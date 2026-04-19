/* ============================================================
   PigTrack — app.js
   Talks to Flask backend at BASE_URL
   ============================================================ */

const BASE_URL = 'https://pigo-care-backend.onrender.com';

/* ── API KEY ─────────────────────────────────────────────────
   Shared secret sent as the x-api-key header on every request.
   Must match the API_KEY environment variable on the backend.
   ──────────────────────────────────────────────────────────── */
const API_KEY = 'pigocare2024';

/* ── UTILITIES ──────────────────────────────────────────────── */

function $(id) { return document.getElementById(id); }
function $qs(sel, ctx = document) { return ctx.querySelector(sel); }

function showToast(msg, type = 'info', duration = 3200) {
  const tc = $('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-dot"></span><span>${msg}</span>`;
  tc.appendChild(t);
  setTimeout(() => {
    t.classList.add('hiding');
    setTimeout(() => t.remove(), 220);
  }, duration);
}

function fmtDate(str) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return str; }
}

function calculateAge(str) {
  if (!str) return '';
  const dob = new Date(str);
  if (isNaN(dob.getTime())) return '';
  const now = new Date();
  
  let years = now.getFullYear() - dob.getFullYear();
  let months = now.getMonth() - dob.getMonth();
  
  if (now.getDate() < dob.getDate()) {
    months--;
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  
  if (years < 0) return '';
  
  let parts = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  
  if (parts.length === 0) {
    let diff = now - dob;
    let days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days >= 0) {
      parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    } else {
      return '';
    }
  }
  
  return ` (${parts.join(', ')})`;
}

/* ── NAVIGATION ─────────────────────────────────────────────── */

const views = {
  registry: { view: $('view-registry'), nav: $('nav-registry'), title: 'Pig DataBase' },
  register: { view: $('view-register'), nav: $('nav-register'), title: 'Register New Pig' },
  search: { view: $('view-search'), nav: $('nav-search'), title: 'Search Pigs' },
};

function switchView(name) {
  Object.entries(views).forEach(([k, v]) => {
    v.view.classList.toggle('active', k === name);
    v.nav.classList.toggle('active', k === name);
  });
  $('topbar-title').textContent = views[name].title;
  // Hide the "Register Pig" button when already on that page
  $('topbar-add-btn').classList.toggle('hidden', name === 'register');
  // Persist so browser reload returns to same view
  localStorage.setItem('pigo_active_view', name);
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();  // stops href="#" from scrolling or reloading
    const v = item.dataset.view;
    if (v) {
      switchView(v);
      if (window.innerWidth <= 768) closeSidebar();
    }
  });
});

$('topbar-add-btn').addEventListener('click', () => switchView('register'));

// Restore last visited view on page load (prevents redirect to database on reload)
const _savedView = localStorage.getItem('pigo_active_view');
switchView(_savedView && views[_savedView] ? _savedView : 'registry');

/* ── SIDEBAR MOBILE TOGGLE ──────────────────────────────────── */

const sidebar = $('sidebar');

function closeSidebar() { sidebar.classList.remove('open'); }
function openSidebar() { sidebar.classList.add('open'); }

$('sidebar-toggle').addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

document.addEventListener('click', e => {
  if (window.innerWidth <= 768 && !sidebar.contains(e.target) && e.target !== $('sidebar-toggle')) {
    closeSidebar();
  }
});

/* ── SERVER STATUS ───────────────────────────────────────────── */

async function checkServer() {
  try {
    const r = await fetch(`${BASE_URL}/`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'x-api-key': API_KEY },
    });
    if (r.ok) {
      $('status-dot').className = 'status-dot online';
      $('status-text').textContent = 'Server Online';
    } else {
      throw new Error();
    }
  } catch {
    $('status-dot').className = 'status-dot offline';
    $('status-text').textContent = 'Server Offline';
  }
}

checkServer();
setInterval(checkServer, 15000);

/* ── REGISTRY VIEW ──────────────────────────────────────────── */

let allPigs = [];
let viewMode = 'grid'; // 'grid' | 'list'

