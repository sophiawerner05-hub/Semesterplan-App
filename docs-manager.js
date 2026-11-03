/* =========================================================
   UNTERPROGRAMM 5: DOKUMENTENSPEICHER, ROBUSTE AUFGABEN-KOPPLUNG
   ÜBER TASK-HASH, DETERMINISTISCHE SORTIERUNG & AUTO-SYNC (docs-manager.js)
   ========================================================= */
let draggedDocId = null;
let draggedDocFolderGroup = null;
let pendingUploadQueue = [];
let activePreviewObjectUrl = null;
let openTaskFoldersSet = new Set();

/* =========================================================
   1. DOKUMENT-MENÜS (⋯) SCHLIESSEN & UMSCHALTEN
   ========================================================= */
   function closeAllDocActionMenus() {
     document.querySelectorAll('.doc-dropdown-menu.open').forEach(el => el.classList.remove('open'));
     document.querySelectorAll('.doc-menu-btn.active, .chip-dots-btn.active').forEach(el => el.classList.remove('active'));
     document.querySelectorAll('.menu-open-parent, .menu-open-cell, .menu-open-row').forEach(el => {
       el.classList.remove('menu-open-parent', 'menu-open-cell', 'menu-open-row');
     });
   }

   function toggleDocActionMenu(event, menuId) {
     event.stopPropagation();
     event.preventDefault();
     const menu = document.getElementById(menuId);
     if (!menu) return;
     const wasOpen = menu.classList.contains('open');
     if (typeof closeAllTaskActionMenus === 'function') closeAllTaskActionMenus();
     closeAllDocActionMenus();
     if (!wasOpen) {
       menu.classList.add('open');
       event.currentTarget.classList.add('active');
       menu.closest('.task-doc-chip-group')?.classList.add('menu-open-parent');
       menu.closest('.task-item')?.classList.add('menu-open-parent');
       menu.closest('.doc-compact-item')?.classList.add('menu-open-parent');
       menu.closest('.doc-folder-card')?.classList.add('menu-open-parent');
       menu.closest('td')?.classList.add('menu-open-cell');
       menu.closest('tr')?.classList.add('menu-open-row');
     }
   }

/* =========================================================
   2. FEHLERTOLERANTE AUFGABEN- & WOCHEN-ZUORDNUNG
      (Auch nach Neustart oder auf Zweitgeräten immer 100 % stabil!)
   ========================================================= */
function normalizeWeekLabelOneLine(lbl) {
  return String(lbl || '').replace(/\n/g, ' ').trim();
}

function isSameWeekLabelOrId(docWeekLabel, targetWeekObj) {
  if (!targetWeekObj) return false;
  const docWkNorm = normalizeWeekLabelOneLine(docWeekLabel);
  if (!docWkNorm) return false;
  const targetWkNorm = normalizeWeekLabelOneLine(targetWeekObj.weekLabel);
  if (docWkNorm === targetWkNorm) return true;
  return resolveWeekIdFromLabelOrId(docWkNorm) === targetWeekObj.id;
}

function getNextSortOrderInScope(moduleName, weekLabelOneLine, taskText = '') {
  const wkId = resolveWeekIdFromLabelOrId(weekLabelOneLine);
  const normTask = normalizeTaskTextForMatch(taskText, moduleName);
  let maxOrder = 0;
  for (const d of cachedDocsList) {
    if (d.module !== moduleName) continue;
    if (resolveWeekIdFromLabelOrId(d.weekLabel) !== wkId) continue;
    if (normalizeTaskTextForMatch(d.taskText || '', moduleName) !== normTask) continue;
    const ord = typeof d.sortOrder === 'number' ? d.sortOrder : 0;
    if (ord > maxOrder) maxOrder = ord;
  }
  return maxOrder > 0 ? maxOrder + 10 : 10;
}

function getDocsForTask(weekIdx, shortName, taskText) {
  const week = appState?.weeks?.[weekIdx];
  if (!week) return [];
  const wkOneLine = normalizeWeekLabelOneLine(week.weekLabel);
  const cleanTaskNorm = normalizeTaskTextForMatch(taskText, shortName);
  if (!cleanTaskNorm) return [];

  const expectedHash = computeTaskHash(shortName, week.id, taskText);
  const taskTokens = extractTaskTokens(cleanTaskNorm);

  const matched = cachedDocsList.filter(doc => {
    if (doc.module !== shortName) return false;

    // 1. Primärer Vergleich über den eindeutigen Task-Hash (immun gegen Drive-Textkürzungen!)
    if (doc.taskHash && doc.taskHash === expectedHash) {
      return true;
    }

    const docTaskNorm = normalizeTaskTextForMatch(doc.taskText || '', shortName);
    const sameWeek = !doc.weekLabel || isSameWeekLabelOrId(doc.weekLabel, week);

    // 2. Exakter oder (durch frühere Drive-Limits) gekürzter Text-Abgleich
    if (docTaskNorm && sameWeek) {
      if (docTaskNorm === cleanTaskNorm) return true;
      if (docTaskNorm.length >= 24 && cleanTaskNorm.startsWith(docTaskNorm)) return true;
      if (cleanTaskNorm.length >= 24 && docTaskNorm.startsWith(cleanTaskNorm)) return true;
    }

    if (doc.manualOverride) {
      return false;
    }

    // 3. Automatischer Token-Abgleich, falls das Dokument in derselben Woche ohne speziellen Aufgabentext liegt
    if (isSameWeekLabelOrId(doc.weekLabel, week) && !docTaskNorm && taskTokens.length > 0) {
      const docTokens = extractTaskTokens((doc.fileName || '') + ' ' + (doc.title || ''));
      if (taskTokens.some(t => docTokens.includes(t))) return true;
    }
    return false;
  });

  return sortDocsByOrder(matched);
}

function getRemainingWeekDocs(weekIdx, shortName, shownDocIds) {
  const week = appState?.weeks?.[weekIdx];
  if (!week) return [];
  const remaining = cachedDocsList.filter(doc =>
    doc.module === shortName &&
    isSameWeekLabelOrId(doc.weekLabel, week) &&
    !shownDocIds.has(doc.id)
  );
  return sortDocsByOrder(remaining);
}

function getGeneralModuleDocs(shortName) {
  const gen = cachedDocsList.filter(doc =>
    doc.module === shortName &&
    !normalizeWeekLabelOneLine(doc.weekLabel)
  );
  return sortDocsByOrder(gen);
}

/* =========================================================
   3. ANGEHÄNGTE DATEIEN BEIM BEWEGEN ODER UMBENENNEN EINER
      AUFGABE AUTOMATISCH MITNEHMEN!
   ========================================================= */
async function moveAttachedDocsWithTask(oldWeekIdx, oldMod, oldTaskText, newWeekIdx, newMod, newTaskText) {
  const oldWeek = appState?.weeks?.[oldWeekIdx];
  const newWeek = appState?.weeks?.[newWeekIdx];
  if (!oldWeek || !newWeek) return 0;

  const cleanOldTask = stripModuleBracketsFromText(oldTaskText, oldMod);
  const cleanNewTask = stripModuleBracketsFromText(newTaskText, newMod);
  const newWeekOneLine = normalizeWeekLabelOneLine(newWeek.weekLabel);

  const attachedDocs = getDocsForTask(oldWeekIdx, oldMod, cleanOldTask);
  if (attachedDocs.length === 0) return 0;

  let movedDocsCount = 0;
  let orderCounter = getNextSortOrderInScope(newMod, newWeekOneLine, cleanNewTask);

  for (const doc of attachedDocs) {
    doc.module = newMod;
    doc.weekLabel = newWeekOneLine;
    doc.taskText = cleanNewTask;
    doc.taskHash = computeTaskHash(newMod, newWeek.id, cleanNewTask);
    doc.title = formatDocTitleForTask(cleanNewTask, doc.category, doc.fileName);
    doc.sortOrder = orderCounter;
    orderCounter += 10;
    doc.manualOverride = true;
    doc.needsDriveUpdate = true;
    doc.updatedAt = Date.now();
    await putDocRecordInDB(doc);
    movedDocsCount++;
  }

  if (movedDocsCount > 0) {
    await refreshDocsCache();
    saveState();
    if (typeof scheduleAutoDriveSync === 'function') scheduleAutoDriveSync();
  }
  return movedDocsCount;
}

