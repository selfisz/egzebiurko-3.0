/* ============================================================
   Egzebiurko 3.0 — zobowiazani.js
   Szafka teczek: lista osób + otwarta teczka (Dane / Systemy / CEPIK / Notatka)
   Synchronizacja CEPIK / UFG z modułem Analityka WRO
   ============================================================ */

'use strict';

const ZobowiazaniModule = (() => {

  const AUTOSAVE_KEY = 'ots_autosave_v1';
  const REG_SYSTEMS = ['KAWA', 'SINF', 'UFG', 'JPK', 'INFZ'];
  const FILE_SOURCE_KEY = 'egze3_zob_file_source';

  let activated = false;
  let dbData = null;
  let dbSheet = null;
  let dbSheetIndex = -1;
  let dataSourceLabel = ''; // 'Arkusz' | 'localStorage' | nazwa pliku
  
  // Stan filtrów i widoku
  let filterText = '';
  let activeFilter = 'all'; // 'all', 'todo', 'progress', 'complete', 'has_cepik', 'no_kawa', 'no_jpk', 'no_ufg', 'no_sinf', 'no_infz'
  let sortCol = 'idx';
  let sortDir = 1;
  let selectedRowIndex = 0;
  let detailOpen = true;
  let detailTab = 'dane'; // 'dane' | 'systemy' | 'cepik' | 'notatka'
  let dbErrorMsg = '';
  let folderAnimToken = 0;

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

    let bestIndex = -1;
    let maxRows = -1;

    data.sheets.forEach((s, idx) => {
      const name = s.name || '';
      const isMatch = (name.toLowerCase() === 'zobowiązani' ||
                       name.toLowerCase() === 'rejestr' ||
                       name.toLowerCase().includes('zobowiązani') ||
                       (s.columns && s.columns.some(c => /pesel/i.test(c) || /nip/i.test(c))));

      if (isMatch) {
        const rowCount = (s.rows || []).length;
        if (rowCount > maxRows) {
          maxRows = rowCount;
          bestIndex = idx;
        }
      }
    });

    if (bestIndex < 0) {
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
  async function loadDataAsync() {
    dbErrorMsg = '';

    // 1) Lokalna kopia (po wcześniejszym wczytaniu JSON / Arkusza)
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

    // 2) Arkusz (iframe)
    try {
      if (typeof ArkuszModule !== 'undefined') {
        ArkuszModule.ensureIframe();
      }

      const frame = document.getElementById('arkusz-frame');
      if (!frame || !frame.contentWindow) {
        throw new Error('Iframe arkusz-frame nie istnieje lub brak dostępu.');
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
        }, 100);

        setTimeout(() => {
          window.removeEventListener('message', handler);
          clearInterval(intervalId);
          reject(new Error('Brak odpowiedzi od Arkusza (timeout).'));
        }, 2000);
      });

      if (!raw) throw new Error('Pusta odpowiedź z Arkusza');
      const parsed = normalizeToDbData(typeof raw === 'string' ? JSON.parse(raw) : raw);
      if (selectBestSheet(parsed)) {
        dataSourceLabel = 'Arkusz';
        persistLocal();
        return true;
      }
      throw new Error('Arkusz nie zawiera arkusza z danymi');
    } catch (e) {
      console.error('[ZobowiazaniModule] Błąd wczytywania:', e);
      dbErrorMsg = e.toString();
      return false;
    }
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
    const needed = [...REG_SYSTEMS, 'Stan', 'Komplet', 'Notatka'];
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

  function saveData() {
    if (!dbData || !dbSheet) return;
    try {
      dbData.savedAt = new Date().toISOString();
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
        if (REG_SYSTEMS.includes(cName) || ['Stan', 'Komplet', 'LP', 'L.p.', 'Lp', 'ID', 'Notatka'].includes(cName)) continue;
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
        return nA.localeCompare(nB) * sortDir;
      });
    } else if (sortCol === 'stan') {
      rowsWithIndex.sort((a, b) => {
        const cA = getPersonSysCount(a.row);
        const cB = getPersonSysCount(b.row);
        return (cA - cB) * sortDir;
      });
    } else if (typeof sortCol === 'number' && sortCol >= 0) {
      rowsWithIndex.sort((a, b) => {
        const valA = String(a.row[sortCol] || '').toLowerCase();
        const valB = String(b.row[sortCol] || '').toLowerCase();
        const numA = parseFloat(valA.replace(',', '.'));
        const numB = parseFloat(valB.replace(',', '.'));
        if (!isNaN(numA) && !isNaN(numB)) return (numA - numB) * sortDir;
        return valA.localeCompare(valB) * sortDir;
      });
    }

    return rowsWithIndex;
  }

  function computeFilterCounts() {
    if (!dbSheet || !dbSheet.rows) return { all: 0, todo: 0, progress: 0, complete: 0, cepik: 0 };
    let todo = 0, progress = 0, complete = 0, cepikCount = 0;
    dbSheet.rows.forEach(r => {
      const c = getPersonSysCount(r);
      if (c === 0) todo++;
      else if (c === REG_SYSTEMS.length) complete++;
      else progress++;

      const info = extractPersonInfo(r);
      if (getCepikForPerson(info)) cepikCount++;
    });
    return { all: dbSheet.rows.length, todo, progress, complete, cepik: cepikCount };
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
                Wskaż eksport Arkusza (<code>.json</code> / <code>.js</code>) — bez iframe i bez <code>arkusz3.html</code>.
              </p>
              <button class="zob-action-btn primary" style="align-self:center;height:40px;padding:0 22px" onclick="ZobowiazaniModule.loadJsonFile()">
                Wczytaj bazę (.json)
              </button>
              ${dbErrorMsg ? `<div style="color:var(--zob-spine);font-size:.82rem;text-align:left;margin-top:8px"><strong>Arkusz:</strong> ${escapeHtml(dbErrorMsg)}</div>` : ''}
            </div>
          </div>
        `;
        return;
      }

      const counts = computeFilterCounts();

      container.innerHTML = `
        <div class="zob-wrap">
          <div class="zob-header">
            <div class="zob-title-area">
              <h2 class="zob-mod-title">Szafka teczek</h2>
              <p class="zob-mod-sub">Kartoteka: <strong>${escapeHtml(dbSheet.name || 'Zobowiązani')}</strong> · źródło: <strong>${escapeHtml(dataSourceLabel || '—')}</strong> — ${dbSheet.rows.length} teczek</p>
            </div>
            <div class="zob-actions">
              <button class="zob-action-btn primary" onclick="ZobowiazaniModule.loadJsonFile()" title="Wczytaj bazę z pliku JSON / JS">Wczytaj JSON</button>
              <button class="zob-action-btn olive" onclick="ZobowiazaniModule.copyCleanExcel()" title="Kopiuje widoczne teczki jako czysty tekst do Excela">Kopiuj do Excela</button>
              <button class="zob-action-btn" onclick="ZobowiazaniModule.syncAllCepik()" title="Auto-sync CEPIK z WRO">Auto-Sync CEPIK</button>
              <button class="zob-action-btn" onclick="ZobowiazaniModule.toggleDetailPane()" title="Pokaż/Ukryj otwartą teczkę">Teczka</button>
            </div>
          </div>

          <div class="zob-toolbar">
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
                Do zrobienia <span class="zob-pill-count">${counts.todo}</span>
              </button>
              <button class="zob-pill pill-warn ${activeFilter === 'progress' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('progress')">
                W toku <span class="zob-pill-count">${counts.progress}</span>
              </button>
              <button class="zob-pill pill-ok ${activeFilter === 'complete' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('complete')">
                Komplet <span class="zob-pill-count">${counts.complete}</span>
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

          <div class="zob-split-container">
            <aside class="zob-drawer">
              <div class="zob-drawer-head">Teczki w szufladzie</div>
              <div class="zob-folder-scroll" id="zob-folder-list"></div>
            </aside>
            <section class="zob-folder-open ${detailOpen ? '' : 'collapsed'}" id="zob-detail-pane">
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
  function renderViews() {
    renderTableOnly();
    renderDetailOnly();
    updatePillsBar();
  }

  function updatePillsBar() {
    const counts = computeFilterCounts();
    const statsEl = document.getElementById('zob-stats-badge');
    const visibleRows = getFilteredRows();
    if (statsEl) {
      statsEl.innerHTML = `Pokazano: <strong>${visibleRows.length}</strong> z <strong>${counts.all}</strong>`;
    }
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
    return { cls: 'todo', label: 'Do zrobienia' };
  }

  function renderTableOnly() {
    const list = document.getElementById('zob-folder-list');
    if (!list || !dbSheet) return;

    const visibleRows = getFilteredRows();

    if (!visibleRows.length) {
      list.innerHTML = `<div class="zob-folder-empty">Brak teczek spełniających wybrane kryteria</div>`;
      return;
    }

    if (!visibleRows.some(item => item.idx === selectedRowIndex)) {
      selectedRowIndex = visibleRows[0].idx;
    }

    let html = '';
    visibleRows.forEach((item) => {
      const r = item.row;
      const ri = item.idx;
      const info = extractPersonInfo(r);
      const isSelected = ri === selectedRowIndex;
      const sysCount = getPersonSysCount(r);
      const cepik = getCepikForPerson(info);
      const st = statusMeta(sysCount);

      let dots = '';
      REG_SYSTEMS.forEach(sys => {
        const sysIdx = dbSheet.columns.indexOf(sys);
        const sysVal = sysIdx >= 0 ? String(r[sysIdx] || '').trim() : '';
        const isDone = sysVal !== '' && sysVal.toLowerCase() !== 'pomiń';
        const isSkip = sysVal.toLowerCase() === 'pomiń';
        dots += `<span class="zob-dot ${isDone ? 'on' : ''}${isSkip ? ' skip' : ''}" title="${sys}"></span>`;
      });

      html += `
        <button type="button" class="zob-teczka ${isSelected ? 'is-selected' : ''}" onclick="ZobowiazaniModule.select(${ri})" aria-pressed="${isSelected}">
          <span class="zob-teczka-spine" aria-hidden="true"></span>
          <span class="zob-teczka-body">
            <span class="zob-teczka-name" title="${escapeHtml(info.name)}">${escapeHtml(info.name)}</span>
            <span class="zob-teczka-meta">
              ${info.pesel ? `<span class="zob-teczka-id">${escapeHtml(info.pesel)}</span>` : ''}
              ${info.nip ? `<span class="zob-teczka-id">NIP ${escapeHtml(info.nip)}</span>` : ''}
              ${cepik ? `<span class="zob-teczka-cepik">${cepik.vehicles.length} poj.</span>` : ''}
            </span>
            <span class="zob-teczka-foot">
              <span class="zob-teczka-dots">${dots}</span>
              <span class="zob-status-chip ${st.cls}">${st.label}</span>
            </span>
          </span>
        </button>
      `;
    });

    list.innerHTML = html;

    const selectedEl = list.querySelector('.zob-teczka.is-selected');
    if (selectedEl) {
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

    if (selectedRowIndex < 0 || selectedRowIndex >= dbSheet.rows.length) {
      detailContent.innerHTML = `<div class="zob-folder-empty" style="padding:48px 24px">Wybierz teczkę z szuflady po lewej</div>`;
      return;
    }

    const r = dbSheet.rows[selectedRowIndex];
    const info = extractPersonInfo(r);
    const sysCount = getPersonSysCount(r);
    const visibleRows = getFilteredRows();
    const curVisIdx = visibleRows.findIndex(item => item.idx === selectedRowIndex);
    const cepik = getCepikForPerson(info);
    const st = statusMeta(sysCount);
    const animKey = ++folderAnimToken;

    const tabs = [
      { id: 'dane', label: 'Dane' },
      { id: 'systemy', label: 'Systemy' },
      { id: 'cepik', label: 'CEPIK' },
      { id: 'notatka', label: 'Notatka' },
    ];

    let bodyHtml = '';

    if (detailTab === 'dane') {
      bodyHtml = `
        <div class="zob-sheet">
          <div class="zob-sheet-title"><span>Dane identyfikacyjne</span><span>Kliknij, by skopiować</span></div>
          ${info.pesel ? `<div class="zob-id-row"><span class="zob-id-label">PESEL</span><span class="zob-badge-mono" onclick="ZobowiazaniModule.copy('${info.pesel}', this)">${info.pesel}</span></div>` : ''}
          ${info.nip ? `<div class="zob-id-row"><span class="zob-id-label">NIP</span><span class="zob-badge-mono" onclick="ZobowiazaniModule.copy('${info.nip}', this)">${info.nip}</span></div>` : ''}
          ${info.regon ? `<div class="zob-id-row"><span class="zob-id-label">REGON</span><span class="zob-badge-mono" onclick="ZobowiazaniModule.copy('${info.regon}', this)">${info.regon}</span></div>` : ''}
          ${info.adresStr ? `<div class="zob-id-row"><span class="zob-id-label">Adres</span><span class="zob-kv-val" onclick="ZobowiazaniModule.copy('${escapeHtml(info.adresStr).replace(/'/g, "\\'")}', this)">${escapeHtml(info.adresStr)}</span></div>` : ''}
          ${(info.sygnatura || info.kwota) ? `<div class="zob-id-row"><span class="zob-id-label">Sprawa</span><span class="zob-kv-val">${escapeHtml([info.sygnatura, info.kwota].filter(Boolean).join(' · '))}</span></div>` : ''}
        </div>
        <div class="zob-sheet">
          <div class="zob-sheet-title"><span>Pozostałe pola z Arkusza</span></div>
          <div class="zob-kv-grid">
            ${dbSheet.columns.map((colName, cIdx) => {
              if (REG_SYSTEMS.includes(colName) || colName === 'Stan' || colName === 'Komplet') return '';
              const rawVal = String(r[cIdx] || '').trim();
              if (!rawVal) return '';
              const isLong = rawVal.length > 25;
              return `<div class="zob-kv-item ${isLong ? 'full' : ''}">
                <div class="zob-kv-label">${escapeHtml(colName)}</div>
                <div class="zob-kv-val" onclick="ZobowiazaniModule.copy('${escapeHtml(rawVal).replace(/'/g, "\\'")}', this)">${escapeHtml(rawVal)}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    } else if (detailTab === 'systemy') {
      bodyHtml = `
        <div class="zob-sheet">
          <div class="zob-sheet-title">
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
        <div>
          <div class="zob-open-title">${escapeHtml(info.name)}</div>
          <div class="zob-open-sub">Teczka #${selectedRowIndex + 1} · <span class="zob-status-chip ${st.cls}">${st.label}</span> · ${sysCount}/5 systemów</div>
        </div>
        <button class="zob-btn-komplet" onclick="ZobowiazaniModule.setAll(${selectedRowIndex})" title="Oznacz komplet">Komplet</button>
      </div>
      <div class="zob-open-tabs">
        ${tabs.map(t => `<button type="button" class="zob-tab ${detailTab === t.id ? 'active' : ''}" onclick="ZobowiazaniModule.setTab('${t.id}')">${t.label}</button>`).join('')}
      </div>
      <div class="zob-open-body" key="${detailTab}-${animKey}">
        ${bodyHtml}
      </div>
      <div class="zob-open-footer">
        <button class="zob-nav-btn" onclick="ZobowiazaniModule.prevPerson()" title="Poprzednia teczka">← Poprzedni</button>
        <span class="zob-mod-sub">${curVisIdx >= 0 ? `${curVisIdx + 1} / ${visibleRows.length}` : ''}</span>
        <button class="zob-nav-btn" onclick="ZobowiazaniModule.nextPerson()" title="Następna teczka">Następny →</button>
        <button class="zob-nav-btn accent" onclick="ZobowiazaniModule.nextTodo()" title="Następna niekompletna">Do zrobienia</button>
      </div>
    `;

    const noteInput = document.getElementById('zob-note-input');
    if (noteInput) {
      noteInput.addEventListener('blur', () => {
        saveNote(selectedRowIndex, noteInput.value);
      });
    }

    // Restart tab animation
    const body = detailContent.querySelector('.zob-open-body');
    if (body) {
      body.style.animation = 'none';
      void body.offsetWidth;
      body.style.animation = '';
    }
  }

  /* ─── NAWIGACJA I AKCJE ────────────────────────────────── */
  function selectRow(ri) {
    selectedRowIndex = ri;
    if (!detailOpen) {
      detailOpen = true;
      const pane = document.getElementById('zob-detail-pane');
      if (pane) pane.classList.remove('collapsed');
    }
    renderViews();
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
    renderViews();
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

  function toggleDetailPane() {
    detailOpen = !detailOpen;
    const pane = document.getElementById('zob-detail-pane');
    if (pane) {
      pane.classList.toggle('collapsed', !detailOpen);
    }
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

  /* ─── API MODUŁU ──────────────────────────────────────── */
  async function activate(params = {}) {
    activated = true;
    await render();
  }

  return {
    activate,
    select: selectRow,
    toggle: toggleSystem,
    setAll: setAllSystems,
    setFilter,
    sortBy,
    setTab: setDetailTab,
    prevPerson,
    nextPerson,
    nextTodo,
    toggleDetailPane,
    syncCepik: syncCepikForPerson,
    syncAllCepik: syncAllCepikFromWro,
    copyCleanExcel: copyCleanExcelText,
    copy: copyToClipboard,
    loadJsonFile: triggerFilePicker
  };

})();