async function loadPigs() {
  const emptyEl = $('registry-empty');
  const grid = $('pig-grid');

  // Guard: only needed on very first call before DOM is ready
  if (!grid) return;

  // Always create a fresh loading indicator (the old one gets wiped by renderPigs)
  grid.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p id="loading-msg">Loading pigs…</p>
    </div>`;
  if (emptyEl) emptyEl.classList.add('hidden');

  // Show warm-up hint if request takes > 4s (Render cold start)
  const warmupTimer = setTimeout(() => {
    const msg = document.getElementById('loading-msg');
    if (msg) msg.textContent = 'Server is warming up, please wait…';
  }, 4000);

  try {
    const res = await fetch(`${BASE_URL}/pigs`, {
      signal: AbortSignal.timeout(35000),
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allPigs = await res.json();
    // Normalize images array on every pig (safety: parse JSON string if backend sends raw)
    allPigs.forEach(pig => {
      if (!Array.isArray(pig.images)) {
        try {
          const parsed = pig.image ? JSON.parse(pig.image) : [];
          pig.images = Array.isArray(parsed) ? parsed : [pig.image].filter(Boolean);
        } catch (_) {
          pig.images = pig.image ? [pig.image] : [];
        }
      }
      // Ensure pig.image is always the first from the resolved array
      if (!pig.image && pig.images.length) pig.image = pig.images[0];
    });
    renderPigs(allPigs);
    updateStats(allPigs);
  } catch (err) {
    grid.innerHTML = '';
    showToast('Failed to load pigs: ' + err.message, 'error');
  } finally {
    clearTimeout(warmupTimer);
  }
}

function updateStats(pigs) {
  const vaccinated = pigs.filter(p => p.vaccinated).length;
  const unvaccinated = pigs.length - vaccinated;
  $('stat-total').textContent = pigs.length;
  $('stat-vaccinated').textContent = vaccinated;
  $('stat-unvaccinated').textContent = unvaccinated;
}

function renderPigs(pigs) {
  const grid = $('pig-grid');
  grid.innerHTML = '';
  grid.className = 'pig-grid' + (viewMode === 'list' ? ' list-view' : '');

  if (pigs.length === 0) {
    $('registry-empty').classList.remove('hidden');
    return;
  }

  $('registry-empty').classList.add('hidden');

  pigs.forEach((pig, i) => {
    const card = buildPigCard(pig, i);
    grid.appendChild(card);
  });
}

function buildPigCard(pig, idx = 0) {
  const isList = viewMode === 'list';
  const card = document.createElement('div');
  card.className = 'pig-card' + (isList ? ' list-card' : '');
  card.style.animationDelay = `${idx * 0.04}s`;

  const imgEl = pig.image
    ? `<img class="pig-card-image" src="${pig.image}" alt="${pig.pig_name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="pig-card-image-placeholder" style="display:none">🐷</div>`
    : `<div class="pig-card-image-placeholder">🐷</div>`;

  const vaccBadge = pig.vaccinated
    ? `<span class="badge badge-vaccinated">✓ Vaccinated</span>`
    : `<span class="badge badge-unvaccinated">✗ Unvaccinated</span>`;

  card.innerHTML = `
    ${imgEl}
    <div class="pig-card-body">
      <div class="pig-card-header">
        <div class="pig-card-name">${esc(pig.pig_name)}</div>
        <div class="pig-card-id">${esc(pig.pig_id)}</div>
      </div>
      <div class="pig-card-meta">
        <div class="pig-card-meta-row">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${esc(pig.breed)}
        </div>
        <div class="pig-card-meta-row">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
          ${esc(pig.farm_name)}
        </div>
      </div>
      <div class="pig-card-footer">
        ${vaccBadge}
        <button class="btn btn-ghost btn-sm" data-action="edit" data-pig-id="${esc(pig.pig_id)}">Edit</button>
      </div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-action="edit"]');
    if (editBtn) {
      openPigModal(pig, true);
    } else {
      openPigModal(pig, false);
    }
  });

  return card;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* View mode toggle */
$('grid-btn').addEventListener('click', () => {
  viewMode = 'grid';
  $('grid-btn').classList.add('active');
  $('list-btn').classList.remove('active');
  renderPigs(filteredPigs());
});

$('list-btn').addEventListener('click', () => {
  viewMode = 'list';
  $('list-btn').classList.add('active');
  $('grid-btn').classList.remove('active');
  renderPigs(filteredPigs());
});

/* Reload / refresh database */
$('registry-reload-btn').addEventListener('click', async () => {
  const btn = $('registry-reload-btn');
  if (btn.classList.contains('spinning')) return; // prevent double-tap

  btn.classList.add('spinning');
  btn.disabled = true;

  try {
    await loadPigs();
    showToast('Database refreshed', 'success', 2000);
  } finally {
    // Always re-enable — don't rely on animationend which may not fire
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
});

/* Quick filter removed */
/* ── ADVANCED REGISTRY FILTERING ────────────────────────────── */

let currentFilters = {
  vaccinated: 'all',
  breed: '',
  farm: '',
  dob_start: '',
  dob_end: ''
};

const filterOverlay = $('filter-overlay');
const filterModal = $('filter-modal');
const filterBtn = $('registry-filter-btn');

/* ── SORTING STATE & DROPDOWN ────────────────────────────── */
let currentSort = 'registration_desc';

const sortBtn = $('registry-sort-btn');
const sortDropdown = $('sort-dropdown');
const sortBtnWrap = $('sort-btn-wrap');

function closeSortDropdown() {
  sortDropdown.classList.add('hidden');
}

if (sortBtn) sortBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sortDropdown.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (sortBtnWrap && !sortBtnWrap.contains(e.target)) {
    closeSortDropdown();
  }
});

const sortItems = document.querySelectorAll('#sort-dropdown .sort-dropdown-item');
sortItems.forEach(item => {
  item.addEventListener('click', () => {
    sortItems.forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    currentSort = item.dataset.val;

    if (currentSort === 'registration_desc') {
      sortBtn.classList.remove('active');
      if ($('sort-active-indicator')) $('sort-active-indicator').classList.add('hidden');
    } else {
      sortBtn.classList.add('active');
      if ($('sort-active-indicator')) $('sort-active-indicator').classList.remove('hidden');
    }

    renderPigs(filteredPigs());
    closeSortDropdown();
  });
});

function openFilterModal() {
  filterOverlay.classList.remove('hidden');
  filterModal.classList.remove('hidden');
  filterModal.style.animation = 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards';
}

function closeFilterModal() {
  filterModal.style.animation = 'slideDown 0.25s ease-in forwards';
  setTimeout(() => {
    filterModal.classList.add('hidden');
    filterOverlay.classList.add('hidden');
  }, 250);
}

if (filterBtn) filterBtn.addEventListener('click', openFilterModal);
if ($('filter-close')) $('filter-close').addEventListener('click', closeFilterModal);
if (filterOverlay) filterOverlay.addEventListener('click', closeFilterModal);

// Segmented buttons
const filterSegments = document.querySelectorAll('#filter-vaccinated-group .filter-segment');
filterSegments.forEach(segment => {
  segment.addEventListener('click', (e) => {
    filterSegments.forEach(s => s.classList.remove('active'));
    e.target.classList.add('active');
  });
});

// Dropdowns (similar to breed/farm)
const fBreedDropdown = $('filter-breed-dropdown');
const fBreedTrigger = $('filter-breed-trigger');
const fBreedTx = $('filter-breed-trigger-text');
const fBreedPanel = $('filter-breed-panel');
const fBreedSearch = $('filter-breed-search');
const fBreedList = $('filter-breed-list');

const fFarmDropdown = $('filter-farm-dropdown');
const fFarmTrigger = $('filter-farm-trigger');
const fFarmTx = $('filter-farm-trigger-text');
const fFarmPanel = $('filter-farm-panel');
const fFarmSearch = $('filter-farm-search');
const fFarmList = $('filter-farm-list');

function renderFilterBreedList(filter = '') {
  const q = filter.toLowerCase().trim();
  fBreedList.innerHTML = '<li class="breed-option active" data-val="">All Breeds</li>';
  if (typeof BREEDS !== 'undefined') {
    BREEDS.forEach(breed => {
      if (breed === 'Other') return;
      if (q && !breed.toLowerCase().includes(q)) return;
      const li = document.createElement('li');
      li.className = 'breed-option';
      li.textContent = breed;
      li.dataset.val = breed;
      fBreedList.appendChild(li);
    });
  }
}

function renderFilterFarmList(filter = '') {
  const q = filter.toLowerCase().trim();
  fFarmList.innerHTML = '<li class="breed-option active" data-val="">All Farms</li>';
  if (typeof FARMS !== 'undefined') {
    FARMS.forEach(farm => {
      if (farm.name === 'Other') return;
      if (q && !farm.name.toLowerCase().includes(q) && !farm.address.toLowerCase().includes(q)) return;
      const li = document.createElement('li');
      li.className = 'breed-option';
      li.innerHTML = `<div>${esc(farm.name)}</div><div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${esc(farm.address)}</div>`;
      li.dataset.val = farm.name;
      fFarmList.appendChild(li);
    });
  }
}

if (fBreedList) {
  fBreedList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const val = li.dataset.val;
    $('filter-breed-val').value = val;
    fBreedTx.textContent = val ? val : 'All Breeds';
    fBreedDropdown.classList.remove('open');
    fBreedPanel.classList.add('hidden');
  });
}

if (fFarmList) {
  fFarmList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const val = li.dataset.val;
    $('filter-farm-val').value = val;
    fFarmTx.textContent = val ? val : 'All Farms';
    fFarmDropdown.classList.remove('open');
    fFarmPanel.classList.add('hidden');
  });
}

if (fBreedTrigger) {
  fBreedTrigger.addEventListener('click', () => {
    const isOpen = fBreedDropdown.classList.contains('open');
    if (!isOpen) renderFilterBreedList();
    fBreedDropdown.classList.toggle('open');
    fBreedPanel.classList.toggle('hidden');
    if (!isOpen) fBreedSearch.focus();
  });
}

if (fFarmTrigger) {
  fFarmTrigger.addEventListener('click', () => {
    const isOpen = fFarmDropdown.classList.contains('open');
    if (!isOpen) renderFilterFarmList();
    fFarmDropdown.classList.toggle('open');
    fFarmPanel.classList.toggle('hidden');
    if (!isOpen) fFarmSearch.focus();
  });
}

if (fBreedSearch) fBreedSearch.addEventListener('input', e => renderFilterBreedList(e.target.value));
if (fFarmSearch) fFarmSearch.addEventListener('input', e => renderFilterFarmList(e.target.value));

document.addEventListener('click', (e) => {
  if (fBreedDropdown && fBreedPanel && !e.target.closest('#filter-breed-dropdown')) {
    fBreedDropdown.classList.remove('open');
    fBreedPanel.classList.add('hidden');
  }
  if (fFarmDropdown && fFarmPanel && !e.target.closest('#filter-farm-dropdown')) {
    fFarmDropdown.classList.remove('open');
    fFarmPanel.classList.add('hidden');
  }
});

if ($('filter-clear')) {
  $('filter-clear').addEventListener('click', () => {
    // Clear segments
    filterSegments.forEach(s => s.classList.remove('active'));
    const allSegment = document.querySelector('#filter-vaccinated-group .filter-segment[data-val="all"]');
    if (allSegment) allSegment.classList.add('active');
    
    // Clear dropdowns
    if ($('filter-breed-val')) $('filter-breed-val').value = '';
    if (fBreedTx) fBreedTx.textContent = 'All Breeds';
    if ($('filter-farm-val')) $('filter-farm-val').value = '';
    if (fFarmTx) fFarmTx.textContent = 'All Farms';
    
    // Clear dates
    if ($('filter-dob-start')) $('filter-dob-start').value = '';
    if ($('filter-dob-end')) $('filter-dob-end').value = '';
    
    applyFilters();
  });
}

if ($('filter-apply')) {
  $('filter-apply').addEventListener('click', () => {
    applyFilters();
    closeFilterModal();
  });
}

function applyFilters() {
  const activeSegment = document.querySelector('#filter-vaccinated-group .filter-segment.active');
  currentFilters.vaccinated = activeSegment ? activeSegment.dataset.val : 'all';
  currentFilters.breed = $('filter-breed-val') ? $('filter-breed-val').value : '';
  currentFilters.farm = $('filter-farm-val') ? $('filter-farm-val').value : '';
  currentFilters.dob_start = $('filter-dob-start') ? $('filter-dob-start').value : '';
  currentFilters.dob_end = $('filter-dob-end') ? $('filter-dob-end').value : '';
  
  const isActive = currentFilters.vaccinated !== 'all' || 
                   currentFilters.breed || 
                   currentFilters.farm || 
                   currentFilters.dob_start || 
                   currentFilters.dob_end;
  
  if (filterBtn) {
    if (isActive) {
      filterBtn.classList.add('active');
      $('filter-active-indicator').classList.remove('hidden');
    } else {
      filterBtn.classList.remove('active');
      $('filter-active-indicator').classList.add('hidden');
    }
  }
  
  renderPigs(filteredPigs());
}

function filteredPigs() {
  let list = allPigs;
  
  // 1. Apply Advanced Filters
  if (currentFilters.vaccinated === 'true') {
    list = list.filter(p => p.vaccinated === true);
  } else if (currentFilters.vaccinated === 'false') {
    list = list.filter(p => p.vaccinated === false);
  }
  
  if (currentFilters.breed) {
    list = list.filter(p => p.breed === currentFilters.breed);
  }
  
  if (currentFilters.farm) {
    list = list.filter(p => p.farm_name === currentFilters.farm);
  }
  
  if (currentFilters.dob_start) {
    list = list.filter(p => p.dob >= currentFilters.dob_start);
  }
  
  if (currentFilters.dob_end) {
    list = list.filter(p => p.dob <= currentFilters.dob_end);
  }
  
  // 2. Apply Sorting
  list.sort((a, b) => {
    switch (currentSort) {
      case 'registration_desc':
      case 'registration_asc':
        const dateA = parseRegDate(a.registration_date);
        const dateB = parseRegDate(b.registration_date);
        return currentSort === 'registration_desc' ? dateB - dateA : dateA - dateB;
      
      case 'age_desc': // Eldest = Earliest DOB
        return new Date(a.dob) - new Date(b.dob);
      case 'age_asc': // Youngest = Latest DOB
        return new Date(b.dob) - new Date(a.dob);
      
      case 'name_asc':
        return (a.pig_name || '').localeCompare(b.pig_name || '');
      case 'name_desc':
        return (b.pig_name || '').localeCompare(a.pig_name || '');
      
      default: return 0;
    }
  });

  // Helper to parse "dd/mm/yyyy hh:mm:ss"
  function parseRegDate(str) {
    if (!str || str === 'Legacy Record') return new Date(0);
    try {
      const parts = str.split(' ');
      if (parts.length < 2) return new Date(0);
      const [d, t] = parts;
      const [day, month, year] = d.split('/');
      const [h, m, s] = t.split(':');
      return new Date(year, month - 1, day, h, m, s);
    } catch { return new Date(0); }
  }

  // 3. Stats update
  updateStats(list);
  
  return list;
}

/* ── IMAGE GALLERY BUILDER ──────────────────────────────────── */

function buildImageGallery(images, name) {
  // Defensive: ensure we have a real non-empty array
  if (!Array.isArray(images)) {
    try { images = images ? JSON.parse(images) : []; } catch (_) { images = []; }
  }
  images = images.filter(Boolean);
  if (!images.length) return `<div class="modal-img-placeholder">🐷</div>`;
  if (images.length === 1) {
    return `<img class="modal-img" src="${esc(images[0])}" alt="${esc(name)}" onerror="this.style.display='none'" />`;
  }
  const slides = images.map((src, i) =>
    `<div class="gallery-slide${i === 0 ? ' active' : ''}" data-idx="${i}">
       <img src="${esc(src)}" alt="${esc(name)} photo ${i + 1}" onerror="this.parentElement.style.background='var(--bg-page)'" />
     </div>`
  ).join('');
  const dots = images.map((_, i) =>
    `<button type="button" class="gallery-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></button>`
  ).join('');
  return `
    <div class="modal-gallery" id="modal-gallery" data-total="${images.length}">
      <div class="gallery-track">${slides}</div>
      <button type="button" class="gallery-nav gallery-prev" id="gallery-prev">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15,18 9,12 15,6"/></svg>
      </button>
      <button type="button" class="gallery-nav gallery-next" id="gallery-next">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9,6 15,12 9,18"/></svg>
      </button>
      <div class="gallery-dots">${dots}</div>
      <div class="gallery-counter"><span id="gallery-cur">1</span>&#160;/&#160;${images.length}</div>
    </div>`;
}

