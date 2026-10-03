'use strict';

/**
 * Playback service — the ONLY module the UI calls for streams.
 *
 *   getPlaybackSource({ id, type, season?, episode?, stream? })
 *     → { url, type: 'mp4' | 'hls', quality? }
 *
 * Flow: resolve the title's authorized torrent streams (Cinemeta metadata +
 * Torrentio listings are metadata only — no content), pick the best one, then
 * ask OUR `/api/playback` resolver for the playable URL. The browser never
 * talks to third-party stream scrapers.
 *
 * DOM-free on purpose (works in Node for tests). No playback starts here —
 * the player consumes the returned PlaybackSource.
 */

/* eslint-disable no-undef */
const TORRENTIO_BASE = 'https://torrentio.strem.fun';
const PLAYBACK_API = '/api/playback';
const STREAM_TTL_MS = 5 * 60 * 1000;

const streamCache = new Map(); // key -> { at, streams }
const inflight = new Map(); // key -> Promise<PlaybackSource>

class PlaybackError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PlaybackError';
    this.code = code || 'PLAYBACK_FAILED';
  }
}

function streamKey(id, type, season, episode) {
  return type === 'series' ? `${id}:${season || 1}:${episode || 1}` : `${id}`;
}

function parseQuality(s) {
  const text = `${s.name || ''}\n${s.title || ''}`;
  const q = /2160|4k/i.test(text) ? 2160 : /1080/i.test(text) ? 1080 : /720/i.test(text) ? 720 : /480/i.test(text) ? 480 : 0;
  const seedM = text.match(/👤\s*(\d+)/) || text.match(/(\d+)\s*seed/i);
  return { q, seeds: seedM ? parseInt(seedM[1], 10) : 0 };
}

function qualityLabel(q) {
  return q >= 2160 ? '4K' : q >= 1080 ? '1080p' : q >= 720 ? '720p' : q >= 480 ? '480p' : 'SD';
}

async function fetchTorrentStreams(imdbId, type, season, episode) {
  const key = `streams:${streamKey(imdbId, type, season, episode)}`;
  const hit = streamCache.get(key);
  if (hit && Date.now() - hit.at < STREAM_TTL_MS) return hit.streams;
  const path = type === 'series'
    ? `/stream/series/${imdbId}:${season || 1}:${episode || 1}.json`
    : `/stream/movie/${imdbId}.json`;
  let res;
  try {
    res = await fetch(TORRENTIO_BASE + path);
  } catch {
    throw new PlaybackError('Cannot reach the catalog right now. Check your connection and retry.', 'CATALOG_UNREACHABLE');
  }
  if (!res.ok) throw new PlaybackError('Catalog lookup failed. Please try again.', 'CATALOG_FAILED');
  const data = await res.json().catch(() => ({}));
  const streams = (data.streams || []).filter((s) => s && s.infoHash);
  streamCache.set(key, { at: Date.now(), streams });
  return streams;
}

function pickBest(streams) {
  const ranked = streams
    .map((s) => ({ s, ...parseQuality(s) }))
    .sort((a, b) => b.q - a.q || b.seeds - a.seeds);
  return ranked[0] || null;
}

async function resolveViaApi({ infoHash, fileIdx, title, quality }) {
  const params = new URLSearchParams({ infoHash, title: title || 'video' });
  if (fileIdx !== undefined) params.set('fileIdx', String(fileIdx));
  if (quality) params.set('quality', quality);
  let res;
  try {
    res = await fetch(`${PLAYBACK_API}?${params.toString()}`);
  } catch {
    throw new PlaybackError('Cannot reach the playback service. Check your connection and retry.', 'API_UNREACHABLE');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url || !/^https?:\/\//i.test(data.url)) {
    throw new PlaybackError(data.error || 'No playable source exists for this title right now.', 'NO_SOURCE');
  }
  return { url: data.url, type: data.type === 'hls' ? 'hls' : 'mp4', quality: data.quality || quality };
}

/**
 * @param {{id: string, type: 'movie'|'series', season?: number, episode?: number,
 *          stream?: {infoHash: string, fileIdx?: number}}} req
 * @returns {Promise<{url: string, type: 'mp4'|'hls', quality?: string}>}
 * @throws {PlaybackError} with a user-friendly message
 */
async function getPlaybackSource(req) {
  const { id, type } = req || {};
  const season = req && req.season != null ? Number(req.season) : 1;
  const episode = req && req.episode != null ? Number(req.episode) : 1;
  if (!id || (type !== 'movie' && type !== 'series')) {
    throw new PlaybackError('Invalid title. Please pick the title again.', 'INVALID_ID');
  }
  if (type === 'series' && (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1)) {
    throw new PlaybackError('Invalid season or episode.', 'INVALID_ID');
  }

  const key = `src:${streamKey(id, type, season, episode)}`;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    // A specific stream row was chosen → use it directly, no re-listing.
    if (req.stream && req.stream.infoHash) {
      return resolveViaApi({
        infoHash: req.stream.infoHash,
        fileIdx: req.stream.fileIdx,
        title: req.stream.title,
        quality: req.stream.quality,
      });
    }
    const streams = await fetchTorrentStreams(id, type, season, episode);
    if (!streams.length) {
      throw new PlaybackError(
        type === 'series'
          ? `No playable source for S${season}:E${episode} right now. Try another episode.`
          : 'No playable source exists for this title right now.',
        'NO_SOURCE',
      );
    }
    const best = pickBest(streams);
    return resolveViaApi({
      infoHash: best.s.infoHash,
      fileIdx: best.s.fileIdx,
      title: best.s.behaviorHints && best.s.behaviorHints.filename,
      quality: qualityLabel(best.q),
    });
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

function clearPlaybackCache() {
  streamCache.clear();
}

const Playback = { getPlaybackSource, clearPlaybackCache, PlaybackError };
if (typeof module !== 'undefined' && module.exports) module.exports = Playback;
