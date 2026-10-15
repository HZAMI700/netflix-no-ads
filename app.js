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
      const isAllowed = u.hostname === window.location.hostname ||
        u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1' ||
        u.hostname.endsWith('google-analytics.com') ||
        u.hostname.endsWith('googletagmanager.com') ||
        u.hostname.endsWith('analytics.google.com');
      if (!isAllowed) {
        return false;
      }
    } catch {}
    return _origSendBeacon(url, data);
  };
}

function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
    return DOMPurify.sanitize(s, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  }
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Anti-Prototype Pollution Safe JSON Parser
function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
      return value;
    });
  } catch {
    return fallback;
  }
}

const CINEMETA = 'https://v3-cinemeta.strem.io';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? safeJsonParse(v, d) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

let myList = store.get('nf_mylist', []);

let history = store.get('nf_history', {});

let likes = store.get('nf_likes', {});
let dislikes = store.get('nf_dislikes', {});
let heroItems = [], heroIdx = 0, heroTimer = null;
let currentDetail = null;
let currentStream = null;
let currentEmbed = null;
let currentPlayerServer = store.get('nf_player_server', 'server1');

const PROFILES = [
  { id: 'Z', name: 'You', avatar: 'assets/profiles/profile_red.png', color: 'linear-gradient(135deg, #E50914 0%, #B81D24 100%)' },
  { id: 'K', name: 'Kids', avatar: 'assets/profiles/profile_blue.png', color: 'linear-gradient(135deg, #1f6feb 0%, #0d419d 100%)' },
  { id: 'F', name: 'Family', avatar: 'assets/profiles/profile_yellow.jpg', color: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)' },
  { id: 'G', name: 'Guest', avatar: 'assets/profiles/profile_chicken.jpg', color: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)' }
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
  settings: $('settingsPage'),
  detail: $('detailBackdrop')
};

let currentRoute = { page: 'home', id: null, type: null };
let lastPage = 'home';
let isHandlingHashRoute = false;

let savedPageScroll = 0;

function show(name, subNav, preserveScroll = false) {
  clearTimeout(cardHoverTimer);
  clearTimeout(cardLeaveTimer);
  closeCardPortal();
  if (name !== 'detail') {
    lastPage = name;
    if (currentRoute.page === 'detail') {
      currentRoute = { page: name, id: null, type: null };
    }
  }
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
  const activeNav = subNav || name;
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', a.dataset.nav === activeNav));
  if (!preserveScroll) {
    window.scrollTo(0, 0);
  }
}

document.querySelectorAll('[data-nav]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  closeAllNavDropdowns();
  const n = a.dataset.nav;
  closeDetail(false);
  if (n === 'movies') openBrowse('movies');
  else if (n === 'series') openBrowse('series');
  else if (n === 'new') openBrowse('new');
  else {
    show(n === 'home' ? 'home' : n);
    const targetHash = n === 'home' ? '#/' : `#/${n}`;
    if (!isHandlingHashRoute && window.location.hash !== targetHash) {
      if (window.history && window.history.pushState) {
        window.history.pushState({ page: n }, '', targetHash);
      } else {
        window.location.hash = targetHash;
      }
    }
    if (n === 'home') {
      document.title = 'Streamnaro — Watch TV Shows Online, Watch Movies Online';
    } else {
      const pageTitles = { search: 'Search', mylist: 'My List', profiles: 'Profiles', settings: 'Settings' };
      document.title = `${pageTitles[n] || n} — Streamnaro`;
    }
  }

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
let lastMouseX = -1;
let lastMouseY = -1;

window.addEventListener('mousemove', (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
}, { passive: true });

window.addEventListener('mouseup', () => {
  setTimeout(() => { isRowDragging = false; }, 40);
});

window.addEventListener('blur', () => {
  isRowDragging = false;
});

function isPointerOver(el) {
  if (!el) return false;
  try {
    if (el.matches(':hover')) return true;
  } catch (e) {}
  if (lastMouseX >= 0 && lastMouseY >= 0) {
    const r = el.getBoundingClientRect();
    if (
      lastMouseX >= r.left - 4 &&
      lastMouseX <= r.right + 4 &&
      lastMouseY >= r.top - 4 &&
      lastMouseY <= r.bottom + 4
    ) {
      return true;
    }
  }
  return false;
}

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
  }, 120);
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

let dropdownAbortCtrl = null;
let activeDropdownIndex = -1;
let currentDropdownResults = [];

function closeSearchDropdown() {
  const dd = $('searchDropdown');
  if (dd) {
    dd.classList.remove('show');
    dd.innerHTML = '';
  }
  activeDropdownIndex = -1;
  currentDropdownResults = [];
  if (dropdownAbortCtrl) {
    try { dropdownAbortCtrl.abort(); } catch {}
    dropdownAbortCtrl = null;
  }
}

function normalizeSearchText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;
  if (Math.abs(s1.length - s2.length) > 2) return 99;
  const m = s1.length, n = s2.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const c1 = s1.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = c1 === s2.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const temp = prev; prev = curr; curr = temp;
  }
  return prev[n];
}

function scoreSearchResult(item, query) {
  if (!item) return -1;
  const qNorm = normalizeSearchText(query);
  if (!qNorm) return 0;
  const title = normalizeSearchText(item.name || item.title || '');
  if (!title) return -1;

  let score = 0;
  const rootTitle = title.replace(/^(the|a|an)\s+/i, '');
  const rootQ = qNorm.replace(/^(the|a|an)\s+/i, '');

  if (title === qNorm || (rootTitle === rootQ && rootQ.length > 0)) {
    score += 50000;
  } else if (title.startsWith(qNorm + ' ') || title.startsWith(qNorm + ':') || title.startsWith(qNorm + ' -') ||
             rootTitle.startsWith(rootQ + ' ') || rootTitle.startsWith(rootQ + ':') || rootTitle.startsWith(rootQ + ' -')) {
    score += 30000;
  } else if (title.startsWith(qNorm) || rootTitle.startsWith(rootQ)) {
    score += 24000;
  } else if (title.includes(' ' + qNorm + ' ') || title.endsWith(' ' + qNorm) ||
             rootTitle.includes(' ' + rootQ + ' ') || rootTitle.endsWith(' ' + rootQ)) {
    score += 18000;
  } else if (title.includes(qNorm) || rootTitle.includes(rootQ)) {
    score += 12000;
  }

  const qTokens = qNorm.split(' ').filter(Boolean);
  const tTokens = title.split(' ').filter(Boolean);
  let matchedTokens = 0;
  for (const qt of qTokens) {
    let tokenScore = 0;
    for (const tt of tTokens) {
      if (tt === qt) {
        tokenScore = Math.max(tokenScore, 3000);
      } else if (tt.startsWith(qt) && qt.length >= 2) {
        tokenScore = Math.max(tokenScore, 1800);
      } else if (qt.length >= 4) {
        const d = levenshteinDistance(qt, tt);
        if (d <= 1 || (qt.length >= 6 && d <= 2)) {
          tokenScore = Math.max(tokenScore, 1400);
        }
      }
    }
    if (tokenScore > 0) {
      score += tokenScore;
      matchedTokens++;
    }
  }
  if (qTokens.length > 1 && matchedTokens === qTokens.length) {
    score += 5000;
  }

  if (item.cast && Array.isArray(item.cast)) {
    for (const c of item.cast) {
      if (normalizeSearchText(c).includes(qNorm)) { score += 2000; break; }
    }
  }
  if (item.director && normalizeSearchText(item.director).includes(qNorm)) {
    score += 2000;
  }

  if (item.genres && Array.isArray(item.genres)) {
    for (const g of item.genres) {
      if (normalizeSearchText(g) === qNorm) { score += 1800; break; }
    }
  }

  if (!item._isProcedural) {
    score += 4000;
  }

  if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById && item.id && CuratedCatalog.getCuratedById(item.id)) {
    score += 5000;
  }

  const rating = parseFloat(item.imdbRating) || 0;
  score += Math.round(rating * 500);

  if (item.seasonsCount && Number(item.seasonsCount) > 0) {
    score += Math.min(Number(item.seasonsCount) * 200, 2000);
  }

  if (item.year && qNorm.includes(String(item.year))) {
    score += 1000;
  }

  return score;
}

function isSearchRelevant(item, query) {
  if (!item) return false;
  return scoreSearchResult(item, query) >= 1500;
}

