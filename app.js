/* =========================================================
   HAUPTLOGIK DER SEMESTERPLAN WEB-APP (app.js)
   (Inkl. Drag & Drop, Reihenfolgen-Wahl, Seiten-Menüleiste,
    Montags-Kalenderlogik, IndexedDB-Modulspeicher & neuen Themes)
   ========================================================= */
const STORAGE_KEY = 'semesterplan_app_state_v3';
const THEME_KEY = 'semesterplan_theme';
const DOCS_DB_NAME = 'semesterplan_files_db';
const DOCS_STORE_NAME = 'module_documents';

const THEMES = {
  rose:       { label: 'Original Rosa',           colors: ['#C66A7A', '#8E3A49', '#FAF6F6'], light: '#F9EFEF', border: '#F0E1E4' },
  berry:      { label: 'Berry Velvet',            colors: ['#DB2777', '#831843', '#FDF2F8'], light: '#FCE7F3', border: '#FBCFE8' },
  mocha:      { label: 'Café Mocha (Cool Taupe)', colors: ['#6E5D56', '#423532', '#F7F5F4'], light: '#EFECEB', border: '#DDD6D4' },
  sage:       { label: 'Nordic Sage (Analog)',    colors: ['#5E8C76', '#2E5242', '#F4F8F6'], light: '#EAF2EE', border: '#CFE0D8' },
  ocean:      { label: 'Aegean Ocean (Kühl)',     colors: ['#3A6EA5', '#1E3A5F', '#F5F8FC'], light: '#EBF2FA', border: '#D0E0F2' },
  lavender:   { label: 'Provence Lavender',       colors: ['#7E6BC4', '#46357D', '#F8F7FC'], light: '#F1EFFA', border: '#DFD9F2' },
  terracotta: { label: 'Tuscan Terracotta',       colors: ['#C26D53', '#853F2A', '#FBF7F5'], light: '#F9EFEA', border: '#EEDAD2' },
  nordic:     { label: 'Nordic Fjord',            colors: ['#3B7A8C', '#1F4854', '#F4F8F9'], light: '#E9F2F5', border: '#CCE0E6' },
  pearl:      { label: 'Rose Quartz & Pearl',     colors: ['#B57C86', '#6B444C', '#FBF8F9'], light: '#F6EEF0', border: '#E8D8DC' },
  dark:       { label: 'Midnight Velvet (Dark)',  colors: ['#D97789', '#F3A6B4', '#141216'], light: '#2A2125', border: '#3D2F35' }
};

let appState = null;
let activeModuleFilter = null;
let currentTab = 'table';
let draggedTaskInfo = null;
let cachedDocsList = [];

