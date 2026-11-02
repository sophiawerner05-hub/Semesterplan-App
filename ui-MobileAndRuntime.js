/* =========================================================
   UNTERPROGRAMM: LAUFZEIT, ABBRECHEN-STEUERUNG, HANDY-MODI,
   SWIPE-SYNC & HINTERGRUND-OFFLINE-BACKUP (ui-MobileAndRuntime.js)
   ========================================================= */

const MOBILE_LAYOUT_KEY = 'semesterplan_mobile_layout_style'; // 'compact' | 'list'
const AUTO_BACKUP_DB_KEY = 'semesterplan_auto_offline_backup_v1';

let loadingDepth = 0;
let currentActionAbortController = null;
let actionCancelledFlag = false;

/* =========================================================
   1. LADEKREIS & SOFORTIGES ABBRECHEN LAUFENDER AKTIONEN
   ========================================================= */
function startCancelableOperation(message = 'Lädt...') {
  actionCancelledFlag = false;
  if (!currentActionAbortController || currentActionAbortController.signal.aborted) {
    currentActionAbortController = new AbortController();
  }
  showLoading(message);
  return currentActionAbortController.signal;
}

function getActiveAbortSignal() {
  if (!currentActionAbortController) {
    currentActionAbortController = new AbortController();
  }
  return currentActionAbortController.signal;
}

function isCurrentActionCancelled() {
  return actionCancelledFlag || (currentActionAbortController && currentActionAbortController.signal.aborted);
}

function showLoading(message = 'Lädt...') {
  loadingDepth++;
  const el = document.getElementById('globalLoadingIndicator');
  const txt = document.getElementById('globalLoadingText');
  if (txt) txt.textContent = message;
  if (el) el.classList.add('active');
}

function hideLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth === 0) {
    document.getElementById('globalLoadingIndicator')?.classList.remove('active');
  }
}

function forceHideLoading() {
  loadingDepth = 0;
  document.getElementById('globalLoadingIndicator')?.classList.remove('active');
}

function cancelCurrentRunningAction() {
  actionCancelledFlag = true;
  if (currentActionAbortController) {
    try {
      currentActionAbortController.abort();
    } catch (e) {}
  }
  currentActionAbortController = new AbortController();
  if (typeof isSyncInProgress !== 'undefined') {
    isSyncInProgress = false;
  }
  if (typeof isDriveSyncInProgress !== 'undefined') {
    isDriveSyncInProgress = false;
  }
  forceHideLoading();
  if (typeof showToast === 'function') {
    showToast('⏹️ Laufende Aktion wurde abgebrochen.');
  }
}

/* =========================================================
   2. AUTOMATISCHE QUERFORMAT-ERKENNUNG (HANDY & IPAD)
      UND KOMPAKT- VS. LISTEN-ANSICHT AUF DEM HANDY
   ========================================================= */
function detectAndApplyOrientationMode() {
  const isLandscapeViewport = window.innerWidth > window.innerHeight && window.innerWidth <= 1024;
  document.body.classList.toggle('auto-landscape-active', isLandscapeViewport);
  if (document.body.classList.contains('iphone-view-mode') && window.innerWidth <= 932) {
    document.body.classList.toggle('landscape-mode', isLandscapeViewport);
  }
}

function applyMobileLayoutPreference(showFeedback = false) {
  const pref = localStorage.getItem(MOBILE_LAYOUT_KEY) || 'compact';
  const isCompact = (pref === 'compact');

  document.body.classList.toggle('mobile-compact-view', isCompact);
  document.body.classList.toggle('mobile-list-view', !isCompact);

  const headerBtn = document.getElementById('mobileHeaderLayoutBtn');
  if (headerBtn) {
    headerBtn.textContent = isCompact ? '📐 Kompakt' : '📋 Liste';
  }
  const drawerLabel = document.getElementById('drawerMobileLayoutLabel');
  if (drawerLabel) {
    drawerLabel.textContent = isCompact
      ? 'Handy-Ansicht: Kompakt aktiv (zu Liste wechseln)'
      : 'Handy-Ansicht: Liste aktiv (zu Kompakt wechseln)';
  }
  const bannerBtn = document.getElementById('mobileBannerLayoutBtn');
  if (bannerBtn) {
    bannerBtn.textContent = isCompact ? '📋 Listen-Ansicht' : '📐 Kompakt-Ansicht';
  }

  if (showFeedback && typeof showToast === 'function') {
    showToast(isCompact
      ? '📐 Kompakt-Ansicht aktiviert (mehrspaltig wie im Querformat)'
      : '📋 Listen-Ansicht aktiviert (untereinander)');
  }
}