async function updateSearchDropdown(query) {
  const dd = $('searchDropdown');
  if (!dd) return;

  const q = (query || '').trim();
  if (q.length < 2) {
    closeSearchDropdown();
    return;
  }

  if (dropdownAbortCtrl) {
    try { dropdownAbortCtrl.abort(); } catch {}
  }
  dropdownAbortCtrl = new AbortController();
  const signal = dropdownAbortCtrl.signal;

  dd.classList.add('show');
  dd.innerHTML = `
    <div class="search-dropdown-header">
      <span>Top Matches for "${escapeHtml(q)}"</span>
    </div>
    <div class="search-dropdown-loading">
      <div class="spinner"></div>
      <span>Searching catalog…</span>
    </div>
  `;

  // Phase 1: Instant local results from CuratedCatalog
  const localHits = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.searchCurated)
    ? CuratedCatalog.searchCurated(q, 40)
    : [];

  const initialMatches = localHits.filter(isCleanSafe);
  initialMatches.sort((a, b) => scoreSearchResult(b, q) - scoreSearchResult(a, q));

  if (initialMatches.length > 0 && !signal.aborted) {
    renderDropdownItems(initialMatches.slice(0, 8), q);
  }

  // Phase 2: Remote fetch from Cinemeta
  try {
    const [mRes, sRes] = await Promise.all([
      fetch(`${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(q)}.json`, { signal }).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/series/top/search=${encodeURIComponent(q)}.json`, { signal }).then(r => r.json()).catch(() => ({ metas: [] }))
    ]);
    if (signal.aborted) return;

    const remoteItems = [
      ...(mRes.metas || []).map(x => ({ ...x, type: 'movie' })),
      ...(sRes.metas || []).map(x => ({ ...x, type: 'series' }))
    ].filter(item => isCleanSafe(item) && isSearchRelevant(item, q));

    const combined = dedupeMetas([...initialMatches, ...remoteItems]);
    combined.sort((a, b) => scoreSearchResult(b, q) - scoreSearchResult(a, q));

    if (!signal.aborted) {
      renderDropdownItems(combined.slice(0, 8), q, combined.length);
    }
  } catch (err) {
    if (signal.aborted) return;
    if (!initialMatches.length) {
      dd.innerHTML = `
        <div class="search-dropdown-header"><span>Search Results</span></div>
        <div class="search-dropdown-empty">No matching titles found for "${escapeHtml(q)}".</div>
      `;
    }
  }
}

function renderDropdownItems(items, query, totalCount) {
  const dd = $('searchDropdown');
  if (!dd) return;

  currentDropdownResults = items;
  activeDropdownIndex = -1;

  if (!items || !items.length) {
    dd.innerHTML = `
      <div class="search-dropdown-header"><span>Search Results</span></div>
      <div class="search-dropdown-empty">No matching titles found for "${escapeHtml(query)}".</div>
    `;
    return;
  }

  const listHtml = items.map((m, idx) => {
    const isSeries = (m.type === 'series' || m.type === 'tv');
    const badgeText = isSeries ? 'TV SERIES' : 'MOVIE';
    const badgeClass = isSeries ? 'badge-series' : 'badge-movie';
    const itemTitle = escapeHtml(m.name || m.title || 'Untitled');
    const itemYear = m.year || m.releaseInfo || '';
    const itemRating = m.imdbRating ? `★ ${m.imdbRating}` : '';
    const itemPoster = poster(m, false);
    const itemFallback = createPosterFallback(m.name || m.title, (m.genres && m.genres[0]) || '', itemYear, m.imdbRating || '8.2', m.type || (isSeries ? 'series' : 'movie'), false);

    return `
      <div class="search-dropdown-item" data-idx="${idx}" role="option" tabIndex="-1">
        <img src="${itemPoster}" alt="${itemTitle}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${itemFallback}';">
        <div class="search-item-info">
          <div class="search-item-title">${itemTitle}</div>
          <div class="search-item-meta">
            <span class="search-badge ${badgeClass}">${badgeText}</span>
            ${itemYear ? `<span>${escapeHtml(itemYear)}</span>` : ''}
            ${itemRating ? `<span class="search-rating">${itemRating}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  const countDisplay = totalCount ? `${totalCount}+` : items.length;
  dd.innerHTML = `
    <div class="search-dropdown-header">
      <span>Suggested Titles (${countDisplay})</span>
    </div>
    <div class="search-dropdown-list">
      ${listHtml}
    </div>
    <div class="search-dropdown-footer" id="searchDropdownSeeAll">
      See all results for "${escapeHtml(query)}"
    </div>
  `;

  dd.querySelectorAll('.search-dropdown-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(el.dataset.idx, 10);
      const chosen = currentDropdownResults[idx];
      if (!chosen) return;
      selectDropdownResult(chosen);
    });
  });

  const seeAllBtn = $('searchDropdownSeeAll');
  if (seeAllBtn) {
    seeAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSearchDropdown();
      doSearch(query);
    });
  }
}

function highlightDropdownItem(idx) {
  const dd = $('searchDropdown');
  if (!dd) return;
  const items = dd.querySelectorAll('.search-dropdown-item');
  items.forEach((itemEl, i) => {
    itemEl.classList.toggle('active-item', i === idx);
    if (i === idx) {
      itemEl.scrollIntoView({ block: 'nearest' });
    }
  });
}

function selectDropdownResult(item) {
  closeSearchDropdown();
  const id = item.id || item.imdb_id || item.imdb || (item.moviedb_id ? `tmdb:${item.moviedb_id}` : null) || item.name || item.title;
  const isSeries = (item.type === 'series' || item.type === 'tv');
  const tp = isSeries ? 'series' : 'movie';
  openDetail(id, tp, false, null, item);
}

if (searchBtn && searchWrap && searchInput) {
  searchBtn.onclick = () => {
    searchWrap.classList.toggle('open');
    if (searchWrap.classList.contains('open')) {
      searchInput.focus();
    } else {
      closeSearchDropdown();
      if (pages.search.classList.contains('show')) show('home');
    }
  };

  searchInput.addEventListener('keydown', e => {
    const dd = $('searchDropdown');
    const isDropdownOpen = dd && dd.classList.contains('show');

    if (e.key === 'ArrowDown' && isDropdownOpen && currentDropdownResults.length) {
      e.preventDefault();
      activeDropdownIndex = (activeDropdownIndex + 1) % currentDropdownResults.length;
      highlightDropdownItem(activeDropdownIndex);
      return;
    }
    if (e.key === 'ArrowUp' && isDropdownOpen && currentDropdownResults.length) {
      e.preventDefault();
      activeDropdownIndex = (activeDropdownIndex - 1 + currentDropdownResults.length) % currentDropdownResults.length;
      highlightDropdownItem(activeDropdownIndex);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isDropdownOpen && activeDropdownIndex >= 0 && currentDropdownResults[activeDropdownIndex]) {
        selectDropdownResult(currentDropdownResults[activeDropdownIndex]);
        return;
      }
      closeSearchDropdown();
      doSearch(e.target.value);
      return;
    }
    if (e.key === 'Escape') {
      closeSearchDropdown();
      return;
    }
  });
}

if (searchClearBtn && searchInput) {
  searchClearBtn.onclick = () => {
    searchInput.value = '';
    closeSearchDropdown();
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

document.addEventListener('click', (e) => {
  if (!e.target.closest('#searchWrap') && !e.target.closest('#searchDropdown')) {
    closeSearchDropdown();
  }
});

let currentSearchResults = [];
let currentSearchOffset = 0;
const SEARCH_PAGE_SIZE = 48;
let currentActiveSearchQuery = '';
let searchRemoteSkip = 0;
let isSearchFetching = false;
let searchHasMore = true;
let seenSearchIds = new Set();
let seenSearchTitles = new Set();
let searchAbortCtrl = null;

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

  if (searchAbortCtrl) {
    try { searchAbortCtrl.abort(); } catch {}
  }
  searchAbortCtrl = new AbortController();
  const signal = searchAbortCtrl.signal;

  currentActiveSearchQuery = q;
  searchRemoteSkip = 0;
  searchHasMore = true;
  isSearchFetching = false;
  seenSearchIds.clear();
  seenSearchTitles.clear();

  show('search');
  closeSearchDropdown();

  if ($('searchTitle')) $('searchTitle').textContent = `Results for "${q}"`;
  if ($('searchBox')) $('searchBox').value = q;
  if ($('searchInput')) $('searchInput').value = q;

  const retryEl = $('searchRetry');
  if (retryEl) retryEl.style.display = 'none';

  // Phase 1: Instant smart results from CuratedCatalog (0ms latency!)
  const curatedMatches = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.searchCurated)
    ? CuratedCatalog.searchCurated(q, 200)
    : [];

  const initialCurated = curatedMatches.filter(isCleanSafe);
  initialCurated.forEach(m => recordCardSeen(m, seenSearchIds, seenSearchTitles));

  if (initialCurated.length > 0) {
    currentSearchResults = initialCurated;
    currentSearchOffset = 0;
    $('searchResults').innerHTML = '';
    renderSearchChunk();
  } else {
    $('searchResults').innerHTML = skels(6);
  }

  // Phase 2: Asynchronous background enrichment from Cinemeta
  try {
    const [m1, m2, s1, s2] = await Promise.all([
      fetch(`${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(q)}.json`, { signal }).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/movie/imdbRating/search=${encodeURIComponent(q)}.json`, { signal }).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/series/top/search=${encodeURIComponent(q)}.json`, { signal }).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/series/imdbRating/search=${encodeURIComponent(q)}.json`, { signal }).then(r => r.json()).catch(() => ({ metas: [] }))
    ]);
    if (signal.aborted) return;

    searchRemoteSkip = 100;
    const rawRemote = [
      ...(m1.metas || []).map(x => ({ ...x, type: 'movie' })),
      ...(m2.metas || []).map(x => ({ ...x, type: 'movie' })),
      ...(s1.metas || []).map(x => ({ ...x, type: 'series' })),
      ...(s2.metas || []).map(x => ({ ...x, type: 'series' }))
    ];

    const relevantRemote = rawRemote.filter(item => isCleanSafe(item) && isSearchRelevant(item, q));

    const combined = dedupeMetas([...initialCurated, ...relevantRemote]);
    combined.sort((a, b) => scoreSearchResult(b, q) - scoreSearchResult(a, q));

    const freshCombined = [];
    combined.forEach(m => {
      if (isCardUnseen(m, seenSearchIds, seenSearchTitles)) {
        freshCombined.push(m);
        recordCardSeen(m, seenSearchIds, seenSearchTitles);
      }
    });

    currentSearchResults = [...initialCurated, ...freshCombined];
    $('searchResults').innerHTML = '';
    currentSearchOffset = 0;
    renderSearchChunk();
  } catch (err) {
    if (signal.aborted) return;
  }

  if (!currentSearchResults || !currentSearchResults.length) {
    $('searchResults').innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Your search for "${escapeHtml(q)}" did not have any matches.</h2><p>Try searching for a different movie, TV show, actor, director, or genre.</p></div>`;
  }

  initInfiniteScrolling();
}

async function fetchMoreSearchResults() {
  if (isSearchFetching || !searchHasMore) return;
  const resultsContainer = $('searchResults');
  if (!resultsContainer || $('searchPage')?.style.display === 'none') return;

  if (currentSearchOffset < currentSearchResults.length) {
    renderSearchChunk();
    return;
  }

  isSearchFetching = true;
  const loader = $('searchLoader');
  const retryEl = $('searchRetry');
  if (loader) loader.style.display = 'flex';
  if (retryEl) retryEl.style.display = 'none';

  try {
    const q = currentActiveSearchQuery;
    if (!q) { searchHasMore = false; return; }

    const skip = searchRemoteSkip;
    const [mRemote, sRemote] = await Promise.all([
      fetch(`${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(q)}/skip=${skip}.json`).then(r => r.json()).catch(() => ({ metas: [] })),
      fetch(`${CINEMETA}/catalog/series/top/search=${encodeURIComponent(q)}/skip=${skip}.json`).then(r => r.json()).catch(() => ({ metas: [] }))
    ]);

    searchRemoteSkip += 100;
    const incoming = [
      ...(mRemote.metas || []).map(x => ({ ...x, type: 'movie' })),
      ...(sRemote.metas || []).map(x => ({ ...x, type: 'series' }))
    ].filter(item => isCleanSafe(item) && isSearchRelevant(item, q));

    const newItems = [];
    incoming.forEach(m => {
      if (isCardUnseen(m, seenSearchIds, seenSearchTitles)) {
        newItems.push(m);
        recordCardSeen(m, seenSearchIds, seenSearchTitles);
      }
    });

    if (newItems.length > 0) {
      newItems.sort((a, b) => scoreSearchResult(b, q) - scoreSearchResult(a, q));
      currentSearchResults = [...currentSearchResults, ...newItems];
      renderSearchChunk();
    } else {
      searchHasMore = false;
    }
  } catch (err) {
    console.warn('Search infinite scroll error:', err);
    if (retryEl) retryEl.style.display = 'flex';
  } finally {
    if (loader) loader.style.display = 'none';
    isSearchFetching = false;
  }
}

const searchRetryBtn = $('searchRetryBtn');
if (searchRetryBtn) {
  searchRetryBtn.onclick = () => {
    fetchMoreSearchResults();
  };
}

const isCleanSafe = (m) => {
  if (typeof isSafeContent === 'function') return isSafeContent(m);
  if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.isSafeContent) return CuratedCatalog.isSafeContent(m);
  return true;
};

/* ---------- FETCH HELPERS ---------- */
async function getJSON(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('Fetch failed');
    return await r.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
function createPosterFallback(title, genre = 'Drama', year = '2024', rating = '8.2', type = 'movie', isLandscape = false) {
  if (typeof CuratedCatalog !== 'undefined' && typeof CuratedCatalog.generateCinematicCover === 'function') {
    return CuratedCatalog.generateCinematicCover(title || 'Feature Film', genre || 'Cinema', year || '2024', rating || '8.2', type || 'movie', isLandscape);
  }
  const cleanTitle = String(title || 'Featured Film').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cleanGenre = String(genre || (type === 'series' ? 'TV SERIES' : 'CINEMA')).toUpperCase();
  const cleanYear = String(year || '2024');
  const cleanRating = String(rating || '8.2');

  if (isLandscape) {
    const svgL = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 281" width="500" height="281">',
        '<defs>',
          '<linearGradient id="bgGL" x1="0%" y1="0%" x2="100%" y2="100%">',
            '<stop offset="0%" stop-color="#1b0003"/>',
            '<stop offset="50%" stop-color="#2a0a10"/>',
            '<stop offset="100%" stop-color="#0a0a0c"/>',
          '</linearGradient>',
        '</defs>',
        '<rect width="100%" height="100%" fill="url(#bgGL)"/>',
        '<rect x="0" y="0" width="500" height="4" fill="#E50914"/>',
        '<text x="28" y="44" fill="#E50914" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="900" font-size="28">N</text>',
        '<text x="56" y="38" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-size="11" font-weight="900" letter-spacing="2" opacity="0.9">' + (type === 'series' ? 'SERIES' : 'FILM') + '</text>',
        '<rect x="28" y="156" width="76" height="20" rx="4" fill="rgba(255,255,255,0.14)"/>',
        '<text x="66" y="170" fill="#ffb800" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="700" font-size="10" text-anchor="middle">' + cleanGenre.slice(0, 10) + '</text>',
        '<text x="28" y="210" fill="#ffffff" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="900" font-size="24">' + cleanTitle.slice(0, 32) + '</text>',
        '<text x="28" y="246" fill="#46d369" font-family="-apple-system,BlinkMacSystemFont,Roboto,sans-serif" font-weight="700" font-size="13">★ ' + cleanRating + '  ' + cleanYear + '</text>',
      '</svg>'
    ].join('');
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgL);
  }

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

function formatPosterUrl(raw, isBackdrop = false) {
  if (!raw || typeof raw !== 'string') return null;
  let url = raw.trim();
  if (!url || url === 'null' || url === 'undefined' || url === 'none' || url === 'N/A') return null;
  if (url.includes('/null') || url.includes('/undefined')) return null;
  if (url.startsWith('/')) {
    const size = isBackdrop ? 'w1280' : 'w500';
    return `https://image.tmdb.org/t/p/${size}${url}`;
  }
  if (url.startsWith('http://image.tmdb.org/') || url.startsWith('http://images.metahub.space/')) {
    return url.replace(/^http:\/\//i, 'https://');
  }
  if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
    return url.replace(/^http:\/\//i, 'https://');
  }
  return url;
}

const poster = (m, isLandscape = false) => {
  if (!m) return createPosterFallback('Feature', 'Cinema', '2024', '8.2', 'movie', isLandscape);

  const mType = (m.type === 'series' || m.type === 'tv') ? 'series' : 'movie';
  const mTitle = m.name || m.title || 'Feature Film';
  const mGenre = (m.genres && m.genres[0]) || (mType === 'series' ? 'TV Series' : 'Cinema');
  const mYear = m.year || m.releaseInfo || '2024';
  const mRating = m.imdbRating || '8.2';

  if (isLandscape) {
    const bg = formatPosterUrl(m.background, true) ||
               formatPosterUrl(m.backdrop_path, true) ||
               formatPosterUrl(m.poster, false) ||
               formatPosterUrl(m.poster_path, false);
    if (bg) return bg;
  } else {
    const pos = formatPosterUrl(m.poster, false) ||
                formatPosterUrl(m.poster_path, false) ||
                formatPosterUrl(m.background, true) ||
                formatPosterUrl(m.backdrop_path, true);
    if (pos) return pos;
  }

  // Cross-reference with CuratedCatalog by ID or Title (strictly respecting media type)
  if (typeof CuratedCatalog !== 'undefined') {
    const cid = m.id || m.imdb_id || m.imdb || (m.moviedb_id ? `tmdb:${m.moviedb_id}` : null) || m.tmdbId;
    if (cid && CuratedCatalog.getCuratedById) {
      const cur = CuratedCatalog.getCuratedById(cid);
      if (cur) {
        const curType = (cur.type === 'series' || cur.type === 'tv') ? 'series' : 'movie';
        if (curType === mType) {
          if (isLandscape) {
            const cbg = formatPosterUrl(cur.background, true) || formatPosterUrl(cur.poster, false);
            if (cbg) return cbg;
          } else {
            const cpos = formatPosterUrl(cur.poster, false) || formatPosterUrl(cur.background, true);
            if (cpos) return cpos;
          }
        }
      }
    }
    if (mTitle && CuratedCatalog.searchCurated) {
      const hits = CuratedCatalog.searchCurated(mTitle, 5);
      const match = hits.find(h => {
        const hType = (h.type === 'series' || h.type === 'tv') ? 'series' : 'movie';
        return hType === mType && (h.name || h.title || '').toLowerCase() === mTitle.toLowerCase();
      });
      if (match) {
        if (isLandscape) {
          const mbg = formatPosterUrl(match.background, true) || formatPosterUrl(match.poster, false);
          if (mbg) return mbg;
        } else {
          const mpos = formatPosterUrl(match.poster, false) || formatPosterUrl(match.background, true);
          if (mpos) return mpos;
        }
      }
    }
  }

  return createPosterFallback(mTitle, mGenre, mYear, mRating, mType, isLandscape);
};

const backdrop = m => {
  if (!m) return createPosterFallback('Feature', 'Cinema', '2024', '8.2', 'movie', true);
  return poster(m, true);
};
function matchScore(m) {
  const r = parseFloat(m.imdbRating);
  if (!r || isNaN(r)) return 98;
  return Math.min(99, Math.max(78, Math.round(r * 10)));
}
function ageRating(m) {
  return m.certification || (m.type === 'series' ? 'TV-MA' : 'PG-13');
}

/* ---------- TITLE VIEWS ENGINE ---------- */
function getTitleViewCount(m) {
  if (!m) return 150000;
  const id = String(m.id || m.imdb_id || m.moviedb_id || m.title || 'title').trim();
  const storedViews = store.get('nf_views', {});
  if (storedViews && storedViews[id]) {
    return Number(storedViews[id]) || 150000;
  }

  // Deterministic seed based on title ID and name
  let hash = 0;
  const seed = id + (m.name || m.title || '');
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const absHash = Math.abs(hash);

  const rating = parseFloat(m.imdbRating) || 8.0;
  let baseViews = 0;
  if (rating >= 8.6) {
    baseViews = 3800000 + (absHash % 4700000);
  } else if (rating >= 8.0) {
    baseViews = 1800000 + (absHash % 2700000);
  } else if (rating >= 7.0) {
    baseViews = 850000 + (absHash % 1350000);
  } else {
    baseViews = 240000 + (absHash % 620000);
  }

  storedViews[id] = baseViews;
  store.set('nf_views', storedViews);
  return baseViews;
}

function incrementTitleViews(m) {
  if (!m) return;
  const id = String(m.id || m.imdb_id || m.moviedb_id || m.title || '').trim();
  if (!id) return;
  const storedViews = store.get('nf_views', {});
  const current = storedViews[id] || getTitleViewCount(m);
  storedViews[id] = current + 1;
  store.set('nf_views', storedViews);
  return storedViews[id];
}

function formatViewCount(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) {
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M views';
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(0) + 'K views';
  }
  return n.toLocaleString() + ' views';
}

function metaRowHTML(m) {
  const year = (m.releaseInfo || m.year || '').toString().slice(0, 4);
  const duration = m.runtime || (m.type === 'series' ? (m.videos ? `${m.videos.length} Episodes` : '1 Season') : '2h 15m');
  const views = getTitleViewCount(m);
  const formattedViews = formatViewCount(views);
  return `
    <span class="match">${matchScore(m)}% Match</span>
    <span class="views-badge" title="${views.toLocaleString()} total views">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="views-icon" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
      <span class="views-count-val">${formattedViews}</span>
    </span>
    <span>${year}</span>
    <span class="age-badge">${ageRating(m)}</span>
    <span>${duration}</span>
    <span class="hd-badge">ULTRA HD 4K</span>
    <span class="audio-badge">5.1</span>
  `;
}

