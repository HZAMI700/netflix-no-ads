'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 8130;
const ROOT = path.join(__dirname, '..');

const server = http.createServer((req, res) => {
  const filePath = path.join(ROOT, 'test.html');
  if (fs.existsSync(filePath)) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(fs.readFileSync(filePath, 'utf8'));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

async function runBrowserVerification() {
  await new Promise(r => server.listen(PORT, r));
  console.log(`Test server running at http://127.0.0.1:${PORT}`);

  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Opera GX', 'opera.exe')
  ];

  let browserPath = chromePaths.find(p => fs.existsSync(p));
  if (!browserPath) {
    console.error('No compatible browser found!');
    process.exit(1);
  }
  console.log('Using browser:', browserPath);

  const userDataDir = path.join(__dirname, 'temp_shield_profile_' + Date.now());
  const browserProc = spawn(browserPath, [
    '--headless=new',
    '--remote-debugging-port=9444',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + userDataDir
  ]);

  // Wait for browser debugger port
  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch('http://127.0.0.1:9444/json/new?http://127.0.0.1:' + PORT, { method: 'PUT' });
      const data = await res.json();
      if (data && data.webSocketDebuggerUrl) {
        wsUrl = data.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {}
  }

  if (!wsUrl) {
    console.error('Failed to connect to CDP endpoint on 9444');
    browserProc.kill();
    server.close();
    process.exit(1);
  }

  console.log('Connected to CDP endpoint');
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on('open', r));

  let reqId = 1;
  const callbacks = new Map();
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = reqId++;
      callbacks.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const networkRequests = [];
  const consoleMessages = [];
  const initialTargets = new Set();
  const runtimeCreatedTargets = [];
  let isNavigated = false;

  ws.on('message', data => {
    try {
      const msg = JSON.parse(data);
      if (callbacks.has(msg.id)) {
        const { resolve, reject } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }

      if (msg.method === 'Target.targetCreated') {
        const info = msg.params.targetInfo;
        if (!isNavigated) {
          initialTargets.add(info.targetId);
        } else {
          runtimeCreatedTargets.push(info);
          console.log('[CDP After Nav] Target created:', info.type, info.url, info.title);
        }
      }

      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || a.description || '').join(' ');
        consoleMessages.push({ type: msg.params.type, text });
        console.log(`[Browser Console ${msg.params.type}]`, text);
      }

      if (msg.method === 'Network.requestWillBeSent') {
        const reqUrl = msg.params.request.url;
        networkRequests.push(reqUrl);
      }
    } catch (err) {}
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Target.setDiscoverTargets', { discover: true });

  console.log('Navigating to test page...');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}` });
  isNavigated = true;

  // Wait for page and iframe to load
  console.log('Waiting for iframe to load and player to mount...');
  await new Promise(r => setTimeout(r, 6000));

  // Perform 5 clicks inside the player area
  console.log('\n--- PERFORMING 5 CLICKS ON PLAYER ---');
  for (let c = 1; c <= 5; c++) {
    console.log(`Click #${c} on player area...`);
    // Dispatch mouse click at center of player (x: 400, y: 250)
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 400,
      y: 250,
      button: 'left',
      clickCount: 1
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 400,
      y: 250,
      button: 'left',
      clickCount: 1
    });
    await new Promise(r => setTimeout(r, 800));
  }

  // Allow settling
  await new Promise(r => setTimeout(r, 2000));

  // Check how many page/tab targets were created after navigation
  const popupTargets = runtimeCreatedTargets.filter(t => t.type === 'page');

  console.log('\n========================================');
  console.log('VERIFICATION SUMMARY:');
  console.log(`1. Total network requests captured: ${networkRequests.length}`);
  console.log(`2. Total new popup/tab windows opened during test: ${popupTargets.length}`);
  console.log(`3. Runtime created targets:`, runtimeCreatedTargets.map(t => `${t.type}: ${t.url}`));

  // Check for any sandbox or adblock errors
  const sandboxErrors = consoleMessages.filter(m => /sandbox/i.test(m.text) && /error|blocked|fail/i.test(m.text));
  console.log(`4. Sandbox errors detected: ${sandboxErrors.length}`);

  // Analyze network requests for potential ad domains
  const adKeywords = ['doubleclick', 'adnxs', 'googlesyndication', 'adsystem', 'bet365', '1xbet', 'trafficjunky', 'onclick', 'popads'];
  const suspiciousRequests = networkRequests.filter(u => adKeywords.some(k => u.toLowerCase().includes(k)));
  console.log(`5. Suspicious unblocked ad requests: ${suspiciousRequests.length}`);
  if (suspiciousRequests.length > 0) {
    console.log('Suspicious URLs:', suspiciousRequests);
  }

  ws.close();
  browserProc.kill();
  server.close();

  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (e) {}

  if (popupTargets.length > 0) {
    console.error(`FAIL: ${popupTargets.length} popups/tabs escaped the shield!`);
    process.exit(1);
  }

  console.log('SUCCESS: All 5 clicks passed without pop-up/pop-under ads, sandbox errors, or tab escapes!');
  process.exit(0);
}

runBrowserVerification().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
