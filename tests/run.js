'use strict';
/* Node test harness for services/media-links.js + architecture guards. No deps. */
const fs = require('fs');
const path = require('path');
const ML = require('../services/media-links.js');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

/* --- streaming helpers --- */
check('movie embed exact', ML.getMovieStreamUrl({ imdb: 'tt23779058' }) === 'https://vaplayer.ru/embed/movie/tt23779058');
check('movie embed missing → null', ML.getMovieStreamUrl({}) === null);
check('movie embed bad id → null', ML.getMovieStreamUrl({ imdb: 'xyz' }) === null);
check('movie embed null → null', ML.getMovieStreamUrl(null) === null);
check('episode embed exact', ML.getEpisodeStreamUrl({ tmdbId: 205715 }, 1, 1) === 'https://vaplayer.ru/embed/tv/205715/1/1');
check('episode embed string ids', ML.getEpisodeStreamUrl({ tmdbId: '1399' }, '2', '3') === 'https://vaplayer.ru/embed/tv/1399/2/3');
check('episode missing season → null', ML.getEpisodeStreamUrl({ tmdbId: 1399 }, null, 1) === null);
check('episode missing ep → null', ML.getEpisodeStreamUrl({ tmdbId: 1399 }, 1, 0) === null);
check('episode missing tmdb → null', ML.getEpisodeStreamUrl({}, 1, 1) === null);
check('episode zero/negative → null', ML.getEpisodeStreamUrl({ tmdbId: 1 }, -1, 1) === null);

/* --- download queries --- */
check('movie query plain', ML.getMovieDownloadSearch({ title: 'Interstellar' }) === 'Interstellar');
check('movie query spaces collapsed', ML.getMovieDownloadSearch({ title: '  The   Dark Knight  ' }) === 'The Dark Knight');
check('movie query Arabic preserved', ML.getMovieDownloadSearch({ title: 'الهيبة' }) === 'الهيبة');
check('movie query apostrophe', ML.getMovieDownloadSearch({ title: "Schindler's List" }) === "Schindler's List");
check('movie query punctuation', ML.getMovieDownloadSearch({ title: 'Spider-Man: No Way Home' }) === 'Spider-Man: No Way Home');
check('movie query keeps year in title', ML.getMovieDownloadSearch({ title: 'Blade Runner 2049' }) === 'Blade Runner 2049');
check('movie query strips [tags]', ML.getMovieDownloadSearch({ title: 'Dune [1080p] [BluRay]' }) === 'Dune');
check('movie query missing → empty', ML.getMovieDownloadSearch({}) === '');
check('episode query S01E03', ML.getEpisodeDownloadSearch({ title: 'Breaking Bad' }, 1, 3) === 'Breaking Bad S01E03');
check('episode query pads S12E10', ML.getEpisodeDownloadSearch({ title: 'Breaking Bad' }, 12, 10) === 'Breaking Bad S12E10');
check('episode query Arabic', ML.getEpisodeDownloadSearch({ title: 'الهيبة' }, 1, 2) === 'الهيبة S01E02');
check('episode query season-only fallback', ML.getEpisodeDownloadSearch({ title: 'Breaking Bad' }, 2, null) === 'Breaking Bad Season 2');
check('episode query no numbers → title', ML.getEpisodeDownloadSearch({ title: 'Breaking Bad' }) === 'Breaking Bad');
check('episode query no title → empty', ML.getEpisodeDownloadSearch({}, 1, 1) === '');

