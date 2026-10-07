/* Netflix-style streaming portal — 100% client-side.
 * Streaming: VidAPI/Vaplayer embeds only. Downloads: OmniSave redirect only. */
'use strict';

// Defensive Security Hardening: Anti-Clickjacking Frame Guard
if (typeof window !== 'undefined' && window.top !== window.self) {
  try {
    window.top.location = window.self.location;
  } catch {
    if (document.documentElement) document.documentElement.style.display = 'none';
  }
}

// Defensive Security: Anti-Tracking Beacon Protection (blocks telemetry to third-party endpoints)
if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
  const _origSendBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function(url, data) {
    try {
      const u = new URL(url, window.location.href);
      if (u.hostname !== window.location.hostname && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
        return false;
      }
    } catch {}
    return _origSendBeacon(url, data);
  };
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const CINEMETA = 'https://v3-cinemeta.strem.io';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};

let myList = store.get('nf_mylist', []);

const DEFAULT_HISTORY = {
  'tt4574334': {
    title: 'Stranger Things',
    type: 'series',
    progress: 0.52,
    finished: false,
    poster: 'https://images.metahub.space/poster/medium/tt4574334/img',
    season: 4,
    episode: 4
  },
  'tt1375666': {
    title: 'Inception',
    type: 'movie',
    progress: 0.74,
    finished: false,
    poster: 'https://images.metahub.space/poster/medium/tt1375666/img',
    imdb: 'tt1375666'
  },
  'tt1877830': {
    title: 'The Batman',
    type: 'movie',
    progress: 0.38,
    finished: false,
    poster: 'https://images.metahub.space/poster/medium/tt1877830/img',
    imdb: 'tt1877830'
  },
  'tt0903747': {
    title: 'Breaking Bad',
    type: 'series',
    progress: 1.0,
    finished: true,
    poster: 'https://images.metahub.space/poster/medium/tt0903747/img',
    season: 5,
    episode: 16
  },
  'tt0816692': {
    title: 'Interstellar',
    type: 'movie',
    progress: 1.0,
    finished: true,
    poster: 'https://images.metahub.space/poster/medium/tt0816692/img',
    imdb: 'tt0816692'
  },
  'tt0468569': {
    title: 'The Dark Knight',
    type: 'movie',
    progress: 1.0,
    finished: true,
    poster: 'https://images.metahub.space/poster/medium/tt0468569/img',
    imdb: 'tt0468569'
  }
};

let history = store.get('nf_history', null);
if (!history || Object.keys(history).length === 0) {
  history = { ...DEFAULT_HISTORY };
  store.set('nf_history', history);
} else {
  const hasFinished = Object.values(history).some(h => h && (h.finished || (h.progress != null && h.progress >= 0.9)));
  if (!hasFinished) {
    Object.entries(DEFAULT_HISTORY).forEach(([k, v]) => {
      if (v.finished && !history[k]) history[k] = { ...v };
    });
    store.set('nf_history', history);
  }
}

let likes = store.get('nf_likes', {});
let dislikes = store.get('nf_dislikes', {});
let heroItems = [], heroIdx = 0, heroTimer = null;
let currentDetail = null;
let currentStream = null;
let currentEmbed = null;
let currentPlayerServer = store.get('nf_player_server', 'server1');

const PROFILES = [
  { id: 'Z', name: 'You', color: 'linear-gradient(135deg, #E50914 0%, #B81D24 100%)' },
  { id: 'K', name: 'Kids', color: 'linear-gradient(135deg, #1f6feb 0%, #0d419d 100%)' },
  { id: 'F', name: 'Family', color: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)' },
  { id: 'G', name: 'Guest', color: 'linear-gradient(135deg, #238636 0%, #175a24 100%)' }
];

function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- NAV / ROUTER ---------- */
const pages = {
  home: $('homePage'),
  search: $('searchPage'),
  mylist: $('mylistPage'),
  browse: $('browsePage'),
  profiles: $('profilesPage'),
  settings: $('settingsPage')
};

function show(name) {
  closeCardPortal();
  Object.entries(pages).forEach(([k, el]) => {
    if (!el) return;
    el.classList.toggle('show', k === name || (name === 'home' && k === 'home'));
  });
  if (name === 'home') {
    if ($('homePage')) $('homePage').style.display = '';
    Object.values(pages).forEach(p => { if (p && p !== pages.home) p.classList.remove('show'); });
  } else {
    if ($('homePage')) $('homePage').style.display = 'none';
  }
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  closeAllNavDropdowns();
  const n = a.dataset.nav;
  if (n === 'movies') openBrowse('movies');
  else if (n === 'series') openBrowse('series');
  else if (n === 'new') openBrowse('new');
  else show(n === 'home' ? 'home' : n);

  if (n === 'mylist') renderMyList();
  if (n === 'profiles') renderProfiles();
  if (n === 'settings') renderAddons();
}));

/* ---------- SCROLL & HOVER INTENT SYSTEM ---------- */
let activeHoverCard = null;
let cardHoverTimer = null;
let cardLeaveTimer = null;
let isScrolling = false;
let scrollEndTimer = null;
let isRowDragging = false;

function onScrollActivity() {
  clearTimeout(cardHoverTimer);
  closeCardPortal();

  if (!isScrolling) {
    isScrolling = true;
    document.body.classList.add('is-scrolling');
  }

  clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(() => {
    isScrolling = false;
    document.body.classList.remove('is-scrolling');
  }, 150);
}

window.addEventListener('scroll', () => {
  const nav = $('topnav');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
  onScrollActivity();

  // Smooth virtual infinite scrolling for search results and browse grid
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 800) {
    if (typeof renderSearchChunk === 'function' && $('searchView') && $('searchView').style.display !== 'none') {
      renderSearchChunk();
    } else if (typeof renderBrowseChunk === 'function' && $('browseView') && $('browseView').style.display !== 'none' && $('browseGrid') && $('browseGrid').innerHTML !== '') {
      renderBrowseChunk();
    }
  }
}, { passive: true });

window.addEventListener('wheel', () => {
  onScrollActivity();
}, { passive: true });

function closeAllNavDropdowns() {
  const pm = $('profileMenu'); if (pm) pm.classList.remove('open');
  const nw = $('notifWrap'); if (nw) nw.classList.remove('open');
  const bd = document.querySelector('.browse-dd'); if (bd) bd.classList.remove('open');
}

const avatarBtn = $('avatarBtn');
if (avatarBtn) {
  avatarBtn.onclick = (e) => {
    e.stopPropagation();
    const pm = $('profileMenu');
    const wasOpen = pm.classList.contains('open');
    closeAllNavDropdowns();
    if (!wasOpen) pm.classList.add('open');
  };
}

const bellBtn = $('bellBtn');
if (bellBtn) {
  bellBtn.onclick = (e) => {
    e.stopPropagation();
    const nw = $('notifWrap');
    const wasOpen = nw.classList.contains('open');
    closeAllNavDropdowns();
    if (!wasOpen) nw.classList.add('open');
  };
}

const browseBtn = $('browseBtn');
if (browseBtn) {
  browseBtn.onclick = (e) => {
    e.stopPropagation();
    const bd = document.querySelector('.browse-dd');
    const wasOpen = bd.classList.contains('open');
    closeAllNavDropdowns();
    if (!wasOpen) bd.classList.add('open');
  };
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#profileMenu') && !e.target.closest('#notifWrap') && !e.target.closest('.browse-dd')) {
    closeAllNavDropdowns();
  }
});

const signOut = $('signOut');
if (signOut) {
  signOut.onclick = e => {
    e.preventDefault();
    closeAllNavDropdowns();
    show('profiles');
    renderProfiles();
  };
}

/* Search bar interactions */
const searchBtn = $('searchBtn');
const searchWrap = $('searchWrap');
const searchInput = $('searchInput');
const searchClearBtn = $('searchClearBtn');

if (searchBtn && searchWrap && searchInput) {
  searchBtn.onclick = () => {
    searchWrap.classList.toggle('open');
    if (searchWrap.classList.contains('open')) {
      searchInput.focus();
    } else {
      if (pages.search.classList.contains('show')) show('home');
    }
  };

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch(e.target.value);
  });
}

if (searchClearBtn && searchInput) {
  searchClearBtn.onclick = () => {
    searchInput.value = '';
    searchInput.focus();
  };
}

const searchGo = $('searchGo');
const searchBox = $('searchBox');
if (searchGo && searchBox) {
  searchGo.onclick = () => doSearch(searchBox.value);
  searchBox.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch(e.target.value);
  });
}

let currentSearchResults = [];
let currentSearchOffset = 0;
const SEARCH_PAGE_SIZE = 48;

function renderSearchChunk() {
  const container = $('searchResults');
  if (!container || !currentSearchResults || !currentSearchResults.length) return;
  const nextChunk = currentSearchResults.slice(currentSearchOffset, currentSearchOffset + SEARCH_PAGE_SIZE);
  if (!nextChunk.length) return;
  nextChunk.forEach(meta => container.appendChild(buildCard(meta)));
  currentSearchOffset += nextChunk.length;
}

