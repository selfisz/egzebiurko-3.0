/* ============================================================
   Egzebiurko 3.0 — app.js
   SharedStore + Router + StatusBar
   ============================================================ */

'use strict';

/* ─── SHARED STORE ─────────────────────────────────────────── */
const SharedStore = (() => {
  const PREFIX = 'egze3_';
  const listeners = {};

  function key(k) { return PREFIX + k; }

  function get(k, fallback = null) {
    try {
      const raw = localStorage.getItem(key(k));
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  function set(k, val) {
    try {
      localStorage.setItem(key(k), JSON.stringify(val));
      emit(k, val);
    } catch (e) { console.warn('[SharedStore] set failed:', k, e); }
  }

  function remove(k) {
    localStorage.removeItem(key(k));
    emit(k, null);
  }

  function on(k, cb) {
    if (!listeners[k]) listeners[k] = [];
    listeners[k].push(cb);
    return () => { listeners[k] = listeners[k].filter(f => f !== cb); };
  }

  function emit(k, val) {
    (listeners[k] || []).forEach(cb => { try { cb(val, k); } catch (e) {} });
    (listeners['*'] || []).forEach(cb => { try { cb(val, k); } catch (e) {} });
  }

  // Well-known keys
  const KEYS = {
    SPRAWY:        'sprawy',        // Lista PESEL/NIP z Arkusza
    OGNIVO:        'ognivo',        // { [pesel]: { count, banks[], ts } }
    WRO_STATUS:    'wro_status',    // { [id]: 'analyzed'|'pending' }
    WRO_CART:      'wro_cart',      // Set→Array of IDs
    PREFS:         'prefs',         // Ustawienia aplikacji
  };

  return { get, set, remove, on, KEYS };
})();


/* ─── ROUTER ────────────────────────────────────────────────── */
const Router = (() => {
  let current = null;
  let modules = {};
  let pendingParams = {};

  function register(id, mod) {
    modules[id] = mod;
  }

  function navigate(id, params = {}) {
    if (current === id && Object.keys(params).length === 0) return;

    // Hide all panels
    document.querySelectorAll('.module-panel').forEach(el => el.classList.add('hidden'));

    // Update nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.module === id);
    });

    // Show target
    const panel = document.getElementById('panel-' + id);
    if (panel) panel.classList.remove('hidden');

    current = id;
    pendingParams = params;

    // Init module if first time
    if (modules[id]) {
      try { modules[id].activate(params); }
      catch (e) { console.error('[Router] activate error', id, e); }
    }

    // Save last view
    try { localStorage.setItem('egze3_last_module', id); } catch {}
  }

  function getCurrent() { return current; }
  function getPendingParams() { return pendingParams; }

  return { register, navigate, getCurrent, getPendingParams };
})();


/* ─── STATUS BAR ────────────────────────────────────────────── */
const StatusBar = (() => {
  function refresh() {
    const ognivoData = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
    const wroCart    = SharedStore.get(SharedStore.KEYS.WRO_CART, []);
    const wroStatus  = SharedStore.get(SharedStore.KEYS.WRO_STATUS, {});
    const sprawy     = SharedStore.get(SharedStore.KEYS.SPRAWY, []);

    const ognivoCount = Object.keys(ognivoData).length;
    const wroCartCount = wroCart.length;
    const wroAnalyzed  = Object.values(wroStatus).filter(v => v === 'analyzed').length;

    const el = document.getElementById('global-statusbar');
    if (!el) return;
    el.innerHTML = `
      <span class="sb-item" title="Osoby z Arkusza w SharedStore">
        <span class="sb-icon">📋</span>
        <strong>${sprawy.length}</strong> spraw
      </span>
      <span class="sb-sep">·</span>
      <span class="sb-item" title="Osoby z wynikami OGNIVO">
        <span class="sb-icon">🏦</span>
        <strong>${ognivoCount}</strong> wyników OGNIVO
      </span>
      <span class="sb-sep">·</span>
      <span class="sb-item" title="W koszyku matrycy WRO">
        <span class="sb-icon">🛒</span>
        <strong>${wroCartCount}</strong> w koszyku WRO
      </span>
      <span class="sb-sep">·</span>
      <span class="sb-item" title="Załatwionych w WRO">
        <span class="sb-icon">✅</span>
        <strong>${wroAnalyzed}</strong> załatwionych
      </span>
    `;
  }

  function init() {
    refresh();
    SharedStore.on('*', refresh);
  }

  return { init, refresh };
})();


/* ─── TOAST ─────────────────────────────────────────────────── */
function showToast(msg, type = 'info', duration = 2800) {
  const el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `app-toast show toast-${type}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), duration);
}

window.SharedStore = SharedStore;
window.Router      = Router;
window.StatusBar   = StatusBar;
window.showToast   = showToast;
