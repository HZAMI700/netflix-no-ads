'use strict';

/**
 * NHDApi Service Module — https://nhdapi.com
 * Handles video streaming endpoints (SSE), subtitles API, and iframe embeds.
 *
 * API Endpoints:
 *   Movie Stream:     GET https://nhdapi.com/movie?id={movie_id}
 *   TV Episode:       GET https://nhdapi.com/tv?id={tv_id}&season={season}&episode={episode}
 *   Movie Subtitles:  GET https://nhdapi.com/subtitles/movie/{movie_id}
 *   TV Subtitles:     GET https://nhdapi.com/subtitles/tv/{tv_id}/{season}/{episode}
 *
 * Iframe Fallback:
 *   Movie:            https://nhdapi.com/movie/{movie_id}
 *   TV Episode:       https://nhdapi.com/tv/{tv_id}?season={season}&episode={episode}
 */

const NHDAPI_BASE = 'https://nhdapi.com';

function toPositiveInt(val) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanTmdbId(id) {
  if (id == null) return null;
  const s = String(id).trim();
  if (/^\d+$/.test(s)) return s;
  if (s.startsWith('tmdb:')) {
    const sub = s.slice(5).trim();
    if (/^\d+$/.test(sub)) return sub;
  }
  return null;
}

/**
 * API Key management.
 * Checks window.NHDAPI_KEY, process.env.NHDAPI_KEY, or localStorage.
 * Treats example keys (e.g. VYLA-AF-XXXX-XXXX) as placeholders.
 */
function getApiKey() {
  try {
    if (typeof window !== 'undefined' && window.NHDAPI_KEY) {
      const k = String(window.NHDAPI_KEY).trim();
      if (k && !k.includes('XXXX')) return k;
    }
  } catch {}

  try {
    if (typeof process !== 'undefined' && process.env && process.env.NHDAPI_KEY) {
      const k = String(process.env.NHDAPI_KEY).trim();
      if (k && !k.includes('XXXX')) return k;
    }
  } catch {}

  try {
    if (typeof localStorage !== 'undefined') {
      const k = localStorage.getItem('nf_nhdapi_key');
      if (k && !k.includes('XXXX')) return k.trim();
    }
  } catch {}

  return '';
}

function setApiKey(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (key) {
        localStorage.setItem('nf_nhdapi_key', String(key).trim());
      } else {
        localStorage.removeItem('nf_nhdapi_key');
      }
    }
  } catch {}
}

/** Iframe embed URL for movies */
function getMovieIframeUrl(tmdbId) {
  const id = cleanTmdbId(tmdbId);
  if (!id) return null;
  return `${NHDAPI_BASE}/movie/${id}`;
}

/** Iframe embed URL for TV episodes */
function getEpisodeIframeUrl(tmdbId, season, episode) {
  const id = cleanTmdbId(tmdbId);
  const s = toPositiveInt(season);
  const e = toPositiveInt(episode);
  if (!id || !s || !e) return null;
  return `${NHDAPI_BASE}/tv/${id}?season=${s}&episode=${e}`;
}

/** Streaming SSE API endpoint for movies */
function getMovieApiUrl(tmdbId) {
  const id = cleanTmdbId(tmdbId);
  if (!id) return null;
  return `${NHDAPI_BASE}/movie?id=${id}`;
}

/** Streaming SSE API endpoint for TV episodes */
function getEpisodeApiUrl(tmdbId, season, episode) {
  const id = cleanTmdbId(tmdbId);
  const s = toPositiveInt(season);
  const e = toPositiveInt(episode);
  if (!id || !s || !e) return null;
  return `${NHDAPI_BASE}/tv?id=${id}&season=${s}&episode=${e}`;
}

/** Subtitles API endpoint for movies */
function getMovieSubtitlesUrl(tmdbId) {
  const id = cleanTmdbId(tmdbId);
  if (!id) return null;
  return `${NHDAPI_BASE}/subtitles/movie/${id}`;
}

/** Subtitles API endpoint for TV episodes */
function getEpisodeSubtitlesUrl(tmdbId, season, episode) {
  const id = cleanTmdbId(tmdbId);
  const s = toPositiveInt(season);
  const e = toPositiveInt(episode);
  if (!id || !s || !e) return null;
  return `${NHDAPI_BASE}/subtitles/tv/${id}/${s}/${e}`;
}