async function doSearch(q) {
  q = (q || '').trim();
  if (!q) return;
  show('search');
  if ($('searchTitle')) $('searchTitle').textContent = `Results for "${q}"`;
  if ($('searchBox')) $('searchBox').value = q;
  if ($('searchInput')) $('searchInput').value = q;
  $('searchResults').innerHTML = skels(6);

  try {
    const [m1, m2, s1, s2] = await Promise.all([
      fetch(`${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(q)}.json`).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/movie/imdbRating/search=${encodeURIComponent(q)}.json`).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/series/top/search=${encodeURIComponent(q)}.json`).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/series/imdbRating/search=${encodeURIComponent(q)}.json`).then(r => r.json()).catch(() => ({ metas: [] }))
    ]);
    const curatedMatches = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.searchCurated) ? CuratedCatalog.searchCurated(q, 300) : [];
    const all = dedupeMetas([
      ...curatedMatches,
      ...(m1.metas || []),
      ...(m2.metas || []),
      ...(s1.metas || []),
      ...(s2.metas || [])
    ]).filter(isCleanSafe);
    $('searchResults').innerHTML = all.length
      ? ''
      : `<div class="empty" style="grid-column:1/-1"><h2>Your search for "${escapeHtml(q)}" did not have any matches.</h2><p>Try searching for a different movie, TV show, actor, director, or genre.</p></div>`;
    currentSearchResults = all;
    currentSearchOffset = 0;
    renderSearchChunk();
  } catch {
    $('searchResults').innerHTML = '<p style="color:#888;grid-column:1/-1;text-align:center">Search failed. Please check your internet connection.</p>';
  }
}

const isCleanSafe = (m) => {
  if (typeof isSafeContent === 'function') return isSafeContent(m);
  if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.isSafeContent) return CuratedCatalog.isSafeContent(m);
  return true;
};

/* ---------- FETCH HELPERS ---------- */
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Fetch failed');
  return r.json();
}
function createPosterFallback(title, genre = 'Drama', year = '2024', rating = '8.2', type = 'movie') {
  if (typeof CuratedCatalog !== 'undefined' && typeof CuratedCatalog.generateCinematicCover === 'function') {
    return CuratedCatalog.generateCinematicCover(title || 'Feature Film', genre || 'Cinema', year || '2024', rating || '8.2', type || 'movie');
  }
  const cleanTitle = String(title || 'Featured Film').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cleanGenre = String(genre || (type === 'series' ? 'TV SERIES' : 'CINEMA')).toUpperCase();
  const cleanYear = String(year || '2024');
  const cleanRating = String(rating || '8.2');
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="300" height="450">',
      '<defs>',
        '<linearGradient id="bgG" x1="0%" y1="0%" x2="100%" y2="100%">',
          '<stop offset="0%" stop-color="#141414"/>',
          '<stop offset="50%" stop-color="#1f1a24"/>',
          '<stop offset="100%" stop-color="#0a0a0c"/>',
        '</linearGradient>',
      '</defs>',
      '<rect width="100%" height="100%" fill="url(#bgG)"/>',
      '<rect x="0" y="0" width="300" height="4" fill="#E50914"/>',
      '<text x="24" y="44" fill="#E50914" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="900" font-size="28">N</text>',
      '<rect x="24" y="60" width="70" height="20" rx="4" fill="rgba(255,255,255,0.12)"/>',
      '<text x="59" y="74" fill="#ffb800" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="700" font-size="10" text-anchor="middle">' + cleanGenre.slice(0, 10) + '</text>',
      '<text x="24" y="340" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="900" font-size="22">' + cleanTitle.slice(0, 22) + '</text>',
      (cleanTitle.length > 22 ? '<text x="24" y="370" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="900" font-size="20">' + cleanTitle.slice(22, 44) + '</text>' : ''),
      '<text x="24" y="410" fill="#46d369" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="700" font-size="12">★ ' + cleanRating + '  ' + cleanYear + '</text>',
    '</svg>'
  ].join('');
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

if (typeof window !== 'undefined') {
  window.createPosterFallback = createPosterFallback;
}

const poster = m => {
  if (!m) return createPosterFallback('Feature');
  if (m.poster && !m.poster.includes('images.metahub.space/poster/medium/tt3') && !m.poster.includes('images.metahub.space/poster/medium/tt7')) {
    return m.poster;
  }
  if (m.background && !m.background.includes('images.metahub.space/background/medium/tt3') && !m.background.includes('images.metahub.space/background/medium/tt7')) {
    return m.background;
  }
  return createPosterFallback(m.name, (m.genres && m.genres[0]) || '', m.year || m.releaseInfo || '2024', m.imdbRating || '8.2', m.type || 'movie');
};

const backdrop = m => {
  if (!m) return createPosterFallback('Feature');
  if (m.background && !m.background.includes('images.metahub.space/background/medium/tt3') && !m.background.includes('images.metahub.space/background/medium/tt7')) {
    return m.background;
  }
  if (m.poster && !m.poster.includes('images.metahub.space/poster/medium/tt3') && !m.poster.includes('images.metahub.space/poster/medium/tt7')) {
    return m.poster;
  }
  return createPosterFallback(m.name, (m.genres && m.genres[0]) || '', m.year || m.releaseInfo || '2024', m.imdbRating || '8.2', m.type || 'movie');
};
function matchScore(m) {
  const r = parseFloat(m.imdbRating);
  if (!r || isNaN(r)) return 98;
  return Math.min(99, Math.max(78, Math.round(r * 10)));
}
function ageRating(m) {
  return m.certification || (m.type === 'series' ? 'TV-MA' : 'PG-13');
}
function metaRowHTML(m) {
  const year = (m.releaseInfo || m.year || '').toString().slice(0, 4);
  const duration = m.runtime || (m.type === 'series' ? (m.videos ? `${m.videos.length} Episodes` : '1 Season') : '2h 15m');
  return `
    <span class="match">${matchScore(m)}% Match</span>
    <span>${year}</span>
    <span class="age-badge">${ageRating(m)}</span>
    <span>${duration}</span>
    <span class="hd-badge">ULTRA HD 4K</span>
    <span class="audio-badge">5.1</span>
  `;
}

function dedupeMetas(arr) {
  const seen = new Set();
  return (arr || []).filter(m => {
    if (!m || !m.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/* ---------- HOME ROWS (EXPANDED TO 30 ORGANIZED NETFLIX CATEGORIES) ---------- */
const HOME_ROWS = [
  { id: 'continue', title: 'Continue Watching for You', dynamic: 'continue' },
  { id: 'finished', title: 'Watch It Again (Finished Watching)', dynamic: 'finished' },
  { id: 'top10', title: 'Top 10 in Movies & TV Today', url: ['movie/top', 'series/top'], mix: true, isTop10: true, limit: 10 },
  { id: 'popular_movies', title: 'Blockbuster Movies & Hollywood Hits', url: ['movie/top', 'movie/top/skip=100', 'movie/top/skip=200'], limit: 100 },
  { id: 'popular_series', title: 'Trending & High-Voltage TV Series', url: ['series/top', 'series/top/skip=100', 'series/top/skip=200'], limit: 100 },
  { id: 'toprated_movies', title: 'IMDb Top Rated Cinema Masterpieces', url: ['movie/imdbRating', 'movie/imdbRating/skip=100', 'movie/imdbRating/skip=200'], limit: 100 },
  { id: 'toprated_series', title: 'Critically Acclaimed & Award-Winning Series', url: ['series/imdbRating', 'series/imdbRating/skip=100', 'series/imdbRating/skip=200'], limit: 100 },
  { id: 'new_releases', title: 'New Releases & Fresh Seasons on Streamnaro', url: ['movie/year', 'series/year', 'movie/year/skip=100', 'series/year/skip=100'], badge: 'NEW', limit: 100 },
  { id: 'action', title: 'High-Octane Action, Heists & Adrenaline', url: ['movie/top/genre=Action', 'movie/top/genre=Action/skip=100', 'movie/top/genre=Action/skip=200'], limit: 100 },
  { id: 'action_series', title: 'Action, Espionage & Adventure TV Series', url: ['series/top/genre=Action', 'series/top/genre=Adventure', 'series/top/genre=Action/skip=100'], limit: 100 },
  { id: 'scifi', title: 'Sci-Fi, Cyberpunk & Futuristic Worlds', url: ['movie/top/genre=Sci-Fi', 'series/top/genre=Sci-Fi', 'movie/top/genre=Sci-Fi/skip=100', 'series/top/genre=Sci-Fi/skip=100'], limit: 100 },
  { id: 'crime', title: 'Gripping Crime Sagas & Mafia Chronicles', url: ['series/top/genre=Crime', 'movie/top/genre=Crime', 'series/top/genre=Crime/skip=100', 'movie/top/genre=Crime/skip=100'], limit: 100 },
  { id: 'thriller', title: 'Edge-of-Your-Seat Thrillers & Psychological Suspense', url: ['movie/top/genre=Thriller', 'movie/top/genre=Thriller/skip=100', 'movie/top/genre=Thriller/skip=200'], limit: 100 },
  { id: 'mystery', title: 'Mind-Bending Whodunits & Detective Stories', url: ['movie/top/genre=Mystery', 'series/top/genre=Mystery', 'movie/top/genre=Mystery/skip=100'], limit: 100 },
  { id: 'animation', title: 'Animated Masterpieces & Anime Legends', url: ['series/top/genre=Animation', 'movie/top/genre=Animation', 'series/top/genre=Animation/skip=100', 'movie/top/genre=Animation/skip=100'], limit: 100 },
  { id: 'superhero', title: 'Superhero Universes & Comic Legends', url: ['movie/top/genre=Action/skip=100', 'movie/top/genre=Fantasy/skip=100', 'series/top/genre=Action/skip=100'], limit: 100 },
  { id: 'comedy', title: 'Laugh-Out-Loud Movie Comedies', url: ['movie/top/genre=Comedy', 'movie/top/genre=Comedy/skip=100', 'movie/top/genre=Comedy/skip=200'], limit: 100 },
  { id: 'comedy_series', title: 'Sitcoms & TV Comedy Hits', url: ['series/top/genre=Comedy', 'series/top/genre=Comedy/skip=100', 'series/top/genre=Comedy/skip=200'], limit: 100 },
  { id: 'drama', title: 'Binge-Worthy TV Dramas & Prestige Sagas', url: ['series/top/genre=Drama', 'series/top/genre=Drama/skip=100', 'series/top/genre=Drama/skip=200'], limit: 100 },
  { id: 'drama_movies', title: 'Award-Winning Drama Movies', url: ['movie/top/genre=Drama', 'movie/top/genre=Drama/skip=100', 'movie/top/genre=Drama/skip=200'], limit: 100 },
  { id: 'fantasy', title: 'Fantasy & Mythical Quests', url: ['movie/top/genre=Fantasy', 'series/top/genre=Fantasy', 'movie/top/genre=Fantasy/skip=100'], limit: 100 },
  { id: 'family', title: 'Family Movie Night & Epic Adventures', url: ['movie/top/genre=Family', 'movie/top/genre=Adventure', 'movie/top/genre=Family/skip=100'], limit: 100 },
  { id: 'horror', title: 'Chilling Horror & Supernatural Thrillers', url: ['movie/top/genre=Horror', 'movie/top/genre=Horror/skip=100'], limit: 100 },
  { id: 'epic_history', title: 'Historical Epics & War Sagas', url: ['movie/top/genre=History', 'movie/top/genre=War', 'series/top/genre=History', 'movie/top/genre=War/skip=100'], limit: 100 },
  { id: 'doc', title: 'Captivating Documentaries & Docuseries', url: ['movie/top/genre=Documentary', 'series/top/genre=Documentary', 'movie/top/genre=Documentary/skip=100'], limit: 100 },
  { id: 'heist', title: 'High-Stakes Heists & Gangster Sagas', url: ['movie/top/genre=Crime/skip=100', 'series/top/genre=Crime/skip=100', 'movie/top/genre=Action/skip=200'], limit: 100 },
  { id: 'sci_series', title: 'Sci-Fi & Cyberpunk Series', url: ['series/top/genre=Sci-Fi/skip=100', 'series/imdbRating/genre=Sci-Fi'], limit: 100 },
  { id: 'global_cinema', title: 'Global Cinema & International Hits', url: ['movie/top/skip=300', 'series/top/skip=300', 'movie/top/skip=400'], limit: 100 },
  { id: 'mylist', title: 'My List', dynamic: 'mylist' }
];

let catalogCache = {};
async function fetchCatalog(spec) {
  const key = spec;
  if (catalogCache[key]) return catalogCache[key];
  const d = await getJSON(`${CINEMETA}/catalog/${spec}.json`).catch(() => ({ metas: [] }));
  const clean = (d.metas || []).filter(isCleanSafe);
  catalogCache[key] = clean;
  return catalogCache[key];
}

function skels(n) {
  return Array.from({ length: n }, () => '<div class="skel"></div>').join('');
}

function renderRowSection(r) {
  return `
    <div class="row-sec" id="row-${r.id}" style="display:none">
      <div class="row-head">
        <div class="row-title-wrap">
          <h2>${r.title}</h2>
          <span class="row-explore-chevron">Explore All ›</span>
        </div>
        <div class="row-dots"></div>
      </div>
      <div class="row-outer">
        <button class="row-arrow left" aria-label="Previous">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div class="row-track"></div>
        <button class="row-arrow right" aria-label="Next">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
    </div>
  `;
}

function wireRowControls(sec) {
  const t = sec.querySelector('.row-track');
  if (!t) return;

  sec.querySelectorAll('.row-arrow').forEach(b => {
    b.onclick = () => {
      closeCardPortal();
      t.scrollBy({ left: (b.classList.contains('right') ? 1 : -1) * t.clientWidth * 0.9, behavior: 'smooth' });
    };
  });

  t.addEventListener('scroll', () => {
    onScrollActivity();
    const pagesCount = Math.max(1, Math.ceil(t.scrollWidth / t.clientWidth));
    const cur = Math.min(pagesCount - 1, Math.round(t.scrollLeft / t.clientWidth));
    const dots = sec.querySelector('.row-dots');
    if (dots && dots.childElementCount !== pagesCount) {
      dots.innerHTML = Array.from({ length: pagesCount }, (_, k) => `<span class="${k === cur ? 'on' : ''}"></span>`).join('');
    } else if (dots) {
      dots.querySelectorAll('span').forEach((s, k) => s.classList.toggle('on', k === cur));
    }
  }, { passive: true });

  // High-performance drag-to-scroll (listeners attached only during active drag)
  let startX = 0;
  let scrollStart = 0;
  let dragDist = 0;

  const onMouseMove = (e) => {
    const diff = e.pageX - startX;
    dragDist = Math.abs(diff);
    if (dragDist > 5) {
      isRowDragging = true;
      closeCardPortal();
      t.scrollLeft = scrollStart - diff;
    }
  };

  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (dragDist > 5) {
      setTimeout(() => { isRowDragging = false; }, 100);
    } else {
      isRowDragging = false;
    }
  };

  t.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    startX = e.pageX;
    scrollStart = t.scrollLeft;
    dragDist = 0;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

async function buildHome() {
  const wrap = $('rows');
  if (!wrap) return;

  wrap.innerHTML = HOME_ROWS.map(r => renderRowSection(r)).join('');
  wrap.querySelectorAll('.row-sec').forEach(sec => wireRowControls(sec));

  // Hero carousel init
  try {
    const top = await fetchCatalog('movie/top');
    heroItems = top.slice(0, 8);
    renderHero(0);
    clearInterval(heroTimer);
    heroTimer = setInterval(() => renderHero((heroIdx + 1) % heroItems.length), 8000);
  } catch {
    if ($('heroTitle')) $('heroTitle').textContent = 'Stranger Things';
  }

  // Track titles shown across rows on the home screen to prevent duplication
  const seenHomeIds = new Set();
  if (heroItems && heroItems.length && heroItems[0] && heroItems[0].id) {
    seenHomeIds.add(heroItems[0].id);
  }

  // Populate rows
  let shown = 0;
  for (const r of HOME_ROWS) {
    const sec = $('row-' + r.id);
    if (!sec) continue;
    const track = sec.querySelector('.row-track');
    let items = [];

    if (r.dynamic === 'continue' || r.dynamic === 'history') {
      items = continueItems();
    } else if (r.dynamic === 'finished') {
      items = finishedItems();
    } else if (r.dynamic === 'mylist') {
      items = myList;
    } else {
      let pool = [];
      for (const u of r.url) {
        pool = pool.concat(await fetchCatalog(u));
      }
      if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedForCategory) {
        pool = pool.concat(CuratedCatalog.getCuratedForCategory(r.id));
      }
      pool = dedupeMetas(pool).filter(isCleanSafe);
      if (r.mix) pool = pool.sort(() => Math.random() - .5);
      if (r.genre) pool = pool.filter(m => (m.genres || []).includes(r.genre));
      if (r.id === 'new_releases') {
        pool = pool.slice().sort((a, b) => parseInt(b.releaseInfo || 0) - parseInt(a.releaseInfo || 0));
      }

      // Cross-row home screen deduplication:
      // Real curated titles (blockbusters, iconic series) remain in their genuine genre rows,
      // while procedural titles are strictly deduplicated so users never see the same synthetic cards repeated.
      const curatedReal = pool.filter(m => !m._isProcedural);
      const proceduralPool = pool.filter(m => m._isProcedural && !seenHomeIds.has(m.id));
      const freshPool = [...curatedReal, ...proceduralPool];
      const max = r.limit || 60;
      items = (freshPool.length >= 10 ? freshPool : pool).slice(0, max);

      // Track items shown to prevent repeating procedural cards in later rows
      items.forEach(m => {
        if (m && m.id) seenHomeIds.add(m.id);
      });
    }

    if (!items.length) continue;
    sec.style.display = '';
    sec.classList.add('enter');
    sec.style.animationDelay = (shown++ * 60) + 'ms';
    track.innerHTML = '';
    items.forEach((m, idx) => track.appendChild(buildCard(m, r.badge, r.isTop10 ? idx + 1 : 0)));
    track.dispatchEvent(new Event('scroll'));
  }
}

/* ---------- NETFLIX CARD HOVER PORTAL ---------- */
function onCardMouseEnter(card, meta, badge, rank) {
  if (isScrolling || isRowDragging) return;
  clearTimeout(cardLeaveTimer);
  clearTimeout(cardHoverTimer);

  cardHoverTimer = setTimeout(() => {
    if (isScrolling || isRowDragging) return;
    if (!card.matches(':hover')) return;
    openCardPortal(card, meta, badge, rank);
  }, 380);
}

function onCardMouseLeave(card) {
  clearTimeout(cardHoverTimer);
  cardLeaveTimer = setTimeout(() => {
    const portal = $('cardPortal');
    if (portal && !portal.matches(':hover') && !card.matches(':hover')) {
      closeCardPortal();
    }
  }, 160);
}

function openCardPortal(card, m, badge, rank) {
  const portal = $('cardPortal');
  if (!portal || isScrolling || isRowDragging) return;

  const rect = card.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  if (rect.bottom < 60 || rect.top > window.innerHeight - 20) return;

  activeHoverCard = card;

  const scale = 1.25;
  const pw = Math.round(rect.width * scale);

  const pad = 16;
  let left = Math.round(rect.left - (pw - rect.width) / 2);
  let originX = 'center';
  if (left < pad) {
    left = Math.max(pad, Math.round(rect.left));
    originX = 'left';
  } else if (left + pw > window.innerWidth - pad) {
    left = Math.min(window.innerWidth - pad - pw, Math.round(rect.right - pw));
    originX = 'right';
  }

  let top = Math.round(rect.top - 24);
  if (top < 70) top = Math.max(70, Math.round(rect.top));

  portal.style.width = `${pw}px`;
  portal.style.left = `${left}px`;
  portal.style.top = `${top}px`;
  portal.style.transformOrigin = `${originX} center`;

  const inList = myList.some(x => x.id === m.id);
  const isLiked = !!likes[m.id];
  const genresStr = (m.genres || ['Drama', 'Thriller']).slice(0, 3).join(' • ');
  const top10Html = rank && rank <= 10
    ? `<div class="top10-badge"><span style="font-size:7px;letter-spacing:0.02em">TOP</span><span>${rank}</span></div>`
    : '';

  const isFinished = !!m._finished;
  const isContinue = (m._progress != null && !isFinished);

  let badgeMarkup = '';
  if (isFinished) {
    badgeMarkup = `<span class="watched-badge"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Finished</span>`;
  } else if (badge) {
    badgeMarkup = `<span class="new-badge">${badge}</span>`;
  }

  const playBtnTitle = isFinished ? 'Watch Again' : (isContinue ? 'Resume' : 'Play');
  const matchTag = isFinished
    ? `<span class="match" style="color:#46D369">✓ Watched</span>`
    : `<span class="match">${matchScore(m)}% Match</span>`;

  portal.innerHTML = `
    <div class="portal-thumb-wrap">
      ${badgeMarkup}
      ${top10Html}
      <img src="${backdrop(m)}" alt="${(m.name || '').replace(/"/g, '')}">
      <div class="portal-thumb-grad"></div>
    </div>
    <div class="portal-info">
      <div class="portal-title">${m.name || 'Untitled'}</div>
      <div class="hbtns">
        <button class="cbtn solid" data-pa="play" title="${playBtnTitle}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        </button>
        <button class="cbtn" data-pa="list" title="${inList ? 'Remove from My List' : 'Add to My List'}">
          ${inList
            ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
            : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'}
        </button>
        <button class="cbtn ${isLiked ? 'solid liked' : ''}" data-pa="like" title="${isLiked ? 'Remove from Favourites' : 'Add to Favourites'}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
        </button>
        <button class="cbtn" data-pa="dislike" title="Not for me">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>
        </button>
        <button class="cbtn" data-pa="dl" title="Download Servers">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
        <span style="flex:1"></span>
        <button class="cbtn" data-pa="info" title="Episode & Info">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
      </div>
      <div class="hm">
        ${matchTag}
        <span class="age-badge">${ageRating(m)}</span>
        <span>${(m.releaseInfo || m.year || '').toString().slice(0, 4)}</span>
        <span class="hd-badge">HD</span>
      </div>
      <div class="genres-line">${genresStr}</div>
    </div>
  `;

  const portalImg = portal.querySelector('img');
  if (portalImg) {
    portalImg.onerror = function() {
      this.onerror = null;
      this.src = createPosterFallback(m.name, (m.genres && m.genres[0]) || '', m.year || m.releaseInfo || '2024', m.imdbRating || '8.2', m.type || 'movie');
    };
  }

  portal.style.display = 'block';
  void portal.offsetWidth;
  portal.classList.add('open');

  portal.onclick = (e) => {
    const a = e.target.closest('[data-pa]')?.dataset.pa;
    const type = m.type || (m.id && m.id.startsWith('tt') ? 'movie' : 'movie');

    if (a === 'play') {
      closeCardPortal();
      if (m._embed) {
        if (isFinished) m._progress = 0;
        playEmbedEntry(m);
      } else {
        openDetail(m.id, type, true);
      }
    } else if (a === 'list') {
      toggleList(m);
      const listBtn = portal.querySelector('[data-pa="list"]');
      if (listBtn) {
        listBtn.classList.add('anim-pop');
        setTimeout(() => listBtn.classList.remove('anim-pop'), 400);
        const nowInList = myList.some(x => x.id === m.id);
        listBtn.innerHTML = nowInList
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        listBtn.classList.toggle('solid', nowInList);
      }
    } else if (a === 'like') {
      likes[m.id] = !likes[m.id];
      delete dislikes[m.id];
      store.set('nf_likes', likes);
      toast(likes[m.id] ? `Added "${m.name || 'title'}" to Favourites` : `Removed "${m.name || 'title'}" from Favourites`);
      const likeBtn = portal.querySelector('[data-pa="like"]');
      if (likeBtn) {
        likeBtn.classList.add('anim-pop');
        setTimeout(() => likeBtn.classList.remove('anim-pop'), 400);
        likeBtn.classList.toggle('solid', !!likes[m.id]);
        likeBtn.classList.toggle('liked', !!likes[m.id]);
      }
      if (currentDetail?.meta?.id === m.id) updateModalLikeButton(m.id);
    } else if (a === 'dislike') {
      dislikes[m.id] = !dislikes[m.id];
      delete likes[m.id];
      store.set('nf_likes', likes);
      toast(dislikes[m.id] ? 'Not for me' : 'Rating removed');
      const likeBtn = portal.querySelector('[data-pa="like"]');
      if (likeBtn) {
        likeBtn.classList.remove('solid');
        likeBtn.classList.remove('liked');
      }
      if (currentDetail?.meta?.id === m.id) updateModalLikeButton(m.id);
    } else if (a === 'dl') {
      closeCardPortal();
      const rawImdb = m.id || m.imdb_id;
      const imdb = rawImdb ? String(rawImdb).split(':')[0].trim() : null;
      openDownloadModal({
        title: m.name,
        type: m.type || type,
        imdb,
        tmdbId: m.moviedb_id,
        year: (m.releaseInfo || m.year || '').toString().slice(0, 4)
      });
    } else {
      closeCardPortal();
      if (m._embed) { playEmbedEntry(m); }
      else { openDetail(m.id, type, false); }
    }
  };
}

function closeCardPortal() {
  const portal = $('cardPortal');
  if (!portal) return;
  portal.classList.remove('open');
  portal.style.display = 'none';
  activeHoverCard = null;
}

const portalEl = $('cardPortal');
if (portalEl) {
  portalEl.addEventListener('wheel', () => onScrollActivity(), { passive: true });
  portalEl.addEventListener('mouseenter', () => {
    clearTimeout(cardLeaveTimer);
  });
  portalEl.addEventListener('mouseleave', () => {
    clearTimeout(cardLeaveTimer);
    cardLeaveTimer = setTimeout(() => {
      if (activeHoverCard && !activeHoverCard.matches(':hover')) {
        closeCardPortal();
      }
    }, 120);
  });
}

function removeFromHistory(id) {
  if (!id) return;
  const strId = String(id);
  const cleanId = strId.replace(/^tmdb:/, '');
  let removedTitle = '';

  for (const k of Object.keys(history)) {
    const entry = history[k];
    if (
      k === strId ||
      k === `tmdb:${cleanId}` ||
      k === cleanId ||
      (entry && (String(entry.id) === strId || String(entry.tmdbId) === cleanId || entry.imdb === strId))
    ) {
      if (entry?.title) removedTitle = entry.title;
      delete history[k];
    }
  }

  store.set('nf_history', history);

  try {
    const raw = localStorage.getItem('vidsrcProgress');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed[cleanId]) {
        delete parsed[cleanId];
        localStorage.setItem('vidsrcProgress', JSON.stringify(parsed));
      }
    }
  } catch {}

  renderContinueRow();
  toast(removedTitle ? `Removed "${removedTitle}" from history` : 'Removed from history');
}

function removeFromMyList(id) {
  if (!id) return;
  const i = myList.findIndex(x => x.id === id);
  if (i >= 0) {
    const name = myList[i].name || myList[i].title || 'title';
    myList.splice(i, 1);
    store.set('nf_mylist', myList);
    if (currentDetail?.meta?.id === id) updateModalListButton(id);
    const heroListBtn = $('heroList');
    if (heroListBtn && heroItems[heroIdx]?.id === id) {
      heroListBtn.innerHTML = `<svg class="icon-list" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span class="hero-list-txt">My List</span>`;
    }
    renderMyList();
    toast(`Removed "${name}" from My List`);
  }
}

function buildCard(m, badge, rank) {
  if (!m || !isCleanSafe(m)) return document.createComment('filtered');
  const type = m.type || (m.id && m.id.startsWith('tt') ? 'movie' : 'movie');
  const el = document.createElement('div');
  el.className = 'card';
  if (m._progress || m._finished) el.classList.add('landscape');

  const isContinue = (m._progress != null && !m._finished);
  const isFinished = !!m._finished;
  const isInMyList = !!m._inMyList;

  let badgeMarkup = '';
  if (isFinished) {
    badgeMarkup = `<span class="watched-badge"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Finished</span>`;
  } else if (badge) {
    badgeMarkup = `<span class="new-badge">${badge}</span>`;
  }

  const prog = isContinue
    ? `<div class="progress"><i style="width:${Math.round(m._progress * 100)}%"></i></div>`
    : '';

  const removeBtn = (isContinue || isFinished || isInMyList)
    ? `<span class="remove-x" title="${isInMyList ? 'Remove from My List' : (isFinished ? 'Remove from Finished Watching' : 'Remove from Continue Watching')}">✕</span>`
    : '';

  const finishToggleBtn = isContinue
    ? `<span class="finish-check" title="Mark as Finished">✓</span>`
    : '';

  const top10Html = rank && rank <= 10
    ? `<div class="top10-badge"><span style="font-size:7px;letter-spacing:0.02em">TOP</span><span>${rank}</span></div>`
    : '';

  el.innerHTML = `
    <div class="card-inner">
      ${badgeMarkup}
      ${top10Html}
      ${finishToggleBtn}
      ${removeBtn}
      <img loading="lazy" src="${poster(m)}" alt="${escapeHtml(m.name || m.title || '')}">
      ${prog}
    </div>
  `;

  const cardImg = el.querySelector('img');
  if (cardImg) {
    cardImg.onerror = function() {
      this.onerror = null;
      this.src = createPosterFallback(m.name || m.title, (m.genres && m.genres[0]) || '', m.year || m.releaseInfo || '2024', m.imdbRating || '8.2', m.type || type);
    };
  }

  // Authentic Netflix hover intent delay
  el.addEventListener('mouseenter', () => onCardMouseEnter(el, m, badge, rank));
  el.addEventListener('mouseleave', () => onCardMouseLeave(el));

  el.onclick = e => {
    if (isRowDragging) return;

    const rx = e.target.closest('.remove-x');
    if (rx) {
      e.preventDefault();
      e.stopPropagation();
      if (isInMyList) {
        removeFromMyList(m.id);
      } else {
        removeFromHistory(m.id);
      }
      return;
    }

    const fc = e.target.closest('.finish-check');
    if (fc) {
      e.preventDefault();
      e.stopPropagation();
      if (!history[m.id]) {
        history[m.id] = {
          title: m.name || m.title,
          type: m.type || type,
          progress: 1.0,
          finished: true,
          poster: poster(m),
          imdb: m.imdb || (typeof m.id === 'string' && m.id.startsWith('tt') ? m.id : null),
          tmdbId: m.tmdbId,
          lastWatched: Date.now()
        };
      } else {
        history[m.id].finished = true;
        history[m.id].progress = 1.0;
        history[m.id].lastWatched = Date.now();
      }
      store.set('nf_history', history);
      renderContinueRow();
      toast(`Marked "${m.name || m.title}" as finished`);
      return;
    }

    if (m._finished && history[m.id]) {
      history[m.id].finished = false;
      history[m.id].progress = 0.08;
      history[m.id].lastWatched = Date.now();
      store.set('nf_history', history);
      renderContinueRow();
    }

    if (m._embed) { playEmbedEntry(m); return; }

    const id = m.id, tp = m.type || type;
    openDetail(id, tp, false);
  };

  return el;
}

/* ---------- HERO BILLBOARD ---------- */
function renderHero(i) {
  heroIdx = i;
  const m = heroItems[i];
  if (!m) return;

  const bg = $('heroBg');
  if (bg) {
    bg.style.opacity = '0';
    bg.style.transform = 'scale(1.05)';
    void bg.offsetWidth;
    setTimeout(() => {
      bg.src = backdrop(m);
      bg.onload = () => {
        bg.style.opacity = '1';
        bg.style.transform = 'scale(1)';
      };
      setTimeout(() => {
        bg.style.opacity = '1';
        bg.style.transform = 'scale(1)';
      }, 300);
    }, 200);
  }

  const hc = document.querySelector('.hero-content');
  if (hc) {
    hc.style.animation = 'none';
    void hc.offsetWidth;
    hc.style.animation = '';
  }

  if ($('heroTitle')) $('heroTitle').textContent = m.name;
  if ($('heroMeta')) $('heroMeta').innerHTML = metaRowHTML(m);
  if ($('heroDesc')) $('heroDesc').textContent = m.description || '';
  if ($('heroMaturity')) $('heroMaturity').textContent = ageRating(m);
  if ($('heroKickerType')) $('heroKickerType').textContent = m.type === 'series' ? 'S E R I E S' : 'F I L M';

  if ($('heroPlay')) $('heroPlay').onclick = () => openDetail(m.id, m.type || 'movie', true);
  if ($('heroInfo')) $('heroInfo').onclick = () => openDetail(m.id, m.type || 'movie', false);

  const heroListBtn = $('heroList');
  if (heroListBtn) {
    const inList = myList.some(x => x.id === m.id);
    heroListBtn.innerHTML = inList
      ? `<svg class="icon-list" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span class="hero-list-txt">In My List</span>`
      : `<svg class="icon-list" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span class="hero-list-txt">My List</span>`;
    heroListBtn.onclick = () => {
      toggleList(m);
      heroListBtn.classList.add('anim-pop');
      setTimeout(() => heroListBtn.classList.remove('anim-pop'), 400);
    };
  }

  const dots = $('heroDots');
  if (dots) {
    dots.innerHTML = heroItems.map((_, k) => `<span class="${k === i ? 'on' : ''}" data-k="${k}"></span>`).join('');
    dots.querySelectorAll('span').forEach(s => {
      s.onclick = () => {
        clearInterval(heroTimer);
        renderHero(+s.dataset.k);
        heroTimer = setInterval(() => renderHero((heroIdx + 1) % heroItems.length), 8000);
      };
    });
  }
}

const heroNext = $('heroNext');
if (heroNext) {
  heroNext.onclick = () => {
    clearInterval(heroTimer);
    renderHero((heroIdx + 1) % heroItems.length);
    heroTimer = setInterval(() => renderHero((heroIdx + 1) % heroItems.length), 8000);
  };
}

/* ---------- EPISODE RUNTIME FORMATTER ---------- */
function formatEpisodeRuntime(v, m) {
  if (v && v.runtime && typeof v.runtime === 'string' && v.runtime.trim() !== '45m' && v.runtime.trim() !== '45 min') {
    return v.runtime;
  }
  const s = Math.max(1, Number(v?.season || 1));
  const ep = Math.max(1, Number(v?.episode || 1));

  const cleanId = String(m?.id || m?.imdb_id || m?.imdb || '').split(':')[0].trim();
  const canonical = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.CANONICAL_SERIES_METRICS)
    ? CuratedCatalog.CANONICAL_SERIES_METRICS[cleanId]
    : null;

  let base = canonical?.baseRuntime;
  if (!base && m?.runtime) {
    const parsed = parseInt(m.runtime);
    if (!isNaN(parsed) && parsed > 12 && parsed < 180) {
      base = parsed;
    }
  }

  if (!base) {
    const genres = (m?.genres || []).map(g => String(g).toLowerCase());
    if (genres.some(g => g.includes('animation') || g.includes('anime') || g.includes('comedy') || g.includes('sitcom'))) {
      base = 23;
    } else if (genres.some(g => g.includes('drama') || g.includes('crime') || g.includes('sci-fi') || g.includes('thriller') || g.includes('action') || g.includes('mystery') || g.includes('adventure'))) {
      base = 54;
    } else if (genres.some(g => g.includes('doc'))) {
      base = 50;
    } else {
      base = 48;
    }
  }

  let delta = 0;
  if (ep === 1) {
    delta = base > 30 ? 5 + ((s * 3) % 5) : 2;
  } else if (ep === 8 || ep === 10 || ep === 12 || ep === 16) {
    delta = base > 30 ? 7 + ((s * 5) % 7) : 3;
  } else {
    delta = ((s * 11 + ep * 17) % 9) - 4;
  }

  const totMin = Math.max(18, base + delta);
  if (totMin >= 60) {
    const h = Math.floor(totMin / 60);
    const min = totMin % 60;
    return `${h}h ${(min < 10 ? '0' : '') + min}m`;
  }
  return `${totMin}m`;
}

/* ---------- DETAIL MODAL ---------- */
async function openDetail(id, type, autoplay) {
  closeCardPortal();
  type = type === 'series' ? 'series' : 'movie';
  const backdropEl = $('detailBackdrop');
  if (backdropEl) backdropEl.classList.add('show');
  document.body.style.overflow = 'hidden';

  if ($('dTitle')) $('dTitle').textContent = 'Loading…';
  if ($('dDesc')) $('dDesc').textContent = '';

  try {
    let m = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(id) : null;
    if (type === 'series') {
      try {
        const j = await getJSON(`${CINEMETA}/meta/${type}/${id}.json`);
        if (j && j.meta) {
          const cinVids = (j.meta.videos || []).filter(v => Number(v.season) > 0 && Number(v.episode) > 0);
          if (m) {
            m = {
              ...j.meta,
              ...m,
              videos: (cinVids.length >= (m.videos || []).length && cinVids.length > 0) ? cinVids : (m.videos || cinVids)
            };
          } else {
            m = { ...j.meta, videos: cinVids };
          }
        }
      } catch (err) {
        console.warn('Cinemeta series metadata fetch fallback:', err);
      }
    } else if (!m) {
      try {
        const j = await getJSON(`${CINEMETA}/meta/${type}/${id}.json`);
        if (j && j.meta) m = j.meta;
      } catch (err) {
        console.warn('Cinemeta movie metadata fetch fallback:', err);
      }
    }
    if (!m || !isCleanSafe(m)) {
      if ($('dTitle')) $('dTitle').textContent = 'Content Unavailable';
      if ($('dDesc')) $('dDesc').textContent = 'This title is not available or has been filtered for family safety.';
      return;
    }
    m.type = type;
    if (type === 'series' && !m.moviedb_id) {
      const cur = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(id) : null;
      if (cur && cur.moviedb_id) m.moviedb_id = cur.moviedb_id;
    }
    currentDetail = { meta: m, type, streams: [], ep: { s: 1, e: 1 } };

    if ($('dBackdrop')) $('dBackdrop').src = backdrop(m);
    if ($('dTitle')) $('dTitle').textContent = m.name;
    if ($('dMeta')) $('dMeta').innerHTML = metaRowHTML(m);
    if ($('dDesc')) $('dDesc').textContent = m.description || '';

    if ($('dRight')) {
      $('dRight').innerHTML = `
        <div><b>Cast:</b> ${(m.cast || []).slice(0, 6).join(', ') || '—'}</div>
        <div style="margin-top:12px"><b>Genres:</b> ${(m.genres || []).join(', ')}</div>
        <div style="margin-top:12px"><b>This title is:</b> ${(m.genres || []).join(', ')}</div>
      `;
    }

    if ($('dAbout')) {
      $('dAbout').innerHTML = `
        <h4 style="font-size:17px;font-weight:700;margin-bottom:12px">About ${m.name}</h4>
        <div><span>Director: </span>${m.director || '—'}</div>
        <div><span>Cast: </span>${(m.cast || []).join(', ') || '—'}</div>
        <div><span>Genres: </span>${(m.genres || []).join(', ')}</div>
        <div><span>Maturity Rating: </span>${ageRating(m)}</div>
      `;
    }

    // Series episodes (Strictly filter out Season 0 / specials)
    let rawVids = m.videos || [];
    let vids = rawVids.filter(v => {
      const s = Number(v.season);
      const ep = Number(v.episode);
      return Number.isInteger(s) && s > 0 && Number.isInteger(ep) && ep > 0;
    });

    if (type === 'series') {
      const canonicalVids = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getSeriesVideos)
        ? CuratedCatalog.getSeriesVideos(m)
        : [];
      if (!vids.length) {
        vids = canonicalVids;
      } else if (canonicalVids && canonicalVids.length > 0) {
        // Ensure that any missing seasons/episodes are augmented from canonical
        const existingEpKeys = new Set(vids.map(v => `${v.season}:${v.episode}`));
        canonicalVids.forEach(cv => {
          if (!existingEpKeys.has(`${cv.season}:${cv.episode}`)) {
            vids.push(cv);
            existingEpKeys.add(`${cv.season}:${cv.episode}`);
          }
        });
      }
    }

    // Deduplicate and sort
    const seenEpKeys = new Set();
    vids = vids.filter(v => {
      const key = `${v.season}:${v.episode}`;
      if (seenEpKeys.has(key)) return false;
      seenEpKeys.add(key);
      return true;
    }).sort((a, b) => {
      const sDiff = Number(a.season) - Number(b.season);
      if (sDiff !== 0) return sDiff;
      return Number(a.episode) - Number(b.episode);
    });

    if (type === 'series' && vids.length) {
      if ($('epWrap')) $('epWrap').style.display = '';
      const seasons = [...new Set(vids.map(v => Number(v.season)))].filter(s => s > 0).sort((a, b) => a - b);
      if (!seasons.length) seasons.push(1);

      if ($('seasonSel')) {
        $('seasonSel').innerHTML = seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');
        const defaultSeason = seasons.includes(1) ? 1 : seasons[0];

        const renderEps = () => {
          const s = Math.max(1, +$('seasonSel').value || defaultSeason);
          currentDetail.ep.s = s;
          const list = $('epList');
          if (!list) return;
          list.innerHTML = '';

          const seasonVids = vids.filter(v => Number(v.season) === s).sort((a, b) => Number(a.episode) - Number(b.episode));
          if (seasonVids.length && seasonVids[0].episode) {
            currentDetail.ep.e = Math.max(1, Number(seasonVids[0].episode));
          }

          seasonVids.forEach(v => {
            const epNum = Math.max(1, Number(v.episode) || 1);
            const d = document.createElement('div');
            d.className = 'ep-card';
            d.innerHTML = `
              <div class="ep-num">${epNum}</div>
              <div class="ep-thumb">
                <img src="${v.thumbnail || m.background || m.poster}" alt="Episode thumbnail">
                <div class="ep-play">
                  <div class="ep-play-circle">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                  </div>
                </div>
              </div>
              <div class="ep-details">
                <div class="ep-title-row">
                  <b>${epNum}. ${v.title || v.name || 'Episode ' + epNum}</b>
                  <span class="ep-duration">${formatEpisodeRuntime(v, m)}</span>
                </div>
                <div class="ep-desc">${(v.overview || 'No description available.').slice(0, 150)}</div>
              </div>
            `;
            const epImg = d.querySelector('.ep-thumb img');
            if (epImg) {
              epImg.onerror = function() {
                this.onerror = null;
                this.src = createPosterFallback(m.name, (m.genres && m.genres[0]) || '', m.year || m.releaseInfo || '2024', m.imdbRating || '8.2', m.type || 'series');
              };
            }
            d.onclick = () => {
              currentDetail.ep = { s, e: epNum };
              playEpisode(s, epNum);
            };

            const dl = document.createElement('button');
            dl.className = 'cbtn ep-dl-btn';
            dl.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
            dl.title = `Download S${s}:E${epNum}`;
            dl.onclick = (e) => {
              e.stopPropagation();
              downloadEpisode(currentDetail.meta.name, s, epNum);
            };
            d.appendChild(dl);
            list.appendChild(d);
          });
        };
        $('seasonSel').onchange = renderEps;
        $('seasonSel').value = defaultSeason;
        renderEps();
      }
    } else {
      if ($('epWrap')) $('epWrap').style.display = 'none';
    }

    // Similar recommendations
    if ($('simGrid')) {
      $('simGrid').innerHTML = '';
      (await fetchCatalog(type + '/top')).filter(isCleanSafe).filter(x => x.id !== id && (x.genres || []).some(g => (m.genres || []).includes(g))).slice(0, 6).forEach(s => {
        const d = document.createElement('div');
        d.className = 'sim';
        d.innerHTML = `
          <img src="${backdrop(s)}" alt="${s.name}">
          <div class="sim-info">
            <div class="sim-title">${s.name}</div>
            <div class="sim-meta">
              <span class="match">${matchScore(s)}% Match</span>
              <span class="age-badge">${ageRating(s)}</span>
            </div>
          </div>
        `;
        const simImg = d.querySelector('img');
        if (simImg) {
          simImg.onerror = function() {
            this.onerror = null;
            this.src = createPosterFallback(s.name, (s.genres && s.genres[0]) || '', s.year || s.releaseInfo || '2024', s.imdbRating || '8.2', s.type || type);
          };
        }
        d.onclick = () => openDetail(s.id, s.type || type, false);
        $('simGrid').appendChild(d);
      });
    }

    updateModalListButton(id);
    updateModalLikeButton(id);
    if ($('dList')) $('dList').onclick = () => toggleList(m);
    if ($('dLike')) $('dLike').onclick = () => toggleLike(m);
    if ($('dDl')) $('dDl').onclick = () => downloadCurrent();

    const canWatch = type === 'movie'
      ? !!MediaLinks.getMovieStreamUrl({ imdb: m.id || m.imdb_id })
      : !!m.moviedb_id;

    if ($('dPlay')) {
      $('dPlay').disabled = !canWatch;
      $('dPlay').title = canWatch ? 'Watch now' : 'Streaming unavailable for this title';
      $('dPlay').onclick = () => playStream();
    }

    if (autoplay && canWatch) playStream();
  } catch {
    if ($('dTitle')) $('dTitle').textContent = 'Failed to load title information';
  }
}

function updateModalListButton(id) {
  const dList = $('dList');
  if (!dList) return;
  const inList = myList.some(x => x.id === id);
  dList.classList.toggle('solid', inList);
  dList.innerHTML = inList
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  dList.title = inList ? 'Remove from My List' : 'Add to My List';
}

function updateModalLikeButton(id) {
  const dLike = $('dLike');
  if (!dLike) return;
  const isLiked = !!likes[id];
  dLike.classList.toggle('solid', isLiked);
  dLike.classList.toggle('liked', isLiked);
  dLike.innerHTML = isLiked
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>';
  dLike.title = isLiked ? 'Remove from Favourites' : 'Add to Favourites';
}

function toggleLike(m) {
  if (!m || !m.id) return;
  likes[m.id] = !likes[m.id];
  delete dislikes[m.id];
  store.set('nf_likes', likes);
  toast(likes[m.id] ? `Added "${m.name || 'title'}" to Favourites` : `Removed "${m.name || 'title'}" from Favourites`);
  updateModalLikeButton(m.id);
  const dLike = $('dLike');
  if (dLike) {
    dLike.classList.add('anim-pop');
    setTimeout(() => dLike.classList.remove('anim-pop'), 400);
  }
}

const dClose = $('dClose');
if (dClose) dClose.onclick = closeDetail;

const detailBackdrop = $('detailBackdrop');
if (detailBackdrop) {
  detailBackdrop.addEventListener('click', e => {
    if (e.target.id === 'detailBackdrop') closeDetail();
  });
}

function closeDetail() {
  const bd = $('detailBackdrop');
  if (bd) bd.classList.remove('show');
  closeDownloadModal();
  document.body.style.overflow = '';
}

/* ---------- MY LIST ---------- */
function toggleList(m) {
  const i = myList.findIndex(x => x.id === m.id);
  if (i >= 0) {
    myList.splice(i, 1);
    toast('Removed from My List');
  } else {
    myList.push({
      id: m.id,
      type: m.type || 'movie',
      name: m.name,
      poster: poster(m),
      background: backdrop(m),
      genres: m.genres || [],
      releaseInfo: m.releaseInfo
    });
    toast('Added to My List');
  }
  store.set('nf_mylist', myList);
  const dList = $('dList');
  if (dList) {
    dList.classList.add('anim-pop');
    setTimeout(() => dList.classList.remove('anim-pop'), 400);
  }
  if (currentDetail?.meta?.id === m.id) updateModalListButton(m.id);
  const heroListBtn = $('heroList');
  if (heroListBtn && heroItems[heroIdx]?.id === m.id) {
    const inList = myList.some(x => x.id === m.id);
    heroListBtn.innerHTML = inList
      ? `<svg class="icon-list" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span class="hero-list-txt">In My List</span>`
      : `<svg class="icon-list" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span class="hero-list-txt">My List</span>`;
  }
  if (pages.mylist.classList.contains('show')) renderMyList();
}

function renderMyList() {
  const g = $('mylistGrid');
  if (!g) return;
  g.innerHTML = '';
  if ($('mylistCount')) {
    $('mylistCount').textContent = myList.length ? `${myList.length} ${myList.length === 1 ? 'Title' : 'Titles'}` : '';
  }
  if (!myList.length) {
    g.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <h2>Your List is Empty</h2>
        <p>Explore titles on Streamnaro and add your favorites to watch them anytime.</p>
        <br>
        <button class="btn-red" onclick="document.querySelector('[data-nav=home]').click()">Explore Titles</button>
      </div>
    `;
    return;
  }
  myList.forEach(m => g.appendChild(buildCard({ ...m, _inMyList: true })));
}