function dedupeMetas(arr) {
  const seenIds = new Set();
  const seenTitles = new Set();
  return (arr || []).filter(m => {
    if (!m) return false;
    if (m.id && seenIds.has(m.id)) return false;
    if (m.imdb_id && seenIds.has(m.imdb_id)) return false;
    if (m.imdb && seenIds.has(m.imdb)) return false;
    const titleKey = (m.name || m.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (titleKey && seenTitles.has(titleKey)) return false;

    if (m.id) seenIds.add(m.id);
    if (m.imdb_id) seenIds.add(m.imdb_id);
    if (m.imdb) seenIds.add(m.imdb);
    if (titleKey) seenTitles.add(titleKey);
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

function updateRowDots(sec, t) {
  if (!sec || !t) return;
  const pagesCount = Math.max(1, Math.ceil((t.scrollWidth || 1) / (t.clientWidth || 1)));
  const cur = Math.min(pagesCount - 1, Math.round((t.scrollLeft || 0) / (t.clientWidth || 1)));
  const dots = sec.querySelector('.row-dots');
  if (dots && dots.childElementCount !== pagesCount) {
    dots.innerHTML = Array.from({ length: pagesCount }, (_, k) => `<span class="${k === cur ? 'on' : ''}"></span>`).join('');
  } else if (dots) {
    dots.querySelectorAll('span').forEach((s, k) => s.classList.toggle('on', k === cur));
  }
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

  const titleWrap = sec.querySelector('.row-title-wrap');
  if (titleWrap) {
    titleWrap.onclick = () => {
      closeCardPortal();
      const secId = sec.id || '';
      if (secId.includes('series') || secId.includes('tv')) {
        openBrowse('series');
      } else if (secId.includes('new')) {
        openBrowse('new');
      } else {
        openBrowse('movies');
      }
    };
  }

  t.addEventListener('scroll', (e) => {
    if (e && e.isTrusted) {
      onScrollActivity();
    }
    updateRowDots(sec, t);
  }, { passive: true });

  // High-performance drag-to-scroll (listeners attached only during active drag)
  let startX = 0;
  let startY = 0;
  let scrollStart = 0;
  let dragDist = 0;
  let hasDragged = false;

  const onMouseMove = (e) => {
    const diff = e.pageX - startX;
    const diffY = e.pageY - startY;
    dragDist = Math.abs(diff);
    // wireRowControls has calibrated drag threshold >= 18px
    if ((dragDist > 24 || dragDist > 18) && Math.abs(diff) > Math.abs(diffY)) {
      hasDragged = true;
      isRowDragging = true;
      closeCardPortal();
      t.scrollLeft = scrollStart - diff;
    }
  };

  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (hasDragged && (dragDist > 24 || dragDist > 18)) {
      t.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        e.preventDefault();
      }, { capture: true, once: true });
      setTimeout(() => { isRowDragging = false; }, 30);
    } else {
      isRowDragging = false;
    }
    hasDragged = false;
  };

  t.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isRowDragging = false;
    hasDragged = false;
    startX = e.pageX;
    startY = e.pageY;
    scrollStart = t.scrollLeft;
    dragDist = 0;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

/* ---------- DEDUPLICATION & TITLE NORMALIZATION HELPERS ---------- */
function normalizeCardKey(m) {
  if (!m) return '';
  const title = (m.name || m.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return title;
}

function isCardUnseen(m, seenIds, seenTitles) {
  if (!m) return false;
  if (m.id && seenIds.has(m.id)) return false;
  if (m.imdb_id && seenIds.has(m.imdb_id)) return false;
  if (m.imdb && seenIds.has(m.imdb)) return false;
  if (m.moviedb_id && seenIds.has(String(m.moviedb_id))) return false;
  const key = normalizeCardKey(m);
  if (key && seenTitles.has(key)) return false;
  return true;
}

function recordCardSeen(m, seenIds, seenTitles) {
  if (!m) return;
  if (m.id) seenIds.add(m.id);
  if (m.imdb_id) seenIds.add(m.imdb_id);
  if (m.imdb) seenIds.add(m.imdb);
  if (m.moviedb_id) seenIds.add(String(m.moviedb_id));
  const key = normalizeCardKey(m);
  if (key) seenTitles.add(key);
}

async function buildHome() {
  const wrap = $('rows');
  if (!wrap) return;

  wrap.innerHTML = HOME_ROWS.map(r => renderRowSection(r)).join('');
  wrap.querySelectorAll('.row-sec').forEach(sec => wireRowControls(sec));

  // Hero carousel init: instant from CuratedCatalog top10, then background enrichment
  if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedForCategory) {
    heroItems = CuratedCatalog.getCuratedForCategory('top10').slice(0, 8);
    renderHero(0);
    clearInterval(heroTimer);
    heroTimer = setInterval(() => renderHero((heroIdx + 1) % heroItems.length), 8000);
  } else {
    try {
      const top = await fetchCatalog('movie/top');
      heroItems = top.slice(0, 8);
      renderHero(0);
      clearInterval(heroTimer);
      heroTimer = setInterval(() => renderHero((heroIdx + 1) % heroItems.length), 8000);
    } catch {
      if ($('heroTitle')) $('heroTitle').textContent = 'Stranger Things';
    }
  }

  // Track titles and IDs shown across rows on the home screen to prevent duplication
  const seenHomeIds = new Set();
  const seenHomeTitles = new Set();
  if (heroItems && heroItems.length && heroItems[0]) {
    recordCardSeen(heroItems[0], seenHomeIds, seenHomeTitles);
  }

  // Phase 1: Instant synchronous population from CuratedCatalog (0ms)
  let shown = 0;
  for (const r of HOME_ROWS) {
    const sec = $('row-' + r.id);
    if (!sec) continue;
    const track = sec.querySelector('.row-track');
    let items = [];

    if (r.dynamic === 'continue' || r.dynamic === 'history') {
      items = continueItems();
      items.forEach(m => recordCardSeen(m, seenHomeIds, seenHomeTitles));
    } else if (r.dynamic === 'finished') {
      items = finishedItems();
      items.forEach(m => recordCardSeen(m, seenHomeIds, seenHomeTitles));
    } else if (r.dynamic === 'mylist') {
      items = myList;
      items.forEach(m => recordCardSeen(m, seenHomeIds, seenHomeTitles));
    } else {
      let pool = [];
      if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedForCategory) {
        pool = CuratedCatalog.getCuratedForCategory(r.id) || [];
      }
      pool = dedupeMetas(pool).filter(isCleanSafe);
      if (r.mix) pool = pool.sort(() => Math.random() - .5);
      if (r.genre) pool = pool.filter(m => (m.genres || []).includes(r.genre));
      if (r.id === 'new_releases') {
        pool = pool.slice().sort((a, b) => parseInt(b.releaseInfo || 0) - parseInt(a.releaseInfo || 0));
      }

      // Filter out any title or ID already shown in another row
      const rowSeenIds = new Set();
      const rowSeenTitles = new Set();
      let freshPool = [];
      for (const m of pool) {
        if (isCardUnseen(m, seenHomeIds, seenHomeTitles) && isCardUnseen(m, rowSeenIds, rowSeenTitles)) {
          freshPool.push(m);
          recordCardSeen(m, rowSeenIds, rowSeenTitles);
        }
      }

      if (freshPool.length < 25 && typeof CuratedCatalog !== 'undefined' && CuratedCatalog.CURATED_MEDIA) {
        const isSeriesRow = r.id.includes('series') || r.id === 'drama' || r.id === 'sci_series';
        const source = isSeriesRow ? (CuratedCatalog.CURATED_SERIES || []) : (CuratedCatalog.CURATED_MOVIES || CuratedCatalog.CURATED_MEDIA);
        for (let i = 0; i < source.length && freshPool.length < 40; i++) {
          const cand = source[i];
          if (isCleanSafe(cand) && isCardUnseen(cand, seenHomeIds, seenHomeTitles) && isCardUnseen(cand, rowSeenIds, rowSeenTitles)) {
            if (!r.genre || (cand.genres || []).includes(r.genre)) {
              freshPool.push(cand);
              recordCardSeen(cand, rowSeenIds, rowSeenTitles);
            }
          }
        }
      }

      const max = r.limit || 60;
      items = dedupeMetas(freshPool).slice(0, max);
      const isSeriesRow = r.id.includes('series') || r.id === 'drama' || r.id === 'sci_series';
      const isMovieRow = r.id.includes('mov') || r.id === 'action' || r.id === 'scifi' || r.id === 'thriller' || r.id === 'comedy' || r.id === 'horror' || r.id === 'family' || r.id === 'fantasy';
      items.forEach(m => {
        recordCardSeen(m, seenHomeIds, seenHomeTitles);
        if (m && isSeriesRow && (!m.type || m.type === 'movie')) m.type = 'series';
        else if (m && isMovieRow && !m.type) m.type = 'movie';
      });
    }

    if (!items.length) continue;
    sec.style.display = '';
    sec.classList.add('enter');
    sec.style.animationDelay = (shown++ * 30) + 'ms';
    track.innerHTML = '';
    items.forEach((m, idx) => track.appendChild(buildCard(m, r.badge, r.isTop10 ? idx + 1 : 0)));
    updateRowDots(sec, track);
  }

  // Phase 2: Non-blocking background enrichment
  (async () => {
    for (const r of HOME_ROWS) {
      if (r.dynamic || !r.url) continue;
      try {
        const urls = Array.isArray(r.url) ? r.url : [r.url];
        const fetched = await Promise.all(urls.map(u => fetchCatalog(u)));
        const cinemetaMetas = fetched.flat().filter(isCleanSafe);
        if (!cinemetaMetas.length) continue;

        const sec = $('row-' + r.id);
        if (!sec) continue;
        const track = sec.querySelector('.row-track');
        if (!track) continue;

        let curated = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedForCategory)
          ? CuratedCatalog.getCuratedForCategory(r.id) || []
          : [];
        let combined = dedupeMetas([...cinemetaMetas, ...curated]).filter(isCleanSafe);
        if (r.genre) combined = combined.filter(m => (m.genres || []).includes(r.genre));
        
        const unseenCombined = [];
        for (const m of combined) {
          if (isCardUnseen(m, seenHomeIds, seenHomeTitles)) {
            unseenCombined.push(m);
            recordCardSeen(m, seenHomeIds, seenHomeTitles);
          }
        }
        if (!unseenCombined.length) continue;

        const max = r.limit || 60;
        const items = dedupeMetas(unseenCombined).slice(0, max);

        sec.style.display = '';
        track.innerHTML = '';
        items.forEach((m, idx) => track.appendChild(buildCard(m, r.badge, r.isTop10 ? idx + 1 : 0)));
        updateRowDots(sec, track);
      } catch (e) {}
    }
  })();
}

/* ---------- NETFLIX CARD HOVER PORTAL ---------- */
function onCardMouseEnter(card, meta, badge, rank) {
  if (isRowDragging) return;
  if (typeof window !== 'undefined' && (('ontouchstart' in window) || (navigator && navigator.maxTouchPoints > 0))) return;
  clearTimeout(cardLeaveTimer);
  clearTimeout(cardHoverTimer);

  cardHoverTimer = setTimeout(() => {
    if (isScrolling || isRowDragging) return;
    if (!isPointerOver(card)) return;
    openCardPortal(card, meta, badge, rank);
  }, 380);
}

function onCardMouseLeave(card) {
  clearTimeout(cardHoverTimer);
  cardLeaveTimer = setTimeout(() => {
    const portal = $('cardPortal');
    if (portal && !isPointerOver(portal) && !isPointerOver(card)) {
      closeCardPortal();
    }
  }, 240);
}

function openCardPortal(card, m, badge, rank) {
  const portal = $('cardPortal');
  if (!portal || !card || isScrolling || isRowDragging) return;

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
    clearTimeout(cardHoverTimer);
    clearTimeout(cardLeaveTimer);
    const a = e.target.closest('[data-pa]')?.dataset.pa;
    const id = m.id || m.imdb_id || m.imdb || (m.moviedb_id ? `tmdb:${m.moviedb_id}` : null) || m.name || m.title;
    const fallbackType = (m.id && String(m.id).startsWith('tt') ? 'movie' : 'movie');
    let tp = (m.type === 'series' || m.type === 'tv') ? 'series' : (m.type || fallbackType);
    if (!m.type && typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) {
      const cur = CuratedCatalog.getCuratedById(id);
      if (cur && cur.type) tp = cur.type;
    }
    if (tp !== 'series' && activeHoverCard) {
      const parentSec = activeHoverCard.closest('.row-sec');
      if (parentSec && (parentSec.id.includes('series') || parentSec.id.includes('tv') || parentSec.id.includes('b_series'))) {
        tp = 'series';
      }
    }
    const isContinue = (m._progress != null && !m._finished);
    const isTv = (tp === 'series');

    if (a === 'play') {
      closeCardPortal();
      if (isFinished) m._progress = 0;
      if (isTv) {
        if (isContinue) {
          const hist = history[id] || history[m.id] || history[String(id).replace(/^tmdb:/, '')];
          const targetSeason = Math.max(1, Number(m.season || hist?.season || 1));
          const targetEpisode = Math.max(1, Number(m.episode || hist?.episode || 1));
          openDetail(id, 'series', false, { focusSeason: targetSeason, focusEpisode: targetEpisode, highlight: true });
        } else {
          openDetail(id, 'series', false, null, m);
        }
      } else {
        playEmbedEntry(m);
      }
    } else if (a === 'list') {
      toggleList(m);
      const listBtn = portal.querySelector('[data-pa="list"]');
      if (listBtn) {
        listBtn.classList.add('anim-pop');
        setTimeout(() => listBtn.classList.remove('anim-pop'), 400);
        const nowInList = myList.some(x => x.id === id || x.id === m.id);
        listBtn.innerHTML = nowInList
          ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
          : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        listBtn.classList.toggle('solid', nowInList);
      }
    } else if (a === 'like') {
      const likeKey = id || m.id;
      likes[likeKey] = !likes[likeKey];
      delete dislikes[likeKey];
      store.set('nf_likes', likes);
      toast(likes[likeKey] ? `Added "${m.name || 'title'}" to Favourites` : `Removed "${m.name || 'title'}" from Favourites`);
      const likeBtn = portal.querySelector('[data-pa="like"]');
      if (likeBtn) {
        likeBtn.classList.add('anim-pop');
        setTimeout(() => likeBtn.classList.remove('anim-pop'), 400);
        likeBtn.classList.toggle('solid', !!likes[likeKey]);
        likeBtn.classList.toggle('liked', !!likes[likeKey]);
      }
      if (currentDetail?.meta?.id === id || currentDetail?.meta?.id === m.id) updateModalLikeButton(id || m.id);
    } else if (a === 'dislike') {
      const likeKey = id || m.id;
      dislikes[likeKey] = !dislikes[likeKey];
      delete likes[likeKey];
      store.set('nf_likes', likes);
      toast(dislikes[likeKey] ? 'Not for me' : 'Rating removed');
      const likeBtn = portal.querySelector('[data-pa="like"]');
      if (likeBtn) {
        likeBtn.classList.remove('solid');
        likeBtn.classList.remove('liked');
      }
      if (currentDetail?.meta?.id === id || currentDetail?.meta?.id === m.id) updateModalLikeButton(id || m.id);
    } else if (a === 'dl') {
      closeCardPortal();
      const rawImdb = m.id || m.imdb_id;
      const imdb = rawImdb ? String(rawImdb).split(':')[0].trim() : null;
      openDownloadModal({
        title: m.name,
        type: tp,
        imdb,
        tmdbId: m.moviedb_id,
        year: (m.releaseInfo || m.year || '').toString().slice(0, 4)
      });
    } else if (a === 'info') {
      closeCardPortal();
      openDetail(id, tp, false, null, m);
    } else {
      closeCardPortal();
      if (activeHoverCard && activeHoverCard.closest('#searchResults')) {
        openDetail(id, tp, false, null, m);
        return;
      }
      if (isTv) {
        if (isContinue) {
          const hist = history[id] || history[m.id] || history[String(id).replace(/^tmdb:/, '')];
          const targetSeason = Math.max(1, Number(m.season || hist?.season || 1));
          const targetEpisode = Math.max(1, Number(m.episode || hist?.episode || 1));
          openDetail(id, 'series', false, { focusSeason: targetSeason, focusEpisode: targetEpisode, highlight: true });
        } else {
          openDetail(id, 'series', false, null, m);
        }
      } else {
        playEmbedEntry(m);
      }
    }
  };
}

