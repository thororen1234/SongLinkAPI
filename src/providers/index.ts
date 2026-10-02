import type { Provider } from '../types.ts';
import { deezerProvider } from './deezer.ts';
import { itunesProvider } from './itunes.ts';
import { spotifyProvider } from './spotify.ts';
import { tidalProvider } from './tidal.ts';
import { youtubeProvider } from './youtube.ts';

export const providers: Provider[] = [
  spotifyProvider,
  itunesProvider,
  deezerProvider,
  youtubeProvider,
  tidalProvider,
];

export function providerByName(name: string): Provider | undefined {
  const n = name.toLowerCase();
  return providers.find((p) => p.platformAliases.some((a) => a.toLowerCase() === n));
}
