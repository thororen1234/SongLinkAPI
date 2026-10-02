import { config } from '../config.ts';
import { ClientCredentialsToken, getJsonOrNull } from '../http.ts';
import { bestMatch, buildQuery, type Candidate } from '../match.ts';
import type { Entity, EntityType, LinkRef, LookupOptions, Provider, SearchTarget } from '../types.ts';

const API = 'https://openapi.tidal.com/v2';
const hasCredentials = () => Boolean(config.tidal.clientId && config.tidal.clientSecret);

let token: ClientCredentialsToken | null = null;

async function tidal(path: string, params: Record<string, string>): Promise<any | null> {
  token ??= new ClientCredentialsToken(
    'https://auth.tidal.com/v1/oauth2/token',
    config.tidal.clientId,
    config.tidal.clientSecret,
  );
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return getJsonOrNull(url, {
    headers: { Authorization: `Bearer ${await token.get()}`, Accept: 'application/vnd.api+json' },
  });
}

function isoDurationToMs(s: string | undefined): number | undefined {
  const m = s?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return undefined;
  return Math.round(((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000);
}

function artistNames(resource: any, included: any[]): string {
  const ids = new Set((resource.relationships?.artists?.data ?? []).map((r: any) => r.id));
  return included
    .filter((i) => i.type === 'artists' && ids.has(i.id))
    .map((i) => i.attributes?.name)
    .join(', ');
}

function toEntity(type: EntityType, resource: any, included: any[]): Entity {
  const a = resource.attributes ?? {};
  const kind = type === 'song' ? 'track' : 'album';
  const hasVersion = !a.version || a.title?.toLowerCase().includes(String(a.version).toLowerCase());
  const title = hasVersion ? a.title : `${a.title} (${a.version})`;
  return {
    uniqueId: `TIDAL_${type === 'song' ? 'SONG' : 'ALBUM'}::${resource.id}`,
    id: String(resource.id),
    type,
    title,
    artistName: artistNames(resource, included),
    apiProvider: 'tidal',
    platforms: ['tidal'],
    isrc: a.isrc,
    upc: a.barcodeId,
    durationMs: isoDurationToMs(a.duration),
    links: {
      tidal: {
        url: `https://tidal.com/browse/${kind}/${resource.id}`,
        nativeAppUriDesktop: `tidal://${kind}/${resource.id}`,
      },
    },
  };
}

export const tidalProvider: Provider = {
  apiProvider: 'tidal',
  platformAliases: ['tidal'],

  canLookup: hasCredentials,
  canSearch: hasCredentials,

  parseUrl(url) {
    if (!/(^|\.)tidal\.com$/.test(url.hostname)) return null;
    const m = url.pathname.match(/^\/(?:browse\/)?(track|album)\/(\d+)/);
    return m ? { type: m[1] === 'track' ? 'song' : 'album', id: m[2] } : null;
  },

  async lookup(ref: LinkRef, opts: LookupOptions) {
    const kind = ref.type === 'song' ? 'tracks' : 'albums';
    const res = await tidal(`/${kind}/${ref.id}`, { countryCode: opts.country, include: 'artists' });
    if (!res?.data) return null;
    if (ref.type === 'album' && opts.songIfSingle && res.data.attributes?.numberOfItems === 1) {
      const items = await tidal(`/albums/${ref.id}/relationships/items`, { countryCode: opts.country });
      const first = items?.data?.find((i: any) => i.type === 'tracks');
      if (first) return this.lookup({ type: 'song', id: String(first.id) }, opts);
    }
    return toEntity(ref.type, res.data, res.included ?? []);
  },

  async search(target: SearchTarget, country: string) {
    const kind = target.type === 'song' ? 'tracks' : 'albums';
    const code = target.type === 'song' ? target.isrc : target.upc;
    if (code) {
      const filter = target.type === 'song' ? 'filter[isrc]' : 'filter[barcodeId]';
      const res = await tidal(`/${kind}`, { countryCode: country, [filter]: code, include: 'artists' });
      const hit = res?.data?.[0];
      if (hit) return toEntity(target.type, hit, res.included ?? []);
    }

    const search = await tidal(`/searchResults/${encodeURIComponent(buildQuery(target))}/relationships/${kind}`, {
      countryCode: country,
    });
    const ids: string[] = (search?.data ?? []).slice(0, 10).map((r: any) => String(r.id));
    if (!ids.length) return null;
    const res = await tidal(`/${kind}`, { countryCode: country, 'filter[id]': ids.join(','), include: 'artists' });
    const included = res?.included ?? [];
    const candidates: Candidate<any>[] = (res?.data ?? []).map((r: any) => {
      const e = toEntity(target.type, r, included);
      return { title: e.title ?? '', artistName: e.artistName ?? '', durationMs: e.durationMs, item: r };
    });
    const hit = bestMatch(target, candidates);
    return hit ? toEntity(target.type, hit, included) : null;
  },
};
