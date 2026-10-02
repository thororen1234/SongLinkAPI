export default function HomePage() {
  return (
    <main>
      <header>
        <h1>Song Link</h1>
        <p>Paste a song or album link from any supported service.</p>
      </header>
      <form action="/page" method="get">
        <input
          name="url"
          type="url"
          required
          placeholder="https://open.spotify.com/track/..."
          aria-label="Song or album URL"
        />
        <button type="submit">Find links</button>
      </form>
    </main>
  );
}