/* ── PIG DETAIL / EDIT MODAL ────────────────────────────────── */

function openPigModal(pig, editMode = false) {
  const body = $('modal-body');

  const vaccBadge = pig.vaccinated
    ? `<span class="badge badge-vaccinated">✓ Vaccinated</span>`
    : `<span class="badge badge-unvaccinated">✗ Unvaccinated</span>`;

  // Build gallery block for modal
  const images = (pig.images && pig.images.length) ? pig.images : (pig.image ? [pig.image] : []);
  const imgBlock = buildImageGallery(images, pig.pig_name);

  body.innerHTML = `
    ${imgBlock}
    <div class="modal-content">
      <div class="modal-header">
        <div>
          <div class="modal-pig-name">${esc(pig.pig_name)}</div>
          <div class="modal-pig-id">${esc(pig.pig_id)}</div>
        </div>
        ${vaccBadge}
      </div>

      <div class="modal-details">
        <div class="detail-item">
          <div class="detail-label">Breed</div>
          <div class="detail-value">${esc(pig.breed)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Date of Birth</div>
          <div class="detail-value">${fmtDate(pig.dob)}${calculateAge(pig.dob)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Farm</div>
          <div class="detail-value">${esc(pig.farm_name)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Vaccine Date</div>
          <div class="detail-value">${fmtDate(pig.vaccine_date)}</div>
        </div>
        <div class="detail-item" style="grid-column:1/-1">
          <div class="detail-label">Farm Address</div>
          <div class="detail-value">${esc(pig.farm_address)}</div>
        </div>
        <div class="detail-item" style="grid-column:1/-1">
          <div class="detail-label">Registration Date</div>
          <div class="detail-value">${pig.registration_date ? esc(pig.registration_date) : 'Legacy Record'}</div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-ghost btn-sm" id="modal-edit-toggle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit Details
        </button>
      </div>

      <!-- EDIT FORM -->
      <div class="modal-edit-section${editMode ? ' open' : ''}" id="modal-edit-section">
        <h3 class="form-section-title" style="margin-bottom:0">Edit Information</h3>

        <div class="modal-edit-grid">
          <div class="modal-edit-field">
            <label>Pig Name</label>
            <input type="text" id="edit-pig-name" value="${esc(pig.pig_name)}" placeholder="Pig name" />
          </div>
          <div class="modal-edit-field">
            <label>Date of Birth</label>
            <input type="date" id="edit-dob" value="${pig.dob || ''}" />
          </div>
          <div class="modal-edit-field">
            <label>Breed</label>
            <input type="text" id="edit-breed" value="${esc(pig.breed)}" placeholder="Breed" />
          </div>
          <div class="modal-edit-field">
            <label>Farm Name</label>
            <input type="text" id="edit-farm-name" value="${esc(pig.farm_name)}" placeholder="Farm name" />
          </div>
          <div class="modal-edit-field full">
            <label>Farm Address</label>
            <input type="text" id="edit-farm-address" value="${esc(pig.farm_address)}" placeholder="Farm address" />
          </div>
          <div class="modal-edit-field" style="align-items:flex-start">
            <label>Vaccinated</label>
            <label class="toggle-switch" style="margin-top:4px">
              <input type="checkbox" id="edit-vaccinated" ${pig.vaccinated ? 'checked' : ''} />
              <span class="toggle-thumb"></span>
            </label>
          </div>
          <div class="modal-edit-field">
            <label>Vaccine Date</label>
            <input type="date" id="edit-vaccine-date" value="${pig.vaccine_date || ''}" />
          </div>
          <div class="modal-edit-field full">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <label style="margin:0">Photos <span style="font-size:11px;color:var(--text-muted);font-weight:400">— &#9733; sets cover · first = Cover</span></label>
              <div style="display:flex;align-items:center;gap:10px">
                <span class="edit-photo-counter" id="edit-photo-counter"></span>
                <button type="button" class="btn btn-ghost btn-sm" id="edit-add-photo-btn" style="padding:6px 12px;font-size:12px">+ Add</button>
              </div>
            </div>
            <div class="multi-preview-grid" id="edit-photo-grid"></div>
            <input type="file" id="edit-image" accept="image/*" multiple class="hidden" />
          </div>
        </div>

        <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;align-items:center">
          <button class="btn btn-danger btn-sm" id="modal-delete-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            Delete Pig
          </button>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" id="modal-edit-cancel">Cancel</button>
            <button class="btn btn-primary btn-sm" id="modal-save-btn">
              <span id="modal-save-text">Save Changes</span>
              <span class="btn-spinner hidden" id="modal-save-spinner"></span>
            </button>
          </div>
        </div>
        <div class="form-feedback hidden" id="modal-edit-feedback"></div>
      </div>
    </div>
  `;

  /* Edit toggle */
  body.querySelector('#modal-edit-toggle').addEventListener('click', () => {
    const sec = $('modal-edit-section');
    sec.classList.toggle('open');
  });

  body.querySelector('#modal-edit-cancel').addEventListener('click', () => {
    $('modal-edit-section').classList.remove('open');
  });

  /* Delete */
  body.querySelector('#modal-delete-btn').addEventListener('click', () => {
    deletePig(pig.pig_id, pig.pig_name);
  });

  /* Save */
  body.querySelector('#modal-save-btn').addEventListener('click', async () => {
    await saveEdit(pig.pig_id);
  });

  /* ── Edit photo grid ── */
  const editPhotos = images.map(url => ({ type: 'url', src: url }));
  const editPhotoGrid = body.querySelector('#edit-photo-grid');
  const editPhotoCounter = body.querySelector('#edit-photo-counter');
  const editAddBtn = body.querySelector('#edit-add-photo-btn');
  const editFileInput = body.querySelector('#edit-image');

  function renderEditPhotos() {
    editPhotoGrid.innerHTML = '';
    editPhotos.forEach((photo, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'preview-thumb';
      const isCover = (i === 0);
      wrap.innerHTML = `
        <img src="${photo.src}" alt="Photo ${i + 1}" />
        <button type="button" class="preview-remove" data-idx="${i}" title="Remove">×</button>
        ${isCover
          ? '<span class="preview-badge">Cover</span>'
          : `<button type="button" class="set-cover-btn" data-idx="${i}" title="Set as Cover">★</button>`
        }
      `;
      editPhotoGrid.appendChild(wrap);
    });
    // Remove
    editPhotoGrid.querySelectorAll('.preview-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        editPhotos.splice(parseInt(btn.dataset.idx), 1);
        renderEditPhotos();
      });
    });
    // Set as Cover — move to index 0
    editPhotoGrid.querySelectorAll('.set-cover-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        const [item] = editPhotos.splice(idx, 1);
        editPhotos.unshift(item);
        renderEditPhotos();
      });
    });
    const total = editPhotos.length;
    editPhotoCounter.textContent = `${total} / 5`;
  }

  renderEditPhotos();

  editAddBtn.addEventListener('click', () => {
    if (editPhotos.length >= 5) { showToast('Max 5 photos already selected.', 'error'); return; }
    editFileInput.click();
  });

  editFileInput.addEventListener('change', () => {
    const remaining = 5 - editPhotos.length;
    if (remaining <= 0) { showToast('Max 5 photos already selected.', 'error'); editFileInput.value = ''; return; }
    const newPick = Array.from(editFileInput.files);
    if (newPick.length > remaining) showToast(`Only ${remaining} more photo${remaining > 1 ? 's' : ''} can be added.`, 'error');
    newPick.slice(0, remaining).forEach(f => {
      const isDupe = editPhotos.some(p => p.type === 'file' && p.file.name === f.name && p.file.size === f.size);
      if (!isDupe) editPhotos.push({ type: 'file', src: URL.createObjectURL(f), file: f });
    });
    editFileInput.value = '';
    renderEditPhotos();
  });

  // Expose editPhotos to saveEdit via a closure on the save button
  body.querySelector('#modal-save-btn')._editPhotos = editPhotos;

  /* Wire gallery navigation (only if multiple images) */
  const gallery = body.querySelector('#modal-gallery');
  if (gallery) {
    let cur = 0;
    const total = parseInt(gallery.dataset.total);
    const slides = gallery.querySelectorAll('.gallery-slide');
    const dots = gallery.querySelectorAll('.gallery-dot');
    const curEl = gallery.querySelector('#gallery-cur');

    function goTo(idx) {
      slides[cur].classList.remove('active');
      dots[cur].classList.remove('active');
      cur = (idx + total) % total;
      slides[cur].classList.add('active');
      dots[cur].classList.add('active');
      if (curEl) curEl.textContent = cur + 1;
    }
    gallery.querySelector('#gallery-prev').addEventListener('click', e => { e.stopPropagation(); goTo(cur - 1); });
    gallery.querySelector('#gallery-next').addEventListener('click', e => { e.stopPropagation(); goTo(cur + 1); });
    dots.forEach((d, i) => d.addEventListener('click', e => { e.stopPropagation(); goTo(i); }));
  }

  /* Show modal */
  $('modal-overlay').classList.remove('hidden');
  $('pig-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
  $('pig-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

$('modal-close').addEventListener('click', closeModal);
$('modal-overlay').addEventListener('click', closeModal);

async function saveEdit(pigId) {
  const saveBtn = $('modal-save-btn');
  const saveText = $('modal-save-text');
  const saveSpinner = $('modal-save-spinner');
  const feedback = $('modal-edit-feedback');

  saveBtn.disabled = true;
  saveText.textContent = 'Saving…';
  saveSpinner.classList.remove('hidden');

  const fd = new FormData();
  fd.append('pig_name', $('edit-pig-name').value.trim());
  fd.append('dob', $('edit-dob').value);
  fd.append('breed', $('edit-breed').value.trim());
  fd.append('farm_name', $('edit-farm-name').value.trim());
  fd.append('farm_address', $('edit-farm-address').value.trim());
  fd.append('vaccinated', $('edit-vaccinated').checked ? 'true' : 'false');
  fd.append('vaccine_date', $('edit-vaccine-date').value);

  // Build image_order and slot files from editPhotos (stored on the button during modal open)
  const editPhotos = saveBtn._editPhotos || [];
  const imageOrder = [];
  let slotIdx = 0;
  editPhotos.forEach(photo => {
    if (photo.type === 'url') {
      imageOrder.push(photo.src);
    } else {
      const key = `__f${slotIdx}`;
      imageOrder.push(key);
      fd.append(`img_${slotIdx}`, photo.file);
      slotIdx++;
    }
  });
  fd.append('image_order', JSON.stringify(imageOrder));

  try {
    const res = await fetch(`${BASE_URL}/update/${encodeURIComponent(pigId)}`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: fd,
      // NOTE: Do NOT set Content-Type manually for FormData —
      // the browser sets it automatically with the correct multipart boundary.
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    feedback.className = 'form-feedback success';
    feedback.textContent = '✓ Pig updated successfully!';
    feedback.classList.remove('hidden');

    showToast(`${data.pig.pig_name} updated!`, 'success');
    closeModal();
    await loadPigs();
  } catch (err) {
    feedback.className = 'form-feedback error';
    feedback.textContent = '✗ ' + err.message;
    feedback.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveText.textContent = 'Save Changes';
    saveSpinner.classList.add('hidden');
  }
}

async function deletePig(pigId, pigName) {
  const confirmed = window.confirm(`Delete "${pigName}"?\n\nThis cannot be undone.`);
  if (!confirmed) return;

  try {
    const res = await fetch(`${BASE_URL}/delete/${encodeURIComponent(pigId)}`, {
      method: 'DELETE',
      headers: { 'x-api-key': API_KEY },
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    closeModal();
    showToast(`${pigName} deleted from database.`, 'success');
    await loadPigs();
  } catch (err) {
    showToast('Delete failed: ' + err.message, 'error');
  }
}

/* ── REGISTER PIG FORM ──────────────────────────────────────── */

const regForm = $('register-form');
const regVaccinated = $('reg-vaccinated');
const vaccDateWrap = $('vaccine-date-wrap');

regVaccinated.addEventListener('change', () => {
  vaccDateWrap.style.display = regVaccinated.checked ? 'grid' : 'none';
});

// ── MULTI-IMAGE PREVIEW ──────────────────────────────────────── */

const MAX_IMAGES = 5;
const uploadZone = $('upload-zone');
const fileInput = $('reg-image');
const placeholder = $('upload-placeholder');
const previewGrid = $('multi-preview-grid');
const uploadCounter = $('upload-counter');

// Persistent accumulator — survives multiple file-picker sessions
let selectedFiles = [];

function mergeFiles(newFiles) {
  // Add new files that aren't already in the list (match by name + size)
  Array.from(newFiles).forEach(f => {
    const isDupe = selectedFiles.some(e => e.name === f.name && e.size === f.size);
    if (!isDupe && selectedFiles.length < MAX_IMAGES) {
      selectedFiles.push(f);
    }
  });
  if (selectedFiles.length > MAX_IMAGES) selectedFiles = selectedFiles.slice(0, MAX_IMAGES);
}

function renderPreviews() {
  previewGrid.innerHTML = '';
  if (!selectedFiles.length) {
    previewGrid.classList.add('hidden');
    placeholder.classList.remove('hidden');
    uploadCounter.classList.add('hidden');
    return;
  }
  placeholder.classList.add('hidden');
  previewGrid.classList.remove('hidden');

  selectedFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    const wrap = document.createElement('div');
    wrap.className = 'preview-thumb';
    wrap.innerHTML = `
      <img src="${url}" alt="Photo ${i + 1}" />
      <button type="button" class="preview-remove" data-idx="${i}" title="Remove">×</button>
      ${i === 0 ? '<span class="preview-badge">Cover</span>' : ''}
    `;
    previewGrid.appendChild(wrap);
  });

  const count = selectedFiles.length;
  uploadCounter.textContent = `${count} / ${MAX_IMAGES} photo${count > 1 ? 's' : ''} selected`;
  uploadCounter.classList.remove('hidden');

  // Wire remove buttons — splice from selectedFiles and re-render
  previewGrid.querySelectorAll('.preview-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      selectedFiles.splice(parseInt(btn.dataset.idx), 1);
      renderPreviews();
    });
  });
}

