/* =========================================================
   UNTERPROGRAMM 2: STATE-VERWALTUNG, RAM-SCHONENDE INDEXEDDB
   MIT SORTIERREIHENFOLGE, DATUM-HELFER & STATISTIKEN (state-utils.js)
   ========================================================= */
const STORAGE_KEY = 'semesterplan_app_state_v3';
const THEME_KEY = 'semesterplan_theme';
const AUTO_BACKUP_DB_KEY = 'semesterplan_auto_offline_backup_v1';

const DOCS_DB_NAME = 'SemesterplanDocsDB';
const DOCS_DB_VERSION = 2;
const DOCS_META_STORE = 'docs_meta';
const DOCS_BLOB_STORE = 'docs_blobs';
const LEGACY_DOCS_STORE = 'module_docs';

let appState = null;
let activeModuleFilter = null;
let currentTab = 'table';
let cachedDocsList = []; // Hält NUR schlanke Metadaten im RAM (keine Base64-Strings!)
let docsDbPromise = null;

/* =========================================================
   1. STATE LADEN, SPEICHERN & STILLES HINTERGRUND-BACKUP
   ========================================================= */
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
    console.warn('Konnte gespeicherten Status nicht laden, prüfe Hintergrund-Backup:', e);
  }

  const restored = restoreSilentBackgroundBackupIfNeeded();
  if (restored) {
    appState = restored;
    return;
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
    if (!appState) return;
    appState.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    saveSilentBackgroundBackup(appState);
  } catch (e) {
    console.error('Fehler beim Speichern im localStorage:', e);
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

/* =========================================================
   2. SPEICHERSCHONENDE INDEXED-DB (METADATEN GETRENNT VON BLOBS)
      INKL. SORTIER-UNTERSTÜTZUNG (sortOrder)
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

function dataUrlToBlobFast(dataUrl, fallbackMime = 'application/pdf') {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  try {
    const parts = dataUrl.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : fallbackMime;
    const bstr = atob(parts[1] || '');
    const u8arr = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) {
      u8arr[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    return null;
  }
}

function stripHeavyFieldsFromMeta(record) {
  const meta = { ...record };
  delete meta.dataUrl;
  delete meta.blob;
  if (typeof meta.sortOrder !== 'number') {
    meta.sortOrder = meta.uploadedAt || Date.now();
  }
  return meta;
}

function sortDocsByOrder(list) {
  return list.sort((a, b) => {
    const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : (a.uploadedAt || 0);
    const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : (b.uploadedAt || 0);
    if (orderA !== orderB) return orderA - orderB;
    return (a.uploadedAt || 0) - (b.uploadedAt || 0);
  });
}

async function migrateLegacyDocsIfNeeded(db) {
  if (!db.objectStoreNames.contains(LEGACY_DOCS_STORE)) return;
  try {
    const legacyRecords = await new Promise((resolve) => {
      const tx = db.transaction(LEGACY_DOCS_STORE, 'readonly');
      const req = tx.objectStore(LEGACY_DOCS_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (legacyRecords.length === 0) return;

    for (const rec of legacyRecords) {
      let blob = rec.blob || null;
      if (!blob && rec.dataUrl) {
        blob = dataUrlToBlobFast(rec.dataUrl, rec.mimeType);
      }
      const meta = stripHeavyFieldsFromMeta(rec);
      meta.hasLocalFile = !!(blob || rec.hasLocalFile);
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
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    cachedDocsList = sortDocsByOrder(metaList.map(stripHeavyFieldsFromMeta));
  } catch (e) {
    console.error('Fehler beim Laden des Dokumenten-Caches:', e);
    cachedDocsList = [];
  }
}

async function putDocRecordInDB(docRecord, explicitBlob = null) {
  const db = await openDocsDB();
  let blobToSave = explicitBlob || docRecord.blob || null;
  if (!blobToSave && docRecord.dataUrl) {
    blobToSave = dataUrlToBlobFast(docRecord.dataUrl, docRecord.mimeType);
  }
  const cleanMeta = stripHeavyFieldsFromMeta(docRecord);
  if (blobToSave) {
    cleanMeta.hasLocalFile = true;
    cleanMeta.sizeBytes = blobToSave.size || cleanMeta.sizeBytes || 0;
  }

  await new Promise((resolve, reject) => {
    const stores = blobToSave ? [DOCS_META_STORE, DOCS_BLOB_STORE] : [DOCS_META_STORE];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(DOCS_META_STORE).put(cleanMeta);
    if (blobToSave) {
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
    return await new Promise((resolve) => {
      const tx = db.transaction(DOCS_BLOB_STORE, 'readonly');
      const req = tx.objectStore(DOCS_BLOB_STORE).get(docId);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function deleteDocRecordFromDB(docId) {
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
   3. DATUM- & FORMATIERUNGS-HELFER
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
  const week = appState?.weeks?.[weekIdx];
  if (!week) return new Date().toISOString().slice(0, 10);
  const parsed = parseWeekDates(week.weekLabel);
  if (!parsed) return new Date().toISOString().slice(0, 10);
  const y = parsed.weekMon.getFullYear();
  const m = String(parsed.weekMon.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.weekMon.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekShortName(weekIdx) {
  const week = appState?.weeks?.[weekIdx];
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
  if (!dateObj || isNaN(dateObj.getTime()) || !appState?.weeks) return -1;
  const t = dateObj.getTime();
  for (let i = 0; i < appState.weeks.length; i++) {
    const parsed = parseWeekDates(appState.weeks[i].weekLabel);
    if (parsed && t >= parsed.weekMon.getTime() && t <= parsed.weekSun.getTime()) {
      return i;
    }
  }
  return -1;
}

function formatFileSize(bytes) {
  const b = Number(bytes) || 0;
  if (b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
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

/* =========================================================
   4. STATISTIK-BERECHNUNG
   ========================================================= */
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