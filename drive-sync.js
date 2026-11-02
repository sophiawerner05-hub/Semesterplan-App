/* =========================================================
   UNTERPROGRAMM 7: OPTIMIERTER GOOGLE DRIVE DOKUMENTEN- &
   SNAPSHOT-SYNC (drive-sync.js)
   - Nutzt native Binär-Blobs aus IndexedDB statt RAM-Base64
   - Fortschrittsanzeige pro Datei & saubere Fehlerbehandlung
   - Überschreibt bei 2 Synchronisationsständen automatisch den ältesten
   ========================================================= */
const DRIVE_SYNC_FOLDER_NAME = 'Semesterplan_App_Sync';
const DRIVE_STATE_SNAPSHOT_PREFIX = 'semesterplan_sync_snapshot';

let cachedDriveFolderId = null;
let isDriveSyncInProgress = false;

async function triggerManualDriveSync() {
  if (typeof isGoogleConnected !== 'function' || !isGoogleConnected()) {
    showToast('🔗 Verbinde mit Google Account für Drive-Synchronisation...');
    if (typeof connectGoogleLive === 'function') connectGoogleLive();
    return;
  }
  await syncDocumentsWithGoogleDrive(false);
}

async function ensureDriveSyncFolder() {
  if (cachedDriveFolderId) return cachedDriveFolderId;
  const q = encodeURIComponent(`name = '${DRIVE_SYNC_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const data = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc`);
  if (data && data.files && data.files.length > 0) {
    cachedDriveFolderId = data.files[0].id;
    return cachedDriveFolderId;
  }
  const created = await googleApiFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    body: JSON.stringify({
      name: DRIVE_SYNC_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  cachedDriveFolderId = created.id;
  return cachedDriveFolderId;
}

function buildDriveAppProperties(docRecord) {
  const safeSlice = (val, max = 110) => String(val || '').slice(0, max);
  return {
    spDocId: safeSlice(docRecord.id, 100),
    spModule: safeSlice(docRecord.module, 50),
    spCategory: safeSlice(docRecord.category || 'Vorlesung', 50),
    spWeekLabel: safeSlice(docRecord.weekLabel, 80),
    spTaskText: safeSlice(docRecord.taskText, 100),
    spTitle: safeSlice(docRecord.title, 100),
    spManualOverride: docRecord.manualOverride ? 'true' : 'false'
  };
}

/* =========================================================
   SPEICHERSCHONENDER BLOB-UPLOAD ZU GOOGLE DRIVE
   ========================================================= */
async function uploadLocalDocToGoogleDrive(docRecord, existingDriveFiles = null) {
  if (!googleAccessToken || isCurrentActionCancelled()) return false;

  const folderId = await ensureDriveSyncFolder();

  let matchingDriveCopies = [];
  if (Array.isArray(existingDriveFiles)) {
    matchingDriveCopies = existingDriveFiles.filter(df =>
      df.id === docRecord.driveFileId ||
      (df.appProperties && df.appProperties.spDocId === docRecord.id) ||
      ((df.name || '').toLowerCase() === (docRecord.fileName || '').toLowerCase() &&
       (df.appProperties?.spModule || '') === docRecord.module)
    );
  }

  // Bei 2+ Kopien in Drive: Älteste behalten/aktualisieren, Überzählige löschen
  if (matchingDriveCopies.length >= 2) {
    matchingDriveCopies.sort((a, b) => new Date(a.modifiedTime || 0) - new Date(b.modifiedTime || 0));
    docRecord.driveFileId = matchingDriveCopies[0].id;
    docRecord.webViewLink = matchingDriveCopies[0].webViewLink || docRecord.webViewLink || '';
    for (let i = 1; i < matchingDriveCopies.length; i++) {
      await deleteDocFromGoogleDrive(matchingDriveCopies[i].id);
    }
  } else if (matchingDriveCopies.length === 1 && !docRecord.driveFileId) {
    docRecord.driveFileId = matchingDriveCopies[0].id;
    docRecord.webViewLink = matchingDriveCopies[0].webViewLink || '';
    if (docRecord.needsDriveUpdate) {
      await syncSingleDocMetadataToDrive(docRecord);
    }
    return false;
  }

  if (docRecord.driveFileId) {
    if (docRecord.needsDriveUpdate) {
      await syncSingleDocMetadataToDrive(docRecord);
    }
    return false;
  }

  // Lade Binär-Blob nur für diese eine Datei direkt aus der IndexedDB
  const fileBlob = await getDocBlobFromDB(docRecord.id);
  if (!fileBlob) return false;

  const metadata = {
    name: docRecord.fileName || docRecord.title || 'Dokument.pdf',
    parents: [folderId],
    appProperties: buildDriveAppProperties(docRecord)
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', fileBlob, metadata.name);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${googleAccessToken}` },
    body: form,
    signal: getActiveAbortSignal()
  });

  if (res.status === 401) {
    throw new Error('Google-Sitzung abgelaufen (401). Bitte neu verbinden.');
  }

  if (res.ok) {
    const uploaded = await res.json();
    docRecord.driveFileId = uploaded.id;
    docRecord.webViewLink = uploaded.webViewLink || '';
    docRecord.needsDriveUpdate = false;
    return true;
  }
  return false;
}

async function syncSingleDocMetadataToDrive(docRecord) {
  if (!googleAccessToken || !docRecord.driveFileId) return;
  try {
    await googleApiFetch(`https://www.googleapis.com/drive/v3/files/${docRecord.driveFileId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: docRecord.fileName || docRecord.title || 'Dokument.pdf',
        appProperties: buildDriveAppProperties(docRecord)
      })
    });
    docRecord.needsDriveUpdate = false;
  } catch (e) {
    console.warn('Drive-Metadaten-Update Hinweis:', e);
  }
}

async function deleteDocFromGoogleDrive(driveFileId) {
  if (!googleAccessToken || !driveFileId) return;
  try {
    await googleApiFetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
      method: 'DELETE'
    });
  } catch (e) {}
}

/* Lädt Datei-Inhalt bei Bedarf von Drive direkt als Blob in die IndexedDB (ohne Base64 im RAM!) */
async function ensureDriveDocContentLoaded(docRecord) {
  const existingBlob = await getDocBlobFromDB(docRecord.id);
  if (existingBlob) return existingBlob;
  if (!docRecord.driveFileId || !googleAccessToken) return null;

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${docRecord.driveFileId}?alt=media`, {
    headers: { 'Authorization': `Bearer ${googleAccessToken}` },
    signal: getActiveAbortSignal()
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  docRecord.hasLocalFile = true;
  await putDocRecordInDB(docRecord, blob);
  return blob;
}

/* =========================================================
   ROTATION VON 2 SYNC-STÄNDEN IN GOOGLE DRIVE
   ========================================================= */
async function saveSyncSnapshotOverwriteOldest(folderId, existingDriveFiles) {
  if (!googleAccessToken || !appState || isCurrentActionCancelled()) return;
  const snapshots = (existingDriveFiles || [])
    .filter(f => (f.name || '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX))
    .sort((a, b) => new Date(a.modifiedTime || 0) - new Date(b.modifiedTime || 0));

  const snapshotPayload = {
    syncedAt: Date.now(),
    modules: appState.modules,
    weeks: appState.weeks,
    docAssignments: cachedDocsList.map(d => ({
      id: d.id,
      driveFileId: d.driveFileId || '',
      fileName: d.fileName || '',
      title: d.title || '',
      module: d.module,
      category: d.category,
      weekLabel: d.weekLabel || '',
      taskText: d.taskText || '',
      manualOverride: !!d.manualOverride,
      updatedAt: d.updatedAt || d.uploadedAt || 0
    }))
  };

  const blob = new Blob([JSON.stringify(snapshotPayload)], { type: 'application/json' });

  if (snapshots.length >= 2) {
    const oldestSnapshot = snapshots[0];
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({
      name: `${DRIVE_STATE_SNAPSHOT_PREFIX}_${new Date().toISOString().slice(0, 10)}.json`
    })], { type: 'application/json' }));
    form.append('file', blob);
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${oldestSnapshot.id}?uploadType=multipart`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${googleAccessToken}` },
      body: form,
      signal: getActiveAbortSignal()
    });
    for (let i = 2; i < snapshots.length; i++) {
      await deleteDocFromGoogleDrive(snapshots[i].id);
    }
  } else {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({
      name: `${DRIVE_STATE_SNAPSHOT_PREFIX}_${snapshots.length + 1}.json`,
      parents: [folderId]
    })], { type: 'application/json' }));
    form.append('file', blob);
    await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${googleAccessToken}` },
      body: form,
      signal: getActiveAbortSignal()
    });
  }
}

/* =========================================================
   HAUPTFUNKTION: INKREMENTELLE DRIVE-SYNCHRONISATION
   ========================================================= */
async function syncDocumentsWithGoogleDrive(silent = true) {
  if (!googleAccessToken || isDriveSyncInProgress) return;
  isDriveSyncInProgress = true;
  if (!silent) {
    startCancelableOperation('Synchronisiere Dokumente mit Google Drive...');
  }
  try {
    const folderId = await ensureDriveSyncFolder();
    if (isCurrentActionCancelled()) return;

    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,mimeType,size,webViewLink,appProperties,createdTime,modifiedTime)');
    const driveData = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=250`);
    const allDriveFiles = (driveData && driveData.files) || [];
    const docDriveFiles = allDriveFiles.filter(f => !(f.name || '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX));

    let uploadedNewCount = 0;
    let updatedMetaCount = 0;
    let pulledCount = 0;

    const docsToUpload = cachedDocsList.filter(d => !d.driveFileId && d.hasLocalFile);
    let currentUploadIdx = 0;

    // 1. Neue oder geänderte lokale Dateien hochladen / aktualisieren
    for (const localDoc of cachedDocsList) {
      if (isCurrentActionCancelled()) break;
      try {
        if (!localDoc.driveFileId && localDoc.hasLocalFile) {
          currentUploadIdx++;
          if (!silent && typeof updateLoadingText === 'function') {
            updateLoadingText(`Lade Datei ${currentUploadIdx}/${docsToUpload.length} hoch (${localDoc.fileName})...`);
          }
          const wasUploaded = await uploadLocalDocToGoogleDrive(localDoc, docDriveFiles);
          await putDocRecordInDB(localDoc);
          if (wasUploaded) uploadedNewCount++;
        } else if (localDoc.driveFileId && localDoc.needsDriveUpdate) {
          await syncSingleDocMetadataToDrive(localDoc);
          await putDocRecordInDB(localDoc);
          updatedMetaCount++;
        }
      } catch (singleErr) {
        console.warn('Einzeldatei-Sync übersprungen:', singleErr);
      }
    }

    // 2. Auf anderen Geräten hinzugefügte oder umgeordnete Drive-Dateien abgleichen
    for (const df of docDriveFiles) {
      if (isCurrentActionCancelled()) break;
      const props = df.appProperties || {};
      const existingLocal = cachedDocsList.find(d =>
        d.driveFileId === df.id ||
        (props.spDocId && d.id === props.spDocId) ||
        (d.module === props.spModule && (d.fileName || '').toLowerCase() === (df.name || '').toLowerCase())
      );

      if (existingLocal) {
        if (!existingLocal.driveFileId) {
          existingLocal.driveFileId = df.id;
          existingLocal.webViewLink = df.webViewLink || '';
          await putDocRecordInDB(existingLocal);
        }
        if (props.spManualOverride === 'true' && !existingLocal.needsDriveUpdate) {
          const remoteTime = df.modifiedTime ? new Date(df.modifiedTime).getTime() : 0;
          const localTime = existingLocal.updatedAt || existingLocal.uploadedAt || 0;
          if (remoteTime > localTime + 2000) {
            existingLocal.module = props.spModule || existingLocal.module;
            existingLocal.category = props.spCategory || existingLocal.category;
            existingLocal.weekLabel = props.spWeekLabel !== undefined ? props.spWeekLabel : existingLocal.weekLabel;
            existingLocal.taskText = props.spTaskText !== undefined ? props.spTaskText : existingLocal.taskText;
            existingLocal.title = props.spTitle || existingLocal.title;
            existingLocal.manualOverride = true;
            existingLocal.updatedAt = remoteTime;
            await putDocRecordInDB(existingLocal);
            updatedMetaCount++;
          }
        }
        continue;
      }

      const guess = analyzeFileForSmartSorting(df.name, props.spModule, props.spCategory, props.spWeekLabel, props.spTaskText);
      const newDoc = {
        id: props.spDocId || `doc_drive_${df.id}`,
        driveFileId: df.id,
        webViewLink: df.webViewLink || '',
        module: props.spModule || guess.module,
        category: props.spCategory || guess.category,
        weekLabel: props.spWeekLabel !== undefined ? props.spWeekLabel : guess.weekLabel,
        taskText: props.spTaskText !== undefined ? props.spTaskText : guess.taskText,
        title: props.spTitle || (guess.taskText ? formatDocTitleForTask(guess.taskText, guess.category, df.name) : df.name.replace(/\.[^/.]+$/, '')),
        fileName: df.name,
        mimeType: df.mimeType || 'application/pdf',
        sizeBytes: Number(df.size) || 0,
        hasLocalFile: false,
        manualOverride: props.spManualOverride === 'true',
        uploadedAt: df.createdTime ? new Date(df.createdTime).getTime() : Date.now(),
        updatedAt: df.modifiedTime ? new Date(df.modifiedTime).getTime() : Date.now()
      };
      await putDocRecordInDB(newDoc);
      pulledCount++;
    }

    if (!isCurrentActionCancelled()) {
      await saveSyncSnapshotOverwriteOldest(folderId, allDriveFiles);
    }

    if (uploadedNewCount > 0 || pulledCount > 0 || updatedMetaCount > 0) {
      await refreshDocsCache();
      if (typeof renderAll === 'function') renderAll();
    }

    if (!silent && !isCurrentActionCancelled()) {
      showToast(`☁️ Drive Sync fertig: ${uploadedNewCount} neu hochgeladen, ${pulledCount} geladen, ${updatedMetaCount} aktualisiert.`);
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn('Google-Drive-Synchronisation Hinweis:', e);
      if (!silent) showToast('⚠️ Drive-Sync Hinweis: ' + e.message);
    }
  } finally {
    isDriveSyncInProgress = false;
    if (!silent) hideLoading();
  }
}

