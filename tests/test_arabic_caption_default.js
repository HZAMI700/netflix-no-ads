'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const nhdContent = fs.readFileSync(path.join(ROOT, 'services', 'nhdapi.js'), 'utf8');

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

console.log('--- 1. HTML DEFAULT SELECTION & UI LABELS ---');

test('settingSubLang has Arabic as first option and is selected by default', () => {
  const dom = new JSDOM(htmlContent);
  const select = dom.window.document.getElementById('settingSubLang');
  assert.ok(select, '#settingSubLang must exist');
  assert.strictEqual(select.options[0].value, 'ar');
  assert.strictEqual(select.value, 'ar');
  assert.ok(select.options[0].hasAttribute('selected'));
});

test('captionModalLangSelect has Arabic as first option and is selected by default', () => {
  const dom = new JSDOM(htmlContent);
  const select = dom.window.document.getElementById('captionModalLangSelect');
  assert.ok(select, '#captionModalLangSelect must exist');
  assert.strictEqual(select.options[0].value, 'ar');
  assert.strictEqual(select.value, 'ar');
  assert.ok(select.options[0].hasAttribute('selected'));
});

test('playerCustomSubLangSelect has Arabic as first option and is selected by default', () => {
  const dom = new JSDOM(htmlContent);
  const select = dom.window.document.getElementById('playerCustomSubLangSelect');
  assert.ok(select, '#playerCustomSubLangSelect must exist');
  assert.strictEqual(select.options[0].value, 'ar');
  assert.strictEqual(select.value, 'ar');
  assert.ok(select.options[0].hasAttribute('selected'));
});

test('pBottomCaptionsLabel defaults to Captions: Arabic', () => {
  const dom = new JSDOM(htmlContent);
  const label = dom.window.document.getElementById('pBottomCaptionsLabel');
  assert.ok(label, '#pBottomCaptionsLabel must exist');
  assert.strictEqual(label.textContent.trim(), 'Captions: Arabic');
});

console.log('\n--- 2. APP.JS DEFAULT STATE & STORAGE INITIALIZATION ---');

test('app.js initializes Arabic as default caption and subtitle setting', () => {
  assert.ok(appContent.includes("store.set('nf_sub_lang', 'ar')"));
  assert.ok(appContent.includes("localStorage.setItem('caption', 'ar')"));
  assert.ok(appContent.includes("localStorage.setItem('captions', 'ar')"));
  assert.ok(appContent.includes("localStorage.setItem('cc', '1')"));
  assert.ok(appContent.includes("localStorage.setItem('cc_load_policy', '1')"));
});

test('SUBTITLE_LANGUAGES array puts Arabic first with Default badge', () => {
  const match = appContent.match(/const SUBTITLE_LANGUAGES = \[([\s\S]*?)\];/);
  assert.ok(match, 'SUBTITLE_LANGUAGES array must exist');
  assert.ok(match[1].includes("{ code: 'ar', label: 'Arabic', sub: 'العربية (Default)' }"));
  const firstItem = match[1].trim().split('\n')[0];
  assert.ok(firstItem.includes("'ar'"), 'Arabic must be the first language in the array');
});

console.log('\n--- 3. URL PARAMETERS & CLOSED CAPTION ENFORCEMENT ---');

test('updateSubtitleUrlParam injects full Arabic caption & subtitle parameters', () => {
  assert.ok(appContent.includes("u.searchParams.set('caption', target)"));
  assert.ok(appContent.includes("u.searchParams.set('captions', target)"));
  assert.ok(appContent.includes("u.searchParams.set('caption_lang', target)"));
  assert.ok(appContent.includes("u.searchParams.set('cc', '1')"));
  assert.ok(appContent.includes("u.searchParams.set('cc_load_policy', '1')"));
  assert.ok(appContent.includes("u.searchParams.set('enable_captions', '1')"));
  assert.ok(appContent.includes("u.searchParams.set('default_caption', target)"));
});

console.log('\n--- 4. POSTMESSAGE DISPATCH & EMBED PLAYERS INTEGRATION ---');

test('dispatchSubtitlesToPlayer transmits caption events and active closed captions', () => {
  assert.ok(appContent.includes("f.contentWindow?.postMessage({ type: 'SET_CAPTIONS'"));
  assert.ok(appContent.includes("f.contentWindow?.postMessage({ type: 'SET_CAPTION'"));
  assert.ok(appContent.includes("f.contentWindow?.postMessage({ type: 'setCaption'"));
  assert.ok(appContent.includes("f.contentWindow?.postMessage({ type: 'SET_CC'"));
  assert.ok(appContent.includes("f.contentWindow?.postMessage({ type: 'ENABLE_CAPTIONS'"));
  assert.ok(appContent.includes("f.contentWindow?.postMessage({ type: 'SUBTITLE_SET'"));
});

test('services/nhdapi.js sorts Arabic subtitles first', () => {
  assert.ok(nhdContent.includes("a.lang === 'ar' && b.lang !== 'ar'"));
});

console.log(`\n========================================`);
console.log(`Arabic Caption Default Tests: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
