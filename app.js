/* =========================================================
   HAUPTLOGIK DER SEMESTERPLAN WEB-APP (app.js)
   - Globaler Ladekreis (Spinner) bei Lade-/Sync-Vorgängen
   - Dokumente ohne Wochenbezug oben unter dem jeweiligen Modulnamen
   - Drag & Drop von Aufgaben UND von Dokumenten direkt auf Aufgaben
   - 2-Spalten-Modulraster auf Handy & Querformat-Unterstützung
   ========================================================= */
const STORAGE_KEY = 'semesterplan_app_state_v3';
const THEME_KEY = 'semesterplan_theme';

const THEMES = {
  rose:       { label: 'Original Rosa',             colors: ['#C66A7A', '#8E3A49', '#FAF6F6'], light: '#F9EFEF', border: '#F0E1E4' },
  berry:      { label: 'Berry Velvet',              colors: ['#DB2777', '#831843', '#FDF2F8'], light: '#FCE7F3', border: '#FBCFE8' },
  mocha:      { label: 'Café Mocha (Cool Taupe)',   colors: ['#6E5D56', '#423532', '#F7F5F4'], light: '#EFECEB', border: '#DDD6D4' },
  sage:       { label: 'Nordic Sage (Analog)',      colors: ['#5E8C76', '#2E5242', '#F4F8F6'], light: '#EAF2EE', border: '#CFE0D8' },
  ocean:      { label: 'Aegean Ocean (Kühl)',       colors: ['#3A6EA5', '#1E3A5F', '#F5F8FC'], light: '#EBF2FA', border: '#D0E0F2' },
  lavender:   { label: 'Provence Lavender',         colors: ['#7E6BC4', '#46357D', '#F8F7FC'], light: '#F1EFFA', border: '#DFD9F2' },
  terracotta: { label: 'Tuscan Terracotta',         colors: ['#C26D53', '#853F2A', '#FBF7F5'], light: '#F9EFEA', border: '#EEDAD2' },
  nordic:     { label: 'Nordic Fjord',              colors: ['#3B7A8C', '#1F4854', '#F4F8F9'], light: '#E9F2F5', border: '#CCE0E6' },
  pearl:      { label: 'Rose Quartz & Pearl',       colors: ['#B57C86', '#6B444C', '#FBF8F9'], light: '#F6EEF0', border: '#E8D8DC' },
  dark:       { label: 'Midnight Velvet (Dark)',    colors: ['#D97789', '#F3A6B4', '#141216'], light: '#2A2125', border: '#3D2F35' },
  obsidian:   { label: 'Obsidian Emerald (Dark)',   colors: ['#52A788', '#8CE0C0', '#0E1513'], light: '#192722', border: '#283D35' },
  cosmos:     { label: 'Nordic Night (Dark)',       colors: ['#5B9BD5', '#93C5FD', '#0B111E'], light: '#1A2636', border: '#2A3B52' },
  amethyst:   { label: 'Nocturne Plum (Dark)',      colors: ['#9B82F3', '#C4B5FD', '#120F1B'], light: '#241E35', border: '#362D4F' },
  espresso:   { label: 'Dark Roast (Dark)',         colors: ['#B68F78', '#E2C5B3', '#141110'], light: '#28211E', border: '#3C322D' }
};

let appState = null;
let activeModuleFilter = null;
let currentTab = 'table';
let draggedTaskInfo = null;
let loadingDepth = 0;

/* =========================================================
   LADEKREIS (SPINNER) STEUERUNG
   ========================================================= */
function showLoading(message = 'Lädt...') {
  loadingDepth++;
  const el = document.getElementById('globalLoadingIndicator');
  const txt = document.getElementById('globalLoadingText');
  if (txt) txt.textContent = message;
  if (el) el.classList.add('active');
}

function hideLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth === 0) {
    document.getElementById('globalLoadingIndicator')?.classList.remove('active');
  }
}

async function initApp() {
  showLoading('Lade Semesterplan & Dokumente...');
  try {
    loadState();
    buildThemeMenuUI();
    const savedTheme = localStorage.getItem(THEME_KEY) || 'rose';
    changeTheme(savedTheme, false);

    if (localStorage.getItem('semesterplan_iphone_view') === 'true') {
      document.body.classList.add('iphone-view-mode');
      updateIphoneBtnState();
    }
    updateIosClock();
    setInterval(updateIosClock, 30000);

    populateFocusWeekDropdown();
    populateDocsFilterDropdowns();
    selectCurrentCalendarWeek(false);

    await refreshDocsCache();
    renderAll();

    document.addEventListener('click', (e) => {
      const themeContainer = document.getElementById('themeDropdownContainer');
      const themeMenu = document.getElementById('themeMenu');
      if (themeContainer && themeMenu && !themeContainer.contains(e.target)) {
        themeMenu.classList.add('hidden');
      }
      if (!e.target.closest('.task-menu-wrapper')) {
        closeAllTaskActionMenus();
      }
    });
  } finally {
    hideLoading();
  }
}

function updateIosClock() {
  const el = document.getElementById('iosClock');
  if (!el) return;
  const now = new Date();
  el.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function stripModuleBracketsFromText(text, shortName = '') {
  let cleaned = String(text ?? '').trim();
  if (shortName) {
    cleaned = cleaned.replace(new RegExp(`^\\[\\s*${shortName}\\s*\\]\\s*:?\\s*`, 'i'), '');
  }
  return cleaned.replace(/^\[[^\]]+\]\s*:?\s*/, '').trim();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        Array.isArray(parsed.modules) &&
        Array.isArray(parsed.weeks) &&
        parsed.weeks.length > 0 &&
        parsed.weeks[0].cells
      ) {
        appState = parsed;
        if (!Array.isArray(appState.deletedGoogleTaskIds)) {
          appState.deletedGoogleTaskIds = [];
        }
        for (const week of appState.weeks) {
          for (const mod of appState.modules) {
            const list = week.cells[mod.shortName] || [];
            list.forEach(item => {
              item.text = stripModuleBracketsFromText(item.text, mod.shortName);
            });
          }
        }
        return;
      }
    }
  } catch (e) {
    console.warn('Konnte gespeicherten Status nicht laden, nutze INITIAL_DATA:', e);
  }
  if (typeof INITIAL_DATA === 'undefined') {
    appState = { modules: [], weeks: [], deletedGoogleTaskIds: [] };
    return;
  }
  appState = JSON.parse(JSON.stringify(INITIAL_DATA));
  appState.deletedGoogleTaskIds = [];
  saveState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (e) {
    console.error('Fehler beim Speichern im localStorage:', e);
  }
}

/* =========================================================
   3-PUNKTE-MENÜ (⋮) FÜR AUFGABEN-AKTIONEN
   ========================================================= */
function closeAllTaskActionMenus() {
  document.querySelectorAll('.task-dropdown-menu.open').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.task-menu-btn.active').forEach(el => el.classList.remove('active'));
}

function toggleTaskActionMenu(event, menuId) {
  event.stopPropagation();
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const isAlreadyOpen = menu.classList.contains('open');
  closeAllTaskActionMenus();
  if (!isAlreadyOpen) {
    menu.classList.add('open');
    event.currentTarget.classList.add('active');
  }
}