/* ---------- BROWSE (ORGANIZED TV SHOWS, MOVIES, NEW & POPULAR) ---------- */
let currentBrowseKind = 'movies';

async function openBrowse(kind) {
  currentBrowseKind = kind;
  show('browse');

  const titles = { movies: 'Movies', series: 'TV Shows', new: 'New & Popular' };
  if ($('browseTitle')) $('browseTitle').textContent = titles[kind] || 'Browse';

  const filterWrap = $('genreFilterWrap');
  if (filterWrap) filterWrap.style.display = kind === 'new' ? 'none' : 'flex';

  const genreSelect = $('genreSelect');
  if (genreSelect) {
    genreSelect.value = '';
    genreSelect.onchange = () => filterBrowseByGenre(genreSelect.value);
  }

  await loadCategoryRows(kind);
}

async function loadCategoryRows(kind) {
  const rowsWrap = $('browseRows');
  const gridWrap = $('browseGrid');
  if (!rowsWrap || !gridWrap) return;

  gridWrap.innerHTML = '';
  rowsWrap.innerHTML = skels(6);

  let categoryRows = [];
  if (kind === 'series') {
    categoryRows = [
      { id: 'b_series_top', title: 'Popular TV Shows', url: ['series/top', 'series/top/skip=100'] },
      { id: 'b_series_rated', title: 'Critically Acclaimed TV', url: ['series/imdbRating', 'series/imdbRating/skip=100'] },
      { id: 'b_series_crime', title: 'Crime, Mystery & Thrillers', url: ['series/top/genre=Crime', 'series/top/genre=Crime/skip=100'] },
      { id: 'b_series_action', title: 'Action & Adventure Series', url: ['series/top/genre=Action', 'series/top/genre=Adventure'] },
      { id: 'b_series_scifi', title: 'Sci-Fi & Supernatural', url: ['series/top/genre=Sci-Fi', 'series/top/genre=Sci-Fi/skip=100'] },
      { id: 'b_series_drama', title: 'Binge-Worthy Dramas', url: ['series/top/genre=Drama', 'series/top/genre=Drama/skip=100'] },
      { id: 'b_series_comedy', title: 'Sitcoms & Comedies', url: ['series/top/genre=Comedy', 'series/top/genre=Comedy/skip=100'] },
      { id: 'b_series_anime', title: 'Anime & Animation Hits', url: ['series/top/genre=Animation', 'series/top/genre=Animation/skip=100'] },
      { id: 'b_series_fantasy', title: 'Fantasy & Epic Sagas', url: ['series/top/genre=Fantasy', 'series/top/genre=Fantasy/skip=100'] },
      { id: 'b_series_doc', title: 'Docuseries & Real Stories', url: ['series/top/genre=Documentary', 'series/top/genre=Documentary/skip=100'] },
      { id: 'b_series_mystery', title: 'Mystery & Detective Series', url: ['series/top/genre=Mystery', 'series/top/genre=Mystery/skip=100'] },
      { id: 'b_series_horror', title: 'Supernatural & Horror Series', url: ['series/top/genre=Horror', 'series/top/genre=Horror/skip=100'] }
    ];
  } else if (kind === 'movies') {
    categoryRows = [
      { id: 'b_mov_top', title: 'Blockbuster Movies', url: ['movie/top', 'movie/top/skip=100'] },
      { id: 'b_mov_rated', title: 'IMDb Top Rated Movies', url: ['movie/imdbRating', 'movie/imdbRating/skip=100'] },
      { id: 'b_mov_action', title: 'High-Octane Action', url: ['movie/top/genre=Action', 'movie/top/genre=Action/skip=100'] },
      { id: 'b_mov_scifi', title: 'Sci-Fi & Futuristic Hits', url: ['movie/top/genre=Sci-Fi', 'movie/top/genre=Sci-Fi/skip=100'] },
      { id: 'b_mov_thriller', title: 'Suspense & Psychological Thrillers', url: ['movie/top/genre=Thriller', 'movie/top/genre=Thriller/skip=100'] },
      { id: 'b_mov_comedy', title: 'Comedies & Feel-Good', url: ['movie/top/genre=Comedy', 'movie/top/genre=Comedy/skip=100'] },
      { id: 'b_mov_horror', title: 'Horror & Paranormal', url: ['movie/top/genre=Horror', 'movie/top/genre=Horror/skip=100'] },
      { id: 'b_mov_romance', title: 'Romantic Favorites', url: ['movie/top/genre=Romance', 'movie/top/genre=Romance/skip=100'] },
      { id: 'b_mov_family', title: 'Family Movie Night', url: ['movie/top/genre=Family', 'movie/top/genre=Animation'] },
      { id: 'b_mov_doc', title: 'Documentary Films', url: ['movie/top/genre=Documentary', 'movie/top/genre=Documentary/skip=100'] },
      { id: 'b_mov_crime', title: 'Crime, Gangsters & Noir', url: ['movie/top/genre=Crime', 'movie/top/genre=Crime/skip=100'] },
      { id: 'b_mov_adventure', title: 'Epic Adventure & Quests', url: ['movie/top/genre=Adventure', 'movie/top/genre=Adventure/skip=100'] }
    ];
  } else if (kind === 'new') {
    categoryRows = [
      { id: 'b_new_mov', title: 'New Movie Releases', url: ['movie/year', 'movie/year/skip=100'], badge: 'NEW' },
      { id: 'b_new_series', title: 'New Series & Fresh Seasons', url: ['series/year', 'series/year/skip=100'], badge: 'NEW' },
      { id: 'b_new_top', title: 'Trending Movies This Week', url: ['movie/top', 'movie/top/skip=100'], isTop10: true },
      { id: 'b_new_top_series', title: 'Trending Series This Week', url: ['series/top', 'series/top/skip=100'], isTop10: true },
      { id: 'b_new_action', title: 'New Action & Thrillers', url: ['movie/year/genre=Action', 'movie/year/genre=Thriller'], badge: 'NEW' },
      { id: 'b_new_scifi', title: 'New Sci-Fi & Fantasy', url: ['movie/year/genre=Sci-Fi', 'movie/year/genre=Fantasy'], badge: 'NEW' }
    ];
  }

  rowsWrap.innerHTML = categoryRows.map(r => renderRowSection(r)).join('');
  rowsWrap.querySelectorAll('.row-sec').forEach(sec => wireRowControls(sec));

  const seenBrowseIds = new Set();
  for (const r of categoryRows) {
    const sec = $('row-' + r.id);
    if (!sec) continue;
    const track = sec.querySelector('.row-track');
    const urls = Array.isArray(r.url) ? r.url : [r.url];
    let pool = [];
    for (const u of urls) {
      pool = pool.concat(await fetchCatalog(u));
    }
    if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedForCategory) {
      pool = pool.concat(CuratedCatalog.getCuratedForCategory(r.id));
    }
    pool = dedupeMetas(pool).filter(isCleanSafe);
    if (!pool.length) continue;

    // Cross-row browse deduplication:
    // Real curated titles remain available in their genuine genre categories,
    // while procedural items are strictly deduplicated so synthetic titles never repeat.
    const curatedReal = pool.filter(m => !m._isProcedural);
    const proceduralPool = pool.filter(m => m._isProcedural && !seenBrowseIds.has(m.id));
    const freshPool = [...curatedReal, ...proceduralPool];
    const items = (freshPool.length >= 10 ? freshPool : pool).slice(0, 100);
    items.forEach(m => {
      if (m && m.id) seenBrowseIds.add(m.id);
    });

    sec.style.display = '';
    track.innerHTML = '';
    items.forEach((m, idx) => track.appendChild(buildCard(m, r.badge, r.isTop10 ? idx + 1 : 0)));
    track.dispatchEvent(new Event('scroll'));
  }
}

