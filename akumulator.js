/* ============================================================
   Egzebiurko 3.0 — akumulator.js
   Zakładka 1: Wklepywator Excel (generator wierszy + Ctrl+V)
   Logika 1:1 — szata jak Szafka teczek (papier + atrament).
   ============================================================ */

'use strict';

const AkumulatorModule = (() => {
  let activated = false;
  let wired = false;
  let batchData = [];
  let editingIndex = -1;
  let pasteBound = false;

  const CSS = `
#akumulator-app {
  --aku-card: var(--tool-cream, #faf6f0);
  --aku-text: var(--tool-ink, #1a2332);
  --aku-muted: var(--tool-ink-soft, #3d4a5c);
  --aku-border: var(--tool-edge, #d4c4b0);
  --aku-input: color-mix(in srgb, var(--tool-cream, #faf6f0) 88%, #fff);
  --aku-excel: var(--tool-excel, #3d6b4f);
  flex: 1; min-height: 0; overflow: auto;
  background: transparent; color: var(--aku-text);
  font-family: var(--tool-ui, "Source Sans 3", system-ui, sans-serif);
}
#akumulator-app * { box-sizing: border-box; }
#akumulator-app input[type=number]::-webkit-inner-spin-button,
#akumulator-app input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
#akumulator-app input[type=number] { -moz-appearance: textfield; }
#akumulator-app .aku-nav {
  background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 70%, var(--aku-card));
  border-bottom: 1px solid var(--aku-border);
  padding: 14px 18px; position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 12px;
}
#akumulator-app .aku-nav h1 {
  margin: 0; font-family: var(--tool-display, Georgia, serif);
  font-size: 1.35rem; font-weight: 700; letter-spacing: -.02em; color: var(--aku-text);
}
#akumulator-app .aku-badge {
  font-family: var(--tool-ui, system-ui, sans-serif);
  font-size: 10px; font-weight: 700; letter-spacing: .06em;
  background: var(--tool-spine, #8b3a3a); color: #faf6f0;
  padding: 3px 8px; border-radius: 4px; margin-left: 10px; vertical-align: middle;
}
#akumulator-app .aku-main { max-width: 64rem; margin: 0 auto; padding: 18px 16px 48px; display: flex; flex-direction: column; gap: 18px; }
#akumulator-app .aku-info {
  background: color-mix(in srgb, var(--tool-spine, #8b3a3a) 8%, var(--aku-card));
  border: 1px solid var(--aku-border); padding: 14px 16px; border-radius: 12px;
  display: flex; gap: 12px; font-size: .875rem; color: var(--aku-text);
  border-left: 3px solid var(--tool-spine, #8b3a3a);
}
#akumulator-app .aku-info strong { display: block; color: var(--tool-spine, #8b3a3a); margin-bottom: 2px; font-weight: 700; }
#akumulator-app .aku-toast {
  position: fixed; top: 72px; right: 20px; z-index: 60;
  background: var(--tool-ink, #1a2332); color: var(--tool-cream, #faf6f0);
  padding: 14px 20px; border-radius: 10px;
  box-shadow: 0 10px 28px rgba(26,35,50,.22); border-left: 4px solid var(--tool-olive, #5c6b3a);
  transform: translateX(120%); transition: transform .3s; display: flex; gap: 12px; align-items: flex-start;
  max-width: min(360px, 90vw);
}
#akumulator-app .aku-toast.show { transform: translateX(0); }
#akumulator-app .aku-toast h4 { margin: 0; font-size: .85rem; font-family: var(--tool-display, Georgia, serif); }
#akumulator-app .aku-toast p { margin: 2px 0 0; font-size: .75rem; opacity: .9; }
#akumulator-app .aku-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 800px) { #akumulator-app .aku-grid { grid-template-columns: 1fr; } }
#akumulator-app .aku-card {
  background: var(--aku-card); border-radius: 14px; border: 1px solid var(--aku-border);
  padding: 18px; box-shadow: 0 8px 24px rgba(26,35,50,.06);
  border-top: 3px solid var(--tool-spine, #8b3a3a);
}
#akumulator-app .aku-card.green { border-top-color: var(--tool-olive, #5c6b3a); display: flex; flex-direction: column; justify-content: space-between; }
#akumulator-app .aku-card.orange { border-top-color: var(--tool-warn, #9a6b2f); }
#akumulator-app .aku-card-head {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 8px;
}
#akumulator-app .aku-card-head h2 {
  margin: 0; font-size: 1.05rem; font-weight: 700;
  font-family: var(--tool-display, Georgia, serif); letter-spacing: -.01em;
}
#akumulator-app .aku-link {
  border: none; background: none; cursor: pointer; font-size: .75rem;
  color: var(--aku-muted); font-weight: 600; font-family: inherit;
}
#akumulator-app .aku-link:hover { color: var(--tool-spine, #8b3a3a); }
#akumulator-app .aku-field { margin-bottom: 12px; }
#akumulator-app .aku-label {
  display: block; font-size: .68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: .06em; color: var(--aku-muted); margin-bottom: 4px;
}
#akumulator-app .aku-input {
  width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--aku-border);
  background: var(--aku-input); color: var(--aku-text); font: inherit;
}
#akumulator-app .aku-input:focus {
  outline: none; border-color: var(--tool-spine, #8b3a3a);
  box-shadow: 0 0 0 3px rgba(139,58,58,.14);
}
#akumulator-app .uppercase-input { text-transform: uppercase; font-weight: 700; }
#akumulator-app .aku-date-row { display: flex; align-items: center; gap: 8px; }
#akumulator-app .aku-icon-btn {
  padding: 10px; min-width: 44px; border: 1px solid var(--aku-border); border-radius: 8px; cursor: pointer;
  background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 55%, var(--aku-card));
  color: var(--aku-text); font-weight: 700; font-family: inherit;
}
#akumulator-app .aku-icon-btn:hover { border-color: var(--tool-spine, #8b3a3a); background: #fff; }
#akumulator-app .aku-amount-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: center; margin-bottom: 10px;
}
#akumulator-app .aku-amount-row label { font-size: .875rem; font-weight: 550; }
#akumulator-app .amount-input { text-align: right; font-family: ui-monospace, monospace; }
#akumulator-app .aku-sum-row {
  margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--aku-border);
  display: flex; justify-content: space-between; align-items: flex-end; gap: 12px;
}
#akumulator-app .aku-sum-label { font-size: .7rem; text-transform: uppercase; color: var(--aku-muted); font-weight: 700; letter-spacing: .05em; }
#akumulator-app #displaySum {
  font-size: 2rem; font-weight: 700; color: var(--aku-excel); font-variant-numeric: tabular-nums;
  font-family: var(--tool-display, Georgia, serif);
}
#akumulator-app .aku-settings {
  background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 65%, var(--aku-card));
  padding: 12px 14px; border-radius: 12px; border: 1px solid var(--aku-border);
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
}
#akumulator-app .aku-row-ctrl {
  display: flex; align-items: center; gap: 6px; background: var(--aku-card);
  padding: 4px; border-radius: 8px; border: 1px solid var(--aku-border);
}
#akumulator-app .aku-row-ctrl input {
  width: 4rem; text-align: center; font-family: ui-monospace, monospace; font-weight: 700;
  border: none; background: transparent; color: var(--aku-text); font-size: 1rem; padding: 4px;
}
#akumulator-app .aku-btn {
  border: 1px solid var(--aku-border); border-radius: 8px; padding: 10px 16px; font-weight: 600; cursor: pointer;
  font-family: inherit; font-size: .875rem; display: inline-flex; align-items: center; gap: 8px;
  background: var(--aku-card); color: var(--aku-text);
}
#akumulator-app .aku-btn:active { transform: scale(.98); }
#akumulator-app .aku-btn-ghost:hover { border-color: var(--tool-spine, #8b3a3a); background: #fff; }
#akumulator-app .aku-btn-excel {
  background: var(--aku-excel); color: #faf6f0; border-color: transparent; font-weight: 700;
}
#akumulator-app .aku-btn-excel:hover { filter: brightness(1.06); }
#akumulator-app .aku-batch-actions { display: flex; gap: 8px; }
#akumulator-app #cancelEditBtn {
  display: none; width: 25%; background: var(--aku-muted); color: #faf6f0; font-weight: 700;
  padding: 12px 8px; border: none; border-radius: 12px; cursor: pointer; font-family: inherit;
}
#akumulator-app #cancelEditBtn.show { display: block; }
#akumulator-app #batchActionBtn {
  flex: 1; width: 100%; background: var(--tool-spine, #8b3a3a); color: #faf6f0; font-weight: 700;
  padding: 14px; border: none; border-radius: 12px; cursor: pointer; font-family: inherit;
  box-shadow: 0 6px 16px rgba(139,58,58,.22);
}
#akumulator-app #batchActionBtn.saving { background: var(--tool-olive, #5c6b3a); box-shadow: 0 6px 16px rgba(92,107,58,.22); }
#akumulator-app #batchActionBtn:hover { filter: brightness(1.05); }
#akumulator-app #batchSection { display: none; }
#akumulator-app #batchSection.show { display: block; animation: akuFade .3s ease; }
@keyframes akuFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
#akumulator-app .aku-table-wrap { overflow-x: auto; margin-bottom: 14px; border-radius: 10px; border: 1px solid var(--aku-border); }
#akumulator-app table { width: 100%; border-collapse: collapse; font-size: .875rem; }
#akumulator-app thead th {
  text-align: left; padding: 10px 12px; font-size: .68rem; text-transform: uppercase; letter-spacing: .06em;
  background: var(--tool-ink, #1a2332); color: var(--tool-cream, #faf6f0); border-bottom: 2px solid var(--tool-spine, #8b3a3a);
}
#akumulator-app tbody td { padding: 10px 12px; border-bottom: 1px solid var(--aku-border); vertical-align: top; background: var(--aku-card); }
#akumulator-app tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--tool-paper, #f3ebe0) 55%, transparent); }
#akumulator-app tbody tr:hover td { background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 80%, #fff); }
#akumulator-app .editing-row td {
  background: color-mix(in srgb, var(--tool-spine, #8b3a3a) 10%, var(--aku-card)) !important;
  box-shadow: inset 3px 0 0 var(--tool-spine, #8b3a3a);
}
#akumulator-app .aku-mono { font-family: ui-monospace, monospace; font-size: .75rem; color: var(--aku-excel); font-weight: 700; }
#akumulator-app .aku-act-btn {
  border: none; background: none; cursor: pointer; padding: 6px; font-size: 1rem; color: var(--tool-spine, #8b3a3a);
}
#akumulator-app .aku-act-btn.danger { color: var(--tool-err, #8b3a3a); }
#akumulator-app .aku-copy-batch {
  width: 100%; background: var(--tool-warn, #9a6b2f); color: #faf6f0; font-weight: 700; padding: 16px;
  border: none; border-radius: 12px; cursor: pointer; font-family: inherit;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  box-shadow: 0 6px 16px rgba(154,107,47,.22);
}
#akumulator-app .aku-copy-batch:hover { filter: brightness(1.05); }
#akumulator-app .aku-copy-batch small { display: block; font-weight: 400; opacity: .85; font-size: 10px; margin-top: 4px; }
#akumulator-app .aku-foot { text-align: center; font-size: .75rem; color: var(--aku-muted); margin-top: 8px; }
@keyframes akuFlash { 0% { background: color-mix(in srgb, var(--tool-olive, #5c6b3a) 28%, transparent); } 100% { background: transparent; } }
#akumulator-app .paste-flash { animation: akuFlash .8s ease-out; }
`;

  const HTML = `
<div class="aku-nav">
  <div>
    <h1>Wklepywator Excel <span class="aku-badge">CTRL+V</span></h1>
  </div>
</div>
<div class="aku-main" id="mainContainer">
  <div class="aku-info">
    <span>📚</span>
    <div>
      <strong>Gotowy na wklejenie z Excela</strong>
      Gdy skopiujesz 4 razy w Programie A, wciśnij tutaj <b>Ctrl+V</b> (nie w polu tekstowym).<br>
      Kolejność: Dłużnik → ZDP → Data → Kwota.
    </div>
  </div>

  <div id="toast" class="aku-toast">
    <span id="toastIcon">✅</span>
    <div>
      <h4>Info</h4>
      <p id="toastMessage">Komunikat systemowy.</p>
    </div>
  </div>

  <div class="aku-grid">
    <section class="aku-card">
      <div class="aku-card-head">
        <h2>👤 1. Dane Wpłaty</h2>
        <button type="button" class="aku-link" data-aku="clearSection1">🗑 Wyczyść</button>
      </div>
      <div class="aku-field">
        <label class="aku-label">Kolumna B: Zobowiązany (AUTO CAPS)</label>
        <input type="text" id="debtor" class="aku-input uppercase-input" placeholder="KOWALSKI JAN">
      </div>
      <div class="aku-field">
        <label class="aku-label">Kolumna C: Nr ZDP (Sygnatura)</label>
        <input type="text" id="transferNo" class="aku-input" placeholder="Np. 1234/2023">
      </div>
      <div class="aku-field">
        <label class="aku-label">Kolumna D: Data Wpłaty</label>
        <div class="aku-date-row">
          <button type="button" class="aku-icon-btn" data-aku="changeDate" data-days="-1" tabindex="-1">−</button>
          <input type="date" id="date" class="aku-input">
          <button type="button" class="aku-icon-btn" data-aku="changeDate" data-days="1" tabindex="-1">+</button>
        </div>
      </div>
    </section>

    <section class="aku-card green">
      <div>
        <div class="aku-card-head">
          <h2>💰 2. Rozksięgowanie</h2>
          <button type="button" class="aku-link" data-aku="clearSection2">🗑 Wyczyść</button>
        </div>
        <div class="aku-amount-row">
          <label>G: Prowizyjne (pr)</label>
          <input type="text" inputmode="decimal" id="amountG" class="aku-input amount-input" placeholder="0,00">
        </div>
        <div class="aku-amount-row">
          <label>H: Bezprowizyjne (bp)</label>
          <input type="text" inputmode="decimal" id="amountH" class="aku-input amount-input" placeholder="0,00">
        </div>
        <div class="aku-amount-row">
          <label>I: Zwrot (zw)</label>
          <input type="text" inputmode="decimal" id="amountI" class="aku-input amount-input" placeholder="0,00">
        </div>
        <div class="aku-amount-row" style="padding-top:8px;border-top:1px solid var(--aku-border);margin-top:8px">
          <label class="aku-label" style="margin:0">F: Podpis</label>
          <input type="text" id="signature" value="HAZO" class="aku-input" style="text-align:center;padding:6px">
        </div>
      </div>
      <div class="aku-sum-row">
        <div class="aku-sum-label">Suma (w Excelu jako formuła)</div>
        <div id="displaySum">0,00 zł</div>
      </div>
    </section>
  </div>

  <section class="aku-settings">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div class="aku-row-ctrl">
        <span style="margin-left:6px">📋</span>
        <label for="startRow" style="font-size:.85rem;font-weight:700;white-space:nowrap">Nr wiersza:</label>
        <button type="button" class="aku-icon-btn" style="min-width:32px;padding:6px" data-aku="changeRow" data-amt="-1">−</button>
        <input type="number" id="startRow" value="0">
        <button type="button" class="aku-icon-btn" style="min-width:32px;padding:6px" data-aku="changeRow" data-amt="1">+</button>
      </div>
      <div style="font-size:.75rem;color:var(--aku-muted)" class="aku-hint-desktop">Steruje formułą SUMY i zwiększa się auto.</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="aku-btn aku-btn-ghost" data-aku="copyDataOnly">📋 Tylko Dane</button>
      <button type="button" class="aku-btn aku-btn-excel" data-aku="copyFullRow">📄 Kopiuj 1 Wiersz</button>
    </div>
  </section>

  <div class="aku-batch-actions">
    <button type="button" id="cancelEditBtn" data-aku="cancelEdit">Anuluj</button>
    <button type="button" id="batchActionBtn" data-aku="handleBatchAction">
      <span id="batchBtnText">➕ Dodaj do listy (+)</span>
    </button>
  </div>

  <section id="batchSection" class="aku-card orange">
    <div class="aku-card-head" style="border-bottom:1px solid var(--aku-border);padding-bottom:8px">
      <h2>📚 Lista Zbiorcza (<span id="batchCount">0</span>)</h2>
      <button type="button" class="aku-link" data-aku="clearBatch" style="color:#ef4444;text-decoration:underline">Wyczyść listę</button>
    </div>
    <div class="aku-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Zobowiązany</th>
            <th>Dane</th>
            <th>Kwoty (G/H/I)</th>
            <th style="text-align:right">Akcje</th>
          </tr>
        </thead>
        <tbody id="batchTableBody"></tbody>
      </table>
    </div>
    <button type="button" class="aku-copy-batch" data-aku="copyBatchList">
      <span style="font-size:1.4rem">📤</span>
      <div style="text-align:left">
        <span style="font-size:1.05rem;display:block;line-height:1.1">Kopiuj CAŁĄ LISTĘ</span>
        <small>Generuje formuły startując od wiersza <span id="btnStartRowIndicator">...</span></small>
      </div>
    </button>
  </section>

  <div class="aku-foot">Gotowe do użycia.</div>
</div>
`;

  function rootEl() { return document.getElementById('akumulator-app'); }
  function isActivePanel() {
    const panel = document.getElementById('panel-zakladka1');
    return panel && !panel.classList.contains('hidden');
  }

  function parsePolishNumber(str) {
    if (!str) return 0;
    let cleaned = str.toString().replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const result = parseFloat(cleaned);
    return isNaN(result) ? 0 : result;
  }

  function formatVisualNumber(num) {
    return new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  }

  function formatForExcel(num) {
    return num.toFixed(2).replace('.', ',');
  }

  function calculateSum() {
    const g = parsePolishNumber(document.getElementById('amountG').value);
    const h = parsePolishNumber(document.getElementById('amountH').value);
    const i = parsePolishNumber(document.getElementById('amountI').value);
    const sum = g + h + i;
    const el = document.getElementById('displaySum');
    if (el) el.innerText = formatVisualNumber(sum) + ' zł';
    return { sum, g, h, i };
  }

  function getCommonData() {
    const debtor = document.getElementById('debtor').value.trim().toUpperCase();
    const transferNo = document.getElementById('transferNo').value.trim();
    const rawDate = document.getElementById('date').value;
    const signature = document.getElementById('signature').value.trim();
    return { debtor, transferNo, date: rawDate, signature };
  }

  function generateRowString(dataObj, excelRowNumber) {
    const excelFormatOrEmpty = (val, rawInput) => {
      if (rawInput === '' || rawInput === undefined || rawInput === null) return '';
      return formatForExcel(val);
    };
    const gExcel = excelFormatOrEmpty(dataObj.gVal, dataObj.rawG);
    const hExcel = excelFormatOrEmpty(dataObj.hVal, dataObj.rawH);
    const iExcel = excelFormatOrEmpty(dataObj.iVal, dataObj.rawI);
    const formula = `=G${excelRowNumber}+H${excelRowNumber}+I${excelRowNumber}`;
    return `${dataObj.debtor}\t${dataObj.transferNo}\t${dataObj.date}\t${formula}\t${dataObj.signature}\t${gExcel}\t${hExcel}\t${iExcel}`;
  }

  function getFormDataAsObject() {
    const common = getCommonData();
    const calcs = calculateSum();
    return {
      ...common,
      gVal: calcs.g,
      hVal: calcs.h,
      iVal: calcs.i,
      rawG: document.getElementById('amountG').value,
      rawH: document.getElementById('amountH').value,
      rawI: document.getElementById('amountI').value
    };
  }

  function updateButtonText() {
    const startVal = document.getElementById('startRow').value || '???';
    const ind = document.getElementById('btnStartRowIndicator');
    if (ind) ind.innerText = startVal;
  }

  function showToast(msg, isError) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toastMessage');
    const icon = document.getElementById('toastIcon');
    if (!toast || !msgEl) return;
    msgEl.innerText = msg;
    if (icon) icon.textContent = isError ? '⚠️' : '✅';
    toast.style.borderLeftColor = isError ? '#ef4444' : '#22c55e';
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function changeRow(amount) {
    const input = document.getElementById('startRow');
    let val = parseInt(input.value, 10) || 0;
    val += amount;
    input.value = val;
    updateButtonText();
  }

  function changeDate(days) {
    const d = document.getElementById('date');
    const current = d.valueAsDate || new Date();
    current.setDate(current.getDate() + days);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    d.value = `${y}-${m}-${day}`;
  }

  function clearSection1() {
    document.getElementById('debtor').value = '';
    document.getElementById('transferNo').value = '';
    document.getElementById('date').valueAsDate = new Date();
    document.getElementById('debtor').focus();
    showToast('Wyczyszczono dane wpłaty');
  }

  function clearSection2() {
    document.getElementById('amountG').value = '';
    document.getElementById('amountH').value = '';
    document.getElementById('amountI').value = '';
    document.getElementById('signature').value = 'HAZO';
    calculateSum();
    showToast('Wyczyszczono rozliczenie');
  }

  function clearInputs() {
    document.getElementById('debtor').value = '';
    document.getElementById('transferNo').value = '';
    document.getElementById('amountG').value = '';
    document.getElementById('amountH').value = '';
    document.getElementById('amountI').value = '';
    calculateSum();
    document.getElementById('debtor').focus();
  }

  function resetEditMode() {
    editingIndex = -1;
    const btnText = document.getElementById('batchBtnText');
    const batchBtn = document.getElementById('batchActionBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');
    if (btnText) btnText.innerHTML = '➕ Dodaj do listy (+)';
    if (batchBtn) batchBtn.classList.remove('saving');
    if (cancelBtn) cancelBtn.classList.remove('show');
    clearInputs();
  }

  function cancelEdit() {
    resetEditMode();
    renderBatch();
    showToast('Edycja anulowana', false);
  }

  function handleBatchAction() {
    const obj = getFormDataAsObject();
    if (!obj.debtor && !obj.transferNo && (obj.gVal + obj.hVal + obj.iVal === 0)) {
      showToast('Brak danych do dodania!', true);
      return;
    }
    const newItem = {
      id: (editingIndex > -1) ? batchData[editingIndex].id : Date.now(),
      ...obj
    };
    if (editingIndex > -1) {
      batchData[editingIndex] = newItem;
      showToast('Zaktualizowano wiersz ' + (editingIndex + 1));
      resetEditMode();
    } else {
      batchData.push(newItem);
      showToast('Dodano do listy.');
      clearInputs();
    }
    renderBatch();
  }

  function editBatchItem(index) {
    const item = batchData[index];
    document.getElementById('debtor').value = item.debtor;
    document.getElementById('transferNo').value = item.transferNo;
    document.getElementById('date').value = item.date;
    document.getElementById('signature').value = item.signature;
    document.getElementById('amountG').value = item.rawG;
    document.getElementById('amountH').value = item.rawH;
    document.getElementById('amountI').value = item.rawI;
    calculateSum();
    editingIndex = index;
    document.getElementById('batchBtnText').innerHTML = '💾 Zapisz Zmiany';
    document.getElementById('batchActionBtn').classList.add('saving');
    document.getElementById('cancelEditBtn').classList.add('show');
    renderBatch();
    const main = document.getElementById('mainContainer');
    if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('debtor').focus();
  }

  function removeFromBatch(index) {
    if (index === editingIndex) cancelEdit();
    batchData.splice(index, 1);
    if (index < editingIndex) editingIndex--;
    renderBatch();
  }

  function clearBatch() {
    if (confirm('Wyczyścić listę?')) {
      batchData = [];
      resetEditMode();
      renderBatch();
    }
  }

  function renderBatch() {
    const section = document.getElementById('batchSection');
    const tbody = document.getElementById('batchTableBody');
    const count = document.getElementById('batchCount');
    if (!section || !tbody) return;
    if (count) count.innerText = batchData.length;
    if (batchData.length === 0) {
      section.classList.remove('show');
      return;
    }
    section.classList.add('show');
    tbody.innerHTML = '';
    batchData.forEach((item, index) => {
      const tr = document.createElement('tr');
      if (index === editingIndex) tr.classList.add('editing-row');
      tr.innerHTML = `
        <td><div style="font-weight:700">${escapeHtml(item.debtor)}</div></td>
        <td style="font-size:.75rem;color:var(--aku-muted)">${escapeHtml(item.date)}<br>${escapeHtml(item.transferNo || '-')}</td>
        <td class="aku-mono">G: ${formatVisualNumber(item.gVal)}<br>H: ${formatVisualNumber(item.hVal)}<br>I: ${formatVisualNumber(item.iVal)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button type="button" class="aku-act-btn" data-aku-edit="${index}" title="Edytuj">✏️</button>
          <button type="button" class="aku-act-btn danger" data-aku-del="${index}" title="Usuń">🗑</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      try { document.execCommand('copy'); }
      catch (e) { showToast('Błąd', true); }
      document.body.removeChild(textArea);
    }
  }

  function copyDataOnly() {
    const { debtor, transferNo, date } = getCommonData();
    copyToClipboard(`${debtor}\t${transferNo}\t${date}`);
    changeRow(1);
    showToast('Skopiowano i zwiększono nr wiersza!');
  }

  function copyFullRow() {
    const startRow = parseInt(document.getElementById('startRow').value, 10) || 0;
    const dataObj = getFormDataAsObject();
    const rowString = generateRowString(dataObj, startRow);
    copyToClipboard(rowString);
    changeRow(1);
    showToast('Skopiowano i zwiększono nr wiersza!');
  }

  function copyBatchList() {
    if (batchData.length === 0) return;
    let startRow = parseInt(document.getElementById('startRow').value, 10) || 0;
    const hugeString = batchData.map((item, index) => {
      const currentRowNum = startRow + index;
      return generateRowString(item, currentRowNum);
    }).join('\n');
    copyToClipboard(hugeString);
    showToast('Skopiowano listę do schowka!');
  }

  function handlePaste(e) {
    if (!isActivePanel()) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    let paste = (e.clipboardData || window.clipboardData).getData('text');
    if (!paste || !paste.includes('|')) return;
    e.preventDefault();
    const parts = paste.split('|');
    if (parts[0]) {
      document.getElementById('debtor').value = parts[0].trim().replace(/(\r\n|\n|\r)/gm, '');
    }
    if (parts[1]) {
      document.getElementById('transferNo').value = parts[1].trim();
    }
    if (parts[2]) {
      let dStr = parts[2].trim();
      if (dStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
        dStr = dStr.split('.').reverse().join('-');
      }
      document.getElementById('date').value = dStr;
    }
    if (parts[3]) {
      document.getElementById('amountH').value = '';
      document.getElementById('amountI').value = '';
      document.getElementById('amountG').value = parts[3].trim();
      calculateSum();
    }
    const main = document.getElementById('mainContainer');
    if (main) {
      main.classList.add('paste-flash');
      setTimeout(() => main.classList.remove('paste-flash'), 800);
    }
    showToast('Dane wczytane z Wklepywatora!');
  }

  function ensureCss() {
    if (document.getElementById('akumulator-css')) return;
    const style = document.createElement('style');
    style.id = 'akumulator-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function wireEvents(root) {
    if (wired) return;
    wired = true;

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-aku]');
      if (!btn) {
        const edit = e.target.closest('[data-aku-edit]');
        if (edit) { editBatchItem(+edit.getAttribute('data-aku-edit')); return; }
        const del = e.target.closest('[data-aku-del]');
        if (del) { removeFromBatch(+del.getAttribute('data-aku-del')); return; }
        return;
      }
      const act = btn.getAttribute('data-aku');
      if (act === 'clearSection1') clearSection1();
      else if (act === 'clearSection2') clearSection2();
      else if (act === 'changeDate') changeDate(+btn.getAttribute('data-days'));
      else if (act === 'changeRow') changeRow(+btn.getAttribute('data-amt'));
      else if (act === 'copyDataOnly') copyDataOnly();
      else if (act === 'copyFullRow') copyFullRow();
      else if (act === 'handleBatchAction') handleBatchAction();
      else if (act === 'cancelEdit') cancelEdit();
      else if (act === 'clearBatch') clearBatch();
      else if (act === 'copyBatchList') copyBatchList();
    });

    const startRow = document.getElementById('startRow');
    if (startRow) startRow.addEventListener('input', updateButtonText);

    root.querySelectorAll('.amount-input').forEach(input => {
      input.addEventListener('input', calculateSum);
      input.addEventListener('blur', function () {
        if (this.value) {
          const val = parsePolishNumber(this.value);
          if (!isNaN(val) && val !== 0) {
            this.value = formatVisualNumber(val);
          }
        }
      });
      input.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') calculateSum();
      });
    });

    if (!pasteBound) {
      document.addEventListener('paste', handlePaste);
      pasteBound = true;
    }
  }

  function render() {
    ensureCss();
    const root = rootEl();
    if (!root) return;
    if (!root.dataset.ready) {
      root.innerHTML = HTML;
      root.dataset.ready = '1';
      const dateInput = document.getElementById('date');
      if (dateInput && !dateInput.value) dateInput.valueAsDate = new Date();
      wireEvents(root);
      updateButtonText();
      calculateSum();
      renderBatch();
    }
  }

  function activate() {
    activated = true;
    render();
  }

  return { activate };
})();

window.AkumulatorModule = AkumulatorModule;
