'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
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

console.log('--- 1. VIEWPORT META & HORIZONTAL OVERFLOW PREVENTION ---');

test('Viewport meta tag specifies width=device-width, initial-scale=1.0, and viewport-fit=cover', () => {
  assert.ok(htmlContent.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">'));
});

test('Universal mobile viewport rules prevent horizontal scrolling on html and body', () => {
  assert.ok(cssContent.includes('html {'));
  assert.ok(cssContent.includes('overflow-x: hidden;'));
  assert.ok(cssContent.includes('width: 100%;'));
  assert.ok(cssContent.includes('max-width: 100vw;'));
  assert.ok(cssContent.includes('touch-action: manipulation;'));
});

console.log('\n--- 2. FORM CONTROLS & IOS SAFARI AUTO-ZOOM PREVENTION ---');

test('Mobile form inputs and selects enforce 16px font-size to prevent iOS auto-zoom', () => {
  const formBlock = cssContent.slice(cssContent.indexOf('/* Form controls: prevent iOS Safari auto-zoom'));
  assert.ok(formBlock.includes('input,'));
  assert.ok(formBlock.includes('select,'));
  assert.ok(formBlock.includes('font-size: 16px !important;'));
});

console.log('\n--- 3. MOBILE NAVIGATION, SEARCH & BROWSE DROPDOWNS ---');

test('Mobile searchWrap and searchDropdown are responsive and bounded to viewport', () => {
  assert.ok(cssContent.includes('#searchWrap.open {'));
  assert.ok(cssContent.includes('.search-dropdown {'));
  assert.ok(cssContent.includes('max-width: calc(100vw - 20px)'));
});

test('Mobile browse menu links provide comfortable touch targets >= 44px', () => {
  const browseBlock = cssContent.slice(cssContent.indexOf('.browse-menu a {'));
  assert.ok(browseBlock.includes('min-height: 44px'));
});

console.log('\n--- 4. MOBILE HERO BANNER & BUTTON WRAPPING ---');

test('Hero buttons wrap cleanly with full-width primary Play and 50/50 secondary buttons', () => {
  assert.ok(cssContent.includes('.hero-btns .btn-play {'));
  assert.ok(cssContent.includes('flex: 1 1 100%;'));
  assert.ok(cssContent.includes('.hero-btns .btn-info {'));
  assert.ok(cssContent.includes('flex: 1 1 calc(50% - 4px);'));
});

console.log('\n--- 5. CARD HOVER SUPPRESSION ON TOUCH SCREENS ---');

test('Desktop card hover portal is disabled on touch screens and mobile viewports', () => {
  const portalBlock = cssContent.slice(cssContent.indexOf('/* Touch screens & mobile: disable desktop card hover expansion popup */'));
  assert.ok(portalBlock.includes('@media (hover: none), (max-width: 768px)'));
  assert.ok(portalBlock.includes('#cardPortal {'));
  assert.ok(portalBlock.includes('display: none !important;'));
});

console.log('\n--- 6. SEARCH FACETS, MODALS & SAFE AREA INSETS ---');

test('Search facet filter bar supports horizontal touch-momentum scrolling on mobile', () => {
  const searchFilterBlock = cssContent.slice(cssContent.indexOf('.search-filter-bar {'));
  assert.ok(searchFilterBlock.includes('-webkit-overflow-scrolling: touch'));
  assert.ok(searchFilterBlock.includes('overflow-x: auto'));
});

test('Modals and backdrops respect safe-area insets and are bounded to viewport height', () => {
  assert.ok(cssContent.includes('env(safe-area-inset-top'));
  assert.ok(cssContent.includes('env(safe-area-inset-bottom'));
  assert.ok(cssContent.includes('max-height: calc(100dvh - 24px) !important;'));
});

test('Mobile landscape orientation mode optimizes player view height', () => {
  assert.ok(cssContent.includes('@media (max-height: 520px) and (orientation: landscape)'));
  assert.ok(cssContent.includes('max-height: 90vh;'));
});

console.log(`\n========================================`);
console.log(`Mobile Responsiveness Audit: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
