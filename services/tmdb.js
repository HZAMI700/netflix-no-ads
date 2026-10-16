(function (global) {
'use strict';

/**
 * Streamnaro TMDB Discovery & Live On-Demand Metadata Service
 * Fetches trending, popular, top-rated, and live multi-search directly from TMDB v3 API.
 * Ensures zero popular movies or series are ever missing from the platform.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

const TMDB_KEYS = [
  '4e44d9029b1270a757cddc766a1bcb63',
  '15d2ea6d0dc1d476efbca3eba2b9bbfb',
  '8265bd1679663a7ea12ac168da84d2e8',
  'e9e9d8da18ae29fc430845952232787c'
];

let currentKeyIndex = 0;

function getApiKey() {
  if (typeof window !== 'undefined') {
    if (window.TMDB_KEY) return String(window.TMDB_KEY).trim();
    try {
      const stored = localStorage.getItem('nf_tmdb_key');
      if (stored) return String(stored).trim();
    } catch {}
  }
  if (typeof process !== 'undefined' && process.env && process.env.TMDB_KEY) {
    return String(process.env.TMDB_KEY).trim();
  }
  return TMDB_KEYS[currentKeyIndex % TMDB_KEYS.length];
}

function rotateApiKey() {
  currentKeyIndex = (currentKeyIndex + 1) % TMDB_KEYS.length;
}

function setApiKey(key) {
  if (!key) return;
  const k = String(key).trim();
  if (typeof window !== 'undefined') {
    window.TMDB_KEY = k;
    try { localStorage.setItem('nf_tmdb_key', k); } catch {}
  }
}

// In-memory cache for fast, zero-latency repeated navigation
const tmdbCache = new Map();

async function tmdbFetch(endpoint, params = {}, retries = 3) {
  const urlParams = new URLSearchParams(params);
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const key = getApiKey();
    urlParams.set('api_key', key);
    const fullUrl = `${TMDB_BASE}${endpoint}?${urlParams.toString()}`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(fullUrl, { signal: ctrl.signal });
      clearTimeout(timer);

      if (res.status === 401 || res.status === 429) {
        rotateApiKey();
        continue;
      }
      if (!res.ok) {
        throw new Error(`TMDB HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      rotateApiKey();
    }
  }

  throw lastError || new Error('TMDB request failed');
}

const GENRE_MAP = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
};

function mapGenreIds(genreIds, genreObjects) {
  if (Array.isArray(genreObjects) && genreObjects.length) {
    return genreObjects.map(g => g.name || GENRE_MAP[g.id] || 'Cinema').filter(Boolean);
  }
  if (Array.isArray(genreIds)) {
    return genreIds.map(id => GENRE_MAP[id]).filter(Boolean);
  }
  return ['Cinema'];
}

function normalizeTmdbMedia(raw, explicitType) {
  if (!raw) return null;
  const isTv = explicitType === 'series' || explicitType === 'tv' || raw.media_type === 'tv' || !!raw.first_air_date || !!raw.name;
  const type = isTv ? 'series' : 'movie';
  const name = String(raw.title || raw.name || raw.original_title || raw.original_name || '').trim();
  if (!name) return null;

  const tmdbId = String(raw.id).trim();
  const extIds = raw.external_ids || {};
  const imdbId = extIds.imdb_id || (String(raw.imdb_id || '').startsWith('tt') ? raw.imdb_id : null);
  const canonicalId = imdbId || `tmdb:${tmdbId}`;

  const posterPath = raw.poster_path ? `${TMDB_IMAGE_BASE}/w500${raw.poster_path}` : '';
  const backdropPath = raw.backdrop_path ? `${TMDB_IMAGE_BASE}/original${raw.backdrop_path}` : '';
  const dateStr = raw.release_date || raw.first_air_date || '';
  const year = dateStr ? dateStr.slice(0, 4) : '2024';
  const rating = raw.vote_average ? Number(raw.vote_average).toFixed(1) : '8.2';
  const genres = mapGenreIds(raw.genre_ids, raw.genres);

  // Cast and crew
  let cast = [];
  let director = '';
  if (raw.credits) {
    if (Array.isArray(raw.credits.cast)) {
      cast = raw.credits.cast.slice(0, 8).map(c => c.name).filter(Boolean);
    }
    if (Array.isArray(raw.credits.crew)) {
      const dir = raw.credits.crew.find(c => c.job === 'Director');
      if (dir) director = dir.name;
    }
  }

  // Canonical videos/episodes if populated
  let videos = [];
  if (Array.isArray(raw.videos) && raw.videos.length > 0) {
    videos = raw.videos;
  }

  const meta = {
    id: canonicalId,
    tmdbId,
    moviedb_id: tmdbId,
    imdb_id: imdbId,
    imdb: imdbId,
    name,
    title: name,
    type,
    year,
    releaseInfo: year,
    poster: posterPath,
    background: backdropPath,
    imdbRating: rating,
    voteCount: raw.vote_count || 1200,
    description: raw.overview || '',
    overview: raw.overview || '',
    genres: genres.length ? genres : ['Cinema'],
    cast,
    director,
    videos,
    number_of_seasons: raw.number_of_seasons || (isTv ? 1 : null),
    number_of_episodes: raw.number_of_episodes || null,
    runtime: raw.runtime ? `${raw.runtime}m` : (raw.episode_run_time?.[0] ? `${raw.episode_run_time[0]}m` : (isTv ? '45m' : '2h 05m')),
    certification: raw.adult ? 'NC-17' : (isTv ? 'TV-MA' : 'PG-13'),
    _tmdb: true
  };

  // Safety filter
  const isSafe = (typeof isSafeContent === 'function')
    ? isSafeContent(meta)
    : (!raw.adult);

  if (!isSafe) return null;

  // Auto-register into CuratedCatalog so all views, search, history & detail routes resolve instantly
  if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.registerExternalMedia) {
    CuratedCatalog.registerExternalMedia(meta);
  }

  return meta;
}

/**
 * 1. Trending Movies & TV Series
 * Endpoints: /trending/movie/{timeWindow}, /trending/tv/{timeWindow}
 */
async function getTrending(type = 'all', timeWindow = 'week', page = 1) {
  const cacheKey = `trending:${type}:${timeWindow}:${page}`;
  if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

  try {
    if (type === 'all') {
      const [m, t] = await Promise.all([
        tmdbFetch(`/trending/movie/${timeWindow}`, { page }),
        tmdbFetch(`/trending/tv/${timeWindow}`, { page })
      ]);
      const movies = (m.results || []).map(r => normalizeTmdbMedia(r, 'movie')).filter(Boolean);
      const tvs = (t.results || []).map(r => normalizeTmdbMedia(r, 'series')).filter(Boolean);
      const combined = [];
      const len = Math.max(movies.length, tvs.length);
      for (let i = 0; i < len; i++) {
        if (movies[i]) combined.push(movies[i]);
        if (tvs[i]) combined.push(tvs[i]);
      }
      tmdbCache.set(cacheKey, combined);
      return combined;
    }

    const t = type === 'series' || type === 'tv' ? 'tv' : 'movie';
    const data = await tmdbFetch(`/trending/${t}/${timeWindow}`, { page });
    const list = (data.results || []).map(r => normalizeTmdbMedia(r, t === 'tv' ? 'series' : 'movie')).filter(Boolean);
    tmdbCache.set(cacheKey, list);
    return list;
  } catch (err) {
    console.warn('[TMDB] getTrending error:', err);
    return [];
  }
}

/**
 * 2. Popular Movies & TV Series
 * Endpoints: /movie/popular, /tv/popular
 */
async function getPopular(type = 'movie', page = 1) {
  const t = type === 'series' || type === 'tv' ? 'tv' : 'movie';
  const cacheKey = `popular:${t}:${page}`;
  if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

  try {
    const data = await tmdbFetch(`/${t}/popular`, { page });
    const list = (data.results || []).map(r => normalizeTmdbMedia(r, t === 'tv' ? 'series' : 'movie')).filter(Boolean);
    tmdbCache.set(cacheKey, list);
    return list;
  } catch (err) {
    console.warn('[TMDB] getPopular error:', err);
    return [];
  }
}

/**
 * 3. Top Rated Movies & TV Series
 * Endpoints: /movie/top_rated, /tv/top_rated
 */
async function getTopRated(type = 'movie', page = 1) {
  const t = type === 'series' || type === 'tv' ? 'tv' : 'movie';
  const cacheKey = `toprated:${t}:${page}`;
  if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

  try {
    const data = await tmdbFetch(`/${t}/top_rated`, { page });
    const list = (data.results || []).map(r => normalizeTmdbMedia(r, t === 'tv' ? 'series' : 'movie')).filter(Boolean);
    tmdbCache.set(cacheKey, list);
    return list;
  } catch (err) {
    console.warn('[TMDB] getTopRated error:', err);
    return [];
  }
}

/**
 * 4. Live Multi Search
 * Endpoint: /search/multi?query={query}&page={page}&include_adult=false
 */
async function searchMulti(query, page = 1) {
  const q = String(query || '').trim();
  if (!q) return [];
  const cacheKey = `search:${q.toLowerCase()}:${page}`;
  if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

  try {
    const data = await tmdbFetch('/search/multi', {
      query: q,
      page,
      include_adult: 'false'
    });
    const results = (data.results || [])
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .map(item => normalizeTmdbMedia(item, item.media_type === 'tv' ? 'series' : 'movie'))
      .filter(Boolean);

    tmdbCache.set(cacheKey, results);
    return results;
  } catch (err) {
    console.warn('[TMDB] searchMulti error:', err);
    return [];
  }
}

/**
 * 5. Full On-Demand Metadata & Season/Episode Generator
 * Queries /movie/{id} or /tv/{id} with external_ids, credits, and all seasons/episodes on the fly
 */
async function getDetails(idOrImdb, explicitType) {
  if (!idOrImdb) return null;
  const rawId = String(idOrImdb).trim();
  let tmdbId = rawId.replace(/^tmdb:/, '');
  let resolvedType = explicitType === 'series' || explicitType === 'tv' ? 'tv' : 'movie';

  // If IMDb ID provided (e.g. tt1375666), find corresponding TMDB ID first
  if (rawId.startsWith('tt')) {
    try {
      const findRes = await tmdbFetch(`/find/${rawId}`, { external_source: 'imdb_id' });
      if (findRes.movie_results && findRes.movie_results.length > 0) {
        tmdbId = String(findRes.movie_results[0].id);
        resolvedType = 'movie';
      } else if (findRes.tv_results && findRes.tv_results.length > 0) {
        tmdbId = String(findRes.tv_results[0].id);
        resolvedType = 'tv';
      }
    } catch (e) {
      console.warn('[TMDB] /find error for', rawId, e);
    }
  }

  if (!/^\d+$/.test(tmdbId)) return null;

  const cacheKey = `details:${resolvedType}:${tmdbId}`;
  if (tmdbCache.has(cacheKey)) return tmdbCache.get(cacheKey);

  try {
    const details = await tmdbFetch(`/${resolvedType}/${tmdbId}`, {
      append_to_response: 'external_ids,credits,recommendations'
    });

    if (!details) return null;

    // For TV series, fetch season 1 episodes (and up to 8 seasons) dynamically on the fly
    if (resolvedType === 'tv' && details.number_of_seasons) {
      const numSeasons = Math.min(10, details.number_of_seasons || 1);
      const episodePromises = [];
      for (let s = 1; s <= numSeasons; s++) {
        episodePromises.push(
          tmdbFetch(`/tv/${tmdbId}/season/${s}`)
            .then(sData => (sData.episodes || []).map(ep => ({
              season: Number(ep.season_number) || s,
              episode: Number(ep.episode_number) || 1,
              name: ep.name || `Episode ${ep.episode_number}`,
              title: ep.name || `Episode ${ep.episode_number}`,
              runtime: ep.runtime ? `${ep.runtime}m` : '45m',
              overview: ep.overview || 'No description available.',
              thumbnail: ep.still_path ? `${TMDB_IMAGE_BASE}/w780${ep.still_path}` : ''
            })))
            .catch(() => [])
        );
      }
      const seasonEpisodes = await Promise.all(episodePromises);
      details.videos = seasonEpisodes.flat().filter(v => v.season > 0 && v.episode > 0);
    }

    const normalized = normalizeTmdbMedia(details, resolvedType === 'tv' ? 'series' : 'movie');
    if (normalized) {
      tmdbCache.set(cacheKey, normalized);
      if (normalized.imdb_id) tmdbCache.set(`details:${resolvedType}:${normalized.imdb_id}`, normalized);
      if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.registerExternalMedia) {
        CuratedCatalog.registerExternalMedia(normalized);
      }
    }
    return normalized;
  } catch (err) {
    console.warn('[TMDB] getDetails error:', err);
    return null;
  }
}

/**
 * 6. Live Multi-Page Sync from All Core Discovery Endpoints
 */
async function syncCoreDiscovery(maxPages = 3) {
  try {
    const promises = [];
    for (let p = 1; p <= maxPages; p++) {
      promises.push(getTrending('movie', 'week', p));
      promises.push(getTrending('tv', 'week', p));
      promises.push(getPopular('movie', p));
      promises.push(getPopular('tv', p));
      promises.push(getTopRated('movie', p));
      promises.push(getTopRated('tv', p));
    }
    const results = await Promise.all(promises);
    const flattened = results.flat().filter(Boolean);
    console.log(`[TMDB] Synced ${flattened.length} trending & popular titles`);
    return flattened;
  } catch (e) {
    console.warn('[TMDB] syncCoreDiscovery error:', e);
    return [];
  }
}

const TMDB = {
  TMDB_BASE,
  TMDB_IMAGE_BASE,
  TMDB_KEYS,
  getApiKey,
  setApiKey,
  getTrending,
  getPopular,
  getTopRated,
  searchMulti,
  getDetails,
  normalizeTmdbMedia,
  syncCoreDiscovery
};

if (typeof window !== 'undefined') {
  window.TMDB = TMDB;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TMDB;
}
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
