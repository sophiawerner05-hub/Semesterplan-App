/* =========================================================
   UNTERPROGRAMM 8: DIREKTE GOOGLE REST-API SYNCHRONISATION (google-sync.js)
   - Jederzeit abbrechbar über "✖ Abbrechen" (AbortController)
   - Google Account dauerhaft merken (login_hint & Auto-Reconnect)
   - Google Tasks, Kalender (Montags-Modus ohne Emojis/Klammern) & Gmail
   ========================================================= */
const DEFAULT_GOOGLE_CLIENT_ID = '420474206009-2n88gvthkgdj84o34416a6j75dbul650.apps.googleusercontent.com';
const TOKEN_STORAGE_KEY = 'semesterplan_google_access_token';
const TOKEN_EXPIRY_KEY = 'semesterplan_google_token_expiry';
const USER_EMAIL_STORAGE_KEY = 'semesterplan_google_user_email';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

let googleAccessToken = null;
let tokenClient = null;
let cachedListMap = {};
let autoSyncInterval = null;
let isSyncInProgress = false;

function getConfiguredClientId() {
  const stored = localStorage.getItem('semesterplan_google_client_id');
  if (stored && stored.includes('.apps.googleusercontent.com') && !stored.startsWith('DEINE_') && !stored.startsWith('GOCSPX-')) {
    return stored;
  }
  return DEFAULT_GOOGLE_CLIENT_ID;
}

function getRememberedUserEmail() {
  return localStorage.getItem(USER_EMAIL_STORAGE_KEY) || '';
}

function isGoogleConnected() {
  return !!googleAccessToken;
}

function updateGoogleConnectedUI(connected) {
  const badge = document.getElementById('connectionBadge');
  const pill = document.getElementById('syncStatusPill');
  const drivePill = document.getElementById('driveStatusPill');
  const btnText = document.getElementById('googleBtnText');
  const accountInfo = document.getElementById('savedGoogleAccountInfo');
  const drawerAccount = document.getElementById('drawerAccountLabel');
  const rememberedEmail = getRememberedUserEmail();

  if (connected) {
    if (badge) {
      badge.textContent = rememberedEmail ? `☁️ ${rememberedEmail}` : '☁️ Live mit Google verbunden';
      badge.style.background = '#117864';
    }
    if (pill) pill.textContent = '🔄 Auto-Sync: Aktiv';
    if (drivePill) drivePill.textContent = '☁️ Drive-Speicher: Synchron';
    if (btnText) {
      btnText.textContent = rememberedEmail ? `Sync (${rememberedEmail.split('@')[0]})` : 'Verbunden (Sync)';
    }
    if (drawerAccount && rememberedEmail) {
      drawerAccount.textContent = `☁️ ${rememberedEmail}`;
    }
  } else {
    if (badge) {
      badge.textContent = rememberedEmail ? `Gemerkt: ${rememberedEmail}` : 'Lokal & Offline-fähig';
      badge.style.background = '';
    }
    if (pill) pill.textContent = '⏰ Auto-Sync: Bereit';
    if (drivePill) drivePill.textContent = '☁️ Drive-Speicher: Lokal';
    if (btnText) {
      btnText.textContent = rememberedEmail ? `Login (${rememberedEmail.split('@')[0]})` : 'Google Login';
    }
  }
  if (accountInfo && rememberedEmail) {
    accountInfo.textContent = `✅ Gemerkter Google-Account für Auto-Sync: ${rememberedEmail}. Lokale Offline-Backups laufen automatisch im Hintergrund.`;
  }
}

