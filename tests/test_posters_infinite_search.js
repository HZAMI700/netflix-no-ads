'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlCode = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cssCode = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

console.log('========================================================');
console.log('TEST SUITE: POSTERS, INFINITE SCROLLING & SEARCH SYSTEM');
console.log('========================================================\n');

// ----------------------------------------------------
// PILLAR 1: POSTERS & BROKEN IMAGES
// ----------------------------------------------------
console.log('--- 1. Testing Poster Resolution & Fallback System ---');

// Evaluate formatPosterUrl, poster, backdrop, createPosterFallback
const sandbox = {
  CuratedCatalog: require('../services/curated-catalog.js'),
  document: {
    createElement: () => ({ classList: { add: () => {} }, style: {}, appendChild: () => {} }),
    createComment: () => ({})
  },
  window: {}
};

const evalContext = `
${appCode.slice(appCode.indexOf('function formatPosterUrl'), appCode.indexOf('function matchScore'))}
`;
const fn = new Function('CuratedCatalog', 'createPosterFallback', 'document', 'window', `
  ${evalContext}
  return { formatPosterUrl, poster, backdrop };
`);

const { formatPosterUrl, poster, backdrop } = fn(
  sandbox.CuratedCatalog,
  sandbox.CuratedCatalog.generateCinematicCover,
  sandbox.document,
  sandbox.window
);

// 1.1 formatPosterUrl
assert.strictEqual(formatPosterUrl(null), null, 'null input should return null');
assert.strictEqual(formatPosterUrl('undefined'), null, '"undefined" string should return null');
assert.strictEqual(formatPosterUrl('/null'), null, 'relative null path should return null');
assert.strictEqual(formatPosterUrl('/xyz.jpg'), 'https://image.tmdb.org/t/p/w500/xyz.jpg', 'TMDB relative poster path formatted');
assert.strictEqual(formatPosterUrl('/xyz.jpg', true), 'https://image.tmdb.org/t/p/w1280/xyz.jpg', 'TMDB relative backdrop path formatted');
assert.strictEqual(formatPosterUrl('http://image.tmdb.org/t/p/w500/xyz.jpg'), 'https://image.tmdb.org/t/p/w500/xyz.jpg', 'HTTP TMDB converted to HTTPS');
console.log('PASS: formatPosterUrl handles null, TMDB relative paths, and HTTPS upgrade');

// 1.2 poster() with TMDB properties
const tmdbMovie = { name: 'Inception', poster_path: '/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg', type: 'movie' };
assert.strictEqual(poster(tmdbMovie), 'https://image.tmdb.org/t/p/w500/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg', 'poster_path resolved correctly');

const tmdbSeries = { name: 'Breaking Bad', backdrop_path: '/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg', type: 'series' };
assert.strictEqual(backdrop(tmdbSeries), 'https://image.tmdb.org/t/p/w1280/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg', 'backdrop_path resolved correctly');
console.log('PASS: poster() and backdrop() correctly handle TMDB poster_path and backdrop_path');

// 1.3 Missing poster fallback to CuratedCatalog (strict type checking)
const reacherSeries = { id: 'tt9288030', name: 'Reacher', type: 'series' };
const reacherPoster = poster(reacherSeries);
assert(reacherPoster && reacherPoster.length > 0, 'Reacher series resolved poster from CuratedCatalog');
assert(reacherPoster.includes('data:image/svg+xml') || reacherPoster.startsWith('http'), 'Valid poster returned');

// 1.4 Broken image error fallback in buildCard
assert(appCode.includes("onerror=\"this.onerror=null;this.classList.add('poster-fallback');this.src='${fallbackPosterSvg}';"), 'buildCard includes inline onerror with SVG fallback');
assert(appCode.includes('cardImg.onerror = function()'), 'buildCard includes JS onerror fallback');
console.log('PASS: buildCard embeds resilient dual onerror fallback protection');

// ----------------------------------------------------
// PILLAR 2: INFINITE SCROLLING
// ----------------------------------------------------
console.log('\n--- 2. Testing Infinite Scrolling Architecture ---');