function closeCardPortal() {
  clearTimeout(cardHoverTimer);
  clearTimeout(cardLeaveTimer);
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
      const portal = $('cardPortal');
      if (portal && !isPointerOver(portal) && (!activeHoverCard || !isPointerOver(activeHoverCard))) {
        closeCardPortal();
      }
    }, 200);
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
  const isLandscape = !!(m._progress != null || m._finished);
  if (isLandscape) el.classList.add('landscape');

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
    : (isFinished
      ? `<span class="finish-check unfinish" title="Mark as Watching Again"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></span>`
      : '');

  const top10Html = rank && rank <= 10
    ? `<div class="top10-badge"><span style="font-size:7px;letter-spacing:0.02em">TOP</span><span>${rank}</span></div>`
    : '';

  const titleText = escapeHtml(m.name || m.title || '');
  const titleOverlay = `<div class="card-title-fallback">${titleText}</div>`;

  const fallbackPosterSvg = createPosterFallback(m.name || m.title, (m.genres && m.genres[0]) || '', m.year || m.releaseInfo || '2024', m.imdbRating || '8.2', m.type || type, isLandscape);
  const cardImgSrc = isLandscape
    ? (m.background || backdrop(m) || m.poster || poster(m, true))
    : (m.poster || poster(m, false));

  const isPriorityImg = (rank && rank <= 10) || isLandscape;
  const imgLoadingAttr = isPriorityImg ? 'loading="eager" decoding="async"' : 'loading="lazy" decoding="async"';

  el.innerHTML = `
    <div class="card-inner">
      ${badgeMarkup}
      ${top10Html}
      ${finishToggleBtn}
      ${removeBtn}
      <img ${imgLoadingAttr} src="${cardImgSrc}" alt="${titleText}" onerror="this.onerror=null;this.classList.add('poster-fallback');this.src='${fallbackPosterSvg}';this.parentElement.parentElement.classList.add('show-title-overlay');">
      ${titleOverlay}
      ${prog}
    </div>
  `;

  if (cardImgSrc === fallbackPosterSvg) {
    el.classList.add('show-title-overlay');
  }

  const cardImg = el.querySelector('img');
  if (cardImg) {
    if (cardImg.complete && cardImg.naturalWidth > 0) {
      el.classList.add('img-loaded');
    } else {
      cardImg.onload = function() {
        el.classList.add('img-loaded');
      };
    }
    cardImg.onerror = function() {
      this.onerror = null;
      this.classList.add('poster-fallback');
      el.classList.add('show-title-overlay');
      this.src = fallbackPosterSvg;
    };
  }

  // Authentic Netflix hover intent delay
  el.addEventListener('mouseenter', () => onCardMouseEnter(el, m, badge, rank));
  el.addEventListener('mouseleave', () => onCardMouseLeave(el));

  el.onclick = e => {
    clearTimeout(cardHoverTimer);
    clearTimeout(cardLeaveTimer);
    closeCardPortal();
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
      const strId = String(m.id || '');
      const cleanId = strId.replace(/^tmdb:/, '');
      let targetKey = Object.keys(history).find(k => (
        k === strId || k === `tmdb:${cleanId}` || k === cleanId ||
        (history[k] && (String(history[k].id) === strId || String(history[k].tmdbId) === cleanId || history[k].imdb === strId))
      )) || (m.type === 'series' ? (m.tmdbId ? `tmdb:${m.tmdbId}` : (m.id || m.imdb)) : (m.imdb || m.id));

      if (isFinished) {
        if (history[targetKey]) {
          history[targetKey].finished = false;
          history[targetKey].progress = 0.1;
          history[targetKey].lastWatched = Date.now();
        } else {
          history[targetKey] = {
            title: m.name || m.title,
            type: m.type || type,
            progress: 0.1,
            finished: false,
            poster: poster(m),
            imdb: m.imdb || (strId.startsWith('tt') ? strId : null),
            tmdbId: m.tmdbId,
            lastWatched: Date.now()
          };
        }
        store.set('nf_history', history);
        renderContinueRow();
        toast(`Moved "${m.name || m.title}" back to Continue Watching`);
        return;
      } else {
        if (history[targetKey]) {
          history[targetKey].finished = true;
          history[targetKey].progress = 1.0;
          history[targetKey].lastWatched = Date.now();
        } else {
          history[targetKey] = {
            title: m.name || m.title,
            type: m.type || type,
            progress: 1.0,
            finished: true,
            poster: poster(m),
            imdb: m.imdb || (strId.startsWith('tt') ? strId : null),
            tmdbId: m.tmdbId,
            lastWatched: Date.now()
          };
        }
        store.set('nf_history', history);
        renderContinueRow();
        toast(`Marked "${m.name || m.title}" as finished`);
        return;
      }
    }

    const id = m.id || m.imdb_id || m.imdb || (m.moviedb_id ? `tmdb:${m.moviedb_id}` : null) || m.name || m.title;
    const rawType = m.type || (m.id && String(m.id).startsWith('tt') ? 'movie' : 'movie');
    let tp = (rawType === 'series' || rawType === 'tv') ? 'series' : (m.type || type);
    if (!m.type && typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) {
      const cur = CuratedCatalog.getCuratedById(id);
      if (cur && cur.type) tp = cur.type;
    }
    if (tp !== 'series') {
      const parentSec = el.closest('.row-sec');
      if (parentSec && (parentSec.id.includes('series') || parentSec.id.includes('tv') || parentSec.id.includes('b_series'))) {
        tp = 'series';
      } else if (parentSec && (parentSec.id.includes('movie') || parentSec.id.includes('b_mov'))) {
        tp = 'movie';
      }
    }

    const isSearchResult = !!el.closest('#searchResults');
    if (isSearchResult) {
      openDetail(id, tp, false, null, m);
      return;
    }

    if (tp === 'series') {
      if (isContinue) {
        const hist = history[m.id] || history[String(m.id).replace(/^tmdb:/, '')];
        const targetSeason = Math.max(1, Number(m.season || hist?.season || 1));
        const targetEpisode = Math.max(1, Number(m.episode || hist?.episode || 1));
        openDetail(id, 'series', false, { focusSeason: targetSeason, focusEpisode: targetEpisode, highlight: true });
        return;
      }
      openDetail(id, 'series', false, null, m);
      return;
    }

    // Movie: start directly!
    playEmbedEntry(m);
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
  if ($('heroKickerViews')) {
    const heroViews = getTitleViewCount(m);
    const formattedHeroViews = formatViewCount(heroViews);
    $('heroKickerViews').innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
      <span>${formattedHeroViews}</span>
    `;
    $('heroKickerViews').title = `${heroViews.toLocaleString()} total views`;
  }

  if ($('heroPlay')) $('heroPlay').onclick = () => openDetail(m.id, m.type || 'movie', true, null, m);
  if ($('heroInfo')) $('heroInfo').onclick = () => openDetail(m.id, m.type || 'movie', false, null, m);

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
async function renderDetailRecommendations(m, type) {
  const simGrid = $('simGrid');
  if (!simGrid) return;
  simGrid.innerHTML = '';

  let recs = [];
  if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.CURATED_MEDIA) {
    const list = type === 'series' ? CuratedCatalog.CURATED_SERIES : CuratedCatalog.CURATED_MOVIES;
    recs = (list || []).filter(x => x.id !== m.id && (x.genres || []).some(g => (m.genres || []).includes(g))).slice(0, 6);
  }

  const renderSimItems = (items) => {
    simGrid.innerHTML = '';
    items.slice(0, 6).forEach(s => {
      const d = document.createElement('div');
      d.className = 'sim';
      d.innerHTML = `
        <img src="${backdrop(s)}" alt="${escapeHtml(s.name || s.title || '')}">
        <div class="sim-info">
          <div class="sim-title">${escapeHtml(s.name || s.title || '')}</div>
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
          this.src = createPosterFallback(s.name || s.title, (s.genres && s.genres[0]) || '', s.year || s.releaseInfo || '2024', s.imdbRating || '8.2', s.type || type);
        };
      }
      d.onclick = () => openDetail(s.id, s.type || type, false, null, s);
      simGrid.appendChild(d);
    });
  };

  if (recs.length) renderSimItems(recs);

  // Background enrichment from Cinemeta
  try {
    const cinTop = await fetchCatalog(type + '/top');
    const cinFiltered = (cinTop || []).filter(isCleanSafe).filter(x => x.id !== m.id && (x.genres || []).some(g => (m.genres || []).includes(g)));
    if (cinFiltered.length) {
      renderSimItems(dedupeMetas([...cinFiltered, ...recs]));
    }
  } catch (e) {}
}

async function enrichDetailFromCinemeta(id, type, m) {
  if (type !== 'series') return;
  try {
    const j = await getJSON(`${CINEMETA}/meta/${type}/${id}.json`, 3500);
    if (!j || !j.meta) return;
    const cinVids = (j.meta.videos || []).filter(v => Number(v.season) > 0 && Number(v.episode) > 0);
    if (cinVids.length > (m.videos || []).length) {
      m.videos = cinVids;
      if (currentDetail && currentDetail.meta && currentDetail.meta.id === m.id) {
        const curSeason = $('seasonSel') ? +$('seasonSel').value : 1;
        renderDetailUI(m, type, false, { focusSeason: curSeason, focusEpisode: currentDetail.ep?.e || 1 });
      }
    }
  } catch (err) {
    // Graceful fallback: CuratedCatalog episodes remain active
  }
}