function initGoogleSyncSettingsUI() {
  if (!localStorage.getItem('semesterplan_google_client_id')) {
    localStorage.setItem('semesterplan_google_client_id', DEFAULT_GOOGLE_CLIENT_ID);
  }
  const input = document.getElementById('clientIdInput');
  if (input) {
    input.value = getConfiguredClientId();
  }
  const calCheck = document.getElementById('autoImportCalendarCheck');
  if (calCheck) {
    calCheck.checked = localStorage.getItem('semesterplan_sync_calendar') !== 'false';
  }
  const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  const savedExpiry = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);

  if (savedToken && Date.now() < savedExpiry) {
    googleAccessToken = savedToken;
    updateGoogleConnectedUI(true);
    startBackgroundAutoSync();
    setTimeout(async () => {
      await syncWithGoogleTasksAPI(true);
      if (typeof syncDocumentsWithGoogleDrive === 'function') {
        await syncDocumentsWithGoogleDrive(true);
      }
      await checkAndSendWeeklyAutoEmail();
    }, 600);
  } else {
    updateGoogleConnectedUI(false);
    if (getRememberedUserEmail()) {
      setTimeout(() => {
        if (!isGoogleConnected() && typeof google !== 'undefined') {
          trySilentTokenRestore();
        }
      }, 1200);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isGoogleConnected()) {
      syncWithGoogleTasksAPI(true);
      if (typeof syncDocumentsWithGoogleDrive === 'function') {
        syncDocumentsWithGoogleDrive(true);
      }
    }
  });
}

window.addEventListener('DOMContentLoaded', initGoogleSyncSettingsUI);

function startBackgroundAutoSync() {
  if (autoSyncInterval) clearInterval(autoSyncInterval);
  autoSyncInterval = setInterval(() => {
    if (googleAccessToken) {
      syncWithGoogleTasksAPI(true);
      if (typeof syncDocumentsWithGoogleDrive === 'function') {
        syncDocumentsWithGoogleDrive(true);
      }
      checkAndSendWeeklyAutoEmail();
    }
  }, 90 * 1000);
}

function handleGooglePrimaryClick() {
  if (isGoogleConnected()) {
    syncAndClean();
  } else {
    connectGoogleLive();
  }
}

function saveGoogleConfig() {
  const input = document.getElementById('clientIdInput');
  if (input && input.value.trim()) {
    localStorage.setItem('semesterplan_google_client_id', input.value.trim());
  }
  const calCheck = document.getElementById('autoImportCalendarCheck');
  if (calCheck) {
    localStorage.setItem('semesterplan_sync_calendar', calCheck.checked ? 'true' : 'false');
  }
}

function saveGoogleConfigAndConnect() {
  saveGoogleConfig();
  closeModal('googleSetupModal');
  connectGoogleLive();
}

async function fetchAndRememberGoogleUserProfile() {
  try {
    const info = await googleApiFetch('https://www.googleapis.com/oauth2/v2/userinfo');
    if (info && info.email) {
      localStorage.setItem(USER_EMAIL_STORAGE_KEY, info.email);
      updateGoogleConnectedUI(true);
    }
  } catch (e) {}
}

function initGoogleAuth() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    showToast('❌ Google-Login-Skript konnte nicht geladen werden (Internetverbindung prüfen).');
    return false;
  }
  const clientId = getConfiguredClientId();
  const rememberedEmail = getRememberedUserEmail();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GOOGLE_SCOPES,
    hint: rememberedEmail || undefined,
    callback: async (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        googleAccessToken = tokenResponse.access_token;
        const expiresInSec = parseInt(tokenResponse.expires_in || '3599', 10);
        localStorage.setItem(TOKEN_STORAGE_KEY, googleAccessToken);
        localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + (expiresInSec - 60) * 1000));
        await fetchAndRememberGoogleUserProfile();
        updateGoogleConnectedUI(true);
        startBackgroundAutoSync();
        await syncWithGoogleTasksAPI(false);
        if (typeof syncDocumentsWithGoogleDrive === 'function') {
          await syncDocumentsWithGoogleDrive(false);
        }
        await checkAndSendWeeklyAutoEmail();
      }
    }
  });
  return true;
}

