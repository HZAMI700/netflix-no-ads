# Netflix-Style Stremio + Torrentio Portal (Backendless)

Static SPA — no server, no database. Open `index.html` or deploy the folder to Vercel / Netlify / GitHub Pages.

## Run locally
Just open `index.html` in a browser (internet required for Cinemeta/Torrentio APIs + WebTorrent CDN).
Or serve statically: `npx serve .`

## How it works
- Catalogs + metadata: `https://v3-cinemeta.strem.io` (CORS-enabled Stremio addon)
- Streams: `https://torrentio.strem.fun/stream/{movie|series}/{id}.json`
- Subtitles: OpenSubtitles v3 addon
- Playback: WebTorrent.js in-browser, with webtor.io iframe fallback, plus Stremio deep links
- Downloads: magnet links + `.torrent` via itorrents.org
- State (My List, Continue Watching, likes, addons, VPN ack): `localStorage`

## Playback engine (`/api/playback` + `services/playback.js`)

The primary playback path is our own serverless resolver, adapted from the
movie-scraper `/api` *architecture* (resolve → `{ url }`, hls.js player,
loader/error states) — but with its vidlink/vidsrc scraping logic deliberately
**left out**. This site only plays sources the operator is authorized to
distribute: your own backend's torrent-to-HTTP streams, or explicitly
allowlisted direct media URLs.

### Watch flow

```
Watch click → Playback.getPlaybackSource({id, type, season?, episode?})
  → resolve authorized torrent streams (cached 5 min, in-flight deduped)
  → GET /api/playback?infoHash=… → POST <BACKEND_URL>/api/stream
  → { url: streamUrl, type: 'mp4' } → custom player (native / hls.js)
  → on failure: friendly error overlay (Try Again / alternative player)
```

- Movies: `{ id, type: 'movie' }`. Series: `{ id, type: 'series', season, episode }`.
- The UI only depends on `getPlaybackSource()` → `{ url, type, quality? }`.
- HLS: native where supported, lazy-loaded hls.js fallback otherwise.
- Downloads (magnet/MP4) are unchanged and live alongside Watch.

### Environment variables (Vercel → Project Settings → Environment Variables)

Copy `.env.example` to `.env` for local reference (never commit `.env`):

| Name | Purpose | Default |
|---|---|---|
| `BACKEND_URL` | Node torrent-to-HTTP backend (required for torrent Watch) | — (503 until set) |
| `PLAYBACK_CORS` | CORS origin for `/api/playback` | `*` (GET-only, safe) |
| `PLAYBACK_TIMEOUT_MS` | Upstream timeout (keep under Vercel `maxDuration`) | `45000` |
| `ALLOWED_MEDIA_ORIGINS` | Exact origins allowed for `?direct=` URLs (empty = none) | — |

### Deploy to Vercel

1. Push this repo, Import in Vercel (no build command — static + serverless).
2. Set the env vars above (`BACKEND_URL` = your backend's public URL).
3. Deploy. `/api/playback` runs as a Node serverless function (`maxDuration: 60`).

### Limitations

- Torrent Watch needs the backend reachable with real swarm access; without it
  the player shows a friendly error (verified: API maps backend failures to
  plain-language messages).
- `?direct=` only serves allowlisted origins — open it deliberately.
- Vercel Hobby caps function duration (10s); torrent metadata can take longer —
  the player surfaces a timeout message with retry. Pro/Fluid extends this.
- Tests: `node tests/run.js` (10 API cases, no framework). The `tests/` dir is
  dev-only and safe to deploy.

## Educational use only
Torrenting exposes your IP. Use a VPN. Respect copyright laws.
