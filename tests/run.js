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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
