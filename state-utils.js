/* =========================================================
   UNTERPROGRAMM 2: STATE-VERWALTUNG, LÖSCH-GEDÄCHTNIS (TOMBSTONES),
   AUFGABEN-HASHING, RAM-SCHONENDE INDEXEDDB & STATISTIKEN (state-utils.js)
   ========================================================= */
var STORAGE_KEY = 'semesterplan_app_state_v3';
var THEME_KEY = 'semesterplan_theme';
var AUTO_BACKUP_DB_KEY = 'semesterplan_auto_offline_backup_v1';

var DOCS_DB_NAME = 'SemesterplanDocsDB';
var DOCS_DB_VERSION = 2;
var DOCS_META_STORE = 'docs_meta';
var DOCS_BLOB_STORE = 'docs_blobs';
var LEGACY_DOCS_STORE = 'module_docs';

var appState = null;
var activeModuleFilter = null;
var currentTab = 'table';
var cachedDocsList = [];
var docsDbPromise = null; 

/* =========================================================
   1. TEXT-ESCAPING & FORMATIERUNGS-HELFER
   ========================================================= */
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

function formatFileSize(bytes) {
  const b = Number(bytes) ? Number(bytes) : 0;
  if (b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/* =========================================================
   2. EINDEUTIGE SIGNATUREN & HASHES FÜR AUFGABEN & LÖSCH-SPERREN
   ========================================================= */
function stripModuleBracketsFromText(text, shortName = '') {
  let cleaned = String(text ?? '').trim();
  if (shortName) {
    cleaned = cleaned.replace(new RegExp(`^\\[\\s*${shortName}\\s*\\]\\s*:?\\s*`, 'i'), '');
  }
  return cleaned.replace(/^\[[^\]]+\]\s*:?\s*/, '').trim();
}

function normalizeTaskTextForMatch(text, shortName = '') {
  return stripModuleBracketsFromText(text ? text : '', shortName)
    .replace(/^[✅⏳📅]\s*/, '')
    .replace(new RegExp(`^${shortName}\\s*(\\([^)]*\\))?:?\\s*`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveWeekIdFromLabelOrId(weekIdOrLabel) {
  const raw = String(weekIdOrLabel ? weekIdOrLabel : '').trim();
  if (!raw) return 'general';
  if (/^week_\d+$/i.test(raw)) return raw.toLowerCase();

  const oneLine = raw.replace(/\n/g, ' ').trim();
  if (appState && Array.isArray(appState.weeks)) {
    const found = appState.weeks.find(w =>
      w.id === raw || w.weekLabel.replace(/\n/g, ' ').trim() === oneLine
    );
    if (found) return found.id;
  }
  const wkMatch = oneLine.match(/woche\s*(\d+|zusatz)/i);
  if (wkMatch) {
    return wkMatch[1].toLowerCase() === 'zusatz' ? 'week_17' : `week_${wkMatch[1]}`;
  }
  return oneLine.toLowerCase();
}

function buildTaskSignature(shortName, weekIdOrLabel, taskText) {
  const mod = String(shortName ? shortName : '').trim().toLowerCase();
  const wkId = resolveWeekIdFromLabelOrId(weekIdOrLabel);
  const normTxt = normalizeTaskTextForMatch(taskText, shortName);
  return [mod, wkId, normTxt].join('::');
}

function buildModuleTaskSignature(shortName, taskText) {
  const mod = String(shortName ? shortName : '').trim().toLowerCase();
  const normTxt = normalizeTaskTextForMatch(taskText, shortName);
  return [mod, '*', normTxt].join('::');
}

function computeTaskHash(shortName, weekIdOrLabel, taskText) {
  const normTxt = normalizeTaskTextForMatch(taskText, shortName);
  if (!normTxt) return '';
  const sig = buildTaskSignature(shortName, weekIdOrLabel, normTxt);
  let h = 2166136261;
  for (let i = 0; i < sig.length; i++) {
    h ^= sig.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'th_' + (h >>> 0).toString(36);
}

function isTaskTombstoned(shortName, weekIdOrLabel, taskText) {
  if (!appState || !appState.deletedTaskTombstones) return false;
  const exactSig = buildTaskSignature(shortName, weekIdOrLabel, taskText);
  const wildcardSig = buildModuleTaskSignature(shortName, taskText);
  return Boolean(appState.deletedTaskTombstones[exactSig] || appState.deletedTaskTombstones[wildcardSig]);
}

function registerTaskTombstone(shortName, weekIdOrLabel, taskText) {
  if (!appState) return;
  if (!appState.deletedTaskTombstones || typeof appState.deletedTaskTombstones !== 'object') {
    appState.deletedTaskTombstones = {};
  }
  const now = Date.now();
  const exactSig = buildTaskSignature(shortName, weekIdOrLabel, taskText);
  const wildcardSig = buildModuleTaskSignature(shortName, taskText);
  appState.deletedTaskTombstones[exactSig] = now;
  appState.deletedTaskTombstones[wildcardSig] = now;
}

function clearTaskTombstone(shortName, weekIdOrLabel, taskText) {
  if (!appState || !appState.deletedTaskTombstones) return;
  const exactSig = buildTaskSignature(shortName, weekIdOrLabel, taskText);
  const wildcardSig = buildModuleTaskSignature(shortName, taskText);
  delete appState.deletedTaskTombstones[exactSig];
  delete appState.deletedTaskTombstones[wildcardSig];
}

function purgeTombstonedTasksFromState(stateObj) {
  if (!stateObj || !Array.isArray(stateObj.weeks) || !stateObj.deletedTaskTombstones) return false;
  let removedAny = false;
  const tombs = stateObj.deletedTaskTombstones;
  for (const week of stateObj.weeks) {
    for (const mod of (stateObj.modules ? stateObj.modules : [])) {
      const sName = mod.shortName;
      const items = (week.cells && week.cells[sName]) ? week.cells[sName] : [];
      const filtered = items.filter(item => {
        const exactSig = buildTaskSignature(sName, week.id, item.text);
        const wildcardSig = buildModuleTaskSignature(sName, item.text);
        if (tombs[exactSig] || tombs[wildcardSig]) {
          removedAny = true;
          return false;
        }
        return true;
      });
      if (week.cells) week.cells[sName] = filtered;
    }
  }
  return removedAny;
}

/* =========================================================
   3. STATE LADEN, SPEICHERN & STILLES HINTERGRUND-BACKUP
   ========================================================= */
function ensureStateCollections(stateObj) {
  if (!stateObj) return;
  if (!Array.isArray(stateObj.deletedGoogleTaskIds)) stateObj.deletedGoogleTaskIds = [];
  if (!Array.isArray(stateObj.deletedGoogleEventIds)) stateObj.deletedGoogleEventIds = [];
  if (!stateObj.deletedTaskTombstones || typeof stateObj.deletedTaskTombstones !== 'object') {
    stateObj.deletedTaskTombstones = {};
  }
  if (!stateObj.deletedDocIds || typeof stateObj.deletedDocIds !== 'object') {
    stateObj.deletedDocIds = {};
  }
}

function saveSilentBackgroundBackup(stateObj) {
  if (!stateObj) return;
  try {
    localStorage.setItem(AUTO_BACKUP_DB_KEY, JSON.stringify({
      timestamp: Date.now(),
      state: stateObj
    }));
  } catch (e) {}
}

function restoreSilentBackgroundBackupIfNeeded() {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_DB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.state && Array.isArray(parsed.state.modules) && Array.isArray(parsed.state.weeks)) {
      return parsed.state;
    }
  } catch (e) {}
  return null;
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
        ensureStateCollections(appState);
        for (const week of appState.weeks) {
          for (const mod of appState.modules) {
            const list = week.cells[mod.shortName] ? week.cells[mod.shortName] : [];
            list.forEach(item => {
              item.text = stripModuleBracketsFromText(item.text, mod.shortName);
            });
          }
        }
        purgeTombstonedTasksFromState(appState);
        return;
      }
    }
  } catch (e) {
    console.warn('Konnte gespeicherten Status nicht laden, prüfe Hintergrund-Backup:', e);
  }

  const restored = restoreSilentBackgroundBackupIfNeeded();
  if (restored) {
    appState = restored;
    ensureStateCollections(appState);
    purgeTombstonedTasksFromState(appState);
    return;
  }

  if (typeof INITIAL_DATA === 'undefined') {
    appState = {
      modules: [],
      weeks: [],
      deletedGoogleTaskIds: [],
      deletedGoogleEventIds: [],
      deletedTaskTombstones: {},
      deletedDocIds: {}
    };
    return;
  }

  appState = JSON.parse(JSON.stringify(INITIAL_DATA));
  ensureStateCollections(appState);
  saveState();
}