let currentBrowseResults = [];
let currentBrowseOffset = 0;
const BROWSE_PAGE_SIZE = 48;

function renderBrowseChunk() {
  const container = $('browseGrid');
  if (!container || !currentBrowseResults || !currentBrowseResults.length) return;
  const nextChunk = currentBrowseResults.slice(currentBrowseOffset, currentBrowseOffset + BROWSE_PAGE_SIZE);
  if (!nextChunk.length) return;
  nextChunk.forEach(meta => container.appendChild(buildCard(meta)));
  currentBrowseOffset += nextChunk.length;
}

async function filterBrowseByGenre(genre) {
  const rowsWrap = $('browseRows');
  const gridWrap = $('browseGrid');
  if (!rowsWrap || !gridWrap) return;

  if (!genre) {
    gridWrap.innerHTML = '';
    currentBrowseResults = [];
    currentBrowseOffset = 0;
    await loadCategoryRows(currentBrowseKind);
    return;
  }

  rowsWrap.innerHTML = '';
  gridWrap.innerHTML = skels(12);

  const type = currentBrowseKind === 'series' ? 'series' : 'movie';
  const [p1, p2, p3] = await Promise.all([
    fetchCatalog(`${type}/top/genre=${encodeURIComponent(genre)}`),
    fetchCatalog(`${type}/top/genre=${encodeURIComponent(genre)}/skip=100`),
    fetchCatalog(`${type}/top/genre=${encodeURIComponent(genre)}/skip=200`)
  ]);
  const curatedMatches = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.CURATED_MEDIA)
    ? CuratedCatalog.CURATED_MEDIA.filter(m => m.type === type && (m.genres || []).includes(genre))
    : [];
  const items = dedupeMetas([...curatedMatches, ...p1, ...p2, ...p3]).filter(isCleanSafe);

  gridWrap.innerHTML = items.length ? '' : `<div class="empty" style="grid-column:1/-1"><h2>No titles found for ${escapeHtml(genre)}</h2></div>`;
  currentBrowseResults = items;
  currentBrowseOffset = 0;
  renderBrowseChunk();
}

/* ---------- PROFILES ---------- */
function renderProfiles() {
  const av = $('avatars');
  if (!av) return;
  av.innerHTML = '';

  PROFILES.forEach(p => {
    const d = document.createElement('div');
    d.className = 'pav';
    d.innerHTML = `
      <div class="box" style="background:${p.color}">${p.id}</div>
      <div>${p.name}</div>
    `;
    d.onclick = () => selectProfile(p);
    av.appendChild(d);
  });
}

function renderProfileSwitcherDropdown() {
  const list = $('profileSwitcherList');
  if (!list) return;
  list.innerHTML = '';
  let current = store.get('nf_profile', 'Z');
  if (current === 'N') current = 'Z';

  PROFILES.forEach(p => {
    const item = document.createElement('div');
    item.className = 'profile-quick-switch';
    item.innerHTML = `
      <div class="mini-box" style="background:${p.color}">${p.id}</div>
      <span style="font-size:13px;color:#fff">${p.name}</span>
      ${p.id === current ? '<span style="margin-left:auto;color:#46D369;font-size:11px">● Active</span>' : ''}
    `;
    item.onclick = () => {
      selectProfile(p);
      closeAllNavDropdowns();
    };
    list.appendChild(item);
  });
}

function selectProfile(p) {
  store.set('nf_profile', p.id);
  const letter = $('avatarLetter');
  if (letter) {
    letter.textContent = p.id;
    letter.style.background = p.color;
  }
  show('home');
  toast(`Switched to ${p.name}`);
  renderProfileSwitcherDropdown();
}

/* ---------- SETTINGS & ADDONS ---------- */
const DEFAULT_ADDONS = [
  { name: 'Cinemeta', url: CINEMETA + '/manifest.json', info: 'Metadata & Catalogs (Official)' },
  { name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json', info: 'Multi-language Subtitles' }
];

function renderAddons() {
  const custom = store.get('nf_addons', []);
  const list = $('addonList');
  if (!list) return;
  list.innerHTML = '';

  [...DEFAULT_ADDONS.map(a => ({ ...a, locked: true })), ...custom].forEach(a => {
    const d = document.createElement('div');
    d.className = 'stream-card';
    d.innerHTML = `
      <div class="smeta">
        <div class="fn">${a.name}</div>
        <div class="ss">${a.url} — ${a.info || ''}</div>
      </div>
    `;
    if (!a.locked) {
      const b = document.createElement('button');
      b.className = 'btn-out';
      b.textContent = 'Remove';
      b.onclick = () => {
        store.set('nf_addons', store.get('nf_addons', []).filter(x => x.url !== a.url));
        renderAddons();
      };
      d.appendChild(b);
    } else {
      const s = document.createElement('span');
      s.style.cssText = 'color:#46D369;font-size:12px;font-weight:600';
      s.textContent = '● Installed';
      d.appendChild(s);
    }
    list.appendChild(d);
  });
}

const addAddon = $('addAddon');
if (addAddon) {
  addAddon.onclick = () => {
    const input = $('customAddon');
    const u = input ? input.value.trim() : '';
    if (!u) return;
    const arr = store.get('nf_addons', []);
    arr.push({ name: 'Custom Addon', url: u, info: 'User installed' });
    store.set('nf_addons', arr);
    if (input) input.value = '';
    renderAddons();
    toast('Addon added successfully');
  };
}

const clearData = $('clearData');
if (clearData) {
  clearData.onclick = () => {
    myList = [];
    history = {};
    store.set('nf_mylist', []);
    store.set('nf_history', {});
    toast('History & My List cleared');
    renderMyList();
    renderContinueRow();
  };
}

/* ---------- DOWNLOAD SERVERS SYSTEM (VidVault & 02MovieDownloader) ---------- */
let _lastDownloadClick = 0;
function safeOpenDownloadUrl(url) {
  if (!url) return;
  const now = Date.now();
  if (now - _lastDownloadClick < 800) return; // Debounce to prevent multiple tabs / duplicate clicks
  _lastDownloadClick = now;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function openOmnisave(query) {
  const url = MediaLinks.omnisaveUrl(query);
  safeOpenDownloadUrl(url);
  if (!query) {
    toast('Server 3 (Global Search Mirror) opened in a new tab');
    return;
  }
  try {
    const done = navigator.clipboard && navigator.clipboard.writeText(query);
    if (done && done.then) {
      done.then(
        () => toast('Server 3 opened — title copied to clipboard'),
        () => toast('Server 3 opened in a new tab')
      );
    } else {
      toast('Server 3 opened in a new tab');
    }
  } catch {
    toast('Server 3 opened in a new tab');
  }
}

function currentTitleContext() {
  if (currentDetail?.meta) {
    const m = currentDetail.meta;
    const rawImdb = m.id || m.imdb_id;
    const imdb = rawImdb ? String(rawImdb).split(':')[0].trim() : '';
    const s = Math.max(1, Number(currentDetail.ep?.s || 1));
    const ep = Math.max(1, Number(currentDetail.ep?.e || 1));
    return {
      title: m.name,
      type: currentDetail.type,
      imdb,
      tmdbId: m.moviedb_id,
      year: (m.releaseInfo || m.year || '').toString().slice(0, 4),
      season: s,
      episode: ep,
      poster: poster(m)
    };
  }
  if (currentEmbed) {
    const s = Math.max(1, Number(currentEmbed.season || 1));
    const ep = Math.max(1, Number(currentEmbed.episode || 1));
    return {
      title: currentEmbed.title,
      type: currentEmbed.type,
      imdb: currentEmbed.imdb,
      tmdbId: currentEmbed.tmdbId,
      season: s,
      episode: ep,
      year: currentEmbed.year || '',
      poster: currentEmbed.poster || ''
    };
  }
  return null;
}

function openDownloadModal(ctx) {
  if (!ctx) { toast('Select a title first'); return; }

  const backdrop = $('serverSelectBackdrop');
  if (!backdrop) {
    const query = ctx.type === 'series'
      ? MediaLinks.getEpisodeDownloadSearch({ title: ctx.title }, ctx.season, ctx.episode)
      : MediaLinks.getMovieDownloadSearch({ title: ctx.title });
    openOmnisave(query);
    return;
  }

  const isSeries = ctx.type === 'series';
  const s = Math.max(1, Number(ctx.season || 1));
  const e = Math.max(1, Number(ctx.episode || 1));
  const rawImdb = ctx.imdb || ctx.id;
  const imdbId = rawImdb ? String(rawImdb).split(':')[0].trim() : '';

  // Media preview poster & badge
  const posterEl = $('serverModalPoster');
  if (posterEl) {
    if (ctx.poster) {
      posterEl.src = ctx.poster;
      posterEl.style.display = 'block';
    } else {
      posterEl.style.display = 'none';
    }
  }

  const badgeEl = $('serverModalTypeBadge');
  if (badgeEl) {
    badgeEl.textContent = isSeries
      ? `S${s}:E${e} • 1080p Full HD`
      : `1080p Full HD • Direct`;
  }

  const titleEl = $('serverModalTitle');
  if (titleEl) {
    titleEl.textContent = isSeries
      ? `Download Episode — ${ctx.title || 'Series'}`
      : `Download Movie — ${ctx.title || 'Movie'}`;
  }

  const metaEl = $('serverModalMeta');
  if (metaEl) {
    metaEl.textContent = isSeries
      ? `Season ${s}, Episode ${e} • Verified High-Speed Mirrors`
      : `${ctx.year ? ctx.year + ' • ' : ''}High-Speed Download Mirrors`.trim();
  }

  // Server 1: VidVault (Primary)
  const vidVaultUrl = isSeries
    ? MediaLinks.getVidVaultEpisodeUrl(imdbId, s, e)
    : MediaLinks.getVidVaultMovieUrl(imdbId);

  // Server 2: 02MovieDownloader (Alternative)
  const movie02Url = isSeries
    ? MediaLinks.get02MovieDownloaderEpisodeUrl(imdbId, s, e)
    : MediaLinks.get02MovieDownloaderMovieUrl(imdbId);

  // Server 3: OmniSave Search Mirror
  const query = isSeries
    ? MediaLinks.getEpisodeDownloadSearch({ title: ctx.title }, s, e)
    : MediaLinks.getMovieDownloadSearch({ title: ctx.title });
  const omniUrl = MediaLinks.omnisaveUrl(query);

  const b1 = $('serverBtnVidvault');
  if (b1) {
    b1.onclick = () => {
      if (!vidVaultUrl) {
        toast('IMDb ID missing for this title on Server 1');
        return;
      }
      safeOpenDownloadUrl(vidVaultUrl);
      toast('Opening Server 1 — Direct High Speed…');
      closeDownloadModal();
    };
  }

  const c1 = $('serverCopyVidvault');
  if (c1) {
    c1.onclick = () => {
      if (!vidVaultUrl) {
        toast('No Server 1 link available for this title');
        return;
      }
      try {
        navigator.clipboard.writeText(vidVaultUrl).then(
          () => toast('Server 1 direct link copied to clipboard!'),
          () => toast('Server 1 link ready')
        );
      } catch {
        toast('Server 1 link ready');
      }
    };
  }

  const b2 = $('serverBtn02');
  if (b2) {
    b2.onclick = () => {
      if (!movie02Url) {
        toast('IMDb ID missing for this title on Server 2');
        return;
      }
      safeOpenDownloadUrl(movie02Url);
      toast('Opening Server 2 — Multi-Quality Mirror…');
      closeDownloadModal();
    };
  }

  const c2 = $('serverCopy02');
  if (c2) {
    c2.onclick = () => {
      if (!movie02Url) {
        toast('No Server 2 link available for this title');
        return;
      }
      try {
        navigator.clipboard.writeText(movie02Url).then(
          () => toast('Server 2 link copied to clipboard!'),
          () => toast('Server 2 link ready')
        );
      } catch {
        toast('Server 2 link ready');
      }
    };
  }

  const b3 = $('serverBtnOmni');
  if (b3) {
    b3.onclick = () => {
      safeOpenDownloadUrl(omniUrl);
      toast('Opening Server 3 — Global Search Mirror…');
      closeDownloadModal();
    };
  }

  backdrop.classList.add('show');
}

function closeDownloadModal() {
  const backdrop = $('serverSelectBackdrop');
  if (backdrop) backdrop.classList.remove('show');
}

const serverModalClose = $('serverModalClose');
if (serverModalClose) serverModalClose.onclick = closeDownloadModal;

const serverSelectBackdrop = $('serverSelectBackdrop');
if (serverSelectBackdrop) {
  serverSelectBackdrop.onclick = (e) => {
    if (e.target === serverSelectBackdrop) closeDownloadModal();
  };
}

function downloadCurrent() {
  const ctx = currentTitleContext();
  if (!ctx) { toast('Select a title first'); return; }
  openDownloadModal(ctx);
}

function downloadEpisode(seriesTitle, season, episode) {
  const m = currentDetail?.meta;
  const rawImdb = m ? (m.id || m.imdb_id) : null;
  const imdb = rawImdb ? String(rawImdb).split(':')[0].trim() : null;
  const s = Math.max(1, Number(season) || 1);
  const ep = Math.max(1, Number(episode) || 1);
  openDownloadModal({
    title: seriesTitle || m?.name || 'Series',
    type: 'series',
    imdb,
    tmdbId: m?.moviedb_id,
    season: s,
    episode: ep
  });
}

const pDl = $('pDl');
if (pDl) pDl.onclick = () => downloadCurrent();

/* ---------- CAPTIONS, OPENSUBTITLES & PLAYER CUSTOMIZATION ---------- */
function applyPlayerTheme(theme) {
  const root = document.documentElement;
  if (theme === 'blue') {
    root.style.setProperty('--nf-red', '#3B82F6');
    root.style.setProperty('--nf-red-hover', '#60A5FA');
  } else if (theme === 'emerald') {
    root.style.setProperty('--nf-red', '#10B981');
    root.style.setProperty('--nf-red-hover', '#34D399');
  } else if (theme === 'amber') {
    root.style.setProperty('--nf-red', '#F59E0B');
    root.style.setProperty('--nf-red-hover', '#FBBF24');
  } else {
    root.style.setProperty('--nf-red', '#E50914');
    root.style.setProperty('--nf-red-hover', '#F40612');
  }
}

function updateSubPreview() {
  const textEl = $('subPreviewText');
  if (!textEl) return;
  const color = $('captionModalColorSelect')?.value || '#FFE600';
  const size = $('captionModalSizeSelect')?.value || 'medium';
  const style = $('captionModalStyleSelect')?.value || 'shadow';

  textEl.style.color = color;
  if (size === 'small') textEl.style.fontSize = '13px';
  else if (size === 'large') textEl.style.fontSize = '20px';
  else if (size === 'xlarge') textEl.style.fontSize = '24px';
  else textEl.style.fontSize = '16px';

  if (style === 'box') {
    textEl.style.background = 'rgba(0, 0, 0, 0.88)';
    textEl.style.padding = '4px 10px';
    textEl.style.borderRadius = '4px';
    textEl.style.textShadow = 'none';
  } else if (style === 'outline') {
    textEl.style.background = 'transparent';
    textEl.style.padding = '0';
    textEl.style.borderRadius = '0';
    textEl.style.textShadow = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 3px 6px #000';
  } else {
    textEl.style.background = 'transparent';
    textEl.style.padding = '0';
    textEl.style.borderRadius = '0';
    textEl.style.textShadow = '0 2px 4px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.95)';
  }
}

const SUBTITLE_LANGUAGES = [
  { code: 'off', label: 'Off', sub: 'Subtitles Disabled' },
  { code: 'en', label: 'English', sub: 'English' },
  { code: 'ar', label: 'Arabic', sub: 'العربية' },
  { code: 'es', label: 'Spanish', sub: 'Español' },
  { code: 'fr', label: 'French', sub: 'Français' },
  { code: 'de', label: 'German', sub: 'Deutsch' },
  { code: 'it', label: 'Italian', sub: 'Italiano' },
  { code: 'pt', label: 'Portuguese', sub: 'Português' },
  { code: 'ru', label: 'Russian', sub: 'Русский' },
  { code: 'tr', label: 'Turkish', sub: 'Türkçe' },
  { code: 'ja', label: 'Japanese', sub: '日本語' },
  { code: 'ko', label: 'Korean', sub: '한국어' },
  { code: 'zh', label: 'Chinese', sub: '中文' },
  { code: 'hi', label: 'Hindi', sub: 'हिन्दी' },
  { code: 'nl', label: 'Dutch', sub: 'Nederlands' },
  { code: 'pl', label: 'Polish', sub: 'Polski' },
  { code: 'sv', label: 'Swedish', sub: 'Svenska' },
  { code: 'id', label: 'Indonesian', sub: 'Bahasa' },
  { code: 'vi', label: 'Vietnamese', sub: 'Tiếng Việt' },
  { code: 'el', label: 'Greek', sub: 'Ελληνικά' },
  { code: 'fa', label: 'Persian', sub: 'فارسی' },
  { code: 'he', label: 'Hebrew', sub: 'עברית' }
];

function renderCaptionLangPills(filter = '') {
  const container = $('captionLangPills');
  if (!container) return;
  const currentLang = store.get('nf_sub_lang', 'ar');
  const term = String(filter || '').trim().toLowerCase();

  const matches = SUBTITLE_LANGUAGES.filter(item => {
    if (!term) return true;
    return item.label.toLowerCase().includes(term) ||
           item.sub.toLowerCase().includes(term) ||
           item.code.toLowerCase().includes(term);
  });

  const countEl = $('captionLangCount');
  if (countEl) countEl.textContent = `${matches.length} language${matches.length === 1 ? '' : 's'}`;

  container.innerHTML = '';
  if (!matches.length) {
    container.innerHTML = '<div style="font-size:12px;color:#888;padding:6px">No matching languages found</div>';
    return;
  }

  matches.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `caption-lang-pill ${item.code === currentLang ? 'active' : ''}`;
    btn.innerHTML = `${item.label} <span style="font-size:10px;opacity:0.75">(${item.sub})</span>`;
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectCaptionLanguage(item.code, item.label);
    };
    container.appendChild(btn);
  });
}

