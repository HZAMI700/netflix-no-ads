# Netflix-Style Streaming Portal (Frontend Only)

Static SPA — no server, no database. Open `index.html` or deploy the folder to Vercel / Netlify / GitHub Pages.

## Run locally
Just open `index.html` in a browser (internet required for the Cinemeta API and the streaming embeds).
Or serve statically: `npx serve .`

## How it works
- Catalogs + metadata: `https://v3-cinemeta.strem.io` (CORS-enabled Stremio addon)
- Streaming: VidAPI/Vaplayer embeds only (IMDb for movies, TMDB+s/e for episodes)
- Downloads: OmniSave redirect only (search-by-title, new tab)
- State (My List, Continue Watching, likes, addons): `localStorage`

## Streaming (VidAPI only) + Download (OmniSave only)

Strict separation, no backend, pure frontend:

- **Watch ▶ → VidAPI/Vaplayer embed, the ONLY streaming source.**
  Movies: `https://vaplayer.ru/embed/movie/{IMDB_ID}`.
  Episodes: `https://vaplayer.ru/embed/tv/{TMDB_ID}/{SEASON}/{EPISODE}`.
  IDs come from the existing Cinemeta metadata. No fallback provider, no proxy,
  no direct media URLs. Missing/invalid IDs disable Watch with a friendly error.
- **Download ⬇ → OmniSave redirect, never a direct download.**
  Opens `https://videodownloader.site/?utm_source=MB_Website&q={query}` in a new
  tab (their declared `?q=` search target), with the query copied to the
  clipboard as fallback. Movies: `Movie Name`. Episodes: `Series Name S01E03`.
- Helpers live in `services/media-links.js`
  (`getMovieStreamUrl`, `getEpisodeStreamUrl`, `getMovieDownloadSearch`,
  `getEpisodeDownloadSearch`, `omnisaveUrl`, `cleanTitle`).
- Player progress events (accepted from the embed origin only) feed
  Continue Watching; `ended` auto-advances series episodes.
- Tests: `node tests/run.js` (39 cases: URL builders, Arabic/punctuation/
  apostrophe titles, missing IDs, and architecture guards proving no second
  streaming provider and no direct-download code exists).

### Deploy to Vercel

Push this repo, Import in Vercel (no build command, no env vars needed).
Static files deploy as-is; everything runs in the browser.

### Limitations

- Embed availability depends on VidLink; if a title won't load, use retry or
  the torrent download options on the same page.
- Only use streams you are authorized to access and distribute.

## Educational use only
Only use streams and downloads you are authorized to access. Respect copyright laws.
