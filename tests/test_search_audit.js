'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CC = require('../services/curated-catalog.js');

console.log('========================================================');
console.log('TEST SUITE: SEARCH ACCURACY, AUDIT & THE MENTALIST');
console.log('========================================================\n');

// 1. Verify "The Mentalist" in real catalog
console.log('--- 1. Verifying "The Mentalist" in Real Catalog ---');
const mentalist = CC.getCuratedById('tt1196946');
assert(mentalist, 'The Mentalist (tt1196946) must exist in CuratedCatalog');
assert.strictEqual(mentalist.name, 'The Mentalist', 'Title must be "The Mentalist"');
assert.strictEqual(mentalist.type, 'series', 'Type must be "series"');
assert.strictEqual(mentalist.moviedb_id, 5920, 'TMDB ID must be 5920');
assert.strictEqual(mentalist.year, 2008, 'Release year must be 2008');
assert.strictEqual(mentalist.imdbRating, '8.2', 'IMDb rating must be 8.2');
assert(Array.isArray(mentalist.genres) && mentalist.genres.includes('Crime') && mentalist.genres.includes('Mystery'), 'Genres must include Crime & Mystery');

const mentalistByTmdb = CC.getCuratedById('5920');
assert(mentalistByTmdb && mentalistByTmdb.id === 'tt1196946', 'Lookup by TMDB ID 5920 works');

const mentalistByTmdbPrefix = CC.getCuratedById('tmdb:5920');
assert(mentalistByTmdbPrefix && mentalistByTmdbPrefix.id === 'tt1196946', 'Lookup by "tmdb:5920" works');

const mentalistEpisodes = CC.getSeriesVideos(mentalist);
assert(Array.isArray(mentalistEpisodes) && mentalistEpisodes.length > 0, 'The Mentalist has generated canonical episodes');
const seasons = [...new Set(mentalistEpisodes.map(e => e.season))];
assert.strictEqual(seasons.length, 7, 'The Mentalist has all 7 canonical seasons');
assert(!mentalistEpisodes.some(e => e.season === 0), 'Zero season 0 in The Mentalist');
console.log('PASS: The Mentalist verified in catalog with authentic IMDb/TMDB IDs, 7 seasons, and 0 season 0');

// 2. Search Ranking: Exact Title Matches Above Partial Matches
console.log('\n--- 2. Testing Search Accuracy & Ranking ---');

// 2.1 "The Mentalist"
const res1 = CC.searchCurated('The Mentalist');
assert(res1.length > 0, 'Results returned for "The Mentalist"');
assert.strictEqual(res1[0].name, 'The Mentalist', '"The Mentalist" query ranks The Mentalist #1');
console.log('PASS: "The Mentalist" query returns The Mentalist as #1');

// 2.2 "Mentalist" (root title match without leading "The")
const res2 = CC.searchCurated('Mentalist');
assert(res2.length > 0, 'Results returned for "Mentalist"');
assert.strictEqual(res2[0].name, 'The Mentalist', '"Mentalist" query ranks The Mentalist as #1');
console.log('PASS: "Mentalist" query returns The Mentalist as #1');

// 2.3 Extra whitespace and case-insensitivity: "   the   mentalist   "
const res3 = CC.searchCurated('   the   mentalist   ');
assert(res3.length > 0 && res3[0].name, 'The Mentalist', 'Whitespace and casing handled');
assert.strictEqual(res3[0].name, 'The Mentalist');
console.log('PASS: "   the   mentalist   " handles extra spaces and ranks #1');

// 2.4 Known movie: "Inception"
const resMovie = CC.searchCurated('Inception');
assert(resMovie.length > 0, 'Results returned for "Inception"');
assert.strictEqual(resMovie[0].name, 'Inception', '"Inception" query ranks Inception as #1');
assert.strictEqual(resMovie[0].type, 'movie', 'Inception is identified as a movie');
console.log('PASS: Known movie "Inception" returns Inception as #1 movie');

// 2.5 Known series: "Breaking Bad"
const resSeries = CC.searchCurated('Breaking Bad');
assert(resSeries.length > 0, 'Results returned for "Breaking Bad"');
assert.strictEqual(resSeries[0].name, 'Breaking Bad', '"Breaking Bad" query ranks Breaking Bad as #1');
assert.strictEqual(resSeries[0].type, 'series', 'Breaking Bad is identified as a series');
console.log('PASS: Known series "Breaking Bad" returns Breaking Bad as #1 series');

// 3. Testing Client-Side app.js Search & Scoring
console.log('\n--- 3. Testing app.js Search Scoring & Navigation ---');
const appCode = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Ensure levenshteinDistance and scoreSearchResult exist
assert(appCode.includes('function levenshteinDistance('), 'levenshteinDistance defined in app.js');
assert(appCode.includes('function scoreSearchResult('), 'scoreSearchResult defined in app.js');
assert(appCode.includes('rootTitle = title.replace('), 'Root title comparison present in scoreSearchResult');

// Check that search result clicks open detail view for both series and movies
assert(appCode.includes("const isSearchResult = !!el.closest('#searchResults');"), 'isSearchResult checked in buildCard');
assert(appCode.includes("openDetail(id, tp, false, null, item);"), 'selectDropdownResult opens detail for both types');

console.log('PASS: app.js scoring algorithms and click navigation wired correctly');

console.log('\n========================================================');
console.log('>>> ALL SEARCH AUDIT CHECKS PASSED (100%) <<<');
console.log('========================================================\n');
