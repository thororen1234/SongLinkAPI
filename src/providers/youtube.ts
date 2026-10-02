import { config } from '../config.ts';
import { getJson, getJsonOrNull, getText } from '../http.ts';
import { bestMatch, buildQuery, splitYouTubeTitle, type Candidate } from '../match.ts';
import type { Entity, LinkRef, Provider, SearchTarget } from '../types.ts';

interface Video {
  id: string;
  title: string;
  channel: string;
  durationMs?: number;
}

function toEntity(v: Video): Entity {
  const { title, artistName } = splitYouTubeTitle(v.title, v.channel);
  return {
    uniqueId: `YOUTUBE_VIDEO::${v.id}`,
    id: v.id,
    type: 'song',
    title,
    artistName,
    thumbnailUrl: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    thumbnailWidth: 480,
    thumbnailHeight: 360,
    apiProvider: 'youtube',
    platforms: ['youtube', 'youtubeMusic'],
    durationMs: v.durationMs,
    links: {
      youtube: {
        url: `https://www.youtube.com/watch?v=${v.id}`,
        nativeAppUriMobile: `vnd.youtube://www.youtube.com/watch?v=${v.id}`,
      },
      youtubeMusic: { url: `https://music.youtube.com/watch?v=${v.id}` },
    },
  };
}

/** "4:29" / "1:02:03" -> ms */
function clockToMs(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

/** "PT4M29S" -> ms */
function isoDurationToMs(s: string | undefined): number | undefined {
  const m = s?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return undefined;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}

async function lookupVideo(id: string): Promise<Video | null> {
  if (config.youtube.apiKey) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({ part: 'snippet,contentDetails', id, key: config.youtube.apiKey }).toString();
    const item = (await getJson(url))?.items?.[0];
    if (!item) return null;
    return {
      id,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      durationMs: isoDurationToMs(item.contentDetails?.duration),
    };
  }
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  const data = await getJsonOrNull(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`);
  return data ? { id, title: data.title, channel: data.author_name } : null;
}

async function searchWithApi(query: string, country: string): Promise<Video[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoCategoryId: '10',
    maxResults: '10',
    regionCode: country,
    q: query,
    key: config.youtube.apiKey,
  }).toString();
  const items: any[] = (await getJson(url))?.items ?? [];
  return items.map((i) => ({
    id: i.id.videoId,
    title: decodeEntities(i.snippet.title),
    channel: decodeEntities(i.snippet.channelTitle),
  }));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Keyless fallback: read the `ytInitialData` blob embedded in the search results page. */
async function searchWithoutApi(query: string, country: string): Promise<Video[]> {
  const url = new URL('https://www.youtube.com/results');
  url.search = new URLSearchParams({ search_query: query, sp: 'EgIQAQ==', gl: country, hl: 'en' }).toString();
  const html = await getText(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  const m = html.match(/var ytInitialData = (\{.+?\});<\/script>/s);
  if (!m) return [];
  const videos: Video[] = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object' || videos.length >= 15) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    const r = node.videoRenderer;
    if (r?.videoId) {
      videos.push({
        id: r.videoId,
        title: r.title?.runs?.map((x: any) => x.text).join('') ?? '',
        channel: r.ownerText?.runs?.[0]?.text ?? '',
        durationMs: clockToMs(r.lengthText?.simpleText),
      });
      return;
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(JSON.parse(m[1]));
  return videos;
}

export const youtubeProvider: Provider = {
  apiProvider: 'youtube',
  platformAliases: ['youtube', 'youtubeMusic', 'youtubemusic'],

  canLookup: () => true,
  canSearch: () => true,

  parseUrl(url) {
    const host = url.hostname.replace(/^(www|m)\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'music.youtube.com') {
      id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { type: 'song', id } : null;
  },

  async lookup(ref: LinkRef) {
    if (ref.type !== 'song') return null;
    const v = await lookupVideo(ref.id);
    return v ? toEntity(v) : null;
  },

  async search(target: SearchTarget, country: string) {
    // Albums on YouTube are auto-generated playlists that can't be searched reliably.
    if (target.type !== 'song') return null;
    const query = buildQuery(target);
    const videos = config.youtube.apiKey
      ? await searchWithApi(query, country)
      : await searchWithoutApi(query, country);
    const candidates: Candidate<Video>[] = videos.map((v) => ({
      ...splitYouTubeTitle(v.title, v.channel),
      durationMs: v.durationMs,
      item: v,
      // Prefer the label-uploaded "Artist - Topic" audio over fan uploads.
      bonus: / - Topic$/.test(v.channel) ? 0.05 : 0,
    }));
    const hit = bestMatch(target, candidates);
    return hit ? toEntity(hit) : null;
  },
};
