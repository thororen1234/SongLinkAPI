import { TtlCache } from './cache.ts';
import { config } from './config.ts';
import { BROWSER_UA } from './http.ts';
import { deezerProvider } from './providers/deezer.ts';
import { providerByName, providers } from './providers/index.ts';
import type { Entity, EntityType, LinkRef, LinksResponse, Provider, SearchTarget } from './types.ts';

export class ApiError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type ResolveInput =
  | { url: string; country: string; songIfSingle: boolean }
  | { platform: string; type: EntityType; id: string; country: string; songIfSingle: boolean };

const SHORT_LINK_HOSTS = new Set([
  'spotify.link',
  'spotify.app.link',
  'link.deezer.com',
  'deezer.page.link',
  'dzr.page.link',
  'apple.co',
  'tidal.link',
  'link.tidal.com',
]);

const cache = new TtlCache<LinksResponse>(config.cacheTtlMs);

function parseInputUrl(raw: string): URL {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    throw new ApiError(400, 'invalid_url', `Could not parse url: ${raw}`);
  }
}

function matchProvider(url: URL): { provider: Provider; ref: LinkRef } | null {
  for (const provider of providers) {
    const ref = provider.parseUrl(url);
    if (ref) return { provider, ref };
  }
  return null;
}

async function expandShortLink(url: URL): Promise<URL | null> {
  if (!SHORT_LINK_HOSTS.has(url.hostname)) return null;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    const final = new URL(res.url);
    if (final.href !== url.href) return final;
    const html = await res.text();
    const m = html.match(/https:\/\/(?:open\.spotify\.com|www\.deezer\.com|music\.apple\.com|tidal\.com)\/[^"'\s<>]+/);
    return m ? new URL(m[0].replace(/&amp;/g, '&')) : null;
  } catch {
    return null;
  }
}

async function identify(input: ResolveInput): Promise<{ provider: Provider; ref: LinkRef }> {
  if ('platform' in input) {
    const provider = providerByName(input.platform);
    if (!provider) throw new ApiError(400, 'unsupported_platform', `Unsupported platform: ${input.platform}`);
    return { provider, ref: { type: input.type, id: input.id } };
  }
  const url = parseInputUrl(input.url);
  const direct = matchProvider(url);
  if (direct) return direct;
  const expanded = await expandShortLink(url);
  const viaRedirect = expanded && matchProvider(expanded);
  if (viaRedirect) return viaRedirect;
  throw new ApiError(400, 'could_not_resolve_entity', `Unsupported or unrecognised url: ${input.url}`);
}

function toTarget(e: Entity): SearchTarget {
  return {
    type: e.type,
    title: e.title ?? '',
    artistName: e.artistName ?? '',
    isrc: e.isrc,
    upc: e.upc,
    durationMs: e.durationMs,
  };
}

async function safeSearch(p: Provider, target: SearchTarget, country: string): Promise<Entity | null> {
  try {
    return await p.search(target, country);
  } catch (err) {
    console.warn(`[${p.apiProvider}] search failed:`, (err as Error).message);
    return null;
  }
}

export function pageUrlFor(e: Entity, country: string): string {
  return `${config.publicUrl}/${country.toLowerCase()}/${e.type}/${e.apiProvider}/${encodeURIComponent(e.id)}`;
}

function buildResponse(source: Entity, matches: Entity[], country: string): LinksResponse {
  const response: LinksResponse = {
    entityUniqueId: source.uniqueId,
    userCountry: country,
    pageUrl: pageUrlFor(source, country),
    entitiesByUniqueId: {},
    linksByPlatform: {},
  };
  for (const e of [source, ...matches]) {
    const { uniqueId, isrc, upc, durationMs, links, ...pub } = e;
    response.entitiesByUniqueId[uniqueId] = pub;
    for (const [platform, link] of Object.entries(links)) {
      response.linksByPlatform[platform as keyof typeof links] ??= { ...link, entityUniqueId: uniqueId };
    }
  }
  return response;
}

export async function resolve(input: ResolveInput): Promise<LinksResponse> {
  const { country, songIfSingle } = input;
  const { provider, ref } = await identify(input);

  const key = `${provider.apiProvider}:${ref.type}:${ref.id}:${country}:${songIfSingle}`;
  if (!provider.canLookup()) {
    throw new ApiError(400, 'platform_not_configured', `${provider.apiProvider} credentials are not configured`);
  }
  return cache.wrap(key, async () => {
    let source: Entity | null;
    try {
      source = await provider.lookup(ref, { country, songIfSingle });
    } catch (err) {
      console.warn(`[${provider.apiProvider}] lookup failed:`, (err as Error).message);
      throw new ApiError(502, 'provider_error', `Failed to look up entity on ${provider.apiProvider}`);
    }
    if (!source) throw new ApiError(404, 'could_not_resolve_entity', `Entity not found on ${provider.apiProvider}`);

    const target = toTarget(source);
    const matches: Entity[] = [];

    if (provider !== deezerProvider && (!target.isrc || (target.type === 'album' && !target.upc))) {
      const dz = await safeSearch(deezerProvider, target, country);
      if (dz) {
        matches.push(dz);
        target.isrc ??= dz.isrc;
        target.upc ??= dz.upc;
      }
    }

    const remaining = providers.filter(
      (p) => p !== provider && p.canSearch() && !matches.some((m) => m.apiProvider === p.apiProvider),
    );
    const found = await Promise.all(remaining.map((p) => safeSearch(p, target, country)));
    for (const e of found) if (e) matches.push(e);

    const order = providers.map((p) => p.apiProvider);
    matches.sort((a, b) => order.indexOf(a.apiProvider) - order.indexOf(b.apiProvider));
    return buildResponse(source, matches, country);
  });
}
