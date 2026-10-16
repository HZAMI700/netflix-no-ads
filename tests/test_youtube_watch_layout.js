'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    failed++;
  }
}

console.log('--- 1. PROMINENT PLAY BUTTON AT THE TOP ---');
test('index.html contains watch-player-wrap and watch-preview-overlay', () => {
  assert.ok(htmlContent.includes('id="watchPlayerWrap"'));
  assert.ok(htmlContent.includes('id="watchPreviewOverlay"'));
});

test('index.html contains prominent play button dTopPlayBtn and dTopPlayLabel', () => {
  assert.ok(htmlContent.includes('id="dTopPlayBtn"'));
  assert.ok(htmlContent.includes('id="dTopPlayLabel"'));
});

test('styles.css centers watch-prominent-play-btn with high-contrast styling', () => {
  assert.ok(cssContent.includes('.watch-prominent-play-btn'));
  assert.ok(cssContent.includes('top: 50%'));
  assert.ok(cssContent.includes('left: 50%'));
  assert.ok(cssContent.includes('transform: translate(-50%, -50%)'));
  assert.ok(cssContent.includes('.watch-play-circle'));
});

test('app.js wires dTopPlayBtn to playStream() and sets dynamic label', () => {
  assert.ok(appContent.includes("topPlayBtn.onclick = (e) =>"));
  assert.ok(appContent.includes("playStream()"));
  assert.ok(appContent.includes("playActionLabel = '▶ Play Movie'"));
  assert.ok(appContent.includes("playActionLabel = '▶ Watch Series'"));
  assert.ok(appContent.includes("playActionLabel = '▶ Watch Anime'"));
});

test('openPlayerShell hides watchPreviewOverlay and closePlayer restores it', () => {
  assert.ok(appContent.includes("$('watchPreviewOverlay')"));
  assert.ok(appContent.includes("overlay.style.display = 'none'"));
  assert.ok(appContent.includes("overlay.style.display = ''"));
});

console.log('\n--- 2. DESKTOP YOUTUBE-STYLE 2-COLUMN WATCH PAGE LAYOUT ---');
test('index.html defines yt-watch-grid with main and sidebar columns', () => {
  assert.ok(htmlContent.includes('class="yt-watch-grid"'));
  assert.ok(htmlContent.includes('class="yt-main-col"'));
  assert.ok(htmlContent.includes('class="yt-sidebar-col"'));
});

test('styles.css styles yt-watch-grid with 70/30 split and 16:9 player wrap', () => {
  assert.ok(cssContent.includes('.yt-watch-grid'));
  assert.ok(cssContent.includes('grid-template-columns: minmax(0, 7fr) minmax(320px, 3fr)'));
  assert.ok(cssContent.includes('.watch-player-wrap'));
  assert.ok(cssContent.includes('aspect-ratio: 16 / 9'));
});

test('Left column contains Title, Action Bar, Server Switcher, and Description Card', () => {
  assert.ok(htmlContent.includes('class="yt-watch-title" id="dTitle"'));
  assert.ok(htmlContent.includes('class="yt-action-bar"'));
  assert.ok(htmlContent.includes('id="ytServerSwitcherBar"'));
  assert.ok(htmlContent.includes('id="ytDescCard"'));
});

test('Server Switcher has Vid API, NHD API, Backup Server, and Force Next button', () => {
  assert.ok(htmlContent.includes('id="ytServerVidapi"'));
  assert.ok(htmlContent.includes('id="ytServerNhdapi"'));
  assert.ok(htmlContent.includes('id="ytServerBackup"'));
  assert.ok(htmlContent.includes('id="ytForceNextServer"'));
});

test('app.js wires all server switcher pills and toggle', () => {
  assert.ok(appContent.includes("switchPlayerServer('server1')"));
  assert.ok(appContent.includes("switchPlayerServer('server2')"));
  assert.ok(appContent.includes("switchPlayerServer('backup')"));
  assert.ok(appContent.includes("togglePlayerServer()"));
});

test('updatePlayerServerUI synchronizes server switcher pills active state', () => {
  assert.ok(appContent.includes("pillVid.classList.toggle('active'"));
  assert.ok(appContent.includes("pillNhd.classList.toggle('active'"));
  assert.ok(appContent.includes("pillBackup.classList.toggle('active'"));
});

test('switchPlayerServer and togglePlayerServer support backup server', () => {
  assert.ok(appContent.includes("currentPlayerServer = 'backup'"));
  assert.ok(appContent.includes("Watching Server: Backup Stream Mirror"));
});

test('Description Card contains expandable synopsis, credits, and toggle button', () => {
  assert.ok(htmlContent.includes('id="ytDescToggle"'));
  assert.ok(htmlContent.includes('id="ytDescToggleText"'));
  assert.ok(htmlContent.includes('id="ytDescExtended"'));
  assert.ok(appContent.includes("descCard.classList.toggle('expanded')"));
});

test('Right sidebar contains Episodes Playlist Card and Up Next Recommendations', () => {
  assert.ok(htmlContent.includes('class="yt-playlist-card" id="epWrap"'));
  assert.ok(htmlContent.includes('id="ytPlaylistHeading"'));
  assert.ok(htmlContent.includes('id="seasonSel"'));
  assert.ok(htmlContent.includes('id="epList"'));
  assert.ok(htmlContent.includes('class="similar-grid yt-recs-feed" id="simGrid"'));
});

test('renderDetailRecommendations renders up to 10 compact horizontal cards with 16:9 thumbnail and fallback', () => {
  assert.ok(appContent.includes(".slice(0, 10)"));
  assert.ok(appContent.includes("createPosterFallback(s.name || s.title"));
  assert.ok(appContent.includes("true")); // 16:9 landscape fallback flag
});

console.log('\n--- 3. MOBILE & TABLET YOUTUBE APP LAYOUT ---');
test('styles.css configures sticky top video player at <= 900px', () => {
  const mobileMedia = cssContent.slice(cssContent.indexOf('@media (max-width: 900px)'));
  assert.ok(mobileMedia.includes('.watch-player-wrap'));
  assert.ok(mobileMedia.includes('position: sticky'));
  assert.ok(mobileMedia.includes('top: 0'));
  assert.ok(mobileMedia.includes('z-index: 100'));
});

test('styles.css configures horizontally scrollable server bar for mobile', () => {
  const mobileMedia = cssContent.slice(cssContent.indexOf('@media (max-width: 900px)'));
  assert.ok(mobileMedia.includes('.yt-server-switcher-bar'));
  assert.ok(mobileMedia.includes('overflow-x: auto'));
});

console.log(`\n========================================`);
console.log(`YouTube Watch Layout Tests: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