function trySilentTokenRestore() {
  if (!initGoogleAuth()) return;
  const rememberedEmail = getRememberedUserEmail();
  tokenClient.requestAccessToken({
    prompt: 'none',
    login_hint: rememberedEmail || undefined
  });
}

function connectGoogleLive() {
  if (!initGoogleAuth()) return;
  const rememberedEmail = getRememberedUserEmail();
  tokenClient.requestAccessToken({
    prompt: '',
    login_hint: rememberedEmail || undefined
  });
}

async function googleApiFetch(url, options = {}) {
  if (!googleAccessToken) throw new Error('Nicht mit Google verbunden.');
  if (typeof isCurrentActionCancelled === 'function' && isCurrentActionCancelled()) {
    const abortErr = new Error('Aktion vom Nutzer abgebrochen');
    abortErr.name = 'AbortError';
    throw abortErr;
  }
  const headers = {
    'Authorization': `Bearer ${googleAccessToken}`,
    ...(options.headers || {})
  };
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const fetchSignal = typeof getActiveAbortSignal === 'function' ? getActiveAbortSignal() : undefined;
  const response = await fetch(url, { ...options, headers, signal: fetchSignal });
  if (response.status === 401) {
    googleAccessToken = null;
    cachedListMap = {};
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    updateGoogleConnectedUI(false);
    throw new Error('Google-Sitzung abgelaufen. Bitte kurz auf Google Sync klicken.');
  }
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google API Fehler (${response.status}): ${errText}`);
  }
  return response.status === 204 ? null : response.json();
}

/* =========================================================
   GOOGLE TASKS & KALENDER SYNCHRONISATION (MONTAGS-MODUS)
   ========================================================= */
async function fetchAllGoogleTasks(listId) {
  let allItems = [];
  let pageToken = '';
  do {
    if (isCurrentActionCancelled()) break;
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const data = await googleApiFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&showHidden=true&maxResults=100${tokenParam}`
    );
    if (data && Array.isArray(data.items)) {
      allItems = allItems.concat(data.items);
    }
    pageToken = data ? data.nextPageToken : '';
  } while (pageToken);
  return allItems;
}

async function ensureModuleTaskLists(forceRefresh = false) {
  if (!appState && typeof loadState === 'function') {
    loadState();
  }
  if (!appState || !Array.isArray(appState.modules)) {
    throw new Error('App-Daten (appState.modules) sind noch nicht geladen.');
  }
  if (!forceRefresh && Object.keys(cachedListMap).length === appState.modules.length) {
    return cachedListMap;
  }
  const listsData = await googleApiFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100');
  const existingLists = (listsData && listsData.items) || [];
  const listMap = {};
  existingLists.forEach(l => {
    const cleanTitle = l.title.trim().replace(/^\[|\]$/g, '');
    listMap[cleanTitle] = l.id;
  });
  for (const mod of appState.modules) {
    if (isCurrentActionCancelled()) break;
    if (!listMap[mod.shortName]) {
      const createdList = await googleApiFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
        method: 'POST',
        body: JSON.stringify({ title: mod.shortName })
      });
      listMap[mod.shortName] = createdList.id;
    }
  }
  cachedListMap = listMap;
  return listMap;
}

function getWeekMondayIso(weekIdx) {
  const week = appState.weeks[weekIdx];
  if (!week) return new Date().toISOString();
  const parsed = parseWeekDates(week.weekLabel);
  if (!parsed) return new Date().toISOString();
  return new Date(Date.UTC(
    parsed.weekMon.getFullYear(),
    parsed.weekMon.getMonth(),
    parsed.weekMon.getDate(),
    12, 0, 0
  )).toISOString();
}

function stripAllEmojisAndBrackets(str) {
  return String(str ?? '')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCleanTaskDescription(shortName, rawText) {
  const withoutEmojis = stripAllEmojisAndBrackets(rawText);
  return withoutEmojis
    .replace(new RegExp(`^${shortName}\\s*(\\([^)]*\\))?:?\\s*`, 'i'), '')
    .replace(/^\(?\s*Woche\s*\d+[^)]*\)?:?\s*/i, '')
    .trim();
}

