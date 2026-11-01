/* =========================================================
   HAUPTLOGIK DER SEMESTERPLAN WEB-APP (app.js)
   - Ohne "Mo, Datum"-Badge bei einzelnen Aufgaben
   - Direkter Zugriff auf dazugehörige Dokumente (Vorschau & Upload)
     direkt in der Aufgaben-Übersicht (Tabelle & Wochen-Fokus)
   - Status "Angefangen" (inProgress) für Aufgaben
   - Intelligente Wochen- & Kategorie-Einsortierung beim Datei-Upload
     inkl. Rückfrage/Bestätigung für jedes einzelne Dokument
   - Dokumenten-Kategorie "Lösungen" & 5 dunkle Farbschemata
   ========================================================= */
const STORAGE_KEY = 'semesterplan_app_state_v3';
const THEME_KEY = 'semesterplan_theme';
const DOCS_DB_NAME = 'semesterplan_files_db';
const DOCS_STORE_NAME = 'module_documents';

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

const DOC_CATEGORIES = [
  { value: 'Vorlesung', label: '📖 Vorlesung' },
  { value: 'Übung', label: '✍️ Übung' },
  { value: 'Lösungen', label: '✅ Lösungen' },
  { value: 'Hörsaalübung', label: '🏛️ Hörsaalübung' },
  { value: 'Testat / Praktikum', label: '🔬 Testat / Praktikum' },
  { value: 'Klausur / Zusammenfassung', label: '🎓 Klausur / Zusammenfassung' }
];

let appState = null;
let activeModuleFilter = null;
let currentTab = 'table';
let draggedTaskInfo = null;
let cachedDocsList = [];
let pendingUploadPlans = [];

async function initApp() {
  loadState();
  document.getElementById('dragHintBanner')?.remove();
  ensureExtendedUIElements();

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
    const container = document.getElementById('themeDropdownContainer');
    const menu = document.getElementById('themeMenu');
    if (container && menu && !container.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });
}

