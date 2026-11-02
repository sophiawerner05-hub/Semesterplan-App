/* =========================================================
   UNTERPROGRAMM: GOOGLE DRIVE DOKUMENTEN- & SNAPSHOT-SYNC (drive-sync.js)
   - Eigene "☁️ Drive Sync"-Taste (triggerManualDriveSync)
   - Lädt direkt NUR neue oder geänderte Dateien hoch
   - Überschreibt bei 2 Synchronisationsständen automatisch den ältesten
   - Jederzeit über den Abbrechen-Button (AbortController) abbrechbar
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
  if (data.files && data.files.length > 0) {
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

function dataUrlToBlob(dataUrl, fallbackMime = 'application/octet-stream') {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : fallbackMime;
  const bstr = atob(parts[1] || '');
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/* =========================================================
   EINZELNE NEUE DATEI HOCHLADEN ODER ÄLTESTES DUPLIKAT ÜBERSCHREIBEN
   ========================================================= */
async function uploadLocalDocToGoogleDrive(docRecord, existingDriveFiles = null) {
  if (!googleAccessToken || !docRecord.dataUrl) return false;
  if (isCurrentActionCancelled()) return false;

  const folderId = await ensureDriveSyncFolder();

  // Prüfen, ob in Google Drive bereits Kopien derselben Datei existieren
  let matchingDriveCopies = [];
  if (Array.isArray(existingDriveFiles)) {
    matchingDriveCopies = existingDriveFiles.filter(df =>
      df.id === docRecord.driveFileId ||
      (df.appProperties && df.appProperties.spDocId === docRecord.id) ||
      ((df.name || '').toLowerCase() === (docRecord.fileName || '').toLowerCase() &&
       (df.appProperties?.spModule || '') === docRecord.module)
    );
  }

  const appProps = {
    spDocId: docRecord.id,
    spModule: docRecord.module || '',
    spCategory: docRecord.category || 'Vorlesung',
    spWeekLabel: docRecord.weekLabel || '',
    spTaskText: docRecord.taskText || '',
    spTitle: docRecord.title || '',
    spManualOverride: docRecord.manualOverride ? 'true' : 'false'
  };

  // Falls 2 (oder mehr) Synchronisations-Kopien derselben Datei existieren:
  // Sortiere nach Änderungsdatum aufsteigend (älteste zuerst) und überschreibe die älteste!
  if (matchingDriveCopies.length >= 2) {
    matchingDriveCopies.sort((a, b) => new Date(a.modifiedTime || 0) - new Date(b.modifiedTime || 0));
    const oldestCopy = matchingDriveCopies[0];
    docRecord.driveFileId = oldestCopy.id;
    // Entferne überzählige Kopien, sodass jedes Dokument nur einmal existiert
    for (let i = 1; i < matchingDriveCopies.length; i++) {
      await deleteDocFromGoogleDrive(matchingDriveCopies[i].id);
    }
  } else if (matchingDriveCopies.length === 1 && !docRecord.driveFileId) {
    // Datei existiert bereits auf Drive -> Nicht erneut hochladen, nur ID verknüpfen!
    docRecord.driveFileId = matchingDriveCopies[0].id;
    docRecord.webViewLink = matchingDriveCopies[0].webViewLink || '';
    if (docRecord.needsDriveUpdate) {
      await syncSingleDocMetadataToDrive(docRecord);
      docRecord.needsDriveUpdate = false;
    }
    return false;
  }

  // Wenn die Datei bereits eine driveFileId hat, nur Metadaten aktualisieren statt Datei neu hochzuladen
  if (docRecord.driveFileId) {
    if (docRecord.needsDriveUpdate) {
      await syncSingleDocMetadataToDrive(docRecord);
      docRecord.needsDriveUpdate = false;
    }
    return false;
  }

  // Komplett neue Datei hochladen
  const metadata = {
    name: docRecord.fileName || docRecord.title,
    parents: [folderId],
    appProperties: appProps
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', dataUrlToBlob(docRecord.dataUrl, docRecord.mimeType));

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${googleAccessToken}` },
    body: form,
    signal: getActiveAbortSignal()
  });
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
        name: docRecord.fileName || docRecord.title,
        appProperties: {
          spDocId: docRecord.id,
          spModule: docRecord.module || '',
          spCategory: docRecord.category || 'Vorlesung',
          spWeekLabel: docRecord.weekLabel || '',
          spTaskText: docRecord.taskText || '',
          spTitle: docRecord.title || '',
          spManualOverride: docRecord.manualOverride ? 'true' : 'false'
        }
      })
    });
    docRecord.needsDriveUpdate = false;
  } catch (e) {
    console.warn('Drive-Metadaten-Update fehlgeschlagen:', e);
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

async function ensureDriveDocContentLoaded(docRecord) {
  if (docRecord.dataUrl || !docRecord.driveFileId || !googleAccessToken) return;
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${docRecord.driveFileId}?alt=media`, {
    headers: { 'Authorization': `Bearer ${googleAccessToken}` },
    signal: getActiveAbortSignal()
  });
  if (!response.ok) return;
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  docRecord.dataUrl = dataUrl;
  await putDocRecordInDB(docRecord);
}

