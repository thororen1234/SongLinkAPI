import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { config } from './config.ts';
import { providers } from './providers/index.ts';

serve({ fetch: app.fetch, port: config.port }, (info) => {
  const searchable = providers.filter((p) => p.canSearch()).map((p) => p.apiProvider);
  console.log(`SongLink API listening on http://localhost:${info.port}`);
  console.log(`Searching: ${searchable.join(', ')}`);
});