/** Language map for normalizing subtitle labels to standard ISO codes */
const SUBTITLE_LANG_MAP = {
  ar: 'ar', ara: 'ar', arabic: 'ar',
  en: 'en', eng: 'en', english: 'en',
  es: 'es', spa: 'es', spanish: 'es',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr',
  de: 'de', ger: 'de', deu: 'de', german: 'de',
  it: 'it', ita: 'it', italian: 'it',
  pt: 'pt', por: 'pt', pob: 'pt', portuguese: 'pt',
  ru: 'ru', rus: 'ru', russian: 'ru',
  hi: 'hi', hin: 'hi', hindi: 'hi',
  tr: 'tr', tur: 'tr', turkish: 'tr',
  nl: 'nl', dut: 'nl', nld: 'nl', dutch: 'nl',
  pl: 'pl', pol: 'pl', polish: 'pl',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  ko: 'ko', kor: 'ko', korean: 'ko',
  zh: 'zh', zho: 'zh', zhe: 'zh', chinese: 'zh'
};

function normalizeLanguageCode(label) {
  if (!label) return 'unknown';
  const clean = String(label).toLowerCase().replace(/[^a-z]/g, '');
  return SUBTITLE_LANG_MAP[clean] || clean.slice(0, 3);
}

// Active connection reference for SSE request cancellation
let activeStreamController = null;

function cancelActiveStream() {
  if (activeStreamController) {
    try {
      activeStreamController.abort();
    } catch {}
    activeStreamController = null;
  }
}

/**
 * Fetch and stream video sources from NHDApi via SSE.
 * Safely parses event stream chunks without blocking or locking the UI.
 *
 * @param {Object} options
 * @param {string|number} options.tmdbId - TMDB numeric ID
 * @param {string} [options.type='movie'] - 'movie' or 'series'
 * @param {number} [options.season] - Season number for TV
 * @param {number} [options.episode] - Episode number for TV
 * @param {Function} [options.onMeta] - Callback for 'meta' event: (meta) => void
 * @param {Function} [options.onSource] - Callback for 'source' event: (source) => void
 * @param {Function} [options.onDone] - Callback when done: ({ meta, sources }) => void
 * @param {Function} [options.onError] - Callback on error: (err) => void
 * @param {AbortSignal} [options.signal] - Optional external abort signal
 * @param {number} [options.timeoutMs=15000] - Request timeout in milliseconds
 */
async function fetchStream(options = {}) {
  const {
    tmdbId,
    type = 'movie',
    season,
    episode,
    onMeta,
    onSource,
    onDone,
    onError,
    signal,
    timeoutMs = 15000
  } = options;

  cancelActiveStream();

  const controller = new AbortController();
  activeStreamController = controller;

  // Propagate external signal if provided
  if (signal) {
    if (signal.aborted) {
      controller.abort();
      return;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const timeoutTimer = setTimeout(() => {
    try { controller.abort(new Error('NHDApi stream timeout')); } catch {}
  }, timeoutMs);

  const url = type === 'series'
    ? getEpisodeApiUrl(tmdbId, season, episode)
    : getMovieApiUrl(tmdbId);

  if (!url) {
    clearTimeout(timeoutTimer);
    const err = new Error('Invalid TMDB ID or episode coordinates for NHDApi');
    if (typeof onError === 'function') onError(err);
    return;
  }

  const headers = {
    'Accept': 'text/event-stream'
  };
  const apiKey = getApiKey();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['X-API-Key'] = apiKey;
  }

  const collected = {
    meta: null,
    sources: []
  };

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`NHDApi HTTP error: ${res.status} ${res.statusText}`);
    }

    if (!res.body || !res.body.getReader) {
      // Fallback for environments where ReadableStream is not accessible
      const text = await res.text();
      clearTimeout(timeoutTimer);
      parseEventStreamText(text, {
        onMeta: m => { collected.meta = m; if (onMeta) onMeta(m); },
        onSource: s => { collected.sources.push(s); if (onSource) onSource(s); },
        onDone: () => { if (onDone) onDone(collected); }
      });
      return collected;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Retain remainder in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const payloadStr = trimmed.slice(5).trim();
        if (!payloadStr) continue;

        try {
          const parsed = JSON.parse(payloadStr);
          if (!parsed || typeof parsed !== 'object') continue;

          if (parsed.type === 'meta' && parsed.meta) {
            collected.meta = parsed.meta;
            if (typeof onMeta === 'function') onMeta(parsed.meta);
          } else if (parsed.type === 'source' && parsed.source) {
            const src = { ...parsed.source };
            // Resolve relative proxy URLs (e.g. /api?url=...)
            if (src.url && src.url.startsWith('/')) {
              src.url = `${NHDAPI_BASE}${src.url}`;
            }
            collected.sources.push(src);
            if (typeof onSource === 'function') onSource(src);
          } else if (parsed.type === 'done') {
            if (typeof onDone === 'function') onDone(collected);
          }
        } catch {
          // Ignore malformed individual chunks and continue reading
        }
      }
    }

    // Process any remaining bytes
    if (buffer.trim().startsWith('data:')) {
      try {
        const parsed = JSON.parse(buffer.trim().slice(5).trim());
        if (parsed.type === 'source' && parsed.source) {
          const src = { ...parsed.source };
          if (src.url && src.url.startsWith('/')) src.url = `${NHDAPI_BASE}${src.url}`;
          collected.sources.push(src);
          if (typeof onSource === 'function') onSource(src);
        }
      } catch {}
    }

    clearTimeout(timeoutTimer);
    if (typeof onDone === 'function') onDone(collected);
    return collected;
  } catch (err) {
    clearTimeout(timeoutTimer);
    if (controller.signal.aborted) {
      // Aborted intentionally — don't report as user error
      return collected;
    }
    if (typeof onError === 'function') onError(err);
    return collected;
  } finally {
    if (activeStreamController === controller) {
      activeStreamController = null;
    }
  }
}

