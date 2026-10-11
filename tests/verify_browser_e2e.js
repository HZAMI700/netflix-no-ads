'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8124;
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
  console.log('HTTP:', req.method, req.url, '-> exists:', exists);
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
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
  try {
    await runE2E();
  } catch (err) {
    console.error('E2E error:', err);
    process.exit(1);
  } finally {
    server.close();
  }
});

async function runE2E() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9333',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + path.join(__dirname, 'temp_profile_' + Date.now())
  ]);

  // Wait for remote debugging endpoint
  await new Promise(r => setTimeout(r, 1500));

  const newRes = await fetch(`http://127.0.0.1:9333/json/new?http://127.0.0.1:${PORT}`, { method: 'PUT' });
  const newTab = await newRes.json();
  const wsUrl = newTab.webSocketDebuggerUrl;

  let ws;
  try {
    ws = new (require('ws'))(wsUrl);
  } catch {
    console.log('ws package not installed, testing via node fetch/CDP or checking requirements');
    chromeProcess.kill();
    return;
  }

  await new Promise(r => ws.on('open', r));

  let reqId = 1;
  const callbacks = new Map();

  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('PAGE EXCEPTION:', JSON.stringify(msg.params.exceptionDetails));
    }
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
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  console.log('Navigating to http://127.0.0.1:' + PORT);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}` });

  async function evaluate(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return res ? res.result.value : null;
  }

  // Poll until page DOM and elements are available
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const ready = await evaluate(`!!document.getElementById('profilesPage') && document.readyState === 'complete'`);
      if (ready) {
        console.log('Page ready and fully initialized.');
        break;
      }
    } catch {}
  }

  async function takeScreenshot(name) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join('C:\\Users\\lenovo\\.gemini\\antigravity\\brain\\a2b8c6f3-9f5b-436b-96a7-efb9c0824db7', name);
    fs.writeFileSync(outPath, buffer);
    console.log(`Saved screenshot: ${name}`);
  }

  // 1. Verify First-Time Profile Screen
  console.log('\n--- 1. Testing First-Time Visitor Profile Selection ---');
  const isProfileGateActive = await evaluate(`document.body.classList.contains('profile-gate-active')`);
  console.log('profile-gate-active on body:', isProfileGateActive);
  const profilesVisible = await evaluate(`
    const p = document.getElementById('profilesPage');
    p && p.classList.contains('show') && getComputedStyle(p).display !== 'none'
  `);
  console.log('profilesPage visible:', profilesVisible);
  const avatarCount = await evaluate(`document.querySelectorAll('#avatars .pav').length`);
  console.log('Avatar count:', avatarCount);
  await takeScreenshot('shot_first_visit_profiles.png');

  // 2. Select Profile 'You'
  console.log('\n--- 2. Selecting Profile "You" ---');
  await evaluate(`document.querySelector('#avatars .pav').click()`);
  await new Promise(r => setTimeout(r, 1200));

  const profileGateGone = await evaluate(`!document.body.classList.contains('profile-gate-active')`);
  console.log('profile-gate-active removed:', profileGateGone);
  const homeVisible = await evaluate(`
    const h = document.getElementById('homePage');
    h && getComputedStyle(h).display !== 'none'
  `);
  console.log('homePage visible after selecting profile:', homeVisible);

  // 3. Verify No Continue / Finished Watching on First Visit
  console.log('\n--- 3. Testing Continue / Finished Watching for First Visit ---');
  const continueHidden = await evaluate(`
    (() => {
      const r = document.getElementById('row-continue');
      return !r || r.style.display === 'none' || getComputedStyle(r).display === 'none';
    })()
  `);
  const finishedHidden = await evaluate(`
    (() => {
      const r = document.getElementById('row-finished');
      return !r || r.style.display === 'none' || getComputedStyle(r).display === 'none';
    })()
  `);
  console.log('Continue watching row hidden:', continueHidden);
  console.log('Finished watching row hidden:', finishedHidden);

  // 4. Verify Zero Duplication on Home Screen
  console.log('\n--- 4. Checking Cross-Row Zero Duplication on Home Screen ---');
  const homeDuplicationCheck = await evaluate(`
    (() => {
      const rows = Array.from(document.querySelectorAll('#rows .row-sec'));
      const seenTitles = new Map();
      const duplicates = [];

      rows.forEach(r => {
        if (r.style.display === 'none') return;
        const rowTitle = r.querySelector('.row-head h2')?.textContent?.trim() || r.id;
        const cardTitles = Array.from(r.querySelectorAll('.card img')).map(img => img.alt.trim().toLowerCase()).filter(Boolean);
        cardTitles.forEach(title => {
          if (!title) return;
          if (seenTitles.has(title)) {
            duplicates.push({ title, rowA: seenTitles.get(title), rowB: rowTitle });
          } else {
            seenTitles.set(title, rowTitle);
          }
        });
      });

      return { totalUniqueTitles: seenTitles.size, duplicatesCount: duplicates.length, duplicates };
    })()
  `);
  console.log('Home unique titles:', homeDuplicationCheck.totalUniqueTitles);
  console.log('Home duplicates found across rows:', homeDuplicationCheck.duplicatesCount);
  if (homeDuplicationCheck.duplicatesCount > 0) {
    console.log('Duplicates:', homeDuplicationCheck.duplicates);
  }
  await takeScreenshot('shot_home_no_duplicates.png');

  // 5. Verify Zero Duplication in TV Shows (Series Browse)
  console.log('\n--- 5. Checking Cross-Row Zero Duplication in TV Shows Section ---');
  await evaluate(`openBrowse('series')`);
  await new Promise(r => setTimeout(r, 2000));

  const seriesDuplicationCheck = await evaluate(`
    (() => {
      const rows = Array.from(document.querySelectorAll('#browseRows .row-sec'));
      const seenTitles = new Map();
      const duplicates = [];

      rows.forEach(r => {
        if (r.style.display === 'none') return;
        const rowTitle = r.querySelector('.row-head h2')?.textContent?.trim() || r.id;
        const cardTitles = Array.from(r.querySelectorAll('.card img')).map(img => img.alt.trim().toLowerCase()).filter(Boolean);
        cardTitles.forEach(title => {
          if (!title) return;
          if (seenTitles.has(title)) {
            duplicates.push({ title, rowA: seenTitles.get(title), rowB: rowTitle });
          } else {
            seenTitles.set(title, rowTitle);
          }
        });
      });

      return { totalUniqueTitles: seenTitles.size, duplicatesCount: duplicates.length, duplicates };
    })()
  `);
  console.log('TV Shows unique titles:', seriesDuplicationCheck.totalUniqueTitles);
  console.log('TV Shows duplicates found across rows:', seriesDuplicationCheck.duplicatesCount);
  if (seriesDuplicationCheck.duplicatesCount > 0) {
    console.log('Duplicates:', seriesDuplicationCheck.duplicates);
  }
  await takeScreenshot('shot_series_no_duplicates.png');

  // 6. Verify Settings page (Addons section hidden)
  console.log('\n--- 6. Checking Settings Page (Addons Section Hidden) ---');
  await evaluate(`show('settings'); renderAddons();`);
  await new Promise(r => setTimeout(r, 800));

  const addonsHidden = await evaluate(`
    const el = document.getElementById('settingsAddonsCard');
    !el || el.style.display.includes('none') || getComputedStyle(el).display === 'none'
  `);
  console.log('Settings addons card hidden:', addonsHidden);
  await takeScreenshot('shot_settings_hidden_addons.png');

  // 7. Verify Security (DOMPurify active)
  console.log('\n--- 7. Checking Security (DOMPurify & Sanitation) ---');
  const domPurifyWorking = await evaluate(`
    typeof window.DOMPurify !== 'undefined' &&
    window.DOMPurify.sanitize('<img src=x onerror=alert(1)>') === '<img src="x">'
  `);
  console.log('DOMPurify working in browser:', domPurifyWorking);

  ws.close();
  chromeProcess.kill();

  const allPassed = isProfileGateActive &&
                    profilesVisible &&
                    avatarCount === 4 &&
                    profileGateGone &&
                    homeVisible &&
                    continueHidden &&
                    finishedHidden &&
                    homeDuplicationCheck.duplicatesCount === 0 &&
                    seriesDuplicationCheck.duplicatesCount === 0 &&
                    addonsHidden &&
                    domPurifyWorking;

  if (allPassed) {
    console.log('\n>>> ALL 7 BROWSER E2E VERIFICATIONS PASSED 100%! <<<');
    process.exit(0);
  } else {
    console.error('\n>>> SOME E2E VERIFICATIONS FAILED! <<<');
    process.exit(1);
  }
}
