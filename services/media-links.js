'use strict';

/**
 * Media-link helpers — pure functions, no DOM.
 * Single place that knows how Watch and Download URLs are built.
 *
 * STREAMING (VidAPI/Vaplayer only — no other provider, no proxy):
 *   movie   → https://vaplayer.ru/embed/movie/{IMDB_ID}
 *   episode → https://vaplayer.ru/embed/tv/{TMDB_ID}/{SEASON}/{EPISODE}
 *
 * DOWNLOAD (OmniSave redirect only — never a direct file URL):
 *   base    → https://videodownloader.site/?utm_source=MB_Website
 *   search  → base + &q={query}  (their declared SearchAction target is ?q=)
 */

const VAPLAYER_BASE = 'https://vaplayer.ru/embed';
const OMNISAVE_BASE = 'https://videodownloader.site/';
const OMNISAVE_UTM = 'utm_source=MB_Website';
const VIDVAULT_BASE = 'https://vidvault.to';
const MOVIEDOWNLOADER02_BASE = 'https://02moviedownloader.site';

const IMDB_RE = /^tt\d+$/;

function toInt(n) {
  const v = Number(n);
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** Movie embed. Returns null when the IMDb ID is missing/invalid. */
function getMovieStreamUrl(movie) {
  const imdb = movie && typeof movie.imdb === 'string' ? movie.imdb.trim() : '';
  if (!IMDB_RE.test(imdb)) return null;
  return `${VAPLAYER_BASE}/movie/${imdb}`;
}

/** Episode embed. Returns null when TMDB id / season / episode are missing. */
function getEpisodeStreamUrl(series, season, episode) {
  const tmdb = series && series.tmdbId != null ? String(series.tmdbId).trim() : '';
  const s = toInt(season);
  const e = toInt(episode);
  if (!tmdb || !/^\d+$/.test(tmdb) || !s || !e) return null;
  return `${VAPLAYER_BASE}/tv/${tmdb}/${s}/${e}`;
}

/**
 * Clean display title for search queries. Preserves the original wording
 * (including years like "Blade Runner 2049", Arabic, punctuation,
 * apostrophes) — only trims, collapses whitespace, and drops [...] technical
 * tags which are never part of a real title.
 */
function cleanTitle(title) {
  if (typeof title !== 'string') return '';
  return title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Movie download query: just the clean title. */
function getMovieDownloadSearch(movie) {
  return cleanTitle(movie && movie.title);
}

/**
 * Episode download query. Prefers "Series S01E03"; falls back to
 * "Series Season 1 Episode 3" wording when only partial numbers exist,
 * and to the bare title when numbers are missing.
 */
function getEpisodeDownloadSearch(series, season, episode) {
  const title = cleanTitle(series && series.title);
  if (!title) return '';
  const s = toInt(season);
  const e = toInt(episode);
  if (s && e) return `${title} S${pad2(s)}E${pad2(e)}`;
  if (s && !e) return `${title} Season ${s}`;
  if (!s && e) return `${title} Episode ${e}`;
  return title;
}

/**
 * OmniSave URL for a search query. Uses their declared ?q= search target
 * plus our utm tag. Empty query → plain base URL (their homepage).
 */
function omnisaveUrl(query) {
  const base = `${OMNISAVE_BASE}?${OMNISAVE_UTM}`;
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return base;
  return `${base}&q=${encodeURIComponent(q)}`;
}

function extractImdbId(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val.imdb === 'string') return val.imdb.trim();
  if (typeof val.id === 'string' && val.id.startsWith('tt')) return val.id.split(':')[0].trim();
  if (typeof val.imdb_id === 'string') return val.imdb_id.trim();
  return '';
}

/**
 * Server 1: VidVault Movie Download URL
 * https://vidvault.to/movie/{IMDB_ID}
 * Example: https://vidvault.to/movie/tt0816692
 */
function getVidVaultMovieUrl(imdbId) {
  const imdb = extractImdbId(imdbId);
  if (!IMDB_RE.test(imdb)) return null;
  return `${VIDVAULT_BASE}/movie/${imdb}`;
}

/**
 * Server 1: VidVault TV Episode Download URL
 * https://vidvault.to/tv/{IMDB_ID}/{SEASON}/{EPISODE}
 * Example: https://vidvault.to/tv/tt5071412/1/1
 */
function getVidVaultEpisodeUrl(imdbId, season, episode) {
  const imdb = extractImdbId(imdbId);
  const s = toInt(season);
  const e = toInt(episode);
  if (!IMDB_RE.test(imdb) || !s || !e) return null;
  return `${VIDVAULT_BASE}/tv/${imdb}/${s}/${e}`;
}

/**
 * Server 2: 02MovieDownloader Movie Download URL
 * https://02moviedownloader.site/api/download/movie/{IMDB_ID}
 * Example: https://02moviedownloader.site/api/download/movie/tt0468569
 */
function get02MovieDownloaderMovieUrl(imdbId) {
  const imdb = extractImdbId(imdbId);
  if (!IMDB_RE.test(imdb)) return null;
  return `${MOVIEDOWNLOADER02_BASE}/api/download/movie/${imdb}`;
}

/**
 * Server 2: 02MovieDownloader TV Episode Download URL
 * https://02moviedownloader.site/api/download/tv/{IMDB_ID}/{SEASON}/{EPISODE}
 * Example: https://02moviedownloader.site/api/download/tv/tt11126994/1/1
 */
function get02MovieDownloaderEpisodeUrl(imdbId, season, episode) {
  const imdb = extractImdbId(imdbId);
  const s = toInt(season);
  const e = toInt(episode);
  if (!IMDB_RE.test(imdb) || !s || !e) return null;
  return `${MOVIEDOWNLOADER02_BASE}/api/download/tv/${imdb}/${s}/${e}`;
}

const MediaLinks = {
  VAPLAYER_BASE,
  OMNISAVE_BASE,
  VIDVAULT_BASE,
  MOVIEDOWNLOADER02_BASE,
  getMovieStreamUrl,
  getEpisodeStreamUrl,
  cleanTitle,
  getMovieDownloadSearch,
  getEpisodeDownloadSearch,
  omnisaveUrl,
  getVidVaultMovieUrl,
  getVidVaultEpisodeUrl,
  get02MovieDownloaderMovieUrl,
  get02MovieDownloaderEpisodeUrl,
};
if (typeof module !== 'undefined' && module.exports) module.exports = MediaLinks;
