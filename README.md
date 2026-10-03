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

## Playback engine (VidLink embed — frontend only, no backend)

Watch is powered by the official VidLink embed player
(`https://vidlink.pro/movie/{tmdbId}` and `/tv/{tmdbId}/{season}/{episode}`),
iframe-embedded and styled in Netflix red. No backend, no scraping: the catalog
(Cinemeta) gives each title's `moviedb_id`, which maps straight onto the embed.

### Watch flow

```
Watch click → moviedb_id from Cinemeta meta → VidLink embed URL
  (+ Netflix colors, autoplay, next-episode button, resume via startAt)
  → iframe player with VidLink's own controls/subtitles
  → postMessage MEDIA_DATA → saved to Continue Watching (with resume)
  → postMessage PLAYER_EVENT ended → auto-advances to next episode
```

- Movies: `/movie/{tmdbId}`. Series: `/tv/{tmdbId}/{season}/{episode}` (+ `nextbutton`).
- Continue Watching cards resume exactly where you stopped (`startAt`).
- If a title has no TMDB mapping, the player shows a friendly error with retry.
- Torrent downloads (magnet/MP4 via Torrentio listings) remain available from
  the stream rows and the ⬇ button — playback itself needs no backend.

### Deploy to Vercel

Push this repo, Import in Vercel (no build command, no env vars needed).
Static files deploy as-is; everything runs in the browser.

### Limitations

- Embed availability depends on VidLink; if a title won't load, use retry or
  the torrent download options on the same page.
- Only use streams you are authorized to access and distribute.

## Educational use only
Torrenting exposes your IP. Use a VPN. Respect copyright laws.
