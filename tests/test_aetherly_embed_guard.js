'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const guardContent = fs.readFileSync(path.join(ROOT, 'services', 'aetherly-embed-guard.js'), 'utf8');
const AetherlyEmbedGuard = require(path.join(ROOT, 'services', 'aetherly-embed-guard.js'));

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

console.log('--- 1. AETHERLY-EMBED-GUARD WRAPPER COMPONENT ---');

test('index.html contains AetherlyEmbedGuard wrapper around player iframe', () => {
  assert.ok(htmlContent.includes('class="aetherly-embed-guard"'));
  assert.ok(htmlContent.includes('id="aetherlyEmbedGuard"'));
  assert.ok(htmlContent.includes('class="aetherly-embed-guard-wrapper"'));
});

test('index.html loads services/aetherly-embed-guard.js before app.js', () => {
  assert.ok(htmlContent.includes('<script src="services/aetherly-embed-guard.js"></script>'));
  const guardIdx = htmlContent.indexOf('services/aetherly-embed-guard.js');
  const appIdx = htmlContent.indexOf('app.js');
  assert.ok(guardIdx > 0 && guardIdx < appIdx);
});

test('AetherlyEmbedGuard service is exported and exposes core API', () => {
  assert.strictEqual(typeof AetherlyEmbedGuard, 'object');
  assert.strictEqual(typeof AetherlyEmbedGuard.configureIframe, 'function');
  assert.strictEqual(typeof AetherlyEmbedGuard.activateShield, 'function');
  assert.strictEqual(typeof AetherlyEmbedGuard.disarmShield, 'function');
  assert.strictEqual(typeof AetherlyEmbedGuard.interact, 'function');
  assert.strictEqual(typeof AetherlyEmbedGuard.toggleFullscreen, 'function');
  assert.strictEqual(typeof AetherlyEmbedGuard.handleWindowBlur, 'function');
  assert.strictEqual(AetherlyEmbedGuard.SHIELD_Z_INDEX, 10);
  assert.strictEqual(AetherlyEmbedGuard.CONTROLS_Z_INDEX, 20);
  assert.strictEqual(AetherlyEmbedGuard.SHIELD_AUTO_ACTIVATE_DELAY, 1200);
  assert.strictEqual(AetherlyEmbedGuard.FOCUS_SNAP_DELAY, 60);
});

test('styles.css styles .aetherly-embed-guard wrapper component', () => {
  assert.ok(cssContent.includes('.aetherly-embed-guard'));
  assert.ok(cssContent.includes('.aetherly-embed-guard-wrapper'));
});

console.log('\n--- 2. IFRAME CONFIGURATION (CREDENTIALLESS, ALLOW POLICY & NO SANDBOX) ---');

test('Iframe configured with credentialless attribute in app.js and AetherlyEmbedGuard', () => {
  assert.ok(appContent.includes("f.setAttribute('credentialless', '')"));
  assert.ok(appContent.includes("iframe.setAttribute('credentialless', '')"));
  assert.ok(guardContent.includes("iframe.setAttribute('credentialless', '')"));
});

test('Iframe configured with allow="autoplay; fullscreen; encrypted-media; window-management \'none\'"', () => {
  assert.ok(appContent.includes("f.setAttribute('allow', \"autoplay; fullscreen; encrypted-media; window-management 'none'\")"));
  assert.ok(appContent.includes("iframe.setAttribute('allow', \"autoplay; fullscreen; encrypted-media; window-management 'none'\")"));
  assert.ok(guardContent.includes("ALLOW_POLICY: \"autoplay; fullscreen; encrypted-media; window-management 'none'\""));
});

test('Strict rule: NO sandbox attribute is applied to iframe in app.js or guard', () => {
  assert.strictEqual(appContent.includes("f.setAttribute('sandbox'"), false);
  assert.strictEqual(appContent.includes("iframe.setAttribute('sandbox'"), false);
  assert.strictEqual(guardContent.includes("iframe.setAttribute('sandbox'"), false);
  assert.ok(appContent.includes("f.removeAttribute('sandbox')"));
  assert.ok(appContent.includes("iframe.removeAttribute('sandbox')"));
  assert.ok(guardContent.includes("iframe.removeAttribute('sandbox')"));
});

