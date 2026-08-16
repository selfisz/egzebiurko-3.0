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
  flex: 1; min-height: 0; overflow: auto;
  background: transparent;
  color: var(--tool-ink, #1a2332);
  font-family: var(--tool-ui, "Source Sans 3", system-ui, sans-serif);
  padding: 22px 18px;
  box-sizing: border-box;
}
#rozliczenia-app .rzl-container {
  background: var(--tool-cream, #faf6f0);
  padding: 22px 24px 28px;
  border-radius: 14px;
  border: 1px solid var(--tool-edge, #d4c4b0);
  box-shadow: 0 10px 28px rgba(26,35,50,.07);
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  box-sizing: border-box;
}
#rozliczenia-app .tabs-header {
  display: flex; border-bottom: 1px solid var(--tool-edge, #d4c4b0); margin-bottom: 22px; gap: 4px; flex-wrap: wrap;
}
#rozliczenia-app .tab-btn {
  background: none; border: none; padding: 12px 18px; font-size: .92rem; font-weight: 650;
  color: var(--tool-ink-soft, #3d4a5c); cursor: pointer; border-bottom: 3px solid transparent;
  margin-bottom: -1px; transition: color .15s, border-color .15s; font-family: inherit;
}
#rozliczenia-app .tab-btn:hover { color: var(--tool-ink, #1a2332); }
#rozliczenia-app .tab-btn.active { color: var(--tool-spine, #8b3a3a); border-bottom-color: var(--tool-spine, #8b3a3a); }
#rozliczenia-app .tab-content { display: none; animation: rzlFadeIn .3s ease; }
#rozliczenia-app .tab-content.active { display: block; }
@keyframes rzlFadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
#rozliczenia-app h2 {
  margin-top: 0; font-size: 1.35rem; text-align: center;
  font-family: var(--tool-display, Georgia, serif); font-weight: 700; letter-spacing: -.02em;
  border-bottom: 1px solid var(--tool-edge, #d4c4b0);
  padding-bottom: 14px; margin-bottom: 18px; color: var(--tool-ink, #1a2332);
}
#rozliczenia-app .columns-wrapper {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px;
}
#rozliczenia-app .source-section {
  padding: 16px; border-radius: 12px; border: 1px solid var(--tool-edge, #d4c4b0);
  background: color-mix(in srgb, var(--tool-paper, #f3ebe0) 70%, var(--tool-cream, #faf6f0));
}
#rozliczenia-app .section-arkusz { border-top: 3px solid var(--tool-spine, #8b3a3a); }
#rozliczenia-app .section-system { border-top: 3px solid var(--tool-olive, #5c6b3a); }
#rozliczenia-app .section-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;
}
#rozliczenia-app .section-title {
  font-size: .78rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
  color: var(--tool-ink-soft, #3d4a5c);
}
#rozliczenia-app .clear-btn {
  background: none; border: 1px solid transparent; font-size: 16px; cursor: pointer; padding: 4px 6px;
  border-radius: 6px; transition: background-color .15s, border-color .15s;
  display: flex; align-items: center; justify-content: center; color: var(--tool-ink-soft, #3d4a5c);
}
#rozliczenia-app .clear-btn:hover { background: #fff; border-color: var(--tool-spine, #8b3a3a); }
#rozliczenia-app .form-group { display: flex; flex-direction: column; margin-bottom: 12px; }
#rozliczenia-app .form-group-split { display: flex; gap: 10px; }
#rozliczenia-app .form-group-split .form-group { flex: 1; }
#rozliczenia-app label {
  font-weight: 650; margin-bottom: 4px; font-size: .72rem; text-transform: uppercase;
  letter-spacing: .04em; color: var(--tool-ink-soft, #3d4a5c);
}
#rozliczenia-app input[type="text"] {
  padding: 9px 12px; border: 1px solid var(--tool-edge, #d4c4b0); border-radius: 8px;
  font-size: .95rem; transition: all .15s ease; background: var(--tool-cream, #faf6f0);
  width: 100%; box-sizing: border-box; font-family: inherit; color: var(--tool-ink, #1a2332);
}
#rozliczenia-app input[type="text"]:focus:not([readonly]) {
  outline: none; border-color: var(--tool-spine, #8b3a3a); box-shadow: 0 0 0 3px rgba(139,58,58,.14);
}
#rozliczenia-app .readonly-input {
  background: color-mix(in srgb, var(--tool-warn, #9a6b2f) 14%, var(--tool-cream, #faf6f0));
  font-weight: 700; color: var(--tool-warn, #9a6b2f); border-color: color-mix(in srgb, var(--tool-warn, #9a6b2f) 40%, var(--tool-edge, #d4c4b0)); cursor: not-allowed;
}
#rozliczenia-app .readonly-arkusz {
  background: color-mix(in srgb, var(--tool-spine, #8b3a3a) 10%, var(--tool-cream, #faf6f0));
  font-weight: 700; color: var(--tool-spine, #8b3a3a);
  border-color: color-mix(in srgb, var(--tool-spine, #8b3a3a) 35%, var(--tool-edge, #d4c4b0)); cursor: not-allowed;
}
#rozliczenia-app .results { display: flex; flex-direction: column; gap: 8px; }
#rozliczenia-app .result-item {
  padding: 12px 14px; border-radius: 10px; font-size: .88rem;
  display: flex; justify-content: space-between; align-items: center;
  background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 55%, var(--tool-cream, #faf6f0));
  border: 1px solid var(--tool-edge, #d4c4b0); gap: 12px; flex-wrap: wrap;
}
#rozliczenia-app .result-label { font-weight: 650; }
#rozliczenia-app .result-equation { font-size: .72rem; color: var(--tool-ink-soft, #3d4a5c); margin-top: 3px; display: block; }
#rozliczenia-app .status-badge {
  padding: 6px 12px; border-radius: 8px; font-size: .72rem; font-weight: 700;
  color: #faf6f0; text-align: center; min-width: 120px; letter-spacing: .02em;
}
#rozliczenia-app .bg-red { background: var(--tool-err, #8b3a3a); }
#rozliczenia-app .bg-green { background: var(--tool-ok, #5c6b3a); }
#rozliczenia-app .bg-gray { background: var(--tool-ink-soft, #3d4a5c); }
#rozliczenia-app .top-bar {
  display: flex; justify-content: center; margin-bottom: 14px;
  background: color-mix(in srgb, var(--tool-spine, #8b3a3a) 8%, var(--tool-cream, #faf6f0));
  padding: 14px; border-radius: 10px; border: 1px dashed color-mix(in srgb, var(--tool-spine, #8b3a3a) 35%, var(--tool-edge, #d4c4b0));
}
#rozliczenia-app .toggle-paste-btn {
  width: 100%; padding: 10px; background: var(--tool-cream, #faf6f0);
  border: 1px solid var(--tool-edge, #d4c4b0); border-radius: 8px; font-weight: 700;
  color: var(--tool-ink-soft, #3d4a5c); cursor: pointer; text-align: center; margin-bottom: 14px;
  transition: border-color .15s, color .15s; font-family: inherit;
}
#rozliczenia-app .toggle-paste-btn:hover { border-color: var(--tool-spine, #8b3a3a); color: var(--tool-ink, #1a2332); }
#rozliczenia-app textarea {
  width: 100%; height: 200px; padding: 12px; border: 1px solid var(--tool-edge, #d4c4b0);
  border-radius: 8px; font-family: ui-monospace, monospace; font-size: .82rem; resize: vertical;
  box-sizing: border-box; background: color-mix(in srgb, var(--tool-paper, #f3ebe0) 60%, var(--tool-cream, #faf6f0));
  color: var(--tool-ink, #1a2332);
}
#rozliczenia-app textarea:focus {
  outline: none; border-color: var(--tool-spine, #8b3a3a);
  box-shadow: 0 0 0 3px rgba(139,58,58,.14); background: var(--tool-cream, #faf6f0);
}
#rozliczenia-app .help-text { font-size: .7rem; color: var(--tool-ink-soft, #3d4a5c); margin-top: 4px; display: block; }
#rozliczenia-app .summary-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px;
  border-top: 1px solid var(--tool-edge, #d4c4b0); padding-top: 18px;
}
#rozliczenia-app .summary-card {
  padding: 14px; border-radius: 10px; border: 1px solid var(--tool-edge, #d4c4b0);
  background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 50%, var(--tool-cream, #faf6f0));
  display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
}
#rozliczenia-app .details-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: .82rem; }
#rozliczenia-app .details-table th,
#rozliczenia-app .details-table td {
  padding: 10px; text-align: left; border-bottom: 1px solid var(--tool-edge, #d4c4b0); vertical-align: top;
}
#rozliczenia-app .details-table th {
  background: var(--tool-ink, #1a2332); color: var(--tool-cream, #faf6f0);
  font-weight: 650; position: sticky; top: 0; border-bottom: 2px solid var(--tool-spine, #8b3a3a);
  font-size: .68rem; text-transform: uppercase; letter-spacing: .05em;
}
#rozliczenia-app .row-error { background: color-mix(in srgb, var(--tool-err, #8b3a3a) 10%, var(--tool-cream, #faf6f0)); }
#rozliczenia-app .text-red { color: var(--tool-err, #8b3a3a); font-weight: 700; }
#rozliczenia-app .text-green { color: var(--tool-ok, #5c6b3a); font-weight: 700; }
#rozliczenia-app .text-blue-zdp { color: var(--tool-spine, #8b3a3a); font-weight: 700; }
#rozliczenia-app .added-note {
  display: block; font-size: .7rem; color: var(--tool-ink-soft, #3d4a5c); margin-top: 4px; font-weight: normal;
}
#rozliczenia-app .row-excluded {
  background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 70%, transparent);
  opacity: .55; text-decoration: line-through; color: var(--tool-ink-soft, #3d4a5c);
}
#rozliczenia-app .action-btn {
  background: none; border: none; cursor: pointer; font-size: 16px; padding: 4px;
  border-radius: 6px; transition: background .15s;
}
#rozliczenia-app .action-btn:hover { background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 80%, #fff); }
#rozliczenia-app .btn-restore {
  font-size: .72rem; background: var(--tool-paper2, #ebe1d4); padding: 4px 8px; border-radius: 6px;
  text-decoration: none; display: inline-block; font-weight: 700; color: var(--tool-ink, #1a2332);
  border: 1px solid var(--tool-edge, #d4c4b0); cursor: pointer;
}
#rozliczenia-app .btn-add { background: color-mix(in srgb, var(--tool-olive, #5c6b3a) 16%, var(--tool-cream, #faf6f0)); }
#rozliczenia-app .btn-add:hover { background: color-mix(in srgb, var(--tool-olive, #5c6b3a) 28%, var(--tool-cream, #faf6f0)); }
#rozliczenia-app .filter-group { display: flex; gap: 8px; margin-bottom: 14px; align-items: center; flex-wrap: wrap; }
#rozliczenia-app .filter-label { font-size: .78rem; font-weight: 650; color: var(--tool-ink-soft, #3d4a5c); margin-right: 4px; }
#rozliczenia-app .filter-btn {
  padding: 6px 12px; border: 1px solid var(--tool-edge, #d4c4b0); border-radius: 999px;
  background: var(--tool-cream, #faf6f0); cursor: pointer; font-size: .72rem; font-weight: 700;
  color: var(--tool-ink-soft, #3d4a5c); transition: all .15s; font-family: inherit;
}
#rozliczenia-app .filter-btn:hover { border-color: var(--tool-spine, #8b3a3a); color: var(--tool-ink, #1a2332); }
#rozliczenia-app .filter-btn.active {
  background: var(--tool-ink, #1a2332); color: var(--tool-cream, #faf6f0); border-color: var(--tool-ink, #1a2332);
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
      <div class="result-item" style="background:color-mix(in srgb, var(--tool-olive) 10%, var(--tool-cream));border-color:color-mix(in srgb, var(--tool-olive) 35%, var(--tool-edge))">
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
      <div class="result-item" style="background:color-mix(in srgb, var(--tool-spine) 8%, var(--tool-cream));border-color:color-mix(in srgb, var(--tool-spine) 30%, var(--tool-edge))">
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