function buildCleanGoogleTitle(shortName, rawText) {
  const cleanText = extractCleanTaskDescription(shortName, rawText);
  const cleanMod = stripAllEmojisAndBrackets(shortName);
  return `${cleanMod}: ${cleanText}`;
}

function isLegacyWeekHeaderTask(gTask, shortName) {
  if (!gTask) return false;
  if (gTask.notes && gTask.notes.includes('WocheParent:')) return true;
  const rawTitle = (gTask.title || '').trim();
  const cleanTitle = stripAllEmojisAndBrackets(rawTitle);
  if (/^([a-z0-9äöüß\s]+:?\s*)?woche\s*(\d+|zusatz)/i.test(cleanTitle)) return true;
  if (cleanTitle.toLowerCase() === shortName.toLowerCase() && gTask.notes && gTask.notes.includes('Oberaufgabe')) return true;
  return false;
}

function buildTaskPayload(weekIdx, shortName, item) {
  const week = appState.weeks[weekIdx];
  const parsed = parseWeekDates(week.weekLabel);
  const mondayDueIso = getWeekMondayIso(weekIdx);
  const sundayStr = parsed ? formatDateDE(parsed.weekSun) : '';
  const mondayStr = parsed ? formatDateDE(parsed.weekMon) : '';
  let dueIso = mondayDueIso;
  if (item.dueDate && parsed) {
    const sunIsoDay = `${parsed.weekSun.getFullYear()}-${String(parsed.weekSun.getMonth() + 1).padStart(2, '0')}-${String(parsed.weekSun.getDate()).padStart(2, '0')}`;
    if (item.dueDate !== sunIsoDay) {
      const p = item.dueDate.split('-');
      dueIso = new Date(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12, 0, 0)).toISOString();
    } else {
      item.dueDate = getWeekMondayDateString(weekIdx);
    }
  }
  return {
    title: buildCleanGoogleTitle(shortName, item.text),
    notes: `Modul: ${shortName} | Montag: ${mondayStr}${sundayStr ? ` (bis ${sundayStr})` : ''} | WocheID:${week.id}`,
    due: dueIso,
    status: item.done ? 'completed' : 'needsAction'
  };
}

async function pushSingleTaskToggleToGoogle(weekIdx, shortName, item) {
  try {
    await ensureModuleTaskLists();
    const listId = cachedListMap[shortName];
    if (!listId) return;
    if (item.googleTaskId) {
      await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${item.googleTaskId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: buildCleanGoogleTitle(shortName, item.text),
          status: item.done ? 'completed' : 'needsAction'
        })
      });
      item.lastSyncedDone = item.done;
      saveState();
      showToast(item.done ? '☁️ In Google Tasks abgehakt!' : '☁️ In Google Tasks als offen markiert!');
    } else {
      await pushSingleTaskCreateToGoogle(weekIdx, shortName, item);
    }
  } catch (e) {
    console.error(e);
  }
}

async function pushSingleTaskCreateToGoogle(weekIdx, shortName, item) {
  try {
    await ensureModuleTaskLists();
    const listId = cachedListMap[shortName];
    if (!listId) return;
    const payload = buildTaskPayload(weekIdx, shortName, item);
    const created = await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    item.googleTaskId = created.id;
    delete item.parentTaskId;
    item.lastSyncedDone = item.done;
    item.lastSyncedText = item.text;
    if (item.syncCalendar !== false) {
      await createOrUpdateCalendarEvent(weekIdx, shortName, item);
    }
    saveState();
    showToast('☁️ In Google Tasks & Kalender gespeichert!');
  } catch (e) {
    console.error(e);
  }
}

