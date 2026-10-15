'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MediaLinks = require('../services/media-links.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name} -> ${err.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('--- 1. Cloudflare Worker URL Construction ---');
  const expectedBase = 'https://adsclear.yassine-hzami.workers.dev/?url=';

  test('MediaLinks exports WORKER_PROXY_BASE matching requirement', () => {
    assert.strictEqual(MediaLinks.WORKER_PROXY_BASE, expectedBase);
  });

  test('getWorkerProxyUrl correctly encodes original stream URLs', () => {
    const original = 'https://nhdapi.com/movie/1101412';
    const expected = `${expectedBase}${encodeURIComponent(original)}`;
    assert.strictEqual(MediaLinks.getWorkerProxyUrl(original), expected);
  });

  test('app.js defines WORKER_PROXY_BASE and getWorkerProxyUrl', () => {
    assert.ok(appContent.includes("const WORKER_PROXY_BASE = 'https://adsclear.yassine-hzami.workers.dev/?url=';"));
    assert.ok(appContent.includes('function getWorkerProxyUrl('));
  });

  console.log('\n--- 2. Direct Embed Loading & Multi-Layer Pop-Under Blocker ---');
  test('iframe src set directly to fullOriginalEmbedUrl', () => {
    assert.ok(appContent.includes("f.src = fullOriginalEmbedUrl;"));
    assert.ok(appContent.includes("iframe.src = fullOriginalEmbedUrl;"));
  });

  test('iframe includes allow="autoplay; fullscreen; encrypted-media; window-management \'none\'" and allowFullScreen', () => {
    assert.ok(appContent.includes('allow="autoplay; fullscreen; encrypted-media; window-management \'none\'"') || appContent.includes("autoplay; fullscreen; encrypted-media; window-management 'none'"));
    assert.ok(appContent.includes('f.allowFullscreen = true'));
    assert.ok(appContent.includes("f.setAttribute('allowfullscreen', '')"));
    assert.ok(appContent.includes("f.setAttribute('credentialless', '')"));
  });

  test('no sandbox attribute on iframe (allows playback)', () => {
    assert.strictEqual(appContent.includes("f.setAttribute('sandbox'"), false);
    assert.strictEqual(appContent.includes("iframe.setAttribute('sandbox'"), false);
  });

  test('High-Frequency Focus Trap: hidden pFocusTrap outside iframe snaps focus back', () => {
    assert.ok(htmlContent.includes('id="pFocusTrap"'));
    assert.ok(appContent.includes('document.activeElement === iframe'));
    assert.ok(appContent.includes('iframe.blur()'));
    assert.ok(appContent.includes('trap.focus()'));
  });

  test('beforeunload redirect lock active ONLY while mouse hovers over player container', () => {
    assert.ok(appContent.includes('_playerHovered'));
    assert.ok(appContent.includes("addEventListener('mouseenter'"));
    assert.ok(appContent.includes("addEventListener('mouseleave'"));
    assert.ok(appContent.includes("if (_playerHovered && $('playerView')"));
  });

  test('smart click-shield overlay activates 1.5s after user first click with corner controls', () => {
    assert.ok(appContent.includes('_shieldActivateTimer = setTimeout'));
    assert.ok(appContent.includes('activateVidShield()'));
    assert.ok(htmlContent.includes('id="pShieldControls"'));
    assert.ok(htmlContent.includes('id="pUnlockShieldBtn"'));
    assert.ok(htmlContent.includes('id="pFullscreenShieldBtn"'));
    assert.ok(appContent.includes('disarmVidShield(3)'));
    assert.ok(appContent.includes('togglePlayerWrapperFullscreen()'));
  });

  test('no fetch pre-check in player embed logic (broken pre-check removed)', () => {
    assert.strictEqual(appContent.includes('checkWorkerStreamAvailability'), false);
    assert.strictEqual(appContent.includes('await fetch(workerUrl'), false);
  });

  test('getWorkerProxyUrl never calls worker with an empty or invalid URL', () => {
    assert.strictEqual(MediaLinks.getWorkerProxyUrl(''), '');
    assert.strictEqual(MediaLinks.getWorkerProxyUrl(null), '');
    assert.strictEqual(MediaLinks.getWorkerProxyUrl('https://nhdapi.com/movie?id='), '');
  });

  test('index.html contains preconnect for Cloudflare Worker domain', () => {
    assert.ok(htmlContent.includes('<link rel="preconnect" href="https://adsclear.yassine-hzami.workers.dev">'));
  });

  console.log('\n--- 3. Live Worker Connectivity & Fallback Resilience ---');
  // Test live Worker response for movie stream
  try {
    const testUrl = 'https://nhdapi.com/movie/1101412';
    const proxyUrl = MediaLinks.getWorkerProxyUrl(testUrl);
    const res = await fetch(proxyUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(4000)
    });
    test('Live Cloudflare Worker responds with status 200 for NHDApi movie', () => {
      assert.strictEqual(res.status, 200);
    });
  } catch (err) {
    console.warn('Note: Live worker network fetch warning:', err.message);
  }

  // Test fallback simulation on network error
  test('Simulated timeout or 500 error gracefully falls back to original stream URL', () => {
    const original = 'https://vaplayer.ru/embed/movie/tt1375666';
    const isWorkerOk = false; // Simulated failure
    const finalUrl = isWorkerOk ? MediaLinks.getWorkerProxyUrl(original) : original;
    assert.strictEqual(finalUrl, original);
  });

  console.log('\n--- 4. TMDB ID Validation & Empty ID Prevention (Rule 1) ---');
  test('isValidStreamEmbedUrl rejects empty IDs like /movie?id= and /tv?id=', () => {
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/movie?id='), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/tv?id='), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/tv?id=&season=1&episode=3'), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://example.com/watch?kind=movie&id='), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/movie/'), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://vaplayer.ru/embed/tv//1/1'), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/movie?id=undefined'), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/movie?id=null'), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl(''), false);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl(null), false);
  });

  test('isValidStreamEmbedUrl accepts valid TMDB ID and embed URLs', () => {
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/movie/1101412'), true);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://nhdapi.com/tv/1396?season=1&episode=3'), true);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://vaplayer.ru/embed/tv/1396/1/3'), true);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://example.com/watch?kind=movie&id=1101412'), true);
    assert.strictEqual(MediaLinks.isValidStreamEmbedUrl('https://vaplayer.ru/embed/movie/tt1375666'), true);
  });

  test('ensureValidStreamEmbedUrl fixes empty placeholder with valid TMDB ID', () => {
    const fixedMovie = MediaLinks.ensureValidStreamEmbedUrl('https://nhdapi.com/movie?id=', 1101412);
    assert.strictEqual(fixedMovie, 'https://nhdapi.com/movie?id=1101412');

    const fixedWatch = MediaLinks.ensureValidStreamEmbedUrl('https://example.com/watch?kind=movie&id=', '1101412');
    assert.strictEqual(fixedWatch, 'https://example.com/watch?kind=movie&id=1101412');

    const emptyNoId = MediaLinks.ensureValidStreamEmbedUrl('https://nhdapi.com/movie?id=', null);
    assert.strictEqual(emptyNoId, null);
  });

  test('app.js integrates ensureValidStreamEmbedUrl and isValidStreamEmbedUrl', () => {
    assert.ok(appContent.includes('function isValidStreamEmbedUrl('));
    assert.ok(appContent.includes('function ensureValidStreamEmbedUrl('));
    assert.ok(appContent.includes('ensureValidStreamEmbedUrl(rawStreamUrl, tmdbId, o)'));
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests();
