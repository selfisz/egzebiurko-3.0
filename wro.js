/* ============================================================
   Egzebiurko 3.0 — modules/wro.js
   Analityka WRO Pro
   Integracja z SharedStore (status, koszyk, OGNIVO wyniki)
   ============================================================ */

'use strict';

const WroModule = (() => {

  /* ─── STAN ─────────────────────────────────────────────── */
  let bazaDanych = {};
  let entities   = [];
  let activeFilters = new Set();
  let currentActiveId = null;
  let activated   = false;

  const icons = {
    "Raporter":"📊","STIR":"🏦","Księgi Wieczyste":"🏢",
    "CRCM":"📋","Dochody":"💰","Przychód":"📈",
    "UFG CEPIK":"🚗","Kontrahenci: SPRZEDAŻ":"🛒","Kontrahenci: ZAKUP":"🛍️",
    "Wynik: OGNIVO":"🔥","Wynik: AUM":"🎯","Wynik: JPK":"⚡"
  };
  const sourceNames = Object.keys(icons);
  const matrixColumns = [
    "Raporter","STIR","Księgi Wieczyste","CRCM","Dochody","Przychód",
    "UFG CEPIK","Kontrahenci: SPRZEDAŻ","Kontrahenci: ZAKUP",
    "Wynik: OGNIVO","Wynik: AUM","Wynik: JPK"
  ];

  /* ─── POMOCNICZE ────────────────────────────────────────── */
  function getAnalyzed() { return new Set(SharedStore.get('wro_analyzed_status', [])); }
  function setAnalyzed(s) { SharedStore.set('wro_analyzed_status', [...s]); }
  function getCart()     { return new Set(SharedStore.get('wro_cart_status', [])); }
  function setCart(s)    { SharedStore.set('wro_cart_status', [...s]); SharedStore.set(SharedStore.KEYS.WRO_CART, [...s]); }

  /* ─── GŁÓWNY RENDER ─────────────────────────────────────── */
  function render() {
    const container = document.getElementById('wro-app');
    if (!container) return;

    const cart = getCart();

    container.innerHTML = `
      <div class="wro-layout">
        <aside class="wro-sidebar">
          <div class="wro-sidebar-inner">
            <button class="wro-cart-btn" onclick="WroModule.renderCart()">
              🛒 Koszyk matrycowy
              <span class="wro-cart-counter" id="wro-cart-counter">${cart.size}</span>
            </button>

            <label class="wro-upload-btn">
              📥 Wczytaj bazę danych (.js)
              <input type="file" id="wro-file-input" accept=".js,.json,.txt" style="display:none">
            </label>

            <div class="wro-progress-row">
              <button class="wro-prog-btn" onclick="WroModule.exportProgress()">💾 Zapisz postęp</button>
              <label class="wro-prog-btn">
                📂 Wczytaj postęp
                <input type="file" id="wro-prog-input" accept=".json" style="display:none">
              </label>
            </div>

            <input type="text" class="wro-search" id="wro-search" placeholder="Szukaj (nazwa, NIP, PESEL)...">

            <div class="wro-filters" id="wro-filters"></div>
          </div>

          <div class="wro-list" id="wro-list">
            <div class="wro-empty-list">
              Brak wczytanych danych.<br>
              Wczytaj plik z bazą (.js) aby rozpocząć.
            </div>
          </div>
        </aside>

        <main class="wro-content" id="wro-content">
          <div class="wro-empty-state">
            <div class="wro-empty-card">
              <div class="wro-empty-icon">📊</div>
              <h3>Analityka WRO</h3>
              <p>Wczytaj plik bazy danych wygenerowany przez makro Excel, następnie wybierz podmiot z listy.</p>
              ${Object.keys(bazaDanych).length > 0
                ? `<p class="wro-db-info">✅ Baza załadowana: ${Object.keys(bazaDanych).length} podmiotów</p>`
                : ''}
            </div>
          </div>
        </main>
      </div>
    `;

    bindEvents();
    initFilters();
    if (entities.length > 0) renderList('');
  }

  function bindEvents() {
    const fi   = document.getElementById('wro-file-input');
    const pi   = document.getElementById('wro-prog-input');
    const srch = document.getElementById('wro-search');

    if (fi) fi.addEventListener('change', handleFileLoad);
    if (pi) pi.addEventListener('change', handleProgressLoad);
    if (srch) srch.addEventListener('input', e => renderList(e.target.value));
  }

  function handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsText(file, 'UTF-16LE');
    reader.onload = evt => {
      let text = evt.target.result.replace('const bazaDanych = ', '').trim();
      if (text.endsWith('};')) text = text.slice(0, -2) + '}';
      try {
        bazaDanych = JSON.parse(text);
        window.WroDatabase = bazaDanych;
        entities = Object.keys(bazaDanych).map(id => {
          const avail = Object.keys(bazaDanych[id]).filter(k => k !== '_meta' && bazaDanych[id][k].length > 1);
          return { id, availableSources: avail, sourceCount: avail.length };
        }).sort((a, b) => b.sourceCount - a.sourceCount || a.id.localeCompare(b.id));

        renderList('');
        showContent('<div class="wro-empty-state"><div class="wro-empty-card"><div class="wro-empty-icon">✅</div><h3>Baza załadowana</h3><p>Załadowano ' + entities.length + ' podmiotów. Wybierz podmiot z listy.</p></div></div>');
        showToast('✅ Wczytano bazę WRO: ' + entities.length + ' podmiotów', 'success');
      } catch(err) {
        showToast('❌ Błąd pliku bazy danych!', 'error');
      }
    };
  }

  function handleProgressLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = evt => {
      try {
        const obj = JSON.parse(evt.target.result);
        const analyzed = getAnalyzed();
        const cart = getCart();
        if (obj.analyzed) obj.analyzed.forEach(id => analyzed.add(id));
        if (obj.cart)     obj.cart.forEach(id => cart.add(id));
        setAnalyzed(analyzed);
        setCart(cart);
        updateCartCounter();
        renderList(document.getElementById('wro-search')?.value || '');
        showToast('✅ Postęp wczytany', 'success');
      } catch { showToast('❌ Nieprawidłowy plik postępu', 'error'); }
    };
  }

  function initFilters() {
    const fc = document.getElementById('wro-filters');
    if (!fc) return;
    fc.innerHTML = '';
    sourceNames.forEach(src => {
      const chip = document.createElement('div');
      chip.className = 'wro-chip';
      const disp = src.replace('Kontrahenci: ','').replace('Wynik: ','');
      chip.innerHTML = `${icons[src]} ${disp}`;
      chip.onclick = () => {
        chip.classList.toggle('active');
        if (chip.classList.contains('active')) activeFilters.add(src);
        else activeFilters.delete(src);
        renderList(document.getElementById('wro-search')?.value || '');
      };
      fc.appendChild(chip);
    });
  }

  function renderList(filterText = '') {
    const listEl = document.getElementById('wro-list');
    if (!listEl) return;

    if (!entities.length) {
      listEl.innerHTML = '<div class="wro-empty-list">Brak wczytanych danych.</div>';
      return;
    }

    const analyzed = getAnalyzed();
    const cart     = getCart();
    const lf = filterText.toLowerCase();

    const filtered = entities.filter(item => {
      const matchText = item.id.toLowerCase().includes(lf);
      let matchFilters = true;
      if (activeFilters.size > 0) {
        for (const req of activeFilters) {
          if (!item.availableSources.includes(req)) { matchFilters = false; break; }
        }
      }
      return matchText && matchFilters;
    });

    listEl.innerHTML = filtered.map(item => {
      const isAnalyzed = analyzed.has(item.id);
      const inCart     = cart.has(item.id);
      const isActive   = currentActiveId === item.id;

      const statusBadges = (inCart ? '🛒 ' : '') + (isAnalyzed ? '✅' : '');
      const iconsHtml = item.availableSources.map(s => {
        const safe = s.replace(/[^a-zA-Z0-9]/g,'');
        const style = s.startsWith('Wynik:') ? 'color:#ef4444;font-weight:bold;' : '';
        return `<span class="wro-icon-jump" style="${style}" data-entity="${item.id}" data-section="${safe}" title="${s}">${icons[s]||'📄'}</span>`;
      }).join('');

      return `
        <div class="wro-list-item ${isAnalyzed ? 'is-analyzed' : ''} ${isActive ? 'active' : ''}" data-id="${item.id}">
          <div class="wro-list-title">
            <span title="${item.id}">${item.id}</span>
            <span>${statusBadges}</span>
          </div>
          <div class="wro-list-score">Dane: ${iconsHtml}</div>
        </div>
      `;
    }).join('');

    // Bind click events
    listEl.querySelectorAll('.wro-list-item').forEach(el => {
      el.addEventListener('click', ev => {
        if (ev.target.classList.contains('wro-icon-jump')) return;
        selectEntity(el.dataset.id);
      });
    });
    listEl.querySelectorAll('.wro-icon-jump').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        const id = el.dataset.entity;
        const sec = el.dataset.section;
        selectEntity(id, sec);
      });
    });
  }

  function selectEntity(id, scrollToSection = null) {
    currentActiveId = id;
    // Update active state
    document.querySelectorAll('.wro-list-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });
    renderEntityContent(id, scrollToSection);
  }

  function renderEntityContent(id, scrollToSection) {
    const data = bazaDanych[id];
    if (!data) return;

    const analyzed  = getAnalyzed();
    const cart      = getCart();
    const isAnalyzed = analyzed.has(id);
    const inCart     = cart.has(id);

    const fileName = data._meta?.plik || 'Nieznany';
    const a3       = data._meta?.a3 || '';
    const b3       = data._meta?.b3 || '';

    // Pobierz wyniki OGNIVO z SharedStore dla tej osoby
    const ognivoData  = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
    const ognivoEntry = ognivoData[id] || ognivoData[a3] || ognivoData[b3] || null;

    let validSources = Object.keys(data).filter(k => k !== '_meta' && data[k].length > 1);
    validSources.sort((a, b) => {
      if (a.startsWith('Wynik:') && !b.startsWith('Wynik:')) return -1;
      if (!a.startsWith('Wynik:') && b.startsWith('Wynik:')) return 1;
      return 0;
    });

    const metaBadges = [
      a3 ? `<span class="wro-meta-badge" onclick="copyText('${a3}',this)" title="Kliknij aby skopiować"><strong>NIP:</strong> ${a3}</span>` : '',
      b3 ? `<span class="wro-meta-badge" onclick="copyText('${b3}',this)" title="Kliknij aby skopiować"><strong>PESEL:</strong> ${b3}</span>` : ''
    ].filter(Boolean).join('');

    // OGNIVO badge
    const ognivoBadge = ognivoEntry
      ? `<span class="wro-ognivo-badge" title="Wyniki OGNIVO z SharedStore">🏦 OGNIVO: ${ognivoEntry.count} trafień</span>`
      : '';

    const navCapsules = validSources.map(src => {
      const safe = src.replace(/[^a-zA-Z0-9]/g,'');
      const isAction = src.startsWith('Wynik:');
      const disp = src.replace('Wynik: ','');
      return `<a href="#wro-sec-${safe}" class="wro-capsule ${isAction ? 'wro-capsule-action' : ''}"
                onclick="document.getElementById('wro-sec-${safe}')?.classList.remove('collapsed')"
              >${icons[src]||'📄'} ${disp}</a>`;
    }).join('');

    let html = `
      <div class="wro-entity-wrap">
        <div class="wro-entity-header">
          <div>
            <h2 class="wro-entity-title">
              ${id}
              ${metaBadges ? `<div class="wro-meta-row">${metaBadges}</div>` : ''}
              ${ognivoBadge}
            </h2>
            <span class="wro-source-chip">📄 ${fileName}</span>
          </div>
          <div class="wro-entity-actions">
            <button class="wro-btn ${inCart ? 'wro-btn-red' : 'wro-btn-orange'}"
              onclick="WroModule.toggleCart('${id}')">
              ${inCart ? '❌ Usuń z koszyka' : '🛒 Dodaj do koszyka'}
            </button>
          </div>
        </div>

        <div class="wro-sticky-nav">
          <div class="wro-sticky-row">
            <div class="wro-capsules">${navCapsules}</div>
            <button class="wro-analyze-btn ${isAnalyzed ? 'done' : ''}"
              onclick="WroModule.toggleStatus('${id}')">
              ${isAnalyzed ? '↩️ Cofnij status' : '✅ Oznacz jako załatwione'}
            </button>
          </div>
          <div class="wro-toggle-row">
            <button class="wro-toggle-btn" onclick="WroModule.expandAll()">🔽 Rozwiń</button>
            <button class="wro-toggle-btn" onclick="WroModule.collapseAll()">◀️ Zwiń</button>
          </div>
        </div>
    `;

    // OGNIVO wyniki inline jeśli dostępne
    if (ognivoEntry) {
      html += `
        <div class="wro-ognivo-inline">
          <div class="wro-ognivo-title">🏦 Wyniki OGNIVO (z SharedStore)</div>
          <div class="wro-ognivo-banks">
            ${(ognivoEntry.banks || []).map(b => `<span class="bank-badge">${b}</span>`).join('')}
          </div>
          <div class="wro-ognivo-meta">Zapisano: ${ognivoEntry.ts ? new Date(ognivoEntry.ts).toLocaleString('pl') : '—'}</div>
        </div>
      `;
    }

    // Sekcje danych
    validSources.forEach(src => {
      const rows = data[src];
      const safe = src.replace(/[^a-zA-Z0-9]/g,'');
      const isAction = src.startsWith('Wynik:');
      const disp = src.replace('Wynik: ','Akcja: ');
      const headers = rows[0];

      html += `
        <div class="wro-source-block ${isAction ? 'wro-action-block' : ''}" id="wro-sec-${safe}">
          <div class="wro-source-title" onclick="this.closest('.wro-source-block').classList.toggle('collapsed')">
            <div class="wro-title-left">${icons[src]||'📄'} ${disp}</div>
            <div class="wro-collapse-icon">▼</div>
          </div>
          <div class="wro-cards-grid">
            ${Array.from({length: rows.length - 1}, (_, i) => i + 1).map(r => `
              <div class="wro-card">
                <div class="wro-card-hdr">Wpis #${r}</div>
                ${headers.map((h, c) => {
                  const val = rows[r][c];
                  const disp = (val && String(val).trim()) ? val : '<span class="wro-empty-val">—</span>';
                  return `<div class="wro-card-row"><div class="wro-label">${h}</div><div class="wro-value">${disp}</div></div>`;
                }).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    html += '</div>';
    showContent(html);

    // Scrolluj do sekcji jeśli podano
    if (scrollToSection) {
      setTimeout(() => {
        const el = document.getElementById('wro-sec-' + scrollToSection);
        if (el) { el.classList.remove('collapsed'); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }, 80);
    }

    // Przenieś do Arkusza — przycisk "Otwórz w Arkuszu"
    addArkuszLink(id);
  }

  function addArkuszLink(id) {
    const header = document.querySelector('.wro-entity-actions');
    if (!header) return;
    if (header.querySelector('.wro-btn-arkusz')) return;
    const btn = document.createElement('button');
    btn.className = 'wro-btn wro-btn-arkusz';
    btn.title = 'Znajdź tę osobę w Arkuszu';
    btn.innerHTML = '📋 Otwórz w Arkuszu';
    btn.onclick = () => Router.navigate('arkusz', { pesel: id, nip: id });
    header.insertBefore(btn, header.firstChild);
  }

  function showContent(html) {
    const content = document.getElementById('wro-content');
    if (content) { content.innerHTML = html; content.scrollTop = 0; }
  }

  function toggleStatus(id) {
    const analyzed = getAnalyzed();
    if (analyzed.has(id)) analyzed.delete(id);
    else analyzed.add(id);
    setAnalyzed(analyzed);

    // Aktualizuj SharedStore dla Arkusza
    const statusMap = SharedStore.get(SharedStore.KEYS.WRO_STATUS, {});
    statusMap[id] = analyzed.has(id) ? 'analyzed' : 'pending';
    SharedStore.set(SharedStore.KEYS.WRO_STATUS, statusMap);

    renderList(document.getElementById('wro-search')?.value || '');
    if (currentActiveId === id) renderEntityContent(id, null);
    showToast(analyzed.has(id) ? '✅ Oznaczono jako załatwione' : '↩️ Cofnięto status', 'info');
  }

  function toggleCart(id) {
    const cart = getCart();
    if (cart.has(id)) cart.delete(id);
    else cart.add(id);
    setCart(cart);
    updateCartCounter();
    renderList(document.getElementById('wro-search')?.value || '');
    if (currentActiveId === id) renderEntityContent(id, null);
  }

  function updateCartCounter() {
    const el = document.getElementById('wro-cart-counter');
    if (el) el.textContent = getCart().size;
  }

  function renderCart() {
    currentActiveId = null;
    const cart = getCart();

    if (!cart.size) {
      showContent(`<div class="wro-empty-state">
        <div class="wro-empty-card">
          <div class="wro-empty-icon">🛒</div>
          <h3>Koszyk jest pusty</h3>
          <p>Dodaj osoby do koszyka za pomocą przycisku w profilu.</p>
        </div>
      </div>`);
      return;
    }

    let html = `
      <div class="wro-entity-wrap">
        <div class="wro-entity-header">
          <h2 class="wro-entity-title">🛒 Koszyk — Matryca Wyników (${cart.size} osób)</h2>
          <div class="wro-entity-actions">
            <button class="wro-btn wro-btn-red" onclick="WroModule.clearCart()">🗑️ Opróżnij</button>
            <button class="wro-btn wro-btn-green" onclick="WroModule.exportMatrixCSV()">📥 Eksportuj CSV</button>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table class="wro-matrix-table">
            <thead>
              <tr>
                <th style="text-align:left;min-width:200px">Podmiot</th>
                <th>NIP</th>
                <th>PESEL</th>
                ${matrixColumns.map(c => `<th>${icons[c]||''} ${c.replace('Kontrahenci: ','').replace('Wynik: ','')}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${[...cart].map(id => {
                const d = bazaDanych[id];
                if (!d) return `<tr><td class="wro-name-col" colspan="${3+matrixColumns.length}">${id} <small>(brak w bazie)</small></td></tr>`;
                const a3 = d._meta?.a3 || '—';
                const b3 = d._meta?.b3 || '—';
                return `<tr>
                  <td class="wro-name-col" onclick="WroModule.selectFromCart('${id}')" style="cursor:pointer">${id}</td>
                  <td class="wro-matrix-id">${a3}</td>
                  <td class="wro-matrix-id">${b3}</td>
                  ${matrixColumns.map(col =>
                    d[col] && d[col].length > 1
                      ? `<td class="matrix-v">✓</td>`
                      : `<td class="matrix-x">✗</td>`
                  ).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    showContent(html);
  }

  function selectFromCart(id) {
    currentActiveId = id;
    renderEntityContent(id, null);
  }

  function clearCart() {
    if (!confirm('Opróżnić cały koszyk?')) return;
    setCart(new Set());
    updateCartCounter();
    renderCart();
  }

  function exportProgress() {
    const data = JSON.stringify({ analyzed: [...getAnalyzed()], cart: [...getCart()] });
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `WRO_Postep_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  }

  function exportMatrixCSV() {
    const cart = getCart();
    let csv = '\uFEFF';
    csv += ['Podmiot','NIP','PESEL', ...matrixColumns.map(c => c.replace('Wynik: ',''))].join(';') + '\n';
    cart.forEach(id => {
      const d = bazaDanych[id];
      if (!d) return;
      const a3 = d._meta?.a3 || '';
      const b3 = d._meta?.b3 || '';
      const cols = matrixColumns.map(col => (d[col] && d[col].length > 1) ? 'V' : 'X');
      csv += [id, a3, b3, ...cols].join(';') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Matryca_WRO_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  function expandAll()   { document.querySelectorAll('.wro-source-block').forEach(el => el.classList.remove('collapsed')); }
  function collapseAll() { document.querySelectorAll('.wro-source-block').forEach(el => el.classList.add('collapsed')); }

  function activate(params = {}) {
    if (!activated) { activated = true; }
    render();

    // Jeśli wywołano z Arkusza z konkretną osobą — aktywuj ją
    if (params.pesel || params.nip) {
      const id = params.pesel || params.nip;
      if (bazaDanych[id]) {
        setTimeout(() => selectEntity(id), 100);
      } else {
        showToast(`ℹ️ Brak "${id}" w bazie WRO — wczytaj plik bazy`, 'info');
      }
    }
  }

  function getCepikInfoForId(id) {
    const db = bazaDanych || window.WroDatabase;
    if (!id || !db) return null;
    const clean = String(id).replace(/\D/g, '');
    if (!clean && typeof id !== 'string') return null;
    
    // Szukamy po kluczu bezpośrednim lub po polach NIP/PESEL wewnątrz encji
    let entity = db[id] || (clean ? db[clean] : null);
    if (!entity && clean) {
      const keys = Object.keys(db);
      for (const k of keys) {
        const ent = db[k];
        if (!ent) continue;
        const meta = ent._meta || {};
        const a3 = String(meta.a3 || '').replace(/\D/g, '');
        const b3 = String(meta.b3 || '').replace(/\D/g, '');
        if (k.replace(/\D/g, '') === clean || (a3 && a3 === clean) || (b3 && b3 === clean)) {
          entity = ent;
          break;
        }
      }
    }
    if (!entity || !entity['UFG CEPIK'] || entity['UFG CEPIK'].length <= 1) {
      return null;
    }

    const rows = entity['UFG CEPIK'];
    const headers = rows[0] || [];
    
    const brandIdx = headers.findIndex(h => /marka|model|pojazd|opis|typ/i.test(h));
    const plateIdx = headers.findIndex(h => /rejestr|nr.*rej|tablica|rejestracj/i.test(h));
    const vinIdx = headers.findIndex(h => /vin/i.test(h));
    const polisaIdx = headers.findIndex(h => /polisa|ubezpiecz/i.test(h));

    const vehicles = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const brand = brandIdx >= 0 ? String(r[brandIdx] || '').trim() : '';
      const plate = plateIdx >= 0 ? String(r[plateIdx] || '').trim() : '';
      const vin = vinIdx >= 0 ? String(r[vinIdx] || '').trim() : '';
      const polisa = polisaIdx >= 0 ? String(r[polisaIdx] || '').trim() : '';

      let label = '';
      if (brand && plate) label = `${brand} (${plate})`;
      else if (plate) label = `Pojazd (${plate})`;
      else if (brand) label = brand;
      else if (vin) label = `VIN: ${vin}`;
      else label = `Pojazd #${i}`;

      vehicles.push({ label, brand, plate, vin, polisa, raw: r, headers });
    }

    const today = new Date();
    const todayShort = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}`;
    const summaryText = vehicles.map(v => v.label).join(', ');
    const formattedNote = vehicles.length > 0 ? `[CEPIK ${todayShort}: ${summaryText}]` : `[CEPIK ${todayShort}: Brak pojazdów]`;

    return {
      hasVehicles: vehicles.length > 0,
      vehicles,
      summaryText,
      formattedNote,
      headers,
      rawRows: rows
    };
  }

  function getBazaDanych() { return bazaDanych; }

  return {
    activate, selectEntity, selectFromCart,
    toggleStatus, toggleCart, updateCartCounter,
    renderCart, clearCart, exportProgress, exportMatrixCSV,
    expandAll, collapseAll,
    getCepikInfoForId, getBazaDanych
  };
})();

window.WroModule = WroModule;

function copyText(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = el.innerHTML;
    el.innerHTML = '✅ <strong>Skopiowano!</strong>';
    el.style.background = '#10b981';
    el.style.color = '#fff';
    setTimeout(() => { el.innerHTML = orig; el.style = ''; }, 1400);
  });
}