// On each file-picker change: ACCUMULATE (don't replace)
fileInput.addEventListener('change', () => {
  const newPick = Array.from(fileInput.files);
  const remaining = MAX_IMAGES - selectedFiles.length;
  if (remaining <= 0) {
    showToast(`Max ${MAX_IMAGES} images already selected.`, 'error');
    fileInput.value = '';
    return;
  }
  if (newPick.length > remaining) {
    showToast(`Only ${remaining} more photo${remaining > 1 ? 's' : ''} can be added (max ${MAX_IMAGES}).`, 'error');
  }
  mergeFiles(newPick);
  fileInput.value = '';   // reset so same file can be picked again next time
  renderPreviews();
});

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));

uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (!dropped.length) return;
  mergeFiles(dropped);
  renderPreviews();
});


/* ── BREED SEARCHABLE DROPDOWN ──────────────────────────────── */

const BREEDS = [
  'Ankamali Pig', 'Banna Mini Pig', 'Berkshire', 'Chester White',
  'Duroc', 'Fengjing', 'Ghungroo', 'Gori', 'Hampshire', 'Hereford Pig',
  'Huai Pig', 'Jinhua', 'Landrace', 'Large Black', 'Large White (Yorkshire)',
  'Meishan', 'Middle White', 'Min Pig', 'Mukota Pig', 'Niang Megha',
  'Ossabaw Island Hog', 'Pietrain', 'Poland China', 'Spotted (Spots)',
  'Tamworth', 'Tenyi Vo', 'Tibetan Pig', 'Vietnamese Pot-bellied Pig',
  'Wuzhishan Pig', 'Xiang Pig', 'Zovawk',
  'Other',
];