function buildTaskActionMenuHtml(wIdx, shortName, idx, item, prefix = 'tbl') {
  const menuId = `taskMenu_${prefix}_${wIdx}_${shortName.replace(/\s+/g, '')}_${idx}`;
  const inProgLabel = item.inProgress && !item.done ? '⬜ „Angefangen“ aufheben' : '⏳ Als angefangen markieren';
  return `
    <div class="task-menu-wrapper">
      <button type="button" class="task-menu-btn" title="Optionen" onclick="toggleTaskActionMenu(event, '${escapeAttr(menuId)}')">⋮</button>
      <div class="task-dropdown-menu" id="${escapeAttr(menuId)}" onclick="event.stopPropagation()">
        <button type="button" class="task-menu-item" onclick="closeAllTaskActionMenus(); openUploadDocForTask(${wIdx}, '${escapeAttr(shortName)}', ${idx}, event)">
          <span>📎</span> <span>Dokument zu dieser Aufgabe hochladen</span>
        </button>
        <button type="button" class="task-menu-item" onclick="closeAllTaskActionMenus(); toggleTaskInProgress(${wIdx}, '${escapeAttr(shortName)}', ${idx})">
          <span>${inProgLabel}</span>
        </button>
        <button type="button" class="task-menu-item" onclick="closeAllTaskActionMenus(); moveTaskOrder(${wIdx}, '${escapeAttr(shortName)}', ${idx}, -1)">
          <span>↑</span> <span>Nach oben verschieben</span>
        </button>
        <button type="button" class="task-menu-item" onclick="closeAllTaskActionMenus(); moveTaskOrder(${wIdx}, '${escapeAttr(shortName)}', ${idx}, 1)">
          <span>↓</span> <span>Nach unten verschieben</span>
        </button>
        <button type="button" class="task-menu-item" onclick="closeAllTaskActionMenus(); openEditTaskModal(${wIdx}, '${escapeAttr(shortName)}', ${idx})">
          <span>✏️</span> <span>Aufgabe bearbeiten</span>
        </button>
        <button type="button" class="task-menu-item danger-item" onclick="closeAllTaskActionMenus(); deleteTaskItem(${wIdx}, '${escapeAttr(shortName)}', ${idx})">
          <span>🗑️</span> <span>Aufgabe löschen</span>
        </button>
      </div>
    </div>
  `;
}

/* =========================================================
   SEITEN-MENÜLEISTE, THEMES & QUERFORMAT-ANSICHT
   ========================================================= */
function toggleSideDrawer() {
  const drawer = document.getElementById('sideMenuDrawer');
  const backdrop = document.getElementById('sideDrawerBackdrop');
  if (!drawer || !backdrop) return;
  const isOpen = drawer.classList.toggle('open');
  backdrop.classList.toggle('open', isOpen);
}

function closeSideDrawer() {
  document.getElementById('sideMenuDrawer')?.classList.remove('open');
  document.getElementById('sideDrawerBackdrop')?.classList.remove('open');
}

function buildThemeMenuUI() {
  const html = Object.entries(THEMES).map(([key, t]) => `
    <button type="button" class="theme-option-item" data-theme-key="${key}" onclick="changeTheme('${key}', true)">
      <span class="theme-preview-dots">
        <span class="dot" style="background:${t.colors[0]}"></span>
        <span class="dot" style="background:${t.colors[1]}"></span>
        <span class="dot" style="background:${t.colors[2]}"></span>
      </span>
      <span class="theme-option-label">${escapeHtml(t.label)}</span>
    </button>
  `).join('');
  const menu = document.getElementById('themeMenu');
  if (menu) menu.innerHTML = html;
  const drawerList = document.getElementById('drawerThemeList');
  if (drawerList) drawerList.innerHTML = html;
}

function toggleThemeMenu(event) {
  event.stopPropagation();
  document.getElementById('themeMenu')?.classList.toggle('hidden');
}

function changeTheme(themeName, showNotification = true) {
  const themeKey = THEMES[themeName] ? themeName : 'rose';
  const themeObj = THEMES[themeKey];
  document.documentElement.setAttribute('data-theme', themeKey);
  localStorage.setItem(THEME_KEY, themeKey);
  const dotsEl = document.getElementById('currentThemeDots');
  const labelEl = document.getElementById('currentThemeLabel');
  if (dotsEl) {
    dotsEl.innerHTML = `
      <span class="dot" style="background:${themeObj.colors[0]}"></span>
      <span class="dot" style="background:${themeObj.colors[1]}"></span>
      <span class="dot" style="background:${themeObj.colors[2]}"></span>
    `;
  }
  if (labelEl) labelEl.textContent = themeObj.label;
  document.querySelectorAll('.theme-option-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme-key') === themeKey);
  });
  document.getElementById('themeMenu')?.classList.add('hidden');
  renderEmailPreview();
  if (showNotification) {
    showToast(`🎨 Farbdesign „${themeObj.label}“ aktiviert!`);
  }
}

function toggleIphoneView() {
  const isIphone = document.body.classList.toggle('iphone-view-mode');
  if (!isIphone) document.body.classList.remove('landscape-mode');
  localStorage.setItem('semesterplan_iphone_view', isIphone ? 'true' : 'false');
  updateIphoneBtnState();
  showToast(isIphone ? '📱 Handy-Ansicht aktiviert (2-Spalten-Modulraster)' : '💻 Desktop-Tabellenansicht aktiviert');
}

function toggleLandscapePreview() {
  if (!document.body.classList.contains('iphone-view-mode')) {
    document.body.classList.add('iphone-view-mode');
  }
  const isLand = document.body.classList.toggle('landscape-mode');
  updateIphoneBtnState();
  showToast(isLand ? '🔄 Handy-Querformat (Landscape) aktiviert!' : '📱 Handy-Hochformat (Portrait) aktiviert!');
}

function updateIphoneBtnState() {
  const btn = document.getElementById('iphoneViewBtn');
  const landBtn = document.getElementById('landscapeToggleBtn');
  const isIphone = document.body.classList.contains('iphone-view-mode');
  const isLand = document.body.classList.contains('landscape-mode');
  if (btn) btn.textContent = isIphone ? '💻 Desktop-Ansicht' : '📱 Handy-Ansicht';
  if (landBtn) {
    landBtn.classList.toggle('hidden', !isIphone);
    landBtn.textContent = isLand ? '📱 Hochformat' : '🔄 Querformat';
  }
}

function switchTab(tabName) {
  currentTab = tabName;
  document.getElementById('viewTable')?.classList.toggle('hidden', tabName !== 'table');
  document.getElementById('viewFocus')?.classList.toggle('hidden', tabName !== 'focus');
  document.getElementById('viewDocs')?.classList.toggle('hidden', tabName !== 'docs');
  document.getElementById('viewEmail')?.classList.toggle('hidden', tabName !== 'email');
  document.getElementById('tableFilters')?.classList.toggle('hidden', tabName !== 'table');
  ['table', 'focus', 'docs', 'email'].forEach(t => {
    const cap = t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(`tabBtn${cap}`)?.classList.toggle('active', tabName === t);
    document.getElementById(`iosTab${cap}`)?.classList.toggle('active', tabName === t);
    document.getElementById(`drawerTab${cap}`)?.classList.toggle('active', tabName === t);
  });
  renderAll();
}

function setModuleFilter(shortName) {
  activeModuleFilter = (activeModuleFilter === shortName) ? null : shortName;
  const clearBtn = document.getElementById('clearModuleFilterBtn');
  if (clearBtn) {
    clearBtn.style.display = activeModuleFilter ? 'inline-flex' : 'none';
  }
  renderAll();
}

function openModuleDocsDirectly(shortName, event) {
  if (event) event.stopPropagation();
  const sel = document.getElementById('docsModuleFilter');
  if (sel) sel.value = shortName;
  switchTab('docs');
}

function populateDocsFilterDropdowns() {
  const filterMod = document.getElementById('docsModuleFilter');
  if (filterMod) {
    filterMod.innerHTML = `<option value="all">Alle Module anzeigen</option>` +
      appState.modules.map(m => `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} – ${escapeHtml(m.fullName)}</option>`).join('');
  }
}

/* =========================================================
   DATUM-HILFSFUNKTIONEN
   ========================================================= */
