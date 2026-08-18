/* ============================================================
   Egzebiurko 3.0 — automaty.js
   Panel sit JPK + OGNIVO: zrzutnia w przeglądarce
   (drop plików / folderu zamiast A:\Automaty\1_Zrzutnia).
   ============================================================ */

'use strict';

const AutomatyModule = (() => {

  const ROLE_LABEL = {
    ognivo: 'OGNIVO (CSV)',
    see11: 'SEE.11',
    see18: 'SEE.18',
    platforma: 'Platforma'
  };

  let filesByRole = { ognivo: null, see11: null, see18: null, platforma: null };
  let tables = { ognivo: null, see11: null, see18: null, platforma: null };
  let lastOgnivo = null;
  let lastJpk = null;
  let activated = false;
  let busy = false;

  function render() {
    const el = document.getElementById('automaty-app');
    if (!el) return;
    el.innerHTML = `
      <div class="aut-wrap">
        <div class="aut-header">
          <div>
            <h2 class="mod-title">Automaty JPK + OGNIVO</h2>
            <p class="mod-sub">To samo sito co w makrach Excel: SEE.11 + SEE.18, potem OGNIVO CSV albo Platforma. Pliki wskazujesz tutaj — aplikacja nie czyta dysku A:\\.</p>
          </div>
        </div>

        <div class="aut-flow" aria-hidden="true">
          <span>OGNIVO / Platforma</span>
          <span class="aut-flow-arr">→</span>
          <span>porównanie z SEE.18</span>
          <span class="aut-flow-arr">→</span>
          <span>sito SEE.11</span>
          <span class="aut-flow-arr">→</span>
          <span>do zajęcia</span>
        </div>

        <div class="ognivo-dropzone" id="aut-drop">
          <div class="dz-icon">📂</div>
          <div class="dz-text">Przeciągnij pliki z Zrzutni albo cały folder</div>
          <div class="dz-sub">Nazwy jak w makrze: <strong>OGNIVO</strong> (CSV), <strong>SEE.11</strong>, <strong>SEE.18</strong>, <strong>PLATFORMA</strong>. CSV jest rozbijane z rozpoznaniem separatora (; , TAB) — nie przez zwykłe otwarcie skoroszytu.</div>
          <div class="dz-btns">
            <button type="button" class="btn-dz" id="aut-pick-files">Wybierz pliki</button>
            <button type="button" class="btn-dz" id="aut-pick-folder">Wybierz folder</button>
          </div>
          <input type="file" id="aut-file-input" multiple accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xls" hidden>
          <input type="file" id="aut-folder-input" webkitdirectory directory multiple hidden>
        </div>

        <div class="aut-roles" id="aut-roles"></div>

        <div class="aut-actions">
          <button type="button" class="btn-act btn-start" id="aut-run-ognivo">▶ Analiza OGNIVO</button>
          <button type="button" class="btn-act btn-start" id="aut-run-jpk">▶ Analiza JPK</button>
          <button type="button" class="btn-act btn-clear" id="aut-clear">✕ Wyczyść</button>
        </div>

        <pre class="aut-diag" id="aut-diag" hidden></pre>
        <div id="aut-results" hidden></div>
      </div>
    `;
    bind();
    paintRoles();
  }

  function bind() {
    const drop = document.getElementById('aut-drop');
    const fileIn = document.getElementById('aut-file-input');
    const folderIn = document.getElementById('aut-folder-input');
    document.getElementById('aut-pick-files').onclick = () => fileIn.click();
    document.getElementById('aut-pick-folder').onclick = () => folderIn.click();
    fileIn.onchange = e => { addFiles(e.target.files); e.target.value = ''; };
    folderIn.onchange = e => { addFiles(e.target.files); e.target.value = ''; };

    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      const files = [];
      if (e.dataTransfer.items) {
        for (const item of e.dataTransfer.items) {
          const f = item.getAsFile && item.getAsFile();
          if (f) files.push(f);
        }
      } else if (e.dataTransfer.files) {
        for (const f of e.dataTransfer.files) files.push(f);
      }
      addFiles(files);
    });

    document.getElementById('aut-run-ognivo').onclick = () => runOgnivo();
    document.getElementById('aut-run-jpk').onclick = () => runJpk();
    document.getElementById('aut-clear').onclick = () => clearAll();
  }

  function addFiles(fileList) {
    const C = window.AutomatyCore;
    if (!C) {
      showToast('Brak silnika AutomatyCore', 'error');
      return;
    }
    let n = 0;
    for (const file of fileList) {
      const role = C.classifyDumpName(file.name);
      if (!role) continue;
      filesByRole[role] = file;
      tables[role] = null;
      n++;
    }
    if (!n) {
      showToast('Nie rozpoznano plików (szukam OGNIVO / SEE.11 / SEE.18 / PLATFORMA w nazwie)', 'warn');
    } else {
      showToast('Rozpoznano ' + n + ' plik(ów)', 'success');
    }
    paintRoles();
  }

  function paintRoles() {
    const box = document.getElementById('aut-roles');
    if (!box) return;
    box.innerHTML = ['ognivo', 'see11', 'see18', 'platforma'].map(role => {
      const f = filesByRole[role];
      const ok = !!f;
      return `<div class="aut-role ${ok ? 'is-ok' : 'is-miss'}">
        <div class="aut-role-k">${ROLE_LABEL[role]}</div>
        <div class="aut-role-v">${ok ? esc(f.name) : 'brak'}</div>
      </div>`;
    }).join('');
  }

  function clearAll() {
    filesByRole = { ognivo: null, see11: null, see18: null, platforma: null };
    tables = { ognivo: null, see11: null, see18: null, platforma: null };
    lastOgnivo = null;
    lastJpk = null;
    paintRoles();
    const diag = document.getElementById('aut-diag');
    const res = document.getElementById('aut-results');
    if (diag) { diag.hidden = true; diag.textContent = ''; }
    if (res) { res.hidden = true; res.innerHTML = ''; }
  }

  async function ensureTable(role) {
    if (tables[role]) return tables[role];
    const file = filesByRole[role];
    if (!file) return null;
    const C = window.AutomatyCore;
    const name = (file.name || '').toLowerCase();
    if (/\.xls$/.test(name) && !/\.xlsx$/.test(name) && !/\.xlsm$/.test(name)) {
      throw new Error('Stary format .xls nie jest obsługiwany. Zapisz ' + ROLE_LABEL[role] + ' jako .xlsx albo CSV.');
    }
    if (/\.xlsx$|\.xlsm$/.test(name)) {
      const buf = await file.arrayBuffer();
      const parsed = await C.readXlsxFirstSheet(buf);
      tables[role] = parsed;
      return parsed;
    }
    const buf = await file.arrayBuffer();
    const text = C.decodeTextBuffer(buf);
    const parsed = C.wczytajCsvTekst(text);
    tables[role] = { rows: parsed.rows, separator: parsed.separator, kind: 'csv' };
    return tables[role];
  }

  function showDiag(text) {
    const diag = document.getElementById('aut-diag');
    if (!diag) return;
    diag.hidden = !text;
    diag.textContent = text || '';
  }

  function showResultTable(title, rows, extraBtns) {
    const box = document.getElementById('aut-results');
    if (!box) return;
    if (!rows || !rows.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const head = rows[0] || [];
    const body = rows.slice(1);
    const preview = body.slice(0, 80);
    box.hidden = false;
    box.innerHTML = `
      <div class="results-header">
        <span>${esc(title)} — ${body.length} rekordów${body.length > 80 ? ' (podgląd 80)' : ''}</span>
        <span class="results-hint">CSV do Excela (średnik)</span>
      </div>
      <div class="aut-result-btns">${extraBtns || ''}</div>
      <div class="ognivo-table-wrap">
        <table class="ognivo-table">
          <thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${preview.map(r => `<tr>${head.map((_, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    `;
    box.querySelectorAll('[data-aut-act]').forEach(btn => {
      btn.addEventListener('click', () => handleAct(btn.getAttribute('data-aut-act')));
    });
  }

  function downloadCsv(filename, rows) {
    const csv = window.AutomatyCore.tableToCsv(rows, ';');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  async function runOgnivo() {
    if (busy) return;
    const C = window.AutomatyCore;
    if (!filesByRole.ognivo || !filesByRole.see11 || !filesByRole.see18) {
      showToast('Do OGNIVO potrzebne są: OGNIVO CSV + SEE.11 + SEE.18', 'error');
      return;
    }
    busy = true;
    try {
      const [og, s11, s18] = await Promise.all([
        ensureTable('ognivo'),
        ensureTable('see11'),
        ensureTable('see18')
      ]);
      const result = C.analizaOgnivo({
        ognivo: og.rows,
        see11: s11.rows,
        see18: s18.rows,
        separator: og.separator || ';'
      });
      lastOgnivo = result;
      lastJpk = null;
      const diag = result.diagnostics ? C.formatOgnivoDiagnostics(result.diagnostics) : '';
      if (!result.ok) {
        showDiag((diag ? diag + '\n\n' : '') + (result.error || 'Błąd'));
        showResultTable('', null);
        showToast(result.error || 'OGNIVO: brak wyniku', 'warn');
        return;
      }
      showDiag(diag);
      showResultTable('DO ZAJĘCIA (OGNIVO)', result.rows, `
        <button type="button" class="btn-act btn-export" data-aut-act="dl-ognivo">⬇ Pobierz CSV</button>
        <button type="button" class="btn-act btn-secondary" data-aut-act="store-ognivo">💾 Zapisz do pamięci OGNIVO</button>
        <button type="button" class="btn-act btn-secondary" data-aut-act="wro-ognivo">📊 Dodaj do WRO jako Wynik: OGNIVO</button>
      `);
      showToast('OGNIVO: ' + result.diagnostics.dopasowaniaKon + ' rekordów do zajęcia', 'success');
    } catch (e) {
      showDiag('Błąd podczas analizy OGNIVO:\n\n' + (e && e.message ? e.message : e));
      showToast('Błąd OGNIVO', 'error');
    } finally {
      busy = false;
    }
  }

  async function runJpk() {
    if (busy) return;
    const C = window.AutomatyCore;
    if (!filesByRole.platforma || !filesByRole.see11 || !filesByRole.see18) {
      showToast('Do JPK potrzebne są: Platforma + SEE.11 + SEE.18', 'error');
      return;
    }
    busy = true;
    try {
      const [pa, s11, s18] = await Promise.all([
        ensureTable('platforma'),
        ensureTable('see11'),
        ensureTable('see18')
      ]);
      const result = C.analizaJpk({
        platforma: pa.rows,
        see11: s11.rows,
        see18: s18.rows
      });
      lastJpk = result;
      lastOgnivo = null;
      const diag = result.diagnostics ? C.formatJpkDiagnostics(result.diagnostics) : '';
      if (!result.ok) {
        showDiag((diag ? diag + '\n\n' : '') + (result.error || 'Błąd'));
        showResultTable('', null);
        showToast(result.error || 'JPK: brak wyniku', 'warn');
        return;
      }
      showDiag(diag);
      showResultTable('JPK1 wynik', result.rows, `
        <button type="button" class="btn-act btn-export" data-aut-act="dl-jpk">⬇ Pobierz CSV</button>
        <button type="button" class="btn-act btn-secondary" data-aut-act="wro-jpk">📊 Dodaj do WRO jako Wynik: JPK</button>
      `);
      showToast('JPK: ' + result.diagnostics.outRows + ' rekordów', 'success');
    } catch (e) {
      showDiag('Błąd JPK:\n\n' + (e && e.message ? e.message : e));
      showToast('Błąd JPK', 'error');
    } finally {
      busy = false;
    }
  }

  function handleAct(act) {
    const C = window.AutomatyCore;
    if (act === 'dl-ognivo' && lastOgnivo && lastOgnivo.rows) {
      downloadCsv(lastOgnivo.fileName || 'DO_ZAJECIA.csv', lastOgnivo.rows);
      return;
    }
    if (act === 'dl-jpk' && lastJpk && lastJpk.rows) {
      downloadCsv(lastJpk.fileName || 'JPK1_Wynik.csv', lastJpk.rows);
      return;
    }
    if (act === 'store-ognivo' && lastOgnivo && lastOgnivo.ok) {
      const pack = C.ognivoRowsToStore(lastOgnivo.rows, lastOgnivo.startRow);
      const existing = SharedStore.get(SharedStore.KEYS.OGNIVO, {}) || {};
      Object.keys(pack).forEach(pesel => {
        const prev = existing[pesel] || { banks: [] };
        const banks = Array.from(new Set([].concat(prev.banks || [], pack[pesel].banks || [])));
        existing[pesel] = {
          count: banks.length,
          banks,
          ts: pack[pesel].ts,
          name: pack[pesel].name || prev.name
        };
      });
      SharedStore.set(SharedStore.KEYS.OGNIVO, existing);
      showToast('Zapisano ' + Object.keys(pack).length + ' wyników OGNIVO do pamięci', 'success');
      return;
    }
    if (act === 'wro-ognivo' && lastOgnivo && lastOgnivo.ok) {
      const byId = C.ognivoRowsToWro(lastOgnivo.rows, lastOgnivo.startRow);
      pushToWro('Wynik: OGNIVO', byId);
      return;
    }
    if (act === 'wro-jpk' && lastJpk && lastJpk.ok) {
      const byId = C.jpkRowsToWro(lastJpk.rows);
      pushToWro('Wynik: JPK', byId);
    }
  }

  function pushToWro(sectionKey, byId) {
    if (typeof WroModule === 'undefined' || typeof WroModule.mergeWynikSection !== 'function') {
      showToast('Moduł WRO nie jest gotowy', 'error');
      return;
    }
    const stats = WroModule.mergeWynikSection(sectionKey, byId);
    showToast(sectionKey + ': dopisano ' + stats.merged + ' (nowe teczki: ' + stats.created + ')', 'success');
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function activate() {
    if (!activated) {
      render();
      activated = true;
    } else {
      paintRoles();
    }
  }

  return { activate, render };
})();

window.AutomatyModule = AutomatyModule;