/* =========================================================
   4. REIHENFOLGE VON DOKUMENTEN (OHNE ODER MIT AUFGABE) ÄNDERN
   ========================================================= */
function getPeerDocsInSameScope(doc) {
  if (!doc) return [];
  const docWkId = resolveWeekIdFromLabelOrId(doc.weekLabel);
  const docTaskNorm = normalizeTaskTextForMatch(doc.taskText || '', doc.module);

  const peers = cachedDocsList.filter(d => {
    if (d.module !== doc.module) return false;
    if (resolveWeekIdFromLabelOrId(d.weekLabel) !== docWkId) return false;
    const dTaskNorm = normalizeTaskTextForMatch(d.taskText || '', d.module);
    return dTaskNorm === docTaskNorm;
  });
  return sortDocsByOrder(peers);
}

async function moveDocOrder(docId, direction, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  closeAllDocActionMenus();
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;

  const peers = getPeerDocsInSameScope(doc);
  if (peers.length < 2) {
    showToast('ℹ️ Nur eine Datei in diesem Bereich vorhanden.');
    return;
  }

  peers.forEach((p, i) => {
    p.sortOrder = (i + 1) * 10;
  });

  const currentIdx = peers.findIndex(p => p.id === docId);
  const targetIdx = currentIdx + direction;
  if (targetIdx < 0 || targetIdx >= peers.length) return;

  const otherDoc = peers[targetIdx];
  const tempOrder = doc.sortOrder;
  doc.sortOrder = otherDoc.sortOrder;
  otherDoc.sortOrder = tempOrder;

  const now = Date.now();
  for (const p of peers) {
    p.updatedAt = now;
    p.needsDriveUpdate = true;
    await putDocRecordInDB(p);
  }
  await refreshDocsCache();
  saveState();
  if (typeof renderAll === 'function') renderAll();
  showToast('↕️ Dokumenten-Reihenfolge gespeichert!');
  if (typeof scheduleAutoDriveSync === 'function') scheduleAutoDriveSync();
}

function handleDocChipDragOver(event) {
  if (!draggedDocId) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.add('doc-chip-reorder-target');
}

function handleDocChipDragLeave(event) {
  event.currentTarget.classList.remove('doc-chip-reorder-target');
}

async function handleDocChipDropOnChip(event, targetDocId) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('doc-chip-reorder-target');

  const rawData = event.dataTransfer?.getData('text/plain') || '';
  const sourceDocId = draggedDocId || (rawData.startsWith('DOC:') ? rawData.replace('DOC:', '') : '');
  draggedDocId = null;

  if (!sourceDocId || sourceDocId === targetDocId) return;
  const srcDoc = cachedDocsList.find(d => d.id === sourceDocId);
  const tgtDoc = cachedDocsList.find(d => d.id === targetDocId);
  if (!srcDoc || !tgtDoc) return;

  srcDoc.module = tgtDoc.module;
  srcDoc.weekLabel = normalizeWeekLabelOneLine(tgtDoc.weekLabel);
  srcDoc.taskText = stripModuleBracketsFromText(tgtDoc.taskText || '', tgtDoc.module);
  srcDoc.taskHash = srcDoc.taskText ? computeTaskHash(srcDoc.module, srcDoc.weekLabel, srcDoc.taskText) : '';
  if (srcDoc.taskText) {
    srcDoc.title = formatDocTitleForTask(srcDoc.taskText, srcDoc.category, srcDoc.fileName);
  }
  srcDoc.manualOverride = true;
  srcDoc.needsDriveUpdate = true;

  const peers = getPeerDocsInSameScope(tgtDoc).filter(p => p.id !== srcDoc.id);
  const targetIndex = peers.findIndex(p => p.id === tgtDoc.id);
  peers.splice(targetIndex >= 0 ? targetIndex : peers.length, 0, srcDoc);

  const now = Date.now();
  for (let i = 0; i < peers.length; i++) {
    peers[i].sortOrder = (i + 1) * 10;
    peers[i].updatedAt = now;
    peers[i].needsDriveUpdate = true;
    await putDocRecordInDB(peers[i]);
  }

  await refreshDocsCache();
  saveState();
  if (typeof renderAll === 'function') renderAll();
  showToast('↕️ Dokumenten-Anordnung aktualisiert!');
  if (typeof scheduleAutoDriveSync === 'function') scheduleAutoDriveSync();
}

/* =========================================================
   5. KOMPAKTE DOKUMENT-CHIPS MIT ⋯-MENÜ & REIHENFOLGE-STEUERUNG
   ========================================================= */