function parseWeekDates(weekLabel) {
  if (!weekLabel) return null;
  const regex = /(\d{2})\.(\d{2})\.(?:(\d{4}))?\s*[–\-]\s*(\d{2})\.(\d{2})\.(\d{4})/;
  const match = weekLabel.match(regex);
  if (!match) return null;
  const d1 = parseInt(match[1], 10);
  const m1 = parseInt(match[2], 10) - 1;
  const d2 = parseInt(match[4], 10);
  const m2 = parseInt(match[5], 10) - 1;
  const y2 = parseInt(match[6], 10);
  const y1 = match[3] ? parseInt(match[3], 10) : (m1 > m2 ? y2 - 1 : y2);
  const weekMon = new Date(y1, m1, d1, 0, 0, 0, 0);
  const weekSun = new Date(y2, m2, d2, 23, 59, 59, 999);
  return { weekMon, weekSun };
}

function getWeekMondayDateString(weekIdx) {
  const week = appState.weeks[weekIdx];
  if (!week) return new Date().toISOString().slice(0, 10);
  const parsed = parseWeekDates(week.weekLabel);
  if (!parsed) return new Date().toISOString().slice(0, 10);
  const y = parsed.weekMon.getFullYear();
  const m = String(parsed.weekMon.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.weekMon.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekShortName(weekIdx) {
  const week = appState.weeks[weekIdx];
  if (!week) return 'Woche';
  return week.weekLabel.split('\n')[0].trim();
}

function formatDateDE(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}.${m}.${y}`;
}

function formatIsoDateDE(isoStr) {
  if (!isoStr) return '';
  const parts = isoStr.split('-');
  if (parts.length !== 3) return isoStr;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function findWeekIndexByDate(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return -1;
  const t = dateObj.getTime();
  for (let i = 0; i < appState.weeks.length; i++) {
    const parsed = parseWeekDates(appState.weeks[i].weekLabel);
    if (parsed && t >= parsed.weekMon.getTime() && t <= parsed.weekSun.getTime()) {
      return i;
    }
  }
  return -1;
}

/* =========================================================
   STATISTIK & FORTSCHRITTSBERECHNUNG
   ========================================================= */
function calculateStats() {
  const moduleStats = {};
  let overallTotal = 0;
  let overallCompleted = 0;
  let overallInProgress = 0;
  for (const mod of appState.modules) {
    moduleStats[mod.shortName] = {
      shortName: mod.shortName,
      fullName: mod.fullName,
      total: 0,
      completed: 0,
      inProgress: 0,
      pct: 0,
      docCount: cachedDocsList.filter(d => d.module === mod.shortName).length
    };
  }
  for (const week of appState.weeks) {
    for (const mod of appState.modules) {
      const items = week.cells[mod.shortName] || [];
      for (const item of items) {
        moduleStats[mod.shortName].total++;
        overallTotal++;
        if (item.done) {
          moduleStats[mod.shortName].completed++;
          overallCompleted++;
        } else if (item.inProgress) {
          moduleStats[mod.shortName].inProgress++;
          overallInProgress++;
        }
      }
    }
  }
  for (const mod of appState.modules) {
    const s = moduleStats[mod.shortName];
    s.pct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  }
  const overallPct = overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 100) : 0;
  return { moduleStats, overallTotal, overallCompleted, overallInProgress, overallPct };
}

/* =========================================================
   RENDERING: DASHBOARD, TABELLE (INKL. ALLG. MODUL-UNTERLAGEN OBEN)
   ========================================================= */
function renderAll() {
  if (!appState) return;
  const stats = calculateStats();
  renderDashboard(stats);
  renderTable(stats);
  renderFocusView();
  renderModuleDocsView();
  renderEmailPreview();
}

function renderDashboard(stats) {
  const statusEl = document.getElementById('overallStatusText');
  if (statusEl) {
    const inProgInfo = stats.overallInProgress > 0 ? `, ${stats.overallInProgress} angefangen` : '';
    statusEl.textContent = `Gesamtfortschritt: ${stats.overallPct} % (${stats.overallCompleted}/${stats.overallTotal} erledigt${inProgInfo})`;
  }
  const container = document.getElementById('dashboardCards');
  if (!container) return;
  container.innerHTML = appState.modules.map(mod => {
    const s = stats.moduleStats[mod.shortName];
    const isActive = activeModuleFilter === mod.shortName ? 'active-filter' : '';
    const inProgSub = s.inProgress > 0 ? ` • ⏳ ${s.inProgress}` : '';
    return `
      <div class="stat-card ${isActive}" onclick="setModuleFilter('${escapeAttr(mod.shortName)}')" title="Klicken, um nach ${escapeAttr(mod.fullName)} zu filtern">
        <div>
          <div class="stat-card-header">
            <span class="stat-title">${escapeHtml(mod.shortName)}</span>
            <span class="stat-pct">${s.pct}%</span>
          </div>
          <div class="stat-sub">${escapeHtml(mod.fullName)} (${s.completed}/${s.total}${inProgSub})</div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${s.pct}%;"></div>
          </div>
        </div>
        <div class="stat-doc-bar">
          <span>📁 ${s.docCount} Datei(en)</span>
          <button type="button" class="stat-doc-btn" onclick="openModuleDocsDirectly('${escapeAttr(mod.shortName)}', event)">Speicher</button>
        </div>
      </div>
    `;
  }).join('');
}

function ensureMobileCurrentWeekBanner(currentWeekIdx) {
  const viewTable = document.getElementById('viewTable');
  if (!viewTable) return;
  let banner = document.getElementById('mobileCurrentWeekBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'mobileCurrentWeekBanner';
    banner.className = 'mobile-current-week-banner no-print';
    viewTable.parentElement.insertBefore(banner, viewTable);
  }
  const idx = currentWeekIdx !== -1 ? currentWeekIdx : 0;
  const week = appState.weeks[idx];
  if (week) {
    const oneLine = week.weekLabel.replace(/\n/g, ' ');
    banner.innerHTML = `
      <span>📍 Aktuelle Woche oben: ${escapeHtml(oneLine)}</span>
      <button type="button" class="btn btn-header btn-sm" onclick="switchTab('focus'); selectCurrentCalendarWeek(true);">Zum Fokus</button>
    `;
  }
}

function renderTable(stats) {
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  const tfoot = document.getElementById('tableFoot');
  if (!thead || !tbody || !tfoot) return;

  const visibleModules = activeModuleFilter
    ? appState.modules.filter(m => m.shortName === activeModuleFilter)
    : appState.modules;

  // Kopfzeile + Zeile direkt darunter für alle Dokumente OHNE Wochenbezug pro Modulspalte
  thead.innerHTML = `
    <tr>
      <th>Semesterwoche</th>
      ${visibleModules.map(m => `<th>${escapeHtml(m.shortName)}<br><small style="font-weight:400; opacity:0.9;">${escapeHtml(m.fullName)}</small></th>`).join('')}
    </tr>
    <tr class="general-docs-row">
      <td>📌 Allgemeine Modul-Unterlagen<br><small style="font-weight:500; opacity:0.8;">(ohne Wochenbezug)</small></td>
      ${visibleModules.map(m => `<td data-module="${escapeAttr(m.shortName + ' (Allgemein)')}">${renderGeneralModuleDocsCellHtml(m.shortName)}</td>`).join('')}
    </tr>
  `;

  const searchVal = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  const currentWeekIdx = findWeekIndexByDate(new Date());
  ensureMobileCurrentWeekBanner(currentWeekIdx);

  let rowsHtml = '';
  appState.weeks.forEach((week, wIdx) => {
    const isCurrentWeek = (wIdx === currentWeekIdx);
    const rowClass = `${wIdx % 2 === 0 ? 'even-row' : 'odd-row'} ${isCurrentWeek ? 'current-week-row' : ''}`;
    let rowHasMatch = !searchVal && statusFilter === 'all';
    let cellsHtml = '';
    const mondayIso = getWeekMondayDateString(wIdx);
    const mondayDE = formatIsoDateDE(mondayIso);

    visibleModules.forEach(mod => {
      const allItems = week.cells[mod.shortName] || [];
      const filteredItems = allItems
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => {
          if (statusFilter === 'open' && (item.done || item.inProgress)) return false;
          if (statusFilter === 'in_progress' && (!item.inProgress || item.done)) return false;
          if (statusFilter === 'done' && !item.done) return false;
          if (searchVal && !item.text.toLowerCase().includes(searchVal)) return false;
          return true;
        });

      if (filteredItems.length > 0) rowHasMatch = true;
      const allDone = allItems.length > 0 && allItems.every(i => i.done);
      const cellClass = allItems.length === 0 ? 'empty-cell' : (allDone ? 'completed-cell' : '');
      const dropAttrs = `ondragover="handleCellDragOver(event)" ondragleave="handleCellDragLeave(event)" ondrop="handleCellDrop(event, ${wIdx}, '${escapeAttr(mod.shortName)}')"`;
      const shownDocIds = new Set();

      if (filteredItems.length === 0) {
        const remainingDocs = getRemainingWeekDocs(wIdx, mod.shortName, shownDocIds);
        const remainingDocsHtml = renderUnassignedWeekDocsHtml(remainingDocs);
        cellsHtml += `
          <td class="${cellClass}" data-module="${escapeAttr(mod.shortName)}" ${dropAttrs}>
            <span class="empty-dash">–</span>
            ${remainingDocsHtml}
            <button class="add-task-btn" onclick="openTaskModal(${wIdx}, '${escapeAttr(mod.shortName)}')">+ Aufgabe</button>
          </td>
        `;
      } else {
        const listHtml = filteredItems.map(({ item, idx }) => {
          const cleanItemText = stripModuleBracketsFromText(item.text, mod.shortName);
          const isTestat = /testat\s*\d+/i.test(cleanItemText);
          const badgeHtml = isTestat ? `<span class="testat-tag">TESTAT</span>` : '';
          const inProgBadge = (!item.done && item.inProgress) ? `<span class="inprogress-tag">⏳ Angefangen</span>` : '';
          const statusClass = item.done ? 'done' : (item.inProgress ? 'in-progress' : '');

          const taskDocs = getDocsForTask(wIdx, mod.shortName, cleanItemText);
          taskDocs.forEach(d => shownDocIds.add(d.id));
          const folderKey = `tbl_${wIdx}_${mod.shortName.replace(/\s+/g, '')}_${idx}`;
          const docsChipsHtml = renderTaskDocChipsHtml(taskDocs, folderKey);
          const actionMenuHtml = buildTaskActionMenuHtml(wIdx, mod.shortName, idx, item, 'tbl');

          return `
            <li class="task-item ${statusClass}"
                draggable="true"
                ondragstart="handleTaskDragStart(event, ${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})"
                ondragend="handleTaskDragEnd(event)"
                ondragover="handleTaskDragOverItem(event)"
                ondragleave="handleTaskDragLeaveItem(event)"
                ondrop="handleTaskDropOnItem(event, ${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
              <div class="task-main-row">
                <span class="drag-handle" title="Ziehen zum Verschieben (Drag & Drop)">⠿</span>
                <input type="checkbox" class="task-checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
                <span class="task-text" onclick="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
                  ${escapeHtml(cleanItemText)} ${inProgBadge} ${badgeHtml}
                </span>
                ${actionMenuHtml}
              </div>
              ${docsChipsHtml}
            </li>
          `;
        }).join('');

        const remainingDocs = getRemainingWeekDocs(wIdx, mod.shortName, shownDocIds);
        const remainingDocsHtml = renderUnassignedWeekDocsHtml(remainingDocs);
        cellsHtml += `
          <td class="${cellClass}" data-module="${escapeAttr(mod.shortName)}" ${dropAttrs}>
            <ul class="task-list">${listHtml}</ul>
            ${remainingDocsHtml}
            <button class="add-task-btn" onclick="openTaskModal(${wIdx}, '${escapeAttr(mod.shortName)}')">+ Aufgabe</button>
          </td>
        `;
      }
    });

    if (rowHasMatch) {
      const currentBadge = isCurrentWeek ? `<span class="week-badge-current">📍 Aktuelle Woche</span>` : '';
      rowsHtml += `
        <tr class="${rowClass}">
          <td class="week-col">
            <div>
              <span>${escapeHtml(week.weekLabel)}</span>
              <span class="week-mon-hint">Mo: ${mondayDE}</span>
            </div>
            ${currentBadge}
          </td>
          ${cellsHtml}
        </tr>
      `;
    }
  });

  tbody.innerHTML = rowsHtml || `<tr><td colspan="${visibleModules.length + 1}" style="text-align:center; padding: 24px;">Keine passenden Aufgaben für diesen Filter gefunden.</td></tr>`;
  tfoot.innerHTML = `
    <tr class="summary-quote-row">
      <td>📊 Lernfortschritt (%)</td>
      ${visibleModules.map(m => {
        const s = stats.moduleStats[m.shortName];
        return `<td data-module="${escapeAttr(m.shortName)}">${s.pct} % (${s.completed}/${s.total})</td>`;
      }).join('')}
    </tr>
    <tr class="summary-bar-row">
      <td>📈 Fortschritts-Balken</td>
      ${visibleModules.map(m => {
        const s = stats.moduleStats[m.shortName];
        return `
          <td data-module="${escapeAttr(m.shortName)}">
            <div class="progress-track">
              <div class="progress-fill" style="width: ${s.pct}%;"></div>
            </div>
          </td>
        `;
      }).join('')}
    </tr>
  `;
}

/* =========================================================
   DRAG & DROP (AUFGABEN VERSCHIEBEN + DOKUMENTE AUF AUFGABEN ZIEHEN)
   ========================================================= */
function handleTaskDragStart(event, weekIdx, shortName, itemIdx) {
  draggedDocId = null;
  draggedTaskInfo = { weekIdx, shortName, itemIdx };
  event.currentTarget.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', JSON.stringify(draggedTaskInfo));
}

function handleTaskDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over-cell, .drag-over-item, .doc-drop-target').forEach(el => {
    el.classList.remove('drag-over-cell', 'drag-over-item', 'doc-drop-target');
  });
}

function handleCellDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('drag-over-cell');
}

function handleCellDragLeave(event) {
  event.currentTarget.classList.remove('drag-over-cell');
}

function handleTaskDragOverItem(event) {
  event.preventDefault();
  event.stopPropagation();
  if (draggedDocId) {
    event.currentTarget.classList.add('doc-drop-target');
  } else {
    event.currentTarget.classList.add('drag-over-item');
  }
}

function handleTaskDragLeaveItem(event) {
  event.currentTarget.classList.remove('drag-over-item', 'doc-drop-target');
}

async function handleTaskDropOnItem(event, targetWeekIdx, targetMod, targetItemIdx) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over-item', 'doc-drop-target');

  // Fall 1: Ein nicht zugeordnetes Dokument wurde auf diese Aufgabe gezogen!
  const rawData = event.dataTransfer?.getData('text/plain') || '';
  if (draggedDocId || rawData.startsWith('DOC:')) {
    const docId = draggedDocId || rawData.replace('DOC:', '');
    draggedDocId = null;
    await assignDocToTaskByDragDrop(docId, targetWeekIdx, targetMod, targetItemIdx);
    return;
  }

  // Fall 2: Eine Aufgabe wurde verschoben
  await executeTaskMove(targetWeekIdx, targetMod, targetItemIdx);
}

async function handleCellDrop(event, targetWeekIdx, targetMod) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over-cell');

  const rawData = event.dataTransfer?.getData('text/plain') || '';
  if (draggedDocId || rawData.startsWith('DOC:')) {
    const docId = draggedDocId || rawData.replace('DOC:', '');
    draggedDocId = null;
    const doc = cachedDocsList.find(d => d.id === docId);
    const week = appState.weeks[targetWeekIdx];
    if (doc && week) {
      doc.module = targetMod;
      doc.weekLabel = week.weekLabel.replace(/\n/g, ' ');
      const tasks = week.cells[targetMod] || [];
      if (tasks.length === 1) {
        doc.taskText = stripModuleBracketsFromText(tasks[0].text, targetMod);
        recalculateTaskDocTitles(doc.module, doc.weekLabel, doc.taskText);
      } else {
        doc.taskText = '';
      }
      await putDocRecordInDB(doc);
      await refreshDocsCache();
      renderAll();
      showToast(`📁 Dokument in ${targetMod} (${getWeekShortName(targetWeekIdx)}) abgelegt.`);
    }
    return;
  }

  const targetList = appState.weeks[targetWeekIdx]?.cells[targetMod] || [];
  await executeTaskMove(targetWeekIdx, targetMod, targetList.length);
}

async function executeTaskMove(targetWeekIdx, targetMod, targetIndex) {
  if (!draggedTaskInfo) return;
  const { weekIdx: srcWeekIdx, shortName: srcMod, itemIdx: srcIdx } = draggedTaskInfo;
  draggedTaskInfo = null;
  const srcList = appState.weeks[srcWeekIdx]?.cells[srcMod];
  if (!srcList || !srcList[srcIdx]) return;
  const [movedItem] = srcList.splice(srcIdx, 1);
  if (!appState.weeks[targetWeekIdx].cells[targetMod]) {
    appState.weeks[targetWeekIdx].cells[targetMod] = [];
  }
  const destList = appState.weeks[targetWeekIdx].cells[targetMod];
  let insertAt = targetIndex;
  if (srcWeekIdx === targetWeekIdx && srcMod === targetMod && srcIdx < targetIndex) {
    insertAt = Math.max(0, targetIndex - 1);
  }
  destList.splice(insertAt, 0, movedItem);
  if (srcWeekIdx !== targetWeekIdx) {
    movedItem.dueDate = getWeekMondayDateString(targetWeekIdx);
  }
  saveState();
  renderAll();
  if (srcWeekIdx === targetWeekIdx && srcMod === targetMod) {
    showToast('↕️ Reihenfolge aktualisiert!');
  } else {
    showToast(`📦 Aufgabe nach ${targetMod} (${getWeekShortName(targetWeekIdx)}) verschoben!`);
    if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
      if (srcMod !== targetMod && movedItem.googleTaskId) {
        await deleteSingleTaskFromGoogle(srcMod, movedItem.googleTaskId);
        delete movedItem.googleTaskId;
        await pushSingleTaskCreateToGoogle(targetWeekIdx, targetMod, movedItem);
      } else {
        await pushSingleTaskMoveOrEditToGoogle(targetWeekIdx, targetMod, movedItem);
      }
    }
  }
}

function moveTaskOrder(weekIdx, shortName, itemIdx, direction) {
  const list = appState.weeks[weekIdx]?.cells[shortName];
  if (!list) return;
  const newIdx = itemIdx + direction;
  if (newIdx < 0 || newIdx >= list.length) return;
  const temp = list[itemIdx];
  list[itemIdx] = list[newIdx];
  list[newIdx] = temp;
  saveState();
  renderAll();
}

/* =========================================================
   TAB 2: WOCHEN-FOKUS & RÜCKSTÄNDE
   ========================================================= */
function populateFocusWeekDropdown() {
  const select = document.getElementById('focusWeekSelect');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = appState.weeks.map((w, idx) => {
    const labelOneLine = w.weekLabel.replace(/\n/g, ' ');
    return `<option value="${idx}">${escapeHtml(labelOneLine)}</option>`;
  }).join('');
  if (currentVal !== '' && appState.weeks[parseInt(currentVal, 10)]) {
    select.value = currentVal;
  }
}

function selectCurrentCalendarWeek(rerender = true) {
  const select = document.getElementById('focusWeekSelect');
  if (!select) return;
  const nowIdx = findWeekIndexByDate(new Date());
  select.value = nowIdx !== -1 ? String(nowIdx) : '0';
  if (rerender) {
    renderFocusView();
    showToast('📍 Auf aktuelle Kalenderwoche gesprungen!');
  }
}

function renderFocusView() {
  const select = document.getElementById('focusWeekSelect');
  if (!select) return;
  if (select.options.length !== appState.weeks.length) {
    populateFocusWeekDropdown();
  }
  const selIdx = parseInt(select.value, 10) || 0;
  const week = appState.weeks[selIdx];
  if (!week) return;
  const titleEl = document.getElementById('focusWeekTitle');
  const progEl = document.getElementById('focusWeekProgress');
  const upcomingContainer = document.getElementById('focusUpcomingContainer');
  const overdueContainer = document.getElementById('focusOverdueContainer');
  const mondayIso = getWeekMondayDateString(selIdx);
  if (titleEl) {
    titleEl.textContent = `${week.weekLabel.replace(/\n/g, ' ')} (Montag: ${formatIsoDateDE(mondayIso)})`;
  }
  let weekTotal = 0;
  let weekDone = 0;
  let upcomingHtml = '';

  appState.modules.forEach(mod => {
    const items = week.cells[mod.shortName] || [];
    if (items.length === 0) return;
    const shownDocIds = new Set();
    const listHtml = items.map((item, idx) => {
      weekTotal++;
      if (item.done) weekDone++;
      const cleanItemText = stripModuleBracketsFromText(item.text, mod.shortName);
      const statusClass = item.done ? 'done' : (item.inProgress ? 'in-progress' : '');
      const inProgBadge = (!item.done && item.inProgress) ? `<span class="inprogress-tag">⏳ Angefangen</span>` : '';
      const taskDocs = getDocsForTask(selIdx, mod.shortName, cleanItemText);
      taskDocs.forEach(d => shownDocIds.add(d.id));
      const folderKey = `foc_${selIdx}_${mod.shortName.replace(/\s+/g, '')}_${idx}`;
      const docsChipsHtml = renderTaskDocChipsHtml(taskDocs, folderKey);
      const actionMenuHtml = buildTaskActionMenuHtml(selIdx, mod.shortName, idx, item, 'foc');
      return `
        <li class="task-item ${statusClass}"
            ondragover="handleTaskDragOverItem(event)"
            ondragleave="handleTaskDragLeaveItem(event)"
            ondrop="handleTaskDropOnItem(event, ${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
          <div class="task-main-row">
            <input type="checkbox" class="task-checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskDone(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
            <span class="task-text" onclick="toggleTaskDone(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
              ${escapeHtml(cleanItemText)} ${inProgBadge}
            </span>
            ${actionMenuHtml}
          </div>
          ${docsChipsHtml}
        </li>
      `;
    }).join('');
    const remainingDocs = getRemainingWeekDocs(selIdx, mod.shortName, shownDocIds);
    const remainingDocsHtml = renderUnassignedWeekDocsHtml(remainingDocs);
    upcomingHtml += `
      <div class="module-focus-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h4 style="margin-bottom:0;">${escapeHtml(mod.shortName)} – ${escapeHtml(mod.fullName)}</h4>
          <button type="button" class="stat-doc-btn" onclick="openModuleDocsDirectly('${escapeAttr(mod.shortName)}', event)">📁 Modulspeicher</button>
        </div>
        <ul class="task-list">${listHtml}</ul>
        ${remainingDocsHtml}
      </div>
    `;
  });

  const weekPct = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : 0;
  if (progEl) progEl.textContent = `${weekPct} % (${weekDone}/${weekTotal} erledigt)`;
  if (upcomingContainer) {
    upcomingContainer.innerHTML = upcomingHtml || `<p style="color: var(--text-muted);">Keine Aufgaben in dieser Woche eingetragen.</p>`;
  }

  let overdueHtml = '';
  for (let wIdx = 0; wIdx < selIdx; wIdx++) {
    const pastWeek = appState.weeks[wIdx];
    const shortWeekName = pastWeek.weekLabel.split('\n')[0];
    appState.modules.forEach(mod => {
      const allItems = pastWeek.cells[mod.shortName] || [];
      const openItems = allItems
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => !item.done);
      if (openItems.length > 0) {
        const listHtml = openItems.map(({ item, idx }) => {
          const cleanItemText = stripModuleBracketsFromText(item.text, mod.shortName);
          const taskDocs = getDocsForTask(wIdx, mod.shortName, cleanItemText);
          const docsChipsHtml = renderTaskDocChipsHtml(taskDocs, `ovd_${wIdx}_${mod.shortName}_${idx}`);
          return `
            <li class="task-item ${item.inProgress ? 'in-progress' : ''}">
              <div class="task-main-row">
                <input type="checkbox" class="task-checkbox" onchange="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
                <span class="task-text" onclick="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
                  ${escapeHtml(cleanItemText)} ${item.inProgress ? '<span class="inprogress-tag">⏳ Angefangen</span>' : ''}
                </span>
              </div>
              ${docsChipsHtml}
            </li>
          `;
        }).join('');
        overdueHtml += `
          <div class="overdue-box">
            <h4>${escapeHtml(mod.shortName)} – ${escapeHtml(shortWeekName)}</h4>
            <ul class="task-list">${listHtml}</ul>
          </div>
        `;
      }
    });
  }
  if (overdueContainer) {
    overdueContainer.innerHTML = overdueHtml || `<p style="color: var(--success-text); font-weight: 600;">🎉 Alles erledigt! Keine offenen Rückstände aus den Vorwochen.</p>`;
  }
}

/* =========================================================
   AUFGABEN ABHAKEN, HINZUFÜGEN & BEARBEITEN
   ========================================================= */
function toggleTaskDone(weekIdx, shortName, itemIdx) {
  const items = appState.weeks[weekIdx]?.cells[shortName];
  if (!items || !items[itemIdx]) return;
  const item = items[itemIdx];
  item.done = !item.done;
  if (item.done) item.inProgress = false;
  saveState();
  renderAll();
  if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
    pushSingleTaskToggleToGoogle(weekIdx, shortName, item);
  }
}

function toggleTaskInProgress(weekIdx, shortName, itemIdx) {
  const items = appState.weeks[weekIdx]?.cells[shortName];
  if (!items || !items[itemIdx]) return;
  const item = items[itemIdx];
  item.inProgress = !item.inProgress;
  if (item.inProgress && item.done) {
    item.done = false;
    if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
      pushSingleTaskToggleToGoogle(weekIdx, shortName, item);
    }
  }
  saveState();
  renderAll();
  showToast(item.inProgress ? '⏳ Aufgabe als „Angefangen“ markiert!' : '⬜ Status „Angefangen“ aufgehoben.');
}

function populateModalDropdowns() {
  const modSelect = document.getElementById('taskModuleSelect');
  const weekSelect = document.getElementById('taskWeekSelect');
  if (modSelect) {
    modSelect.innerHTML = appState.modules.map(m =>
      `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} – ${escapeHtml(m.fullName)}</option>`
    ).join('');
  }
  if (weekSelect) {
    weekSelect.innerHTML = appState.weeks.map((w, idx) => {
      const monDE = formatIsoDateDE(getWeekMondayDateString(idx));
      return `<option value="${idx}">${escapeHtml(w.weekLabel.replace(/\n/g, ' '))} – Mo, ${monDE}</option>`;
    }).join('');
  }
}

function updateTaskPositionOptions(selectedPos = null) {
  const posSelect = document.getElementById('taskPositionSelect');
  const modVal = document.getElementById('taskModuleSelect')?.value;
  const weekIdx = parseInt(document.getElementById('taskWeekSelect')?.value || '0', 10);
  if (!posSelect || !modVal || isNaN(weekIdx)) return;
  const existingItems = appState.weeks[weekIdx]?.cells[modVal] || [];
  const options = [`<option value="0">1. An erster Stelle (ganz oben)</option>`];
  existingItems.forEach((it, idx) => {
    const shortTxt = it.text.length > 38 ? it.text.slice(0, 38) + '…' : it.text;
    options.push(`<option value="${idx + 1}">${idx + 2}. Nach „${escapeHtml(shortTxt)}“</option>`);
  });
  posSelect.innerHTML = options.join('');
  if (selectedPos !== null && selectedPos >= 0 && selectedPos <= existingItems.length) {
    posSelect.value = String(selectedPos);
  } else {
    posSelect.value = String(existingItems.length);
  }
}

function openTaskModal(preselectedWeekIdx = null, preselectedModule = null) {
  populateModalDropdowns();
  document.getElementById('taskModalTitle').textContent = '➕ Neue Aufgabe hinzufügen';
  document.getElementById('editTaskWeekIdx').value = '';
  document.getElementById('editTaskOrigModule').value = '';
  document.getElementById('editTaskItemIdx').value = '';
  document.getElementById('deleteTaskModalBtn').style.display = 'none';
  const nowIdx = findWeekIndexByDate(new Date());
  const targetWeek = (preselectedWeekIdx !== null && !isNaN(preselectedWeekIdx))
    ? preselectedWeekIdx
    : (nowIdx !== -1 ? nowIdx : 0);
  document.getElementById('taskWeekSelect').value = String(targetWeek);
  document.getElementById('taskModuleSelect').value = preselectedModule || appState.modules[0].shortName;
  updateTaskPositionOptions();
  document.getElementById('taskTextInput').value = '';
  document.getElementById('taskDueDateInput').value = getWeekMondayDateString(targetWeek);
  document.getElementById('taskSyncCalendarCheck').checked = true;
  document.getElementById('taskDoneCheck').checked = false;
  const inProgEl = document.getElementById('taskInProgressCheck');
  if (inProgEl) inProgEl.checked = false;
  openModal('taskModal');
  setTimeout(() => document.getElementById('taskTextInput')?.focus(), 80);
}

function openEditTaskModal(weekIdx, shortName, itemIdx) {
  const item = appState.weeks[weekIdx]?.cells[shortName]?.[itemIdx];
  if (!item) return;
  populateModalDropdowns();
  document.getElementById('taskModalTitle').textContent = '✏️ Aufgabe & Status bearbeiten';
  document.getElementById('editTaskWeekIdx').value = String(weekIdx);
  document.getElementById('editTaskOrigModule').value = shortName;
  document.getElementById('editTaskItemIdx').value = String(itemIdx);
  document.getElementById('deleteTaskModalBtn').style.display = 'inline-flex';
  document.getElementById('taskWeekSelect').value = String(weekIdx);
  document.getElementById('taskModuleSelect').value = shortName;
  updateTaskPositionOptions(itemIdx);
  document.getElementById('taskTextInput').value = stripModuleBracketsFromText(item.text, shortName);
  document.getElementById('taskDueDateInput').value = item.dueDate || getWeekMondayDateString(weekIdx);
  document.getElementById('taskSyncCalendarCheck').checked = item.syncCalendar !== false;
  document.getElementById('taskDoneCheck').checked = !!item.done;
  const inProgEl = document.getElementById('taskInProgressCheck');
  if (inProgEl) inProgEl.checked = !!item.inProgress && !item.done;
  openModal('taskModal');
  setTimeout(() => document.getElementById('taskTextInput')?.focus(), 80);
}

function saveTaskFromModal() {
  const textInput = document.getElementById('taskTextInput');
  const targetMod = document.getElementById('taskModuleSelect').value;
  const rawText = (textInput.value || '').trim().replace(/^[✅⏳]\s*/, '');
  const cleanText = stripModuleBracketsFromText(rawText, targetMod);
  if (!cleanText) {
    showToast('⚠️ Bitte eine Aufgabenbeschreibung eingeben.');
    textInput.focus();
    return;
  }
  const targetWeekIdx = parseInt(document.getElementById('taskWeekSelect').value, 10);
  const targetPos = parseInt(document.getElementById('taskPositionSelect')?.value || '0', 10);
  const mondayDefault = getWeekMondayDateString(targetWeekIdx);
  const dueDate = document.getElementById('taskDueDateInput').value || mondayDefault;
  const syncCalendar = document.getElementById('taskSyncCalendarCheck').checked;
  const done = document.getElementById('taskDoneCheck').checked;
  const inProgress = !done && !!document.getElementById('taskInProgressCheck')?.checked;
  const origWeekStr = document.getElementById('editTaskWeekIdx').value;
  const origMod = document.getElementById('editTaskOrigModule').value;
  const origItemStr = document.getElementById('editTaskItemIdx').value;

  if (!appState.weeks[targetWeekIdx].cells[targetMod]) {
    appState.weeks[targetWeekIdx].cells[targetMod] = [];
  }
  if (origWeekStr !== '' && origItemStr !== '') {
    const origWeekIdx = parseInt(origWeekStr, 10);
    const origItemIdx = parseInt(origItemStr, 10);
    const existingItem = appState.weeks[origWeekIdx]?.cells[origMod]?.[origItemIdx];
    if (existingItem) {
      existingItem.text = cleanText;
      existingItem.dueDate = (origWeekIdx !== targetWeekIdx && dueDate === getWeekMondayDateString(origWeekIdx))
        ? mondayDefault
        : dueDate;
      existingItem.syncCalendar = syncCalendar;
      existingItem.done = done;
      existingItem.inProgress = inProgress;
      appState.weeks[origWeekIdx].cells[origMod].splice(origItemIdx, 1);
      const destList = appState.weeks[targetWeekIdx].cells[targetMod];
      const boundedPos = Math.min(Math.max(0, targetPos), destList.length);
      destList.splice(boundedPos, 0, existingItem);
      saveState();
      renderAll();
      closeModal('taskModal');
      showToast('💾 Aufgabe aktualisiert!');
      if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
        pushSingleTaskMoveOrEditToGoogle(targetWeekIdx, targetMod, existingItem);
      }
      return;
    }
  }
  const newItem = {
    text: cleanText,
    done: done,
    inProgress: inProgress,
    dueDate: dueDate,
    syncCalendar: syncCalendar
  };
  const destList = appState.weeks[targetWeekIdx].cells[targetMod];
  const boundedPos = Math.min(Math.max(0, targetPos), destList.length);
  destList.splice(boundedPos, 0, newItem);
  saveState();
  renderAll();
  closeModal('taskModal');
  showToast(`✅ Aufgabe in ${targetMod} eingefügt!`);
  if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
    pushSingleTaskCreateToGoogle(targetWeekIdx, targetMod, newItem);
  }
}

function deleteTaskFromModal() {
  const origWeekStr = document.getElementById('editTaskWeekIdx').value;
  const origMod = document.getElementById('editTaskOrigModule').value;
  const origItemStr = document.getElementById('editTaskItemIdx').value;
  if (origWeekStr === '' || origItemStr === '') return;
  closeModal('taskModal');
  deleteTaskItem(parseInt(origWeekStr, 10), origMod, parseInt(origItemStr, 10));
}

function deleteTaskItem(weekIdx, shortName, itemIdx) {
  const items = appState.weeks[weekIdx]?.cells[shortName];
  if (!items || !items[itemIdx]) return;
  const removed = items.splice(itemIdx, 1)[0];
  if (removed.googleTaskId) {
    if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
      deleteSingleTaskFromGoogle(shortName, removed.googleTaskId);
    } else {
      appState.deletedGoogleTaskIds = appState.deletedGoogleTaskIds || [];
      appState.deletedGoogleTaskIds.push({ shortName, taskId: removed.googleTaskId });
    }
  }
  saveState();
  renderAll();
  showToast('🗑️ Aufgabe gelöscht.');
}

async function syncAndClean() {
  showLoading('Bereinige Aufgaben & synchronisiere mit Google...');
  try {
    const seenTestateGlobal = new Set();
    for (const week of appState.weeks) {
      for (const mod of appState.modules) {
        const items = week.cells[mod.shortName] || [];
        const seenInCell = new Set();
        const cleaned = [];
        for (const item of items) {
          const cleanLine = stripModuleBracketsFromText(item.text, mod.shortName)
            .replace(/^[✅⏳📅]\s*/, '')
            .replace(new RegExp(`^${mod.shortName}\\s*(\\([^)]*\\))?:?\\s*`, 'i'), '')
            .trim();
          const lowerClean = cleanLine.toLowerCase();
          if (!cleanLine || seenInCell.has(lowerClean)) continue;
          seenInCell.add(lowerClean);
          if (/^testat\s*\d+$/i.test(lowerClean)) {
            if (seenTestateGlobal.has(lowerClean)) continue;
            seenTestateGlobal.add(lowerClean);
          }
          item.text = cleanLine;
          cleaned.push(item);
        }
        week.cells[mod.shortName] = cleaned;
      }
    }
    await sanitizeAndDeduplicateDocsSilent();
    saveState();
    renderAll();
    if (typeof syncWithGoogleTasksAPI === 'function') {
      await syncWithGoogleTasksAPI(false);
    }
  } finally {
    hideLoading();
  }
}

/* =========================================================
   TAB 4: E-MAIL BRIEFING GENERATOR & PDF-EXPORT
   ========================================================= */
function buildEmailHtmlObject() {
  const statsObj = calculateStats();
  const selEl = document.getElementById('focusWeekSelect');
  const selIdx = selEl ? (parseInt(selEl.value, 10) || 0) : 0;
  const week = appState.weeks[selIdx] || appState.weeks[0];
  const upcomingWeekLabel = week.weekLabel.replace(/\n/g, ' ');
  const mondayStr = formatIsoDateDE(getWeekMondayDateString(selIdx));
  const currentThemeKey = document.documentElement.getAttribute('data-theme') || 'rose';
  const themeObj = THEMES[currentThemeKey] || THEMES.rose;
  const primaryColor = themeObj.colors[0];
  const darkColor = themeObj.colors[1];
  const lightBg = themeObj.light;
  const borderCol = themeObj.border;
  let upcomingTasksHtml = '';
  let plainTextLines = [`DEIN SEMESTERPLAN-UPDATE: ${upcomingWeekLabel} (Wochenstart Mo, ${mondayStr})`, '====================================', '', 'AUFGABEN DIESER WOCHE:'];
  for (const mod of appState.modules) {
    const items = week.cells[mod.shortName] || [];
    if (items.length > 0) {
      const itemsHtml = items.map(i => {
        const icon = i.done ? '✅ ' : (i.inProgress ? '⏳ ' : '⬜ ');
        const cleanTxt = stripModuleBracketsFromText(i.text, mod.shortName);
        return `<li>${icon}${escapeHtml(cleanTxt)}</li>`;
      }).join('');
      upcomingTasksHtml += `
        <div style="margin-bottom: 14px; padding: 12px; background-color: ${lightBg}; border-left: 4px solid ${primaryColor}; border-radius: 6px;">
          <strong style="color: ${darkColor}; font-size: 15px;">${escapeHtml(mod.shortName)} – ${escapeHtml(mod.fullName)}</strong>
          <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #333;">${itemsHtml}</ul>
        </div>`;
      plainTextLines.push(`\n${mod.shortName} (${mod.fullName}):`);
      items.forEach(i => plainTextLines.push(` - ${i.done ? '(erledigt)' : (i.inProgress ? '(angefangen)' : '(offen)')} ${stripModuleBracketsFromText(i.text, mod.shortName)}`));
    }
  }
  if (!upcomingTasksHtml) {
    upcomingTasksHtml = '<p style="color: #555;">Für diese Woche stehen laut Semesterplan keine Aufgaben an.</p>';
  }
  let overdueTasksHtml = '';
  for (let wIdx = 0; wIdx < selIdx; wIdx++) {
    const pastWeek = appState.weeks[wIdx];
    const weekShort = pastWeek.weekLabel.split('\n')[0].trim();
    for (const mod of appState.modules) {
      const openLines = (pastWeek.cells[mod.shortName] || []).filter(l => !l.done);
      if (openLines.length > 0) {
        const openHtml = openLines.map(l => `<li>${l.inProgress ? '⏳ ' : ''}${escapeHtml(stripModuleBracketsFromText(l.text, mod.shortName))}</li>`).join('');
        overdueTasksHtml += `
          <div style="margin-bottom: 8px;">
            <strong>${escapeHtml(mod.shortName)} (${escapeHtml(weekShort)}):</strong>
            <ul style="margin: 4px 0 8px 0; padding-left: 20px;">${openHtml}</ul>
          </div>`;
      }
    }
  }
  let progressHtml = '';
  for (const mod of appState.modules) {
    const s = statsObj.moduleStats[mod.shortName];
    progressHtml += `
      <div style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 3px;">
          <strong>${escapeHtml(s.shortName)}</strong>
          <span>${s.pct} % (${s.completed}/${s.total} erledigt${s.inProgress ? `, ${s.inProgress} angefangen` : ''})</span>
        </div>
        <div style="width: 100%; background-color: ${borderCol}; border-radius: 6px; height: 10px; overflow: hidden;">
          <div style="width: ${s.pct}%; background-color: ${primaryColor}; height: 10px;"></div>
        </div>
      </div>`;
  }
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid ${borderCol}; border-radius: 10px; overflow: hidden; background: #FFFFFF;">
      <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${darkColor} 100%); color: #FFFFFF; padding: 18px 24px;">
        <h2 style="margin: 0; font-size: 20px;">Dein Semesterplan-Briefing</h2>
        <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(upcomingWeekLabel)} • Wochenstart am Montag (${mondayStr})</p>
      </div>
      <div style="padding: 20px 24px; color: #2C3E50;">
        <h3 style="margin-top: 0; color: ${primaryColor}; border-bottom: 1px solid ${borderCol}; padding-bottom: 6px;">Aufgaben für diese Woche</h3>
        ${upcomingTasksHtml}
        <h3 style="margin-top: 24px; color: ${primaryColor}; border-bottom: 1px solid ${borderCol}; padding-bottom: 6px;">Dein aktueller Gesamt-Lernfortschritt (${statsObj.overallPct} %)</h3>
        ${progressHtml}
        ${overdueTasksHtml ? `
          <h3 style="margin-top: 24px; color: #B03A2E; border-bottom: 1px solid #F5B7B1; padding-bottom: 6px;">Noch offen aus Vorwochen</h3>
          <div style="background-color: #FDEDEC; padding: 12px; border-radius: 6px; font-size: 13px; color: #2C3E50;">
            ${overdueTasksHtml}
          </div>
        ` : ''}
      </div>
    </div>`;
  return {
    subject: `Semesterplan-Briefing: ${upcomingWeekLabel} (${statsObj.overallPct}% erledigt)`,
    htmlBody,
    plainText: plainTextLines.join('\n')
  };
}

