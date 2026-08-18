/* ============================================================
   Egzebiurko 3.0 — zobowiazani.js
   Szafka teczek: lista osób + otwarta teczka (Dane / Systemy / CEPIK / Notatka)
   Synchronizacja CEPIK / UFG z modułem Analityka WRO
   ============================================================ */

'use strict';

const ZobowiazaniModule = (() => {

  const AUTOSAVE_KEY = 'ots_autosave_v1';
  const REG_SYSTEMS = ['KAWA', 'SINF', 'UFG', 'JPK', 'INFZ'];
  const DEFER_COL = 'Wróć';
  const SUSPEND_COL = 'Zawieszone';
  const FILE_SOURCE_KEY = 'egze3_zob_file_source';
  const DESK_PINS_KEY = 'egze3_desk_pins';
  const ARCHIVE_IDS_KEY = 'egze3_archive_ids';
  const OPEN_TABS_KEY = 'egze3_open_tabs';

  let activated = false;
  let dbData = null;
  let dbSheet = null;
  let dbSheetIndex = -1;
  let dataSourceLabel = ''; // 'Arkusz' | 'localStorage' | nazwa pliku
  
  // Stan filtrów i widoku
  let filterText = '';
  let activeFilter = 'all'; // 'all', 'todo', 'progress', 'complete', 'deferred', 'due', 'has_cepik', 'no_*'
  let sectionFilter = 'active'; // 'active' | 'desk' | 'archive' | 'suspended'
  let sortCol = 'idx';
  let sortDir = 1;
  let selectedRowIndex = 0;
  /** @type {'list'|'split'|'focus'} */
  let viewMode = 'list';
  /** @type {{key:string, rowIndex:number, name:string}[]} */
  let openTabs = [];
  let activeTabKey = '';
  let detailTab = 'dane'; // 'dane' | 'systemy' | 'cepik' | 'majatek' | 'notatka'
  let filtersOpen = false;
  let dbErrorMsg = '';
  let folderAnimToken = 0;
  let deskPins = loadJsonKey(DESK_PINS_KEY, []);
  let archiveMap = loadJsonKey(ARCHIVE_IDS_KEY, {});
  if (!Array.isArray(deskPins)) deskPins = [];
  if (!archiveMap || typeof archiveMap !== 'object' || Array.isArray(archiveMap)) archiveMap = {};
  /** @type {Set<string>} PESEL/NIP dodane ostatnim „Dodaj do bazy” */
  let freshKeys = new Set();
  let _filterCache = { key: '', rows: null };
  let _personColCache = { sheet: null, len: -1, map: null };
  let _virtBound = false;
  let _virtRaf = 0;
  let minDochodFilter = 0;
  let _wroItemCtx = {};
  let _wroItemSeq = 0;
  restoreOpenTabs();

  function invalidateListCache() {
    _filterCache = { key: '', rows: null };
    _personColCache = { sheet: null, len: -1, map: null };
  }

  function loadJsonKey(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function saveJsonKey(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function restoreOpenTabs() {
    const saved = loadJsonKey(OPEN_TABS_KEY, null);
    if (!saved || !Array.isArray(saved.tabs)) return;
    openTabs = saved.tabs.map(t => ({
      key: String(t.key || ''),
      rowIndex: Number(t.rowIndex) || 0,
      name: String(t.name || 'Teczka'),
    })).filter(t => t.key);
    activeTabKey = String(saved.active || (openTabs[0] && openTabs[0].key) || '');
    if (openTabs.length && activeTabKey) {
      const t = openTabs.find(x => x.key === activeTabKey) || openTabs[0];
      selectedRowIndex = t.rowIndex;
      viewMode = 'split';
    }
  }

  function persistOpenTabs() {
    saveJsonKey(OPEN_TABS_KEY, { tabs: openTabs, active: activeTabKey });
  }

  function persistDeskPins() {
    saveJsonKey(DESK_PINS_KEY, deskPins);
  }

  function persistArchive() {
    saveJsonKey(ARCHIVE_IDS_KEY, archiveMap);
  }

  function personKeyFromInfo(info) {
    const id = String(info.pesel || info.nip || '').replace(/\D/g, '');
    if (id) return id;
    return 'row:' + String(info.name || '').trim().toLowerCase();
  }

  function personKeyFromRow(row) {
    return personKeyFromInfo(extractPersonInfo(row));
  }

  function isPinned(key) {
    return deskPins.includes(key);
  }

  function isArchived(key) {
    return !!(archiveMap && archiveMap[key]);
  }

  function rowStan(row) {
    if (!dbSheet || !row) return '';
    const ci = dbSheet.columns.indexOf('Stan');
    return ci >= 0 ? String(row[ci] || '').trim() : '';
  }

  function rowZawieszone(row) {
    if (!dbSheet || !row) return '';
    const ci = dbSheet.columns.indexOf(SUSPEND_COL);
    if (ci >= 0) {
      const v = String(row[ci] || '').trim();
      if (v) return v;
    }
    return /^zawiesz/i.test(rowStan(row)) ? rowStan(row) : '';
  }

  function isSuspendedRow(row) {
    return !!rowZawieszone(row);
  }

  function persistZawieszoneStore() {
    if (typeof SharedStore === 'undefined' || !dbSheet) return;
    const map = {};
    const at = new Date().toISOString();
    dbSheet.rows.forEach(r => {
      if (!isSuspendedRow(r)) return;
      const info = extractPersonInfo(r);
      const rec = { at, name: info.name || '' };
      const keys = [
        personKeyFromInfo(info),
        String(info.pesel || '').replace(/\D/g, ''),
        String(info.nip || '').replace(/\D/g, ''),
      ].filter(Boolean);
      keys.forEach(k => { map[k] = rec; });
    });
    SharedStore.set(SharedStore.KEYS.ZAWIESZONE, map);
  }

  function getLastActivity(row) {
    if (!dbSheet || !row) return '';
    let best = null;
    let bestRaw = '';
    REG_SYSTEMS.forEach(sys => {
      const idx = dbSheet.columns.indexOf(sys);
      if (idx < 0) return;
      const raw = String(row[idx] || '').trim();
      if (!raw || raw.toLowerCase() === 'pomiń') return;
      const d = parseDatePl(raw);
      if (d && (!best || d > best)) {
        best = d;
        bestRaw = raw;
      } else if (!d && !bestRaw) {
        bestRaw = raw;
      }
    });
    const defer = getDeferInfo(row);
    if (defer && defer.date && (!best || defer.date > best)) {
      best = defer.date;
      bestRaw = defer.raw;
    }
    return bestRaw || (best ? best.toLocaleDateString('pl-PL') : '');
  }

  /* ─── NORMALIZACJA / WYBÓR ARKUSZA ─────────────────────── */
  function normalizeToDbData(parsed) {
    if (!parsed) throw new Error('Pusty plik');

    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }

    if (parsed && Array.isArray(parsed.sheets)) {
      return parsed;
    }

    if (parsed && Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
      return {
        sheets: [{
          name: parsed.name || 'Zobowiązani',
          columns: parsed.columns,
          rows: parsed.rows,
          widths: parsed.widths,
          visible: parsed.visible,
          order: parsed.order,
        }],
        savedAt: new Date().toISOString(),
      };
    }

    if (Array.isArray(parsed) && parsed.length) {
      if (typeof parsed[0] === 'object' && !Array.isArray(parsed[0])) {
        const columns = Array.from(parsed.reduce((set, row) => {
          Object.keys(row || {}).forEach(k => set.add(k));
          return set;
        }, new Set()));
        const rows = parsed.map(obj => columns.map(c => (obj && obj[c] != null ? obj[c] : '')));
        return {
          sheets: [{ name: 'Zobowiązani', columns, rows }],
          savedAt: new Date().toISOString(),
        };
      }
      if (Array.isArray(parsed[0])) {
        const columns = parsed[0].map(c => String(c ?? ''));
        const rows = parsed.slice(1).map(r => {
          const row = Array.isArray(r) ? r.slice() : [];
          while (row.length < columns.length) row.push('');
          return row;
        });
        return {
          sheets: [{ name: 'Zobowiązani', columns, rows }],
          savedAt: new Date().toISOString(),
        };
      }
    }

    throw new Error('Nieznany format JSON (oczekiwano sheets[] / columns+rows / tablicy obiektów)');
  }

  function parseLooseJsonText(text) {
    let t = String(text || '').trim();
    if (!t) throw new Error('Plik jest pusty');

    // Pliki .js typu: const baza = {...};  lub  module.exports = {...}
    if (t.charAt(0) !== '{' && t.charAt(0) !== '[') {
      const assign = t.match(/=\s*([\[{][\s\S]*)$/);
      if (assign) t = assign[1].replace(/;?\s*$/, '');
      else {
        const firstBrace = t.search(/[\[{]/);
        if (firstBrace >= 0) t = t.slice(firstBrace).replace(/;?\s*$/, '');
      }
    }

    return JSON.parse(t);
  }

  function selectBestSheet(data) {
    if (!data || !Array.isArray(data.sheets) || !data.sheets.length) return false;

    // 1) Dokładna nazwa bazy Zobowiązani / Rejestr — nawet pusta (tryb Z bazą)
    let bestIndex = data.sheets.findIndex(s => {
      const n = String(s.name || '').trim().toLowerCase();
      return n === 'zobowiązani' || n === 'rejestr';
    });

    // 2) Nazwa zawiera „zobowiązani”
    if (bestIndex < 0) {
      bestIndex = data.sheets.findIndex(s => String(s.name || '').toLowerCase().includes('zobowiązani'));
    }

    // 3) Arkusz z PESEL/NIP — najwięcej wierszy
    if (bestIndex < 0) {
      let maxRows = -1;
      data.sheets.forEach((s, idx) => {
        const hasId = s.columns && s.columns.some(c => /pesel/i.test(String(c)) || /nip/i.test(String(c)));
        if (!hasId) return;
        const rowCount = (s.rows || []).length;
        if (rowCount > maxRows) {
          maxRows = rowCount;
          bestIndex = idx;
        }
      });
    }

    // 4) Największy arkusz
    if (bestIndex < 0) {
      let maxRows = -1;
      data.sheets.forEach((s, idx) => {
        const rowCount = (s.rows || []).length;
        if (rowCount > maxRows) {
          maxRows = rowCount;
          bestIndex = idx;
        }
      });
    }

    if (bestIndex < 0) return false;

    dbData = data;
    dbSheetIndex = bestIndex;
    dbSheet = dbData.sheets[dbSheetIndex];
    if (!Array.isArray(dbSheet.rows)) dbSheet.rows = [];
    if (!Array.isArray(dbSheet.columns)) dbSheet.columns = [];
    ensureSystemColumns(dbSheet);
    invalidateListCache();
    return true;
  }

  function persistLocal() {
    if (!dbData) return;
    try {
      dbData.savedAt = new Date().toISOString();
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(dbData));
    } catch (e) {
      console.warn('[ZobowiazaniModule] localStorage save failed:', e);
    }
  }

  /* ─── SYNCHRONIZACJA Z ARKUSZEM / PLIKIEM ──────────────── */
  let _syncTimer = null;
  let _suppressSyncUntil = 0;
  let _syncInFlight = false;
  let _lastSyncedAt = '';
  let _ensureRegistryOnce = false;

  async function fetchDbFromArkusz(timeoutMs = 2500, opts = {}) {
    if (typeof ArkuszModule !== 'undefined') {
      ArkuszModule.ensureIframe();
    }

    const frame = document.getElementById('arkusz-frame');
    if (!frame) {
      throw new Error('Iframe arkusz-frame nie istnieje lub brak dostępu.');
    }

    if (!frame.contentWindow) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Timeout ładowania Arkusza')), Math.min(timeoutMs, 5000));
        frame.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    } else {
      await new Promise(r => setTimeout(r, 80));
    }

    // ENSURE_REGISTRY tylko raz / na żądanie — nie przy każdym odświeżeniu (pętla + miganie)
    if (opts.ensureRegistry || !_ensureRegistryOnce) {
      try {
        frame.contentWindow.postMessage({ type: 'ENSURE_REGISTRY', switchTo: false }, '*');
        _ensureRegistryOnce = true;
        await new Promise(r => setTimeout(r, 60));
      } catch {}
    }

    const raw = await new Promise((resolve, reject) => {
      let intervalId;
      let done = false;
      const finish = (fn, val) => {
        if (done) return;
        done = true;
        window.removeEventListener('message', handler);
        clearInterval(intervalId);
        fn(val);
      };
      const handler = (e) => {
        if (e.data && e.data.type === 'DB_DATA') finish(resolve, e.data.payload);
      };
      window.addEventListener('message', handler);

      const ping = () => {
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'GET_DB' }, '*');
        }
      };
      ping();
      intervalId = setInterval(ping, 400);

      setTimeout(() => {
        finish(reject, new Error('Brak odpowiedzi od Arkusza (timeout).'));
      }, timeoutMs);
    });

    if (!raw) throw new Error('Pusta odpowiedź z Arkusza');
    const parsed = normalizeToDbData(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (!selectBestSheet(parsed)) {
      throw new Error('Arkusz nie zawiera arkusza z danymi');
    }
    _lastSyncedAt = parsed.savedAt || '';
    invalidateListCache();
    return true;
  }

  async function loadDataAsync() {
    dbErrorMsg = '';

    try {
      await fetchDbFromArkusz(2500, { ensureRegistry: true });
      dataSourceLabel = 'Arkusz';
      try { localStorage.removeItem(FILE_SOURCE_KEY); } catch {}
      persistLocal();
      return true;
    } catch (e) {
      console.warn('[ZobowiazaniModule] Arkusz niedostępny:', e);
      dbErrorMsg = e.toString();
    }

    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const parsed = normalizeToDbData(JSON.parse(raw));
        if (selectBestSheet(parsed)) {
          dataSourceLabel = localStorage.getItem(FILE_SOURCE_KEY) || 'localStorage';
          return true;
        }
      }
    } catch (e) {
      console.warn('[ZobowiazaniModule] localStorage read failed:', e);
    }

    return false;
  }

  function scheduleSyncFromArkusz(reason) {
    if (!activated) return;
    if (Date.now() < _suppressSyncUntil) return;
    if (_syncInFlight) return;

    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      if (Date.now() < _suppressSyncUntil) return;
      if (_syncInFlight) return;
      _syncInFlight = true;
      try {
        const prevIdx = selectedRowIndex;
        const prevAt = _lastSyncedAt;
        await fetchDbFromArkusz(2000, { ensureRegistry: false });
        // Ten sam snapshot — nie przerysowuj (miganie)
        if (prevAt && _lastSyncedAt && prevAt === _lastSyncedAt && reason !== 'force') {
          return;
        }
        dataSourceLabel = 'Arkusz';
        if (dbSheet && prevIdx >= 0 && prevIdx < dbSheet.rows.length) {
          selectedRowIndex = prevIdx;
        }
        renderViews();
        updatePillsBar();
      } catch (e) {
        console.warn('[ZobowiazaniModule] sync refresh failed:', e);
      } finally {
        _syncInFlight = false;
      }
    }, 5000);
  }

  function bindArkuszSyncListeners() {
    if (bindArkuszSyncListeners._done) return;
    bindArkuszSyncListeners._done = true;

    window.addEventListener('message', (e) => {
      if (!e.data) return;
      if (e.data.type === 'EGZE_DB_UPDATED') {
        // Ignoruj echo własnego zapisu
        if (Date.now() < _suppressSyncUntil) return;
        if (e.data.savedAt && e.data.savedAt === _lastSyncedAt) return;
        scheduleSyncFromArkusz('arkusz');
      } else if (e.data.type === 'EGZE_WORK_MODE') {
        _ensureRegistryOnce = false;
        scheduleSyncFromArkusz('workmode');
      }
    });

    window.addEventListener('storage', (e) => {
      if (e.key === AUTOSAVE_KEY && Date.now() >= _suppressSyncUntil) {
        scheduleSyncFromArkusz('storage');
      }
    });
  }

  function loadFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Nie udało się odczytać pliku'));
      reader.onload = () => {
        try {
          const parsed = normalizeToDbData(parseLooseJsonText(reader.result));
          if (!selectBestSheet(parsed)) {
            reject(new Error('Plik nie zawiera żadnego arkusza / wierszy'));
            return;
          }
          dataSourceLabel = file.name || 'plik JSON';
          try { localStorage.setItem(FILE_SOURCE_KEY, dataSourceLabel); } catch {}
          persistLocal();

          // Spróbuj też odesłać do Arkusza, jeśli jest otwarty
          try {
            const frame = document.getElementById('arkusz-frame');
            if (frame && frame.contentWindow) {
              frame.contentWindow.postMessage({ type: 'SET_DB', payload: JSON.stringify(dbData) }, '*');
            }
          } catch {}

          resolve(true);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file, 'UTF-8');
    });
  }

  function triggerFilePicker() {
    let input = document.getElementById('zob-json-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'zob-json-input';
      input.accept = '.json,.js,.txt,application/json,text/plain';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        try {
          await loadFromFile(file);
          selectedRowIndex = 0;
          if (typeof showToast === 'function') {
            showToast(`Wczytano bazę: ${file.name} (${dbSheet.rows.length} wierszy)`, 'success', 3200);
          }
          await render();
        } catch (err) {
          console.error(err);
          if (typeof showToast === 'function') {
            showToast(`Błąd JSON: ${err.message || err}`, 'error', 4500);
          }
        }
      });
      document.body.appendChild(input);
    }
    input.click();
  }

  function ensureSystemColumns(sheet) {
    if (!sheet || !sheet.columns) return;
    const needed = [...REG_SYSTEMS, 'Stan', 'Komplet', 'Notatka', DEFER_COL, SUSPEND_COL];
    let added = false;
    needed.forEach(colName => {
      if (!sheet.columns.includes(colName)) {
        sheet.columns.push(colName);
        if (Array.isArray(sheet.widths)) sheet.widths.push(colName === 'Notatka' ? 220 : 100);
        if (Array.isArray(sheet.visible)) sheet.visible.push(true);
        if (Array.isArray(sheet.order)) sheet.order.push(sheet.columns.length - 1);
        added = true;
      }
    });
    if (added && Array.isArray(sheet.rows)) {
      sheet.rows.forEach(r => {
        while (r.length < sheet.columns.length) r.push('');
      });
    }
    migrateZawieszoneColumn(sheet);
  }

  function migrateZawieszoneColumn(sheet) {
    if (!sheet || !sheet.columns) return;
    const ciStan = sheet.columns.indexOf('Stan');
    const ciZ = sheet.columns.indexOf(SUSPEND_COL);
    if (ciStan < 0 || ciZ < 0 || !Array.isArray(sheet.rows)) return;
    sheet.rows.forEach((r, i) => {
      while (r.length < sheet.columns.length) r.push('');
      if (!/^zawiesz/i.test(String(r[ciStan] || ''))) return;
      if (!String(r[ciZ] || '').trim()) r[ciZ] = getTodayStr();
      r[ciStan] = '';
      if (sheet === dbSheet) recalcRowStatus(i, true);
    });
  }

  function formatDatePl(d) {
    return String(d.getDate()).padStart(2, '0') + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
  }

  function parseDatePl(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/);
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getDeferValue(row) {
    if (!dbSheet || !row) return '';
    const idx = dbSheet.columns.indexOf(DEFER_COL);
    if (idx < 0) return '';
    return String(row[idx] || '').trim();
  }

  function getDeferInfo(row) {
    const raw = getDeferValue(row);
    if (!raw) return null;
    const d = parseDatePl(raw);
    if (!d) return { raw, date: null, due: false, future: false };
    const today = todayStart();
    const due = d.getTime() <= today.getTime();
    return { raw, date: d, due, future: !due };
  }

  function setDeferDate(rowIndex, dateStr) {
    if (!dbSheet || !dbSheet.rows[rowIndex]) return;
    ensureSystemColumns(dbSheet);
    const idx = dbSheet.columns.indexOf(DEFER_COL);
    const row = dbSheet.rows[rowIndex];
    while (row.length < dbSheet.columns.length) row.push('');
    row[idx] = dateStr || '';
    saveData();
    renderViews();
  }

  function deferByDays(rowIndex, days) {
    const d = todayStart();
    d.setDate(d.getDate() + days);
    const label = formatDatePl(d);
    setDeferDate(rowIndex, label);
    closeDeferMenu();
    if (typeof showToast === 'function') {
      showToast(`Odłożono — wróć ${label}`, 'info', 2200);
    }
  }

  function deferPickDate(rowIndex) {
    const current = getDeferValue(dbSheet.rows[rowIndex]) || formatDatePl(todayStart());
    const ans = prompt('Data powrotu (DD.MM.RRRR):', current);
    if (ans == null) return;
    const trimmed = ans.trim();
    if (!trimmed) {
      clearDefer(rowIndex);
      return;
    }
    if (!parseDatePl(trimmed)) {
      if (typeof showToast === 'function') showToast('Zły format daty — użyj DD.MM.RRRR', 'warn', 2500);
      return;
    }
    setDeferDate(rowIndex, trimmed);
    closeDeferMenu();
    if (typeof showToast === 'function') showToast(`Przypomnienie: wróć ${trimmed}`, 'info', 2200);
  }

  function clearDefer(rowIndex) {
    setDeferDate(rowIndex, '');
    closeDeferMenu();
    if (typeof showToast === 'function') showToast('Zdjęto odłożenie', 'info', 1600);
  }

  function closeDeferMenu() {
    document.querySelectorAll('.zob-defer-pop').forEach(el => el.remove());
  }

  function openDeferMenu(rowIndex, ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    closeDeferMenu();
    if (!dbSheet || !dbSheet.rows[rowIndex]) return;
    const defer = getDeferInfo(dbSheet.rows[rowIndex]);
    const pop = document.createElement('div');
    pop.className = 'zob-defer-pop';
    pop.innerHTML = `
      <div class="zob-defer-pop-h">Odłóż / przypomnienie</div>
      <div class="zob-defer-actions">
        <button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.deferDays(${rowIndex}, 1)">+1 dzień</button>
        <button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.deferDays(${rowIndex}, 3)">+3 dni</button>
        <button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.deferDays(${rowIndex}, 7)">+7 dni</button>
        <button type="button" class="zob-action-btn primary" onclick="ZobowiazaniModule.deferPick(${rowIndex})">Wybierz datę</button>
        ${defer ? `<button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.clearDefer(${rowIndex})">Wyczyść</button>` : ''}
      </div>
    `;
    document.body.appendChild(pop);
    const pad = 8;
    let x = ev && ev.clientX != null ? ev.clientX : window.innerWidth / 2 - 110;
    let y = ev && ev.clientY != null ? ev.clientY : 120;
    if (ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect) {
      const r = ev.currentTarget.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 6;
    }
    pop.style.left = `${Math.max(pad, Math.min(x, window.innerWidth - pop.offsetWidth - pad))}px`;
    pop.style.top = `${Math.max(pad, Math.min(y, window.innerHeight - pop.offsetHeight - pad))}px`;
    const hide = (e) => {
      if (pop.contains(e.target)) return;
      closeDeferMenu();
      document.removeEventListener('mousedown', hide, true);
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') { closeDeferMenu(); document.removeEventListener('mousedown', hide, true); document.removeEventListener('keydown', onKey); } };
    setTimeout(() => {
      document.addEventListener('mousedown', hide, true);
      document.addEventListener('keydown', onKey);
    }, 0);
  }

  function saveData() {
    if (!dbData || !dbSheet) return;
    invalidateListCache();
    try {
      dbData.savedAt = new Date().toISOString();
      _lastSyncedAt = dbData.savedAt;
      // Blokuj echo sync na czas zapisu (wcześniej: SET_DB → reload → pusta baza / miganie)
      _suppressSyncUntil = Date.now() + 2500;
      persistZawieszoneStore();
      persistLocal();
      const frame = document.getElementById('arkusz-frame');
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'SET_DB', payload: JSON.stringify(dbData) }, '*');
      }
    } catch (e) {
      console.error('[ZobowiazaniModule] Błąd zapisu:', e);
      if (typeof showToast === 'function') showToast('Błąd zapisu bazy!', 'error');
    }
  }

  function getTodayStr() {
    const d = new Date();
    return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
  }

  function recalcRowStatus(ri, skipEnsure) {
    if (!dbSheet || !dbSheet.columns) return;
    const row = dbSheet.rows[ri];
    if (!skipEnsure) ensureSystemColumns(dbSheet);
    while (row.length < dbSheet.columns.length) row.push('');

    const ciStan = dbSheet.columns.indexOf('Stan');
    const ciKomplet = dbSheet.columns.indexOf('Komplet');

    let count = 0;
    REG_SYSTEMS.forEach(sys => {
      const idx = dbSheet.columns.indexOf(sys);
      if (idx >= 0 && row[idx] && String(row[idx]).trim() !== '' && String(row[idx]).trim().toLowerCase() !== 'pomiń') {
        count++;
      }
    });

    const isComplete = count === REG_SYSTEMS.length;
    
    if (ciKomplet >= 0) {
      row[ciKomplet] = isComplete ? getTodayStr() : '';
    }

    if (ciStan >= 0) {
      if (isComplete) row[ciStan] = 'Komplet';
      else if (count > 0) row[ciStan] = 'Częściowo';
      else row[ciStan] = 'Puste';
    }
  }

  function getPersonSysCount(row) {
    if (!dbSheet || !dbSheet.columns) return 0;
    let count = 0;
    REG_SYSTEMS.forEach(sys => {
      const idx = dbSheet.columns.indexOf(sys);
      if (idx >= 0 && row[idx] && String(row[idx]).trim() !== '' && String(row[idx]).trim().toLowerCase() !== 'pomiń') {
        count++;
      }
    });
    return count;
  }

  function toggleSystem(rowIndex, sysName) {
    if (!dbSheet) return;
    ensureSystemColumns(dbSheet);
    const sysColIdx = dbSheet.columns.indexOf(sysName);
    if (sysColIdx < 0) return;

    const row = dbSheet.rows[rowIndex];
    while (row.length < dbSheet.columns.length) row.push('');
    const curr = String(row[sysColIdx] || '').trim();
    
    if (curr === '') {
      row[sysColIdx] = getTodayStr();
    } else {
      row[sysColIdx] = '';
    }

    recalcRowStatus(rowIndex);
    saveData();
    renderViews();
  }

  function setAllSystems(rowIndex) {
    if (!dbSheet) return;
    ensureSystemColumns(dbSheet);
    const row = dbSheet.rows[rowIndex];
    const today = getTodayStr();
    while (row.length < dbSheet.columns.length) row.push('');

    REG_SYSTEMS.forEach(sys => {
      const idx = dbSheet.columns.indexOf(sys);
      if (idx >= 0) row[idx] = today;
    });

    recalcRowStatus(rowIndex);
    saveData();
    renderViews();
    if (typeof showToast === 'function') showToast('Oznaczono komplet dzisiaj ✨', 'info', 1500);
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function copyToClipboard(text, el) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      if (typeof showToast === 'function') {
        showToast(`Skopiowano: ${text}`, 'info', 1600);
      }
      if (el) {
        const orig = el.style.outline;
        el.style.outline = '2px solid var(--accent)';
        setTimeout(() => { el.style.outline = orig; }, 500);
      }
    });
  }

  /* ─── INTELIGENTNA EKSTRAKCJA DANYCH OSOBOWYCH ──────────── */
  function getPersonColMap() {
    const cols = (dbSheet && dbSheet.columns) || [];
    if (_personColCache.sheet === dbSheet && _personColCache.len === cols.length && _personColCache.map) {
      return _personColCache.map;
    }
    const find = (re) => cols.findIndex(c => re.test(String(c || '').trim()));
    const prefer = (exact, fuzzy) => {
      const a = find(exact);
      return a >= 0 ? a : find(fuzzy);
    };
    const nameColPatterns = [
      /nazwisko.*i.*imi[eę]/i,
      /imi[eę].*i.*nazwisko/i,
      /dane.*osob/i,
      /zobowi[aą]zan/i,
      /d[lł]u[zż]nik/i,
      /podmiot/i,
      /kontrahent/i,
      /klient/i,
      /uczestnik/i,
      /strona/i,
      /^nazwa$/i,
      /nazwa.*podmiotu/i,
      /nazwa.*d[lł]u[zż]nika/i,
      /nazwa/i
    ];
    const skipName = new Set();
    cols.forEach((c, i) => {
      const cName = String(c || '').trim();
      if (REG_SYSTEMS.includes(cName) || ['Stan', 'Komplet', 'LP', 'L.p.', 'Lp', 'ID', 'Notatka', DEFER_COL, SUSPEND_COL].includes(cName)) {
        skipName.add(i);
      } else if (/pesel|nip|regon|data|kwota|sygn|stan|komplet|notatk/i.test(cName)) {
        skipName.add(i);
      }
    });
    const map = {
      pesel: prefer(/^pesel$/i, /pesel/i),
      nip: prefer(/^nip$/i, /nip/i),
      regon: prefer(/^regon$/i, /regon/i),
      nameIdxs: nameColPatterns.map(find),
      nazwisko: prefer(/^nazwisko$/i, /nazwisko/i),
      imie: prefer(/^imi[eę]$/i, /imi[eę]/i),
      ulica: prefer(/^(ulica|adres|ul\.|zamieszkanie|adres.*zamieszkania|siedziba)$/i, /ulica|adres|zamieszk/i),
      miasto: prefer(/^(miasto|miejscowo[sś][cć])$/i, /miejscowo[sś][cć]|miasto/i),
      kod: prefer(/^(kod|kod.*pocztowy|poczta)$/i, /kod/i),
      kwota: find(/kwota|nale[zż]no[sś][cć]|zad[lł]u[zż]enie|suma/i),
      sygn: find(/sygnatura|sygn|sprawa|nr.*sprawy/i),
      notatka: prefer(/^notatka$/i, /notatk/i),
      stan: cols.indexOf('Stan'),
      skipName,
      colCount: cols.length,
    };
    _personColCache = { sheet: dbSheet, len: cols.length, map };
    return map;
  }

  function extractPersonInfo(row) {
    const cols = dbSheet.columns || [];
    const cmap = getPersonColMap();
    const getColVal = (idx) => {
      return (idx >= 0 && idx < row.length) ? String(row[idx] || '').trim() : '';
    };

    const pesel = getColVal(cmap.pesel);
    const nip = getColVal(cmap.nip);
    const regon = getColVal(cmap.regon);

    let name = '';
    for (let i = 0; i < cmap.nameIdxs.length; i++) {
      const idx = cmap.nameIdxs[i];
      if (idx < 0) continue;
      const val = getColVal(idx);
      if (val) { name = val; break; }
    }

    if (!name) {
      const nVal = getColVal(cmap.nazwisko);
      const iVal = getColVal(cmap.imie);
      if (nVal || iVal) name = `${nVal} ${iVal}`.trim();
    }

    if (!name) {
      for (let i = 0; i < cols.length; i++) {
        if (cmap.skipName.has(i)) continue;
        const val = getColVal(i);
        if (val && /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{2,}/.test(val) && !/^\d{2}[.-]\d{2}[.-]\d{4}$/.test(val)) {
          name = val;
          break;
        }
      }
    }

    if (!name) {
      name = pesel ? `PESEL: ${pesel}` : (nip ? `NIP: ${nip}` : 'Brak danych');
    }

    let ulica = getColVal(cmap.ulica);
    let miasto = getColVal(cmap.miasto);
    let kod = getColVal(cmap.kod);
    let adresStr = '';
    if (ulica) adresStr = ulica;
    if (kod || miasto) {
      const cityPart = `${kod} ${miasto}`.trim();
      adresStr = adresStr ? `${adresStr}, ${cityPart}` : cityPart;
    }

    if (!adresStr) {
      for (let i = 0; i < cols.length; i++) {
        const val = getColVal(i);
        if (val && (/\d{2}-\d{3}/.test(val) || /ul\.|al\.|os\.|pl\./i.test(val))) {
          adresStr = val;
          break;
        }
      }
    }

    return {
      name, pesel, nip, regon, adresStr, ulica, miasto, kod,
      kwota: getColVal(cmap.kwota),
      sygnatura: getColVal(cmap.sygn),
      notatka: getColVal(cmap.notatka),
      stan: getColVal(cmap.stan),
    };
  }

  /* ─── SYNCHRONIZACJA CEPIK (WRO) ────────────────────────── */
  function getCepikForPerson(info) {
    if (typeof WroModule === 'undefined' || !WroModule.getCepikInfoForId) return null;
    let cepik = null;
    if (info.pesel) cepik = WroModule.getCepikInfoForId(info.pesel);
    if (!cepik && info.nip) cepik = WroModule.getCepikInfoForId(info.nip);
    if (!cepik && info.name) cepik = WroModule.getCepikInfoForId(info.name);
    return (cepik && cepik.hasVehicles) ? cepik : null;
  }

  function fmtDatePl(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
  }

  function wroRowPreview(headers, row) {
    const idx = (headers || []).findIndex(h => /bank|nazwa|adres|nieruch|rachun|iban|marka|vin|kwota|opis|kw\b/i.test(String(h || '')));
    const useIdx = idx >= 0 ? idx : 0;
    return String(row[useIdx] || row[0] || '').trim() || (headers[0] ? String(headers[0]) : 'wpis');
  }

  function renderMajatekHtml(info, row) {
    const hasWro = typeof WroModule !== 'undefined';
    const pk = String(info.pesel || info.nip || '').replace(/\D/g, '');
    const suspended = row ? isSuspendedRow(row) : false;

    if (!hasWro || !pk || !WroModule.getMajatekSnapshot) {
      return `<div class="zob-sheet" style="border-style:dashed">
        <div class="zob-sheet-title"><span>Majątek z WRO</span></div>
        <p class="zob-mod-sub" style="margin:0">Brak PESEL/NIP lub modułu WRO — nie można dopasować danych majątkowych.</p>
      </div>`;
    }

    const snap = WroModule.getMajatekSnapshot(pk);
    if (!snap || !snap.sections || !Object.keys(snap.sections).length) {
      return `<div class="zob-sheet" style="border-style:dashed">
        <div class="zob-sheet-title"><span>Majątek z WRO</span></div>
        <p class="zob-mod-sub" style="margin:0">Brak zsynchronizowanych danych dla tej osoby. Wgraj plik i kliknij <strong>„Synchronizuj z Szafką”</strong> w Analityce WRO.</p>
        <button class="zob-action-btn" style="align-self:flex-start;margin-top:8px" onclick="Router.navigate('wro')">Otwórz Analitykę WRO</button>
      </div>`;
    }

    const catalog = WroModule.getSourceCatalog ? WroModule.getSourceCatalog() : [];
    const order = catalog.length ? catalog.map(c => c.key) : Object.keys(snap.sections);
    const sectionKeys = Object.keys(snap.sections).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });

    const dochodBadge = snap.dochodMax > 0
      ? `<span class="zob-asset-n" style="background:rgba(154,107,47,.15);color:#9a6b2f">💰 max dochód: ${snap.dochodMax.toLocaleString('pl-PL')} zł</span>`
      : '';

    const blocks = sectionKeys.map(secKey => {
      const sec = snap.sections[secKey];
      const iconMeta = catalog.find(c => c.key === secKey);
      const icon = iconMeta ? iconMeta.icon : '📄';
      const label = iconMeta ? iconMeta.label : secKey.replace('Wynik: ', '');
      const isAction = secKey.startsWith('Wynik:');
      const safe = secKey.replace(/[^a-zA-Z0-9]/g, '');
      const headers = sec.headers || [];
      const rows = sec.rows || [];

      if (!isAction) {
        const preview = rows.slice(0, 3).map(r => escapeHtml(wroRowPreview(headers, r))).join(' · ');
        return `<div class="zob-sheet" style="border-style:dashed">
          <div class="zob-sheet-title"><span>${icon} ${escapeHtml(label)} <span class="zob-asset-n">${rows.length}</span></span><span>wrzucono ${fmtDatePl(sec.updatedAt)}</span></div>
          <p class="zob-mod-sub" style="margin:0">${preview || '—'}</p>
        </div>`;
      }

      const todoRows = [], knownRows = [];
      rows.forEach(r => {
        const fp = r.slice(0, 5).map(v => String(v || '')).join('||');
        const ann = WroModule.getAnnotation ? WroModule.getAnnotation(pk, safe, fp) : null;
        (ann && (ann.status === 'done' || ann.status === 'excluded') ? knownRows : todoRows).push({ r, fp, ann });
      });
      const showTodo = !suspended;
      const sectionBid = 'zwks' + (++_wroItemSeq);

      const rowCard = (item, known) => {
        const ctxId = 'zwk' + (++_wroItemSeq);
        _wroItemCtx[ctxId] = { pk, safe, fp: item.fp };
        return `
        <div class="wro-card ${item.ann?.status === 'excluded' ? 'wro-card-excl' : item.ann?.status === 'done' ? 'wro-card-done' : ''}" style="margin-bottom:6px">
          <div class="wro-card-hdr">
            <span>${escapeHtml(wroRowPreview(headers, item.r))}</span>
            ${known
              ? `<button class="wro-annot-btn" style="background:#e2e8f0;color:#475569" onclick="ZobowiazaniModule.markWroItem('${ctxId}',null)">↩️ Wróć do „do zajęcia”</button>`
              : `<span style="display:flex;gap:4px">
                  <button class="wro-annot-btn" style="background:#dcfce7;color:#166534" onclick="ZobowiazaniModule.markWroItem('${ctxId}','done')">✅ Zrobione</button>
                  <button class="wro-annot-btn" style="background:#fee2e2;color:#991b1b" onclick="ZobowiazaniModule.markWroItem('${ctxId}','excluded')">⛔ Wyklucz</button>
                </span>`}
          </div>
        </div>`;
      };

      return `<div class="zob-sheet">
        <div class="zob-sheet-title">
          <span>${icon} ${escapeHtml(label)} <span class="zob-asset-n">${rows.length}</span>${suspended ? ' <span class="zob-asset-n" style="background:rgba(122,85,36,.18);color:#7a5524">⏸ zawieszona — bez alertów</span>' : ''}</span>
          <span>wrzucono ${fmtDatePl(sec.updatedAt)}</span>
        </div>
        ${showTodo ? todoRows.map(it => rowCard(it, false)).join('') : ''}
        ${!showTodo && todoRows.length ? `<p class="zob-mod-sub" style="margin:0">${todoRows.length} wpis(ów) bez decyzji — sprawa zawieszona, nie wyświetlane jako nowość.</p>` : ''}
        ${todoRows.length === 0 && knownRows.length > 0 ? '<p class="zob-mod-sub" style="margin:0">✅ Wszystkie wpisy oznaczone</p>' : ''}
        ${knownRows.length > 0 ? `
          <div class="wro-known-toggle" onclick="(function(el){const g=el.nextElementSibling;g.classList.toggle('wro-known-hidden');el.classList.toggle('expanded');el.querySelector('.wro-known-arrow').textContent=g.classList.contains('wro-known-hidden')?'▶':'▼'})(this)">
            <span>👁 Pokaż znane (${knownRows.length})</span><span class="wro-known-arrow">▶</span>
          </div>
          <div class="wro-known-hidden" id="${sectionBid}">${knownRows.map(it => rowCard(it, true)).join('')}</div>
        ` : ''}
      </div>`;
    }).join('');

    return `<div class="zob-sheet" style="margin-bottom:0">
        <div class="zob-sheet-title"><span>Majątek z WRO</span><span>ost. synchronizacja: ${fmtDatePl(snap.lastSyncAt)}</span></div>
        ${dochodBadge ? `<div>${dochodBadge}</div>` : ''}
      </div>
      ${blocks}`;
  }

  function openWroForPerson(pesel, nip, section) {
    if (typeof Router === 'undefined') return;
    Router.navigate('wro', { pesel: pesel || '', nip: nip || '', section: section || '' });
  }

  function stampUfgIfCar(rowIndex, silent, skipSave) {
    if (!dbSheet || !dbSheet.rows[rowIndex]) return false;
    const r = dbSheet.rows[rowIndex];
    const info = extractPersonInfo(r);
    const cepik = getCepikForPerson(info);
    if (!cepik || !cepik.hasVehicles) return false;
    ensureSystemColumns(dbSheet);
    const ufgIdx = dbSheet.columns.indexOf('UFG');
    if (ufgIdx < 0) return false;
    while (r.length < dbSheet.columns.length) r.push('');
    const cur = String(r[ufgIdx] || '').trim();
    if (cur) return false;
    r[ufgIdx] = getTodayStr();
    recalcRowStatus(rowIndex);
    if (!skipSave) saveData();
    if (!silent && typeof showToast === 'function') {
      showToast('UFG: wpisano datę (znaleziono pojazd w CEPIK)', 'success', 2200);
    }
    return true;
  }

  function stampAllUfgFromCepik() {
    if (!dbSheet || !dbSheet.rows) return 0;
    let n = 0;
    dbSheet.rows.forEach((_, i) => {
      if (stampUfgIfCar(i, true, true)) n++;
    });
    if (n) saveData();
    return n;
  }

  function syncCepikForPerson(rowIndex, silent = false) {
    if (!dbSheet || !dbSheet.rows) return { synced: false };
    const r = dbSheet.rows[rowIndex];
    const info = extractPersonInfo(r);
    const cepik = getCepikForPerson(info);

    if (!cepik || !cepik.hasVehicles) {
      if (!silent && typeof showToast === 'function') {
        showToast(`ℹ️ Brak wpisów w CEPIK dla: ${info.name}`, 'info', 2500);
      }
      return { synced: false };
    }

    ensureSystemColumns(dbSheet);
    
    // 1. Ustaw dzisiejszą datę w kolumnie UFG
    const ufgIdx = dbSheet.columns.indexOf('UFG');
    if (ufgIdx >= 0) {
      while (r.length < dbSheet.columns.length) r.push('');
      r[ufgIdx] = getTodayStr();
    }

    // 2. Dopisujemy / aktualizujemy znacznik w kolumnie Notatka
    let notatkaIdx = dbSheet.columns.findIndex(c => /^notatka$/i.test(c) || /notatk/i.test(c));
    if (notatkaIdx < 0) {
      dbSheet.columns.push('Notatka');
      if (Array.isArray(dbSheet.widths)) dbSheet.widths.push(220);
      if (Array.isArray(dbSheet.visible)) dbSheet.visible.push(true);
      if (Array.isArray(dbSheet.order)) dbSheet.order.push(dbSheet.columns.length - 1);
      notatkaIdx = dbSheet.columns.length - 1;
    }
    while (r.length < dbSheet.columns.length) r.push('');

    let currentNote = String(r[notatkaIdx] || '').trim();
    const cepikFormatted = cepik.formattedNote;

    if (/\[CEPIK[^\]]*\]/i.test(currentNote)) {
      currentNote = currentNote.replace(/\[CEPIK[^\]]*\]/i, cepikFormatted).trim();
    } else {
      currentNote = currentNote ? `${currentNote} ${cepikFormatted}` : cepikFormatted;
    }
    r[notatkaIdx] = currentNote;

    recalcRowStatus(rowIndex);
    
    if (!silent) {
      saveData();
      renderViews();
      if (typeof showToast === 'function') {
        showToast(`🚗 Zsynchronizowano CEPIK: ${cepik.summaryText}`, 'success', 2500);
      }
    }

    return { synced: true, count: cepik.vehicles.length, summary: cepik.summaryText };
  }

  function syncAllCepikFromWro() {
    if (!dbSheet || !dbSheet.rows || !dbSheet.rows.length) {
      if (typeof showToast === 'function') showToast('Brak danych w bazie Zobowiązanych!', 'error');
      return;
    }

    const wroDb = (typeof WroModule !== 'undefined' && WroModule.getBazaDanych) ? WroModule.getBazaDanych() : (window.WroDatabase || {});
    if (!wroDb || Object.keys(wroDb).length === 0) {
      if (typeof showToast === 'function') {
        showToast('⚠️ Najpierw wczytaj plik bazy (.js) w zakładce Analityka WRO!', 'warn', 4000);
      }
      return;
    }

    let syncedCount = 0;
    let totalVehicles = 0;

    for (let ri = 0; ri < dbSheet.rows.length; ri++) {
      const res = syncCepikForPerson(ri, true);
      if (res.synced) {
        syncedCount++;
        totalVehicles += res.count;
      }
    }

    if (syncedCount > 0) {
      saveData();
      renderViews();
      if (typeof showToast === 'function') {
        showToast(`🎉 Sukces! Zsynchronizowano CEPIK dla ${syncedCount} osób (wykryto ${totalVehicles} pojazdów). UFG i Notatki zaktualizowane!`, 'success', 4500);
      }
    } else {
      if (typeof showToast === 'function') {
        showToast('ℹ️ Przeszukano bazę, ale nie znaleziono nowych pojazdów w CEPIK dla osób z bazy.', 'info', 3500);
      }
    }
  }

  /* ─── FILTRY I STATYSTYKI ──────────────────────────────── */
  function rowIsFresh(row, info) {
    if (!freshKeys.size) return false;
    const inf = info || extractPersonInfo(row);
    const pesel = String(inf.pesel || '').replace(/\D/g, '');
    const nip = String(inf.nip || '').replace(/\D/g, '');
    const key = personKeyFromInfo(inf);
    return (pesel && freshKeys.has(pesel)) || (nip && freshKeys.has(nip)) || (key && freshKeys.has(key));
  }

  function getFilteredRows() {
    if (!dbSheet || !dbSheet.rows) return [];
    const cacheKey = [
      dbSheet.rows.length,
      sectionFilter,
      activeFilter,
      filterText,
      sortCol,
      sortDir,
      Object.keys(archiveMap).length,
      deskPins.length,
      freshKeys.size,
      minDochodFilter,
    ].join('|');
    if (_filterCache.key === cacheKey && _filterCache.rows) return _filterCache.rows;

    let rowsWithIndex = dbSheet.rows.map((row, idx) => {
      const info = extractPersonInfo(row);
      return { row, idx, info, key: personKeyFromInfo(info) };
    });

    // Sekcje: Aktywne / Biurko / Archiwum
    rowsWithIndex = rowsWithIndex.filter(item => {
      const archived = isArchived(item.key);
      const suspended = isSuspendedRow(item.row);
      if (sectionFilter === 'archive') return archived;
      if (sectionFilter === 'desk') return isPinned(item.key) && !archived && !suspended;
      if (sectionFilter === 'suspended') return suspended && !archived;
      return !archived && !suspended;
    });

    if (filterText) {
      const query = filterText.toLowerCase();
      rowsWithIndex = rowsWithIndex.filter(item => {
        return item.row.some(cell => String(cell || '').toLowerCase().includes(query));
      });
    }

    if (minDochodFilter > 0) {
      rowsWithIndex = rowsWithIndex.filter(item => getDochodMaxForKey(item.key) >= minDochodFilter);
    }

    if (activeFilter === 'fresh') {
      rowsWithIndex = rowsWithIndex.filter(item => rowIsFresh(item.row, item.info));
    } else if (activeFilter === 'todo') {
      rowsWithIndex = rowsWithIndex.filter(item => getPersonSysCount(item.row) === 0);
    } else if (activeFilter === 'progress') {
      rowsWithIndex = rowsWithIndex.filter(item => {
        const c = getPersonSysCount(item.row);
        return c > 0 && c < REG_SYSTEMS.length;
      });
    } else if (activeFilter === 'complete') {
      rowsWithIndex = rowsWithIndex.filter(item => getPersonSysCount(item.row) === REG_SYSTEMS.length);
    } else if (activeFilter === 'deferred') {
      rowsWithIndex = rowsWithIndex.filter(item => !!getDeferInfo(item.row));
    } else if (activeFilter === 'due') {
      rowsWithIndex = rowsWithIndex.filter(item => {
        const d = getDeferInfo(item.row);
        return d && d.due;
      });
    } else if (activeFilter === 'has_cepik') {
      rowsWithIndex = rowsWithIndex.filter(item => !!getCepikForPerson(item.info));
    } else if (activeFilter === 'wro_new') {
      rowsWithIndex = rowsWithIndex.filter(item => {
        return typeof WroModule !== 'undefined' && WroModule.hasPendingItemsForKey && WroModule.hasPendingItemsForKey(item.key);
      });
    } else if (activeFilter.startsWith('src:')) {
      const secKey = activeFilter.slice(4);
      rowsWithIndex = rowsWithIndex.filter(item => {
        return typeof WroModule !== 'undefined' && WroModule.personHasSection && WroModule.personHasSection(item.key, secKey);
      });
    } else if (activeFilter.startsWith('no_')) {
      const sysName = activeFilter.replace('no_', '').toUpperCase();
      const sysIdx = dbSheet.columns.indexOf(sysName);
      if (sysIdx >= 0) {
        rowsWithIndex = rowsWithIndex.filter(item => {
          const v = String(item.row[sysIdx] || '').trim();
          return !v;
        });
      }
    }

    if (sortCol === 'name') {
      rowsWithIndex.sort((a, b) => a.info.name.toLowerCase().localeCompare(b.info.name.toLowerCase(), 'pl') * sortDir);
    } else if (sortCol === 'pesel') {
      rowsWithIndex.sort((a, b) => {
        const nA = a.info.pesel || a.info.nip || '';
        const nB = b.info.pesel || b.info.nip || '';
        return String(nA).localeCompare(String(nB), 'pl') * sortDir;
      });
    } else if (sortCol === 'stan') {
      rowsWithIndex.sort((a, b) => (getPersonSysCount(a.row) - getPersonSysCount(b.row)) * sortDir);
    } else if (sortCol === 'adres') {
      rowsWithIndex.sort((a, b) => a.info.adresStr.toLowerCase().localeCompare(b.info.adresStr.toLowerCase(), 'pl') * sortDir);
    } else if (sortCol === 'aktywnosc') {
      rowsWithIndex.sort((a, b) => {
        const dA = parseDatePl(getLastActivity(a.row)) || new Date(0);
        const dB = parseDatePl(getLastActivity(b.row)) || new Date(0);
        return (dA - dB) * sortDir;
      });
    } else if (sortCol === 'wroc') {
      rowsWithIndex.sort((a, b) => {
        const dA = getDeferInfo(a.row);
        const dB = getDeferInfo(b.row);
        const tA = dA && dA.date ? dA.date.getTime() : 0;
        const tB = dB && dB.date ? dB.date.getTime() : 0;
        return (tA - tB) * sortDir;
      });
    } else if (sortCol === 'cepik') {
      rowsWithIndex.sort((a, b) => {
        const cA = getCepikForPerson(a.info) ? 1 : 0;
        const cB = getCepikForPerson(b.info) ? 1 : 0;
        return (cA - cB) * sortDir;
      });
    } else if (typeof sortCol === 'number' && sortCol >= 0) {
      rowsWithIndex.sort((a, b) => {
        const valA = String(a.row[sortCol] || '').toLowerCase();
        const valB = String(b.row[sortCol] || '').toLowerCase();
        const numA = parseFloat(valA.replace(',', '.'));
        const numB = parseFloat(valB.replace(',', '.'));
        if (!isNaN(numA) && !isNaN(numB)) return (numA - numB) * sortDir;
        return valA.localeCompare(valB, 'pl') * sortDir;
      });
    } else {
      rowsWithIndex.sort((a, b) => (a.idx - b.idx) * (sortDir || 1));
    }

    _filterCache = { key: cacheKey, rows: rowsWithIndex };
    return rowsWithIndex;
  }

  function computeSectionCounts() {
    if (!dbSheet || !dbSheet.rows) return { active: 0, desk: 0, archive: 0, suspended: 0 };
    let active = 0, desk = 0, archive = 0, suspended = 0;
    dbSheet.rows.forEach(r => {
      const key = personKeyFromRow(r);
      if (isArchived(key)) archive++;
      else if (isSuspendedRow(r)) suspended++;
      else {
        active++;
        if (isPinned(key)) desk++;
      }
    });
    return { active, desk, archive, suspended };
  }

  function computeFilterCounts() {
    if (!dbSheet || !dbSheet.rows) return { all: 0, todo: 0, progress: 0, complete: 0, cepik: 0, deferred: 0, due: 0 };
    let todo = 0, progress = 0, complete = 0, cepikCount = 0, deferred = 0, due = 0, wroNew = 0;
    let scoped = 0;
    dbSheet.rows.forEach(r => {
      const key = personKeyFromRow(r);
      const archived = isArchived(key);
      if (sectionFilter === 'archive' && !archived) return;
      if (sectionFilter === 'desk' && (!(isPinned(key) && !archived))) return;
      if (sectionFilter === 'suspended' && !(isSuspendedRow(r) && !archived)) return;
      if (sectionFilter === 'active' && (archived || isSuspendedRow(r))) return;
      scoped++;

      const c = getPersonSysCount(r);
      if (c === 0) todo++;
      else if (c === REG_SYSTEMS.length) complete++;
      else progress++;

      const info = extractPersonInfo(r);
      if (getCepikForPerson(info)) cepikCount++;

      const def = getDeferInfo(r);
      if (def) {
        deferred++;
        if (def.due) due++;
      }

      if (!archived && !isSuspendedRow(r) && typeof WroModule !== 'undefined' && WroModule.hasPendingItemsForKey && WroModule.hasPendingItemsForKey(key)) {
        wroNew++;
      }
    });
    return { all: scoped, todo, progress, complete, cepik: cepikCount, deferred, due, wroNew };
  }

  function renderSourceChipsHtml() {
    if (typeof WroModule === 'undefined' || !WroModule.getSourceCatalog) return '';
    const catalog = WroModule.getSourceCatalog();
    if (!catalog.length) return '';
    const chips = catalog.map(c => {
      const filterKey = 'src:' + c.key;
      return `<button class="zob-pill ${activeFilter === filterKey ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('${filterKey}')" title="Pokaż teczki z danymi ${escapeHtml(c.label)}">${c.icon} ${escapeHtml(c.label)}</button>`;
    }).join('');
    return `<div class="zob-pills" id="zob-src-chips" style="margin-top:2px"><span class="zob-section-hint" style="text-transform:none;font-size:.7rem;opacity:.7;margin-right:2px">Źródło WRO:</span>${chips}</div>`;
  }

  function renderDochodFilterHtml() {
    if (typeof WroModule === 'undefined' || !WroModule.getSourceCatalog) return '';
    return `
      <div class="zob-dochod-filter">
        <div class="zob-dochod-label">💰 Min. dochód roczny (PLN) — z Analityki WRO</div>
        <div class="zob-dochod-row">
          <input type="number" id="zob-min-dochod" class="zob-dochod-inp" placeholder="np. 60000" min="0" step="1000" value="${minDochodFilter || ''}">
          <button class="zob-dochod-clear" onclick="ZobowiazaniModule.setMinDochod(0)" title="Wyczyść filtr">✕</button>
        </div>
        <div class="zob-dochod-presets">
          <button class="${minDochodFilter === 30000 ? 'active' : ''}" onclick="ZobowiazaniModule.setMinDochod(30000)">30k</button>
          <button class="${minDochodFilter === 60000 ? 'active' : ''}" onclick="ZobowiazaniModule.setMinDochod(60000)">60k</button>
          <button class="${minDochodFilter === 100000 ? 'active' : ''}" onclick="ZobowiazaniModule.setMinDochod(100000)">100k</button>
          <button class="${minDochodFilter === 200000 ? 'active' : ''}" onclick="ZobowiazaniModule.setMinDochod(200000)">200k</button>
        </div>
      </div>
    `;
  }

  function setMinDochod(val) {
    minDochodFilter = parseFloat(val) || 0;
    invalidateListCache();
    const inp = document.getElementById('zob-min-dochod');
    if (inp) inp.value = minDochodFilter || '';
    renderViews({ keepScroll: true, detail: false, tabs: false });
  }

  function getDochodMaxForKey(key) {
    if (typeof WroModule === 'undefined' || !WroModule.getMajatekSnapshot) return 0;
    const snap = WroModule.getMajatekSnapshot(key);
    return (snap && snap.dochodMax) || 0;
  }

  /* ─── RENDEROWANIE GŁÓWNEGO WIDOKU ─────────────────────── */
  async function render() {
    const container = document.getElementById('zobowiazani-app');
    if (!container) return;

    try {
      container.innerHTML = `<div class="zob-wrap"><div class="zob-mod-sub" style="padding:40px;text-align:center">Ładowanie teczek z Arkusza...</div></div>`;

      const hasData = await loadDataAsync();

      if (!hasData) {
        container.innerHTML = `
          <div class="zob-wrap">
            <div class="zob-header">
              <div class="zob-title-area">
                <h2 class="zob-mod-title">Szafka teczek</h2>
                <p class="zob-mod-sub">Brak bazy — wczytaj plik JSON albo otwórz Arkusz z danymi.</p>
              </div>
            </div>
            <div class="zob-sheet" style="max-width:560px;margin:24px auto;text-align:center;gap:14px">
              <div class="zob-sheet-title" style="justify-content:center"><span>Wczytaj bazę z pliku</span></div>
              <p class="zob-mod-sub" style="margin:0;line-height:1.5">
                Włącz w Arkuszu tryb <strong>„Z bazą”</strong> (pojawi się karta ★ Zobowiązani), wklej bazę,<br>
                albo wskaż eksport <code>.json</code> / <code>.js</code>.
              </p>
              <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
                <button class="zob-action-btn" style="height:40px;padding:0 18px" onclick="Router.navigate('arkusz')">Otwórz Arkusz</button>
                <button class="zob-action-btn primary" style="height:40px;padding:0 22px" onclick="ZobowiazaniModule.loadJsonFile()">
                  Wczytaj bazę (.json)
                </button>
              </div>
              ${dbErrorMsg ? `<div style="color:var(--zob-spine);font-size:.82rem;text-align:left;margin-top:8px"><strong>Arkusz:</strong> ${escapeHtml(dbErrorMsg)}</div>` : ''}
            </div>
          </div>
        `;
        return;
      }

      const counts = computeFilterCounts();
      const sec = computeSectionCounts();

      container.innerHTML = `
        <div class="zob-wrap">
          <div class="zob-header">
            <div class="zob-title-area">
              <h2 class="zob-mod-title">Szafka teczek</h2>
              <p class="zob-mod-sub">Przeglądaj i zarządzaj dokumentacją zobowiązanych · <strong>${escapeHtml(dbSheet.name || 'Zobowiązani')}</strong> · ${dbSheet.rows.length} osób</p>
            </div>
            <div class="zob-actions">
              <button class="zob-action-btn primary" onclick="ZobowiazaniModule.loadJsonFile()" title="Wczytaj bazę z pliku JSON / JS">Wczytaj bazę</button>
              <button class="zob-action-btn ${filtersOpen ? 'is-on' : ''}" onclick="ZobowiazaniModule.toggleFilters()" title="Pokaż / ukryj filtry">Filtry${activeFilter !== 'all' || filterText ? ' ·' : ''}</button>
              <button class="zob-action-btn" onclick="ZobowiazaniModule.refreshFromArkusz()" title="Pobierz aktualną bazę z Arkusza">Odśwież</button>
              <button class="zob-action-btn olive" onclick="ZobowiazaniModule.copyCleanExcel()" title="Kopiuje widoczne teczki jako czysty tekst do Excela">Do Excela</button>
            </div>
          </div>

          <div class="zob-chrome">
            <div class="zob-sections" id="zob-sections-bar">
              <button type="button" class="zob-section-btn ${sectionFilter === 'desk' ? 'active' : ''}" onclick="ZobowiazaniModule.setSection('desk')">
                Biurko <span class="zob-section-count">${sec.desk}</span>
              </button>
              <button type="button" class="zob-section-btn ${sectionFilter === 'active' ? 'active' : ''}" onclick="ZobowiazaniModule.setSection('active')">
                Aktywne <span class="zob-section-count">${sec.active}</span>
              </button>
              <button type="button" class="zob-section-btn ${sectionFilter === 'suspended' ? 'active' : ''}" onclick="ZobowiazaniModule.setSection('suspended')">
                Zawieszone <span class="zob-section-count">${sec.suspended}</span>
              </button>
              <button type="button" class="zob-section-btn ${sectionFilter === 'archive' ? 'active' : ''}" onclick="ZobowiazaniModule.setSection('archive')">
                Archiwum <span class="zob-section-count">${sec.archive}</span>
              </button>
            </div>
            <div class="zob-browser-tabs" id="zob-browser-tabs"></div>
          </div>

          <div class="zob-toolbar ${filtersOpen ? 'filters-open' : 'filters-collapsed'}">
            <div class="zob-tool-top">
              <div class="zob-search-box">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="text" class="zob-search" id="zob-search-input" placeholder="Szukaj w teczkach: nazwisko, PESEL, NIP, adres..." value="${escapeHtml(filterText)}">
              </div>
              <div class="zob-stats" id="zob-stats-badge">Ładowanie...</div>
            </div>
            <div class="zob-pills" id="zob-pills-bar">
              <button class="zob-pill ${activeFilter === 'all' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('all')">
                Wszystkie <span class="zob-pill-count">${counts.all}</span>
              </button>
              <button class="zob-pill pill-danger ${activeFilter === 'todo' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('todo')">
                Braki <span class="zob-pill-count">${counts.todo}</span>
              </button>
              <button class="zob-pill pill-warn ${activeFilter === 'progress' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('progress')">
                W toku <span class="zob-pill-count">${counts.progress}</span>
              </button>
              <button class="zob-pill pill-ok ${activeFilter === 'complete' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('complete')">
                Komplet <span class="zob-pill-count">${counts.complete}</span>
              </button>
              <button class="zob-pill ${activeFilter === 'deferred' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('deferred')">
                Na później <span class="zob-pill-count">${counts.deferred}</span>
              </button>
              <button class="zob-pill pill-warn ${activeFilter === 'due' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('due')">
                Do powrotu <span class="zob-pill-count">${counts.due}</span>
              </button>
              ${counts.wroNew > 0 ? `
                <button class="zob-pill pill-danger ${activeFilter === 'wro_new' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('wro_new')" title="Osoby z niezałatwionymi pozycjami z ostatniej synchronizacji WRO (bez zawieszonych)">
                  🔥 Nowość WRO <span class="zob-pill-count">${counts.wroNew}</span>
                </button>
              ` : ''}
              ${freshKeys.size ? `
                <button class="zob-pill pill-ok ${activeFilter === 'fresh' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('fresh')" id="zob-fresh-pill">
                  Nowe <span class="zob-pill-count">${freshKeys.size}</span>
                </button>
              ` : ''}
              ${counts.cepik > 0 ? `
                <button class="zob-pill ${activeFilter === 'has_cepik' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('has_cepik')">
                  W CEPIK <span class="zob-pill-count">${counts.cepik}</span>
                </button>
              ` : ''}
              <span class="zob-pill-sep">|</span>
              <button class="zob-pill ${activeFilter === 'no_kawa' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_kawa')">Brak KAWA</button>
              <button class="zob-pill ${activeFilter === 'no_sinf' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_sinf')">Brak SINF</button>
              <button class="zob-pill ${activeFilter === 'no_ufg' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_ufg')">Brak UFG</button>
              <button class="zob-pill ${activeFilter === 'no_jpk' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_jpk')">Brak JPK</button>
              <button class="zob-pill ${activeFilter === 'no_infz' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_infz')">Brak INFZ</button>
            </div>
            ${renderSourceChipsHtml()}
            ${renderDochodFilterHtml()}
          </div>

          <div class="zob-split-container mode-${viewMode}" id="zob-split">
            <aside class="zob-drawer" id="zob-drawer">
              <div class="zob-drawer-head">
                <span class="zob-drawer-head-title">${sectionFilter === 'desk' ? 'Biurko' : sectionFilter === 'archive' ? 'Archiwum' : sectionFilter === 'suspended' ? 'Zawieszone' : 'Lista zobowiązanych'}</span>
                <span class="zob-drawer-count" id="zob-drawer-count">0</span>
              </div>
              <div class="zob-folder-scroll" id="zob-folder-list"></div>
            </aside>
            <section class="zob-folder-open" id="zob-detail-pane">
              <div id="zob-detail-content"></div>
            </section>
          </div>
        </div>
      `;

      const searchInput = document.getElementById('zob-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          filterText = e.target.value;
          invalidateListCache();
          renderViews({ keepScroll: true, detail: false, tabs: false });
        });
      }

      const dochodInput = document.getElementById('zob-min-dochod');
      if (dochodInput) {
        dochodInput.addEventListener('input', (e) => {
          minDochodFilter = parseFloat(e.target.value) || 0;
          invalidateListCache();
          renderViews({ keepScroll: true, detail: false, tabs: false });
        });
      }

      window.removeEventListener('keydown', handleGlobalKeydown);
      window.addEventListener('keydown', handleGlobalKeydown);

      renderViews();
    } catch (err) {
      console.error(err);
      container.innerHTML = `<div class="zob-wrap" style="color:var(--zob-spine);padding:20px">Błąd render: ${escapeHtml(err.message)}</div>`;
    }
  }

  function handleGlobalKeydown(e) {
    if (!activated) return;
    const activeModule = document.getElementById('panel-zobowiazani');
    if (!activeModule || activeModule.classList.contains('hidden')) return;

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const visibleRows = getFilteredRows();
    if (!visibleRows.length) return;

    const currentVisIdx = visibleRows.findIndex(item => item.idx === selectedRowIndex);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = currentVisIdx < visibleRows.length - 1 ? currentVisIdx + 1 : 0;
      selectRow(visibleRows[nextIdx].idx);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = currentVisIdx > 0 ? currentVisIdx - 1 : visibleRows.length - 1;
      selectRow(visibleRows[prevIdx].idx);
    } else if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      setAllSystems(selectedRowIndex);
    } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
      e.preventDefault();
      const sys = REG_SYSTEMS[parseInt(e.key, 10) - 1];
      if (sys) toggleSystem(selectedRowIndex, sys);
    }
  }

  /* ─── RENDEROWANIE WIDOKÓW (LISTA TECZEK + OTWARTA) ───── */
  function applyViewMode() {
    const split = document.getElementById('zob-split');
    if (split) {
      split.classList.remove('mode-list', 'mode-split', 'mode-focus');
      split.classList.add('mode-' + viewMode);
    }
  }

  function renderBrowserTabs() {
    const el = document.getElementById('zob-browser-tabs');
    if (!el) return;
    if (!openTabs.length) {
      el.innerHTML = `<div class="zob-tabs-empty">Brak otwartych teczek — kliknij osobę na liście</div>`;
      return;
    }
    el.innerHTML = openTabs.map(t => `
      <button type="button" class="zob-btab ${t.key === activeTabKey ? 'active' : ''}" title="${escapeHtml(t.name)}"
        onclick="ZobowiazaniModule.activateTab(decodeURIComponent('${encodeURIComponent(t.key)}'))"
        oncontextmenu="ZobowiazaniModule.openTabMenu(event, decodeURIComponent('${encodeURIComponent(t.key)}'))">
        <span class="zob-btab-label">${escapeHtml(t.name)}</span>
        <span class="zob-btab-x" onclick="event.stopPropagation();ZobowiazaniModule.closeTab(decodeURIComponent('${encodeURIComponent(t.key)}'))" title="Zamknij">×</span>
      </button>
    `).join('');
  }

  function rematchOpenTabs() {
    if (!dbSheet || !dbSheet.rows) return;
    openTabs.forEach(t => {
      const found = dbSheet.rows.findIndex(r => personKeyFromRow(r) === t.key);
      if (found >= 0) {
        t.rowIndex = found;
        t.name = extractPersonInfo(dbSheet.rows[found]).name || t.name;
      }
    });
    if (activeTabKey) {
      const t = openTabs.find(x => x.key === activeTabKey);
      if (t) selectedRowIndex = t.rowIndex;
    }
  }

  function renderViews(opts) {
    opts = opts || {};
    rematchOpenTabs();
    applyViewMode();
    if (opts.tabs !== false) renderBrowserTabs();
    if (opts.list !== false) renderTableOnly({ keepScroll: !!opts.keepScroll });
    if (opts.detail !== false) renderDetailOnly();
    if (opts.pills !== false) {
      updatePillsBar();
      updateSectionsBar();
    }
  }

  function updateSectionsBar() {
    const sec = computeSectionCounts();
    const bar = document.getElementById('zob-sections-bar');
    if (!bar) return;
    bar.querySelectorAll('.zob-section-btn').forEach(btn => {
      const onclick = btn.getAttribute('onclick') || '';
      const m = onclick.match(/setSection\('([^']+)'\)/);
      if (!m) return;
      btn.classList.toggle('active', m[1] === sectionFilter);
      const countEl = btn.querySelector('.zob-section-count');
      if (countEl) countEl.textContent = String(sec[m[1]] ?? 0);
    });
  }

  function syncExtraFilterButtons() {
    const chipsBar = document.getElementById('zob-src-chips');
    if (chipsBar) {
      chipsBar.querySelectorAll('button.zob-pill').forEach(btn => {
        const m = (btn.getAttribute('onclick') || '').match(/setFilter\('([^']+)'\)/);
        btn.classList.toggle('active', !!m && m[1] === activeFilter);
      });
    }
    const presets = document.querySelector('.zob-dochod-presets');
    if (presets) {
      presets.querySelectorAll('button').forEach(btn => {
        const m = (btn.getAttribute('onclick') || '').match(/setMinDochod\((\d+)\)/);
        btn.classList.toggle('active', !!m && Number(m[1]) === minDochodFilter);
      });
    }
    const dochodInput = document.getElementById('zob-min-dochod');
    if (dochodInput && document.activeElement !== dochodInput) {
      dochodInput.value = minDochodFilter || '';
    }
  }

  function updatePillsBar() {
    const counts = computeFilterCounts();
    const statsEl = document.getElementById('zob-stats-badge');
    const visibleRows = getFilteredRows();
    if (statsEl) {
      statsEl.innerHTML = `Pokazano: <strong>${visibleRows.length}</strong> z <strong>${counts.all}</strong>`;
    }
    const drawerCount = document.getElementById('zob-drawer-count');
    if (drawerCount) drawerCount.textContent = String(visibleRows.length);
    syncExtraFilterButtons();
    const bar = document.getElementById('zob-pills-bar');
    if (!bar) return;
    let freshBtn = document.getElementById('zob-fresh-pill');
    if (freshKeys.size) {
      if (!freshBtn) {
        freshBtn = document.createElement('button');
        freshBtn.id = 'zob-fresh-pill';
        freshBtn.className = 'zob-pill pill-ok';
        freshBtn.setAttribute('onclick', "ZobowiazaniModule.setFilter('fresh')");
        const sep = bar.querySelector('.zob-pill-sep');
        bar.insertBefore(freshBtn, sep || null);
      }
      freshBtn.innerHTML = `Nowe <span class="zob-pill-count">${freshKeys.size}</span>`;
    } else if (freshBtn) {
      freshBtn.remove();
      if (activeFilter === 'fresh') activeFilter = 'all';
    }
    bar.querySelectorAll('.zob-pill').forEach(btn => {
      const onclick = btn.getAttribute('onclick') || '';
      const m = onclick.match(/setFilter\('([^']+)'\)/);
      if (!m) return;
      btn.classList.toggle('active', m[1] === activeFilter);
    });
  }

  function statusMeta(sysCount, row) {
    if (row && isSuspendedRow(row)) return { cls: 'suspended', label: 'Zawieszone' };
    if (sysCount === REG_SYSTEMS.length) return { cls: 'complete', label: 'Komplet' };
    if (sysCount > 0) return { cls: 'progress', label: 'W toku' };
    return { cls: 'todo', label: 'Braki' };
  }

  function sortMark(key) {
    if (sortCol !== key) return '';
    return `<span class="sort-ind">${sortDir > 0 ? '▲' : '▼'}</span>`;
  }

  function virtRowHeight() {
    return viewMode === 'list' ? 37 : 52;
  }

  function bindFolderListEvents(list) {
    if (!list || list._zobBound) return;
    list._zobBound = true;
    list.addEventListener('click', (e) => {
      if (e.target.closest('.zob-pin-btn, .zob-person-sort, thead th')) return;
      const row = e.target.closest('[data-ri]');
      if (!row || !list.contains(row)) return;
      selectRow(+row.dataset.ri, true);
    });
    list.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('[data-ri]');
      if (!row || !list.contains(row)) return;
      e.preventDefault();
      openRowMenu(e, +row.dataset.ri);
    });
    list.addEventListener('scroll', () => {
      if (_virtRaf) return;
      _virtRaf = requestAnimationFrame(() => {
        _virtRaf = 0;
        paintVirtualWindow();
      });
    }, { passive: true });
  }

  function dotsHtml(row, withTitle) {
    let dots = '';
    REG_SYSTEMS.forEach(sys => {
      const sysIdx = dbSheet.columns.indexOf(sys);
      const sysVal = sysIdx >= 0 ? String(row[sysIdx] || '').trim() : '';
      const isDone = sysVal !== '' && sysVal.toLowerCase() !== 'pomiń';
      const isSkip = sysVal.toLowerCase() === 'pomiń';
      const title = withTitle ? ` title="${sys}: ${escapeHtml(sysVal || 'brak')}"` : ` title="${sys}"`;
      dots += `<span class="zob-dot ${isDone ? 'on' : ''}${isSkip ? ' skip' : ''}"${title}></span>`;
    });
    return dots;
  }

  function compactRowHtml(item) {
    const r = item.row;
    const ri = item.idx;
    const info = item.info || extractPersonInfo(r);
    const key = item.key || personKeyFromInfo(info);
    const isSelected = ri === selectedRowIndex && activeTabKey === key;
    const sysCount = getPersonSysCount(r);
    const st = statusMeta(sysCount, r);
    const hasCar = !!getCepikForPerson(info);
    const fresh = rowIsFresh(r, info);
    return `
      <button type="button" class="zob-person-row ${isSelected ? 'is-selected' : ''}${hasCar ? ' has-car' : ''}${fresh ? ' is-fresh' : ''}" data-ri="${ri}">
        <div class="zob-person-main">
          <div class="zob-reg-name" title="${escapeHtml(info.name)}">${hasCar ? '<span class="zob-car-mark" title="Pojazd w CEPIK">🚗</span>' : ''}${escapeHtml(info.name)}${fresh ? '<span class="zob-fresh-mark">nowa</span>' : ''}</div>
          <div class="zob-systems-dots">${dotsHtml(r, false)}<span class="zob-systems-count">${sysCount}/5</span></div>
        </div>
        <span class="zob-status-chip ${st.cls}">${st.label}</span>
      </button>`;
  }

  function tableRowHtml(item, displayIdx) {
    const r = item.row;
    const ri = item.idx;
    const info = item.info || extractPersonInfo(r);
    const key = item.key || personKeyFromInfo(info);
    const isSelected = ri === selectedRowIndex && activeTabKey === key;
    const sysCount = getPersonSysCount(r);
    const st = statusMeta(sysCount, r);
    const defer = getDeferInfo(r);
    const pinned = isPinned(key);
    const lastAct = getLastActivity(r);
    const adresShort = (info.adresStr || '').length > 42
      ? (info.adresStr.slice(0, 40) + '…')
      : (info.adresStr || '—');
    const idLine = [info.pesel, info.nip ? `NIP ${info.nip}` : ''].filter(Boolean).join(' · ');
    const deferChip = defer
      ? `<span class="zob-defer-chip ${defer.due ? 'due' : 'wait'}" title="Odłożone — wróć ${escapeHtml(defer.raw)}">${defer.due ? 'Do powrotu' : 'Na później'} ${escapeHtml(defer.raw)}</span>`
      : '';
    const hasCar = !!getCepikForPerson(info);
    const fresh = rowIsFresh(r, info);
    return `
      <tr class="${isSelected ? 'is-selected' : ''}${pinned ? ' is-pinned' : ''}${hasCar ? ' has-car' : ''}${fresh ? ' is-fresh' : ''}" data-ri="${ri}">
        <td style="width:36px;color:var(--zob-ink-soft);font-size:.72rem">${displayIdx + 1}</td>
        <td>
          <div class="zob-reg-name" title="${escapeHtml(info.name)}">${hasCar ? '<span class="zob-car-mark" title="Pojazd w CEPIK">🚗</span>' : ''}${escapeHtml(info.name)}${fresh ? '<span class="zob-fresh-mark">nowa</span>' : ''}</div>
        </td>
        <td class="zob-reg-ids">${escapeHtml(idLine || '—')}</td>
        <td title="${escapeHtml(info.adresStr || '')}"><span class="zob-reg-addr">${escapeHtml(adresShort)}</span></td>
        <td>
          <div class="zob-reg-sys">${dotsHtml(r, true)}<span class="zob-reg-sys-count">${sysCount}/5</span></div>
        </td>
        <td style="text-align:center"><span class="zob-status-chip ${st.cls}">${st.label}</span></td>
        <td>${deferChip || '<span class="zob-muted">—</span>'}</td>
        <td style="text-align:center">${hasCar ? '<span class="zob-car-mark" title="Pojazd w CEPIK">🚗</span>' : '<span class="zob-muted">—</span>'}</td>
        <td class="zob-reg-ids">${escapeHtml(lastAct || '—')}</td>
        <td style="text-align:center" onclick="event.stopPropagation()">
          <button type="button" class="zob-pin-btn ${pinned ? 'on' : ''}" title="${pinned ? 'Zdejmij z Biurka' : 'Przypnij do Biurka'}"
            onclick="ZobowiazaniModule.togglePin(decodeURIComponent('${encodeURIComponent(key)}'))">${pinned ? '📌' : '📍'}</button>
        </td>
      </tr>`;
  }

  function virtRange(list, count, rowH) {
    const overscan = 10;
    const viewH = list.clientHeight || 480;
    const start = Math.max(0, Math.floor(list.scrollTop / rowH) - overscan);
    const end = Math.min(count, Math.ceil((list.scrollTop + viewH) / rowH) + overscan);
    return { start, end };
  }

  function paintVirtualWindow() {
    const list = document.getElementById('zob-folder-list');
    if (!list || !dbSheet) return;
    const visibleRows = getFilteredRows();
    const fullCols = viewMode === 'list';
    const rowH = virtRowHeight();
    const { start, end } = virtRange(list, visibleRows.length, rowH);

    if (!fullCols) {
      const spacer = document.getElementById('zob-virt-spacer');
      const win = document.getElementById('zob-virt-window');
      if (!spacer || !win) return;
      spacer.style.height = (visibleRows.length * rowH) + 'px';
      win.style.transform = 'translateY(' + (start * rowH) + 'px)';
      let html = '';
      for (let i = start; i < end; i++) html += compactRowHtml(visibleRows[i]);
      win.innerHTML = html;
      return;
    }

    const tbody = list.querySelector('.zob-reg-table tbody');
    if (!tbody) return;
    const topH = start * rowH;
    const botH = Math.max(0, (visibleRows.length - end) * rowH);
    let html = `<tr class="zob-virt-pad"><td colspan="10" style="height:${topH}px;padding:0;border:0"></td></tr>`;
    for (let i = start; i < end; i++) html += tableRowHtml(visibleRows[i], i);
    html += `<tr class="zob-virt-pad"><td colspan="10" style="height:${botH}px;padding:0;border:0"></td></tr>`;
    tbody.innerHTML = html;
  }

  function renderTableOnly(opts) {
    opts = opts || {};
    const list = document.getElementById('zob-folder-list');
    if (!list || !dbSheet) return;

    const visibleRows = getFilteredRows();
    const fullCols = viewMode === 'list';
    const drawer = document.querySelector('.zob-drawer');
    if (drawer) drawer.classList.toggle('compact', !fullCols);
    bindFolderListEvents(list);

    const keepScroll = !!opts.keepScroll;
    const prevScroll = list.scrollTop;
    const wantMode = (!visibleRows.length) ? 'empty' : (fullCols ? 'table' : 'compact');

    if (list.dataset.virtMode !== wantMode) {
      list.dataset.virtMode = wantMode;
      if (!visibleRows.length) {
        list.innerHTML = `<div class="zob-folder-empty">Brak osób spełniających wybrane kryteria</div>`;
        return;
      }
      if (!fullCols) {
        list.innerHTML = `
          <div class="zob-person-list-head">
            <button type="button" class="zob-person-sort ${sortCol === 'name' ? 'is-sorted' : ''}" onclick="ZobowiazaniModule.sortBy('name')">Nazwisko${sortMark('name')}</button>
            <button type="button" class="zob-person-sort ${sortCol === 'cepik' ? 'is-sorted' : ''}" onclick="ZobowiazaniModule.sortBy('cepik')">🚗${sortMark('cepik')}</button>
            <button type="button" class="zob-person-sort ${sortCol === 'stan' ? 'is-sorted' : ''}" onclick="ZobowiazaniModule.sortBy('stan')">Status${sortMark('stan')}</button>
          </div>
          <div class="zob-virt" id="zob-virt">
            <div class="zob-virt-spacer" id="zob-virt-spacer"></div>
            <div class="zob-virt-window" id="zob-virt-window"></div>
          </div>`;
      } else {
        list.innerHTML = `
          <table class="zob-reg-table zob-reg-full">
            <thead>
              <tr>
                <th style="width:36px" onclick="ZobowiazaniModule.sortBy('idx')" class="${sortCol === 'idx' ? 'is-sorted' : ''}">#${sortMark('idx')}</th>
                <th onclick="ZobowiazaniModule.sortBy('name')" class="${sortCol === 'name' ? 'is-sorted' : ''}">Nazwisko i imię${sortMark('name')}</th>
                <th onclick="ZobowiazaniModule.sortBy('pesel')" class="${sortCol === 'pesel' ? 'is-sorted' : ''}">PESEL / NIP${sortMark('pesel')}</th>
                <th onclick="ZobowiazaniModule.sortBy('adres')" class="${sortCol === 'adres' ? 'is-sorted' : ''}">Adres${sortMark('adres')}</th>
                <th onclick="ZobowiazaniModule.sortBy('stan')" class="${sortCol === 'stan' ? 'is-sorted' : ''}" style="width:120px">Systemy${sortMark('stan')}</th>
                <th onclick="ZobowiazaniModule.sortBy('stan')" class="${sortCol === 'stan' ? 'is-sorted' : ''}" style="width:100px;text-align:center">Status${sortMark('stan')}</th>
                <th onclick="ZobowiazaniModule.sortBy('wroc')" class="${sortCol === 'wroc' ? 'is-sorted' : ''}">Wróć${sortMark('wroc')}</th>
                <th onclick="ZobowiazaniModule.sortBy('cepik')" class="${sortCol === 'cepik' ? 'is-sorted' : ''}" style="width:52px;text-align:center" title="Pojazd CEPIK">🚗${sortMark('cepik')}</th>
                <th onclick="ZobowiazaniModule.sortBy('aktywnosc')" class="${sortCol === 'aktywnosc' ? 'is-sorted' : ''}">Ostatnia czynność${sortMark('aktywnosc')}</th>
                <th style="width:44px;text-align:center" title="Biurko">📌</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>`;
      }
    } else if (!fullCols) {
      list.querySelectorAll('.zob-person-sort').forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';
        const m = onclick.match(/sortBy\('([^']+)'\)/);
        if (!m) return;
        btn.classList.toggle('is-sorted', sortCol === m[1]);
      });
    } else if (fullCols) {
      list.querySelectorAll('thead th').forEach(th => {
        const onclick = th.getAttribute('onclick') || '';
        const m = onclick.match(/sortBy\('([^']+)'\)/);
        if (!m) return;
        th.classList.toggle('is-sorted', sortCol === m[1]);
      });
    }

    paintVirtualWindow();
    if (keepScroll) list.scrollTop = prevScroll;

    const vis = getFilteredRows();
    const visIdx = vis.findIndex(item => item.idx === selectedRowIndex);
    if (!keepScroll) {
      const rowH = virtRowHeight();
      if (visIdx >= 0) {
        const target = visIdx * rowH;
        if (target < list.scrollTop || target > list.scrollTop + list.clientHeight - rowH * 2) {
          list.scrollTop = Math.max(0, target - rowH);
          paintVirtualWindow();
        }
      } else {
        list.scrollTop = 0;
        paintVirtualWindow();
      }
    }
  }

  function setDetailTab(tabId) {
    detailTab = tabId;
    renderDetailOnly();
  }

  function saveNote(rowIndex, value) {
    if (!dbSheet || !dbSheet.rows[rowIndex]) return;
    ensureSystemColumns(dbSheet);
    let notatkaIdx = dbSheet.columns.findIndex(c => /^notatka$/i.test(c) || /notatk/i.test(c));
    if (notatkaIdx < 0) {
      dbSheet.columns.push('Notatka');
      notatkaIdx = dbSheet.columns.length - 1;
    }
    const r = dbSheet.rows[rowIndex];
    while (r.length < dbSheet.columns.length) r.push('');
    r[notatkaIdx] = value;
    saveData();
  }

  function renderDetailOnly() {
    const detailContent = document.getElementById('zob-detail-content');
    if (!detailContent || !dbSheet || !dbSheet.rows) return;

    if (viewMode === 'list' || !activeTabKey) {
      detailContent.innerHTML = '';
      return;
    }

    if (selectedRowIndex < 0 || selectedRowIndex >= dbSheet.rows.length) {
      detailContent.innerHTML = `<div class="zob-folder-empty" style="padding:48px 24px">Wybierz teczkę z listy</div>`;
      return;
    }

    const r = dbSheet.rows[selectedRowIndex];
    const info = extractPersonInfo(r);
    const pkey = personKeyFromInfo(info);
    const sysCount = getPersonSysCount(r);
    const visibleRows = getFilteredRows();
    const curVisIdx = visibleRows.findIndex(item => item.idx === selectedRowIndex);
    const cepik = getCepikForPerson(info);
    const st = statusMeta(sysCount, r);
    const defer = getDeferInfo(r);
    const animKey = ++folderAnimToken;

    const tabs = [
      { id: 'dane', label: 'Dane' },
      { id: 'systemy', label: 'Systemy' },
      { id: 'cepik', label: 'CEPIK' },
      { id: 'majatek', label: 'Majątek' },
      { id: 'notatka', label: 'Notatka' },
    ];

    const deferBanner = defer
      ? `<div class="zob-defer-banner ${defer.due ? 'due' : 'wait'}">
           ${defer.due ? 'Przypomnienie aktywne — wróć' : 'Odłożone — wróć'} <strong>${escapeHtml(defer.raw)}</strong>
           <button type="button" class="zob-nav-btn" style="margin-left:auto;height:28px;padding:0 10px" onclick="ZobowiazaniModule.clearDefer(${selectedRowIndex})">Zdejmij</button>
         </div>`
      : '';

    let bodyHtml = '';

    if (detailTab === 'dane') {
      const idExtras = [
        info.regon ? `<div class="zob-id-row"><span class="zob-id-label">REGON</span><span class="zob-badge-mono" onclick="ZobowiazaniModule.copy('${info.regon}', this)">${info.regon}</span></div>` : '',
        info.adresStr ? `<div class="zob-id-row"><span class="zob-id-label">Adres</span><span class="zob-kv-val" onclick="ZobowiazaniModule.copy('${escapeHtml(info.adresStr).replace(/'/g, "\\'")}', this)">${escapeHtml(info.adresStr)}</span></div>` : '',
        (info.sygnatura || info.kwota) ? `<div class="zob-id-row"><span class="zob-id-label">Sprawa</span><span class="zob-kv-val">${escapeHtml([info.sygnatura, info.kwota].filter(Boolean).join(' · '))}</span></div>` : '',
      ].filter(Boolean).join('');

      const skipCols = new Set([...REG_SYSTEMS, 'Stan', 'Komplet', DEFER_COL, SUSPEND_COL]);
      const otherFields = dbSheet.columns.map((colName, cIdx) => {
        if (skipCols.has(colName)) return '';
        if (/^(pesel|nip|regon)$/i.test(String(colName).trim())) return '';
        if (/adres|ulica|miasto|kod\s*poczt/i.test(String(colName)) && info.adresStr) return '';
        if (/sygn|kwota/i.test(String(colName)) && (info.sygnatura || info.kwota)) return '';
        const rawVal = String(r[cIdx] || '').trim();
        if (!rawVal) return '';
        // Skip if identical to header PESEL/NIP
        if (info.pesel && rawVal === info.pesel) return '';
        if (info.nip && rawVal === info.nip) return '';
        const isLong = rawVal.length > 25;
        return `<div class="zob-kv-item ${isLong ? 'full' : ''}">
          <div class="zob-kv-label">${escapeHtml(colName)}</div>
          <div class="zob-kv-val" onclick="ZobowiazaniModule.copy('${escapeHtml(rawVal).replace(/'/g, "\\'")}', this)">${escapeHtml(rawVal)}</div>
        </div>`;
      }).join('');

      bodyHtml = `
        ${deferBanner}
        <div class="zob-section">
          <div class="zob-section-title"><span>Odłóż / przypomnienie</span></div>
          <div class="zob-defer-actions">
            <button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.deferDays(${selectedRowIndex}, 1)">+1 dzień</button>
            <button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.deferDays(${selectedRowIndex}, 3)">+3 dni</button>
            <button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.deferDays(${selectedRowIndex}, 7)">+7 dni</button>
            <button type="button" class="zob-action-btn primary" onclick="ZobowiazaniModule.deferPick(${selectedRowIndex})">Wybierz datę</button>
            ${defer ? `<button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.clearDefer(${selectedRowIndex})">Wyczyść</button>` : ''}
          </div>
          <p class="zob-defer-note">Kolumna <strong>Wróć</strong> w Arkuszu — widać też na liście i w filtrach.</p>
        </div>
        ${idExtras ? `<div class="zob-section">
          <div class="zob-section-title"><span>Adres i sprawa</span><span class="zob-section-hint">Kliknij, by skopiować</span></div>
          ${idExtras}
        </div>` : ''}
        ${otherFields ? `<div class="zob-section">
          <div class="zob-section-title"><span>Pozostałe pola</span></div>
          <div class="zob-kv-grid">${otherFields}</div>
        </div>` : ''}
      `;
    } else if (detailTab === 'systemy') {
      bodyHtml = `
        <div class="zob-section">
          <div class="zob-section-title">
            <span>Czynności systemowe</span>
            <span style="color:${sysCount === 5 ? 'var(--zob-olive)' : 'var(--zob-spine)'}">${sysCount} z 5</span>
          </div>
          <div class="zob-systems-grid">
            ${REG_SYSTEMS.map(sys => {
              const idx = dbSheet.columns.indexOf(sys);
              const val = idx >= 0 ? String(r[idx] || '').trim() : '';
              const isDone = val !== '' && val.toLowerCase() !== 'pomiń';
              const isSkip = val.toLowerCase() === 'pomiń';
              return `<div class="zob-sys-tile ${isDone ? 'done' : ''}" onclick="ZobowiazaniModule.toggle(${selectedRowIndex}, '${sys}')">
                <div class="zob-sys-tile-name"><span>${sys}</span><span>${isDone ? '✓' : (isSkip ? 'P' : '+')}</span></div>
                <div class="zob-sys-tile-val">${escapeHtml(val || 'Brak — kliknij')}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    } else if (detailTab === 'cepik') {
      if (cepik) {
        bodyHtml = `
          <div class="zob-sheet">
            <div class="zob-sheet-title">
              <span>Dane z CEPIK (WRO)</span>
              <button class="zob-btn-komplet" onclick="ZobowiazaniModule.syncCepik(${selectedRowIndex})">Synchronizuj</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${cepik.vehicles.map((v) => {
                const year = String(v.year || '').match(/(?:19|20)\d{2}/)?.[0] || String(v.year || '').trim();
                const fields = (v.headers || []).map((h, c) => {
                  const val = v.raw ? String(v.raw[c] ?? '').trim() : '';
                  if (!h && !val) return '';
                  return `<div class="wro-card-row"><div class="wro-label">${escapeHtml(String(h || 'Pole'))}</div><div class="wro-value">${escapeHtml(val || '—')}</div></div>`;
                }).join('');
                return `<div class="zob-vehicle" onclick="this.classList.toggle('open')" title="Kliknij, aby rozwinąć pełne dane">
                  <div class="zob-vehicle-sum">
                    <div>
                      <div class="zob-vehicle-brand">${escapeHtml(v.brand || v.label || 'Pojazd')}</div>
                      <div class="zob-vehicle-meta">${[year ? `Rok rej.: ${escapeHtml(year)}` : '', v.vin ? `VIN: ${escapeHtml(v.vin)}` : ''].filter(Boolean).join(' · ') || 'Kliknij, aby rozwinąć'}</div>
                    </div>
                    <span class="zob-badge-mono">${escapeHtml(v.plate || 'Brak tablicy')}</span>
                  </div>
                  <div class="zob-vehicle-full"><div class="wro-card">${fields || '<div class="wro-card-row"><div class="wro-value">Brak szczegółów</div></div>'}</div></div>
                </div>`;
              }).join('')}
            </div>
          </div>
        `;
      } else {
        bodyHtml = `
          <div class="zob-sheet" style="border-style:dashed">
            <div class="zob-sheet-title"><span>CEPIK</span></div>
            <p class="zob-mod-sub" style="margin:0">Brak ustaleń w WRO dla tej osoby.</p>
            <button class="zob-action-btn" style="align-self:flex-start;margin-top:8px" onclick="Router.navigate('wro', { pesel: '${info.pesel || ''}', nip: '${info.nip || ''}' })">Otwórz w WRO</button>
          </div>
        `;
      }
    } else if (detailTab === 'majatek') {
      bodyHtml = renderMajatekHtml(info, r);
    } else {
      bodyHtml = `
        <div class="zob-sheet">
          <div class="zob-sheet-title"><span>Notatka w teczce</span><span>Zapis przy opuszczeniu pola</span></div>
          <textarea class="zob-note-area" id="zob-note-input" placeholder="Notatki do sprawy...">${escapeHtml(info.notatka || '')}</textarea>
        </div>
      `;
    }

    detailContent.innerHTML = `
      <div class="zob-open-header" data-anim="${animKey}">
        <div class="zob-open-header-main">
          <div class="zob-open-title">${escapeHtml(info.name)}</div>
          ${(info.pesel || info.nip || info.adresStr) ? `<div class="zob-open-ids">
            ${info.pesel ? `<button type="button" class="zob-id-chip" title="Kopiuj PESEL" onclick="ZobowiazaniModule.copy('${info.pesel}', this)"><span class="lbl">PESEL</span>${info.pesel}</button>` : ''}
            ${info.nip ? `<button type="button" class="zob-id-chip" title="Kopiuj NIP" onclick="ZobowiazaniModule.copy('${info.nip}', this)"><span class="lbl">NIP</span>${info.nip}</button>` : ''}
            ${info.adresStr ? `<button type="button" class="zob-open-addr" title="Kopiuj adres" onclick="ZobowiazaniModule.copy(decodeURIComponent('${encodeURIComponent(info.adresStr)}'), this)">${escapeHtml(info.adresStr)}</button>` : ''}
          </div>` : ''}
          <div class="zob-open-sub"><span class="zob-status-chip ${st.cls}">${st.label}</span>${rowZawieszone(r) ? ` · od ${escapeHtml(rowZawieszone(r))}` : ''} · ${sysCount}/5 systemów · #${selectedRowIndex + 1}${cepik ? ' · 🚗 CEPIK' : ''}${defer ? ` · <span class="zob-defer-chip ${defer.due ? 'due' : 'wait'}">${defer.due ? 'Do powrotu' : 'Na później'} ${escapeHtml(defer.raw)}</span>` : ''}</div>
        </div>
        <div class="zob-open-header-actions">
          <button type="button" class="zob-pin-btn ${isPinned(pkey) ? 'on' : ''}" onclick="ZobowiazaniModule.togglePin(decodeURIComponent('${encodeURIComponent(pkey)}'))" title="Biurko">${isPinned(pkey) ? '📌 Biurko' : '📍 Biurko'}</button>
          <button type="button" class="zob-action-btn ${isSuspendedRow(r) ? 'is-on' : ''}" onclick="ZobowiazaniModule.toggleSuspend(${selectedRowIndex})" title="Zawieś sprawę">${isSuspendedRow(r) ? '▶ Wznów' : '⏸ Zawieś'}</button>
          <button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.openDeferMenu(${selectedRowIndex}, event)" title="Odłóż / przypomnienie">Odłóż</button>
          <button class="zob-btn-komplet" onclick="ZobowiazaniModule.setAll(${selectedRowIndex})" title="Oznacz komplet">Komplet</button>
          <div class="zob-win-controls">
            <button type="button" class="zob-win-btn archive" onclick="ZobowiazaniModule.archivePerson(${selectedRowIndex})" title="${isArchived(pkey) ? 'Przywróć z archiwum' : 'Archiwizuj'}">${isArchived(pkey) ? 'Przywróć' : 'Archiwizuj'}</button>
            <button type="button" class="zob-win-btn" onclick="ZobowiazaniModule.minimizeFolder()" title="Minimalizuj (zostaw kartę)">−</button>
            <button type="button" class="zob-win-btn" onclick="ZobowiazaniModule.toggleFocus()" title="${viewMode === 'focus' ? 'Pokaż listę obok' : 'Ukryj listę (teczka na środku)'}">${viewMode === 'focus' ? '⧉' : '⛶'}</button>
            <button type="button" class="zob-win-btn close" onclick="ZobowiazaniModule.closeActiveTab()" title="Zamknij teczkę">×</button>
          </div>
        </div>
      </div>
      <div class="zob-open-tabs">
        ${tabs.map(t => `<button type="button" class="zob-tab ${detailTab === t.id ? 'active' : ''}" onclick="ZobowiazaniModule.setTab('${t.id}')">${t.label}</button>`).join('')}
      </div>
      <div class="zob-open-body" key="${detailTab}-${animKey}">
        ${detailTab !== 'dane' ? deferBanner : ''}
        ${bodyHtml}
      </div>
      <div class="zob-open-footer">
        <button class="zob-nav-btn" onclick="ZobowiazaniModule.prevPerson()" title="Poprzednia teczka">← Poprzedni</button>
        <span class="zob-foot-count">${curVisIdx >= 0 ? `${curVisIdx + 1} / ${visibleRows.length}` : ''}</span>
        <button class="zob-nav-btn" onclick="ZobowiazaniModule.nextPerson()" title="Następna teczka">Następny →</button>
      </div>
    `;

    const noteInput = document.getElementById('zob-note-input');
    if (noteInput) {
      noteInput.addEventListener('blur', () => {
        saveNote(selectedRowIndex, noteInput.value);
      });
    }

    detailContent.oncontextmenu = (e) => {
      if (e.target.closest('textarea, input, button, a')) return;
      openRowMenu(e, selectedRowIndex);
    };

    // Restart tab animation
    const body = detailContent.querySelector('.zob-open-body');
    if (body) {
      body.style.animation = 'none';
      void body.offsetWidth;
      body.style.animation = '';
    }
  }

  /* ─── NAWIGACJA I AKCJE ────────────────────────────────── */
  function openOrActivateTab(ri) {
    if (!dbSheet || !dbSheet.rows[ri]) return;
    const info = extractPersonInfo(dbSheet.rows[ri]);
    const key = personKeyFromInfo(info);
    const existing = openTabs.find(t => t.key === key);
    if (existing) {
      existing.rowIndex = ri;
      existing.name = info.name || 'Teczka';
    } else {
      openTabs.push({ key, rowIndex: ri, name: info.name || 'Teczka' });
    }
    activeTabKey = key;
    selectedRowIndex = ri;
    if (viewMode === 'list') viewMode = 'split';
    persistOpenTabs();
  }

  function selectRow(ri, fromList) {
    stampUfgIfCar(ri, true);
    const wasList = viewMode === 'list';
    openOrActivateTab(ri);
    if (wasList && viewMode !== 'list') {
      const list = document.getElementById('zob-folder-list');
      if (list) list.dataset.virtMode = '';
      renderViews({ keepScroll: true });
      return;
    }
    applyViewMode();
    const list = document.getElementById('zob-folder-list');
    if (list) {
      list.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
      const el = list.querySelector('[data-ri="' + ri + '"]');
      if (el) el.classList.add('is-selected');
    }
    renderBrowserTabs();
    renderDetailOnly();
    if (!fromList) renderTableOnly({ keepScroll: false });
  }

  function activateTab(key) {
    const t = openTabs.find(x => x.key === key);
    if (!t) return;
    activeTabKey = key;
    selectedRowIndex = t.rowIndex;
    stampUfgIfCar(t.rowIndex, true);
    if (viewMode === 'list') viewMode = 'split';
    persistOpenTabs();
    renderViews();
  }

  function closeTab(key) {
    const idx = openTabs.findIndex(t => t.key === key);
    if (idx < 0) return;
    openTabs.splice(idx, 1);
    if (activeTabKey === key) {
      if (openTabs.length) {
        const next = openTabs[Math.max(0, idx - 1)];
        activeTabKey = next.key;
        selectedRowIndex = next.rowIndex;
        if (viewMode === 'list') viewMode = 'split';
      } else {
        activeTabKey = '';
        viewMode = 'list';
      }
    }
    persistOpenTabs();
    renderViews();
  }

  function closeActiveTab() {
    if (activeTabKey) closeTab(activeTabKey);
    else {
      viewMode = 'list';
      renderViews();
    }
  }

  function minimizeFolder() {
    viewMode = 'list';
    persistOpenTabs();
    renderViews();
  }

  function hideCtxMenu() {
    const m = document.getElementById('zob-ctx-menu');
    if (m) m.classList.remove('open');
  }

  function ensureCtxMenu() {
    let m = document.getElementById('zob-ctx-menu');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'zob-ctx-menu';
    m.className = 'zob-ctx';
    m.setAttribute('role', 'menu');
    document.body.appendChild(m);
    if (!hideCtxMenu._bound) {
      document.addEventListener('click', hideCtxMenu);
      document.addEventListener('scroll', hideCtxMenu, true);
      window.addEventListener('resize', hideCtxMenu);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtxMenu(); });
      hideCtxMenu._bound = true;
    }
    return m;
  }

  function placeCtxMenu(menu, e) {
    menu.classList.add('open');
    const pad = 8;
    const w = menu.offsetWidth || 220;
    const h = menu.offsetHeight || 200;
    let x = e.clientX;
    let y = e.clientY;
    if (x + w > window.innerWidth - pad) x = window.innerWidth - w - pad;
    if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
    menu.style.left = Math.max(pad, x) + 'px';
    menu.style.top = Math.max(pad, y) + 'px';
  }

  function buildCtxItems(menu, title, items) {
    menu.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'zob-ctx-h';
    h.textContent = title;
    menu.appendChild(h);
    items.forEach(it => {
      if (it === 'sep') {
        const sep = document.createElement('div');
        sep.className = 'zob-ctx-sep';
        menu.appendChild(sep);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      if (it.danger) b.classList.add('danger');
      b.onclick = () => {
        hideCtxMenu();
        try { it.action(); } catch (err) { console.error(err); }
      };
      menu.appendChild(b);
    });
  }

  function openRowMenu(e, ri) {
    e.preventDefault();
    e.stopPropagation();
    if (!dbSheet || !dbSheet.rows[ri]) return;
    const info = extractPersonInfo(dbSheet.rows[ri]);
    const key = personKeyFromInfo(info);
    const pinned = isPinned(key);
    const archived = isArchived(key);
    const tabOpen = openTabs.some(t => t.key === key);
    const menu = ensureCtxMenu();
    const items = [
      { label: 'Otwórz teczkę', action: () => selectRow(ri) },
      'sep',
      { label: pinned ? 'Zdejmij z Biurka' : 'Przypnij do Biurka', action: () => togglePin(key) },
      { label: 'Odłóż / przypomnienie…', action: () => openDeferMenu(ri, e) },
      { label: isSuspendedRow(dbSheet.rows[ri]) ? '▶ Wznów sprawę' : '⏸ Zawieś sprawę', action: () => toggleSuspend(ri) },
      { label: archived ? 'Przywróć z Archiwum' : 'Archiwizuj', action: () => archivePerson(ri), danger: !archived },
      'sep',
    ];
    if (info.pesel) items.push({ label: 'Kopiuj PESEL', action: () => copyToClipboard(info.pesel) });
    if (info.nip) items.push({ label: 'Kopiuj NIP', action: () => copyToClipboard(info.nip) });
    if (info.name) items.push({ label: 'Kopiuj nazwisko', action: () => copyToClipboard(info.name) });
    if (tabOpen) {
      items.push('sep');
      items.push({ label: 'Zamknij kartę', action: () => closeTab(key) });
    }
    buildCtxItems(menu, info.name || 'Teczka', items);
    placeCtxMenu(menu, e);
  }

  function openTabMenu(e, key) {
    e.preventDefault();
    e.stopPropagation();
    const t = openTabs.find(x => x.key === key);
    if (!t) return;
    const menu = ensureCtxMenu();
    const items = [
      { label: 'Aktywuj', action: () => activateTab(key) },
      { label: 'Zamknij kartę', action: () => closeTab(key) },
      { label: 'Zamknij inne karty', action: () => {
        openTabs = openTabs.filter(x => x.key === key);
        activeTabKey = key;
        selectedRowIndex = t.rowIndex;
        if (viewMode === 'list') viewMode = 'split';
        persistOpenTabs();
        renderViews();
      }},
      { label: 'Zamknij wszystkie', action: () => {
        openTabs = [];
        activeTabKey = '';
        viewMode = 'list';
        persistOpenTabs();
        renderViews();
      }},
      'sep',
      { label: 'Minimalizuj (lista)', action: () => { activateTab(key); minimizeFolder(); } },
    ];
    if (dbSheet && dbSheet.rows[t.rowIndex]) {
      const info = extractPersonInfo(dbSheet.rows[t.rowIndex]);
      const pkey = personKeyFromInfo(info);
      items.push('sep');
      items.push({ label: isPinned(pkey) ? 'Zdejmij z Biurka' : 'Przypnij do Biurka', action: () => togglePin(pkey) });
      items.push({ label: isSuspendedRow(dbSheet.rows[t.rowIndex]) ? '▶ Wznów sprawę' : '⏸ Zawieś sprawę', action: () => toggleSuspend(t.rowIndex) });
      items.push({ label: isArchived(pkey) ? 'Przywróć z Archiwum' : 'Archiwizuj', action: () => archivePerson(t.rowIndex), danger: !isArchived(pkey) });
    }
    buildCtxItems(menu, t.name || 'Karta', items);
    placeCtxMenu(menu, e);
  }

  function toggleFocus() {
    if (viewMode === 'focus') viewMode = 'split';
    else if (activeTabKey) viewMode = 'focus';
    else return;
    renderViews();
  }

  function setSection(sec) {
    sectionFilter = (sec === 'desk' || sec === 'archive' || sec === 'suspended') ? sec : 'active';
    renderViews();
  }

  function toggleSuspend(ri) {
    if (!dbSheet || !dbSheet.rows[ri]) return;
    ensureSystemColumns(dbSheet);
    const ci = dbSheet.columns.indexOf(SUSPEND_COL);
    if (ci < 0) return;
    const r = dbSheet.rows[ri];
    while (r.length < dbSheet.columns.length) r.push('');
    if (isSuspendedRow(r)) {
      r[ci] = '';
      recalcRowStatus(ri);
      if (typeof showToast === 'function') showToast('Wznowiono sprawę — kolumna Zawieszone w Arkuszu wyczyszczona', 'success', 2200);
    } else {
      r[ci] = getTodayStr();
      recalcRowStatus(ri);
      if (typeof showToast === 'function') showToast('Zawieszono — data w kolumnie Zawieszone (Arkusz brązowy)', 'info', 2500);
    }
    saveData();
    renderViews();
  }

  function togglePin(key) {
    key = String(key || '');
    if (!key) return;
    const i = deskPins.indexOf(key);
    if (i >= 0) deskPins.splice(i, 1);
    else deskPins.push(key);
    persistDeskPins();
    renderViews();
  }

  function archivePerson(ri) {
    if (!dbSheet || !dbSheet.rows[ri]) return;
    const info = extractPersonInfo(dbSheet.rows[ri]);
    const key = personKeyFromInfo(info);
    if (isArchived(key)) {
      delete archiveMap[key];
      if (typeof showToast === 'function') showToast('Przywrócono z archiwum', 'success', 2000);
    } else {
      archiveMap[key] = {
        at: new Date().toISOString(),
        name: info.name || '',
        reason: 'ręcznie',
      };
      closeTab(key);
      if (typeof showToast === 'function') showToast('Przeniesiono do Archiwum (Szafka)', 'info', 2500);
    }
    persistArchive();
    renderViews();
  }

  function isSuspended(key) {
    const pk = String(key || '').replace(/\D/g, '') || String(key || '');
    if (!pk || !dbSheet) return false;
    const hit = lookupById(pk);
    if (!hit || !dbSheet.rows[hit.rowIndex]) return false;
    return isSuspendedRow(dbSheet.rows[hit.rowIndex]);
  }

  function archiveByKey(key, meta) {
    const hit = lookupById(key);
    if (!hit || !dbSheet || !dbSheet.rows[hit.rowIndex]) return false;
    const info = extractPersonInfo(dbSheet.rows[hit.rowIndex]);
    const pk = personKeyFromInfo(info);
    if (isArchived(pk)) return true;
    archiveMap[pk] = {
      at: (meta && meta.at) || new Date().toISOString(),
      name: info.name || '',
      reason: (meta && meta.reason) || 'WRO: zniknęły dane',
    };
    closeTab(pk);
    persistArchive();
    invalidateListCache();
    if (activated) renderViews();
    if (typeof showToast === 'function') showToast('Teczka "' + (info.name || pk) + '" → Archiwum', 'info', 2500);
    return true;
  }

  function markWroItem(ctxId, status) {
    const ctx = _wroItemCtx[ctxId];
    if (!ctx) return;
    if (typeof WroModule === 'undefined' || !WroModule.setAnnotationData) return;
    WroModule.setAnnotationData(ctx.pk, ctx.safe, ctx.fp, status ? { status } : null);
    invalidateListCache();
    renderDetailOnly();
    updatePillsBar();
  }

  function applyArchiveIds(ids, meta, opts) {
    const list = Array.isArray(ids) ? ids : [];
    list.forEach(id => {
      const key = String(id || '').replace(/\D/g, '') || String(id || '');
      if (!key) return;
      archiveMap[key] = {
        at: (meta && meta.at) || new Date().toISOString(),
        name: '',
        reason: (meta && meta.reason) || 'Odśwież z Excela',
      };
    });
    persistArchive();
    invalidateListCache();
    if (activated && !(opts && opts.silent)) renderViews();
  }

  async function afterExcelRefresh(payload) {
    payload = payload || {};
    const keys = Array.isArray(payload.addedKeys) ? payload.addedKeys : [];
    freshKeys = new Set(keys.map(k => String(k || '').replace(/\D/g, '')).filter(Boolean));
    invalidateListCache();
    try {
      await fetchDbFromArkusz(4000, { ensureRegistry: false });
      dataSourceLabel = 'Arkusz';
      persistLocal();
    } catch (e) {
      console.warn('[ZobowiazaniModule] afterExcelRefresh fetch:', e);
    }
    invalidateListCache();
    sectionFilter = 'active';
    if (freshKeys.size) activeFilter = 'fresh';
    filtersOpen = true;
    const tb = document.querySelector('#zobowiazani-app .zob-toolbar');
    if (tb) {
      tb.classList.add('filters-open');
      tb.classList.remove('filters-collapsed');
    }
    activated = true;
    const container = document.getElementById('zobowiazani-app');
    const live = container && container.querySelector('.zob-header');
    if (live) {
      const list = document.getElementById('zob-folder-list');
      if (list) list.dataset.virtMode = '';
      renderViews();
    }
    if (typeof showToast === 'function') {
      const n = freshKeys.size || payload.addedCount || 0;
      const arch = payload.archiveCount || 0;
      showToast(
        (n ? ('+' + n + ' nowych teczek (filtr Nowe)') : 'Brak nowych teczek')
        + (arch ? (' · ' + arch + ' → Archiwum') : ''),
        n ? 'success' : 'info',
        3500
      );
    }
  }

  function prevPerson() {
    const visibleRows = getFilteredRows();
    if (!visibleRows.length) return;
    const curVisIdx = visibleRows.findIndex(item => item.idx === selectedRowIndex);
    const prevIdx = curVisIdx > 0 ? curVisIdx - 1 : visibleRows.length - 1;
    selectRow(visibleRows[prevIdx].idx);
  }

  function nextPerson() {
    const visibleRows = getFilteredRows();
    if (!visibleRows.length) return;
    const curVisIdx = visibleRows.findIndex(item => item.idx === selectedRowIndex);
    const nextIdx = curVisIdx < visibleRows.length - 1 ? curVisIdx + 1 : 0;
    selectRow(visibleRows[nextIdx].idx);
  }

  function nextTodo() {
    const visibleRows = getFilteredRows();
    if (!visibleRows.length) return;
    const curVisIdx = visibleRows.findIndex(item => item.idx === selectedRowIndex);
    
    for (let i = curVisIdx + 1; i < visibleRows.length; i++) {
      if (getPersonSysCount(visibleRows[i].row) < REG_SYSTEMS.length) {
        selectRow(visibleRows[i].idx);
        return;
      }
    }
    for (let i = 0; i <= curVisIdx; i++) {
      if (getPersonSysCount(visibleRows[i].row) < REG_SYSTEMS.length) {
        selectRow(visibleRows[i].idx);
        return;
      }
    }
    if (typeof showToast === 'function') showToast('Wszystkie widoczne osoby mają już komplet! 🎉', 'info', 2000);
  }

  function setFilter(filterKey) {
    activeFilter = filterKey;
    if (filterKey !== 'all') filtersOpen = true;
    const tb = document.querySelector('#zobowiazani-app .zob-toolbar');
    if (tb) {
      tb.classList.toggle('filters-open', filtersOpen);
      tb.classList.toggle('filters-collapsed', !filtersOpen);
    }
    document.querySelectorAll('#zobowiazani-app .zob-actions .zob-action-btn').forEach(b => {
      if ((b.getAttribute('onclick') || '').includes('toggleFilters')) {
        b.classList.toggle('is-on', filtersOpen);
        const mark = activeFilter !== 'all' || filterText ? ' ·' : '';
        b.textContent = `Filtry${mark}`;
      }
    });
    renderViews();
  }

  function toggleFilters() {
    filtersOpen = !filtersOpen;
    const tb = document.querySelector('#zobowiazani-app .zob-toolbar');
    if (tb) {
      tb.classList.toggle('filters-open', filtersOpen);
      tb.classList.toggle('filters-collapsed', !filtersOpen);
    }
    document.querySelectorAll('#zobowiazani-app .zob-actions .zob-action-btn').forEach(b => {
      if ((b.getAttribute('onclick') || '').includes('toggleFilters')) {
        b.classList.toggle('is-on', filtersOpen);
        const mark = activeFilter !== 'all' || filterText ? ' ·' : '';
        b.textContent = `Filtry${mark}`;
      }
    });
  }

  function sortBy(colKey) {
    if (sortCol === colKey) {
      sortDir = sortDir * -1;
    } else {
      sortCol = colKey;
      sortDir = 1;
    }
    renderViews();
  }

  function copyCleanExcelText() {
    if (!dbSheet || !dbSheet.rows || !dbSheet.rows.length) {
      if (typeof showToast === 'function') showToast('Brak danych w bazie!', 'error');
      return;
    }

    const visibleRows = getFilteredRows();
    if (!visibleRows.length) {
      if (typeof showToast === 'function') showToast('Brak wierszy do skopiowania!', 'error');
      return;
    }

    const cols = dbSheet.columns;
    const lines = [];
    lines.push(cols.join('\t'));
    visibleRows.forEach(item => {
      lines.push(item.row.map(c => String(c ?? '')).join('\t'));
    });

    const plainText = lines.join('\r\n');
    navigator.clipboard.writeText(plainText).then(() => {
      if (typeof showToast === 'function') {
        showToast(`📋 Skopiowano ${visibleRows.length} wierszy (czysty tekst bez formatowania — wklej w Excelu)`, 'success', 2500);
      }
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = plainText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      if (typeof showToast === 'function') {
        showToast(`📋 Skopiowano ${visibleRows.length} wierszy do schowka`, 'success', 2500);
      }
    });
  }

  async function refreshFromArkusz() {
    try {
      await fetchDbFromArkusz(3000);
      dataSourceLabel = 'Arkusz';
      try { localStorage.removeItem(FILE_SOURCE_KEY); } catch {}
      persistLocal();
      if (typeof showToast === 'function') {
        showToast(`Zsynchronizowano z Arkuszem: ${dbSheet.rows.length} teczek`, 'success', 2800);
      }
      await render();
    } catch (err) {
      if (typeof showToast === 'function') {
        showToast(`Nie udało się odświeżyć: ${err.message || err}`, 'error', 4000);
      }
    }
  }

  function indexSheetPeople(sheet, map) {
    if (!sheet || !Array.isArray(sheet.rows) || !Array.isArray(sheet.columns)) return;
    const cols = sheet.columns;
    const peselI = cols.findIndex(c => /pesel/i.test(String(c || '')));
    const nipI = cols.findIndex(c => /nip/i.test(String(c || '')));
    const nameI = cols.findIndex(c => /nazwisk|imi[eę]|osoba|nazwa|zobowi|d[lł]u[zż]nik/i.test(String(c || '')));
    sheet.rows.forEach((r, i) => {
      const pesel = peselI >= 0 ? String(r[peselI] || '').replace(/\D/g, '') : '';
      const nip = nipI >= 0 ? String(r[nipI] || '').replace(/\D/g, '') : '';
      let name = nameI >= 0 ? String(r[nameI] || '').trim() : '';
      if (!name && dbSheet === sheet) {
        try { name = extractPersonInfo(r).name || ''; } catch {}
      }
      if (!pesel && !nip) return;
      const rec = { name: name || (pesel ? ('PESEL ' + pesel) : ('NIP ' + nip)), pesel, nip, rowIndex: i };
      if (pesel) map[pesel] = rec;
      if (nip) map[nip] = rec;
    });
  }

  function getIdIndex() {
    const map = {};
    if (dbSheet) indexSheetPeople(dbSheet, map);
    if (Object.keys(map).length) return map;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return map;
      const data = JSON.parse(raw);
      const sheets = data && data.sheets;
      if (!Array.isArray(sheets)) return map;
      const ranked = sheets.slice().sort((a, b) => {
        const score = s => {
          let n = (s.rows || []).length;
          if (/zobowi|rejestr/i.test(String(s.name || ''))) n += 100000;
          return n;
        };
        return score(b) - score(a);
      });
      ranked.forEach(s => indexSheetPeople(s, map));
    } catch {}
    return map;
  }

  function lookupById(id) {
    const want = String(id || '').replace(/\D/g, '');
    if (!want || want.length < 10) return null;
    return getIdIndex()[want] || null;
  }

  function openById(id) {
    const hit = lookupById(id);
    if (!hit || !dbSheet) {
      if (typeof showToast === 'function') showToast('Nie ma takiej osoby w Szafce / Arkuszu', 'info', 2500);
      return false;
    }
    selectRow(hit.rowIndex);
    return true;
  }
  async function activate(params = {}) {
    bindArkuszSyncListeners();
    const savedArchive = loadJsonKey(ARCHIVE_IDS_KEY, {});
    if (savedArchive && typeof savedArchive === 'object' && !Array.isArray(savedArchive)) {
      archiveMap = savedArchive;
    }
    const container = document.getElementById('zobowiazani-app');
    const alreadyLive = activated && dbSheet && container && container.querySelector('.zob-header');
    activated = true;
    if (!alreadyLive) {
      await render();
    }
    persistZawieszoneStore();
    const stamped = stampAllUfgFromCepik();
    if (stamped && typeof showToast === 'function') {
      showToast('UFG: wpisano datę przy ' + stamped + ' osobach z pojazdem CEPIK', 'success', 2800);
    }
    if (stamped) renderViews({ keepScroll: true });
    const key = params.pesel || params.nip;
    if (key) {
      const hit = lookupById(key);
      if (hit) selectRow(hit.rowIndex);
      else if (typeof showToast === 'function') {
        showToast('Brak teczki w Szafce dla ' + key, 'info', 2800);
      }
    }
  }

  return {
    activate,
    select: selectRow,
    toggle: toggleSystem,
    setAll: setAllSystems,
    setFilter,
    toggleFilters,
    setSection,
    sortBy,
    setTab: setDetailTab,
    prevPerson,
    nextPerson,
    nextTodo,
    activateTab,
    closeTab,
    closeActiveTab,
    minimizeFolder,
    toggleFocus,
    togglePin,
    toggleSuspend,
    archivePerson,
    applyArchiveIds,
    afterExcelRefresh,
    isSuspended,
    archiveByKey,
    markWroItem,
    setMinDochod,
    setDetailTab,
    invalidateListCache,
    refreshAfterWroSync() { invalidateListCache(); if (activated) renderViews(); },
    openRowMenu,
    openTabMenu,
    syncCepik: syncCepikForPerson,
    syncAllCepik: syncAllCepikFromWro,
    stampUfgIfCar,
    lookupById,
    getIdIndex,
    openById,
    openWro: openWroForPerson,
    copyCleanExcel: copyCleanExcelText,
    copy: copyToClipboard,
    loadJsonFile: triggerFilePicker,
    refreshFromArkusz,
    deferDays: deferByDays,
    deferPick: deferPickDate,
    openDeferMenu,
    clearDefer
  };

})();