function buildSingleDocChipHtml(doc, contextKey = 'chip') {
  const catMeta = getCategoryMeta(doc.category);
  const menuId = `docChipMenu_${contextKey}_${doc.id.replace(/[^a-zA-Z0-9_]/g, '')}`;
  const displayTitle = doc.title || doc.fileName || 'Dokument';

  return `
    <div class="task-doc-chip-group ${catMeta.chipClass}"
         draggable="true"
         ondragstart="handleDocDragStart(event, '${escapeAttr(doc.id)}')"
         ondragend="handleDocDragEnd(event)"
         ondragover="handleDocChipDragOver(event)"
         ondragleave="handleDocChipDragLeave(event)"
         ondrop="handleDocChipDropOnChip(event, '${escapeAttr(doc.id)}')">
      <button type="button"
              class="task-doc-chip"
              onclick="event.stopPropagation(); previewModuleDoc('${escapeAttr(doc.id)}')"
              title="${escapeAttr(displayTitle)} (${escapeAttr(doc.category || 'Vorlesung')}) – Klicken für Vorschau, ziehen zum Umsortieren">
        <span>${catMeta.icon}</span>
        <span class="task-doc-chip-title">${escapeHtml(displayTitle)}</span>
      </button>
      <div class="doc-menu-wrapper">
        <button type="button"
                class="chip-dots-btn"
                onclick="toggleDocActionMenu(event, '${escapeAttr(menuId)}')"
                title="Datei-Optionen (Vorschau, Reihenfolge, Kategorie, Download, Löschen)">⋯</button>
        <div class="doc-dropdown-menu" id="${escapeAttr(menuId)}" onclick="event.stopPropagation()">
          <button type="button" class="task-menu-item" onclick="closeAllDocActionMenus(); previewModuleDoc('${escapeAttr(doc.id)}')">
            <span>👁️</span> <span>Vorschau öffnen</span>
          </button>
          <button type="button" class="task-menu-item" onclick="closeAllDocActionMenus(); openEditDocModal('${escapeAttr(doc.id)}', event)">
            <span>✏️</span> <span>Kategorie &amp; Zuordnung ändern</span>
          </button>
          <button type="button" class="task-menu-item" onclick="moveDocOrder('${escapeAttr(doc.id)}', -1, event)">
            <span>⬅️</span> <span>Weiter nach vorne / oben</span>
          </button>
          <button type="button" class="task-menu-item" onclick="moveDocOrder('${escapeAttr(doc.id)}', 1, event)">
            <span>➡️</span> <span>Weiter nach hinten / unten</span>
          </button>
          <button type="button" class="task-menu-item" onclick="closeAllDocActionMenus(); downloadModuleDoc('${escapeAttr(doc.id)}')">
            <span>⬇️</span> <span>Herunterladen</span>
          </button>
          <button type="button" class="task-menu-item danger-item" onclick="closeAllDocActionMenus(); deleteModuleDoc('${escapeAttr(doc.id)}')">
            <span>🗑️</span> <span>Dokument löschen</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function toggleTaskDocFolder(folderKey, event) {
  if (event) event.stopPropagation();
  const box = document.getElementById(`taskFolder_${folderKey}`);
  if (!box) return;
  const isOpen = box.classList.toggle('open');
  if (isOpen) openTaskFoldersSet.add(folderKey);
  else openTaskFoldersSet.delete(folderKey);
}

function renderTaskDocChipsHtml(docsList, folderKey = 'fld') {
  if (!Array.isArray(docsList) || docsList.length === 0) return '';
  if (docsList.length === 1) {
    return `<div class="task-docs-row">${buildSingleDocChipHtml(docsList[0], folderKey)}</div>`;
  }
  const isOpen = openTaskFoldersSet.has(folderKey) ? 'open' : '';
  const docIdsJson = escapeAttr(JSON.stringify(docsList.map(d => d.id)));
  const chipsInside = docsList.map((d, i) => buildSingleDocChipHtml(d, `${folderKey}_${i}`)).join('');
  return `
    <div class="task-folder-box ${isOpen}"
         id="taskFolder_${escapeAttr(folderKey)}"
         draggable="true"
         ondragstart="handleDocFolderDragStart(event, '${docIdsJson}')"
         ondragend="handleDocDragEnd(event)">
      <button type="button" class="task-folder-toggle" onclick="toggleTaskDocFolder('${escapeAttr(folderKey)}', event)">
        <span>📂 ${docsList.length} Dateien in diesem Ordner</span>
        <span>▾</span>
      </button>
      <div class="task-folder-content">
        ${chipsInside}
      </div>
    </div>
  `;
}

function renderUnassignedWeekDocsHtml(remainingDocs) {
  if (!Array.isArray(remainingDocs) || remainingDocs.length === 0) return '';
  const chips = remainingDocs.map((d, idx) => buildSingleDocChipHtml(d, `wkrem_${idx}`)).join('');
  return `<div class="cell-docs-footer"><div class="task-docs-row">${chips}</div></div>`;
}

function renderGeneralModuleDocsCellHtml(shortName) {
  const genDocs = getGeneralModuleDocs(shortName);
  const chipsHtml = genDocs.length > 0
    ? `<div class="task-docs-row" style="margin-bottom:4px;">${genDocs.map((d, i) => buildSingleDocChipHtml(d, `gen_${shortName}_${i}`)).join('')}</div>`
    : `<span style="font-size:0.72rem; color:var(--text-muted);">Keine allgemeinen Dateien</span>`;

  return `
    <div>
      ${chipsHtml}
      <button type="button" class="add-task-btn" onclick="openUploadDocForGeneralModule('${escapeAttr(shortName)}', event)">+ Datei / Formelsammlung</button>
    </div>
  `;
}

/* =========================================================
   6. DRAG & DROP FÜR DOKUMENTE, GANZE ORDNER & PC-DATEIEN
      (MIT DETERMINISTISCHER SORTIERUNG & SOFORTIGEM AUTO-SYNC)
   ========================================================= */
function handleDocDragStart(event, docId) {
  event.stopPropagation();
  draggedTaskInfo = null;
  draggedDocFolderGroup = null;
  draggedDocId = docId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `DOC:${docId}`);
}

function handleDocFolderDragStart(event, docIdsJson) {
  event.stopPropagation();
  draggedTaskInfo = null;
  draggedDocId = null;
  try {
    draggedDocFolderGroup = JSON.parse(docIdsJson);
  } catch (e) {
    draggedDocFolderGroup = null;
  }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `DOCFOLDER:${docIdsJson}`);
}

function handleDocDragEnd() {
  draggedDocId = null;
  draggedDocFolderGroup = null;
  if (typeof stopDragAutoScroll === 'function') stopDragAutoScroll();
  document.querySelectorAll('.drag-over-cell, .drag-over-item, .doc-drop-target, .doc-chip-reorder-target').forEach(el => {
    el.classList.remove('drag-over-cell', 'drag-over-item', 'doc-drop-target', 'doc-chip-reorder-target');
  });
}

async function assignDocIdsToTarget(docIds, targetMod, targetWeekLabel, targetTaskText = '') {
  if (!Array.isArray(docIds) || docIds.length === 0) return 0;
  const cleanWeek = normalizeWeekLabelOneLine(targetWeekLabel);
  const cleanTask = targetTaskText ? stripModuleBracketsFromText(targetTaskText, targetMod) : '';
  let nextOrder = getNextSortOrderInScope(targetMod, cleanWeek, cleanTask);
  let count = 0;

  for (const id of docIds) {
    const doc = cachedDocsList.find(d => d.id === id);
    if (!doc) continue;
    doc.module = targetMod;
    doc.weekLabel = cleanWeek;
    doc.taskText = cleanTask;
    doc.taskHash = cleanTask ? computeTaskHash(targetMod, cleanWeek, cleanTask) : '';
    if (cleanTask) {
      doc.title = formatDocTitleForTask(cleanTask, doc.category, doc.fileName);
    }
    doc.sortOrder = nextOrder;
    nextOrder += 10;
    doc.manualOverride = true;
    doc.needsDriveUpdate = true;
    doc.updatedAt = Date.now();
    await putDocRecordInDB(doc);
    count++;
  }

  if (count > 0) {
    await refreshDocsCache();
    saveState();
    if (typeof renderAll === 'function') renderAll();
    if (typeof scheduleAutoDriveSync === 'function') scheduleAutoDriveSync();
  }
  return count;
}

async function assignDocToTaskByDragDrop(docIdOrIds, targetWeekIdx, targetMod, targetItemIdx) {
  const week = appState.weeks[targetWeekIdx];
  const taskItem = week?.cells?.[targetMod]?.[targetItemIdx];
  if (!week || !taskItem) return;
  const ids = Array.isArray(docIdOrIds) ? docIdOrIds : [docIdOrIds];
  const cleanTaskText = stripModuleBracketsFromText(taskItem.text, targetMod);
  const movedCount = await assignDocIdsToTarget(ids, targetMod, week.weekLabel, cleanTaskText);
  if (movedCount) {
    showToast(`📎 ${movedCount > 1 ? movedCount + ' Dateien' : 'Dokument'} fest der Aufgabe „${cleanTaskText}“ zugeordnet!`);
  }
}

async function handleDirectExternalFilesDropInCell(filesList, targetMod, targetWeekLabel = '', targetTaskText = '') {
  const files = Array.from(filesList || []);
  if (files.length === 0) return;
  startCancelableOperation(`Speichere ${files.length} gezogene Datei(en) in ${targetMod}...`);
  try {
    const newDocs = [];
    for (const file of files) {
      if (isCurrentActionCancelled()) break;
      const guess = analyzeFileForSmartSorting(file.name, targetMod, '', targetWeekLabel, targetTaskText, true);
      const finalWeek = normalizeWeekLabelOneLine(targetWeekLabel || guess.weekLabel);
      const finalTask = stripModuleBracketsFromText(targetTaskText || guess.taskText || '', targetMod);
      const nextOrd = getNextSortOrderInScope(targetMod, finalWeek, finalTask);

      const docRecord = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        module: targetMod,
        category: guess.category,
        weekLabel: finalWeek,
        taskText: finalTask,
        taskHash: finalTask ? computeTaskHash(targetMod, finalWeek, finalTask) : '',
        title: finalTask
          ? formatDocTitleForTask(finalTask, guess.category, file.name)
          : file.name.replace(/\.[^/.]+$/, ''),
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        sizeBytes: file.size || 0,
        hasLocalFile: true,
        manualOverride: true,
        needsDriveUpdate: true,
        sortOrder: nextOrd,
        uploadedAt: Date.now(),
        updatedAt: Date.now()
      };
      await putDocRecordInDB(docRecord, file);
      newDocs.push(docRecord);
    }
    await refreshDocsCache();
    saveState();
    if (typeof renderAll === 'function') renderAll();
    showToast(`✅ ${newDocs.length} Datei(en) direkt in ${targetMod} gespeichert!`);

    if (typeof scheduleAutoDriveSync === 'function') {
      scheduleAutoDriveSync(400);
    }
  } finally {
    hideLoading();
  }
}

async function handleGeneralCellDrop(event, targetMod) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over-cell');

  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    await handleDirectExternalFilesDropInCell(event.dataTransfer.files, targetMod, '', '');
    return;
  }

  const rawData = event.dataTransfer?.getData('text/plain') || '';
  if (draggedDocFolderGroup || rawData.startsWith('DOCFOLDER:')) {
    const ids = draggedDocFolderGroup || JSON.parse(rawData.replace('DOCFOLDER:', '') || '[]');
    draggedDocFolderGroup = null;
    await assignDocIdsToTarget(ids, targetMod, '', '');
    showToast(`📂 Ordner (${ids.length} Dateien) in ${targetMod} (Allgemein) abgelegt!`);
    return;
  }
  if (draggedDocId || rawData.startsWith('DOC:')) {
    const docId = draggedDocId || rawData.replace('DOC:', '');
    draggedDocId = null;
    await assignDocIdsToTarget([docId], targetMod, '', '');
    showToast(`📌 Dokument in ${targetMod} (Allgemein) abgelegt!`);
  }
}

async function recalculateTaskDocTitles(moduleName, weekLabel, taskText) {
  if (!taskText) return;
  const wkNorm = normalizeWeekLabelOneLine(weekLabel);
  for (const doc of cachedDocsList) {
    if (doc.module === moduleName && normalizeWeekLabelOneLine(doc.weekLabel) === wkNorm && doc.taskText === taskText) {
      doc.title = formatDocTitleForTask(taskText, doc.category, doc.fileName);
      doc.taskHash = computeTaskHash(moduleName, wkNorm, taskText);
      await putDocRecordInDB(doc);
    }
  }
}

async function sanitizeAndDeduplicateDocsSilent() {
  await refreshDocsCache();
  const seenKeys = new Set();
  for (const doc of [...cachedDocsList]) {
    const key = `${doc.module}|${(doc.fileName || '').toLowerCase()}|${doc.sizeBytes || 0}|${doc.taskHash || ''}`;
    if (seenKeys.has(key)) {
      await deleteDocRecordFromDB(doc.id, false);
    } else {
      seenKeys.add(key);
    }
  }
}

/* =========================================================
   7. TAB 3: MODUL-DOKUMENTENSPEICHER RENDERN
   ========================================================= */
function renderModuleDocsView() {
  const grid = document.getElementById('moduleDocsGrid');
  if (!grid || !appState) return;

  const modFilter = document.getElementById('docsModuleFilter')?.value || 'all';
  const catFilter = document.getElementById('docsCategoryFilter')?.value || 'all';

  const modulesToRender = modFilter === 'all'
    ? appState.modules
    : appState.modules.filter(m => m.shortName === modFilter);

  grid.innerHTML = modulesToRender.map(mod => {
    const modDocs = sortDocsByOrder(cachedDocsList.filter(d =>
      d.module === mod.shortName &&
      (catFilter === 'all' || d.category === catFilter)
    ));

    const groupsMap = new Map();
    for (const d of modDocs) {
      const wk = normalizeWeekLabelOneLine(d.weekLabel);
      const tsk = stripModuleBracketsFromText(d.taskText || '', mod.shortName);
      const groupKey = !wk ? '__GENERAL__' : (tsk ? `${wk}:::${tsk}` : `${wk}:::__WEEK_ONLY__`);
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          isGeneral: !wk,
          weekLabel: wk,
          taskText: tsk,
          docs: []
        });
      }
      groupsMap.get(groupKey).docs.push(d);
    }

    let foldersHtml = '';
    if (groupsMap.size === 0) {
      foldersHtml = `<p style="color:var(--text-muted); font-size:0.82rem; padding:8px 2px;">Noch keine Dokumente für diesen Filter hinterlegt. Ziehe Dateien einfach hierher oder klicke auf „+ Datei zu ${escapeHtml(mod.shortName)}“.</p>`;
    } else {
      const folderCards = [];
      for (const [, grp] of groupsMap.entries()) {
        const folderTitle = grp.isGeneral
          ? '📌 Allgemeine Modul-Unterlagen & Formelsammlungen'
          : (grp.taskText ? `${grp.taskText}` : `${grp.weekLabel} (Wochen-Unterlagen ohne Aufgabe)`);
        const folderSub = grp.isGeneral ? 'Ohne Wochenbezug (Reihenfolge frei änderbar)' : grp.weekLabel;
        const folderDocIdsJson = escapeAttr(JSON.stringify(grp.docs.map(x => x.id)));

        const filesHtml = grp.docs.map(doc => {
          const catMeta = getCategoryMeta(doc.category);
          const badgeClass = doc.category === 'Lösungen'
            ? 'doc-cat-solution'
            : (doc.category === 'Formelsammlung' ? 'doc-cat-formula' : (doc.category === 'Zusatz' ? 'doc-cat-extra' : ''));
          const menuId = `storageDocMenu_${doc.id.replace(/[^a-zA-Z0-9_]/g, '')}`;

          return `
            <div class="doc-compact-item"
                 draggable="true"
                 ondragstart="handleDocDragStart(event, '${escapeAttr(doc.id)}')"
                 ondragend="handleDocDragEnd(event)"
                 ondragover="handleDocChipDragOver(event)"
                 ondragleave="handleDocChipDragLeave(event)"
                 ondrop="handleDocChipDropOnChip(event, '${escapeAttr(doc.id)}')">
              <div class="doc-item-info" onclick="previewModuleDoc('${escapeAttr(doc.id)}')" title="Klicken für Vorschau, ziehen zum Umsortieren">
                <div class="doc-item-title">${catMeta.icon} ${escapeHtml(doc.title || doc.fileName)}</div>
                <div class="doc-item-meta">
                  <span class="doc-cat-badge ${badgeClass}">${escapeHtml(doc.category || 'Vorlesung')}</span>
                  ${doc.sizeBytes ? `<span>• ${formatFileSize(doc.sizeBytes)}</span>` : ''}
                  ${doc.driveFileId ? `<span>• ☁️ Drive</span>` : ''}
                </div>
              </div>
              <div class="doc-item-actions">
                <div class="doc-menu-wrapper">
                  <button type="button" class="doc-menu-btn" onclick="toggleDocActionMenu(event, '${escapeAttr(menuId)}')" title="Optionen">⋯</button>
                  <div class="doc-dropdown-menu" id="${escapeAttr(menuId)}" onclick="event.stopPropagation()">
                    <button type="button" class="task-menu-item" onclick="closeAllDocActionMenus(); previewModuleDoc('${escapeAttr(doc.id)}')">
                      <span>👁️</span> <span>Vorschau öffnen</span>
                    </button>
                    <button type="button" class="task-menu-item" onclick="closeAllDocActionMenus(); openEditDocModal('${escapeAttr(doc.id)}', event)">
                      <span>✏️</span> <span>Kategorie &amp; Zuordnung ändern</span>
                    </button>
                    <button type="button" class="task-menu-item" onclick="moveDocOrder('${escapeAttr(doc.id)}', -1, event)">
                      <span>↑</span> <span>Nach oben verschieben</span>
                    </button>
                    <button type="button" class="task-menu-item" onclick="moveDocOrder('${escapeAttr(doc.id)}', 1, event)">
                      <span>↓</span> <span>Nach unten verschieben</span>
                    </button>
                    <button type="button" class="task-menu-item" onclick="closeAllDocActionMenus(); downloadModuleDoc('${escapeAttr(doc.id)}')">
                      <span>⬇️</span> <span>Herunterladen</span>
                    </button>
                    <button type="button" class="task-menu-item danger-item" onclick="closeAllDocActionMenus(); deleteModuleDoc('${escapeAttr(doc.id)}')">
                      <span>🗑️</span> <span>Löschen</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');

        folderCards.push(`
          <div class="doc-folder-card ${grp.isGeneral ? 'general-folder' : ''}"
               draggable="true"
               ondragstart="handleDocFolderDragStart(event, '${folderDocIdsJson}')"
               ondragend="handleDocDragEnd(event)">
            <div class="doc-folder-header">
              <div>
                <div class="doc-folder-title">${escapeHtml(folderTitle)}</div>
                <div class="doc-folder-meta">${escapeHtml(folderSub)}</div>
              </div>
              <span class="doc-folder-meta">${grp.docs.length} Datei(en)</span>
            </div>
            <div class="doc-folder-files">${filesHtml}</div>
          </div>
        `);
      }
      foldersHtml = `<div class="docs-compact-grid">${folderCards.join('')}</div>`;
    }

    return `
      <div class="module-doc-section"
           ondragover="handleCellDragOver(event)"
           ondragleave="handleCellDragLeave(event)"
           ondrop="handleGeneralCellDrop(event, '${escapeAttr(mod.shortName)}')">
        <div class="module-doc-col-header">
          <h3>📁 ${escapeHtml(mod.shortName)} – ${escapeHtml(mod.fullName)} (${modDocs.length})</h3>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn btn-outline btn-sm" onclick="openUploadDocForGeneralModule('${escapeAttr(mod.shortName)}', event)">+ Datei zu ${escapeHtml(mod.shortName)}</button>
          </div>
        </div>
        ${foldersHtml}
      </div>
    `;
  }).join('');
}

