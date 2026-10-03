/* Netflix-style streaming portal — 100% client-side.
 * Streaming: VidAPI/Vaplayer embeds only. Downloads: OmniSave redirect only. */
'use strict';

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

const PROFILES = [
  { id: 'N', name: 'You', color: 'linear-gradient(135deg, #E50914 0%, #B81D24 100%)' },
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
    const all = dedupeMetas([
      ...(m1.metas || []),
      ...(m2.metas || []),
      ...(s1.metas || []),
      ...(s2.metas || [])
    ]);
    $('searchResults').innerHTML = all.length
      ? ''
      : `<div class="empty" style="grid-column:1/-1"><h2>Your search for "${q}" did not have any matches.</h2><p>Try searching for a different movie, TV show, actor, director, or genre.</p></div>`;
    all.forEach(meta => $('searchResults').appendChild(buildCard(meta)));
  } catch {
    $('searchResults').innerHTML = '<p style="color:#888;grid-column:1/-1;text-align:center">Search failed. Please check your internet connection.</p>';
  }
}

/* ---------- FETCH HELPERS ---------- */
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Fetch failed');
  return r.json();
}
const poster = m => m.poster || m.background || '';
const backdrop = m => m.background || m.poster || '';
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
  { id: 'popular_movies', title: 'Blockbuster Movies', url: ['movie/top', 'movie/top/skip=100'], limit: 75 },
  { id: 'popular_series', title: 'Trending TV Shows', url: ['series/top', 'series/top/skip=100'], limit: 75 },
  { id: 'toprated_movies', title: 'IMDb Top Rated Movies', url: ['movie/imdbRating', 'movie/imdbRating/skip=100'], limit: 75 },
  { id: 'toprated_series', title: 'Critically Acclaimed Series', url: ['series/imdbRating', 'series/imdbRating/skip=100'], limit: 75 },
  { id: 'new_releases', title: 'New Releases on Netflix', url: ['movie/year', 'series/year', 'movie/year/skip=100'], badge: 'NEW', limit: 75 },
  { id: 'action', title: 'High-Octane Action & Adrenaline', url: ['movie/top/genre=Action', 'movie/top/genre=Action/skip=100'], limit: 75 },
  { id: 'action_series', title: 'Action & Adventure TV Series', url: ['series/top/genre=Action', 'series/top/genre=Adventure', 'series/top/genre=Action/skip=100'], limit: 75 },
  { id: 'thriller', title: 'Edge-of-Your-Seat Thrillers & Psychological Suspense', url: ['movie/top/genre=Thriller', 'movie/top/genre=Thriller/skip=100'], limit: 75 },
  { id: 'scifi', title: 'Sci-Fi & Futuristic Worlds', url: ['movie/top/genre=Sci-Fi', 'series/top/genre=Sci-Fi', 'movie/top/genre=Sci-Fi/skip=100'], limit: 75 },
  { id: 'crime', title: 'Gripping Crime & True Mysteries', url: ['series/top/genre=Crime', 'movie/top/genre=Crime', 'series/top/genre=Crime/skip=100'], limit: 75 },
  { id: 'mystery', title: 'Mind-Bending Whodunits & Detective Stories', url: ['movie/top/genre=Mystery', 'series/top/genre=Mystery'], limit: 75 },
  { id: 'comedy', title: 'Laugh-Out-Loud Comedies', url: ['movie/top/genre=Comedy', 'movie/top/genre=Comedy/skip=100'], limit: 75 },
  { id: 'comedy_series', title: 'Sitcoms & TV Comedy Hits', url: ['series/top/genre=Comedy', 'series/top/genre=Comedy/skip=100'], limit: 75 },
  { id: 'horror', title: 'Chilling Horror & Supernatural Thrillers', url: ['movie/top/genre=Horror', 'movie/top/genre=Horror/skip=100'], limit: 75 },
  { id: 'drama', title: 'Binge-Worthy TV Dramas', url: ['series/top/genre=Drama', 'series/top/genre=Drama/skip=100'], limit: 75 },
  { id: 'drama_movies', title: 'Award-Winning Drama Movies', url: ['movie/top/genre=Drama', 'movie/top/genre=Drama/skip=100'], limit: 75 },
  { id: 'animation', title: 'Animated Masterpieces & Anime', url: ['series/top/genre=Animation', 'movie/top/genre=Animation', 'series/top/genre=Animation/skip=100'], limit: 75 },
  { id: 'family', title: 'Family Movie Night & Epic Adventures', url: ['movie/top/genre=Family', 'movie/top/genre=Adventure'], limit: 75 },
  { id: 'fantasy', title: 'Fantasy & Mythical Quests', url: ['movie/top/genre=Fantasy', 'series/top/genre=Fantasy'], limit: 75 },
  { id: 'romance', title: 'Romantic Movies & Heartfelt Stories', url: ['movie/top/genre=Romance', 'movie/top/genre=Romance/skip=100'], limit: 75 },
  { id: 'doc', title: 'Captivating Documentaries & Docuseries', url: ['movie/top/genre=Documentary', 'series/top/genre=Documentary'], limit: 75 },
  { id: 'heist', title: 'High-Stakes Heists & Gangster Sagas', url: ['movie/top/genre=Crime/skip=100', 'series/top/genre=Crime/skip=100'], limit: 75 },
  { id: 'superhero', title: 'Superhero Universes & Comic Legends', url: ['movie/top/genre=Action/skip=100', 'movie/top/genre=Fantasy/skip=100'], limit: 75 },
  { id: 'dark_humor', title: 'Dark Comedy & Cult Classics', url: ['movie/top/genre=Comedy/skip=100', 'movie/imdbRating/genre=Comedy'], limit: 75 },
  { id: 'sci_series', title: 'Sci-Fi & Cyberpunk Series', url: ['series/top/genre=Sci-Fi/skip=100', 'series/imdbRating/genre=Sci-Fi'], limit: 75 },
  { id: 'epic_history', title: 'Historical Epics & War Sagas', url: ['movie/top/genre=History', 'movie/top/genre=War', 'series/top/genre=History'], limit: 75 },
  { id: 'global_cinema', title: 'Global Cinema & International Hits', url: ['movie/top/skip=200', 'series/top/skip=200'], limit: 75 },
  { id: 'mylist', title: 'My List', dynamic: 'mylist' }
];

