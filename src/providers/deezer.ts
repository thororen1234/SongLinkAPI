import { getJson } from '../http.ts';
import { bestMatch, buildQuery, type Candidate } from '../match.ts';
import type { Entity, EntityType, LinkRef, LookupOptions, Provider, SearchTarget } from '../types.ts';

const API = 'https://api.deezer.com';

async function deezer(path: string, params?: Record<string, string>): Promise<any | null> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const data = await getJson(url);
  if (data?.error) return null;
  return data;
}

function toEntity(type: EntityType, d: any): Entity {
  const id = String(d.id);
  const cover = type === 'song' ? d.album : d;
  const path = `${type === 'song' ? 'track' : 'album'}/${id}`;
  return {
    uniqueId: `DEEZER_${type === 'song' ? 'SONG' : 'ALBUM'}::${id}`,
    id,
    type,
    title: d.title,
    artistName: d.artist?.name,
    thumbnailUrl: cover?.cover_big,
    thumbnailWidth: cover?.cover_big ? 500 : undefined,
    thumbnailHeight: cover?.cover_big ? 500 : undefined,
    apiProvider: 'deezer',
    platforms: ['deezer'],
    isrc: d.isrc,
    upc: d.upc,
    durationMs: d.duration ? d.duration * 1000 : undefined,
    links: {
      deezer: {
        url: `https://www.deezer.com/${path}`,
        nativeAppUriDesktop: `deezer://www.deezer.com/${path}`,
      },
    },
  };
}

export const deezerProvider: Provider = {
  apiProvider: 'deezer',
  platformAliases: ['deezer'],

  canLookup: () => true,
  canSearch: () => true,

  parseUrl(url) {
    if (!/(^|\.)deezer\.com$/.test(url.hostname)) return null;
    const m = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album)\/(\d+)/i);
    if (!m) return null;
    return { type: m[1].toLowerCase() === 'track' ? 'song' : 'album', id: m[2] };
  },

  async lookup(ref: LinkRef, opts: LookupOptions) {
    if (ref.type === 'song') {
      const t = await deezer(`/track/${ref.id}`);
      return t ? toEntity('song', t) : null;
    }
    const a = await deezer(`/album/${ref.id}`);
    if (!a) return null;
    if (opts.songIfSingle && a.nb_tracks === 1 && a.tracks?.data?.[0]) {
      return this.lookup({ type: 'song', id: String(a.tracks.data[0].id) }, opts);
    }
    return toEntity('album', a);
  },

  async search(target: SearchTarget) {
    if (target.type === 'song') {
      if (target.isrc) {
        const t = await deezer(`/track/isrc:${target.isrc}`);
        if (t) return toEntity('song', t);
      }
      const res = await deezer('/search', { q: buildQuery(target), limit: '15' });
      const candidates: Candidate<any>[] = (res?.data ?? []).map((t: any) => ({
        title: t.title,
        artistName: t.artist?.name ?? '',
        durationMs: t.duration * 1000,
        item: t,
      }));
      const hit = bestMatch(target, candidates);
      return hit ? toEntity('song', hit) : null;
    }

    if (target.upc) {
      const a = await deezer(`/album/upc:${target.upc}`);
      if (a) return toEntity('album', a);
    }
    const res = await deezer('/search/album', { q: buildQuery(target), limit: '15' });
    const candidates: Candidate<any>[] = (res?.data ?? []).map((a: any) => ({
      title: a.title,
      artistName: a.artist?.name ?? '',
      item: a,
    }));
    const hit = bestMatch(target, candidates);
    if (!hit) return null;
    const full = await deezer(`/album/${hit.id}`);
    return toEntity('album', full ?? hit);
  },
};
