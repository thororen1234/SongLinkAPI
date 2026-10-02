const env = process.env;

const port = Number(env.PORT) || 3000;

export const config = {
  port,
  publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  apiKeys: (env.API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean),
  cacheTtlMs: (Number(env.CACHE_TTL_SECONDS) || 86400) * 1000,
  defaultCountry: (env.DEFAULT_COUNTRY || 'US').toUpperCase(),
  spotify: {
    clientId: env.SPOTIFY_CLIENT_ID || '',
    clientSecret: env.SPOTIFY_CLIENT_SECRET || '',
  },
  youtube: {
    apiKey: env.YOUTUBE_API_KEY || '',
  },
  tidal: {
    clientId: env.TIDAL_CLIENT_ID || '',
    clientSecret: env.TIDAL_CLIENT_SECRET || '',
  },
};