let catalogCache = {};
async function fetchCatalog(spec) {
  const key = spec;
  if (catalogCache[key]) return catalogCache[key];
  const d = await getJSON(`${CINEMETA}/catalog/${spec}.json`).catch(() => ({ metas: [] }));
  catalogCache[key] = (d.metas || []);
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
      pool = dedupeMetas(pool);
      if (r.mix) pool = pool.sort(() => Math.random() - .5);
      if (r.genre) pool = pool.filter(m => (m.genres || []).includes(r.genre));
      const max = r.limit || 75;
      items = pool.slice(0, max);
      if (r.id === 'new_releases') {
        items = pool.slice().sort((a, b) => parseInt(b.releaseInfo || 0) - parseInt(a.releaseInfo || 0)).slice(0, max);
      }
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
      <img src="${backdrop(m)}" alt="${(m.name || '').replace(/"/g, '')}" onerror="this.src='${poster(m)}'">
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
        <button class="cbtn ${isLiked ? 'solid' : ''}" data-pa="like" title="I like this">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
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
        const nowInList = myList.some(x => x.id === m.id);
        listBtn.innerHTML = nowInList
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
      }
    } else if (a === 'like') {
      likes[m.id] = !likes[m.id];
      delete dislikes[m.id];
      store.set('nf_likes', likes);
      toast(likes[m.id] ? 'Rated: I like this' : 'Rating removed');
      const likeBtn = portal.querySelector('[data-pa="like"]');
      if (likeBtn) likeBtn.classList.toggle('solid', !!likes[m.id]);
    } else if (a === 'dislike') {
      dislikes[m.id] = !dislikes[m.id];
      delete likes[m.id];
      store.set('nf_dislikes', dislikes);
      toast(dislikes[m.id] ? 'Not for me' : 'Rating removed');
      const likeBtn = portal.querySelector('[data-pa="like"]');
      if (likeBtn) likeBtn.classList.remove('solid');
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

function buildCard(m, badge, rank) {
  const type = m.type || (m.id && m.id.startsWith('tt') ? 'movie' : 'movie');
  const el = document.createElement('div');
  el.className = 'card';
  if (m._progress || m._finished) el.classList.add('landscape');

  const isContinue = (m._progress != null && !m._finished);
  const isFinished = !!m._finished;

  let badgeMarkup = '';
  if (isFinished) {
    badgeMarkup = `<span class="watched-badge"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Finished</span>`;
  } else if (badge) {
    badgeMarkup = `<span class="new-badge">${badge}</span>`;
  }

  const prog = isContinue
    ? `<div class="progress"><i style="width:${Math.round(m._progress * 100)}%"></i></div>`
    : '';

  const removeBtn = (isContinue || isFinished)
    ? `<span class="remove-x" title="${isFinished ? 'Remove from Finished Watching' : 'Remove from Continue Watching'}">✕</span>`
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
      <img loading="lazy" src="${poster(m)}" alt="${(m.name || '').replace(/"/g, '')}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22450%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%23181818%22/><text x=%2250%25%22 y=%2250%25%22 fill=%22%23777%22 text-anchor=%22middle%22 font-family=%22sans-serif%22 font-size=%2214%22>${encodeURIComponent((m.name || '?').slice(0, 18))}</text></svg>'">
      ${prog}
    </div>
  `;

  // Authentic Netflix hover intent delay
  el.addEventListener('mouseenter', () => onCardMouseEnter(el, m, badge, rank));
  el.addEventListener('mouseleave', () => onCardMouseLeave(el));

  el.onclick = e => {
    if (isRowDragging) return;
    if (m._embed) { playEmbedEntry(m); return; }
    
    const rx = e.target.closest('.remove-x');
    if (rx) {
      delete history[m.id];
      store.set('nf_history', history);
      renderContinueRow();
      toast(`Removed "${m.name || 'title'}" from list`);
      e.stopPropagation();
      return;
    }

    const fc = e.target.closest('.finish-check');
    if (fc) {
      if (!history[m.id]) {
        history[m.id] = {
          title: m.name,
          type: m.type || type,
          progress: 1.0,
          finished: true,
          poster: poster(m),
          imdb: m.imdb || (m.id.startsWith('tt') ? m.id : null),
          tmdbId: m.tmdbId
        };
      } else {
        history[m.id].finished = true;
        history[m.id].progress = 1.0;
      }
      store.set('nf_history', history);
      renderContinueRow();
      toast(`Marked "${m.name}" as finished`);
      e.stopPropagation();
      return;
    }

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
    bg.style.animation = 'none';
    void bg.offsetWidth;
    setTimeout(() => {
      bg.src = backdrop(m);
      bg.onload = () => { bg.style.opacity = '1'; };
      setTimeout(() => { bg.style.opacity = '1'; }, 300);
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
    const j = await getJSON(`${CINEMETA}/meta/${type}/${id}.json`);
    const m = j.meta;
    m.type = type;
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

    // Series episodes
    const vids = m.videos || [];
    if (type === 'series' && vids.length) {
      if ($('epWrap')) $('epWrap').style.display = '';
      const seasons = [...new Set(vids.map(v => v.season))].sort((a, b) => a - b);
      if ($('seasonSel')) {
        $('seasonSel').innerHTML = seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');
        const renderEps = () => {
          const s = +$('seasonSel').value;
          currentDetail.ep.s = s;
          const list = $('epList');
          if (!list) return;
          list.innerHTML = '';

          vids.filter(v => v.season === s).forEach(v => {
            const d = document.createElement('div');
            d.className = 'ep-card';
            d.innerHTML = `
              <div class="ep-num">${v.episode}</div>
              <div class="ep-thumb">
                <img src="${v.thumbnail || m.background || m.poster}" alt="Episode thumbnail" onerror="this.src='${backdrop(m)}'">
                <div class="ep-play">
                  <div class="ep-play-circle">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                  </div>
                </div>
              </div>
              <div class="ep-details">
                <div class="ep-title-row">
                  <b>${v.episode}. ${v.title || v.name || 'Episode ' + v.episode}</b>
                  <span class="ep-duration">${v.runtime || '45m'}</span>
                </div>
                <div class="ep-desc">${(v.overview || 'No description available.').slice(0, 150)}</div>
              </div>
            `;
            d.onclick = () => {
              currentDetail.ep = { s: v.season, e: v.episode };
              playEpisode(v.season, v.episode);
            };

            const dl = document.createElement('button');
            dl.className = 'cbtn';
            dl.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
            dl.title = 'Download on OmniSave ↗';
            dl.onclick = (e) => {
              e.stopPropagation();
              downloadEpisode(currentDetail.meta.name, v.season, v.episode);
            };
            d.appendChild(dl);
            list.appendChild(d);
          });
        };
        $('seasonSel').onchange = renderEps;
        $('seasonSel').value = seasons[0];
        renderEps();
      }
    } else {
      if ($('epWrap')) $('epWrap').style.display = 'none';
    }

    // Similar recommendations
    if ($('simGrid')) {
      $('simGrid').innerHTML = '';
      (await fetchCatalog(type + '/top')).filter(x => x.id !== id && (x.genres || []).some(g => (m.genres || []).includes(g))).slice(0, 6).forEach(s => {
        const d = document.createElement('div');
        d.className = 'sim';
        d.innerHTML = `
          <img src="${backdrop(s)}" alt="${s.name}" onerror="this.src='${poster(s)}'">
          <div class="sim-info">
            <div class="sim-title">${s.name}</div>
            <div class="sim-meta">
              <span class="match">${matchScore(s)}% Match</span>
              <span class="age-badge">${ageRating(s)}</span>
            </div>
          </div>
        `;
        d.onclick = () => openDetail(s.id, s.type || type, false);
        $('simGrid').appendChild(d);
      });
    }

    updateModalListButton(id);
    if ($('dList')) $('dList').onclick = () => { toggleList(m); updateModalListButton(id); };
    if ($('dLike')) $('dLike').onclick = () => toast('Thanks for rating!');
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
  dList.innerHTML = inList
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
  dList.title = inList ? 'Remove from My List' : 'Add to My List';
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
        <p>Explore titles on Netflix and add your favorites to watch them anytime.</p>
        <br>
        <button class="btn-red" onclick="document.querySelector('[data-nav=home]').click()">Explore Titles</button>
      </div>
    `;
    return;
  }
  myList.forEach(m => g.appendChild(buildCard(m)));
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

  for (const r of categoryRows) {
    const sec = $('row-' + r.id);
    if (!sec) continue;
    const track = sec.querySelector('.row-track');
    const urls = Array.isArray(r.url) ? r.url : [r.url];
    let pool = [];
    for (const u of urls) {
      pool = pool.concat(await fetchCatalog(u));
    }
    pool = dedupeMetas(pool);
    if (!pool.length) continue;
    sec.style.display = '';
    track.innerHTML = '';
    pool.slice(0, 75).forEach((m, idx) => track.appendChild(buildCard(m, r.badge, r.isTop10 ? idx + 1 : 0)));
    track.dispatchEvent(new Event('scroll'));
  }
}

