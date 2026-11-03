/* =========================================================
   UNTERPROGRAMM 3: LAUFZEIT, MITLAUFENDE TABELLEN-KOPFZEILE,
   AUTO-SCROLL BEIM DRAG & DROP, HANDY-MODI & SWIPE-SYNC (ui-runtime.js)
   ========================================================= */
const MOBILE_LAYOUT_KEY = 'semesterplan_mobile_layout_style'; // 'compact' | 'list'

let loadingDepth = 0;
let currentActionAbortController = null;
let actionCancelledFlag = false;
let toastTimer = null;

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

function updateLoadingText(message) {
  const txt = document.getElementById('globalLoadingText');
  if (txt && message) txt.textContent = message;
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
  if (typeof isSyncInProgress !== 'undefined') isSyncInProgress = false;
  if (typeof isDriveSyncInProgress !== 'undefined') isDriveSyncInProgress = false;
  forceHideLoading();
  showToast('⏹️ Laufende Aktion wurde abgebrochen.');
}

/* =========================================================
   2. DYNAMISCHE HÖHENBERECHNUNG FÜR MITLAUFENDE MODULNAMEN
      IN DER TABELLEN-ÜBERSICHT (STICKY TABLE HEADER)
   ========================================================= */
function updateStickyHeaderOffset() {
  const headerEl = document.getElementById('appMainHeader') || document.querySelector('header');
  if (!headerEl) return;
  const rect = headerEl.getBoundingClientRect();
  const offsetPx = Math.max(48, Math.round(rect.height));
  document.documentElement.style.setProperty('--sticky-header-offset', `${offsetPx}px`);
}

/* =========================================================
   3. AUTOMATISCHES RUNTER- & HOCHSCROLLEN BEIM DRAG & DROP
      VON DATEIEN, ORDNERN ODER AUFGABEN IN WEIT ENTFERNTE WOCHEN
   ========================================================= */
