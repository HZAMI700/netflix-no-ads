(function (global) {
'use strict';

/**
 * Media-link helpers — pure functions, no DOM.
 * Single place that knows how Watch and Download URLs are built.
 *
 * STREAMING:
 *   Server 1 (Vaplayer/VidAPI):
 *     movie   → https://vaplayer.ru/embed/movie/{IMDB_ID}
 *     episode → https://vaplayer.ru/embed/tv/{TMDB_ID}/{SEASON}/{EPISODE}
 *   Server 2 (VidSrc - vidsrc.sh):
 *     movie   → https://vidsrc.sh/embed/movie/{ID} (IMDb or TMDb ID)
 *     episode → https://vidsrc.sh/embed/tv/{ID}/{SEASON}/{EPISODE} (TMDb or IMDb ID)
 *
 * DOWNLOAD (OmniSave redirect only — never a direct file URL):
 *   base    → https://videodownloader.site/?utm_source=MB_Website
 *   search  → base + &q={query}  (their declared SearchAction target is ?q=)
 */

const VAPLAYER_BASE = 'https://vaplayer.ru/embed';
const VIDAPI_BASE = 'https://vidapi.ru/embed';
const VIDSRC_BASE = 'https://vidsrc.sh';
const OMNISAVE_BASE = 'https://videodownloader.site/';
const OMNISAVE_UTM = 'utm_source=MB_Website';
const VIDVAULT_BASE = 'https://vidvault.to';
const MOVIEDOWNLOADER02_BASE = 'https://02moviedownloader.site';
const NHDAPI_BASE = 'https://nhdapi.com';
const WORKER_PROXY_BASE = 'https://adsclear.yassine-hzami.workers.dev/?url=';

function getWorkerProxyUrl(originalUrl) {
  if (!originalUrl || !isValidStreamEmbedUrl(originalUrl)) return '';
  return `${WORKER_PROXY_BASE}${encodeURIComponent(originalUrl)}`;
}

/**
 * Validates that an embed URL contains a valid non-empty identifier (TMDB ID or IMDb ID)
 * and does NOT have an empty ID (e.g., rejects /movie?id=, /tv?id=, /watch?kind=movie&id=, /movie/).
 */
function isValidStreamEmbedUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Never load an empty ID like /movie?id=, /tv?id=, /watch?kind=movie&id=, or ?id=
  if (/[?&]id=(?:&|#|$)/.test(trimmed)) return false;
  if (/[?&]id=(?:undefined|null|nan)(?:&|#|$)/i.test(trimmed)) return false;

  // Never load empty path ID like /movie/, /movie/? or /tv//
  if (/\/(?:embed\/)?(?:movie|tv)\/(?:[?#]|$)/i.test(trimmed)) return false;
  if (/\/(?:embed\/)?tv\/\//i.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed, 'https://streamnaro.local');
    const path = parsed.pathname;

    // Check query ID if present
    if (parsed.searchParams.has('id')) {
      const qId = parsed.searchParams.get('id');
      if (!qId || !qId.trim()) return false;
      const cleanQId = qId.trim();
      if (cleanQId === 'undefined' || cleanQId === 'null' || cleanQId === 'NaN' || cleanQId === '0') return false;
      if (!/^(?:tt\d+|\d+)$/.test(cleanQId)) return false;
      return true;
    }

    // Check path ID
    const pathMatch = path.match(/\/(?:embed\/)?(?:movie|tv)\/([^/?#]+)/i);
    if (pathMatch) {
      const pId = pathMatch[1].trim();
      if (!pId || pId === 'undefined' || pId === 'null' || pId === 'NaN' || pId === '0') return false;
      if (!/^(?:tt\d+|\d+)$/.test(pId)) return false;
      return true;
    }

    // Check /watch?kind=movie&id=... or /watch?id=...
    if (path.includes('/watch')) {
      const wId = parsed.searchParams.get('id');
      if (!wId || !/^(?:tt\d+|\d+)$/.test(wId.trim())) return false;
      return true;
    }

    // Generic URL format: ensure valid ID exists somewhere in URL
    if (/^(https?:)?\/\//.test(trimmed)) {
      return /(?:tt\d+|\b\d{3,8}\b)/.test(trimmed);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Ensures originalStreamUrl contains a valid TMDB ID before loading.
 * If URL has an empty ID placeholder (e.g., /movie?id=) and a valid tmdbId is provided,
 * it populates the ID. Otherwise returns null if the URL remains invalid.
 */
function ensureValidStreamEmbedUrl(url, tmdbId, metadata = {}) {
  if (!url || typeof url !== 'string') return null;
  let cleanUrl = url.trim();
  if (!cleanUrl) return null;

  const validTmdb = (tmdbId != null && /^\d+$/.test(String(tmdbId).trim())) ? String(tmdbId).trim() : null;

  // If URL has empty query id parameter like /movie?id= or /watch?kind=movie&id=
  if (/[?&]id=(?:&|#|$)/.test(cleanUrl) || /[?&]id=(?:undefined|null|nan)(?:&|#|$)/i.test(cleanUrl)) {
    if (validTmdb) {
      cleanUrl = cleanUrl.replace(/([?&]id=)(?:undefined|null|nan)?(?=&|#|$)/i, `$1${validTmdb}`);
    } else {
      return null;
    }
  }

  // If URL has empty path like /movie/ or /movie/?
  if (/\/(?:embed\/)?movie\/(?:[?#]|$)/i.test(cleanUrl)) {
    if (validTmdb) {
      cleanUrl = cleanUrl.replace(/(\/(?:embed\/)?movie\/)(?=[?#]|$)/i, `$1${validTmdb}`);
    } else {
      return null;
    }
  }

  // If URL has empty tv path like /tv//1/1 or /embed/tv//1/1
  if (/\/(?:embed\/)?tv\/\/(?=\d+)/i.test(cleanUrl)) {
    if (validTmdb) {
      cleanUrl = cleanUrl.replace(/(\/(?:embed\/)?tv\/)\/(?=\d+)/i, `$1${validTmdb}/`);
    } else {
      return null;
    }
  }

  // If URL ends with /tv/ or /tv/?
  if (/\/(?:embed\/)?tv\/(?:[?#]|$)/i.test(cleanUrl)) {
    if (validTmdb) {
      const s = (metadata && metadata.season) || 1;
      const ep = (metadata && metadata.episode) || 1;
      cleanUrl = cleanUrl.replace(/(\/(?:embed\/)?tv\/)(?=[?#]|$)/i, `$1${validTmdb}?season=${s}&episode=${ep}`);
    } else {
      return null;
    }
  }

  return isValidStreamEmbedUrl(cleanUrl) ? cleanUrl : null;
}

const IMDB_RE = /^tt\d+$/;

function toInt(n) {
  const v = Number(n);
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** Movie embed. Returns null when the IMDb/TMDB ID is missing/invalid. */
function getMovieStreamUrl(movie, server = 'server1') {
  const imdb = movie && typeof movie.imdb === 'string' ? movie.imdb.trim() : '';
  const tmdb = movie && movie.tmdbId != null ? String(movie.tmdbId).trim() : (movie && movie.moviedb_id != null ? String(movie.moviedb_id).trim() : '');

  if (server === 'nhdapi') {
    const id = /^\d+$/.test(tmdb) ? tmdb : '';
    if (!id) return null;
    return `${NHDAPI_BASE}/movie/${id}`;
  }

  if (server === 'server2' || server === 'vidsrc') {
    const id = (IMDB_RE.test(imdb) ? imdb : '') || (/^\d+$/.test(tmdb) ? tmdb : '');
    if (!id) return null;
    return `${VIDSRC_BASE}/embed/movie/${id}`;
  }

  if (server === 'vidapi') {
    const id = IMDB_RE.test(imdb) ? imdb : (/^\d+$/.test(tmdb) ? tmdb : '');
    if (!id) return null;
    return `${VIDAPI_BASE}/movie/${id}`;
  }

  const id = IMDB_RE.test(imdb) ? imdb : (/^\d+$/.test(tmdb) ? tmdb : '');
  if (!id) return null;
  return `${VAPLAYER_BASE}/movie/${id}`;
}

/** Episode embed. Returns null when TMDB id / season / episode are missing. */
function getEpisodeStreamUrl(series, season, episode, server = 'server1') {
  const imdb = series && typeof series.imdb === 'string' ? series.imdb.trim() : '';
  const tmdb = series && series.tmdbId != null ? String(series.tmdbId).trim() : (series && series.moviedb_id != null ? String(series.moviedb_id).trim() : '');
  const s = toInt(season);
  const e = toInt(episode);
  if (!s || !e) return null;

  if (server === 'nhdapi') {
    if (!tmdb || !/^\d+$/.test(tmdb)) return null;
    return `${NHDAPI_BASE}/tv/${tmdb}?season=${s}&episode=${e}`;
  }

  if (server === 'server2' || server === 'vidsrc') {
    const id = (/^\d+$/.test(tmdb) ? tmdb : '') || (IMDB_RE.test(imdb) ? imdb : '');
    if (!id) return null;
    return `${VIDSRC_BASE}/embed/tv/${id}/${s}/${e}`;
  }

  if (!tmdb || !/^\d+$/.test(tmdb)) return null;

  if (server === 'vidapi') {
    return `${VIDAPI_BASE}/tv/${tmdb}/${s}/${e}`;
  }

  return `${VAPLAYER_BASE}/tv/${tmdb}/${s}/${e}`;
}

/** NHDApi movie iframe embed URL */
function getNhdApiMovieUrl(tmdbId) {
  const id = tmdbId != null ? String(tmdbId).trim() : '';
  if (!/^\d+$/.test(id)) return null;
  const apiKey = (typeof NHDApi !== 'undefined' && NHDApi.getApiKey) ? NHDApi.getApiKey() : '';
  const keyParam = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
  return `${NHDAPI_BASE}/movie/${id}${keyParam}`;
}

/** NHDApi TV episode iframe embed URL */
function getNhdApiEpisodeUrl(tmdbId, season, episode) {
  const id = tmdbId != null ? String(tmdbId).trim() : '';
  const s = toInt(season);
  const e = toInt(episode);
  if (!/^\d+$/.test(id) || !s || !e) return null;
  const apiKey = (typeof NHDApi !== 'undefined' && NHDApi.getApiKey) ? NHDApi.getApiKey() : '';
  const keyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : '';
  return `${NHDAPI_BASE}/tv/${id}?season=${s}&episode=${e}${keyParam}`;
}

/** NHDApi movie streaming API (SSE) endpoint */
function getNhdApiMovieApiUrl(tmdbId) {
  const id = tmdbId != null ? String(tmdbId).trim() : '';
  if (!/^\d+$/.test(id)) return null;
  return `${NHDAPI_BASE}/movie?id=${id}`;
}

/** NHDApi TV episode streaming API (SSE) endpoint */
function getNhdApiEpisodeApiUrl(tmdbId, season, episode) {
  const id = tmdbId != null ? String(tmdbId).trim() : '';
  const s = toInt(season);
  const e = toInt(episode);
  if (!/^\d+$/.test(id) || !s || !e) return null;
  return `${NHDAPI_BASE}/tv?id=${id}&season=${s}&episode=${e}`;
}

/** NHDApi movie subtitles endpoint */
function getNhdApiMovieSubtitlesUrl(tmdbId) {
  const id = tmdbId != null ? String(tmdbId).trim() : '';
  if (!/^\d+$/.test(id)) return null;
  return `${NHDAPI_BASE}/subtitles/movie/${id}`;
}

/** NHDApi TV episode subtitles endpoint */
function getNhdApiEpisodeSubtitlesUrl(tmdbId, season, episode) {
  const id = tmdbId != null ? String(tmdbId).trim() : '';
  const s = toInt(season);
  const e = toInt(episode);
  if (!/^\d+$/.test(id) || !s || !e) return null;
  return `${NHDAPI_BASE}/subtitles/tv/${id}/${s}/${e}`;
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
  VIDAPI_BASE,
  VIDSRC_BASE,
  OMNISAVE_BASE,
  VIDVAULT_BASE,
  MOVIEDOWNLOADER02_BASE,
  NHDAPI_BASE,
  WORKER_PROXY_BASE,
  getWorkerProxyUrl,
  isValidStreamEmbedUrl,
  ensureValidStreamEmbedUrl,
  getMovieStreamUrl,
  getEpisodeStreamUrl,
  getNhdApiMovieUrl,
  getNhdApiEpisodeUrl,
  getNhdApiMovieApiUrl,
  getNhdApiEpisodeApiUrl,
  getNhdApiMovieSubtitlesUrl,
  getNhdApiEpisodeSubtitlesUrl,
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
if (typeof global !== 'undefined') global.MediaLinks = MediaLinks;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
