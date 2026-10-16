'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

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

console.log('--- 1. RESTORE ROUTING & TMDB ID HANDLING ---');

// Extract parseRouteFromLocation function logic from app.js to test in isolated environment
const parseRouteFnMatch = appContent.match(/function parseRouteFromLocation\(\)\s*\{([\s\S]*?)\n\}\s*\nfunction handleRouteFromHash/);
assert.ok(parseRouteFnMatch, 'parseRouteFromLocation must be defined in app.js');

function mockParseRoute(mockWindow) {
  const window = mockWindow;
  const URLSearchParams = require('url').URLSearchParams;
  const fn = new Function('window', 'URLSearchParams', parseRouteFnMatch[1]);
  return fn(window, URLSearchParams);
}

test('Route /movie/1101412 (hash) parses correctly', () => {
  const r = mockParseRoute({ location: { hash: '#/movie/1101412', pathname: '/', search: '' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.kind, 'movie');
  assert.strictEqual(r.id, '1101412');
  assert.strictEqual(r.isWatch, false);
});

test('Route /movie?id=1101412 (hash query) parses correctly', () => {
  const r = mockParseRoute({ location: { hash: '#/movie?id=1101412', pathname: '/', search: '' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.kind, 'movie');
  assert.strictEqual(r.id, '1101412');
});

test('Route /movie/1101412 (pathname) parses correctly without hash', () => {
  const r = mockParseRoute({ location: { hash: '', pathname: '/movie/1101412', search: '' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.kind, 'movie');
  assert.strictEqual(r.id, '1101412');
});

test('Route /tv/1396/1/3 (hash) parses season and episode correctly', () => {
  const r = mockParseRoute({ location: { hash: '#/tv/1396/1/3', pathname: '/', search: '' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.kind, 'series');
  assert.strictEqual(r.id, '1396');
  assert.strictEqual(r.season, 1);
  assert.strictEqual(r.episode, 3);
});

test('Route /tv?id=1396&season=2&episode=5 parses correctly', () => {
  const r = mockParseRoute({ location: { hash: '#/tv?id=1396&season=2&episode=5', pathname: '/', search: '' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.kind, 'series');
  assert.strictEqual(r.id, '1396');
  assert.strictEqual(r.season, 2);
  assert.strictEqual(r.episode, 5);
});

test('Route /watch?kind=movie&id=1101412 flags isWatch: true', () => {
  const r = mockParseRoute({ location: { hash: '#/watch?kind=movie&id=1101412', pathname: '/', search: '' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.kind, 'movie');
  assert.strictEqual(r.id, '1101412');
  assert.strictEqual(r.isWatch, true);
});

test('Route /watch?kind=tv&id=1396&season=1&episode=3 flags isWatch: true and extracts coordinates', () => {
  const r = mockParseRoute({ location: { hash: '#/watch?kind=tv&id=1396&season=1&episode=3', pathname: '/', search: '' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.kind, 'series');
  assert.strictEqual(r.id, '1396');
  assert.strictEqual(r.season, 1);
  assert.strictEqual(r.episode, 3);
  assert.strictEqual(r.isWatch, true);
});

test('Query string ?id=1101412 directly resolves to movie media route', () => {
  const r = mockParseRoute({ location: { hash: '', pathname: '/', search: '?id=1101412' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.kind, 'movie');
  assert.strictEqual(r.id, '1101412');
});

test('Empty ID route /movie?id= returns id: null to prevent 404 or empty stream loading', () => {
  const r = mockParseRoute({ location: { hash: '#/movie?id=', pathname: '/', search: '' } });
  assert.strictEqual(r.type, 'media');
  assert.strictEqual(r.id, null);
});

test('handleRouteFromHash gracefully rejects missing ID and toasts notice', () => {
  assert.ok(appContent.includes("toast('No title to play: missing valid ID.')"));
  assert.ok(appContent.includes("!routeId || routeId === 'undefined' || routeId === 'null'"));
});

test('openDetail validates ID and preserves numeric TMDB IDs in Step 3 fallback', () => {
  assert.ok(appContent.includes("if (!id || id === 'undefined' || id === 'null' || id === 'NaN')"));
  assert.ok(appContent.includes("const isNum = /^\\d+$/.test(cleanId)"));
  assert.ok(appContent.includes("moviedb_id: tmdbVal"));
  assert.ok(appContent.includes("tmdbId: tmdbVal"));
});

console.log('\n--- 2. MULTI-LAYER POP-UNDER BLOCKER (NO SANDBOX) ---');

test('Strict rule: player iframe has NO sandbox attribute in app.js', () => {
  assert.strictEqual(appContent.includes("f.setAttribute('sandbox'"), false);
  assert.strictEqual(appContent.includes("iframe.setAttribute('sandbox'"), false);
});

test('Iframe has credentialless and allow="autoplay; fullscreen; encrypted-media; picture-in-picture"', () => {
  assert.ok(appContent.includes("autoplay; fullscreen; encrypted-media; picture-in-picture"));
  assert.ok(appContent.includes("f.setAttribute('credentialless', '')"));
  assert.ok(appContent.includes("iframe.setAttribute('credentialless', '')"));
});

test('Iframe loads original external embed provider URL directly in playEmbed and switchPlayerServer', () => {
  assert.ok(appContent.includes("f.src = fullOriginalEmbedUrl;"));
  assert.ok(appContent.includes("iframe.src = fullOriginalEmbedUrl;"));
});

test('High-Frequency Focus Trap: hidden button pFocusTrap outside iframe in index.html', () => {
  assert.ok(htmlContent.includes('<button id="pFocusTrap"'));
  assert.ok(htmlContent.includes('aria-hidden="true"'));
  assert.ok(appContent.includes('document.activeElement === iframe'));
  assert.ok(appContent.includes('iframe.blur()'));
  assert.ok(appContent.includes('trap.focus()'));
  assert.ok(appContent.includes('window.focus()'));
});

test('beforeunload redirect lock active while mouse hovers or mobile touch interacts with player container', () => {
  assert.ok(appContent.includes('_playerHovered'));
  assert.ok(appContent.includes('_playerHovered = true'));
  assert.ok(appContent.includes('_playerHovered = false'));
  assert.ok(appContent.includes("'touchstart'"));
  assert.ok(appContent.includes("'touchend'"));
  assert.ok(appContent.includes("if (_playerHovered && $('playerView')?.classList.contains('show') && !_allowNavigation)"));
});

test('Smart transparent click-shield overlay activates 1.5s after user first click', () => {
  assert.ok(appContent.includes('_firstClickDone'));
  assert.ok(appContent.includes('_shieldActivateTimer = setTimeout'));
  assert.ok(appContent.includes('1500'));
  assert.ok(appContent.includes('activateVidShield()'));
});

test('Shield controls in index.html and styles.css provide Unlock (3s) and Fullscreen buttons', () => {
  assert.ok(htmlContent.includes('id="pShieldControls"'));
  assert.ok(htmlContent.includes('id="pUnlockShieldBtn"'));
  assert.ok(htmlContent.includes('Unlock Controls (3s)'));
  assert.ok(htmlContent.includes('id="pFullscreenShieldBtn"'));
  assert.ok(htmlContent.includes('Fullscreen'));
  assert.ok(cssContent.includes('.p-shield-controls'));
  assert.ok(cssContent.includes('.shield-corner-btn'));
  assert.ok(appContent.includes('disarmVidShield(3)'));
  assert.ok(appContent.includes('togglePlayerWrapperFullscreen()'));
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
