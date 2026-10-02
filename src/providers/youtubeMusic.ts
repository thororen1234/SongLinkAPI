import { getJson } from '../http.ts';
import { bestMatch, buildQuery, type Candidate } from '../match.ts';
import type { Entity, LinkRef, LookupOptions, Provider, SearchTarget } from '../types.ts';

const API = 'https://music.youtube.com/youtubei/v1';
const CLIENT_VERSION = '1.20250101.01.00';

const SONGS_FILTER = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';
const ALBUMS_FILTER = 'EgWKAQIYAWoMEA4QChADEAQQCRAF';

async function innertube(endpoint: string, body: Record<string, unknown>, country = 'US'): Promise<any> {
  return getJson(`${API}/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB_REMIX', clientVersion: CLIENT_VERSION, hl: 'en', gl: country } },
      ...body,
    }),
  });
}

function findAll(node: any, key: string, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, key, out);
  } else if (node[key]) {
    out.push(node[key]);
  } else {
    for (const v of Object.values(node)) findAll(v, key, out);
  }
  return out;
}

function text(o: any): string {
  return o?.runs?.map((r: any) => r.text).join('') ?? '';
}

function flexColumn(r: any, i: number): string {
  return text(r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text);
}

function bigThumbnail(thumbnails: any[] | undefined): string | undefined {
  return thumbnails?.at(-1)?.url?.replace(/=w\d+-h\d+/, '=w544-h544');
}

function clockToMs(s: string | undefined): number | undefined {
  if (!s || !/^\d+(:\d+)+$/.test(s)) return undefined;
  return s.split(':').reduce((acc, n) => acc * 60 + Number(n), 0) * 1000;
}

interface Song {
  id: string;
  title: string;
  artistName: string;
  durationMs?: number;
  thumbnailUrl?: string;
}

interface Album {
  id: string;
  title: string;
  artistName: string;
  url: string;
  trackCount?: number;
  firstTrack?: Song;
  thumbnailUrl?: string;
}

function songEntity(s: Song): Entity {
  return {
    uniqueId: `YOUTUBE_MUSIC_SONG::${s.id}`,
    id: s.id,
    type: 'song',
    title: s.title,
    artistName: s.artistName,
    thumbnailUrl: s.thumbnailUrl,
    thumbnailWidth: s.thumbnailUrl ? 544 : undefined,
    thumbnailHeight: s.thumbnailUrl ? 544 : undefined,
    apiProvider: 'youtubeMusic',
    platforms: ['youtubeMusic'],
    durationMs: s.durationMs,
    links: {
      youtubeMusic: { url: `https://music.youtube.com/watch?v=${s.id}` },
    },
  };
}

function albumEntity(a: Album): Entity {
  return {
    uniqueId: `YOUTUBE_MUSIC_ALBUM::${a.id}`,
    id: a.id,
    type: 'album',
    title: a.title,
    artistName: a.artistName,
    thumbnailUrl: a.thumbnailUrl,
    thumbnailWidth: a.thumbnailUrl ? 544 : undefined,
    thumbnailHeight: a.thumbnailUrl ? 544 : undefined,
    apiProvider: 'youtubeMusic',
    platforms: ['youtubeMusic'],
    links: {
      youtubeMusic: { url: a.url },
    },
  };
}

async function lookupSong(videoId: string): Promise<Song | null> {
  const v = (await innertube('player', { videoId }))?.videoDetails;
  if (!v?.title) return null;
  return {
    id: videoId,
    title: v.title,
    artistName: v.author?.replace(/\s-\sTopic$/, '') ?? '',
    durationMs:
      v.lengthSeconds && v.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV' ? Number(v.lengthSeconds) * 1000 : undefined,
    thumbnailUrl: v.thumbnail?.thumbnails?.at(-1)?.url,
  };
}