async function filterBrowseByGenre(genre) {
  const rowsWrap = $('browseRows');
  const gridWrap = $('browseGrid');
  if (!rowsWrap || !gridWrap) return;

  if (!genre) {
    gridWrap.innerHTML = '';
    await loadCategoryRows(currentBrowseKind);
    return;
  }

  rowsWrap.innerHTML = '';
  gridWrap.innerHTML = skels(12);

  const type = currentBrowseKind === 'series' ? 'series' : 'movie';
  const [p1, p2] = await Promise.all([
    fetchCatalog(`${type}/top/genre=${encodeURIComponent(genre)}`),
    fetchCatalog(`${type}/top/genre=${encodeURIComponent(genre)}/skip=100`)
  ]);
  const items = dedupeMetas([...p1, ...p2]);

  gridWrap.innerHTML = items.length ? '' : `<div class="empty" style="grid-column:1/-1"><h2>No titles found for ${genre}</h2></div>`;
  items.slice(0, 120).forEach(m => gridWrap.appendChild(buildCard(m)));
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
  const current = store.get('nf_profile', 'N');

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
    toast('OmniSave opened in a new tab');
    return;
  }
  try {
    const done = navigator.clipboard && navigator.clipboard.writeText(query);
    if (done && done.then) {
      done.then(
        () => toast('OmniSave opened — title copied to clipboard'),
        () => toast('OmniSave opened in a new tab')
      );
    } else {
      toast('OmniSave opened in a new tab');
    }
  } catch {
    toast('OmniSave opened in a new tab');
  }
}