function renderEmailPreview() {
  const container = document.getElementById('emailPreviewContainer');
  if (!container || !appState) return;
  const { htmlBody } = buildEmailHtmlObject();
  container.innerHTML = htmlBody;
  const autoCheck = document.getElementById('autoWeeklyEmailCheck');
  if (autoCheck) {
    autoCheck.checked = localStorage.getItem('semesterplan_auto_weekly_email') !== 'false';
  }
  const lastSent = localStorage.getItem('semesterplan_last_auto_email_date');
  const infoEl = document.getElementById('lastAutoEmailInfo');
  if (infoEl) {
    infoEl.textContent = lastSent
      ? `✅ Letztes automatisches Wochen-Briefing gesendet am: ${lastSent}`
      : `ℹ️ Automatischer Versand ist bereit und wird bei aktiver Google-Verbindung zum Wochenstart/Sonntag ausgelöst.`;
  }
}

function toggleAutoWeeklyEmail(enabled) {
  localStorage.setItem('semesterplan_auto_weekly_email', enabled ? 'true' : 'false');
  const pill = document.getElementById('emailStatusPill');
  if (pill) {
    pill.textContent = enabled ? '📩 Wochen-Mail: Aktiv' : '📩 Wochen-Mail: Pausiert';
  }
  showToast(enabled ? '📩 Automatische wöchentliche E-Mail aktiviert!' : '⏸️ Automatische wöchentliche E-Mail pausiert.');
}

