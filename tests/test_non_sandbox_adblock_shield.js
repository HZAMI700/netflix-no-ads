'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const MediaLinks = require(path.join(ROOT, 'services', 'media-links.js'));

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

console.log('--- 1. PRESERVE WORKING ROUTING & DIRECT IFRAME LOADING (NO PROXY / NO 404s) ---');

test('No backend proxy rewrites embed URLs into internal routes', () => {
  assert.ok(appContent.includes("f.src = fullOriginalEmbedUrl;"));
  assert.ok(appContent.includes("iframe.src = fullOriginalEmbedUrl;"));
  assert.strictEqual(appContent.includes("/api/embed-proxy"), false);
});

test('Direct external stream URLs generated for NHD API, 2Embed, and Vid API', () => {
  // NHD API
  const nhdMovie = MediaLinks.getNhdApiMovieUrl('1101412');
  assert.strictEqual(nhdMovie, 'https://nhdapi.com/movie/1101412');
  const nhdEp = MediaLinks.getNhdApiEpisodeUrl('1396', 1, 3);
  assert.ok(nhdEp.includes('https://nhdapi.com/tv/1396'));

  // 2Embed
  const twoMovie = MediaLinks.get2EmbedMovieUrl('1101412');
  assert.strictEqual(twoMovie, 'https://www.2embed.online/embed/movie/1101412');
  const twoMovieImdb = MediaLinks.get2EmbedMovieUrl('tt23779058');
  assert.strictEqual(twoMovieImdb, 'https://www.2embed.online/embed/movie/tt23779058');
  const twoEp = MediaLinks.get2EmbedEpisodeUrl('1396', 1, 3);
  assert.strictEqual(twoEp, 'https://www.2embed.online/embed/tv/1396/1/3');
  const twoIframe = MediaLinks.get2EmbedIframePhpUrl('1101412');
  assert.strictEqual(twoIframe, 'https://www.2embed.online/iframe.php?id=1101412');

  // Vid API
  const vidMovie = MediaLinks.getMovieStreamUrl({ imdb: 'tt0816692', tmdbId: '157336' }, 'vidapi');
  assert.strictEqual(vidMovie, 'https://vidapi.ru/embed/movie/tt0816692');
  const vidEp = MediaLinks.getEpisodeStreamUrl({ tmdbId: '1396' }, 1, 3, 'vidapi');
  assert.strictEqual(vidEp, 'https://vidapi.ru/embed/tv/1396/1/3');
});

console.log('\n--- 2. ENFORCE THE NON-SANDBOX POP-UNDER BLOCKER ON EVERY SERVER ---');

test('Strict rule: NEVER use sandbox attribute on player iframe', () => {
  assert.strictEqual(appContent.includes("f.setAttribute('sandbox'"), false);
  assert.strictEqual(appContent.includes("iframe.setAttribute('sandbox'"), false);
  assert.ok(appContent.includes("f.removeAttribute('sandbox')"));
  assert.ok(appContent.includes("iframe.removeAttribute('sandbox')"));
});

test('Both playEmbed and switchPlayerServer apply credentialless and exact allow attribute', () => {
  const expectedAllow = 'allow="autoplay; fullscreen; encrypted-media; picture-in-picture; window-management \'none\'"';
  assert.ok(appContent.includes("f.setAttribute('allow', \"autoplay; fullscreen; encrypted-media; picture-in-picture; window-management 'none'\")"));
  assert.ok(appContent.includes("iframe.setAttribute('allow', \"autoplay; fullscreen; encrypted-media; picture-in-picture; window-management 'none'\")"));
  assert.ok(appContent.includes("f.setAttribute('credentialless', '')"));
  assert.ok(appContent.includes("iframe.setAttribute('credentialless', '')"));
});

test('Both playEmbed and switchPlayerServer enforce z-index: 1 on iframe', () => {
  assert.ok(appContent.includes("f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;z-index:1';"));
  assert.ok(appContent.includes("iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;z-index:1';"));
});

console.log('\n--- 3. HIGH-FREQUENCY FOCUS TRAP (BLOCK POP-UNDERS) ---');

