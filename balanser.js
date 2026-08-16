/* ============================================================
   Egzebiurko 3.0 — balanser.js
   Zakładka 4: Balanser Odsetek (korekta należności / alokacja zwrotu)
   Logika 1:1 — CSS offline (bez CDN).
   ============================================================ */

'use strict';

const BalanserModule = (() => {
  let activated = false;
  let wired = false;
  let currentMode = 'balance';

  const CSS = `
#balanser-app {
  --bal-bg: #0f172a;
  --bal-card: #1e293b;
  --bal-panel: #334155;
  --bal-border: #475569;
  --bal-text: #f8fafc;
  --bal-muted: #94a3b8;
  --bal-accent: #3b82f6;
  --bal-accent-h: #2563eb;
  --bal-gold: #d4af37;
  --bal-ok: #10b981;
  flex: 1; min-height: 0; overflow: auto;
  background: var(--bal-bg); color: var(--bal-text);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px 16px;
}
#balanser-app * { box-sizing: border-box; }
#balanser-app input::-webkit-outer-spin-button,
#balanser-app input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
#balanser-app .bal-shell {
  width: 100%; max-width: 32rem;
  background: var(--bal-card); border-radius: 16px;
  border: 1px solid #334155; box-shadow: 0 20px 50px rgba(0,0,0,.35);
  overflow: hidden;
}
#balanser-app .bal-head {
  background: rgba(51,65,85,.5); padding: 22px 24px; border-bottom: 1px solid #334155;
}
#balanser-app .bal-head h1 {
  margin: 0; font-size: 1.4rem; font-weight: 700; color: #fff;
  display: flex; align-items: center; gap: 12px;
}
#balanser-app .bal-head p { margin: 6px 0 0; font-size: .875rem; color: var(--bal-muted); }
#balanser-app .bal-modes { padding: 20px 28px 8px; }
#balanser-app .bal-mode-switch {
  display: flex; background: var(--bal-bg); padding: 6px; border-radius: 12px;
  border: 1px solid #334155; gap: 4px;
}
#balanser-app .mode-btn {
  flex: 1; padding: 10px 8px; font-size: .85rem; font-weight: 600;
  border-radius: 8px; border: 1px solid transparent; background: transparent;
  color: var(--bal-muted); cursor: pointer; font-family: inherit; text-align: center;
  transition: all .2s;
}
#balanser-app .mode-btn:hover { color: #fff; }
#balanser-app .mode-btn.active {
  background: var(--bal-accent); color: #fff; border-color: var(--bal-accent);
}
#balanser-app .mode-btn span {
  display: block; font-size: 10px; font-weight: 400; opacity: .7; margin-top: 2px;
}
#balanser-app .bal-body { padding: 16px 28px 28px; display: flex; flex-direction: column; gap: 16px; }
#balanser-app .hidden-section { display: none !important; }
#balanser-app .bal-hint {
  font-size: .75rem; text-align: center; font-style: italic; margin: 0 0 12px; color: var(--bal-gold);
}
#balanser-app .bal-hint.blue { color: #60a5fa; }
#balanser-app .bal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 520px) { #balanser-app .bal-grid { grid-template-columns: 1fr; } }
#balanser-app .bal-field { display: flex; flex-direction: column; gap: 8px; }
#balanser-app .bal-field.full { grid-column: 1 / -1; }
#balanser-app label {
  font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #64748b;
}
#balanser-app label.accent { color: var(--bal-accent); }
#balanser-app label.ok { color: #34d399; }
#balanser-app .input-field {
  width: 100%; background: var(--bal-bg); border: 1px solid #475569; border-radius: 10px;
  padding: 12px 14px; color: #fff; font-size: 1.1rem; font-family: inherit;
}
#balanser-app .input-field::placeholder { color: #475569; }
#balanser-app .input-field:focus {
  outline: none; border-color: var(--bal-accent);
  box-shadow: 0 0 0 2px rgba(59,130,246,.45);
}
#balanser-app .bal-divider {
  position: relative; padding: 14px 0; text-align: center;
}
#balanser-app .bal-divider::before {
  content: ''; position: absolute; left: 0; right: 0; top: 50%;
  border-top: 1px solid #334155;
}
#balanser-app .bal-divider span {
  position: relative; background: var(--bal-card); padding: 0 10px;
  font-size: .7rem; text-transform: uppercase; font-weight: 700; color: #64748b;
}
#balanser-app .bal-box {
  background: rgba(15,23,42,.5); padding: 14px; border-radius: 12px;
  border: 1px solid #334155; display: flex; flex-direction: column; gap: 14px;
}
#balanser-app .bal-alloc-wrap { position: relative; }
#balanser-app .bal-fill-btn {
  position: absolute; right: 8px; top: 8px; bottom: 8px; padding: 0 12px;
  background: rgba(59,130,246,.2); color: var(--bal-accent); border: none;
  border-radius: 6px; font-size: .7rem; font-weight: 700; text-transform: uppercase;
  cursor: pointer; font-family: inherit;
}
#balanser-app .bal-fill-btn:hover { background: rgba(59,130,246,.4); }
#balanser-app .bal-actions { display: flex; gap: 12px; padding-top: 8px; }
#balanser-app .bal-btn-go {
  flex: 1; background: var(--bal-accent); color: #fff; font-weight: 600;
  padding: 12px 20px; border: none; border-radius: 10px; cursor: pointer;
  font-family: inherit; box-shadow: 0 8px 20px rgba(59,130,246,.25);
}
#balanser-app .bal-btn-go:hover { background: var(--bal-accent-h); }
#balanser-app .bal-btn-go:active { transform: scale(.98); }
#balanser-app .bal-btn-clear {
  padding: 12px 20px; border-radius: 10px; border: 1px solid #475569;
  background: transparent; color: var(--bal-muted); cursor: pointer; font-family: inherit;
}
#balanser-app .bal-btn-clear:hover { color: #fff; background: #334155; border-color: #64748b; }
#balanser-app #resultContainer { display: none; margin-top: 8px; }
#balanser-app #resultContainer.show { display: block; animation: balFade .4s ease forwards; }
@keyframes balFade {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
#balanser-app .bal-res-main {
  background: linear-gradient(135deg, #0f172a, #1e293b);
  border: 1px solid #475569; border-radius: 12px; padding: 18px;
  text-align: center; position: relative; overflow: hidden;
}
#balanser-app .bal-res-label {
  color: var(--bal-accent); font-size: .7rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em; margin: 0 0 4px;
}
#balanser-app .bal-res-value {
  font-size: 2rem; font-weight: 700; color: #fff; margin: 8px 0; letter-spacing: -.02em;
}
#balanser-app .bal-res-sum { font-size: .75rem; color: #64748b; margin: 0; }
#balanser-app .bal-res-sum span { color: #cbd5e1; font-family: ui-monospace, monospace; }
#balanser-app .bal-copy {
  position: absolute; top: 10px; right: 10px; padding: 8px; border: none;
  background: transparent; color: #64748b; cursor: pointer; border-radius: 8px;
}
#balanser-app .bal-copy:hover { color: #fff; background: rgba(255,255,255,.1); }
#balanser-app .bal-delta {
  background: rgba(15,23,42,.5); border: 1px solid #334155; border-radius: 10px;
  padding: 12px; text-align: center; margin-top: 10px; font-size: .875rem; color: var(--bal-muted);
}
#balanser-app .bal-alloc-card {
  background: #0f172a; border-radius: 12px; padding: 14px 18px;
  display: flex; align-items: center; justify-content: space-between;
  position: relative; margin-bottom: 10px;
}
#balanser-app .bal-alloc-card.interest { border: 1px solid rgba(59,130,246,.5); }
#balanser-app .bal-alloc-card.refund { border: 1px solid rgba(16,185,129,.5); }
#balanser-app .bal-alloc-card .t { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 2px; }
#balanser-app .bal-alloc-card.interest .t { color: var(--bal-accent); }
#balanser-app .bal-alloc-card.refund .t { color: #10b981; }
#balanser-app .bal-alloc-card .s { font-size: .75rem; color: var(--bal-muted); margin: 0; }
#balanser-app .bal-alloc-card .v { font-size: 1.4rem; font-weight: 700; color: #fff; }
#balanser-app .bal-alloc-card.refund .v { color: #34d399; }
#balanser-app .bal-alloc-card .bal-copy { top: 6px; right: 6px; padding: 6px; }
#balanser-app #errorContainer {
  display: none; margin-top: 8px; background: rgba(127,29,29,.2);
  border: 1px solid rgba(239,68,68,.3); border-radius: 12px; padding: 14px;
}
#balanser-app #errorContainer.show { display: block; animation: balFade .3s ease; }
#balanser-app #errorContainer .title { font-weight: 700; color: #f87171; display: block; margin-bottom: 4px; }
#balanser-app #errorContainer .msg { font-size: .875rem; color: #fecaca; }
#balanser-app .text-orange { color: #fb923c; font-weight: 700; }
#balanser-app .text-emerald { color: #34d399; font-weight: 700; }
`;

  const HTML = `
<div class="bal-shell">
  <div class="bal-head">
    <h1>
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#3b82f6">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
      Balanser Odsetek
    </h1>
    <p>Narzędzie do korekt i alokacji środków.</p>
  </div>

  <div class="bal-modes">
    <div class="bal-mode-switch">
      <button type="button" id="btnModeBalance" class="mode-btn active" data-bal-mode="balance">
        Korekta Należności
        <span>Automatyczny bilans</span>
      </button>
      <button type="button" id="btnModeAllocation" class="mode-btn" data-bal-mode="allocation">
        Rozliczanie Zwrotu
        <span>Manualna alokacja</span>
      </button>
    </div>
  </div>

  <div class="bal-body">
    <div id="formSectionBalance">
      <p class="bal-hint">Zmiana należności głównej powoduje automatyczną korektę odsetek, aby suma roszczenia pozostała stała.</p>
      <div class="bal-grid">
        <div class="bal-field">
          <label for="origPrincipal">Pierwotna Należność</label>
          <input type="text" id="origPrincipal" class="input-field" placeholder="214,22" data-bal-format>
        </div>
        <div class="bal-field">
          <label for="origInterest">Pierwotne Odsetki</label>
          <input type="text" id="origInterest" class="input-field" placeholder="2,00" data-bal-format>
        </div>
      </div>
      <div class="bal-divider"><span>Zmieniam na</span></div>
      <div class="bal-field">
        <label for="targetPrincipal" class="accent">Nowa Należność Główna</label>
        <input type="text" id="targetPrincipal" class="input-field" placeholder="np. 215,00" data-bal-format>
      </div>
    </div>

    <div id="formSectionAllocation" class="hidden-section">
      <p class="bal-hint blue">Rozdziel kwotę zwrotu/nadpłaty pomiędzy dopłatę do odsetek a wolne środki (pozostały zwrot).</p>
      <div class="bal-field" style="margin-bottom:14px">
        <label for="currentInterest">Bieżące Odsetki (Saldo)</label>
        <input type="text" id="currentInterest" class="input-field" placeholder="np. 1,00" data-bal-format>
      </div>
      <div class="bal-box">
        <div class="bal-field">
          <label for="refundAmount" class="ok">Dostępna Kwota Zwrotu</label>
          <input type="text" id="refundAmount" class="input-field" placeholder="np. 1,23" data-bal-format style="border-color:rgba(16,185,129,.3)">
        </div>
        <div class="bal-field">
          <label for="allocateAmount" class="accent">Ile przekazać na odsetki?</label>
          <div class="bal-alloc-wrap">
            <input type="text" id="allocateAmount" class="input-field" placeholder="np. 1,00" data-bal-format style="padding-right:88px;border-color:rgba(59,130,246,.5)">
            <button type="button" class="bal-fill-btn" data-bal="fillMax">Całość</button>
          </div>
        </div>
      </div>
    </div>

    <div class="bal-actions">
      <button type="button" class="bal-btn-go" data-bal="calculate">Przelicz</button>
      <button type="button" class="bal-btn-clear" data-bal="clear">Wyczyść</button>
    </div>

    <div id="resultContainer">
      <div id="resultBalance" class="hidden-section">
        <div class="bal-res-main">
          <p class="bal-res-label">Wyrównane odsetki</p>
          <div class="bal-res-value" id="resBalValue">0,00 zł</div>
          <p class="bal-res-sum">Suma (N+O): <span id="resBalSum">0,00 zł</span></p>
          <button type="button" class="bal-copy" data-bal-copy="resBalValue" title="Kopiuj">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
          </button>
        </div>
        <div class="bal-delta"><p id="resBalDelta">...</p></div>
      </div>

      <div id="resultAllocation" class="hidden-section">
        <div class="bal-alloc-card interest">
          <div>
            <p class="t">Nowe Saldo Odsetek</p>
            <p class="s">Po dodaniu kwoty</p>
          </div>
          <div class="v" id="resAllocInterest">0,00 zł</div>
          <button type="button" class="bal-copy" data-bal-copy="resAllocInterest" title="Kopiuj">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
          </button>
        </div>
        <div class="bal-alloc-card refund">
          <div>
            <p class="t">Pozostały Zwrot</p>
            <p class="s">Do wypłaty/rozliczenia</p>
          </div>
          <div class="v" id="resAllocRefund">0,00 zł</div>
          <button type="button" class="bal-copy" data-bal-copy="resAllocRefund" title="Kopiuj">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
          </button>
        </div>
      </div>
    </div>

    <div id="errorContainer">
      <span class="title">Błąd danych</span>
      <span class="msg" id="errorText">Sprawdź dane.</span>
    </div>
  </div>
</div>
`;

  function setMode(mode) {
    currentMode = mode;
    const btnBal = document.getElementById('btnModeBalance');
    const btnAlloc = document.getElementById('btnModeAllocation');
    const secBal = document.getElementById('formSectionBalance');
    const secAlloc = document.getElementById('formSectionAllocation');
    const resCont = document.getElementById('resultContainer');
    const errCont = document.getElementById('errorContainer');
    if (resCont) resCont.classList.remove('show');
    if (errCont) errCont.classList.remove('show');

    if (mode === 'balance') {
      btnBal.classList.add('active');
      btnAlloc.classList.remove('active');
      secBal.classList.remove('hidden-section');
      secAlloc.classList.add('hidden-section');
    } else {
      btnAlloc.classList.add('active');
      btnBal.classList.remove('active');
      secAlloc.classList.remove('hidden-section');
      secBal.classList.add('hidden-section');
    }
  }

  function fillMaxAllocation() {
    const refundVal = document.getElementById('refundAmount').value;
    if (refundVal) {
      document.getElementById('allocateAmount').value = refundVal;
    }
  }

  function parsePolishNumber(str) {
    if (!str) return 0;
    let cleanStr = str.replace(/[\s\u00A0]/g, '');
    cleanStr = cleanStr.replace(/\./g, '');
    cleanStr = cleanStr.replace(',', '.');
    cleanStr = cleanStr.replace(/[^0-9.-]/g, '');
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
  }

  function formatCurrency(num) {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  }

  function formatInputAsTyping(input) {
    input.value = input.value.replace(/[^0-9,\s.]/g, '');
  }

  function calculate() {
    const resCont = document.getElementById('resultContainer');
    const errCont = document.getElementById('errorContainer');
    resCont.classList.remove('show');
    errCont.classList.remove('show');
    document.getElementById('resultBalance').classList.add('hidden-section');
    document.getElementById('resultAllocation').classList.add('hidden-section');

    try {
      if (currentMode === 'balance') calculateBalance();
      else calculateAllocation();
      resCont.classList.add('show');
    } catch (e) {
      document.getElementById('errorText').innerText = e.message;
      errCont.classList.add('show');
    }
  }

  function calculateBalance() {
    const origPrincipalStr = document.getElementById('origPrincipal').value;
    const origInterestStr = document.getElementById('origInterest').value;
    const targetPrincipalStr = document.getElementById('targetPrincipal').value;

    if (!origPrincipalStr || !targetPrincipalStr) throw new Error('Uzupełnij kwoty należności.');

    const op = parsePolishNumber(origPrincipalStr);
    const oi = parsePolishNumber(origInterestStr);
    const tp = parsePolishNumber(targetPrincipalStr);

    const totalSum = op + oi;
    const newInterest = totalSum - tp;

    if (newInterest < 0) throw new Error('Nowa należność główna przekracza sumę roszczenia.');

    const diff = newInterest - oi;
    const diffFormatted = formatCurrency(Math.abs(diff));
    let explanation = '';

    if (diff < -0.009) {
      explanation = `Zwiększono kapitał, więc <span class="text-orange">zabrano ${diffFormatted}</span> z odsetek.`;
    } else if (diff > 0.009) {
      explanation = `Zmniejszono kapitał, więc <span class="text-emerald">dodano ${diffFormatted}</span> do odsetek.`;
    } else {
      explanation = 'Brak zmian w saldzie.';
    }

    document.getElementById('resBalValue').innerText = formatCurrency(newInterest);
    document.getElementById('resBalSum').innerText = formatCurrency(totalSum);
    document.getElementById('resBalDelta').innerHTML = explanation;
    document.getElementById('resultBalance').classList.remove('hidden-section');
  }

  function calculateAllocation() {
    const curIntStr = document.getElementById('currentInterest').value;
    const refundStr = document.getElementById('refundAmount').value;
    const allocStr = document.getElementById('allocateAmount').value;

    if (!curIntStr || !refundStr || !allocStr) throw new Error('Uzupełnij wszystkie pola alokacji.');

    const curInt = parsePolishNumber(curIntStr);
    const refund = parsePolishNumber(refundStr);
    const alloc = parsePolishNumber(allocStr);

    if (alloc > refund) throw new Error('Kwota przekazana na odsetki nie może być wyższa niż dostępny zwrot.');
    if (alloc < 0) throw new Error('Kwota alokacji nie może być ujemna.');

    const newTotalInterest = curInt + alloc;
    const remainingRefund = refund - alloc;

    document.getElementById('resAllocInterest').innerText = formatCurrency(newTotalInterest);
    document.getElementById('resAllocRefund').innerText = formatCurrency(remainingRefund);
    document.getElementById('resultAllocation').classList.remove('hidden-section');
  }

  function clearForm() {
    const root = document.getElementById('balanser-app');
    if (!root) return;
    root.querySelectorAll('input').forEach(i => { i.value = ''; });
    document.getElementById('resultContainer').classList.remove('show');
    document.getElementById('errorContainer').classList.remove('show');
  }

  function copyText(elementId, btn) {
    const text = document.getElementById(elementId).innerText;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => blinkBtn(btn));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      blinkBtn(btn);
    }
  }

  function blinkBtn(btn) {
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="#34d399"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`;
    setTimeout(() => { btn.innerHTML = originalHTML; }, 1000);
  }

  function ensureCss() {
    if (document.getElementById('balanser-css')) return;
    const style = document.createElement('style');
    style.id = 'balanser-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function wireEvents(root) {
    if (wired) return;
    wired = true;

    root.addEventListener('click', (e) => {
      const modeBtn = e.target.closest('[data-bal-mode]');
      if (modeBtn) { setMode(modeBtn.getAttribute('data-bal-mode')); return; }
      const act = e.target.closest('[data-bal]');
      if (act) {
        const a = act.getAttribute('data-bal');
        if (a === 'calculate') calculate();
        else if (a === 'clear') clearForm();
        else if (a === 'fillMax') fillMaxAllocation();
        return;
      }
      const copyBtn = e.target.closest('[data-bal-copy]');
      if (copyBtn) copyText(copyBtn.getAttribute('data-bal-copy'), copyBtn);
    });

    root.querySelectorAll('[data-bal-format]').forEach(input => {
      input.addEventListener('input', () => formatInputAsTyping(input));
    });

    root.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') calculate();
    });
  }

  function render() {
    ensureCss();
    const root = document.getElementById('balanser-app');
    if (!root) return;
    if (!root.dataset.ready) {
      root.innerHTML = HTML;
      root.dataset.ready = '1';
      wireEvents(root);
      setMode('balance');
    }
  }

  function activate() {
    activated = true;
    render();
  }

  return { activate };
})();

window.BalanserModule = BalanserModule;
