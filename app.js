/* =========================================================
   HAUPTLOGIK DER SEMESTERPLAN WEB-APP (app.js)
   ========================================================= */
const STORAGE_KEY = 'semesterplan_app_state_v3';
const THEME_KEY = 'semesterplan_theme';

const THEMES = {
  rose:     { label: 'Original Rosa',   colors: ['#C66A7A', '#8E3A49', '#FAF6F6'], light: '#F9EFEF', border: '#F0E1E4' },
  ocean:    { label: 'Ozean Blau',      colors: ['#3B82F6', '#1D4ED8', '#F8FAFC'], light: '#EFF6FF', border: '#DBEAFE' },
  forest:   { label: 'Waldgrün',        colors: ['#2E8B57', '#1E5631', '#F4F9F5'], light: '#ECFDF5', border: '#D1FAE5' },
  lavender: { label: 'Lavendel',        colors: ['#8B5CF6', '#5B21B6', '#FAF8FF'], light: '#F5F3FF', border: '#EDE9FE' },
  sunset:   { label: 'Sunset Coral',    colors: ['#F97316', '#C2410C', '#FFF7ED'], light: '#FFEDD5', border: '#FED7AA' },
  matcha:   { label: 'Matcha Latte',    colors: ['#65A30D', '#3F6212', '#F7FEE7'], light: '#ECFCCB', border: '#D9F99D' },
  berry:    { label: 'Berry Velvet',    colors: ['#DB2777', '#831843', '#FDF2F8'], light: '#FCE7F3', border: '#FBCFE8' },
  mocha:    { label: 'Café Mocha',      colors: ['#A16207', '#713F12', '#FEFCE8'], light: '#FEF9C3', border: '#FEF08A' },
  dark:     { label: 'Midnight Dark',   colors: ['#D97789', '#F3A6B4', '#141216'], light: '#2A2125', border: '#3D2F35' },
  cyber:    { label: 'Cyber Neon',      colors: ['#06B6D4', '#67E8F9', '#0F172A'], light: '#1E293B', border: '#334155' }
};

let appState = null;
let activeModuleFilter = null;
let currentTab = 'table';

function initApp() {
  // 1. ZUERST Daten aus localStorage oder INITIAL_DATA (data.js) laden!
  loadState();

  // 2. Danach erst Theme-Menü bauen und Theme aktivieren (da changeTheme auf appState zugreift)
  buildThemeMenuUI();
  const savedTheme = localStorage.getItem(THEME_KEY) || 'rose';
  changeTheme(savedTheme, false);

  // 3. iPhone-Ansicht wiederherstellen (falls aktiv)
  if (localStorage.getItem('semesterplan_iphone_view') === 'true') {
    document.body.classList.add('iphone-view-mode');
    updateIphoneBtnState();
  }

  // 4. Uhrzeit in der iPhone-Statusbar aktualisieren
  updateIosClock();
  setInterval(updateIosClock, 30000);

  // 5. Dropdown für Wochen-Fokus initialisieren
  populateFocusWeekDropdown();
  selectCurrentCalendarWeek(false);

  // 6. Komplette Oberfläche zeichnen
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
    console.error('KRITISCHER FEHLER: data.js (INITIAL_DATA) wurde nicht geladen!');
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
   THEMES (MIT FARBVORSCHAU) & ECHTE IPHONE-ANSICHT
   ========================================================= */
function buildThemeMenuUI() {
  const menu = document.getElementById('themeMenu');
  if (!menu) return;

  menu.innerHTML = Object.entries(THEMES).map(([key, t]) => `
    <button type="button" class="theme-option-item" data-theme-key="${key}" onclick="changeTheme('${key}', true)">
      <span class="theme-preview-dots">
        <span class="dot" style="background:${t.colors[0]}"></span>
        <span class="dot" style="background:${t.colors[1]}"></span>
        <span class="dot" style="background:${t.colors[2]}"></span>
      </span>
      <span class="theme-option-label">${escapeHtml(t.label)}</span>
    </button>
  `).join('');
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

  // Vorschau im Header-Button aktualisieren
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

  // Aktiven Eintrag im Menü markieren
  document.querySelectorAll('.theme-option-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme-key') === themeKey);
  });

  const menu = document.getElementById('themeMenu');
  if (menu) menu.classList.add('hidden');

  renderEmailPreview();

  if (showNotification) {
    showToast(`🎨 Farbdesign „${themeObj.label}“ aktiviert!`);
  }
}

