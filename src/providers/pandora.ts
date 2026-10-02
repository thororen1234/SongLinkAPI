import { randomBytes } from 'node:crypto';
import { getJson, getText, HttpError } from '../http.ts';
import { bestMatch, buildQuery, type Candidate } from '../match.ts';
import type { Entity, EntityType, LinkRef, LookupOptions, Provider, SearchTarget } from '../types.ts';

const BASE = 'https://www.pandora.com';
const CSRF = randomBytes(8).toString('hex');

async function pandora(path: string, body: unknown): Promise<any> {
  return getJson(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CsrfToken': CSRF, Cookie: `csrftoken=${CSRF}` },
    body: JSON.stringify(body),
  });
}

async function annotate(pandoraId: string): Promise<any | null> {
  return (await pandora('/api/v4/catalog/annotateObjectsSimple', { pandoraIds: [pandoraId] }))?.[pandoraId] ?? null;
}

async function pandoraIdFor(ref: LinkRef): Promise<string | null> {
  if (/^(TR|AL):\d+$/.test(ref.id)) return ref.id;
  try {
    const html = await getText(`${BASE}/artist/_/_/${ref.type === 'song' ? '_/' : ''}${encodeURIComponent(ref.id)}`);
    return html.match(/pandoraId=((?:TR|AL):\d+)/)?.[1] ?? null;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

function toEntity(a: any): Entity {
  const type: EntityType = a.type === 'TR' ? 'song' : 'album';
  const id = a.shareableUrlPath?.split('/').pop() ?? a.pandoraId;
  const art = a.icon?.artUrl ? `https://content-images.p-cdn.com/${a.icon.artUrl}` : undefined;
  return {
    uniqueId: `PANDORA_${type === 'song' ? 'SONG' : 'ALBUM'}::${id}`,
    id,
    type,
    title: a.name,
    artistName: a.artistName,
    thumbnailUrl: art,
    thumbnailWidth: art ? 500 : undefined,
    thumbnailHeight: art ? 500 : undefined,
    apiProvider: 'pandora',
    platforms: ['pandora'],
    isrc: a.isrc,
    durationMs: a.durationMillis ?? (type === 'song' && a.duration ? a.duration * 1000 : undefined),
    links: {
      pandora: { url: BASE + a.shareableUrlPath },
    },
  };
}

export const pandoraProvider: Provider = {
  apiProvider: 'pandora',
  platformAliases: ['pandora'],

  canLookup: () => true,
  canSearch: () => true,

  parseUrl(url) {
    if (!/^(www\.)?pandora\.com$/.test(url.hostname)) return null;
    const m = url.pathname.match(/^\/artist\/.+\/((TR|AL)[A-Za-z0-9]+)\/?$/);
    if (!m) return null;
    return { type: m[2] === 'TR' ? 'song' : 'album', id: m[1] };
  },

  async lookup(ref: LinkRef, opts: LookupOptions) {
    const pandoraId = await pandoraIdFor(ref);
    const a = pandoraId && (await annotate(pandoraId));
    if (!a?.shareableUrlPath) return null;
    if (opts.songIfSingle && a.type === 'AL' && a.trackCount === 1 && a.tracks?.[0]) {
      const t = await annotate(a.tracks[0]);
      if (t?.shareableUrlPath) return toEntity(t);
    }
    return toEntity(a);
  },

  async search(target: SearchTarget) {
    const type = target.type === 'song' ? 'TR' : 'AL';
    const res = await pandora('/api/v3/sod/search', {
      query: buildQuery(target),
      types: [type],
      listener: null,
      start: 0,
      count: 20,
      annotate: true,
      searchTime: 0,
      annotationRecipe: 'CLASS_OF_2019',
    });
    const items: any[] = (res?.results ?? [])
      .map((id: string) => res.annotations?.[id])
      .filter((a: any) => a?.type === type && a.shareableUrlPath);
    const exact = target.isrc && items.find((a) => a.isrc === target.isrc);
    if (exact) return toEntity(exact);
    const candidates: Candidate<any>[] = items.map((a) => ({
      title: a.name,
      artistName: a.artistName ?? '',
      durationMs: type === 'TR' ? (a.durationMillis ?? a.duration * 1000) : undefined,
      item: a,
    }));
    const hit = bestMatch(target, candidates);
    return hit ? toEntity(hit) : null;
  },
};