function currentTitleContext() {
  if (currentDetail?.meta) {
    const m = currentDetail.meta;
    const rawImdb = m.id || m.imdb_id;
    const imdb = rawImdb ? String(rawImdb).split(':')[0].trim() : '';
    return {
      title: m.name,
      type: currentDetail.type,
      imdb,
      tmdbId: m.moviedb_id,
      year: (m.releaseInfo || m.year || '').toString().slice(0, 4),
      season: currentDetail.ep?.s || 1,
      episode: currentDetail.ep?.e || 1
    };
  }
  if (currentEmbed) {
    return {
      title: currentEmbed.title,
      type: currentEmbed.type,
      imdb: currentEmbed.imdb,
      tmdbId: currentEmbed.tmdbId,
      season: currentEmbed.season || 1,
      episode: currentEmbed.episode || 1
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
  const s = ctx.season || 1;
  const e = ctx.episode || 1;
  const rawImdb = ctx.imdb || ctx.id;
  const imdbId = rawImdb ? String(rawImdb).split(':')[0].trim() : '';

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
        toast('IMDb ID missing for this title on VidVault');
        return;
      }
      safeOpenDownloadUrl(vidVaultUrl);
      toast('Opening Server 1 — VidVault…');
      closeDownloadModal();
    };
  }

  const b2 = $('serverBtn02');
  if (b2) {
    b2.onclick = () => {
      if (!movie02Url) {
        toast('IMDb ID missing for this title on 02MovieDownloader');
        return;
      }
      safeOpenDownloadUrl(movie02Url);
      toast('Opening Server 2 — 02MovieDownloader…');
      closeDownloadModal();
    };
  }

  const b3 = $('serverBtnOmni');
  if (b3) {
    b3.onclick = () => {
      safeOpenDownloadUrl(omniUrl);
      toast('Opening OmniSave search mirror…');
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
  openDownloadModal({
    title: seriesTitle || m?.name || 'Series',
    type: 'series',
    imdb,
    tmdbId: m?.moviedb_id,
    season,
    episode
  });
}

const pDl = $('pDl');
if (pDl) pDl.onclick = () => downloadCurrent();

/* ---------- PLAYER ---------- */
let hideT = null;
function wakeChrome() {
  ['pTop', 'pBottom'].forEach(id => {
    const el = $(id);
    if (el) el.style.opacity = '1';
  });
  clearTimeout(hideT);
  hideT = setTimeout(() => {
    ['pTop', 'pBottom'].forEach(id => {
      const el = $(id);
      if (el) el.style.opacity = '0';
    });
  }, 3500);
}

['pTop', 'pBottom'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('mousemove', wakeChrome);
});
document.addEventListener('mousemove', () => {
  if ($('playerView')?.classList.contains('show')) wakeChrome();
});

