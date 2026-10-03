'use strict';
const fs = require('fs');
const js = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const refs = [...new Set([...js.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]))];
const missing = refs.filter((id) => !html.includes(`id="${id}"`));
console.log(missing.length ? 'MISSING IN HTML: ' + missing.join(', ') : `all ${refs.length} element refs resolve`);
