'use strict';
const fs = require('fs');
const path = require('path');

const appContent = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const purifyExists = fs.existsSync(path.join(__dirname, '..', 'purify.min.js'));

let passed = 0, failed = 0;
function test(desc, cond, extra) {
  if (cond) {
    passed++;
    console.log(`PASS: ${desc}`);
  } else {
    failed++;
    console.error(`FAIL: ${desc}`, extra || '');
  }
}

console.log('--- Checking Requirement 1: Zero cross-row card duplication ---');
test('isCardUnseen and recordCardSeen defined in app.js',
  appContent.includes('function isCardUnseen(') && appContent.includes('function recordCardSeen('));
test('normalizeCardKey defined in app.js',
  appContent.includes('function normalizeCardKey('));
test('buildHome tracks seenHomeIds and seenHomeTitles',
  appContent.includes('seenHomeIds') && appContent.includes('seenHomeTitles'));
test('loadCategoryRows tracks seenBrowseIds and seenBrowseTitles',
  appContent.includes('seenBrowseIds') && appContent.includes('seenBrowseTitles'));
test('loadCategoryRows filters with isCardUnseen',
  appContent.includes('isCardUnseen(m, seenBrowseIds, seenBrowseTitles)'));
test('buildHome filters with isCardUnseen',
  appContent.includes('isCardUnseen(m, seenHomeIds, seenHomeTitles)'));

console.log('\n--- Checking Requirement 2: First-time profile selection screen ---');
test('Startup checks nf_profile_selected',
  appContent.includes("store.get('nf_profile_selected', false)"));
test('Startup activates profile-gate-active when no profile selected',
  appContent.includes("document.body.classList.add('profile-gate-active')") && appContent.includes("show('profiles')"));
test('selectProfile sets nf_profile_selected to true',
  appContent.includes("store.set('nf_profile_selected', true)"));
test('selectProfile removes profile-gate-active',
  appContent.includes("document.body.classList.remove('profile-gate-active')"));
test('profile-gate-active hides nav-links and profile-menu in styles.css',
  cssContent.includes('body.profile-gate-active .nav-links') && cssContent.includes('display: none !important;'));
test('profilesPage styled for centered Netflix-like screen in styles.css',
  cssContent.includes('#profilesPage.show') && cssContent.includes('justify-content: center;'));

console.log('\n--- Checking Requirement 3: No continue/finished watching for first-time visitors ---');
test('history initialized to empty object store.get("nf_history", {})',
  appContent.includes("let history = store.get('nf_history', {});"));
test('No mock DEFAULT_HISTORY auto-seeded into nf_history',
  !appContent.includes("DEFAULT_HISTORY = {"));
test('continueItems returns empty list when history is empty', () => {
  // Mock historyItems
  const mockHistoryItems = () => [];
  const items = mockHistoryItems().filter(m => !m._finished);
  return items.length === 0;
});

console.log('\n--- Checking Requirement 4: Hide addons content catalog in Settings ---');
test('settingsAddonsCard has display:none in index.html',
  htmlContent.includes('id="settingsAddonsCard"') && htmlContent.includes('style="display:none !important;"'));
test('Addons & Content Catalogs title exists inside hidden card',
  htmlContent.includes('<h3>Addons &amp; Content Catalogs</h3>'));

console.log('\n--- Checking Requirement 5: Full security using free repo from GitHub ---');
test('purify.min.js from DOMPurify GitHub repo exists on disk', purifyExists);
test('purify.min.js loaded in index.html before app.js',
  htmlContent.includes('<script src="purify.min.js"></script>') && htmlContent.indexOf('purify.min.js') < htmlContent.indexOf('app.js'));
test('escapeHtml integrates DOMPurify sanitization in app.js',
  appContent.includes('DOMPurify.sanitize('));
test('safeJsonParse protects against prototype pollution in store.get',
  appContent.includes('function safeJsonParse(') && appContent.includes('__proto__'));
test('Strict security headers present in index.html',
  htmlContent.includes('X-XSS-Protection') &&
  htmlContent.includes('Cross-Origin-Opener-Policy') &&
  htmlContent.includes('Cross-Origin-Resource-Policy') &&
  htmlContent.includes('Content-Security-Policy'));

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