async function initApp() {
  // 1. Zuerst Status laden
  loadState();

  // 2. Farbschemata im Header & Seitenmenü aufbauen
  buildThemeMenuUI();
  const savedTheme = localStorage.getItem(THEME_KEY) || 'rose';
  changeTheme(savedTheme, false);

  // 3. Handy-Ansicht wiederherstellen (falls aktiv)
  if (localStorage.getItem('semesterplan_iphone_view') === 'true') {
    document.body.classList.add('iphone-view-mode');
    updateIphoneBtnState();
  }

  // 4. Uhrzeit aktualisieren
  updateIosClock();
  setInterval(updateIosClock, 30000);

  // 5. Dropdowns initialisieren
  populateFocusWeekDropdown();
  populateDocsFilterDropdowns();
  selectCurrentCalendarWeek(false);

  // 6. Gespeicherte Modul-Dokumente aus IndexedDB laden
  await refreshDocsCache();

  // 7. Oberfläche zeichnen
  renderAll();

  // Klick außerhalb schließt Farbdesign-Menü
  document.addEventListener('click', (e) => {
    const container = document.getElementById('themeDropdownContainer');
    const menu = document.getElementById('themeMenu');
    if (container && menu && !container.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });
}

function updateIosClock() {
  const el = document.getElementById('iosClock');
  if (!el) return;
  const now = new Date();
  el.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
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
   SEITEN-MENÜLEISTE (SIDE DRAWER) & THEMES
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
  const menu = document.getElementById('themeMenu');
  if (menu) menu.classList.toggle('hidden');
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
  localStorage.setItem('semesterplan_iphone_view', isIphone ? 'true' : 'false');
  updateIphoneBtnState();
  showToast(isIphone ? '📱 Handy-Ansicht mit Seitenmenü aktiviert' : '💻 Desktop-Tabellenansicht aktiviert');
}

function updateIphoneBtnState() {
  const btn = document.getElementById('iphoneViewBtn');
  const isIphone = document.body.classList.contains('iphone-view-mode');
  if (btn) btn.textContent = isIphone ? '💻 Desktop-Ansicht' : '📱 Handy-Ansicht';
}

function switchTab(tabName) {
  currentTab = tabName;
  document.getElementById('viewTable')?.classList.toggle('hidden', tabName !== 'table');
  document.getElementById('viewFocus')?.classList.toggle('hidden', tabName !== 'focus');
  document.getElementById('viewDocs')?.classList.toggle('hidden', tabName !== 'docs');
  document.getElementById('viewEmail')?.classList.toggle('hidden', tabName !== 'email');
  document.getElementById('tableFilters')?.classList.toggle('hidden', tabName !== 'table');
  document.getElementById('dragHintBanner')?.classList.toggle('hidden', tabName !== 'table');

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

/* =========================================================
   DATUM-HILFSFUNKTIONEN (ALLE AUFGABEN AM MONTAG DER WOCHE)
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
  for (const mod of appState.modules) {
    moduleStats[mod.shortName] = {
      shortName: mod.shortName,
      fullName: mod.fullName,
      total: 0,
      completed: 0,
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
        }
      }
    }
  }
  for (const mod of appState.modules) {
    const s = moduleStats[mod.shortName];
    s.pct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  }
  const overallPct = overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 100) : 0;
  return { moduleStats, overallTotal, overallCompleted, overallPct };
}

/* =========================================================
   RENDERING: DASHBOARD, TABELLE, FOKUS, DOKUMENTE & E-MAIL
   ========================================================= */
function renderAll() {
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
    statusEl.textContent = `Gesamtfortschritt: ${stats.overallPct} % (${stats.overallCompleted}/${stats.overallTotal} erledigt)`;
  }
  const container = document.getElementById('dashboardCards');
  if (!container) return;
  container.innerHTML = appState.modules.map(mod => {
    const s = stats.moduleStats[mod.shortName];
    const isActive = activeModuleFilter === mod.shortName ? 'active-filter' : '';
    return `
      <div class="stat-card ${isActive}" onclick="setModuleFilter('${escapeAttr(mod.shortName)}')" title="Klicken, um nach ${escapeAttr(mod.fullName)} zu filtern">
        <div class="stat-card-header">
          <span class="stat-title">${escapeHtml(mod.shortName)}</span>
          <span class="stat-pct">${s.pct}%</span>
        </div>
        <div class="stat-sub">${escapeHtml(mod.fullName)} (${s.completed}/${s.total})</div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${s.pct}%;"></div>
        </div>
        <div class="stat-doc-bar">
          <span>📁 ${s.docCount} Unterlage(n)</span>
          <button type="button" class="stat-doc-btn" onclick="openModuleDocsDirectly('${escapeAttr(mod.shortName)}', event)">Speicher öffnen</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderTable(stats) {
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  const tfoot = document.getElementById('tableFoot');
  if (!thead || !tbody || !tfoot) return;

  const visibleModules = activeModuleFilter
    ? appState.modules.filter(m => m.shortName === activeModuleFilter)
    : appState.modules;

  thead.innerHTML = `
    <tr>
      <th>Semesterwoche</th>
      ${visibleModules.map(m => `<th>${escapeHtml(m.shortName)}<br><small style="font-weight:400; opacity:0.9;">${escapeHtml(m.fullName)}</small></th>`).join('')}
    </tr>
  `;

  const searchVal = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  const currentWeekIdx = findWeekIndexByDate(new Date());

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
          if (statusFilter === 'open' && item.done) return false;
          if (statusFilter === 'done' && !item.done) return false;
          if (searchVal && !item.text.toLowerCase().includes(searchVal)) return false;
          return true;
        });

      if (filteredItems.length > 0) rowHasMatch = true;
      const allDone = allItems.length > 0 && allItems.every(i => i.done);
      const cellClass = allItems.length === 0 ? 'empty-cell' : (allDone ? 'completed-cell' : '');

      const dropAttrs = `ondragover="handleCellDragOver(event)" ondragleave="handleCellDragLeave(event)" ondrop="handleCellDrop(event, ${wIdx}, '${escapeAttr(mod.shortName)}')"`;

      if (filteredItems.length === 0) {
        cellsHtml += `
          <td class="${cellClass}" data-module="${escapeAttr(mod.shortName)}" ${dropAttrs}>
            <span class="empty-dash">–</span>
            <button class="add-task-btn" onclick="openTaskModal(${wIdx}, '${escapeAttr(mod.shortName)}')">+ Aufgabe</button>
          </td>
        `;
      } else {
        const listHtml = filteredItems.map(({ item, idx }) => {
          const isTestat = /testat\s*\d+/i.test(item.text);
          const badgeHtml = isTestat ? `<span class="testat-tag">TESTAT</span>` : '';
          const effectiveDate = item.dueDate || mondayIso;
          const dateHtml = `<span class="date-tag" title="Kalenderdatum (Montag der Woche)">📅 Mo, ${formatIsoDateDE(effectiveDate)}</span>`;

          return `
            <li class="task-item ${item.done ? 'done' : ''}"
                draggable="true"
                ondragstart="handleTaskDragStart(event, ${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})"
                ondragend="handleTaskDragEnd(event)"
                ondragover="handleTaskDragOverItem(event)"
                ondragleave="handleTaskDragLeaveItem(event)"
                ondrop="handleTaskDropOnItem(event, ${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
              <span class="drag-handle" title="Ziehen zum Verschieben (Drag & Drop)">⠿</span>
              <input type="checkbox" class="task-checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
              <span class="task-text" onclick="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
                ${escapeHtml(item.text)} ${badgeHtml} ${dateHtml}
              </span>
              <div class="task-actions">
                <button class="task-action-btn" title="Nach oben" onclick="moveTaskOrder(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx}, -1)">↑</button>
                <button class="task-action-btn" title="Nach unten" onclick="moveTaskOrder(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx}, 1)">↓</button>
                <button class="task-action-btn" title="Bearbeiten" onclick="openEditTaskModal(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">✏️</button>
                <button class="task-action-btn" title="Löschen" onclick="deleteTaskItem(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">🗑️</button>
              </div>
            </li>
          `;
        }).join('');

        cellsHtml += `
          <td class="${cellClass}" data-module="${escapeAttr(mod.shortName)}" ${dropAttrs}>
            <ul class="task-list">${listHtml}</ul>
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
              <span class="week-mon-hint">🗓️ Mo: ${mondayDE}</span>
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
   DRAG & DROP UND REIHENFOLGEN-ÄNDERUNG
   ========================================================= */
function handleTaskDragStart(event, weekIdx, shortName, itemIdx) {
  draggedTaskInfo = { weekIdx, shortName, itemIdx };
  event.currentTarget.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', JSON.stringify(draggedTaskInfo));
}

function handleTaskDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over-cell, .drag-over-item').forEach(el => {
    el.classList.remove('drag-over-cell', 'drag-over-item');
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
  event.currentTarget.classList.add('drag-over-item');
}

function handleTaskDragLeaveItem(event) {
  event.currentTarget.classList.remove('drag-over-item');
}

async function handleTaskDropOnItem(event, targetWeekIdx, targetMod, targetItemIdx) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-over-item');
  await executeTaskMove(targetWeekIdx, targetMod, targetItemIdx);
}

async function handleCellDrop(event, targetWeekIdx, targetMod) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over-cell');
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

  // Wenn die Woche gewechselt wurde, altes Datum zurücksetzen, damit der neue Montag gilt
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
    titleEl.textContent = `📅 ${week.weekLabel.replace(/\n/g, ' ')} (Kalender-Montag: ${formatIsoDateDE(mondayIso)})`;
  }

  let weekTotal = 0;
  let weekDone = 0;
  let upcomingHtml = '';

  appState.modules.forEach(mod => {
    const items = week.cells[mod.shortName] || [];
    if (items.length === 0) return;
    const listHtml = items.map((item, idx) => {
      weekTotal++;
      if (item.done) weekDone++;
      const dateStr = formatIsoDateDE(item.dueDate || mondayIso);
      return `
        <li class="task-item ${item.done ? 'done' : ''}">
          <input type="checkbox" class="task-checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskDone(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
          <span class="task-text" onclick="toggleTaskDone(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
            <strong>[${escapeHtml(mod.shortName)}]</strong> ${escapeHtml(item.text)}
            <span class="date-tag">📅 Mo, ${dateStr}</span>
          </span>
          <div class="task-actions">
            <button class="task-action-btn" onclick="moveTaskOrder(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx}, -1)">↑</button>
            <button class="task-action-btn" onclick="moveTaskOrder(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx}, 1)">↓</button>
            <button class="task-action-btn" onclick="openEditTaskModal(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">✏️</button>
            <button class="task-action-btn" onclick="deleteTaskItem(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">🗑️</button>
          </div>
        </li>
      `;
    }).join('');
    upcomingHtml += `
      <div class="module-focus-card">
        <h4>${escapeHtml(mod.shortName)} – ${escapeHtml(mod.fullName)}</h4>
        <ul class="task-list">${listHtml}</ul>
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
        const listHtml = openItems.map(({ item, idx }) => `
          <li class="task-item">
            <input type="checkbox" class="task-checkbox" onchange="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
            <span class="task-text" onclick="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">${escapeHtml(item.text)}</span>
          </li>
        `).join('');
        overdueHtml += `
          <div class="overdue-box">
            <h4>${escapeHtml(mod.shortName)} (${escapeHtml(shortWeekName)})</h4>
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
   AUFGABEN ABHAKEN, HINZUFÜGEN (MIT REIHENFOLGE), BEARBEITEN
   ========================================================= */
function toggleTaskDone(weekIdx, shortName, itemIdx) {
  const items = appState.weeks[weekIdx]?.cells[shortName];
  if (!items || !items[itemIdx]) return;
  const item = items[itemIdx];
  item.done = !item.done;
  saveState();
  renderAll();
  if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
    pushSingleTaskToggleToGoogle(weekIdx, shortName, item);
  }
}

function populateModalDropdowns() {
  const modSelect = document.getElementById('taskModuleSelect');
  const weekSelect = document.getElementById('taskWeekSelect');
  if (modSelect) {
    modSelect.innerHTML = appState.modules.map(m =>
      `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} (${escapeHtml(m.fullName)})</option>`
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
  const options = [];
  options.push(`<option value="0">1. An erster Stelle (ganz oben)</option>`);
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

  openModal('taskModal');
  setTimeout(() => document.getElementById('taskTextInput')?.focus(), 80);
}

function openEditTaskModal(weekIdx, shortName, itemIdx) {
  const item = appState.weeks[weekIdx]?.cells[shortName]?.[itemIdx];
  if (!item) return;
  populateModalDropdowns();
  document.getElementById('taskModalTitle').textContent = '✏️ Aufgabe & Position bearbeiten';
  document.getElementById('editTaskWeekIdx').value = String(weekIdx);
  document.getElementById('editTaskOrigModule').value = shortName;
  document.getElementById('editTaskItemIdx').value = String(itemIdx);
  document.getElementById('deleteTaskModalBtn').style.display = 'inline-flex';

  document.getElementById('taskWeekSelect').value = String(weekIdx);
  document.getElementById('taskModuleSelect').value = shortName;
  updateTaskPositionOptions(itemIdx);

  document.getElementById('taskTextInput').value = item.text;
  document.getElementById('taskDueDateInput').value = item.dueDate || getWeekMondayDateString(weekIdx);
  document.getElementById('taskSyncCalendarCheck').checked = item.syncCalendar !== false;
  document.getElementById('taskDoneCheck').checked = !!item.done;

  openModal('taskModal');
  setTimeout(() => document.getElementById('taskTextInput')?.focus(), 80);
}

function saveTaskFromModal() {
  const textInput = document.getElementById('taskTextInput');
  const cleanText = (textInput.value || '').trim().replace(/^✅\s*/, '');
  if (!cleanText) {
    showToast('⚠️ Bitte eine Aufgabenbeschreibung eingeben.');
    textInput.focus();
    return;
  }

  const targetWeekIdx = parseInt(document.getElementById('taskWeekSelect').value, 10);
  const targetMod = document.getElementById('taskModuleSelect').value;
  const targetPos = parseInt(document.getElementById('taskPositionSelect')?.value || '0', 10);
  const mondayDefault = getWeekMondayDateString(targetWeekIdx);
  const dueDate = document.getElementById('taskDueDateInput').value || mondayDefault;
  const syncCalendar = document.getElementById('taskSyncCalendarCheck').checked;
  const done = document.getElementById('taskDoneCheck').checked;

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

      appState.weeks[origWeekIdx].cells[origMod].splice(origItemIdx, 1);
      const destList = appState.weeks[targetWeekIdx].cells[targetMod];
      const boundedPos = Math.min(Math.max(0, targetPos), destList.length);
      destList.splice(boundedPos, 0, existingItem);

      saveState();
      renderAll();
      closeModal('taskModal');
      showToast('💾 Aufgabe & Reihenfolge aktualisiert!');
      if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
        pushSingleTaskMoveOrEditToGoogle(targetWeekIdx, targetMod, existingItem);
      }
      return;
    }
  }

  const newItem = {
    text: cleanText,
    done: done,
    dueDate: dueDate,
    syncCalendar: syncCalendar
  };

  const destList = appState.weeks[targetWeekIdx].cells[targetMod];
  const boundedPos = Math.min(Math.max(0, targetPos), destList.length);
  destList.splice(boundedPos, 0, newItem);

  saveState();
  renderAll();
  closeModal('taskModal');
  showToast(`✅ Aufgabe an Position ${boundedPos + 1} in ${targetMod} eingefügt!`);

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

function syncAndClean() {
  const seenTestateGlobal = new Set();
  for (const week of appState.weeks) {
    for (const mod of appState.modules) {
      const items = week.cells[mod.shortName] || [];
      const seenInCell = new Set();
      const cleaned = [];
      for (const item of items) {
        const cleanLine = item.text
          .replace(/^✅\s*/, '')
          .replace(new RegExp(`^\\[?${mod.shortName}\\]?\\s*(\\([^)]*\\))?:?\\s*`, 'i'), '')
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
  saveState();
  renderAll();
  if (typeof syncWithGoogleTasksAPI === 'function') {
    syncWithGoogleTasksAPI(false);
  }
}

/* =========================================================
   MODUL-DOKUMENTENSPEICHER (INDEXEDDB FÜR PDF, FOLIEN, ÜBUNGEN)
   ========================================================= */
function openDocsDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DOCS_DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DOCS_STORE_NAME)) {
        db.createObjectStore(DOCS_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function refreshDocsCache() {
  try {
    const db = await openDocsDatabase();
    cachedDocsList = await new Promise((resolve, reject) => {
      const tx = db.transaction(DOCS_STORE_NAME, 'readonly');
      const store = tx.objectStore(DOCS_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    cachedDocsList.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  } catch (e) {
    console.warn('IndexedDB Dokumentenspeicher nicht verfügbar:', e);
    cachedDocsList = [];
  }
}

function populateDocsFilterDropdowns() {
  const filterMod = document.getElementById('docsModuleFilter');
  if (filterMod) {
    filterMod.innerHTML = `<option value="all">Alle Module anzeigen</option>` +
      appState.modules.map(m => `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} – ${escapeHtml(m.fullName)}</option>`).join('');
  }
}

function openUploadDocModal(preselectedMod = null) {
  const modSel = document.getElementById('docModuleSelect');
  const weekSel = document.getElementById('docWeekSelect');
  if (modSel) {
    modSel.innerHTML = appState.modules.map(m =>
      `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} (${escapeHtml(m.fullName)})</option>`
    ).join('');
    if (preselectedMod) modSel.value = preselectedMod;
  }
  if (weekSel) {
    weekSel.innerHTML = `<option value="">Allgemein / Ohne feste Woche</option>` +
      appState.weeks.map(w => {
        const oneLine = w.weekLabel.replace(/\n/g, ' ');
        return `<option value="${escapeAttr(oneLine)}">${escapeHtml(oneLine)}</option>`;
      }).join('');
  }
  document.getElementById('docCustomTitle').value = '';
  document.getElementById('docFileInput').value = '';
  openModal('uploadDocModal');
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleSaveUploadedDocs() {
  const fileInput = document.getElementById('docFileInput');
  const files = fileInput?.files;
  if (!files || files.length === 0) {
    showToast('⚠️ Bitte mindestens eine Datei auswählen.');
    return;
  }
  const moduleName = document.getElementById('docModuleSelect').value;
  const category = document.getElementById('docCategorySelect').value;
  const weekName = document.getElementById('docWeekSelect').value;
  const customTitle = document.getElementById('docCustomTitle').value.trim();

  try {
    const db = await openDocsDatabase();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await readFileAsDataURL(file);
      const docRecord = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        module: moduleName,
        category: category,
        weekLabel: weekName,
        title: customTitle && files.length === 1 ? customTitle : file.name,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        dataUrl: dataUrl,
        uploadedAt: Date.now()
      };
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DOCS_STORE_NAME, 'readwrite');
        tx.objectStore(DOCS_STORE_NAME).put(docRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    await refreshDocsCache();
    closeModal('uploadDocModal');
    renderAll();
    showToast(`📁 ${files.length} Dokument(e) in ${moduleName} gespeichert!`);
  } catch (e) {
    console.error('Fehler beim Speichern des Dokuments:', e);
    showToast('❌ Fehler beim Speichern der Datei.');
  }
}

async function deleteModuleDoc(docId) {
  try {
    const db = await openDocsDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DOCS_STORE_NAME, 'readwrite');
      tx.objectStore(DOCS_STORE_NAME).delete(docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await refreshDocsCache();
    renderAll();
    showToast('🗑️ Dokument aus Modulspeicher entfernt.');
  } catch (e) {
    console.error(e);
  }
}

function previewModuleDoc(docId) {
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;
  document.getElementById('docPreviewTitle').textContent = `📄 ${doc.module}: ${doc.title}`;
  const body = document.getElementById('docPreviewBody');
  const dlBtn = document.getElementById('docPreviewDownloadBtn');
  dlBtn.href = doc.dataUrl;
  dlBtn.download = doc.fileName || doc.title;

  if (doc.mimeType.includes('pdf')) {
    body.innerHTML = `<iframe src="${doc.dataUrl}" style="width:100%; height:65vh; border:none; border-radius:8px;"></iframe>`;
  } else if (doc.mimeType.startsWith('image/')) {
    body.innerHTML = `<img src="${doc.dataUrl}" alt="${escapeAttr(doc.title)}" style="max-width:100%; max-height:65vh; border-radius:8px;">`;
  } else {
    body.innerHTML = `
      <div style="text-align:center; padding:30px;">
        <p style="font-size:3rem; margin-bottom:10px;">📦</p>
        <h4>${escapeHtml(doc.title)}</h4>
        <p style="color:var(--text-muted); margin-top:6px;">Dateityp: ${escapeHtml(doc.mimeType)} (${formatFileSize(doc.sizeBytes)})</p>
        <p style="margin-top:12px;">Klicke unten rechts auf <strong>„Datei herunterladen“</strong>, um diese Datei zu öffnen.</p>
      </div>
    `;
  }
  openModal('docPreviewModal');
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderModuleDocsView() {
  const grid = document.getElementById('moduleDocsGrid');
  if (!grid) return;

  const modFilter = document.getElementById('docsModuleFilter')?.value || 'all';
  const catFilter = document.getElementById('docsCategoryFilter')?.value || 'all';

  const modulesToShow = modFilter === 'all'
    ? appState.modules
    : appState.modules.filter(m => m.shortName === modFilter);

  grid.innerHTML = modulesToShow.map(mod => {
    const docsForMod = cachedDocsList.filter(d =>
      d.module === mod.shortName &&
      (catFilter === 'all' || d.category === catFilter)
    );

    const listHtml = docsForMod.length === 0
      ? `<p style="font-size:0.8rem; color:var(--text-muted); padding:10px 0;">Noch keine Dokumente für ${escapeHtml(mod.shortName)} hinterlegt.</p>`
      : docsForMod.map(doc => `
          <div class="doc-item-card">
            <div class="doc-item-info">
              <div class="doc-item-title" title="${escapeAttr(doc.title)}">📄 ${escapeHtml(doc.title)}</div>
              <div class="doc-item-meta">
                <span class="doc-cat-badge">${escapeHtml(doc.category)}</span>
                ${doc.weekLabel ? `<span>• ${escapeHtml(doc.weekLabel.split('(')[0].trim())}</span>` : ''}
                <span>• ${formatFileSize(doc.sizeBytes)}</span>
              </div>
            </div>
            <div class="doc-item-actions">
              <button class="btn btn-outline btn-sm" onclick="previewModuleDoc('${escapeAttr(doc.id)}')" title="Vorschau">👁️</button>
              <a class="btn btn-outline btn-sm" href="${doc.dataUrl}" download="${escapeAttr(doc.fileName || doc.title)}" title="Herunterladen">⬇️</a>
              <button class="btn btn-danger-outline btn-sm" onclick="deleteModuleDoc('${escapeAttr(doc.id)}')" title="Löschen">🗑️</button>
            </div>
          </div>
        `).join('');

    return `
      <div class="module-doc-column">
        <div class="module-doc-col-header">
          <div>
            <h3>📁 ${escapeHtml(mod.shortName)}</h3>
            <small style="color:var(--text-muted); font-size:0.75rem;">${escapeHtml(mod.fullName)}</small>
          </div>
          <button class="btn btn-outline btn-sm" onclick="openUploadDocModal('${escapeAttr(mod.shortName)}')">+ Datei</button>
        </div>
        ${listHtml}
      </div>
    `;
  }).join('');
}

/* =========================================================
   TAB 4: E-MAIL BRIEFING GENERATOR & AUTOMATIK-STATUS
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
      const itemsHtml = items.map(i => `<li>${i.done ? '✅ ' : '⬜ '}<strong>[${escapeHtml(mod.shortName)}]</strong> ${escapeHtml(i.text)} (Kalender: Mo, ${formatIsoDateDE(i.dueDate || getWeekMondayDateString(selIdx))})</li>`).join('');
      upcomingTasksHtml += `
        <div style="margin-bottom: 14px; padding: 12px; background-color: ${lightBg}; border-left: 4px solid ${primaryColor}; border-radius: 6px;">
          <strong style="color: ${darkColor}; font-size: 15px;">${escapeHtml(mod.shortName)} (${escapeHtml(mod.fullName)})</strong>
          <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #333;">${itemsHtml}</ul>
        </div>`;
      plainTextLines.push(`\n[${mod.shortName}]`);
      items.forEach(i => plainTextLines.push(` - ${i.done ? '[x]' : '[ ]'} ${i.text}`));
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
        const openHtml = openLines.map(l => `<li>${escapeHtml(l.text)}</li>`).join('');
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
          <span>${s.pct} % (${s.completed}/${s.total} erledigt)</span>
        </div>
        <div style="width: 100%; background-color: ${borderCol}; border-radius: 6px; height: 10px; overflow: hidden;">
          <div style="width: ${s.pct}%; background-color: ${primaryColor}; height: 10px;"></div>
        </div>
      </div>`;
  }

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid ${borderCol}; border-radius: 10px; overflow: hidden; background: #FFFFFF;">
      <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${darkColor} 100%); color: #FFFFFF; padding: 18px 24px;">
        <h2 style="margin: 0; font-size: 20px;">🎓 Dein Semesterplan-Briefing</h2>
        <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(upcomingWeekLabel)} • Kalender-Eintrag am Montag (${mondayStr})</p>
      </div>
      <div style="padding: 20px 24px; color: #2C3E50;">
        <h3 style="margin-top: 0; color: ${primaryColor}; border-bottom: 1px solid ${borderCol}; padding-bottom: 6px;">📅 Aufgaben für diese Woche</h3>
        ${upcomingTasksHtml}
        <h3 style="margin-top: 24px; color: ${primaryColor}; border-bottom: 1px solid ${borderCol}; padding-bottom: 6px;">📊 Dein aktueller Gesamt-Lernfortschritt (${statsObj.overallPct} %)</h3>
        ${progressHtml}
        ${overdueTasksHtml ? `
          <h3 style="margin-top: 24px; color: #B03A2E; border-bottom: 1px solid #F5B7B1; padding-bottom: 6px;">⚠️ Noch offen aus Vorwochen</h3>
          <div style="background-color: #FDEDEC; padding: 12px; border-radius: 6px; font-size: 13px; color: #2C3E50;">
            ${overdueTasksHtml}
          </div>
        ` : ''}
      </div>
    </div>`;

  return {
    subject: `🎓 Semesterplan-Briefing: ${upcomingWeekLabel} (${statsObj.overallPct}% erledigt)`,
    htmlBody,
    plainText: plainTextLines.join('\n')
  };
}

function renderEmailPreview() {
  const container = document.getElementById('emailPreviewContainer');
  if (!container) return;
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

/* =========================================================
   FARBIGER PDF-EXPORT MIT VORSCHAU-MODAL
   ========================================================= */
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