/* ============================================================
   Egzebiurko 3.0 — automaty.js
   Zrzutnia dla Analityki WRO: wskazany folder + JPK / OGNIVO / AUM.
   ============================================================ */

'use strict';

const AutomatyZrzutnia = (() => {

  const ROLES = ['see11', 'see18', 'platforma', 'aum', 'ognivo'];
  const NEED = {
    jpk: ['platforma', 'see11', 'see18'],
    ognivo: ['ognivo', 'see11', 'see18'],
    aum: ['aum', 'see11', 'see18']
  };
  const ROLE_LABEL = {
    see11: 'SEE.11',
    see18: 'SEE.18',
    platforma: 'Platforma',
    aum: 'AUM',
    ognivo: 'OGNIVO'
  };

  let files = {};
  let folderName = '';

  function ingest(fileList) {
    files = {};
    folderName = '';
    let n = 0;
    for (const file of fileList || []) {
      const C = window.AutomatyCore;
      const role = C && C.classifyDumpName(file.name);
      if (!role) continue;
      files[role] = file;
      n++;
      const rel = file.webkitRelativePath || file.name;
      const parts = String(rel).split(/[/\\]/);
      if (parts.length > 1) folderName = parts[0];
    }
    if (!folderName && n) folderName = 'folder';
    return snapshot();
  }

  function snapshot() {
    const found = {};
    ROLES.forEach(r => { found[r] = files[r] ? files[r].name : null; });
    return { folderName, found, count: ROLES.filter(r => files[r]).length };
  }

  function missingFor(kind) {
    return (NEED[kind] || []).filter(r => !files[r]).map(r => ROLE_LABEL[r] || r);
  }

  async function load(role) {
    const file = files[role];
    if (!file) return null;
    return window.AutomatyCore.tableFromFile(file);
  }

  async function run(kind) {
    const C = window.AutomatyCore;
    const miss = missingFor(kind);
    if (miss.length) {
      return { ok: false, error: 'W folderze brakuje: ' + miss.join(', ') + '.' };
    }

    const see11 = await load('see11');
    const see18 = await load('see18');

    if (kind === 'jpk') {
      const pa = await load('platforma');
      const result = C.analizaJpk({ platforma: pa.rows, see11: see11.rows, see18: see18.rows });
      if (!result.ok) return result;
      return {
        ok: true,
        kind,
        sectionKey: 'Wynik: JPK',
        byId: C.jpkRowsToWro(result.rows),
        count: result.diagnostics.outRows,
        diagnostics: C.formatJpkDiagnostics(result.diagnostics)
      };
    }

    if (kind === 'aum') {
      const aum = await load('aum');
      const result = C.analizaAum({ aum: aum.rows, see11: see11.rows, see18: see18.rows });
      if (!result.ok) return result;
      return {
        ok: true,
        kind,
        sectionKey: 'Wynik: AUM',
        byId: C.aumRowsToWro(result.rows),
        count: result.diagnostics.outRows,
        diagnostics: C.formatAumDiagnostics(result.diagnostics)
      };
    }

    const og = await load('ognivo');
    const result = C.analizaOgnivo({
      ognivo: og.rows,
      see11: see11.rows,
      see18: see18.rows,
      separator: og.separator || ';'
    });
    if (!result.ok) return result;
    return {
      ok: true,
      kind,
      sectionKey: 'Wynik: OGNIVO',
      byId: C.ognivoRowsToWro(result.rows, result.startRow),
      count: result.diagnostics.dopasowaniaKon,
      diagnostics: C.formatOgnivoDiagnostics(result.diagnostics)
    };
  }

  return { ingest, snapshot, missingFor, run, ROLE_LABEL, ROLES };
})();

window.AutomatyZrzutnia = AutomatyZrzutnia;
