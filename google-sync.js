/* =========================================================
   DIREKTE GOOGLE REST-API SYNCHRONISATION (google-sync.js)
   - Einheitliche Benennung aller Ober- & Unteraufgaben:
     Oberaufgabe: "📅 [ModSim] Woche 3 (02.11. – 08.11.2026)"
     Unteraufgabe: "ModSim (Woche 3): Vorlesung: V2..."
   - Automatische Migration alter "ModSim"-Oberaufgaben
   - Alle Aufgaben werden am MONTAG der jeweiligen Woche im
     Kalender & in Google Tasks angezeigt (nicht am Sonntag!)
   - Automatischer wöchentlicher E-Mail-Briefing-Versand
   ========================================================= */
const DEFAULT_GOOGLE_CLIENT_ID = '420474206009-2n88gvthkgdj84o34416a6j75dbul650.apps.googleusercontent.com';
const TOKEN_STORAGE_KEY = 'semesterplan_google_access_token';
const TOKEN_EXPIRY_KEY = 'semesterplan_google_token_expiry';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send'
].join(' ');

let googleAccessToken = null;
let tokenClient = null;
let cachedListMap = {};
let autoSyncInterval = null;
let isSyncInProgress = false;

function getConfiguredClientId() {
  const stored = localStorage.getItem('semesterplan_google_client_id');
  if (stored && stored.includes('.apps.googleusercontent.com') && !stored.startsWith('DEINE_')) {
    return stored;
  }
  return DEFAULT_GOOGLE_CLIENT_ID;
}

function isGoogleConnected() {
  return !!googleAccessToken;
}

function updateGoogleConnectedUI(connected) {
  const badge = document.getElementById('connectionBadge');
  const pill = document.getElementById('syncStatusPill');
  const btnText = document.getElementById('googleBtnText');
  if (connected) {
    if (badge) {
      badge.textContent = '☁️ Live mit Google verbunden';
      badge.style.background = '#117864';
    }
    if (pill) {
      pill.textContent = '🔄 Auto-Sync: Aktiv (Montags-Modus)';
    }
    if (btnText) {
      btnText.textContent = 'Verbunden (Sync)';
    }
  } else {
    if (badge) {
      badge.textContent = 'Lokal & Offline-fähig';
      badge.style.background = '';
    }
    if (pill) {
      pill.textContent = '⏰ Auto-Sync: Bereit';
    }
    if (btnText) {
      btnText.textContent = 'Google Login';
    }
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
      await checkAndSendWeeklyAutoEmail();
    }, 600);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isGoogleConnected()) {
      syncWithGoogleTasksAPI(true);
    }
  });
  window.addEventListener('focus', () => {
    if (isGoogleConnected()) {
      syncWithGoogleTasksAPI(true);
    }
  });
}

window.addEventListener('DOMContentLoaded', initGoogleSyncSettingsUI);

function startBackgroundAutoSync() {
  if (autoSyncInterval) clearInterval(autoSyncInterval);
  autoSyncInterval = setInterval(() => {
    if (googleAccessToken) {
      syncWithGoogleTasksAPI(true);
      checkAndSendWeeklyAutoEmail();
    }
  }, 60 * 1000);
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

function initGoogleAuth() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    showToast('❌ Google-Login-Skript konnte nicht geladen werden (Internetverbindung prüfen).');
    return false;
  }
  const clientId = getConfiguredClientId();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GOOGLE_SCOPES,
    callback: async (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        googleAccessToken = tokenResponse.access_token;
        const expiresInSec = parseInt(tokenResponse.expires_in || '3599', 10);
        localStorage.setItem(TOKEN_STORAGE_KEY, googleAccessToken);
        localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + (expiresInSec - 60) * 1000));
        updateGoogleConnectedUI(true);
        startBackgroundAutoSync();
        await syncWithGoogleTasksAPI(false);
        await checkAndSendWeeklyAutoEmail();
      }
    }
  });
  return true;
}

function connectGoogleLive() {
  if (!initGoogleAuth()) return;
  tokenClient.requestAccessToken({ prompt: '' });
}

async function googleApiFetch(url, options = {}) {
  if (!googleAccessToken) throw new Error('Nicht mit Google verbunden.');
  const headers = {
    'Authorization': `Bearer ${googleAccessToken}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    googleAccessToken = null;
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    updateGoogleConnectedUI(false);
    throw new Error('Google-Sitzung abgelaufen. Bitte kurz neu verbinden.');
  }
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google API Fehler (${response.status}): ${errText}`);
  }
  return response.status === 204 ? null : response.json();
}