function selectCaptionLanguage(langCode, optLabel) {
  store.set('nf_sub_lang', langCode);
  const sLang = $('settingSubLang');
  const mLang = $('captionModalLangSelect');
  if (sLang) sLang.value = langCode;
  if (mLang) mLang.value = langCode;
  updateSubPreview();
  renderCaptionLangPills($('captionLangSearch')?.value || '');
  if (typeof applySubtitleToActivePlayer === 'function') {
    applySubtitleToActivePlayer(langCode);
  }
  toast(`Subtitles set to: ${optLabel || langCode}`);
}

/* ==========================================================================
   WEBSITE MULTI-LANGUAGE SYSTEM (i18n)
   Supported: English (en), French (fr), Spanish (es), Russian (ru),
              Arabic (ar), Indian/Hindi (hi), Portuguese (pt)
   ========================================================================== */
const I18N_TRANSLATIONS = {
  en: {
    name: 'English',
    dir: 'ltr',
    navHome: 'Home',
    navSeries: 'TV Shows',
    navMovies: 'Movies',
    navNew: 'New & Popular',
    navMyList: 'My List',
    navSettings: 'Settings',
    searchPlaceholder: 'Titles, people, genres',
    heroPlay: 'Play',
    heroMoreInfo: 'More Info',
    heroMyList: 'My List',
    heroInList: 'In My List',
    browseTitleMovies: 'Movies',
    browseTitleSeries: 'TV Shows',
    browseTitleNew: 'New & Popular',
    settingsTitle: 'Settings & Preferences',
    settingsSub: 'Manage language, subtitles, streaming options, download servers, and local library data.',
    langCardTitle: 'Display & Interface Language',
    langCardDesc: 'Choose your preferred language for menus, titles, navigation, and settings.',
    langFieldLabel: 'Website Language',
    langStatus: 'Real-time interface localization active across the platform',
    captionsTitle: 'Captions & Audio',
    captionsDesc: 'Configure default subtitles, languages, and typography.',
    subLangLabel: 'Default Subtitle Language',
    subSizeLabel: 'Subtitle Font Size',
    serversTitle: 'Download Servers',
    serversDesc: 'Active download endpoints and multi-server system configuration.',
    addonsTitle: 'Addons & Content Catalogs',
    addonsDesc: 'Live Cinemeta catalog feeds and installed custom providers.',
    dataTitle: 'Data Management',
    dataDesc: 'Local storage, viewing progress, cached data, and preferences.',
    downloadBtn: 'Download',
    episodes: 'Episodes',
    season: 'Season',
    close: 'Close',
    langChanged: 'Website language updated to English'
  },
  fr: {
    name: 'Français',
    dir: 'ltr',
    navHome: 'Accueil',
    navSeries: 'Séries',
    navMovies: 'Films',
    navNew: 'Nouveautés',
    navMyList: 'Ma Liste',
    navSettings: 'Paramètres',
    searchPlaceholder: 'Titres, personnes, genres',
    heroPlay: 'Lecture',
    heroMoreInfo: 'Plus d\'infos',
    heroMyList: 'Ma Liste',
    heroInList: 'Dans ma liste',
    browseTitleMovies: 'Films',
    browseTitleSeries: 'Séries TV',
    browseTitleNew: 'Nouveautés & Populaires',
    settingsTitle: 'Paramètres & Préférences',
    settingsSub: 'Gérez la langue, les sous-titres, les options de streaming et les serveurs.',
    langCardTitle: 'Langue d\'affichage & Interface',
    langCardDesc: 'Choisissez votre langue préférée pour les menus, titres et navigation.',
    langFieldLabel: 'Langue du site',
    langStatus: 'Traduction d\'interface en temps réel active',
    captionsTitle: 'Sous-titres & Audio',
    captionsDesc: 'Configurez les sous-titres par défaut, langues et police.',
    subLangLabel: 'Langue des sous-titres par défaut',
    subSizeLabel: 'Taille des sous-titres',
    serversTitle: 'Serveurs de téléchargement',
    serversDesc: 'Serveurs actifs et configuration des liens directs.',
    addonsTitle: 'Extensions & Catalogues',
    addonsDesc: 'Flux de métadonnées et fournisseurs officiels.',
    dataTitle: 'Gestion des données',
    dataDesc: 'Stockage local, historique de visionnage et préférences.',
    downloadBtn: 'Télécharger',
    episodes: 'Épisodes',
    season: 'Saison',
    close: 'Fermer',
    langChanged: 'Langue du site mise à jour en Français'
  },
  es: {
    name: 'Español',
    dir: 'ltr',
    navHome: 'Inicio',
    navSeries: 'Series TV',
    navMovies: 'Películas',
    navNew: 'Novedades populares',
    navMyList: 'Mi Lista',
    navSettings: 'Configuración',
    searchPlaceholder: 'Títulos, personas, géneros',
    heroPlay: 'Reproducir',
    heroMoreInfo: 'Más información',
    heroMyList: 'Mi Lista',
    heroInList: 'En mi lista',
    browseTitleMovies: 'Películas',
    browseTitleSeries: 'Series TV',
    browseTitleNew: 'Novedades Populares',
    settingsTitle: 'Configuración & Preferencias',
    settingsSub: 'Gestiona idioma, subtítulos, reproducción y servidores de descarga.',
    langCardTitle: 'Idioma de visualización e interfaz',
    langCardDesc: 'Elige tu idioma preferido para menús, títulos, navegación y ajustes.',
    langFieldLabel: 'Idioma del sitio web',
    langStatus: 'Traducción de interfaz en tiempo real activa',
    captionsTitle: 'Subtítulos y audio',
    captionsDesc: 'Configura subtítulos predeterminados, idiomas y tipografía.',
    subLangLabel: 'Idioma de subtítulos predeterminado',
    subSizeLabel: 'Tamaño de subtítulos',
    serversTitle: 'Servidores de descarga',
    serversDesc: 'Puntos finales activos y configuración multi-servidor.',
    addonsTitle: 'Complementos y catálogos',
    addonsDesc: 'Fuentes de catálogo de Cinemeta y proveedores.',
    dataTitle: 'Gestión de datos',
    dataDesc: 'Almacenamiento local, progreso de visualización y biblioteca.',
    downloadBtn: 'Descargar',
    episodes: 'Episodios',
    season: 'Temporada',
    close: 'Cerrar',
    langChanged: 'Idioma del sitio actualizado a Español'
  },
  ru: {
    name: 'Русский',
    dir: 'ltr',
    navHome: 'Главная',
    navSeries: 'Сериалы',
    navMovies: 'Фильмы',
    navNew: 'Новое и популярное',
    navMyList: 'Мой список',
    navSettings: 'Настройки',
    searchPlaceholder: 'Фильмы, сериалы, жанры',
    heroPlay: 'Смотреть',
    heroMoreInfo: 'Подробнее',
    heroMyList: 'В список',
    heroInList: 'В списке',
    browseTitleMovies: 'Фильмы',
    browseTitleSeries: 'Сериалы',
    browseTitleNew: 'Новое и популярное',
    settingsTitle: 'Настройки & Параметры',
    settingsSub: 'Управление языком, субтитрами, воспроизведением и серверами загрузки.',
    langCardTitle: 'Язык интерфейса и отображения',
    langCardDesc: 'Выберите предпочтительный язык для меню, названий и навигации.',
    langFieldLabel: 'Язык сайта',
    langStatus: 'Локализация интерфейса активна в реальном времени',
    captionsTitle: 'Субтитры и звук',
    captionsDesc: 'Настройка субтитров по умолчанию, языков и шрифта.',
    subLangLabel: 'Язык субтитров по умолчанию',
    subSizeLabel: 'Размер шрифта субтитров',
    serversTitle: 'Серверы загрузки',
    serversDesc: 'Активные серверы и конфигурация зеркал скачивания.',
    addonsTitle: 'Каталоги и плагины',
    addonsDesc: 'Официальные каталоги Cinemeta и дополнения.',
    dataTitle: 'Управление данными',
    dataDesc: 'Локальное хранилище, история просмотров и настройки.',
    downloadBtn: 'Скачать',
    episodes: 'Серии',
    season: 'Сезон',
    close: 'Закрыть',
    langChanged: 'Язык сайта переключен на Русский'
  },
  ar: {
    name: 'العربية',
    dir: 'rtl',
    navHome: 'الرئيسية',
    navSeries: 'مسلسلات',
    navMovies: 'أفلام',
    navNew: 'الجديد والشائع',
    navMyList: 'قائمتي',
    navSettings: 'الإعدادات',
    searchPlaceholder: 'عناوين، ممثلين، تصنيفات',
    heroPlay: 'تشغيل',
    heroMoreInfo: 'تفاصيل أكثر',
    heroMyList: 'قائمتي',
    heroInList: 'في قائمتي',
    browseTitleMovies: 'أفلام',
    browseTitleSeries: 'مسلسلات تلفزيونية',
    browseTitleNew: 'الجديد والشائع',
    settingsTitle: 'الإعدادات والتفضيلات',
    settingsSub: 'إدارة لغة الموقع، الترجمات، خيارات البث وخوادم التحميل المباشر.',
    langCardTitle: 'لغة العرض والواجهة',
    langCardDesc: 'اختر لغتك المفضلة للقوائم والعناوين والتنقل والإعدادات.',
    langFieldLabel: 'لغة الموقع',
    langStatus: 'التعريب المباشر للواجهة مفعّل بالكامل',
    captionsTitle: 'الترجمة والصوت',
    captionsDesc: 'تهيئة لغة الترجمة الافتراضية وحجم الخط والمظهر.',
    subLangLabel: 'لغة الترجمة الافتراضية',
    subSizeLabel: 'حجم خط الترجمة',
    serversTitle: 'خوادم التحميل المباشر',
    serversDesc: 'الخوادم النشطة وروابط التحميل عالية السرعة.',
    addonsTitle: 'الإضافات وكتالوجات المحتوى',
    addonsDesc: 'تغذية البيانات المباشرة من Cinemeta والإضافات.',
    dataTitle: 'إدارة البيانات',
    dataDesc: 'التخزين المحلي، سجل المشاهدة، والبيانات المحفوظة.',
    downloadBtn: 'تحميل',
    episodes: 'الحلقات',
    season: 'الموسم',
    close: 'إغلاق',
    langChanged: 'تم تحديث لغة الموقع إلى العربية بنجاح'
  },
  hi: {
    name: 'हिन्दी',
    dir: 'ltr',
    navHome: 'होम',
    navSeries: 'टीवी शो',
    navMovies: 'फ़िल्में',
    navNew: 'नया और लोकप्रिय',
    navMyList: 'मेरी सूची',
    navSettings: 'सेटिंग्स',
    searchPlaceholder: 'शीर्षक, लोग, शैलियाँ खोजें',
    heroPlay: 'चलाएं',
    heroMoreInfo: 'और जानकारी',
    heroMyList: 'मेरी सूची',
    heroInList: 'सूची में है',
    browseTitleMovies: 'फ़िल्में',
    browseTitleSeries: 'टीवी धारावाहिक',
    browseTitleNew: 'नया और लोकप्रिय',
    settingsTitle: 'सेटिंग्स और प्राथमिकताएं',
    settingsSub: 'भाषा, उपशीर्षक, स्ट्रीमिंग विकल्प और डाउनलोड सर्वर प्रबंधित करें।',
    langCardTitle: 'डिस्प्ले और इंटरफ़ेस भाषा',
    langCardDesc: 'मेनू, शीर्षक और नेविगेशन के लिए अपनी पसंदीदा भाषा चुनें।',
    langFieldLabel: 'वेबसाइट की भाषा',
    langStatus: 'रीयल-टाइम इंटरफ़ेस स्थानीयकरण सक्रिय है',
    captionsTitle: 'उपशीर्षक और ऑडियो',
    captionsDesc: 'डिफ़ॉल्ट उपशीर्षक, भाषाएं और फ़ॉन्ट आकार कॉन्फ़िगर करें।',
    subLangLabel: 'डिफ़ॉल्ट उपशीर्षक भाषा',
    subSizeLabel: 'उपशीर्षक फ़ॉन्ट का आकार',
    serversTitle: 'डाउनलोड सर्वर',
    serversDesc: 'सक्रिय डाउनलोड एंडपॉइंट और मल्टी-सर्वर सिस्टम।',
    addonsTitle: 'ऐड-ऑन और कैटलॉग',
    addonsDesc: 'लाइव सिनेमेटा कैटलॉग और इंस्टॉल किए गए प्रदाता।',
    dataTitle: 'डेटा प्रबंधन',
    dataDesc: 'स्थानीय मेमोरी, देखने का इतिहास और लाइब्रेरी डेटा।',
    downloadBtn: 'डाउनलोड',
    episodes: 'एपिसोड',
    season: 'सीज़न',
    close: 'बंद करें',
    langChanged: 'वेबसाइट की भाषा हिन्दी में बदल दी गई है'
  },
  pt: {
    name: 'Português',
    dir: 'ltr',
    navHome: 'Início',
    navSeries: 'Séries',
    navMovies: 'Filmes',
    navNew: 'Bombando',
    navMyList: 'Minha Lista',
    navSettings: 'Configurações',
    searchPlaceholder: 'Títulos, pessoas, gêneros',
    heroPlay: 'Assistir',
    heroMoreInfo: 'Mais Informações',
    heroMyList: 'Minha Lista',
    heroInList: 'Na Minha Lista',
    browseTitleMovies: 'Filmes',
    browseTitleSeries: 'Séries de TV',
    browseTitleNew: 'Novos & Populares',
    settingsTitle: 'Configurações & Preferências',
    settingsSub: 'Gerencie idioma, legendas, transmissão e servidores de download.',
    langCardTitle: 'Idioma de Exibição e Interface',
    langCardDesc: 'Escolha seu idioma preferido para menus, títulos e navegação.',
    langFieldLabel: 'Idioma do site',
    langStatus: 'Tradução em tempo real ativa em toda a plataforma',
    captionsTitle: 'Legendas e Áudio',
    captionsDesc: 'Configure legendas padrão, idiomas e tamanho do texto.',
    subLangLabel: 'Idioma de legenda padrão',
    subSizeLabel: 'Tamanho da fonte da legenda',
    serversTitle: 'Servidores de Download',
    serversDesc: 'Servidores de alta velocidade e espelhos de download.',
    addonsTitle: 'Extensões e Catálogos',
    addonsDesc: 'Fontes de metadados do Cinemeta e provedores instalados.',
    dataTitle: 'Gerenciamento de Dados',
    dataDesc: 'Armazenamento local, histórico de exibição e preferências.',
    downloadBtn: 'Baixar',
    episodes: 'Episódios',
    season: 'Temporada',
    close: 'Fechar',
    langChanged: 'Idioma do site alterado para Português'
  }
};

