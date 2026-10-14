'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const NHDApi = require('../services/nhdapi.js');
const MediaLinks = require('../services/media-links.js');

const appContent = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name} — ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name} — ${err.message}`);
  }
}

(async () => {
  console.log('--- 1. NHDApi URL Builders & ID Resolution ---');
  test('Movie iframe URL format matches https://nhdapi.com/movie/{id}', () => {
    const url = NHDApi.getMovieIframeUrl(1101412);
    assert.strictEqual(url, 'https://nhdapi.com/movie/1101412');
  });

  test('TV episode iframe URL format matches https://nhdapi.com/tv/{id}?season={s}&episode={e}', () => {
    const url = NHDApi.getEpisodeIframeUrl(1396, 1, 3);
    assert.strictEqual(url, 'https://nhdapi.com/tv/1396?season=1&episode=3');
  });

  test('Movie SSE API endpoint format matches https://nhdapi.com/movie?id={id}', () => {
    const url = NHDApi.getMovieApiUrl(1101412);
    assert.strictEqual(url, 'https://nhdapi.com/movie?id=1101412');
  });

  test('TV SSE API endpoint format matches https://nhdapi.com/tv?id={id}&season={s}&episode={e}', () => {
    const url = NHDApi.getEpisodeApiUrl(1396, 1, 3);
    assert.strictEqual(url, 'https://nhdapi.com/tv?id=1396&season=1&episode=3');
  });

  test('Movie Subtitles URL format matches https://nhdapi.com/subtitles/movie/{id}', () => {
    const url = NHDApi.getMovieSubtitlesUrl(1101412);
    assert.strictEqual(url, 'https://nhdapi.com/subtitles/movie/1101412');
  });

  test('TV Subtitles URL format matches https://nhdapi.com/subtitles/tv/{id}/{s}/{e}', () => {
    const url = NHDApi.getEpisodeSubtitlesUrl(1396, 1, 3);
    assert.strictEqual(url, 'https://nhdapi.com/subtitles/tv/1396/1/3');
  });

  test('cleanTmdbId strips tmdb: prefix and rejects invalid non-numeric IDs', () => {
    assert.strictEqual(NHDApi.cleanTmdbId('tmdb:1101412'), '1101412');
    assert.strictEqual(NHDApi.cleanTmdbId(1396), '1396');
    assert.strictEqual(NHDApi.cleanTmdbId('tt1396'), null);
    assert.strictEqual(NHDApi.cleanTmdbId(''), null);
    assert.strictEqual(NHDApi.cleanTmdbId(null), null);
  });

  console.log('\n--- 2. MediaLinks Integration ---');
  test('MediaLinks.NHDAPI_BASE is defined', () => {
    assert.strictEqual(MediaLinks.NHDAPI_BASE, 'https://nhdapi.com');
  });

  test('MediaLinks.getMovieStreamUrl supports server="nhdapi"', () => {
    const url = MediaLinks.getMovieStreamUrl({ tmdbId: 1101412 }, 'nhdapi');
    assert.strictEqual(url, 'https://nhdapi.com/movie/1101412');
  });

  test('MediaLinks.getEpisodeStreamUrl supports server="nhdapi"', () => {
    const url = MediaLinks.getEpisodeStreamUrl({ tmdbId: 1396 }, 1, 3, 'nhdapi');
    assert.strictEqual(url, 'https://nhdapi.com/tv/1396?season=1&episode=3');
  });

  test('MediaLinks exports dedicated NHDApi methods', () => {
    assert.strictEqual(typeof MediaLinks.getNhdApiMovieUrl, 'function');
    assert.strictEqual(typeof MediaLinks.getNhdApiEpisodeUrl, 'function');
    assert.strictEqual(typeof MediaLinks.getNhdApiMovieApiUrl, 'function');
    assert.strictEqual(typeof MediaLinks.getNhdApiEpisodeApiUrl, 'function');
    assert.strictEqual(typeof MediaLinks.getNhdApiMovieSubtitlesUrl, 'function');
    assert.strictEqual(typeof MediaLinks.getNhdApiEpisodeSubtitlesUrl, 'function');
  });

  console.log('\n--- 3. SSE Stream Parser & Event Handling ---');
  test('parseEventStreamText correctly extracts meta, sources, and done', () => {
    const mockSse = [
      'data: {"type":"meta","meta":{"id":1101412,"title":"Fall 2: Deadpoint"}}',
      'data: {"type":"source","source":{"source":"dulo","label":"Dulo 1","url":"https://example.com/stream.m3u8"}}',
      'data: {"type":"source","source":{"source":"kisskh","label":"KissKH","url":"/api?url=https%3A%2F%2Fcdn.example.com%2Fvideo"}}',
      'data: {"type":"done"}'
    ].join('\n\n');

    let metaReceived = null;
    const sourcesReceived = [];
    let doneCalled = false;

    NHDApi.parseEventStreamText(mockSse, {
      onMeta: (m) => { metaReceived = m; },
      onSource: (s) => { sourcesReceived.push(s); },
      onDone: () => { doneCalled = true; }
    });

    assert.ok(metaReceived);
    assert.strictEqual(metaReceived.id, 1101412);
    assert.strictEqual(sourcesReceived.length, 2);
    assert.strictEqual(sourcesReceived[0].url, 'https://example.com/stream.m3u8');
    // Relative URL was resolved to NHDApi base
    assert.strictEqual(sourcesReceived[1].url, 'https://nhdapi.com/api?url=https%3A%2F%2Fcdn.example.com%2Fvideo');
    assert.strictEqual(doneCalled, true);
  });

  test('parseEventStreamText safely ignores malformed chunks', () => {
    const badSse = [
      'data: not-valid-json',
      'data: {"type":"source","source":{"url":"https://ok.com/video.mp4"}}'
    ].join('\n');

    const sources = [];
    NHDApi.parseEventStreamText(badSse, {
      onSource: (s) => sources.push(s)
    });
    assert.strictEqual(sources.length, 1);
    assert.strictEqual(sources[0].url, 'https://ok.com/video.mp4');
  });

  console.log('\n--- 4. Subtitle Normalization & Language Code Mapping ---');
  test('Language codes normalize correctly for common streams', () => {
    assert.strictEqual(NHDApi.normalizeLanguageCode('Arabic'), 'ar');
    assert.strictEqual(NHDApi.normalizeLanguageCode('ARA'), 'ar');
    assert.strictEqual(NHDApi.normalizeLanguageCode('English'), 'en');
    assert.strictEqual(NHDApi.normalizeLanguageCode('ENG'), 'en');
    assert.strictEqual(NHDApi.normalizeLanguageCode('French'), 'fr');
    assert.strictEqual(NHDApi.normalizeLanguageCode('Spanish'), 'es');
    assert.strictEqual(NHDApi.normalizeLanguageCode('German'), 'de');
    assert.strictEqual(NHDApi.normalizeLanguageCode('Russian'), 'ru');
  });

  console.log('\n--- 5. Server Selection & UI Architecture ---');
  test('index.html contains both server options with generic names', () => {
    assert.ok(htmlContent.includes('<option value="server1" selected>Server 1: High Definition Stream</option>'));
    assert.ok(htmlContent.includes('<option value="server2">Server 2: Fast Mirror Stream</option>'));
  });

  test('index.html includes services/nhdapi.js script tag', () => {
    assert.ok(htmlContent.includes('<script src="services/nhdapi.js"></script>'));
  });

  test('app.js includes https://nhdapi.com in EMBED_ORIGINS', () => {
    assert.ok(appContent.includes("'https://nhdapi.com'"));
  });

  test('switchPlayerServer supports Server 2 (NHDApi)', () => {
    assert.ok(appContent.includes("newServer === 'server2' || newServer === 'nhdapi'"));
    assert.ok(appContent.includes("startNhdApiSession"));
  });

  test('closePlayer and openPlayerShell cancel active NHDApi stream', () => {
    assert.ok(appContent.includes('NHDApi.cancelActiveStream'));
  });

  console.log('\n--- 6. Pop-Under Ads & Focus Guardian Protection ---');
  test('armVidShield is armed during player embed mounting and server switching', () => {
    const playEmbedArm = appContent.indexOf('armVidShield()');
    assert.ok(playEmbedArm > -1);
  });

  test('Global window.open trap blocks unauthorized popups while allowing legitimate actions', () => {
    assert.ok(appContent.includes('window.open = function(url, target, features)'));
    assert.ok(appContent.includes('_nativeWindowOpen'));
  });

  test('Light-speed focus snap guards against blur/visibility loss during playback', () => {
    assert.ok(appContent.includes('snapWindowFocus'));
    assert.ok(appContent.includes('triggerLightSpeedFocusSnap'));
    assert.ok(appContent.includes('startFocusGuardian'));
  });

  console.log(`\n========================================`);
  console.log(`NHDApi Integration Tests: ${passed} passed, ${failed} failed.`);
  console.log(`========================================`);
  if (failed > 0) process.exit(1);
})();