test('Hidden button pFocusTrap exists in index.html outside player iframe', () => {
  assert.ok(htmlContent.includes('<button id="pFocusTrap"'));
  assert.ok(htmlContent.includes('tabindex="-1"'));
  assert.ok(htmlContent.includes('aria-hidden="true"'));
});

test('Global window blur listener immediately blurs iframe, focuses trap, and calls window.focus() immediately and at 50ms', () => {
  assert.ok(appContent.includes("document.activeElement === iframe"));
  assert.ok(appContent.includes("iframe.blur()"));
  assert.ok(appContent.includes("trap.focus()"));
  assert.ok(appContent.includes("window.focus()"));
  assert.ok(appContent.includes("setTimeout(() => {"));
  assert.ok(appContent.includes("50);"));
});

console.log('\n--- 4. BEFOREUNLOAD REDIRECT LOCK (BLOCK TOP-WINDOW HIJACKING) ---');

test('Outer player container attaches mouseenter, mouseleave, touchstart, touchend', () => {
  assert.ok(appContent.includes("_pvHover.addEventListener('mouseenter'"));
  assert.ok(appContent.includes("_pvHover.addEventListener('mouseleave'"));
  assert.ok(appContent.includes("_pvHover.addEventListener('touchstart'"));
  assert.ok(appContent.includes("_pvHover.addEventListener('touchend'"));
});

test('beforeunload interceptor active ONLY while user mouse or touch is interacting with player container', () => {
  assert.ok(appContent.includes("if (_playerHovered && $('playerView')?.classList.contains('show') && !_allowNavigation)"));
  assert.ok(appContent.includes("e.preventDefault()"));
});

console.log('\n--- 5. SMART 1.5s CLICK-SHIELD OVERLAY (PC & MOBILE) ---');

test('vidShield styled with position: absolute; inset: 0; z-index: 20 directly over iframe', () => {
  assert.ok(cssContent.includes("#vidShield"));
  assert.ok(cssContent.includes("z-index: 20;"));
  assert.ok(appContent.includes("shield.style.zIndex = '20';"));
});

test('armVidShield leaves shield inactive on load/server switch and arms 1.5s countdown', () => {
  assert.ok(appContent.includes("_firstClickDone = false;"));
  assert.ok(appContent.includes("clearTimeout(_shieldActivateTimer)"));
  assert.ok(appContent.includes("_shieldActivateTimer = setTimeout(() => {"));
  assert.ok(appContent.includes("1500"));
  assert.ok(appContent.includes("activateVidShield()"));
});

test('Floating action buttons in player corner styled with z-index: 30', () => {
  assert.ok(htmlContent.includes('id="pShieldControls"'));
  assert.ok(htmlContent.includes('id="pUnlockShieldBtn"'));
  assert.ok(htmlContent.includes('Unlock Controls (3s)'));
  assert.ok(htmlContent.includes('id="pFullscreenShieldBtn"'));
  assert.ok(htmlContent.includes('Fullscreen'));
  assert.ok(cssContent.includes(".p-shield-controls"));
  assert.ok(cssContent.includes("z-index: 30;"));
});

test('Unlock Controls (3s) temporarily disables pointer-events with countdown then re-locks', () => {
  assert.ok(appContent.includes("function disarmVidShield(seconds)"));
  assert.ok(appContent.includes("shield.style.pointerEvents = 'none'"));
  assert.ok(appContent.includes("Unlocked (${remaining}s)"));
  assert.ok(appContent.includes("activateVidShield()"));
});

test('Fullscreen button invokes requestFullscreen and webkitRequestFullscreen on outer player container', () => {
  assert.ok(appContent.includes("function togglePlayerWrapperFullscreen()"));
  assert.ok(appContent.includes("pv.requestFullscreen()"));
  assert.ok(appContent.includes("pv.webkitRequestFullscreen()"));
  assert.ok(appContent.includes("pFullscreenShieldBtn.onclick"));
});

console.log(`\n========================================`);
console.log(`Non-Sandbox AdBlock Shield Tests: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
