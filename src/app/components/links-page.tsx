import type { LinksResponse, Platform } from '../../types.ts';

const platformNames: Record<Platform, string> = {
  spotify: 'Spotify',
  appleMusic: 'Apple Music',
  itunes: 'iTunes Store',
  deezer: 'Deezer',
  youtube: 'YouTube',
  youtubeMusic: 'YouTube Music',
  tidal: 'TIDAL',
  pandora: 'Pandora',
  soundcloud: 'SoundCloud',
};

export function LinksPage({ data }: { data: LinksResponse }) {
  const entity = data.entitiesByUniqueId[data.entityUniqueId];
  const links = Object.entries(data.linksByPlatform);

  return (
    <main>
      {entity?.thumbnailUrl && <img className="artwork" src={entity.thumbnailUrl} alt="" />}
      <header>
        <h1>{entity?.title ?? 'Song Link'}</h1>
        {entity?.artistName && <p>{entity.artistName}</p>}
      </header>
      <ul>
        {links.map(([platform, link]) => (
          <li key={platform}>
            <a className="link" href={link.url} rel="noopener noreferrer">
              <span>{platformNames[platform as Platform] ?? platform}</span>
              <span>Play</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function ErrorPage({ message }: { message: string }) {
  return (
    <main>
      <header>
        <h1>Couldn&apos;t find that</h1>
        <p>{message}</p>
      </header>
    </main>
  );
}
