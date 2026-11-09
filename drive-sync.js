/* =========================================================
   UNTERPROGRAMM 7: GOOGLE DRIVE DOKUMENTEN- & SNAPSHOT-SYNC
   INKL. UTF-8-BYTE-SCHUTZ, TASK-HASH & SNAPSHOT-MERGE (drive-sync.js)
   ========================================================= */
var DRIVE_SYNC_FOLDER_NAME = 'Semesterplan_App_Sync';
var DRIVE_STATE_SNAPSHOT_PREFIX = 'semesterplan_sync_snapshot';

var cachedDriveFolderId = null;
var isDriveSyncInProgress = false;
var autoDriveSyncTimer = null;
var pendingDriveResyncRequested = false;

function scheduleAutoDriveSync(delayMs = 1200) {
  if (typeof isGoogleConnected !== 'function' || !isGoogleConnected()) return;
  if (autoDriveSyncTimer) clearTimeout(autoDriveSyncTimer);
  autoDriveSyncTimer = setTimeout(() => {
    autoDriveSyncTimer = null; 
    if (isDriveSyncInProgress) {
      pendingDriveResyncRequested = true;
    } else {
      syncDocumentsWithGoogleDrive(true);
    }
  }, delayMs);
}

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

function utf8ByteSafePropValue(keyName, rawValue, maxTotalBytes = 120) {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(String(keyName ? keyName : '')).length;
  const maxValBytes = Math.max(10, maxTotalBytes - keyBytes);
  const str = String(rawValue ?? '');
  if (encoder.encode(str).length <= maxValBytes) return str;

  let out = '';
  let usedBytes = 0;
  for (const ch of str) {
    const chBytes = encoder.encode(ch).length;
    if (usedBytes + chBytes > maxValBytes) break;
    out += ch;
    usedBytes += chBytes;
  }
  return out;
}