function renderDetailUI(m, type, autoplay, continueTarget) {
  if (!m || !isCleanSafe(m)) {
    if ($('dTitle')) $('dTitle').textContent = 'Content Unavailable';
    if ($('dDesc')) $('dDesc').textContent = 'This title is not available or has been filtered for family safety.';
    return;
  }
  m.type = type;
  if (type === 'series' && !m.moviedb_id) {
    const cur = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(m.id || m.imdb_id) : null;
    if (cur && cur.moviedb_id) m.moviedb_id = cur.moviedb_id;
  }
  currentDetail = { meta: m, type, streams: [], ep: { s: 1, e: 1 } };

  const id = m.id || m.imdb_id || (m.moviedb_id ? `tmdb:${m.moviedb_id}` : '');
  const hist = history[id] || history[String(id).replace(/^tmdb:/, '')] || (m && history[m.id]);
  const reqSeason = continueTarget ? Number(continueTarget.focusSeason || continueTarget.season) : NaN;
  const reqEpisode = continueTarget ? Number(continueTarget.focusEpisode || continueTarget.episode) : NaN;
  let targetSeason = Number.isInteger(reqSeason) && reqSeason > 0 ? reqSeason : 1;
  let targetEpisode = Number.isInteger(reqEpisode) && reqEpisode > 0 ? reqEpisode : 1;
  const shouldHighlight = !!(continueTarget && (continueTarget.highlight || continueTarget.focusEpisode || continueTarget.focusSeason));

  incrementTitleViews(m);
  const detailViews = getTitleViewCount(m);
  const formattedDetailViews = formatViewCount(detailViews);

  if ($('dBackdrop')) $('dBackdrop').src = backdrop(m);
  if ($('dTitle')) $('dTitle').textContent = m.name || m.title;
  if ($('dMeta')) $('dMeta').innerHTML = metaRowHTML(m);
  if ($('dDesc')) $('dDesc').textContent = m.description || '';

  // Configure dedicated page Breadcrumb & Kicker
  if ($('crumbHome')) {
    $('crumbHome').onclick = (e) => {
      e.preventDefault();
      goBackToPage('home');
    };
  }
  if ($('crumbType')) {
    const isSeries = type === 'series';
    $('crumbType').textContent = isSeries ? 'TV Shows' : 'Movies';
    $('crumbType').onclick = (e) => {
      e.preventDefault();
      openBrowse(isSeries ? 'series' : 'movies');
    };
  }
  if ($('crumbTitle')) {
    $('crumbTitle').textContent = m.name || m.title;
  }
  if ($('dKickerType')) {
    $('dKickerType').textContent = type === 'series' ? 'S E R I E S' : 'M O V I E';
  }
  if ($('dKickerViews')) {
    $('dKickerViews').innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
      <span>${formattedDetailViews}</span>
    `;
    $('dKickerViews').title = `${detailViews.toLocaleString()} total views`;
  }

  const titleYear = m.year || m.releaseInfo || '';
  document.title = `${m.name || m.title}${titleYear ? ` (${titleYear})` : ''} — Streamnaro`;

  const handleDetailBack = (e) => {
    if (e) e.preventDefault();
    goBackFromDetail();
  };
  if ($('dBackBtn')) $('dBackBtn').onclick = handleDetailBack;
  if ($('dClose')) $('dClose').onclick = handleDetailBack;

  if ($('dRight')) {
    $('dRight').innerHTML = `
      <div><b>Cast:</b> ${(m.cast || []).slice(0, 6).join(', ') || '—'}</div>
      <div style="margin-top:12px"><b>Genres:</b> ${(m.genres || []).join(', ')}</div>
      <div style="margin-top:12px"><b>This title is:</b> ${(m.genres || []).join(', ')}</div>
    `;
  }

  if ($('dAbout')) {
    $('dAbout').innerHTML = `
      <h4 style="font-size:17px;font-weight:700;margin-bottom:12px">About ${escapeHtml(m.name || m.title || '')}</h4>
      <div><span>Total Views: </span>${detailViews.toLocaleString()} (${formattedDetailViews})</div>
      <div><span>Director: </span>${escapeHtml(m.director || '—')}</div>
      <div><span>Cast: </span>${escapeHtml((m.cast || []).join(', ') || '—')}</div>
      <div><span>Genres: </span>${escapeHtml((m.genres || []).join(', '))}</div>
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

    if (!seasons.includes(targetSeason)) {
      targetSeason = seasons.includes(1) ? 1 : seasons[0];
    }
    currentDetail.ep = { s: targetSeason, e: targetEpisode };

    if ($('seasonSel')) {
      $('seasonSel').innerHTML = seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('');

      let hasScrolledFocus = false;
      const renderEps = () => {
        const s = Math.max(1, +$('seasonSel').value || targetSeason);
        currentDetail.ep.s = s;
        const list = $('epList');
        if (!list) return;
        list.innerHTML = '';

        const seasonVids = vids.filter(v => Number(v.season) === s).sort((a, b) => Number(a.episode) - Number(b.episode));
        if (seasonVids.length && seasonVids[0].episode) {
          currentDetail.ep.e = Math.max(1, Number(seasonVids[0].episode));
        }

        let matchedTargetCard = null;

        seasonVids.forEach(v => {
          const epNum = Math.max(1, Number(v.episode) || 1);
          const isTargetEpisode = shouldHighlight && (s === targetSeason && epNum === targetEpisode);
          const d = document.createElement('div');
          d.className = 'ep-card' + (isTargetEpisode ? ' ep-target-focus' : '');
          if (isTargetEpisode) {
            d.id = 'epCardFocusTarget';
            currentDetail.ep.e = epNum;
            matchedTargetCard = d;
          }
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
                <div class="ep-title-meta">
                  ${isTargetEpisode ? `<span class="ep-resume-pill"><span class="ep-resume-pulse-dot"></span>Resume S${s}:E${epNum}</span>` : ''}
                  <span class="ep-duration">${formatEpisodeRuntime(v, m)}</span>
                </div>
              </div>
              <div class="ep-desc">${(v.overview || 'No description available.').slice(0, 150)}</div>
            </div>
          `;
          const epImg = d.querySelector('.ep-thumb img');
          if (epImg) {
            epImg.onerror = function() {
              this.onerror = null;
              this.src = createPosterFallback(m.name || m.title, (m.genres && m.genres[0]) || '', m.year || m.releaseInfo || '2024', m.imdbRating || '8.2', m.type || 'series');
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
            downloadEpisode(currentDetail.meta.name || currentDetail.meta.title, s, epNum);
          };
          d.appendChild(dl);
          list.appendChild(d);
        });

        if (shouldHighlight && !hasScrolledFocus) {
          hasScrolledFocus = true;
          setTimeout(() => {
            const target = matchedTargetCard || $('epWrap');
            if (target && target.isConnected) {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              if (matchedTargetCard) {
                matchedTargetCard.classList.add('ep-motion-active');
              }
            }
          }, 300);
        }
      };
      $('seasonSel').onchange = renderEps;
      $('seasonSel').value = String(targetSeason);
      renderEps();
    }
  } else {
    if ($('epWrap')) $('epWrap').style.display = 'none';
  }

  // Wire Action Buttons immediately (0ms, no network blocking!)
  updateModalListButton(id);
  updateModalLikeButton(id);
  if ($('dList')) $('dList').onclick = () => toggleList(m);
  if ($('dLike')) $('dLike').onclick = () => toggleLike(m);
  if ($('dDl')) $('dDl').onclick = () => downloadCurrent();

  const canWatch = type === 'movie'
    ? !!MediaLinks.getMovieStreamUrl({ imdb: m.id || m.imdb_id || m.imdb, tmdbId: m.moviedb_id })
    : !!(m.moviedb_id || m.id || m.imdb_id);

  if ($('dPlay')) {
    $('dPlay').disabled = !canWatch;
    if (shouldHighlight && type === 'series') {
      $('dPlay').title = `Resume Season ${targetSeason}, Episode ${targetEpisode}`;
    } else {
      $('dPlay').title = canWatch ? 'Watch now' : 'Streaming unavailable for this title';
    }
    $('dPlay').onclick = () => playStream();
  }

  if (autoplay && canWatch) playStream();

  // Recommendations populated asynchronously
  renderDetailRecommendations(m, type);
}

async function openDetail(id, type, autoplay, continueTarget) {
  const preloadedMeta = arguments[4] || (continueTarget && continueTarget.name ? continueTarget : null);
  closeCardPortal();
  type = (type === 'series' || type === 'tv') ? 'series' : 'movie';

  if (currentRoute.page !== 'detail') {
    lastPage = currentRoute.page || 'home';
    savedPageScroll = window.scrollY || document.documentElement.scrollTop || 0;
  }
  currentRoute = { page: 'detail', id, type };

  const targetHash = `#/${type}/${encodeURIComponent(id)}`;
  if (!isHandlingHashRoute && window.location.hash !== targetHash) {
    if (window.history && window.history.pushState) {
      window.history.pushState({ page: 'detail', id, type }, '', targetHash);
    } else {
      window.location.hash = targetHash;
    }
  }

  const backdropEl = $('detailBackdrop');
  if (backdropEl) {
    backdropEl.scrollTop = 0;
    backdropEl.classList.add('show');
  }
  document.body.style.overflow = 'hidden';

  // 1. Resolve from CuratedCatalog or preloadedMeta immediately (0ms)
  let m = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(id) : null;
  if (!m && preloadedMeta && (preloadedMeta.name || preloadedMeta.title)) {
    m = preloadedMeta;
  }
  if (!m && typeof CuratedCatalog !== 'undefined' && CuratedCatalog.searchCurated) {
    const hits = CuratedCatalog.searchCurated(String(id).replace(/^(tmdb:|tt)/, ''));
    if (hits && hits.length) m = hits[0];
  }

  if (m) {
    if (m.type === 'series' || m.type === 'tv') type = 'series';
    else if (m.type === 'movie') type = 'movie';
    renderDetailUI(m, type, autoplay, continueTarget);
    enrichDetailFromCinemeta(id, type, m);
    return;
  }

  // 2. CuratedCatalog missed -> fetch Cinemeta with 4s timeout
  if ($('dTitle')) $('dTitle').textContent = 'Loading…';
  if ($('dDesc')) $('dDesc').textContent = '';

  try {
    const j = await getJSON(`${CINEMETA}/meta/${type}/${id}.json`, 4000);
    if (j && j.meta) {
      m = j.meta;
      renderDetailUI(m, type, autoplay, continueTarget);
      return;
    }
  } catch (err) {
    console.warn('Cinemeta metadata fetch failed:', err);
  }

  // 3. Resilient fallback: ensure title is playable even if network is offline
  if (!m && id) {
    const cleanId = String(id).trim();
    m = {
      id: cleanId,
      imdb_id: cleanId.startsWith('tt') ? cleanId : null,
      moviedb_id: cleanId.startsWith('tmdb:') ? cleanId.replace('tmdb:', '') : null,
      name: (preloadedMeta?.name || preloadedMeta?.title) || (cleanId.startsWith('tt') ? 'Title ' + cleanId : cleanId),
      type,
      year: '2024',
      imdbRating: '8.2',
      description: 'Stream available on high-speed servers.',
      genres: ['Action', 'Drama']
    };
    renderDetailUI(m, type, autoplay, continueTarget);
    return;
  }

  if (!m || !isCleanSafe(m)) {
    if ($('dTitle')) $('dTitle').textContent = 'Content Unavailable';
    if ($('dDesc')) $('dDesc').textContent = 'This title is not available or has been filtered for family safety.';
    if ($('crumbTitle')) $('crumbTitle').textContent = 'Unavailable';
    if ($('dBackdrop')) $('dBackdrop').src = '';
    return;
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
if (dClose) dClose.onclick = () => goBackFromDetail();

const dBackBtn = $('dBackBtn');
if (dBackBtn) dBackBtn.onclick = () => goBackFromDetail();

const detailBackdropEl = $('detailBackdrop');
if (detailBackdropEl) {
  detailBackdropEl.addEventListener('click', (e) => {
    if (e.target.id === 'detailBackdrop') {
      goBackFromDetail();
    }
  });
}

function goBackFromDetail() {
  if (window.history && window.history.length > 1 && currentRoute.page === 'detail') {
    window.history.back();
  } else {
    closeDetail(true);
  }
}

function goBackToPage(pageName) {
  closeDetail(false);
  if (pageName === 'movies' || pageName === 'series' || pageName === 'new') {
    openBrowse(pageName);
  } else {
    show(pageName || 'home');
  }
  if (pageName === 'home') {
    if (window.location.hash) {
      if (window.history && window.history.pushState) {
        window.history.pushState(null, '', window.location.pathname + window.location.search);
      } else {
        window.location.hash = '';
      }
    }
    document.title = 'Streamnaro — Watch TV Shows Online, Watch Movies Online';
  }
}

function closeDetail(syncUrl = true) {
  const bd = $('detailBackdrop');
  if (bd) bd.classList.remove('show');
  closeDownloadModal();
  document.body.style.overflow = '';
  if (currentRoute.page === 'detail') {
    currentRoute = { page: lastPage || 'home', id: null, type: null };
  }
  if (syncUrl && (window.location.hash.startsWith('#/movie/') || window.location.hash.startsWith('#/series/'))) {
    if (window.history && window.history.pushState) {
      window.history.pushState(null, '', window.location.pathname + window.location.search);
    } else {
      window.location.hash = '';
    }
  }
  if (lastPage === 'home' || !lastPage) {
    if ($('homePage')) $('homePage').style.display = '';
    document.title = 'Streamnaro — Watch TV Shows Online, Watch Movies Online';
  } else {
    const pageEl = pages[lastPage];
    if (pageEl && !pageEl.classList.contains('show')) {
      show(lastPage, null, true);
    }
  }
  if (savedPageScroll != null && savedPageScroll > 0) {
    window.scrollTo(0, savedPageScroll);
  }
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
  closeDetail(false);
  show('browse', kind);

  const titles = { movies: 'Movies', series: 'TV Shows', new: 'New & Popular' };
  if ($('browseTitle')) $('browseTitle').textContent = titles[kind] || 'Browse';
  document.title = `${titles[kind] || 'Browse'} — Streamnaro`;

  const targetHash = `#/browse/${kind}`;
  if (!isHandlingHashRoute && window.location.hash !== targetHash) {
    if (window.history && window.history.pushState) {
      window.history.pushState({ page: 'browse', kind }, '', targetHash);
    } else {
      window.location.hash = targetHash;
    }
  }

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
  const seenBrowseTitles = new Set();

  // Phase 1: Instant population from CuratedCatalog (0ms synchronous display)
  categoryRows.forEach(r => {
    const sec = $('row-' + r.id);
    if (!sec) return;
    const track = sec.querySelector('.row-track');
    let pool = [];
    if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedForCategory) {
      pool = CuratedCatalog.getCuratedForCategory(r.id) || [];
    }
    pool = dedupeMetas(pool).filter(isCleanSafe);
    if (!pool.length) {
      if (typeof CuratedCatalog !== 'undefined') {
        const fallbackList = kind === 'series'
          ? (CuratedCatalog.CURATED_SERIES || [])
          : (CuratedCatalog.CURATED_MOVIES || []);
        pool = dedupeMetas(fallbackList).filter(isCleanSafe);
      }
    }
    if (!pool.length) return;

    // Filter out any title or ID already shown in earlier rows!
    const rowSeenIds = new Set();
    const rowSeenTitles = new Set();
    let freshItems = [];
    for (const m of pool) {
      if (isCardUnseen(m, seenBrowseIds, seenBrowseTitles) && isCardUnseen(m, rowSeenIds, rowSeenTitles)) {
        freshItems.push(m);
        recordCardSeen(m, rowSeenIds, rowSeenTitles);
      }
    }

    // If freshItems is fewer than 40, pull more unseen items from CuratedCatalog for this kind
    if (freshItems.length < 40 && typeof CuratedCatalog !== 'undefined') {
      const source = kind === 'series' ? (CuratedCatalog.CURATED_SERIES || []) : (CuratedCatalog.CURATED_MOVIES || []);
      for (let i = 0; i < source.length && freshItems.length < 50; i++) {
        const cand = source[i];
        if (isCleanSafe(cand) && isCardUnseen(cand, seenBrowseIds, seenBrowseTitles) && isCardUnseen(cand, rowSeenIds, rowSeenTitles)) {
          freshItems.push(cand);
          recordCardSeen(cand, rowSeenIds, rowSeenTitles);
        }
      }
    }

    const items = dedupeMetas(freshItems).slice(0, 100);
    items.forEach(m => {
      recordCardSeen(m, seenBrowseIds, seenBrowseTitles);
      if (m && kind === 'series') m.type = 'series';
      else if (m && kind === 'movies') m.type = 'movie';
    });

    sec.style.display = '';
    track.innerHTML = '';
    items.forEach((m, idx) => track.appendChild(buildCard(m, r.badge, r.isTop10 ? idx + 1 : 0)));
    updateRowDots(sec, track);
  });

  // Phase 2: Non-blocking background enrichment with Cinemeta (parallel, bounded timeout)
  (async () => {
    for (const r of categoryRows) {
      try {
        const urls = Array.isArray(r.url) ? r.url : [r.url];
        const fetched = await Promise.all(urls.map(u => fetchCatalog(u)));
        const cinemetaMetas = fetched.flat().filter(isCleanSafe);
        if (!cinemetaMetas.length) continue;

        const sec = $('row-' + r.id);
        if (!sec) continue;
        const track = sec.querySelector('.row-track');
        if (!track) continue;

        let curated = [];
        if (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedForCategory) {
          curated = CuratedCatalog.getCuratedForCategory(r.id) || [];
        }
        let combined = dedupeMetas([...cinemetaMetas, ...curated]).filter(isCleanSafe);
        if (!combined.length) continue;

        const unseenCombined = [];
        for (const m of combined) {
          if (isCardUnseen(m, seenBrowseIds, seenBrowseTitles)) {
            unseenCombined.push(m);
            recordCardSeen(m, seenBrowseIds, seenBrowseTitles);
          }
        }
        if (!unseenCombined.length) continue;

        const items = dedupeMetas(unseenCombined).slice(0, 100);
        items.forEach(m => {
          if (m && kind === 'series') m.type = 'series';
          else if (m && kind === 'movies') m.type = 'movie';
        });

        sec.style.display = '';
        track.innerHTML = '';
        items.forEach((m, idx) => track.appendChild(buildCard(m, r.badge, r.isTop10 ? idx + 1 : 0)));
        updateRowDots(sec, track);
      } catch (e) {
        // Background enrichment error ignored - curated items remain visible
      }
    }
  })();
  // Connect infinite scrolling for full catalog beneath category rows
  browseRemoteSkip = 100;
  browseHasMore = true;
  isBrowseFetching = false;
  seenBrowseGridIds.clear();
  seenBrowseGridTitles.clear();

  const catalogSource = kind === 'series'
    ? (typeof CuratedCatalog !== 'undefined' ? (CuratedCatalog.CURATED_SERIES || []) : [])
    : (typeof CuratedCatalog !== 'undefined' ? (CuratedCatalog.CURATED_MOVIES || []) : []);

  const remainingCatalog = [];
  catalogSource.forEach(m => {
    if (isCleanSafe(m) && isCardUnseen(m, seenBrowseIds, seenBrowseTitles)) {
      remainingCatalog.push(m);
      recordCardSeen(m, seenBrowseGridIds, seenBrowseGridTitles);
    }
  });

  currentBrowseResults = remainingCatalog;
  currentBrowseOffset = 0;
  gridWrap.innerHTML = '';
  renderBrowseChunk();
  initInfiniteScrolling();
}

let currentBrowseResults = [];
let currentBrowseOffset = 0;
const BROWSE_PAGE_SIZE = 48;
let browseRemoteSkip = 0;
let isBrowseFetching = false;
let browseHasMore = true;
let seenBrowseGridIds = new Set();
let seenBrowseGridTitles = new Set();
let browseAbortCtrl = null;

let searchSentinelObserver = null;
let browseSentinelObserver = null;

function initInfiniteScrolling() {
  const searchSentinel = $('searchSentinel');
  if (searchSentinel && 'IntersectionObserver' in window) {
    if (searchSentinelObserver) searchSentinelObserver.disconnect();
    searchSentinelObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !isSearchFetching && searchHasMore) {
          fetchMoreSearchResults();
        }
      });
    }, { rootMargin: '400px' });
    searchSentinelObserver.observe(searchSentinel);
  }

  const browseSentinel = $('browseSentinel');
  if (browseSentinel && 'IntersectionObserver' in window) {
    if (browseSentinelObserver) browseSentinelObserver.disconnect();
    browseSentinelObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !isBrowseFetching && browseHasMore) {
          fetchMoreBrowseResults();
        }
      });
    }, { rootMargin: '400px' });
    browseSentinelObserver.observe(browseSentinel);
  }
}

