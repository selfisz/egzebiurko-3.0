/* ============================================================
   Egzebiurko 3.0 — modules/zobowiazani.js
   Hybrydowy panel: Smart Tabela + Master-Detail + Szybkie Filtry
   Pełna synchronizacja CEPIK / UFG z modułem Analityka WRO
   ============================================================ */

'use strict';

const ZobowiazaniModule = (() => {

  const AUTOSAVE_KEY = 'ots_autosave_v1';
  const REG_SYSTEMS = ['KAWA', 'SINF', 'UFG', 'JPK', 'INFZ'];

  let activated = false;
  let dbData = null;
  let dbSheet = null;
  let dbSheetIndex = -1;
  
  // Stan filtrów i widoku
  let filterText = '';
  let activeFilter = 'all'; // 'all', 'todo', 'progress', 'complete', 'has_cepik', 'no_kawa', 'no_jpk', 'no_ufg', 'no_sinf', 'no_infz'
  let sortCol = 'idx';
  let sortDir = 1;
  let selectedRowIndex = 0;
  let detailOpen = true;
  let dbErrorMsg = '';

  /* ─── SYNCHRONIZACJA Z ARKUSZEM ────────────────────────── */
  async function loadDataAsync() {
    try {
      if (typeof ArkuszModule !== 'undefined') {
        ArkuszModule.ensureIframe();
      }
      
      const frame = document.getElementById('arkusz-frame');
      if (!frame || !frame.contentWindow) {
        throw new Error("Iframe arkusz-frame nie istnieje lub brak dostępu.");
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
          reject(new Error("Brak odpowiedzi od Arkusza (timeout)."));
        }, 2000);
      });

      if (!raw) return false;
      dbData = JSON.parse(raw);
      if (!dbData || !Array.isArray(dbData.sheets)) return false;

      let bestIndex = -1;
      let maxRows = -1;

      dbData.sheets.forEach((s, idx) => {
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

      if (bestIndex < 0 && dbData.sheets.length > 0) {
        dbData.sheets.forEach((s, idx) => {
          const rowCount = (s.rows || []).length;
          if (rowCount > maxRows) {
            maxRows = rowCount;
            bestIndex = idx;
          }
        });
      }

      if (bestIndex >= 0) {
        dbSheetIndex = bestIndex;
        dbSheet = dbData.sheets[dbSheetIndex];
        ensureSystemColumns(dbSheet);
        return true;
      }
      return false;
    } catch (e) {
      console.error('[ZobowiazaniModule] Błąd wczytywania:', e);
      dbErrorMsg = e.toString();
      return false;
    }
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
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);">Ładowanie bazy z Arkusza...</div>`;

      const hasData = await loadDataAsync();

      if (!hasData) {
        container.innerHTML = `
          <div class="zob-wrap">
            <div class="zob-header">
              <div>
                <h2 class="mod-title">📇 Baza Zobowiązanych</h2>
                <p class="mod-sub">Nie znaleziono bazy w pamięci Arkusza.</p>
              </div>
            </div>
            <div style="background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; color:var(--danger)">
              <strong>Szczegóły:</strong> ${dbErrorMsg || 'Brak danych'}
            </div>
          </div>
        `;
        return;
      }

      const counts = computeFilterCounts();

      container.innerHTML = `
        <div class="zob-wrap">
          <!-- GÓRNY PASEK -->
          <div class="zob-header">
            <div class="zob-title-area">
              <h2 class="mod-title" style="margin:0; font-size:1.3rem;">📇 Baza Zobowiązanych</h2>
              <p class="mod-sub" style="margin:0;">Karta: <strong>${escapeHtml(dbSheet.name || 'Zobowiązani')}</strong> — Inteligentny widok operacyjny</p>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <button class="nav-btn" style="height:32px; padding:0 12px; border-radius:8px; background:#16a34a; color:#fff; border:1px solid #15803d; font-weight:700;" onclick="ZobowiazaniModule.copyCleanExcel()" title="Kopiuje widoczne wiersze jako czysty tekst do wklejenia w Excelu (Ctrl+V) bez tabel, kolorów i obramowań">
                📋 Kopiuj do Excela (czysty tekst)
              </button>
              <button class="nav-btn" style="height:32px; padding:0 12px; border-radius:8px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-weight:600;" onclick="ZobowiazaniModule.syncAllCepik()" title="Sprawdź wszystkich dłużników w bazie WRO i automatycznie oznacz UFG oraz dopisz pojazdy do Notatki">
                🚗 Auto-Sync CEPIK (WRO)
              </button>
              <button class="nav-btn" style="height:32px; padding:0 12px; border-radius:8px;" onclick="ZobowiazaniModule.toggleDetailPane()" title="Pokaż/Ukryj boczny panel szczegółów">
                <span>◨ Panel roboczy</span>
              </button>
            </div>
          </div>

          <!-- PASEK FILTRÓW I SZUKANIA -->
          <div class="zob-toolbar">
            <div class="zob-tool-top">
              <div class="zob-search-box">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="text" class="zob-search" id="zob-search-input" placeholder="Szukaj po nazwisku, PESEL, NIP, adresie, mieście, notatce..." value="${escapeHtml(filterText)}">
              </div>
              <div class="zob-stats" id="zob-stats-badge">Ładowanie...</div>
            </div>
            
            <div class="zob-pills" id="zob-pills-bar">
              <button class="zob-pill ${activeFilter === 'all' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('all')">
                Wszystkie <span class="zob-pill-count">${counts.all}</span>
              </button>
              <button class="zob-pill pill-danger ${activeFilter === 'todo' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('todo')">
                🔴 Do zrobienia (0/5) <span class="zob-pill-count">${counts.todo}</span>
              </button>
              <button class="zob-pill pill-warn ${activeFilter === 'progress' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('progress')">
                🟡 W toku (1-4/5) <span class="zob-pill-count">${counts.progress}</span>
              </button>
              <button class="zob-pill pill-ok ${activeFilter === 'complete' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('complete')">
                🟢 Komplet (5/5) <span class="zob-pill-count">${counts.complete}</span>
              </button>
              ${counts.cepik > 0 ? `
                <button class="zob-pill ${activeFilter === 'has_cepik' ? 'active' : ''}" style="border-color:#bfdbfe; color:#1d4ed8;" onclick="ZobowiazaniModule.setFilter('has_cepik')">
                  🚗 W CEPIK (WRO) <span class="zob-pill-count" style="background:#dbeafe; color:#1e40af;">${counts.cepik}</span>
                </button>
              ` : ''}
              <span style="color:var(--line); margin:0 4px;">|</span>
              <button class="zob-pill ${activeFilter === 'no_kawa' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_kawa')">Brak KAWA</button>
              <button class="zob-pill ${activeFilter === 'no_sinf' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_sinf')">Brak SINF</button>
              <button class="zob-pill ${activeFilter === 'no_ufg' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_ufg')">Brak UFG</button>
              <button class="zob-pill ${activeFilter === 'no_jpk' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_jpk')">Brak JPK</button>
              <button class="zob-pill ${activeFilter === 'no_infz' ? 'active' : ''}" onclick="ZobowiazaniModule.setFilter('no_infz')">Brak INFZ</button>
            </div>
          </div>

          <!-- KONTENER HYBRYDOWY (MASTER-DETAIL SPLIT) -->
          <div class="zob-split-container">
            <!-- LEWA STRONA: SMART TABELA -->
            <div class="zob-table-pane">
              <div class="zob-table-scroll" id="zob-table-scroll">
                <table class="zob-smart-table">
                  <thead>
                    <tr>
                      <th style="width:36px; text-align:center;">#</th>
                      <th onclick="ZobowiazaniModule.sortBy('name')" style="min-width:210px;">Osoba / Identyfikatory ↕</th>
                      <th style="min-width:200px;">Adres i Sprawa</th>
                      <th style="min-width:180px; text-align:center;">Czynności (5 systemów)</th>
                      <th onclick="ZobowiazaniModule.sortBy('stan')" style="width:90px; text-align:center;">Stan ↕</th>
                      <th style="width:110px; text-align:center;">Szybka Akcja</th>
                    </tr>
                  </thead>
                  <tbody id="zob-smart-tbody"></tbody>
                </table>
              </div>
            </div>

            <!-- PRAWA STRONA: MASTER-DETAIL INSPECTOR -->
            <div class="zob-detail-pane ${detailOpen ? '' : 'collapsed'}" id="zob-detail-pane">
              <div id="zob-detail-content" style="flex:1; display:flex; flex-direction:column; min-height:0;"></div>
            </div>
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
      container.innerHTML = `<div style="padding:20px; color:red">Błąd render: ${err.message}</div>`;
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

  /* ─── RENDEROWANIE WIDOKÓW (TABELA + PANEL) ──────────────── */
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
  }

  function renderTableOnly() {
    const tbody = document.getElementById('zob-smart-tbody');
    if (!tbody || !dbSheet) return;

    const visibleRows = getFilteredRows();

    if (!visibleRows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="zob-empty">Brak osób spełniających wybrane kryteria</td></tr>`;
      return;
    }

    if (!visibleRows.some(item => item.idx === selectedRowIndex)) {
      selectedRowIndex = visibleRows[0].idx;
    }

    let html = '';
    visibleRows.forEach((item, displayIdx) => {
      const r = item.row;
      const ri = item.idx;
      const info = extractPersonInfo(r);
      const isSelected = ri === selectedRowIndex;
      const sysCount = getPersonSysCount(r);
      const cepik = getCepikForPerson(info);

      let stanBadgeClass = 'st-puste';
      if (sysCount === REG_SYSTEMS.length) stanBadgeClass = 'st-komplet';
      else if (sysCount > 0) stanBadgeClass = 'st-czesciowo';

      html += `<tr class="zob-smart-row ${isSelected ? 'selected' : ''}" onclick="ZobowiazaniModule.select(${ri})">`;
      
      // #
      html += `<td style="color:var(--muted); text-align:center; font-size:0.75rem;">${displayIdx + 1}</td>`;

      // Osoba & Identyfikatory
      html += `<td>
        <div class="zob-person-cell">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="zob-person-name">${escapeHtml(info.name)}</span>
            ${cepik ? `<span class="zob-badge-mono" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; font-size:0.7rem;" title="CEPIK (WRO): ${escapeHtml(cepik.summaryText)}">🚗 ${cepik.vehicles.length} poj.</span>` : ''}
          </div>
          <div class="zob-person-ids">
            ${info.pesel ? `<span class="zob-badge-mono" onclick="event.stopPropagation(); ZobowiazaniModule.copy('${info.pesel}', this)" title="Kopiuj PESEL">PESEL: ${info.pesel}</span>` : ''}
            ${info.nip ? `<span class="zob-badge-mono" onclick="event.stopPropagation(); ZobowiazaniModule.copy('${info.nip}', this)" title="Kopiuj NIP">NIP: ${info.nip}</span>` : ''}
            ${info.regon ? `<span class="zob-badge-mono" onclick="event.stopPropagation(); ZobowiazaniModule.copy('${info.regon}', this)" title="Kopiuj REGON">REGON: ${info.regon}</span>` : ''}
          </div>
        </div>
      </td>`;

      // Adres i Sprawa
      html += `<td>
        <div class="zob-addr-cell">
          <div class="zob-addr-main">${escapeHtml(info.adresStr || 'Brak adresu')}</div>
          ${(info.sygnatura || info.kwota) ? `<div class="zob-addr-sub">${escapeHtml([info.sygnatura, info.kwota].filter(Boolean).join(' • '))}</div>` : ''}
          ${info.notatka ? `<div style="font-size:0.72rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:220px;" title="${escapeHtml(info.notatka)}">📝 ${escapeHtml(info.notatka)}</div>` : ''}
        </div>
      </td>`;

      // Systemy (5 w 1)
      html += `<td style="text-align:center;">
        <div class="zob-sys-group" onclick="event.stopPropagation();">`;
      REG_SYSTEMS.forEach(sys => {
        const sysIdx = dbSheet.columns.indexOf(sys);
        const sysVal = sysIdx >= 0 ? String(r[sysIdx] || '').trim() : '';
        const isDone = sysVal !== '' && sysVal.toLowerCase() !== 'pomiń';
        const isSkip = sysVal.toLowerCase() === 'pomiń';

        let pillClass = 'zob-sys-pill';
        if (isDone) pillClass += ' done';
        else if (isSkip) pillClass += ' skip';

        const txt = isDone ? '✓' : (isSkip ? 'P' : sys.charAt(0));
        const tooltip = isDone ? `${sys}: Zrobiono ${sysVal}` : `${sys}: Kliknij, aby oznaczyć dzisiaj`;

        html += `<button class="${pillClass}" onclick="ZobowiazaniModule.toggle(${ri}, '${sys}')" title="${tooltip}">${txt}</button>`;
      });
      html += `<span class="zob-sys-progress">${sysCount}/5</span>`;
      html += `</div></td>`;

      // Stan
      html += `<td style="text-align:center;">
        <span class="zob-stan-badge ${stanBadgeClass}">${info.stan || (sysCount === 5 ? 'Komplet' : (sysCount > 0 ? 'W toku' : 'Puste'))}</span>
      </td>`;

      // Szybka Akcja
      html += `<td style="text-align:center; white-space:nowrap;" onclick="event.stopPropagation();">
        <button class="zob-btn-komplet" onclick="ZobowiazaniModule.setAll(${ri})" title="Oznacz wszystkie 5 czynności dzisiejszą datą">✨ Komplet</button>
      </td>`;

      html += `</tr>`;
    });

    tbody.innerHTML = html;
  }

  function renderDetailOnly() {
    const detailContent = document.getElementById('zob-detail-content');
    if (!detailContent || !dbSheet || !dbSheet.rows) return;

    if (selectedRowIndex < 0 || selectedRowIndex >= dbSheet.rows.length) {
      detailContent.innerHTML = `<div style="padding:30px; text-align:center; color:var(--muted);">Wybierz osobę z listy po lewej</div>`;
      return;
    }

    const r = dbSheet.rows[selectedRowIndex];
    const info = extractPersonInfo(r);
    const sysCount = getPersonSysCount(r);
    const visibleRows = getFilteredRows();
    const curVisIdx = visibleRows.findIndex(item => item.idx === selectedRowIndex);
    const cepik = getCepikForPerson(info);

    let html = `
      <!-- NAGŁÓWEK INSPEKTORA -->
      <div class="zob-detail-header">
        <div>
          <div class="zob-detail-title">${escapeHtml(info.name)}</div>
          <div style="font-size:0.75rem; color:var(--muted); margin-top:2px;">Wiersz w bazie: #${selectedRowIndex + 1}</div>
        </div>
        <button class="zob-btn-komplet" onclick="ZobowiazaniModule.setAll(${selectedRowIndex})" title="Oznacz komplet">✨ Komplet</button>
      </div>

      <!-- CIAŁO INSPEKTORA -->
      <div class="zob-detail-body">
        <!-- KARTA IDENTYFIKACYJNA -->
        <div class="zob-detail-card">
          <div class="zob-detail-card-title">
            <span>Dane Identyfikacyjne</span>
            <span style="font-size:0.7rem; color:var(--accent);">Kliknij, by skopiować</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${info.pesel ? `
              <div style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); padding:6px 10px; border-radius:6px; border:1px solid var(--line);">
                <span style="font-size:0.75rem; color:var(--muted);">PESEL:</span>
                <span class="zob-badge-mono" onclick="ZobowiazaniModule.copy('${info.pesel}', this)">${info.pesel} 📋</span>
              </div>` : ''}
            ${info.nip ? `
              <div style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); padding:6px 10px; border-radius:6px; border:1px solid var(--line);">
                <span style="font-size:0.75rem; color:var(--muted);">NIP:</span>
                <span class="zob-badge-mono" onclick="ZobowiazaniModule.copy('${info.nip}', this)">${info.nip} 📋</span>
              </div>` : ''}
            ${info.regon ? `
              <div style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); padding:6px 10px; border-radius:6px; border:1px solid var(--line);">
                <span style="font-size:0.75rem; color:var(--muted);">REGON:</span>
                <span class="zob-badge-mono" onclick="ZobowiazaniModule.copy('${info.regon}', this)">${info.regon} 📋</span>
              </div>` : ''}
            ${info.adresStr ? `
              <div style="display:flex; justify-content:space-between; align-items:flex-start; background:var(--panel); padding:6px 10px; border-radius:6px; border:1px solid var(--line);">
                <span style="font-size:0.75rem; color:var(--muted); margin-top:2px;">Adres:</span>
                <span style="font-size:0.8rem; font-weight:600; text-align:right; cursor:pointer;" onclick="ZobowiazaniModule.copy('${info.adresStr}', this)" title="Kopiuj adres">${escapeHtml(info.adresStr)} 📋</span>
              </div>` : ''}
          </div>
        </div>

        <!-- SEKCJA CEPIK (WRO) SYNCHRONIZACJA -->
        ${cepik ? `
          <div class="zob-detail-card" style="border-left: 3px solid #2563eb; background: color-mix(in srgb, var(--panel2) 90%, #eff6ff);">
            <div class="zob-detail-card-title">
              <span style="color:#1d4ed8; font-weight:800;">🚗 Dane z CEPIK (WRO)</span>
              <button class="zob-btn-komplet" style="background:#2563eb; color:#fff; font-size:0.72rem; padding:4px 10px;" onclick="ZobowiazaniModule.syncCepik(${selectedRowIndex})" title="Wstaw dzisiejszą datę do UFG i dopisz pojazdy do Notatki">
                🔄 Zsynchronizuj CEPIK
              </button>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:0.8rem;">
              ${cepik.vehicles.map(v => `
                <div style="background:var(--panel); border:1px solid #bfdbfe; border-radius:6px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <div style="font-weight:700; color:var(--text);">${escapeHtml(v.brand || 'Pojazd')}</div>
                    <div style="font-size:0.72rem; color:var(--muted);">${v.vin ? `VIN: ${v.vin}` : ''} ${v.polisa ? `• Polisa: ${v.polisa}` : ''}</div>
                  </div>
                  <span class="zob-badge-mono" style="background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe;">${escapeHtml(v.plate || 'Brak tablicy')}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : `
          <div class="zob-detail-card" style="border-style:dashed; opacity:0.85;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:0.75rem; color:var(--muted);">🚗 CEPIK: brak ustaleń w WRO</span>
              <button class="nav-btn" style="height:24px; padding:0 8px; font-size:0.72rem; border-radius:4px;" onclick="Router.navigate('wro', { pesel: '${info.pesel || ''}', nip: '${info.nip || ''}' })">Otwórz w WRO</button>
            </div>
          </div>
        `}

        <!-- CENTRUM SYSTEMÓW (5 KAFELKÓW) -->
        <div class="zob-detail-card">
          <div class="zob-detail-card-title">
            <span>Czynności Systemowe</span>
            <span style="font-weight:700; color:${sysCount === 5 ? '#16a34a' : 'var(--accent)'};">${sysCount} z 5 zrobione</span>
          </div>
          
          <div class="zob-detail-systems-grid">
    `;

    REG_SYSTEMS.forEach(sys => {
      const idx = dbSheet.columns.indexOf(sys);
      const val = idx >= 0 ? String(r[idx] || '').trim() : '';
      const isDone = val !== '' && val.toLowerCase() !== 'pomiń';
      const isSkip = val.toLowerCase() === 'pomiń';

      html += `
        <div class="zob-detail-sys-item ${isDone ? 'done' : ''}" onclick="ZobowiazaniModule.toggle(${selectedRowIndex}, '${sys}')">
          <div class="zob-detail-sys-name">
            <span>${sys}</span>
            <span>${isDone ? '✓' : (isSkip ? 'Pomiń' : '+')}</span>
          </div>
          <div class="zob-detail-sys-val">${escapeHtml(val || 'Brak — kliknij')}</div>
        </div>
      `;
    });

    html += `
          </div>
        </div>

        <!-- WSZYSTKIE POZOSTAŁE POLA Z ARKUSZA -->
        <div class="zob-detail-card">
          <div class="zob-detail-card-title">
            <span>Wszystkie kolumny z Arkusza</span>
          </div>
          <div class="zob-kv-grid">
    `;

    dbSheet.columns.forEach((colName, cIdx) => {
      if (REG_SYSTEMS.includes(colName) || colName === 'Stan' || colName === 'Komplet') return;
      const rawVal = String(r[cIdx] || '').trim();
      if (!rawVal) return;

      const isLong = rawVal.length > 25;
      html += `
        <div class="zob-kv-item ${isLong ? 'full' : ''}">
          <div class="zob-kv-label">${escapeHtml(colName)}</div>
          <div class="zob-kv-val" onclick="ZobowiazaniModule.copy('${escapeHtml(rawVal)}', this)" title="Kliknij, aby skopiować">${escapeHtml(rawVal)}</div>
        </div>
      `;
    });

    html += `
          </div>
        </div>
      </div>

      <!-- DOLNA NAWIGACJA -->
      <div class="zob-detail-footer">
        <button class="zob-nav-btn" onclick="ZobowiazaniModule.prevPerson()" title="Poprzednia osoba (Strzałka w górę)">← Poprzedni</button>
        <span style="font-size:0.75rem; color:var(--muted); font-weight:600;">
          ${curVisIdx >= 0 ? `${curVisIdx + 1} / ${visibleRows.length}` : ''}
        </span>
        <button class="zob-nav-btn" onclick="ZobowiazaniModule.nextPerson()" title="Następna osoba (Strzałka w dół)">Następny →</button>
        <button class="zob-nav-btn" style="background:var(--soft); color:var(--accent);" onclick="ZobowiazaniModule.nextTodo()" title="Przeskocz do następnej niekompletnej osoby">⏩ Do zrobienia</button>
      </div>
    `;

    detailContent.innerHTML = html;
  }

  /* ─── NAWIGACJA I AKCJE ────────────────────────────────── */
  function selectRow(ri) {
    selectedRowIndex = ri;
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
    prevPerson,
    nextPerson,
    nextTodo,
    toggleDetailPane,
    syncCepik: syncCepikForPerson,
    syncAllCepik: syncAllCepikFromWro,
    copyCleanExcel: copyCleanExcelText,
    copy: copyToClipboard
  };

})();