async function fetchAllGoogleTasks(listId) {
  let allItems = [];
  let pageToken = '';
  do {
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

async function ensureModuleTaskLists() {
  const listsData = await googleApiFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100');
  const existingLists = listsData.items || [];
  const listMap = {};
  existingLists.forEach(l => listMap[l.title.trim()] = l.id);
  for (const mod of appState.modules) {
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

/* =========================================================
   MONTAGS-BERECHNUNG & EINHEITLICHE BENENNUNG FÜR ALLE TASKS
   ========================================================= */
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

function buildExpectedWeekParentTitle(shortName, weekIdx) {
  const week = appState.weeks[weekIdx];
  const weekLabelOneLine = week.weekLabel.replace(/\n/g, ' ').trim();
  return `📅 [${shortName}] ${weekLabelOneLine}`;
}

function buildExpectedSubtaskTitle(shortName, weekIdx, rawText) {
  const week = appState.weeks[weekIdx];
  const weekShort = week ? week.weekLabel.split('\n')[0].trim() : 'Woche';
  const cleanText = rawText
    .replace(/^✅\s*/, '')
    .replace(new RegExp(`^\\[?${shortName}\\]?\\s*(\\([^)]*\\))?:?\\s*`, 'i'), '')
    .trim();
  return `${shortName} (${weekShort}): ${cleanText}`;
}

async function ensureWeekParentTask(listId, shortName, weekIdx, activeGoogleTasks = null) {
  const week = appState.weeks[weekIdx];
  if (!week) return null;
  week.googleParentTaskIds = week.googleParentTaskIds || {};

  const parsed = parseWeekDates(week.weekLabel);
  const sundayStr = parsed ? formatDateDE(parsed.weekSun) : '';
  const mondayStr = parsed ? formatDateDE(parsed.weekMon) : '';
  const mondayDueIso = getWeekMondayIso(weekIdx);
  const expectedTitle = buildExpectedWeekParentTitle(shortName, weekIdx);
  const expectedNotes = `Semesterwoche Oberaufgabe (${shortName}) – Wochenstart Montag, ${mondayStr} [WocheParent:${week.id}]`;

  if (!Array.isArray(activeGoogleTasks)) {
    const fetched = await fetchAllGoogleTasks(listId);
    activeGoogleTasks = fetched.filter(t => !t.deleted);
  }

  const weekLabelOneLine = week.weekLabel.replace(/\n/g, ' ').trim();

  // Sucht sowohl neue als auch alte Oberaufgaben (z.B. "📅 Woche X" oder alte "ModSim"-Oberaufgaben)
  const existingParent = activeGoogleTasks.find(t => {
    if (t.parent) return false;
    if (t.id && t.id === week.googleParentTaskIds[listId]) return true;
    if (t.notes && t.notes.includes(`[WocheParent:${week.id}]`)) return true;
    const tTitle = (t.title || '').trim().toLowerCase();
    if (tTitle === expectedTitle.toLowerCase()) return true;
    if (tTitle.replace(/^📅\s*/, '').trim() === weekLabelOneLine.toLowerCase()) return true;
    // Alte Oberaufgaben erkennen, die nur "ModSim" hießen und "Fällig bis Sonntag, den ..." in den Notizen hatten
    if (tTitle === shortName.toLowerCase() && t.notes && sundayStr && t.notes.includes(sundayStr)) {
      return true;
    }
    return false;
  });

  if (existingParent) {
    week.googleParentTaskIds[listId] = existingParent.id;
    const currentDueDay = existingParent.due ? existingParent.due.slice(0, 10) : '';
    const targetDueDay = mondayDueIso.slice(0, 10);
    if (existingParent.title !== expectedTitle || currentDueDay !== targetDueDay || !(existingParent.notes || '').includes(`[WocheParent:${week.id}]`)) {
      await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${existingParent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: expectedTitle,
          notes: expectedNotes,
          due: mondayDueIso
        })
      });
      existingParent.title = expectedTitle;
      existingParent.notes = expectedNotes;
      existingParent.due = mondayDueIso;
    }
    return existingParent.id;
  }

  // Oberaufgabe neu anlegen (am Montag der jeweiligen Woche!)
  const createdParent = await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({
      title: expectedTitle,
      notes: expectedNotes,
      due: mondayDueIso
    })
  });
  week.googleParentTaskIds[listId] = createdParent.id;
  saveState();
  return createdParent.id;
}

