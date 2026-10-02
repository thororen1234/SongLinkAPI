import { getJsonOrNull, getText, HttpError } from '../http.ts';
import { bestMatch, buildQuery, splitYouTubeTitle, type Candidate } from '../match.ts';
import type { Entity, EntityType, LinkRef, LookupOptions, Provider, SearchTarget } from '../types.ts';

const API = 'https://api-v2.soundcloud.com';

const RESERVED_PATHS = new Set([
  'discover',
  'search',
  'stream',
  'you',
  'upload',
  'charts',
  'pages',
  'settings',
  'messages',
  'notifications',
  'people',
  'tags',
  'stations',
  'feed',
  'terms-of-use',
  'mobile',
  'jobs',
]);

let clientIdPromise: Promise<string> | null = null;

async function fetchClientId(): Promise<string> {
  const html = await getText('https://soundcloud.com/');
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
    .map((m) => m[1])
    .reverse();
  for (const src of scripts) {
    const m = (await getText(src)).match(/client_id\s*[:=]\s*"([A-Za-z0-9]{32})"/);
    if (m) return m[1];
  }
  throw new Error('Could not find a SoundCloud client_id');
}

function getClientId(): Promise<string> {
  clientIdPromise ??= fetchClientId().catch((err) => {
    clientIdPromise = null;
    throw err;
  });
  return clientIdPromise;
}

async function soundcloud(path: string, params: Record<string, string> = {}): Promise<any | null> {
  for (let attempt = 0; ; attempt++) {
    const url = new URL(API + path);
    url.search = new URLSearchParams({ ...params, client_id: await getClientId() }).toString();
    try {
      return await getJsonOrNull(url);
    } catch (err) {
      if (attempt === 0 && err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        clientIdPromise = null;
        continue;
      }
      throw err;
    }
  }
}

function trackMeta(t: any): { title: string; artistName: string } {
  if (t.publisher_metadata?.artist) return { title: t.title, artistName: t.publisher_metadata.artist };
  return splitYouTubeTitle(t.title ?? '', t.user?.username ?? '');
}

function toEntity(type: EntityType, d: any): Entity {
  const id = String(d.id);
  const art: string | undefined = (d.artwork_url ?? d.user?.avatar_url)?.replace('-large.', '-t500x500.');
  return {
    uniqueId: `SOUNDCLOUD_${type === 'song' ? 'SONG' : 'ALBUM'}::${id}`,
    id,
    type,
    ...(type === 'song' ? trackMeta(d) : { title: d.title, artistName: d.user?.username }),
    thumbnailUrl: art,
    thumbnailWidth: art ? 500 : undefined,
    thumbnailHeight: art ? 500 : undefined,
    apiProvider: 'soundcloud',
    platforms: ['soundcloud'],
    isrc: d.publisher_metadata?.isrc,
    upc: d.publisher_metadata?.upc_or_ean,
    durationMs: d.full_duration ?? d.duration,
    links: {
      soundcloud: { url: d.permalink_url },
    },
  };
}

export const soundcloudProvider: Provider = {
  apiProvider: 'soundcloud',
  platformAliases: ['soundcloud'],

  canLookup: () => true,
  canSearch: () => true,

  parseUrl(url) {
    if (!/^((www|m)\.)?soundcloud\.com$/.test(url.hostname)) return null;
    const [user, slug, third, secret] = url.pathname.split('/').filter(Boolean);
    if (!user || !slug || RESERVED_PATHS.has(user)) return null;
    if (slug === 'sets' && third) {
      return { type: 'album', id: [user, slug, third, ...(secret?.startsWith('s-') ? [secret] : [])].join('/') };
    }
    if (
      ['tracks', 'albums', 'popular-tracks', 'likes', 'reposts', 'followers', 'following', 'comments'].includes(slug)
    ) {
      return null;
    }
    return { type: 'song', id: [user, slug, ...(third?.startsWith('s-') ? [third] : [])].join('/') };
  },

  async lookup(ref: LinkRef, opts: LookupOptions) {
    const d = /^\d+$/.test(ref.id)
      ? await soundcloud(`/${ref.type === 'song' ? 'tracks' : 'playlists'}/${ref.id}`)
      : await soundcloud('/resolve', { url: `https://soundcloud.com/${ref.id}` });
    if (d?.kind === 'track') return toEntity('song', d);
    if (d?.kind !== 'playlist') return null;
    if (opts.songIfSingle && d.track_count === 1 && d.tracks?.[0]) {
      const t = d.tracks[0].title ? d.tracks[0] : await soundcloud(`/tracks/${d.tracks[0].id}`);
      if (t) return toEntity('song', t);
    }
    return toEntity('album', d);
  },

  async search(target: SearchTarget) {
    if (target.type === 'song') {
      const res = await soundcloud('/search/tracks', { q: buildQuery(target), limit: '20' });
      const tracks: any[] = res?.collection ?? [];
      const exact = target.isrc && tracks.find((t) => t.publisher_metadata?.isrc === target.isrc);
      if (exact) return toEntity('song', exact);
      const candidates: Candidate<any>[] = tracks.map((t) => ({
        ...trackMeta(t),
        durationMs: t.full_duration ?? t.duration,
        item: t,
        bonus: t.publisher_metadata?.isrc ? 0.05 : 0,
      }));
      const hit = bestMatch(target, candidates);
      return hit ? toEntity('song', hit) : null;
    }

    const res = await soundcloud('/search/albums', { q: buildQuery(target), limit: '10' });
    const candidates: Candidate<any>[] = (res?.collection ?? []).map((a: any) => ({
      title: a.title,
      artistName: a.user?.username ?? '',
      item: a,
    }));
    const hit = bestMatch(target, candidates);
    return hit ? toEntity('album', hit) : null;
  },
};
