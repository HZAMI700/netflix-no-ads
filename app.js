/* Netflix-style streaming portal — 100% client-side.
 * Streaming: VidAPI/Vaplayer embeds only. Downloads: OmniSave redirect only. */
const CINEMETA = 'https://v3-cinemeta.strem.io';

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
    if (m._embed) { playEmbedEntry(m); return; }
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
            playEpisode(v.season, v.episode);
          };
          const dl = document.createElement('button');
          dl.className = 'cbtn'; dl.textContent = '⬇'; dl.title = 'Download on OmniSave ↗';
          dl.onclick = (e) => {
            e.stopPropagation();
            downloadEpisode(currentDetail.meta.name, v.season, v.episode);
          };
          d.appendChild(dl);
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
    // Watch availability depends on the required embed ID being present.
    const canWatch = type === 'movie'
      ? !!MediaLinks.getMovieStreamUrl({ imdb: m.id || m.imdb_id })
      : !!m.moviedb_id;
    $('dPlay').disabled = !canWatch;
    $('dPlay').title = canWatch ? 'Watch' : 'Streaming is unavailable for this title';
    $('dPlay').onclick = () => playStream();
    $('dDl').onclick = () => downloadCurrent();
    if (autoplay && canWatch) playStream();
  } catch { $('dTitle').textContent = 'Failed to load title'; }
}
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

/* ---------- DOWNLOAD = OmniSave redirect only ----------
 * The Download button never downloads through this site. It opens the
 * external OmniSave website in a new tab with the title search ready
 * (their declared ?q= search target), and copies the query to the
 * clipboard as a fallback. */
function openOmnisave(query) {
  window.open(MediaLinks.omnisaveUrl(query), '_blank', 'noopener');
  if (!query) { toast('OmniSave opened in a new tab'); return; }
  try {
    const done = navigator.clipboard && navigator.clipboard.writeText(query);
    if (done && done.then) done.then(
      () => toast('OmniSave opened — title copied, paste it into search'),
      () => toast('OmniSave opened in a new tab'),
    );
    else toast('OmniSave opened in a new tab');
  } catch { toast('OmniSave opened in a new tab'); }
}
/** Title context for downloads: detail modal first, player second. */
function currentTitleContext() {
  if (currentDetail?.meta) {
    return { title: currentDetail.meta.name, type: currentDetail.type, season: currentDetail.ep.s, episode: currentDetail.ep.e };
  }
  if (currentEmbed) {
    return { title: currentEmbed.title, type: currentEmbed.type, season: currentEmbed.season, episode: currentEmbed.episode };
  }
  return null;
}
function downloadCurrent() {
  const ctx = currentTitleContext();
  if (!ctx) { toast('Open a title first'); return; }
  const query = ctx.type === 'series'
    ? MediaLinks.getEpisodeDownloadSearch({ title: ctx.title }, ctx.season, ctx.episode)
    : MediaLinks.getMovieDownloadSearch({ title: ctx.title });
  openOmnisave(query);
}
function downloadEpisode(seriesTitle, season, episode) {
  openOmnisave(MediaLinks.getEpisodeDownloadSearch({ title: seriesTitle }, season, episode));
}
$('pDl').onclick = () => downloadCurrent();

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
  syncEmbedProgress();
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
  currentEmbed = null;
}

/* ---------- PRIMARY WATCH FLOW (VidAPI/Vaplayer embed ONLY) ----------
 * The ONLY streaming provider. Movies use the IMDb embed, episodes the
 * TMDB embed. No fallbacks, no proxy, no direct media URLs. */
let currentEmbed = null;
function hidePlayerError() { $('pError').classList.remove('show'); }
function showPlayerError(msg) {
  $('pErrorMsg').textContent = msg || 'This title is not available for streaming right now.';
  $('pError').classList.add('show');
}
function openPlayerShell(title) {
  closeDetail();
  hidePlayerError();
  document.querySelectorAll('#playerView iframe').forEach(f => f.remove());
  $('playerView').classList.add('show');
  $('pTitle').textContent = title;
  wakeChrome();
  // embed mode: the provider brings its own controls — hide the native chrome
  $('playerVideo').style.display = 'none';
  $('pBottom').style.display = 'none';
  $('torrentStats').style.display = 'none';
  $('skipIntro').style.display = 'none';
  $('nextEp').style.display = 'none';
}
/**
 * PRIMARY Watch entry for movies. Requires an IMDb ID.
 * PRIMARY Watch entry for episodes is playEpisode().
 */
