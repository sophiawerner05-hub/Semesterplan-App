/* =========================================================
   UNTERPROGRAMM: DOKUMENTEN- & ORDNERSYSTEM (docs-manager.js)
   - Dauerhafte manuelle Umordnung (manualOverride verhindert Zurückspringen)
   - Direkt-Bearbeiten-Button (✏️) auch an jedem Dokument im Ordner
   - Neue Kategorien: "Formelsammlung" & "Zusatz"
   - Automatische Umbenennung nach Aufgabenbetitelung (+ "Lösung" / "Formelsammlung" / "Zusatz")
   - Ordner-Gruppierung bei mehreren Dokumenten pro Aufgabe
   ========================================================= */

const DOCS_DB_NAME = 'semesterplan_files_db';
const DOCS_STORE_NAME = 'module_documents';

const DOC_CATEGORIES = [
  { value: 'Vorlesung', label: '📖 Vorlesung' },
  { value: 'Übung', label: '✍️ Übung' },
  { value: 'Lösungen', label: '✅ Lösungen' },
  { value: 'Hörsaalübung', label: '🏛️ Hörsaalübung' },
  { value: 'Formelsammlung', label: '📐 Formelsammlung' },
  { value: 'Zusatz', label: '➕ Zusatz' },
  { value: 'Testat / Praktikum', label: '🔬 Testat / Praktikum' },
  { value: 'Klausur / Zusammenfassung', label: '🎓 Klausur / Zusammenfassung' }
];

let cachedDocsList = [];
let pendingUploadPlans = [];
let draggedDocId = null;

function formatFileSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

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

async function putDocRecordInDB(docRecord) {
  const db = await openDocsDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE_NAME, 'readwrite');
    tx.objectStore(DOCS_STORE_NAME).put(docRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteDocRecordFromDB(docId) {
  const db = await openDocsDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE_NAME, 'readwrite');
    tx.objectStore(DOCS_STORE_NAME).delete(docId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    cachedDocsList.sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0));
    await sanitizeAndDeduplicateDocsSilent();
  } catch (e) {
    console.warn('IndexedDB Dokumentenspeicher nicht verfügbar:', e);
    cachedDocsList = [];
  }
}

/* =========================================================
   EXAKTER WOCHEN-VERGLEICH
   ========================================================= */
function extractWeekKeyFromLabel(labelStr) {
  const s = String(labelStr || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('zusatz')) return 'week_17';
  const m = s.match(/\bwoche\s*(\d{1,2})\b/i);
  if (m) return `week_${parseInt(m[1], 10)}`;
  return s;
}

function isSameSemesterWeek(docWeekLabel, targetWeekObj) {
  if (!docWeekLabel || !targetWeekObj) return false;
  const docKey = extractWeekKeyFromLabel(docWeekLabel);
  const targetKey = targetWeekObj.id || extractWeekKeyFromLabel(targetWeekObj.weekLabel);
  return docKey !== '' && docKey === targetKey;
}

/* =========================================================
   AUTOMATISCHE DATEI-BETITELUNG NACH AUFGABE
   (+ "Lösung", "Formelsammlung", "Zusatz")
   ========================================================= */
function isSolutionDocument(category, fileName = '', currentTitle = '') {
  if (category === 'Lösungen') return true;
  const combined = `${fileName} ${currentTitle}`.toLowerCase();
  return /(lösung|loesung|musterlösung|musterloesung|solution|\blös\b|\bloes\b)/i.test(combined);
}

function formatDocTitleForTask(taskText, category, fileName = '', siblingIndex = 0, totalSameType = 1) {
  const cleanTask = stripModuleBracketsFromText(taskText || '').trim();
  if (!cleanTask) return fileName ? fileName.replace(/\.[^/.]+$/, '') : 'Dokument';
  const isSol = isSolutionDocument(category, fileName, '');
  let baseTitle = cleanTask;

  if (isSol && !/lösung/i.test(baseTitle)) {
    baseTitle = `${baseTitle} – Lösung`;
  } else if (category === 'Formelsammlung' && !/formelsammlung/i.test(baseTitle)) {
    baseTitle = `${baseTitle} – Formelsammlung`;
  } else if (category === 'Zusatz' && !/zusatz/i.test(baseTitle)) {
    baseTitle = `${baseTitle} – Zusatz`;
  }

  if (totalSameType > 1 && siblingIndex > 0) {
    return `${baseTitle} (${siblingIndex})`;
  }
  return baseTitle;
}

async function recalculateTaskDocTitles(moduleName, weekLabel, taskText) {
  if (!taskText) return;
  const matching = cachedDocsList.filter(d =>
    d.module === moduleName &&
    extractWeekKeyFromLabel(d.weekLabel) === extractWeekKeyFromLabel(weekLabel) &&
    (d.taskText || '').trim().toLowerCase() === taskText.trim().toLowerCase()
  );
  const solutions = matching.filter(d => isSolutionDocument(d.category, d.fileName, d.title));
  const others = matching.filter(d => !isSolutionDocument(d.category, d.fileName, d.title));

  for (let idx = 0; idx < solutions.length; idx++) {
    const doc = solutions[idx];
    doc.category = 'Lösungen';
    if (!doc.customTitleLocked) {
      doc.title = formatDocTitleForTask(taskText, 'Lösungen', doc.fileName, idx + 1, solutions.length);
    }
    await putDocRecordInDB(doc);
  }
  for (let idx = 0; idx < others.length; idx++) {
    const doc = others[idx];
    if (!doc.customTitleLocked) {
      doc.title = formatDocTitleForTask(taskText, doc.category, doc.fileName, idx + 1, others.length);
    }
    await putDocRecordInDB(doc);
  }
}

/* =========================================================
   INTELLIGENTE ZUORDNUNG ZU MODUL, WOCHE & AUFGABE
   ========================================================= */
function normalizeToken(rawToken) {
  const s = String(rawToken || '')
    .toLowerCase()
    .replace(/ueb|^ü(?=\s*\d)/, 'üb')
    .replace(/hsu/, 'hsü')
    .replace(/\s+/g, '');
  if (/^2-\d{2}$/.test(s)) return s;
  return s.replace(/([a-zäöüß]+)0+(\d+)/g, '$1$2');
}

function extractNormalizedTokens(str) {
  const tokenRegex = /\b(v\s*0*\d+|le\s*0*\d+|üb\s*0*\d+|ueb\s*0*\d+|ü\s*0*\d+|hsü\s*0*\d+|hsu\s*0*\d+|testat\s*0*\d+|2-\d{2}|typ\s*[a-j])\b/gi;
  return (String(str || '').match(tokenRegex) || []).map(normalizeToken);
}