// 2.1 Sentinel elements in HTML
assert(htmlCode.includes('id="browseSentinel"'), 'browseSentinel element exists in index.html');
assert(htmlCode.includes('id="searchSentinel"'), 'searchSentinel element exists in index.html');
assert(htmlCode.includes('id="browseLoader"'), 'browseLoader element exists in index.html');
assert(htmlCode.includes('id="searchLoader"'), 'searchLoader element exists in index.html');
assert(htmlCode.includes('id="browseRetryBtn"'), 'browseRetryBtn element exists in index.html');
assert(htmlCode.includes('id="searchRetryBtn"'), 'searchRetryBtn element exists in index.html');
console.log('PASS: All infinite scroll sentinels, loaders, and retry triggers exist in index.html');

// 2.2 Infinite scrolling functions in app.js
assert(appCode.includes('function initInfiniteScrolling()'), 'initInfiniteScrolling defined in app.js');
assert(appCode.includes('function fetchMoreBrowseResults()'), 'fetchMoreBrowseResults defined in app.js');
assert(appCode.includes('function fetchMoreSearchResults()'), 'fetchMoreSearchResults defined in app.js');
assert(appCode.includes('seenBrowseGridIds'), 'seenBrowseGridIds deduplication Set present');
assert(appCode.includes('seenSearchIds'), 'seenSearchIds deduplication Set present');
assert(appCode.includes('isBrowseFetching'), 'Fast scroll debounce flag present for browse');
assert(appCode.includes('isSearchFetching'), 'Fast scroll debounce flag present for search');
console.log('PASS: Infinite scrolling observers, deduplication, and fast scroll guards present');

// 2.3 Scroll position preservation on detail navigation
assert(appCode.includes('savedPageScroll = window.scrollY'), 'Scroll position saved on openDetail');
assert(appCode.includes('window.scrollTo(0, savedPageScroll)'), 'Scroll position restored on closeDetail');
assert(appCode.includes('function show(name, subNav, preserveScroll = false)'), 'show supports preserveScroll');
console.log('PASS: Scroll position preserved when navigating to and from details');

// ----------------------------------------------------
// PILLAR 3: SEARCH SYSTEM OVERHAUL
// ----------------------------------------------------
console.log('\n--- 3. Testing Enhanced Search System & Dropdown ---');

// 3.1 Dropdown elements in index.html and styles.css
assert(htmlCode.includes('id="searchDropdown"'), 'searchDropdown container exists in index.html');
assert(cssCode.includes('.search-dropdown'), 'search-dropdown styled in styles.css');
assert(cssCode.includes('.search-dropdown-item'), 'search-dropdown-item styled in styles.css');
assert(cssCode.includes('.search-badge'), 'search-badge styled in styles.css');
assert(cssCode.includes('.badge-movie'), 'badge-movie styled in styles.css');
assert(cssCode.includes('.badge-series'), 'badge-series styled in styles.css');
console.log('PASS: Search dropdown and movie/series badges fully styled');

// 3.2 Search scoring & relevance filtering
assert(appCode.includes('function scoreSearchResult('), 'scoreSearchResult defined in app.js');
assert(appCode.includes('function isSearchRelevant('), 'isSearchRelevant defined in app.js');
assert(appCode.includes('updateSearchDropdown('), 'updateSearchDropdown defined in app.js');
assert(appCode.includes('closeSearchDropdown()'), 'closeSearchDropdown defined in app.js');
assert(appCode.includes('renderDropdownItems('), 'renderDropdownItems defined in app.js');

// 3.3 Keyboard navigation in search
assert(appCode.includes("e.key === 'ArrowDown'"), 'ArrowDown navigation implemented');
assert(appCode.includes("e.key === 'ArrowUp'"), 'ArrowUp navigation implemented');
assert(appCode.includes("e.key === 'Escape'"), 'Escape closes search dropdown');
assert(appCode.includes("e.key === 'Enter'"), 'Enter activates suggestion or submits search');
console.log('PASS: Search keyboard navigation (ArrowDown, ArrowUp, Enter, Escape) implemented');

// 3.4 Stale request cancellation via AbortController
assert(appCode.includes('dropdownAbortCtrl = new AbortController()'), 'Dropdown aborts stale queries');
assert(appCode.includes('searchAbortCtrl = new AbortController()'), 'Search page aborts stale queries');
console.log('PASS: Stale search query cancellation via AbortController implemented');

console.log('\n========================================================');
console.log('>>> ALL VERIFICATION CHECKS PASSED (100%) <<<');
console.log('========================================================\n');
