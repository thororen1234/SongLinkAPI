import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.ts';
import { renderErrorPage, renderHomePage, renderLinksPage } from './page.ts';
import { providers } from './providers/index.ts';
import { ApiError, resolve, type ResolveInput } from './resolver.ts';

export const app = new Hono();

function readInput(c: Context): ResolveInput {
  const q = (name: string) => c.req.query(name)?.trim() || undefined;
  const country = (q('userCountry') ?? config.defaultCountry).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new ApiError(400, 'invalid_user_country', 'userCountry must be an ISO 3166-1 alpha-2 code');
  }
  const songIfSingle = q('songIfSingle') === 'true';

  const url = q('url');
  if (url) return { url, country, songIfSingle };

  const platform = q('platform');
  const type = q('type');
  const id = q('id');
  if (platform && id && (type === 'song' || type === 'album')) {
    return { platform, type, id, country, songIfSingle };
  }
  throw new ApiError(400, 'missing_parameters', 'Pass either `url`, or `platform`, `type` (song|album) and `id`');
}

function errorBody(err: unknown) {
  if (err instanceof ApiError) return { statusCode: err.statusCode, code: err.code, message: err.message };
  console.error(err);
  return { statusCode: 500, code: 'internal_error', message: 'Internal server error' };
}

app.use('/v1/*', cors());

app.use('/v1/*', async (c, next) => {
  if (config.apiKeys.length && !config.apiKeys.includes(c.req.query('key') ?? '')) {
    return c.json({ statusCode: 401, code: 'invalid_api_key', message: 'A valid `key` is required' }, 401);
  }
  await next();
});

app.get('/v1/links', async (c) => {
  try {
    return c.json(await resolve(readInput(c)));
  } catch (err) {
    const body = errorBody(err);
    return c.json(body, body.statusCode as 400);
  }
});

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    providers: Object.fromEntries(
      providers.map((p) => [p.apiProvider, { lookup: p.canLookup(), search: p.canSearch() }]),
    ),
  }),
);

app.get('/', (c) => c.html(renderHomePage()));

async function servePage(c: Context, input: ResolveInput) {
  try {
    return c.html(renderLinksPage(await resolve(input)));
  } catch (err) {
    const body = errorBody(err);
    return c.html(renderErrorPage(body.message), body.statusCode as 404);
  }
}

app.get('/page', (c) => {
  const url = c.req.query('url');
  if (!url) return c.redirect('/');
  return servePage(c, { url, country: config.defaultCountry, songIfSingle: true });
});

app.get('/:country{[a-z]{2}}/:type{song|album}/:platform/:id', (c) => {
  const { country, type, platform, id } = c.req.param();
  return servePage(c, {
    platform,
    type: type as 'song' | 'album',
    id,
    country: country.toUpperCase(),
    songIfSingle: false,
  });
});