function triggerMailtoFallback() {
  const { subject, plainText } = buildEmailHtmlObject();
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
}

function openPdfModal() {
  const currentThemeKey = document.documentElement.getAttribute('data-theme') || 'rose';
  const themeObj = THEMES[currentThemeKey] || THEMES.rose;
  const labelEl = document.getElementById('pdfThemeNameLabel');
  if (labelEl) labelEl.textContent = themeObj.label;
  updatePdfPreview();
  openModal('pdfModal');
}

function updatePdfPreview() {
  const previewBox = document.getElementById('pdfPreviewBox');
  if (!previewBox) return;
  const includeDashboard = document.getElementById('pdfIncludeDashboard')?.checked !== false;
  const compactMode = document.getElementById('pdfCompactMode')?.checked === true;
  const stats = calculateStats();
  const dashboardClone = includeDashboard
    ? `<div class="dashboard-grid" style="margin-bottom: 16px;">${document.getElementById('dashboardCards')?.innerHTML || ''}</div>`
    : '';
  const tableClone = document.getElementById('viewTable')?.outerHTML || '';
  previewBox.className = `pdf-preview-box ${compactMode ? 'pdf-compact-cards' : ''}`;
  previewBox.innerHTML = `
    <div id="pdfRenderTarget" class="pdf-render-target">
      <div class="pdf-custom-header">
        <div>
          <h2>🎓 Semesterplan – WiSe 26/27</h2>
          <p>Gesamtfortschritt: ${stats.overallPct} % (${stats.overallCompleted} von ${stats.overallTotal} Aufgaben erledigt)</p>
        </div>
        <span class="pdf-date-stamp">Stand: ${formatDateDE(new Date())}</span>
      </div>
      ${dashboardClone}
      ${tableClone}
    </div>
  `;
}

