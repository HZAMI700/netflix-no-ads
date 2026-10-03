/* Netflix-style Stremio + Torrentio portal — 100% client-side */
const CINEMETA = 'https://v3-cinemeta.strem.io';
const TORRENTIO = 'https://torrentio.strem.fun';
const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://9.rarbg.com:2810/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce'
].map(t => 'tr=' + encodeURIComponent(t)).join('&');

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
let myList = store.get('nf_mylist', []);
let history = store.get('nf_history', {});   // id -> {progress, type, title, poster}
let likes = store.get('nf_likes', {});
let heroItems = [], heroIdx = 0, heroTimer = null;
let currentDetail = null;   // {meta, type, streams, ep:{s,e}}
let currentStream = null;

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- NAV / ROUTER ---------- */
const pages = { home: $('homePage'), search: $('searchPage'), mylist: $('mylistPage'), browse: $('browsePage'), profiles: $('profilesPage'), settings: $('settingsPage') };
function show(name) {
  Object.entries(pages).forEach(([k, el]) => el.classList.toggle('show', k === name || (name === 'home' && k === 'home')));
  if (name === 'home') { $('homePage').style.display = ''; Object.values(pages).forEach(p => { if (p !== pages.home) p.classList.remove('show'); }); }
  else { $('homePage').style.display = 'none'; }
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault(); $('profileMenu').classList.remove('open');
  const n = a.dataset.nav;
  if (n === 'movies') openBrowse('movies'); else if (n === 'series') openBrowse('series');
  else if (n === 'new') openBrowse('new'); else show(n === 'home' ? 'home' : n);
  if (n === 'mylist') renderMyList(); if (n === 'profiles') renderProfiles(); if (n === 'settings') renderAddons();
}));
$('logo') && 0;
window.addEventListener('scroll', () => $('topnav').classList.toggle('scrolled', window.scrollY > 0));
$('avatarBtn').onclick = () => $('profileMenu').classList.toggle('open');
$('signOut').onclick = e => { e.preventDefault(); show('profiles'); renderProfiles(); };
$('bellBtn').onclick = () => toast('No new notifications');
$('browseBtn').onclick = () => openBrowse('movies');