/* =========================================================
   8. UPLOAD-DIALOG MIT SICHERER SPEICHERUNG DER AUFGABEN-ZUORDNUNG
   ========================================================= */
function populateUploadDocModalDropdowns(preMod = '', preCat = 'Vorlesung', preWeek = '') {
  const modSel = document.getElementById('docModuleSelect');
  const catSel = document.getElementById('docCategorySelect');
  const wkSel = document.getElementById('docWeekSelect');

  if (modSel && appState?.modules) {
    modSel.innerHTML = appState.modules.map(m =>
      `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} – ${escapeHtml(m.fullName)}</option>`
    ).join('');
    if (preMod) modSel.value = preMod;
  }
  if (catSel && preCat) {
    catSel.value = preCat;
  }
  if (wkSel && appState?.weeks) {
    wkSel.innerHTML = `<option value="">📌 Automatisch passend zur Aufgabe / Allgemein</option>` +
      appState.weeks.map(w => {
        const oneLine = normalizeWeekLabelOneLine(w.weekLabel);
        return `<option value="${escapeAttr(oneLine)}">${escapeHtml(oneLine)}</option>`;
      }).join('');
    wkSel.value = preWeek ? normalizeWeekLabelOneLine(preWeek) : '';
  }
}

function openUploadDocModal(preMod = '', preCat = 'Vorlesung', preWeek = '', preTaskText = '') {
  const docsModFilter = document.getElementById('docsModuleFilter')?.value;
  const docsCatFilter = document.getElementById('docsCategoryFilter')?.value;
  const effectiveMod = preMod || activeModuleFilter || (docsModFilter && docsModFilter !== 'all' ? docsModFilter : '') || (appState?.modules?.[0]?.shortName || 'ModSim');
  const effectiveCat = preCat || (docsCatFilter && docsCatFilter !== 'all' ? docsCatFilter : 'Vorlesung');

  populateUploadDocModalDropdowns(effectiveMod, effectiveCat, preWeek);
  window._preselectedUploadTaskText = preTaskText ? stripModuleBracketsFromText(preTaskText, effectiveMod) : '';
  renderPendingUploadQueue();
  openModal('uploadDocModal');
}