const breedDropdown = $('breed-dropdown');
const breedTrigger = $('breed-trigger');
const breedTriggerTxt = $('breed-trigger-text');
const breedPanel = $('breed-panel');
const breedSearchEl = $('breed-search');
const breedList = $('breed-list');
const breedHidden = $('reg-breed');
const breedOtherInput = $('breed-other-input');
const breedOtherWrap = $('breed-other-wrap');

function renderBreedList(filter = '') {
  const q = filter.toLowerCase().trim();
  breedList.innerHTML = '';
  BREEDS.forEach(breed => {
    if (q && !breed.toLowerCase().includes(q)) return;
    const li = document.createElement('li');
    li.className = 'breed-option' + (breed === 'Other' ? ' breed-other-marker' : '');
    li.textContent = breed;
    li.addEventListener('click', () => selectBreed(breed));
    breedList.appendChild(li);
  });
  if (!breedList.children.length) {
    if (q) {
      const typed = filter.trim();
      const li = document.createElement('li');
      li.className = 'breed-option breed-use-typed';
      li.textContent = `+ Use "${typed}" as breed`;
      li.addEventListener('click', () => {
        breedHidden.value = typed;
        breedTriggerTxt.textContent = 'Other';
        breedTrigger.classList.add('has-value');
        breedTrigger.classList.remove('invalid');
        breedOtherWrap.classList.remove('hidden');
        breedOtherWrap.style.display = 'flex';
        breedOtherInput.value = typed;
        closeBreedPanel();
      });
      breedList.appendChild(li);
    } else {
      const li = document.createElement('li');
      li.className = 'breed-no-results';
      li.textContent = 'No breeds found';
      breedList.appendChild(li);
    }
  }
}