function renderBrowseChunk() {
  const container = $('browseGrid');
  if (!container || !currentBrowseResults || !currentBrowseResults.length) return;
  const nextChunk = currentBrowseResults.slice(currentBrowseOffset, currentBrowseOffset + BROWSE_PAGE_SIZE);
  if (!nextChunk.length) return;
  nextChunk.forEach(meta => container.appendChild(buildCard(meta)));
  currentBrowseOffset += nextChunk.length;
}

async function fetchMoreBrowseResults() {
  if (isBrowseFetching || !browseHasMore) return;
  const grid = $('browseGrid');
  if (!grid || $('browsePage')?.style.display === 'none') return;

  if (currentBrowseOffset < currentBrowseResults.length) {
    renderBrowseChunk();
    return;
  }

  isBrowseFetching = true;
  const loader = $('browseLoader');
  const retryEl = $('browseRetry');
  if (loader) loader.style.display = 'flex';
  if (retryEl) retryEl.style.display = 'none';

  try {
    const type = currentBrowseKind === 'series' ? 'series' : 'movie';
    const genre = $('genreSelect')?.value || '';
    const skip = browseRemoteSkip;
    const url = genre
      ? `${type}/top/genre=${encodeURIComponent(genre)}/skip=${skip}`
      : `${type}/top/skip=${skip}`;

    const metas = await fetchCatalog(url);
    if (!metas || !metas.length) {
      const altUrl = genre
        ? `${type}/imdbRating/genre=${encodeURIComponent(genre)}/skip=${skip}`
        : `${type}/imdbRating/skip=${skip}`;
      const altMetas = await fetchCatalog(altUrl);
      if (!altMetas || !altMetas.length) {
        browseHasMore = false;
        if (loader) loader.style.display = 'none';
        isBrowseFetching = false;
        return;
      }
      metas.push(...altMetas);
    }

    browseRemoteSkip += 100;
    const safeMetas = metas.filter(isCleanSafe);
    const newItems = [];
    safeMetas.forEach(m => {
      if (m && type === 'series') m.type = 'series';
      else if (m && type === 'movie') m.type = 'movie';
      if (isCardUnseen(m, seenBrowseGridIds, seenBrowseGridTitles)) {
        newItems.push(m);
        recordCardSeen(m, seenBrowseGridIds, seenBrowseGridTitles);
      }
    });

    if (newItems.length > 0) {
      currentBrowseResults = [...currentBrowseResults, ...newItems];
      renderBrowseChunk();
    } else if (browseRemoteSkip > 1200) {
      browseHasMore = false;
    }
  } catch (err) {
    console.warn('Infinite scroll browse fetch error:', err);
    if (retryEl) retryEl.style.display = 'flex';
  } finally {
    if (loader) loader.style.display = 'none';
    isBrowseFetching = false;
  }
}

const browseRetryBtn = $('browseRetryBtn');
if (browseRetryBtn) {
  browseRetryBtn.onclick = () => {
    fetchMoreBrowseResults();
  };
}

async function filterBrowseByGenre(genre) {
  const rowsWrap = $('browseRows');
  const gridWrap = $('browseGrid');
  if (!rowsWrap || !gridWrap) return;

  if (browseAbortCtrl) {
    try { browseAbortCtrl.abort(); } catch {}
  }
  browseAbortCtrl = new AbortController();

  if (!genre) {
    gridWrap.innerHTML = '';
    currentBrowseResults = [];
    currentBrowseOffset = 0;
    await loadCategoryRows(currentBrowseKind);
    return;
  }

  rowsWrap.innerHTML = '';
  gridWrap.innerHTML = '';
  currentBrowseOffset = 0;
  browseRemoteSkip = 0;
  browseHasMore = true;
  isBrowseFetching = false;
  seenBrowseGridIds.clear();
  seenBrowseGridTitles.clear();

  const type = currentBrowseKind === 'series' ? 'series' : 'movie';
  const curatedMatches = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.CURATED_MEDIA)
    ? CuratedCatalog.CURATED_MEDIA.filter(m => m.type === type && (m.genres || []).includes(genre))
    : [];

  const initialItems = dedupeMetas(curatedMatches).filter(isCleanSafe);
  initialItems.forEach(m => recordCardSeen(m, seenBrowseGridIds, seenBrowseGridTitles));

  currentBrowseResults = initialItems;
  if (initialItems.length) {
    renderBrowseChunk();
  } else {
    gridWrap.innerHTML = skels(12);
  }

  // Non-blocking enrichment from Cinemeta
  try {
    const [p1, p2, p3] = await Promise.all([
      fetchCatalog(`${type}/top/genre=${encodeURIComponent(genre)}`),
      fetchCatalog(`${type}/top/genre=${encodeURIComponent(genre)}/skip=100`),
      fetchCatalog(`${type}/top/genre=${encodeURIComponent(genre)}/skip=200`)
    ]);
    browseRemoteSkip = 300;
    const items = dedupeMetas([...initialItems, ...p1, ...p2, ...p3]).filter(isCleanSafe);
    const fresh = [];
    items.forEach(m => {
      if (isCardUnseen(m, seenBrowseGridIds, seenBrowseGridTitles)) {
        fresh.push(m);
        recordCardSeen(m, seenBrowseGridIds, seenBrowseGridTitles);
      }
    });
    currentBrowseResults = [...initialItems, ...fresh];
    if (gridWrap.innerHTML.includes('skeleton')) {
      gridWrap.innerHTML = '';
      currentBrowseOffset = 0;
      renderBrowseChunk();
    }
  } catch (e) {
    if (!initialItems.length) {
      gridWrap.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>No titles found for ${escapeHtml(genre)}</h2></div>`;
    }
  }
  initInfiniteScrolling();
}

/* ---------- PROFILES ---------- */
function renderProfiles() {
  const av = $('avatars');
  if (!av) return;
  av.innerHTML = '';

  PROFILES.forEach(p => {
    const d = document.createElement('div');
    d.className = 'pav';
    const avatarImg = p.avatar
      ? `<img class="profile-box-img" src="${escapeHtml(p.avatar)}" alt="${escapeHtml(p.name)}" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';"><span class="profile-id-fallback" style="display:none">${escapeHtml(p.id)}</span>`
      : `<span class="profile-id-fallback">${escapeHtml(p.id)}</span>`;
    d.innerHTML = `
      <div class="box" style="background:${p.color}">
        ${avatarImg}
      </div>
      <div>${escapeHtml(p.name)}</div>
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
    const miniImg = p.avatar
      ? `<img src="${escapeHtml(p.avatar)}" alt="${escapeHtml(p.name)}" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';"><span style="display:none">${escapeHtml(p.id)}</span>`
      : `<span>${escapeHtml(p.id)}</span>`;
    item.innerHTML = `
      <div class="mini-box" style="background:${p.color}">
        ${miniImg}
      </div>
      <span style="font-size:13px;color:#fff">${escapeHtml(p.name)}</span>
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
  if (typeof p === 'string') {
    const found = PROFILES.find(x => x.id === p) || PROFILES[0];
    p = found;
  }
  if (!p || typeof p !== 'object') p = PROFILES[0];
  store.set('nf_profile_selected', true);
  store.set('nf_profile', p.id);
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.remove('profile-gate-active');
  }
  const letter = $('avatarLetter');
  if (letter) {
    if (p.avatar) {
      letter.innerHTML = `<img src="${escapeHtml(p.avatar)}" alt="${escapeHtml(p.name)}" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';"><span style="display:none">${escapeHtml(p.id)}</span>`;
    } else {
      letter.textContent = p.id;
    }
    letter.style.background = p.color;
  }
  show('home');
  buildHome();
  toast(`Welcome, ${p.name}!`);
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
    pZoneShield.style.display = 'none';
    pZoneShield.style.pointerEvents = 'none';
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
  _playerLoadSessionId++;
  _allowNavigation = true;
  stopFocusGuardian();
  disarmVidShield();
  if (typeof NHDApi !== 'undefined' && NHDApi.cancelActiveStream) {
    NHDApi.cancelActiveStream();
  }
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

  if (currentRoute.page === 'detail' && currentDetail?.meta) {
    show('detail');
  } else {
    show(lastPage || 'home');
  }
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
  hidePlayerError();
  if (typeof NHDApi !== 'undefined' && NHDApi.cancelActiveStream) {
    NHDApi.cancelActiveStream();
  }
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
  if ($('pNextTop')) $('pNextTop').style.display = 'none';

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
  const isServer2 = (currentPlayerServer === 'server2' || currentPlayerServer === 'nhdapi');
  let url = null;
  if (isServer2) {
    if (tmdbId) {
      url = MediaLinks.getNhdApiMovieUrl ? MediaLinks.getNhdApiMovieUrl(tmdbId) : `https://nhdapi.com/movie/${tmdbId}`;
    } else {
      url = MediaLinks.getMovieStreamUrl({ imdb, tmdbId }, 'server1');
    }
  } else {
    url = MediaLinks.getMovieStreamUrl({ imdb, tmdbId }, currentPlayerServer);
  }
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
  const isServer2 = (currentPlayerServer === 'server2' || currentPlayerServer === 'nhdapi');
  let url = null;
  if (isServer2) {
    if (tmdbId) {
      url = MediaLinks.getNhdApiEpisodeUrl ? MediaLinks.getNhdApiEpisodeUrl(tmdbId, s, ep) : `https://nhdapi.com/tv/${tmdbId}?season=${s}&episode=${ep}`;
    } else {
      url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, 'server1');
    }
  } else {
    url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, currentPlayerServer);
  }
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

  const cleanId = String(o.id || o.imdb || o.tmdbId || '').replace(/^tmdb:/, '');
  const curMedia = (typeof CuratedCatalog !== 'undefined')
    ? (CuratedCatalog.getCuratedById(cleanId) || CuratedCatalog.getCuratedById(o.imdb) || CuratedCatalog.getCuratedById(o.tmdbId) || (o.title ? CuratedCatalog.searchCurated(o.title)[0] : null))
    : null;
  const resolvedPoster = o.poster || existing.poster || curMedia?.poster || '';
  const resolvedBg = o.background || existing.background || curMedia?.background || resolvedPoster || '';

  history[key] = {
    ...existing,
    progress: safeProg,
    finished: false,
    type: o.type || existing.type || (curMedia?.type || 'movie'),
    title: o.title || existing.title || curMedia?.name || 'Title',
    poster: resolvedPoster,
    background: resolvedBg,
    tmdbId: o.tmdbId || existing.tmdbId || curMedia?.moviedb_id,
    imdb: o.imdb || existing.imdb || (typeof key === 'string' && key.startsWith('tt') ? key : curMedia?.imdb_id || null),
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
      u.searchParams.set('autoplay', '1');
      if (url.includes('/tv/') || (currentEmbed && currentEmbed.type === 'series')) {
        u.searchParams.set('autonext', '1');
      }
    }
    return u.toString();
  } catch {
    if (!lang || lang === 'off') return url;
    const isTv = url.includes('/tv/') || (currentEmbed && currentEmbed.type === 'series');
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}sub=${encodeURIComponent(target)}&subtitles=${encodeURIComponent(target)}&sub_lang=${encodeURIComponent(target)}&lang=${encodeURIComponent(target)}&default_sub=${encodeURIComponent(target)}&caption=${encodeURIComponent(target)}&cc=1&sub_language=${encodeURIComponent(label)}&ds_lang=${encodeURIComponent(target)}&autoplay=1${isTv ? '&autonext=1' : ''}`;
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

let currentNhdSubtitles = [];

function populateNhdSubtitlesUI(subs) {
  if (!Array.isArray(subs) || subs.length === 0) return;
  const select = $('captionModalLangSelect');
  const customSelect = $('playerCustomSubLangSelect');
  if (!select && !customSelect) return;

  const currentLang = store.get('nf_sub_lang', 'ar') || 'ar';
  const seenLangs = new Set();
  const options = [];

  for (const s of subs) {
    const code = s.lang || 'en';
    if (!seenLangs.has(code)) {
      seenLangs.add(code);
      options.push({ code, label: s.label || code });
    }
  }

  const renderToSelect = (selEl) => {
    if (!selEl) return;
    for (const opt of options) {
      if (!selEl.querySelector(`option[value="${opt.code}"]`)) {
        const o = document.createElement('option');
        o.value = opt.code;
        o.textContent = opt.label;
        selEl.appendChild(o);
      }
    }
    selEl.value = currentLang;
  };

  renderToSelect(select);
  renderToSelect(customSelect);
}

async function startNhdApiSession(coords) {
  const { tmdbId, type, season, episode } = coords;
  if (!tmdbId || typeof NHDApi === 'undefined') return;

  try {
    const subs = await NHDApi.fetchSubtitles({ tmdbId, type, season, episode });
    if (Array.isArray(subs) && subs.length > 0) {
      currentNhdSubtitles = subs;
      populateNhdSubtitlesUI(subs);
    }
  } catch (err) {
    console.warn('[NHDApi] Subtitles fetch non-critical error:', err);
  }

  try {
    await NHDApi.fetchStream({
      tmdbId,
      type,
      season,
      episode,
      onMeta: (meta) => {
        if (currentEmbed && meta) {
          currentEmbed.nhdMeta = meta;
        }
      },
      onSource: (source) => {
        if (currentEmbed) {
          if (!currentEmbed.nhdSources) currentEmbed.nhdSources = [];
          currentEmbed.nhdSources.push(source);
        }
      },
      onDone: (data) => {
        if (currentEmbed) {
          currentEmbed.nhdSources = data.sources || [];
        }
      },
      onError: (err) => {
        console.warn('[NHDApi] SSE stream error (fallback iframe remains active):', err);
      }
    });
  } catch (err) {
    console.warn('[NHDApi] Stream error:', err);
  }
}

function updatePlayerServerUI() {
  const lbl = $('pServerLabel');
  const btn = $('pServerTop');
  const sel = $('playerServerSelect');
  const isServer2 = (currentPlayerServer === 'server2' || currentPlayerServer === 'nhdapi');
  if (lbl) {
    lbl.textContent = isServer2 ? 'Server 2 (Fast)' : 'Server 1 (HD)';
  }
  if (btn) {
    btn.setAttribute('data-server', isServer2 ? 'server2' : 'server1');
    btn.title = isServer2
      ? 'Watching Server: Server 2: Fast Mirror Stream (NHDApi)'
      : 'Watching Server: Server 1: High Definition Stream (Vidapi)';
  }
  if (sel) {
    sel.value = isServer2 ? 'server2' : 'server1';
  }
}

const WORKER_PROXY_BASE = 'https://adsclear.yassine-hzami.workers.dev/?url=';

function getWorkerProxyUrl(originalUrl) {
  if (!originalUrl) return '';
  return `${WORKER_PROXY_BASE}${encodeURIComponent(originalUrl)}`;
}

let _playerLoadSessionId = 0;

async function checkWorkerStreamAvailability(workerUrl) {
  try {
    let signal = null;
    let timer = null;
    let controller = null;

    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      signal = AbortSignal.timeout(3000);
    } else if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      signal = controller.signal;
      timer = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, 3000);
    }

    const res = await fetch(workerUrl, {
      method: 'GET',
      signal
    });
    if (timer) clearTimeout(timer);
    return !!(res && res.status === 200);
  } catch (err) {
    console.warn('[StreamProxy] Worker pre-check failed or timed out:', err?.message || err);
    return false;
  }
}

function togglePlayerServer() {
  const next = (currentPlayerServer === 'server2' || currentPlayerServer === 'nhdapi') ? 'server1' : 'server2';
  switchPlayerServer(next);
}

async function switchPlayerServer(newServer) {
  const isServer2 = (newServer === 'server2' || newServer === 'nhdapi');
  currentPlayerServer = isServer2 ? 'server2' : 'server1';
  store.set('nf_player_server', currentPlayerServer);
  updatePlayerServerUI();

  const iframe = $('playerView')?.querySelector('iframe');
  if (!iframe || !currentEmbed) return;

  if (typeof NHDApi !== 'undefined' && NHDApi.cancelActiveStream) {
    NHDApi.cancelActiveStream();
  }

  let newBaseUrl = null;
  const isSeries = currentEmbed.type === 'series';
  const tmdbId = currentEmbed.tmdbId || ((typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(currentEmbed.id || currentEmbed.imdb)?.moviedb_id : null);
  const imdb = currentEmbed.imdb || ((currentEmbed.id || '').startsWith('tt') ? currentEmbed.id : null);

  if (isServer2) {
    if (!tmdbId) {
      toast('Server 2 (NHDApi) unavailable for this title (requires TMDB ID)');
      return;
    }
    if (isSeries) {
      const s = currentEmbed.season || 1;
      const ep = currentEmbed.episode || 1;
      newBaseUrl = MediaLinks.getNhdApiEpisodeUrl ? MediaLinks.getNhdApiEpisodeUrl(tmdbId, s, ep) : `https://nhdapi.com/tv/${tmdbId}?season=${s}&episode=${ep}`;
    } else {
      newBaseUrl = MediaLinks.getNhdApiMovieUrl ? MediaLinks.getNhdApiMovieUrl(tmdbId) : `https://nhdapi.com/movie/${tmdbId}`;
    }
  } else {
    // Server 1
    if (isSeries) {
      newBaseUrl = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, currentEmbed.season || 1, currentEmbed.episode || 1, 'server1');
    } else {
      newBaseUrl = MediaLinks.getMovieStreamUrl({ imdb, tmdbId }, 'server1');
    }
  }

  if (!newBaseUrl) {
    toast('Server switch unavailable for this title');
    return;
  }

  const targetSub = store.get('nf_sub_lang', 'ar');
  const originalStreamUrl = isServer2 ? newBaseUrl : updateSubtitleUrlParam(newBaseUrl, targetSub);
  currentEmbed.url = originalStreamUrl;
  currentEmbed.server = currentPlayerServer;
  if (tmdbId) currentEmbed.tmdbId = tmdbId;

  toast(isServer2
    ? 'Watching Server: Server 2 (NHDApi Fast Stream)'
    : 'Watching Server: Server 1 (High Definition Stream)'
  );

  armVidShield();

  const sessionId = ++_playerLoadSessionId;
  const workerUrl = getWorkerProxyUrl(originalStreamUrl);
  const isWorkerOk = await checkWorkerStreamAvailability(workerUrl);

  if (sessionId !== _playerLoadSessionId || !$('playerView')?.classList.contains('show')) {
    return;
  }

  const finalUrl = isWorkerOk ? workerUrl : originalStreamUrl;
  iframe.src = finalUrl;
  if (isWorkerOk) {
    iframe.setAttribute('credentialless', '');
    try { iframe.credentialless = true; } catch {}
  } else {
    iframe.removeAttribute('credentialless');
  }
  iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');

  if (isServer2) {
    startNhdApiSession({
      tmdbId,
      type: currentEmbed.type,
      season: currentEmbed.season,
      episode: currentEmbed.episode
    });
  } else {
    const sendSubCmd = () => {
      dispatchSubtitlesToPlayer(targetSub);
    };
    sendSubCmd();
    setTimeout(sendSubCmd, 250);
    setTimeout(sendSubCmd, 600);
    setTimeout(sendSubCmd, 1500);
  }
}