function saveState() {
  try {
    if (!appState) return;
    ensureStateCollections(appState);
    appState.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    saveSilentBackgroundBackup(appState);
  } catch (e) {
    console.error('Fehler beim Speichern im localStorage:', e);
  }
}

/* =========================================================
   4. SPEICHERSCHONENDE INDEXED-DB (METADATEN GETRENNT VON BLOBS)
   ========================================================= */
function openDocsDB() {
  if (docsDbPromise) return docsDbPromise;
  docsDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DOCS_DB_NAME, DOCS_DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DOCS_META_STORE)) {
        db.createObjectStore(DOCS_META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DOCS_BLOB_STORE)) {
        db.createObjectStore(DOCS_BLOB_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(LEGACY_DOCS_STORE)) {
        db.createObjectStore(LEGACY_DOCS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => {
      docsDbPromise = null;
      reject(e.target.error);
    };
  });
  return docsDbPromise;
}

function inferMimeTypeFromFileName(fileName, fallbackMime = 'application/pdf') {
  const lower = String(fileName ? fileName : '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (fallbackMime && fallbackMime !== 'application/octet-stream') return fallbackMime;
  return 'application/pdf';
}

function dataUrlToBlobFast(dataUrl, fallbackMime = 'application/pdf') {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  try {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = (mimeMatch && mimeMatch[1] && mimeMatch[1] !== 'application/octet-stream')
      ? mimeMatch[1]
      : fallbackMime;
    const bstr = atob(parts[1] ? parts[1] : '');
    const u8arr = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    return null;
  }
}

async function normalizeToMemoryBlob(fileOrBlob, fileName = '', explicitMime = '') {
  if (!fileOrBlob) return null;
  const fName = fileName ? fileName : (fileOrBlob.name ? fileOrBlob.name : '');
  const fType = explicitMime ? explicitMime : (fileOrBlob.type ? fileOrBlob.type : '');
  const targetMime = inferMimeTypeFromFileName(fName, fType);
  try {
    if (typeof fileOrBlob.arrayBuffer === 'function') {
      const buf = await fileOrBlob.arrayBuffer();
      return new Blob([buf], { type: targetMime });
    }
  } catch (e) {}
  return new Blob([fileOrBlob], { type: targetMime });
}

function stripHeavyFieldsFromMeta(record) {
  const meta = { ...record };
  delete meta.dataUrl;
  delete meta.blob;
  meta.mimeType = inferMimeTypeFromFileName(meta.fileName ? meta.fileName : meta.title, meta.mimeType);
  meta.weekLabel = String(meta.weekLabel ? meta.weekLabel : '').replace(/\n/g, ' ').trim();
  meta.taskText = stripModuleBracketsFromText(meta.taskText ? meta.taskText : '', meta.module ? meta.module : '');
  if (meta.taskText) {
    meta.taskHash = computeTaskHash(meta.module, meta.weekLabel, meta.taskText);
  } else {
    meta.taskHash = '';
  }
  if (typeof meta.sortOrder !== 'number' || isNaN(meta.sortOrder)) {
    meta.sortOrder = meta.uploadedAt ? meta.uploadedAt : Date.now();
  }
  return meta;
}

function sortDocsByOrder(list) {
  return list.sort((a, b) => {
    const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : (a.uploadedAt ? a.uploadedAt : 0);
    const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : (b.uploadedAt ? b.uploadedAt : 0);
    if (orderA !== orderB) return orderA - orderB;
    const timeA = a.uploadedAt ? a.uploadedAt : 0;
    const timeB = b.uploadedAt ? b.uploadedAt : 0;
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id ? a.id : '').localeCompare(String(b.id ? b.id : ''));
  });
}