let dragScrollVelocity = 0;
let dragScrollRafId = null;

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
      // Je näher am unteren Bildschirmrand, desto schneller scrollt die Tabelle nach unten
      const intensity = Math.min(1, (y - bottomBoundary) / 85);
      dragScrollVelocity = Math.round(6 + intensity * 18);
      if (!dragScrollRafId) {
        dragScrollRafId = requestAnimationFrame(performContinuousDragScroll);
      }
    } else if (y < topBoundary) {
      // Nahe am oberen Rand -> nach oben scrollen
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
   4. MITLAUFENDER HANDY-MODUS (KOMPAKT VS. LISTE) & QUERFORMAT
   ========================================================= */
function detectAndApplyOrientationMode() {
  const isLandscapeViewport = window.innerWidth > window.innerHeight && window.innerWidth <= 1024;
  document.body.classList.toggle('auto-landscape-active', isLandscapeViewport);
  if (document.body.classList.contains('iphone-view-mode') && window.innerWidth <= 932) {
    document.body.classList.toggle('landscape-mode', isLandscapeViewport);
  }
  updateStickyHeaderOffset();
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
  if (showFeedback) {
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

function toggleIphoneView() {
  const isIphone = document.body.classList.toggle('iphone-view-mode');
  if (!isIphone) document.body.classList.remove('landscape-mode');
  localStorage.setItem('semesterplan_iphone_view', isIphone ? 'true' : 'false');
  updateIphoneBtnState();
  updateStickyHeaderOffset();
  showToast(isIphone ? '📱 Handy-Ansicht aktiviert' : '💻 Desktop-Tabellenansicht aktiviert');
}

function toggleLandscapePreview() {
  if (!document.body.classList.contains('iphone-view-mode')) {
    document.body.classList.add('iphone-view-mode');
  }
  const isLand = document.body.classList.toggle('landscape-mode');
  updateIphoneBtnState();
  updateStickyHeaderOffset();
  showToast(isLand ? '🔄 Handy-Querformat (Landscape) aktiviert!' : '📱 Handy-Hochformat (Portrait) aktiviert!');
}

function updateIphoneBtnState() {
  const btn = document.getElementById('iphoneViewBtn');
  const landBtn = document.getElementById('landscapeToggleBtn');
  const isIphone = document.body.classList.contains('iphone-view-mode');
  const isLand = document.body.classList.contains('landscape-mode');
  if (btn) btn.textContent = isIphone ? '💻 Desktop-Ansicht' : '📱 Handy-Ansicht';
  if (landBtn) {
    landBtn.classList.toggle('hidden', !isIphone);
    landBtn.textContent = isLand ? '📱 Hochformat' : '🔄 Querformat';
  }
}

/* =========================================================
   5. SEITENMENÜ (DRAWER), FARBSCHEMATA & MODALS
   ========================================================= */
function toggleSideDrawer() {
  const drawer = document.getElementById('sideMenuDrawer');
  const backdrop = document.getElementById('sideDrawerBackdrop');
  if (!drawer || !backdrop) return;
  const isOpen = drawer.classList.toggle('open');
  backdrop.classList.toggle('open', isOpen);
}

function closeSideDrawer() {
  document.getElementById('sideMenuDrawer')?.classList.remove('open');
  document.getElementById('sideDrawerBackdrop')?.classList.remove('open');
}

function buildThemeMenuUI() {
  const html = Object.entries(THEMES).map(([key, t]) => `
    <button type="button" class="theme-option-item" data-theme-key="${key}" onclick="changeTheme('${key}', true)">
      <span class="theme-preview-dots">
        <span class="dot" style="background:${t.colors[0]}"></span>
        <span class="dot" style="background:${t.colors[1]}"></span>
        <span class="dot" style="background:${t.colors[2]}"></span>
      </span>
      <span class="theme-option-label">${escapeHtml(t.label)}</span>
    </button>
  `).join('');
  const menu = document.getElementById('themeMenu');
  if (menu) menu.innerHTML = html;
  const drawerList = document.getElementById('drawerThemeList');
  if (drawerList) drawerList.innerHTML = html;
}

function toggleThemeMenu(event) {
  event.stopPropagation();
  document.getElementById('themeMenu')?.classList.toggle('hidden');
}

function changeTheme(themeName, showNotification = true) {
  const themeKey = THEMES[themeName] ? themeName : 'rose';
  const themeObj = THEMES[themeKey];
  document.documentElement.setAttribute('data-theme', themeKey);
  localStorage.setItem(THEME_KEY, themeKey);

  const dotsEl = document.getElementById('currentThemeDots');
  const labelEl = document.getElementById('currentThemeLabel');
  if (dotsEl) {
    dotsEl.innerHTML = `
      <span class="dot" style="background:${themeObj.colors[0]}"></span>
      <span class="dot" style="background:${themeObj.colors[1]}"></span>
      <span class="dot" style="background:${themeObj.colors[2]}"></span>
    `;
  }
  if (labelEl) labelEl.textContent = themeObj.label;

  document.querySelectorAll('.theme-option-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-theme-key') === themeKey);
  });
  document.getElementById('themeMenu')?.classList.add('hidden');
  if (typeof renderEmailPreview === 'function' && currentTab === 'email') {
    renderEmailPreview();
  }
  if (showNotification) {
    showToast(`🎨 Farbdesign „${themeObj.label}“ aktiviert!`);
  }
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* =========================================================
   6. SWIPE-NEULADEN & SYNCHRONISIERUNG AUF IPAD & HANDY
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

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      triggerSwipeReloadAndSync(true);
    }
  });
}

async function triggerSwipeReloadAndSync(silent = false) {
  if (!silent) {
    showToast('🔄 Aktualisiere App & synchronisiere mit Google / Drive...');
  }
  await refreshDocsCache();
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
  setTimeout(updateStickyHeaderOffset, 100);
  window.addEventListener('resize', detectAndApplyOrientationMode);
  window.addEventListener('orientationchange', () => {
    setTimeout(detectAndApplyOrientationMode, 120);
  });
});