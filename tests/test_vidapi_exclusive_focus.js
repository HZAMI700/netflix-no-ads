'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appContent = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
global.CuratedCatalog = require(path.join(ROOT, 'services', 'curated-catalog.js'));
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

console.log('--- 1. EXCLUSIVELY KEEP VIDAPI & HIDE OTHER SERVERS IN UI ---');

test('ytServerVidapi is active and visible in index.html', () => {
  assert.ok(htmlContent.includes('id="ytServerVidapi"'));
  assert.ok(htmlContent.includes('class="yt-server-pill active" id="ytServerVidapi"'));
  assert.ok(htmlContent.includes('id="statusDotVid"'));
});

test('Other server buttons (NHD API, 2Embed, Backup, Force Next) are hidden in index.html with inline display:none !important', () => {
  assert.ok(htmlContent.includes('id="ytServerNhdapi" data-server="server2" title="NHD API (Server 2: Fast Mirror Stream)" style="display:none !important;"'));
  assert.ok(htmlContent.includes('id="ytServer2embed" data-server="2embed" title="2Embed (Auto-Failover Multi-Stream Mirror)" style="display:none !important;"'));
  assert.ok(htmlContent.includes('id="ytServerBackup" data-server="backup" title="Backup Stream Mirrors" style="display:none !important;"'));
  assert.ok(htmlContent.includes('id="ytForceNextServer" title="Try Next Server (Auto-Failover)" style="display:none !important;"'));
});

test('styles.css explicitly enforces display: none !important on other servers', () => {
  assert.ok(cssContent.includes('#ytServerNhdapi'));
  assert.ok(cssContent.includes('#ytServer2embed'));
  assert.ok(cssContent.includes('#ytServerBackup'));
  assert.ok(cssContent.includes('#ytForceNextServer'));
  const cssSection = cssContent.slice(cssContent.indexOf('#ytServerNhdapi'));
  assert.ok(cssSection.includes('display: none !important;'));
});

test('Settings modal dropdown playerServerSelect hides secondary server options', () => {
  assert.ok(htmlContent.includes('<option value="server1" selected>Server 1: High Definition Stream</option>'));
  assert.ok(htmlContent.includes('<option value="server2" data-alias="Server 2: Fast Mirror Stream" style="display:none !important;">Ultra HD Fast Server</option>'));
});

console.log('\n--- 2. APP.JS SERVER STATE & UI SYNCHRONIZATION ---');

test('currentPlayerServer defaults to server1 (VidAPI)', () => {
  assert.ok(appContent.includes("currentPlayerServer = 'server1'"));
  assert.ok(appContent.includes("store.set('nf_player_server', 'server1')"));
});

test('updatePlayerServerUI keeps VidAPI active and explicitly hides other server pills', () => {
  assert.ok(appContent.includes("pillVid.classList.toggle('active', currentPlayerServer === 'server1')"));
  assert.ok(appContent.includes("pillVid.style.display = 'inline-flex'"));
  assert.ok(appContent.includes("pillNhd.style.display = 'none'"));
  assert.ok(appContent.includes("pill2embed.style.display = 'none'"));
  assert.ok(appContent.includes("pillBackup.style.display = 'none'"));
  assert.ok(appContent.includes("forceBtn.style.display = 'none'"));
});

console.log('\n--- 3. HIGH FOCUSING ON VIDAPI & AUTO-FAILOVER PREVENTION ---');

test('triggerAutoFailover prevents switching away from VidAPI and triggers reload/recovery instead', () => {
  assert.ok(appContent.includes("if (normKey === 'server1')"));
  assert.ok(appContent.includes("updateServerStatusDot('server1', 'online')"));
  assert.ok(appContent.includes("iframe.src = currentEmbed.url;"));
});

test('startFailoverWatchdog keeps VidAPI online and prevents auto-switching to hidden backup', () => {
  assert.ok(appContent.includes("if (normKey === 'server1') {"));
  assert.ok(appContent.includes("updateServerStatusDot('server1', 'online');"));
});

test('togglePlayerServer remains locked to VidAPI (server1)', () => {
  assert.ok(appContent.includes("switchPlayerServer('server1');"));
});

console.log('\n--- 4. VIDAPI STREAM URL RESOLUTION FOR MOVIES & TV SERIES ---');

test('MediaLinks generates valid VidAPI URLs for movies with IMDb or TMDB ID', () => {
  const m1 = MediaLinks.getMovieStreamUrl({ imdb: 'tt1375666' }, 'server1');
  assert.strictEqual(m1, 'https://vaplayer.ru/embed/movie/tt1375666');

  const m2 = MediaLinks.getMovieStreamUrl({ tmdbId: 27205 }, 'server1');
  assert.strictEqual(m2, 'https://vaplayer.ru/embed/movie/27205');

  const m3 = MediaLinks.getMovieStreamUrl({ imdb: 'tt0816692', tmdbId: '157336' }, 'vidapi');
  assert.strictEqual(m3, 'https://vidapi.ru/embed/movie/tt0816692');
});

test('MediaLinks generates valid VidAPI URLs for series episodes with TMDB ID and coordinates', () => {
  const e1 = MediaLinks.getEpisodeStreamUrl({ tmdbId: 205715 }, 1, 1, 'server1');
  assert.strictEqual(e1, 'https://vaplayer.ru/embed/tv/205715/1/1');

  const e2 = MediaLinks.getEpisodeStreamUrl({ tmdbId: '1396' }, 1, 3, 'vidapi');
  assert.strictEqual(e2, 'https://vidapi.ru/embed/tv/1396/1/3');
});

test('MediaLinks falls back to CuratedCatalog for series lacking direct tmdbId property', () => {
  // Breaking Bad in curated catalog is tt0903747 -> moviedb_id 1396
  const e3 = MediaLinks.getEpisodeStreamUrl({ imdb: 'tt0903747' }, 2, 4, 'server1');
  assert.ok(e3 && e3.includes('/tv/1396/2/4'));
});

console.log('\n--- 5. ANTI-POPUP & HIGH-FOCUSING FOCUS TRAP GUARDS ACTIVE ON VIDAPI ---');

test('Player iframe operates without sandbox attribute', () => {
  assert.strictEqual(appContent.includes("f.setAttribute('sandbox'"), false);
  assert.strictEqual(appContent.includes("iframe.setAttribute('sandbox'"), false);
});

test('Focus trap button and beforeunload redirect lock guard active on player container', () => {
  assert.ok(htmlContent.includes('id="pFocusTrap"'));
  assert.ok(appContent.includes('trap.focus()'));
  assert.ok(appContent.includes("if (_playerHovered && $('playerView')?.classList.contains('show') && !_allowNavigation)"));
});

test('Smart 1.5s transparent click-shield active with bottom control override for VidAPI', () => {
  assert.ok(appContent.includes('armVidShield()'));
  assert.ok(appContent.includes('activateVidShield()'));
  assert.ok(appContent.includes('temporarilyDisableShield(2)'));
  assert.ok(appContent.includes('distFromBottom <= 80'));
});

console.log(`\n========================================`);
console.log(`VidAPI Exclusive Focus Tests: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