async function migrateLegacyDocsIfNeeded(db) {
  if (!db.objectStoreNames.contains(LEGACY_DOCS_STORE)) return;
  try {
    const legacyRecords = await new Promise((resolve) => {
      const tx = db.transaction(LEGACY_DOCS_STORE, 'readonly');
      const req = tx.objectStore(LEGACY_DOCS_STORE).getAll();
      req.onsuccess = () => resolve(req.result ? req.result : []);
      req.onerror = () => resolve([]);
    });
    if (legacyRecords.length === 0) return;

    for (const rec of legacyRecords) {
      let blob = rec.blob ? rec.blob : null;
      if (!blob && rec.dataUrl) {
        blob = dataUrlToBlobFast(rec.dataUrl, inferMimeTypeFromFileName(rec.fileName, rec.mimeType));
      }
      const meta = stripHeavyFieldsFromMeta(rec);
      meta.hasLocalFile = Boolean(blob || rec.hasLocalFile);
      await putDocRecordInDB(meta, blob);
    }
    const clearTx = db.transaction(LEGACY_DOCS_STORE, 'readwrite');
    clearTx.objectStore(LEGACY_DOCS_STORE).clear();
  } catch (e) {
    console.warn('Migration alter Dokumente Hinweis:', e);
  }
}