function playStream() {
  const m = currentDetail?.meta;
  if (!m) return;
  if (currentDetail.type === 'series') {
    playEpisode(currentDetail.ep.s, currentDetail.ep.e);
    return;
  }
  const url = MediaLinks.getMovieStreamUrl({ imdb: m.id || m.imdb_id });
  if (!url) {
    closeDetail();
    $('playerView').classList.add('show');
    $('pTitle').textContent = m.name;
    showPlayerError('Streaming is unavailable for this title (missing ID).');
    return;
  }
  playEmbed({ url, type: 'movie', imdb: m.id || m.imdb_id, title: m.name });
}
function playEpisode(season, episode) {
  const m = currentDetail?.meta;
  if (!m) return;
  currentDetail.ep = { s: season, e: episode };
  const url = MediaLinks.getEpisodeStreamUrl({ tmdbId: m.moviedb_id }, season, episode);
  if (!url) {
    toast('Streaming is unavailable for this episode (missing ID).');
    return;
  }
  playEmbed({ url, type: 'series', tmdbId: m.moviedb_id, season, episode, title: m.name });
}
function playEmbed(o) {
  if (!o || !o.url) { showPlayerError('This title is not available for streaming right now.'); return; }
  currentEmbed = { ...o };
  currentStream = o;
  openPlayerShell(o.title + (o.type === 'series' ? ` — S${o.season}:E${o.episode}` : ''));
  const f = document.createElement('iframe');
  f.src = o.url;
  f.allowFullscreen = true;
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
  f.style.cssText = 'flex:1;width:100%;border:none';
  $('playerView').insertBefore(f, $('pTop'));
  armVidShield();
}
/** Continue-Watching card → resume in place (only if still playable). */
function playEmbedEntry(m) {
  if (m.type === 'series') {
    if (!m.tmdbId) { toast('Streaming is unavailable for this title (missing ID).'); return; }
    const url = MediaLinks.getEpisodeStreamUrl({ tmdbId: m.tmdbId }, m.season || 1, m.episode || 1);
    if (!url) { toast('Streaming is unavailable for this episode.'); return; }
    playEmbed({ url, type: 'series', tmdbId: m.tmdbId, season: m.season || 1, episode: m.episode || 1, title: m.name });
    return;
  }
  const imdb = m.imdb || ((m.id || '').startsWith('tt') ? m.id : null);
  const url = MediaLinks.getMovieStreamUrl({ imdb });
  if (!url) { toast('Streaming is unavailable for this title (missing ID).'); return; }
  playEmbed({ url, type: 'movie', imdb, title: m.name });
}
/* Embed-player progress → our Continue Watching.
 * Accepts the documented MEDIA_DATA shape from the embed provider only.
 * Legacy vidlink-pro progress entries already stored locally are migrated
 * when still playable, then never written again. */