function toggleIphoneView() {
  const isIphone = document.body.classList.toggle('iphone-view-mode');
  localStorage.setItem('semesterplan_iphone_view', isIphone ? 'true' : 'false');
  updateIphoneBtnState();
  showToast(isIphone ? '📱 Echte iPhone-Ansicht aktiviert' : '💻 Desktop-Tabellenansicht aktiviert');
}

function updateIphoneBtnState() {
  const btn = document.getElementById('iphoneViewBtn');
  if (!btn) return;
  const isIphone = document.body.classList.contains('iphone-view-mode');
  btn.textContent = isIphone ? '💻 Desktop-Ansicht' : '📱 iPhone-Ansicht';
}

function switchTab(tabName) {
  currentTab = tabName;
  document.getElementById('viewTable').classList.toggle('hidden', tabName !== 'table');
  document.getElementById('viewFocus').classList.toggle('hidden', tabName !== 'focus');
  document.getElementById('viewEmail').classList.toggle('hidden', tabName !== 'email');
  document.getElementById('tableFilters').classList.toggle('hidden', tabName !== 'table');

  document.getElementById('tabBtnTable')?.classList.toggle('active', tabName === 'table');
  document.getElementById('tabBtnFocus')?.classList.toggle('active', tabName === 'focus');
  document.getElementById('tabBtnEmail')?.classList.toggle('active', tabName === 'email');

  document.getElementById('iosTabTable')?.classList.toggle('active', tabName === 'table');
  document.getElementById('iosTabFocus')?.classList.toggle('active', tabName === 'focus');
  document.getElementById('iosTabEmail')?.classList.toggle('active', tabName === 'email');

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

/* =========================================================
   DATUM-HILFSFUNKTIONEN FÜR WOCHENZUORDNUNG
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
      pct: 0
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
   RENDERING: DASHBOARD, TABELLE, FOKUS & E-MAIL
   ========================================================= */
function renderAll() {
  const stats = calculateStats();
  renderDashboard(stats);
  renderTable(stats);
  renderFocusView();
  renderEmailPreview();
}

function renderDashboard(stats) {
  const statusEl = document.getElementById('overallStatusText');
  if (statusEl) {
    statusEl.textContent = `Gesamtfortschritt: ${stats.overallPct} % (${stats.overallCompleted} von ${stats.overallTotal} Aufgaben erledigt)`;
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

  // 1. Tabellenkopf
  thead.innerHTML = `
    <tr>
      <th>Semesterwoche</th>
      ${visibleModules.map(m => `<th>${escapeHtml(m.shortName)}<br><small style="font-weight:400; opacity:0.9;">${escapeHtml(m.fullName)}</small></th>`).join('')}
    </tr>
  `;

  // Filterwerte auslesen
  const searchVal = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  const currentWeekIdx = findWeekIndexByDate(new Date());

  // 2. Tabellenkörper
  let rowsHtml = '';
  appState.weeks.forEach((week, wIdx) => {
    const isCurrentWeek = (wIdx === currentWeekIdx);
    const rowClass = `${wIdx % 2 === 0 ? 'even-row' : 'odd-row'} ${isCurrentWeek ? 'current-week-row' : ''}`;

    let rowHasMatch = !searchVal && statusFilter === 'all';
    let cellsHtml = '';

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

      if (filteredItems.length === 0) {
        cellsHtml += `
          <td class="${cellClass}" data-module="${escapeAttr(mod.shortName)}">
            <span class="empty-dash">–</span>
            <button class="add-task-btn" onclick="openTaskModal(${wIdx}, '${escapeAttr(mod.shortName)}')">+ Aufgabe</button>
          </td>
        `;
      } else {
        const listHtml = filteredItems.map(({ item, idx }) => {
          const isTestat = /testat\s*\d+/i.test(item.text);
          const badgeHtml = isTestat ? `<span class="testat-tag">TESTAT</span>` : '';
          const dateHtml = item.dueDate ? `<span class="date-tag">📅 ${formatIsoDateDE(item.dueDate)}</span>` : '';

          return `
            <li class="task-item ${item.done ? 'done' : ''}">
              <input type="checkbox" class="task-checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
              <span class="task-text" onclick="toggleTaskDone(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
                ${escapeHtml(item.text)} ${badgeHtml} ${dateHtml}
              </span>
              <div class="task-actions">
                <button class="task-action-btn" title="Bearbeiten" onclick="openEditTaskModal(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">✏️</button>
                <button class="task-action-btn" title="Löschen" onclick="deleteTaskItem(${wIdx}, '${escapeAttr(mod.shortName)}', ${idx})">🗑️</button>
              </div>
            </li>
          `;
        }).join('');

        cellsHtml += `
          <td class="${cellClass}" data-module="${escapeAttr(mod.shortName)}">
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
          <td class="week-col"><span>${escapeHtml(week.weekLabel)}</span>${currentBadge}</td>
          ${cellsHtml}
        </tr>
      `;
    }
  });

  tbody.innerHTML = rowsHtml || `<tr><td colspan="${visibleModules.length + 1}" style="text-align:center; padding: 24px;">Keine passenden Aufgaben für diesen Filter gefunden.</td></tr>`;

  // 3. Tabellenfuß (Fortschritt pro Modul)
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

  if (titleEl) {
    titleEl.textContent = `📅 ${week.weekLabel.replace(/\n/g, ' ')}`;
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
      const dateHtml = item.dueDate ? `<span class="date-tag">📅 ${formatIsoDateDE(item.dueDate)}</span>` : '';
      return `
        <li class="task-item ${item.done ? 'done' : ''}">
          <input type="checkbox" class="task-checkbox" ${item.done ? 'checked' : ''} onchange="toggleTaskDone(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">
          <span class="task-text" onclick="toggleTaskDone(${selIdx}, '${escapeAttr(mod.shortName)}', ${idx})">${escapeHtml(item.text)} ${dateHtml}</span>
          <div class="task-actions">
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
  if (progEl) {
    progEl.textContent = `${weekPct} % (${weekDone}/${weekTotal} erledigt)`;
  }

  if (upcomingContainer) {
    upcomingContainer.innerHTML = upcomingHtml || `<p style="color: var(--text-muted);">Keine Aufgaben in dieser Woche eingetragen.</p>`;
  }

  // Offene Aufgaben aus Vorwochen sammeln
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
   AUFGABEN ABHAKEN, HINZUFÜGEN, BEARBEITEN & LÖSCHEN
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
    weekSelect.innerHTML = appState.weeks.map((w, idx) =>
      `<option value="${idx}">${escapeHtml(w.weekLabel.replace(/\n/g, ' '))}</option>`
    ).join('');
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
  document.getElementById('taskTextInput').value = '';
  document.getElementById('taskDueDateInput').value = '';
  document.getElementById('taskSyncCalendarCheck').checked = false;
  document.getElementById('taskDoneCheck').checked = false;

  openModal('taskModal');
  setTimeout(() => document.getElementById('taskTextInput')?.focus(), 80);
}

function openEditTaskModal(weekIdx, shortName, itemIdx) {
  const item = appState.weeks[weekIdx]?.cells[shortName]?.[itemIdx];
  if (!item) return;

  populateModalDropdowns();
  document.getElementById('taskModalTitle').textContent = '✏️ Aufgabe bearbeiten';
  document.getElementById('editTaskWeekIdx').value = String(weekIdx);
  document.getElementById('editTaskOrigModule').value = shortName;
  document.getElementById('editTaskItemIdx').value = String(itemIdx);
  document.getElementById('deleteTaskModalBtn').style.display = 'inline-flex';

  document.getElementById('taskWeekSelect').value = String(weekIdx);
  document.getElementById('taskModuleSelect').value = shortName;
  document.getElementById('taskTextInput').value = item.text;
  document.getElementById('taskDueDateInput').value = item.dueDate || '';
  document.getElementById('taskSyncCalendarCheck').checked = !!item.syncCalendar;
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
  const dueDate = document.getElementById('taskDueDateInput').value || null;
  const syncCalendar = document.getElementById('taskSyncCalendarCheck').checked;
  const done = document.getElementById('taskDoneCheck').checked;

  const origWeekStr = document.getElementById('editTaskWeekIdx').value;
  const origMod = document.getElementById('editTaskOrigModule').value;
  const origItemStr = document.getElementById('editTaskItemIdx').value;

  if (origWeekStr !== '' && origItemStr !== '') {
    const origWeekIdx = parseInt(origWeekStr, 10);
    const origItemIdx = parseInt(origItemStr, 10);
    const existingItem = appState.weeks[origWeekIdx]?.cells[origMod]?.[origItemIdx];

    if (existingItem) {
      existingItem.text = cleanText;
      existingItem.dueDate = dueDate;
      existingItem.syncCalendar = syncCalendar;
      existingItem.done = done;

      if (origWeekIdx !== targetWeekIdx || origMod !== targetMod) {
        appState.weeks[origWeekIdx].cells[origMod].splice(origItemIdx, 1);
        appState.weeks[targetWeekIdx].cells[targetMod].push(existingItem);
      }

      saveState();
      renderAll();
      closeModal('taskModal');
      showToast('💾 Aufgabe aktualisiert!');

      if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
        pushSingleTaskEditToGoogle(targetWeekIdx, targetMod, existingItem);
      }
      return;
    }
  }

  // Neue Aufgabe anlegen (wird in Google Tasks als Unteraufgabe der Woche angelegt)
  const newItem = {
    text: cleanText,
    done: done,
    dueDate: dueDate,
    syncCalendar: syncCalendar
  };

  if (!appState.weeks[targetWeekIdx].cells[targetMod]) {
    appState.weeks[targetWeekIdx].cells[targetMod] = [];
  }
  appState.weeks[targetWeekIdx].cells[targetMod].push(newItem);

  saveState();
  renderAll();
  closeModal('taskModal');
  showToast(`✅ Aufgabe zu ${targetMod} hinzugefügt!`);

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
        const cleanLine = item.text.replace(/^✅\s*/, '').replace(new RegExp(`^${mod.shortName}:\\s*`, 'i'), '').trim();
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
   TAB 3: E-MAIL BRIEFING GENERATOR (NUTZT AKTIVES FARBDESIGN)
   ========================================================= */
function buildEmailHtmlObject() {
  const statsObj = calculateStats();
  const selEl = document.getElementById('focusWeekSelect');
  const selIdx = selEl ? (parseInt(selEl.value, 10) || 0) : 0;
  const week = appState.weeks[selIdx] || appState.weeks[0];
  const upcomingWeekLabel = week.weekLabel.replace(/\n/g, ' ');

  const currentThemeKey = document.documentElement.getAttribute('data-theme') || 'rose';
  const themeObj = THEMES[currentThemeKey] || THEMES.rose;
  const primaryColor = themeObj.colors[0];
  const darkColor = themeObj.colors[1];
  const lightBg = themeObj.light;
  const borderCol = themeObj.border;

  let upcomingTasksHtml = '';
  let plainTextLines = [`DEIN SEMESTERPLAN-UPDATE: ${upcomingWeekLabel}`, '====================================', '', 'AUFGABEN DIESER WOCHE:'];

  for (const mod of appState.modules) {
    const items = week.cells[mod.shortName] || [];
    if (items.length > 0) {
      const itemsHtml = items.map(i => `<li>${i.done ? '✅ ' : '⬜ '}${escapeHtml(i.text)}${i.dueDate ? ` (Fällig: ${formatIsoDateDE(i.dueDate)})` : ''}</li>`).join('');
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
        <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(upcomingWeekLabel)}</p>
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
}

function triggerMailtoFallback() {
  const { subject, plainText } = buildEmailHtmlObject();
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
}

/* =========================================================
   FARBIGER PDF-EXPORT MIT VORSCHAU-MODAL (OHNE DIREKTDRUCK)
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
    showToast('ℹ️ PDF-Generator lädt noch, nutze System-Farbdruck...');
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
    console.error('PDF Export Fehler:', e);
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