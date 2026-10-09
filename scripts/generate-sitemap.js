'use strict';
/**
 * Streamnaro XML Sitemap Generator (Specification Compliant)
 * Generates Sitemap Index and sub-sitemaps (max 40,000 URLs each) for 100% Google/Bing compliance.
 */
const fs = require('fs');
const path = require('path');
const CuratedCatalog = require('../services/curated-catalog.js');

const BASE_URL = 'https://streamnaro.com';
const TODAY = new Date().toISOString().split('T')[0];
const CHUNK_SIZE = 40000;

function generateSitemaps() {
  const urls = [];

  // Core Main Pages
  urls.push({ loc: `${BASE_URL}/`, changefreq: 'daily', priority: '1.0' });
  urls.push({ loc: `${BASE_URL}/#movies`, changefreq: 'daily', priority: '0.9' });
  urls.push({ loc: `${BASE_URL}/#series`, changefreq: 'daily', priority: '0.9' });
  urls.push({ loc: `${BASE_URL}/#new`, changefreq: 'daily', priority: '0.8' });

  // Curated Titles
  const mediaList = CuratedCatalog.CURATED_MEDIA || [];
  mediaList.forEach(m => {
    if (!m || !m.id) return;
    const type = m.type === 'series' ? 'series' : 'movie';
    const slug = encodeURIComponent(String(m.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    urls.push({
      loc: `${BASE_URL}/#${type}/${m.id}${slug ? '-' + slug : ''}`,
      lastmod: TODAY,
      changefreq: type === 'series' ? 'weekly' : 'monthly',
      priority: '0.8'
    });
  });

  const totalUrls = urls.length;
  const chunkCount = Math.ceil(totalUrls / CHUNK_SIZE);
  const subSitemaps = [];

  for (let i = 0; i < chunkCount; i++) {
    const chunkUrls = urls.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const subFilename = `sitemap-${i + 1}.xml`;
    subSitemaps.push(subFilename);

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...chunkUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod || TODAY}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`),
      '</urlset>'
    ].join('\n');

    fs.writeFileSync(path.join(__dirname, '..', subFilename), xml, 'utf8');
    console.log(`Wrote ${chunkUrls.length} URLs to ${subFilename}`);
  }

  // Master Sitemap Index
  const indexXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...subSitemaps.map(filename => `  <sitemap>
    <loc>${BASE_URL}/${filename}</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>`),
    '</sitemapindex>'
  ].join('\n');

  fs.writeFileSync(path.join(__dirname, '..', 'sitemap.xml'), indexXml, 'utf8');
  console.log(`Generated master sitemap.xml index pointing to ${subSitemaps.length} sitemaps with ${totalUrls} total URLs.`);
}

generateSitemaps();