async function refreshDocsCache() {
  try {
    const db = await openDocsDB();
    await migrateLegacyDocsIfNeeded(db);
    const metaList = await new Promise((resolve) => {
      const tx = db.transaction(DOCS_META_STORE, 'readonly');
      const req = tx.objectStore(DOCS_META_STORE).getAll();
      req.onsuccess = () => resolve(req.result ? req.result : []);
      req.onerror = () => resolve([]);
    });
    const deletedDocsMap = (appState && appState.deletedDocIds) ? appState.deletedDocIds : {};
    const validMeta = metaList
      .filter(m => !deletedDocsMap[m.id])
      .map(stripHeavyFieldsFromMeta);
    cachedDocsList = sortDocsByOrder(validMeta);
  } catch (e) {
    console.error('Fehler beim Laden des Dokumenten-Caches:', e);
    cachedDocsList = [];
  }
}

async function putDocRecordInDB(docRecord, explicitBlob = null) {
  const db = await openDocsDB();
  let rawBlob = explicitBlob ? explicitBlob : (docRecord.blob ? docRecord.blob : null);
  if (!rawBlob && docRecord.dataUrl) {
    rawBlob = dataUrlToBlobFast(docRecord.dataUrl, inferMimeTypeFromFileName(docRecord.fileName, docRecord.mimeType));
  }
  let blobToSave = null;
  if (rawBlob) {
    blobToSave = await normalizeToMemoryBlob(rawBlob, docRecord.fileName ? docRecord.fileName : docRecord.title, docRecord.mimeType);
  }

  const cleanMeta = stripHeavyFieldsFromMeta(docRecord);
  if (blobToSave && blobToSave.size > 0) {
    cleanMeta.hasLocalFile = true;
    cleanMeta.sizeBytes = blobToSave.size ? blobToSave.size : (cleanMeta.sizeBytes ? cleanMeta.sizeBytes : 0);
  }

  if (appState && appState.deletedDocIds && appState.deletedDocIds[cleanMeta.id]) {
    delete appState.deletedDocIds[cleanMeta.id];
    saveState();
  }

  await new Promise((resolve, reject) => {
    const stores = (blobToSave && blobToSave.size > 0)
      ? [DOCS_META_STORE, DOCS_BLOB_STORE]
      : [DOCS_META_STORE];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(DOCS_META_STORE).put(cleanMeta);
    if (blobToSave && blobToSave.size > 0) {
      tx.objectStore(DOCS_BLOB_STORE).put({ id: cleanMeta.id, blob: blobToSave });
    }
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });

  const idx = cachedDocsList.findIndex(d => d.id === cleanMeta.id);
  if (idx !== -1) {
    cachedDocsList[idx] = cleanMeta;
  } else {
    cachedDocsList.push(cleanMeta);
  }
  sortDocsByOrder(cachedDocsList);
  return cleanMeta;
}