/* =========================================================
   DIREKTER DOKUMENTEN-IMPORT AUS GOOGLE DRIVE (PICKER-MODAL)
   ========================================================= */
async function openGoogleDrivePickerModal() {
  if (typeof isGoogleConnected !== 'function' || !isGoogleConnected()) {
    showToast('🔗 Bitte verbinde zuerst kurz dein Google-Konto.');
    if (typeof connectGoogleLive === 'function') connectGoogleLive();
    return;
  }
  openModal('googleDriveModal');
  await loadGoogleDriveFilesList();
}

async function loadGoogleDriveFilesList() {
  const listContainer = document.getElementById('googleDriveFilesList');
  const queryText = (document.getElementById('driveSearchInput')?.value || '').trim();
  if (!listContainer) return;
  startCancelableOperation('Durchsuche dein Google Drive...');
  try {
    let q = `mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
    if (queryText) {
      const safeQ = queryText.replace(/'/g, "\\'");
      q += ` and name contains '${safeQ}'`;
    }
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,mimeType,size,webViewLink,modifiedTime)')}&pageSize=40&orderBy=modifiedTime desc`;
    const data = await googleApiFetch(url);
    const files = ((data && data.files) || []).filter(f => !(f.name || '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX));
    if (files.length === 0) {
      listContainer.innerHTML = `<p style="text-align:center; padding:20px; color:var(--text-muted);">Keine passenden Dateien in deinem Google Drive gefunden.</p>`;
      return;
    }
    listContainer.innerHTML = files.map(f => {
      const alreadyAdded = cachedDocsList.some(d => d.driveFileId === f.id);
      return `
        <div class="doc-compact-item" style="padding:10px 12px;">
          <div class="doc-item-info">
            <div class="doc-item-title">☁️ ${escapeHtml(f.name)}</div>
            <div class="doc-item-meta">
              <span>${escapeHtml(f.mimeType)}</span>
              ${f.size ? `<span>• ${formatFileSize(f.size)}</span>` : ''}
            </div>
          </div>
          <div class="doc-item-actions">
            ${alreadyAdded
              ? `<span class="doc-cat-badge doc-cat-solution">✅ Bereits verknüpft</span>`
              : `<button type="button" class="btn btn-primary btn-sm" onclick="importFileFromGoogleDrive('${escapeAttr(f.id)}', '${escapeAttr(f.name)}', '${escapeAttr(f.mimeType || '')}', ${Number(f.size) || 0}, '${escapeAttr(f.webViewLink || '')}')">📥 Übernehmen</button>`
            }
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    if (e.name !== 'AbortError') {
      listContainer.innerHTML = `<p style="color:var(--warning-text); padding:14px;">Fehler beim Laden aus Google Drive: ${escapeHtml(e.message)}</p>`;
    }
  } finally {
    hideLoading();
  }
}

async function importFileFromGoogleDrive(driveId, fileName, mimeType, sizeBytes, webViewLink) {
  if (cachedDocsList.some(d => d.driveFileId === driveId)) {
    showToast('ℹ️ Dieses Dokument ist bereits im Semesterplan hinterlegt.');
    return;
  }
  startCancelableOperation(`Importiere „${fileName}“ aus Google Drive...`);
  try {
    const fallbackMod = document.getElementById('docModuleSelect')?.value || '';
    const fallbackCat = document.getElementById('docCategorySelect')?.value || '';
    const fallbackWeek = document.getElementById('docWeekSelect')?.value || '';
    const guess = analyzeFileForSmartSorting(fileName, fallbackMod, fallbackCat, fallbackWeek);
    const newDoc = {
      id: `doc_drive_${driveId}`,
      driveFileId: driveId,
      webViewLink: webViewLink || '',
      module: guess.module,
      category: guess.category,
      weekLabel: guess.weekLabel || '',
      taskText: guess.taskText || '',
      title: guess.taskText ? formatDocTitleForTask(guess.taskText, guess.category, fileName) : fileName.replace(/\.[^/.]+$/, ''),
      fileName: fileName,
      mimeType: mimeType || 'application/pdf',
      sizeBytes: sizeBytes || 0,
      hasLocalFile: false,
      manualOverride: true,
      uploadedAt: Date.now(),
      updatedAt: Date.now()
    };
    try {
      await ensureDriveDocContentLoaded(newDoc);
    } catch (e) {}
    await putDocRecordInDB(newDoc);
    await refreshDocsCache();
    if (typeof renderAll === 'function') renderAll();
    await loadGoogleDriveFilesList();
    showToast(`✅ „${newDoc.title}“ zugeordnet (${newDoc.module})!`);
  } finally {
    hideLoading();
  }
}