function getActiveAppLanguage() {
  const saved = store.get('nf_app_lang', 'en');
  return I18N_TRANSLATIONS[saved] ? saved : 'en';
}

function setAppLanguage(langCode, silent = false) {
  const lang = I18N_TRANSLATIONS[langCode] ? langCode : 'en';
  const t = I18N_TRANSLATIONS[lang];
  store.set('nf_app_lang', lang);

  document.documentElement.lang = lang;
  document.documentElement.dir = t.dir || 'ltr';
  if (t.dir === 'rtl') {
    document.body.classList.add('rtl-mode');
  } else {
    document.body.classList.remove('rtl-mode');
  }

  const navMap = {
    home: t.navHome,
    series: t.navSeries,
    movies: t.navMovies,
    new: t.navNew,
    mylist: t.navMyList,
    settings: t.navSettings
  };
  document.querySelectorAll('[data-nav]').forEach(el => {
    const k = el.getAttribute('data-nav');
    if (navMap[k]) {
      const sp = el.querySelector('span');
      if (sp) sp.textContent = navMap[k];
      else el.textContent = navMap[k];
    }
  });

  const sInput = $('searchInput');
  if (sInput) sInput.placeholder = t.searchPlaceholder;

  const hPlay = $('heroPlay');
  if (hPlay) {
    const sp = hPlay.querySelector('span');
    if (sp) sp.textContent = t.heroPlay;
  }
  const hInfo = $('heroInfo');
  if (hInfo) {
    const sp = hInfo.querySelector('span');
    if (sp) sp.textContent = t.heroMoreInfo;
  }
  const hListTxt = document.querySelector('.hero-list-txt');
  if (hListTxt) {
    const inList = heroItems[heroIdx] && myList.some(x => x.id === heroItems[heroIdx].id);
    hListTxt.textContent = inList ? t.heroInList : t.heroMyList;
  }

  if ($('txtSettingsHeader')) $('txtSettingsHeader').textContent = t.settingsTitle;
  if ($('txtSettingsSub')) $('txtSettingsSub').textContent = t.settingsSub;
  if ($('txtSettingLangTitle')) $('txtSettingLangTitle').textContent = t.langCardTitle;
  if ($('txtSettingLangDesc')) $('txtSettingLangDesc').textContent = t.langCardDesc;
  if ($('lblSettingAppLang')) $('lblSettingAppLang').textContent = t.langFieldLabel;
  if ($('txtSettingLangStatus')) $('txtSettingLangStatus').textContent = t.langStatus;
  if ($('txtSettingCaptionsTitle')) $('txtSettingCaptionsTitle').textContent = t.captionsTitle;

  const appLangSelect = $('settingAppLang');
  if (appLangSelect && appLangSelect.value !== lang) {
    appLangSelect.value = lang;
  }

  if (!silent) {
    toast(t.langChanged);
  }
}

function initSubtitlesAndPreferences() {
  const appLangSelect = $('settingAppLang');
  if (appLangSelect) {
    appLangSelect.value = getActiveAppLanguage();
    appLangSelect.onchange = () => {
      setAppLanguage(appLangSelect.value);
    };
  }
  setAppLanguage(getActiveAppLanguage(), true);

  const savedLang = store.get('nf_sub_lang', 'ar');
  const savedSize = store.get('nf_sub_size', 'medium');
  const savedColor = store.get('nf_sub_color', '#FFE600');
  const savedStyle = store.get('nf_sub_style', 'shadow');
  const savedOS = store.get('nf_sub_os_autofetch', true);

  const sLang = $('settingSubLang');
  const sSize = $('settingSubSize');
  const mLang = $('captionModalLangSelect');
  const mSize = $('captionModalSizeSelect');
  const mColor = $('captionModalColorSelect');
  const mStyle = $('captionModalStyleSelect');
  const mOS = $('subAutoFetchOS');

  if (sLang) sLang.value = savedLang;
  if (sSize) sSize.value = savedSize;
  if (mLang) mLang.value = savedLang;
  if (mSize) mSize.value = savedSize;
  if (mColor) mColor.value = savedColor;
  if (mStyle) mStyle.value = savedStyle;
  if (mOS) mOS.checked = savedOS !== false;

  updateSubPreview();
  renderCaptionLangPills('');

  const onSettingChange = () => {
    const lang = sLang ? sLang.value : 'ar';
    const size = sSize ? sSize.value : 'medium';
    store.set('nf_sub_lang', lang);
    store.set('nf_sub_size', size);
    if (mLang) mLang.value = lang;
    if (mSize) mSize.value = size;
    updateSubPreview();
    renderCaptionLangPills($('captionLangSearch')?.value || '');
    if (typeof applySubtitleToActivePlayer === 'function') {
      applySubtitleToActivePlayer(lang);
    } else {
      dispatchSubtitlesToPlayer(lang);
    }
    toast('Subtitle preferences updated');
  };

  if (sLang) sLang.onchange = onSettingChange;
  if (sSize) sSize.onchange = onSettingChange;

  if (mLang) {
    mLang.onchange = () => {
      selectCaptionLanguage(mLang.value, mLang.selectedOptions?.[0]?.text);
    };
  }

  // Interactive Live Language Search
  const searchInput = $('captionLangSearch');
  const clearBtn = $('captionLangSearchClear');
  if (searchInput) {
    searchInput.oninput = () => {
      const val = searchInput.value;
      if (clearBtn) clearBtn.style.display = val ? 'inline-block' : 'none';
      renderCaptionLangPills(val);
    };
  }
  if (clearBtn) {
    clearBtn.onclick = (e) => {
      e.preventDefault();
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearBtn.style.display = 'none';
      renderCaptionLangPills('');
    };
  }

  ['captionModalColorSelect', 'captionModalSizeSelect', 'captionModalStyleSelect'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', updateSubPreview);
  });

  // OpenSubtitles direct catalog search
  const osSearchBtn = $('openSubtitlesSearchBtn');
  if (osSearchBtn) {
    osSearchBtn.onclick = () => {
      const ctx = currentTitleContext();
      const rawImdb = ctx?.imdb || '';
      const cleanImdb = rawImdb ? rawImdb.replace(/^tt/, '').trim() : '';
      let url = 'https://www.opensubtitles.org';
      if (cleanImdb) {
        url = `https://www.opensubtitles.org/en/search/sublanguageid-all/imdbid-${cleanImdb}`;
      } else if (ctx?.title) {
        url = `https://www.opensubtitles.org/en/search2/sublanguageid-all/moviename-${encodeURIComponent(ctx.title)}`;
      }
      safeOpenDownloadUrl(url);
      toast('Opening OpenSubtitles catalog in a new tab…');
    };
  }

  const captionsModalClose = $('captionsModalClose');
  if (captionsModalClose) {
    captionsModalClose.onclick = () => closeCaptionsModal();
  }

  const captionsBackdrop = $('captionsModalBackdrop');
  if (captionsBackdrop) {
    captionsBackdrop.onclick = (e) => {
      if (e.target === captionsBackdrop) closeCaptionsModal();
    };
  }

  const captionsModal = $('captionsModal');
  if (captionsModal) {
    captionsModal.addEventListener('click', (e) => e.stopPropagation());
    captionsModal.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  }

  const applyBtn = $('captionModalApply');
  if (applyBtn) {
    applyBtn.onclick = () => {
      const lang = mLang ? mLang.value : 'ar';
      const size = mSize ? mSize.value : 'medium';
      const color = mColor ? mColor.value : '#FFE600';
      const style = mStyle ? mStyle.value : 'shadow';
      const osFetch = mOS ? mOS.checked : true;

      store.set('nf_sub_lang', lang);
      store.set('nf_sub_size', size);
      store.set('nf_sub_color', color);
      store.set('nf_sub_style', style);
      store.set('nf_sub_os_autofetch', osFetch);

      if (sLang) sLang.value = lang;
      if (sSize) sSize.value = size;
      if (typeof applySubtitleToActivePlayer === 'function') {
        applySubtitleToActivePlayer(lang);
      } else {
        dispatchSubtitlesToPlayer(lang);
      }
      const langText = mLang?.selectedOptions?.[0]?.text || lang;
      closeCaptionsModal();
      toast(`Subtitles enabled: ${langText}`);
    };
  }

  const ccBtn = $('captionOpenPlayerCC');
  if (ccBtn) {
    ccBtn.onclick = () => {
      const cur = store.get('nf_sub_lang', 'ar') || 'ar';
      const next = cur === 'ar' ? 'en' : (cur === 'en' ? 'off' : 'ar');
      applySubtitleToActivePlayer(next);
      closeCaptionsModal();
      const names = { ar: 'Arabic (العربية)', en: 'English', off: 'Disabled' };
      toast(`Subtitles switched: ${names[next] || next}`);
    };
  }

  // Player server switcher top button setup
  const pServerTop = $('pServerTop');
  if (pServerTop) {
    pServerTop.onclick = (e) => {
      e.stopPropagation();
      togglePlayerServer();
    };
  }

  // Player customization modal setup
  const pCustomTop = $('pCustomizeTop');
  if (pCustomTop) {
    pCustomTop.onclick = (e) => {
      e.stopPropagation();
      openPlayerCustomModal();
    };
  }

  // Safe ad-proof bottom controls and defensive gesture shield
  const pBottomCaps = $('pBottomCaptions');
  if (pBottomCaps) {
    pBottomCaps.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      triggerLightSpeedFocusSnap();
      openCaptionsModal();
    };
  }

  const pBottomSet = $('pBottomSettings');
  if (pBottomSet) {
    pBottomSet.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      triggerLightSpeedFocusSnap();
      openPlayerCustomModal();
    };
  }

  const pZoneShield = $('pControlZoneShield');
  if (pZoneShield) {
    const handleControlShield = (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerLightSpeedFocusSnap();
      const rect = pZoneShield.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      if (clickX < rect.width * 0.55) {
        openCaptionsModal();
      } else {
        openPlayerCustomModal();
      }
    };
    ['click', 'mousedown', 'pointerdown', 'touchstart'].forEach(evt => {
      pZoneShield.addEventListener(evt, handleControlShield, { capture: true });
    });
  }

  const pCustomClose = $('playerCustomModalClose');
  if (pCustomClose) pCustomClose.onclick = closePlayerCustomModal;

  const pCustomBd = $('playerCustomModalBackdrop');
  if (pCustomBd) {
    pCustomBd.onclick = (e) => {
      if (e.target === pCustomBd) closePlayerCustomModal();
    };
  }

  const pCustomApply = $('playerCustomApply');
  if (pCustomApply) {
    pCustomApply.onclick = () => {
      const prefs = {
        speed: $('playerSpeedSelect')?.value || '1',
        theme: $('playerThemeSelect')?.value || 'red',
        autoNext: $('playerAutoNextToggle')?.checked ?? true,
        autoSkip: $('playerAutoSkipToggle')?.checked ?? true,
        smoothScrub: $('playerSmoothScrubToggle')?.checked ?? true
      };
      store.set('nf_player_prefs', prefs);
      applyPlayerTheme(prefs.theme);
      const selectedSubLang = $('playerCustomSubLangSelect')?.value || store.get('nf_sub_lang', 'ar');
      if (selectedSubLang && selectedSubLang !== store.get('nf_sub_lang', 'ar')) {
        applySubtitleToActivePlayer(selectedSubLang);
      }
      const selectedServer = $('playerServerSelect')?.value || 'server1';
      if (selectedServer !== currentPlayerServer) {
        switchPlayerServer(selectedServer);
      }
      closePlayerCustomModal();
      toast('Player settings saved');
    };
  }

  const pCustomReset = $('playerCustomReset');
  if (pCustomReset) {
    pCustomReset.onclick = () => {
      const defaults = { speed: '1', theme: 'red', autoNext: true, autoSkip: true, smoothScrub: true };
      store.set('nf_player_prefs', defaults);
      if ($('playerSpeedSelect')) $('playerSpeedSelect').value = '1';
      if ($('playerThemeSelect')) $('playerThemeSelect').value = 'red';
      if ($('playerServerSelect')) $('playerServerSelect').value = 'server1';
      if ($('playerCustomSubLangSelect')) $('playerCustomSubLangSelect').value = 'ar';
      if ($('playerAutoNextToggle')) $('playerAutoNextToggle').checked = true;
      if ($('playerAutoSkipToggle')) $('playerAutoSkipToggle').checked = true;
      if ($('playerSmoothScrubToggle')) $('playerSmoothScrubToggle').checked = true;
      applyPlayerTheme('red');
      applySubtitleToActivePlayer('ar');
      if (currentPlayerServer !== 'server1') switchPlayerServer('server1');
      toast('Reset to default player settings');
    };
  }

  // Load saved player theme
  const initialPrefs = store.get('nf_player_prefs', {});
  if (initialPrefs.theme) applyPlayerTheme(initialPrefs.theme);
}

function openCaptionsModal() {
  const backdrop = $('captionsModalBackdrop');
  if (!backdrop) return;
  const savedLang = store.get('nf_sub_lang', 'ar');
  const savedSize = store.get('nf_sub_size', 'medium');
  const savedColor = store.get('nf_sub_color', '#FFE600');
  const savedStyle = store.get('nf_sub_style', 'shadow');
  const savedOS = store.get('nf_sub_os_autofetch', true);

  if ($('captionModalLangSelect')) $('captionModalLangSelect').value = savedLang;
  if ($('captionModalSizeSelect')) $('captionModalSizeSelect').value = savedSize;
  if ($('captionModalColorSelect')) $('captionModalColorSelect').value = savedColor;
  if ($('captionModalStyleSelect')) $('captionModalStyleSelect').value = savedStyle;
  if ($('subAutoFetchOS')) $('subAutoFetchOS').checked = savedOS !== false;

  const sInput = $('captionLangSearch');
  if (sInput) sInput.value = '';
  const cBtn = $('captionLangSearchClear');
  if (cBtn) cBtn.style.display = 'none';
  renderCaptionLangPills('');

  updateSubPreview();
  backdrop.classList.add('show');
}

function closeCaptionsModal() {
  const backdrop = $('captionsModalBackdrop');
  if (backdrop) backdrop.classList.remove('show');
}

function openPlayerCustomModal() {
  const bd = $('playerCustomModalBackdrop');
  if (!bd) return;
  const prefs = store.get('nf_player_prefs', { speed: '1', theme: 'red', autoNext: true, autoSkip: true, smoothScrub: true });
  if ($('playerSpeedSelect')) $('playerSpeedSelect').value = prefs.speed || '1';
  if ($('playerThemeSelect')) $('playerThemeSelect').value = prefs.theme || 'red';
  if ($('playerServerSelect')) $('playerServerSelect').value = currentPlayerServer;
  if ($('playerCustomSubLangSelect')) $('playerCustomSubLangSelect').value = store.get('nf_sub_lang', 'ar') || 'ar';
  if ($('playerAutoNextToggle')) $('playerAutoNextToggle').checked = prefs.autoNext !== false;
  if ($('playerAutoSkipToggle')) $('playerAutoSkipToggle').checked = prefs.autoSkip !== false;
  if ($('playerSmoothScrubToggle')) $('playerSmoothScrubToggle').checked = prefs.smoothScrub !== false;
  bd.classList.add('show');
}

function closePlayerCustomModal() {
  const bd = $('playerCustomModalBackdrop');
  if (bd) bd.classList.remove('show');
}

/* ---------- PLAYER CHROME & WAKE SYSTEM ---------- */
let hideT = null;
function wakeChrome() {
  const pTop = $('pTop');
  const pBottomBar = $('pBottomBar');
  if (pTop) {
    pTop.classList.remove('hidden');
    pTop.style.opacity = '1';
    pTop.style.pointerEvents = 'auto';
  }
  if (pBottomBar) {
    pBottomBar.classList.remove('hidden');
    pBottomBar.style.opacity = '1';
    pBottomBar.style.pointerEvents = 'auto';
  }
  clearTimeout(hideT);
  hideT = setTimeout(() => {
    if (pTop) {
      pTop.classList.add('hidden');
      pTop.style.opacity = '0';
      pTop.style.pointerEvents = 'none';
    }
    if (pBottomBar) {
      pBottomBar.classList.add('hidden');
      pBottomBar.style.opacity = '0';
      pBottomBar.style.pointerEvents = 'none';
    }
  }, 4000);
}

function togglePlayerPlayback() {
  const iframe = $('playerView')?.querySelector('iframe');
  if (iframe && iframe.contentWindow) {
    try { iframe.contentWindow.postMessage({ type: 'PLAYER_CONTROL', event: 'toggle', action: 'toggle' }, '*'); } catch {}
    try { iframe.contentWindow.postMessage({ method: 'toggle' }, '*'); } catch {}
    try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'togglePlay', args: '' }), '*'); } catch {}
  }
}

['pTop', 'pTopSensor', 'pBottomBar', 'pControlZoneShield'].forEach(id => {
  const el = $(id);
  if (el) {
    ['mousemove', 'touchstart', 'pointerdown', 'click'].forEach(evt => {
      el.addEventListener(evt, () => {
        wakeChrome();
      }, { passive: true });
    });
  }
});
['mousemove', 'touchstart', 'pointerdown'].forEach(evt => {
  document.addEventListener(evt, () => {
    if ($('playerView')?.classList.contains('show')) wakeChrome();
  }, { passive: true });
});

const pBack = $('pBack');
if (pBack) pBack.onclick = closePlayer;

function closePlayer() {
  _allowNavigation = true;
  stopFocusGuardian();
  disarmVidShield();
  closeCaptionsModal();
  closePlayerCustomModal();
  closeDownloadModal();
  syncEmbedProgress();
  const pv = $('playerView');
  if (pv) pv.classList.remove('show');
  const pBottomBar = $('pBottomBar');
  if (pBottomBar) pBottomBar.classList.add('hidden');
  hidePlayerError();
  document.querySelectorAll('#playerView iframe').forEach(f => f.remove());

  const v = $('playerVideo');
  if (v) {
    try { v.pause(); } catch {}
    v.removeAttribute('src');
    v.load();
    v.style.display = 'none';
  }
  if ($('pBottom')) $('pBottom').style.display = 'none';
  if ($('torrentStats')) $('torrentStats').style.display = 'none';
  currentEmbed = null;
}

/* ---------- STREAMING EMBEDS ---------- */
function hidePlayerError() {
  const err = $('pError');
  if (err) err.classList.remove('show');
}
function showPlayerError(msg) {
  if ($('pErrorMsg')) $('pErrorMsg').textContent = msg || 'This title is currently unavailable.';
  const err = $('pError');
  if (err) err.classList.add('show');
}

