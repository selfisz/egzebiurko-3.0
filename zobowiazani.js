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
  let sectionFilter = 'active'; // 'active' | 'desk' | 'archive'
  let sortCol = 'idx';
  let sortDir = 1;
  let selectedRowIndex = 0;
  /** @type {'list'|'split'|'focus'} */
  let viewMode = 'list';
  /** @type {{key:string, rowIndex:number, name:string}[]} */
  let openTabs = [];
  let activeTabKey = '';
  let detailTab = 'dane'; // 'dane' | 'systemy' | 'cepik' | 'notatka'
  let filtersOpen = false;
  let dbErrorMsg = '';
  let folderAnimToken = 0;
  let deskPins = loadJsonKey(DESK_PINS_KEY, []);
  let archiveMap = loadJsonKey(ARCHIVE_IDS_KEY, {});
  if (!Array.isArray(deskPins)) deskPins = [];
  if (!archiveMap || typeof archiveMap !== 'object' || Array.isArray(archiveMap)) archiveMap = {};
  restoreOpenTabs();

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
      const handler = (e) => {
        if (e.data && e.data.type === 'DB_DATA') {
          window.removeEventListener('message', handler);
          clearInterval(intervalId);
          resolve(e.data.payload);
        }
      };
      window.addEventListener('message', handler);

      intervalId = setInterval(() => {
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'GET_DB' }, '*');
        }
      }, 2000);

      setTimeout(() => {
        window.removeEventListener('message', handler);
        clearInterval(intervalId);
        reject(new Error('Brak odpowiedzi od Arkusza (timeout).'));
      }, timeoutMs);
    });

    if (!raw) throw new Error('Pusta odpowiedź z Arkusza');
    const parsed = normalizeToDbData(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (!selectBestSheet(parsed)) {
      throw new Error('Arkusz nie zawiera arkusza z danymi');
    }
    _lastSyncedAt = parsed.savedAt || '';
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
    const needed = [...REG_SYSTEMS, 'Stan', 'Komplet', 'Notatka', DEFER_COL];
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
    if (typeof showToast === 'function') showToast(`Przypomnienie: wróć ${trimmed}`, 'info', 2200);
  }

  function clearDefer(rowIndex) {
    setDeferDate(rowIndex, '');
    if (typeof showToast === 'function') showToast('Zdjęto odłożenie', 'info', 1600);
  }

  function saveData() {
    if (!dbData || !dbSheet) return;
    try {
      dbData.savedAt = new Date().toISOString();
      _lastSyncedAt = dbData.savedAt;
      // Blokuj echo sync na czas zapisu (wcześniej: SET_DB → reload → pusta baza / miganie)
      _suppressSyncUntil = Date.now() + 2500;
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

  function recalcRowStatus(ri) {
    if (!dbSheet || !dbSheet.columns) return;
    const row = dbSheet.rows[ri];
    ensureSystemColumns(dbSheet);
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
  function extractPersonInfo(row) {
    const cols = dbSheet.columns || [];
    
    const getColVal = (idx) => {
      return (idx >= 0 && idx < row.length) ? String(row[idx] || '').trim() : '';
    };

    const findColIdx = (regex) => {
      return cols.findIndex(c => regex.test(String(c || '').trim()));
    };

    // 1. PESEL / NIP / REGON
    const peselIdx = findColIdx(/^pesel$/i) >= 0 ? findColIdx(/^pesel$/i) : findColIdx(/pesel/i);
    const pesel = getColVal(peselIdx);

    const nipIdx = findColIdx(/^nip$/i) >= 0 ? findColIdx(/^nip$/i) : findColIdx(/nip/i);
    const nip = getColVal(nipIdx);

    const regonIdx = findColIdx(/^regon$/i) >= 0 ? findColIdx(/^regon$/i) : findColIdx(/regon/i);
    const regon = getColVal(regonIdx);

    // 2. IMIĘ, NAZWISKO, PODMIOT, DŁUŻNIK, ZOBOWIĄZANY
    let name = '';
    
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

    for (const pat of nameColPatterns) {
      const idx = findColIdx(pat);
      if (idx >= 0) {
        const val = getColVal(idx);
        if (val) {
          name = val;
          break;
        }
      }
    }

    if (!name) {
      const nazwiskoIdx = findColIdx(/^nazwisko$/i) >= 0 ? findColIdx(/^nazwisko$/i) : findColIdx(/nazwisko/i);
      const imieIdx = findColIdx(/^imi[eę]$/i) >= 0 ? findColIdx(/^imi[eę]$/i) : findColIdx(/imi[eę]/i);
      const nVal = getColVal(nazwiskoIdx);
      const iVal = getColVal(imieIdx);
      if (nVal || iVal) {
        name = `${nVal} ${iVal}`.trim();
      }
    }

    if (!name) {
      for (let i = 0; i < cols.length; i++) {
        const cName = String(cols[i] || '').trim();
        if (REG_SYSTEMS.includes(cName) || ['Stan', 'Komplet', 'LP', 'L.p.', 'Lp', 'ID', 'Notatka', DEFER_COL].includes(cName)) continue;
        if (/pesel|nip|regon|data|kwota|sygn|stan|komplet|notatk/i.test(cName)) continue;
        
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

    // 3. ADRES
    let ulica = '', miasto = '', kod = '', adresStr = '';
    const ulicaIdx = findColIdx(/^(ulica|adres|ul\.|zamieszkanie|adres.*zamieszkania|siedziba)$/i) >= 0 
      ? findColIdx(/^(ulica|adres|ul\.|zamieszkanie|adres.*zamieszkania|siedziba)$/i)
      : findColIdx(/ulica|adres|zamieszk/i);
    ulica = getColVal(ulicaIdx);

    const miastoIdx = findColIdx(/^(miasto|miejscowo[sś][cć])$/i) >= 0
      ? findColIdx(/^(miasto|miejscowo[sś][cć])$/i)
      : findColIdx(/miejscowo[sś][cć]|miasto/i);
    miasto = getColVal(miastoIdx);

    const kodIdx = findColIdx(/^(kod|kod.*pocztowy|poczta)$/i) >= 0
      ? findColIdx(/^(kod|kod.*pocztowy|poczta)$/i)
      : findColIdx(/kod/i);
    kod = getColVal(kodIdx);

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

    // 4. KWOTA I SYGNATURA
    const kwotaIdx = findColIdx(/kwota|nale[zż]no[sś][cć]|zad[lł]u[zż]enie|suma/i);
    const kwota = getColVal(kwotaIdx);

    const sygnIdx = findColIdx(/sygnatura|sygn|sprawa|nr.*sprawy/i);
    const sygnatura = getColVal(sygnIdx);

    // 5. NOTATKA
    const notatkaIdx = findColIdx(/^notatka$/i) >= 0 ? findColIdx(/^notatka$/i) : findColIdx(/notatk/i);
    const notatka = getColVal(notatkaIdx);

    // 6. STAN
    const stanIdx = cols.indexOf('Stan');
    const stan = getColVal(stanIdx);

    return { name, pesel, nip, regon, adresStr, ulica, miasto, kod, kwota, sygnatura, notatka, stan };
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
  function getFilteredRows() {
    if (!dbSheet || !dbSheet.rows) return [];
    
    let rowsWithIndex = dbSheet.rows.map((row, idx) => ({ row, idx }));

    // Sekcje: Aktywne / Biurko / Archiwum
    rowsWithIndex = rowsWithIndex.filter(item => {
      const key = personKeyFromRow(item.row);
      const archived = isArchived(key);
      if (sectionFilter === 'archive') return archived;
      if (sectionFilter === 'desk') return isPinned(key) && !archived;
      return !archived; // active
    });

    if (filterText) {
      const query = filterText.toLowerCase();
      rowsWithIndex = rowsWithIndex.filter(item => {
        return item.row.some(cell => String(cell || '').toLowerCase().includes(query));
      });
    }

    if (activeFilter === 'todo') {
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
      rowsWithIndex = rowsWithIndex.filter(item => {
        const info = extractPersonInfo(item.row);
        return !!getCepikForPerson(info);
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
      rowsWithIndex.sort((a, b) => {
        const nA = extractPersonInfo(a.row).name.toLowerCase();
        const nB = extractPersonInfo(b.row).name.toLowerCase();
        return nA.localeCompare(nB, 'pl') * sortDir;
      });
    } else if (sortCol === 'pesel') {
      rowsWithIndex.sort((a, b) => {
        const nA = extractPersonInfo(a.row).pesel || extractPersonInfo(a.row).nip || '';
        const nB = extractPersonInfo(b.row).pesel || extractPersonInfo(b.row).nip || '';
        return String(nA).localeCompare(String(nB), 'pl') * sortDir;
      });
    } else if (sortCol === 'stan') {
      rowsWithIndex.sort((a, b) => {
        const cA = getPersonSysCount(a.row);
        const cB = getPersonSysCount(b.row);
        return (cA - cB) * sortDir;
      });
    } else if (sortCol === 'adres') {
      rowsWithIndex.sort((a, b) => {
        const nA = extractPersonInfo(a.row).adresStr.toLowerCase();
        const nB = extractPersonInfo(b.row).adresStr.toLowerCase();
        return nA.localeCompare(nB, 'pl') * sortDir;
      });
    } else if (sortCol === 'aktywnosc') {
      rowsWithIndex.sort((a, b) => {
        const dA = parseDatePl(getLastActivity(a.row)) || new Date(0);
        const dB = parseDatePl(getLastActivity(b.row)) || new Date(0);
        return (dA - dB) * sortDir;
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
      // domyślnie: kolejność jak w Arkuszu (idx)
      rowsWithIndex.sort((a, b) => (a.idx - b.idx) * (sortDir || 1));
    }

    return rowsWithIndex;
  }

  function computeSectionCounts() {
    if (!dbSheet || !dbSheet.rows) return { active: 0, desk: 0, archive: 0 };
    let active = 0, desk = 0, archive = 0;
    dbSheet.rows.forEach(r => {
      const key = personKeyFromRow(r);
      if (isArchived(key)) archive++;
      else {
        active++;
        if (isPinned(key)) desk++;
      }
    });
    return { active, desk, archive };
  }

  function computeFilterCounts() {
    if (!dbSheet || !dbSheet.rows) return { all: 0, todo: 0, progress: 0, complete: 0, cepik: 0, deferred: 0, due: 0 };
    let todo = 0, progress = 0, complete = 0, cepikCount = 0, deferred = 0, due = 0;
    let scoped = 0;
    dbSheet.rows.forEach(r => {
      const key = personKeyFromRow(r);
      const archived = isArchived(key);
      if (sectionFilter === 'archive' && !archived) return;
      if (sectionFilter === 'desk' && (!(isPinned(key) && !archived))) return;
      if (sectionFilter === 'active' && archived) return;
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
    });
    return { all: scoped, todo, progress, complete, cepik: cepikCount, deferred, due };
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
          </div>

          <div class="zob-split-container mode-${viewMode}" id="zob-split">
            <aside class="zob-drawer" id="zob-drawer">
              <div class="zob-drawer-head">
                <span class="zob-drawer-head-title">${sectionFilter === 'desk' ? 'Biurko' : sectionFilter === 'archive' ? 'Archiwum' : 'Lista zobowiązanych'}</span>
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
          renderViews();
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

  function renderViews() {
    rematchOpenTabs();
    applyViewMode();
    renderBrowserTabs();
    renderTableOnly();
    renderDetailOnly();
    updatePillsBar();
    updateSectionsBar();
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

  function updatePillsBar() {
    const counts = computeFilterCounts();
    const statsEl = document.getElementById('zob-stats-badge');
    const visibleRows = getFilteredRows();
    if (statsEl) {
      statsEl.innerHTML = `Pokazano: <strong>${visibleRows.length}</strong> z <strong>${counts.all}</strong>`;
    }
    const drawerCount = document.getElementById('zob-drawer-count');
    if (drawerCount) drawerCount.textContent = String(visibleRows.length);
    const bar = document.getElementById('zob-pills-bar');
    if (!bar) return;
    bar.querySelectorAll('.zob-pill').forEach(btn => {
      const onclick = btn.getAttribute('onclick') || '';
      const m = onclick.match(/setFilter\('([^']+)'\)/);
      if (!m) return;
      btn.classList.toggle('active', m[1] === activeFilter);
    });
  }

  function statusMeta(sysCount) {
    if (sysCount === REG_SYSTEMS.length) return { cls: 'complete', label: 'Komplet' };
    if (sysCount > 0) return { cls: 'progress', label: 'W toku' };
    return { cls: 'todo', label: 'Braki' };
  }

  function sortMark(key) {
    if (sortCol !== key) return '';
    return `<span class="sort-ind">${sortDir > 0 ? '▲' : '▼'}</span>`;
  }

  function renderTableOnly() {
    const list = document.getElementById('zob-folder-list');
    if (!list || !dbSheet) return;

    const visibleRows = getFilteredRows();
    const fullCols = viewMode === 'list';

    if (!visibleRows.length) {
      list.innerHTML = `<div class="zob-folder-empty">Brak osób spełniających wybrane kryteria</div>`;
      return;
    }

    let body = '';
    visibleRows.forEach((item, displayIdx) => {
      const r = item.row;
      const ri = item.idx;
      const info = extractPersonInfo(r);
      const key = personKeyFromInfo(info);
      const isSelected = viewMode !== 'list' && ri === selectedRowIndex && activeTabKey === key;
      const sysCount = getPersonSysCount(r);
      const st = statusMeta(sysCount);
      const defer = getDeferInfo(r);
      const pinned = isPinned(key);
      const lastAct = getLastActivity(r);
      const adresShort = (info.adresStr || '').length > 42
        ? (info.adresStr.slice(0, 40) + '…')
        : (info.adresStr || '—');

      let dots = '';
      REG_SYSTEMS.forEach(sys => {
        const sysIdx = dbSheet.columns.indexOf(sys);
        const sysVal = sysIdx >= 0 ? String(r[sysIdx] || '').trim() : '';
        const isDone = sysVal !== '' && sysVal.toLowerCase() !== 'pomiń';
        const isSkip = sysVal.toLowerCase() === 'pomiń';
        dots += `<span class="zob-dot ${isDone ? 'on' : ''}${isSkip ? ' skip' : ''}" title="${sys}: ${escapeHtml(sysVal || 'brak')}"></span>`;
      });

      const idLine = [info.pesel, info.nip ? `NIP ${info.nip}` : ''].filter(Boolean).join(' · ');
      const deferChip = defer
        ? `<span class="zob-defer-chip ${defer.due ? 'due' : 'wait'}" title="Odłożone — wróć ${escapeHtml(defer.raw)}">${defer.due ? 'Do powrotu' : 'Na później'} ${escapeHtml(defer.raw)}</span>`
        : '';

      body += `
        <tr class="${isSelected ? 'is-selected' : ''}${pinned ? ' is-pinned' : ''}" data-ri="${ri}"
          onclick="ZobowiazaniModule.select(${ri})"
          oncontextmenu="ZobowiazaniModule.openRowMenu(event, ${ri})">
          ${fullCols ? `<td style="width:36px;color:var(--zob-ink-soft);font-size:.72rem">${displayIdx + 1}</td>` : ''}
          <td>
            <div class="zob-reg-name" title="${escapeHtml(info.name)}">${escapeHtml(info.name)}</div>
            ${idLine ? `<div class="zob-reg-ids">${fullCols ? escapeHtml(idLine) : escapeHtml(info.pesel ? `PESEL: ${info.pesel}` : (info.nip ? `NIP: ${info.nip}` : idLine))}</div>` : ''}
            ${!fullCols ? `<div class="zob-systems-dots">${dots}<span class="zob-systems-count">${sysCount}/5</span></div>` : ''}
            ${!fullCols ? deferChip : ''}
          </td>
          ${fullCols ? `<td class="zob-reg-ids">${escapeHtml(idLine || '—')}</td>` : ''}
          ${fullCols ? `<td title="${escapeHtml(info.adresStr || '')}"><span class="zob-reg-addr">${escapeHtml(adresShort)}</span></td>` : ''}
          ${fullCols ? `<td>
            <div class="zob-reg-sys">${dots}<span class="zob-reg-sys-count">${sysCount}/5</span></div>
          </td>` : ''}
          <td style="text-align:${fullCols ? 'center' : 'right'}"><span class="zob-status-chip ${st.cls}">${st.label}</span></td>
          ${fullCols ? `<td>${deferChip || '<span class="zob-muted">—</span>'}</td>` : ''}
          ${fullCols ? `<td class="zob-reg-ids">${escapeHtml(lastAct || '—')}</td>` : ''}
          ${fullCols ? `<td style="text-align:center" onclick="event.stopPropagation()">
            <button type="button" class="zob-pin-btn ${pinned ? 'on' : ''}" title="${pinned ? 'Zdejmij z Biurka' : 'Przypnij do Biurka'}"
              onclick="ZobowiazaniModule.togglePin(decodeURIComponent('${encodeURIComponent(key)}'))">${pinned ? '📌' : '📍'}</button>
          </td>` : ''}
        </tr>
      `;
    });

    const drawer = document.querySelector('.zob-drawer');
    if (drawer) drawer.classList.toggle('compact', !fullCols);

    list.innerHTML = `
      <table class="zob-reg-table ${fullCols ? 'zob-reg-full' : 'zob-reg-compact'}">
        <thead>
          <tr>
            ${fullCols ? `<th style="width:36px" onclick="ZobowiazaniModule.sortBy('idx')" class="${sortCol === 'idx' ? 'is-sorted' : ''}">#${sortMark('idx')}</th>` : ''}
            <th onclick="ZobowiazaniModule.sortBy('name')" class="${sortCol === 'name' ? 'is-sorted' : ''}">Nazwisko i imię${sortMark('name')}</th>
            ${fullCols ? `<th onclick="ZobowiazaniModule.sortBy('pesel')" class="${sortCol === 'pesel' ? 'is-sorted' : ''}">PESEL / NIP${sortMark('pesel')}</th>` : ''}
            ${fullCols ? `<th onclick="ZobowiazaniModule.sortBy('adres')" class="${sortCol === 'adres' ? 'is-sorted' : ''}">Adres${sortMark('adres')}</th>` : ''}
            ${fullCols ? `<th onclick="ZobowiazaniModule.sortBy('stan')" class="${sortCol === 'stan' ? 'is-sorted' : ''}" style="width:120px">Systemy${sortMark('stan')}</th>` : ''}
            <th onclick="ZobowiazaniModule.sortBy('stan')" class="${sortCol === 'stan' ? 'is-sorted' : ''}" style="width:${fullCols ? '100px' : '88px'};text-align:${fullCols ? 'center' : 'right'}">Status${sortMark('stan')}</th>
            ${fullCols ? `<th>Wróć</th>` : ''}
            ${fullCols ? `<th onclick="ZobowiazaniModule.sortBy('aktywnosc')" class="${sortCol === 'aktywnosc' ? 'is-sorted' : ''}">Ostatnia czynność${sortMark('aktywnosc')}</th>` : ''}
            ${fullCols ? `<th style="width:44px;text-align:center" title="Biurko">📌</th>` : ''}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;

    const selectedEl = list.querySelector('tr.is-selected');
    if (selectedEl && viewMode !== 'list') {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    const st = statusMeta(sysCount);
    const defer = getDeferInfo(r);
    const animKey = ++folderAnimToken;

    const tabs = [
      { id: 'dane', label: 'Dane' },
      { id: 'systemy', label: 'Systemy' },
      { id: 'cepik', label: 'CEPIK' },
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

      const skipCols = new Set([...REG_SYSTEMS, 'Stan', 'Komplet', DEFER_COL]);
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
              ${cepik.vehicles.map(v => `
                <div class="zob-vehicle">
                  <div>
                    <div class="zob-vehicle-brand">${escapeHtml(v.brand || 'Pojazd')}</div>
                    <div class="zob-vehicle-meta">${v.vin ? `VIN: ${escapeHtml(v.vin)}` : ''} ${v.polisa ? `· Polisa: ${escapeHtml(v.polisa)}` : ''}</div>
                  </div>
                  <span class="zob-badge-mono">${escapeHtml(v.plate || 'Brak tablicy')}</span>
                </div>
              `).join('')}
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
          <div class="zob-open-sub"><span class="zob-status-chip ${st.cls}">${st.label}</span> · ${sysCount}/5 systemów · #${selectedRowIndex + 1}${defer ? ` · <span class="zob-defer-chip ${defer.due ? 'due' : 'wait'}">${defer.due ? 'Do powrotu' : 'Na później'} ${escapeHtml(defer.raw)}</span>` : ''}</div>
        </div>
        <div class="zob-open-header-actions">
          <button type="button" class="zob-pin-btn ${isPinned(pkey) ? 'on' : ''}" onclick="ZobowiazaniModule.togglePin(decodeURIComponent('${encodeURIComponent(pkey)}'))" title="Biurko">${isPinned(pkey) ? '📌 Biurko' : '📍 Biurko'}</button>
          <button type="button" class="zob-action-btn" onclick="ZobowiazaniModule.deferDays(${selectedRowIndex}, 3)" title="Odłóż o 3 dni">Odłóż +3</button>
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

  function selectRow(ri) {
    openOrActivateTab(ri);
    renderViews();
  }

  function activateTab(key) {
    const t = openTabs.find(x => x.key === key);
    if (!t) return;
    activeTabKey = key;
    selectedRowIndex = t.rowIndex;
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
      { label: 'Odłóż +3 dni', action: () => deferByDays(ri, 3) },
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
    sectionFilter = sec === 'desk' || sec === 'archive' ? sec : 'active';
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

  function applyArchiveIds(ids, meta) {
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

  /* ─── API MODUŁU ──────────────────────────────────────── */
  async function activate(params = {}) {
    bindArkuszSyncListeners();
    const container = document.getElementById('zobowiazani-app');
    const alreadyLive = activated && dbSheet && container && container.querySelector('.zob-header');
    activated = true;
    if (alreadyLive) {
      renderViews();
      return;
    }
    await render();
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
    archivePerson,
    applyArchiveIds,
    openRowMenu,
    openTabMenu,
    syncCepik: syncCepikForPerson,
    syncAllCepik: syncAllCepikFromWro,
    copyCleanExcel: copyCleanExcelText,
    copy: copyToClipboard,
    loadJsonFile: triggerFilePicker,
    refreshFromArkusz,
    deferDays: deferByDays,
    deferPick: deferPickDate,
    clearDefer
  };

})();
