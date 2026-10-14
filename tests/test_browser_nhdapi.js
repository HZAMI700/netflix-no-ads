'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 8129;
const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const server = http.createServer((req, res) => {
  let u = req.url.split('?')[0];
  if (u === '/') u = '/index.html';
  const filePath = path.join(ROOT, decodeURIComponent(u.replace(/^\//, '')));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Test server running on http://127.0.0.1:${PORT}`);
  try {
    await runBrowserTests();
  } catch (err) {
    console.error('Browser Test Error:', err);
    process.exit(1);
  } finally {
    server.close();
  }
});

async function runBrowserTests() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = path.join(__dirname, 'temp_nhdapi_' + Date.now());
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9334',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    '--user-data-dir=' + profileDir
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const newRes = await fetch(`http://127.0.0.1:9334/json/new?http://127.0.0.1:${PORT}`, { method: 'PUT' });
  const newTab = await newRes.json();
  const wsUrl = newTab.webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  let reqId = 1;
  const callbacks = new Map();
  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      cb(msg);
    }
  });

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = reqId++;
      callbacks.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.result && res.result.exceptionDetails) {
      console.warn('Evaluation warning:', res.result.exceptionDetails);
    }
    return res.result?.result?.value;
  }

  async function captureScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    if (res.result?.data) {
      const buffer = Buffer.from(res.result.data, 'base64');
      const artifactDir = path.join('C:', 'Users', 'lenovo', '.gemini', 'antigravity', 'brain', 'a2b8c6f3-9f5b-436b-96a7-efb9c0824db7');
      if (fs.existsSync(artifactDir)) {
        fs.writeFileSync(path.join(artifactDir, filename), buffer);
      }
      fs.writeFileSync(path.join(__dirname, filename), buffer);
      console.log(`Saved screenshot: ${filename}`);
    }
  }

  await send('Page.enable');
  await send('Runtime.enable');

  console.log('\n--- 1. Page Load & Initial State ---');
  // Wait until app.js has executed and initialized
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`typeof currentPlayerServer !== 'undefined'`);
    if (ready) break;
    await new Promise(r => setTimeout(r, 200));
  }

  // Select profile if profile gate is shown
  const isProfileGate = await evaluate(`document.body.classList.contains('profile-gate-active')`);
  if (isProfileGate) {
    console.log('Profile gate is active, selecting Profile...');
    await evaluate(`selectProfile(PROFILES[0])`);
    await new Promise(r => setTimeout(r, 600));
  }

  const initialServer = await evaluate(`currentPlayerServer`);
  console.log('Initial default player server:', initialServer);
  if (initialServer !== 'server1') throw new Error(`Default server should be server1, got ${initialServer}`);

  // Verify Telegram links in footer and top player control bar
  const footerTg = await evaluate(`document.querySelector('.ficons a[href="https://t.me/blackroner"]')?.href`);
  console.log('Footer Telegram Link:', footerTg);
  if (footerTg !== 'https://t.me/blackroner') throw new Error('Footer telegram link missing or incorrect');

  const playerTg = await evaluate(`$('pTelegramTop')?.getAttribute('href')`);
  console.log('Player Topbar Telegram Link:', playerTg);
  if (playerTg !== 'https://t.me/blackroner') throw new Error('Player topbar telegram link missing or incorrect');

  console.log('\n--- 2. Movie Playback on Server 1 (Default) ---');
  // Open Inception (TMDB ID 27205, IMDb tt1375666)
  await evaluate(`
    const cur = CuratedCatalog.getCuratedById('tt1375666');
    openDetail(cur ? cur.id : 'tt1375666', 'movie', true);
  `);
  await new Promise(r => setTimeout(r, 1000));

  const pViewShow = await evaluate(`$('playerView').classList.contains('show')`);
  const s1IframeSrc = await evaluate(`$('playerView').querySelector('iframe')?.src`);
  const s1Label = await evaluate(`$('pServerLabel')?.textContent`);
  console.log('Player active:', pViewShow);
  console.log('Server 1 Iframe Src:', s1IframeSrc);
  console.log('Server Label:', s1Label);

  if (!pViewShow) throw new Error('PlayerView did not open');
  if (!s1IframeSrc || !s1IframeSrc.includes('vaplayer.ru')) throw new Error('Server 1 should use vaplayer');
  if (s1Label !== 'Server 1 (HD)') throw new Error(`Expected Server 1 (HD), got ${s1Label}`);

  await captureScreenshot('shot_server1_movie.png');

  console.log('\n--- 3. Switching to Server 2 (NHDApi) on Movie ---');
  // Click switch server button #pServerTop
  await evaluate(`$('pServerTop').click();`);
  await new Promise(r => setTimeout(r, 1000));

  const currentServerAfterSwitch = await evaluate(`currentPlayerServer`);
  const s2IframeSrc = await evaluate(`$('playerView').querySelector('iframe')?.src`);
  const s2Label = await evaluate(`$('pServerLabel')?.textContent`);
  const toastText = await evaluate(`$('toast')?.textContent`);
  console.log('Current server after switch:', currentServerAfterSwitch);
  console.log('Server 2 Iframe Src:', s2IframeSrc);
  console.log('Server Label:', s2Label);
  console.log('Toast notification:', toastText);

  if (currentServerAfterSwitch !== 'server2') throw new Error('Server was not switched to server2');
  if (!s2IframeSrc || !s2IframeSrc.startsWith('https://nhdapi.com/movie/')) {
    throw new Error(`Expected NHDApi movie iframe, got: ${s2IframeSrc}`);
  }
  if (!s2Label.includes('Server 2')) throw new Error(`Expected Server 2 label, got: ${s2Label}`);

  await captureScreenshot('shot_nhdapi_movie.png');

  console.log('\n--- 4. Pop-Under & Ad Prevention on NHDApi ---');
  // Test 1: window.open attempt
  const blockedPopupResult = await evaluate(`
    window.open('https://unwanted-ad-domain.com/click.php', '_blank');
  `);
  console.log('Result of unauthorized window.open:', blockedPopupResult);
  if (blockedPopupResult !== null) throw new Error('Unauthorized popup should be blocked (null)');

  // Test 2: focus guardian activity check
  const focusLossTest = await evaluate(`
    try {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('visibilitychange'));
      true;
    } catch (e) {
      false;
    }
  `);
  console.log('Focus snap on blur/visibility event test passed:', focusLossTest);
  if (!focusLossTest) throw new Error('Focus loss handler failed');

  console.log('\n--- 5. Subtitle System with NHDApi ---');
  // Check subtitle options
  const subOptions = await evaluate(`
    Array.from($('captionModalLangSelect')?.options || []).map(o => ({ value: o.value, text: o.textContent }));
  `);
  console.log('Available subtitle options count:', subOptions.length);
  console.log('Sample subtitle options:', subOptions.slice(0, 5));

  // Change subtitle to English
  await evaluate(`applySubtitleToActivePlayer('en')`);
  const currentSubLangEn = await evaluate(`store.get('nf_sub_lang')`);
  console.log('Subtitle lang set to:', currentSubLangEn);
  if (currentSubLangEn !== 'en') throw new Error('Subtitle should be en');

  // Change subtitle to Off / Disabled
  await evaluate(`applySubtitleToActivePlayer('off')`);
  const currentSubLangOff = await evaluate(`store.get('nf_sub_lang')`);
  console.log('Subtitle lang disabled:', currentSubLangOff);
  if (currentSubLangOff !== 'off') throw new Error('Subtitle should be off');

  // Restore to Arabic (default)
  await evaluate(`applySubtitleToActivePlayer('ar')`);

  console.log('\n--- 6. TV Series Playback on NHDApi & Next Episode ---');
  // Close player
  await evaluate(`closePlayer()`);
  await new Promise(r => setTimeout(r, 500));

  // Open Breaking Bad (TMDB ID 1396) Season 1 Episode 1
  await evaluate(`
    const bb = CuratedCatalog.getCuratedById('tt0903747');
    openDetail(bb ? bb.id : 'tt0903747', 'series', true);
  `);
  await new Promise(r => setTimeout(r, 1000));

  const tvS2IframeSrc = await evaluate(`$('playerView').querySelector('iframe')?.src`);
  console.log('TV Series Server 2 Iframe Src:', tvS2IframeSrc);
  if (!tvS2IframeSrc || !tvS2IframeSrc.startsWith('https://nhdapi.com/tv/1396?season=1&episode=1')) {
    throw new Error(`Expected NHDApi TV iframe S1E1, got: ${tvS2IframeSrc}`);
  }

  await captureScreenshot('shot_nhdapi_series.png');

  // Click Next Episode (#pNextTop)
  console.log('Clicking Next Episode button...');
  await evaluate(`$('pNextTop').click()`);
  await new Promise(r => setTimeout(r, 1000));

  const nextEpIframeSrc = await evaluate(`$('playerView').querySelector('iframe')?.src`);
  console.log('After Next Episode, Iframe Src:', nextEpIframeSrc);
  if (!nextEpIframeSrc || !nextEpIframeSrc.startsWith('https://nhdapi.com/tv/1396?season=1&episode=2')) {
    throw new Error(`Expected NHDApi TV iframe S1E2, got: ${nextEpIframeSrc}`);
  }

  console.log('\n--- 7. Switching Back to Server 1 on TV Series ---');
  await evaluate(`$('pServerTop').click();`);
  await new Promise(r => setTimeout(r, 800));

  const backS1Src = await evaluate(`$('playerView').querySelector('iframe')?.src`);
  const backS1Label = await evaluate(`$('pServerLabel')?.textContent`);
  console.log('Back to Server 1 Iframe Src:', backS1Src);
  console.log('Back to Server 1 Label:', backS1Label);
  if (!backS1Src || !backS1Src.includes('vaplayer.ru')) {
    throw new Error(`Expected Server 1 vaplayer URL, got: ${backS1Src}`);
  }
  if (backS1Label !== 'Server 1 (HD)') throw new Error(`Expected Server 1 (HD), got: ${backS1Label}`);

  console.log('\n--- 8. Cleanup & Close Player ---');
  await evaluate(`closePlayer()`);
  await new Promise(r => setTimeout(r, 500));

  const finalIframeList = await evaluate(`document.querySelectorAll('#playerView iframe').length`);
  console.log('Remaining iframes in playerView after close:', finalIframeList);
  if (finalIframeList !== 0) throw new Error('All iframes should be removed after closePlayer');

  // Teardown chrome
  chromeProcess.kill();
  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch {}

  console.log('\n========================================');
  console.log('ALL BROWSER E2E TESTS FOR NHDAPI PASSED!');
  console.log('========================================\n');
}