/* search */
$('searchBtn').onclick = () => { $('searchWrap').classList.toggle('open'); if ($('searchWrap').classList.contains('open')) $('searchInput').focus(); else { show('home'); } };
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(e.target.value); });
$('searchGo').onclick = () => doSearch($('searchBox').value);
$('searchBox').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(e.target.value); });
async function doSearch(q) {
  q = (q || '').trim(); if (!q) return;
  show('search'); $('searchTitle').textContent = `Results for "${q}"`;
  $('searchResults').innerHTML = skels(6);
  try {
    const [m, s] = await Promise.all([
      fetch(`${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(q)}.json`).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/series/top/search=${encodeURIComponent(q)}.json`).then(r => r.json()).catch(() => ({ metas: [] }))
    ]);
    const all = [...(m.metas || []), ...(s.metas || [])];
    $('searchResults').innerHTML = all.length ? '' : `<div class="empty" style="grid-column:1/-1"><h2>Your search for "${q}" did not have any matches.</h2><p>Try different keywords, a title, actor, director, or genre.</p></div>`;
    all.forEach(meta => $('searchResults').appendChild(buildCard(meta)));
  } catch { $('searchResults').innerHTML = '<p style="color:#888">Search failed. Check connection.</p>'; }
}

/* ---------- FETCH HELPERS ---------- */
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw 0; return r.json(); }
const poster = m => m.poster || m.background || '';
const backdrop = m => m.background || m.poster || '';
function matchScore(m) { const r = parseFloat(m.imdbRating); if (!r || isNaN(r)) return 97; return Math.min(99, Math.round(r * 10)); }
function ageRating(m) { return m.certification || (m.type === 'series' ? 'TV-MA' : 'PG-13'); }
function metaRowHTML(m) {
  return `<span class="match">${matchScore(m)}% Match</span><span>${(m.releaseInfo || m.year || '').toString().slice(0, 4)}</span><span class="age-badge">${ageRating(m)}</span><span>${m.runtime || (m.type === 'series' ? (m.videos ? m.videos.length + ' Episodes' : '1 Season') : '2h')}</span><span class="hd-badge">HD</span>`;
}

/* ---------- HOME ROWS ---------- */
const ROWS = [
  { id: 'continue', title: 'Continue Watching for You', dynamic: 'history' },
  { id: 'mylist', title: 'My List', dynamic: 'mylist' },
  { id: 'trending', title: 'Trending Now', url: ['movie/top', 'series/top'], mix: true },
  { id: 'movies', title: 'Popular Movies', url: ['movie/top'] },
  { id: 'series', title: 'Popular TV Shows', url: ['series/top'] },
  { id: 'toprated', title: 'IMDb Top Rated', url: ['movie/imdbRating'] },
  { id: 'new', title: 'New Releases', url: ['movie/year'], badge: 'NEW' },
  { id: 'action', title: 'Action & Adventure', url: ['movie/top'], genre: 'Action' },
  { id: 'comedy', title: 'Comedies', url: ['movie/top'], genre: 'Comedy' },
  { id: 'doc', title: 'Documentaries', url: ['movie/top'], genre: 'Documentary' }
];
let catalogCache = {};
async function fetchCatalog(spec) {
  const key = spec; if (catalogCache[key]) return catalogCache[key];
  const d = await getJSON(`${CINEMETA}/catalog/${spec}.json`).catch(() => ({ metas: [] }));
  catalogCache[key] = (d.metas || []); return catalogCache[key];
}
function skels(n) { return Array.from({ length: n }, () => '<div class="skel"></div>').join(''); }

async function buildHome() {
  const wrap = $('rows'); wrap.innerHTML = ROWS.map(r => `<div class="row-sec" id="row-${r.id}" style="display:none"><div class="row-head"><h2>${r.title}</h2><div class="row-dots"></div></div><div class="row-outer"><button class="row-arrow left">‹</button><div class="row-track"></div><button class="row-arrow right">›</button></div></div>`).join('');
  wrap.querySelectorAll('.row-arrow').forEach(b => b.onclick = () => {
    const t = b.parentElement.querySelector('.row-track');
    t.scrollBy({ left: (b.classList.contains('right') ? 1 : -1) * t.clientWidth * 0.9, behavior: 'smooth' });
  });
  wrap.querySelectorAll('.row-track').forEach(t => t.addEventListener('scroll', () => {
    const pages = Math.max(1, Math.ceil(t.scrollWidth / t.clientWidth));
    const cur = Math.min(pages - 1, Math.round(t.scrollLeft / t.clientWidth));
    const dots = t.closest('.row-sec').querySelector('.row-dots');
    if (dots && dots.childElementCount !== pages) dots.innerHTML = Array.from({ length: pages }, (_, k) => `<span class="${k === cur ? 'on' : ''}"></span>`).join('');
    else if (dots) dots.querySelectorAll('span').forEach((s, k) => s.classList.toggle('on', k === cur));
  }, { passive: true }));
  // hero
  try {
    const top = await fetchCatalog('movie/top');
    heroItems = top.slice(0, 7); renderHero(0);
    heroTimer = setInterval(() => renderHero((heroIdx + 1) % heroItems.length), 8000);
  } catch { $('heroTitle').textContent = 'Unavailable offline'; }
  // rows
  let shown = 0;
  for (const r of ROWS) {
    const sec = $('row-' + r.id), track = sec.querySelector('.row-track');
    let items = [];
    if (r.dynamic === 'history') {
      items = historyItems();
    } else if (r.dynamic === 'mylist') {
      items = myList;
    } else {
      let pool = [];
      for (const u of r.url) pool = pool.concat(await fetchCatalog(u));
      if (r.mix) pool = pool.sort(() => Math.random() - .5);
      if (r.genre) pool = pool.filter(m => (m.genres || []).includes(r.genre));
      items = pool.slice(0, 18);
      if (r.id === 'new') items = pool.slice().sort((a, b) => parseInt(b.releaseInfo || 0) - parseInt(a.releaseInfo || 0)).slice(0, 18);
    }
    if (!items.length) continue;
    sec.style.display = '';
    sec.classList.add('enter');
    sec.style.animationDelay = (shown++ * 80) + 'ms';
    track.innerHTML = '';
    items.forEach(m => track.appendChild(buildCard(m, r.badge)));
    track.dispatchEvent(new Event('scroll'));
  }
}

function buildCard(m, badge) {
  const type = m.type || (m.id && m.id.startsWith('tt') ? 'movie' : 'movie');
  const el = document.createElement('div');
  el.className = 'card expandable';
  const prog = m._progress ? `<div class="progress"><i style="width:${Math.round(m._progress * 100)}%"></i></div>` : '';
  const rm = (m._progress || badge === undefined && false) ? '' : '';
  el.innerHTML = `${badge ? `<span class="new-badge">${badge}</span>` : ''}${m._progress ? `<span class="remove-x" title="Remove">✕</span>` : ''}<img loading="lazy" src="${poster(m)}" alt="${(m.name || '').replace(/"/g, '')}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%23222%22/><text x=%2250%25%22 y=%2250%25%22 fill=%22%23888%22 text-anchor=%22middle%22>${encodeURIComponent((m.name || '?').slice(0, 18))}</text></svg>'">
    ${prog}
    <div class="hover-pop"><div class="hbtns"><button class="cbtn solid" data-a="play">▶</button><button class="cbtn" data-a="list">＋</button><button class="cbtn" data-a="like">👍</button><span style="flex:1"></span><button class="cbtn" data-a="info">ⓘ</button></div>
    <div class="hm"><span class="match">${matchScore(m)}% Match</span><span class="age-badge">${ageRating(m)}</span><span>${(m.releaseInfo || '').toString().slice(0, 4)}</span></div>
    <div class="hm" style="margin-top:4px">${(m.genres || []).slice(0, 3).join(' • ')}</div></div>`;
  el.onclick = e => {
    // Continue-Watching cards from player progress resume directly.
    if (m._vidlink) { playVidlinkEntry(m); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    const rx = e.target.closest('.remove-x');
    if (rx) { delete history[m.id]; store.set('nf_history', history); buildHome(); e.stopPropagation(); return; }
    const id = m.id, tp = m.type || type;
    if (a === 'play') openDetail(id, tp, true);
    else if (a === 'list') toggleList(m);
    else if (a === 'like') { likes[id] = !likes[id]; store.set('nf_likes', likes); toast(likes[id] ? 'Rated: I like this' : 'Rating removed'); }
    else openDetail(id, tp, false);
  };
  return el;
}

/* ---------- HERO ---------- */
function renderHero(i) {
  heroIdx = i; const m = heroItems[i]; if (!m) return;
  const bg = $('heroBg'); bg.style.opacity = 0;
  bg.style.animation = 'none'; void bg.offsetWidth; bg.style.animation = '';
  setTimeout(() => { bg.src = backdrop(m); bg.onload = () => bg.style.opacity = 1; setTimeout(() => bg.style.opacity = 1, 300); }, 200);
  const hc = document.querySelector('.hero-content');
  hc.style.animation = 'none'; void hc.offsetWidth; hc.style.animation = '';
  $('heroTitle').textContent = m.name;
  $('heroMeta').innerHTML = metaRowHTML(m);
  $('heroDesc').textContent = m.description || '';
  $('heroMaturity').textContent = ageRating(m);
  $('heroPlay').onclick = () => openDetail(m.id, m.type || 'movie', true);
  $('heroInfo').onclick = () => openDetail(m.id, m.type || 'movie', false);
  $('heroDots').innerHTML = heroItems.map((_, k) => `<span class="${k === i ? 'on' : ''}" data-k="${k}"></span>`).join('');
  $('heroDots').querySelectorAll('span').forEach(s => s.onclick = () => { clearInterval(heroTimer); renderHero(+s.dataset.k); heroTimer = setInterval(() => renderHero((heroIdx + 1) % heroItems.length), 8000); });
}
$('heroNext').onclick = () => renderHero((heroIdx + 1) % heroItems.length);

/* ---------- DETAIL MODAL ---------- */
async function openDetail(id, type, autoplay) {
  type = type === 'series' ? 'series' : 'movie';
  $('detailBackdrop').classList.add('show'); document.body.style.overflow = 'hidden';
  $('streamList').innerHTML = '<p style="color:#888">Loading streams…</p>';
  $('dTitle').textContent = 'Loading…'; $('dDesc').textContent = '';
  try {
    const j = await getJSON(`${CINEMETA}/meta/${type}/${id}.json`);
    const m = j.meta; m.type = type; currentDetail = { meta: m, type, streams: [], ep: { s: 1, e: 1 } };
    $('dBackdrop').src = backdrop(m);
    $('dTitle').textContent = m.name;
    $('dMeta').innerHTML = metaRowHTML(m);
    $('dDesc').textContent = m.description || '';
    $('dRight').innerHTML = `<div><b style="color:#777">Cast:</b> ${(m.cast || []).slice(0, 6).join(', ') || '—'}</div><br><div><b style="color:#777">Genres:</b> ${(m.genres || []).join(', ')}</div><br><div><b style="color:#777">This show is:</b> ${(m.genres || []).join(', ')}</div>`;
    $('dAbout').innerHTML = `<b>About ${m.name}:</b><div><span>Director: </span>${m.director || '—'}</div><div><span>Cast: </span>${(m.cast || []).join(', ') || '—'}</div><div><span>Genres: </span>${(m.genres || []).join(', ')}</div>`;
    // episodes
    const vids = m.videos || [];
    if (type === 'series' && vids.length) {
      $('epWrap').style.display = '';
      const seasons = [...new Set(vids.map(v => v.season))].sort((a, b) => a - b);
      $('seasonSel').innerHTML = seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');
      const renderEps = () => {
        const s = +$('seasonSel').value; currentDetail.ep.s = s;
        $('epList').innerHTML = '';
        vids.filter(v => v.season === s).forEach(v => {
          const d = document.createElement('div'); d.className = 'ep-card';
          d.innerHTML = `<div class="ep-thumb"><img src="${v.thumbnail || m.background || m.poster}"><div class="ep-play"><i>▶</i></div></div><div style="flex:1"><b>${v.episode}. ${v.title || v.name || 'Episode ' + v.episode}</b><div style="color:#888;font-size:12px;margin-top:4px">${v.released || ''}</div><div style="color:#bbb;font-size:12px;margin-top:4px">${(v.overview || '').slice(0, 140)}</div></div><span style="color:#888">${v.runtime || ''}</span>`;
          d.onclick = () => {
            currentDetail.ep = { s: v.season, e: v.episode };
            const tmdbId = currentDetail.meta.moviedb_id;
            if (!tmdbId) { toast('Streaming is unavailable for this title.'); return; }
            playVidlink({ tmdbId, type: 'series', season: v.season, episode: v.episode, title: currentDetail.meta.name });
          };
          $('epList').appendChild(d);
        });
      };
      $('seasonSel').onchange = renderEps; $('seasonSel').value = seasons[0]; renderEps();
    } else $('epWrap').style.display = 'none';
    // similar
    $('simGrid').innerHTML = '';
    (await fetchCatalog(type + '/top')).filter(x => x.id !== id && (x.genres || []).some(g => (m.genres || []).includes(g))).slice(0, 6).forEach(s => {
      const d = document.createElement('div'); d.className = 'sim';
      d.innerHTML = `<img src="${backdrop(s)}"><div>${s.name}</div>`;
      d.onclick = () => openDetail(s.id, s.type || type, false);
      $('simGrid').appendChild(d);
    });
    $('dList').textContent = myList.some(x => x.id === id) ? '✓' : '＋';
    $('dList').onclick = () => toggleList(m);
    $('dLike').onclick = () => toast('Thanks for rating!');
    $('dPlay').onclick = () => loadStreams(true);
    $('dDl').onclick = () => openDownload(currentStream || (currentDetail.streams[0]));
    await loadStreams(autoplay);
  } catch { $('dTitle').textContent = 'Failed to load title'; }
}
function parseStream(s) {
  const name = (s.name || '') + '\n' + (s.title || '');
  const q = /2160|4k/i.test(name) ? 2160 : /1080/i.test(name) ? 1080 : /720/i.test(name) ? 720 : /480/i.test(name) ? 480 : 0;
  const seedM = name.match(/👤\s*(\d+)/) || name.match(/(\d+)\s*seed/i);
  const seeds = seedM ? +seedM[1] : 0;
  const sizeM = name.match(/💾\s*([\d.]+\s*\w+)/) || name.match(/(\d+\.?\d*\s*(GB|MB))/i);
  const size = sizeM ? sizeM[0] : (s.behaviorHints?.videoSize ? (s.behaviorHints.videoSize / 1e9).toFixed(2) + ' GB' : '—');
  const prov = (s.name || '').split('\n')[0] || 'Torrentio';
  return { q, seeds, size, prov, file: s.behaviorHints?.filename || s.title || 'stream' };
}
async function loadStreams(autoplay) {
  const { meta, type, ep } = currentDetail;
  const imdb = meta.id || meta.imdb_id;
  const url = type === 'movie' ? `${TORRENTIO}/stream/movie/${imdb}.json` : `${TORRENTIO}/stream/series/${imdb}:${ep.s}:${ep.e}.json`;
  try {
    const j = await getJSON(url);
    currentDetail.streams = (j.streams || []).map(s => ({ ...s, _p: parseStream(s) }));
    renderStreams();
    if (autoplay && currentDetail.streams.length) playStream(currentDetail.streams[0]);
    else if (!currentDetail.streams.length) $('streamList').innerHTML = '<p style="color:#888">No streams found for this title/episode. Try another episode or open in Stremio.</p>';
  } catch { $('streamList').innerHTML = '<p style="color:#888">Stream lookup failed (network/CORS). Try again.</p>'; }
}
function qLabel(q) { return q >= 2160 ? '4K' : q >= 1080 ? '1080p' : q >= 720 ? '720p' : q >= 480 ? '480p' : 'CAM'; }
function qClass(q) { return q >= 2160 ? 'q-4k' : q >= 1080 ? 'q-1080' : q >= 720 ? 'q-720' : q >= 480 ? 'q-480' : 'q-cam'; }
function renderStreams() {
  const minQ = +$('sortSel') ? 0 : 0;
  const q = +$('qSel').value, minS = +$('sSel').value, sort = $('sortSel').value;
  let arr = currentDetail.streams.filter(s => s._p.q >= q && s._p.seeds >= minS);
  arr.sort((a, b) => sort === 'seeders' ? b._p.seeds - a._p.seeds : sort === 'size' ? (parseFloat(a._p.size) || 9e9) - (parseFloat(b._p.size) || 9e9) : b._p.q - a._p.q || b._p.seeds - a._p.seeds);
  $('streamList').innerHTML = '';
  arr.slice(0, 40).forEach(s => {
    const d = document.createElement('div'); d.className = 'stream-card';
    const seedC = s._p.seeds > 50 ? 'seed-hi' : s._p.seeds >= 10 ? 'seed-mid' : 'seed-lo';
    d.innerHTML = `<span class="qbadge ${qClass(s._p.q)}">${qLabel(s._p.q)}</span><div class="smeta"><div class="fn">${s._p.file}</div><div class="ss"><span class="${seedC}">👤 ${s._p.seeds} seeders</span> · 💾 ${s._p.size} · ${s._p.prov}</div></div>`;
    const pb = document.createElement('button'); pb.className = 'btn-red'; pb.textContent = '▶ Play'; pb.onclick = () => playStream(s);
    const db = document.createElement('button'); db.className = 'btn-out'; db.textContent = '⬇'; db.title = 'Download MP4'; db.onclick = () => startMP4Download(s);
    const wrap = document.createElement('div'); wrap.className = 'sbtns'; wrap.append(pb, db);
    d.appendChild(wrap); $('streamList').appendChild(d);
  });
  if (!arr.length) $('streamList').innerHTML = '<p style="color:#888">No streams match filters.</p>';
}
['sortSel', 'qSel', 'sSel'].forEach(id => $(id).onchange = renderStreams);
$('dClose').onclick = closeDetail;
$('detailBackdrop').addEventListener('click', e => { if (e.target.id === 'detailBackdrop') closeDetail(); });
function closeDetail() { $('detailBackdrop').classList.remove('show'); document.body.style.overflow = ''; }

/* ---------- MY LIST ---------- */
function toggleList(m) {
  const i = myList.findIndex(x => x.id === m.id);
  if (i >= 0) { myList.splice(i, 1); toast('Removed from My List'); }
  else { myList.push({ id: m.id, type: m.type || 'movie', name: m.name, poster: poster(m), background: backdrop(m), genres: m.genres || [], releaseInfo: m.releaseInfo }); toast('Added to My List'); }
  store.set('nf_mylist', myList);
  if ($('dTitle') && currentDetail?.meta.id === m.id) $('dList').textContent = i >= 0 ? '＋' : '✓';
  if (pages.mylist.classList.contains('show')) renderMyList();
}
function renderMyList() {
  const g = $('mylistGrid'); g.innerHTML = '';
  if (!myList.length) { g.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Your List is Empty</h2><p>Add movies and shows to your list and they will appear here.</p><br><button class="btn-red" onclick="document.querySelector('[data-nav=home]').click()">Find Something to Watch</button></div>`; return; }
  myList.forEach(m => g.appendChild(buildCard(m)));
}