async function pushSingleTaskMoveOrEditToGoogle(weekIdx, shortName, item) {
  try {
    await ensureModuleTaskLists();
    const listId = cachedListMap[shortName];
    if (!listId) return;
    const payload = buildTaskPayload(weekIdx, shortName, item);
    if (item.googleTaskId) {
      await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${item.googleTaskId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      item.lastSyncedDone = item.done;
      item.lastSyncedText = item.text;
    } else {
      await pushSingleTaskCreateToGoogle(weekIdx, shortName, item);
    }
    if (item.syncCalendar !== false) {
      await createOrUpdateCalendarEvent(weekIdx, shortName, item);
    }
    saveState();
  } catch (e) {
    console.error(e);
  }
}

async function deleteSingleTaskFromGoogle(shortName, googleTaskId) {
  try {
    await ensureModuleTaskLists();
    const listId = cachedListMap[shortName];
    if (!listId || !googleTaskId) return;
    await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${googleTaskId}`, {
      method: 'DELETE'
    });
  } catch (e) {}
}

async function syncWithGoogleTasksAPI(silent = false) {
  if (!googleAccessToken) {
    if (!silent) connectGoogleLive();
    return;
  }
  if (isSyncInProgress) return;
  isSyncInProgress = true;
  if (!silent) startCancelableOperation('Synchronisiere Aufgaben mit Google Tasks & Kalender...');
  try {
    const listMap = await ensureModuleTaskLists(true);
    if (Array.isArray(appState.deletedGoogleTaskIds) && appState.deletedGoogleTaskIds.length > 0) {
      for (const delEntry of appState.deletedGoogleTaskIds) {
        if (isCurrentActionCancelled()) break;
        const lId = listMap[delEntry.shortName];
        if (lId && delEntry.taskId) {
          try {
            await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${lId}/tasks/${delEntry.taskId}`, {
              method: 'DELETE'
            });
          } catch (e) {}
        }
      }
      appState.deletedGoogleTaskIds = [];
    }

    let importedFromGoogleCount = 0;
    let statusChangedFromGoogleCount = 0;

    for (const mod of appState.modules) {
      if (isCurrentActionCancelled()) break;
      const shortName = mod.shortName;
      const listId = listMap[shortName];
      const allRawTasks = await fetchAllGoogleTasks(listId);
      if (isCurrentActionCancelled()) break;

      const deletedTaskIds = new Set(allRawTasks.filter(t => t.deleted).map(t => t.id));
      let activeGoogleTasks = allRawTasks.filter(t => !t.deleted && (t.title || '').trim() !== '');

      const legacyParentIds = new Set();
      for (const gTask of activeGoogleTasks) {
        if (isLegacyWeekHeaderTask(gTask, shortName)) {
          legacyParentIds.add(gTask.id);
        }
      }
      if (legacyParentIds.size > 0) {
        for (const gTask of activeGoogleTasks) {
          if (isCurrentActionCancelled()) break;
          if (gTask.parent && legacyParentIds.has(gTask.parent)) {
            try {
              await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${gTask.id}/move`, {
                method: 'POST'
              });
              delete gTask.parent;
            } catch (e) {}
          }
        }
        for (const parentId of legacyParentIds) {
          if (isCurrentActionCancelled()) break;
          try {
            await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${parentId}`, {
              method: 'DELETE'
            });
          } catch (e) {}
        }
        activeGoogleTasks = activeGoogleTasks.filter(t => !legacyParentIds.has(t.id));
      }

      for (const week of appState.weeks) {
        if (week.googleParentTaskIds) delete week.googleParentTaskIds[listId];
        const items = week.cells[shortName] || [];
        week.cells[shortName] = items.filter(item => !(item.googleTaskId && deletedTaskIds.has(item.googleTaskId)));
      }

      const matchedGoogleTaskIds = new Set();
      for (let wIdx = 0; wIdx < appState.weeks.length; wIdx++) {
        if (isCurrentActionCancelled()) break;
        const week = appState.weeks[wIdx];
        const parsed = parseWeekDates(week.weekLabel);
        const sundayStr = parsed ? formatDateDE(parsed.weekSun) : '';
        const items = week.cells[shortName] || [];
        if (items.length === 0) continue;

        for (const item of items) {
          if (isCurrentActionCancelled()) break;
          const cleanText = extractCleanTaskDescription(shortName, item.text);
          item.text = cleanText;
          const expectedCleanTitle = buildCleanGoogleTitle(shortName, cleanText);

          let matchedTask = item.googleTaskId
            ? activeGoogleTasks.find(t => t.id === item.googleTaskId && !matchedGoogleTaskIds.has(t.id))
            : null;

          if (!matchedTask) {
            matchedTask = activeGoogleTasks.find(t => {
              if (matchedGoogleTaskIds.has(t.id) || !t.title) return false;
              const tDesc = extractCleanTaskDescription(shortName, t.title);
              if (tDesc.toLowerCase() !== cleanText.toLowerCase()) return false;
              if (t.notes && (t.notes.includes(`WocheID:${week.id}`) || (sundayStr && t.notes.includes(sundayStr)))) {
                return true;
              }
              return true;
            });
          }

          if (!matchedTask) {
            const payload = buildTaskPayload(wIdx, shortName, item);
            const created = await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            item.googleTaskId = created.id;
            delete item.parentTaskId;
            item.lastSyncedDone = item.done;
            item.lastSyncedText = item.text;
            matchedGoogleTaskIds.add(created.id);
          } else {
            matchedGoogleTaskIds.add(matchedTask.id);
            item.googleTaskId = matchedTask.id;
            delete item.parentTaskId;
            const googleIsDone = (matchedTask.status === 'completed');
            if (typeof item.lastSyncedDone === 'boolean') {
              if (googleIsDone !== item.lastSyncedDone && item.done === item.lastSyncedDone) {
                item.done = googleIsDone;
                if (item.done) item.inProgress = false;
                statusChangedFromGoogleCount++;
              }
            } else if (googleIsDone && !item.done) {
              item.done = true;
              item.inProgress = false;
              statusChangedFromGoogleCount++;
            }
            const desiredPayload = buildTaskPayload(wIdx, shortName, item);
            const currentDueDay = matchedTask.due ? matchedTask.due.slice(0, 10) : '';
            const desiredDueDay = desiredPayload.due.slice(0, 10);
            const needsPatch =
              matchedTask.title !== expectedCleanTitle ||
              currentDueDay !== desiredDueDay ||
              (matchedTask.status === 'completed') !== item.done;
            if (needsPatch) {
              await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${matchedTask.id}`, {
                method: 'PATCH',
                body: JSON.stringify(desiredPayload)
              });
            }
            item.lastSyncedDone = item.done;
            item.lastSyncedText = item.text;
          }

          if (item.googleEventId && item.syncCalendar !== false) {
            await createOrUpdateCalendarEvent(wIdx, shortName, item);
          }
        }
      }

      for (const gTask of activeGoogleTasks) {
        if (isCurrentActionCancelled()) break;
        if (matchedGoogleTaskIds.has(gTask.id)) continue;
        if (isLegacyWeekHeaderTask(gTask, shortName)) continue;
        const cleanTaskText = extractCleanTaskDescription(shortName, gTask.title || '');
        if (!cleanTaskText) continue;

        let targetWeekIdx = -1;
        if (gTask.notes) {
          const idMatch = gTask.notes.match(/WocheID:(week_\d+)/);
          if (idMatch) {
            targetWeekIdx = appState.weeks.findIndex(w => w.id === idMatch[1]);
          }
        }
        if (targetWeekIdx === -1 && gTask.due) {
          targetWeekIdx = findWeekIndexByDate(new Date(gTask.due));
        }
        if (targetWeekIdx === -1) {
          const nowIdx = findWeekIndexByDate(new Date());
          targetWeekIdx = nowIdx !== -1 ? nowIdx : 0;
        }

        const targetWeek = appState.weeks[targetWeekIdx];
        const existingInCell = targetWeek.cells[shortName] || [];
        const duplicate = existingInCell.find(i => i.text.toLowerCase() === cleanTaskText.toLowerCase());
        if (!duplicate) {
          existingInCell.push({
            text: cleanTaskText,
            done: gTask.status === 'completed',
            inProgress: false,
            dueDate: getWeekMondayDateString(targetWeekIdx),
            googleTaskId: gTask.id,
            lastSyncedDone: gTask.status === 'completed',
            lastSyncedText: cleanTaskText
          });
          targetWeek.cells[shortName] = existingInCell;
          importedFromGoogleCount++;
        }
      }
    }

    if (!isCurrentActionCancelled() && localStorage.getItem('semesterplan_sync_calendar') !== 'false') {
      const calImported = await syncEventsFromGoogleCalendar();
      importedFromGoogleCount += calImported;
    }

    if (!isCurrentActionCancelled() && typeof syncDocumentsWithGoogleDrive === 'function') {
      await syncDocumentsWithGoogleDrive(true);
    }

    saveState();
    renderAll();

    if (!silent && !isCurrentActionCancelled()) {
      showToast('✅ Sync (Tasks, Kalender & Drive) abgeschlossen!');
    } else if (!isCurrentActionCancelled() && (statusChangedFromGoogleCount > 0 || importedFromGoogleCount > 0)) {
      showToast('☁️ Änderungen aus Google automatisch übernommen!');
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(error);
      if (!silent) showToast('❌ Synchronisationsfehler: ' + error.message);
    }
  } finally {
    isSyncInProgress = false;
    if (!silent) hideLoading();
  }
}

async function forceFullResync() {
  closeModal('googleSetupModal');
  await syncWithGoogleTasksAPI(false);
}

async function createOrUpdateCalendarEvent(weekIdx, shortName, item) {
  if (!googleAccessToken || isCurrentActionCancelled()) return;
  try {
    const startDate = item.dueDate || getWeekMondayDateString(weekIdx);
    const startObj = new Date(startDate + 'T00:00:00');
    const endObj = new Date(startObj.getTime() + 24 * 60 * 60 * 1000);
    const endDate = endObj.toISOString().slice(0, 10);
    const cleanSummary = buildCleanGoogleTitle(shortName, item.text);
    const eventPayload = {
      summary: cleanSummary,
      description: `Semesterplan-Aufgabe für ${stripAllEmojisAndBrackets(shortName)}`,
      start: { date: startDate },
      end: { date: endDate }
    };
    if (item.googleEventId) {
      await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${item.googleEventId}`, {
        method: 'PATCH',
        body: JSON.stringify(eventPayload)
      });
    } else {
      const created = await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events`, {
        method: 'POST',
        body: JSON.stringify(eventPayload)
      });
      item.googleEventId = created.id;
    }
  } catch (e) {}
}

async function syncEventsFromGoogleCalendar() {
  if (!googleAccessToken || isCurrentActionCancelled()) return 0;
  try {
    const timeMin = new Date(2026, 9, 15).toISOString();
    const timeMax = new Date(2027, 2, 1).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&maxResults=250`;
    const calData = await googleApiFetch(url);
    const events = (calData && calData.items) || [];
    let importedCount = 0;

    for (const ev of events) {
      if (isCurrentActionCancelled()) break;
      const rawSummary = (ev.summary || '').trim();
      if (!rawSummary) continue;
      let matchedMod = null;
      for (const mod of appState.modules) {
        const regex = new RegExp(`\\b(${mod.shortName}|${mod.fullName.split(':')[0]})\\b`, 'i');
        if (regex.test(rawSummary)) {
          matchedMod = mod.shortName;
          break;
        }
      }
      if (!matchedMod && /testat/i.test(rawSummary)) {
        matchedMod = 'CAD';
      }
      if (!matchedMod) continue;

      const rawDateStr = ev.start?.date || (ev.start?.dateTime ? ev.start.dateTime.slice(0, 10) : null);
      if (!rawDateStr) continue;
      const p = rawDateStr.split('-');
      const eventDate = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12, 0, 0);
      const weekIdx = findWeekIndexByDate(eventDate);
      if (weekIdx === -1) continue;

      const cleanTitle = extractCleanTaskDescription(matchedMod, rawSummary);
      if (!cleanTitle) continue;

      const expectedSummary = buildCleanGoogleTitle(matchedMod, cleanTitle);
      if (rawSummary !== expectedSummary) {
        try {
          await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${ev.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ summary: expectedSummary })
          });
        } catch (e) {}
      }

      const cellItems = appState.weeks[weekIdx].cells[matchedMod] || [];
      const exists = cellItems.some(i =>
        i.googleEventId === ev.id || i.text.toLowerCase() === cleanTitle.toLowerCase()
      );
      if (!exists) {
        cellItems.push({
          text: cleanTitle,
          done: false,
          inProgress: false,
          dueDate: getWeekMondayDateString(weekIdx),
          googleEventId: ev.id,
          syncCalendar: true
        });
        appState.weeks[weekIdx].cells[matchedMod] = cellItems;
        importedCount++;
      }
    }
    return importedCount;
  } catch (e) {
    return 0;
  }
}