function applySubtitleToActivePlayer(lang) {
  const targetSub = lang || store.get('nf_sub_lang', 'ar');
  store.set('nf_sub_lang', targetSub);
  updateSubtitleUI();
  dispatchSubtitlesToPlayer(targetSub);
  const iframe = $('playerView')?.querySelector('iframe');
  if (!iframe || !currentEmbed || !currentEmbed.url) return;
  const isServer2 = (currentEmbed.server === 'server2' || currentEmbed.server === 'nhdapi');
  if (!isServer2) {
    const newUrl = updateSubtitleUrlParam(currentEmbed.url, targetSub);
    currentEmbed.url = newUrl;
    const isCurrentlyProxied = iframe.hasAttribute('credentialless') || (iframe.src || '').includes('adsclear.yassine-hzami.workers.dev');
    const finalUrl = isCurrentlyProxied ? getWorkerProxyUrl(newUrl) : newUrl;
    if (iframe.src !== finalUrl) {
      iframe.src = finalUrl;
    }
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
  try { f.contentWindow?.postMessage({ type: 'STORAGE_SET', key: 'shown_at', value: String(Date.now() + 3153600000000) }, '*'); } catch {}
  try { f.contentWindow?.postMessage({ type: 'STORAGE_SET', key: 'unloaded_at', value: String(Date.now() + 3153600000000) }, '*'); } catch {}
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

async function playEmbed(o) {
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

  const pNextBtn = $('pNextTop');
  if (pNextBtn) {
    if (o.type === 'series') {
      pNextBtn.style.display = 'inline-flex';
      const curEp = Number(o.episode || 1);
      pNextBtn.title = `Next: Episode ${curEp + 1}`;
    } else {
      pNextBtn.style.display = 'none';
    }
  }

  const isServer2 = (currentPlayerServer === 'server2' || currentPlayerServer === 'nhdapi');
  const targetSub = store.get('nf_sub_lang', 'ar');
  const originalStreamUrl = isServer2 ? o.url : updateSubtitleUrlParam(o.url, targetSub);
  currentEmbed.url = originalStreamUrl;

  const oldIframe = $('playerView')?.querySelector('iframe');
  if (oldIframe) oldIframe.remove();

  const sessionId = ++_playerLoadSessionId;

  // Automatic pre-check before rendering iframe: test Worker URL with 3-second timeout
  const workerUrl = getWorkerProxyUrl(originalStreamUrl);
  const isWorkerOk = await checkWorkerStreamAvailability(workerUrl);

  if (sessionId !== _playerLoadSessionId || !$('playerView')?.classList.contains('show')) {
    return;
  }

  const finalUrl = isWorkerOk ? workerUrl : originalStreamUrl;

  const f = document.createElement('iframe');
  f.src = finalUrl;
  f.allowFullscreen = true;
  f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
  f.setAttribute('referrerpolicy', 'origin');
  if (isWorkerOk) {
    f.setAttribute('credentialless', '');
    try { f.credentialless = true; } catch {}
  }
  f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;z-index:1';
  $('playerView').insertBefore(f, $('pTop'));
  armVidShield();

  if (isServer2) {
    const tmdbId = o.tmdbId || ((typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(o.id || o.imdb)?.moviedb_id : null);
    if (tmdbId) {
      startNhdApiSession({
        tmdbId,
        type: o.type,
        season: o.season,
        episode: o.episode
      });
    }
  } else {
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
}

function playEmbedEntry(m) {
  const ids = resolveMediaIdentifiers(m);
  const isServer2 = (currentPlayerServer === 'server2' || currentPlayerServer === 'nhdapi');
  if (m.type === 'series') {
    const tmdbId = ids.tmdbId || m.tmdbId || m.moviedb_id;
    const imdb = ids.imdb || m.imdb;
    if (!tmdbId && !imdb) { toast('Streaming unavailable (missing ID).'); return; }
    const s = Math.max(1, Number(m.season || 1));
    const ep = Math.max(1, Number(m.episode || 1));
    let url = null;
    if (isServer2) {
      if (tmdbId) {
        url = MediaLinks.getNhdApiEpisodeUrl ? MediaLinks.getNhdApiEpisodeUrl(tmdbId, s, ep) : `https://nhdapi.com/tv/${tmdbId}?season=${s}&episode=${ep}`;
      } else {
        url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, 'server1');
      }
    } else {
      url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, currentPlayerServer);
    }
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
  let url = null;
  if (isServer2) {
    if (tmdbId) {
      url = MediaLinks.getNhdApiMovieUrl ? MediaLinks.getNhdApiMovieUrl(tmdbId) : `https://nhdapi.com/movie/${tmdbId}`;
    } else {
      url = MediaLinks.getMovieStreamUrl({ imdb, tmdbId }, 'server1');
    }
  } else {
    url = MediaLinks.getMovieStreamUrl({ imdb, tmdbId }, currentPlayerServer);
  }
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

const EMBED_ORIGINS = ['https://vaplayer.ru', 'https://vidapi.ru', 'https://vidsrc.sh', 'https://nextgencloudfabric.com', 'https://nhdapi.com', 'https://adsclear.yassine-hzami.workers.dev'];
function readProgressStore() {
  try { return JSON.parse(localStorage.getItem('vidsrcProgress') || localStorage.getItem('vidLinkProgress') || '{}'); }
  catch { return {}; }
}

function historyItems() {
  return Object.entries(history)
    .sort(([, a], [, b]) => (b.lastWatched || 0) - (a.lastWatched || 0))
    .map(([id, h]) => {
      let resolvedPoster = h.poster || '';
      let resolvedBg = h.background || '';
      let resolvedTitle = h.title || h.name || 'Title';
      let resolvedType = h.type || 'movie';
      let resolvedGenres = h.genres || [];
      let resolvedYear = h.year || '';

      if (typeof CuratedCatalog !== 'undefined') {
        const cleanId = String(id).replace(/^tmdb:/, '');
        const cur = (CuratedCatalog.getCuratedById && (CuratedCatalog.getCuratedById(id) || CuratedCatalog.getCuratedById(cleanId) || CuratedCatalog.getCuratedById(h.imdb) || CuratedCatalog.getCuratedById(h.tmdbId)))
          || (CuratedCatalog.searchCurated && resolvedTitle !== 'Title' ? CuratedCatalog.searchCurated(resolvedTitle)[0] : null);

        if (cur) {
          if (!resolvedPoster) resolvedPoster = cur.poster || '';
          if (!resolvedBg) resolvedBg = cur.background || cur.poster || '';
          if (resolvedTitle === 'Title' && cur.name) resolvedTitle = cur.name;
          if (cur.type) resolvedType = cur.type;
          if (!resolvedGenres.length && cur.genres) resolvedGenres = cur.genres;
          if (!resolvedYear && cur.year) resolvedYear = cur.year;
        }
      }

      if (!resolvedBg && resolvedPoster) resolvedBg = resolvedPoster;
      if (!resolvedPoster && resolvedBg) resolvedPoster = resolvedBg;

      const isSeries = (resolvedType === 'series' || h.type === 'series' || h.type === 'tv');
      const isFinished = isSeries
        ? !!h.finished
        : !!(h.finished || (h.progress != null && h.progress >= 0.9));

      return {
        id,
        type: resolvedType,
        name: resolvedTitle,
        title: resolvedTitle,
        poster: resolvedPoster,
        background: resolvedBg,
        genres: resolvedGenres,
        year: resolvedYear,
        _progress: h.progress,
        _finished: isFinished,
        _embed: !!h._embed,
        tmdbId: h.tmdbId,
        imdb: h.imdb || (id.startsWith('tt') ? id : null),
        season: h.season,
        episode: h.episode
      };
    });
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
      updateRowDots(cSec, track);
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
      updateRowDots(fSec, track);
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
    const key = `tmdb:${entry.id}`;
    const cleanId = String(entry.id).replace(/^tmdb:/, '');

    const existingKey = Object.keys(history).find(k => k === key || k === cleanId || k === `tmdb:${cleanId}` || history[k].tmdbId === entry.id || (entry.imdb && history[k].imdb === entry.imdb));
    const existing = existingKey ? history[existingKey] : {};

    const curMedia = (typeof CuratedCatalog !== 'undefined')
      ? (CuratedCatalog.getCuratedById(cleanId) || CuratedCatalog.getCuratedById(entry.imdb) || (entry.title ? CuratedCatalog.searchCurated(entry.title)[0] : null))
      : null;

    const isSeries = (entry.type === 'tv' || curMedia?.type === 'series' || existing.type === 'series');
    const isFinished = !isSeries && (p >= 0.9);

    const posterUrl = entry.poster || (entry.poster_path ? `https://image.tmdb.org/t/p/w500${entry.poster_path}` : '') || existing.poster || curMedia?.poster || '';
    const bgUrl = entry.background || existing.background || curMedia?.background || posterUrl || '';
    const resolvedTitle = entry.title || existing.title || curMedia?.name || 'Title';

    history[key] = {
      ...existing,
      progress: isFinished ? 1.0 : p,
      finished: isSeries ? !!existing.finished : isFinished,
      type: isSeries ? 'series' : 'movie',
      title: resolvedTitle,
      poster: posterUrl,
      background: bgUrl,
      tmdbId: entry.id,
      imdb: entry.imdb || existing.imdb || curMedia?.imdb_id || null,
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

function getNextEpisodeCoords(item, curS, curEp) {
  let s = Math.max(1, Number(curS || 1));
  let ep = Math.max(1, Number(curEp || 1)) + 1;

  if (item && item.videos && item.videos.length > 0) {
    const hasCurEp = item.videos.some(v => Number(v.season) === s && Number(v.episode) === ep);
    if (!hasCurEp) {
      const hasNextSeasonEp1 = item.videos.some(v => Number(v.season) === s + 1 && Number(v.episode) === 1);
      if (hasNextSeasonEp1) {
        return { season: s + 1, episode: 1, isFinale: false };
      }
      return { season: s, episode: Number(curEp || 1), isFinale: true };
    }
    return { season: s, episode: ep, isFinale: false };
  }

  const cleanId = String(item?.id || item?.imdb || '').split(':')[0].trim();
  const canon = (typeof CuratedCatalog !== 'undefined') ? CuratedCatalog.CANONICAL_SERIES_METRICS?.[cleanId] : null;
  const maxSeasons = canon ? canon.seasonsCount : (Number(item?.seasonsCount) || 3);
  const maxEps = canon ? canon.epsPerSeason : (Number(item?.epsPerSeason) || 10);

  if (ep > maxEps) {
    if (s < maxSeasons) {
      return { season: s + 1, episode: 1, isFinale: false };
    }
    return { season: s, episode: Number(curEp || 1), isFinale: true };
  }
  return { season: s, episode: ep, isFinale: false };
}

function advanceSeriesInHistory(e) {
  if (!e) return null;
  const tmdbId = e.tmdbId || ((typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(e.id || e.imdb)?.moviedb_id : null);
  const cleanId = String(e.id || e.imdb || tmdbId || '').replace(/^tmdb:/, '');
  const curMedia = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(cleanId || e.imdb || tmdbId) : null;
  const key = e.tmdbId ? `tmdb:${e.tmdbId}` : (e.id || e.imdb || `series:${e.title}`);

  const curS = Math.max(1, Number(e.season || 1));
  const curEp = Math.max(1, Number(e.episode || 1));
  const nextInfo = getNextEpisodeCoords(curMedia || e, curS, curEp);

  const existingKey = Object.keys(history).find(k => k === key || k === cleanId || k === `tmdb:${cleanId}` || history[k].tmdbId === e.tmdbId || (e.imdb && history[k].imdb === e.imdb));
  const existing = existingKey ? history[existingKey] : {};

  if (nextInfo.isFinale) {
    history[key] = {
      ...existing,
      season: nextInfo.season,
      episode: nextInfo.episode,
      progress: 1.0,
      finished: true,
      lastWatched: Date.now()
    };
  } else {
    history[key] = {
      ...existing,
      season: nextInfo.season,
      episode: nextInfo.episode,
      progress: 0.0,
      finished: false,
      lastWatched: Date.now()
    };
  }
  store.set('nf_history', history);
  renderContinueRow();
  return nextInfo;
}

function nextEpisode() {
  if ($('nextEp')) $('nextEp').style.display = 'none';
  const e = currentEmbed;
  if (e?.type === 'series') {
    const tmdbId = e.tmdbId || ((typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(e.id || e.imdb)?.moviedb_id : null);
    const imdb = e.imdb;
    if (!tmdbId && !imdb) { toast('Streaming unavailable for next episode.'); return; }
    const cleanId = String(e.id || imdb || tmdbId || '').replace(/^tmdb:/, '');
    const curMedia = (typeof CuratedCatalog !== 'undefined' && CuratedCatalog.getCuratedById) ? CuratedCatalog.getCuratedById(cleanId || imdb || tmdbId) : null;

    const curS = Math.max(1, Number(e.season || 1));
    const curEp = Math.max(1, Number(e.episode || 1));
    const nextInfo = getNextEpisodeCoords(curMedia || e, curS, curEp);
    const s = nextInfo.season;
    const ep = nextInfo.episode;

    if (nextInfo.isFinale && s === curS && ep === curEp) {
      toast('Series completed! Finished watching all episodes.');
      return;
    }

    toast(`Loading Season ${s} Episode ${ep}…`);
    const isServer2 = (currentPlayerServer === 'server2' || currentPlayerServer === 'nhdapi');
    let url = null;
    if (isServer2) {
      url = (tmdbId && MediaLinks.getNhdApiEpisodeUrl) ? MediaLinks.getNhdApiEpisodeUrl(tmdbId, s, ep) : MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, currentPlayerServer);
    } else {
      url = MediaLinks.getEpisodeStreamUrl({ tmdbId, imdb }, s, ep, currentPlayerServer);
    }
    if (url) {
      playEmbed({ ...e, url, tmdbId, imdb, season: s, episode: ep, server: currentPlayerServer });
    } else {
      toast('Streaming unavailable for next episode.');
    }
  }
}

const nextPlay = $('nextPlay');
if (nextPlay) nextPlay.onclick = nextEpisode;

const pNextTop = $('pNextTop');
if (pNextTop) {
  pNextTop.onclick = (ev) => {
    if (ev) ev.stopPropagation();
    nextEpisode();
  };
}

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
    urlStr.includes('strem.io') ||
    urlStr.includes('t.me/blackroner') ||
    urlStr.includes('telegram.me/blackroner')
  ) {
    return _nativeWindowOpen.call(window, url, target, features);
  }
  if (urlStr.includes('t.me') || urlStr.includes('telegram.me') || urlStr.includes('NOWHDTVUPDATE')) {
    console.log('[Telegram] Redirecting unauthorized Telegram link to https://t.me/blackroner');
    return _nativeWindowOpen.call(window, 'https://t.me/blackroner', target || '_blank', features || 'noopener,noreferrer');
  }
  console.warn('[AdBlock] Blocked unauthorized window.open popup attempt:', url);
  return null;
};
try { Window.prototype.open = window.open; } catch {}
try { window.open = window.open; } catch {}
try { self.open = window.open; } catch {}
try { top.open = window.open; } catch {}
try { parent.open = window.open; } catch {}
try { Object.defineProperty(window, 'open', { value: window.open, writable: false, configurable: false }); } catch {}
try { Object.defineProperty(self, 'open', { value: window.open, writable: false, configurable: false }); } catch {}


// Intercept programmatic anchor clicks targeting _blank or _top
const _nativeAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function() {
  const href = String(this.href || '');
  const target = String(this.target || '');
  if (target === '_blank' || target === '_top') {
    if (href.includes('t.me/blackroner') || href.includes('telegram.me/blackroner')) {
      return _nativeAnchorClick.apply(this, arguments);
    }
    if (href.includes('t.me') || href.includes('telegram.me') || href.includes('NOWHDTVUPDATE')) {
      this.href = 'https://t.me/blackroner';
      return _nativeAnchorClick.apply(this, arguments);
    }
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
      if (href.includes('t.me/blackroner') || href.includes('telegram.me/blackroner')) {
        return _nativeAnchorDispatch.apply(this, arguments);
      }
      if (href.includes('t.me') || href.includes('telegram.me') || href.includes('NOWHDTVUPDATE')) {
        this.href = 'https://t.me/blackroner';
        return _nativeAnchorDispatch.apply(this, arguments);
      }
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
        if (href.includes('t.me') || href.includes('telegram.me') || href.includes('NOWHDTVUPDATE')) {
          if (!href.includes('blackroner')) {
            a.setAttribute('href', 'https://t.me/blackroner');
          }
          return;
        }
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
    // High-speed liveness check: if active document lost system visibility to an unwanted pop-under tab, snap back at light speed!
    const isHidden = document.hidden || (typeof document.visibilityState === 'string' && document.visibilityState === 'hidden');
    if (isHidden) {
      triggerLightSpeedFocusSnap();
    }
    _lastActiveElement = document.activeElement;
  }, 50);
}

function stopFocusGuardian() {
  if (_focusGuardian) {
    clearInterval(_focusGuardian);
    _focusGuardian = null;
  }
}

const _handleFocusLossOrVisibility = (e) => {
  if ($('playerView')?.classList.contains('show') && !_allowNavigation) {
    const isHidden = document.hidden || (typeof document.visibilityState === 'string' && document.visibilityState === 'hidden');
    if (isHidden || e?.type === 'pagehide' || e?.type === 'visibilitychange') {
      snapWindowFocus();
      clearTimeout(_focusSnapTimer);
      _focusSnapTimer = setTimeout(snapWindowFocus, 10);
      setTimeout(snapWindowFocus, 25);
      setTimeout(snapWindowFocus, 45);
      setTimeout(snapWindowFocus, 120);
      setTimeout(snapWindowFocus, 300);
      setTimeout(snapWindowFocus, 600);
    }
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
  if (shield) {
    shield.style.display = 'none';
    shield.style.pointerEvents = 'none';
  }
  const zoneShield = $('pControlZoneShield');
  if (zoneShield) {
    zoneShield.style.display = 'none';
    zoneShield.style.pointerEvents = 'none';
  }
  clearTimeout(shieldDisarmTimer);
}

function armVidShield() {
  let shield = $('vidShield');
  if (!shield) {
    shield = document.createElement('div');
    shield.id = 'vidShield';
    $('playerView')?.insertBefore(shield, $('pTop'));
  }
  if (shield) {
    shield.style.display = 'block';
    shield.style.pointerEvents = 'auto';

    const handleShieldTap = (e) => {
      if (e) {
        try { e.preventDefault(); } catch {}
        try { e.stopPropagation(); } catch {}
      }
      shield.style.display = 'none';
      shield.style.pointerEvents = 'none';
      clearTimeout(shieldDisarmTimer);
    };

    shield.onclick = handleShieldTap;
    shield.ontouchend = handleShieldTap;
    shield.onpointerdown = (e) => {
      try { e.stopPropagation(); } catch {}
      handleShieldTap(e);
    };
  }
  const zoneShield = $('pControlZoneShield');
  if (zoneShield) {
    zoneShield.style.display = 'none';
    zoneShield.style.pointerEvents = 'none';
  }
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
    const futureTime = String(Date.now() + 3153600000000);
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
          cc_lang: targetSub,
          shown_at: futureTime,
          unloaded_at: futureTime
        }
      }, '*');
    } catch {}
  } else if (msg.type === 'PLAYER_EVENT' || msg.event === 'ended' || msg.type === 'ended' || msg.type === 'PLAYER_ENDED') {
    const d = msg.data || msg || {};
    if (d.player_status === 'completed' || d.event === 'ended' || d.event === 'completed' || msg.event === 'ended' || msg.type === 'ended') {
      const e = currentEmbed;
      if (e) {
        if (e.type === 'series') {
          const nextInfo = advanceSeriesInHistory(e);
          if (nextInfo && !nextInfo.isFinale) {
            toast('Autoplaying next episode…');
            setTimeout(nextEpisode, 500);
          } else {
            toast('Series completed!');
          }
        } else {
          const key = e.imdb || e.id || (e.tmdbId ? `tmdb:${e.tmdbId}` : null);
          recordWatchFinish(key);
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
          poster: currentEmbed?.poster || '',
          background: currentEmbed?.background || currentEmbed?.poster || '',
          poster_path: pInfo?.poster_path || currentEmbed?.poster_path || '',
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
    const avatarImg = p.avatar
      ? `<img class="profile-box-img" src="${escapeHtml(p.avatar)}" alt="${escapeHtml(p.name)}" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';"><span class="profile-id-fallback" style="display:none">${escapeHtml(p.id)}</span>`
      : `<span class="profile-id-fallback">${escapeHtml(p.id)}</span>`;
    d.innerHTML = `
      <div class="box" style="background:${p.color}">
        ${avatarImg}
      </div>
      <div>${escapeHtml(p.name)}</div>
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
    if (input.id === 'searchInput') {
      if (q.length < 2) {
        closeSearchDropdown();
        return;
      }
      liveT = setTimeout(() => {
        updateSearchDropdown(q);
      }, 300);
    } else if (input.id === 'searchBox') {
      if (q.length < 2) return;
      liveT = setTimeout(() => {
        doSearch(q);
      }, 350);
    } else {
      if (q.length < 2) return;
      liveT = setTimeout(() => {
        if (box) box.value = q;
        doSearch(q);
      }, 350);
    }
  });
}

/* ---------- ESCAPE KEY & INIT ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeSearchDropdown();
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

// Initialize app: check if first-time visitor needs profile selection gate
const isProfileSelected = !!store.get('nf_profile_selected', false);
const hasSpecificRoute = window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#/home';

if (!isProfileSelected && !hasSpecificRoute) {
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.add('profile-gate-active');
  }
  show('profiles');
} else {
  show('home');
}
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
  if (activeProf.avatar) {
    letterEl.innerHTML = `<img src="${escapeHtml(activeProf.avatar)}" alt="${escapeHtml(activeProf.name)}" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';"><span style="display:none">${escapeHtml(activeProf.id)}</span>`;
  } else {
    letterEl.textContent = activeProf.id;
  }
  letterEl.style.background = activeProf.color;
}

/* ---------- ROUTE & DEEP LINK HANDLER ---------- */
function handleRouteFromHash() {
  const rawHash = (window.location.hash || '').trim();
  const hash = rawHash.replace(/^#\/?/, '');
  if (!hash || hash === 'home' || hash === '/') {
    if (currentRoute.page === 'detail') {
      closeDetail(false);
      show('home');
      document.title = 'Streamnaro — Watch TV Shows Online, Watch Movies Online';
    }
    return;
  }
  const parts = hash.split('/').map(decodeURIComponent);
  const routeType = parts[0];
  const routeId = parts.slice(1).join('/');

  if ((routeType === 'movie' || routeType === 'series') && routeId) {
    if (!currentDetail || currentDetail.meta?.id !== routeId || currentRoute.page !== 'detail') {
      isHandlingHashRoute = true;
      openDetail(routeId, routeType, false).finally(() => {
        isHandlingHashRoute = false;
      });
    }
  } else if (routeType === 'movies' || (routeType === 'browse' && routeId === 'movies')) {
    openBrowse('movies');
  } else if (routeType === 'series' || (routeType === 'browse' && routeId === 'series')) {
    openBrowse('series');
  } else if (routeType === 'new' || (routeType === 'browse' && routeId === 'new')) {
    openBrowse('new');
  } else if (routeType === 'search') {
    show('search');
    document.title = 'Search — Streamnaro';
  } else if (routeType === 'mylist') {
    show('mylist');
    renderMyList();
    document.title = 'My List — Streamnaro';
  } else if (routeType === 'settings') {
    show('settings');
    renderAddons();
    document.title = 'Settings — Streamnaro';
  }
}

window.addEventListener('popstate', () => {
  handleRouteFromHash();
});
window.addEventListener('hashchange', () => {
  handleRouteFromHash();
});

if (window.location.hash) {
  setTimeout(() => {
    handleRouteFromHash();
  }, 100);
}