console.log('\n--- 3. LAYER 1: CLICK SHIELD OVERLAY (1200ms AUTO-ACTIVATE & Z-INDEX: 10) ---');

test('Initial state allows initial click to pass through (pointer-events: none)', () => {
  assert.ok(appContent.includes("shield.style.pointerEvents = 'none'"));
  assert.ok(guardContent.includes("shield.style.pointerEvents = 'none'"));
});

test('Automatically activates transparent shield with z-index: 10 after 1200ms on window blur to iframe', () => {
  assert.ok(appContent.includes("1200"));
  assert.ok(appContent.includes("shield.style.zIndex = '10'"));
  assert.ok(guardContent.includes("1200"));
  assert.ok(guardContent.includes("this.SHIELD_Z_INDEX"));
  assert.ok(cssContent.includes(".aetherly-shield-overlay"));
  assert.ok(cssContent.includes("z-index: 10;"));
});

console.log('\n--- 4. LAYER 2: HIGH-SPEED FOCUS GUARD (60ms MULTI-POPUP KILLER) ---');

test('On window blur to iframe, immediately triggers iframe.blur() and refocuses hidden guard button', () => {
  assert.ok(appContent.includes("iframe.blur()"));
  assert.ok(appContent.includes("trap.focus()"));
  assert.ok(guardContent.includes("iframe.blur()"));
  assert.ok(guardContent.includes("guardBtn.focus()"));
});

test('Triggers hidden guard button refocus + window.focus() after 60ms to kill popup chains', () => {
  assert.ok(appContent.includes("60);"));
  assert.ok(appContent.includes("FOCUS_SNAP_DELAY") || guardContent.includes("60"));
  assert.ok(htmlContent.includes('class="aetherly-focus-guard"'));
});

console.log('\n--- 5. LAYER 3: REDIRECT / TAB-UNDER LOCK (BEFOREUNLOAD POINTER LOCK) ---');

test('Pointer inside guard wrapper triggers mouseenter and mouseleave tracking', () => {
  assert.ok(appContent.includes("_pvHover.addEventListener('mouseenter'"));
  assert.ok(appContent.includes("_pvHover.addEventListener('mouseleave'"));
  assert.ok(appContent.includes("_guardPointerInside = true"));
  assert.ok(appContent.includes("_guardPointerInside = false"));
});

test('beforeunload listener cancels main window redirect while pointer is inside guard wrapper', () => {
  assert.ok(appContent.includes("window.addEventListener('beforeunload'"));
  assert.ok(appContent.includes("e.preventDefault()"));
  assert.ok(appContent.includes("e.returnValue = ''"));
});

console.log('\n--- 6. LAYER 4: SAFE FLOATING CONTROLS (Z-INDEX: 20, FULLSCREEN & 3s INTERACT) ---');

test('Floating controls styled with z-index: 20 in styles.css and app.js', () => {
  assert.ok(cssContent.includes(".aetherly-floating-controls"));
  assert.ok(cssContent.includes("z-index: 20;"));
  assert.ok(appContent.includes("controls.style.zIndex = '20'"));
  assert.ok(guardContent.includes("this.CONTROLS_Z_INDEX"));
});

test('Fullscreen button calls requestFullscreen on aetherly-embed-guard container', () => {
  assert.ok(htmlContent.includes('id="pFullscreenShieldBtn"'));
  assert.ok(htmlContent.includes('⛶'));
  assert.ok(appContent.includes("document.querySelector('.aetherly-embed-guard') || $('aetherlyEmbedGuard')"));
  assert.ok(appContent.includes("pv.requestFullscreen()"));
  assert.ok(guardContent.includes("container.requestFullscreen()"));
});

test('Interact (3s) button temporarily disables shield for 3 seconds', () => {
  assert.ok(htmlContent.includes('id="pUnlockShieldBtn"'));
  assert.ok(htmlContent.includes('Interact (3s)'));
  assert.ok(htmlContent.includes('🔓'));
  assert.ok(appContent.includes("disarmVidShield(3)"));
  assert.ok(appContent.includes("AetherlyEmbedGuard.interact(3)"));
  assert.ok(guardContent.includes("disarmShield(seconds = 3)"));
});

console.log(`\n========================================`);
console.log(`AetherlyEmbedGuard Tests: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
