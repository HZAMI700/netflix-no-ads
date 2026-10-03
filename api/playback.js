'use strict';

/**
 * GET /api/playback — primary playback resolver for the site.
 *
 * Lawful counterpart to the movie-scraper `/api` pattern: same serverless
 * shape (resolve → { url }), but it ONLY serves sources the operator is
 * authorized to distribute:
 *   1. `infoHash` → proxied through YOUR backend API (keeps its URL/keys
 *      out of the browser). The backend streams your own authorized torrents.
 *   2. `direct`   → an explicit media URL, only when its origin is allowlisted
 *      via ALLOWED_MEDIA_ORIGINS.
 *
 * There is deliberately NO third-party scraper logic here: no token
 * generation, no WASM blobs, no spoofed Referer/Origin, no vidsrc-style
 * fallbacks.
 *
 * Query:
 *   /api/playback?infoHash=<40-hex>&fileIdx=0&title=Name&quality=1080p
 *   /api/playback?direct=https%3A%2F%2Fcdn.example.com%2Fvid%2F1.m3u8
 *
 * Success: { "url": "https://…", "type": "mp4" | "hls", "quality": "1080p" }
 * Failure: { "error": "human-friendly message" }
 */

const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/$/, '');
const CORS_ORIGIN = process.env.PLAYBACK_CORS || '*';
const TIMEOUT_MS = Math.max(1000, parseInt(process.env.PLAYBACK_TIMEOUT_MS || '45000', 10) || 45000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_MEDIA_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase().replace(/\/$/, ''))
  .filter(Boolean);

const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://9.rarbg.com:2810/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
].map((t) => 'tr=' + encodeURIComponent(t)).join('&');

const INFO_HASH_RE = /^[a-f0-9]{40}$/i;

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function buildMagnet(infoHash, filename) {
  return `magnet:?xt=urn:btih:${infoHash.toLowerCase()}&dn=${encodeURIComponent(filename || 'video')}&${TRACKERS}`;
}

function friendlyBackendError(status) {
  if (status === 400) return 'That title has no playable file. Try another episode or stream.';
  if (status === 404) return 'The playback session expired. Please try again.';
  if (status === 413) return 'This file exceeds the server size limit.';
  if (status === 429) return 'The playback server is busy. Please wait a moment and retry.';
  if (status === 502) return 'The playback server could not fetch the media. Try another stream.';
  return 'Playback failed. Please try again.';
}

/** Mode 1: resolve a torrent the operator is authorized to distribute via their backend. */
async function handleBackend(res, q) {
  if (!BACKEND_URL) {
    return send(res, 503, { error: 'Playback backend is not configured yet.' });
  }
  const infoHash = (q.infoHash || '').trim();
  if (!INFO_HASH_RE.test(infoHash)) {
    return send(res, 400, { error: 'Invalid title reference. Please pick the title again.' });
  }
  const fileIdx = q.fileIdx === undefined || q.fileIdx === '' ? undefined : Number(q.fileIdx);
  if (fileIdx !== undefined && (!Number.isInteger(fileIdx) || fileIdx < 0)) {
    return send(res, 400, { error: 'Invalid file reference.' });
  }

  let upstream;
  try {
    upstream = await fetch(`${BACKEND_URL}/api/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        magnet: buildMagnet(infoHash, q.title),
        ...(fileIdx !== undefined ? { fileIndex: fileIdx } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return send(res, 502, {
      error: timedOut
        ? 'The playback server is taking too long. Please try again.'
        : 'Cannot reach the playback server. Check your connection and retry.',
    });
  }

  let data = {};
  try {
    data = await upstream.json();
  } catch {
    return send(res, 502, { error: 'The playback server returned an invalid response.' });
  }
  if (!upstream.ok || !data.streamUrl || !/^https?:\/\//i.test(data.streamUrl)) {
    return send(res, upstream.status === 429 ? 429 : 502, {
      error: data.error || friendlyBackendError(upstream.status),
    });
  }
  return send(res, 200, {
    url: data.streamUrl,
    type: 'mp4',
    quality: q.quality || undefined,
    direct: data.direct !== false,
  });
}

/** Mode 2: explicit media URL, only from allowlisted origins. */
function handleDirect(res, raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return send(res, 400, { error: 'That media URL is invalid.' });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return send(res, 403, { error: 'That media URL is not allowed.' });
  }
  const origin = parsed.origin.toLowerCase();
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return send(res, 403, { error: 'That media source is not enabled on this site.' });
  }
  const type = /\.m3u8(\?|$)/i.test(parsed.pathname) ? 'hls' : 'mp4';
  return send(res, 200, { url: parsed.toString(), type });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const url = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(url.searchParams);
  if (q.direct) return handleDirect(res, q.direct);
  if (q.infoHash) return handleBackend(res, q);
  return send(res, 400, { error: 'Provide a title reference (infoHash) or an enabled media URL.' });
};