/* =========================================================
   MANUELLER & AUTOMATISCHER WÖCHENTLICHER E-MAIL-VERSAND (GMAIL API)
   ========================================================= */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function sendBriefingViaGmailAPI(silent = false) {
  if (!googleAccessToken) {
    if (!silent) connectGoogleLive();
    return false;
  }
  if (!silent) startCancelableOperation('Sende Wochen-Briefing über Gmail API...');
  try {
    const { subject, htmlBody } = buildEmailHtmlObject();
    const mimeLines = [
      `To: me`,
      `Subject: =?utf-8?B?${utf8ToBase64(subject)}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlBody
    ];
    const rawMime = mimeLines.join('\r\n');
    const base64UrlEncoded = utf8ToBase64(rawMime)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await googleApiFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: base64UrlEncoded })
    });
    const nowStr = formatDateDE(new Date());
    localStorage.setItem('semesterplan_last_auto_email_date', nowStr);
    if (currentTab === 'email') renderEmailPreview();
    if (!silent && !isCurrentActionCancelled()) {
      showToast('✅ Wochen-Briefing erfolgreich an dein Gmail-Postfach gesendet!');
    }
    return true;
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(error);
      if (!silent) {
        showToast('❌ Gmail-Versand fehlgeschlagen, öffne Standard-Mailprogramm...');
        triggerMailtoFallback();
      }
    }
    return false;
  } finally {
    if (!silent) hideLoading();
  }
}

async function checkAndSendWeeklyAutoEmail() {
  if (!googleAccessToken) return;
  if (localStorage.getItem('semesterplan_auto_weekly_email') === 'false') return;
  const now = new Date();
  const currentWeekIdx = findWeekIndexByDate(now);
  const weekKey = currentWeekIdx !== -1
    ? `week_${currentWeekIdx}`
    : `iso_${now.getFullYear()}_${now.getMonth()}_${Math.floor(now.getDate() / 7)}`;
  const targetKey = now.getDay() === 0 ? `${weekKey}_sun_preview` : `${weekKey}_weekly`;
  const lastSentKey = localStorage.getItem('semesterplan_last_auto_email_week_key');
  if (lastSentKey === targetKey) return;
  const sentOk = await sendBriefingViaGmailAPI(true);
  if (sentOk) {
    localStorage.setItem('semesterplan_last_auto_email_week_key', targetKey);
    showToast('📩 Wöchentliches E-Mail-Briefing wurde automatisch an dein Gmail-Postfach gesendet!');
  }
}