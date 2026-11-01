/* =========================================================
   DIREKTE GOOGLE REST-API SYNCHRONISATION (google-sync.js)
   (Google Tasks + Google Kalender + Gmail Briefing)
   ========================================================= */
const DEFAULT_GOOGLE_CLIENT_ID = 'DEINE_CLIENT_ID_HIER_EINTRAGEN.apps.googleusercontent.com';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send'
].join(' ');

let googleAccessToken = null;
let tokenClient = null;
let cachedListMap = {};
let autoSyncInterval = null;

function getConfiguredClientId() {
  return localStorage.getItem('semesterplan_google_client_id') || DEFAULT_GOOGLE_CLIENT_ID;
}

function isGoogleConnected() {
  return !!googleAccessToken;
}

function initGoogleSyncSettingsUI() {
  const input = document.getElementById('clientIdInput');
  if (input) {
    const savedId = localStorage.getItem('semesterplan_google_client_id');
    input.value = savedId || (DEFAULT_GOOGLE_CLIENT_ID.startsWith('DEINE_') ? '' : DEFAULT_GOOGLE_CLIENT_ID);
  }
  const calCheck = document.getElementById('autoImportCalendarCheck');
  if (calCheck) {
    calCheck.checked = localStorage.getItem('semesterplan_sync_calendar') !== 'false';
  }
}

window.addEventListener('DOMContentLoaded', initGoogleSyncSettingsUI);

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
  if (!clientId || clientId.startsWith('GOCSPX-') || clientId.startsWith('DEINE_') || !clientId.includes('.apps.googleusercontent.com')) {
    openModal('googleSetupModal');
    showToast('⚠️ Bitte gültige OAuth Client-ID eintragen (endet auf .apps.googleusercontent.com).');
    return false;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GOOGLE_SCOPES,
    callback: async (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        googleAccessToken = tokenResponse.access_token;
        const badge = document.getElementById('connectionBadge');
        if (badge) {
          badge.textContent = '☁️ Live mit Google verbunden';
          badge.style.background = '#117864';
        }
        const pill = document.getElementById('syncStatusPill');
        if (pill) {
          pill.textContent = '⏰ Auto-Sync: Aktiv (Bidirektional)';
        }

        if (autoSyncInterval) clearInterval(autoSyncInterval);
        autoSyncInterval = setInterval(() => {
          if (googleAccessToken) syncWithGoogleTasksAPI(true);
        }, 60 * 60 * 1000);

        await syncWithGoogleTasksAPI();
      }
    }
  });
  return true;
}

function connectGoogleLive() {
  if (!initGoogleAuth()) return;
  tokenClient.requestAccessToken();
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
    throw new Error('Google-Sitzung abgelaufen. Bitte neu verbinden.');
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
   ECHTZEIT-EINZELAKTIONEN (BEI KLICK IN DER WEB-APP)
   ========================================================= */
function buildTaskPayload(weekIdx, shortName, item) {
  const week = appState.weeks[weekIdx];
  const parsed = parseWeekDates(week.weekLabel);

  let dueIso;
  if (item.dueDate) {
    const p = item.dueDate.split('-');
    dueIso = new Date(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12, 0, 0)).toISOString();
  } else if (parsed) {
    dueIso = new Date(Date.UTC(parsed.weekMon.getFullYear(), parsed.weekMon.getMonth(), parsed.weekMon.getDate(), 12, 0, 0)).toISOString();
  } else {
    dueIso = new Date().toISOString();
  }

  const sundayStr = parsed ? formatDateDE(parsed.weekSun) : '';
  const cleanText = item.text.replace(/^✅\s*/, '').trim();

  return {
    title: `${shortName}: ${cleanText}`,
    notes: sundayStr ? `Fällig bis Sonntag, den ${sundayStr} [WocheID:${week.id}]` : `[WocheID:${week.id}]`,
    due: dueIso,
    status: item.done ? 'completed' : 'needsAction'
  };
}

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

    const payload = buildTaskPayload(weekIdx, shortName, item);
    const created = await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    item.googleTaskId = created.id;
    item.lastSyncedDone = item.done;
    item.lastSyncedText = item.text;

    if (item.syncCalendar && item.dueDate) {
      await createOrUpdateCalendarEvent(shortName, item);
    }

    saveState();
    showToast('☁️ Aufgabe sofort in Google Tasks & Kalender gespeichert!');
  } catch (e) {
    console.error(e);
  }
}