function onUploadPreselectionChanged() {
  if (pendingUploadQueue.length === 0) return;
  const defaultMod = document.getElementById('docModuleSelect')?.value || 'ModSim';
  const defaultCat = document.getElementById('docCategorySelect')?.value || 'Vorlesung';
  const defaultWk = document.getElementById('docWeekSelect')?.value || '';
  const preTask = window._preselectedUploadTaskText || '';

  for (const item of pendingUploadQueue) {
    const guess = analyzeFileForSmartSorting(item.fileName, defaultMod, defaultCat, defaultWk, preTask, true);
    item.module = guess.module;
    item.category = guess.category;
    item.weekLabel = guess.weekLabel;
    item.taskText = guess.taskText;
    item.title = guess.title;
    item.reason = guess.reason;
  }
  renderPendingUploadQueue();
}

function openUploadDocForTask(weekIdx, shortName, itemIdx, event) {
  if (event) event.stopPropagation();
  const week = appState?.weeks?.[weekIdx];
  const item = week?.cells?.[shortName]?.[itemIdx];
  const wkOneLine = week ? normalizeWeekLabelOneLine(week.weekLabel) : '';
  const cleanTask = item ? stripModuleBracketsFromText(item.text, shortName) : '';
  let guessedCat = 'Vorlesung';
  if (/übung|üb\b/i.test(cleanTask)) guessedCat = 'Übung';
  else if (/hörsaal|hsü/i.test(cleanTask)) guessedCat = 'Hörsaalübung';
  else if (/testat/i.test(cleanTask)) guessedCat = 'Testat / Praktikum';
  openUploadDocModal(shortName, guessedCat, wkOneLine, cleanTask);
}

function openUploadDocForGeneralModule(shortName, event) {
  if (event) event.stopPropagation();
  openUploadDocModal(shortName, 'Formelsammlung', '', '');
}

function handleUploadDropZoneDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('docDropZone')?.classList.add('drag-active');
}

function handleUploadDropZoneDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('docDropZone')?.classList.remove('drag-active');
}

function handleUploadDropZoneDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('docDropZone')?.classList.remove('drag-active');
  if (event.dataTransfer?.files?.length) {
    handleDocFilesSelected(event.dataTransfer.files);
  }
}

