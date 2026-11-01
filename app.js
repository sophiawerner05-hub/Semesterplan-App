/* =========================================================
   HAUPTLOGIK DER SEMESTERPLAN WEB-APP (app.js)
   ========================================================= */
const STORAGE_KEY = 'semesterplan_app_state_v2';
const THEME_KEY = 'semesterplan_theme';

let appState = null;
let activeModuleFilter = null;
let currentTab = 'table';

function initApp() {
  // Gespeichertes Farbschema laden
  const savedTheme = localStorage.getItem(THEME_KEY) || 'rose';
  changeTheme(savedTheme, false);

  // Kompakte Kartenansicht laden (falls aktiv)
  if (localStorage.getItem('semesterplan_compact_layout') === 'true') {
    document.body.classList.add('force-card-layout');
  }

  // Daten aus localStorage oder INITIAL_DATA laden
  loadState();

  // Dropdown für Wochen-Fokus initialisieren
  populateFocusWeekDropdown();
  selectCurrentCalendarWeek(false);

  // Komplette Oberfläche zeichnen
  renderAll();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.modules) && Array.isArray(parsed.weeks)) {
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
   THEMES & LAYOUT
   ========================================================= */
function changeTheme(themeName, showNotification = true) {
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem(THEME_KEY, themeName);
  const select = document.getElementById('themeSelect');
  if (select && select.value !== themeName) {
    select.value = themeName;
  }
  if (showNotification) {
    showToast('🎨 Farbschema aktualisiert!');
  }
}

function toggleCompactLayout() {
  const isCompact = document.body.classList.toggle('force-card-layout');
  localStorage.setItem('semesterplan_compact_layout', isCompact ? 'true' : 'false');
  showToast(isCompact ? '📱 Kompakte Kartenansicht aktiviert' : '📊 Klassische Tabellenansicht aktiviert');
}

function switchTab(tabName) {
  currentTab = tabName;
  document.getElementById('viewTable').classList.toggle('hidden', tabName !== 'table');
  document.getElementById('viewFocus').classList.toggle('hidden', tabName !== 'focus');
  document.getElementById('viewEmail').classList.toggle('hidden', tabName !== 'email');
  document.getElementById('tableFilters').classList.toggle('hidden', tabName !== 'table');

  document.getElementById('tabBtnTable').classList.toggle('active', tabName === 'table');
  document.getElementById('tabBtnFocus').classList.toggle('active', tabName === 'focus');
  document.getElementById('tabBtnEmail').classList.toggle('active', tabName === 'email');

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
            <span>–</span>
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
      const currentBadge = isCurrentWeek ? `<br><span class="week-badge-current">📍 Aktuelle Woche</span>` : '';
      rowsHtml += `
        <tr class="${rowClass}">
          <td class="week-col">${escapeHtml(week.weekLabel)}${currentBadge}</td>
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
        return `<td>${s.pct} % (${s.completed}/${s.total})</td>`;
      }).join('')}
    </tr>
    <tr class="summary-bar-row">
      <td>📈 Fortschritts-Balken</td>
      ${visibleModules.map(m => {
        const s = stats.moduleStats[m.shortName];
        return `
          <td>
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
    // Bestehende Aufgabe aktualisieren
    const origWeekIdx = parseInt(origWeekStr, 10);
    const origItemIdx = parseInt(origItemStr, 10);
    const existingItem = appState.weeks[origWeekIdx]?.cells[origMod]?.[origItemIdx];

    if (existingItem) {
      existingItem.text = cleanText;
      existingItem.dueDate = dueDate;
      existingItem.syncCalendar = syncCalendar;
      existingItem.done = done;

      // Falls Woche oder Modul geändert wurde -> verschieben
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

  // Neue Aufgabe anlegen
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

/* =========================================================
   CAD-TESTATE (1-5) IMPORT & BEREINIGUNG
   ========================================================= */
function importCADTestateInApp() {
  const testateList = [];
  for (let i = 1; i <= 5; i++) {
    const val = document.getElementById(`testatDate${i}`)?.value;
    if (val) {
      const parts = val.split('-');
      const dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
      testateList.push({ title: `Testat ${i}`, dueDate: val, date: dt });
    }
  }

  if (testateList.length === 0) {
    showToast('⚠️ Bitte mindestens ein gültiges Datum eingeben.');
    return;
  }

  // Alte Testate aus CAD entfernen (Erledigt-Status merken)
  const doneStatusMap = {};
  for (const week of appState.weeks) {
    const cadItems = week.cells['CAD'] || [];
    for (const item of cadItems) {
      if (/^testat\s*\d+/i.test(item.text.trim())) {
        doneStatusMap[item.text.trim().toLowerCase()] = item.done;
      }
    }
    week.cells['CAD'] = cadItems.filter(item => !/^(\✅\s*)?(CAD:\s*)?testat\s*\d+/i.test(item.text.trim()));
  }

  testateList.sort((a, b) => a.date - b.date);

  for (const t of testateList) {
    let wIdx = findWeekIndexByDate(t.date);
    if (wIdx === -1) {
      wIdx = appState.weeks.length - 1; // Fallback auf Zusatzwoche
    }
    const newItem = {
      text: t.title,
      done: !!doneStatusMap[t.title.toLowerCase()],
      dueDate: t.dueDate,
      syncCalendar: true
    };
    appState.weeks[wIdx].cells['CAD'].push(newItem);
  }

  saveState();
  renderAll();
  closeModal('testatModal');
  showToast('✅ 5 CAD-Testate erfolgreich zugeordnet!');

  if (typeof syncWithGoogleTasksAPI === 'function' && typeof isGoogleConnected === 'function' && isGoogleConnected()) {
    syncWithGoogleTasksAPI();
  }
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
   TAB 3: E-MAIL BRIEFING GENERATOR & VORSCHAU
   ========================================================= */
function buildEmailHtmlObject() {
  const statsObj = calculateStats();
  const selEl = document.getElementById('focusWeekSelect');
  const selIdx = selEl ? (parseInt(selEl.value, 10) || 0) : 0;
  const week = appState.weeks[selIdx] || appState.weeks[0];
  const upcomingWeekLabel = week.weekLabel.replace(/\n/g, ' ');

  let upcomingTasksHtml = '';
  let plainTextLines = [`DEIN SEMESTERPLAN-UPDATE: ${upcomingWeekLabel}`, '====================================', '', 'AUFGABEN DIESER WOCHE:'];

  for (const mod of appState.modules) {
    const items = week.cells[mod.shortName] || [];
    if (items.length > 0) {
      const itemsHtml = items.map(i => `<li>${i.done ? '✅ ' : '⬜ '}${escapeHtml(i.text)}${i.dueDate ? ` (Fällig: ${formatIsoDateDE(i.dueDate)})` : ''}</li>`).join('');
      upcomingTasksHtml += `
        <div style="margin-bottom: 14px; padding: 12px; background-color: #F9EFEF; border-left: 4px solid #C66A7A; border-radius: 4px;">
          <strong style="color: #8E3A49; font-size: 15px;">${escapeHtml(mod.shortName)} (${escapeHtml(mod.fullName)})</strong>
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
        <div style="width: 100%; background-color: #F0E1E4; border-radius: 6px; height: 10px; overflow: hidden;">
          <div style="width: ${s.pct}%; background-color: #C66A7A; height: 10px;"></div>
        </div>
      </div>`;
  }

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #E5E7E9; border-radius: 8px; overflow: hidden; background: #FFFFFF;">
      <div style="background-color: #C66A7A; color: #FFFFFF; padding: 18px 24px;">
        <h2 style="margin: 0; font-size: 20px;">🎓 Dein Semesterplan-Briefing</h2>
        <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">${escapeHtml(upcomingWeekLabel)}</p>
      </div>
      <div style="padding: 20px 24px; color: #2C3E50;">
        <h3 style="margin-top: 0; color: #C66A7A; border-bottom: 1px solid #F2D7DB; padding-bottom: 6px;">📅 Aufgaben für diese Woche</h3>
        ${upcomingTasksHtml}
        <h3 style="margin-top: 24px; color: #C66A7A; border-bottom: 1px solid #F2D7DB; padding-bottom: 6px;">📊 Dein aktueller Gesamt-Lernfortschritt (${statsObj.overallPct} %)</h3>
        ${progressHtml}
        ${overdueTasksHtml ? `
          <h3 style="margin-top: 24px; color: #B03A2E; border-bottom: 1px solid #F5B7B1; padding-bottom: 6px;">⚠️ Noch offen aus Vorwochen</h3>
          <div style="background-color: #FDEDEC; padding: 12px; border-radius: 4px; font-size: 13px; color: #2C3E50;">
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

function openEmailPreview() {
  switchTab('email');
  showToast('📧 Wochen-Briefing Vorschau geöffnet.');
}

function triggerMailtoFallback() {
  const { subject, plainText } = buildEmailHtmlObject();
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
}

/* =========================================================
   EXPORT, BACKUP & RESET
   ========================================================= */
function exportCSV() {
  const headers = ['Woche', ...appState.modules.map(m => m.fullName)];
  const rows = [headers];

  for (const week of appState.weeks) {
    const row = [week.weekLabel.replace(/\n/g, ' ')];
    for (const mod of appState.modules) {
      const items = week.cells[mod.shortName] || [];
      const text = items.map(i => `${i.done ? '✅ ' : ''}${i.text}`).join(' | ') || '-';
      row.push(text);
    }
    rows.push(row);
  }

  const csvContent = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'Semesterplan_WiSe26_27.csv';
  link.click();
  showToast('💾 CSV-Datei heruntergeladen!');
}

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

function resetToOriginal() {
  if (!confirm('Möchtest du den gesamten Semesterplan wirklich auf den Ursprungszustand zurücksetzen?')) return;
  appState = JSON.parse(JSON.stringify(INITIAL_DATA));
  appState.deletedGoogleTaskIds = [];
  saveState();
  renderAll();
  showToast('↺ Plan auf Ursprungszustand zurückgesetzt.');
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