function openPlayerShell(title, subTitle) {
  closeCardPortal();
  _allowNavigation = false;
  closeDetail();
  hidePlayerError();
  document.querySelectorAll('#playerView iframe').forEach(f => f.remove());
  const pv = $('playerView');
  if (pv) pv.classList.add('show');
  if ($('pTitle')) $('pTitle').textContent = title || 'Now Playing';
  if ($('pSubTitle')) $('pSubTitle').textContent = subTitle || 'Streaming in Full HD • OpenSubtitles v3';

  if ($('playerVideo')) $('playerVideo').style.display = 'none';
  if ($('pBottom')) $('pBottom').style.display = 'none';
  if ($('torrentStats')) $('torrentStats').style.display = 'none';
  if ($('skipIntro')) $('skipIntro').style.display = 'none';
  if ($('nextEp')) $('nextEp').style.display = 'none';

  startFocusGuardian();
  wakeChrome();
}

function resolveMediaIdentifiers(m) {
  if (!m) return { tmdbId: null, imdb: null };
  let tmdbId = m.tmdbId != null ? String(m.tmdbId).trim() : (m.moviedb_id != null ? String(m.moviedb_id).trim() : null);
  let imdb = m.imdb ? String(m.imdb).trim() : (m.imdb_id ? String(m.imdb_id).trim() : null);

  const rawId = String(m.id || '').trim();
  if (!tmdbId && /^\d+$/.test(rawId)) tmdbId = rawId;
  if (!tmdbId && rawId.startsWith('tmdb:')) tmdbId = rawId.slice(5).trim();
  if (!imdb && /^tt\d+$/.test(rawId)) imdb = rawId;

  if ((!tmdbId || !imdb) && typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) {
    const cur = CuratedCatalog.getCuratedById(rawId) ||
                (imdb ? CuratedCatalog.getCuratedById(imdb) : null) ||
                (tmdbId ? CuratedCatalog.getCuratedById(tmdbId) : null);
    if (cur) {
      if (!tmdbId && cur.moviedb_id) tmdbId = String(cur.moviedb_id);
      if (!tmdbId && cur.tmdbId) tmdbId = String(cur.tmdbId);
      if (!imdb && cur.id && /^tt\d+$/.test(cur.id)) imdb = cur.id;
    }
  }

  if ((!tmdbId || !imdb) && m.name && typeof allMedia !== 'undefined' && Array.isArray(allMedia)) {
    const titleMatch = allMedia.find(item => item && item.name && item.name.toLowerCase() === m.name.toLowerCase() && item.type === (m.type || 'movie'));
    if (titleMatch) {
      if (!tmdbId && titleMatch.moviedb_id) tmdbId = String(titleMatch.moviedb_id);
      if (!tmdbId && titleMatch.tmdbId) tmdbId = String(titleMatch.tmdbId);
      if (!imdb && titleMatch.id && /^tt\d+$/.test(titleMatch.id)) imdb = titleMatch.id;
    }
  }

  return {
    tmdbId: tmdbId && /^\d+$/.test(tmdbId) ? tmdbId : null,
    imdb: imdb && /^tt\d+$/.test(imdb) ? imdb : null
  };
}

function playStream() {
  const m = currentDetail?.meta;
  if (!m) return;
  if (currentDetail.type === 'series') {
    const s = Math.max(1, Number(currentDetail.ep?.s || 1));
    const ep = Math.max(1, Number(currentDetail.ep?.e || 1));
    playEpisode(s, ep);
    return;
  }
  const ids = resolveMediaIdentifiers(m);
  const tmdbId = ids.tmdbId || m.moviedb_id || m.tmdbId;
  const imdb = ids.imdb || m.imdb || m.imdb_id || (String(m.id || '').startsWith('tt') ? m.id : null);
  const url = MediaLinks.getMovieStreamUrl({ imdb, tmdbId }, currentPlayerServer);
  if (!url) {
    closeDetail();
    $('playerView').classList.add('show');
    if ($('pTitle')) $('pTitle').textContent = m.name;
    showPlayerError('Streaming is unavailable for this title (missing valid ID).');
    return;
  }
  playEmbed({
    url,
    type: 'movie',
    id: m.id,
    imdb,
    title: m.name,
    poster: poster(m),
    tmdbId,
    server: currentPlayerServer
  });
}

function playEpisode(season, episode) {
  const m = currentDetail?.meta;
  if (!m) return;
  const s = Math.max(1, Number(season) || 1);
  const ep = Math.max(1, Number(episode) || 1);
  currentDetail.ep = { s, e: ep };
  const ids = resolveMediaIdentifiers(m);
  const tmdbId = ids.tmdbId || m.moviedb_id || m.tmdbId;
  const imdb = ids.imdb || m.imdb || m.imdb_id;
  const url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, currentPlayerServer);
  if (!url) {
    toast('Streaming is unavailable for this episode (missing ID).');
    return;
  }
  playEmbed({
    url,
    type: 'series',
    id: m.id,
    tmdbId,
    imdb: ids.imdb || m.imdb || m.imdb_id,
    season: s,
    episode: ep,
    title: m.name,
    poster: poster(m),
    server: currentPlayerServer
  });
}

function recordWatchStart(o) {
  if (!o) return;
  const key = o.type === 'series'
    ? (o.tmdbId ? `tmdb:${o.tmdbId}` : (o.id || o.imdb || `series:${o.title}`))
    : (o.imdb || o.id || (o.tmdbId ? `tmdb:${o.tmdbId}` : `movie:${o.title}`));

  const existing = history[key] || {};
  const currentProg = existing.progress != null ? existing.progress : 0.12;
  const safeProg = (currentProg > 0.05 && currentProg < 0.95) ? currentProg : 0.12;

  history[key] = {
    ...existing,
    progress: safeProg,
    finished: false,
    type: o.type || existing.type || 'movie',
    title: o.title || existing.title || 'Title',
    poster: o.poster || existing.poster || '',
    tmdbId: o.tmdbId || existing.tmdbId,
    imdb: o.imdb || existing.imdb || (typeof key === 'string' && key.startsWith('tt') ? key : null),
    season: Math.max(1, +(o.season || existing.season || 1)),
    episode: Math.max(1, +(o.episode || existing.episode || 1)),
    lastWatched: Date.now(),
    _embed: true
  };
  store.set('nf_history', history);
  renderContinueRow();
}

function recordWatchFinish(id) {
  if (!id) return;
  let targetKey = id;
  if (!history[targetKey]) {
    const found = Object.keys(history).find(k => k === id || k === `tmdb:${id}` || history[k].tmdbId === id || history[k].imdb === id);
    if (found) targetKey = found;
  }
  if (history[targetKey]) {
    history[targetKey].finished = true;
    history[targetKey].progress = 1.0;
    history[targetKey].lastWatched = Date.now();
    store.set('nf_history', history);
    renderContinueRow();
  }
}

function updateSubtitleUrlParam(url, lang) {
  if (!url) return url;
  const target = lang || 'ar';
  const langNames = {
    ar: 'Arabic', en: 'English', es: 'Spanish', fr: 'French',
    de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
    hi: 'Hindi'
  };
  const label = langNames[target] || target;
  try {
    const u = new URL(url, window.location.href);
    if (!lang || lang === 'off') {
      ['sub', 'subtitles', 'sub_lang', 'lang', 'default_sub', 'default_subtitle', 'default_subtitles', 'caption', 'captions', 'caption_lang', 'sub_language', 'sub_lang_label', 'srclang', 'c_lang', 'auto_sub', 'auto_subtitles', 'subtitle_lang', 'va_sub', 'ds_lang'].forEach(p => u.searchParams.delete(p));
      u.searchParams.set('sub', 'off');
      u.searchParams.set('cc', '0');
    } else {
      u.searchParams.set('sub', target);
      u.searchParams.set('subtitles', target);
      u.searchParams.set('sub_lang', target);
      u.searchParams.set('lang', target);
      u.searchParams.set('default_sub', target);
      u.searchParams.set('default_subtitle', target);
      u.searchParams.set('default_subtitles', target);
      u.searchParams.set('caption', target);
      u.searchParams.set('captions', target);
      u.searchParams.set('caption_lang', target);
      u.searchParams.set('cc', '1');
      u.searchParams.set('cc_lang', target);
      u.searchParams.set('sub_language', label);
      u.searchParams.set('sub_lang_label', label);
      u.searchParams.set('srclang', target);
      u.searchParams.set('auto_sub', target);
      u.searchParams.set('auto_subtitles', '1');
      u.searchParams.set('subtitle_lang', target);
      u.searchParams.set('va_sub', target);
      u.searchParams.set('va_subtitle_lang', target);
      u.searchParams.set('va_caption', target);
      u.searchParams.set('player_sub', target);
      u.searchParams.set('player_sub_lang', target);
      u.searchParams.set('player_subtitle', target);
      u.searchParams.set('player_subtitles', target);
      u.searchParams.set('player_lang', target);
      u.searchParams.set('ds_lang', target);
    }
    return u.toString();
  } catch {
    if (!lang || lang === 'off') return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}sub=${encodeURIComponent(target)}&subtitles=${encodeURIComponent(target)}&sub_lang=${encodeURIComponent(target)}&lang=${encodeURIComponent(target)}&default_sub=${encodeURIComponent(target)}&caption=${encodeURIComponent(target)}&cc=1&sub_language=${encodeURIComponent(label)}&ds_lang=${encodeURIComponent(target)}`;
  }
}

function updateSubtitleUI() {
  const currentLang = store.get('nf_sub_lang', 'ar') || 'ar';
  const langNames = {
    ar: 'Arabic', en: 'English', es: 'Spanish', fr: 'French',
    de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
    tr: 'Turkish', ja: 'Japanese', hi: 'Hindi', off: 'Off'
  };
  const label = langNames[currentLang] || (currentLang === 'off' ? 'Off' : currentLang.toUpperCase());
  const bLabel = $('pBottomCaptionsLabel');
  if (bLabel) {
    bLabel.textContent = `Captions: ${label}`;
  }
  const modalSelect = $('captionModalLangSelect');
  if (modalSelect && modalSelect.value !== currentLang) {
    modalSelect.value = currentLang;
  }
  const customSubSelect = $('playerCustomSubLangSelect');
  if (customSubSelect && customSubSelect.value !== currentLang) {
    customSubSelect.value = currentLang;
  }
}

function updatePlayerServerUI() {
  const lbl = $('pServerLabel');
  const btn = $('pServerTop');
  const sel = $('playerServerSelect');
  const isServer2 = currentPlayerServer === 'server2';
  if (lbl) {
    lbl.textContent = isServer2 ? 'Server 2 (Fast)' : 'Server 1 (HD)';
  }
  if (btn) {
    btn.setAttribute('data-server', currentPlayerServer);
    btn.title = isServer2
      ? 'Current: Server 2 (Fast Mirror Stream) — Click to switch to Server 1 (High Definition Stream)'
      : 'Current: Server 1 (High Definition Stream) — Click to switch to Server 2 (Fast Mirror Stream)';
  }
  if (sel) {
    sel.value = currentPlayerServer;
  }
}

function togglePlayerServer() {
  const nextServer = currentPlayerServer === 'server1' ? 'server2' : 'server1';
  switchPlayerServer(nextServer);
}

function switchPlayerServer(newServer) {
  currentPlayerServer = (newServer === 'server2' || newServer === 'vidsrc') ? 'server2' : 'server1';
  store.set('nf_player_server', currentPlayerServer);
  updatePlayerServerUI();

  const iframe = $('playerView')?.querySelector('iframe');
  if (!iframe || !currentEmbed) return;

  let newBaseUrl = null;
  if (currentEmbed.type === 'series') {
    const tmdbId = currentEmbed.tmdbId || ((typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(currentEmbed.id || currentEmbed.imdb)?.moviedb_id : null);
    const imdb = currentEmbed.imdb || ((currentEmbed.id || '').startsWith('tt') ? currentEmbed.id : null);
    newBaseUrl = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, currentEmbed.season || 1, currentEmbed.episode || 1, currentPlayerServer);
  } else {
    const imdb = currentEmbed.imdb || ((currentEmbed.id || '').startsWith('tt') ? currentEmbed.id : null);
    const tmdbId = currentEmbed.tmdbId || ((typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(currentEmbed.id || imdb)?.moviedb_id : null);
    newBaseUrl = MediaLinks.getMovieStreamUrl({ imdb, tmdbId }, currentPlayerServer);
  }

  if (!newBaseUrl) {
    toast('Server switch unavailable for this title');
    return;
  }

  const targetSub = store.get('nf_sub_lang', 'ar');
  const finalUrl = updateSubtitleUrlParam(newBaseUrl, targetSub);
  currentEmbed.url = finalUrl;
  currentEmbed.server = currentPlayerServer;
  iframe.src = finalUrl;

  const serverName = currentPlayerServer === 'server2' ? 'Server 2 (Fast Mirror Stream)' : 'Server 1 (High Definition Stream)';
  toast(`Switched to ${serverName}`);

  armVidShield();

  const sendSubCmd = () => {
    dispatchSubtitlesToPlayer(targetSub);
  };
  sendSubCmd();
  setTimeout(sendSubCmd, 250);
  setTimeout(sendSubCmd, 600);
  setTimeout(sendSubCmd, 1500);
}

function applySubtitleToActivePlayer(lang) {
  const targetSub = lang || store.get('nf_sub_lang', 'ar');
  store.set('nf_sub_lang', targetSub);
  updateSubtitleUI();
  dispatchSubtitlesToPlayer(targetSub);
  const iframe = $('playerView')?.querySelector('iframe');
  if (!iframe || !currentEmbed || !currentEmbed.url) return;
  const newUrl = updateSubtitleUrlParam(currentEmbed.url, targetSub);
  currentEmbed.url = newUrl;
  if (iframe.src !== newUrl) {
    iframe.src = newUrl;
  }
  setTimeout(() => {
    try { iframe.focus(); } catch {}
    dispatchSubtitlesToPlayer(targetSub);
  }, 120);
}

function dispatchSubtitlesToPlayer(lang) {
  const f = $('playerView')?.querySelector('iframe');
  if (!f || !f.contentWindow) return;
  const targetSub = lang || store.get('nf_sub_lang', 'ar');
  const langNames = {
    ar: 'Arabic', en: 'English', es: 'Spanish', fr: 'French',
    de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
    hi: 'Hindi'
  };
  const label = langNames[targetSub] || targetSub;

  try {
    localStorage.setItem('subtitleLang', targetSub);
    localStorage.setItem('va_subtitle_lang', targetSub);
    localStorage.setItem('va_sub', targetSub);
    localStorage.setItem('player_subtitle', targetSub);
    localStorage.setItem('player_sub_lang', targetSub);
  } catch {}

  const storageData = {
    subtitleLang: targetSub,
    va_subtitle_lang: targetSub,
    va_sub: targetSub,
    va_caption: targetSub,
    player_subtitle: targetSub,
    player_sub: targetSub,
    player_subtitles: targetSub,
    player_lang: targetSub,
    player_sub_lang: targetSub,
    default_sub: targetSub,
    sub_lang: targetSub
  };

  try { f.contentWindow?.postMessage({ type: 'STORAGE_INIT', data: storageData }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'STORAGE_SET', key: 'subtitleLang', value: targetSub }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'STORAGE_SET', key: 'va_subtitle_lang', value: targetSub }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'STORAGE_SET', key: 'player_subtitle', value: targetSub }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'STORAGE_SET', key: 'player_sub_lang', value: targetSub }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'STORAGE_SET', key: 'va_sub', value: targetSub }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'SUBTITLE_SET', lang: targetSub, language: label, code: targetSub, label }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'SET_SUBTITLES', lang: targetSub, language: label }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'SET_SUBTITLE', lang: targetSub, language: label }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'setSubtitle', lang: targetSub, language: label }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ event: 'setSubtitle', lang: targetSub, language: label }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ event: 'set_subtitle', lang: targetSub }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'PLAYER_SET_SUBTITLE', lang: targetSub }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ action: 'setSubtitle', language: targetSub }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ command: 'set_subtitle', lang: targetSub }, '*'); } catch {}

  try {
    for (let i = 0; i < window.frames.length; i++) {
      try { window.frames[i].postMessage({ type: 'STORAGE_INIT', data: storageData }, '*'); } catch {}
      try { window.frames[i].postMessage({ type: 'STORAGE_SET', key: 'subtitleLang', value: targetSub }, '*'); } catch {}
      try { window.frames[i].postMessage({ type: 'STORAGE_SET', key: 'va_subtitle_lang', value: targetSub }, '*'); } catch {}
      try { window.frames[i].postMessage({ type: 'SUBTITLE_SET', lang: targetSub, language: label, code: targetSub, label }, '*'); } catch {}
      try { window.frames[i].postMessage({ type: 'SET_SUBTITLES', lang: targetSub, language: label }, '*'); } catch {}
      try { window.frames[i].postMessage({ type: 'SET_SUBTITLE', lang: targetSub, language: label }, '*'); } catch {}
      try { window.frames[i].postMessage({ event: 'setSubtitle', lang: targetSub, language: label }, '*'); } catch {}
    }
  } catch {}
}

function playEmbed(o) {
  if (!o || !o.url) { showPlayerError('This title is unavailable.'); return; }
  currentEmbed = { ...o, server: currentPlayerServer };
  currentStream = o;
  recordWatchStart(o);
  const sub = o.type === 'series'
    ? `Season ${o.season || 1}, Episode ${o.episode || 1} • HD Stream • Arabic Subtitles`
    : `${o.year ? o.year + ' • ' : ''}HD Stream • Arabic Subtitles`;
  openPlayerShell(o.title, sub);

  updatePlayerServerUI();
  updateSubtitleUI();

  const targetSub = store.get('nf_sub_lang', 'ar');
  const embedUrlWithSub = updateSubtitleUrlParam(o.url, targetSub);
  currentEmbed.url = embedUrlWithSub;

  const f = document.createElement('iframe');
  f.src = embedUrlWithSub;
  f.allowFullscreen = true;
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
  f.setAttribute('referrerpolicy', 'origin');
  f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;z-index:1';
  $('playerView').insertBefore(f, $('pTop'));
  armVidShield();

  const sendSubCmd = () => {
    dispatchSubtitlesToPlayer(targetSub);
  };
  sendSubCmd();
  f.onload = () => {
    sendSubCmd();
    setTimeout(sendSubCmd, 250);
    setTimeout(sendSubCmd, 600);
    setTimeout(sendSubCmd, 1200);
    setTimeout(sendSubCmd, 2500);
    setTimeout(sendSubCmd, 4000);
  };
}

function playEmbedEntry(m) {
  const ids = resolveMediaIdentifiers(m);
  if (m.type === 'series') {
    const tmdbId = ids.tmdbId || m.tmdbId || m.moviedb_id;
    const imdb = ids.imdb || m.imdb;
    if (!tmdbId && !imdb) { toast('Streaming unavailable (missing ID).'); return; }
    const s = Math.max(1, Number(m.season || 1));
    const ep = Math.max(1, Number(m.episode || 1));
    const url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, currentPlayerServer);
    if (!url) { toast('Streaming unavailable for this episode.'); return; }
    playEmbed({
      url,
      type: 'series',
      id: m.id,
      tmdbId,
      imdb: ids.imdb || m.imdb,
      season: s,
      episode: ep,
      title: m.name,
      poster: poster(m),
      server: currentPlayerServer
    });
    return;
  }
  const tmdbId = ids.tmdbId || m.tmdbId || m.moviedb_id;
  const imdb = ids.imdb || m.imdb || ((m.id || '').startsWith('tt') ? m.id : null);
  const url = MediaLinks.getMovieStreamUrl({ imdb, tmdbId }, currentPlayerServer);
  if (!url) { toast('Streaming unavailable (missing ID).'); return; }
  playEmbed({
    url,
    type: 'movie',
    id: m.id,
    imdb,
    title: m.name,
    poster: poster(m),
    tmdbId,
    server: currentPlayerServer
  });
}

const EMBED_ORIGINS = ['https://vaplayer.ru', 'https://vidapi.ru', 'https://vidsrc.sh', 'https://nextgencloudfabric.com'];
function readProgressStore() {
  try { return JSON.parse(localStorage.getItem('vidsrcProgress') || localStorage.getItem('vidLinkProgress') || '{}'); }
  catch { return {}; }
}

function historyItems() {
  return Object.entries(history)
    .sort(([, a], [, b]) => (b.lastWatched || 0) - (a.lastWatched || 0))
    .map(([id, h]) => ({
      id,
      type: h.type || 'movie',
      name: h.title,
      poster: h.poster,
      background: h.poster,
      _progress: h.progress,
      _finished: !!(h.finished || (h.progress != null && h.progress >= 0.9)),
      _embed: !!h._embed,
      tmdbId: h.tmdbId,
      imdb: h.imdb || (id.startsWith('tt') ? id : null),
      season: h.season,
      episode: h.episode
    }));
}

function continueItems() {
  return historyItems().filter(m => !m._finished);
}

function finishedItems() {
  return historyItems().filter(m => m._finished);
}

function renderContinueRow() {
  const cSec = $('row-continue');
  if (cSec) {
    const track = cSec.querySelector('.row-track');
    const items = continueItems();
    cSec.style.display = items.length ? '' : 'none';
    if (track) {
      track.innerHTML = '';
      items.forEach(m => track.appendChild(buildCard(m)));
      track.dispatchEvent(new Event('scroll'));
    }
  }

  const fSec = $('row-finished');
  if (fSec) {
    const track = fSec.querySelector('.row-track');
    const items = finishedItems();
    fSec.style.display = items.length ? '' : 'none';
    if (track) {
      track.innerHTML = '';
      items.forEach(m => track.appendChild(buildCard(m)));
      track.dispatchEvent(new Event('scroll'));
    }
  }
}

function syncEmbedProgress() {
  const data = readProgressStore();
  let changed = false;
  Object.values(data).forEach(entry => {
    if (!entry || entry.id == null) return;
    const dur = entry.progress?.duration || 0, watched = entry.progress?.watched || 0;
    if (!dur || watched < 5) return;
    const p = Math.min(.98, watched / dur);
    const isFinished = p >= 0.9;
    const key = `tmdb:${entry.id}`;
    const existing = history[key] || {};
    history[key] = {
      ...existing,
      progress: p,
      finished: isFinished,
      type: entry.type === 'tv' ? 'series' : 'movie',
      title: entry.title || existing.title || 'Title',
      poster: entry.poster_path ? `https://image.tmdb.org/t/p/w500${entry.poster_path}` : (existing.poster || ''),
      tmdbId: entry.id,
      imdb: entry.imdb || existing.imdb || null,
      season: Math.max(1, +(entry.last_season_watched || existing.season || 1)),
      episode: Math.max(1, +(entry.last_episode_watched || existing.episode || 1)),
      lastWatched: Date.now(),
      _embed: true
    };
    changed = true;
  });
  if (changed) {
    store.set('nf_history', history);
    renderContinueRow();
  }
}