/* ---------- BROWSE ---------- */
async function openBrowse(kind) {
  show('browse');
  const titles = { movies: 'Movies', series: 'TV Shows', new: 'New & Popular' };
  $('browseTitle').textContent = titles[kind];
  $('browseGrid').innerHTML = skels(12);
  const spec = kind === 'series' ? 'series/top' : kind === 'new' ? 'movie/year' : 'movie/top';
  const items = await fetchCatalog(spec);
  $('browseGrid').innerHTML = '';
  items.slice(0, 60).forEach(m => $('browseGrid').appendChild(buildCard(m)));
}

/* ---------- PROFILES / ADDONS ---------- */
function renderProfiles() {
  const av = $('avatars'); av.innerHTML = '';
  [['N', '#E50914', 'You'], ['K', '#1f6feb', 'Kids'], ['G', '#238636', 'Guest']].forEach(([l, c, n]) => {
    const d = document.createElement('div'); d.className = 'pav';
    d.innerHTML = `<div class="box" style="background:${c}">${l}</div><div>${n}</div>`;
    d.onclick = () => { $('avatarBtn').textContent = l; show('home'); toast(`Switched to ${n}`); };
    av.appendChild(d);
  });
}
const DEFAULT_ADDONS = [
  { name: 'Cinemeta', url: CINEMETA + '/manifest.json', info: 'Metadata + catalogs' },
  { name: 'Torrentio', url: TORRENTIO + '/manifest.json', info: 'Torrent streams (10+ providers)' },
  { name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json', info: 'Subtitles' }
];
function renderAddons() {
  const custom = store.get('nf_addons', []);
  $('addonList').innerHTML = '';
  [...DEFAULT_ADDONS.map(a => ({ ...a, locked: true })), ...custom].forEach(a => {
    const d = document.createElement('div'); d.className = 'stream-card';
    d.innerHTML = `<div class="smeta"><div class="fn">${a.name}</div><div class="ss">${a.url} — ${a.info || ''}</div></div>`;
    if (!a.locked) { const b = document.createElement('button'); b.className = 'btn-out'; b.textContent = 'Remove'; b.onclick = () => { store.set('nf_addons', store.get('nf_addons', []).filter(x => x.url !== a.url)); renderAddons(); }; d.appendChild(b); }
    else { const s = document.createElement('span'); s.style.cssText = 'color:#46D369;font-size:12px'; s.textContent = '● Active'; d.appendChild(s); }
    $('addonList').appendChild(d);
  });
}
$('addAddon').onclick = () => {
  const u = $('customAddon').value.trim(); if (!u) return;
  const arr = store.get('nf_addons', []); arr.push({ name: 'Custom addon', url: u, info: 'User-added' });
  store.set('nf_addons', arr); $('customAddon').value = ''; renderAddons(); toast('Addon added');
};
$('clearData').onclick = () => { myList = []; history = {}; store.set('nf_mylist', []); store.set('nf_history', {}); toast('Cleared'); renderMyList(); };

/* ---------- DOWNLOAD ---------- */
function magnet(s) {
  if (!s?.infoHash) return '';
  return `magnet:?xt=urn:btih:${s.infoHash}&dn=${encodeURIComponent(s._p?.file || 'download')}&${TRACKERS}`;
}
function openDownload(s) {
  if (!s) { toast('Open a title first to see streams'); return; }
  currentStream = s;
  $('dlFile').textContent = `${s._p?.file || ''} · ${s._p?.size || ''} · ${qLabel(s._p?.q || 0)}`;
  $('dlBackdrop').classList.add('show');
}
$('dlClose').onclick = () => $('dlBackdrop').classList.remove('show');
$('dlCopy').onclick = async () => { await navigator.clipboard.writeText(magnet(currentStream)).catch(() => {}); toast('Magnet link copied'); };
$('dlHash').onclick = async () => { await navigator.clipboard.writeText(currentStream.infoHash || '').catch(() => {}); toast('Hash copied'); };
$('dlTorrent').onclick = () => { if (currentStream?.infoHash) window.open(`https://itorrents.org/torrent/${currentStream.infoHash.toUpperCase()}.torrent`, '_blank'); };
$('dlStremio').onclick = () => { const m = currentDetail?.meta; if (m) window.open(`stremio:///detail/${m.type}/${m.id}`, '_blank'); };
$('pDl').onclick = () => openDownload(currentStream);
$('dlMP4').onclick = () => startMP4Download(currentStream);

/* ---------- DIRECT MP4 DOWNLOAD (video file, not .torrent) ---------- */
let dlState = null; // { client, torrent, url, name, timer }
let dlLastStream = null;
const WT_CDNS = [
  'https://cdn.jsdelivr.net/npm/webtorrent@2/dist/webtorrent.min.js',
  'https://unpkg.com/webtorrent@2/dist/webtorrent.min.js',
  'https://cdn.jsdelivr.net/npm/webtorrent@2.8.5/dist/webtorrent.min.js'
];
let wtLoading = null;
/* Guarantees the download engine is loaded, trying mirror CDNs in turn */
function ensureWebTorrent() {
  if (window.WebTorrent) return Promise.resolve();
  if (wtLoading) return wtLoading;
  wtLoading = new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (window.WebTorrent) return resolve();
      if (i >= WT_CDNS.length) return reject(new Error('no-engine'));
      const s = document.createElement('script');
      s.src = WT_CDNS[i++];
      s.onload = () => (window.WebTorrent ? resolve() : next());
      s.onerror = next;
      document.head.appendChild(s);
      setTimeout(() => { if (!window.WebTorrent && s.parentNode) { s.remove(); next(); } }, 15000);
    };
    next();
  }).catch(e => { wtLoading = null; throw e; });
  return wtLoading;
}
function mp4Name(s) {
  const raw = String(s?._p?.file || s?.behaviorHints?.filename || 'video').split('/').pop();
  const base = raw.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim().slice(0, 120) || 'video';
  return base + '.mp4';
}
function pickVideoFile(t, idx) {
  if (typeof idx === 'number' && t.files[idx]) return t.files[idx];
  const vids = t.files.filter(f => /\.(mp4|mkv|avi|mov|webm|m4v)$/i.test(f.name));
  const pool = vids.length ? vids : t.files;
  return pool.reduce((a, b) => (a.length > b.length ? a : b));
}
function fmtSpeed(bps) {
  if (!bps || bps <= 0) return '0 KB/s';
  return bps > 1048576 ? (bps / 1048576).toFixed(2) + ' MB/s' : Math.round(bps / 1024) + ' KB/s';
}
function fmtETA(t, done, total, speed) {
  if (!speed || speed <= 0 || done >= total) return '';
  const s = Math.round((total - done) / speed);
  return s > 3600 ? ` · ETA ${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : s > 60 ? ` · ETA ${Math.floor(s / 60)}m ${s % 60}s` : ` · ETA ${s}s`;
}
function setMP4(pct, stats) {
  $('mp4Fill').style.width = Math.min(100, pct) + '%';
  $('mp4Stats').textContent = stats;
}
function triggerMP4Save() {
  if (!dlState?.url) return;
  const a = document.createElement('a');
  a.href = dlState.url; a.download = dlState.name;
  document.body.appendChild(a); a.click(); a.remove();
}
function cancelMP4() {
  if (dlState?.timer) clearTimeout(dlState.timer);
  try { dlState?.torrent?.destroy?.(); } catch { }
  try { dlState?.client?.destroy?.(); } catch { }
  dlState = null;
  $('mp4Backdrop').classList.remove('show');
}
async function startMP4Download(s) {
  if (!s?.infoHash) { toast('No torrent found for this stream'); return; }
  if (dlState) cancelMP4();
  dlLastStream = s;
  $('dlBackdrop').classList.remove('show');
  if ($('detailBackdrop').classList.contains('show')) closeDetail();
  const name = mp4Name(s);
  $('mp4Name').textContent = name;
  $('mp4Warn').style.display = 'none';
  $('mp4Done').style.display = 'none';
  $('mp4Cancel').style.display = '';
  setMP4(0, 'Connecting to peers…');
  $('mp4Backdrop').classList.add('show');
  $('mp4Magnet').onclick = async () => { await navigator.clipboard.writeText(magnet(s)).catch(() => {}); toast('Magnet link copied'); };
  $('mp4Stremio').onclick = () => { const m = currentDetail?.meta; if (m) window.open(`stremio:///detail/${m.type}/${m.id}`, '_blank'); };
  setMP4(0, 'Loading download engine…');
  $('mp4Retry').style.display = 'none';
  let client;
  try {
    await ensureWebTorrent();
    client = new WebTorrent();
  } catch { setMP4(0, 'Download engine failed to load. Check connection and retry.'); $('mp4Retry').style.display = ''; $('mp4Warn').style.display = ''; return; }
  const state = dlState = { client, torrent: null, url: null, name, timer: null };
  state.timer = setTimeout(() => {
    if (dlState === state && !state.done && (!state.torrent || (state.torrent.progress === 0 && state.torrent.numPeers === 0)))
      $('mp4Warn').style.display = '';
  }, 20000);
  try {
    const torrent = state.torrent = client.add(magnet(s), t => {
      const file = pickVideoFile(t, s.fileIdx);
      t.on('download', () => {
        if (dlState !== state || state.done) return;
        const pct = Math.round(t.progress * 100);
        setMP4(pct, `👥 ${t.numPeers} peers · ${fmtSpeed(t.downloadSpeed)} · ${pct}% of ${(file.length / 1073741824).toFixed(2)} GB${fmtETA(0, t.downloaded, file.length, t.downloadSpeed)}`);
      });
      t.on('done', () => {
        if (dlState !== state || state.done) return;
        state.done = true;
        setMP4(100, 'Assembling MP4 file…');
        file.getBlob((err, blob) => {
          if (dlState !== state) return;
          if (err || !blob) { setMP4(100, 'Could not assemble file. Try again or use the magnet link.'); $('mp4Warn').style.display = ''; return; }
          if (state.timer) clearTimeout(state.timer);
          state.url = URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
          triggerMP4Save();
          setMP4(100, `Complete — ${name} (${(blob.size / 1048576).toFixed(1)} MB)`);
          $('mp4Done').style.display = '';
          $('mp4Cancel').style.display = 'none';
          toast('MP4 download started');
        });
      });
    });
    torrent.on('error', () => { if (dlState === state && !state.done) { setMP4(0, 'Torrent error. Try another stream or use the magnet link.'); $('mp4Warn').style.display = ''; } });
  } catch { setMP4(0, 'Could not start download. Try another stream.'); $('mp4Warn').style.display = ''; }
}
$('mp4Save').onclick = triggerMP4Save;
$('mp4Retry').onclick = () => { if (dlLastStream) startMP4Download(dlLastStream); };
$('mp4Cancel').onclick = () => { cancelMP4(); toast('Download cancelled'); };
$('mp4Close').onclick = () => $('mp4Backdrop').classList.remove('show');

