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

## Educational use only
Torrenting exposes your IP. Use a VPN. Respect copyright laws.