/* --- omnisave URL --- */
check('omnisave base has utm', ML.omnisaveUrl('') === 'https://videodownloader.site/?utm_source=MB_Website');
const ou = ML.omnisaveUrl('Breaking Bad S01E03');
check('omnisave q encoded', ou === 'https://videodownloader.site/?utm_source=MB_Website&q=Breaking%20Bad%20S01E03', ou);
const ar = ML.omnisaveUrl('الهيبة S01E02');
check('omnisave arabic encoded', ar.startsWith('https://videodownloader.site/?utm_source=MB_Website&q=') && ar.includes('%D8%A7'), ar);
const ap = ML.omnisaveUrl("Schindler's List");
check('omnisave apostrophe preserved+encoded', ap === 'https://videodownloader.site/?utm_source=MB_Website&q=Schindler%27s%20List' || ap === 'https://videodownloader.site/?utm_source=MB_Website&q=Schindler\'s%20List', ap);

/* --- download servers (VidVault & 02MovieDownloader) --- */
check('vidvault movie exact', ML.getVidVaultMovieUrl('tt0816692') === 'https://vidvault.to/movie/tt0816692');
check('vidvault episode exact', ML.getVidVaultEpisodeUrl('tt5071412', 1, 1) === 'https://vidvault.to/tv/tt5071412/1/1');
check('vidvault movie object input', ML.getVidVaultMovieUrl({ imdb: 'tt0816692' }) === 'https://vidvault.to/movie/tt0816692');
check('vidvault bad id → null', ML.getVidVaultMovieUrl('invalid') === null);
check('vidvault episode missing params → null', ML.getVidVaultEpisodeUrl('tt5071412', null, 1) === null);
check('02moviedownloader movie exact', ML.get02MovieDownloaderMovieUrl('tt0468569') === 'https://02moviedownloader.site/api/download/movie/tt0468569');
check('02moviedownloader episode exact', ML.get02MovieDownloaderEpisodeUrl('tt5071412', 1, 1) === 'https://02moviedownloader.site/api/download/tv/tt5071412/1/1');
check('02moviedownloader bad id → null', ML.get02MovieDownloaderMovieUrl('') === null);