function findBestTaskInWeek(weekIdx, moduleName, fileName, category) {
  const week = appState?.weeks?.[weekIdx];
  if (!week) return '';
  const tasks = week.cells?.[moduleName] || [];
  if (tasks.length === 0) return '';
  if (tasks.length === 1) return tasks[0].text;

  const docTokens = extractNormalizedTokens(fileName);
  for (const t of tasks) {
    const tTokens = extractNormalizedTokens(t.text);
    if (docTokens.length > 0 && tTokens.some(tok => docTokens.includes(tok))) {
      return t.text;
    }
  }

  for (const t of tasks) {
    const lower = t.text.toLowerCase();
    if (category === 'Hörsaalübung' && (lower.includes('hörsaal') || lower.includes('hsü'))) return t.text;
    if ((category === 'Übung' || category === 'Lösungen') && (lower.includes('übung') || lower.includes('üb ')) && !lower.includes('hörsaal')) return t.text;
    if (category === 'Vorlesung' && (lower.includes('vorlesung') || /\b(v\s*\d+|le\s*\d+|2-\d{2})\b/i.test(t.text))) return t.text;
    if (category === 'Testat / Praktikum' && lower.includes('testat')) return t.text;
  }
  return '';
}

function analyzeFileForSmartSorting(fileName, fallbackModule, fallbackCategory, fallbackWeekLabel, preselectedTaskText = '') {
  const cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/[_\-]+/g, ' ');
  const lower = cleanName.toLowerCase();
  let detectedModule = fallbackModule || appState.modules[0]?.shortName || 'ModSim';

  const modPatterns = [
    { mod: 'ModSim', regex: /\b(modsim|modellierung|simulation|fem|numpy|python|awp|rwp|2-\d{2})\b/i },
    { mod: 'Informatik', regex: /\b(info|informatik|programmierung|grundbegriffe|le\s*0*\d+|ringtausch|oop|polymorphismus|verkettete|bool)\b/i },
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
  if (/(lösung|loesung|musterlösung|musterloesung|solution|\blös\b|\bloes\b)/i.test(cleanName)) {
    detectedCategory = 'Lösungen';
  } else if (/(formelsammlung|formeln|merkblatt|cheatsheet)/i.test(cleanName)) {
    detectedCategory = 'Formelsammlung';
  } else if (/(zusatz|bonus|ergänzung|ergaenzung|extra|beispiel)/i.test(cleanName)) {
    detectedCategory = 'Zusatz';
  } else if (/(hsü|hsu|hörsaal|hoersaal)/i.test(cleanName)) {
    detectedCategory = 'Hörsaalübung';
  } else if (/(üb|ueb|übung|uebung|blatt|aufgabe)/i.test(cleanName)) {
    detectedCategory = 'Übung';
  } else if (/(testat|praktikum|labor)/i.test(cleanName)) {
    detectedCategory = 'Testat / Praktikum';
  } else if (/(klausur|altklausur|zusammenfassung|skript)/i.test(cleanName)) {
    detectedCategory = 'Klausur / Zusammenfassung';
  } else if (/(vorlesung|folien|\bv\s*0*\d+|\ble\s*0*\d+)/i.test(cleanName)) {
    detectedCategory = 'Vorlesung';
  }

  let detectedWeekLabel = fallbackWeekLabel || '';
  let detectedTaskText = preselectedTaskText || '';
  let matchReason = 'Standard-Auswahl';

  if (detectedCategory === 'Formelsammlung' && !fallbackWeekLabel && !preselectedTaskText) {
    return {
      module: detectedModule,
      category: detectedCategory,
      weekLabel: '',
      taskText: '',
      reason: 'Formelsammlung → Oben in Modulspalte'
    };
  }

  const tokens = extractNormalizedTokens(cleanName);
  let bestScore = 0;
  let bestWeekIdx = -1;
  let bestTask = '';
  let bestToken = '';

  for (let wIdx = 0; wIdx < appState.weeks.length; wIdx++) {
    const week = appState.weeks[wIdx];
    const modItems = week.cells[detectedModule] || [];
    for (const item of modItems) {
      const itemTokens = extractNormalizedTokens(item.text);
      let score = 0;
      for (const tok of tokens) {
        if (itemTokens.includes(tok)) {
          score += 20;
          bestToken = tok.toUpperCase();
        }
      }
      const words = lower.split(/\s+/).filter(w => w.length >= 4 && !['vorlesung', 'übung', 'uebung', 'lösung', 'loesung', 'neu2024', 'ws24'].includes(w));
      for (const w of words) {
        if (item.text.toLowerCase().includes(w)) {
          score += 5;
          if (!bestToken) bestToken = w;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestWeekIdx = wIdx;
        bestTask = item.text;
      }
    }
  }

  if (bestWeekIdx !== -1 && bestScore > 0) {
    detectedWeekLabel = appState.weeks[bestWeekIdx].weekLabel.replace(/\n/g, ' ');
    detectedTaskText = bestTask;
    matchReason = `Aufgabe erkannt über „${bestToken}“ → ${detectedTaskText}`;
  } else {
    const directWeekMatch = cleanName.match(/\b(?:woche|week|w)\s*0*(\d{1,2})\b/i);
    if (directWeekMatch) {
      const wNum = parseInt(directWeekMatch[1], 10);
      if (wNum >= 1 && wNum <= appState.weeks.length) {
        bestWeekIdx = wNum - 1;
        detectedWeekLabel = appState.weeks[bestWeekIdx].weekLabel.replace(/\n/g, ' ');
        detectedTaskText = findBestTaskInWeek(bestWeekIdx, detectedModule, cleanName, detectedCategory);
        matchReason = `Woche ${wNum} erkannt`;
      }
    } else if (detectedWeekLabel) {
      const wIdx = appState.weeks.findIndex(w => isSameSemesterWeek(detectedWeekLabel, w));
      if (wIdx !== -1 && !detectedTaskText) {
        detectedTaskText = findBestTaskInWeek(wIdx, detectedModule, cleanName, detectedCategory);
      }
    } else {
      matchReason = 'Ohne Wochenbezug → Oben in Modulspalte';
    }
  }

  return {
    module: detectedModule,
    category: detectedCategory,
    weekLabel: detectedWeekLabel,
    taskText: detectedTaskText,
    reason: matchReason
  };
}

/* =========================================================
   DUPLIKAT-BEREINIGUNG (RESPEKTIERT MANUELLE UMORDNUNGEN!)
   ========================================================= */
function getDocUniqueSignature(doc) {
  const cleanFile = String(doc.fileName || doc.title || '').trim().toLowerCase();
  const size = Number(doc.sizeBytes) || 0;
  return `${doc.module}::${cleanFile}::${size}`;
}

async function sanitizeAndDeduplicateDocsSilent() {
  if (!Array.isArray(cachedDocsList) || cachedDocsList.length === 0) return 0;
  const seenSignatures = new Map();
  const seenDriveIds = new Set();
  const toDeleteIds = [];
  let updatedCount = 0;

  for (const doc of cachedDocsList) {
    if (doc.driveFileId) {
      if (seenDriveIds.has(doc.driveFileId)) {
        toDeleteIds.push(doc.id);
        continue;
      }
      seenDriveIds.add(doc.driveFileId);
    }
    const sig = getDocUniqueSignature(doc);
    if (seenSignatures.has(sig)) {
      toDeleteIds.push(doc.id);
      continue;
    }
    seenSignatures.set(sig, doc.id);

    // WICHTIG: Wenn der Nutzer das Dokument manuell bearbeitet/umgeordnet hat, NIEMALS überschreiben!
    if (doc.manualOverride) {
      continue;
    }

    if (!doc.taskText && doc.fileName) {
      const guess = analyzeFileForSmartSorting(doc.fileName, doc.module, doc.category, doc.weekLabel);
      if (guess.taskText) {
        doc.weekLabel = guess.weekLabel;
        doc.taskText = guess.taskText;
        doc.title = formatDocTitleForTask(doc.taskText, doc.category, doc.fileName);
        await putDocRecordInDB(doc);
        updatedCount++;
      } else if (doc.weekLabel && /^woche\s*1\b/i.test(doc.weekLabel) && !/\b(le\s*0*2|v1|üb\s*0*1|üb\s*0*2)\b/i.test(doc.fileName)) {
        if (/\ble\s*0*1\b/i.test(doc.fileName)) {
          doc.weekLabel = '';
          doc.taskText = '';
          await putDocRecordInDB(doc);
          updatedCount++;
        }
      }
    }
  }

  for (const delId of toDeleteIds) {
    await deleteDocRecordFromDB(delId);
  }
  if (toDeleteIds.length > 0 || updatedCount > 0) {
    const db = await openDocsDatabase();
    cachedDocsList = await new Promise((resolve) => {
      const tx = db.transaction(DOCS_STORE_NAME, 'readonly');
      const req = tx.objectStore(DOCS_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }
  return toDeleteIds.length;
}

/* =========================================================
   ABFRAGE DER DOKUMENTE FÜR AUFGABEN, WOCHEN & MODUL-KOPFZEILE
   ========================================================= */
function getDocsForTask(weekIdx, shortName, taskText) {
  if (!Array.isArray(cachedDocsList) || cachedDocsList.length === 0) return [];
  const week = appState.weeks[weekIdx];
  if (!week) return [];
  const cleanTargetTask = stripModuleBracketsFromText(taskText, shortName).trim().toLowerCase();
  const taskTokens = extractNormalizedTokens(cleanTargetTask);
  const allWeekTasks = week.cells?.[shortName] || [];

  return cachedDocsList.filter(doc => {
    if (doc.module !== shortName) return false;
    if (!isSameSemesterWeek(doc.weekLabel, week)) return false;

    // 1. Wenn das Dokument eine gespeicherte Aufgaben-Zuordnung hat oder manuell umgeordnet wurde:
    if (doc.manualOverride || (doc.taskText && doc.taskText.trim() !== '')) {
      const assignedTask = stripModuleBracketsFromText(doc.taskText || '', shortName).trim().toLowerCase();
      return assignedTask !== '' && assignedTask === cleanTargetTask;
    }

    // 2. Automatische Token-Übereinstimmung innerhalb derselben Woche (nur falls noch nicht manuell festgesetzt)
    const docTokens = extractNormalizedTokens(`${doc.fileName || ''} ${doc.title || ''}`);
    if (taskTokens.length > 0 && docTokens.length > 0) {
      return taskTokens.some(tok => docTokens.includes(tok));
    }

    // 3. Falls es in dieser Woche und diesem Modul nur eine einzige Aufgabe gibt
    if (allWeekTasks.length === 1 && docTokens.length === 0) {
      return true;
    }
    return false;
  });
}

function getRemainingWeekDocs(weekIdx, shortName, alreadyShownDocIds) {
  if (!Array.isArray(cachedDocsList) || cachedDocsList.length === 0) return [];
  const week = appState.weeks[weekIdx];
  if (!week) return [];
  return cachedDocsList.filter(doc => {
    if (doc.module !== shortName) return false;
    if (alreadyShownDocIds && alreadyShownDocIds.has(doc.id)) return false;
    return isSameSemesterWeek(doc.weekLabel, week);
  });
}

function getGeneralModuleDocs(shortName) {
  if (!Array.isArray(cachedDocsList) || cachedDocsList.length === 0) return [];
  return cachedDocsList.filter(doc => doc.module === shortName && (!doc.weekLabel || doc.weekLabel.trim() === ''));
}

/* =========================================================
   RENDERING VON AUFGABEN-DOKUMENTEN (MIT DIREKT-UMORDNEN-BUTTON ✏️)
   ========================================================= */
function toggleTaskFolder(event, folderId) {
  event.stopPropagation();
  const box = document.getElementById(folderId);
  if (box) box.classList.toggle('open');
}

function getCategoryIcon(doc) {
  if (isSolutionDocument(doc.category, doc.fileName, doc.title)) return '✅';
  if (doc.category === 'Formelsammlung') return '📐';
  if (doc.category === 'Zusatz') return '➕';
  return '📄';
}

function buildSingleDocChipHtml(doc, isDraggable = false) {
  const isSol = isSolutionDocument(doc.category, doc.fileName, doc.title);
  const isFormula = doc.category === 'Formelsammlung';
  const icon = getCategoryIcon(doc);
  const dragAttrs = isDraggable
    ? `draggable="true" ondragstart="handleDocChipDragStart(event, '${escapeAttr(doc.id)}')"`
    : '';
  const groupClass = `${isSol ? 'solution-chip' : ''} ${isFormula ? 'formula-chip' : ''}`;
  const tooltip = `${doc.category}: ${doc.title} (Klicken zur Vorschau, ✏️ zum Umordnen)`;

  return `
    <div class="task-doc-chip-group ${groupClass}" ${dragAttrs}>
      <button type="button"
              class="task-doc-chip"
              onclick="event.stopPropagation(); previewModuleDoc('${escapeAttr(doc.id)}')"
              title="${escapeAttr(tooltip)}">
        <span>${icon}</span>
        <span class="task-doc-chip-title">${escapeHtml(doc.title)}</span>
      </button>
      <button type="button"
              class="chip-edit-btn"
              onclick="event.stopPropagation(); openEditDocModal('${escapeAttr(doc.id)}', event)"
              title="Dokument-Zuordnung (Modul, Woche, Aufgabe, Kategorie) direkt umordnen">
        ✏️
      </button>
    </div>
  `;
}

function renderTaskDocChipsHtml(docs, folderContextKey = '') {
  if (!docs || docs.length === 0) return '';
  if (docs.length === 1) {
    return `<div class="task-docs-row">${buildSingleDocChipHtml(docs[0], true)}</div>`;
  }
  const folderId = `taskFolder_${folderContextKey || docs[0].id}`;
  const solCount = docs.filter(d => isSolutionDocument(d.category, d.fileName, d.title)).length;
  const solHint = solCount > 0 ? ` (${solCount}× Lösung)` : '';
  const chipsHtml = docs.map(d => buildSingleDocChipHtml(d, true)).join('');

  return `
    <div class="task-folder-box" id="${escapeAttr(folderId)}" onclick="event.stopPropagation()">
      <button type="button" class="task-folder-toggle" onclick="toggleTaskFolder(event, '${escapeAttr(folderId)}')">
        <span>📁 Ordner: ${docs.length} Dateien${escapeHtml(solHint)}</span>
        <span>▾</span>
      </button>
      <div class="task-folder-content">
        ${chipsHtml}
      </div>
    </div>
  `;
}

function renderUnassignedWeekDocsHtml(docs) {
  if (!docs || docs.length === 0) return '';
  const chips = docs.map(d => buildSingleDocChipHtml(d, true)).join('');
  return `
    <div class="cell-docs-footer">
      <span class="unassigned-hint-label">🤚 Auf Aufgabe ziehen oder ✏️ klicken:</span>
      <div class="task-docs-row">${chips}</div>
    </div>
  `;
}

function renderGeneralModuleDocsCellHtml(shortName) {
  const genDocs = getGeneralModuleDocs(shortName);
  if (genDocs.length === 0) {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
        <span style="color:var(--text-muted); font-size:0.72rem;">Keine allg. Dateien</span>
        <button type="button" class="stat-doc-btn" onclick="openUploadDocModal('${escapeAttr(shortName)}', '')">+ Datei</button>
      </div>
    `;
  }
  const folderId = `genFolder_${shortName.replace(/\s+/g, '')}`;
  const chips = genDocs.map(d => buildSingleDocChipHtml(d, true)).join('');
  if (genDocs.length === 1) {
    return `
      <div style="display:flex; flex-direction:column; gap:4px;">
        <div class="task-docs-row">${chips}</div>
        <button type="button" class="stat-doc-btn" style="align-self:flex-start;" onclick="openUploadDocModal('${escapeAttr(shortName)}', '')">+ Datei</button>
      </div>
    `;
  }
  return `
    <div class="task-folder-box" id="${escapeAttr(folderId)}">
      <button type="button" class="task-folder-toggle" onclick="toggleTaskFolder(event, '${escapeAttr(folderId)}')">
        <span>📁 ${genDocs.length} Allg. Unterlagen</span>
        <span>▾</span>
      </button>
      <div class="task-folder-content">
        ${chips}
        <button type="button" class="stat-doc-btn" onclick="openUploadDocModal('${escapeAttr(shortName)}', '')">+ Weitere Datei</button>
      </div>
    </div>
  `;
}

/* =========================================================
   DRAG & DROP EINES DOKUMENTS DIREKT AUF EINE AUFGABE
   ========================================================= */
function handleDocChipDragStart(event, docId) {
  event.stopPropagation();
  draggedDocId = docId;
  draggedTaskInfo = null;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `DOC:${docId}`);
}

async function assignDocToTaskByDragDrop(docId, weekIdx, shortName, taskItemIdx) {
  const doc = cachedDocsList.find(d => d.id === docId);
  const week = appState.weeks[weekIdx];
  const taskItem = week?.cells?.[shortName]?.[taskItemIdx];
  if (!doc || !week || !taskItem) return;

  showLoading('Ordne Dokument der Aufgabe zu & passe Dateinamen an...');
  try {
    doc.module = shortName;
    doc.weekLabel = week.weekLabel.replace(/\n/g, ' ');
    doc.taskText = stripModuleBracketsFromText(taskItem.text, shortName);
    doc.manualOverride = true;
    doc.customTitleLocked = false;
    doc.needsDriveUpdate = true;
    doc.updatedAt = Date.now();

    await putDocRecordInDB(doc);
    await recalculateTaskDocTitles(doc.module, doc.weekLabel, doc.taskText);

    if (typeof syncSingleDocMetadataToDrive === 'function' && typeof isGoogleConnected === 'function' && isGoogleConnected()) {
      await syncSingleDocMetadataToDrive(doc);
    }
    await refreshDocsCache();
    renderAll();
    showToast(`📎 Dokument als „${doc.title}“ der Aufgabe zugeordnet!`);
  } finally {
    hideLoading();
  }
}

/* =========================================================
   UPLOAD-MODAL MIT SEQUENTIELLEM DRAG & DROP
   ========================================================= */
function buildTasksOptionsForWeekAndModule(moduleName, weekLabel, selectedTaskText = '') {
  const week = appState.weeks.find(w => isSameSemesterWeek(weekLabel, w));
  const tasks = week?.cells?.[moduleName] || [];
  let html = `<option value="">-- Ohne feste Aufgabe (in Woche ablegen) --</option>`;
  tasks.forEach(t => {
    const cleanTxt = stripModuleBracketsFromText(t.text, moduleName);
    const isSel = selectedTaskText && cleanTxt.trim().toLowerCase() === selectedTaskText.trim().toLowerCase();
    html += `<option value="${escapeAttr(cleanTxt)}" ${isSel ? 'selected' : ''}>🎯 ${escapeHtml(cleanTxt)}</option>`;
  });
  return html;
}

function openUploadDocModal(preselectedMod = null, preselectedWeekLabel = null, preselectedTaskText = '') {
  const modSel = document.getElementById('docModuleSelect');
  const catSel = document.getElementById('docCategorySelect');
  const weekSel = document.getElementById('docWeekSelect');

  if (modSel) {
    modSel.innerHTML = appState.modules.map(m =>
      `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} – ${escapeHtml(m.fullName)}</option>`
    ).join('');
    if (preselectedMod) modSel.value = preselectedMod;
  }
  if (catSel) {
    catSel.innerHTML = DOC_CATEGORIES.map(c =>
      `<option value="${escapeAttr(c.value)}">${escapeHtml(c.label)}</option>`
    ).join('');
  }
  if (weekSel) {
    weekSel.innerHTML = `<option value="">📌 Allgemein / Ohne Wochenbezug (oben in Modulspalte)</option>` +
      appState.weeks.map(w => {
        const oneLine = w.weekLabel.replace(/\n/g, ' ');
        return `<option value="${escapeAttr(oneLine)}">${escapeHtml(oneLine)}</option>`;
      }).join('');
    if (preselectedWeekLabel !== null) {
      weekSel.value = preselectedWeekLabel;
    }
  }

  const fileInput = document.getElementById('docFileInput');
  if (fileInput) {
    fileInput.value = '';
    fileInput.dataset.preselectedTask = preselectedTaskText || '';
  }

  pendingUploadPlans = [];
  renderSmartUploadPreview();
  openModal('uploadDocModal');
}

function openUploadDocForTask(weekIdx, shortName, itemIdx, event) {
  if (event) event.stopPropagation();
  const week = appState.weeks[weekIdx];
  const item = week?.cells?.[shortName]?.[itemIdx];
  const oneLineWeek = week ? week.weekLabel.replace(/\n/g, ' ') : '';
  const cleanTask = item ? stripModuleBracketsFromText(item.text, shortName) : '';
  openUploadDocModal(shortName, oneLineWeek, cleanTask);

  if (item) {
    const catSel = document.getElementById('docCategorySelect');
    const txt = cleanTask.toLowerCase();
    if (catSel) {
      if (txt.includes('hörsaal') || txt.includes('hsü')) catSel.value = 'Hörsaalübung';
      else if (txt.includes('übung') || txt.includes('üb ')) catSel.value = 'Übung';
      else if (txt.includes('testat')) catSel.value = 'Testat / Praktikum';
      else catSel.value = 'Vorlesung';
    }
  }
}

function handleUploadDropZoneDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.add('drag-active');
}

function handleUploadDropZoneDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-active');
}

function handleUploadDropZoneDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('drag-active');
  const droppedFiles = event.dataTransfer?.files;
  if (droppedFiles && droppedFiles.length > 0) {
    handleDocFilesSelected(droppedFiles);
  }
}

function clearPendingUploadQueue() {
  pendingUploadPlans = [];
  const fileInput = document.getElementById('docFileInput');
  if (fileInput) fileInput.value = '';
  renderSmartUploadPreview();
}

function removeSinglePendingPlan(idx) {
  pendingUploadPlans.splice(idx, 1);
  renderSmartUploadPreview();
}

function handleDocFilesSelected(fileListObj) {
  const incomingFiles = Array.from(fileListObj || document.getElementById('docFileInput')?.files || []);
  if (incomingFiles.length === 0) return;

  const fallbackMod = document.getElementById('docModuleSelect')?.value || appState.modules[0]?.shortName;
  const fallbackCat = document.getElementById('docCategorySelect')?.value || 'Vorlesung';
  const fallbackWeek = document.getElementById('docWeekSelect')?.value || '';
  const preselectedTask = document.getElementById('docFileInput')?.dataset?.preselectedTask || '';

  let addedCount = 0;
  let skippedDuplicates = 0;

  for (const file of incomingFiles) {
    const alreadyInQueue = pendingUploadPlans.some(p =>
      p.file.name.toLowerCase() === file.name.toLowerCase() && p.file.size === file.size
    );
    if (alreadyInQueue) {
      skippedDuplicates++;
      continue;
    }

    const guess = analyzeFileForSmartSorting(file.name, fallbackMod, fallbackCat, fallbackWeek, preselectedTask);
    const alreadyInDB = cachedDocsList.some(d =>
      d.module === guess.module &&
      (d.fileName || '').toLowerCase() === file.name.toLowerCase() &&
      Number(d.sizeBytes) === file.size
    );
    if (alreadyInDB) {
      skippedDuplicates++;
      continue;
    }

    const computedTitle = guess.taskText
      ? formatDocTitleForTask(guess.taskText, guess.category, file.name)
      : file.name.replace(/\.[^/.]+$/, '');

    pendingUploadPlans.push({
      file: file,
      title: computedTitle,
      module: guess.module,
      category: guess.category,
      weekLabel: guess.weekLabel,
      taskText: guess.taskText || '',
      reason: guess.reason
    });
    addedCount++;
  }

  if (skippedDuplicates > 0) {
    showToast(`ℹ️ ${skippedDuplicates} identische Datei(en) übersprungen (keine Dopplungen).`);
  } else if (addedCount > 0) {
    showToast(`➕ ${addedCount} Datei(en) zur Upload-Liste hinzugefügt (${pendingUploadPlans.length} gesamt).`);
  }

  renderSmartUploadPreview();
}

function renderSmartUploadPreview() {
  const previewContainer = document.getElementById('docSmartPreviewList');
  const countLabel = document.getElementById('pendingUploadCountLabel');
  const clearBtn = document.getElementById('clearPendingUploadsBtn');
  if (!previewContainer) return;

  if (countLabel) {
    countLabel.textContent = pendingUploadPlans.length === 0
      ? 'Noch keine Dateien in der Warteschlange'
      : `📋 ${pendingUploadPlans.length} Datei(en) bereit zum Speichern:`;
  }
  if (clearBtn) {
    clearBtn.style.display = pendingUploadPlans.length > 0 ? 'inline-flex' : 'none';
  }

  if (pendingUploadPlans.length === 0) {
    previewContainer.innerHTML = '';
    return;
  }

  const weekOptionsHtml = `<option value="">📌 Allgemein / Ohne Wochenbezug (oben in Modulspalte)</option>` +
    appState.weeks.map(w => {
      const oneLine = w.weekLabel.replace(/\n/g, ' ');
      return `<option value="${escapeAttr(oneLine)}">${escapeHtml(oneLine)}</option>`;
    }).join('');

  previewContainer.innerHTML = pendingUploadPlans.map((plan, idx) => {
    const taskOpts = buildTasksOptionsForWeekAndModule(plan.module, plan.weekLabel, plan.taskText);
    return `
      <div class="smart-sort-card">
        <div class="smart-sort-card-header">
          <div>
            <strong>📄 Original: ${escapeHtml(plan.file.name)} (${formatFileSize(plan.file.size)})</strong>
            <div style="font-size:0.78rem; color:var(--primary-dark); font-weight:700; margin-top:2px;">
              🏷️ Neuer Anzeigename: „${escapeHtml(plan.title)}“
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="smart-sort-reason">✨ ${escapeHtml(plan.reason)}</span>
            <button type="button" class="btn btn-danger-outline btn-sm" onclick="removeSinglePendingPlan(${idx})" title="Aus Liste entfernen">✖</button>
          </div>
        </div>
        <div class="smart-sort-grid">
          <div>
            <label style="font-size:0.72rem; font-weight:700;">Modul:</label>
            <select class="select-box full-width" onchange="updatePendingUploadPlan(${idx}, 'module', this.value)">
              ${appState.modules.map(m => `<option value="${escapeAttr(m.shortName)}" ${plan.module === m.shortName ? 'selected' : ''}>${escapeHtml(m.shortName)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.72rem; font-weight:700;">Kategorie:</label>
            <select class="select-box full-width" onchange="updatePendingUploadPlan(${idx}, 'category', this.value)">
              ${DOC_CATEGORIES.map(c => `<option value="${escapeAttr(c.value)}" ${plan.category === c.value ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.72rem; font-weight:700;">Semesterwoche:</label>
            <select class="select-box full-width" id="smartWeekSelect_${idx}" onchange="updatePendingUploadPlan(${idx}, 'weekLabel', this.value)">
              ${weekOptionsHtml}
            </select>
          </div>
          <div>
            <label style="font-size:0.72rem; font-weight:700;">Zugehörige Aufgabe:</label>
            <select class="select-box full-width" id="smartTaskSelect_${idx}" onchange="updatePendingUploadPlan(${idx}, 'taskText', this.value)">
              ${taskOpts}
            </select>
          </div>
        </div>
      </div>
    `;
  }).join('');

  pendingUploadPlans.forEach((plan, idx) => {
    const sel = document.getElementById(`smartWeekSelect_${idx}`);
    if (sel) sel.value = plan.weekLabel || '';
  });
}

function updatePendingUploadPlan(idx, field, value) {
  const plan = pendingUploadPlans[idx];
  if (!plan) return;
  plan[field] = value;

  if (field === 'module' || field === 'weekLabel') {
    const wIdx = appState.weeks.findIndex(w => isSameSemesterWeek(plan.weekLabel, w));
    plan.taskText = wIdx !== -1 ? findBestTaskInWeek(wIdx, plan.module, plan.file.name, plan.category) : '';
  }
  plan.title = plan.taskText
    ? formatDocTitleForTask(plan.taskText, plan.category, plan.file.name)
    : plan.file.name.replace(/\.[^/.]+$/, '');

  renderSmartUploadPreview();
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
  if (pendingUploadPlans.length === 0) {
    showToast('⚠️ Bitte ziehe mindestens eine Datei in das Upload-Feld.');
    return;
  }

  startCancelableOperation(`Speichere ${pendingUploadPlans.length} Dokument(e) & lade neue Dateien zu Drive hoch...`);
  try {
    let savedCount = 0;
    for (let i = 0; i < pendingUploadPlans.length; i++) {
      if (isCurrentActionCancelled()) break;
      const plan = pendingUploadPlans[i];
      const file = plan.file;

      const duplicate = cachedDocsList.find(d =>
        d.module === plan.module &&
        (d.fileName || '').toLowerCase() === file.name.toLowerCase() &&
        Number(d.sizeBytes) === file.size
      );
      if (duplicate) continue;

      const dataUrl = await readFileAsDataURL(file);
      const finalTitle = plan.taskText
        ? formatDocTitleForTask(plan.taskText, plan.category, file.name)
        : (plan.title || file.name);

      const docRecord = {
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        module: plan.module,
        category: plan.category,
        weekLabel: plan.weekLabel || '',
        taskText: plan.taskText || '',
        title: finalTitle,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        dataUrl: dataUrl,
        manualOverride: true,
        needsDriveUpdate: true,
        uploadedAt: Date.now(),
        updatedAt: Date.now()
      };

      await putDocRecordInDB(docRecord);
      cachedDocsList.push(docRecord);

      if (docRecord.taskText) {
        await recalculateTaskDocTitles(docRecord.module, docRecord.weekLabel, docRecord.taskText);
      }

      if (typeof uploadLocalDocToGoogleDrive === 'function' && typeof isGoogleConnected === 'function' && isGoogleConnected()) {
        try {
          await uploadLocalDocToGoogleDrive(docRecord);
          await putDocRecordInDB(docRecord);
        } catch (driveErr) {
          console.warn('Drive-Upload im Hintergrund fehlgeschlagen:', driveErr);
        }
      }
      savedCount++;
    }

    await refreshDocsCache();
    pendingUploadPlans = [];
    closeModal('uploadDocModal');
    renderAll();
    if (!isCurrentActionCancelled()) {
      showToast(`📁 ${savedCount} neue Datei(en) gespeichert & zugeordnet!`);
    }
  } catch (e) {
    console.error('Fehler beim Speichern des Dokuments:', e);
    showToast('❌ Fehler beim Speichern der Datei.');
  } finally {
    hideLoading();
  }
}

async function deleteModuleDoc(docId) {
  const doc = cachedDocsList.find(d => d.id === docId);
  startCancelableOperation('Entferne Dokument...');
  try {
    if (doc?.driveFileId && typeof deleteDocFromGoogleDrive === 'function' && typeof isGoogleConnected === 'function' && isGoogleConnected()) {
      await deleteDocFromGoogleDrive(doc.driveFileId);
    }
    await deleteDocRecordFromDB(docId);
    await refreshDocsCache();
    renderAll();
    showToast('🗑️ Dokument entfernt.');
  } catch (e) {
    console.error(e);
  } finally {
    hideLoading();
  }
}

/* =========================================================
   REPARIERTES BEARBEITEN & UMORDNEN VON DOKUMENTEN
   ========================================================= */
function ensureEditDocModalExists() {
  if (document.getElementById('editDocModal')) return;
  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'modal-backdrop';
  modalBackdrop.id = 'editDocModal';
  modalBackdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>✏️ Dokument-Zuordnung umordnen</h3>
        <button class="modal-close" onclick="closeModal('editDocModal')">&times;</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="editDocIdInput" value="">
        <div class="form-grid">
          <div class="form-group">
            <label for="editDocModuleSelect">Modul / Fach</label>
            <select id="editDocModuleSelect" class="select-box full-width" onchange="updateEditDocTaskDropdown()"></select>
          </div>
          <div class="form-group">
            <label for="editDocCategorySelect">Kategorie (inkl. Formelsammlung &amp; Zusatz)</label>
            <select id="editDocCategorySelect" class="select-box full-width" onchange="autoUpdateEditDocTitlePreview()"></select>
          </div>
        </div>
        <div class="form-group" style="margin-top: 14px;">
          <label for="editDocWeekSelect">Zugehörige Semesterwoche</label>
          <select id="editDocWeekSelect" class="select-box full-width" onchange="updateEditDocTaskDropdown()"></select>
        </div>
        <div class="form-group" style="margin-top: 14px;">
          <label for="editDocTaskSelect">Zugehörige Aufgabe (wird sofort dorthin verschoben)</label>
          <select id="editDocTaskSelect" class="select-box full-width" onchange="autoUpdateEditDocTitlePreview()"></select>
        </div>
        <div class="form-group" style="margin-top: 14px;">
          <label for="editDocTitleInput">Anzeigename des Dokuments</label>
          <input type="text" id="editDocTitleInput" class="full-width" oninput="this.dataset.userEdited='true'" onkeydown="if(event.key==='Enter') saveEditedDoc()">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger-outline" style="margin-right:auto;" onclick="deleteDocFromEditModal()">🗑️ Löschen</button>
        <button class="btn btn-outline" onclick="closeModal('editDocModal')">Abbrechen</button>
        <button class="btn btn-primary" onclick="saveEditedDoc()">💾 Jetzt umordnen &amp; speichern</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalBackdrop);
}

function deleteDocFromEditModal() {
  const docId = document.getElementById('editDocIdInput')?.value;
  closeModal('editDocModal');
  if (docId) deleteModuleDoc(docId);
}

function updateEditDocTaskDropdown(preselectedTask = null) {
  const mod = document.getElementById('editDocModuleSelect')?.value;
  const weekLabel = document.getElementById('editDocWeekSelect')?.value;
  const taskSel = document.getElementById('editDocTaskSelect');
  if (!taskSel) return;
  taskSel.innerHTML = buildTasksOptionsForWeekAndModule(mod, weekLabel, preselectedTask !== null ? preselectedTask : '');
  if (preselectedTask === null) {
    const titleInp = document.getElementById('editDocTitleInput');
    if (titleInp) titleInp.dataset.userEdited = 'false';
    autoUpdateEditDocTitlePreview();
  }
}

function autoUpdateEditDocTitlePreview() {
  const docId = document.getElementById('editDocIdInput')?.value;
  const doc = cachedDocsList.find(d => d.id === docId);
  const taskText = document.getElementById('editDocTaskSelect')?.value || '';
  const cat = document.getElementById('editDocCategorySelect')?.value || 'Vorlesung';
  const titleInp = document.getElementById('editDocTitleInput');
  if (!titleInp) return;

  if (taskText) {
    titleInp.value = formatDocTitleForTask(taskText, cat, doc?.fileName || '');
    titleInp.dataset.userEdited = 'false';
  } else if (doc?.fileName && titleInp.dataset.userEdited !== 'true') {
    titleInp.value = doc.fileName.replace(/\.[^/.]+$/, '');
  }
}

function openEditDocModal(docId, event = null) {
  if (event) event.stopPropagation();
  ensureEditDocModalExists();
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;
  closeModal('docPreviewModal');

  const modSel = document.getElementById('editDocModuleSelect');
  const catSel = document.getElementById('editDocCategorySelect');
  const weekSel = document.getElementById('editDocWeekSelect');
  const titleInp = document.getElementById('editDocTitleInput');
  const idInp = document.getElementById('editDocIdInput');

  if (idInp) idInp.value = doc.id;
  if (modSel) {
    modSel.innerHTML = appState.modules.map(m =>
      `<option value="${escapeAttr(m.shortName)}">${escapeHtml(m.shortName)} – ${escapeHtml(m.fullName)}</option>`
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
    weekSel.innerHTML = `<option value="">📌 Allgemein / Ohne Wochenbezug (oben in Modulspalte)</option>` +
      appState.weeks.map(w => {
        const oneLine = w.weekLabel.replace(/\n/g, ' ');
        return `<option value="${escapeAttr(oneLine)}">${escapeHtml(oneLine)}</option>`;
      }).join('');
    let matchedValue = '';
    for (const w of appState.weeks) {
      if (isSameSemesterWeek(doc.weekLabel, w)) {
        matchedValue = w.weekLabel.replace(/\n/g, ' ');
        break;
      }
    }
    weekSel.value = matchedValue;
  }

  updateEditDocTaskDropdown(doc.taskText || '');
  if (titleInp) {
    titleInp.value = doc.title || doc.fileName || '';
    titleInp.dataset.userEdited = 'false';
  }
  openModal('editDocModal');
}

async function saveEditedDoc() {
  const docId = document.getElementById('editDocIdInput')?.value;
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;

  const oldModule = doc.module;
  const oldWeek = doc.weekLabel;
  const oldTask = doc.taskText;

  const newMod = document.getElementById('editDocModuleSelect')?.value || doc.module;
  const newCat = document.getElementById('editDocCategorySelect')?.value || doc.category;
  const newWeek = document.getElementById('editDocWeekSelect')?.value || '';
  const newTask = document.getElementById('editDocTaskSelect')?.value || '';
  const titleInp = document.getElementById('editDocTitleInput');
  let newTitle = (titleInp?.value || '').trim();
  const userTypedCustomTitle = titleInp?.dataset?.userEdited === 'true';

  if (newTask && !userTypedCustomTitle) {
    newTitle = formatDocTitleForTask(newTask, newCat, doc.fileName);
  } else if (!newTask && !userTypedCustomTitle && doc.fileName) {
    newTitle = doc.fileName.replace(/\.[^/.]+$/, '');
  }

  // Speichere die neue Zuordnung mit manualOverride = true, damit das Dokument garantiert umgeordnet bleibt!
  doc.module = newMod;
  doc.category = newCat;
  doc.weekLabel = newWeek;
  doc.taskText = newTask;
  doc.title = newTitle || doc.fileName || doc.title;
  doc.manualOverride = true;
  doc.customTitleLocked = userTypedCustomTitle;
  doc.needsDriveUpdate = true;
  doc.updatedAt = Date.now();

  startCancelableOperation('Ordne Dokument um & aktualisiere Ansicht...');
  try {
    await putDocRecordInDB(doc);

    if (oldTask && (oldTask !== newTask || oldWeek !== newWeek || oldModule !== newMod)) {
      await recalculateTaskDocTitles(oldModule, oldWeek, oldTask);
    }
    if (doc.taskText) {
      await recalculateTaskDocTitles(doc.module, doc.weekLabel, doc.taskText);
    }

    if (typeof syncSingleDocMetadataToDrive === 'function' && typeof isGoogleConnected === 'function' && isGoogleConnected()) {
      await syncSingleDocMetadataToDrive(doc);
    }

    await refreshDocsCache();
    closeModal('editDocModal');
    renderAll();

    const targetPlace = newTask
      ? `${newMod} → ${newTask}`
      : (newWeek ? `${newMod} (${newWeek.split('(')[0].trim()})` : `${newMod} (Allgemein oben)`);
    showToast(`✅ Dokument erfolgreich umgeordnet nach: ${targetPlace}`);
  } finally {
    hideLoading();
  }
}

/* =========================================================
   DOKUMENT-VORSCHAU
   ========================================================= */
async function previewModuleDoc(docId) {
  const doc = cachedDocsList.find(d => d.id === docId);
  if (!doc) return;

  document.getElementById('docPreviewTitle').textContent = `📄 ${doc.module}: ${doc.title}`;
  const body = document.getElementById('docPreviewBody');
  const dlBtn = document.getElementById('docPreviewDownloadBtn');

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
    editBtn.textContent = '✏️ Zuordnung & Aufgabe umordnen';
    editBtn.onclick = () => openEditDocModal(doc.id);
  }

  if (!doc.dataUrl && doc.driveFileId && typeof ensureDriveDocContentLoaded === 'function') {
    startCancelableOperation('Lade Datei aus deinem Google Drive...');
    try {
      await ensureDriveDocContentLoaded(doc);
    } finally {
      hideLoading();
    }
  }

  if (doc.dataUrl) {
    dlBtn.href = doc.dataUrl;
    dlBtn.download = doc.fileName || doc.title;
  } else if (doc.webViewLink) {
    dlBtn.href = doc.webViewLink;
    dlBtn.target = '_blank';
  }

  if (doc.dataUrl && (doc.mimeType || '').includes('pdf')) {
    body.innerHTML = `<iframe src="${doc.dataUrl}" style="width:100%; height:65vh; border:none; border-radius:8px;"></iframe>`;
  } else if (doc.dataUrl && (doc.mimeType || '').startsWith('image/')) {
    body.innerHTML = `<img src="${doc.dataUrl}" alt="${escapeAttr(doc.title)}" style="max-width:100%; max-height:65vh; border-radius:8px;">`;
  } else if (doc.driveFileId && !doc.dataUrl) {
    body.innerHTML = `
      <iframe src="https://drive.google.com/file/d/${escapeAttr(doc.driveFileId)}/preview" style="width:100%; height:65vh; border:none; border-radius:8px;"></iframe>
    `;
  } else {
    body.innerHTML = `
      <div style="text-align:center; padding:30px;">
        <p style="font-size:3rem; margin-bottom:10px;">📦</p>
        <h4>${escapeHtml(doc.title)}</h4>
        <p style="color:var(--text-muted); margin-top:6px;">Originaldatei: ${escapeHtml(doc.fileName || doc.title)} (${formatFileSize(doc.sizeBytes)})</p>
        <p style="margin-top:12px;">Klicke unten rechts auf <strong>„Datei herunterladen“</strong>, um diese Datei zu öffnen.</p>
      </div>
    `;
  }
  openModal('docPreviewModal');
}

/* =========================================================
   KOMPAKTE RASTER- & ORDNER-ANSICHT IM TAB "MODUL-DOKUMENTE"
   ========================================================= */
function getCategoryBadgeClass(doc) {
  if (isSolutionDocument(doc.category, doc.fileName, doc.title)) return 'doc-cat-solution';
  if (doc.category === 'Formelsammlung') return 'doc-cat-formula';
  if (doc.category === 'Zusatz') return 'doc-cat-extra';
  return '';
}

function renderCompactDocItemHtml(doc) {
  const icon = getCategoryIcon(doc);
  const badgeClass = getCategoryBadgeClass(doc);
  const cloudBadge = doc.driveFileId ? `<span title="In Google Drive synchronisiert">☁️</span>` : '';
  return `
    <div class="doc-compact-item">
      <div class="doc-item-info">
        <div class="doc-item-title" title="${escapeAttr(doc.title + ' (' + (doc.fileName || '') + ')')}">
          ${icon} ${escapeHtml(doc.title)} ${cloudBadge}
        </div>
        <div class="doc-item-meta">
          <span class="doc-cat-badge ${badgeClass}">${escapeHtml(doc.category)}</span>
          <span>• ${formatFileSize(doc.sizeBytes)}</span>
        </div>
      </div>
      <div class="doc-item-actions">
        <button class="btn btn-outline btn-sm" onclick="previewModuleDoc('${escapeAttr(doc.id)}')" title="Vorschau">👁️</button>
        <button class="btn btn-outline btn-sm" onclick="openEditDocModal('${escapeAttr(doc.id)}', event)" title="Aufgabe / Woche umordnen">✏️</button>
        ${doc.dataUrl ? `<a class="btn btn-outline btn-sm" href="${doc.dataUrl}" download="${escapeAttr(doc.fileName || doc.title)}" title="Download">⬇️</a>` : ''}
        <button class="btn btn-danger-outline btn-sm" onclick="deleteModuleDoc('${escapeAttr(doc.id)}')" title="Löschen">🗑️</button>
      </div>
    </div>
  `;
}

function renderModuleDocsView() {
  const grid = document.getElementById('moduleDocsGrid');
  if (!grid || !appState) return;
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

    if (docsForMod.length === 0) {
      return `
        <div class="module-doc-section">
          <div class="module-doc-col-header">
            <div>
              <h3>📁 ${escapeHtml(mod.shortName)} – ${escapeHtml(mod.fullName)}</h3>
            </div>
            <button class="btn btn-outline btn-sm" onclick="openUploadDocModal('${escapeAttr(mod.shortName)}')">+ Datei hochladen</button>
          </div>
          <p style="font-size:0.8rem; color:var(--text-muted);">Noch keine Dokumente für diesen Filter hinterlegt.</p>
        </div>
      `;
    }

    const groupsMap = new Map();
    for (const doc of docsForMod) {
      const weekShort = doc.weekLabel ? doc.weekLabel.split('(')[0].trim() : '📌 Ohne Wochenbezug';
      const folderKey = doc.taskText
        ? `${weekShort}::${doc.taskText}`
        : `${weekShort}::Allgemein`;
      if (!groupsMap.has(folderKey)) {
        groupsMap.set(folderKey, {
          isGeneral: !doc.weekLabel,
          weekShort: weekShort,
          folderTitle: doc.taskText ? doc.taskText : (doc.weekLabel ? `${weekShort} (Unzugeordnet)` : '📌 Allgemeine Modul-Unterlagen'),
          files: []
        });
      }
      groupsMap.get(folderKey).files.push(doc);
    }

    const cardsHtml = Array.from(groupsMap.values()).map(group => {
      const folderIcon = group.files.length > 1 ? '📂' : '📁';
      return `
        <div class="doc-folder-card ${group.isGeneral ? 'general-folder' : ''}">
          <div class="doc-folder-header">
            <div>
              <div class="doc-folder-title">${folderIcon} ${escapeHtml(group.folderTitle)}</div>
              <div class="doc-folder-meta">${escapeHtml(group.weekShort)} • ${group.files.length} Datei(en)</div>
            </div>
          </div>
          <div class="doc-folder-files">
            ${group.files.map(renderCompactDocItemHtml).join('')}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="module-doc-section">
        <div class="module-doc-col-header">
          <div>
            <h3>📁 ${escapeHtml(mod.shortName)} – ${escapeHtml(mod.fullName)} (${docsForMod.length} Unterlagen)</h3>
          </div>
          <button class="btn btn-outline btn-sm" onclick="openUploadDocModal('${escapeAttr(mod.shortName)}')">+ Datei hochladen</button>
        </div>
        <div class="docs-compact-grid">
          ${cardsHtml}
        </div>
      </div>
    `;
  }).join('');
}