function handleDocFilesSelected(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const defaultMod = document.getElementById('docModuleSelect')?.value || 'ModSim';
  const defaultCat = document.getElementById('docCategorySelect')?.value || 'Vorlesung';
  const defaultWk = document.getElementById('docWeekSelect')?.value || '';
  const preTask = window._preselectedUploadTaskText || '';

  for (const file of files) {
    const guess = analyzeFileForSmartSorting(file.name, defaultMod, defaultCat, defaultWk, preTask, true);
    pendingUploadQueue.push({
      tempId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      file,
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
      sizeBytes: file.size || 0,
      module: guess.module,
      category: guess.category,
      weekLabel: guess.weekLabel,
      taskText: guess.taskText,
      title: guess.title,
      reason: guess.reason
    });
  }
  const fileInput = document.getElementById('docFileInput');
  if (fileInput) fileInput.value = '';
  renderPendingUploadQueue();
}

function buildTasksOptionsForModAndWeek(modName, weekLabelOneLine, selectedTask = '') {
  const normWk = normalizeWeekLabelOneLine(weekLabelOneLine);
  const weekObj = (appState?.weeks || []).find(w => isSameWeekLabelOrId(normWk, w));
  const tasks = weekObj ? (weekObj.cells[modName] || []) : [];
  const cleanSel = stripModuleBracketsFromText(selectedTask || '', modName);
  let html = `<option value="">– Ohne spezifische Aufgabe (Wochen-/Modul-Ordner) –</option>`;
  let matchedAny = false;
  for (const t of tasks) {
    const clean = stripModuleBracketsFromText(t.text, modName);
    const isSel = (normalizeTaskTextForMatch(clean, modName) === normalizeTaskTextForMatch(cleanSel, modName) && cleanSel !== '');
    if (isSel) matchedAny = true;
    html += `<option value="${escapeAttr(clean)}" ${isSel ? 'selected' : ''}>🎯 ${escapeHtml(clean)}</option>`;
  }
  if (cleanSel && !matchedAny) {
    html += `<option value="${escapeAttr(cleanSel)}" selected>🎯 ${escapeHtml(cleanSel)}</option>`;
  }
  return html;
}

function updatePendingQueueItem(index, field, value) {
  const entry = pendingUploadQueue[index];
  if (!entry) return;
  entry[field] = value;

  if (field === 'module') {
    const reGuess = analyzeFileForSmartSorting(entry.fileName, entry.module, entry.category, '', '', true);
    entry.weekLabel = reGuess.weekLabel;
    entry.taskText = reGuess.taskText;
    entry.title = reGuess.title;
    entry.reason = reGuess.reason;
    renderPendingUploadQueue();
    return;
  }

  if (field === 'weekLabel') {
    const normWk = normalizeWeekLabelOneLine(entry.weekLabel);
    const wkObj = (appState?.weeks || []).find(w => isSameWeekLabelOrId(normWk, w));
    const tasks = wkObj ? (wkObj.cells[entry.module] || []) : [];
    const matchingCatTask = tasks.find(t => doesTaskMatchCategory(t.text, entry.category));
    if (matchingCatTask) {
      entry.taskText = stripModuleBracketsFromText(matchingCatTask.text, entry.module);
    } else if (tasks.length === 1) {
      entry.taskText = stripModuleBracketsFromText(tasks[0].text, entry.module);
    } else {
      entry.taskText = '';
    }
    entry.title = entry.taskText
      ? formatDocTitleForTask(entry.taskText, entry.category, entry.fileName)
      : formatDocTitleForTask('', entry.category, entry.fileName);
    renderPendingUploadQueue();
    return;
  }

  if (field === 'category' || field === 'taskText') {
    // Falls eine Aufgabe ausgewählt wurde, aber weekLabel noch leer war, finde automatisch die passende Woche zur Aufgabe
    if (field === 'taskText' && entry.taskText && !entry.weekLabel && appState?.weeks) {
      const foundWk = appState.weeks.find(w =>
        (w.cells[entry.module] || []).some(t =>
          normalizeTaskTextForMatch(t.text, entry.module) === normalizeTaskTextForMatch(entry.taskText, entry.module)
        )
      );
      if (foundWk) {
        entry.weekLabel = normalizeWeekLabelOneLine(foundWk.weekLabel);
      }
    }
    entry.title = entry.taskText
      ? formatDocTitleForTask(entry.taskText, entry.category, entry.fileName)
      : formatDocTitleForTask('', entry.category, entry.fileName);
    renderPendingUploadQueue();
  }
}

function removePendingQueueItem(index) {
  pendingUploadQueue.splice(index, 1);
  renderPendingUploadQueue();
}

function clearPendingUploadQueue() {
  pendingUploadQueue = [];
  renderPendingUploadQueue();
}