const pBack = $('pBack');
if (pBack) pBack.onclick = closePlayer;

function closePlayer() {
  _allowNavigation = true;
  disarmVidShield();
  syncEmbedProgress();
  const pv = $('playerView');
  if (pv) pv.classList.remove('show');
  hidePlayerError();
  document.querySelectorAll('#playerView iframe').forEach(f => f.remove());

  const v = $('playerVideo');
  if (v) {
    try { v.pause(); } catch {}
    v.removeAttribute('src');
    v.load();
    v.style.display = '';
  }
  if ($('pBottom')) $('pBottom').style.display = '';
  if ($('torrentStats')) $('torrentStats').style.display = '';
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

function openPlayerShell(title) {
  closeCardPortal();
  _allowNavigation = false;
  closeDetail();
  hidePlayerError();
  document.querySelectorAll('#playerView iframe').forEach(f => f.remove());
  const pv = $('playerView');
  if (pv) pv.classList.add('show');
  if ($('pTitle')) $('pTitle').textContent = title;
  wakeChrome();

  if ($('playerVideo')) $('playerVideo').style.display = 'none';
  if ($('pBottom')) $('pBottom').style.display = 'none';
  if ($('torrentStats')) $('torrentStats').style.display = 'none';
  if ($('skipIntro')) $('skipIntro').style.display = 'none';
  if ($('nextEp')) $('nextEp').style.display = 'none';
}

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
    if ($('pTitle')) $('pTitle').textContent = m.name;
    showPlayerError('Streaming is unavailable for this title (missing valid IMDb ID).');
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
  if (!o || !o.url) { showPlayerError('This title is unavailable.'); return; }
  currentEmbed = { ...o };
  currentStream = o;
  openPlayerShell(o.title + (o.type === 'series' ? ` — S${o.season}:E${o.episode}` : ''));

  const f = document.createElement('iframe');
  f.src = o.url;
  f.allowFullscreen = true;
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
  f.style.cssText = 'flex:1;width:100%;border:none;background:#000';
  $('playerView').insertBefore(f, $('pTop'));
  armVidShield();
}