/* ---------- PLAYER ---------- */
let hideT = null;
function wakeChrome() {
  ['pTop', 'pBottom'].forEach(id => $(id).style.opacity = 1);
  clearTimeout(hideT); hideT = setTimeout(() => { ['pTop', 'pBottom'].forEach(id => $(id).style.opacity = 0); }, 3000);
}
['pTop', 'pBottom'].forEach(id => $(id).addEventListener('mousemove', wakeChrome));
document.addEventListener('mousemove', e => { if ($('playerView').classList.contains('show')) wakeChrome(); });
$('pBack').onclick = closePlayer;
function closePlayer() {
  syncVidlinkProgress();
  $('playerView').classList.remove('show');
  hidePlayerError();
  document.querySelectorAll('#playerView iframe').forEach(f => f.remove());
  const v = $('playerVideo');
  try { v.pause(); } catch { }
  v.removeAttribute('src'); v.load();
  // restore native-video chrome for non-embed modes
  v.style.display = '';
  $('pBottom').style.display = '';
  $('torrentStats').style.display = '';
  currentVidlink = null;
}

/* ---------- PRIMARY WATCH FLOW (VidLink embed — frontend only, no backend) ---------- */
let currentVidlink = null;
function hidePlayerError() { $('pError').classList.remove('show'); }
function showPlayerError(msg) {
  $('pErrorMsg').textContent = msg || 'This title is not available for streaming right now.';
  $('pError').classList.add('show');
}
/** Official VidLink embed URL, styled to match this site (Netflix red). */
function vidlinkUrl(o) {
  const base = o.type === 'series'
    ? `https://vidlink.pro/tv/${o.tmdbId}/${o.season || 1}/${o.episode || 1}`
    : `https://vidlink.pro/movie/${o.tmdbId}`;
  const p = new URLSearchParams({
    primaryColor: 'E50914', secondaryColor: '808080', iconColor: 'FFFFFF',
    icons: 'default', title: 'true', poster: 'true', autoplay: 'true',
  });
  if (o.type === 'series') p.set('nextbutton', 'true');
  if (o.startAt > 0) p.set('startAt', String(Math.floor(o.startAt)));
  return `${base}?${p.toString()}`;
}
function openPlayerShell(title) {
  closeDetail();
  hidePlayerError();
  document.querySelectorAll('#playerView iframe').forEach(f => f.remove());
  $('playerView').classList.add('show');
  $('pTitle').textContent = title;
  wakeChrome();
  // embed mode: VidLink brings its own controls — hide the native chrome
  $('playerVideo').style.display = 'none';
  $('pBottom').style.display = 'none';
  $('torrentStats').style.display = 'none';
  $('skipIntro').style.display = 'none';
  $('nextEp').style.display = 'none';
}
/**
 * PRIMARY Watch entry: every Play button ends up here.
 * Catalog (Cinemeta IMDb id) → TMDB id → VidLink embed → iframe player.
 */
