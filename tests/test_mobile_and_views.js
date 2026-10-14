'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = 8125;
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
  const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  if (exists) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Mobile test server running on http://127.0.0.1:${PORT}`);
  try {
    await runMobileTests();
  } catch (err) {
    console.error('Mobile test failed:', err);
    process.exit(1);
  } finally {
    server.close();
  }
});

async function runMobileTests() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const tempProfile = path.join(__dirname, 'temp_mobile_' + Date.now());
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9334',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + tempProfile
  ]);

  await new Promise(r => setTimeout(r, 1500));

  const newRes = await fetch(`http://127.0.0.1:9334/json/new?http://127.0.0.1:${PORT}`, { method: 'PUT' });
  const newTab = await newRes.json();
  const wsUrl = newTab.webSocketDebuggerUrl;

  const ws = new (require('ws'))(wsUrl);
  await new Promise(r => ws.on('open', r));

  let reqId = 1;
  const callbacks = new Map();
  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) cb.reject(msg.error);
      else cb.resolve(msg.result);
    }
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = reqId++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');

  // Set iPhone 12/13/14 mobile viewport (390 x 844)
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    fitWindow: false
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });

  console.log('Navigating to http://127.0.0.1:' + PORT);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}` });

  async function evaluate(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return res ? res.result.value : null;
  }

  // Poll until ready
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ready = await evaluate(`!!document.getElementById('profilesPage') && document.readyState === 'complete'`);
    if (ready) break;
  }

  async function takeScreenshot(name) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join('C:\\Users\\lenovo\\.gemini\\antigravity\\brain\\a2b8c6f3-9f5b-436b-96a7-efb9c0824db7', name);
    fs.writeFileSync(outPath, buffer);
    console.log(`Saved screenshot: ${name}`);
  }

  console.log('\n--- 1. Testing Mobile Profile Gateway (390px) ---');
  const bodyOverflowProfile = await evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
  console.log('Horizontal overflow on profile screen:', bodyOverflowProfile);
  await takeScreenshot('shot_mobile_profiles.png');

  // Select profile
  await evaluate(`document.querySelector('#avatars .pav').click()`);
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- 2. Testing Mobile Home Screen (390px) ---');
  const bodyOverflowHome = await evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
  console.log('Horizontal overflow on Home screen:', bodyOverflowHome);
  await takeScreenshot('shot_mobile_home.png');

  console.log('\n--- 3. Testing Mobile Detail Page & Views Counter for Series ---');
  // Navigate to The Mentalist detail
  await evaluate(`openDetail('tt1196946', 'series', false)`);
  await new Promise(r => setTimeout(r, 800));

  const seriesDetailCheck = await evaluate(`(() => {
    const bd = document.getElementById('detailBackdrop');
    const isOpen = bd && bd.classList.contains('show');
    const title = document.getElementById('dTitle')?.textContent;
    const metaHtml = document.getElementById('dMeta')?.innerHTML;
    const viewsBadge = document.querySelector('#dMeta .views-badge');
    const viewsText = viewsBadge ? viewsBadge.textContent.trim() : '';
    const overflow = bd ? bd.scrollWidth > window.innerWidth : false;
    return { isOpen, title, hasViews: !!viewsBadge, viewsText, overflow };
  })()`);
  console.log('Series detail open:', seriesDetailCheck.isOpen);
  console.log('Series title:', seriesDetailCheck.title);
  console.log('Series has views badge:', seriesDetailCheck.hasViews);
  console.log('Series views text:', seriesDetailCheck.viewsText);
  console.log('Series detail horizontal overflow:', seriesDetailCheck.overflow);
  await takeScreenshot('shot_mobile_series_detail.png');

  console.log('\n--- 4. Testing Mobile Detail Page & Views Counter for Movie ---');
  // Navigate to Inception detail
  await evaluate(`openDetail('tt1375666', 'movie', false)`);
  await new Promise(r => setTimeout(r, 800));

  const movieDetailCheck = await evaluate(`(() => {
    const bd = document.getElementById('detailBackdrop');
    const isOpen = bd && bd.classList.contains('show');
    const title = document.getElementById('dTitle')?.textContent;
    const viewsBadge = document.querySelector('#dMeta .views-badge');
    const viewsText = viewsBadge ? viewsBadge.textContent.trim() : '';
    const overflow = bd ? bd.scrollWidth > window.innerWidth : false;
    return { isOpen, title, hasViews: !!viewsBadge, viewsText, overflow };
  })()`);
  console.log('Movie detail open:', movieDetailCheck.isOpen);
  console.log('Movie title:', movieDetailCheck.title);
  console.log('Movie has views badge:', movieDetailCheck.hasViews);
  console.log('Movie views text:', movieDetailCheck.viewsText);
  console.log('Movie detail horizontal overflow:', movieDetailCheck.overflow);
  await takeScreenshot('shot_mobile_movie_detail.png');

  console.log('\n--- 5. Testing View Increment Logic ---');
  const initialViews = await evaluate(`getTitleViewCount ? getTitleViewCount({ id: 'tt1375666' }) : 0`);
  console.log('Initial Inception views:', initialViews);

  ws.close();
  chromeProcess.kill();
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch {}
}
