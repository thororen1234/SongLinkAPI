import { config } from './config.ts';
import { ApiError, type ResolveInput } from './resolver.ts';

type Query = URLSearchParams | Record<string, string | string[] | undefined>;

function queryValue(query: Query, name: string): string | undefined {
  const value = query instanceof URLSearchParams ? query.get(name) : query[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

export function readResolveInput(query: Query): ResolveInput {
  const country = (queryValue(query, 'userCountry') ?? config.defaultCountry).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ApiError(400, 'invalid_user_country', 'userCountry must be an ISO 3166-1 alpha-2 code');
  }

  const songIfSingle = queryValue(query, 'songIfSingle') === 'true';
  const url = queryValue(query, 'url');
  if (url) return { url, country, songIfSingle };

  const platform = queryValue(query, 'platform');
  const type = queryValue(query, 'type');
  const id = queryValue(query, 'id');
  if (platform && id && (type === 'song' || type === 'album')) {
    return { platform, type, id, country, songIfSingle };
  }
  throw new ApiError(400, 'missing_parameters', 'Pass either `url`, or `platform`, `type` (song|album) and `id`');
}

export function errorBody(error: unknown) {
  if (error instanceof ApiError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message };
  }
  console.error(error);
  return { statusCode: 500, code: 'internal_error', message: 'Internal server error' };
}
