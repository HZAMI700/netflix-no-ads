'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
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

console.log('--- 1. MOBILE DETECTION & ENVIRONMENT AWARENESS ---');

test('app.js defines isMobileDevice helper detecting UA, touch, and viewport width', () => {
  assert.ok(appContent.includes('function isMobileDevice()'));
  assert.ok(appContent.includes('/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i'));
  assert.ok(appContent.includes('maxTouchPoints'));
  assert.ok(appContent.includes('innerWidth <= 820'));
});

test('AetherlyEmbedGuard exposes isMobile method for mobile-specific defense', () => {
  assert.strictEqual(typeof AetherlyEmbedGuard.isMobile, 'function');
});

console.log('\n--- 2. MOBILE REDIRECT ANNIHILATION (WINDOW.STOP & BEFOREUNLOAD) ---');

test('beforeunload listener invokes window.stop() on mobile when playerView is active', () => {
  assert.ok(appContent.includes("isMobile && $('playerView')?.classList.contains('show')"));
  assert.ok(appContent.includes('try { window.stop(); } catch {}'));
});

test('pagehide listener invokes window.stop() on mobile to halt background redirects', () => {
  assert.ok(appContent.includes("window.addEventListener('pagehide'"));
  assert.ok(appContent.includes('if (isMobile && playerOpen && !_allowNavigation)'));
});

test('mobile redirect annihilation preserves media stream without calling window.stop on blur', () => {
  assert.ok(appContent.includes('const isMobile = isMobileDevice()'));
  assert.ok(guardContent.includes('this.isMobile()'));
  assert.ok(appContent.includes("window.addEventListener('beforeunload'"));
  assert.ok(appContent.includes("window.addEventListener('pagehide'"));
});

console.log('\n--- 3. MOBILE HISTORY & BACK-BUTTON SHIELD (ANTI-POISONING) ---');

test('popstate listener prevents rogue external redirects on mobile while player is active', () => {
  assert.ok(appContent.includes("window.addEventListener('popstate'"));
  assert.ok(appContent.includes('history.pushState({ streamnaroPlayer: true }'));
});

test('openPlayerShell initializes mobile history state on mobile devices', () => {
  assert.ok(appContent.includes("if (typeof isMobileDevice === 'function' && isMobileDevice())"));
  assert.ok(appContent.includes('_playerHovered = true;'));
  assert.ok(appContent.includes('window.history.pushState({ streamnaroPlayer: true }'));
});

console.log('\n--- 4. MOBILE DEEP LINK & SCHEME INTERCEPTION ---');

test('Global capture intercepts intent:// and app store schemes on mobile', () => {
  assert.ok(appContent.includes('/^(intent|market|itms-apps|itms|appstore|vnd\\.youtube):/i'));
  assert.ok(appContent.includes('Blocked mobile app scheme intent'));
});

test('Location assign and replace prototype overrides block rogue embed redirects', () => {
  assert.ok(appContent.includes('Location.prototype.assign'));
  assert.ok(appContent.includes('Location.prototype.replace'));
  assert.ok(appContent.includes('Blocked rogue location.assign redirect'));
  assert.ok(appContent.includes('Blocked rogue location.replace redirect'));
});

console.log('\n--- 5. MOBILE TOUCH ARMOR & PLAY COMMAND DISPATCH ---');

test('Global touch listener captures touchstart and pointerdown on mobile', () => {
  assert.ok(appContent.includes("['touchstart', 'pointerdown'].forEach(evt => {"));
  assert.ok(appContent.includes('if (!isMobileDevice()) return;'));
  assert.ok(appContent.includes('dispatchMobilePlayCommand();'));
});

test('dispatchMobilePlayCommand sends universal postMessage play events', () => {
  assert.ok(appContent.includes('function dispatchMobilePlayCommand()'));
  assert.ok(appContent.includes("PLAYER_CONTROL"));
  assert.ok(appContent.includes("playVideo"));
});

console.log('\n--- 6. PC BEHAVIOR & CONTROLS INVARIANTS PRESERVED ---');

test('Strict rule: NO sandbox attribute is added to player iframe', () => {
  assert.strictEqual(appContent.includes("f.setAttribute('sandbox'"), false);
  assert.strictEqual(appContent.includes("iframe.setAttribute('sandbox'"), false);
  assert.strictEqual(guardContent.includes("iframe.setAttribute('sandbox'"), false);
});

test('Controls locker remains removed and native controls remain clickable', () => {
  assert.ok(appContent.includes("shield.style.pointerEvents = 'none'"));
  assert.ok(guardContent.includes("shield.style.pointerEvents = 'none'"));
  assert.ok(appContent.includes("_shieldActive = false"));
});

console.log(`\n========================================`);
console.log(`Mobile Pop-under Blocker Tests: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
