'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const mediaLinksContent = fs.readFileSync(path.join(ROOT, 'services', 'media-links.js'), 'utf8');
const tmdbContent = fs.readFileSync(path.join(ROOT, 'services', 'tmdb.js'), 'utf8');

const MediaLinks = require('../services/media-links.js');
const TMDB = require('../services/tmdb.js');
const CuratedCatalog = require('../services/curated-catalog.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('--- 1. TMDB SERVICE & METADATA NORMALIZATION ---');

test('TMDB service exports core discovery and on-demand methods', () => {
  assert.ok(typeof TMDB.getTrending === 'function');
  assert.ok(typeof TMDB.getPopular === 'function');
  assert.ok(typeof TMDB.getTopRated === 'function');
  assert.ok(typeof TMDB.searchMulti === 'function');
  assert.ok(typeof TMDB.getDetails === 'function');
  assert.ok(typeof TMDB.syncCoreDiscovery === 'function');
  assert.ok(typeof TMDB.normalizeTmdbMedia === 'function');
});

test('normalizeTmdbMedia correctly normalizes movies and series', () => {
  const rawMovie = {
    id: 1147301,
    title: 'Test Blockbuster Movie',
    overview: 'An epic adventure.',
    release_date: '2024-05-15',
    vote_average: 8.4,
    genre_ids: [28, 12],
    poster_path: '/poster123.jpg',
    backdrop_path: '/bg123.jpg',
    adult: false
  };
  const normMovie = TMDB.normalizeTmdbMedia(rawMovie, 'movie');
  assert.strictEqual(normMovie.tmdbId, '1147301');
  assert.strictEqual(normMovie.title, 'Test Blockbuster Movie');
  assert.strictEqual(normMovie.type, 'movie');
  assert.strictEqual(normMovie.year, '2024');
  assert.strictEqual(normMovie.imdbRating, '8.4');
  assert.deepStrictEqual(normMovie.genres, ['Action', 'Adventure']);
  assert.ok(normMovie.poster.includes('/poster123.jpg'));

  const rawTv = {
    id: 205715,
    name: 'Test Hit Series',
    overview: 'Drama unfolds.',
    first_air_date: '2023-10-01',
    vote_average: 8.9,
    genre_ids: [18, 80],
    adult: false
  };
  const normTv = TMDB.normalizeTmdbMedia(rawTv, 'series');
  assert.strictEqual(normTv.tmdbId, '205715');
  assert.strictEqual(normTv.title, 'Test Hit Series');
  assert.strictEqual(normTv.type, 'series');
  assert.deepStrictEqual(normTv.genres, ['Drama', 'Crime']);
});

test('normalizeTmdbMedia excludes adult NSFW content', () => {
  const adultMovie = {
    id: 999999,
    title: 'Explicit Content Title',
    adult: true
  };
  const result = TMDB.normalizeTmdbMedia(adultMovie, 'movie');
  assert.strictEqual(result, null);
});

test('TMDB API key rotation provides valid fallback keys', () => {
  assert.ok(Array.isArray(TMDB.TMDB_KEYS));
  assert.ok(TMDB.TMDB_KEYS.length >= 4);
  const key = TMDB.getApiKey();
  assert.ok(key && key.length === 32);
});

console.log('\n--- 2. 2EMBED & NHD API STREAM URL BUILDERS ---');

test('MediaLinks defines TWOEMBED_BASE as https://www.2embed.online', () => {
  assert.strictEqual(MediaLinks.TWOEMBED_BASE, 'https://www.2embed.online');
});

test('get2EmbedMovieUrl supports numeric TMDB ID and tt IMDb ID', () => {
  assert.strictEqual(MediaLinks.get2EmbedMovieUrl(1147301), 'https://www.2embed.online/embed/movie/1147301');
  assert.strictEqual(MediaLinks.get2EmbedMovieUrl('tt23779058'), 'https://www.2embed.online/embed/movie/tt23779058');
  assert.strictEqual(MediaLinks.get2EmbedMovieUrl(''), null);
  assert.strictEqual(MediaLinks.get2EmbedMovieUrl('invalid_id'), null);
});

test('get2EmbedEpisodeUrl supports TMDB/IMDb ID with season and episode numbers', () => {
  assert.strictEqual(MediaLinks.get2EmbedEpisodeUrl(205715, 1, 1), 'https://www.2embed.online/embed/tv/205715/1/1');
  assert.strictEqual(MediaLinks.get2EmbedEpisodeUrl('tt1375666', 2, 5), 'https://www.2embed.online/embed/tv/tt1375666/2/5');
  assert.strictEqual(MediaLinks.get2EmbedEpisodeUrl(205715, 0, 1), null);
  assert.strictEqual(MediaLinks.get2EmbedEpisodeUrl(205715, 1, 0), null);
});

test('get2EmbedIframePhpUrl generates auto-detect fallback endpoint', () => {
  assert.strictEqual(MediaLinks.get2EmbedIframePhpUrl(1147301), 'https://www.2embed.online/iframe.php?id=1147301');
  assert.strictEqual(MediaLinks.get2EmbedIframePhpUrl('tt23779058'), 'https://www.2embed.online/iframe.php?id=tt23779058');
});

test('getMovieStreamUrl and getEpisodeStreamUrl support server="2embed"', () => {
  const movie = { tmdbId: 1147301, imdb: 'tt23779058' };
  assert.strictEqual(MediaLinks.getMovieStreamUrl(movie, '2embed'), 'https://www.2embed.online/embed/movie/1147301');
  assert.strictEqual(MediaLinks.getMovieStreamUrl(movie, '2embed-imdb'), 'https://www.2embed.online/embed/movie/tt23779058');
  assert.strictEqual(MediaLinks.getMovieStreamUrl(movie, '2embed-iframe'), 'https://www.2embed.online/iframe.php?id=1147301');

  const series = { tmdbId: 205715, imdb: 'tt1234567' };
  assert.strictEqual(MediaLinks.getEpisodeStreamUrl(series, 1, 3, '2embed'), 'https://www.2embed.online/embed/tv/205715/1/3');
  assert.strictEqual(MediaLinks.getEpisodeStreamUrl(series, 1, 3, '2embed-imdb'), 'https://www.2embed.online/embed/tv/tt1234567/1/3');
  assert.strictEqual(MediaLinks.getEpisodeStreamUrl(series, 1, 3, '2embed-iframe'), 'https://www.2embed.online/iframe.php?id=205715');
});

test('isValidStreamEmbedUrl validates 2Embed and NHD API URLs', () => {
  assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://www.2embed.online/embed/movie/1147301'), true);
  assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://www.2embed.online/embed/tv/205715/1/1'), true);
  assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://www.2embed.online/iframe.php?id=1147301'), true);
  assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/movie/1147301'), true);
  assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/tv/205715?season=1&episode=1'), true);

  // Rejects empty IDs
  assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://www.2embed.online/iframe.php?id='), false);
  assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://www.2embed.online/embed/movie/'), false);
  assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/movie?id='), false);
});

console.log('\n--- 3. UI INTEGRATION & PRECONNECT IN INDEX.HTML ---');

test('index.html contains preconnect headers for TMDB, 2Embed, and NHD API', () => {
  assert.ok(htmlContent.includes('rel="preconnect" href="https://api.themoviedb.org"'));
  assert.ok(htmlContent.includes('rel="preconnect" href="https://image.tmdb.org"'));
  assert.ok(htmlContent.includes('rel="preconnect" href="https://www.2embed.online"'));
  assert.ok(htmlContent.includes('rel="preconnect" href="https://nhdapi.com"'));
});

test('index.html includes 2Embed pill in server switcher bar with status dots', () => {
  assert.ok(htmlContent.includes('id="ytServer2embed"'));
  assert.ok(htmlContent.includes('id="statusDot2embed"'));
  assert.ok(htmlContent.includes('id="statusDotNhd"'));
  assert.ok(htmlContent.includes('id="statusDotVid"'));
  assert.ok(htmlContent.includes('id="statusDotBackup"'));
  assert.ok(htmlContent.includes('id="ytForceNextServer"'));
  assert.ok(htmlContent.includes('Try Next Server'));
});

test('index.html loads services/tmdb.js script before app.js', () => {
  assert.ok(htmlContent.includes('<script src="services/tmdb.js"></script>'));
  const tmdbIdx = htmlContent.indexOf('services/tmdb.js');
  const appIdx = htmlContent.indexOf('app.js');
  assert.ok(tmdbIdx > 0 && tmdbIdx < appIdx);
});

console.log('\n--- 4. APP.JS FAILOVER, TMDB LIVE SEARCH & ON-DEMAND METADATA ---');

test('app.js includes 2embed origins in EMBED_ORIGINS', () => {
  assert.ok(appContent.includes("'https://www.2embed.online'"));
  assert.ok(appContent.includes("'https://2embed.online'"));
});

test('app.js wires 8-second failover watchdog and queue across NHD API, 2Embed, and Vid API', () => {
  assert.ok(appContent.includes('startFailoverWatchdog'));
  assert.ok(appContent.includes('cancelFailoverWatchdog'));
  assert.ok(appContent.includes('triggerAutoFailover'));
  assert.ok(appContent.includes('8000'));
  assert.ok(appContent.includes("['nhdapi', '2embed', '2embed-fallback', 'server1', 'backup']"));
  assert.ok(appContent.includes('unresponsive, automatically switching to'));
});

test('switchPlayerServer supports 2embed and sets frameborder="0" without sandbox', () => {
  assert.ok(appContent.includes("is2embed = (newServer === '2embed' || newServer === '2embed-fallback')"));
  assert.ok(appContent.includes("iframe.setAttribute('frameborder', '0')"));
  assert.strictEqual(appContent.includes("iframe.setAttribute('sandbox'"), false);
  assert.strictEqual(appContent.includes("f.setAttribute('sandbox'"), false);
});

test('openDetail incorporates Step 2.5 TMDB on-demand fallback', () => {
  assert.ok(appContent.includes('// 2.5 Live On-Demand Fallback via TMDB'));
  assert.ok(appContent.includes('TMDB.getDetails(id, type)'));
});

test('doSearch and doSearchDropdown incorporate TMDB.searchMulti', () => {
  assert.ok(appContent.includes('TMDB.searchMulti(q)'));
});

test('season dropdown updates active player stream dynamically without full reload', () => {
  assert.ok(appContent.includes("$('seasonSel').onchange = () =>"));
  assert.ok(appContent.includes("playEpisode(newSeason, 1)"));
});

console.log(`\n========================================`);
console.log(`TMDB & 2Embed Integration Tests: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
