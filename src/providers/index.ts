import type { Provider } from '../types.ts';
import { deezerProvider } from './deezer.ts';
import { itunesProvider } from './itunes.ts';
import { pandoraProvider } from './pandora.ts';
import { soundcloudProvider } from './soundcloud.ts';
import { spotifyProvider } from './spotify.ts';
import { tidalProvider } from './tidal.ts';
import { youtubeProvider } from './youtube.ts';
import { youtubeMusicProvider } from './youtubeMusic.ts';

export const providers: Provider[] = [
  spotifyProvider,
  itunesProvider,
  deezerProvider,
  youtubeMusicProvider,
  youtubeProvider,
  tidalProvider,
  pandoraProvider,
  soundcloudProvider,
];

export function providerByName(name: string): Provider | undefined {
  const n = name.toLowerCase();
  return providers.find((p) => p.platformAliases.some((a) => a.toLowerCase() === n));
}