function ensureExtendedUIElements() {
  const statusFilter = document.getElementById('statusFilter');
  if (statusFilter && !statusFilter.querySelector('option[value="in_progress"]')) {
    const opt = document.createElement('option');
    opt.value = 'in_progress';
    opt.textContent = '⏳ Nur angefangene';
    const openOpt = statusFilter.querySelector('option[value="open"]');
    if (openOpt && openOpt.nextSibling) {
      statusFilter.insertBefore(opt, openOpt.nextSibling);
    } else {
      statusFilter.appendChild(opt);
    }
  }

  const doneCheck = document.getElementById('taskDoneCheck');
  if (doneCheck && !document.getElementById('taskInProgressCheck')) {
    const group = doneCheck.closest('.checkbox-group');
    if (group) {
      const label = document.createElement('label');
      label.className = 'checkbox-label';
      label.innerHTML = `
        <input type="checkbox" id="taskInProgressCheck" onchange="if(this.checked) document.getElementById('taskDoneCheck').checked = false;">
        <span>Aufgabe bereits angefangen / in Bearbeitung (⏳)</span>
      `;
      group.insertBefore(label, doneCheck.closest('label'));
      doneCheck.addEventListener('change', function() {
        if (this.checked) {
          const inProg = document.getElementById('taskInProgressCheck');
          if (inProg) inProg.checked = false;
        }
      });
    }
  }

  const fileInput = document.getElementById('docFileInput');
  if (fileInput) {
    fileInput.onchange = handleDocFilesSelected;
    if (!document.getElementById('docSmartPreviewList')) {
      const previewContainer = document.createElement('div');
      previewContainer.id = 'docSmartPreviewList';
      previewContainer.className = 'smart-sort-preview-list';
      fileInput.parentElement.appendChild(previewContainer);
    }
  }
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
  showToast(isIphone ? '📱 Handy-Ansicht aktiviert' : '💻 Desktop-Tabellenansicht aktiviert');
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
   DOKUMENTEN-VERKNÜPFUNG FÜR AUFGABEN & WOCHENZELLEN
   ========================================================= */
function getDocsForTask(weekIdx, shortName, taskText) {
  if (!Array.isArray(cachedDocsList) || cachedDocsList.length === 0) return [];
  const week = appState.weeks[weekIdx];
  const weekOneLine = week ? week.weekLabel.replace(/\n/g, ' ').trim() : '';
  const weekShort = week ? week.weekLabel.split('\n')[0].trim().toLowerCase() : '';
  const modDocs = cachedDocsList.filter(d => d.module === shortName);
  if (modDocs.length === 0) return [];

  const tokenRegex = /\b(v\s*\d+|le\s*\d+|üb\s*\d+|ueb\s*\d+|ü\s*\d+|hsü\s*\d+|hsu\s*\d+|testat\s*\d+|2-\d{2}|typ\s*[a-j])\b/gi;
  const taskTokens = (taskText.match(tokenRegex) || []).map(t =>
    t.toLowerCase().replace(/ueb|^ü(?=\s*\d)/, 'üb').replace(/hsu/, 'hsü').replace(/\s+/g, '')
  );

  const taskLower = taskText.toLowerCase();
  const isVorlesung = taskLower.includes('vorlesung') || /\b(v\s*\d+|le\s*\d+|2-\d{2})\b/i.test(taskText);
  const isUebung = /\b(übung|uebung|üb\s*\d+|aufgabensammlung)\b/i.test(taskText) && !taskLower.includes('hörsaal');
  const isHsu = /\b(hörsaalübung|hsü)\b/i.test(taskText);
  const isTestat = /\b(testat|praktikum|selfassessment)\b/i.test(taskText);

  return modDocs.filter(doc => {
    const docNameNorm = (doc.title + ' ' + (doc.fileName || '')).toLowerCase()
      .replace(/ueb/g, 'üb').replace(/hsu/g, 'hsü').replace(/\s+/g, '');

    // 1. Direkter Treffer über gleiches Kürzel (z.B. ÜB 3, V4, LE 5, Testat 2)
    if (taskTokens.length > 0 && taskTokens.some(tok => docNameNorm.includes(tok))) {
      return true;
    }

    // 2. Treffer über gleiche Semesterwoche + passende Kategorie
    const docWeek = (doc.weekLabel || '').trim();
    const sameWeek = docWeek && (docWeek === weekOneLine || docWeek.toLowerCase().startsWith(weekShort));
    if (sameWeek) {
      if (isVorlesung && doc.category === 'Vorlesung') return true;
      if (isUebung && (doc.category === 'Übung' || doc.category === 'Lösungen')) return true;
      if (isHsu && (doc.category === 'Hörsaalübung' || doc.category === 'Lösungen')) return true;
      if (isTestat && (doc.category === 'Testat / Praktikum' || doc.category === 'Lösungen')) return true;
      const cellTasks = week?.cells?.[shortName] || [];
      if (cellTasks.length === 1) return true;
    }
    return false;
  });
}

function getRemainingWeekDocs(weekIdx, shortName, alreadyShownDocIds) {
  if (!Array.isArray(cachedDocsList) || cachedDocsList.length === 0) return [];
  const week = appState.weeks[weekIdx];
  if (!week) return [];
  const weekOneLine = week.weekLabel.replace(/\n/g, ' ').trim();
  const weekShort = week.weekLabel.split('\n')[0].trim().toLowerCase();

  return cachedDocsList.filter(doc => {
    if (doc.module !== shortName) return false;
    if (alreadyShownDocIds && alreadyShownDocIds.has(doc.id)) return false;
    const docWeek = (doc.weekLabel || '').trim();
    return docWeek && (docWeek === weekOneLine || docWeek.toLowerCase().startsWith(weekShort));
  });
}

function renderTaskDocChipsHtml(docs) {
  if (!docs || docs.length === 0) return '';
  const chips = docs.map(doc => {
    const isSol = doc.category === 'Lösungen';
    const icon = isSol ? '✅' : '📄';
    return `
      <button type="button"
              class="task-doc-chip ${isSol ? 'solution-chip' : ''}"
              onclick="event.stopPropagation(); previewModuleDoc('${escapeAttr(doc.id)}')"
              title="${escapeAttr(doc.category + ': ' + doc.title)} (Klicken zur Vorschau)">
        <span>${icon}</span>
        <span class="task-doc-chip-title">${escapeHtml(doc.title)}</span>
      </button>
    `;
  }).join('');
  return `<div class="task-docs-row">${chips}</div>`;
}

function openUploadDocForTask(weekIdx, shortName, itemIdx, event) {
  if (event) event.stopPropagation();
  const week = appState.weeks[weekIdx];
  const item = week?.cells?.[shortName]?.[itemIdx];
  openUploadDocModal(shortName);

  if (week) {
    const weekSel = document.getElementById('docWeekSelect');
    const oneLine = week.weekLabel.replace(/\n/g, ' ');
    if (weekSel) weekSel.value = oneLine;
  }
  if (item) {
    const catSel = document.getElementById('docCategorySelect');
    const txt = item.text.toLowerCase();
    if (catSel) {
      if (txt.includes('hörsaal') || txt.includes('hsü')) catSel.value = 'Hörsaalübung';
      else if (txt.includes('übung') || txt.includes('üb ')) catSel.value = 'Übung';
      else if (txt.includes('testat')) catSel.value = 'Testat / Praktikum';
      else catSel.value = 'Vorlesung';
    }
    const titleInput = document.getElementById('docCustomTitle');
    if (titleInput) titleInput.placeholder = `Unterlage zu: ${item.text}`;
  }
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
   RENDERING: DASHBOARD, TABELLE, FOKUS, DOKUMENTE & E-MAIL
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
        <div class="stat-card-header">
          <span class="stat-title">${escapeHtml(mod.shortName)}</span>
          <span class="stat-pct">${s.pct}%</span>
        </div>
        <div class="stat-sub">${escapeHtml(mod.fullName)} (${s.completed}/${s.total}${inProgSub})</div>
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
        const remainingDocsHtml = remainingDocs.length > 0
          ? `<div class="cell-docs-footer">${renderTaskDocChipsHtml(remainingDocs)}</div>`
          : '';
        cellsHtml += `
          <td class="${cellClass}" data-module="${escapeAttr(mod.shortName)}" ${dropAttrs}>
            <span class="empty-dash">–</span>
            ${remainingDocsHtml}
            <button class="add-task-btn" onclick="openTaskModal(${wIdx}, '${escapeAttr(mod.shortName)}')">+ Aufgabe</button>
          </td>
        `;
      } else {
        const listHtml = filteredItems.map(({ item, idx }) => {
          const isTestat = /testat\s*\d+/i.test(item.text);
          const badgeHtml = isTestat ? `<span class="testat-tag">TESTAT</span>` : '';
          const inProgBadge = (!item.done && item.inProgress) ? `<span class="inprogress-tag">⏳ Angefangen</span>` : '';
          const statusClass = item.done ? 'done' : (item.inProgress ? 'in-progress' : '');

          const taskDocs = getDocsForTask(wIdx, mod.shortName, item.text);
          taskDocs.forEach(d => shownDocIds.add(d.id));
          const docsChipsHtml = renderTaskDocChipsHtml(taskDocs);

          return `
            <li class="task-item ${statusClass}"
                draggable="true"
                ondragstart="handleTaskDragStart(event, ${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})"
                ondragend="handleTaskDragEnd(event)"
                ondragover="handleTaskDragOverItem(event)"
                ondragleave="handleTaskDragLeaveItem(event)"
                ondrop="handleTaskDropOnItem(event, ${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
              <span class="drag-handle" title="Ziehen zum Verschieben (Drag & Drop)">⠿</span>
              <input type="checkbox" class="task-checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
              <span class="task-text" onclick="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
                ${escapeHtml(item.text)} ${inProgBadge} ${badgeHtml}
                ${docsChipsHtml}
              </span>
              <div class="task-actions">
                <button class="task-action-btn" title="Dokument zu dieser Aufgabe hochladen" onclick="openUploadDocForTask(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx}, event)">📎</button>
                <button class="task-action-btn ${item.inProgress && !item.done ? 'active-progress' : ''}" title="Als angefangen markieren / aufheben" onclick="toggleTaskInProgress(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">⏳</button>
                <button class="task-action-btn" title="Nach oben" onclick="moveTaskOrder(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx}, -1)">↑</button>
                <button class="task-action-btn" title="Nach unten" onclick="moveTaskOrder(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx}, 1)">↓</button>
                <button class="task-action-btn" title="Bearbeiten" onclick="openEditTaskModal(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">✏️</button>
                <button class="task-action-btn" title="Löschen" onclick="deleteTaskItem(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">🗑️</button>
              </div>
            </li>
          `;
        }).join('');

        const remainingDocs = getRemainingWeekDocs(wIdx, mod.shortName, shownDocIds);
        const remainingDocsHtml = remainingDocs.length > 0
          ? `<div class="cell-docs-footer">${renderTaskDocChipsHtml(remainingDocs)}</div>`
          : '';

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
   TAB 2: WOCHEN-FOKUS & RÜCKSTÄNDE (INKL. DOKUMENTEN-ZUGRIFF)
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
      const statusClass = item.done ? 'done' : (item.inProgress ? 'in-progress' : '');
      const inProgBadge = (!item.done && item.inProgress) ? `<span class="inprogress-tag">⏳ Angefangen</span>` : '';

      const taskDocs = getDocsForTask(selIdx, mod.shortName, item.text);
      taskDocs.forEach(d => shownDocIds.add(d.id));
      const docsChipsHtml = renderTaskDocChipsHtml(taskDocs);

      return `
        <li class="task-item ${statusClass}">
          <input type="checkbox" class="task-checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskDone(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
          <span class="task-text" onclick="toggleTaskDone(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
            <strong>[${escapeHtml(mod.shortName)}]</strong> ${escapeHtml(item.text)} ${inProgBadge}
            ${docsChipsHtml}
          </span>
          <div class="task-actions">
            <button class="task-action-btn" title="Dokument zu dieser Aufgabe hochladen" onclick="openUploadDocForTask(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx}, event)">📎</button>
            <button class="task-action-btn ${item.inProgress && !item.done ? 'active-progress' : ''}" onclick="toggleTaskInProgress(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">⏳</button>
            <button class="task-action-btn" onclick="moveTaskOrder(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx}, -1)">↑</button>
            <button class="task-action-btn" onclick="moveTaskOrder(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx}, 1)">↓</button>
            <button class="task-action-btn" onclick="openEditTaskModal(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">✏️</button>
            <button class="task-action-btn" onclick="deleteTaskItem(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">🗑️</button>
          </div>
        </li>
      `;
    }).join('');

    const remainingDocs = getRemainingWeekDocs(selIdx, mod.shortName, shownDocIds);
    const remainingDocsHtml = remainingDocs.length > 0
      ? `<div class="cell-docs-footer">${renderTaskDocChipsHtml(remainingDocs)}</div>`
      : '';

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
          const taskDocs = getDocsForTask(wIdx, mod.shortName, item.text);
          const docsChipsHtml = renderTaskDocChipsHtml(taskDocs);
          return `
            <li class="task-item ${item.inProgress ? 'in-progress' : ''}">
              <input type="checkbox" class="task-checkbox" onchange="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
              <span class="task-text" onclick="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
                ${escapeHtml(item.text)} ${item.inProgress ? '<span class="inprogress-tag">⏳ Angefangen</span>' : ''}
                ${docsChipsHtml}
              </span>
            </li>
          `;
        }).join('');
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
   AUFGABEN ABHAKEN, ALS ANGEFANGEN MARKIEREN, HINZUFÜGEN & BEARBEITEN
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
  ensureExtendedUIElements();
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
  ensureExtendedUIElements();
  populateModalDropdowns();
  document.getElementById('taskModalTitle').textContent = '✏️ Aufgabe & Status bearbeiten';
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
  const inProgEl = document.getElementById('taskInProgressCheck');
  if (inProgEl) inProgEl.checked = !!item.inProgress && !item.done;

  openModal('taskModal');
  setTimeout(() => document.getElementById('taskTextInput')?.focus(), 80);
}