function selectBreed(breed) {
  breedTriggerTxt.textContent = breed;
  breedTrigger.classList.add('has-value');
  breedTrigger.classList.remove('invalid');
  if (breed === 'Other') {
    breedHidden.value = '';
    breedOtherWrap.classList.remove('hidden');
    breedOtherWrap.style.display = 'flex';
    breedOtherInput.value = '';
    breedOtherInput.focus();
  } else {
    breedHidden.value = breed;
    breedOtherWrap.classList.add('hidden');
    breedOtherWrap.style.display = '';
    breedOtherInput.value = '';
  }
  closeBreedPanel();
}

breedOtherInput.addEventListener('input', () => {
  breedHidden.value = breedOtherInput.value.trim();
});

function openBreedPanel() {
  breedPanel.classList.remove('hidden');
  breedSearchEl.value = '';
  renderBreedList();
  breedTrigger.classList.add('open');
  setTimeout(() => breedSearchEl.focus(), 50);
}

function closeBreedPanel() {
  breedPanel.classList.add('hidden');
  breedTrigger.classList.remove('open');
}

breedTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  breedPanel.classList.contains('hidden') ? openBreedPanel() : closeBreedPanel();
});

breedSearchEl.addEventListener('input', () => renderBreedList(breedSearchEl.value));

document.addEventListener('click', (e) => {
  if (!breedDropdown.contains(e.target)) closeBreedPanel();
});

function resetBreedDropdown() {
  breedTriggerTxt.textContent = 'Select a breed…';
  breedHidden.value = '';
  breedTrigger.classList.remove('has-value', 'invalid', 'open');
  breedOtherWrap.classList.add('hidden');
  breedOtherWrap.style.display = '';
  breedOtherInput.value = '';
  closeBreedPanel();
}

/* ── FARM SEARCHABLE DROPDOWN ───────────────────────────────── */

const FARMS = [
  { name: 'A & A Piggery Farm', address: 'Id More, Sikidri, Ranchi, Jharkhand 835219, India' },
  { name: 'AICRP on Pig – Assam Agricultural University Campus', address: 'Khanapara, Guwahati, Assam 781022, India' },
  { name: 'AICRP on Pig – College of Veterinary Sciences, Agartala', address: 'Agartala, Tripura 799006, India' },
  { name: 'AICRP on Pig – College of Veterinary Sciences, Aizawl', address: 'Aizawl, Mizoram 796015, India' },
  { name: 'AICRP on Pig – College of Veterinary Sciences, Gangtok', address: 'Gangtok, Sikkim 737102, India' },
  { name: 'AICRP on Pig – College of Veterinary Sciences, Imphal', address: 'Imphal, Manipur 795004, India' },
  { name: 'AICRP on Pig – College of Veterinary Sciences, Itanagar', address: 'Itanagar, Arunachal Pradesh 791111, India' },
  { name: 'AICRP on Pig – ICAR-CCARI Campus', address: 'Old Goa, Goa 403402, India' },
  { name: 'AICRP on Pig – ICAR-CIARI Campus', address: 'Port Blair, Andaman & Nicobar Islands 744101, India' },
  { name: 'AICRP on Pig – ICAR-IVRI Campus', address: 'Izatnagar, Bareilly, Uttar Pradesh 243122, India' },
  { name: 'AICRP on Pig – ICAR-RCNEH Campus', address: 'Umiam, Meghalaya 793103, India' },
  { name: 'AICRP on Pig – Nagaland University, Medziphema Campus', address: 'Dimapur, Nagaland 797106, India' },
  { name: 'AICRP on Pig – West Bengal University of Animal & Fishery Sciences', address: 'Mohanpur, Nadia, West Bengal 741252, India' },
  { name: 'Ajit Pig Farm', address: 'Sankosai, Asura, West Singhbhum, Jharkhand 833202, India' },
  { name: 'Anil Mahto Pig Farm', address: 'Madhaipur, Natundanga, Bardhaman, West Bengal 713381, India' },
  { name: 'Ankush Pig Farms', address: 'Ghatkhed, Maharashtra 444602, India' },
  { name: 'Aparna Agro', address: 'Near Ram Mandir, Laxmi Sagar, Bhubaneswar, Odisha, India' },
  { name: 'Ashirwad Piggery Farm', address: 'Hill View Colony, Jamshedpur, Jharkhand, India' },
  { name: 'Assam Agricultural University Pig Farm', address: 'Khanapara, Guwahati, Assam 781022, India' },
  { name: 'Atoz Farm', address: 'Sayestanagar, North 24 Parganas, West Bengal 743427, India' },
  { name: 'Baba Pigry Farm', address: 'Punjab, India' },
  { name: 'Barki Devi Pig Farm', address: 'NH19, Barakatha, Jharkhand, India' },
  { name: 'Bethlehem Rabbit Farm & Agricultural (Pig Unit)', address: 'India' },
  { name: 'Bihar Animal Sciences University Pig Farm', address: 'Patna, Bihar 800014, India' },
  { name: 'Bishop Braddy Agro Farm', address: 'Fatehpur, Uttar Pradesh 212652, India' },
  { name: 'Bobby Piggery Farm', address: 'India' },
  { name: 'Brothers Agriculture & Farming Company', address: 'Bistupur, Jamshedpur, Jharkhand, India' },
  { name: 'Budheswar Soren Pig Farm', address: 'Mayurbhanj, Odisha 757040, India' },
  { name: 'Ccube Pig Farm', address: 'Chokkasandra, Bengaluru, Karnataka 560099, India' },
  { name: 'Chaudhary Pig Farm', address: 'Naraura, Bulandshahr, Uttar Pradesh, India' },
  { name: 'Devsatya Farms Pvt Ltd', address: 'Farrukhabad, Uttar Pradesh 209601, India' },
  { name: 'Diyan Livestock Pig Farm', address: 'Village Kot, Dadri, Uttar Pradesh, India' },
  { name: 'Dumbi Hembrom Pig Farm', address: 'West Singhbhum, Jharkhand, India' },
  { name: 'Farmers Universe Pigg Farm', address: 'Jharkhand, India' },
  { name: 'Five Square Agro Pig Farm', address: 'Raigarh, Chhattisgarh, India' },
  { name: 'Gitanjali Farm (Pig Unit)', address: 'India' },
  { name: 'GK Farms (Pig Farming Unit)', address: 'Coimbatore, Tamil Nadu, India' },
  { name: 'Government Livestock Farm (Pig Unit)', address: 'Hisar, Haryana 125004, India' },
  { name: 'Government Pig Breeding Farm – Kanke', address: 'Kanke, Ranchi, Jharkhand 834006, India' },
  { name: 'Government Pig Breeding Farm – Khanapara', address: 'Khanapara, Guwahati, Assam 781022, India' },
  { name: 'Government Pig Breeding Farm – Medziphema', address: 'Medziphema, Dimapur, Nagaland 797106, India' },
  { name: 'Government Pig Farm – Agartala', address: 'Agartala, Tripura 799001, India' },
  { name: 'Government Pig Farm – Aizawl', address: 'Aizawl, Mizoram 796001, India' },
  { name: 'Government Pig Farm – Bhubaneswar', address: 'Bhubaneswar, Odisha 751003, India' },
  { name: 'Government Pig Farm – Byrnihat', address: 'Byrnihat, Ri-Bhoi, Meghalaya 793101, India' },
  { name: 'Government Pig Farm – Gangtok', address: 'Gangtok, Sikkim 737101, India' },
  { name: 'Government Pig Farm – Imphal', address: 'Imphal, Manipur 795004, India' },
  { name: 'Government Pig Farm – Itanagar', address: 'Itanagar, Arunachal Pradesh 791111, India' },
  { name: 'Government Pig Farm – Kalyani', address: 'Kalyani, Nadia, West Bengal 741235, India' },
  { name: 'Government Pig Farm – Patna', address: 'Patna, Bihar 800014, India' },
  { name: 'HOSH Farms Pig Unit', address: 'Vizianagaram, Andhra Pradesh 535006, India' },
  { name: 'HPS Piggery Farm', address: 'Char Brahmanagar, Nadia, West Bengal 741301, India' },
  { name: 'ICAR – CCARI Pig Unit', address: 'Ela, Old Goa, Goa 403402, India' },
  { name: 'ICAR – CIARI Pig Farm', address: 'Port Blair, Andaman & Nicobar Islands 744101, India' },
  { name: 'ICAR – ERS Pig Farm', address: 'Kalyani, Nadia, West Bengal 741235, India' },
  { name: 'ICAR – IVRI Pig Farm', address: 'Izatnagar, Bareilly, Uttar Pradesh 243122, India' },
  { name: 'ICAR – NRC on Pig', address: 'Rani, Guwahati, Kamrup, Assam 781131, India' },
  { name: 'ICAR – RCNEH Pig Unit', address: 'Umiam, Barapani, Meghalaya 793103, India' },
  { name: 'Irene Piggery', address: 'Lawngtlai, Mizoram, India' },
  { name: 'Jaswant Pig Farm', address: 'Dhaulana, Ghaziabad, Uttar Pradesh, India' },
  { name: 'JB Agro & Livestock', address: 'Nadia, West Bengal, India' },
  { name: 'Joy Baba Lokenath Piggery Firm', address: 'Bongaon, West Bengal 743245, India' },
  { name: 'K.K Pig Breeding Farm & Training Centre', address: 'Ranchi, Jharkhand 835303, India' },
  { name: 'Kaimur & Umang Piggery Group', address: 'Bihar, India' },
  { name: 'Kamboj Pig Farm', address: 'India' },
  { name: 'Karnal Swine Breeding Farm', address: 'Karnal, Haryana 132037, India' },
  { name: 'Kerala Veterinary and Animal Sciences University Pig Farm', address: 'Mannuthy, Thrissur, Kerala 680651, India' },
  { name: 'Khushi Livestock Pig Farm', address: 'India' },
  { name: 'Maa Kali Pig Farm', address: 'North 24 Parganas, West Bengal, India' },
  { name: 'Maa Piggery Bhollakash', address: 'Bhollakash, India' },
  { name: 'Mina Pork Meat Pig Farm', address: 'North 24 Parganas, West Bengal, India' },
  { name: 'Mizoram University Pig Farm', address: 'Aizawl, Mizoram 796004, India' },
  { name: 'Monu Sree Pig Farm', address: 'Chakdaha, West Bengal 741248, India' },
  { name: 'Murmu Enterprise Pig Farm', address: 'Jharkhand, India' },
  { name: 'Nagaland University Pig Farm', address: 'Medziphema, Dimapur, Nagaland 797106, India' },
  { name: 'Narsanda Pig Farm', address: 'Jharkhand, India' },
  { name: 'Narsing Farm', address: 'Ranchi, Jharkhand, India' },
  { name: 'New Jyoti Foundation Pig Farm', address: 'Jharkhand, India' },
  { name: 'Om Sai Piggery Farm', address: 'Jharkhand, India' },
  { name: 'Padangka Livestock Farm', address: 'Chukuniapara, Assam 781135, India' },
  { name: 'Paras Farma Pig Unit', address: 'India' },
  { name: 'Pig Farming Training & Research Institute of India Farm', address: 'Helencha, Bongaon, West Bengal 743270, India' },
  { name: 'Pradhan Pig Farming', address: 'Jamulanda, India' },
  { name: 'Raghuvanshi Pig Farm', address: 'Noida, Uttar Pradesh 201304, India' },
  { name: 'Raj Kumar Piggery Farm', address: 'Kamalpur, Punjab 147101, India' },
  { name: 'Rana Pig Farm', address: 'Pindaura Jahangeerpur, India' },
  { name: 'Sagar Livestock Pig Farm', address: 'Yamunanagar, Haryana 135133, India' },
  { name: 'Sai Agro Pig Farm', address: 'Daund, Maharashtra 412207, India' },
  { name: 'SKUAST Pig Farm', address: 'Jammu, Jammu & Kashmir 180009, India' },
  { name: 'Snow White Piggery', address: 'Jharkhand, India' },
  { name: 'SS Piggery Farm', address: 'Majhola, Moradabad, Uttar Pradesh 244001, India' },
  { name: 'Suvojit Pig Farm', address: 'Sayestanagar, North 24 Parganas, West Bengal, India' },
  { name: 'Sure Farm Pig Unit', address: 'Dehradun, Uttarakhand 248002, India' },
  { name: 'TANUVAS Pig Farm', address: 'Madhavaram, Chennai, Tamil Nadu 600051, India' },
  { name: 'Tripura Veterinary College Pig Farm', address: 'Agartala, Tripura 799006, India' },
  { name: 'Universal Piggery', address: 'India' },
  { name: 'Vikas Kumar Agro Livestock Farm', address: 'Patna, Bihar, India' },
  { name: 'Vikas Livestock Pig Farm', address: 'Saharanpur, Uttar Pradesh 247001, India' },
  { name: 'West Bengal University of Animal & Fishery Sciences Pig Farm', address: 'Mohanpur, Nadia, West Bengal 741252, India' },
  { name: 'Other', address: '' },
];

