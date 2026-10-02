import { getJson } from '../http.ts';
import { bestMatch, buildQuery, type Candidate } from '../match.ts';
import type { Entity, EntityType, LinkRef, LookupOptions, Provider, SearchTarget } from '../types.ts';

const API = 'https://itunes.apple.com';

async function itunes(path: string, params: Record<string, string>): Promise<any[]> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const data = await getJson(url);
  return data?.results ?? [];
}

function toEntity(type: EntityType, r: any, country: string): Entity {
  const id = String(type === 'song' ? r.trackId : r.collectionId);
  const cc = country.toLowerCase();
  const path =
    type === 'song'
      ? `${cc}/album/_/${r.collectionId}?i=${r.trackId}&mt=1`
      : `${cc}/album/_/${r.collectionId}?mt=1`;
  const artwork: string | undefined = r.artworkUrl100?.replace(/\/\d+x\d+bb\./, '/512x512bb.');
  return {
    uniqueId: `ITUNES_${type === 'song' ? 'SONG' : 'ALBUM'}::${id}`,
    id,
    type,
    title: type === 'song' ? r.trackName : r.collectionName,
    artistName: r.artistName,
    thumbnailUrl: artwork,
    thumbnailWidth: artwork ? 512 : undefined,
    thumbnailHeight: artwork ? 512 : undefined,
    apiProvider: 'itunes',
    platforms: ['appleMusic', 'itunes'],
    durationMs: r.trackTimeMillis,
    links: {
      appleMusic: {
        url: `https://geo.music.apple.com/${path}&app=music`,
        nativeAppUriMobile: `music://music.apple.com/${path}&app=music`,
        nativeAppUriDesktop: `itms://music.apple.com/${path}&app=music`,
      },
      itunes: {
        url: `https://geo.music.apple.com/${path}&app=itunes`,
        nativeAppUriMobile: `itmss://music.apple.com/${path}&app=itunes`,
        nativeAppUriDesktop: `itmss://music.apple.com/${path}&app=itunes`,
      },
    },
  };
}

export const itunesProvider: Provider = {
  apiProvider: 'itunes',
  platformAliases: ['itunes', 'appleMusic', 'applemusic', 'apple'],

  canLookup: () => true,
  canSearch: () => true,

  parseUrl(url) {
    if (!/^(geo\.)?(music|itunes)\.apple\.com$/.test(url.hostname)) return null;
    const songId = url.searchParams.get('i');
    const m = url.pathname.match(/\/(album|song|music-video)\/(?:[^/]+\/)?(?:id)?(\d+)\/?$/);
    if (!m) return null;
    if (songId) return { type: 'song', id: songId };
    return { type: m[1] === 'album' ? 'album' : 'song', id: m[2] };
  },

  async lookup(ref: LinkRef, opts: LookupOptions) {
    const results = await itunes('/lookup', {
      id: ref.id,
      country: opts.country,
      ...(ref.type === 'album' ? { entity: 'song' } : {}),
    });
    if (ref.type === 'song') {
      const t = results.find((r) => r.wrapperType === 'track');
      return t ? toEntity('song', t, opts.country) : null;
    }
    const album = results.find((r) => r.wrapperType === 'collection');
    if (!album) return null;
    const tracks = results.filter((r) => r.wrapperType === 'track');
    if (opts.songIfSingle && album.trackCount === 1 && tracks[0]) {
      return toEntity('song', tracks[0], opts.country);
    }
    return toEntity('album', album, opts.country);
  },

  async search(target: SearchTarget, country: string) {
    if (target.type === 'album' && target.upc) {
      const [hit] = await itunes('/lookup', { upc: target.upc, country });
      if (hit?.wrapperType === 'collection') return toEntity('album', hit, country);
    }
    const results = await itunes('/search', {
      term: buildQuery(target),
      country,
      media: 'music',
      entity: target.type === 'song' ? 'song' : 'album',
      limit: '15',
    });
    const candidates: Candidate<any>[] = results.map((r) => ({
      title: target.type === 'song' ? r.trackName : r.collectionName,
      artistName: r.artistName ?? '',
      durationMs: target.type === 'song' ? r.trackTimeMillis : undefined,
      item: r,
    }));
    const hit = bestMatch(target, candidates);
    return hit ? toEntity(target.type, hit, country) : null;
  },
};