async function lookupAlbum(id: string): Promise<Album | null> {
  let browseId = id;
  if (!id.startsWith('MPREb_')) {
    const playlist = await innertube('browse', { browseId: `VL${id}` });
    browseId = JSON.stringify(playlist).match(/"browseId":"(MPREb_[\w-]+)"/)?.[1] ?? '';
    if (!browseId) return null;
  }
  const data = await innertube('browse', { browseId });
  const header = findAll(data, 'musicResponsiveHeaderRenderer')[0];
  if (!header) return null;
  const artistName = text(header.straplineTextOne);
  const thumbnailUrl = bigThumbnail(header.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  const trackCount = text(header.secondSubtitle).match(/^(\d+) songs?\b/)?.[1];
  const first = findAll(data, 'musicResponsiveListItemRenderer')[0];
  const firstTrack: Song | undefined = first?.playlistItemData?.videoId
    ? {
        id: first.playlistItemData.videoId,
        title: flexColumn(first, 0),
        artistName,
        durationMs: clockToMs(text(first.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)),
        thumbnailUrl,
      }
    : undefined;
  return {
    id: browseId,
    title: text(header.title),
    artistName,
    url: data.microformat?.microformatDataRenderer?.urlCanonical ?? `https://music.youtube.com/browse/${browseId}`,
    trackCount: trackCount ? Number(trackCount) : undefined,
    firstTrack,
    thumbnailUrl,
  };
}

async function searchSongs(query: string, country: string): Promise<Song[]> {
  const data = await innertube('search', { query, params: SONGS_FILTER }, country);
  return findAll(data, 'musicResponsiveListItemRenderer').flatMap((r): Song[] => {
    const id = r.playlistItemData?.videoId;
    if (!id) return [];
    const meta = flexColumn(r, 1).split(' • ');
    return [
      {
        id,
        title: flexColumn(r, 0),
        artistName: meta[0] ?? '',
        durationMs: clockToMs(meta.at(-1)),
        thumbnailUrl: bigThumbnail(r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      },
    ];
  });
}

async function searchAlbums(
  query: string,
  country: string,
): Promise<{ id: string; title: string; artistName: string }[]> {
  const data = await innertube('search', { query, params: ALBUMS_FILTER }, country);
  return findAll(data, 'musicResponsiveListItemRenderer').flatMap((r) => {
    const id: string | undefined = r.navigationEndpoint?.browseEndpoint?.browseId;
    if (!id?.startsWith('MPREb_')) return [];
    const meta = flexColumn(r, 1).split(' • ');
    return [{ id, title: flexColumn(r, 0), artistName: meta[1] ?? '' }];
  });
}

export const youtubeMusicProvider: Provider = {
  apiProvider: 'youtubeMusic',
  platformAliases: ['youtubeMusic', 'youtubemusic', 'ytmusic'],

  canLookup: () => true,
  canSearch: () => true,

  parseUrl(url) {
    const host = url.hostname.replace(/^(www|m)\./, '');
    const list = url.searchParams.get('list');
    if (host === 'music.youtube.com') {
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return { type: 'song', id: v };
      const browse = url.pathname.match(/^\/browse\/(MPREb_[\w-]+)/)?.[1];
      if (browse) return { type: 'album', id: browse };
    }
    if (
      (host === 'music.youtube.com' || host === 'youtube.com') &&
      list?.startsWith('OLAK5uy_') &&
      !url.searchParams.get('v')
    ) {
      return { type: 'album', id: list };
    }
    return null;
  },

  async lookup(ref: LinkRef, opts: LookupOptions) {
    if (ref.type === 'song') {
      const s = await lookupSong(ref.id);
      return s ? songEntity(s) : null;
    }
    const a = await lookupAlbum(ref.id);
    if (!a) return null;
    if (opts.songIfSingle && a.trackCount === 1 && a.firstTrack) return songEntity(a.firstTrack);
    return albumEntity(a);
  },

  async search(target: SearchTarget, country: string) {
    const query = buildQuery(target);
    if (target.type === 'song') {
      const songs = await searchSongs(query, country);
      const candidates: Candidate<Song>[] = songs.map((s) => ({ ...s, item: s }));
      const hit = bestMatch(target, candidates);
      return hit ? songEntity(hit) : null;
    }
    const albums = await searchAlbums(query, country);
    const hit = bestMatch(
      target,
      albums.map((a) => ({ ...a, item: a })),
    );
    if (!hit) return null;
    const full = await lookupAlbum(hit.id);
    return full ? albumEntity(full) : null;
  },
};
