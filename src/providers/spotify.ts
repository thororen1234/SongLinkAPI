import { config } from '../config.ts';
import { ClientCredentialsToken, getJsonOrNull, getText } from '../http.ts';
import { bestMatch, type Candidate } from '../match.ts';
import type { Entity, EntityType, LinkRef, LookupOptions, Provider, SearchTarget } from '../types.ts';

const API = 'https://api.spotify.com/v1';
const hasCredentials = () => Boolean(config.spotify.clientId && config.spotify.clientSecret);

let token: ClientCredentialsToken | null = null;

async function spotify(path: string, params: Record<string, string> = {}): Promise<any | null> {
  token ??= new ClientCredentialsToken(
    'https://accounts.spotify.com/api/token',
    config.spotify.clientId,
    config.spotify.clientSecret,
  );
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return getJsonOrNull(url, { headers: { Authorization: `Bearer ${await token.get()}` } });
}

function links(type: EntityType, id: string): Entity['links'] {
  const kind = type === 'song' ? 'track' : 'album';
  return {
    spotify: {
      url: `https://open.spotify.com/${kind}/${id}`,
      nativeAppUriDesktop: `spotify:${kind}:${id}`,
    },
  };
}

function toEntity(type: EntityType, d: any): Entity {
  const image = (type === 'song' ? d.album?.images : d.images)?.[0];
  return {
    uniqueId: `SPOTIFY_${type === 'song' ? 'SONG' : 'ALBUM'}::${d.id}`,
    id: d.id,
    type,
    title: d.name,
    artistName: (d.artists ?? []).map((a: any) => a.name).join(', '),
    thumbnailUrl: image?.url,
    thumbnailWidth: image?.width ?? undefined,
    thumbnailHeight: image?.height ?? undefined,
    apiProvider: 'spotify',
    platforms: ['spotify'],
    isrc: d.external_ids?.isrc,
    upc: d.external_ids?.upc,
    durationMs: d.duration_ms,
    links: links(type, d.id),
  };
}

/** Keyless fallback: the public embed page ships the entity metadata as JSON. */
async function lookupViaEmbed(ref: LinkRef): Promise<Entity | null> {
  const kind = ref.type === 'song' ? 'track' : 'album';
  let html: string;
  try {
    html = await getText(`https://open.spotify.com/embed/${kind}/${ref.id}`);
  } catch {
    return null;
  }
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (!m) return null;
  const e = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!e?.id) return null;
  const images: any[] = e.visualIdentity?.image ?? e.coverArt?.sources ?? [];
  const image = images.reduce<any>((best, img) => ((img.maxWidth ?? 0) > (best?.maxWidth ?? 0) ? img : best), null);
  const artists: any[] = e.artists ?? [];
  return {
    uniqueId: `SPOTIFY_${ref.type === 'song' ? 'SONG' : 'ALBUM'}::${e.id}`,
    id: e.id,
    type: ref.type,
    title: e.title ?? e.name,
    artistName: artists.length ? artists.map((a) => a.name).join(', ') : e.subtitle,
    thumbnailUrl: image?.url,
    thumbnailWidth: image?.maxWidth,
    thumbnailHeight: image?.maxHeight,
    apiProvider: 'spotify',
    platforms: ['spotify'],
    durationMs: e.duration,
    links: links(ref.type, e.id),
  };
}

export const spotifyProvider: Provider = {
  apiProvider: 'spotify',
  platformAliases: ['spotify'],

  canLookup: () => true,
  canSearch: hasCredentials,

  parseUrl(url) {
    if (url.protocol === 'spotify:') {
      const m = url.pathname.match(/^(track|album):([A-Za-z0-9]{22})$/);
      return m ? { type: m[1] === 'track' ? 'song' : 'album', id: m[2] } : null;
    }
    if (url.hostname !== 'open.spotify.com' && url.hostname !== 'play.spotify.com') return null;
    const m = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album)\/([A-Za-z0-9]{22})/i);
    return m ? { type: m[1] === 'track' ? 'song' : 'album', id: m[2] } : null;
  },

  async lookup(ref: LinkRef, opts: LookupOptions) {
    if (!hasCredentials()) return lookupViaEmbed(ref);
    const market = opts.country;
    if (ref.type === 'song') {
      const t = await spotify(`/tracks/${ref.id}`, { market });
      return t ? toEntity('song', t) : null;
    }
    const a = await spotify(`/albums/${ref.id}`, { market });
    if (!a) return null;
    if (opts.songIfSingle && a.total_tracks === 1 && a.tracks?.items?.[0]) {
      return this.lookup({ type: 'song', id: a.tracks.items[0].id }, opts);
    }
    return toEntity('album', a);
  },

  async search(target: SearchTarget, country: string) {
    const kind = target.type === 'song' ? 'track' : 'album';
    const run = async (q: string) => {
      const res = await spotify('/search', { q, type: kind, market: country, limit: '10' });
      return (res?.[`${kind}s`]?.items ?? []).filter(Boolean) as any[];
    };

    const code = target.type === 'song' ? target.isrc && `isrc:${target.isrc}` : target.upc && `upc:${target.upc}`;
    if (code) {
      const [hit] = await run(code);
      if (hit) return toEntity(target.type, hit);
    }

    const field = target.type === 'song' ? 'track' : 'album';
    let items = await run(`${field}:"${target.title}" artist:"${target.artistName}"`);
    if (!items.length) items = await run(`${target.artistName} ${target.title}`);
    const candidates: Candidate<any>[] = items.map((d) => ({
      title: d.name,
      artistName: (d.artists ?? []).map((a: any) => a.name).join(', '),
      durationMs: d.duration_ms,
      item: d,
    }));
    const hit = bestMatch(target, candidates);
    return hit ? toEntity(target.type, hit) : null;
  },
};
