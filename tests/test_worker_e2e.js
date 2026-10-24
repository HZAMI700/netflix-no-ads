const https = require('https');

async function testWorker() {
  const url = 'https://stream-shield.yassine-hzami.workers.dev/';
  console.log('Fetching', url);
  const res = await fetch(url);
  console.log('Status:', res.status);
  console.log('Headers:');
  for (const [k, v] of res.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
  const text = await res.text();
  console.log('Body length:', text.length);
  console.log('Has <base>: ', text.includes('<base href="https://streamnaro.online/">'));
  console.log('Has [StreamShield]:', text.includes('[StreamShield]'));
  console.log('Has window.open override:', text.includes('Object.defineProperty(window, \'open\''));
  console.log('Has x-frame-options header:', res.headers.has('x-frame-options'));
  console.log('Has CSP header:', res.headers.has('content-security-policy'));
  console.log('Has CORS header:', res.headers.get('access-control-allow-origin'));

  // Also test /__p/ prefix
  const testNestedUrl = 'https://stream-shield.yassine-hzami.workers.dev/__p/' + encodeURIComponent('https://streamnaro.online') + '/';
  console.log('\nTesting nested prefix URL:', testNestedUrl);
  const resNested = await fetch(testNestedUrl);
  console.log('Nested status:', resNested.status);
  const textNested = await resNested.text();
  console.log('Nested body length:', textNested.length);
  console.log('Nested has shield:', textNested.includes('[StreamShield]'));
}

testWorker().catch(console.error);