function toggleMobileLayoutStyle() {
  const current = localStorage.getItem(MOBILE_LAYOUT_KEY) || 'compact';
  const next = current === 'compact' ? 'list' : 'compact';
  localStorage.setItem(MOBILE_LAYOUT_KEY, next);
  applyMobileLayoutPreference(true);
}

/* =========================================================
   3. SWIPE-NEULADEN & SYNCHRONISIERUNG AUF IPAD & HANDY
   ========================================================= */
let touchStartY = 0;
let touchPullActive = false;

function initTouchSwipeToSync() {
  window.addEventListener('touchstart', (e) => {
    if (window.scrollY <= 5 && e.touches && e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      touchPullActive = true;
    } else {
      touchPullActive = false;
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!touchPullActive || !e.touches || e.touches.length !== 1) return;
    const deltaY = e.touches[0].clientY - touchStartY;
    const indicator = document.getElementById('swipeSyncIndicator');
    if (deltaY > 65 && window.scrollY <= 2) {
      indicator?.classList.add('pulling');
    } else {
      indicator?.classList.remove('pulling');
    }
  }, { passive: true });

  window.addEventListener('touchend', async () => {
    const indicator = document.getElementById('swipeSyncIndicator');
    if (indicator && indicator.classList.contains('pulling')) {
      indicator.classList.remove('pulling');
      await triggerSwipeReloadAndSync();
    }
    touchPullActive = false;
  }, { passive: true });

  // Zusätzlich beim Zurückkehren aus dem iPadOS / iOS App-Switcher automatisch synchronisieren
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      triggerSwipeReloadAndSync(true);
    }
  });
}

async function triggerSwipeReloadAndSync(silent = false) {
  if (!silent && typeof showToast === 'function') {
    showToast('🔄 Aktualisiere App & synchronisiere mit Google / Drive...');
  }
  if (typeof refreshDocsCache === 'function') {
    await refreshDocsCache();
  }
  if (typeof renderAll === 'function') {
    renderAll();
  }
  if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
    if (typeof syncWithGoogleTasksAPI === 'function') {
      await syncWithGoogleTasksAPI(silent);
    }
    if (typeof syncDocumentsWithGoogleDrive === 'function') {
      await syncDocumentsWithGoogleDrive(silent);
    }
  }
}

/* =========================================================
   4. AUTOMATISCHES HINTERGRUND-BACKUP (FÜR OFFLINE-MODUS)
   ========================================================= */
function saveSilentBackgroundBackup(stateObj) {
  if (!stateObj) return;
  try {
    const payload = {
      timestamp: Date.now(),
      state: stateObj
    };
    localStorage.setItem(AUTO_BACKUP_DB_KEY, JSON.stringify(payload));
  } catch (e) {
    // Ignoriere Quota-Warnung im stillen Hintergrundmodus
  }
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

window.addEventListener('DOMContentLoaded', () => {
  detectAndApplyOrientationMode();
  applyMobileLayoutPreference(false);
  initTouchSwipeToSync();

  window.addEventListener('resize', detectAndApplyOrientationMode);
  window.addEventListener('orientationchange', () => {
    setTimeout(detectAndApplyOrientationMode, 120);
  });
  if (window.matchMedia) {
    const mq = window.matchMedia('(orientation: landscape)');
    if (mq.addEventListener) {
      mq.addEventListener('change', detectAndApplyOrientationMode);
    }
  }
});