function playVidlink(o) {
  if (!o || !o.tmdbId) { showPlayerError('This title is not available for streaming right now.'); return; }
  currentVidlink = { ...o };
  openPlayerShell(o.title + (o.type === 'series' ? ` — S${o.season || 1}:E${o.episode || 1}` : ''));
  const f = document.createElement('iframe');
  f.src = vidlinkUrl(o);
  f.allowFullscreen = true;
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
  // Block pop-unders/ads from inside the embed while keeping playback working:
  // scripts + same-origin keep the player and postMessage progress alive,
  // and omitting allow-popups / allow-top-navigation traps popups.
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
  f.style.cssText = 'flex:1;width:100%;border:none';
  $('playerView').insertBefore(f, $('pTop'));
}
function playStream(s) {
  currentStream = s || null;
  const m = currentDetail?.meta;
  if (!m) return;
  const tmdbId = m.moviedb_id;
  if (!tmdbId) {
    closeDetail();
    $('playerView').classList.add('show');
    $('pTitle').textContent = m.name;
    showPlayerError('This title is not available for streaming right now.');
    return;
  }
  playVidlink({
    tmdbId, type: currentDetail.type,
    season: currentDetail.ep.s, episode: currentDetail.ep.e, title: m.name,
  });
}
/** Continue-Watching card (built from VidLink progress) → resume in place. */
function playVidlinkEntry(m) {
  playVidlink({
    tmdbId: m.tmdbId, type: m.type === 'series' ? 'series' : 'movie',
    season: m.season || 1, episode: m.episode || 1,
    startAt: m._resume || 0, title: m.name,
  });
}
/* VidLink progress → our Continue Watching (their documented MEDIA_DATA events). */
function readVidlinkStore() {
  try { return JSON.parse(localStorage.getItem('vidLinkProgress') || '{}'); }
  catch { return {}; }
}
function historyItems() {
  return Object.entries(history).map(([id, h]) => ({
    id, type: h.type, name: h.title, poster: h.poster, background: h.poster,
    _progress: h.progress, _vidlink: !!h._vidlink, tmdbId: h.tmdbId,
    season: h.season, episode: h.episode, _resume: h._resume,
  }));
}
function renderContinueRow() {
  const sec = $('row-continue');
  if (!sec) return;
  const track = sec.querySelector('.row-track');
  const items = historyItems();
  sec.style.display = items.length ? '' : 'none';
  track.innerHTML = '';
  items.forEach(m => track.appendChild(buildCard(m)));
  track.dispatchEvent(new Event('scroll'));
}
function syncVidlinkProgress() {
  const data = readVidlinkStore();
  let changed = false;
  Object.values(data).forEach(entry => {
    if (!entry || entry.id == null) return;
    const dur = entry.progress?.duration || 0, watched = entry.progress?.watched || 0;
    if (!dur || watched < 5) return;
    history[`tmdb:${entry.id}`] = {
      progress: Math.min(.98, watched / dur),
      type: entry.type === 'tv' ? 'series' : 'movie',
      title: entry.title || 'Title',
      poster: entry.poster_path ? `https://image.tmdb.org/t/p/w500${entry.poster_path}` : '',
      tmdbId: entry.id, season: +(entry.last_season_watched || 1),
      episode: +(entry.last_episode_watched || 1), _vidlink: true, _resume: watched,
    };
    changed = true;
  });
  if (changed) {
    store.set('nf_history', history);
    renderContinueRow();
  }
}
function useWebtorFallback(s) {
  if (!s?.infoHash) return;
  $('torrentStats').textContent = 'WebRTC peers unavailable — relay via webtor.io';
  $('playerVideo').style.display = 'none';
  const f = document.createElement('iframe');
  f.src = `https://webtor.io/${s.infoHash}/embed`;
  f.allowFullscreen = true;
  $('playerView').insertBefore(f, $('pTop'));
}
function nextEpisode() {
  $('nextEp').style.display = 'none';
  if (currentVidlink?.type === 'series') {
    const ep = (currentVidlink.episode || 1) + 1;
    toast(`Loading episode ${ep}…`);
    playVidlink({ ...currentVidlink, episode: ep, startAt: 0 });
  } else if (currentDetail?.type === 'series') {
    currentDetail.ep.e += 1;
    playStream(null);
  }
}
$('nextPlay').onclick = nextEpisode;
$('pRetry').onclick = () => { hidePlayerError(); playStream(currentStream); };
$('pAlt').onclick = () => {
  hidePlayerError();
  if (currentStream?.infoHash) {
    // legacy torrent fallback for the selected stream
    $('playerVideo').style.display = 'none';
    useWebtorFallback(currentStream);
  } else showPlayerError('No alternative player is available for this title.');
};
/* VidLink player events (documented postMessage API): progress + ended. */
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://vidlink.pro') return;
  const msg = event.data || {};
  if (msg.type === 'MEDIA_DATA' && msg.data) {
    try {
      const cur = readVidlinkStore();
      cur[msg.data.id] = msg.data;
      localStorage.setItem('vidLinkProgress', JSON.stringify(cur));
    } catch { /* storage full/blocked */ }
    syncVidlinkProgress();
  } else if (msg.type === 'PLAYER_EVENT' && msg.data?.event === 'ended' && currentVidlink?.type === 'series') {
    toast('Playing next episode…');
    playVidlink({ ...currentVidlink, episode: (currentVidlink.episode || 1) + 1, startAt: 0 });
  }
});
$('ppPlay').onclick = () => { const v = $('playerVideo'); v.paused ? v.play() : v.pause(); $('ppPlay').textContent = v.paused ? '▶' : '⏸'; };
$('ppBack').onclick = () => $('playerVideo').currentTime -= 10;
$('ppFwd').onclick = () => $('playerVideo').currentTime += 10;
$('ppMute').onclick = () => $('playerVideo').muted = !$('playerVideo').muted;
$('ppFs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : $('playerView').requestFullscreen?.();
$('ppSubs').onclick = () => toast('Subtitles are built into the player — use the CC button');
$('ppEps').onclick = () => { closePlayer(); if (currentDetail) openDetail(currentDetail.meta.id, currentDetail.type, false); };

/* ---------- VPN ---------- */
if (!localStorage.getItem('vpn_ack')) $('vpnBackdrop').classList.add('show');
if (!localStorage.getItem('vpn_banner_dismissed')) $('vpnBanner').classList.add('show');
$('vpnOk').onclick = () => { localStorage.setItem('vpn_ack', 'true'); $('vpnBackdrop').classList.remove('show'); };
$('vpnLearn').onclick = () => toast('A VPN encrypts traffic and hides your IP from torrent peers');
$('vpnDismiss').onclick = () => { localStorage.setItem('vpn_banner_dismissed', 'true'); $('vpnBanner').classList.remove('show'); };

/* ---------- PROFILE GATE + LIVE SEARCH ---------- */
function renderGate() {
  const av = $('gateAvatars'); av.innerHTML = '';
  const saved = store.get('nf_profile', 'N');
  [['N', '#E50914', 'You'], ['K', '#1f6feb', 'Kids'], ['G', '#238636', 'Guest']].forEach(([l, c, n]) => {
    const d = document.createElement('div'); d.className = 'pav';
    d.innerHTML = `<div class="box" style="background:${c}">${l}</div><div>${n}</div>`;
    d.onclick = () => {
      store.set('nf_profile', l);
      $('avatarBtn').textContent = l;
      $('profileGate').classList.add('hide');
      toast(`Welcome, ${n}`);
    };
    if (l === saved) setTimeout(() => d.querySelector('.box').style.borderColor = '#fff', 50);
    av.appendChild(d);
  });
}
let liveT = null;
function armLiveSearch(input, box) {
  input.addEventListener('input', () => {
    clearTimeout(liveT);
    const q = input.value.trim();
    if (q.length < 3) return;
    liveT = setTimeout(() => {
      if (box) box.value = q;
      if (pages.search.classList.contains('show') || input === box) doSearch(q);
    }, 600);
  });
}

/* ---------- INIT ---------- */
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); $('dlBackdrop').classList.remove('show'); if ($('playerView').classList.contains('show')) closePlayer(); } });
show('home');
buildHome();
renderProfiles();
renderGate();
armLiveSearch($('searchInput'), $('searchBox'));
armLiveSearch($('searchBox'), null);
$('avatarBtn').textContent = store.get('nf_profile', 'N');
ensureWebTorrent().catch(() => {}); /* preload download engine in background */
