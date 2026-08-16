/* ============================================================
   Egzebiurko 3.0 — modules/arkusz.js
   Ładuje arkusz3.html bezpośrednio do panelu jako iframe.
   Oryginał NIE jest zmieniany — działa 1:1 jak zawsze.
   Dodatek: pasek integracji (OGNIVO / WRO) nad Arkuszem.
   ============================================================ */

'use strict';

const ArkuszModule = (() => {

  let activated = false;
  let rendered  = false;   // iframe tworzymy TYLKO RAZ
  let _selectedId = null;

  /* ─── Ścieżka do oryginału ─────────────────────── */
  /* Arkusz jest w repo: html/arkusz3.html (działa z file:// i z scripts/serve.py) */
  function resolveArkuszSrc() {
    return 'html/arkusz3.html';
  }
  let ARKUSZ_SRC = resolveArkuszSrc();

  /* ─── RENDER ────────────────────────────────────── */
  function render() {
    const container = document.getElementById('arkusz-content-area');
    if (!container) return;

    container.innerHTML = `
      <!-- Pasek integracji nad Arkuszem -->
      <div class="arkusz-integration-bar" id="arkusz-int-bar">
        ${renderIntegrationBar()}
      </div>

      <!-- Sam Arkusz w iframe — pełny, niezmieniony -->
      <iframe
        id="arkusz-frame"
        src="${ARKUSZ_SRC}"
        title="Arkusz"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups"
        style="flex:1;width:100%;border:none;min-height:0;display:block"
      ></iframe>

      <!-- Fallback: widoczny dopiero gdy iframe się nie załaduje -->
      <div id="arkusz-fallback" style="display:none">
        ${renderFallback()}
      </div>
    `;

    /* Obsługa błędu iframe */
    const iframe = document.getElementById('arkusz-frame');
    if (iframe) {
      iframe.addEventListener('load', () => {
        /* Iframe załadowany — próba odczytu PESEL/NIP z localStorage Arkusza */
        setTimeout(syncFromArkuszLocalStorage, 500);
      });
      iframe.addEventListener('error', () => {
        iframe.style.display = 'none';
        document.getElementById('arkusz-fallback').style.display = 'block';
      });
    }

    /* Reaktywne odświeżenie paska integracji gdy SharedStore się zmieni */
    SharedStore.on(SharedStore.KEYS.OGNIVO,     () => refreshIntBar());
    SharedStore.on(SharedStore.KEYS.WRO_STATUS, () => refreshIntBar());
    SharedStore.on(SharedStore.KEYS.WRO_CART,   () => refreshIntBar());
  }

  /* ─── PASEK INTEGRACJI ──────────────────────────── */
  function renderIntegrationBar() {
    const ognivo   = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
    const wroStatus = SharedStore.get(SharedStore.KEYS.WRO_STATUS, {});
    const wroCart  = SharedStore.get(SharedStore.KEYS.WRO_CART, []);

    const oc = Object.keys(ognivo).length;
    const wc = wroCart.length;
    const wa = Object.values(wroStatus).filter(v => v === 'analyzed').length;

    return `
      <div class="aib-info">
        <span class="aib-badge ${oc > 0 ? 'aib-active' : ''}" title="Wyniki OGNIVO w pamięci">
          🏦 OGNIVO: <strong>${oc}</strong> wyników
        </span>
        <span class="aib-badge ${wa > 0 ? 'aib-ok' : ''}" title="Załatwione w WRO">
          ✅ WRO: <strong>${wa}</strong> załatwionych
        </span>
        <span class="aib-badge ${wc > 0 ? 'aib-warn' : ''}" title="Koszyk matrycy WRO">
          🛒 Koszyk: <strong>${wc}</strong>
        </span>
      </div>
      <div class="aib-actions">
        <button class="aib-btn" onclick="Router.navigate('ognivo')" title="Przejdź do modułu OGNIVO">
          🏦 Otwórz OGNIVO
        </button>
        <button class="aib-btn" onclick="Router.navigate('wro')" title="Przejdź do modułu WRO">
          📊 Otwórz WRO
        </button>
        <button class="aib-btn aib-sync" onclick="ArkuszModule.syncFromArkuszLocalStorage()" title="Odczytaj PESEL/NIP z Arkusza">
          🔄 Sync PESEL/NIP
        </button>
        <button class="aib-btn" onclick="ArkuszModule.showOgnivoInspector()" title="Sprawdź wyniki OGNIVO dla wybranej osoby">
          🔍 Sprawdź OGNIVO
        </button>
      </div>
    `;
  }

  function refreshIntBar() {
    const bar = document.getElementById('arkusz-int-bar');
    if (bar) bar.innerHTML = renderIntegrationBar();
  }

  /* ─── FALLBACK (gdy iframe nie działa) ─────────── */
  function renderFallback() {
    return `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:40px">
        <div style="max-width:500px;text-align:center;background:var(--panel);border:1px dashed var(--line);border-radius:16px;padding:36px;box-shadow:var(--shadow-sm)">
          <div style="font-size:2.5rem;margin-bottom:14px">📋</div>
          <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:10px">Arkusz nie może się załadować w panelu</h3>
          <p style="font-size:.87rem;color:var(--muted);line-height:1.6;margin-bottom:16px">
            Przeglądarka blokuje wczytanie pliku jako ramkę (iframe).<br>
            Otwórz Arkusz w nowej karcie — synchronizacja przez localStorage działa nawet wtedy!
          </p>
          <p style="font-size:.82rem;color:var(--muted);margin-bottom:6px">Ścieżka do pliku:</p>
          <code style="font-size:.76rem;background:var(--panel2);border:1px solid var(--line);padding:6px 12px;border-radius:6px;color:var(--accent);display:block;margin-bottom:18px;word-break:break-all">
            ${ARKUSZ_SRC}
          </code>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button style="background:var(--accent);color:#fff;border:none;padding:10px 22px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer"
              onclick="ArkuszModule.openInNewTab()">
              🔗 Otwórz w nowej karcie
            </button>
            <button style="background:var(--panel2);color:var(--text);border:1px solid var(--line);padding:10px 16px;border-radius:8px;font:inherit;cursor:pointer"
              onclick="ArkuszModule.tryReload()">
              🔄 Spróbuj ponownie
            </button>
          </div>
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line)">
            <p style="font-size:.8rem;color:var(--muted);margin-bottom:10px">Synchronizuj PESEL/NIP ręcznie (wklej listę):</p>
            <textarea id="fallback-sync-ta"
              style="width:100%;min-height:100px;resize:vertical;border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;font-size:.8rem;font-family:var(--mono);background:var(--panel2);color:var(--text);box-sizing:border-box"
              placeholder="12345678901&#10;9876543210&#10;..."></textarea>
            <button style="margin-top:8px;background:var(--ok);color:#fff;border:none;padding:8px 16px;border-radius:7px;font:inherit;font-size:.82rem;cursor:pointer"
              onclick="ArkuszModule.saveFallbackSync()">
              💾 Zapisz do SharedStore
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /* ─── SYNC: PESEL/NIP z localStorage Arkusza ───── */
  function syncFromArkuszLocalStorage() {
    try {
      /* Arkusz zapisuje dane w ots_autosave_v1 */
      const raw = localStorage.getItem('ots_autosave_v1');
      if (!raw) {
        showToast('ℹ️ Brak danych Arkusza w localStorage (wczytaj plik w Arkuszu najpierw)', 'info', 4000);
        return 0;
      }
      const wb = JSON.parse(raw);
      if (!wb || !wb.sheets) return 0;

      const ids = new Set();
      wb.sheets.forEach(sheet => {
        const cols = sheet.columns || [];
        /* Szukaj kolumny PESEL lub NIP */
        const keyIdx = cols.findIndex(c =>
          /pesel/i.test(String(c)) || /^nip$/i.test(String(c)) || /identyfikator/i.test(String(c))
        );
        if (keyIdx < 0) return;
        (sheet.rows || []).forEach(row => {
          const val = String(row[keyIdx] || '').trim().replace(/[\s\-]/g, '');
          if (val.length >= 10 && /^\d+$/.test(val)) ids.add(val);
        });
      });

      if (ids.size > 0) {
        const list = [...ids].map(id => ({ id }));
        SharedStore.set(SharedStore.KEYS.SPRAWY, list);
        showToast(`✅ Zsynchronizowano ${ids.size} identyfikatorów z Arkusza`, 'success');
        refreshIntBar();
        return ids.size;
      } else {
        showToast('ℹ️ Nie znaleziono kolumny PESEL/NIP w Arkuszu', 'info', 3500);
        return 0;
      }
    } catch (e) {
      console.warn('[Arkusz] sync error:', e);
      showToast('⚠️ Błąd odczytu danych Arkusza', 'warn');
      return 0;
    }
  }

  function saveFallbackSync() {
    const ta = document.getElementById('fallback-sync-ta');
    if (!ta) return;
    const lines = ta.value.split('\n')
      .map(l => l.trim().replace(/\s/g, ''))
      .filter(l => l.length >= 10 && /^\d+$/.test(l));
    if (!lines.length) { showToast('Brak prawidłowych numerów', 'warn'); return; }
    const existing = SharedStore.get(SharedStore.KEYS.SPRAWY, []);
    const existSet = new Set(existing.map(e => e.id));
    lines.forEach(id => { if (!existSet.has(id)) existing.push({ id }); });
    SharedStore.set(SharedStore.KEYS.SPRAWY, existing);
    showToast(`✅ Dodano ${lines.length} identyfikatorów`, 'success');
  }

  /* ─── OGNIVO INSPECTOR ──────────────────────────── */
  function showOgnivoInspector() {
    const id = prompt('Podaj PESEL lub NIP osoby do sprawdzenia w OGNIVO:');
    if (!id) return;
    const clean = id.trim().replace(/\s/g, '');
    const ognivo = SharedStore.get(SharedStore.KEYS.OGNIVO, {});
    if (ognivo[clean]) {
      const d = ognivo[clean];
      alert(`OGNIVO — wyniki dla ${clean}:\n\nTrafień: ${d.count}\nBanki:\n${(d.banks||[]).join('\n')}\n\nZapisano: ${d.ts ? new Date(d.ts).toLocaleString('pl') : '—'}`);
    } else {
      const ans = confirm(`Brak wyników OGNIVO dla "${clean}" w pamięci.\n\nPrzejść do modułu OGNIVO aby wczytać pliki XML?`);
      if (ans) Router.navigate('ognivo');
    }
  }

  /* ─── UTILS ─────────────────────────────────────── */
  function openInNewTab() {
    ARKUSZ_SRC = resolveArkuszSrc();
    try {
      const url = new URL(ARKUSZ_SRC, window.location.href).href;
      window.open(url, '_blank');
    } catch {
      window.open(ARKUSZ_SRC, '_blank');
    }
    showToast('Arkusz otwarty w nowej karcie — localStorage jest wspólny.', 'info', 5000);
  }

  function tryReload() {
    const frame = document.getElementById('arkusz-frame');
    const fb    = document.getElementById('arkusz-fallback');
    if (frame && fb) {
      fb.style.display = 'none';
      frame.style.display = 'block';
      frame.src = ARKUSZ_SRC + '?t=' + Date.now();
    }
  }

  function getSelectedId() { return _selectedId; }
  function setSelectedId(id) { _selectedId = id; }

  /* ─── API MODUŁU ──────────────────────────────────────── */
  function ensureIframe() {
    if (!rendered) {
      rendered = true;
      render();
    }
  }

  function activate(params = {}) {
    activated = true;
    ensureIframe();
    // Reload iframe to sync any LocalStorage changes made in Zobowiazani module
    const frame = document.getElementById('arkusz-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.location.reload();
    }
    refreshIntBar();
  }

  return {
    activate, render, openInNewTab, tryReload,
    syncFromArkuszLocalStorage, saveFallbackSync,
    showOgnivoInspector, ensureIframe,
    getSelectedId, setSelectedId
  };
})();

window.ArkuszModule = ArkuszModule;
