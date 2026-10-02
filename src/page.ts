import type { LinksResponse, Platform } from './types.ts';

const PLATFORM_NAMES: Record<Platform, string> = {
  spotify: 'Spotify',
  appleMusic: 'Apple Music',
  itunes: 'iTunes Store',
  deezer: 'Deezer',
  youtube: 'YouTube',
  youtubeMusic: 'YouTube Music',
  tidal: 'TIDAL',
};

function esc(s: string | number | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const STYLE = `
  :root {
    --bg: #f4f4f5;
    --card: #fff;
    --fg: #18181b;
    --muted: #71717a;
    --line: #e4e4e7;
    --accent: #2563eb;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #09090b;
      --card: #18181b;
      --fg: #fafafa;
      --muted: #a1a1aa;
      --line: #27272a;
      --accent: #60a5fa;
    }
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.4 system-ui, sans-serif;
  }

  main {
    width: 100%;
    max-width: 420px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    overflow: hidden;
  }

  img {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    background: var(--line);
  }

  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--line);
  }

  h1 {
    margin: 0;
    font-size: 20px;
  }

  p {
    margin: 4px 0 0;
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li a {
    display: flex;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
    color: inherit;
    text-decoration: none;
  }

  li:last-child a {
    border-bottom: 0;
  }

  li a:hover {
    background: var(--bg);
  }

  li a span:last-child {
    color: var(--accent);
    font-weight: 600;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px;
  }

  input,
  button {
    font: inherit;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg);
  }

  button {
    background: var(--accent);
    color: #fff;
    border: 0;
    cursor: pointer;
  }
`;

function layout(title: string, body: string, image?: string): string {
  const ogImage = image ? `\n    <meta property="og:image" content="${esc(image)}">` : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta property="og:title" content="${esc(title)}">${ogImage}
    <style>${STYLE}</style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

function header(title: string | undefined, subtitle: string | undefined): string {
  return `
      <header>
        <h1>${esc(title)}</h1>
        <p>${esc(subtitle)}</p>
      </header>`;
}

export function renderLinksPage(data: LinksResponse): string {
  const entity = data.entitiesByUniqueId[data.entityUniqueId];
  const title = [entity?.title, entity?.artistName].filter(Boolean).join(' - ') || 'Song Link';

  const items = Object.entries(data.linksByPlatform)
    .map(([platform, link]) => {
      const name = PLATFORM_NAMES[platform as Platform] ?? platform;
      return `
        <li>
          <a href="${esc(link.url)}" rel="noopener">
            <span>${esc(name)}</span>
            <span>Play</span>
          </a>
        </li>`;
    })
    .join('');

  const art = entity?.thumbnailUrl ? `\n      <img src="${esc(entity.thumbnailUrl)}" alt="">` : '';

  return layout(
    title,
    `${art}${header(entity?.title, entity?.artistName)}
      <ul>${items}
      </ul>
    `,
    entity?.thumbnailUrl,
  );
}

export function renderHomePage(): string {
  return layout(
    'Song Link',
    `${header('Song Link', 'Paste a song or album link from any supported service.')}
      <form action="/page" method="get">
        <input name="url" type="url" required placeholder="https://open.spotify.com/track/...">
        <button>Find links</button>
      </form>
    `,
  );
}

export function renderErrorPage(message: string): string {
  return layout('Not found', `${header("Couldn't find that", message)}\n    `);
}