const farmDropdown = $('farm-dropdown');
const farmTrigger = $('farm-trigger');
const farmTriggerTxt = $('farm-trigger-text');
const farmPanel = $('farm-panel');
const farmSearchEl = $('farm-search');
const farmListEl = $('farm-list');
const farmHiddenName = $('reg-farm-name');
const farmHiddenAddr = $('reg-farm-address');
const farmAddrDisplay = $('farm-address-display');
const farmOtherWrap = $('farm-other-wrap');
const farmOtherName = $('farm-other-name');
const farmOtherAddress = $('farm-other-address');

function renderFarmList(filter = '') {
  const q = filter.toLowerCase().trim();
  farmListEl.innerHTML = '';
  FARMS.forEach(farm => {
    if (q && !farm.name.toLowerCase().includes(q)) return;
    const li = document.createElement('li');
    li.className = 'breed-option' + (farm.name === 'Other' ? ' breed-other-marker' : '');
    li.textContent = farm.name;
    li.addEventListener('click', () => selectFarm(farm));
    farmListEl.appendChild(li);
  });
  if (!farmListEl.children.length) {
    if (q) {
      const typed = filter.trim();
      const li = document.createElement('li');
      li.className = 'breed-option breed-use-typed';
      li.textContent = `+ Use "${typed}" as farm name`;
      li.addEventListener('click', () => {
        farmTriggerTxt.textContent = 'Other';
        farmTrigger.classList.add('has-value');
        farmTrigger.classList.remove('invalid');
        const farmAddrSection = $('farm-address-section');
        if (farmAddrSection) farmAddrSection.classList.add('hidden');
        farmAddrDisplay.textContent = '';
        farmOtherWrap.classList.remove('hidden');
        farmOtherName.value = typed;
        farmHiddenName.value = typed;
        farmHiddenAddr.value = '';
        farmOtherAddress.value = '';
        closeFarmPanel();
        setTimeout(() => farmOtherAddress.focus(), 50);
      });
      farmListEl.appendChild(li);
    } else {
      const li = document.createElement('li');
      li.className = 'breed-no-results';
      li.textContent = 'No farms found';
      farmListEl.appendChild(li);
    }
  }
}

