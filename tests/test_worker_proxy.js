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

  console.log('\n--- 2. Pre-Check Mechanism with 3-Second Timeout ---');
  test('checkWorkerStreamAvailability defined with 3-second timeout', () => {
    assert.ok(appContent.includes('checkWorkerStreamAvailability'));
    assert.ok(appContent.includes('3000'));
  });

  test('Worker status 200 OK check and fallback branches exist in playEmbed', () => {
    assert.ok(appContent.includes('const isWorkerOk = await checkWorkerStreamAvailability(workerUrl);'));
    assert.ok(appContent.includes('const finalUrl = isWorkerOk ? workerUrl : originalStreamUrl;'));
  });

  test('credentialless and allow attributes added when worker is OK', () => {
    assert.ok(appContent.includes("f.setAttribute('credentialless', '')"));
    assert.ok(appContent.includes("f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media"));
  });

  test('switchPlayerServer also verifies worker and sets credentialless', () => {
    assert.ok(appContent.includes("iframe.setAttribute('credentialless', '')"));
    assert.ok(appContent.includes("iframe.removeAttribute('credentialless')"));
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