async function downloadThemedPdfFile() {
  const target = document.getElementById('pdfRenderTarget');
  const btn = document.getElementById('downloadPdfBtn');
  if (!target) return;
  if (typeof html2pdf === 'undefined') {
    printWithThemeColors();
    return;
  }
  const origText = btn ? btn.textContent : '';
  showLoading('Erstelle farbiges PDF-Dokument...');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Farb-PDF wird erstellt...';
  }
  try {
    const bgPage = getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim() || '#FAF6F6';
    const opt = {
      margin: [8, 8, 8, 8],
      filename: `Semesterplan_WiSe26_27_${new Date().toISOString().slice(0, 10)}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: bgPage },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };
    await html2pdf().set(opt).from(target).save();
    closeModal('pdfModal');
    showToast('✅ Farbiges PDF erfolgreich heruntergeladen!');
  } catch (e) {
    printWithThemeColors();
  } finally {
    hideLoading();
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

function printWithThemeColors() {
  closeModal('pdfModal');
  setTimeout(() => window.print(), 200);
}

/* =========================================================
   JSON BACKUP EXPORT & IMPORT
   ========================================================= */
function exportJSONBackup() {
  const dataStr = JSON.stringify(appState, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Semesterplan_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  showToast('⬇️ JSON-Backup erfolgreich gespeichert!');
}

function importJSONBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported && Array.isArray(imported.modules) && Array.isArray(imported.weeks)) {
        appState = imported;
        saveState();
        renderAll();
        closeModal('googleSetupModal');
        showToast('✅ JSON-Backup erfolgreich wiederhergestellt!');
      } else {
        showToast('❌ Ungültiges Backup-Format.');
      }
    } catch (err) {
      showToast('❌ Datei konnte nicht gelesen werden.');
    }
  };
  reader.readAsText(file);
}

/* =========================================================
   UI HELFER (MODALS, TOAST, ESCAPING)
   ========================================================= */
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str ?? '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

window.addEventListener('DOMContentLoaded', initApp);