/* --- architecture guards: single provider, no direct downloads --- */
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bannedStreaming = ['vidlink.pro', 'vidsrc', 'torrentio.strem.fun', 'webtor.io', 'webtorrent', 'magnet:?xt='];
bannedStreaming.forEach((t) => {
  check(`no second provider: ${t}`, !app.includes(t) && !html.includes(t));
});
check('vaplayer movie embed used', app.includes('https://vaplayer.ru/embed/movie/') || fs.readFileSync(path.join(__dirname, '..', 'services', 'media-links.js'), 'utf8').includes('vaplayer.ru'));
check('no direct-download engine', !/getBlob|createObjectURL|createReadStream|torrent\.destroy|client\.add\(/.test(app));
check('no download modal markup', !html.includes('dlBackdrop') && !html.includes('mp4Backdrop'));
check('no torrent UI copy', !/torrentio|magnet|WebRTC/i.test(html));
check('omnisave linked', app.includes('openOmnisave') && fs.readFileSync(path.join(__dirname, '..', 'services', 'media-links.js'), 'utf8').includes('videodownloader.site'));

/* --- catalog scale & deduplication guards --- */
const CC = require('../services/curated-catalog.js');
const allMedia = CC.CURATED_MEDIA;
check('catalog scale > 80,000', allMedia.length >= 80000, allMedia.length);

const allIds = new Set();
let dupIdCount = 0;
for (const m of allMedia) {
  if (allIds.has(m.id)) dupIdCount++;
  allIds.add(m.id);
}
check('zero duplicate IDs across entire catalog', dupIdCount === 0, dupIdCount);

const allTitles = new Set();
let dupTitleCount = 0;
for (const m of allMedia) {
  const norm = m.name.toLowerCase().trim();
  if (allTitles.has(norm)) dupTitleCount++;
  allTitles.add(norm);
}
check('zero duplicate titles across entire catalog', dupTitleCount === 0, dupTitleCount);

/* --- series seasons & no season 0 guards --- */
const reacher = allMedia.find(m => m.name.toLowerCase() === 'reacher');
check('reacher exists in catalog', !!reacher);
const reacherVids = CC.getSeriesVideos(reacher);
const reacherSeasons = [...new Set(reacherVids.map(v => v.season))];
check('reacher has all 4 seasons', reacherSeasons.length === 4 && reacherSeasons.includes(4), reacherSeasons);
check('reacher has zero season 0', !reacherVids.some(v => v.season === 0));

const ozark = allMedia.find(m => m.name.toLowerCase() === 'ozark');
check('ozark exists in catalog', !!ozark);
const ozarkVids = CC.getSeriesVideos(ozark);
const ozarkSeasons = [...new Set(ozarkVids.map(v => v.season))];
check('ozark has all 4 seasons', ozarkSeasons.length === 4, ozarkSeasons);
check('ozark has zero season 0', !ozarkVids.some(v => v.season === 0));

/* --- i18n & ui guards --- */
const requiredLangs = ['en', 'fr', 'es', 'ru', 'ar', 'hi', 'pt'];
const i18nMatch = app.match(/const I18N_TRANSLATIONS = \{([\s\S]*?)\n\};/);
check('i18n translations dictionary present', !!i18nMatch);
if (i18nMatch) {
  requiredLangs.forEach(lang => {
    check(`i18n supports ${lang}`, app.includes(`'${lang}':`) || app.includes(`${lang}:`));
  });
}
check('settingAppLang exists in index.html', html.includes('id="settingAppLang"'));
check('no blur focus theft of player', !app.includes('document.body?.focus()') && !app.includes('document.body.focus()'));

/* --- cinematic cover & category priority guards --- */
check('generateCinematicCover exists', typeof CC.generateCinematicCover === 'function');
const sampleCover = CC.generateCinematicCover('Test Movie', 'Action', 2024, '8.5', 'movie');
check('generateCinematicCover returns svg data uri', typeof sampleCover === 'string' && sampleCover.startsWith('data:image/svg+xml'));

const actionItems = CC.getCuratedForCategory('action');
check('action category returns items', actionItems.length > 0);
check('action category prioritizes real curated items first', !actionItems[0]._isProcedural);

const searchResults = CC.searchCurated('break');
check('searchCurated prioritizes real curated titles first', searchResults.length > 0 && !searchResults[0]._isProcedural);

const wednesday = allMedia.find(m => m.name.toLowerCase() === 'wednesday');
check('wednesday exists in catalog', !!wednesday);
if (wednesday) {
  const vids = CC.getSeriesVideos(wednesday);
  check('wednesday has zero season 0', !vids.some(v => v.season === 0));
}

const prisonBreak = allMedia.find(m => m.name.toLowerCase() === 'prison break');
check('prison break exists in catalog', !!prisonBreak);
if (prisonBreak) {
  const vids = CC.getSeriesVideos(prisonBreak);
  const pbSeasons = [...new Set(vids.map(v => v.season))];
  check('prison break has 5 seasons', pbSeasons.length === 5, pbSeasons);
}

check('app has createPosterFallback', app.includes('function createPosterFallback'));
check('no raw %20 in card fallback', !app.includes('${encodeURIComponent((m.name || \'?\').slice(0, 18))}'));

/* --- popunder & ad blocking guards --- */
check('player iframe has no sandbox (allows playback)', !app.includes("f.setAttribute('sandbox'"));
check('player iframe has referrerpolicy origin', app.includes("f.setAttribute('referrerpolicy', 'origin')"));
check('armVidShield called in playEmbed', app.includes('armVidShield()'));
check('vidShield styled in styles.css', fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').includes('#vidShield'));
check('global window.open popup trap present', app.includes('window.open = function(url, target, features)'));
check('self.open popup trap present', app.includes('self.open = window.open'));
check('navigation lock beforeunload present', app.includes('_allowNavigation'));
check('focus snap on blur/visibilitychange present', app.includes("'visibilitychange'") && app.includes("window.focus()"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