function renderPendingUploadQueue() {
  const listEl = document.getElementById('docSmartPreviewList');
  const countEl = document.getElementById('pendingUploadCountLabel');
  const clearBtn = document.getElementById('clearPendingUploadsBtn');
  if (!listEl) return;

  if (countEl) {
    countEl.textContent = pendingUploadQueue.length === 0
      ? 'Noch keine Dateien in der Warteschlange'
      : `${pendingUploadQueue.length} Datei(en) bereit zum Speichern`;
  }
  if (clearBtn) {
    clearBtn.style.display = pendingUploadQueue.length > 0 ? 'inline-flex' : 'none';
  }

  if (pendingUploadQueue.length === 0) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = pendingUploadQueue.map((item, idx) => {
    const modOpts = (appState?.modules || []).map(m =>
      `<option value="${escapeAttr(m.shortName)}" ${m.shortName === item.module ? 'selected' : ''}>${escapeHtml(m.shortName)}</option>`
    ).join('');

    const catOpts = DOC_CATEGORIES.map(c =>
      `<option value="${escapeAttr(c.value)}" ${c.value === item.category ? 'selected' : ''}>${escapeHtml(c.label)}</option>`
    ).join('');

    const wkOpts = `<option value="" ${!item.weekLabel ? 'selected' : ''}>📌 Allgemein (ohne Wochenbezug)</option>` +
      (appState?.weeks || []).map(w => {
        const one = normalizeWeekLabelOneLine(w.weekLabel);
        return `<option value="${escapeAttr(one)}" ${isSameWeekLabelOrId(item.weekLabel, w) ? 'selected' : ''}>${escapeHtml(one)}</option>`;
      }).join('');

    const taskOpts = buildTasksOptionsForModAndWeek(item.module, item.weekLabel, item.taskText);

    return `
      <div class="smart-sort-card">
        <div class="smart-sort-card-header">
          <strong>📄 ${escapeHtml(item.fileName)} (${formatFileSize(item.sizeBytes)})</strong>
          <div style="display:flex; gap:6px; align-items:center;">
            <span class="smart-sort-reason">✨ ${escapeHtml(item.reason)}</span>
            <button type="button" class="btn btn-danger-outline btn-sm" onclick="removePendingQueueItem(${idx})">✖</button>
          </div>
        </div>
        <div class="smart-sort-grid">
          <div class="form-group">
            <label>Modul</label>
            <select class="select-box full-width" onchange="updatePendingQueueItem(${idx}, 'module', this.value)">${modOpts}</select>
          </div>
          <div class="form-group">
            <label>Kategorie</label>
            <select class="select-box full-width" onchange="updatePendingQueueItem(${idx}, 'category', this.value)">${catOpts}</select>
          </div>
          <div class="form-group">
            <label>Semesterwoche</label>
            <select class="select-box full-width" onchange="updatePendingQueueItem(${idx}, 'weekLabel', this.value)">${wkOpts}</select>
          </div>
          <div class="form-group">
            <label>Aufgabe (optional)</label>
            <select class="select-box full-width" onchange="updatePendingQueueItem(${idx}, 'taskText', this.value)">${taskOpts}</select>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function handleSaveUploadedDocs() {
  if (pendingUploadQueue.length === 0) {
    showToast('⚠️ Bitte zuerst mindestens eine Datei auswählen oder hineinziehen.');
    return;
  }
  startCancelableOperation(`Speichere ${pendingUploadQueue.length} Dokument(e)...`);
  try {
    const savedDocs = [];
    for (const item of pendingUploadQueue) {
      if (isCurrentActionCancelled()) break;
      const cleanWeek = normalizeWeekLabelOneLine(item.weekLabel);
      const cleanTask = stripModuleBracketsFromText(item.taskText || '', item.module);
      const nextOrd = getNextSortOrderInScope(item.module, cleanWeek, cleanTask);

      const newDoc = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        module: item.module,
        category: item.category,
        weekLabel: cleanWeek,
        taskText: cleanTask,
        taskHash: cleanTask ? computeTaskHash(item.module, cleanWeek, cleanTask) : '',
        title: item.title || item.fileName.replace(/\.[^/.]+$/, ''),
        fileName: item.fileName,
        mimeType: item.mimeType || 'application/pdf',
        sizeBytes: item.sizeBytes || 0,
        hasLocalFile: true,
        manualOverride: true,
        needsDriveUpdate: true,
        sortOrder: nextOrd,
        uploadedAt: Date.now(),
        updatedAt: Date.now()
      };
      await putDocRecordInDB(newDoc, item.file);
      savedDocs.push(newDoc);
    }

    pendingUploadQueue = [];
    window._preselectedUploadTaskText = '';
    closeModal('uploadDocModal');
    await refreshDocsCache();
    saveState();
    if (typeof renderAll === 'function') renderAll();

    if (typeof isGoogleConnected === 'function' && isGoogleConnected() && typeof syncDocumentsWithGoogleDrive === 'function') {
      await syncDocumentsWithGoogleDrive(false);
    } else {
      showToast(`✅ ${savedDocs.length} Dokument(e) fest zugeordnet & lokal gesichert!`);
    }
  } finally {
    hideLoading();
  }
}

/* =========================================================
   9. BEARBEITEN VON KATEGORIE, MODUL, WOCHE & AUFGABE (editDocModal)
   ========================================================= */
function ensureEditDocModalExists() {
  if (document.getElementById('editDocModal')) return;
  const modalHtml = `
    <div class="modal-backdrop" id="editDocModal">
      <div class="modal">
        <div class="modal-header">
          <h3>✏️ Dokument-Kategorie &amp; Zuordnung bearbeiten</h3>
          <button type="button" class="modal-close" onclick="closeModal('editDocModal')">&times;</button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="editDocIdInput" value="">
          <div class="form-group" style="margin-bottom:12px;">
            <label for="editDocTitleInput">Anzeigename des Dokuments</label>
            <input type="text" id="editDocTitleInput" class="full-width" placeholder="Titel des Dokuments">
            <small class="field-note" id="editDocOriginalFileNote"></small>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label for="editDocModuleSelect">Modul / Fach</label>
              <select id="editDocModuleSelect" class="select-box full-width" onchange="onEditDocModuleOrWeekChange()"></select>
            </div>
            <div class="form-group">
              <label for="editDocCategorySelect">Kategorie</label>
              <select id="editDocCategorySelect" class="select-box full-width" onchange="onEditDocCategoryChange()"></select>
            </div>
          </div>
          <div class="form-grid" style="margin-top:12px;">
            <div class="form-group">
              <label for="editDocWeekSelect">Semesterwoche</label>
              <select id="editDocWeekSelect" class="select-box full-width" onchange="onEditDocModuleOrWeekChange()"></select>
            </div>
            <div class="form-group">
              <label for="editDocTaskSelect">Zugeordnete Aufgabe (optional)</label>
              <select id="editDocTaskSelect" class="select-box full-width" onchange="onEditDocTaskSelectChange()"></select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger-outline" style="margin-right:auto;" onclick="deleteDocFromEditModal()">🗑️ Löschen</button>
          <button type="button" class="btn btn-outline" onclick="closeModal('editDocModal')">Abbrechen</button>
          <button type="button" class="btn btn-primary" onclick="saveEditedDoc()">💾 Änderungen speichern</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function openEditDocModal(docId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  closeAllDocActionMenus();
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) {
    showToast('⚠️ Dokument wurde nicht gefunden.');
    return;
  }
  ensureEditDocModalExists();

  document.getElementById('editDocIdInput').value = doc.id;
  document.getElementById('editDocTitleInput').value = doc.title || doc.fileName || '';
  const noteEl = document.getElementById('editDocOriginalFileNote');
  if (noteEl) {
    noteEl.textContent = `Originaldatei: ${doc.fileName || 'Unbekannt'}`;
  }

  const modSel = document.getElementById('editDocModuleSelect');
  modSel.innerHTML = (appState?.modules || []).map(m =>
    `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} – ${escapeHtml(m.fullName)}</option>`
  ).join('');
  modSel.value = doc.module || appState.modules[0].shortName;

  const catSel = document.getElementById('editDocCategorySelect');
  catSel.innerHTML = DOC_CATEGORIES.map(c =>
    `<option value="${escapeAttr(c.value)}">${escapeHtml(c.label)}</option>`
  ).join('');
  catSel.value = DOC_CATEGORIES.some(c => c.value === doc.category) ? doc.category : 'Vorlesung';

  const wkSel = document.getElementById('editDocWeekSelect');
  const normDocWk = normalizeWeekLabelOneLine(doc.weekLabel);
  wkSel.innerHTML = `<option value="">📌 Allgemein (ohne Wochenbezug)</option>` +
    (appState?.weeks || []).map(w => {
      const one = normalizeWeekLabelOneLine(w.weekLabel);
      return `<option value="${escapeAttr(one)}">${escapeHtml(one)}</option>`;
    }).join('');
  wkSel.value = normDocWk;

  const taskSel = document.getElementById('editDocTaskSelect');
  taskSel.innerHTML = buildTasksOptionsForModAndWeek(modSel.value, normDocWk, stripModuleBracketsFromText(doc.taskText || '', modSel.value));

  openModal('editDocModal');
}

function onEditDocModuleOrWeekChange() {
  const modVal = document.getElementById('editDocModuleSelect')?.value || 'ModSim';
  const wkVal = document.getElementById('editDocWeekSelect')?.value || '';
  const taskSel = document.getElementById('editDocTaskSelect');
  if (!taskSel) return;
  taskSel.innerHTML = buildTasksOptionsForModAndWeek(modVal, wkVal, '');
}

function onEditDocCategoryChange() {
  const catVal = document.getElementById('editDocCategorySelect')?.value || 'Vorlesung';
  const taskVal = document.getElementById('editDocTaskSelect')?.value || '';
  const titleInput = document.getElementById('editDocTitleInput');
  const docId = document.getElementById('editDocIdInput')?.value;
  const doc = cachedDocsList.find(d => d.id === docId);
  if (titleInput && taskVal) {
    titleInput.value = formatDocTitleForTask(taskVal, catVal, doc?.fileName || '');
  }
}

function onEditDocTaskSelectChange() {
  const taskVal = document.getElementById('editDocTaskSelect')?.value || '';
  const catVal = document.getElementById('editDocCategorySelect')?.value || 'Vorlesung';
  const titleInput = document.getElementById('editDocTitleInput');
  const docId = document.getElementById('editDocIdInput')?.value;
  const doc = cachedDocsList.find(d => d.id === docId);
  if (titleInput && taskVal) {
    titleInput.value = formatDocTitleForTask(taskVal, catVal, doc?.fileName || '');
  }
}

async function saveEditedDoc() {
  const docId = document.getElementById('editDocIdInput')?.value;
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;

  const newTitle = (document.getElementById('editDocTitleInput')?.value || '').trim();
  const newMod = document.getElementById('editDocModuleSelect')?.value || doc.module;
  const newCat = document.getElementById('editDocCategorySelect')?.value || doc.category;
  const newWeek = normalizeWeekLabelOneLine(document.getElementById('editDocWeekSelect')?.value || '');
  const newTask = stripModuleBracketsFromText(document.getElementById('editDocTaskSelect')?.value || '', newMod);

  const scopeChanged =
    doc.module !== newMod ||
    normalizeWeekLabelOneLine(doc.weekLabel) !== newWeek ||
    normalizeTaskTextForMatch(doc.taskText || '', doc.module) !== normalizeTaskTextForMatch(newTask, newMod);

  doc.module = newMod;
  doc.category = newCat;
  doc.weekLabel = newWeek;
  doc.taskText = newTask;
  doc.taskHash = newTask ? computeTaskHash(newMod, newWeek, newTask) : '';
  doc.title = newTitle || (newTask ? formatDocTitleForTask(newTask, newCat, doc.fileName) : doc.fileName);
  if (scopeChanged) {
    doc.sortOrder = getNextSortOrderInScope(newMod, newWeek, newTask);
  }
  doc.manualOverride = true;
  doc.needsDriveUpdate = true;
  doc.updatedAt = Date.now();

  await putDocRecordInDB(doc);
  await refreshDocsCache();
  saveState();
  closeModal('editDocModal');
  if (typeof renderAll === 'function') renderAll();
  showToast(`✅ Dokument gespeichert (${doc.module} • ${doc.category})!`);

  if (typeof scheduleAutoDriveSync === 'function') {
    scheduleAutoDriveSync(500);
  }
}

async function deleteDocFromEditModal() {
  const docId = document.getElementById('editDocIdInput')?.value;
  closeModal('editDocModal');
  if (docId) await deleteModuleDoc(docId);
}

/* =========================================================
   10. HANDY- & IPAD-OPTIMIERTE DOKUMENT-VORSCHAU
   ========================================================= */
function closePreviewModal() {
  closeModal('docPreviewModal');
  const body = document.getElementById('docPreviewBody');
  if (body) body.innerHTML = '';
  if (activePreviewObjectUrl) {
    URL.revokeObjectURL(activePreviewObjectUrl);
    activePreviewObjectUrl = null;
  }
}

async function previewModuleDoc(docId) {
  closeAllDocActionMenus();
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;

  const titleEl = document.getElementById('docPreviewTitle');
  const bodyEl = document.getElementById('docPreviewBody');
  const dlBtn = document.getElementById('docPreviewDownloadBtn');
  const newTabBtn = document.getElementById('docPreviewNewTabBtn');
  const editBtn = document.getElementById('docPreviewEditBtn');

  if (titleEl) titleEl.textContent = `📄 ${doc.title || doc.fileName}`;
  if (editBtn) {
    editBtn.onclick = (ev) => {
      closePreviewModal();
      openEditDocModal(doc.id, ev);
    };
  }

  if (activePreviewObjectUrl) {
    URL.revokeObjectURL(activePreviewObjectUrl);
    activePreviewObjectUrl = null;
  }

  let blob = await getDocBlobFromDB(doc.id);
  if (!blob && doc.driveFileId && typeof ensureDriveDocContentLoaded === 'function') {
    startCancelableOperation('Lade Datei-Vorschau aus Google Drive...');
    try {
      blob = await ensureDriveDocContentLoaded(doc);
    } finally {
      hideLoading();
    }
  }

  openModal('docPreviewModal');

  if (!blob) {
    if (doc.webViewLink) {
      if (newTabBtn) {
        newTabBtn.href = doc.webViewLink;
        newTabBtn.style.display = 'inline-flex';
      }
      if (dlBtn) dlBtn.href = doc.webViewLink;
      bodyEl.innerHTML = `
        <div class="doc-preview-frame-container" style="flex-direction:column; gap:12px; padding:24px; text-align:center;">
          <p>Diese Datei liegt in deinem Google Drive.</p>
          <a href="${escapeAttr(doc.webViewLink)}" target="_blank" rel="noopener" class="btn btn-primary">☁️ Direkt in Google Drive öffnen</a>
        </div>
      `;
    } else {
      bodyEl.innerHTML = `<div class="doc-preview-frame-container"><p style="color:var(--text-muted); padding:24px;">Vorschau für diese Datei aktuell offline nicht verfügbar.</p></div>`;
    }
    return;
  }

  activePreviewObjectUrl = URL.createObjectURL(blob);
  if (dlBtn) {
    dlBtn.href = activePreviewObjectUrl;
    dlBtn.download = doc.fileName || `${doc.title || 'Dokument'}.pdf`;
  }
  if (newTabBtn) {
    newTabBtn.href = activePreviewObjectUrl;
    newTabBtn.style.display = 'inline-flex';
  }

  const mime = (doc.mimeType || blob.type || '').toLowerCase();
  const isTouchMobile = window.innerWidth <= 900 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  if (mime.startsWith('image/')) {
    bodyEl.innerHTML = `
      <div class="doc-preview-frame-container">
        <img src="${activePreviewObjectUrl}" alt="${escapeAttr(doc.title)}" style="max-width:100%; max-height:100%; border-radius:8px; object-fit:contain;">
      </div>
    `;
  } else {
    const mobileTopBar = isTouchMobile ? `
      <div class="doc-preview-mobile-bar">
        <span>📱 <strong>Tipp für Handy &amp; iPad:</strong> Für mehrseitiges Blättern &amp; Zoomen:</span>
        <a href="${activePreviewObjectUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">🔍 Im Vollbild-Reader öffnen</a>
      </div>
    ` : '';

    bodyEl.innerHTML = `
      ${mobileTopBar}
      <div class="doc-preview-frame-container">
        <iframe src="${activePreviewObjectUrl}#view=FitH" style="width:100%; height:100%; min-height:60vh; border:none; border-radius:6px;" title="${escapeAttr(doc.title)}"></iframe>
      </div>
    `;
  }
}

async function downloadModuleDoc(docId) {
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;
  let blob = await getDocBlobFromDB(doc.id);
  if (!blob && doc.driveFileId && typeof ensureDriveDocContentLoaded === 'function') {
    startCancelableOperation('Lade Datei aus Google Drive herunter...');
    try {
      blob = await ensureDriveDocContentLoaded(doc);
    } finally {
      hideLoading();
    }
  }
  if (!blob) {
    if (doc.webViewLink) window.open(doc.webViewLink, '_blank');
    else showToast('⚠️ Datei konnte nicht geladen werden.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.fileName || `${doc.title || 'Dokument'}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function deleteModuleDoc(docId) {
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;
  const driveId = doc.driveFileId;
  await deleteDocRecordFromDB(docId, true);
  if (typeof renderAll === 'function') renderAll();
  showToast('🗑️ Dokument dauerhaft gelöscht.');
  if (driveId && typeof isGoogleConnected === 'function' && isGoogleConnected() && typeof deleteDocFromGoogleDrive === 'function') {
    await deleteDocFromGoogleDrive(driveId);
  }
  if (typeof scheduleAutoDriveSync === 'function') scheduleAutoDriveSync();
}