function playEmbedEntry(m) {
  if (m.type === 'series') {
    if (!m.tmdbId) { toast('Streaming unavailable (missing ID).'); return; }
    const url = MediaLinks.getEpisodeStreamUrl({ tmdbId: m.tmdbId }, m.season || 1, m.episode || 1);
    if (!url) { toast('Streaming unavailable for this episode.'); return; }
    playEmbed({ url, type: 'series', tmdbId: m.tmdbId, season: m.season || 1, episode: m.episode || 1, title: m.name });
    return;
  }
  const imdb = m.imdb || ((m.id || '').startsWith('tt') ? m.id : null);
  const url = MediaLinks.getMovieStreamUrl({ imdb });
  if (!url) { toast('Streaming unavailable (missing IMDb ID).'); return; }
  playEmbed({ url, type: 'movie', imdb, title: m.name });
}

const EMBED_ORIGINS = ['https://vaplayer.ru', 'https://vidapi.ru'];
function readProgressStore() {
  try { return JSON.parse(localStorage.getItem('vidLinkProgress') || '{}'); }
  catch { return {}; }
}

function historyItems() {
  return Object.entries(history).map(([id, h]) => ({
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
    history[`tmdb:${entry.id}`] = {
      progress: p,
      finished: isFinished,
      type: entry.type === 'tv' ? 'series' : 'movie',
      title: entry.title || 'Title',
      poster: entry.poster_path ? `https://image.tmdb.org/t/p/w500${entry.poster_path}` : '',
      tmdbId: entry.id,
      imdb: entry.imdb || null,
      season: +(entry.last_season_watched || 1),
      episode: +(entry.last_episode_watched || 1),
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
  if (e?.type === 'series' && e.tmdbId) {
    const ep = (e.episode || 1) + 1;
    toast(`Loading episode ${ep}…`);
    const url = MediaLinks.getEpisodeStreamUrl({ tmdbId: e.tmdbId }, e.season || 1, ep);
    if (url) playEmbed({ ...e, url, episode: ep });
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
    urlStr.includes('omnisave')
  ) {
    return _nativeWindowOpen.call(window, url, target, features);
  }
  console.warn('[AdBlock] Blocked unauthorized window.open popup attempt:', url);
  return null;
};

let _allowNavigation = false;
window.addEventListener('beforeunload', (e) => {
  if ($('playerView')?.classList.contains('show') && !_allowNavigation) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

let shieldDisarmTimer = null;
let shieldClickCount = 0;

function disarmVidShield() {
  const shield = $('vidShield');
  if (shield) shield.style.display = 'none';
  clearTimeout(shieldDisarmTimer);
}

function armVidShield() {
  let shield = $('vidShield');
  if (!shield) {
    shield = document.createElement('div');
    shield.id = 'vidShield';
    shield.style.cssText = 'position:absolute;inset:0;z-index:4;display:block;cursor:pointer;background:transparent';
    $('playerView').insertBefore(shield, $('pTop'));
  }
  shield.style.display = 'block';
  shieldClickCount = 0;

  shield.onclick = (e) => {
    e.stopPropagation();
    shieldClickCount++;

    // Streaming embeds typically stack an overlay click trap on initial load.
    // Absorbing the initial tap neutralizes the ad trigger and disarms the shield permanently,
    // allowing unobstructed player control, scrubbing, and subtitle/audio language selection.
    shield.style.display = 'none';
    clearTimeout(shieldDisarmTimer);
    const iframe = $('playerView')?.querySelector('iframe');
    if (iframe) {
      try { iframe.focus(); } catch {}
    }
  };
}

let lastPlayerTap = 0;
document.addEventListener('pointerdown', () => {
  if ($('playerView')?.classList.contains('show')) {
    lastPlayerTap = Date.now();
  }
}, true);

window.addEventListener('message', (event) => {
  if (!EMBED_ORIGINS.includes(event.origin)) return;
  const msg = event.data || {};
  if (msg.type === 'MEDIA_DATA' && msg.data) {
    try {
      const cur = readProgressStore();
      cur[msg.data.id] = { ...msg.data, imdb: msg.data.imdb || msg.data.imdb_id || undefined };
      localStorage.setItem('vidLinkProgress', JSON.stringify(cur));
    } catch {}
    syncEmbedProgress();
  } else if (msg.type === 'PLAYER_EVENT' && msg.data?.event === 'ended') {
    const e = currentEmbed;
    if (e?.type === 'series' && e.tmdbId) {
      toast('Starting next episode…');
      const ep = (e.episode || 1) + 1;
      const url = MediaLinks.getEpisodeStreamUrl({ tmdbId: e.tmdbId }, e.season || 1, ep);
      if (url) playEmbed({ ...e, url, episode: ep });
    }
  }
});

// Player controls
const ppPlay = $('ppPlay');
if (ppPlay) {
  ppPlay.onclick = () => {
    const v = $('playerVideo');
    if (v) {
      v.paused ? v.play() : v.pause();
    }
  };
}

const ppBack = $('ppBack');
if (ppBack) {
  ppBack.onclick = () => {
    const v = $('playerVideo');
    if (v) v.currentTime = Math.max(0, v.currentTime - 10);
  };
}

const ppFwd = $('ppFwd');
if (ppFwd) {
  ppFwd.onclick = () => {
    const v = $('playerVideo');
    if (v) v.currentTime += 10;
  };
}

const ppMute = $('ppMute');
if (ppMute) {
  ppMute.onclick = () => {
    const v = $('playerVideo');
    if (v) v.muted = !v.muted;
  };
}

const ppFs = $('ppFs');
if (ppFs) {
  ppFs.onclick = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      $('playerView')?.requestFullscreen?.();
    }
  };
}

const ppSubs = $('ppSubs');
if (ppSubs) {
  ppSubs.onclick = () => {
    disarmVidShield();
    const iframe = $('playerView')?.querySelector('iframe');
    if (iframe) {
      try { iframe.focus(); } catch {}
    }
    toast('Select subtitles or audio in the CC menu inside the player');
  };
}

const ppEps = $('ppEps');
if (ppEps) {
  ppEps.onclick = () => {
    closePlayer();
    if (currentDetail) openDetail(currentDetail.meta.id, currentDetail.type, false);
  };
}

/* ---------- PROFILE GATE ---------- */
function renderGate() {
  const av = $('gateAvatars');
  if (!av) return;
  av.innerHTML = '';
  const saved = store.get('nf_profile', 'N');

  PROFILES.forEach(p => {
    const d = document.createElement('div');
    d.className = 'pav';
    d.innerHTML = `
      <div class="box" style="background:${p.color}">${p.id}</div>
      <div>${p.name}</div>
    `;
    d.onclick = () => {
      selectProfile(p);
      const gate = $('profileGate');
      if (gate) gate.classList.add('hide');
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
    if ($('playerView')?.classList.contains('show')) closePlayer();
    closeAllNavDropdowns();
  }
});

(function migrateHistory() {
  let changed = false;
  Object.entries(history).forEach(([k, h]) => {
    if (!h) return;
    const playable = h.type === 'series' ? !!h.tmdbId : !!(h.imdb || k.startsWith('tt'));
    if (!playable) { delete history[k]; changed = true; }
  });
  if (changed) store.set('nf_history', history);
})();

// Initialize app
show('home');
buildHome();
renderProfiles();
renderProfileSwitcherDropdown();
renderGate();
armLiveSearch($('searchInput'), $('searchBox'));
armLiveSearch($('searchBox'), null);

const currentProfileId = store.get('nf_profile', 'N');
const activeProf = PROFILES.find(p => p.id === currentProfileId) || PROFILES[0];
const letterEl = $('avatarLetter');
if (letterEl) {
  letterEl.textContent = activeProf.id;
  letterEl.style.background = activeProf.color;
}
