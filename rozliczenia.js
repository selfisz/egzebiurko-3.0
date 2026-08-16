/* ============================================================
   Egzebiurko 3.0 — rozliczenia.js
   Zakładka 2: Narzędzia rozliczeniowe (EXCEL vs EGA + Analizator ZDP)
   Logika przeniesiona 1:1 — tylko wpleciona w shell aplikacji.
   ============================================================ */

'use strict';

const RozliczeniaModule = (() => {
  let activated = false;
  let wired = false;

  const CSS = `
#rozliczenia-app {
  --rzl-bg: #f3f4f6;
  --rzl-card: #ffffff;
  --rzl-text: #1f2937;
  --rzl-label: #4b5563;
  --rzl-border: #d1d5db;
  --rzl-focus: #3b82f6;
  --rzl-ok: #10b981;
  --rzl-err: #ef4444;
  --rzl-muted: #9ca3af;
  flex: 1; min-height: 0; overflow: auto;
  background: var(--rzl-bg);
  color: var(--rzl-text);
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  padding: 24px 20px;
  box-sizing: border-box;
}
#rozliczenia-app .rzl-container {
  background: var(--rzl-card);
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,.08);
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  box-sizing: border-box;
}
#rozliczenia-app .tabs-header {
  display: flex; border-bottom: 2px solid #e5e7eb; margin-bottom: 25px; gap: 10px; flex-wrap: wrap;
}
#rozliczenia-app .tab-btn {
  background: none; border: none; padding: 12px 24px; font-size: 16px; font-weight: bold;
  color: var(--rzl-label); cursor: pointer; border-bottom: 3px solid transparent;
  margin-bottom: -2px; transition: all .2s ease; font-family: inherit;
}
#rozliczenia-app .tab-btn:hover { color: var(--rzl-focus); }
#rozliczenia-app .tab-btn.active { color: var(--rzl-focus); border-bottom: 3px solid var(--rzl-focus); }
#rozliczenia-app .tab-content { display: none; animation: rzlFadeIn .3s ease; }
#rozliczenia-app .tab-content.active { display: block; }
@keyframes rzlFadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
#rozliczenia-app h2 {
  margin-top: 0; font-size: 22px; text-align: center; border-bottom: 2px solid #e5e7eb;
  padding-bottom: 15px; margin-bottom: 20px; color: var(--rzl-text);
}
#rozliczenia-app .columns-wrapper {
  display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-bottom: 20px;
}
#rozliczenia-app .source-section {
  padding: 20px; border-radius: 8px; border: 1px solid var(--rzl-border);
}
#rozliczenia-app .section-arkusz { background: #f8fafc; border-top: 4px solid #3b82f6; }
#rozliczenia-app .section-system { background: #fdfbf7; border-top: 4px solid #eab308; }
#rozliczenia-app .section-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;
}
#rozliczenia-app .section-title {
  font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
}
#rozliczenia-app .clear-btn {
  background: none; border: none; font-size: 18px; cursor: pointer; padding: 4px;
  border-radius: 4px; transition: background-color .2s;
  display: flex; align-items: center; justify-content: center;
}
#rozliczenia-app .clear-btn:hover { background: #e5e7eb; }
#rozliczenia-app .form-group { display: flex; flex-direction: column; margin-bottom: 12px; }
#rozliczenia-app .form-group-split { display: flex; gap: 10px; }
#rozliczenia-app .form-group-split .form-group { flex: 1; }
#rozliczenia-app label {
  font-weight: 600; margin-bottom: 4px; font-size: 13px; color: var(--rzl-label);
}
#rozliczenia-app input[type="text"] {
  padding: 8px 12px; border: 1px solid var(--rzl-border); border-radius: 6px;
  font-size: 15px; transition: all .2s ease; background: #fff; width: 100%; box-sizing: border-box;
  font-family: inherit; color: var(--rzl-text);
}
#rozliczenia-app input[type="text"]:focus:not([readonly]) {
  outline: none; border-color: var(--rzl-focus); box-shadow: 0 0 0 3px rgba(59,130,246,.15);
}
#rozliczenia-app .readonly-input {
  background: #fef9c3; font-weight: bold; color: #854d0e; border-color: #fde047; cursor: not-allowed;
}
#rozliczenia-app .readonly-arkusz {
  background: #e0f2fe; font-weight: bold; color: #0369a1; border-color: #7dd3fc; cursor: not-allowed;
}
#rozliczenia-app .results { display: flex; flex-direction: column; gap: 10px; }
#rozliczenia-app .result-item {
  padding: 12px 15px; border-radius: 8px; font-size: 14px;
  display: flex; justify-content: space-between; align-items: center;
  background: #f9fafb; border: 1px solid #e5e7eb; gap: 12px; flex-wrap: wrap;
}
#rozliczenia-app .result-label { font-weight: 600; }
#rozliczenia-app .result-equation { font-size: 12px; color: #6b7280; margin-top: 3px; display: block; }
#rozliczenia-app .status-badge {
  padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;
  color: #fff; text-align: center; min-width: 120px;
}
#rozliczenia-app .bg-red { background: var(--rzl-err); }
#rozliczenia-app .bg-green { background: var(--rzl-ok); }
#rozliczenia-app .bg-gray { background: var(--rzl-muted); }
#rozliczenia-app .top-bar {
  display: flex; justify-content: center; margin-bottom: 15px;
  background: #eff6ff; padding: 15px; border-radius: 8px; border: 1px dashed #bfdbfe;
}
#rozliczenia-app .toggle-paste-btn {
  width: 100%; padding: 10px; background: #f3f4f6; border: 1px solid #d1d5db;
  border-radius: 6px; font-weight: bold; color: #4b5563; cursor: pointer;
  text-align: center; margin-bottom: 15px; transition: background-color .2s; font-family: inherit;
}
#rozliczenia-app .toggle-paste-btn:hover { background: #e5e7eb; }
#rozliczenia-app textarea {
  width: 100%; height: 200px; padding: 12px; border: 1px solid var(--rzl-border);
  border-radius: 6px; font-family: monospace; font-size: 13px; resize: vertical;
  box-sizing: border-box; background: #f9fafb; color: var(--rzl-text);
}
#rozliczenia-app textarea:focus {
  outline: none; border-color: var(--rzl-focus);
  box-shadow: 0 0 0 3px rgba(59,130,246,.15); background: #fff;
}
#rozliczenia-app .help-text { font-size: 11px; color: #6b7280; margin-top: 4px; display: block; }
#rozliczenia-app .summary-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;
  border-top: 2px solid #e5e7eb; padding-top: 20px;
}
#rozliczenia-app .summary-card {
  padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; background: #f9fafb;
  display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
}
#rozliczenia-app .details-table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
#rozliczenia-app .details-table th,
#rozliczenia-app .details-table td {
  padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; vertical-align: top;
}
#rozliczenia-app .details-table th {
  background: #f3f4f6; font-weight: 600; color: var(--rzl-label); position: sticky; top: 0;
}
#rozliczenia-app .row-error { background: #fef2f2; }
#rozliczenia-app .text-red { color: #dc2626; font-weight: bold; }
#rozliczenia-app .text-green { color: #16a34a; font-weight: bold; }
#rozliczenia-app .text-blue-zdp { color: #2563eb; font-weight: 700; }
#rozliczenia-app .added-note {
  display: block; font-size: 11px; color: #6b7280; margin-top: 4px; font-weight: normal;
}
#rozliczenia-app .row-excluded {
  background: #f9fafb; opacity: .5; text-decoration: line-through; color: #9ca3af;
}
#rozliczenia-app .action-btn {
  background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px;
  border-radius: 4px; transition: background .2s;
}
#rozliczenia-app .action-btn:hover { background: #e5e7eb; }
#rozliczenia-app .btn-restore {
  font-size: 12px; background: #e5e7eb; padding: 4px 8px; border-radius: 4px;
  text-decoration: none; display: inline-block; font-weight: bold; color: #374151; border: none; cursor: pointer;
}
#rozliczenia-app .btn-add { background: #dcfce7; }
#rozliczenia-app .btn-add:hover { background: #bbf7d0; }
#rozliczenia-app .filter-group { display: flex; gap: 10px; margin-bottom: 15px; align-items: center; flex-wrap: wrap; }
#rozliczenia-app .filter-label { font-size: 13px; font-weight: 600; color: var(--rzl-label); margin-right: 5px; }
#rozliczenia-app .filter-btn {
  padding: 6px 14px; border: 1px solid var(--rzl-border); border-radius: 20px;
  background: #fff; cursor: pointer; font-size: 12px; font-weight: bold;
  color: var(--rzl-label); transition: all .2s; font-family: inherit;
}
#rozliczenia-app .filter-btn:hover { background: #f3f4f6; }
#rozliczenia-app .filter-btn.active {
  background: var(--rzl-focus); color: #fff; border-color: var(--rzl-focus);
}
@media (max-width: 800px) {
  #rozliczenia-app .columns-wrapper,
  #rozliczenia-app .summary-grid { grid-template-columns: 1fr; }
}
`;

  const HTML = `
<div class="rzl-container">
  <div class="tabs-header">
    <button type="button" class="tab-btn active" data-rzl-tab="tab-weryfikator">Weryfikator Krzyżowy</button>
    <button type="button" class="tab-btn" data-rzl-tab="tab-zdp">Analizator ZDP</button>
  </div>

  <div id="tab-weryfikator" class="tab-content active">
    <h2>Weryfikator Przelewów (EXCEL vs EGA)</h2>
    <div class="columns-wrapper">
      <div class="source-section section-arkusz">
        <div class="section-header">
          <div class="section-title">EXCEL</div>
          <button type="button" class="clear-btn" data-rzl-act="clearExcel" title="Wyczyść kolumnę Excel">🧹</button>
        </div>
        <div class="form-group">
          <label for="ark_kwota">Kwota całości</label>
          <input type="text" id="ark_kwota" placeholder="0,00" autocomplete="off">
        </div>
        <div class="form-group" style="margin-bottom:20px">
          <label for="ark_autosuma">Suma kontrolna składowych</label>
          <input type="text" id="ark_autosuma" class="readonly-arkusz" placeholder="0,00" readonly tabindex="-1" title="Samo sumuje Prowizje, Bezprowizje i Zwrot">
        </div>
        <div class="form-group-split">
          <div class="form-group">
            <label for="ark_prow">Prowizyjnie</label>
            <input type="text" id="ark_prow" placeholder="0,00" autocomplete="off">
          </div>
          <div class="form-group">
            <label for="ark_bezprow">Bezprowizyjne</label>
            <input type="text" id="ark_bezprow" placeholder="0,00" autocomplete="off">
          </div>
        </div>
        <div class="form-group">
          <label for="ark_zwrot">Zwrot</label>
          <input type="text" id="ark_zwrot" placeholder="0,00" autocomplete="off">
        </div>
      </div>

      <div class="source-section section-system">
        <div class="section-header">
          <div class="section-title">EGA</div>
          <button type="button" class="clear-btn" data-rzl-act="clearEga" title="Wyczyść kolumnę EGA">🧹</button>
        </div>
        <div class="form-group" style="margin-bottom:20px">
          <label for="sys_kwota">Kwota całości (Auto-suma)</label>
          <input type="text" id="sys_kwota" class="readonly-input" placeholder="0,00" readonly tabindex="-1">
        </div>
        <div class="form-group-split">
          <div class="form-group">
            <label for="sys_wierzyciel">Wierzyciel</label>
            <input type="text" id="sys_wierzyciel" placeholder="0,00" autocomplete="off">
          </div>
          <div class="form-group">
            <label for="sys_reczny">Ręczny/Inny</label>
            <input type="text" id="sys_reczny" placeholder="0,00" autocomplete="off">
          </div>
        </div>
        <div class="form-group">
          <label for="sys_koszty">Koszty</label>
          <input type="text" id="sys_koszty" placeholder="0,00" autocomplete="off">
        </div>
        <label style="margin-top:5px;display:block">Szczegóły zwrotów</label>
        <div class="form-group-split">
          <div class="form-group">
            <label for="sys_kawa" style="font-weight:normal;font-size:12px">Kawa</label>
            <input type="text" id="sys_kawa" placeholder="0,00" autocomplete="off">
          </div>
          <div class="form-group">
            <label for="sys_ega" style="font-weight:normal;font-size:12px">EGA</label>
            <input type="text" id="sys_ega" placeholder="0,00" autocomplete="off">
          </div>
        </div>
      </div>
    </div>

    <div class="results">
      <div class="result-item" style="background:#f0fdf4;border-color:#bbf7d0">
        <div>
          <span class="result-label">1. Weryfikacja Excela</span>
          <span class="result-equation">Kwota Excela = Prowizyjnie + Bezprowizyjnie + Zwrot</span>
        </div>
        <span id="status1" class="status-badge bg-gray">OCZEKIWANIE</span>
      </div>
      <div class="result-item">
        <div>
          <span class="result-label">2. Zgodność Zwrotów</span>
          <span class="result-equation">Excel Zwrot = EGA (Kawa + EGA)</span>
        </div>
        <span id="status2" class="status-badge bg-gray">OCZEKIWANIE</span>
      </div>
      <div class="result-item">
        <div>
          <span class="result-label">3. Zgodność Podstawy</span>
          <span class="result-equation">Excel (Prow. + Bezprow.) = EGA (Wierzyciel + Koszty)</span>
        </div>
        <span id="status3" class="status-badge bg-gray">OCZEKIWANIE</span>
      </div>
      <div class="result-item" style="background:#eef2ff;border-color:#c7d2fe">
        <div>
          <span class="result-label">4. Zgodność Całościowa (Krzyżowa)</span>
          <span class="result-equation">Excel Kwota = EGA Kwota (Auto-suma)</span>
        </div>
        <span id="status4" class="status-badge bg-gray">OCZEKIWANIE</span>
      </div>
    </div>
  </div>

  <div id="tab-zdp" class="tab-content">
    <h2>Analizator ZDP i Kwot</h2>
    <div class="top-bar">
      <div class="form-group" style="width:350px;max-width:100%">
        <label for="kwota_docelowa" style="text-align:center">Kwota całości EXCEL (cel)</label>
        <input type="text" id="kwota_docelowa" class="readonly-input" placeholder="0,00" readonly tabindex="-1" title="To pole samo pobiera kwotę z pierwszej zakładki">
        <span style="font-size:11px;color:#6b7280;text-align:center;margin-top:4px">Pobrano automatycznie z Weryfikatora</span>
      </div>
    </div>

    <button type="button" class="toggle-paste-btn" data-rzl-act="togglePasteArea">👁️ Ukryj / Pokaż okna wklejania danych</button>

    <div class="columns-wrapper" id="zdp-paste-section">
      <div class="form-group" style="width:100%">
        <div style="display:flex;justify-content:space-between">
          <label for="dane_plik">Krok 1: Wklej z pliku źródłowego (2 kolumny)</label>
          <button type="button" class="clear-btn" style="font-size:14px;padding:2px" data-rzl-act="clearSourceData" title="Wyczyść plik źródłowy">🧹</button>
        </div>
        <textarea id="dane_plik" placeholder="Wklej ZDP i Kwotę:&#10;89/2026/237    545,92"></textarea>
        <span class="help-text">Zaznacz w Excelu numery ZDP i Kwoty obok siebie, zrób CTRL+C i wklej.</span>
      </div>
      <div class="form-group" style="width:100%">
        <div style="display:flex;justify-content:space-between">
          <label for="dane_excel">Krok 2: Wklej ze swojego Excela</label>
          <button type="button" class="clear-btn" style="font-size:14px;padding:2px" data-rzl-act="clearYourData" title="Wyczyść swój Excel">🧹</button>
        </div>
        <textarea id="dane_excel" placeholder="Możesz wkleić ZDP, Datę i Kwotę:&#10;89/2026/237    15.05.2024    200,00"></textarea>
        <span class="help-text">Program sam pominie datę i zsumuje pozycje z tym samym ZDP.</span>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <span class="summary-label">Suma w Pliku Źródłowym vs Cel</span>
        <span id="status_plik_cel" class="status-badge bg-gray">OCZEKIWANIE</span>
      </div>
      <div class="summary-card">
        <span class="summary-label">Suma w Twoim Excelu vs Cel</span>
        <span id="status_excel_cel" class="status-badge bg-gray">OCZEKIWANIE</span>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;border-bottom:1px solid #e5e7eb;padding-bottom:10px;gap:12px;flex-wrap:wrap">
      <h3 style="font-size:16px;margin:0">Raport Różnic w Przelewach (ZDP)</h3>
      <div class="filter-group" style="margin:0">
        <span class="filter-label">Widok:</span>
        <button type="button" class="filter-btn active" data-rzl-filter="ALL">Wszystko</button>
        <button type="button" class="filter-btn" data-rzl-filter="ERRORS">Tylko błędy / braki</button>
        <button type="button" class="filter-btn" data-rzl-filter="EXCLUDED">Tylko wykluczone</button>
      </div>
    </div>

    <div style="max-height:400px;overflow-y:auto">
      <table class="details-table">
        <thead>
          <tr>
            <th>Numer ZDP</th>
            <th>Plik Źródłowy</th>
            <th>Twój Excel</th>
            <th>Status</th>
            <th style="width:90px;text-align:center">Akcja</th>
          </tr>
        </thead>
        <tbody id="tabela_wynikow">
          <tr><td colspan="5" style="text-align:center;color:#6b7280">Brak danych do porównania</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
`;

  /* ─── LOGIKA ORYGINALNA (bez zmian matematycznych) ─── */
  function parseToGrosze(val) {
    if (!val) return 0;
    let parsed = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
    if (isNaN(parsed)) return 0;
    return Math.round(parsed * 100);
  }

  function formatDiff(grosze) {
    let val = (Math.abs(grosze) / 100).toFixed(2).replace('.', ',');
    let parts = val.split(',');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    let sign = grosze < 0 ? '-' : '';
    return sign + parts.join(',');
  }

  function updateBadge(el, calcVal, targetVal, isEmpty) {
    if (!el) return;
    if (isEmpty) {
      el.textContent = 'OCZEKIWANIE';
      el.className = 'status-badge bg-gray';
      return;
    }
    if (calcVal === targetVal) {
      el.textContent = 'ZGODNE';
      el.className = 'status-badge bg-green';
    } else {
      el.textContent = `BŁĄD (${formatDiff(calcVal - targetVal)})`;
      el.className = 'status-badge bg-red';
    }
  }

  function openTab(tabId) {
    const root = document.getElementById('rozliczenia-app');
    if (!root) return;
    root.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const pane = root.querySelector('#' + tabId);
    if (pane) pane.classList.add('active');
    root.querySelectorAll('.tab-btn').forEach(b => {
      if (b.getAttribute('data-rzl-tab') === tabId) b.classList.add('active');
    });
  }

  function formatInputOnBlur(e) {
    if (e.target.value.trim() !== '') {
      const grosze = parseToGrosze(e.target.value);
      e.target.value = formatDiff(grosze);
    }
  }

  function clearExcel() {
    document.getElementById('ark_kwota').value = '';
    document.getElementById('ark_prow').value = '';
    document.getElementById('ark_bezprow').value = '';
    document.getElementById('ark_zwrot').value = '';
    validateWeryfikator();
    document.getElementById('kwota_docelowa').value = '';
    validateZDP();
  }

  function clearEga() {
    document.getElementById('sys_wierzyciel').value = '';
    document.getElementById('sys_reczny').value = '';
    document.getElementById('sys_koszty').value = '';
    document.getElementById('sys_kawa').value = '';
    document.getElementById('sys_ega').value = '';
    validateWeryfikator();
  }

  function validateWeryfikator() {
    const arkKwota = parseToGrosze(document.getElementById('ark_kwota').value);
    const arkProw = parseToGrosze(document.getElementById('ark_prow').value);
    const arkBezprow = parseToGrosze(document.getElementById('ark_bezprow').value);
    const arkZwrot = parseToGrosze(document.getElementById('ark_zwrot').value);

    const arkSumaProwizji = arkProw + arkBezprow;
    const arkSumaWszystkiego = arkSumaProwizji + arkZwrot;
    document.getElementById('ark_autosuma').value = arkSumaWszystkiego === 0 ? '' : formatDiff(arkSumaWszystkiego);

    const sysWierzyciel = parseToGrosze(document.getElementById('sys_wierzyciel').value);
    const sysReczny = parseToGrosze(document.getElementById('sys_reczny').value);
    const sysKoszty = parseToGrosze(document.getElementById('sys_koszty').value);
    const sysKawa = parseToGrosze(document.getElementById('sys_kawa').value);
    const sysEga = parseToGrosze(document.getElementById('sys_ega').value);

    const sysSumaZwrotow = sysKawa + sysEga;
    const sysSumaPodstawy = sysWierzyciel + sysReczny + sysKoszty;
    const sysKwotaCalosci = sysSumaPodstawy + sysSumaZwrotow;

    document.getElementById('sys_kwota').value = sysKwotaCalosci === 0 ? '' : formatDiff(sysKwotaCalosci);

    const empty1 = (arkKwota === 0 && arkSumaWszystkiego === 0);
    updateBadge(document.getElementById('status1'), arkSumaWszystkiego, arkKwota, empty1);

    const empty2 = (arkZwrot === 0 && sysSumaZwrotow === 0);
    updateBadge(document.getElementById('status2'), sysSumaZwrotow, arkZwrot, empty2);

    const empty3 = (arkSumaProwizji === 0 && sysSumaPodstawy === 0);
    updateBadge(document.getElementById('status3'), sysSumaPodstawy, arkSumaProwizji, empty3);

    const empty4 = (arkKwota === 0 && sysKwotaCalosci === 0);
    updateBadge(document.getElementById('status4'), sysKwotaCalosci, arkKwota, empty4);
  }

  let excludedZDPs = new Set();
  let manuallyAddedZDPs = new Set();
  let currentFilter = 'ALL';

  function togglePasteArea() {
    const section = document.getElementById('zdp-paste-section');
    if (section.style.display === 'none') {
      section.style.display = 'grid';
    } else {
      section.style.display = 'none';
    }
  }

  function setFilter(filterType, btnElement) {
    currentFilter = filterType;
    const root = document.getElementById('rozliczenia-app');
    if (root) root.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    validateZDP();
  }

  function clearSourceData() {
    document.getElementById('dane_plik').value = '';
    manuallyAddedZDPs.clear();
    validateZDP();
  }

  function clearYourData() {
    document.getElementById('dane_excel').value = '';
    validateZDP();
  }

  function parsePastedData(text, isUserExcel) {
    const lines = String(text || '').trim().split('\n');
    const dataMap = new Map();
    lines.forEach(line => {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const zdp = parts[0].trim();
        let kwotaStr = parts[1];
        if (isUserExcel && parts.length >= 3) {
          kwotaStr = parts[2];
        }
        if (zdp !== '') {
          const kwota = parseToGrosze(kwotaStr);
          const obecnaKwota = dataMap.has(zdp) ? dataMap.get(zdp) : 0;
          dataMap.set(zdp, obecnaKwota + kwota);
        }
      }
    });
    return dataMap;
  }

  function toggleExclude(zdp) {
    if (excludedZDPs.has(zdp)) {
      excludedZDPs.delete(zdp);
    } else {
      excludedZDPs.add(zdp);
    }
    validateZDP();
  }

  function addToSourceTextarea(zdp, kwotaGrosze) {
    const textarea = document.getElementById('dane_plik');
    const kwotaStr = formatDiff(kwotaGrosze);
    const newLine = `${zdp}\t${kwotaStr}`;
    if (textarea.value.trim() === '') {
      textarea.value = newLine;
    } else {
      textarea.value = textarea.value.trim() + '\n' + newLine;
    }
    manuallyAddedZDPs.add(zdp);
    validateZDP();
  }

  function validateZDP() {
    const kwotaDocelowa = parseToGrosze(document.getElementById('kwota_docelowa').value);
    const danePlikText = document.getElementById('dane_plik').value;
    const daneExcelText = document.getElementById('dane_excel').value;

    const mapPlik = parsePastedData(danePlikText, false);
    const mapExcel = parsePastedData(daneExcelText, true);

    let sumaPlik = 0;
    let sumaExcel = 0;

    const kaikkiZDP = new Set([...mapPlik.keys(), ...mapExcel.keys()]);

    const activeZDPs = [];
    const excludedZDPsList = [];

    kaikkiZDP.forEach(zdp => {
      if (excludedZDPs.has(zdp)) {
        excludedZDPsList.push(zdp);
      } else {
        activeZDPs.push(zdp);
        if (mapPlik.has(zdp)) sumaPlik += mapPlik.get(zdp);
        if (mapExcel.has(zdp)) sumaExcel += mapExcel.get(zdp);
      }
    });

    activeZDPs.sort();
    excludedZDPsList.sort();

    const zdpPosortowane = [...activeZDPs, ...excludedZDPsList];

    const statPlik = document.getElementById('status_plik_cel');
    updateBadge(statPlik, sumaPlik, kwotaDocelowa, (kwotaDocelowa === 0 && sumaPlik === 0));

    const statExcel = document.getElementById('status_excel_cel');
    updateBadge(statExcel, sumaExcel, kwotaDocelowa, (kwotaDocelowa === 0 && sumaExcel === 0));

    const tbody = document.getElementById('tabela_wynikow');
    tbody.innerHTML = '';

    if (zdpPosortowane.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7280">Brak danych do porównania</td></tr>';
      return;
    }

    let renderedRows = 0;

    zdpPosortowane.forEach(zdp => {
      const kwotaPlik = mapPlik.has(zdp) ? mapPlik.get(zdp) : null;
      const kwotaExcel = mapExcel.has(zdp) ? mapExcel.get(zdp) : null;
      const isExcluded = excludedZDPs.has(zdp);
      const isManuallyAdded = manuallyAddedZDPs.has(zdp);

      const hasError = (!isExcluded) && (kwotaPlik === null || kwotaExcel === null || kwotaPlik !== kwotaExcel);

      if (currentFilter === 'ERRORS' && !hasError) return;
      if (currentFilter === 'EXCLUDED' && !isExcluded) return;

      renderedRows++;

      const tr = document.createElement('tr');
      let statusHtml = '';

      if (kwotaPlik === null) {
        tr.className = isExcluded ? 'row-excluded' : 'row-error';
        statusHtml = '<span class="text-red">Brak w pliku źródłowym</span>';
      } else if (kwotaExcel === null) {
        tr.className = isExcluded ? 'row-excluded' : 'row-error';
        statusHtml = '<span class="text-red">Pominięto w Twoim Excelu</span>';
      } else if (kwotaPlik !== kwotaExcel) {
        tr.className = isExcluded ? 'row-excluded' : 'row-error';
        statusHtml = `<span class="text-red">Różnica: ${formatDiff(kwotaExcel - kwotaPlik)}</span>`;
      } else {
        tr.className = isExcluded ? 'row-excluded' : '';
        statusHtml = '<span class="text-green">Zgodne</span>';
        if (isManuallyAdded) {
          statusHtml += '<span class="added-note">(Brak w bieżącym pliku źródłowym)</span>';
        }
      }

      const actionTd = document.createElement('td');
      actionTd.style.textAlign = 'center';

      if (isExcluded) {
        const btnRestore = document.createElement('button');
        btnRestore.type = 'button';
        btnRestore.className = 'action-btn btn-restore';
        btnRestore.textContent = 'Przywróć';
        btnRestore.title = 'Przywróć do podsumowania';
        btnRestore.onclick = function () { toggleExclude(zdp); };
        actionTd.appendChild(btnRestore);
      } else {
        if (kwotaPlik === null && kwotaExcel !== null) {
          const btnAdd = document.createElement('button');
          btnAdd.type = 'button';
          btnAdd.className = 'action-btn btn-add';
          btnAdd.innerHTML = '➕';
          btnAdd.title = 'Dodaj do pliku źródłowego (Zbilansuj)';
          btnAdd.style.marginRight = '5px';
          btnAdd.onclick = function () { addToSourceTextarea(zdp, kwotaExcel); };
          actionTd.appendChild(btnAdd);
        }

        const btnExclude = document.createElement('button');
        btnExclude.type = 'button';
        btnExclude.className = 'action-btn';
        btnExclude.textContent = '❌';
        btnExclude.title = 'Wyklucz z podsumowania';
        btnExclude.onclick = function () { toggleExclude(zdp); };
        actionTd.appendChild(btnExclude);
      }

      const tdZdp = document.createElement('td');
      if (isManuallyAdded) {
        tdZdp.className = 'text-blue-zdp';
      } else {
        tdZdp.style.fontWeight = '600';
      }
      tdZdp.textContent = zdp;

      const tdPlik = document.createElement('td');
      tdPlik.textContent = kwotaPlik !== null ? formatDiff(kwotaPlik) : '-';

      const tdExcel = document.createElement('td');
      tdExcel.textContent = kwotaExcel !== null ? formatDiff(kwotaExcel) : '-';

      const tdStatus = document.createElement('td');
      tdStatus.innerHTML = statusHtml;

      tr.appendChild(tdZdp);
      tr.appendChild(tdPlik);
      tr.appendChild(tdExcel);
      tr.appendChild(tdStatus);
      tr.appendChild(actionTd);

      tbody.appendChild(tr);
    });

    if (renderedRows === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:20px">Brak pozycji dla wybranego filtru</td></tr>';
    }
  }

  function ensureCss() {
    if (document.getElementById('rozliczenia-css')) return;
    const style = document.createElement('style');
    style.id = 'rozliczenia-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function wireEvents(root) {
    if (wired) return;
    wired = true;

    root.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-rzl-tab]');
      if (tabBtn) {
        openTab(tabBtn.getAttribute('data-rzl-tab'));
        return;
      }
      const actBtn = e.target.closest('[data-rzl-act]');
      if (actBtn) {
        const act = actBtn.getAttribute('data-rzl-act');
        if (act === 'clearExcel') clearExcel();
        else if (act === 'clearEga') clearEga();
        else if (act === 'togglePasteArea') togglePasteArea();
        else if (act === 'clearSourceData') clearSourceData();
        else if (act === 'clearYourData') clearYourData();
        return;
      }
      const filterBtn = e.target.closest('[data-rzl-filter]');
      if (filterBtn) {
        setFilter(filterBtn.getAttribute('data-rzl-filter'), filterBtn);
      }
    });

    const arkKwota = document.getElementById('ark_kwota');
    if (arkKwota) {
      arkKwota.addEventListener('input', function (e) {
        document.getElementById('kwota_docelowa').value = e.target.value;
        validateZDP();
      });
    }

    root.querySelectorAll('input[type="text"]:not([readonly])').forEach(input => {
      input.addEventListener('blur', function (e) {
        formatInputOnBlur(e);
        if (e.target.id === 'ark_kwota') {
          document.getElementById('kwota_docelowa').value = e.target.value;
        }
      });
    });

    root.querySelectorAll('#tab-weryfikator input:not([readonly])').forEach(input => {
      input.addEventListener('input', validateWeryfikator);
    });

    root.querySelectorAll('#tab-zdp input, #tab-zdp textarea').forEach(input => {
      input.addEventListener('input', validateZDP);
    });
  }

  function render() {
    ensureCss();
    const root = document.getElementById('rozliczenia-app');
    if (!root) return;
    if (!root.dataset.ready) {
      root.innerHTML = HTML;
      root.dataset.ready = '1';
      wireEvents(root);
    }
  }

  function activate() {
    activated = true;
    render();
  }

  return { activate };
})();

window.RozliczeniaModule = RozliczeniaModule;