/* =========================================================
   ROTATION VON 2 SYNC-STÄNDEN IN GOOGLE DRIVE:
   ÜBERSCHREIBT AUTOMATISCH DEN ÄLTESTEN VON 2 SYNCS
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

  // Wenn bereits 2 Synchronisations-Snapshots existieren: Überschreibe gezielt den ÄLTESTEN (snapshots[0])!
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

    // Falls mehr als 2 alte Snapshots lagen, restliche überzählige aufräumen
    for (let i = 2; i < snapshots.length; i++) {
      await deleteDocFromGoogleDrive(snapshots[i].id);
    }
  } else {
    // Weniger als 2 Snapshots vorhanden -> Neuen anlegen
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
   HAUPTFUNKTION: DRIVE-SYNCHRONISATION (INKREMENTELL)
   ========================================================= */
async function syncDocumentsWithGoogleDrive(silent = true) {
  if (!googleAccessToken || isDriveSyncInProgress) return;
  isDriveSyncInProgress = true;
  if (!silent) {
    startCancelableOperation('Synchronisiere neue Dateien mit Google Drive...');
  }

  try {
    const folderId = await ensureDriveSyncFolder();
    if (isCurrentActionCancelled()) return;

    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,mimeType,size,webViewLink,appProperties,createdTime,modifiedTime)');
    const driveData = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=250`);
    const allDriveFiles = driveData.files || [];
    const docDriveFiles = allDriveFiles.filter(f => !(f.name || '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX));

    let uploadedNewCount = 0;
    let updatedMetaCount = 0;
    let pulledCount = 0;

    // 1. NUR NEUE oder GEÄNDERTE lokale Dateien zu Google Drive übertragen
    for (const localDoc of cachedDocsList) {
      if (isCurrentActionCancelled()) break;
      if (!localDoc.driveFileId && localDoc.dataUrl) {
        const wasUploaded = await uploadLocalDocToGoogleDrive(localDoc, docDriveFiles);
        await putDocRecordInDB(localDoc);
        if (wasUploaded) uploadedNewCount++;
      } else if (localDoc.driveFileId && localDoc.needsDriveUpdate) {
        await syncSingleDocMetadataToDrive(localDoc);
        await putDocRecordInDB(localDoc);
        updatedMetaCount++;
      }
    }

    // 2. Vom anderen Gerät (z. B. Laptop -> Handy) neu hinzugekommene oder umgeordnete Dateien abrufen
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
        // Falls auf dem anderen Gerät die Zuordnung manuell geändert wurde, übernehmen
        if (props.spManualOverride === 'true' && !existingLocal.needsDriveUpdate) {
          const changed =
            existingLocal.module !== (props.spModule || existingLocal.module) ||
            existingLocal.category !== (props.spCategory || existingLocal.category) ||
            (existingLocal.weekLabel || '') !== (props.spWeekLabel || '') ||
            (existingLocal.taskText || '') !== (props.spTaskText || '');
          if (changed) {
            existingLocal.module = props.spModule || existingLocal.module;
            existingLocal.category = props.spCategory || existingLocal.category;
            existingLocal.weekLabel = props.spWeekLabel || '';
            existingLocal.taskText = props.spTaskText || '';
            existingLocal.title = props.spTitle || existingLocal.title;
            existingLocal.manualOverride = true;
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
        title: props.spTitle || (guess.taskText ? formatDocTitleForTask(guess.taskText, guess.category, df.name) : df.name),
        fileName: df.name,
        mimeType: df.mimeType || 'application/pdf',
        sizeBytes: Number(df.size) || 0,
        dataUrl: '',
        manualOverride: props.spManualOverride === 'true',
        uploadedAt: df.createdTime ? new Date(df.createdTime).getTime() : Date.now(),
        updatedAt: df.modifiedTime ? new Date(df.modifiedTime).getTime() : Date.now()
      };
      await putDocRecordInDB(newDoc);
      cachedDocsList.push(newDoc);
      pulledCount++;
    }

    // 3. Synchronisations-Snapshot sichern (überschreibt automatisch den ältesten von 2 Ständen)
    if (!isCurrentActionCancelled()) {
      await saveSyncSnapshotOverwriteOldest(folderId, allDriveFiles);
    }

    if (uploadedNewCount > 0 || pulledCount > 0 || updatedMetaCount > 0) {
      await refreshDocsCache();
      renderAll();
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
    const files = (data.files || []).filter(f => !(f.name || '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX));

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
      dataUrl: '',
      manualOverride: true,
      uploadedAt: Date.now(),
      updatedAt: Date.now()
    };

    try {
      await ensureDriveDocContentLoaded(newDoc);
    } catch (e) {}

    await putDocRecordInDB(newDoc);
    await refreshDocsCache();
    renderAll();
    await loadGoogleDriveFilesList();
    showToast(`✅ „${newDoc.title}“ zugeordnet (${newDoc.module})!`);
  } finally {
    hideLoading();
  }
}