function selectFarm(farm) {
  farmTriggerTxt.textContent = farm.name;
  farmTrigger.classList.add('has-value');
  farmTrigger.classList.remove('invalid');

  const farmAddrSection = $('farm-address-section');

  if (farm.name === 'Other') {
    farmHiddenName.value = '';
    farmHiddenAddr.value = '';
    if (farmAddrSection) farmAddrSection.classList.add('hidden');
    farmAddrDisplay.textContent = '';
    farmOtherWrap.classList.remove('hidden');
    farmOtherName.value = '';
    farmOtherAddress.value = '';
    farmOtherName.focus();
  } else {
    farmHiddenName.value = farm.name;
    farmHiddenAddr.value = farm.address;
    farmOtherWrap.classList.add('hidden');
    // Show auto-filled address with heading
    farmAddrDisplay.textContent = farm.address;
    if (farmAddrSection) farmAddrSection.classList.remove('hidden');
  }
  closeFarmPanel();
}

farmOtherName.addEventListener('input', () => { farmHiddenName.value = farmOtherName.value.trim(); });
farmOtherAddress.addEventListener('input', () => { farmHiddenAddr.value = farmOtherAddress.value.trim(); });

function openFarmPanel() {
  farmPanel.classList.remove('hidden');
  farmSearchEl.value = '';
  renderFarmList();
  farmTrigger.classList.add('open');
  setTimeout(() => farmSearchEl.focus(), 50);
}

function closeFarmPanel() {
  farmPanel.classList.add('hidden');
  farmTrigger.classList.remove('open');
}

farmTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  farmPanel.classList.contains('hidden') ? openFarmPanel() : closeFarmPanel();
});

farmSearchEl.addEventListener('input', () => renderFarmList(farmSearchEl.value));

document.addEventListener('click', (e) => {
  if (!farmDropdown.contains(e.target)) closeFarmPanel();
});

function resetFarmDropdown() {
  farmTriggerTxt.textContent = 'Select a farm…';
  farmHiddenName.value = '';
  farmHiddenAddr.value = '';
  farmTrigger.classList.remove('has-value', 'invalid', 'open');
  const farmAddrSection = $('farm-address-section');
  if (farmAddrSection) farmAddrSection.classList.add('hidden');
  farmAddrDisplay.textContent = '';
  farmOtherWrap.classList.add('hidden');
  farmOtherName.value = '';
  farmOtherAddress.value = '';
  closeFarmPanel();
}

/* Reset */
$('reg-reset').addEventListener('click', () => {
  regForm.reset();
  selectedFiles = [];
  renderPreviews();
  vaccDateWrap.style.display = 'none';
  $('reg-feedback').classList.add('hidden');
  regForm.querySelectorAll('input').forEach(el => el.classList.remove('invalid'));
  resetBreedDropdown();
  resetFarmDropdown();
});


/* Submit */
regForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const required = ['reg-pig-name', 'reg-dob'];
  let valid = true;

  required.forEach(id => {
    const el = $(id);
    if (!el.value.trim()) {
      el.classList.add('invalid');
      valid = false;
    } else {
      el.classList.remove('invalid');
    }
  });

  // Breed dropdown validation
  if (!breedHidden.value.trim()) {
    breedTrigger.classList.add('invalid');
    valid = false;
  } else {
    breedTrigger.classList.remove('invalid');
  }

  // Farm dropdown validation
  if (!farmHiddenName.value.trim()) {
    farmTrigger.classList.add('invalid');
    valid = false;
  } else {
    farmTrigger.classList.remove('invalid');
  }
  if (!farmHiddenAddr.value.trim()) {
    if (farmOtherWrap.classList.contains('hidden')) {
      farmTrigger.classList.add('invalid');
    } else {
      farmOtherAddress.classList.add('invalid');
    }
    valid = false;
  } else {
    farmOtherAddress.classList.remove('invalid');
  }

  if (!selectedFiles.length) {
    uploadZone.style.borderColor = 'var(--red)';
    valid = false;
  } else {
    uploadZone.style.borderColor = '';
  }

  if (!valid) {
    showFeedback('reg-feedback', 'error', 'Please fill in all required fields and upload an image.');
    return;
  }

  const submitBtn = $('reg-submit');
  const submitText = $('reg-submit-text');
  const submitSpinner = $('reg-spinner');

  submitBtn.disabled = true;
  submitText.textContent = 'Registering…';
  submitSpinner.classList.remove('hidden');

  const fd = new FormData();
  fd.append('pig_name', $('reg-pig-name').value.trim());
  fd.append('dob', $('reg-dob').value);
  fd.append('breed', $('reg-breed').value.trim());
  fd.append('farm_name', $('reg-farm-name').value.trim());
  fd.append('farm_address', $('reg-farm-address').value.trim());
  fd.append('vaccinated', regVaccinated.checked ? 'true' : 'false');
  fd.append('vaccine_date', $('reg-vaccine-date').value);
  selectedFiles.forEach(f => fd.append('image', f));

  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY },
      body: fd,
      // NOTE: Do NOT set Content-Type manually for FormData —
      // the browser sets it automatically with the correct multipart boundary.
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // Show the auto-generated ID prominently
    const assignedId = data.pig.pig_id;
    if ($('auto-id-display')) $('auto-id-display').textContent = `Auto-assigned on save`;
    showFeedback('reg-feedback', 'success', `✓ ${data.pig.pig_name} registered — ID: ${assignedId}`);
    showToast(`${data.pig.pig_name} added — ID: ${assignedId}`, 'success', 4500);
    regForm.reset();
    selectedFiles = [];
    renderPreviews();
    resetBreedDropdown();
    resetFarmDropdown();
    vaccDateWrap.style.display = 'none';
    await loadPigs();


  } catch (err) {
    showFeedback('reg-feedback', 'error', '✗ ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitText.textContent = 'Register Pig';
    submitSpinner.classList.add('hidden');
  }
});

function showFeedback(id, type, msg) {
  const el = $(id);
  el.className = `form-feedback ${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── SEARCH VIEW ────────────────────────────────────────────── */

let searchDebounce;

$('search-input').addEventListener('input', () => {
  const q = $('search-input').value.trim();
  $('search-clear').classList.toggle('hidden', q.length === 0);

  clearTimeout(searchDebounce);
  if (q.length < 2) {
    $('search-hint').classList.remove('hidden');
    $('search-results').classList.add('hidden');
    $('search-empty').classList.add('hidden');
    return;
  }
  searchDebounce = setTimeout(() => doSearch(q), 320);
});

$('search-clear').addEventListener('click', () => {
  $('search-input').value = '';
  $('search-clear').classList.add('hidden');
  $('search-hint').classList.remove('hidden');
  $('search-results').classList.add('hidden');
  $('search-empty').classList.add('hidden');
  $('search-input').focus();
});

async function doSearch(q) {
  const results = $('search-results');
  results.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Searching…</p></div>`;
  results.classList.remove('hidden');
  $('search-hint').classList.add('hidden');
  $('search-empty').classList.add('hidden');

  try {
    const res = await fetch(`${BASE_URL}/search?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(35000),
      headers: { 'x-api-key': API_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pigs = await res.json();

    results.innerHTML = '';

    if (pigs.length === 0) {
      results.classList.add('hidden');
      $('search-empty').classList.remove('hidden');
      return;
    }

    $('search-empty').classList.add('hidden');
    results.className = 'pig-grid';

    pigs.forEach((pig, i) => {
      const card = buildPigCard(pig, i);
      results.appendChild(card);
    });

  } catch (err) {
    results.innerHTML = '';
    results.classList.add('hidden');
    showToast('Search failed: ' + err.message, 'error');
  }
}

/* ── INIT ────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  loadPigs();
});