function saveTaskFromModal() {
  const textInput = document.getElementById('taskTextInput');
  const cleanText = (textInput.value || '').trim().replace(/^[✅⏳]\s*/, '');
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

function syncAndClean() {
  const seenTestateGlobal = new Set();
  for (const week of appState.weeks) {
    for (const mod of appState.modules) {
      const items = week.cells[mod.shortName] || [];
      const seenInCell = new Set();
      const cleaned = [];
      for (const item of items) {
        const cleanLine = item.text
          .replace(/^[✅⏳📅]\s*/, '')
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
   MODUL-DOKUMENTENSPEICHER & INTELLIGENTE WOCHEN-EINSORTIERUNG
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
  const filterCat = document.getElementById('docsCategoryFilter');
  if (filterCat) {
    filterCat.innerHTML = `<option value="all">Alle Kategorien</option>` +
      DOC_CATEGORIES.map(c => `<option value="${escapeAttr(c.value)}">${escapeHtml(c.label)}</option>`).join('');
  }
}

function openUploadDocModal(preselectedMod = null) {
  ensureExtendedUIElements();
  const modSel = document.getElementById('docModuleSelect');
  const catSel = document.getElementById('docCategorySelect');
  const weekSel = document.getElementById('docWeekSelect');

  if (modSel) {
    modSel.innerHTML = appState.modules.map(m =>
      `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} (${escapeHtml(m.fullName)})</option>`
    ).join('');
    if (preselectedMod) modSel.value = preselectedMod;
  }
  if (catSel) {
    catSel.innerHTML = DOC_CATEGORIES.map(c =>
      `<option value="${escapeAttr(c.value)}">${escapeHtml(c.label)}</option>`
    ).join('');
  }
  if (weekSel) {
    weekSel.innerHTML = `<option value="">Automatisch erkennen / Allgemein</option>` +
      appState.weeks.map(w => {
        const oneLine = w.weekLabel.replace(/\n/g, ' ');
        return `<option value="${escapeAttr(oneLine)}">${escapeHtml(oneLine)}</option>`;
      }).join('');
  }

  document.getElementById('docCustomTitle').value = '';
  document.getElementById('docFileInput').value = '';
  pendingUploadPlans = [];
  const previewEl = document.getElementById('docSmartPreviewList');
  if (previewEl) previewEl.innerHTML = '';
  openModal('uploadDocModal');
}

function analyzeFileForSmartSorting(fileName, fallbackModule, fallbackCategory, fallbackWeekLabel) {
  const cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/[_\-]+/g, ' ');
  const lower = cleanName.toLowerCase();

  let detectedModule = fallbackModule || appState.modules[0]?.shortName || 'ModSim';
  const modPatterns = [
    { mod: 'ModSim', regex: /\b(modsim|modellierung|simulation|fem|numpy|python|awp|rwp|2-\d{2})\b/i },
    { mod: 'Informatik', regex: /\b(info|informatik|programmierung|le\s*\d+|ringtausch|oop|polymorphismus|verkettete)\b/i },
    { mod: 'Elektro', regex: /\b(elektro|elektrotechnik|elektronik|kirchhoff|ohm|kondensator|spule|wechselstrom|diode|transistor|operationsverst)\b/i },
    { mod: 'Mathe 2', regex: /\b(mathe|hm\s*2|komplexe|euler|gauß|gauss|matrizen|determinante|eigenwert|hesse|taylor|fubini)\b/i },
    { mod: 'CAD', regex: /\b(cad|testat|toleranz|passung|oberfl|wellenlagerung|maschinenelemente|typ\s*[a-j])\b/i }
  ];
  for (const mp of modPatterns) {
    if (mp.regex.test(cleanName)) {
      detectedModule = mp.mod;
      break;
    }
  }

  let detectedCategory = fallbackCategory || 'Vorlesung';
  if (/(lösung|loesung|musterlösung|musterloesung|solution|lös\b|loes\b)/i.test(cleanName)) {
    detectedCategory = 'Lösungen';
  } else if (/(hsü|hsu|hörsaal|hoersaal)/i.test(cleanName)) {
    detectedCategory = 'Hörsaalübung';
  } else if (/(üb|ueb|übung|uebung|blatt|aufgabe)/i.test(cleanName)) {
    detectedCategory = 'Übung';
  } else if (/(testat|praktikum|labor)/i.test(cleanName)) {
    detectedCategory = 'Testat / Praktikum';
  } else if (/(klausur|altklausur|zusammenfassung|formelsammlung|skript)/i.test(cleanName)) {
    detectedCategory = 'Klausur / Zusammenfassung';
  } else if (/(vorlesung|folien|\bv\s*\d+|\ble\s*\d+)/i.test(cleanName)) {
    detectedCategory = 'Vorlesung';
  }

  let detectedWeekLabel = fallbackWeekLabel || '';
  let matchReason = 'Standard-Auswahl';

  const directWeekMatch = cleanName.match(/\b(?:woche|week|w)\s*(\d{1,2})\b/i);
  if (directWeekMatch) {
    const wNum = parseInt(directWeekMatch[1], 10);
    if (wNum >= 1 && wNum <= appState.weeks.length) {
      detectedWeekLabel = appState.weeks[wNum - 1].weekLabel.replace(/\n/g, ' ');
      matchReason = `Wochennummer „Woche ${wNum}“ im Dateinamen erkannt`;
    }
  }

  if (!detectedWeekLabel || matchReason === 'Standard-Auswahl') {
    const tokenRegex = /\b(v\s*\d+|le\s*\d+|üb\s*\d+|ueb\s*\d+|ü\s*\d+|hsü\s*\d+|hsu\s*\d+|testat\s*\d+|2-\d{2}|typ\s*[a-j])\b/gi;
    const tokens = (cleanName.match(tokenRegex) || []).map(t =>
      t.toLowerCase().replace(/ueb|^ü(?=\s*\d)/, 'üb').replace(/hsu/, 'hsü').replace(/\s+/g, '')
    );

    let bestScore = 0;
    let bestWeek = null;
    let bestToken = '';

    for (const week of appState.weeks) {
      const modItems = week.cells[detectedModule] || [];
      for (const item of modItems) {
        const itemNorm = item.text.toLowerCase().replace(/\s+/g, '');
        let score = 0;
        for (const tok of tokens) {
          if (itemNorm.includes(tok)) {
            score += 10;
            bestToken = tok.toUpperCase();
          }
        }
        const words = lower.split(/\s+/).filter(w => w.length >= 4 && !['vorlesung', 'übung', 'uebung', 'lösung', 'loesung'].includes(w));
        for (const w of words) {
          if (item.text.toLowerCase().includes(w)) {
            score += 4;
            if (!bestToken) bestToken = w;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestWeek = week;
        }
      }
    }

    if (bestWeek && bestScore > 0) {
      detectedWeekLabel = bestWeek.weekLabel.replace(/\n/g, ' ');
      matchReason = `Automatisch zugeordnet über „${bestToken}“ in ${detectedModule}`;
    } else if (!detectedWeekLabel) {
      const nowIdx = findWeekIndexByDate(new Date());
      if (nowIdx !== -1) {
        detectedWeekLabel = appState.weeks[nowIdx].weekLabel.replace(/\n/g, ' ');
        matchReason = 'Aktuelle Kalenderwoche (kein eindeutiges Kürzel im Dateinamen)';
      }
    }
  }

  return {
    module: detectedModule,
    category: detectedCategory,
    weekLabel: detectedWeekLabel,
    reason: matchReason
  };
}

function handleDocFilesSelected() {
  const fileInput = document.getElementById('docFileInput');
  const previewContainer = document.getElementById('docSmartPreviewList');
  if (!fileInput || !previewContainer) return;

  const files = Array.from(fileInput.files || []);
  if (files.length === 0) {
    pendingUploadPlans = [];
    previewContainer.innerHTML = '';
    return;
  }

  const fallbackMod = document.getElementById('docModuleSelect')?.value || appState.modules[0]?.shortName;
  const fallbackCat = document.getElementById('docCategorySelect')?.value || 'Vorlesung';
  const fallbackWeek = document.getElementById('docWeekSelect')?.value || '';

  pendingUploadPlans = files.map((file, idx) => {
    const guess = analyzeFileForSmartSorting(file.name, fallbackMod, fallbackCat, fallbackWeek);
    return {
      index: idx,
      file: file,
      title: file.name,
      module: guess.module,
      category: guess.category,
      weekLabel: guess.weekLabel,
      reason: guess.reason
    };
  });

  renderSmartUploadPreview();
}

function renderSmartUploadPreview() {
  const previewContainer = document.getElementById('docSmartPreviewList');
  if (!previewContainer) return;

  const weekOptionsHtml = `<option value="">Allgemein / Ohne feste Woche</option>` +
    appState.weeks.map(w => {
      const oneLine = w.weekLabel.replace(/\n/g, ' ');
      return `<option value="${escapeAttr(oneLine)}">${escapeHtml(oneLine)}</option>`;
    }).join('');

  previewContainer.innerHTML = pendingUploadPlans.map((plan, idx) => `
    <div class="smart-sort-card">
      <div class="smart-sort-card-header">
        <strong>📄 ${escapeHtml(plan.file.name)}</strong>
        <span class="smart-sort-reason">✨ ${escapeHtml(plan.reason)}</span>
      </div>
      <div class="smart-sort-grid">
        <div>
          <label style="font-size:0.74rem; font-weight:700;">Modul prüfen:</label>
          <select class="select-box full-width" onchange="updatePendingUploadPlan(${idx}, 'module', this.value)">
            ${appState.modules.map(m => `<option value="${escapeAttr(m.shortName)}" ${plan.module === m.shortName ? 'selected' : ''}>${escapeHtml(m.shortName)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.74rem; font-weight:700;">Kategorie prüfen:</label>
          <select class="select-box full-width" onchange="updatePendingUploadPlan(${idx}, 'category', this.value)">
            ${DOC_CATEGORIES.map(c => `<option value="${escapeAttr(c.value)}" ${plan.category === c.value ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.74rem; font-weight:700;">Semesterwoche prüfen:</label>
          <select class="select-box full-width" id="smartWeekSelect_${idx}" onchange="updatePendingUploadPlan(${idx}, 'weekLabel', this.value)">
            ${weekOptionsHtml}
          </select>
        </div>
      </div>
    </div>
  `).join('');

  pendingUploadPlans.forEach((plan, idx) => {
    const sel = document.getElementById(`smartWeekSelect_${idx}`);
    if (sel) sel.value = plan.weekLabel || '';
  });
}

function updatePendingUploadPlan(idx, field, value) {
  if (!pendingUploadPlans[idx]) return;
  pendingUploadPlans[idx][field] = value;
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

  if (pendingUploadPlans.length !== files.length) {
    handleDocFilesSelected();
  }

  const customTitle = (document.getElementById('docCustomTitle')?.value || '').trim();

  try {
    const db = await openDocsDatabase();
    let savedCount = 0;

    for (let i = 0; i < pendingUploadPlans.length; i++) {
      const plan = pendingUploadPlans[i];
      const file = plan.file;
      const weekDisplay = plan.weekLabel ? plan.weekLabel : 'Allgemein (ohne feste Woche)';

      const isConfirmed = window.confirm(
        `Dokument ${i + 1} von ${pendingUploadPlans.length}: „${file.name}“\n\n` +
        `Automatische Einsortierung:\n` +
        `• Modul: ${plan.module}\n` +
        `• Kategorie: ${plan.category}\n` +
        `• Woche: ${weekDisplay}\n` +
        `(${plan.reason})\n\n` +
        `Ist diese Einsortierung richtig? (Klicke auf „Abbrechen“, wenn du die Zuordnung im Fenster noch ändern möchtest.)`
      );

      if (!isConfirmed) {
        showToast(`ℹ️ Bitte passe die Zuordnung für „${file.name}“ im Auswahlfeld an und speichere erneut.`);
        return;
      }

      const dataUrl = await readFileAsDataURL(file);
      const docRecord = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        module: plan.module,
        category: plan.category,
        weekLabel: plan.weekLabel,
        title: customTitle && pendingUploadPlans.length === 1 ? customTitle : file.name,
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
      savedCount++;
    }

    await refreshDocsCache();
    closeModal('uploadDocModal');
    renderAll();
    showToast(`📁 ${savedCount} Dokument(e) erfolgreich geprüft und gespeichert!`);
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

/* =========================================================
   DOKUMENT-VORSCHAU & NACHTRÄGLICHE EINSORTIERUNG ÄNDERN
   ========================================================= */
function ensureEditDocModalExists() {
  if (document.getElementById('editDocModal')) return;

  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'modal-backdrop';
  modalBackdrop.id = 'editDocModal';
  modalBackdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>✏️ Dokument-Einsortierung ändern</h3>
        <button class="modal-close" onclick="closeModal('editDocModal')">&times;</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="editDocIdInput" value="">
        <div class="form-group" style="margin-bottom: 14px;">
          <label for="editDocTitleInput">Titel / Anzeigename des Dokuments</label>
          <input type="text" id="editDocTitleInput" class="full-width" onkeydown="if(event.key==='Enter') saveEditedDoc()">
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label for="editDocModuleSelect">Modul / Fach</label>
            <select id="editDocModuleSelect" class="select-box full-width"></select>
          </div>
          <div class="form-group">
            <label for="editDocCategorySelect">Kategorie</label>
            <select id="editDocCategorySelect" class="select-box full-width"></select>
          </div>
        </div>
        <div class="form-group" style="margin-top: 14px;">
          <label for="editDocWeekSelect">Zugehörige Semesterwoche</label>
          <select id="editDocWeekSelect" class="select-box full-width"></select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal('editDocModal')">Abbrechen</button>
        <button class="btn btn-primary" onclick="saveEditedDoc()">💾 Einsortierung speichern</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalBackdrop);
}

function openEditDocModal(docId, event = null) {
  if (event) event.stopPropagation();
  ensureEditDocModalExists();

  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;

  // Falls die Vorschau offen war, diese schließen
  closeModal('docPreviewModal');

  const modSel = document.getElementById('editDocModuleSelect');
  const catSel = document.getElementById('editDocCategorySelect');
  const weekSel = document.getElementById('editDocWeekSelect');
  const titleInp = document.getElementById('editDocTitleInput');
  const idInp = document.getElementById('editDocIdInput');

  if (idInp) idInp.value = doc.id;
  if (titleInp) titleInp.value = doc.title || doc.fileName || '';

  if (modSel) {
    modSel.innerHTML = appState.modules.map(m =>
      `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} (${escapeHtml(m.fullName)})</option>`
    ).join('');
    modSel.value = doc.module;
  }

  if (catSel) {
    catSel.innerHTML = DOC_CATEGORIES.map(c =>
      `<option value="${escapeAttr(c.value)}">${escapeHtml(c.label)}</option>`
    ).join('');
    catSel.value = doc.category || 'Vorlesung';
  }

  if (weekSel) {
    weekSel.innerHTML = `<option value="">Allgemein / Ohne feste Woche</option>` +
      appState.weeks.map(w => {
        const oneLine = w.weekLabel.replace(/\n/g, ' ');
        return `<option value="${escapeAttr(oneLine)}">${escapeHtml(oneLine)}</option>`;
      }).join('');

    // Passende Woche auswählen (auch wenn sich Zeilenumbrüche leicht unterscheiden)
    const savedWeek = (doc.weekLabel || '').trim();
    const savedWeekShort = savedWeek.split('(')[0].trim().toLowerCase();
    let matchedValue = '';
    for (const opt of weekSel.options) {
      if (!opt.value) continue;
      if (opt.value === savedWeek || (savedWeekShort && opt.value.toLowerCase().startsWith(savedWeekShort))) {
        matchedValue = opt.value;
        break;
      }
    }
    weekSel.value = matchedValue;
  }

  openModal('editDocModal');
}

async function saveEditedDoc() {
  const docId = document.getElementById('editDocIdInput')?.value;
  if (!docId) return;

  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;

  const newTitle = (document.getElementById('editDocTitleInput')?.value || '').trim();
  const newMod = document.getElementById('editDocModuleSelect')?.value || doc.module;
  const newCat = document.getElementById('editDocCategorySelect')?.value || doc.category;
  const newWeek = document.getElementById('editDocWeekSelect')?.value || '';

  doc.title = newTitle || doc.fileName || doc.title;
  doc.module = newMod;
  doc.category = newCat;
  doc.weekLabel = newWeek;

  try {
    const db = await openDocsDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DOCS_STORE_NAME, 'readwrite');
      tx.objectStore(DOCS_STORE_NAME).put(doc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await refreshDocsCache();
    closeModal('editDocModal');
    renderAll();

    const weekInfo = newWeek ? newWeek.split('(')[0].trim() : 'Allgemein';
    showToast(`✅ Einsortierung geändert: ${newMod} • ${newCat} (${weekInfo})`);
  } catch (e) {
    console.error('Fehler beim Aktualisieren des Dokuments:', e);
    showToast('❌ Änderungen konnten nicht gespeichert werden.');
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

  // "Einsortierung ändern"-Button direkt im Vorschau-Modal ergänzen
  let editBtn = document.getElementById('docPreviewEditBtn');
  if (!editBtn && dlBtn && dlBtn.parentElement) {
    editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.id = 'docPreviewEditBtn';
    editBtn.className = 'btn btn-outline';
    editBtn.style.marginRight = 'auto';
    dlBtn.parentElement.insertBefore(editBtn, dlBtn.parentElement.firstChild);
  }
  if (editBtn) {
    editBtn.textContent = '✏️ Einsortierung ändern';
    editBtn.onclick = () => openEditDocModal(doc.id);
  }

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
      : docsForMod.map(doc => {
          const isSolution = doc.category === 'Lösungen';
          return `
            <div class="doc-item-card">
              <div class="doc-item-info">
                <div class="doc-item-title" title="${escapeAttr(doc.title)}">📄 ${escapeHtml(doc.title)}</div>
                <div class="doc-item-meta">
                  <span class="doc-cat-badge ${isSolution ? 'doc-cat-solution' : ''}">${escapeHtml(doc.category)}</span>
                  ${doc.weekLabel ? `<span>• ${escapeHtml(doc.weekLabel.split('(')[0].trim())}</span>` : '<span>• Allgemein</span>'}
                  <span>• ${formatFileSize(doc.sizeBytes)}</span>
                </div>
              </div>
              <div class="doc-item-actions">
                <button class="btn btn-outline btn-sm" onclick="previewModuleDoc('${escapeAttr(doc.id)}')" title="Vorschau">👁️</button>
                <button class="btn btn-outline btn-sm" onclick="openEditDocModal('${escapeAttr(doc.id)}', event)" title="Einsortierung (Woche, Modul, Kategorie, Titel) ändern">✏️</button>
                <a class="btn btn-outline btn-sm" href="${doc.dataUrl}" download="${escapeAttr(doc.fileName || doc.title)}" title="Herunterladen">⬇️</a>
                <button class="btn btn-danger-outline btn-sm" onclick="deleteModuleDoc('${escapeAttr(doc.id)}')" title="Löschen">🗑️</button>
              </div>
            </div>
          `;
        }).join('');

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
      const itemsHtml = items.map(i => {
        const icon = i.done ? '✅ ' : (i.inProgress ? '⏳ ' : '⬜ ');
        return `<li>${icon}<strong>[${escapeHtml(mod.shortName)}]</strong> ${escapeHtml(i.text)}</li>`;
      }).join('');
      upcomingTasksHtml += `
        <div style="margin-bottom: 14px; padding: 12px; background-color: ${lightBg}; border-left: 4px solid ${primaryColor}; border-radius: 6px;">
          <strong style="color: ${darkColor}; font-size: 15px;">${escapeHtml(mod.shortName)} (${escapeHtml(mod.fullName)})</strong>
          <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #333;">${itemsHtml}</ul>
        </div>`;
      plainTextLines.push(`\n[${mod.shortName}]`);
      items.forEach(i => plainTextLines.push(` - ${i.done ? '[x]' : (i.inProgress ? '[~]' : '[ ]')} ${i.text}`));
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
        const openHtml = openLines.map(l => `<li>${l.inProgress ? '⏳ ' : ''}${escapeHtml(l.text)}</li>`).join('');
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