function buildTaskPayload(weekIdx, shortName, item) {
  const week = appState.weeks[weekIdx];
  const parsed = parseWeekDates(week.weekLabel);
  const mondayDueIso = getWeekMondayIso(weekIdx);
  const sundayStr = parsed ? formatDateDE(parsed.weekSun) : '';
  const mondayStr = parsed ? formatDateDE(parsed.weekMon) : '';

  // Falls item.dueDate noch auf dem alten Sonntag der Woche lag, automatisch auf den Montag korrigieren
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
    title: buildExpectedSubtaskTitle(shortName, weekIdx, item.text),
    notes: `Modul: ${shortName} | Woche: ${week.weekLabel.replace(/\n/g, ' ')} | Kalender-Montag: ${mondayStr}${sundayStr ? ` (Woche bis ${sundayStr})` : ''} [WocheID:${week.id}]`,
    due: dueIso,
    status: item.done ? 'completed' : 'needsAction'
  };
}

/* =========================================================
   ECHTZEIT-EINZELAKTIONEN (BEI KLICK / DRAG & DROP IN DER APP)
   ========================================================= */
async function pushSingleTaskToggleToGoogle(weekIdx, shortName, item) {
  try {
    if (!cachedListMap[shortName]) await ensureModuleTaskLists();
    const listId = cachedListMap[shortName];
    if (!listId) return;
    if (item.googleTaskId) {
      await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${item.googleTaskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: item.done ? 'completed' : 'needsAction' })
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
    if (!cachedListMap[shortName]) await ensureModuleTaskLists();
    const listId = cachedListMap[shortName];
    if (!listId) return;
    const parentTaskId = await ensureWeekParentTask(listId, shortName, weekIdx);
    const parentQuery = parentTaskId ? `?parent=${encodeURIComponent(parentTaskId)}` : '';
    const payload = buildTaskPayload(weekIdx, shortName, item);
    const created = await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks${parentQuery}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    item.googleTaskId = created.id;
    item.parentTaskId = parentTaskId;
    item.lastSyncedDone = item.done;
    item.lastSyncedText = item.text;
    if (item.syncCalendar !== false) {
      await createOrUpdateCalendarEvent(weekIdx, shortName, item);
    }
    saveState();
    showToast('☁️ Am Montag der Woche in Google Tasks & Kalender gespeichert!');
  } catch (e) {
    console.error(e);
  }
}