function buildDriveAppProperties(docRecord) {
  const taskHash = docRecord.taskHash ? docRecord.taskHash : (docRecord.taskText
    ? computeTaskHash(docRecord.module, docRecord.weekLabel, docRecord.taskText)
    : '');
  return {
    spDocId:          utf8ByteSafePropValue('spDocId', docRecord.id),
    spModule:         utf8ByteSafePropValue('spModule', docRecord.module),
    spCategory:       utf8ByteSafePropValue('spCategory', docRecord.category ? docRecord.category : 'Vorlesung'),
    spWeekLabel:      utf8ByteSafePropValue('spWeekLabel', docRecord.weekLabel),
    spTaskText:       utf8ByteSafePropValue('spTaskText', docRecord.taskText),
    spTaskHash:       utf8ByteSafePropValue('spTaskHash', taskHash),
    spTitle:          utf8ByteSafePropValue('spTitle', docRecord.title),
    spSortOrder:      utf8ByteSafePropValue('spSortOrder', String(docRecord.sortOrder ? docRecord.sortOrder : (docRecord.uploadedAt ? docRecord.uploadedAt : 0))),
    spUpdatedAt:      utf8ByteSafePropValue('spUpdatedAt', String(docRecord.updatedAt ? docRecord.updatedAt : (docRecord.uploadedAt ? docRecord.uploadedAt : Date.now()))),
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
      ((df.name ? df.name : '').toLowerCase() === (docRecord.fileName ? docRecord.fileName : '').toLowerCase() &&
       (df.appProperties?.spModule ? df.appProperties.spModule : '') === docRecord.module)
    );
  }

  if (matchingDriveCopies.length >= 2) {
    matchingDriveCopies.sort((a, b) => new Date(a.modifiedTime ? a.modifiedTime : 0) - new Date(b.modifiedTime ? b.modifiedTime : 0));
    docRecord.driveFileId = matchingDriveCopies[0].id;
    docRecord.webViewLink = matchingDriveCopies[0].webViewLink ? matchingDriveCopies[0].webViewLink : (docRecord.webViewLink ? docRecord.webViewLink : '');
    for (let i = 1; i < matchingDriveCopies.length; i++) {
      await deleteDocFromGoogleDrive(matchingDriveCopies[i].id);
    }
  } else if (matchingDriveCopies.length === 1 && !docRecord.driveFileId) {
    docRecord.driveFileId = matchingDriveCopies[0].id;
    docRecord.webViewLink = matchingDriveCopies[0].webViewLink ? matchingDriveCopies[0].webViewLink : '';
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

  const fileBlob = await getDocBlobFromDB(docRecord.id);
  if (!fileBlob) return false;

  const metadata = {
    name: docRecord.fileName ? docRecord.fileName : (docRecord.title ? docRecord.title : 'Dokument.pdf'),
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
    docRecord.webViewLink = uploaded.webViewLink ? uploaded.webViewLink : '';
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
        name: docRecord.fileName ? docRecord.fileName : (docRecord.title ? docRecord.title : 'Dokument.pdf'),
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
   SNAPSHOT-LESEN & -SCHREIBEN
   ========================================================= */
async function pullAndMergeLatestDriveSnapshot(existingDriveFiles) {
  if (!googleAccessToken || !appState || isCurrentActionCancelled()) return false;
  const snapshots = (existingDriveFiles ? existingDriveFiles : [])
    .filter(f => (f.name ? f.name : '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX))
    .sort((a, b) => new Date(b.modifiedTime ? b.modifiedTime : 0) - new Date(a.modifiedTime ? a.modifiedTime : 0));

  if (snapshots.length === 0) return false;
  const latestSnapshotFile = snapshots[0];

  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${latestSnapshotFile.id}?alt=media`, {
      headers: { 'Authorization': `Bearer ${googleAccessToken}` },
      signal: getActiveAbortSignal()
    });
    if (!res.ok) return false;
    const snap = await res.json();
    if (!snap || typeof snap !== 'object') return false;

    let anyStateChanged = false;
    ensureStateCollections(appState);

    if (snap.deletedTaskTombstones && typeof snap.deletedTaskTombstones === 'object') {
      for (const [sig, ts] of Object.entries(snap.deletedTaskTombstones)) {
        if (!appState.deletedTaskTombstones[sig] || ts > appState.deletedTaskTombstones[sig]) {
          appState.deletedTaskTombstones[sig] = ts;
          anyStateChanged = true;
        }
      }
    }

    if (snap.deletedDocIds && typeof snap.deletedDocIds === 'object') {
      for (const [docId, ts] of Object.entries(snap.deletedDocIds)) {
        if (!appState.deletedDocIds[docId]) {
          appState.deletedDocIds[docId] = ts;
          anyStateChanged = true;
        }
        if (cachedDocsList.some(d => d.id === docId)) {
          await deleteDocRecordFromDB(docId, false);
          anyStateChanged = true;
        }
      }
    }

    if (purgeTombstonedTasksFromState(appState)) {
      anyStateChanged = true;
    }

    if (Array.isArray(snap.weeks) && Array.isArray(appState.weeks)) {
      const snapUpdated = Number(snap.stateLastUpdated ? snap.stateLastUpdated : (snap.syncedAt ? snap.syncedAt : 0));
      const localUpdated = Number(appState.lastUpdated ? appState.lastUpdated : 0);

      for (let wIdx = 0; wIdx < appState.weeks.length; wIdx++) {
        const localWeek = appState.weeks[wIdx];
        const snapWeek = snap.weeks.find(w => w.id === localWeek.id) || snap.weeks[wIdx];
        if (!snapWeek || !snapWeek.cells) continue;

        for (const mod of appState.modules) {
          const sName = mod.shortName;
          const localItems = localWeek.cells[sName] ? localWeek.cells[sName] : [];
          const snapItems = (snapWeek.cells[sName] ? snapWeek.cells[sName] : []).filter(
            it => !isTaskTombstoned(sName, localWeek.id, it.text)
          );

          if (snapUpdated > localUpdated) {
            for (const sItem of snapItems) {
              const normSnap = normalizeTaskTextForMatch(sItem.text, sName);
              const existingLocal = localItems.find(li => normalizeTaskTextForMatch(li.text, sName) === normSnap);
              if (!existingLocal) {
                localItems.push({ ...sItem });
                anyStateChanged = true;
              } else if (existingLocal.done !== sItem.done || existingLocal.inProgress !== sItem.inProgress) {
                existingLocal.done = sItem.done;
                existingLocal.inProgress = sItem.inProgress;
                anyStateChanged = true;
              }
            }
          }
          localWeek.cells[sName] = localItems;
        }
      }
    }

    if (Array.isArray(snap.docAssignments)) {
      for (const sa of snap.docAssignments) {
        if (!sa || !sa.id || (appState.deletedDocIds && appState.deletedDocIds[sa.id])) continue;
        const localDoc = cachedDocsList.find(d =>
          d.id === sa.id ||
          (sa.driveFileId && d.driveFileId === sa.driveFileId)
        );
        if (localDoc && !localDoc.needsDriveUpdate) {
          const snapDocTime = Number(sa.updatedAt ? sa.updatedAt : 0);
          const localDocTime = Number(localDoc.updatedAt ? localDoc.updatedAt : (localDoc.uploadedAt ? localDoc.uploadedAt : 0));
          const isMissingAssignment = !localDoc.taskText && sa.taskText;

          if (snapDocTime > localDocTime || isMissingAssignment) {
            localDoc.module = sa.module ? sa.module : localDoc.module;
            localDoc.category = sa.category ? sa.category : localDoc.category;
            localDoc.weekLabel = normalizeWeekLabelOneLine(sa.weekLabel !== undefined ? sa.weekLabel : localDoc.weekLabel);
            localDoc.taskText = stripModuleBracketsFromText(sa.taskText !== undefined ? sa.taskText : localDoc.taskText, localDoc.module);
            localDoc.taskHash = sa.taskHash ? sa.taskHash : (localDoc.taskText ? computeTaskHash(localDoc.module, localDoc.weekLabel, localDoc.taskText) : '');
            localDoc.title = sa.title ? sa.title : localDoc.title;
            if (typeof sa.sortOrder === 'number') localDoc.sortOrder = sa.sortOrder;
            localDoc.manualOverride = sa.manualOverride !== undefined ? Boolean(sa.manualOverride) : localDoc.manualOverride;
            localDoc.updatedAt = Math.max(localDocTime, snapDocTime);
            await putDocRecordInDB(localDoc);
            anyStateChanged = true;
          }
        }
      }
    }

    if (anyStateChanged) {
      saveState();
    }
    return anyStateChanged;
  } catch (e) {
    console.warn('Snapshot-Merge Hinweis:', e);
    return false;
  }
}

async function saveSyncSnapshotOverwriteOldest(folderId, existingDriveFiles) {
  if (!googleAccessToken || !appState || isCurrentActionCancelled()) return;
  const snapshots = (existingDriveFiles ? existingDriveFiles : [])
    .filter(f => (f.name ? f.name : '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX))
    .sort((a, b) => new Date(a.modifiedTime ? a.modifiedTime : 0) - new Date(b.modifiedTime ? b.modifiedTime : 0));

  ensureStateCollections(appState);

  const snapshotPayload = {
    syncedAt: Date.now(),
    stateLastUpdated: appState.lastUpdated ? appState.lastUpdated : Date.now(),
    modules: appState.modules,
    weeks: appState.weeks,
    deletedTaskTombstones: appState.deletedTaskTombstones ? appState.deletedTaskTombstones : {},
    deletedDocIds: appState.deletedDocIds ? appState.deletedDocIds : {},
    docAssignments: cachedDocsList.map(d => ({
      id: d.id,
      driveFileId: d.driveFileId ? d.driveFileId : '',
      fileName: d.fileName ? d.fileName : '',
      title: d.title ? d.title : '',
      module: d.module,
      category: d.category,
      weekLabel: normalizeWeekLabelOneLine(d.weekLabel ? d.weekLabel : ''),
      taskText: stripModuleBracketsFromText(d.taskText ? d.taskText : '', d.module),
      taskHash: d.taskHash ? d.taskHash : (d.taskText ? computeTaskHash(d.module, d.weekLabel, d.taskText) : ''),
      sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : (d.uploadedAt ? d.uploadedAt : 0),
      manualOverride: Boolean(d.manualOverride),
      updatedAt: d.updatedAt ? d.updatedAt : (d.uploadedAt ? d.uploadedAt : 0)
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

function resolveFullTaskTextByHash(moduleName, weekLabelOneLine, taskHash, fallbackTaskText = '') {
  if (!taskHash || !appState?.weeks) return fallbackTaskText;
  for (const w of appState.weeks) {
    const items = w.cells?.[moduleName] ? w.cells[moduleName] : [];
    for (const it of items) {
      const cleanTxt = stripModuleBracketsFromText(it.text, moduleName);
      if (computeTaskHash(moduleName, w.id, cleanTxt) === taskHash) {
        return cleanTxt;
      }
    }
  }
  return fallbackTaskText;
}

/* =========================================================
   HAUPTFUNKTION: INKREMENTELLE DRIVE-SYNCHRONISATION
   ========================================================= */
async function syncDocumentsWithGoogleDrive(silent = true) {
  if (!googleAccessToken || isDriveSyncInProgress) return;
  isDriveSyncInProgress = true;
  if (!silent) {
    startCancelableOperation('Synchronisiere Dokumente & Zuordnungen mit Google Drive...');
  }
  try {
    const folderId = await ensureDriveSyncFolder();
    if (isCurrentActionCancelled()) return;

    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,mimeType,size,webViewLink,appProperties,createdTime,modifiedTime)');
    const driveData = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=250`);
    const allDriveFiles = (driveData && driveData.files) ? driveData.files : [];
    const docDriveFiles = allDriveFiles.filter(f => !(f.name ? f.name : '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX));

    let uploadedNewCount = 0;
    let updatedMetaCount = 0;
    let pulledCount = 0;

    const snapshotMerged = await pullAndMergeLatestDriveSnapshot(allDriveFiles);

    const docsToUpload = cachedDocsList.filter(d => !d.driveFileId && d.hasLocalFile);
    let currentUploadIdx = 0;

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

    const deletedDocsMap = (appState && appState.deletedDocIds) ? appState.deletedDocIds : {};

    for (const df of docDriveFiles) {
      if (isCurrentActionCancelled()) break;
      const props = df.appProperties ? df.appProperties : {};
      const docIdFromProps = props.spDocId ? props.spDocId : `doc_drive_${df.id}`;

      if (deletedDocsMap[docIdFromProps]) {
        await deleteDocFromGoogleDrive(df.id);
        continue;
      }

      const existingLocal = cachedDocsList.find(d =>
        d.driveFileId === df.id ||
        (props.spDocId && d.id === props.spDocId) ||
        (d.module === props.spModule && (d.fileName ? d.fileName : '').toLowerCase() === (df.name ? df.name : '').toLowerCase())
      );

      if (existingLocal) {
        if (!existingLocal.driveFileId) {
          existingLocal.driveFileId = df.id;
          existingLocal.webViewLink = df.webViewLink ? df.webViewLink : '';
          await putDocRecordInDB(existingLocal);
        }
        if (props.spManualOverride === 'true' && !existingLocal.needsDriveUpdate) {
          const remoteTime = Number(props.spUpdatedAt) ? Number(props.spUpdatedAt) : (df.modifiedTime ? new Date(df.modifiedTime).getTime() : 0);
          const localTime = Number(existingLocal.updatedAt ? existingLocal.updatedAt : (existingLocal.uploadedAt ? existingLocal.uploadedAt : 0));
          if (remoteTime > localTime + 1500) {
            const modName = props.spModule ? props.spModule : existingLocal.module;
            const wkLabel = normalizeWeekLabelOneLine(props.spWeekLabel !== undefined ? props.spWeekLabel : existingLocal.weekLabel);
            const fullTask = resolveFullTaskTextByHash(modName, wkLabel, props.spTaskHash, props.spTaskText !== undefined ? props.spTaskText : existingLocal.taskText);

            existingLocal.module = modName;
            existingLocal.category = props.spCategory ? props.spCategory : existingLocal.category;
            existingLocal.weekLabel = wkLabel;
            existingLocal.taskText = fullTask;
            existingLocal.taskHash = props.spTaskHash ? props.spTaskHash : (fullTask ? computeTaskHash(modName, wkLabel, fullTask) : '');
            existingLocal.title = props.spTitle ? props.spTitle : existingLocal.title;
            if (props.spSortOrder) existingLocal.sortOrder = Number(props.spSortOrder) ? Number(props.spSortOrder) : existingLocal.sortOrder;
            existingLocal.manualOverride = true;
            existingLocal.updatedAt = remoteTime;
            await putDocRecordInDB(existingLocal);
            updatedMetaCount++;
          }
        }
        continue;
      }

      const guess = analyzeFileForSmartSorting(df.name, props.spModule, props.spCategory, props.spWeekLabel, props.spTaskText, true);
      const targetMod = props.spModule ? props.spModule : guess.module;
      const targetWk = normalizeWeekLabelOneLine(props.spWeekLabel !== undefined ? props.spWeekLabel : guess.weekLabel);
      const rawTask = props.spTaskText !== undefined ? props.spTaskText : guess.taskText;
      const fullTask = resolveFullTaskTextByHash(targetMod, targetWk, props.spTaskHash, rawTask);

      const newDoc = {
        id: docIdFromProps,
        driveFileId: df.id,
        webViewLink: df.webViewLink ? df.webViewLink : '',
        module: targetMod,
        category: props.spCategory ? props.spCategory : guess.category,
        weekLabel: targetWk,
        taskText: fullTask,
        taskHash: props.spTaskHash ? props.spTaskHash : (fullTask ? computeTaskHash(targetMod, targetWk, fullTask) : ''),
        title: props.spTitle ? props.spTitle : df.name.replace(/\.[^/.]+$/, ''),
        fileName: df.name,
        mimeType: df.mimeType ? df.mimeType : 'application/pdf',
        sizeBytes: Number(df.size) ? Number(df.size) : 0,
        hasLocalFile: false,
        sortOrder: props.spSortOrder ? Number(props.spSortOrder) : (df.createdTime ? new Date(df.createdTime).getTime() : Date.now()),
        manualOverride: props.spManualOverride === 'true',
        uploadedAt: df.createdTime ? new Date(df.createdTime).getTime() : Date.now(),
        updatedAt: Number(props.spUpdatedAt) ? Number(props.spUpdatedAt) : (df.modifiedTime ? new Date(df.modifiedTime).getTime() : Date.now())
      };
      await putDocRecordInDB(newDoc);
      pulledCount++;
    }

    if (!isCurrentActionCancelled()) {
      await saveSyncSnapshotOverwriteOldest(folderId, allDriveFiles);
    }

    if (uploadedNewCount > 0 || pulledCount > 0 || updatedMetaCount > 0 || snapshotMerged) {
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
    if (pendingDriveResyncRequested) {
      pendingDriveResyncRequested = false;
      scheduleAutoDriveSync(800);
    }
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
    const files = ((data && data.files) ? data.files : []).filter(f => !(f.name ? f.name : '').startsWith(DRIVE_STATE_SNAPSHOT_PREFIX));
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
              : `<button type="button" class="btn btn-primary btn-sm" onclick="importFileFromGoogleDrive('${escapeAttr(f.id)}', '${escapeAttr(f.name)}', '${escapeAttr(f.mimeType ? f.mimeType : '')}', ${Number(f.size) ? Number(f.size) : 0}, '${escapeAttr(f.webViewLink ? f.webViewLink : '')}')">📥 Übernehmen</button>`
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
    const docsModFilter = document.getElementById('docsModuleFilter')?.value;
    const docsCatFilter = document.getElementById('docsCategoryFilter')?.value;
    const fallbackMod = document.getElementById('docModuleSelect')?.value || activeModuleFilter || (docsModFilter && docsModFilter !== 'all' ? docsModFilter : '');
    const fallbackCat = document.getElementById('docCategorySelect')?.value || (docsCatFilter && docsCatFilter !== 'all' ? docsCatFilter : '');
    const fallbackWeek = document.getElementById('docWeekSelect')?.value || '';
    const preTask = window._preselectedUploadTaskText || '';

    const hasExplicitPreselection = Boolean(fallbackMod || fallbackCat || fallbackWeek || preTask);
    const guess = analyzeFileForSmartSorting(fileName, fallbackMod, fallbackCat, fallbackWeek, preTask, hasExplicitPreselection);
    const cleanWk = normalizeWeekLabelOneLine(guess.weekLabel ? guess.weekLabel : '');
    const cleanTask = stripModuleBracketsFromText(guess.taskText ? guess.taskText : '', guess.module);
    const nextOrd = getNextSortOrderInScope(guess.module, cleanWk, cleanTask);

    const newDoc = {
      id: `doc_drive_${driveId}`,
      driveFileId: driveId,
      webViewLink: webViewLink ? webViewLink : '',
      module: guess.module,
      category: guess.category,
      weekLabel: cleanWk,
      taskText: cleanTask,
      taskHash: cleanTask ? computeTaskHash(guess.module, cleanWk, cleanTask) : '',
      title: guess.title,
      fileName: fileName,
      mimeType: mimeType ? mimeType : 'application/pdf',
      sizeBytes: sizeBytes ? sizeBytes : 0,
      hasLocalFile: false,
      sortOrder: nextOrd,
      manualOverride: true,
      needsDriveUpdate: true,
      uploadedAt: Date.now(),
      updatedAt: Date.now()
    };
    try {
      await ensureDriveDocContentLoaded(newDoc);
    } catch (e) {}
    await putDocRecordInDB(newDoc);
    await refreshDocsCache();
    saveState();
    if (typeof renderAll === 'function') renderAll();
    await loadGoogleDriveFilesList();
    showToast(`✅ „${newDoc.title}“ zugeordnet (${newDoc.module})!`);
    scheduleAutoDriveSync(500);
  } finally {
    hideLoading();
  }
}