async function getDocBlobFromDB(docId) {
  try {
    const db = await openDocsDB();
    const docMeta = cachedDocsList.find(d => d.id === docId);
    const expectedMime = inferMimeTypeFromFileName(
      docMeta ? (docMeta.fileName ? docMeta.fileName : docMeta.title) : '',
      docMeta ? docMeta.mimeType : ''
    );

    const storedBlob = await new Promise((resolve) => {
      if (!db.objectStoreNames.contains(DOCS_BLOB_STORE)) return resolve(null);
      const tx = db.transaction(DOCS_BLOB_STORE, 'readonly');
      const req = tx.objectStore(DOCS_BLOB_STORE).get(docId);
      req.onsuccess = () => {
        const res = req.result;
        if (!res) return resolve(null);
        if (res.blob instanceof Blob) return resolve(res.blob);
        if (res instanceof Blob) return resolve(res);
        if (res.dataUrl) return resolve(dataUrlToBlobFast(res.dataUrl, expectedMime));
        resolve(null);
      };
      req.onerror = () => resolve(null);
    });

    if (storedBlob && storedBlob.size > 0) {
      return storedBlob.type === expectedMime ? storedBlob : new Blob([storedBlob], { type: expectedMime });
    }

    const fallbackBlob = await new Promise((resolve) => {
      const storeNames = [DOCS_META_STORE];
      if (db.objectStoreNames.contains(LEGACY_DOCS_STORE)) storeNames.push(LEGACY_DOCS_STORE);
      const tx = db.transaction(storeNames, 'readonly');
      const req = tx.objectStore(DOCS_META_STORE).get(docId);
      req.onsuccess = () => {
        const r = req.result;
        if (r && r.blob instanceof Blob && r.blob.size > 0) return resolve(r.blob);
        if (r && r.dataUrl) return resolve(dataUrlToBlobFast(r.dataUrl, expectedMime));
        if (db.objectStoreNames.contains(LEGACY_DOCS_STORE)) {
          const legReq = tx.objectStore(LEGACY_DOCS_STORE).get(docId);
          legReq.onsuccess = () => {
            const lr = legReq.result;
            if (lr && lr.blob instanceof Blob && lr.blob.size > 0) return resolve(lr.blob);
            if (lr && lr.dataUrl) return resolve(dataUrlToBlobFast(lr.dataUrl, expectedMime));
            resolve(null);
          };
          legReq.onerror = () => resolve(null);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });

    if (fallbackBlob && fallbackBlob.size > 0) {
      return fallbackBlob.type === expectedMime ? fallbackBlob : new Blob([fallbackBlob], { type: expectedMime });
    }
    return null;
  } catch (e) {
    console.warn('Blob-Abruf Hinweis:', e);
    return null;
  }
}

async function deleteDocRecordFromDB(docId, recordTombstone = true) {
  if (recordTombstone && appState) {
    ensureStateCollections(appState);
    appState.deletedDocIds[docId] = Date.now();
    saveState();
  }
  const db = await openDocsDB();
  await new Promise((resolve) => {
    const tx = db.transaction([DOCS_META_STORE, DOCS_BLOB_STORE], 'readwrite');
    tx.objectStore(DOCS_META_STORE).delete(docId);
    tx.objectStore(DOCS_BLOB_STORE).delete(docId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  cachedDocsList = cachedDocsList.filter(d => d.id !== docId);
}

/* =========================================================
   5. DATUM-HELFER & STATISTIK-BERECHNUNG
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
  const week = (appState && appState.weeks) ? appState.weeks[weekIdx] : null;
  if (!week) return new Date().toISOString().slice(0, 10);
  const parsed = parseWeekDates(week.weekLabel);
  if (!parsed) return new Date().toISOString().slice(0, 10);
  const y = parsed.weekMon.getFullYear();
  const m = String(parsed.weekMon.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.weekMon.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekShortName(weekIdx) {
  const week = (appState && appState.weeks) ? appState.weeks[weekIdx] : null;
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
  if (!dateObj || isNaN(dateObj.getTime()) || !appState || !Array.isArray(appState.weeks)) return -1;
  const t = dateObj.getTime();
  for (let i = 0; i < appState.weeks.length; i++) {
    const parsed = parseWeekDates(appState.weeks[i].weekLabel);
    if (parsed && t >= parsed.weekMon.getTime() && t <= parsed.weekSun.getTime()) {
      return i;
    }
  }
  return -1;
}

function calculateStats() {
  const moduleStats = {};
  let overallTotal = 0;
  let overallCompleted = 0;
  let overallInProgress = 0;
  if (!appState || !Array.isArray(appState.modules)) {
    return { moduleStats, overallTotal: 0, overallCompleted: 0, overallInProgress: 0, overallPct: 0 };
  }
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
      const items = (week.cells && week.cells[mod.shortName]) ? week.cells[mod.shortName] : [];
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