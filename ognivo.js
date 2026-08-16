/* ============================================================
   Egzebiurko 3.0 — modules/ognivo.js
   Parser XML odpowiedzi OGNIVO
   Zapis wyników do SharedStore → widoczne w Arkuszu i WRO
   ============================================================ */

'use strict';

const OgnivoModule = (() => {

  /* ─── DANE BANKÓW ───────────────────────────────────────── */
  const exactBankCodes = {
    "30000065": "SKOK im. Franciszka Stefczyka",
    "30000079": "Krakowska SKOK",
    "30000061": "SKOK im. Z. Chmielewskiego",
    "30000115": "SKOK \"Centrum\""
  };
  const bankPrefixes = {
    "1010":"NBP","1020":"PKO Bank Polski","1050":"ING Bank Śląski",
    "1060":"Bank BPH","1090":"Erste Bank Polska","1130":"BGK",
    "1140":"mBank","1160":"Bank Millennium","1190":"Citi Handlowy",
    "1240":"Bank Pekao","1280":"HSBC Polska","1320":"Bank Pocztowy",
    "1540":"BOŚ","1560":"VeloBank","1580":"Mercedes-Benz Bank",
    "1600":"BNP Paribas Polska","1610":"SGB-Bank","1680":"Plus Bank",
    "1840":"Société Générale","1870":"Nest Bank","1930":"BPS",
    "1940":"Credit Agricole","2030":"BNP Paribas Polska",
    "2120":"Santander Consumer","2130":"Volkswagen Bank",
    "2160":"Toyota Bank","2190":"DNB Bank","2480":"Getin/VeloBank",
    "2490":"Alior Bank","2910":"UniCredit","8591":"KBS"
  };

  function getBankName(code) {
    if (!code) return "Nieznany";
    code = String(code).trim();
    if (exactBankCodes[code]) return exactBankCodes[code];
    const prefix = code.substring(0, 4);
    if (bankPrefixes[prefix]) return bankPrefixes[prefix];
    if (code.startsWith("8") || code.startsWith("9")) return "Bank Spółdzielczy";
    return "Nierozpoznany";
  }

  /* ─── STAN ─────────────────────────────────────────────── */
  let fileQueue = [];
  let finalData = [];
  let activated = false;

  /* ─── RENDER ────────────────────────────────────────────── */
  function render() {
    const container = document.getElementById('ognivo-app');
    if (!container) return;

    const stored = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
    const storedCount = Object.keys(stored).length;

    container.innerHTML = `
      <div class="ognivo-wrap">
        <div class="ognivo-header">
          <div>
            <h2 class="mod-title">🏦 Wizualizator OGNIVO</h2>
            <p class="mod-sub">Analiza odpowiedzi XML z systemu OGNIVO — błyskawicznie identyfikuje rachunki bankowe</p>
          </div>
          ${storedCount > 0 ? `<div class="ognivo-stored-badge">💾 ${storedCount} wyników w pamięci (SharedStore)</div>` : ''}
        </div>

        <div class="ognivo-dropzone" id="ognivo-drop">
          <div class="dz-icon">📂</div>
          <div class="dz-text">Przeciągnij pliki <strong>.xml</strong> lub <strong>foldery</strong></div>
          <div class="dz-sub">System sam wejdzie do podfolderów i wyciągnie pliki .xml</div>
          <div class="dz-btns">
            <button class="btn-dz" onclick="document.getElementById('ognivo-file-input').click()">Wybierz pliki (.xml)</button>
            <button class="btn-dz" onclick="document.getElementById('ognivo-folder-input').click()">Wybierz folder</button>
          </div>
          <input type="file" id="ognivo-file-input" multiple accept=".xml" style="display:none">
          <input type="file" id="ognivo-folder-input" webkitdirectory directory multiple style="display:none">
        </div>

        <div class="ognivo-actions" id="ognivo-actions">
          <div class="ognivo-queue-info" id="ognivo-queue-info">W kolejce: 0 plików</div>
          <div class="ognivo-btns">
            <button class="btn-act btn-start" id="ognivo-start-btn" style="display:none" onclick="OgnivoModule.startAnalysis()">▶ Rozpocznij analizę</button>
            <button class="btn-act btn-clear" id="ognivo-clear-btn" style="display:none" onclick="OgnivoModule.clearQueue()">✕ Wyczyść kolejkę</button>
            <button class="btn-act btn-export" id="ognivo-export-btn" style="display:none" onclick="OgnivoModule.exportCSV()">⬇ Pobierz CSV</button>
            <button class="btn-act btn-secondary" id="ognivo-save-btn" style="display:none" onclick="OgnivoModule.saveToStore()">💾 Zapisz do pamięci</button>
          </div>
          <div class="ognivo-progress" id="ognivo-progress" style="display:none">
            <div class="prog-bar-wrap"><div class="prog-bar" id="ognivo-prog-bar"></div></div>
            <div class="prog-text" id="ognivo-prog-text">Przygotowywanie...</div>
          </div>
        </div>

        <div id="ognivo-results" style="display:none">
          <div class="results-header">
            <span id="ognivo-count">Znaleziono: 0 podmiotów</span>
            <span class="results-hint">Kliknij nagłówek kolumny aby posortować</span>
          </div>
          <div class="ognivo-table-wrap">
            <table class="ognivo-table">
              <thead>
                <tr>
                  <th onclick="OgnivoModule.sortTable(0)">Podmiot ↕</th>
                  <th onclick="OgnivoModule.sortTable(1)">PESEL / NIP / REGON ↕</th>
                  <th onclick="OgnivoModule.sortTable(2)" class="center">Trafienia ↕</th>
                  <th>Zidentyfikowane rachunki</th>
                  <th class="center">W Arkuszu</th>
                </tr>
              </thead>
              <tbody id="ognivo-tbody"></tbody>
            </table>
          </div>
        </div>

        ${storedCount > 0 ? renderStoredResults(stored) : ''}
      </div>
    `;

    bindEvents();
  }

  function renderStoredResults(stored) {
    const entries = Object.entries(stored).slice(0, 50);
    if (!entries.length) return '';
    return `
      <div class="stored-results">
        <h3 class="stored-title">📦 Wyniki z pamięci SharedStore (${Object.keys(stored).length} podmiotów)</h3>
        <div class="ognivo-table-wrap">
          <table class="ognivo-table">
            <thead>
              <tr>
                <th>ID (PESEL/NIP)</th>
                <th class="center">Trafień</th>
                <th>Banki</th>
                <th>Zapisano</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map(([id, d]) => `
                <tr>
                  <td class="td-id">${id}</td>
                  <td class="center"><strong class="hit-count">${d.count}</strong></td>
                  <td>${(d.banks||[]).map(b => `<span class="bank-badge">${b}</span>`).join('')}</td>
                  <td class="td-muted">${d.ts ? new Date(d.ts).toLocaleString('pl') : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function bindEvents() {
    const drop = document.getElementById('ognivo-drop');
    if (!drop) return;

    ['dragenter','dragover','dragleave','drop'].forEach(ev =>
      drop.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); })
    );
    ['dragenter','dragover'].forEach(ev =>
      drop.addEventListener(ev, () => drop.classList.add('drag-over'))
    );
    ['dragleave','drop'].forEach(ev =>
      drop.addEventListener(ev, () => drop.classList.remove('drag-over'))
    );

    drop.addEventListener('drop', e => {
      if (e.dataTransfer.items) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
          const item = e.dataTransfer.items[i].webkitGetAsEntry();
          if (item) traverseTree(item);
        }
      } else {
        addFiles(e.dataTransfer.files);
      }
    });

    const fi = document.getElementById('ognivo-file-input');
    const fo = document.getElementById('ognivo-folder-input');
    if (fi) fi.addEventListener('change', e => { addFiles(e.target.files); fi.value = ''; });
    if (fo) fo.addEventListener('change', e => { addFiles(e.target.files); fo.value = ''; });
  }

  function traverseTree(item) {
    if (item.isFile) {
      item.file(f => {
        if (f.name.toLowerCase().endsWith('.xml')) {
          fileQueue.push(f);
          updateQueueUI();
        }
      });
    } else if (item.isDirectory) {
      const reader = item.createReader();
      const read = () => reader.readEntries(entries => {
        if (entries.length > 0) {
          entries.forEach(e => traverseTree(e));
          read();
        }
      });
      read();
    }
  }

  function addFiles(files) {
    for (let f of files) {
      if (f.name.toLowerCase().endsWith('.xml')) fileQueue.push(f);
    }
    updateQueueUI();
  }

  function updateQueueUI() {
    const info  = document.getElementById('ognivo-queue-info');
    const start = document.getElementById('ognivo-start-btn');
    const clear = document.getElementById('ognivo-clear-btn');
    if (info)  info.textContent = `W kolejce: ${fileQueue.length} plików XML`;
    if (start) start.style.display = fileQueue.length > 0 ? 'inline-flex' : 'none';
    if (clear) clear.style.display = fileQueue.length > 0 ? 'inline-flex' : 'none';
  }

  function clearQueue() {
    fileQueue = [];
    finalData = [];
    updateQueueUI();
    const res = document.getElementById('ognivo-results');
    if (res) res.style.display = 'none';
    const exp = document.getElementById('ognivo-export-btn');
    const sav = document.getElementById('ognivo-save-btn');
    if (exp) exp.style.display = 'none';
    if (sav) sav.style.display = 'none';
  }

  async function startAnalysis() {
    if (!fileQueue.length) return;

    const startBtn = document.getElementById('ognivo-start-btn');
    const prog     = document.getElementById('ognivo-progress');
    const bar      = document.getElementById('ognivo-prog-bar');
    const progText = document.getElementById('ognivo-prog-text');
    const expBtn   = document.getElementById('ognivo-export-btn');
    const savBtn   = document.getElementById('ognivo-save-btn');

    if (startBtn) startBtn.disabled = true;
    if (prog) prog.style.display = 'block';

    const results = new Map();
    const total = fileQueue.length;
    let done = 0;
    const CHUNK = 25;

    for (let i = 0; i < total; i += CHUNK) {
      const chunk = fileQueue.slice(i, i + CHUNK);
      await processChunk(chunk, results);
      done += chunk.length;
      const pct = Math.min(100, Math.round((done / total) * 100));
      if (bar) bar.style.width = pct + '%';
      if (progText) progText.textContent = `Przetworzono ${done} z ${total} plików...`;
      await new Promise(r => setTimeout(r, 10));
    }

    if (progText) progText.textContent = 'Generowanie wyników...';
    await new Promise(r => setTimeout(r, 50));

    finalData = Array.from(results.values());
    renderTable(finalData);

    fileQueue = [];
    updateQueueUI();
    if (startBtn) startBtn.disabled = false;
    setTimeout(() => {
      if (prog) prog.style.display = 'none';
      if (bar)  bar.style.width = '0%';
      if (finalData.length > 0 && expBtn) expBtn.style.display = 'inline-flex';
      if (finalData.length > 0 && savBtn) savBtn.style.display = 'inline-flex';
    }, 1000);
  }

  async function processChunk(chunk, resultsMap) {
    const sprawy = SharedStore.get(SharedStore.KEYS.SPRAWY, []);
    const sprawySet = new Set(sprawy.map(s => String(s.id || s).trim()));

    for (const file of chunk) {
      try {
        const text = await file.text();

        let bankCode = '';
        const bankMatch = text.match(/<(?:[a-zA-Z0-9-]+:)?KodBanku>([^<]+)<\//i);
        if (bankMatch) bankCode = bankMatch[1].trim();
        else {
          const ep = text.match(/kodOgnivo=["']([^_"']+)/i);
          if (ep) bankCode = ep[1].trim();
        }

        const bankName = getBankName(bankCode);
        const fullBank = `${bankCode} — ${bankName}`;

        const dluznikRx = /<(?:[a-zA-Z0-9-]+:)?Dluznik[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9-]+:)?Dluznik>/gi;
        let m;
        while ((m = dluznikRx.exec(text)) !== null) {
          const block = m[1];
          if (!/<(?:[a-zA-Z0-9-]+:)?Odpowiedz>\s*tak\s*<\//i.test(block)) continue;

          const pesel  = (block.match(/<(?:[a-zA-Z0-9-]+:)?Pesel>\s*([^<]+)\s*<\//i)   || [])[1];
          const nip    = (block.match(/<(?:[a-zA-Z0-9-]+:)?NIP>\s*([^<]+)\s*<\//i)     || [])[1];
          const regon  = (block.match(/<(?:[a-zA-Z0-9-]+:)?REGON>\s*([^<]+)\s*<\//i)   || [])[1];
          const imie   = (block.match(/<(?:[a-zA-Z0-9-]+:)?Imie>\s*([^<]+)\s*<\//i)    || [])[1];
          const nazw   = (block.match(/<(?:[a-zA-Z0-9-]+:)?Nazwisko>\s*([^<]+)\s*<\//i)|| [])[1];
          const firma  = (block.match(/<(?:[a-zA-Z0-9-]+:)?NazwaInstytucji>\s*([^<]+)\s*<\//i)||[])[1];

          const id   = pesel ? pesel.trim() : nip ? nip.trim() : regon ? regon.trim() : 'Brak ID';
          const name = firma ? firma.trim() : (imie && nazw) ? `${imie.trim()} ${nazw.trim()}` : 'Brak nazwy';
          const inArkusz = sprawySet.has(id);

          if (!resultsMap.has(id)) {
            resultsMap.set(id, { id, name, count: 0, banks: new Set(), rawCodes: new Set(), inArkusz });
          }
          const rec = resultsMap.get(id);
          rec.banks.add(fullBank);
          rec.rawCodes.add(bankCode);
          rec.count = rec.banks.size;
        }
      } catch (e) { console.error('[OGNIVO] parse error:', file.name, e); }
    }
  }

  function renderTable(data) {
    const res = document.getElementById('ognivo-results');
    const cnt = document.getElementById('ognivo-count');
    const tbody = document.getElementById('ognivo-tbody');
    if (!res || !tbody) return;

    if (!data.length) {
      showToast('Nie znaleziono odpowiedzi "tak" w plikach XML', 'warn');
      return;
    }

    data.sort((a, b) => b.count - a.count);
    res.style.display = 'block';
    if (cnt) cnt.textContent = `Zidentyfikowano majątek u ${data.length} podmiotów`;

    tbody.innerHTML = data.map(item => {
      const banks = Array.from(item.banks).map(b => {
        const unknown = b.includes('Nierozpoznany') || b.includes('Nieznany');
        return `<span class="bank-badge ${unknown ? 'bank-unknown' : ''}">${b}</span>`;
      }).join('');

      const arkuszIcon = item.inArkusz
        ? `<span class="in-arkusz" title="Osoba jest w Arkuszu">✅</span>`
        : `<span class="not-arkusz" title="Nie ma w Arkuszu">—</span>`;

      return `
        <tr>
          <td class="td-name">${item.name}</td>
          <td class="td-id">${item.id}</td>
          <td class="center"><strong class="hit-count">${item.count}</strong></td>
          <td><div class="banks-wrap">${banks}</div></td>
          <td class="center">${arkuszIcon}</td>
        </tr>
      `;
    }).join('');
  }

  function saveToStore() {
    if (!finalData.length) return;

    const existing = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
    finalData.forEach(item => {
      existing[item.id] = {
        name:  item.name,
        count: item.count,
        banks: Array.from(item.banks),
        rawCodes: Array.from(item.rawCodes),
        ts: Date.now()
      };
    });
    SharedStore.set(SharedStore.KEYS.OGNIVO, existing);
    showToast(`💾 Zapisano ${finalData.length} wyników OGNIVO do pamięci`, 'success');

    // Refresh wyników (pokaże znaczniki w Arkuszu)
    renderTable(finalData);
  }

  function exportCSV() {
    if (!finalData.length) return;
    let csv = '\uFEFF'; // BOM dla Excel
    csv += 'Podmiot;Identyfikator;Trafień;Banki;Kody\n';
    finalData.forEach(item => {
      const name = item.name.replace(/;/g, ',');
      const banks = Array.from(item.banks).join(' | ');
      const codes = Array.from(item.rawCodes).join(' | ');
      csv += `"${name}";"${item.id}";"${item.count}";"${banks}";"${codes}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `OGNIVO_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function sortTable(col) {
    if (!finalData.length) return;
    const keys = ['name', 'id', 'count'];
    const k = keys[col];
    finalData.sort((a, b) => {
      const av = col === 2 ? a[k] : String(a[k]).toLowerCase();
      const bv = col === 2 ? b[k] : String(b[k]).toLowerCase();
      return av > bv ? 1 : av < bv ? -1 : 0;
    });
    renderTable(finalData);
  }

  function activate(params = {}) {
    if (!activated) {
      activated = true;
    }
    render();

    // Jeśli wywołano z Arkusza z konkretnym ID — pokaż wyniki dla tej osoby
    if (params.pesel || params.nip) {
      const id = params.pesel || params.nip;
      const stored = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
      if (stored[id]) {
        showToast(`Wyniki OGNIVO dla ${id}: ${stored[id].count} trafień`, 'info');
      }
    }
  }

  return { activate, startAnalysis, clearQueue, exportCSV, saveToStore, sortTable };
})();

window.OgnivoModule = OgnivoModule;