const EMBED_ORIGINS = ['https://vaplayer.ru', 'https://vidapi.ru'];
function readProgressStore() {
  try { return JSON.parse(localStorage.getItem('vidLinkProgress') || '{}'); }
  catch { return {}; }
}
function historyItems() {
  return Object.entries(history).map(([id, h]) => ({
    id, type: h.type, name: h.title, poster: h.poster, background: h.poster,
    _progress: h.progress, _embed: !!h._embed, tmdbId: h.tmdbId,
    imdb: h.imdb || (id.startsWith('tt') ? id : null),
    season: h.season, episode: h.episode,
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
function syncEmbedProgress() {
  const data = readProgressStore();
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
      tmdbId: entry.id, imdb: entry.imdb || null,
      season: +(entry.last_season_watched || 1),
      episode: +(entry.last_episode_watched || 1), _embed: true,
    };
    changed = true;
  });
  if (changed) {
    store.set('nf_history', history);
    renderContinueRow();
  }
}
/* Embed-player events: progress + ended. Only the documented provider origins. */
function nextEpisode() {
  $('nextEp').style.display = 'none';
  const e = currentEmbed;
  if (e?.type === 'series' && e.tmdbId) {
    const ep = (e.episode || 1) + 1;
    toast(`Loading episode ${ep}…`);
    const url = MediaLinks.getEpisodeStreamUrl({ tmdbId: e.tmdbId }, e.season || 1, ep);
    if (url) playEmbed({ ...e, url, episode: ep });
    else toast('Streaming is unavailable for this episode.');
  }
}
$('nextPlay').onclick = nextEpisode;
$('pRetry').onclick = () => {
  hidePlayerError();
  if (currentEmbed) playEmbed({ ...currentEmbed });
  else playStream();
};
/* Pop-under guard (no sandbox — the player rejects sandboxed frames).
 * A transparent shield swallows the first tap on the player (the gesture
 * pop-unders feed on). If a popup still steals focus, we pull the user back
 * and re-arm the shield for the next tap. Back/title buttons sit above it. */
function armVidShield() {
  let shield = $('vidShield');
  if (!shield) {
    shield = document.createElement('div');
    shield.id = 'vidShield';
    $('playerView').insertBefore(shield, $('pTop'));
  }
  shield.style.display = 'block';
  shield.onclick = () => { shield.style.display = 'none'; };
}
let lastPlayerTap = 0;
document.addEventListener('pointerdown', () => {
  if ($('playerView').classList.contains('show')) lastPlayerTap = Date.now();
}, true);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('playerView').classList.contains('show') && Date.now() - lastPlayerTap < 3000) {
    try { window.focus(); } catch { /* ignore */ }
    armVidShield();
  }
});
/* Embed-player events: progress + ended. Only the documented provider origins. */
window.addEventListener('message', (event) => {
  if (!EMBED_ORIGINS.includes(event.origin)) return;
  const msg = event.data || {};
  if (msg.type === 'MEDIA_DATA' && msg.data) {
    try {
      const cur = readProgressStore();
      cur[msg.data.id] = { ...msg.data, imdb: msg.data.imdb || msg.data.imdb_id || undefined };
      localStorage.setItem('vidLinkProgress', JSON.stringify(cur));
    } catch { /* storage full/blocked */ }
    syncEmbedProgress();
  } else if (msg.type === 'PLAYER_EVENT' && msg.data?.event === 'ended') {
    const e = currentEmbed;
    if (e?.type === 'series' && e.tmdbId) {
      toast('Playing next episode…');
      const ep = (e.episode || 1) + 1;
      const url = MediaLinks.getEpisodeStreamUrl({ tmdbId: e.tmdbId }, e.season || 1, ep);
      if (url) playEmbed({ ...e, url, episode: ep });
    }
  }
});
$('ppPlay').onclick = () => { const v = $('playerVideo'); v.paused ? v.play() : v.pause(); $('ppPlay').textContent = v.paused ? '▶' : '⏸'; };
$('ppBack').onclick = () => $('playerVideo').currentTime -= 10;
$('ppFwd').onclick = () => $('playerVideo').currentTime += 10;
$('ppMute').onclick = () => $('playerVideo').muted = !$('playerVideo').muted;
$('ppFs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : $('playerView').requestFullscreen?.();
$('ppSubs').onclick = () => toast('Subtitles are built into the player — use the CC button');
$('ppEps').onclick = () => { closePlayer(); if (currentDetail) openDetail(currentDetail.meta.id, currentDetail.type, false); };

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
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); if ($('playerView').classList.contains('show')) closePlayer(); } });
// One-time migration: drop legacy progress entries that have no playable ID
// under the current provider (TMDB-only movies predate IMDb-based playback).
(function migrateHistory() {
  let changed = false;
  Object.entries(history).forEach(([k, h]) => {
    if (!h) return;
    const playable = h.type === 'series' ? !!h.tmdbId : !!(h.imdb || k.startsWith('tt'));
    if (!playable) { delete history[k]; changed = true; }
  });
  if (changed) store.set('nf_history', history);
})();
show('home');
buildHome();
renderProfiles();
renderGate();
armLiveSearch($('searchInput'), $('searchBox'));
armLiveSearch($('searchBox'), null);
$('avatarBtn').textContent = store.get('nf_profile', 'N');
