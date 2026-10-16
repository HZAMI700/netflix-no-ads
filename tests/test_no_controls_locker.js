'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const guardContent = fs.readFileSync(path.join(ROOT, 'services', 'aetherly-embed-guard.js'), 'utf8');

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

console.log('--- 1. CONTROLS LOCKER REMOVED (NATIVE CONTROLS ALWAYS INTERACTIVE) ---');

test('vidShield has pointer-events: none !important in styles.css to prevent blocking controls', () => {
  assert.ok(cssContent.includes('#vidShield'));
  assert.ok(cssContent.includes('.aetherly-shield-overlay'));
  assert.ok(cssContent.includes('pointer-events: none !important;'));
});

test('p-control-zone-sensor has pointer-events: none !important in styles.css so bottom controls are never blocked', () => {
  assert.ok(cssContent.includes('.p-control-zone-sensor'));
  const sensorBlock = cssContent.slice(cssContent.indexOf('.p-control-zone-sensor'), cssContent.indexOf('.p-control-zone-sensor') + 200);
  assert.ok(sensorBlock.includes('pointer-events: none !important;'));
  assert.ok(sensorBlock.includes('display: none !important;'));
});

test('activateVidShield sets shield.style.pointerEvents = "none" so controls are never locked', () => {
  const actIdx = appContent.indexOf('function activateVidShield()');
  const actBlock = appContent.slice(actIdx, actIdx + 1200);
  assert.ok(actBlock.includes("shield.style.pointerEvents = 'none'"));
  assert.ok(actBlock.includes("_shieldActive = false"));
});

test('activateShield in AetherlyEmbedGuard keeps shield.style.pointerEvents = "none"', () => {
  const actIdx = guardContent.indexOf('activateShield()');
  const actBlock = guardContent.slice(actIdx, actIdx + 1200);
  assert.ok(actBlock.includes("shield.style.pointerEvents = 'none'"));
  assert.ok(actBlock.includes("this._shieldActive = false"));
});

console.log('\n--- 2. INTERACT / UNLOCK BUTTON PERMANENTLY HIDDEN ---');

test('pUnlockShieldBtn has display:none !important in index.html', () => {
  assert.ok(htmlContent.includes('id="pUnlockShieldBtn"'));
  const btnIdx = htmlContent.indexOf('id="pUnlockShieldBtn"');
  const btnTag = htmlContent.slice(btnIdx, btnIdx + 200);
  assert.ok(btnTag.includes('display:none !important'));
});

test('pUnlockShieldBtn and .aetherly-interact-btn are hidden in styles.css', () => {
  assert.ok(cssContent.includes('#pUnlockShieldBtn'));
  assert.ok(cssContent.includes('.aetherly-interact-btn'));
  const btnIdx = cssContent.indexOf('#pUnlockShieldBtn');
  const btnBlock = cssContent.slice(btnIdx, btnIdx + 150);
  assert.ok(btnBlock.includes('display: none !important;'));
  assert.ok(btnBlock.includes('pointer-events: none !important;'));
});

test('app.js hides pUnlockShieldBtn on activation and setup', () => {
  assert.ok(appContent.includes("if (unlockBtn) unlockBtn.style.display = 'none'"));
  assert.ok(appContent.includes("pUnlockShieldBtn.style.display = 'none'"));
});

console.log('\n--- 3. POP-UNDER AD BLOCKING FULLY PRESERVED ---');

test('High-speed focus guard blurs iframe and refocuses trap immediately on blur', () => {
  assert.ok(appContent.includes("iframe.blur()"));
  assert.ok(appContent.includes("trap.focus()"));
  assert.ok(appContent.includes("window.focus()"));
});

test('Pop-under multi-popup killer snaps focus at 50ms and 60ms', () => {
  assert.ok(appContent.includes("50);"));
  assert.ok(appContent.includes("60);"));
});

test('Redirect lock beforeunload active during playback interaction', () => {
  assert.ok(appContent.includes("window.addEventListener('beforeunload'"));
  assert.ok(appContent.includes("e.preventDefault()"));
});

test('Top-level window.open and self.open popup interception active', () => {
  assert.ok(appContent.includes("const _nativeWindowOpen = window.open;"));
  assert.ok(appContent.includes("Blocked unauthorized window.open popup attempt"));
});

test('Iframe retains credentialless and strict permissions policy without sandbox', () => {
  assert.ok(appContent.includes("f.setAttribute('credentialless', '')"));
  assert.ok(appContent.includes("f.setAttribute('allow', \"autoplay; fullscreen; encrypted-media; window-management 'none'\")"));
  assert.strictEqual(appContent.includes("f.setAttribute('sandbox'"), false);
});

console.log(`\n========================================`);
console.log(`No Controls Locker Verification: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
