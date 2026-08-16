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


/* ─── WORKSPACE TABS (otwarte moduły jak w przeglądarce) ───── */
const WorkspaceTabs = (() => {
  const KEY = 'egze3_workspace_tabs';
  const LABELS = {
    arkusz: 'Arkusz',
    zobowiazani: 'Szafka teczek',
    ognivo: 'OGNIVO',
    wro: 'Analityka WRO',
    zakladka1: 'Akumulator',
    zakladka2: 'Rozliczenia',
    zakladka3: 'Przelew',
    zakladka4: 'Balanser',
  };

  let tabs = [];
  let menuEl = null;

  function labelOf(id) {
    const btn = document.querySelector(`.nav-btn[data-module="${id}"]`);
    const fromNav = btn && btn.querySelector('.nav-label');
    return (fromNav && fromNav.textContent.trim()) || LABELS[id] || id;
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      tabs = Array.isArray(raw) ? raw.filter(id => LABELS[id]) : [];
    } catch { tabs = []; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(tabs)); } catch {}
  }

  function isOpen(id) { return tabs.includes(id); }

  function open(id) {
    if (!LABELS[id]) return;
    if (!tabs.includes(id)) tabs.push(id);
    save();
    render();
    syncNavMarks();
  }

  function close(id) {
    const idx = tabs.indexOf(id);
    if (idx < 0) return;
    tabs.splice(idx, 1);
    save();
    render();
    syncNavMarks();
    if (Router.getCurrent() === id) {
      const next = tabs[Math.min(idx, tabs.length - 1)] || 'arkusz';
      Router.navigate(next);
    }
  }

  function closeOthers(id) {
    if (!LABELS[id]) return;
    tabs = [id];
    save();
    render();
    syncNavMarks();
    if (Router.getCurrent() !== id) Router.navigate(id);
  }

  function closeAll() {
    tabs = [];
    save();
    render();
    syncNavMarks();
    if (Router.getCurrent() !== 'arkusz') Router.navigate('arkusz');
  }

  function syncNavMarks() {
    document.querySelectorAll('.nav-btn[data-module]').forEach(btn => {
      btn.classList.toggle('is-open', tabs.includes(btn.dataset.module));
    });
  }

  function hideMenu() {
    if (menuEl) menuEl.classList.remove('open');
  }

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.id = 'workspace-ctx-menu';
    menuEl.className = 'workspace-ctx';
    menuEl.setAttribute('role', 'menu');
    document.body.appendChild(menuEl);
    document.addEventListener('click', hideMenu);
    document.addEventListener('scroll', hideMenu, true);
    window.addEventListener('resize', hideMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
    return menuEl;
  }

  function placeMenu(menu, e) {
    menu.classList.add('open');
    const pad = 8;
    const w = menu.offsetWidth || 220;
    const h = menu.offsetHeight || 180;
    let x = e.clientX;
    let y = e.clientY;
    if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
    if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
    menu.style.left = Math.max(pad, x) + 'px';
    menu.style.top = Math.max(pad, y) + 'px';
  }

  function buildMenu(title, items) {
    const menu = ensureMenu();
    menu.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'workspace-ctx-h';
    h.textContent = title;
    menu.appendChild(h);
    items.forEach(it => {
      if (it === 'sep') {
        const sep = document.createElement('div');
        sep.className = 'workspace-ctx-sep';
        menu.appendChild(sep);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      if (it.danger) b.classList.add('danger');
      b.onclick = () => {
        hideMenu();
        try { it.action(); } catch (err) { console.error(err); }
      };
      menu.appendChild(b);
    });
    return menu;
  }

  function openNavMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    if (!LABELS[id]) return;
    const open = isOpen(id);
    const items = [
      { label: open ? 'Przejdź do karty' : 'Otwórz kartę', action: () => Router.navigate(id) },
    ];
    if (open) {
      items.push({ label: 'Zamknij kartę', action: () => close(id), danger: true });
      items.push('sep');
      items.push({ label: 'Zamknij inne karty', action: () => closeOthers(id) });
      items.push({ label: 'Zamknij wszystkie', action: () => closeAll(), danger: true });
    } else {
      items.push({
        label: 'Otwórz bez przełączania',
        action: () => { open(id); if (typeof showToast === 'function') showToast('Otwarto: ' + labelOf(id), 'info', 1600); },
      });
    }
    const menu = buildMenu(labelOf(id), items);
    placeMenu(menu, e);
  }

  function openTabMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const items = [
      { label: 'Aktywuj', action: () => Router.navigate(id) },
      { label: 'Zamknij kartę', action: () => close(id), danger: true },
      'sep',
      { label: 'Zamknij inne karty', action: () => closeOthers(id) },
      { label: 'Zamknij wszystkie', action: () => closeAll(), danger: true },
    ];
    const menu = buildMenu(labelOf(id), items);
    placeMenu(menu, e);
  }

  function render() {
    const el = document.getElementById('workspace-tabs');
    if (!el) return;
    if (!tabs.length) {
      el.classList.add('empty');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('empty');
    const cur = Router.getCurrent();
    el.innerHTML = tabs.map(id => `
      <button type="button" class="ws-tab ${id === cur ? 'active' : ''}" data-module="${id}"
        title="${labelOf(id)}"
        onclick="Router.navigate('${id}')"
        oncontextmenu="WorkspaceTabs.openTabMenu(event, '${id}')"
        onauxclick="if(event.button===1){event.preventDefault();WorkspaceTabs.close('${id}')}">
        <span class="ws-tab-label">${labelOf(id)}</span>
        <span class="ws-tab-x" onclick="event.stopPropagation();WorkspaceTabs.close('${id}')" title="Zamknij">×</span>
      </button>
    `).join('');
  }

  function onNavigate(id) {
    open(id);
  }

  function init() {
    load();
    document.querySelectorAll('.nav-btn[data-module]').forEach(btn => {
      btn.addEventListener('contextmenu', (e) => openNavMenu(e, btn.dataset.module));
    });
    render();
    syncNavMarks();
  }

  return { init, open, close, closeOthers, closeAll, onNavigate, render, openTabMenu, openNavMenu, isOpen };
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
    if (current === id && Object.keys(params).length === 0) {
      if (window.WorkspaceTabs) WorkspaceTabs.onNavigate(id);
      return;
    }

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

    if (window.WorkspaceTabs) WorkspaceTabs.onNavigate(id);
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

window.SharedStore    = SharedStore;
window.Router         = Router;
window.WorkspaceTabs  = WorkspaceTabs;
window.StatusBar      = StatusBar;
window.showToast      = showToast;


/* ─── PEŁNY PAKIET EGZEBIURKO (zapisz / wczytaj) ───────────── */
const EgzeBundle = (() => {
  const BUNDLE_VERSION = 1;
  const ARKUSZ_KEY = 'ots_autosave_v1';
  const WRO_DB_KEY = 'egze3_wro_database';
  const SZAFKA_KEYS = ['egze3_desk_pins', 'egze3_archive_ids', 'egze3_open_tabs', 'egze3_zob_file_source'];
  const PREF_KEYS = ['egze3_last_module', 'egze3_dark', 'egze3_workspace_tabs'];
  const OTS_PREF_KEYS = ['ots_copy_mode_v1', 'ots_work_mode_v1', 'ots_view_prefs_v1', 'ots_schemas_v1'];

  function lsGetRaw(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  }
  function lsSetRaw(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) { console.warn('[EgzeBundle] set failed', k, e); return false; }
  }
  function lsGetJson(k, fallback) {
    try {
      const raw = localStorage.getItem(k);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }

  function collectSharedStore() {
    const out = {};
    Object.values(SharedStore.KEYS).forEach(k => {
      out[k] = SharedStore.get(k, null);
    });
    // legacy / dodatkowe klucze WRO używane w module
    ['wro_analyzed_status', 'wro_cart_status'].forEach(k => {
      out[k] = SharedStore.get(k, null);
    });
    return out;
  }

  function collectSzafka() {
    const out = {};
    SZAFKA_KEYS.forEach(k => {
      const raw = lsGetRaw(k);
      if (raw != null) {
        try { out[k] = JSON.parse(raw); }
        catch { out[k] = raw; }
      }
    });
    return out;
  }

  function collectWroDatabase() {
    try {
      if (window.WroModule && typeof window.WroModule.getBazaDanych === 'function') {
        const db = window.WroModule.getBazaDanych();
        if (db && typeof db === 'object' && Object.keys(db).length) return db;
      }
    } catch {}
    return lsGetJson(WRO_DB_KEY, null);
  }

  function buildBundle() {
    let arkusz = null;
    try {
      const raw = lsGetRaw(ARKUSZ_KEY);
      if (raw) arkusz = JSON.parse(raw);
    } catch {}

    const prefs = {};
    [...PREF_KEYS, ...OTS_PREF_KEYS].forEach(k => {
      const v = lsGetRaw(k);
      if (v != null) prefs[k] = v;
    });

    return {
      app: 'egzebiurko',
      version: BUNDLE_VERSION,
      savedAt: new Date().toISOString(),
      arkusz,
      szafka: collectSzafka(),
      shared: collectSharedStore(),
      wroDatabase: collectWroDatabase(),
      prefs,
    };
  }

  function downloadBundle() {
    const bundle = buildBundle();
    const hasArkusz = !!(bundle.arkusz && Array.isArray(bundle.arkusz.sheets));
    const wroN = bundle.wroDatabase ? Object.keys(bundle.wroDatabase).length : 0;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const day = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = `Egzebiurko_${day}.egze.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast(
      `Zapisano całe Egzebiurko` + (hasArkusz ? ' · Arkusz' : '') + (wroN ? ` · WRO ${wroN}` : ''),
      'success',
      3200
    );
  }

  function applyBundle(bundle) {
    if (!bundle || bundle.app !== 'egzebiurko') {
      throw new Error('To nie jest plik Egzebiurko (.egze.json)');
    }

    if (bundle.arkusz && Array.isArray(bundle.arkusz.sheets)) {
      lsSetRaw(ARKUSZ_KEY, JSON.stringify(bundle.arkusz));
    }

    if (bundle.szafka && typeof bundle.szafka === 'object') {
      Object.keys(bundle.szafka).forEach(k => {
        const v = bundle.szafka[k];
        lsSetRaw(k, typeof v === 'string' ? v : JSON.stringify(v));
      });
    }

    if (bundle.shared && typeof bundle.shared === 'object') {
      Object.keys(bundle.shared).forEach(k => {
        const v = bundle.shared[k];
        if (v == null) SharedStore.remove(k);
        else SharedStore.set(k, v);
      });
    }

    if (bundle.wroDatabase && typeof bundle.wroDatabase === 'object') {
      const ok = lsSetRaw(WRO_DB_KEY, JSON.stringify(bundle.wroDatabase));
      if (!ok) {
        showToast('Baza WRO za duża na localStorage — wczytaj ją osobno w Analityce WRO', 'info', 4500);
      }
      try {
        if (window.WroModule && typeof window.WroModule.importBazaDanych === 'function') {
          window.WroModule.importBazaDanych(bundle.wroDatabase);
        } else {
          window.WroDatabase = bundle.wroDatabase;
        }
      } catch {}
    }

    if (bundle.prefs && typeof bundle.prefs === 'object') {
      Object.keys(bundle.prefs).forEach(k => {
        if (bundle.prefs[k] != null) lsSetRaw(k, String(bundle.prefs[k]));
      });
    }
  }

  async function loadBundleFromFile(file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Plik nie jest poprawnym JSON'); }

    // Pojedynczy skoroszyt Arkusza (.ots.json) — też akceptuj
    if (data && Array.isArray(data.sheets) && data.app !== 'egzebiurko') {
      lsSetRaw(ARKUSZ_KEY, JSON.stringify(data));
      showToast('Wczytano skoroszyt Arkusza — odświeżam…', 'success', 2000);
      setTimeout(() => location.reload(), 400);
      return;
    }

    applyBundle(data);
    showToast('Wczytano całe Egzebiurko — odświeżam…', 'success', 2200);
    setTimeout(() => location.reload(), 450);
  }

  function triggerLoad() {
    const inp = document.getElementById('egze-bundle-file');
    if (!inp) return;
    inp.value = '';
    inp.click();
  }

  function bindUi() {
    const btnSave = document.getElementById('btn-egze-save');
    const btnLoad = document.getElementById('btn-egze-load');
    const inp = document.getElementById('egze-bundle-file');
    if (btnSave) btnSave.addEventListener('click', () => {
      try { downloadBundle(); }
      catch (e) { showToast('Nie udało się zapisać: ' + (e.message || e), 'error', 4000); }
    });
    if (btnLoad) btnLoad.addEventListener('click', triggerLoad);
    if (inp) inp.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try { await loadBundleFromFile(f); }
      catch (err) { showToast(err.message || String(err), 'error', 4500); }
    });
  }

  return { buildBundle, downloadBundle, loadBundleFromFile, bindUi, WRO_DB_KEY };
})();

window.EgzeBundle = EgzeBundle;
