/* ============================================================
   Egzebiurko 3.0 — modules/wro.js
   Analityka WRO Pro
   Integracja z SharedStore (status, koszyk, OGNIVO wyniki)
   ============================================================ */

'use strict';

const WroModule = (() => {

  /* ─── STAN ─────────────────────────────────────────────── */
  let bazaDanych = {};
  let entities   = [];
  let activeFilters = new Set();
  let filterNoFolder = false;
  let currentActiveId = null;
  let activated   = false;
  let _currentAnnotBid = null;
  const _annotBtnCtx = {};
  let _annotBtnSeq = 0;
  let minDochodFilter = 0;
  let _lookupIndex = null;
  let _wroFiltered = [];
  let _wroVirtRaf = 0;
  let _zrzutniaBusy = false;

  /* ─── SYNCHRONIZACJA Z SZAFKĄ (majątek per teczka) ─────── */
  const MAJATEK_KEY = 'egze3_majatek_sync';

  let _majatekMem = null;
  function loadMajatekStore() {
    if (_majatekMem) return _majatekMem;
    try {
      const raw = localStorage.getItem(MAJATEK_KEY);
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v === 'object') {
        if (!v.people || typeof v.people !== 'object') v.people = {};
        if (!Array.isArray(v.pendingGone)) v.pendingGone = [];
        _majatekMem = v;
        return v;
      }
    } catch {}
    _majatekMem = { people: {}, pendingGone: [] };
    return _majatekMem;
  }
  function saveMajatekStore(store) {
    _majatekMem = store;
    try { localStorage.setItem(MAJATEK_KEY, JSON.stringify(store)); }
    catch (e) { console.warn('[WRO] zapis majątku nie powiódł się (za duży?)', e); }
  }
  function todayIsoWro() {
    return new Date().toISOString().slice(0, 10);
  }
  function personKeyForEntity(id) {
    const data = bazaDanych[id] || {};
    const meta = data._meta || {};
    const fromT = idsFromWroTables(data);
    const a3 = digitsId(meta.a3) || digitsId(fromT.nip);
    const b3 = digitsId(meta.b3) || digitsId(fromT.pesel);
    return b3 || a3 || digitsId(id) || null;
  }
  function computeMaxDochodFromRows(headers, rows) {
    const hLower = (headers || []).map(h => String(h || '').toLowerCase());
    const dochIdx = hLower.findIndex(h => /doch[oó]d|income/i.test(h));
    let max = 0;
    (rows || []).forEach(r => {
      let val = 0;
      if (dochIdx >= 0) val = parsePolishNum(r[dochIdx]);
      else val = (r || []).slice(1).map(v => parsePolishNum(v)).filter(n => n > 0 && n < 100000000).reduce((a, b) => Math.max(a, b), 0);
      if (val > max) max = val;
    });
    return max;
  }
  function entitySectionsSnapshot(id) {
    const data = bazaDanych[id] || {};
    const out = {};
    Object.keys(data).forEach(k => {
      if (k === '_meta') return;
      const rows = data[k];
      if (!Array.isArray(rows) || rows.length <= 1) return;
      out[k] = { updatedAt: todayIsoWro(), headers: rows[0], rows: rows.slice(1) };
    });
    return out;
  }
  function sectionsHavePending(personKey, sections, entityId) {
    const annots = loadAnnotations();
    for (const src of Object.keys(sections)) {
      if (!src.startsWith('Wynik:')) continue;
      const safe = src.replace(/[^a-zA-Z0-9]/g, '');
      for (const row of (sections[src].rows || [])) {
        const fp = row.slice(0, 5).map(v => String(v || '')).join('||');
        const ann = annots[buildAnnotKey(personKey, safe, fp)];
        if (!ann || (ann.status !== 'done' && ann.status !== 'excluded')) return true;
      }
    }
    try {
      const ognivoData = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
      const entry = ognivoData[entityId] || ognivoData[personKey];
      if (entry && Array.isArray(entry.banks)) {
        for (const b of entry.banks) {
          const ann = annots[buildAnnotKey(personKey, 'OGNIVOStore', b)];
          if (!ann || (ann.status !== 'done' && ann.status !== 'excluded')) return true;
        }
      }
    } catch {}
    return false;
  }

  function getMajatekSnapshot(personKey) {
    const pk = digitsId(personKey);
    if (!pk) return null;
    return loadMajatekStore().people[pk] || null;
  }
  function personHasSection(personKey, sectionKey) {
    const snap = getMajatekSnapshot(personKey);
    return !!(snap && snap.sections && snap.sections[sectionKey]);
  }
  function hasPendingItemsForKey(personKey) {
    const pk = digitsId(personKey);
    if (!pk) return false;
    if (typeof ZobowiazaniModule !== 'undefined' && typeof ZobowiazaniModule.isSuspended === 'function' && ZobowiazaniModule.isSuspended(pk)) {
      return false;
    }
    const snap = getMajatekSnapshot(pk);
    if (!snap || !snap.sections) return false;
    return sectionsHavePending(pk, snap.sections, snap.entityId);
  }
  function getPendingGoneCount() {
    return loadMajatekStore().pendingGone.length;
  }
  function getSourceCatalog() {
    return matrixColumns.map(k => ({ key: k, icon: icons[k] || '📄', safe: k.replace(/[^a-zA-Z0-9]/g, ''), label: k.replace('Wynik: ', '') }));
  }
  function getPersonWroFlags(personKey) {
    const pk = digitsId(personKey);
    if (!pk) return { sources: [], dochodMax: 0, pending: false };
    const snap = getMajatekSnapshot(pk);
    if (!snap || !snap.sections) return { sources: [], dochodMax: 0, pending: false };
    const suspended = typeof ZobowiazaniModule !== 'undefined' && typeof ZobowiazaniModule.isSuspended === 'function' && ZobowiazaniModule.isSuspended(pk);
    return {
      sources: Object.keys(snap.sections),
      dochodMax: snap.dochodMax || 0,
      pending: suspended ? false : sectionsHavePending(pk, snap.sections, snap.entityId),
    };
  }

  function syncToSzafka() {
    if (!Object.keys(bazaDanych).length) {
      if (typeof showToast === 'function') showToast('Najpierw wczytaj plik bazy WRO', 'info', 2500);
      return;
    }
    if (typeof ZobowiazaniModule === 'undefined' || typeof ZobowiazaniModule.getIdIndex !== 'function') {
      if (typeof showToast === 'function') showToast('Szafka teczek niedostępna — otwórz najpierw kartę Zobowiązani', 'error', 3000);
      return;
    }
    const idIndex = ZobowiazaniModule.getIdIndex();
    const store = loadMajatekStore();
    let addedN = 0, updatedN = 0, newsN = 0;
    const missingList = [];

    entities.forEach(({ id }) => {
      const pk = personKeyForEntity(id);
      const hit = pk ? idIndex[pk] : null;
      if (!hit) {
        missingList.push({ id, name: resolveEntityView(id, idIndex).displayName });
        return;
      }
      const prev = store.people[pk];
      const sections = entitySectionsSnapshot(id);

      if (prev && prev.sections) {
        Object.keys(prev.sections).forEach(secKey => {
          if (!sections[secKey]) {
            const dup = store.pendingGone.find(g => g.personKey === pk && g.section === secKey);
            if (!dup) {
              store.pendingGone.push({
                personKey: pk,
                name: hit.name || pk,
                section: secKey,
                oldCount: (prev.sections[secKey].rows || []).length,
                at: new Date().toISOString(),
              });
            }
          }
        });
      }

      const dochodMax = sections['Dochody']
        ? computeMaxDochodFromRows(sections['Dochody'].headers, sections['Dochody'].rows)
        : (prev ? (prev.dochodMax || 0) : 0);

      store.people[pk] = { entityId: id, lastSyncAt: new Date().toISOString(), sections, dochodMax };
      if (prev) updatedN++; else addedN++;

      const suspended = typeof ZobowiazaniModule.isSuspended === 'function' && ZobowiazaniModule.isSuspended(pk);
      if (!suspended && sectionsHavePending(pk, sections, id)) newsN++;
    });

    saveMajatekStore(store);
    if (typeof ZobowiazaniModule !== 'undefined' && ZobowiazaniModule.refreshAfterWroSync) ZobowiazaniModule.refreshAfterWroSync();
    showSyncSummaryDialog({ added: addedN, updated: updatedN, missing: missingList, news: newsN, goneCount: store.pendingGone.length });
  }

  let _lastMissingList = [];

  function showSyncSummaryDialog(summary) {
    _lastMissingList = summary.missing || [];
    let dlg = document.getElementById('wro-sync-dlg');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'wro-sync-dlg';
      document.body.appendChild(dlg);
    }
    const missRows = summary.missing.slice(0, 25).map((m, i) => `
      <button type="button" class="wro-missing-row" onclick="WroModule.jumpToMissingEntity(${i})">
        <span>${escWro(m.name)}</span><span class="wro-missing-go">Otwórz w WRO →</span>
      </button>`).join('');
    const missHtml = summary.missing.length
      ? `<div class="wro-ldlg-note" style="text-align:left;padding:6px">
          <div style="font-weight:700;margin-bottom:6px;padding:0 6px">📂 Bez teczki w Szafce — kliknij, aby otworzyć i dopasować ręcznie:</div>
          <div class="wro-missing-list">${missRows}</div>
          ${summary.missing.length > 25 ? `<div style="padding:6px 6px 0;font-size:.75rem">…i ${summary.missing.length - 25} więcej — użyj filtra „Bez teczki” w WRO.</div>` : ''}
        </div>`
      : '';
    dlg.innerHTML = `
      <div class="wro-ldlg-overlay" onclick="document.getElementById('wro-sync-dlg').style.display='none'">
        <div class="wro-ldlg-box" onclick="event.stopPropagation()">
          <div class="wro-ldlg-title">🔄 Synchronizacja z Szafką</div>
          <div class="wro-ldlg-grid">
            <div class="wro-ldlg-card wro-ldlg-done"><div class="wro-ldlg-num">${summary.added}</div><div class="wro-ldlg-lbl">✅ dodanych</div></div>
            <div class="wro-ldlg-card"><div class="wro-ldlg-num">${summary.updated}</div><div class="wro-ldlg-lbl">🔁 zaktualizowanych</div></div>
            <div class="wro-ldlg-card wro-ldlg-todo"><div class="wro-ldlg-num">${summary.news}</div><div class="wro-ldlg-lbl">🔥 z nowością</div></div>
            <div class="wro-ldlg-card wro-ldlg-partial"><div class="wro-ldlg-num">${summary.missing.length}</div><div class="wro-ldlg-lbl">📂 brakuje teczki</div></div>
          </div>
          ${missHtml}
          ${summary.goneCount > 0 ? `<div class="wro-ldlg-note wro-ldlg-first">⚠️ ${summary.goneCount} zniknięć do przeglądu — dane, które osoba miała wcześniej, a już ich nie ma w tym raporcie.</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            ${summary.goneCount > 0 ? `<button class="wro-ldlg-close" style="flex:1;background:#b45309" onclick="document.getElementById('wro-sync-dlg').style.display='none';WroModule.reviewGoneQueue()">Przejrzyj zniknięcia (${summary.goneCount})</button>` : ''}
            ${summary.missing.length > 0 ? `<button class="wro-ldlg-close" style="flex:1;background:#475569" onclick="document.getElementById('wro-sync-dlg').style.display='none';WroModule.filterMissingFolders()">Filtruj listę: bez teczki</button>` : ''}
            <button class="wro-ldlg-close" style="flex:1" onclick="document.getElementById('wro-sync-dlg').style.display='none'">Zamknij</button>
          </div>
        </div>
      </div>`;
    dlg.style.display = 'block';
    refreshSyncButtons();
  }

  function jumpToMissingEntity(idx) {
    const item = _lastMissingList[idx];
    if (!item) return;
    const dlg = document.getElementById('wro-sync-dlg');
    if (dlg) dlg.style.display = 'none';
    selectEntity(item.id);
  }

  function filterMissingFolders() {
    filterNoFolder = true;
    const chip = document.querySelector('.wro-chip-warn');
    if (chip) chip.classList.add('active');
    renderList(document.getElementById('wro-search')?.value || '');
  }

  function reviewGoneQueue() {
    const store = loadMajatekStore();
    if (!store.pendingGone.length) {
      if (typeof showToast === 'function') showToast('Brak zniknięć do przeglądu', 'info', 2200);
      return;
    }
    renderGoneReview();
  }

  function renderGoneReview() {
    const store = loadMajatekStore();
    let dlg = document.getElementById('wro-gone-dlg');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'wro-gone-dlg';
      document.body.appendChild(dlg);
    }
    if (!store.pendingGone.length) {
      dlg.style.display = 'none';
      if (typeof showToast === 'function') showToast('Przegląd zniknięć zakończony', 'success', 2200);
      refreshSyncButtons();
      return;
    }
    const total = store.pendingGone.length;
    const item = store.pendingGone[0];
    dlg.innerHTML = `
      <div class="wro-ldlg-overlay">
        <div class="wro-ldlg-box" style="max-width:440px">
          <div class="wro-ldlg-title">⚠️ Zniknięcie danych (1/${total})</div>
          <p style="margin:0 0 14px;color:var(--text);font-size:.92rem">
            <strong>${escWro(item.name)}</strong> miał(a) wcześniej dane w sekcji <strong>${escWro(item.section.replace('Wynik: ', ''))}</strong>
            (${item.oldCount} wpis${item.oldCount === 1 ? '' : 'ów'}), a w nowym raporcie już ich nie ma.
          </p>
          <p style="margin:0 0 16px;color:var(--muted);font-size:.82rem">Zamknąć sprawę i przenieść teczkę do Archiwum, czy zostawić otwartą?</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="wro-ldlg-close" style="flex:1;background:#b91c1c" onclick="WroModule.goneDecision('archive')">📦 Archiwizuj teczkę</button>
            <button class="wro-ldlg-close" style="flex:1;background:#16a34a" onclick="WroModule.goneDecision('leave')">✅ Zostaw otwartą</button>
          </div>
          <button class="wro-ldlg-close" style="width:100%;margin-top:8px;background:var(--panel2);color:var(--text);border:1px solid var(--line)" onclick="document.getElementById('wro-gone-dlg').style.display='none'">Przerwij przegląd (dokończę później)</button>
        </div>
      </div>`;
    dlg.style.display = 'block';
  }

  function goneDecision(decision) {
    const store = loadMajatekStore();
    const item = store.pendingGone[0];
    if (item) {
      if (decision === 'archive' && typeof ZobowiazaniModule !== 'undefined' && typeof ZobowiazaniModule.archiveByKey === 'function') {
        ZobowiazaniModule.archiveByKey(item.personKey, { reason: 'WRO: zniknęły dane (' + item.section.replace('Wynik: ', '') + ')' });
      }
      store.pendingGone.shift();
      saveMajatekStore(store);
      if (typeof ZobowiazaniModule !== 'undefined' && ZobowiazaniModule.refreshAfterWroSync) ZobowiazaniModule.refreshAfterWroSync();
    }
    renderGoneReview();
  }

  function refreshSyncButtons() {
    const btn = document.getElementById('wro-gone-btn');
    if (!btn) return;
    const n = getPendingGoneCount();
    btn.style.display = n > 0 ? '' : 'none';
    const num = btn.querySelector('.wro-cart-counter');
    if (num) num.textContent = n;
  }

  const icons = {
    "Raporter":"📊","STIR":"🏦","Księgi Wieczyste":"🏢",
    "CRCM":"📋","Dochody":"💰","Przychód":"📈",
    "UFG CEPIK":"🚗","Kontrahenci: SPRZEDAŻ":"🛒","Kontrahenci: ZAKUP":"🛍️",
    "Wynik: OGNIVO":"🔥","Wynik: AUM":"🎯","Wynik: JPK":"⚡"
  };
  const sourceNames = Object.keys(icons);
  const matrixColumns = [
    "Raporter","STIR","Księgi Wieczyste","CRCM","Dochody","Przychód",
    "UFG CEPIK","Kontrahenci: SPRZEDAŻ","Kontrahenci: ZAKUP",
    "Wynik: OGNIVO","Wynik: AUM","Wynik: JPK"
  ];

  /* ─── POMOCNICZE ────────────────────────────────────────── */
  function getAnalyzed() { return new Set(SharedStore.get('wro_analyzed_status', [])); }
  function setAnalyzed(s) { SharedStore.set('wro_analyzed_status', [...s]); }
  function getCart()     { return new Set(SharedStore.get('wro_cart_status', [])); }
  function setCart(s)    { SharedStore.set('wro_cart_status', [...s]); SharedStore.set(SharedStore.KEYS.WRO_CART, [...s]); }

  /* ─── ADNOTACJE NA WYNIKACH ─────────────────────────────── */
  const ANNOT_LS_KEY = 'egze3_wro_annotations';

  let _annotMem = null;
  function loadAnnotations() {
    if (_annotMem) return _annotMem;
    try { _annotMem = JSON.parse(localStorage.getItem(ANNOT_LS_KEY) || '{}'); }
    catch { _annotMem = {}; }
    return _annotMem;
  }
  function saveAnnotations(obj) {
    _annotMem = obj;
    localStorage.setItem(ANNOT_LS_KEY, JSON.stringify(obj));
  }
  function buildAnnotKey(pk, sec, iid) {
    return pk + '|' + sec + '|' + iid;
  }
  function getAnnotation(pk, sec, iid) {
    return loadAnnotations()[buildAnnotKey(pk, sec, iid)] || null;
  }
  function setAnnotationData(pk, sec, iid, data) {
    const all = loadAnnotations();
    const k = buildAnnotKey(pk, sec, iid);
    if (data) all[k] = { ...data, updatedAt: new Date().toISOString().slice(0, 10) };
    else delete all[k];
    saveAnnotations(all);
  }
  /* ─── DOCHODY FILTER ────────────────────────────────────── */
  function parsePolishNum(v) {
    const s = String(v || '').trim().replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function getMaxDochodForEntity(id) {
    const data = bazaDanych[id];
    if (!data) return 0;
    const rows = data['Dochody'];
    if (!rows || rows.length < 2) return 0;
    const headers = (rows[0] || []).map(h => String(h || '').toLowerCase());
    const dochIdx = headers.findIndex(h => /doch[oó]d|income/i.test(h));
    let max = 0;
    for (let r = 1; r < rows.length; r++) {
      let val = 0;
      if (dochIdx >= 0) {
        val = parsePolishNum(rows[r][dochIdx]);
      } else {
        val = (rows[r] || []).slice(1).map(v => parsePolishNum(v)).filter(n => n > 0 && n < 100000000).reduce((a, b) => Math.max(a, b), 0);
      }
      if (val > max) max = val;
    }
    return max;
  }

  function setMinDochod(val) {
    minDochodFilter = val;
    const inp = document.getElementById('wro-min-dochod');
    if (inp) inp.value = val || '';
    renderList(document.getElementById('wro-search')?.value || '');
  }

  function formatPln(n) {
    return n >= 1000 ? (n / 1000).toFixed(0) + ' tys.' : n.toFixed(0);
  }

  function annotChipHtml(annot, pk, sec, iid) {
    const bid = 'ab' + (++_annotBtnSeq);
    _annotBtnCtx[bid] = { pk, sec, iid };
    let label, cls;
    if (!annot || !annot.status || annot.status === 'todo') {
      label = '📋 Do zajęcia'; cls = 'wro-annot-todo';
    } else if (annot.status === 'done') {
      label = '✅ Zrobione' + (annot.updatedAt ? ' · ' + annot.updatedAt : ''); cls = 'wro-annot-done';
    } else {
      label = '⛔ Wykluczone' + (annot.reason ? ' · ' + escWro(annot.reason) : ''); cls = 'wro-annot-excl';
    }
    return `<button class="wro-annot-btn ${cls}" id="${bid}" onclick="WroModule.openAnnotPopover(event,'${bid}')" title="Kliknij aby ustawić status wpisu">${label}</button>`;
  }

  /* ─── GŁÓWNY RENDER ─────────────────────────────────────── */
  function render() {
    const container = document.getElementById('wro-app');
    if (!container) return;

    const cart = getCart();

    container.innerHTML = `
      <div class="wro-layout">
        <aside class="wro-sidebar">
          <div class="wro-sidebar-inner">
            <button class="wro-cart-btn" onclick="WroModule.renderCart()">
              🛒 Koszyk matrycowy
              <span class="wro-cart-counter" id="wro-cart-counter">${cart.size}</span>
            </button>

            <label class="wro-upload-btn">
              📥 Wczytaj bazę danych (.js)
              <input type="file" id="wro-file-input" accept=".js,.json,.txt" style="display:none">
            </label>

            <div class="wro-zrzutnia">
              <div class="wro-zrzutnia-title">Zrzutnia (sita)</div>
              <button type="button" class="wro-zrzutnia-folder" id="wro-zrzutnia-btn">📂 Folder SEE / AUM / Platforma</button>
              <input type="file" id="wro-zrzutnia-input" webkitdirectory directory multiple hidden>
              <div class="wro-zrzutnia-files" id="wro-zrzutnia-files"></div>
              <div class="wro-zrzutnia-runs">
                <button type="button" onclick="WroModule.runZrzutnia('jpk')">JPK</button>
                <button type="button" onclick="WroModule.runZrzutnia('ognivo')">OGNIVO</button>
                <button type="button" onclick="WroModule.runZrzutnia('aum')">AUM</button>
              </div>
            </div>

            <div class="wro-zrzutnia">
              <div class="wro-zrzutnia-title">Teczki WRO</div>
              <button type="button" class="wro-zrzutnia-folder" id="wro-teczki-btn">📂 Folder teczek (~xlsx)</button>
              <input type="file" id="wro-teczki-input" webkitdirectory directory multiple hidden>
              <div class="wro-zrzutnia-files" id="wro-teczki-files"></div>
              <button type="button" class="wro-zrzutnia-build" id="wro-teczki-build" onclick="WroModule.buildBazaFromFolder()">▶ Zbuduj bazę WRO</button>
              <div class="wro-zrzutnia-prog" id="wro-teczki-prog" hidden>
                <div class="wro-zrzutnia-bar"><span id="wro-teczki-bar"></span></div>
                <div class="wro-zrzutnia-prog-txt" id="wro-teczki-prog-txt"></div>
              </div>
            </div>

            <button class="wro-cart-btn" style="background:#0f766e" onclick="WroModule.syncToSzafka()" title="Wgrane dane nie trafiają do Szafki automatycznie — dopiero po kliknięciu tutaj">
              🔄 Synchronizuj z Szafką
            </button>
            <button class="wro-cart-btn" id="wro-gone-btn" style="background:#b45309;display:none" onclick="WroModule.reviewGoneQueue()">
              ⚠️ Przegląd zniknięć
              <span class="wro-cart-counter">0</span>
            </button>

            <div class="wro-progress-row">
              <button class="wro-prog-btn" onclick="WroModule.exportProgress()">💾 Zapisz postęp</button>
              <label class="wro-prog-btn">
                📂 Wczytaj postęp
                <input type="file" id="wro-prog-input" accept=".json" style="display:none">
              </label>
            </div>

            <input type="text" class="wro-search" id="wro-search" placeholder="Szukaj (nazwa, NIP, PESEL)...">

            <div class="wro-filters" id="wro-filters"></div>

            <div class="wro-dochod-filter">
              <div class="wro-dochod-label">💰 Min. dochód roczny (PLN)</div>
              <div class="wro-dochod-row">
                <input type="number" id="wro-min-dochod" class="wro-dochod-inp" placeholder="np. 60000" min="0" step="1000">
                <button class="wro-dochod-clear" onclick="WroModule.setMinDochod(0)" title="Wyczyść filtr">✕</button>
              </div>
              <div class="wro-dochod-presets">
                <button onclick="WroModule.setMinDochod(30000)">30k</button>
                <button onclick="WroModule.setMinDochod(60000)">60k</button>
                <button onclick="WroModule.setMinDochod(100000)">100k</button>
                <button onclick="WroModule.setMinDochod(200000)">200k</button>
              </div>
            </div>
          </div>

          <div class="wro-list" id="wro-list">
            <div class="wro-empty-list">
              Brak wczytanych danych.<br>
              Wskaż folder teczek WRO albo zrzutnię, albo wczytaj bazę .js.
            </div>
          </div>
        </aside>

        <main class="wro-content" id="wro-content">
          <div class="wro-empty-state">
            <div class="wro-empty-card">
              <div class="wro-empty-icon">📊</div>
              <h3>Analityka WRO</h3>
              <p>Dwa foldery, jak w Excelu: <strong>zrzutnia</strong> (sita JPK/OGNIVO/AUM) i <strong>teczki WRO</strong> (~setki xlsx → jedna baza). Albo wczytaj gotowy <code>baza_danych.js</code>.</p>
              ${Object.keys(bazaDanych).length > 0
                ? `<p class="wro-db-info">✅ Baza załadowana: ${Object.keys(bazaDanych).length} podmiotów</p>`
                : ''}
            </div>
          </div>
        </main>
      </div>
    `;

    bindEvents();
    initFilters();
    paintZrzutnia();
    paintTeczki();
    if (entities.length > 0) renderList('');
    refreshSyncButtons();
  }

  function paintZrzutnia() {
    const box = document.getElementById('wro-zrzutnia-files');
    const btn = document.getElementById('wro-zrzutnia-btn');
    if (!box || typeof AutomatyZrzutnia === 'undefined') return;
    const snap = AutomatyZrzutnia.snapshot();
    if (btn) {
      btn.textContent = snap.folderName
        ? ('📂 ' + snap.folderName)
        : '📂 Wskaż folder';
    }
    box.innerHTML = AutomatyZrzutnia.ROLES.map(role => {
      const ok = !!snap.found[role];
      const label = AutomatyZrzutnia.ROLE_LABEL[role];
      return `<span class="wro-zrzutnia-chip ${ok ? 'ok' : ''}" title="${ok ? escWro(snap.found[role]) : 'brak'}">${label}</span>`;
    }).join('');
  }

  function paintTeczki() {
    const box = document.getElementById('wro-teczki-files');
    const btn = document.getElementById('wro-teczki-btn');
    if (!box || typeof AutomatyWroFolder === 'undefined') return;
    const snap = AutomatyWroFolder.snapshot();
    if (btn) {
      btn.textContent = snap.folderName
        ? ('📂 ' + snap.folderName + ' (' + snap.count + ')')
        : '📂 Folder teczek (~xlsx)';
    }
    if (!snap.count) {
      box.innerHTML = '<span class="wro-zrzutnia-chip">brak folderu</span>';
      return;
    }
    box.innerHTML =
      '<span class="wro-zrzutnia-chip ok">' + snap.dossiers + ' teczek</span>' +
      (snap.actions ? '<span class="wro-zrzutnia-chip ok">' + snap.actions + ' OGNIVO/AUM/JPK</span>' : '');
  }

  function bindEvents() {
    const fi   = document.getElementById('wro-file-input');
    const pi   = document.getElementById('wro-prog-input');
    const srch = document.getElementById('wro-search');
    const zBtn = document.getElementById('wro-zrzutnia-btn');
    const zIn  = document.getElementById('wro-zrzutnia-input');
    const tBtn = document.getElementById('wro-teczki-btn');
    const tIn  = document.getElementById('wro-teczki-input');

    if (fi) fi.addEventListener('change', handleFileLoad);
    if (pi) pi.addEventListener('change', handleProgressLoad);
    if (srch) srch.addEventListener('input', e => renderList(e.target.value));
    if (zBtn && zIn) {
      zBtn.addEventListener('click', () => zIn.click());
      zIn.addEventListener('change', e => {
        if (typeof AutomatyZrzutnia === 'undefined') return;
        const snap = AutomatyZrzutnia.ingest(e.target.files);
        e.target.value = '';
        paintZrzutnia();
        if (!snap.count) {
          showToast('W folderze nie ma SEE.11 / SEE.18 / AUM / Platforma / OGNIVO', 'warn');
        } else {
          showToast('Zrzutnia: ' + snap.count + ' plików', 'success');
        }
      });
    }
    if (tBtn && tIn) {
      tBtn.addEventListener('click', () => tIn.click());
      tIn.addEventListener('change', e => {
        if (typeof AutomatyWroFolder === 'undefined') return;
        const snap = AutomatyWroFolder.ingest(e.target.files);
        e.target.value = '';
        paintTeczki();
        if (!snap.count) showToast('W folderze nie ma plików .xlsx / .xlsm teczek WRO', 'warn');
        else showToast('Teczki: ' + snap.dossiers + ' + ' + snap.actions + ' wynikowych', 'success');
      });
    }

    const dochInp = document.getElementById('wro-min-dochod');
    if (dochInp) dochInp.addEventListener('input', e => {
      minDochodFilter = parseFloat(e.target.value) || 0;
      renderList(document.getElementById('wro-search')?.value || '');
    });

    if (!document._wroAnnotListenerAttached) {
      document._wroAnnotListenerAttached = true;
      document.addEventListener('click', e => {
        const pop = document.getElementById('wro-annot-pop');
        if (pop && pop.style.display !== 'none') {
          if (!pop.contains(e.target) && !e.target.classList.contains('wro-annot-btn')) {
            pop.style.display = 'none';
          }
        }
      }, true);
    }
  }

  function escWro(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function entityHasWroDossier(data) {
    if (!data) return false;
    return Object.keys(data).some(k =>
      k !== '_meta' && !String(k).startsWith('Wynik:') && Array.isArray(data[k]) && data[k].length > 1
    );
  }

  function isPlaceholderWroId(id) {
    return /brak\s*teczk|brak\s*danych|bez\s*nazw|unknown|^n\/?a$/i.test(String(id || ''));
  }

  function idsFromWroTables(data) {
    let pesel = '', nip = '';
    Object.keys(data || {}).forEach(k => {
      if (k === '_meta') return;
      const rows = data[k];
      if (!Array.isArray(rows) || rows.length < 2) return;
      const headers = rows[0] || [];
      const pi = headers.findIndex(h => /pesel/i.test(String(h || '')));
      const ni = headers.findIndex(h => /nip/i.test(String(h || '')));
      rows.slice(1).forEach(r => {
        if (!pesel && pi >= 0) {
          const d = String(r[pi] || '').replace(/\D/g, '');
          if (d.length === 11) pesel = d;
        }
        if (!nip && ni >= 0) {
          const d = String(r[ni] || '').replace(/\D/g, '');
          if (d.length === 10) nip = d;
        }
      });
    });
    return { pesel, nip };
  }

  function resolveEntityView(id, index) {
    const data = bazaDanych[id] || {};
    const fromTables = idsFromWroTables(data);
    const a3 = String(data._meta?.a3 || '').replace(/\D/g, '') || fromTables.nip;
    const b3 = String(data._meta?.b3 || '').replace(/\D/g, '') || fromTables.pesel;
    const idDigits = String(id || '').replace(/\D/g, '');
    const stub = !entityHasWroDossier(data);
    const idx = index || ((typeof ZobowiazaniModule !== 'undefined' && typeof ZobowiazaniModule.getIdIndex === 'function')
      ? ZobowiazaniModule.getIdIndex()
      : {});
    const person = idx[b3] || idx[a3] || idx[idDigits] || null;
    const displayName = (person && person.name)
      || (!isPlaceholderWroId(id) ? String(id) : '')
      || (b3 ? ('PESEL ' + b3) : '')
      || (a3 ? ('NIP ' + a3) : '')
      || String(id);
    return { displayName, person, stub, a3, b3 };
  }

  function rebuildEntitiesFromBaza() {
    entities = Object.keys(bazaDanych).map(id => {
      const avail = Object.keys(bazaDanych[id]).filter(k => k !== '_meta' && bazaDanych[id][k].length > 1);
      return { id, availableSources: avail, sourceCount: avail.length };
    }).sort((a, b) => b.sourceCount - a.sourceCount || a.id.localeCompare(b.id));
    _lookupIndex = Object.create(null);
    entities.forEach(item => {
      const ent = bazaDanych[item.id];
      const meta = (ent && ent._meta) || {};
      [item.id, meta.a3, meta.b3].forEach(v => {
        const d = String(v || '').replace(/\D/g, '');
        if (d && !_lookupIndex[d]) _lookupIndex[d] = item.id;
      });
    });
  }

  function persistBazaDanych() {
    try {
      if (!bazaDanych || !Object.keys(bazaDanych).length) {
        localStorage.removeItem('egze3_wro_database');
        return;
      }
      localStorage.setItem('egze3_wro_database', JSON.stringify(bazaDanych));
    } catch (e) {
      console.warn('[WRO] persist baza failed (za duża?)', e);
    }
  }

  function mergeWynikSection(sectionKey, byId) {
    if (!sectionKey || !byId || typeof byId !== 'object') return { merged: 0, created: 0 };
    if (!bazaDanych || typeof bazaDanych !== 'object') bazaDanych = {};
    let merged = 0;
    let created = 0;
    Object.keys(byId).forEach(id => {
      const pack = byId[id] || {};
      const headers = Array.isArray(pack.headers) ? pack.headers : [];
      const rows = Array.isArray(pack.rows) ? pack.rows : [];
      if (!headers.length && !rows.length) return;
      const meta = pack.meta || {};
      const pesel = digitsId(meta.b3 || id);
      const nip = digitsId(meta.a3 || (pesel.length === 10 ? id : ''));
      let key = findEntityKey(pesel, nip, pack.name);
      if (!key) {
        key = pesel || nip || String(id);
        if (!bazaDanych[key]) {
          bazaDanych[key] = {
            _meta: {
              a3: nip.length === 10 ? nip : (meta.a3 || ''),
              b3: pesel.length === 11 ? pesel : (meta.b3 || ''),
              plik: 'Automaty'
            }
          };
          created++;
        }
      }
      const table = [headers].concat(rows);
      bazaDanych[key][sectionKey] = table;
      merged++;
    });
    window.WroDatabase = bazaDanych;
    rebuildEntitiesFromBaza();
    persistBazaDanych();
    return { merged, created };
  }

  async function buildBazaFromFolder() {
    if (_zrzutniaBusy) return;
    if (typeof AutomatyWroFolder === 'undefined') {
      if (typeof showToast === 'function') showToast('Brak silnika teczek WRO', 'error');
      return;
    }
    const snap = AutomatyWroFolder.snapshot();
    if (!snap.count) {
      if (typeof showToast === 'function') showToast('Najpierw wskaż folder teczek WRO', 'warn');
      return;
    }
    _zrzutniaBusy = true;
    const prog = document.getElementById('wro-teczki-prog');
    const bar = document.getElementById('wro-teczki-bar');
    const txt = document.getElementById('wro-teczki-prog-txt');
    const buildBtn = document.getElementById('wro-teczki-build');
    if (prog) prog.hidden = false;
    if (buildBtn) buildBtn.disabled = true;
    try {
      const result = await AutomatyWroFolder.build(bazaDanych, (done, total) => {
        const pct = total ? Math.round(done * 100 / total) : 0;
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = 'Czytanie ' + done + ' / ' + total;
      });
      if (!result.ok) {
        if (typeof showToast === 'function') showToast(result.error || 'Nie złożono bazy', 'warn');
        return;
      }
      importBazaDanych(result.db);
      initFilters();
      renderList(document.getElementById('wro-search')?.value || '');
      refreshSyncButtons();
      showLoadSummaryDialog(computeLoadSummary());
      if (typeof showToast === 'function') {
        showToast('Baza WRO: ' + result.people + ' podmiotów (' + result.dossiers + ' teczek)', 'success');
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast((e && e.message) || 'Błąd składania bazy', 'error');
    } finally {
      _zrzutniaBusy = false;
      if (buildBtn) buildBtn.disabled = false;
      if (txt && AutomatyWroFolder.snapshot().count) txt.textContent = 'Gotowe';
    }
  }

  async function runZrzutnia(kind) {
    if (_zrzutniaBusy) return;
    if (typeof AutomatyZrzutnia === 'undefined') {
      if (typeof showToast === 'function') showToast('Brak silnika zrzutni', 'error');
      return;
    }
    _zrzutniaBusy = true;
    try {
      const result = await AutomatyZrzutnia.run(kind);
      if (!result.ok) {
        if (typeof showToast === 'function') showToast(result.error || 'Brak wyniku', 'warn');
        return;
      }
      const stats = mergeWynikSection(result.sectionKey, result.byId);
      initFilters();
      renderList(document.getElementById('wro-search')?.value || '');
      refreshSyncButtons();
      const n = result.count || stats.merged;
      if (typeof showToast === 'function') {
        showToast(result.sectionKey + ': ' + n + ' w Analityce WRO', 'success');
      }
    } catch (e) {
      if (typeof showToast === 'function') showToast((e && e.message) || 'Błąd zrzutni', 'error');
    } finally {
      _zrzutniaBusy = false;
    }
  }

  function importBazaDanych(db, opts) {
    opts = opts || {};
    if (!db || typeof db !== 'object') return false;
    bazaDanych = db;
    window.WroDatabase = bazaDanych;
    rebuildEntitiesFromBaza();
    if (!opts.skipPersist) persistBazaDanych();
    return true;
  }

  function tryLoadPersistedBaza() {
    if (Object.keys(bazaDanych).length) return;
    try {
      const raw = localStorage.getItem('egze3_wro_database');
      if (!raw) return;
      const db = JSON.parse(raw);
      if (db && typeof db === 'object' && Object.keys(db).length) {
        importBazaDanych(db, { skipPersist: true });
      }
    } catch (e) {
      console.warn('[WRO] load persisted baza failed', e);
    }
  }

  function computeLoadSummary() {
    const annots = loadAnnotations();
    const result = { total: entities.length, withActions: 0, allKnown: 0, partiallyKnown: 0, noAnnotations: 0, noActionSections: 0 };

    entities.forEach(({ id }) => {
      const data = bazaDanych[id];
      if (!data) return;
      const fromTbls = idsFromWroTables(data);
      const a3 = String(data._meta?.a3 || '').replace(/\D/g, '') || fromTbls.nip;
      const b3 = String(data._meta?.b3 || '').replace(/\D/g, '') || fromTbls.pesel;
      const pk = (b3 || a3 || String(id)).replace(/\D/g, '') || String(id);

      const actionSrcs = Object.keys(data).filter(k => k.startsWith('Wynik:') && Array.isArray(data[k]) && data[k].length > 1);
      if (!actionSrcs.length) { result.noActionSections++; return; }

      result.withActions++;
      let todo = 0, known = 0;
      actionSrcs.forEach(src => {
        const rows = data[src];
        const safe = src.replace(/[^a-zA-Z0-9]/g, '');
        for (let r = 1; r < rows.length; r++) {
          const fp = rows[r].slice(0, 5).map(v => String(v || '')).join('||');
          const ann = annots[buildAnnotKey(pk, safe, fp)];
          if (ann && (ann.status === 'done' || ann.status === 'excluded')) known++;
          else todo++;
        }
      });

      if (known === 0) result.noAnnotations++;
      else if (todo === 0) result.allKnown++;
      else result.partiallyKnown++;
    });
    return result;
  }

  function showLoadSummaryDialog(summary) {
    let dlg = document.getElementById('wro-load-dlg');
    if (!dlg) {
      dlg = document.createElement('div');
      dlg.id = 'wro-load-dlg';
      document.body.appendChild(dlg);
    }
    const { total, withActions, allKnown, partiallyKnown, noAnnotations, noActionSections } = summary;
    const hasAnyAnnot = allKnown + partiallyKnown > 0;

    dlg.innerHTML = `
      <div class="wro-ldlg-overlay" onclick="document.getElementById('wro-load-dlg').style.display='none'">
        <div class="wro-ldlg-box" onclick="event.stopPropagation()">
          <div class="wro-ldlg-title">📊 Podsumowanie wczytanego pliku</div>
          <div class="wro-ldlg-grid">
            <div class="wro-ldlg-card">
              <div class="wro-ldlg-num">${total}</div>
              <div class="wro-ldlg-lbl">podmiotów łącznie</div>
            </div>
            <div class="wro-ldlg-card wro-ldlg-todo">
              <div class="wro-ldlg-num">${noAnnotations}</div>
              <div class="wro-ldlg-lbl">📋 do przejrzenia</div>
            </div>
            <div class="wro-ldlg-card wro-ldlg-partial">
              <div class="wro-ldlg-num">${partiallyKnown}</div>
              <div class="wro-ldlg-lbl">⚡ częściowo znane</div>
            </div>
            <div class="wro-ldlg-card wro-ldlg-done">
              <div class="wro-ldlg-num">${allKnown}</div>
              <div class="wro-ldlg-lbl">✅ wszystkie znane</div>
            </div>
          </div>
          ${noActionSections > 0 ? `<div class="wro-ldlg-note">${noActionSections} podmiotów bez sekcji wynikowych (OGNIVO/AUM/JPK)</div>` : ''}
          ${!hasAnyAnnot ? `<div class="wro-ldlg-note wro-ldlg-first">ℹ️ Brak zapisanych adnotacji — to pierwsze wczytanie lub nowe urządzenie. Oznaczaj wpisy statusami aby przy kolejnym wczytaniu system pokazał delta.</div>` : ''}
          <button class="wro-ldlg-close" onclick="document.getElementById('wro-load-dlg').style.display='none'">Zamknij</button>
        </div>
      </div>
    `;
    dlg.style.display = 'block';
  }

  function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsText(file, 'UTF-16LE');
    reader.onload = evt => {
      let text = evt.target.result.replace('const bazaDanych = ', '').trim();
      if (text.endsWith('};')) text = text.slice(0, -2) + '}';
      try {
        bazaDanych = JSON.parse(text);
        window.WroDatabase = bazaDanych;
        rebuildEntitiesFromBaza();
        persistBazaDanych();

        renderList('');
        showContent('<div class="wro-empty-state"><div class="wro-empty-card"><div class="wro-empty-icon">✅</div><h3>Baza załadowana</h3><p>Załadowano ' + entities.length + ' podmiotów. Wybierz podmiot z listy.</p></div></div>');
        showToast('✅ Wczytano bazę WRO: ' + entities.length + ' podmiotów', 'success');
        showLoadSummaryDialog(computeLoadSummary());
      } catch(err) {
        showToast('❌ Błąd pliku bazy danych!', 'error');
      }
    };
  }

  function handleProgressLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = evt => {
      try {
        const obj = JSON.parse(evt.target.result);
        const analyzed = getAnalyzed();
        const cart = getCart();
        if (obj.analyzed) obj.analyzed.forEach(id => analyzed.add(id));
        if (obj.cart)     obj.cart.forEach(id => cart.add(id));
        setAnalyzed(analyzed);
        setCart(cart);
        if (obj.annotations && typeof obj.annotations === 'object') {
          const existing = loadAnnotations();
          saveAnnotations({ ...existing, ...obj.annotations });
        }
        updateCartCounter();
        renderList(document.getElementById('wro-search')?.value || '');
        showToast('✅ Postęp wczytany', 'success');
      } catch { showToast('❌ Nieprawidłowy plik postępu', 'error'); }
    };
  }

  function initFilters() {
    const fc = document.getElementById('wro-filters');
    if (!fc) return;
    fc.innerHTML = '';
    const noFolderChip = document.createElement('div');
    noFolderChip.className = 'wro-chip wro-chip-warn' + (filterNoFolder ? ' active' : '');
    noFolderChip.innerHTML = '🗂 Bez teczki w Szafce';
    noFolderChip.title = 'Podmioty bez dopasowanej teczki (PESEL/NIP) w Szafce';
    noFolderChip.onclick = () => {
      filterNoFolder = !filterNoFolder;
      noFolderChip.classList.toggle('active', filterNoFolder);
      renderList(document.getElementById('wro-search')?.value || '');
    };
    fc.appendChild(noFolderChip);
    sourceNames.forEach(src => {
      const chip = document.createElement('div');
      chip.className = 'wro-chip';
      const disp = src.replace('Kontrahenci: ','').replace('Wynik: ','');
      chip.innerHTML = `${icons[src]} ${disp}`;
      chip.onclick = () => {
        chip.classList.toggle('active');
        if (chip.classList.contains('active')) activeFilters.add(src);
        else activeFilters.delete(src);
        renderList(document.getElementById('wro-search')?.value || '');
      };
      fc.appendChild(chip);
    });
  }

  function renderList(filterText = '') {
    const listEl = document.getElementById('wro-list');
    if (!listEl) return;

    if (!entities.length) {
      _wroFiltered = [];
      listEl.innerHTML = '<div class="wro-empty-list">Brak wczytanych danych.</div>';
      return;
    }

    const analyzed = getAnalyzed();
    const cart     = getCart();
    const lf = filterText.toLowerCase();
    const arkIndex = (typeof ZobowiazaniModule !== 'undefined' && typeof ZobowiazaniModule.getIdIndex === 'function')
      ? ZobowiazaniModule.getIdIndex()
      : {};

    _wroFiltered = entities.filter(item => {
      if (activeFilters.size > 0) {
        for (const req of activeFilters) {
          if (!item.availableSources.includes(req)) return false;
        }
      }
      if (minDochodFilter && getMaxDochodForEntity(item.id) < minDochodFilter) return false;
      if (filterNoFolder) {
        const view = resolveEntityView(item.id, arkIndex);
        item._view = view;
        if (view.person) return false;
      }
      if (!lf) return true;
      const view = item._view || resolveEntityView(item.id, arkIndex);
      item._view = view;
      const blob = [item.id, view.displayName, view.a3, view.b3, view.person && view.person.name].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(lf);
    });

    bindWroListEvents(listEl);
    listEl.dataset.virt = '1';
    if (!listEl.querySelector('#wro-virt-spacer')) {
      listEl.innerHTML = `<div class="wro-virt" id="wro-virt"><div class="wro-virt-spacer" id="wro-virt-spacer"></div><div class="wro-virt-window" id="wro-virt-window"></div></div>`;
    }
    paintWroWindow(listEl, analyzed, cart);
  }

  function wroItemHtml(item, analyzed, cart) {
    const isAnalyzed = analyzed.has(item.id);
    const inCart     = cart.has(item.id);
    const isActive   = currentActiveId === item.id;
    const view = item._view || resolveEntityView(item.id);
    const stubMark = view.stub ? '<span class="wro-stub-chip" title="Tylko OGNIVO/AUM — brak raportu WRO">bez WRO</span>' : '';
    const fromArk = view.person ? '<span class="wro-stub-chip ark" title="Dopasowano z Arkusza">teczka</span>' : '';
    const folderIco = `<span class="wro-icon-jump wro-open-teczka" data-entity="${escWro(item.id)}" data-open-teczka="1" title="${view.person ? 'Otwórz teczkę w Szafce' : 'Szukaj teczki w Szafce'}">📂</span>`;
    const statusBadges = (inCart ? '🛒 ' : '') + (isAnalyzed ? '✅' : '');
    const maxDochod = item.availableSources.includes('Dochody') ? getMaxDochodForEntity(item.id) : 0;
    const dochodBadge = maxDochod > 0
      ? `<span class="wro-dochod-badge${maxDochod >= 60000 ? ' high' : ''}" title="Maks. dochód roczny z PIT">💰 ${formatPln(maxDochod)}</span>`
      : '';
    const iconsHtml = item.availableSources.map(s => {
      const safe = s.replace(/[^a-zA-Z0-9]/g,'');
      const style = s.startsWith('Wynik:') ? 'color:#ef4444;font-weight:bold;' : '';
      return `<span class="wro-icon-jump" style="${style}" data-entity="${escWro(item.id)}" data-section="${safe}" title="${s}">${icons[s]||'📄'}</span>`;
    }).join('');

    return `
      <div class="wro-list-item ${isAnalyzed ? 'is-analyzed' : ''} ${isActive ? 'active' : ''} ${view.stub ? 'is-stub' : ''}" data-id="${escWro(item.id)}">
        <div class="wro-list-title">
          <span title="${escWro(item.id)}">${escWro(view.displayName)}</span>
          <span>${statusBadges}${dochodBadge}${stubMark}${fromArk}</span>
        </div>
        <div class="wro-list-score">${folderIco} ${iconsHtml}</div>
      </div>`;
  }

  function paintWroWindow(listEl, analyzed, cart) {
    listEl = listEl || document.getElementById('wro-list');
    const spacer = document.getElementById('wro-virt-spacer');
    const win = document.getElementById('wro-virt-window');
    if (!listEl || !spacer || !win) return;
    analyzed = analyzed || getAnalyzed();
    cart = cart || getCart();
    const rowH = 72;
    const overscan = 8;
    const n = _wroFiltered.length;
    spacer.style.height = (n * rowH) + 'px';
    const start = Math.max(0, Math.floor(listEl.scrollTop / rowH) - overscan);
    const end = Math.min(n, Math.ceil((listEl.scrollTop + (listEl.clientHeight || 480)) / rowH) + overscan);
    win.style.transform = 'translateY(' + (start * rowH) + 'px)';
    const arkIndex = (typeof ZobowiazaniModule !== 'undefined' && typeof ZobowiazaniModule.getIdIndex === 'function')
      ? ZobowiazaniModule.getIdIndex()
      : {};
    let html = '';
    for (let i = start; i < end; i++) {
      const item = _wroFiltered[i];
      if (!item._view) item._view = resolveEntityView(item.id, arkIndex);
      html += wroItemHtml(item, analyzed, cart);
    }
    win.innerHTML = html || (n ? '' : '<div class="wro-empty-list">Brak wyników.</div>');
  }

  function bindWroListEvents(listEl) {
    if (!listEl || listEl._wroBound) return;
    listEl._wroBound = true;
    listEl.addEventListener('click', ev => {
      const jump = ev.target.closest('.wro-icon-jump');
      if (jump) {
        ev.stopPropagation();
        const id = jump.dataset.entity;
        if (jump.dataset.openTeczka) { openInSzafka(id); return; }
        selectEntity(id, jump.dataset.section);
        return;
      }
      const row = ev.target.closest('.wro-list-item');
      if (row && row.dataset.id) selectEntity(row.dataset.id);
    });
    listEl.addEventListener('scroll', () => {
      if (_wroVirtRaf) return;
      _wroVirtRaf = requestAnimationFrame(() => {
        _wroVirtRaf = 0;
        paintWroWindow(listEl);
      });
    }, { passive: true });
  }

  function selectEntity(id, scrollToSection = null) {
    currentActiveId = id;
    // Update active state
    document.querySelectorAll('.wro-list-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });
    renderEntityContent(id, scrollToSection);
  }

  function renderEntityContent(id, scrollToSection) {
    const data = bazaDanych[id];
    if (!data) return;

    // Reset annotation button context for fresh render
    for (const k in _annotBtnCtx) delete _annotBtnCtx[k];
    _annotBtnSeq = 0;

    const analyzed  = getAnalyzed();
    const cart      = getCart();
    const isAnalyzed = analyzed.has(id);
    const inCart     = cart.has(id);

    const fileName = data._meta?.plik || 'Nieznany';
    const a3       = data._meta?.a3 || '';
    const b3       = data._meta?.b3 || '';
    const view     = resolveEntityView(id);
    const personKey = (b3 || a3 || String(id)).replace(/\D/g, '') || String(id);

    // Pobierz wyniki OGNIVO z SharedStore dla tej osoby
    const ognivoData  = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
    const ognivoEntry = ognivoData[id] || ognivoData[a3] || ognivoData[b3]
      || (view.person && (ognivoData[view.person.pesel] || ognivoData[view.person.nip])) || null;

    let validSources = Object.keys(data).filter(k => k !== '_meta' && data[k].length > 1);
    validSources.sort((a, b) => {
      if (a.startsWith('Wynik:') && !b.startsWith('Wynik:')) return -1;
      if (!a.startsWith('Wynik:') && b.startsWith('Wynik:')) return 1;
      return 0;
    });

    const metaBadges = [
      a3 ? `<span class="wro-meta-badge" onclick="copyText('${a3}',this)" title="Kliknij aby skopiować"><strong>NIP:</strong> ${a3}</span>` : '',
      b3 ? `<span class="wro-meta-badge" onclick="copyText('${b3}',this)" title="Kliknij aby skopiować"><strong>PESEL:</strong> ${b3}</span>` : ''
    ].filter(Boolean).join('');

    // OGNIVO badge
    const ognivoBadge = ognivoEntry
      ? `<span class="wro-ognivo-badge" title="Wyniki OGNIVO z SharedStore">🏦 OGNIVO: ${ognivoEntry.count} trafień</span>`
      : '';

    const navCapsules = validSources.map(src => {
      const safe = src.replace(/[^a-zA-Z0-9]/g,'');
      const isAction = src.startsWith('Wynik:');
      const disp = src.replace('Wynik: ','');
      return `<a href="#wro-sec-${safe}" class="wro-capsule ${isAction ? 'wro-capsule-action' : ''}"
                onclick="document.getElementById('wro-sec-${safe}')?.classList.remove('collapsed')"
              >${icons[src]||'📄'} ${disp}</a>`;
    }).join('');

    let html = `
      <div class="wro-entity-wrap">
        <div class="wro-entity-header">
          <div>
            <h2 class="wro-entity-title">
              ${escWro(view.displayName)}
              ${view.stub ? `<span class="wro-stub-chip" title="W bazie WRO są tylko wyniki OGNIVO/AUM">bez raportu WRO</span>` : ''}
              ${view.person ? `<span class="wro-stub-chip ark">teczka z Arkusza</span>` : (view.stub ? `<span class="wro-stub-chip" title="PESEL/NIP nie znaleziony w Arkuszu">poza bazą</span>` : '')}
              ${metaBadges ? `<div class="wro-meta-row">${metaBadges}</div>` : ''}
              ${ognivoBadge}
              ${isZawieszonaWro(id, a3, b3) ? `<span class="wro-ognivo-badge" style="background:#7a5524" title="Sprawa zawieszona w Szafce / Arkuszu">⏸ Zawieszona</span>` : ''}
            </h2>
            <span class="wro-source-chip">📄 ${escWro(fileName)}${isPlaceholderWroId(id) && id !== view.displayName ? ' · klucz: ' + escWro(id) : ''}</span>
          </div>
          <div class="wro-entity-actions">
            <button class="wro-btn ${inCart ? 'wro-btn-red' : 'wro-btn-orange'}"
              onclick="WroModule.toggleCart('${String(id).replace(/'/g, "\\'")}')">
              ${inCart ? '❌ Usuń z koszyka' : '🛒 Dodaj do koszyka'}
            </button>
            ${view.person
              ? `<button class="wro-btn" onclick="WroModule.openInSzafka('${String(id).replace(/'/g, "\\'")}')">📂 Otwórz teczkę</button>`
              : `<button class="wro-btn" onclick="WroModule.openInSzafka('${String(id).replace(/'/g, "\\'")}')">📂 Szukaj teczki</button>`}
          </div>
        </div>

        <div class="wro-sticky-nav">
          <div class="wro-sticky-row">
            <div class="wro-capsules">${navCapsules}</div>
            <button class="wro-analyze-btn ${isAnalyzed ? 'done' : ''}"
              onclick="WroModule.toggleStatus('${id}')">
              ${isAnalyzed ? '↩️ Cofnij status' : '✅ Oznacz jako załatwione'}
            </button>
          </div>
          <div class="wro-toggle-row">
            <button class="wro-toggle-btn" onclick="WroModule.expandAll()">🔽 Rozwiń</button>
            <button class="wro-toggle-btn" onclick="WroModule.collapseAll()">◀️ Zwiń</button>
          </div>
        </div>
    `;

    // OGNIVO wyniki inline jeśli dostępne
    if (ognivoEntry) {
      const allBanks = (ognivoEntry.banks || []);
      const todoBanks = allBanks.filter(b => { const a = getAnnotation(personKey,'OGNIVOStore',b); return !a || !a.status || a.status==='todo'; });
      const knownBanks = allBanks.filter(b => { const a = getAnnotation(personKey,'OGNIVOStore',b); return a && (a.status==='done'||a.status==='excluded'); });
      const ogBadge = knownBanks.length > 0
        ? `<span class="wro-sec-badge" style="${todoBanks.length===0?'color:#16a34a':'color:#dc2626'}">${todoBanks.length > 0 ? todoBanks.length+' do zajęcia · ' : ''}${knownBanks.length} znane</span>`
        : '';
      html += `
        <div class="wro-ognivo-inline">
          <div class="wro-ognivo-title">🏦 Wyniki OGNIVO (z SharedStore) ${ogBadge}</div>
          <div class="wro-ognivo-banks">
            ${todoBanks.map(b => {
              const ann = getAnnotation(personKey, 'OGNIVOStore', b);
              return `<div class="wro-ognivo-bank-item">
                <span class="bank-badge">${escWro(b)}</span>
                ${annotChipHtml(ann, personKey, 'OGNIVOStore', b)}
              </div>`;
            }).join('')}
            ${todoBanks.length === 0 && knownBanks.length > 0 ? '<div class="wro-all-known" style="font-size:.8rem">✅ Wszystkie banki oznaczone jako znane</div>' : ''}
          </div>
          ${knownBanks.length > 0 ? `
          <div class="wro-known-toggle" onclick="(function(el){const g=el.nextElementSibling;g.classList.toggle('wro-known-hidden');el.classList.toggle('expanded');el.querySelector('.wro-known-arrow').textContent=g.classList.contains('wro-known-hidden')?'▶':'▼'})(this)">
            <span>👁 Pokaż znane banki (${knownBanks.length})</span><span class="wro-known-arrow">▶</span>
          </div>
          <div class="wro-ognivo-banks wro-known-hidden">
            ${knownBanks.map(b => {
              const ann = getAnnotation(personKey, 'OGNIVOStore', b);
              return `<div class="wro-ognivo-bank-item">
                <span class="bank-badge ${ann?.status==='excluded'?'badge-annot-excl':'badge-annot-done'}">${escWro(b)}</span>
                ${annotChipHtml(ann, personKey, 'OGNIVOStore', b)}
              </div>`;
            }).join('')}
          </div>` : ''}
          <div class="wro-ognivo-meta">Zapisano: ${ognivoEntry.ts ? new Date(ognivoEntry.ts).toLocaleString('pl') : '—'}</div>
        </div>
      `;
    }

    // Sekcje danych
    validSources.forEach(src => {
      const rows = data[src];
      const safe = src.replace(/[^a-zA-Z0-9]/g,'');
      const isAction = src.startsWith('Wynik:');
      const disp = src.replace('Wynik: ','Akcja: ');
      const headers = rows[0];

      const todoCards = [];
      const knownCards = [];

      Array.from({length: rows.length - 1}, (_, i) => i + 1).forEach(r => {
        const rowFp = rows[r].slice(0, 5).map(v => String(v || '')).join('||');
        const ann = isAction ? getAnnotation(personKey, safe, rowFp) : null;
        const cardCls = ann?.status === 'excluded' ? 'wro-card-excl' : ann?.status === 'done' ? 'wro-card-done' : '';
        const cardHtml = `
          <div class="wro-card ${cardCls}">
            <div class="wro-card-hdr">
              <span>Wpis #${r}</span>
              ${isAction ? annotChipHtml(ann, personKey, safe, rowFp) : ''}
            </div>
            ${headers.map((h, c) => {
              const val = rows[r][c];
              const dispVal = (val && String(val).trim()) ? val : '<span class="wro-empty-val">—</span>';
              return `<div class="wro-card-row"><div class="wro-label">${h}</div><div class="wro-value">${dispVal}</div></div>`;
            }).join('')}
          </div>
        `;
        if (isAction && ann && (ann.status === 'done' || ann.status === 'excluded')) {
          knownCards.push(cardHtml);
        } else {
          todoCards.push(cardHtml);
        }
      });

      const secStatusBadge = isAction ? (() => {
        const t = todoCards.length, k = knownCards.length;
        if (k === 0) return '';
        const col = t === 0 ? 'color:#16a34a' : 'color:#dc2626';
        return `<span class="wro-sec-badge" style="${col}">${t > 0 ? t + ' do zajęcia · ' : ''}${k} znane</span>`;
      })() : '';

      const knownSection = isAction && knownCards.length > 0 ? `
        <div class="wro-known-toggle" onclick="(function(el){const g=el.nextElementSibling;g.classList.toggle('wro-known-hidden');el.classList.toggle('expanded');el.querySelector('.wro-known-arrow').textContent=g.classList.contains('wro-known-hidden')?'▶':'▼'})(this)">
          <span>👁 Pokaż znane (${knownCards.length})</span><span class="wro-known-arrow">▶</span>
        </div>
        <div class="wro-cards-grid wro-known-hidden">
          ${knownCards.join('')}
        </div>
      ` : '';

      html += `
        <div class="wro-source-block ${isAction ? 'wro-action-block' : ''}" id="wro-sec-${safe}">
          <div class="wro-source-title" onclick="this.closest('.wro-source-block').classList.toggle('collapsed')">
            <div class="wro-title-left">${icons[src]||'📄'} ${disp} ${secStatusBadge}</div>
            <div class="wro-collapse-icon">▼</div>
          </div>
          <div class="wro-cards-grid">
            ${todoCards.join('')}
            ${todoCards.length === 0 && knownCards.length > 0
              ? `<div class="wro-all-known">✅ Wszystkie wpisy w tej sekcji oznaczone jako znane — kliknij poniżej aby zobaczyć</div>` : ''}
          </div>
          ${knownSection}
        </div>
      `;
    });

    html += '</div>';
    showContent(html);

    // Scrolluj do sekcji jeśli podano
    if (scrollToSection) {
      setTimeout(() => {
        const el = document.getElementById('wro-sec-' + scrollToSection);
        if (el) { el.classList.remove('collapsed'); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }, 80);
    }

    // Przenieś do Arkusza — przycisk "Otwórz w Arkuszu"
    addArkuszLink(id);
  }

  function addArkuszLink(id) {
    const header = document.querySelector('.wro-entity-actions');
    if (!header) return;
    if (header.querySelector('.wro-btn-arkusz')) return;
    const btn = document.createElement('button');
    btn.className = 'wro-btn wro-btn-arkusz';
    btn.title = 'Znajdź tę osobę w Arkuszu';
    btn.innerHTML = '📋 Otwórz w Arkuszu';
    btn.onclick = () => Router.navigate('arkusz', { pesel: id, nip: id });
    header.insertBefore(btn, header.firstChild);
  }

  function showContent(html) {
    const content = document.getElementById('wro-content');
    if (content) { content.innerHTML = html; content.scrollTop = 0; }
  }

  function toggleStatus(id) {
    const analyzed = getAnalyzed();
    if (analyzed.has(id)) analyzed.delete(id);
    else analyzed.add(id);
    setAnalyzed(analyzed);

    // Aktualizuj SharedStore dla Arkusza
    const statusMap = SharedStore.get(SharedStore.KEYS.WRO_STATUS, {});
    statusMap[id] = analyzed.has(id) ? 'analyzed' : 'pending';
    SharedStore.set(SharedStore.KEYS.WRO_STATUS, statusMap);

    renderList(document.getElementById('wro-search')?.value || '');
    if (currentActiveId === id) renderEntityContent(id, null);
    showToast(analyzed.has(id) ? '✅ Oznaczono jako załatwione' : '↩️ Cofnięto status', 'info');
  }

  function toggleCart(id) {
    const cart = getCart();
    if (cart.has(id)) cart.delete(id);
    else cart.add(id);
    setCart(cart);
    updateCartCounter();
    renderList(document.getElementById('wro-search')?.value || '');
    if (currentActiveId === id) renderEntityContent(id, null);
  }

  function updateCartCounter() {
    const el = document.getElementById('wro-cart-counter');
    if (el) el.textContent = getCart().size;
  }

  function renderCart() {
    currentActiveId = null;
    const cart = getCart();

    if (!cart.size) {
      showContent(`<div class="wro-empty-state">
        <div class="wro-empty-card">
          <div class="wro-empty-icon">🛒</div>
          <h3>Koszyk jest pusty</h3>
          <p>Dodaj osoby do koszyka za pomocą przycisku w profilu.</p>
        </div>
      </div>`);
      return;
    }

    let html = `
      <div class="wro-entity-wrap">
        <div class="wro-entity-header">
          <h2 class="wro-entity-title">🛒 Koszyk — Matryca Wyników (${cart.size} osób)</h2>
          <div class="wro-entity-actions">
            <button class="wro-btn wro-btn-red" onclick="WroModule.clearCart()">🗑️ Opróżnij</button>
            <button class="wro-btn wro-btn-green" onclick="WroModule.exportMatrixCSV()">📥 Eksportuj CSV</button>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table class="wro-matrix-table">
            <thead>
              <tr>
                <th style="text-align:left;min-width:200px">Podmiot</th>
                <th>NIP</th>
                <th>PESEL</th>
                ${matrixColumns.map(c => `<th>${icons[c]||''} ${c.replace('Kontrahenci: ','').replace('Wynik: ','')}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${[...cart].map(id => {
                const d = bazaDanych[id];
                if (!d) return `<tr><td class="wro-name-col" colspan="${3+matrixColumns.length}">${id} <small>(brak w bazie)</small></td></tr>`;
                const a3 = d._meta?.a3 || '—';
                const b3 = d._meta?.b3 || '—';
                return `<tr>
                  <td class="wro-name-col" onclick="WroModule.selectFromCart('${id}')" style="cursor:pointer">${id}</td>
                  <td class="wro-matrix-id">${a3}</td>
                  <td class="wro-matrix-id">${b3}</td>
                  ${matrixColumns.map(col =>
                    d[col] && d[col].length > 1
                      ? `<td class="matrix-v">✓</td>`
                      : `<td class="matrix-x">✗</td>`
                  ).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    showContent(html);
  }

  function selectFromCart(id) {
    currentActiveId = id;
    renderEntityContent(id, null);
  }

  function clearCart() {
    if (!confirm('Opróżnić cały koszyk?')) return;
    setCart(new Set());
    updateCartCounter();
    renderCart();
  }

  function exportProgress() {
    const data = JSON.stringify({
      analyzed: [...getAnalyzed()],
      cart: [...getCart()],
      annotations: loadAnnotations()
    });
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `WRO_Postep_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  }

  function openAnnotPopover(event, bid) {
    _currentAnnotBid = bid;
    const ctx = _annotBtnCtx[bid];
    if (!ctx) return;

    let pop = document.getElementById('wro-annot-pop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'wro-annot-pop';
      pop.className = 'wro-annot-pop';
      document.body.appendChild(pop);
    }

    const current = getAnnotation(ctx.pk, ctx.sec, ctx.iid);
    const isTodo = !current || !current.status || current.status === 'todo';
    const isDone = current?.status === 'done';
    const isExcl = current?.status === 'excluded';

    pop.innerHTML = `
      <div class="wro-ap-title">Status wpisu</div>
      <div class="wro-ap-options">
        <button class="wro-ap-opt${isTodo ? ' active' : ''}" onclick="WroModule.setAnnotStatus(null)">📋 Do zajęcia (brak statusu)</button>
        <button class="wro-ap-opt${isDone ? ' active' : ''}" onclick="WroModule.setAnnotStatus('done')">✅ Zrobione</button>
        <button class="wro-ap-opt${isExcl ? ' active' : ''}" onclick="WroModule.showAnnotExcludeForm()">⛔ Wykluczone…</button>
      </div>
      <div id="wro-ap-excl-form" style="display:${isExcl ? 'block' : 'none'}">
        <div class="wro-ap-label">Powód wykluczenia:</div>
        <select id="wro-ap-reason-sel" class="wro-ap-sel">
          <option value="">— wybierz —</option>
          <option value="Zajęte przez inny organ">Zajęte przez inny organ</option>
          <option value="Brak salda">Brak salda</option>
          <option value="Konto zamknięte">Konto zamknięte</option>
          <option value="Przedawnione">Przedawnione</option>
          <option value="Inne">Inne</option>
        </select>
        <input type="text" id="wro-ap-reason-txt" class="wro-ap-inp" placeholder="lub wpisz własny powód…" value="${isExcl && current.reason ? escWro(current.reason) : ''}">
        <button class="wro-ap-confirm" onclick="WroModule.setAnnotStatus('excluded')">Zapisz wykluczenie</button>
      </div>
      <button class="wro-ap-close-btn" onclick="document.getElementById('wro-annot-pop').style.display='none'">✕ Zamknij</button>
    `;

    if (isExcl && current.reason) {
      setTimeout(() => {
        const sel = document.getElementById('wro-ap-reason-sel');
        if (sel) {
          const opt = [...sel.options].find(o => o.value === current.reason);
          if (opt) sel.value = current.reason;
        }
      }, 0);
    }

    const rect = event.currentTarget.getBoundingClientRect();
    pop.style.display = 'block';
    pop.style.top  = (rect.bottom + 4) + 'px';
    pop.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 280)) + 'px';
    event.stopPropagation();
  }

  function showAnnotExcludeForm() {
    const form = document.getElementById('wro-ap-excl-form');
    if (form) form.style.display = 'block';
  }

  function setAnnotStatus(status) {
    if (!_currentAnnotBid) return;
    const ctx = _annotBtnCtx[_currentAnnotBid];
    if (!ctx) return;

    let data = null;
    if (status === 'done') {
      data = { status: 'done' };
    } else if (status === 'excluded') {
      const sel = document.getElementById('wro-ap-reason-sel');
      const txt = document.getElementById('wro-ap-reason-txt');
      const reason = (txt && txt.value.trim()) || (sel && sel.value !== '' ? sel.value : '') || '';
      data = { status: 'excluded', reason };
    }

    setAnnotationData(ctx.pk, ctx.sec, ctx.iid, data);

    const pop = document.getElementById('wro-annot-pop');
    if (pop) pop.style.display = 'none';

    if (currentActiveId) renderEntityContent(currentActiveId, null);
    showToast(
      status === 'done' ? '✅ Oznaczono jako zrobione' :
      status === 'excluded' ? '⛔ Oznaczono jako wykluczone' :
      '📋 Status usunięty', 'info'
    );
  }

  function exportMatrixCSV() {
    const cart = getCart();
    let csv = '\uFEFF';
    csv += ['Podmiot','NIP','PESEL', ...matrixColumns.map(c => c.replace('Wynik: ',''))].join(';') + '\n';
    cart.forEach(id => {
      const d = bazaDanych[id];
      if (!d) return;
      const a3 = d._meta?.a3 || '';
      const b3 = d._meta?.b3 || '';
      const cols = matrixColumns.map(col => (d[col] && d[col].length > 1) ? 'V' : 'X');
      csv += [id, a3, b3, ...cols].join(';') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Matryca_WRO_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  function expandAll()   { document.querySelectorAll('.wro-source-block').forEach(el => el.classList.remove('collapsed')); }
  function collapseAll() { document.querySelectorAll('.wro-source-block').forEach(el => el.classList.add('collapsed')); }

  function digitsId(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function findEntityKey(pesel, nip, name) {
    const db = bazaDanych || window.WroDatabase;
    if (!db) return null;
    const tries = [pesel, nip, digitsId(pesel), digitsId(nip)].filter(Boolean);
    for (const t of tries) {
      if (db[t]) return t;
      const d = digitsId(t);
      if (d && _lookupIndex && _lookupIndex[d]) return _lookupIndex[d];
    }
    const want = new Set(tries.map(digitsId).filter(d => d.length >= 10));
    const nameLc = String(name || '').trim().toLowerCase();
    if (nameLc && db[name]) return name;
    if (!want.size && !nameLc) return null;
    const keys = Object.keys(db);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const ent = db[k];
      if (!ent) continue;
      const meta = ent._meta || {};
      const a3 = digitsId(meta.a3);
      const b3 = digitsId(meta.b3);
      if ((a3 && want.has(a3)) || (b3 && want.has(b3)) || want.has(digitsId(k))) return k;
      if (nameLc && String(k).trim().toLowerCase() === nameLc) return k;
    }
    return null;
  }

  function sourcePreview(src, rows) {
    const n = Math.max(0, (rows || []).length - 1);
    if (!n) return null;
    const headers = rows[0] || [];
    let idx = headers.findIndex(h => /bank|nazwa|adres|nieruch|rachun|iban|marka|vin|kwota|opis|kw\b/i.test(String(h || '')));
    if (idx < 0) {
      idx = headers.findIndex((_, c) => rows.slice(1).some(r => String(r[c] || '').trim()));
    }
    if (idx < 0) idx = 0;
    const vals = [];
    for (let i = 1; i < rows.length; i++) {
      const v = String(rows[i][idx] || '').trim();
      if (v && !vals.includes(v)) vals.push(v);
    }
    return {
      count: n,
      line: vals.slice(0, 3).join(' · ') + (vals.length > 3 ? '…' : '')
    };
  }

  function getAssetSummaryForPerson(pesel, nip, name) {
    const entityId = findEntityKey(pesel, nip, name);
    const items = [];
    const order = [
      ['Wynik: OGNIVO', 'OGNIVO', '🏦'],
      ['Wynik: AUM', 'AUM', '🎯'],
      ['STIR', 'STIR', '🏦'],
      ['Księgi Wieczyste', 'Księgi wieczyste', '🏢'],
      ['Dochody', 'Dochody', '💰'],
      ['Przychód', 'Przychód', '📈'],
      ['UFG CEPIK', 'Pojazdy', '🚗'],
      ['Kontrahenci: SPRZEDAŻ', 'Sprzedaż', '🛒'],
      ['Kontrahenci: ZAKUP', 'Zakup', '🛍️'],
      ['Wynik: JPK', 'JPK', '⚡'],
      ['Raporter', 'Raporter', '📊'],
      ['CRCM', 'CRCM', '📋'],
    ];
    const data = entityId ? (bazaDanych[entityId] || null) : null;
    if (data) {
      order.forEach(([key, label, icon]) => {
        const rows = data[key];
        if (!rows || rows.length <= 1) return;
        const prev = sourcePreview(key, rows);
        if (!prev) return;
        items.push({
          key, label, icon,
          count: prev.count,
          line: prev.line,
          section: key.replace(/[^a-zA-Z0-9]/g, '')
        });
      });
    }
    try {
      const ognivoData = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
      const entry = ognivoData[pesel] || ognivoData[nip] || ognivoData[digitsId(pesel)] || ognivoData[digitsId(nip)] || (entityId && ognivoData[entityId]);
      if (entry && Array.isArray(entry.banks) && entry.banks.length && !items.some(i => i.key === 'Wynik: OGNIVO')) {
        items.unshift({
          key: 'Wynik: OGNIVO', label: 'OGNIVO', icon: '🏦',
          count: entry.banks.length,
          line: entry.banks.join(' · '),
          section: 'WynikOGNIVO'
        });
      }
    } catch {}
    return { found: !!data || items.length > 0, entityId, items };
  }

  function activate(params = {}) {
    if (!activated) { activated = true; }
    tryLoadPersistedBaza();
    const live = document.getElementById('wro-list');
    if (!live) render();

    if (params.pesel || params.nip) {
      const id = findEntityKey(params.pesel, params.nip) || params.pesel || params.nip;
      if (bazaDanych[id]) {
        const sec = params.section ? String(params.section).replace(/[^a-zA-Z0-9]/g, '') : null;
        setTimeout(() => selectEntity(id, sec), 40);
      } else {
        showToast('ℹ️ Brak tej osoby w bazie WRO — wczytaj plik bazy', 'info');
      }
    }
  }

  function isZawieszonaWro(id, a3, b3) {
    try {
      const map = (typeof SharedStore !== 'undefined') ? SharedStore.get(SharedStore.KEYS.ZAWIESZONE, {}) : {};
      if (!map || typeof map !== 'object') return false;
      const keys = [id, a3, b3].filter(Boolean).map(v => String(v).replace(/\D/g, '') || String(v));
      return keys.some(k => k && map[k]);
    } catch { return false; }
  }

  function normVin(v) {
    return String(v || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }
  function normPlate(v) {
    return String(v || '').replace(/[\s\-]/g, '').toUpperCase();
  }
  function pickRicher(a, b) {
    const av = String(a || '').trim();
    const bv = String(b || '').trim();
    if (av && bv) return av.length >= bv.length ? av : bv;
    return av || bv;
  }
  function vehicleLabel(v, i) {
    if (v.brand && v.plate) return `${v.brand} (${v.plate})`;
    if (v.plate) return `Pojazd (${v.plate})`;
    if (v.brand) return v.brand;
    if (v.vin) return `VIN: ${v.vin}`;
    return `Pojazd #${i || ''}`;
  }
  function sameVehicle(a, b) {
    const va = normVin(a.vin), vb = normVin(b.vin);
    if (va.length >= 8 && vb.length >= 8) return va === vb;
    const pa = normPlate(a.plate), pb = normPlate(b.plate);
    if (pa.length >= 4 && pb.length >= 4) return pa === pb;
    return false;
  }
  function mergeVehicleFields(a, b) {
    const map = new Map();
    const add = (headers, raw) => {
      (headers || []).forEach((h, i) => {
        const key = String(h || '').trim();
        const val = raw ? String(raw[i] ?? '').trim() : '';
        if (!key && !val) return;
        const k = (key || 'pole').toLowerCase();
        const prev = map.get(k);
        if (!prev) map.set(k, { h: key || 'Pole', val });
        else if (val && prev.val && val !== prev.val && !prev.val.includes(val)) prev.val = prev.val + ' · ' + val;
        else if (val && !prev.val) prev.val = val;
      });
    };
    add(a.headers, a.raw);
    add(b.headers, b.raw);
    const headers = [...map.values()].map(x => x.h);
    const raw = [...map.values()].map(x => x.val);
    const merged = {
      brand: pickRicher(a.brand, b.brand),
      plate: pickRicher(a.plate, b.plate),
      vin: pickRicher(a.vin, b.vin),
      polisa: pickRicher(a.polisa, b.polisa),
      year: pickRicher(a.year, b.year),
      raw, headers
    };
    merged.label = vehicleLabel(merged);
    return merged;
  }
  function dedupeVehicles(list) {
    const out = [];
    (list || []).forEach(v => {
      const i = out.findIndex(x => sameVehicle(x, v));
      if (i >= 0) out[i] = mergeVehicleFields(out[i], v);
      else out.push(v);
    });
    return out;
  }

  function getCepikInfoForId(id) {
    const db = bazaDanych || window.WroDatabase;
    if (!id || !db) return null;
    const clean = String(id).replace(/\D/g, '');
    if (!clean && typeof id !== 'string') return null;

    let entity = db[id] || (clean ? db[clean] : null);
    if (!entity && clean && _lookupIndex && _lookupIndex[clean]) {
      entity = db[_lookupIndex[clean]];
    }
    if (!entity && clean) {
      const mapped = _lookupIndex && _lookupIndex[clean];
      if (mapped) entity = db[mapped];
    }
    if (!entity || !entity['UFG CEPIK'] || entity['UFG CEPIK'].length <= 1) {
      return null;
    }

    const rows = entity['UFG CEPIK'];
    const headers = rows[0] || [];
    
    const brandIdx = headers.findIndex(h => /marka|model|pojazd|opis|typ/i.test(h));
    const yearIdx = headers.findIndex(h => /rok|rocznik|data.*rej|pierwsz.*rej|rok.*prod/i.test(h));
    const plateIdx = headers.findIndex(h => /rejestr|nr.*rej|tablica|rejestracj/i.test(h));
    const vinIdx = headers.findIndex(h => /vin/i.test(h));
    const polisaIdx = headers.findIndex(h => /polisa|ubezpiecz/i.test(h));

    const vehicles = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const brand = brandIdx >= 0 ? String(r[brandIdx] || '').trim() : '';
      const yearRaw = yearIdx >= 0 ? String(r[yearIdx] || '').trim() : '';
      const year = (yearRaw.match(/(?:19|20)\d{2}/) || [yearRaw])[0];
      const plate = plateIdx >= 0 ? String(r[plateIdx] || '').trim() : '';
      const vin = vinIdx >= 0 ? String(r[vinIdx] || '').trim() : '';
      const polisa = polisaIdx >= 0 ? String(r[polisaIdx] || '').trim() : '';

      if (!brand && !plate && !vin) continue;

      vehicles.push({
        label: vehicleLabel({ brand, plate, vin }, i),
        brand, plate, vin, polisa, year, raw: r, headers
      });
    }

    const uniqueVehicles = dedupeVehicles(vehicles);

    const today = new Date();
    const todayShort = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}`;
    const summaryText = uniqueVehicles.map(v => v.label).join(', ');
    const formattedNote = uniqueVehicles.length > 0 ? `[CEPIK ${todayShort}: ${summaryText}]` : `[CEPIK ${todayShort}: Brak pojazdów]`;

    return {
      hasVehicles: uniqueVehicles.length > 0,
      vehicles: uniqueVehicles,
      summaryText,
      formattedNote,
      headers,
      rawRows: rows
    };
  }

  function openInSzafka(id) {
    const view = resolveEntityView(id);
    const pesel = (view.person && view.person.pesel) || view.b3;
    const nip = (view.person && view.person.nip) || view.a3;
    if (!pesel && !nip) {
      if (typeof showToast === 'function') showToast('Brak PESEL/NIP do otwarcia teczki', 'info', 2500);
      return;
    }
    if (typeof Router !== 'undefined') Router.navigate('zobowiazani', { pesel, nip });
  }

  function getBazaDanych() { return bazaDanych; }

  return {
    activate, selectEntity, selectFromCart,
    toggleStatus, toggleCart, updateCartCounter,
    renderCart, clearCart, exportProgress, exportMatrixCSV,
    expandAll, collapseAll,
    getCepikInfoForId, getAssetSummaryForPerson, findEntityKey,
    getBazaDanych, importBazaDanych, mergeWynikSection, runZrzutnia, buildBazaFromFolder, openInSzafka,
    openAnnotPopover, showAnnotExcludeForm, setAnnotStatus,
    setMinDochod,
    syncToSzafka, reviewGoneQueue, goneDecision,
    jumpToMissingEntity, filterMissingFolders,
    getAnnotation, setAnnotationData,
    getMajatekSnapshot, personHasSection, hasPendingItemsForKey,
    getPendingGoneCount, getSourceCatalog, getPersonWroFlags,
  };
})();

window.WroModule = WroModule;

function copyText(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = el.innerHTML;
    el.innerHTML = '✅ <strong>Skopiowano!</strong>';
    el.style.background = '#10b981';
    el.style.color = '#fff';
    setTimeout(() => { el.innerHTML = orig; el.style = ''; }, 1400);
  });
}