/**
 * Helper to parse a static SSE text body (useful for tests or non-streaming responses)
 */
function parseEventStreamText(text, callbacks = {}) {
  const { onMeta, onSource, onDone } = callbacks;
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    try {
      const payload = JSON.parse(trimmed.slice(5).trim());
      if (payload.type === 'meta' && onMeta) onMeta(payload.meta);
      else if (payload.type === 'source' && onSource) {
        const s = { ...payload.source };
        if (s.url && s.url.startsWith('/')) s.url = `${NHDAPI_BASE}${s.url}`;
        onSource(s);
      }
      else if (payload.type === 'done' && onDone) onDone();
    } catch {}
  }
}

/**
 * Fetch subtitle tracks from NHDApi.
 * Returns an array of normalized subtitle track objects.
 *
 * @param {Object} options
 * @param {string|number} options.tmdbId - TMDB numeric ID
 * @param {string} [options.type='movie'] - 'movie' or 'series'
 * @param {number} [options.season] - Season number for TV
 * @param {number} [options.episode] - Episode number for TV
 * @param {AbortSignal} [options.signal] - Optional abort signal
 * @param {number} [options.timeoutMs=8000] - Timeout in ms
 * @returns {Promise<Array>} Array of subtitle tracks
 */
async function fetchSubtitles(options = {}) {
  const {
    tmdbId,
    type = 'movie',
    season,
    episode,
    signal,
    timeoutMs = 8000
  } = options;

  const url = type === 'series'
    ? getEpisodeSubtitlesUrl(tmdbId, season, episode)
    : getMovieSubtitlesUrl(tmdbId);

  if (!url) return [];

  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) return [];
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const timer = setTimeout(() => {
    try { controller.abort(); } catch {}
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timer);
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter(item => item && item.file && typeof item.file === 'string')
      .map(item => {
        const rawLabel = String(item.label || 'Subtitles').trim();
        const langCode = normalizeLanguageCode(rawLabel);
        return {
          label: rawLabel,
          file: item.file,
          type: item.type || 'vtt',
          source: item.source || 'nhdapi',
          lang: langCode
        };
      });
  } catch {
    clearTimeout(timer);
    return [];
  }
}

const NHDApi = {
  BASE_URL: NHDAPI_BASE,
  getApiKey,
  setApiKey,
  cleanTmdbId,
  getMovieIframeUrl,
  getEpisodeIframeUrl,
  getMovieApiUrl,
  getEpisodeApiUrl,
  getMovieSubtitlesUrl,
  getEpisodeSubtitlesUrl,
  normalizeLanguageCode,
  fetchStream,
  cancelActiveStream,
  fetchSubtitles,
  parseEventStreamText
};

if (typeof window !== 'undefined') {
  window.NHDApi = NHDApi;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NHDApi;
}