function nextEpisode() {
  if ($('nextEp')) $('nextEp').style.display = 'none';
  const e = currentEmbed;
  if (e?.type === 'series') {
    const tmdbId = e.tmdbId || ((typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(e.id || e.imdb)?.moviedb_id : null);
    const imdb = e.imdb;
    if (!tmdbId && !imdb) { toast('Streaming unavailable for next episode.'); return; }
    const s = Math.max(1, Number(e.season || 1));
    const ep = Math.max(1, Number(e.episode || 1)) + 1;
    toast(`Loading episode ${ep}…`);
    const url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, currentPlayerServer);
    if (url) playEmbed({ ...e, url, tmdbId, imdb, season: s, episode: ep, server: currentPlayerServer });
    else toast('Streaming unavailable for next episode.');
  }
}

const nextPlay = $('nextPlay');
if (nextPlay) nextPlay.onclick = nextEpisode;

const pRetry = $('pRetry');
if (pRetry) {
  pRetry.onclick = () => {
    hidePlayerError();
    if (currentEmbed) playEmbed({ ...currentEmbed });
    else playStream();
  };
}

/* ---------- BULLETPROOF POP-UNDER & AD BLOCKING SYSTEM ----------
 * 1. Global window.open trap: Blocks all pop-ups/pop-unders in our window context,
 *    permitting ONLY intentional user actions (like OmniSave downloads).
 * 2. Navigation lock: Prevents rogue embed redirects from hijacking the parent window.
 * 3. Multi-layer Click Shield: Absorbs consecutive ad-triggering click traps and
 *    auto-rearms immediately after any interaction.
 * 4. Window Focus Guardian: Instantly detects focus loss/blur caused by popunders
 *    and snaps focus right back to the player while re-arming the shield.
 */
const _nativeWindowOpen = window.open;
window.open = function(url, target, features) {
  const urlStr = String(url || '');
  if (
    urlStr.includes('vidvault.to') ||
    urlStr.includes('02moviedownloader.site') ||
    urlStr.includes('videodownloader.site') ||
    urlStr.includes('omnisave') ||
    urlStr.includes('opensubtitles.org') ||
    urlStr.includes('strem.io')
  ) {
    return _nativeWindowOpen.call(window, url, target, features);
  }
  console.warn('[AdBlock] Blocked unauthorized window.open popup attempt:', url);
  return null;
};
try { Window.prototype.open = window.open; } catch {}
try { window.open = window.open; } catch {}
try { self.open = window.open; } catch {}
try { top.open = window.open; } catch {}
try { parent.open = window.open; } catch {}


// Intercept programmatic anchor clicks targeting _blank or _top
const _nativeAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function() {
  const href = String(this.href || '');
  const target = String(this.target || '');
  if (target === '_blank' || target === '_top') {
    if (!href.includes('vidvault.to') &&
        !href.includes('02moviedownloader.site') &&
        !href.includes('videodownloader.site') &&
        !href.includes('omnisave') &&
        !href.includes('opensubtitles.org') &&
        !href.includes(window.location.host)) {
      console.warn('[AdBlock] Blocked programmatic anchor click:', href);
      return;
    }
  }
  return _nativeAnchorClick.apply(this, arguments);
};

// Intercept synthetic/dispatched clicks on anchor elements
const _nativeAnchorDispatch = HTMLAnchorElement.prototype.dispatchEvent;
HTMLAnchorElement.prototype.dispatchEvent = function(event) {
  if (event && event.type === 'click') {
    const href = String(this.href || '');
    const target = String(this.target || '');
    if (target === '_blank' || target === '_top') {
      if (!href.includes('vidvault.to') &&
          !href.includes('02moviedownloader.site') &&
          !href.includes('videodownloader.site') &&
          !href.includes('omnisave') &&
          !href.includes('opensubtitles.org') &&
          !href.includes(window.location.host)) {
        console.warn('[AdBlock] Blocked dispatched click on anchor:', href);
        return false;
      }
    }
  }
  return _nativeAnchorDispatch.apply(this, arguments);
};

// Intercept programmatic form submissions targeting _blank or _top
const _nativeFormSubmit = HTMLFormElement.prototype.submit;
HTMLFormElement.prototype.submit = function() {
  const action = String(this.action || '');
  const target = String(this.target || '');
  if (target === '_blank' || target === '_top') {
    if (!action.includes('vidvault.to') &&
        !action.includes('02moviedownloader.site') &&
        !action.includes('videodownloader.site') &&
        !action.includes('omnisave') &&
        !action.includes('opensubtitles.org')) {
      console.warn('[AdBlock] Blocked programmatic form popup submission:', action);
      return;
    }
  }
  return _nativeFormSubmit.apply(this, arguments);
};

// Global click/touch capture to prevent unexpected rogue blank-target tabs
['click', 'auxclick', 'touchend', 'pointerup'].forEach(evt => {
  document.addEventListener(evt, (e) => {
    const a = e.target.closest('a');
    if (a) {
      const target = a.getAttribute('target');
      const href = a.getAttribute('href') || '';
      if (target === '_blank' || target === '_top') {
        if (!href.includes('vidvault.to') &&
            !href.includes('02moviedownloader.site') &&
            !href.includes('videodownloader.site') &&
            !href.includes('omnisave') &&
            !href.includes('opensubtitles.org') &&
            href !== '#' &&
            !href.startsWith('javascript:')) {
          e.preventDefault();
          e.stopPropagation();
          console.warn('[AdBlock] Blocked unauthorized link popup:', href);
        }
      }
    }
  }, true);
});

// Snap focus back if popunder attempts to blur the window during active playback
// Instantly restores window & tab priority across PC and mobile devices at light speed
let _focusSnapTimer = null;
let _focusGuardian = null;
let _lastActiveElement = null;

function snapWindowFocus() {
  if ($('playerView')?.classList.contains('show') && !_allowNavigation) {
    try { window.focus(); } catch {}
    try { window.top?.focus(); } catch {}
    try { self.focus(); } catch {}
  }
}

function triggerLightSpeedFocusSnap() {
  snapWindowFocus();
  [0, 2, 5, 10, 15, 25, 40, 60, 90, 130, 180, 250, 350, 500, 750, 1000, 1500].forEach(ms => {
    setTimeout(snapWindowFocus, ms);
  });
}

function startFocusGuardian() {
  stopFocusGuardian();
  _lastActiveElement = document.activeElement;
  _focusGuardian = setInterval(() => {
    if (!$('playerView')?.classList.contains('show') || _allowNavigation) {
      stopFocusGuardian();
      return;
    }
    // High-speed liveness check: if active document lost system focus or visibility to a popunder, snap back at light speed!
    const isHidden = document.hidden || (typeof document.visibilityState === 'string' && document.visibilityState === 'hidden');
    const lostFocus = typeof document.hasFocus === 'function' && !document.hasFocus();
    if (isHidden || lostFocus) {
      triggerLightSpeedFocusSnap();
    }

    // Detect when focus shifts to player iframe (user clicked video player) to immediately shield against delayed popups
    const curActive = document.activeElement;
    if (curActive && curActive !== _lastActiveElement && (curActive.tagName === 'IFRAME' || curActive.closest?.('#playerView'))) {
      triggerLightSpeedFocusSnap();
    }
    _lastActiveElement = curActive;
  }, 10);
}

function stopFocusGuardian() {
  if (_focusGuardian) {
    clearInterval(_focusGuardian);
    _focusGuardian = null;
  }
}

const _handleFocusLossOrVisibility = () => {
  if ($('playerView')?.classList.contains('show') && !_allowNavigation) {
    triggerLightSpeedFocusSnap();
    clearTimeout(_focusSnapTimer);
    _focusSnapTimer = setTimeout(snapWindowFocus, 10);
    setTimeout(snapWindowFocus, 25);
    setTimeout(snapWindowFocus, 45);
    setTimeout(snapWindowFocus, 120);
    setTimeout(snapWindowFocus, 300);
    setTimeout(snapWindowFocus, 600);
  }
};

['blur', 'visibilitychange', 'pagehide', 'focusout'].forEach(evt => {
  window.addEventListener(evt, _handleFocusLossOrVisibility, true);
  document.addEventListener(evt, _handleFocusLossOrVisibility, true);
});
try { document.onvisibilitychange = _handleFocusLossOrVisibility; } catch {}

let _allowNavigation = false;
window.addEventListener('beforeunload', (e) => {
  if ($('playerView')?.classList.contains('show') && !_allowNavigation) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

let shieldDisarmTimer = null;

function disarmVidShield() {
  const shield = $('vidShield');
  if (shield) shield.style.display = 'none';
  const zoneShield = $('pControlZoneShield');
  if (zoneShield) zoneShield.style.display = 'none';
  clearTimeout(shieldDisarmTimer);
}

function armVidShield() {
  const shield = $('vidShield');
  if (shield) shield.style.display = 'none';
  const zoneShield = $('pControlZoneShield');
  if (zoneShield) zoneShield.style.display = 'block';
}

let lastPlayerTap = 0;
['pointerdown', 'touchstart', 'click', 'mousedown', 'mouseup'].forEach(evt => {
  const handleInteraction = () => {
    if ($('playerView')?.classList.contains('show') && !_allowNavigation) {
      lastPlayerTap = Date.now();
      triggerLightSpeedFocusSnap();
      setTimeout(snapWindowFocus, 25);
      setTimeout(snapWindowFocus, 75);
      setTimeout(snapWindowFocus, 160);
      setTimeout(snapWindowFocus, 350);
    }
  };
  window.addEventListener(evt, handleInteraction, true);
  document.addEventListener(evt, handleInteraction, true);
});

// Proactively monitor pointer approaching player iframe to anticipate clicks
['pointermove', 'mousemove', 'touchmove', 'mouseenter'].forEach(evt => {
  window.addEventListener(evt, (e) => {
    if ($('playerView')?.classList.contains('show') && !_allowNavigation) {
      const pv = $('playerView');
      if (pv && (e.target === pv || pv.contains(e.target))) {
        if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) {
          triggerLightSpeedFocusSnap();
        }
      }
    }
  }, { capture: true, passive: true });
});

window.addEventListener('message', (event) => {
  if (!EMBED_ORIGINS.includes(event.origin)) return;
  const msg = event.data || {};
  if (msg.type === 'STORAGE_GET_ALL') {
    const targetSub = store.get('nf_sub_lang', 'ar') || 'ar';
    try {
      event.source?.postMessage({
        type: 'STORAGE_INIT',
        data: {
          subtitleLang: targetSub,
          va_subtitle_lang: targetSub,
          va_sub: targetSub,
          va_caption: targetSub,
          player_subtitle: targetSub,
          player_sub: targetSub,
          player_subtitles: targetSub,
          player_lang: targetSub,
          player_sub_lang: targetSub,
          default_sub: targetSub,
          sub_lang: targetSub,
          subtitles: targetSub,
          caption: targetSub,
          captions: targetSub,
          caption_lang: targetSub,
          cc: targetSub,
          cc_lang: targetSub
        }
      }, '*');
    } catch {}
  } else if (msg.type === 'PLAYER_EVENT') {
    const d = msg.data || {};
    if (d.player_status === 'completed' || d.event === 'ended') {
      const e = currentEmbed;
      if (e) {
        const key = e.type === 'series' ? (e.tmdbId ? `tmdb:${e.tmdbId}` : e.id) : (e.imdb || e.id);
        recordWatchFinish(key);
      }
      if (e?.type === 'series') {
        const tmdbId = e.tmdbId || ((typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(e.id || e.imdb)?.moviedb_id : null);
        const imdb = e.imdb;
        if (tmdbId || imdb) {
          toast('Starting next episode…');
          const s = Math.max(1, Number(e.season || 1));
          const ep = Math.max(1, Number(e.episode || 1)) + 1;
          const url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, currentPlayerServer);
          if (url) playEmbed({ ...e, url, tmdbId, imdb, season: s, episode: ep, server: currentPlayerServer });
        }
      }
    } else if (d.player_status === 'playing' || d.event === 'timeupdate') {
      const pInfo = d.player_info;
      const id = (pInfo && (pInfo.tmdb || pInfo.imdb)) || (currentEmbed && (currentEmbed.tmdbId || currentEmbed.imdb || currentEmbed.id));
      const curTime = d.player_progress != null ? d.player_progress : d.currentTime;
      const dur = d.player_duration != null ? d.player_duration : d.duration;
      if (id && curTime != null) {
        const cur = readProgressStore();
        cur[id] = {
          id,
          title: currentEmbed?.title,
          type: (pInfo?.mediaType === 'tv' || currentEmbed?.type === 'series') ? 'tv' : 'movie',
          last_season_watched: pInfo?.season || currentEmbed?.season || 1,
          last_episode_watched: pInfo?.episode || currentEmbed?.episode || 1,
          imdb: pInfo?.imdb || currentEmbed?.imdb,
          progress: { watched: curTime, duration: dur || 0 }
        };
        try { localStorage.setItem('vidsrcProgress', JSON.stringify(cur)); } catch {}
        syncEmbedProgress();
      }
    }
  }
});



/* ---------- PROFILE GATE ---------- */
function renderGate() {
  const gate = $('profileGate');
  if (!gate) return;
  const av = $('gateAvatars');
  if (!av) return;
  av.innerHTML = '';
  let saved = store.get('nf_profile', 'Z');
  if (saved === 'N') saved = 'Z';

  PROFILES.forEach(p => {
    const d = document.createElement('div');
    d.className = 'pav';
    d.innerHTML = `
      <div class="box" style="background:${p.color}">${p.id}</div>
      <div>${p.name}</div>
    `;
    d.onclick = () => {
      selectProfile(p);
      gate.classList.add('hide');
    };
    if (p.id === saved) {
      setTimeout(() => {
        const box = d.querySelector('.box');
        if (box) box.style.borderColor = '#ffffff';
      }, 50);
    }
    av.appendChild(d);
  });
}

/* ---------- LIVE SEARCH ---------- */
let liveT = null;
function armLiveSearch(input, box) {
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(liveT);
    const q = input.value.trim();
    if (q.length < 3) return;
    liveT = setTimeout(() => {
      if (box) box.value = q;
      if (pages.search.classList.contains('show') || input === box) doSearch(q);
    }, 500);
  });
}

/* ---------- ESCAPE KEY & INIT ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDetail();
    closeDownloadModal();
    closeCaptionsModal();
    closePlayerCustomModal();
    if ($('playerView')?.classList.contains('show')) closePlayer();
    closeAllNavDropdowns();
  } else if ((e.code === 'Space' || e.key === ' ' || e.key === 'k' || e.key === 'K') && $('playerView')?.classList.contains('show')) {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      e.preventDefault();
      togglePlayerPlayback();
    }
  }
});

(function migrateHistory() {
  let changed = false;
  Object.entries(history).forEach(([k, h]) => {
    if (!h) return;
    if (h.type === 'series' && !h.tmdbId && typeof CuratedCatalog !== 'undefined') {
      const c = CuratedCatalog.getCuratedById(k) || CuratedCatalog.getCuratedById(h.imdb);
      if (c && c.moviedb_id) { h.tmdbId = c.moviedb_id; changed = true; }
    }
    const playable = h.type === 'series' ? !!h.tmdbId : !!(h.imdb || k.startsWith('tt'));
    if (!playable) { delete history[k]; changed = true; return; }
    if (h.type === 'series') {
      if (h.season == null || h.season <= 0) { h.season = 1; changed = true; }
      if (h.episode == null || h.episode <= 0) { h.episode = 1; changed = true; }
    }
  });
  if (changed) store.set('nf_history', history);
})();

// Initialize app directly to home screen
show('home');
buildHome();
renderProfiles();
renderProfileSwitcherDropdown();
armLiveSearch($('searchInput'), $('searchBox'));
armLiveSearch($('searchBox'), null);
initSubtitlesAndPreferences();

let currentProfileId = store.get('nf_profile', 'Z');
if (currentProfileId === 'N') currentProfileId = 'Z';
const activeProf = PROFILES.find(p => p.id === currentProfileId) || PROFILES[0];
const letterEl = $('avatarLetter');
if (letterEl) {
  letterEl.textContent = activeProf.id;
  letterEl.style.background = activeProf.color;
}
