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
  flex: 1; min-height: 0; overflow: auto;
  background: transparent; color: var(--tool-ink, #1a2332);
  font-family: var(--tool-ui, "Source Sans 3", system-ui, sans-serif);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px 16px;
}
#balanser-app * { box-sizing: border-box; }
#balanser-app input::-webkit-outer-spin-button,
#balanser-app input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
#balanser-app .bal-shell {
  width: 100%; max-width: 32rem;
  background: var(--tool-cream, #faf6f0); border-radius: 16px;
  border: 1px solid var(--tool-edge, #d4c4b0);
  box-shadow: 0 14px 36px rgba(26,35,50,.1);
  overflow: hidden;
}
#balanser-app .bal-head {
  background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 70%, var(--tool-cream, #faf6f0));
  padding: 20px 24px; border-bottom: 1px solid var(--tool-edge, #d4c4b0);
}
#balanser-app .bal-head h1 {
  margin: 0; font-size: 1.4rem; font-weight: 700; color: var(--tool-ink, #1a2332);
  font-family: var(--tool-display, Georgia, serif); letter-spacing: -.02em;
  display: flex; align-items: center; gap: 12px;
}
#balanser-app .bal-head h1 svg { stroke: var(--tool-spine, #8b3a3a); }
#balanser-app .bal-head p { margin: 6px 0 0; font-size: .875rem; color: var(--tool-ink-soft, #3d4a5c); }
#balanser-app .bal-modes { padding: 18px 24px 8px; }
#balanser-app .bal-mode-switch {
  display: flex; background: color-mix(in srgb, var(--tool-paper, #f3ebe0) 80%, transparent);
  padding: 5px; border-radius: 12px; border: 1px solid var(--tool-edge, #d4c4b0); gap: 4px;
}
#balanser-app .mode-btn {
  flex: 1; padding: 10px 8px; font-size: .82rem; font-weight: 650;
  border-radius: 8px; border: 1px solid transparent; background: transparent;
  color: var(--tool-ink-soft, #3d4a5c); cursor: pointer; font-family: inherit; text-align: center;
  transition: all .15s;
}
#balanser-app .mode-btn:hover { color: var(--tool-ink, #1a2332); }
#balanser-app .mode-btn.active {
  background: var(--tool-spine, #8b3a3a); color: #faf6f0; border-color: var(--tool-spine, #8b3a3a);
}
#balanser-app .mode-btn span {
  display: block; font-size: 10px; font-weight: 400; opacity: .75; margin-top: 2px;
}
#balanser-app .bal-body { padding: 14px 24px 24px; display: flex; flex-direction: column; gap: 14px; }
#balanser-app .hidden-section { display: none !important; }
#balanser-app .bal-hint {
  font-size: .78rem; text-align: center; font-style: italic; margin: 0 0 12px;
  color: var(--tool-warn, #9a6b2f);
}
#balanser-app .bal-hint.blue { color: var(--tool-spine, #8b3a3a); }
#balanser-app .bal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 520px) { #balanser-app .bal-grid { grid-template-columns: 1fr; } }
#balanser-app .bal-field { display: flex; flex-direction: column; gap: 8px; }
#balanser-app .bal-field.full { grid-column: 1 / -1; }
#balanser-app label {
  font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
  color: var(--tool-ink-soft, #3d4a5c);
}
#balanser-app label.accent { color: var(--tool-spine, #8b3a3a); }
#balanser-app label.ok { color: var(--tool-olive, #5c6b3a); }
#balanser-app .input-field {
  width: 100%; background: color-mix(in srgb, var(--tool-cream, #faf6f0) 90%, #fff);
  border: 1px solid var(--tool-edge, #d4c4b0); border-radius: 10px;
  padding: 12px 14px; color: var(--tool-ink, #1a2332); font-size: 1.1rem; font-family: inherit;
}
#balanser-app .input-field::placeholder { color: color-mix(in srgb, var(--tool-ink-soft, #3d4a5c) 55%, transparent); }
#balanser-app .input-field:focus {
  outline: none; border-color: var(--tool-spine, #8b3a3a);
  box-shadow: 0 0 0 3px rgba(139,58,58,.14);
}
#balanser-app .bal-divider { position: relative; padding: 14px 0; text-align: center; }
#balanser-app .bal-divider::before {
  content: ''; position: absolute; left: 0; right: 0; top: 50%;
  border-top: 1px solid var(--tool-edge, #d4c4b0);
}
#balanser-app .bal-divider span {
  position: relative; background: var(--tool-cream, #faf6f0); padding: 0 10px;
  font-size: .68rem; text-transform: uppercase; font-weight: 700; letter-spacing: .06em;
  color: var(--tool-ink-soft, #3d4a5c);
}
#balanser-app .bal-box {
  background: color-mix(in srgb, var(--tool-paper, #f3ebe0) 65%, var(--tool-cream, #faf6f0));
  padding: 14px; border-radius: 12px; border: 1px solid var(--tool-edge, #d4c4b0);
  display: flex; flex-direction: column; gap: 14px;
}
#balanser-app .bal-alloc-wrap { position: relative; }
#balanser-app .bal-fill-btn {
  position: absolute; right: 8px; top: 8px; bottom: 8px; padding: 0 12px;
  background: color-mix(in srgb, var(--tool-spine, #8b3a3a) 12%, transparent);
  color: var(--tool-spine, #8b3a3a); border: none; border-radius: 6px;
  font-size: .7rem; font-weight: 700; text-transform: uppercase; cursor: pointer; font-family: inherit;
}
#balanser-app .bal-fill-btn:hover { background: color-mix(in srgb, var(--tool-spine, #8b3a3a) 22%, transparent); }
#balanser-app .bal-actions { display: flex; gap: 12px; padding-top: 6px; }
#balanser-app .bal-btn-go {
  flex: 1; background: var(--tool-spine, #8b3a3a); color: #faf6f0; font-weight: 650;
  padding: 12px 20px; border: none; border-radius: 10px; cursor: pointer;
  font-family: inherit; box-shadow: 0 8px 18px rgba(139,58,58,.22);
}
#balanser-app .bal-btn-go:hover { background: var(--tool-spine-active, #6e2e2e); }
#balanser-app .bal-btn-go:active { transform: scale(.98); }
#balanser-app .bal-btn-clear {
  padding: 12px 20px; border-radius: 10px; border: 1px solid var(--tool-edge, #d4c4b0);
  background: transparent; color: var(--tool-ink-soft, #3d4a5c); cursor: pointer; font-family: inherit;
}
#balanser-app .bal-btn-clear:hover {
  color: var(--tool-ink, #1a2332); background: #fff; border-color: var(--tool-spine, #8b3a3a);
}
#balanser-app #resultContainer { display: none; margin-top: 6px; }
#balanser-app #resultContainer.show { display: block; animation: balFade .4s ease forwards; }
@keyframes balFade {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
#balanser-app .bal-res-main {
  background: color-mix(in srgb, var(--tool-paper2, #ebe1d4) 55%, var(--tool-cream, #faf6f0));
  border: 1px solid var(--tool-edge, #d4c4b0); border-radius: 12px; padding: 18px;
  text-align: center; position: relative; overflow: hidden;
}
#balanser-app .bal-res-label {
  color: var(--tool-spine, #8b3a3a); font-size: .68rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em; margin: 0 0 4px;
}
#balanser-app .bal-res-value {
  font-size: 2rem; font-weight: 700; color: var(--tool-ink, #1a2332); margin: 8px 0;
  font-family: var(--tool-display, Georgia, serif); letter-spacing: -.02em;
}
#balanser-app .bal-res-sum { font-size: .75rem; color: var(--tool-ink-soft, #3d4a5c); margin: 0; }
#balanser-app .bal-res-sum span { color: var(--tool-ink, #1a2332); font-family: ui-monospace, monospace; }
#balanser-app .bal-copy {
  position: absolute; top: 10px; right: 10px; padding: 8px; border: none;
  background: transparent; color: var(--tool-ink-soft, #3d4a5c); cursor: pointer; border-radius: 8px;
}
#balanser-app .bal-copy:hover { color: var(--tool-spine, #8b3a3a); background: rgba(139,58,58,.1); }
#balanser-app .bal-delta {
  background: color-mix(in srgb, var(--tool-paper, #f3ebe0) 70%, transparent);
  border: 1px solid var(--tool-edge, #d4c4b0); border-radius: 10px;
  padding: 12px; text-align: center; margin-top: 10px; font-size: .875rem;
  color: var(--tool-ink-soft, #3d4a5c);
}
#balanser-app .bal-alloc-card {
  background: var(--tool-cream, #faf6f0); border-radius: 12px; padding: 14px 18px;
  display: flex; align-items: center; justify-content: space-between;
  position: relative; margin-bottom: 10px; border: 1px solid var(--tool-edge, #d4c4b0);
}
#balanser-app .bal-alloc-card.interest { border-color: color-mix(in srgb, var(--tool-spine, #8b3a3a) 45%, var(--tool-edge, #d4c4b0)); }
#balanser-app .bal-alloc-card.refund { border-color: color-mix(in srgb, var(--tool-olive, #5c6b3a) 45%, var(--tool-edge, #d4c4b0)); }
#balanser-app .bal-alloc-card .t { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 2px; }
#balanser-app .bal-alloc-card.interest .t { color: var(--tool-spine, #8b3a3a); }
#balanser-app .bal-alloc-card.refund .t { color: var(--tool-olive, #5c6b3a); }
#balanser-app .bal-alloc-card .s { font-size: .75rem; color: var(--tool-ink-soft, #3d4a5c); margin: 0; }
#balanser-app .bal-alloc-card .v {
  font-size: 1.4rem; font-weight: 700; color: var(--tool-ink, #1a2332);
  font-family: var(--tool-display, Georgia, serif);
}
#balanser-app .bal-alloc-card.refund .v { color: var(--tool-olive, #5c6b3a); }
#balanser-app .bal-alloc-card .bal-copy { top: 6px; right: 6px; padding: 6px; }
#balanser-app #errorContainer {
  display: none; margin-top: 8px;
  background: color-mix(in srgb, var(--tool-err, #8b3a3a) 10%, var(--tool-cream, #faf6f0));
  border: 1px solid color-mix(in srgb, var(--tool-err, #8b3a3a) 35%, var(--tool-edge, #d4c4b0));
  border-radius: 12px; padding: 14px;
}
#balanser-app #errorContainer.show { display: block; animation: balFade .3s ease; }
#balanser-app #errorContainer .title { font-weight: 700; color: var(--tool-err, #8b3a3a); display: block; margin-bottom: 4px; }
#balanser-app #errorContainer .msg { font-size: .875rem; color: var(--tool-ink-soft, #3d4a5c); }
#balanser-app .text-orange { color: var(--tool-warn, #9a6b2f); font-weight: 700; }
#balanser-app .text-emerald { color: var(--tool-olive, #5c6b3a); font-weight: 700; }
`;

  const HTML = `
<div class="bal-shell">
  <div class="bal-head">
    <h1>
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
          <input type="text" id="refundAmount" class="input-field" placeholder="np. 1,23" data-bal-format style="border-color:color-mix(in srgb, var(--tool-olive) 40%, var(--tool-edge))">
        </div>
        <div class="bal-field">
          <label for="allocateAmount" class="accent">Ile przekazać na odsetki?</label>
          <div class="bal-alloc-wrap">
            <input type="text" id="allocateAmount" class="input-field" placeholder="np. 1,00" data-bal-format style="padding-right:88px;border-color:color-mix(in srgb, var(--tool-spine) 45%, var(--tool-edge))">
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
