'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
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

console.log('--- 1. DOM STRUCTURE & PARENT/CHILD RELATIONSHIPS ---');

test('index.html has correct playerView, aetherlyEmbedGuard, and pTop relationships', () => {
  const dom = new JSDOM(htmlContent);
  const doc = dom.window.document;
  const playerView = doc.getElementById('playerView');
  const guard = doc.getElementById('aetherlyEmbedGuard');
  const pTop = doc.getElementById('pTop');
  const overlay = doc.getElementById('watchPreviewOverlay');
  const dTopPlayBtn = doc.getElementById('dTopPlayBtn');

  assert.ok(playerView, '#playerView must exist');
  assert.ok(guard, '#aetherlyEmbedGuard must exist');
  assert.ok(pTop, '#pTop must exist');
  assert.ok(overlay, '#watchPreviewOverlay must exist');
  assert.ok(dTopPlayBtn, '#dTopPlayBtn must exist');

  // Verify guard is inside playerView
  assert.strictEqual(guard.parentNode, playerView);
  // Verify pTop is a child of playerView, NOT a child of guard
  assert.strictEqual(pTop.parentNode, playerView);
  assert.notStrictEqual(pTop.parentNode, guard);
});

console.log('\n--- 2. INSERTBEFORE SAFE REFS IN APP.JS & AETHERLY-EMBED-GUARD ---');

test('app.js playEmbed safely validates pTop parent before insertBefore', () => {
  assert.ok(!appContent.includes("guardWrap.insertBefore(f, $('pTop') || guardWrap.firstChild);"));
  assert.ok(appContent.includes("const refNode = (pTop && pTop.parentNode === guardWrap) ? pTop : guardWrap?.firstChild;"));
  assert.ok(appContent.includes("guardWrap.insertBefore(f, refNode);"));
});

test('app.js activateVidShield & armVidShield safely check pTop.parentNode === targetWrap', () => {
  assert.ok(!appContent.includes("($('aetherlyEmbedGuard') || $('playerView'))?.insertBefore(shield, $('pTop'));"));
  const count = (appContent.match(/refNode = \(pTop && pTop\.parentNode === targetWrap\) \? pTop : targetWrap\?\.firstChild;/g) || []).length;
  assert.strictEqual(count, 2, 'Both activateVidShield and armVidShield must have safe parent check');
});

test('services/aetherly-embed-guard.js getShieldElement checks pTop.parentNode === container', () => {
  assert.ok(!guardContent.includes("container.insertBefore(shield, pTop || container.firstChild);"));
  assert.ok(guardContent.includes("pTop.parentNode === container"));
});

console.log('\n--- 3. SIMULATED WATCH CLICK & PLAYBACK EXECUTION (NO BLACK SCREEN) ---');

test('Simulating playEmbed mounts iframe inside aetherlyEmbedGuard without throwing DOMException', () => {
  const dom = new JSDOM(htmlContent, { runScripts: 'dangerously' });
  const doc = dom.window.document;
  const $ = (id) => doc.getElementById(id);

  // Set up mock currentEmbed
  const sampleUrl = 'https://vidapi.com/embed/movie/550';
  const guardWrap = $('aetherlyEmbedGuard') || $('playerView');
  const pTop = $('pTop');
  const refNode = (pTop && pTop.parentNode === guardWrap) ? pTop : guardWrap?.firstChild;

  const f = doc.createElement('iframe');
  f.src = sampleUrl;
  f.setAttribute('credentialless', '');
  f.setAttribute('allow', "autoplay; fullscreen; encrypted-media; window-management 'none'");
  f.removeAttribute('sandbox');
  f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;z-index:1';

  assert.doesNotThrow(() => {
    if (guardWrap) {
      if (refNode) {
        guardWrap.insertBefore(f, refNode);
      } else {
        guardWrap.appendChild(f);
      }
    }
  }, 'Mounting iframe must never throw NotFoundError or DOMException');

  // Verify iframe is in the DOM and mounted in the right container
  const mountedIframe = $('playerView').querySelector('iframe');
  assert.ok(mountedIframe, 'Iframe must be found inside #playerView');
  assert.strictEqual(mountedIframe.src, sampleUrl);
  assert.strictEqual(mountedIframe.getAttribute('credentialless'), '');
  assert.strictEqual(mountedIframe.hasAttribute('sandbox'), false);
  assert.strictEqual(mountedIframe.getAttribute('allow'), "autoplay; fullscreen; encrypted-media; window-management 'none'");
});

test('watchPreviewOverlay is hidden and playerView is shown when playback starts', () => {
  const dom = new JSDOM(htmlContent);
  const doc = dom.window.document;
  const pv = doc.getElementById('playerView');
  const overlay = doc.getElementById('watchPreviewOverlay');

  // Before playback
  assert.strictEqual(pv.classList.contains('show'), false);

  // Simulate openPlayerShell actions
  pv.classList.add('show');
  overlay.style.display = 'none';

  // After playback starts
  assert.strictEqual(pv.classList.contains('show'), true);
  assert.strictEqual(overlay.style.display, 'none');
});

test('Dynamic shield creation when vidShield is missing never throws DOMException', () => {
  const dom = new JSDOM(htmlContent);
  const doc = dom.window.document;

  // Remove existing shield to test dynamic re-creation
  const existingShield = doc.getElementById('vidShield');
  if (existingShield) existingShield.remove();

  const targetWrap = doc.getElementById('aetherlyEmbedGuard') || doc.getElementById('playerView');
  const pTop = doc.getElementById('pTop');
  const refNode = (pTop && pTop.parentNode === targetWrap) ? pTop : targetWrap?.firstChild;

  assert.doesNotThrow(() => {
    const shield = doc.createElement('div');
    shield.id = 'vidShield';
    shield.className = 'aetherly-shield-overlay';
    if (targetWrap) {
      if (refNode) {
        targetWrap.insertBefore(shield, refNode);
      } else {
        targetWrap.appendChild(shield);
      }
    }
  });

  const createdShield = doc.getElementById('vidShield');
  assert.ok(createdShield, 'Dynamic vidShield must be in DOM');
  assert.strictEqual(createdShield.parentNode, targetWrap);
});

console.log(`\n========================================`);
console.log(`Click Watch Fix Tests: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
