'use strict';
/* Plain-node tests for api/playback.js — no test framework needed. */
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}
function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(d) { this.body = String(d === undefined ? '' : d); },
  };
}
function loadHandler(env) {
  const p = path.join(__dirname, '..', 'api', 'playback.js');
  delete require.cache[require.resolve(p)];
  const old = { ...process.env };
  for (const k of Object.keys(env)) {
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  const handler = require(p);
  process.env = old;
  return handler;
}

(async () => {
  // 1. Missing params → 400
  let h = loadHandler({});
  let res = fakeRes();
  await h({ method: 'GET', url: '/api/playback' }, res);
  check('missing params → 400', res.statusCode === 400, res.body);

  // 2. Bad infoHash → 400 (needs BACKEND_URL set to reach validation)
  h = loadHandler({ BACKEND_URL: 'http://localhost:4000' });
  res = fakeRes();
  await h({ method: 'GET', url: '/api/playback?infoHash=xyz' }, res);
  check('bad infoHash → 400', res.statusCode === 400, res.body);

  // 3. Bad fileIdx → 400
  res = fakeRes();
  await h({ method: 'GET', url: '/api/playback?infoHash=08ada5a7a5bd3da1ed0f6e8a6c1279d2079b7f2b&fileIdx=-2' }, res);
  check('bad fileIdx → 400', res.statusCode === 400, res.body);

  // 4. No backend configured → 503 (friendly, no internals)
  h = loadHandler({ BACKEND_URL: undefined });
  res = fakeRes();
  await h({ method: 'GET', url: '/api/playback?infoHash=08ada5a7a5bd3da1ed0f6e8a6c1279d2079b7f2b' }, res);
  const b4 = JSON.parse(res.body);
  check('missing BACKEND_URL → 503 friendly', res.statusCode === 503 && /not configured/.test(b4.error), res.body);

  // 5. Unreachable backend → 502 friendly (connection refused is instant)
  h = loadHandler({ BACKEND_URL: 'http://127.0.0.1:9', PLAYBACK_TIMEOUT_MS: '5000' });
  res = fakeRes();
  await h({ method: 'GET', url: '/api/playback?infoHash=08ada5a7a5bd3da1ed0f6e8a6c1279d2079b7f2b' }, res);
  const b5 = JSON.parse(res.body);
  check('unreachable backend → 502 friendly', res.statusCode === 502 && typeof b5.error === 'string' && !/127\.0\.0\.1:9/.test(b5.error), res.body);

  // 6. Wrong method → 405
  res = fakeRes();
  await h({ method: 'POST', url: '/api/playback?infoHash=08ada5a7a5bd3da1ed0f6e8a6c1279d2079b7f2b' }, res);
  check('POST → 405', res.statusCode === 405, res.body);

  // 7. Direct URL, origin not allowlisted → 403
  h = loadHandler({ ALLOWED_MEDIA_ORIGINS: 'https://cdn.example.com' });
  res = fakeRes();
  await h({ method: 'GET', url: '/api/playback?direct=' + encodeURIComponent('https://evil.example/v.m3u8') }, res);
  check('disallowed direct origin → 403', res.statusCode === 403, res.body);

  // 8. Direct URL, allowlisted → 200 passthrough with type sniffing
  res = fakeRes();
  await h({ method: 'GET', url: '/api/playback?direct=' + encodeURIComponent('https://cdn.example.com/v/ep1.m3u8') }, res);
  const b8 = JSON.parse(res.body);
  check('allowlisted direct → 200 hls', res.statusCode === 200 && b8.type === 'hls' && b8.url === 'https://cdn.example.com/v/ep1.m3u8', res.body);

  // 9. Non-http(s) direct URL → 403
  res = fakeRes();
  await h({ method: 'GET', url: '/api/playback?direct=' + encodeURIComponent('ftp://cdn.example.com/v.mp4') }, res);
  check('ftp direct → 403', res.statusCode === 403, res.body);

  // 10. CORS header present
  check('CORS header set', res.headers['access-control-allow-origin'] === '*', JSON.stringify(res.headers));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