async function pushSingleTaskEditToGoogle(weekIdx, shortName, item) {
  try {
    if (!cachedListMap[shortName]) await ensureModuleTaskLists();
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
      const created = await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      item.googleTaskId = created.id;
      item.lastSyncedDone = item.done;
      item.lastSyncedText = item.text;
    }

    if (item.syncCalendar && item.dueDate) {
      await createOrUpdateCalendarEvent(shortName, item);
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
   VOLLSTÄNDIGE BIDIREKTIONALE SYNCHRONISATION
   ========================================================= */
async function syncWithGoogleTasksAPI(silent = false) {
  if (!googleAccessToken) {
    connectGoogleLive();
    return;
  }

  if (!silent) showToast('🔄 Bidirektionale Synchronisation läuft...');

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

      for (let wIdx = 0; wIdx < appState.weeks.length; wIdx++) {
        const week = appState.weeks[wIdx];
        const parsed = parseWeekDates(week.weekLabel);
        const sundayStr = parsed ? formatDateDE(parsed.weekSun) : '';
        const items = week.cells[shortName] || [];

        for (const item of items) {
          const cleanText = item.text.replace(/^✅\s*/, '').trim();
          const expectedTitle = `${shortName}: ${cleanText}`;

          let matchedTask = item.googleTaskId
            ? activeGoogleTasks.find(t => t.id === item.googleTaskId && !matchedGoogleTaskIds.has(t.id))
            : null;

          if (!matchedTask) {
            matchedTask = activeGoogleTasks.find(t =>
              !matchedGoogleTaskIds.has(t.id) &&
              t.title &&
              (t.title.trim().toLowerCase() === expectedTitle.toLowerCase() ||
               t.title.trim().toLowerCase() === cleanText.toLowerCase()) &&
              t.notes && (t.notes.includes(sundayStr) || t.notes.includes(`[WocheID:${week.id}]`))
            );
          }

          if (!matchedTask && parsed) {
            matchedTask = activeGoogleTasks.find(t => {
              if (matchedGoogleTaskIds.has(t.id) || !t.title) return false;
              const titleMatches =
                t.title.trim().toLowerCase() === expectedTitle.toLowerCase() ||
                t.title.trim().toLowerCase() === cleanText.toLowerCase();
              if (!titleMatches) return false;
              if (!t.due) return true;
              const dueDt = new Date(t.due);
              return dueDt >= parsed.weekMon && dueDt <= parsed.weekSun;
            });
          }

          if (!matchedTask) {
            const payload = buildTaskPayload(wIdx, shortName, item);
            const created = await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`, {
              method: 'POST',
              body: JSON.stringify(payload)
            });
            item.googleTaskId = created.id;
            item.lastSyncedDone = item.done;
            item.lastSyncedText = item.text;
            matchedGoogleTaskIds.add(created.id);
          } else {
            matchedGoogleTaskIds.add(matchedTask.id);
            item.googleTaskId = matchedTask.id;

            const googleIsDone = (matchedTask.status === 'completed');

            if (typeof item.lastSyncedDone === 'boolean') {
              if (item.done !== item.lastSyncedDone && googleIsDone === item.lastSyncedDone) {
                await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${matchedTask.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: item.done ? 'completed' : 'needsAction' })
                });
              } else if (googleIsDone !== item.lastSyncedDone && item.done === item.lastSyncedDone) {
                item.done = googleIsDone;
              } else if (item.done !== googleIsDone) {
                item.done = googleIsDone;
              }
            } else {
              if (item.done && !googleIsDone) {
                await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${matchedTask.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ status: 'completed' })
                });
              } else if (!item.done && googleIsDone) {
                item.done = true;
              }
            }

            const strippedGoogleTitle = matchedTask.title.trim().replace(new RegExp(`^${shortName}:\\s*`, 'i'), '').trim();
            if (item.lastSyncedText && item.text === item.lastSyncedText && strippedGoogleTitle !== item.text) {
              item.text = strippedGoogleTitle;
            } else if (item.lastSyncedText && item.text !== item.lastSyncedText) {
              await googleApiFetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${matchedTask.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ title: `${shortName}: ${item.text}` })
              });
            }

            item.lastSyncedDone = item.done;
            item.lastSyncedText = item.text;
          }
        }
      }

      // Neue in Google Tasks angelegte Aufgaben in die Web-App importieren
      for (const gTask of activeGoogleTasks) {
        if (matchedGoogleTaskIds.has(gTask.id)) continue;

        const rawTitle = (gTask.title || '').trim();
        if (rawTitle.toLowerCase() === shortName.toLowerCase()) continue;

        const cleanTaskText = rawTitle.replace(new RegExp(`^${shortName}:\\s*`, 'i'), '').trim();
        if (!cleanTaskText) continue;

        let targetWeekIdx = -1;
        if (gTask.notes) {
          const idMatch = gTask.notes.match(/\[WocheID:(week_\d+)\]/);
          if (idMatch) {
            targetWeekIdx = appState.weeks.findIndex(w => w.id === idMatch[1]);
          }
        }

        if (targetWeekIdx === -1 && gTask.due) {
          const dueDateObj = new Date(gTask.due);
          targetWeekIdx = findWeekIndexByDate(dueDateObj);
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
            dueDate: gTask.due ? gTask.due.slice(0, 10) : null,
            googleTaskId: gTask.id,
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
      if (importedFromGoogleCount > 0) {
        showToast(`✅ Sync fertig! (${importedFromGoogleCount} neue Aufgaben aus Google importiert)`);
      } else {
        showToast('✅ Web-App, Google Tasks & Kalender sind 100 % synchron!');
      }
    }
  } catch (error) {
    console.error(error);
    showToast('❌ Synchronisationsfehler: ' + error.message);
  }
}

async function forceFullResync() {
  closeModal('googleSetupModal');
  await syncWithGoogleTasksAPI(false);
}

/* =========================================================
   GOOGLE KALENDER INTEGRATION (LESEN & SCHREIBEN)
   ========================================================= */
async function createOrUpdateCalendarEvent(shortName, item) {
  if (!googleAccessToken || !item.dueDate) return;
  try {
    const startDate = item.dueDate;
    const startObj = new Date(startDate + 'T00:00:00');
    const endObj = new Date(startObj.getTime() + 24 * 60 * 60 * 1000);
    const endDate = endObj.toISOString().slice(0, 10);

    const eventPayload = {
      summary: `${shortName}: ${item.text}`,
      description: 'Automatisch synchronisiert aus deiner Semesterplan Web-App',
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

      const cleanTitle = summary.replace(new RegExp(`^\\[?${matchedMod}\\]?:?\\s*`, 'i'), '').trim();
      const cellItems = appState.weeks[weekIdx].cells[matchedMod] || [];

      const exists = cellItems.some(i =>
        i.googleEventId === ev.id || i.text.toLowerCase() === cleanTitle.toLowerCase()
      );

      if (!exists) {
        cellItems.push({
          text: cleanTitle,
          done: false,
          dueDate: rawDateStr,
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
   DIREKTER HTML-E-MAIL-VERSAND ÜBER DIE GMAIL REST API
   ========================================================= */
async function sendBriefingViaGmailAPI() {
  if (!googleAccessToken) {
    connectGoogleLive();
    return;
  }

  try {
    showToast('📨 Sende HTML-Briefing über Gmail API...');
    const { subject, htmlBody } = buildEmailHtmlObject();

    const mimeLines = [
      `To: me`,
      `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlBody
    ];

    const rawMime = mimeLines.join('\r\n');
    const base64UrlEncoded = btoa(unescape(encodeURIComponent(rawMime)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await googleApiFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: base64UrlEncoded })
    });

    showToast('✅ Wochen-Briefing erfolgreich an dein Gmail-Postfach gesendet!');
  } catch (error) {
    console.error(error);
    showToast('❌ Gmail-Versand fehlgeschlagen, öffne Standard-Mailprogramm...');
    triggerMailtoFallback();
  }
}