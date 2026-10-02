# SongLink API

A self-hosted replacement for the deprecated [song.link / Odesli](https://odesli.co) API. Give it a link to a song or album on one streaming service, and it returns matching links on the others.

## Other routes

- `GET /`: a small web page where you can paste a link.
- `GET /:country/:type/:platform/:id`: the share page that `pageUrl` points to.
- `GET /health`: lists which providers are enabled.