async function pushSingleTaskMoveOrEditToGoogle(weekIdx, shortName, item) {
  try {
    if (!cachedListMap[shortName]) await ensureModuleTaskLists();
    const listId = cachedListMap[shortName];
    if (!listId) return;
    const parentTaskId = await ensureWeekParentTask(listId, shortName, weekIdx);
    const payload = buildTaskPayload(weekIdx, shortName, item);

    if (item.googleTaskId) {
      await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${item.googleTaskId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      if (parentTaskId && item.parentTaskId !== parentTaskId) {
        try {
          await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${item.googleTaskId}/move?parent=${encodeURIComponent(parentTaskId)}`, {
            method: 'POST'
          });
          item.parentTaskId = parentTaskId;
        } catch (moveErr) {
          console.warn('Subtask-Move Hinweis:', moveErr);
        }
      }
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
    if (!cachedListMap[shortName]) await ensureModuleTaskLists();
    const listId = cachedListMap[shortName];
    if (!listId || !googleTaskId) return;
    await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${googleTaskId}`, {
      method: 'DELETE'
    });
  } catch (e) {
    console.warn('Task war in Google Tasks bereits gelöscht:', e);
  }
}

/* =========================================================
   VOLLSTÄNDIGE BIDIREKTIONALE SYNCHRONISATION & REPARATUR
   ========================================================= */
async function syncWithGoogleTasksAPI(silent = false) {
  if (!googleAccessToken) {
    if (!silent) connectGoogleLive();
    return;
  }
  if (isSyncInProgress) return;
  isSyncInProgress = true;
  if (!silent) showToast('🔄 Synchronisiere & vereinheitliche Aufgaben (Montags-Modus)...');

  try {
    const listMap = await ensureModuleTaskLists();

    if (Array.isArray(appState.deletedGoogleTaskIds) && appState.deletedGoogleTaskIds.length > 0) {
      for (const delEntry of appState.deletedGoogleTaskIds) {
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
      const shortName = mod.shortName;
      const listId = listMap[shortName];
      const allRawTasks = await fetchAllGoogleTasks(listId);
      const deletedTaskIds = new Set(allRawTasks.filter(t => t.deleted).map(t => t.id));
      const activeGoogleTasks = allRawTasks.filter(t => !t.deleted && (t.title || '').trim() !== '');

      for (const week of appState.weeks) {
        const items = week.cells[shortName] || [];
        week.cells[shortName] = items.filter(item => !(item.googleTaskId && deletedTaskIds.has(item.googleTaskId)));
      }

      const matchedGoogleTaskIds = new Set();
      const parentTaskIdToWeekIdx = {};

      // 1. Bestehende Wochen-Oberaufgaben (inkl. alter "ModSim"-Oberaufgaben) erkennen und auf neues Format + Montag migrieren
      for (let wIdx = 0; wIdx < appState.weeks.length; wIdx++) {
        const week = appState.weeks[wIdx];
        const parsed = parseWeekDates(week.weekLabel);
        const sundayStr = parsed ? formatDateDE(parsed.weekSun) : '';
        const weekLabelOneLine = week.weekLabel.replace(/\n/g, ' ').trim();
        const expectedParentTitle = buildExpectedWeekParentTitle(shortName, wIdx);

        const existingParent = activeGoogleTasks.find(t => {
          if (t.parent) return false;
          if (t.notes && t.notes.includes(`[WocheParent:${week.id}]`)) return true;
          const tTitle = (t.title || '').trim().toLowerCase();
          if (tTitle === expectedParentTitle.toLowerCase()) return true;
          if (tTitle.replace(/^📅\s*/, '').trim() === weekLabelOneLine.toLowerCase()) return true;
          if (tTitle === shortName.toLowerCase() && t.notes && sundayStr && t.notes.includes(sundayStr)) return true;
          return false;
        });

        if (existingParent) {
          const parentId = await ensureWeekParentTask(listId, shortName, wIdx, activeGoogleTasks);
          if (parentId) {
            matchedGoogleTaskIds.add(parentId);
            parentTaskIdToWeekIdx[parentId] = wIdx;
          }
        }
      }

      // 2. Alle Wochen-Aufgaben abgleichen, umbenennen und auf Montag datieren
      for (let wIdx = 0; wIdx < appState.weeks.length; wIdx++) {
        const week = appState.weeks[wIdx];
        const parsed = parseWeekDates(week.weekLabel);
        const sundayStr = parsed ? formatDateDE(parsed.weekSun) : '';
        const items = week.cells[shortName] || [];
        if (items.length === 0) continue;

        const parentTaskId = await ensureWeekParentTask(listId, shortName, wIdx, activeGoogleTasks);
        if (parentTaskId) {
          matchedGoogleTaskIds.add(parentTaskId);
          parentTaskIdToWeekIdx[parentTaskId] = wIdx;
        }

        for (const item of items) {
          const cleanText = item.text
            .replace(/^✅\s*/, '')
            .replace(new RegExp(`^\\[?${shortName}\\]?\\s*(\\([^)]*\\))?:?\\s*`, 'i'), '')
            .trim();
          const expectedSubTitle = buildExpectedSubtaskTitle(shortName, wIdx, cleanText);
          const legacyTitle = `${shortName}: ${cleanText}`;

          let matchedTask = item.googleTaskId
            ? activeGoogleTasks.find(t => t.id === item.googleTaskId && !matchedGoogleTaskIds.has(t.id))
            : null;

          if (!matchedTask) {
            matchedTask = activeGoogleTasks.find(t => {
              if (matchedGoogleTaskIds.has(t.id) || !t.title) return false;
              const tLower = t.title.trim().toLowerCase();
              const titleMatches =
                tLower === expectedSubTitle.toLowerCase() ||
                tLower === legacyTitle.toLowerCase() ||
                tLower === cleanText.toLowerCase();
              if (!titleMatches) return false;
              return (
                (t.notes && (t.notes.includes(sundayStr) || t.notes.includes(`[WocheID:${week.id}]`))) ||
                (parentTaskId && t.parent === parentTaskId)
              );
            });
          }

          if (!matchedTask) {
            const parentQuery = parentTaskId ? `?parent=${encodeURIComponent(parentTaskId)}` : '';
            const payload = buildTaskPayload(wIdx, shortName, item);
            const created = await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks${parentQuery}`, {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            item.googleTaskId = created.id;
            item.parentTaskId = parentTaskId;
            item.lastSyncedDone = item.done;
            item.lastSyncedText = item.text;
            matchedGoogleTaskIds.add(created.id);
          } else {
            matchedGoogleTaskIds.add(matchedTask.id);
            item.googleTaskId = matchedTask.id;

            const googleIsDone = (matchedTask.status === 'completed');
            if (typeof item.lastSyncedDone === 'boolean') {
              if (googleIsDone !== item.lastSyncedDone && item.done === item.lastSyncedDone) {
                item.done = googleIsDone;
                statusChangedFromGoogleCount++;
              }
            } else if (googleIsDone && !item.done) {
              item.done = true;
              statusChangedFromGoogleCount++;
            }

            const desiredPayload = buildTaskPayload(wIdx, shortName, item);
            const currentDueDay = matchedTask.due ? matchedTask.due.slice(0, 10) : '';
            const desiredDueDay = desiredPayload.due.slice(0, 10);
            const needsPatch =
              matchedTask.title !== desiredPayload.title ||
              currentDueDay !== desiredDueDay ||
              (matchedTask.status === 'completed') !== item.done;

            if (needsPatch) {
              await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${matchedTask.id}`, {
                method: 'PATCH',
                body: JSON.stringify(desiredPayload)
              });
            }

            // Falls die Aufgabe noch nicht unter der Wochen-Oberaufgabe hängt, darunter verschieben
            if (parentTaskId && matchedTask.parent !== parentTaskId) {
              try {
                await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${matchedTask.id}/move?parent=${encodeURIComponent(parentTaskId)}`, {
                  method: 'POST'
                });
                item.parentTaskId = parentTaskId;
              } catch (moveErr) {}
            }

            item.lastSyncedDone = item.done;
            item.lastSyncedText = item.text;
          }
        }
      }

      // 3. Neu in Google Tasks erstellte Aufgaben importieren
      for (const gTask of activeGoogleTasks) {
        if (matchedGoogleTaskIds.has(gTask.id)) continue;
        const rawTitle = (gTask.title || '').trim();
        if (rawTitle.toLowerCase() === shortName.toLowerCase()) continue;
        if (gTask.notes && gTask.notes.includes('[WocheParent:')) continue;
        if (/^📅\s*(\[[^\]]+\])?\s*woche/i.test(rawTitle)) continue;

        const cleanTaskText = rawTitle
          .replace(new RegExp(`^\\[?${shortName}\\]?\\s*(\\([^)]*\\))?:?\\s*`, 'i'), '')
          .trim();
        if (!cleanTaskText) continue;

        let targetWeekIdx = -1;
        if (gTask.parent && typeof parentTaskIdToWeekIdx[gTask.parent] === 'number') {
          targetWeekIdx = parentTaskIdToWeekIdx[gTask.parent];
        }
        if (targetWeekIdx === -1 && gTask.notes) {
          const idMatch = gTask.notes.match(/\[WocheID:(week_\d+)\]/);
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
            dueDate: getWeekMondayDateString(targetWeekIdx),
            googleTaskId: gTask.id,
            parentTaskId: gTask.parent || null,
            lastSyncedDone: gTask.status === 'completed',
            lastSyncedText: cleanTaskText
          });
          targetWeek.cells[shortName] = existingInCell;
          importedFromGoogleCount++;
        }
      }
    }

    if (localStorage.getItem('semesterplan_sync_calendar') !== 'false') {
      const calImported = await syncEventsFromGoogleCalendar();
      importedFromGoogleCount += calImported;
    }

    saveState();
    renderAll();

    if (!silent) {
      showToast(`✅ Sync fertig! Alle Tasks einheitlich benannt & auf Montag gesetzt.`);
    } else if (statusChangedFromGoogleCount > 0 || importedFromGoogleCount > 0) {
      showToast('☁️ Änderungen aus Google Tasks automatisch übernommen!');
    }
  } catch (error) {
    console.error(error);
    if (!silent) showToast('❌ Synchronisationsfehler: ' + error.message);
  } finally {
    isSyncInProgress = false;
  }
}

async function forceFullResync() {
  closeModal('googleSetupModal');
  await syncWithGoogleTasksAPI(false);
}

/* =========================================================
   GOOGLE KALENDER INTEGRATION (MONTAG DER JEWEILIGEN WOCHE)
   ========================================================= */
async function createOrUpdateCalendarEvent(weekIdx, shortName, item) {
  if (!googleAccessToken) return;
  try {
    const startDate = item.dueDate || getWeekMondayDateString(weekIdx);
    const startObj = new Date(startDate + 'T00:00:00');
    const endObj = new Date(startObj.getTime() + 24 * 60 * 60 * 1000);
    const endDate = endObj.toISOString().slice(0, 10);
    const weekShort = getWeekShortName(weekIdx);

    const eventPayload = {
      summary: `${shortName} (${weekShort}): ${item.text}`,
      description: `Semesterplan-Aufgabe für ${shortName} in ${weekShort} (automatisch am Montag der Woche eingetragen)`,
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
  } catch (e) {
    console.warn('Kalender-Event konnte nicht erstellt werden:', e);
  }
}

async function syncEventsFromGoogleCalendar() {
  if (!googleAccessToken) return 0;
  try {
    const timeMin = new Date(2026, 9, 15).toISOString();
    const timeMax = new Date(2027, 2, 1).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&maxResults=250`;
    const calData = await googleApiFetch(url);
    const events = calData.items || [];
    let importedCount = 0;

    for (const ev of events) {
      const summary = (ev.summary || '').trim();
      if (!summary) continue;
      let matchedMod = null;
      for (const mod of appState.modules) {
        const regex = new RegExp(`\\b(${mod.shortName}|${mod.fullName.split(':')[0]})\\b`, 'i');
        if (regex.test(summary)) {
          matchedMod = mod.shortName;
          break;
        }
      }
      if (!matchedMod && /testat/i.test(summary)) {
        matchedMod = 'CAD';
      }
      if (!matchedMod) continue;

      const rawDateStr = ev.start?.date || (ev.start?.dateTime ? ev.start.dateTime.slice(0, 10) : null);
      if (!rawDateStr) continue;
      const p = rawDateStr.split('-');
      const eventDate = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12, 0, 0);
      const weekIdx = findWeekIndexByDate(eventDate);
      if (weekIdx === -1) continue;

      const cleanTitle = summary
        .replace(new RegExp(`^\\[?${matchedMod}\\]?\\s*(\\([^)]*\\))?:?\\s*`, 'i'), '')
        .trim();
      const cellItems = appState.weeks[weekIdx].cells[matchedMod] || [];
      const exists = cellItems.some(i =>
        i.googleEventId === ev.id || i.text.toLowerCase() === cleanTitle.toLowerCase()
      );
      if (!exists) {
        cellItems.push({
          text: cleanTitle,
          done: false,
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
    console.warn('Kalender-Import übersprungen:', e);
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
  try {
    if (!silent) showToast('📨 Sende HTML-Briefing über Gmail API...');
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
    renderEmailPreview();

    if (!silent) {
      showToast('✅ Wochen-Briefing erfolgreich an dein Gmail-Postfach gesendet!');
    }
    return true;
  } catch (error) {
    console.error(error);
    if (!silent) {
      showToast('❌ Gmail-Versand fehlgeschlagen, öffne Standard-Mailprogramm...');
      triggerMailtoFallback();
    }
    return false;
  }
}

async function checkAndSendWeeklyAutoEmail() {
  if (!googleAccessToken) return;
  if (localStorage.getItem('semesterplan_auto_weekly_email') === 'false') return;

  const now = new Date();
  const currentWeekIdx = findWeekIndexByDate(now);
  const weekKey = currentWeekIdx !== -1 ? `week_${currentWeekIdx}` : `iso_${now.getFullYear()}_${now.getMonth()}_${Math.floor(now.getDate() / 7)}`;

  // Am Sonntag (Tag 0) bereits die Vorschau für die neue/kommende Woche senden, oder beim ersten Öffnen in der Woche
  const targetKey = now.getDay() === 0 ? `${weekKey}_sun_preview` : `${weekKey}_weekly`;
  const lastSentKey = localStorage.getItem('semesterplan_last_auto_email_week_key');

  if (lastSentKey === targetKey) return;

  const sentOk = await sendBriefingViaGmailAPI(true);
  if (sentOk) {
    localStorage.setItem('semesterplan_last_auto_email_week_key', targetKey);
    showToast('📩 Wöchentliches E-Mail-Briefing wurde automatisch an dein Gmail-Postfach gesendet!');
  }
}