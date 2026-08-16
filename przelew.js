/* ============================================================
   Egzebiurko 3.0 — przelew.js
   Zakładka 3: Generator Druku Przelewu
   Logika przeniesiona 1:1 — wpleciona w shell (print-mode na root).
   ============================================================ */

'use strict';

const PrzelewModule = (() => {
  let activated = false;
  let wired = false;

  const fixedAccount = '57 1010 1270 0009 2513 9120 0000';

  const CSS = `
#przelew-app {
  --prw-panel: 340px;
  flex: 1; min-height: 0; overflow: hidden;
  font-family: var(--tool-ui, "Source Sans 3", system-ui, sans-serif);
  background: transparent;
  color: var(--tool-ink, #1a2332);
  display: flex;
}
#przelew-app * { box-sizing: border-box; }
#przelew-app .app-container {
  display: flex; width: 100%; height: 100%; min-height: 0;
}
#przelew-app .controls-panel {
  width: var(--prw-panel); flex-shrink: 0;
  background: var(--tool-cream, #faf6f0); padding: 18px 18px 20px;
  border-right: 1px solid var(--tool-edge, #d4c4b0); overflow-y: auto;
  display: flex; flex-direction: column; gap: 14px;
  box-shadow: 4px 0 18px rgba(26,35,50,.06); z-index: 10;
}
#przelew-app .controls-panel h2 {
  margin: 0; font-size: 1.25rem; font-family: var(--tool-display, Georgia, serif);
  font-weight: 700; letter-spacing: -.02em;
  border-bottom: 1px solid var(--tool-edge, #d4c4b0); padding-bottom: 10px;
  color: var(--tool-ink, #1a2332);
}
#przelew-app .form-group { display: flex; flex-direction: column; gap: 5px; }
#przelew-app .form-group label {
  font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  color: var(--tool-ink-soft, #3d4a5c);
}
#przelew-app .form-group input {
  padding: 9px 11px; border: 1px solid var(--tool-edge, #d4c4b0); border-radius: 8px;
  font: inherit; color: var(--tool-ink, #1a2332); background: color-mix(in srgb, var(--tool-cream, #faf6f0) 90%, #fff);
}
#przelew-app .form-group input:focus {
  outline: none; border-color: var(--tool-spine, #8b3a3a);
  box-shadow: 0 0 0 3px rgba(139,58,58,.14);
}
#przelew-app .print-options {
  border: 1px solid var(--tool-edge, #d4c4b0); padding: 12px; border-radius: 10px;
  background: color-mix(in srgb, var(--tool-paper, #f3ebe0) 70%, var(--tool-cream, #faf6f0));
}
#przelew-app .print-options > strong,
#przelew-app .print-options > b,
#przelew-app .print-options > div:first-child {
  font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  color: var(--tool-ink-soft, #3d4a5c);
}
#przelew-app .radio-group { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
#przelew-app .radio-group label {
  display: flex; align-items: center; gap: 8px; font-weight: 550; cursor: pointer;
  color: var(--tool-ink, #1a2332); text-transform: none; letter-spacing: 0; font-size: .88rem;
}
#przelew-app button.print-btn {
  background: var(--tool-spine, #8b3a3a); color: #faf6f0; border: none; padding: 12px;
  font-size: .95rem; font-weight: 700; cursor: pointer; margin-top: auto; border-radius: 10px;
  font-family: inherit; box-shadow: 0 6px 16px rgba(139,58,58,.2);
}
#przelew-app button.print-btn:hover { background: var(--tool-spine-active, #6e2e2e); }
#przelew-app .preview-panel {
  flex: 1; min-width: 0; padding: 28px; overflow: auto;
  display: flex; flex-direction: column; align-items: center;
  background:
    radial-gradient(ellipse 80% 50% at 50% 20%, rgba(139,58,58,.06), transparent 60%),
    color-mix(in srgb, var(--tool-paper2, #ebe1d4) 55%, var(--tool-paper, #f3ebe0));
}
#przelew-app .paper-sheet {
  background: #fff; width: 210mm; min-height: 297mm; padding: 10mm;
  box-shadow: 0 12px 36px rgba(26,35,50,.18); position: relative;
  display: flex; flex-direction: column;
  border: 1px solid var(--tool-edge, #d4c4b0); border-radius: 2px;
}
#przelew-app .transfer-form {
  width: 100%; height: 99mm; border: 2px solid #000;
  display: flex; flex-direction: column; margin-bottom: 5mm;
  font-size: 10pt; position: relative; background: #fff; color: #000;
}
#przelew-app .tf-label {
  font-size: 7pt; color: #000; text-transform: uppercase; margin-bottom: 2px; display: block;
}
#przelew-app .tf-value {
  font-family: 'Courier New', monospace; font-weight: bold; font-size: 11pt;
  min-height: 1.2em; word-break: break-all; color: #000;
}
#przelew-app .amount-container { display: flex; align-items: center; height: 100%; }
#przelew-app .currency-label { font-size: 10pt; margin-right: 10px; font-weight: bold; }
#przelew-app .amount-box-pln {
  border: 1px solid #000; height: 24px; min-width: 80px; flex: 1;
  display: flex; align-items: center; justify-content: flex-end; padding-right: 5px;
  font-weight: bold; font-family: monospace; font-size: 12pt;
}
#przelew-app .amount-sep { margin: 0 5px; font-weight: bold; }
#przelew-app .amount-box-gr {
  border: 1px solid #000; height: 24px; width: 30px;
  display: flex; align-items: center; justify-content: center;
  font-weight: bold; font-family: monospace; font-size: 12pt;
}
#przelew-app .account-boxes { display: flex; gap: 2px; margin-top: 5px; flex-wrap: wrap; }
#przelew-app .ac-box {
  width: 16px; height: 24px; border: 1px solid #000;
  display: flex; align-items: center; justify-content: center;
  font-size: 11pt; font-weight: bold; font-family: monospace;
}
#przelew-app .ac-spacer { width: 5px; }
#przelew-app .form-footer {
  height: 6mm; border-top: 1px solid #000; display: flex; align-items: center;
  justify-content: flex-end; padding-right: 10px; font-size: 8pt; font-style: italic;
}
#przelew-app .schema-section {
  display: flex; flex-direction: column; justify-content: center; height: 100%; color: #000;
}
#przelew-app .schema-container {
  font-family: 'Times New Roman', serif; padding: 20px 40px; text-align: center; width: 100%;
}
#przelew-app .schema-header {
  font-weight: bold; text-transform: uppercase; font-size: 14pt; margin-bottom: 30px; line-height: 1.4;
}
#przelew-app .schema-list {
  display: inline-block; text-align: left; width: 100%; max-width: 600px; margin: 0 auto;
}
#przelew-app .schema-item { margin-bottom: 15px; font-size: 12pt; display: flex; gap: 8px; flex-wrap: wrap; }
#przelew-app .schema-label { font-weight: bold; min-width: 150px; }
#przelew-app .page-break { display: none; height: 0; margin: 0; border: none; }

@media (max-width: 900px) {
  #przelew-app { flex-direction: column; overflow: auto; }
  #przelew-app .app-container { flex-direction: column; height: auto; }
  #przelew-app .controls-panel { width: 100%; max-height: 40vh; }
  #przelew-app .preview-panel { padding: 16px; }
  #przelew-app .paper-sheet { width: 100%; min-height: auto; transform: scale(.85); transform-origin: top center; }
}

@media print {
  @page { size: auto; margin: 0mm; }

  body * { visibility: hidden !important; }
  #panel-zakladka3,
  #panel-zakladka3 *,
  #przelew-app,
  #przelew-app * { visibility: visible !important; }

  .shell, .chrome, .nav, .global-status, .content-area {
    display: block !important; position: static !important;
    width: auto !important; height: auto !important; overflow: visible !important;
    background: #fff !important; border: none !important; box-shadow: none !important;
    margin: 0 !important; padding: 0 !important;
  }
  .module-panel { display: none !important; }
  #panel-zakladka3 {
    display: block !important; position: absolute !important; left: 0; top: 0;
    width: 100% !important; height: auto !important; overflow: visible !important;
    background: #fff !important;
  }
  #przelew-app {
    display: block !important; overflow: visible !important; background: #fff !important;
    position: static !important; width: 100% !important; height: auto !important;
  }
  #przelew-app .controls-panel { display: none !important; }
  #przelew-app .app-container { display: block !important; height: auto !important; }
  #przelew-app .preview-panel {
    padding: 0 !important; margin: 0 !important; background: #fff !important;
    overflow: visible !important; display: block !important; width: 100% !important; height: auto !important;
  }
  #przelew-app .paper-sheet {
    box-shadow: none !important; width: 100% !important; max-width: 210mm;
    min-height: 100vh; padding: 0 !important; margin: 0 auto !important;
    display: flex; flex-direction: column;
  }

  #przelew-app.print-mode-transfer .paper-sheet {
    justify-content: center; align-items: center;
  }
  #przelew-app.print-mode-transfer .schema-section,
  #przelew-app.print-mode-transfer .page-break { display: none !important; }
  #przelew-app.print-mode-transfer .transfer-section { width: 100%; padding: 10mm; }

  #przelew-app.print-mode-schema .paper-sheet {
    justify-content: center; align-items: center;
  }
  #przelew-app.print-mode-schema .transfer-section,
  #przelew-app.print-mode-schema .page-break { display: none !important; }
  #przelew-app.print-mode-schema .schema-section { width: 100%; padding: 20mm; }

  #przelew-app.print-mode-complete .paper-sheet {
    display: block !important; padding: 15mm !important;
  }
  #przelew-app.print-mode-complete .transfer-section { margin-bottom: 0; }
  #przelew-app.print-mode-complete .page-break {
    display: block !important; page-break-after: always; height: 1px; margin: 20px 0;
  }
  #przelew-app.print-mode-complete .schema-section {
    display: block !important; margin-top: 20mm;
  }
}
`;

  const HTML = `
<div class="app-container">
  <div class="controls-panel">
    <h2>Druk przelewu</h2>
    <div class="form-group">
      <label>Kwota (PLN)</label>
      <input type="number" step="0.01" id="inputAmount" placeholder="0.00">
    </div>
    <div class="form-group">
      <label>Imię</label>
      <input type="text" id="inputName" placeholder="Jan">
    </div>
    <div class="form-group">
      <label>Nazwisko</label>
      <input type="text" id="inputSurname" placeholder="Kowalski">
    </div>
    <div class="form-group">
      <label>PESEL</label>
      <input type="text" id="inputPesel" placeholder="00000000000">
    </div>
    <div class="form-group">
      <label>Nr sprawy (opcjonalne)</label>
      <input type="text" id="inputCaseNo" placeholder="np. 123/2023">
    </div>
    <div class="print-options">
      <label style="font-weight:700;display:block;margin-bottom:10px;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--tool-ink-soft)">Tryb wydruku</label>
      <div class="radio-group">
        <label><input type="radio" name="printMode" value="transfer" checked> Tylko Przelew (Środek strony)</label>
        <label><input type="radio" name="printMode" value="schema"> Tylko Schemat Tekstowy (Środek strony)</label>
        <label><input type="radio" name="printMode" value="complete"> Komplet (2 strony)</label>
      </div>
    </div>
    <button type="button" class="print-btn" id="prwPrintBtn">Drukuj</button>
  </div>

  <div class="preview-panel">
    <div class="paper-sheet">
      <div id="transferSection" class="transfer-section">
        <div class="transfer-form">
          <div style="display:flex;height:18mm;border-bottom:1px solid black">
            <div style="flex:3;border-right:1px solid black;padding:4px">
              <span class="tf-label">Nazwa odbiorcy</span>
              <div class="tf-value">DRUGI URZĄD SKARBOWY KRAKÓW</div>
            </div>
            <div style="flex:1;padding:4px">
              <span class="tf-label">Kwota</span>
              <div class="amount-container">
                <span class="currency-label">PLN</span>
                <div class="amount-box-pln val-amount-pln"></div>
                <span class="amount-sep">,</span>
                <div class="amount-box-gr val-amount-gr"></div>
              </div>
            </div>
          </div>
          <div style="height:14mm;border-bottom:1px solid black;padding:4px">
            <span class="tf-label">Nr rachunku odbiorcy</span>
            <div class="account-boxes" id="bankAcBoxes1"></div>
          </div>
          <div style="height:12mm;border-bottom:1px solid black;padding:4px">
            <span class="tf-label">Kwota słownie</span>
            <div class="tf-value val-amount-words"></div>
          </div>
          <div style="height:18mm;border-bottom:1px solid black;padding:4px">
            <span class="tf-label">Nazwa zleceniodawcy</span>
            <div class="tf-value val-sender-name"></div>
            <div class="tf-value val-sender-address"></div>
          </div>
          <div style="flex:1;padding:4px;border-bottom:1px solid black">
            <span class="tf-label">Tytułem</span>
            <div class="tf-value val-title-1"></div>
          </div>
          <div class="form-footer">Odcinek dla Banku</div>
          <div style="position:absolute;top:5px;right:5px;font-weight:bold;font-size:8pt">POLECENIE PRZELEWU</div>
        </div>

        <div class="transfer-form">
          <div style="display:flex;height:18mm;border-bottom:1px solid black">
            <div style="flex:3;border-right:1px solid black;padding:4px">
              <span class="tf-label">Nazwa odbiorcy</span>
              <div class="tf-value">DRUGI URZĄD SKARBOWY KRAKÓW</div>
            </div>
            <div style="flex:1;padding:4px">
              <span class="tf-label">Kwota</span>
              <div class="amount-container">
                <span class="currency-label">PLN</span>
                <div class="amount-box-pln val-amount-pln"></div>
                <span class="amount-sep">,</span>
                <div class="amount-box-gr val-amount-gr"></div>
              </div>
            </div>
          </div>
          <div style="height:14mm;border-bottom:1px solid black;padding:4px">
            <span class="tf-label">Nr rachunku odbiorcy</span>
            <div class="account-boxes" id="bankAcBoxes2"></div>
          </div>
          <div style="height:12mm;border-bottom:1px solid black;padding:4px">
            <span class="tf-label">Kwota słownie</span>
            <div class="tf-value val-amount-words"></div>
          </div>
          <div style="height:18mm;border-bottom:1px solid black;padding:4px">
            <span class="tf-label">Nazwa zleceniodawcy</span>
            <div class="tf-value val-sender-name"></div>
          </div>
          <div style="flex:1;padding:4px;border-bottom:1px solid black">
            <span class="tf-label">Tytułem</span>
            <div class="tf-value val-title-1"></div>
          </div>
          <div class="form-footer">Odcinek dla Zleceniodawcy</div>
          <div style="position:absolute;top:5px;right:5px;font-weight:bold;font-size:8pt">POLECENIE PRZELEWU</div>
        </div>
      </div>

      <div class="page-break"></div>

      <div id="schemaSection" class="schema-section">
        <div class="schema-container">
          <div class="schema-header">
            KONTO DZIAŁU EGZEKUCJI – DRUGIEGO URZĘDU SKARBOWEGO KRAKÓW<br>
            PRZELEW:
          </div>
          <div class="schema-list">
            <div class="schema-item">
              <span class="schema-label">1. ODBIORCA:</span> <span>DRUGI URZĄD SKARBOWY KRAKÓW</span>
            </div>
            <div class="schema-item">
              <span class="schema-label">2. KONTO:</span> <span>NBP O/O KRAKÓW NR 57 1010 1270 0009 2513 9120 0000</span>
            </div>
            <div class="schema-item">
              <span class="schema-label">3. KWOTA:</span> <span><span class="val-full-amount">0,00</span> PLN</span>
            </div>
            <div class="schema-item">
              <span class="schema-label">4. OPIS PRZELEWU:</span> <span class="val-title-full">[Brak danych]</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
`;

  function rootEl() {
    return document.getElementById('przelew-app');
  }

  function generateAccountBoxes(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const cleanAc = fixedAccount.replace(/\s+/g, '');
    container.innerHTML = '';
    for (let i = 0; i < cleanAc.length; i++) {
      const div = document.createElement('div');
      div.className = 'ac-box';
      div.textContent = cleanAc[i];
      container.appendChild(div);
      if (i === 1 || (i > 1 && (i - 1) % 4 === 0 && i < cleanAc.length - 1)) {
        const spacer = document.createElement('div');
        spacer.className = 'ac-spacer';
        container.appendChild(spacer);
      }
    }
  }

  function amountToWords(n) {
    if (n === 0) return 'zero złotych';

    const units = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
    const teens = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
    const tens = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
    const hundreds = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
    const gNames = [
      ['złoty', 'złote', 'złotych'],
      ['tysiąc', 'tysiące', 'tysięcy'],
      ['milion', 'miliony', 'milionów'],
      ['miliard', 'miliardy', 'miliardów']
    ];

    let result = '';
    let part = Math.floor(n / 1000000000);
    if (part > 0) { result += convertGroup(part) + ' ' + getForm(part, gNames[3]) + ' '; n %= 1000000000; }
    part = Math.floor(n / 1000000);
    if (part > 0) { result += convertGroup(part) + ' ' + getForm(part, gNames[2]) + ' '; n %= 1000000; }
    part = Math.floor(n / 1000);
    if (part > 0) { result += convertGroup(part) + ' ' + getForm(part, gNames[1]) + ' '; n %= 1000; }
    part = n;
    if (part > 0) { result += convertGroup(part) + ' ' + getForm(part, gNames[0]); }
    else if (result !== '') { result += 'złotych'; }

    return result.trim();

    function convertGroup(val) {
      let t = '';
      const h = Math.floor(val / 100);
      const d = Math.floor((val % 100) / 10);
      const u = val % 10;
      if (h > 0) t += hundreds[h] + ' ';
      if (d === 1) t += teens[u] + ' ';
      else {
        if (d > 0) t += tens[d] + ' ';
        if (u > 0) t += units[u] + ' ';
      }
      return t.trim();
    }
    function getForm(val, forms) {
      if (val === 1) return forms[0];
      const mod10 = val % 10;
      const mod100 = val % 100;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
      return forms[2];
    }
  }

  function updateData() {
    const root = rootEl();
    if (!root) return;
    const inputs = {
      amount: document.getElementById('inputAmount'),
      name: document.getElementById('inputName'),
      surname: document.getElementById('inputSurname'),
      pesel: document.getElementById('inputPesel'),
      caseNo: document.getElementById('inputCaseNo')
    };
    if (!inputs.amount) return;

    const amountVal = parseFloat(inputs.amount.value) || 0;
    const nameVal = inputs.name.value.trim();
    const surnameVal = inputs.surname.value.trim();
    const peselVal = inputs.pesel.value.trim();
    const caseNoVal = inputs.caseNo.value.trim();

    const amountStr = amountVal.toFixed(2);
    const [pln, gr] = amountStr.split('.');

    root.querySelectorAll('.val-amount-pln').forEach(el => { el.textContent = pln; });
    root.querySelectorAll('.val-amount-gr').forEach(el => { el.textContent = gr; });
    const fullAmt = root.querySelector('.val-full-amount');
    if (fullAmt) fullAmt.textContent = amountStr.replace('.', ',');

    const words = amountToWords(Math.floor(amountVal));
    const wordsFull = words + ` ${gr}/100`;
    root.querySelectorAll('.val-amount-words').forEach(el => { el.textContent = wordsFull; });

    const fullName = `${nameVal} ${surnameVal}`.trim();
    root.querySelectorAll('.val-sender-name').forEach(el => { el.textContent = fullName; });

    let title = `${nameVal} ${surnameVal} ${peselVal}`.trim();
    if (caseNoVal) title += ` Nr sprawy ${caseNoVal}`;

    root.querySelectorAll('.val-title-1').forEach(el => { el.textContent = title; });
    const titleFull = root.querySelector('.val-title-full');
    if (titleFull) titleFull.textContent = title || '[Brak danych]';
  }

  function updatePrintMode() {
    const root = rootEl();
    if (!root) return;
    const modeRadios = root.querySelectorAll('input[name="printMode"]');
    let selected = 'transfer';
    modeRadios.forEach(radio => { if (radio.checked) selected = radio.value; });
    root.classList.remove('print-mode-transfer', 'print-mode-schema', 'print-mode-complete');
    root.classList.add('print-mode-' + selected);
  }

  function ensureCss() {
    if (document.getElementById('przelew-css')) return;
    const style = document.createElement('style');
    style.id = 'przelew-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function wireEvents(root) {
    if (wired) return;
    wired = true;

    const inputs = [
      document.getElementById('inputAmount'),
      document.getElementById('inputName'),
      document.getElementById('inputSurname'),
      document.getElementById('inputPesel'),
      document.getElementById('inputCaseNo')
    ];
    inputs.forEach(input => {
      if (input) input.addEventListener('input', updateData);
    });

    root.querySelectorAll('input[name="printMode"]').forEach(r => {
      r.addEventListener('change', updatePrintMode);
    });

    const printBtn = document.getElementById('prwPrintBtn');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        updatePrintMode();
        window.print();
      });
    }
  }

  function render() {
    ensureCss();
    const root = rootEl();
    if (!root) return;
    if (!root.dataset.ready) {
      root.innerHTML = HTML;
      root.dataset.ready = '1';
      root.classList.add('print-mode-transfer');
      generateAccountBoxes('bankAcBoxes1');
      generateAccountBoxes('bankAcBoxes2');
      wireEvents(root);
      updateData();
      updatePrintMode();
    }
  }

  function activate(params) {
    activated = true;
    render();
    // Opcjonalne wstępne dane z innych modułów (nie zmienia logiki — tylko uzupełnia pola)
    if (params && rootEl() && rootEl().dataset.ready) {
      if (params.pesel) {
        const el = document.getElementById('inputPesel');
        if (el && !el.value) el.value = params.pesel;
      }
      if (params.name) {
        const parts = String(params.name).trim().split(/\s+/);
        const nameEl = document.getElementById('inputName');
        const surEl = document.getElementById('inputSurname');
        if (parts.length >= 2) {
          if (nameEl && !nameEl.value) nameEl.value = parts.slice(0, -1).join(' ');
          if (surEl && !surEl.value) surEl.value = parts[parts.length - 1];
        } else if (surEl && !surEl.value) {
          surEl.value = parts[0] || '';
        }
      }
      if (params.amount != null) {
        const el = document.getElementById('inputAmount');
        if (el && !el.value) el.value = params.amount;
      }
      updateData();
    }
  }

  return { activate };
})();

window.PrzelewModule = PrzelewModule;
