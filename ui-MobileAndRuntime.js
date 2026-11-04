/* =========================================================
   UNTERPROGRAMM 3: LAUFZEIT, MITLAUFENDE TABELLEN-KOPFZEILE,
   AUTO-SCROLL BEIM DRAG & DROP, HANDY-MODI & SWIPE-SYNC (ui-runtime.js)
   ========================================================= */
var MOBILE_LAYOUT_KEY = 'semesterplan_mobile_layout_style';
var AUTO_BACKUP_DB_KEY = 'semesterplan_auto_offline_backup_v1';

var loadingDepth = loadingDepth || 0;
var currentActionAbortController = currentActionAbortController || null;
var actionCancelledFlag = actionCancelledFlag || false;
var toastTimer = toastTimer || null;

/* =========================================================
   1. AUTO-SCROLL BEIM DRAG & DROP IN WEIT ENTFERNTE WOCHEN
   ========================================================= */
var dragScrollVelocity = 0;
var dragScrollRafId = null;

function performContinuousDragScroll() {
  if (dragScrollVelocity !== 0) {
    window.scrollBy(0, dragScrollVelocity);
    dragScrollRafId = requestAnimationFrame(performContinuousDragScroll);
  } else {
    dragScrollRafId = null;
  }
}

function stopDragAutoScroll() {
  dragScrollVelocity = 0;
  if (dragScrollRafId) {
    cancelAnimationFrame(dragScrollRafId);
    dragScrollRafId = null;
  }
}

function initDragAutoScroll() {
  window.addEventListener('dragover', (e) => {
    const y = e.clientY;
    if (typeof y !== 'number' || y <= 0) return;
    const viewportH = window.innerHeight;
    const headerEl = document.getElementById('appMainHeader');
    const topBoundary = (headerEl ? headerEl.offsetHeight : 64) + 85;
    const bottomBoundary = viewportH - 95;

    if (y > bottomBoundary) {
      const intensity = Math.min(1, (y - bottomBoundary) / 85);
      dragScrollVelocity = Math.round(6 + intensity * 18);
      if (!dragScrollRafId) {
        dragScrollRafId = requestAnimationFrame(performContinuousDragScroll);
      }
    } else if (y < topBoundary) {
      const intensity = Math.min(1, (topBoundary - y) / 85);
      dragScrollVelocity = -Math.round(6 + intensity * 18);
      if (!dragScrollRafId) {
        dragScrollRafId = requestAnimationFrame(performContinuousDragScroll);
      }
    } else {
      stopDragAutoScroll();
    }
  }, { passive: true });

  window.addEventListener('dragend', stopDragAutoScroll, { passive: true });
  window.addEventListener('drop', stopDragAutoScroll, { passive: true });
}

/* =========================================================
   2. HANDY-MODUS (KOMPAKT VS. LISTE) & QUERFORMAT
   ========================================================= */
function detectAndApplyOrientationMode() {
  const isLandscapeViewport = window.innerWidth > window.innerHeight && window.innerWidth <= 1024;
  document.body.classList.toggle('auto-landscape-active', isLandscapeViewport);
  if (document.body.classList.contains('iphone-view-mode') && window.innerWidth <= 932) {
    document.body.classList.toggle('landscape-mode', isLandscapeViewport);
  }
  if (typeof updateStickyHeaderOffset === 'function') updateStickyHeaderOffset();
}

function applyMobileLayoutPreference(showFeedback = false) {
  const pref = localStorage.getItem(MOBILE_LAYOUT_KEY) || 'compact';
  const isCompact = (pref === 'compact');
  document.body.classList.toggle('mobile-compact-view', isCompact);
  document.body.classList.toggle('mobile-list-view', !isCompact);

  const headerBtn = document.getElementById('mobileHeaderLayoutBtn');
  if (headerBtn) {
    headerBtn.textContent = isCompact ? '📐 Kompakt ⇄' : '📋 Liste ⇄';
  }
  const drawerLabel = document.getElementById('drawerMobileLayoutLabel');
  if (drawerLabel) {
    drawerLabel.textContent = isCompact
      ? 'Handy-Ansicht: Kompakt aktiv (zu Liste wechseln)'
      : 'Handy-Ansicht: Liste aktiv (zu Kompakt wechseln)';
  }
  const bannerBtn = document.getElementById('mobileBannerLayoutBtn');
  if (bannerBtn) {
    bannerBtn.textContent = isCompact ? '📋 Zu Liste' : '📐 Zu Kompakt';
  }
  if (showFeedback && typeof showToast === 'function') {
    showToast(isCompact
      ? '📐 Kompakt-Ansicht aktiviert (mehrspaltig)'
      : '📋 Listen-Ansicht aktiviert (Modul-Übersicht oben bleibt kompakt)');
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
var touchStartY = 0;
var touchPullActive = false;

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
  if (typeof refreshDocsCache === 'function') await refreshDocsCache();
  if (typeof renderAll === 'function') renderAll();
  if (typeof isGoogleConnected === 'function' && isGoogleConnected()) {
    if (typeof syncWithGoogleTasksAPI === 'function') {
      await syncWithGoogleTasksAPI(silent);
    }
    if (typeof syncDocumentsWithGoogleDrive === 'function') {
      await syncDocumentsWithGoogleDrive(silent);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  detectAndApplyOrientationMode();
  applyMobileLayoutPreference(false);
  initTouchSwipeToSync();
  initDragAutoScroll();
  if (typeof updateStickyHeaderOffset === 'function') {
    setTimeout(updateStickyHeaderOffset, 100);
  }
  window.addEventListener('resize', detectAndApplyOrientationMode);
  window.addEventListener('orientationchange', () => {
    setTimeout(detectAndApplyOrientationMode, 120);
  });
});