/* ============================================================
   Egzebiurko 3.0 — automaty-core.js
   Sito JPK + OGNIVO (logika 1:1 z makr VBA Orkiestrator_JPK1
   i Orkiestrator_AnalizaOgnivo). Działa na tablicach w pamięci
   — bez folderu A:\Automaty.
   ============================================================ */

'use strict';

(function (root) {

  function getStr(val) {
    if (val == null) return '';
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return '';
      if (Math.abs(val) >= 1e15 || (Math.abs(val) > 0 && Math.abs(val) < 1e-6)) {
        const rounded = Math.round(val);
        if (Math.abs(val - rounded) < 1e-6) return String(rounded);
      }
      if (Number.isInteger(val) || Math.abs(val - Math.round(val)) < 1e-9) {
        if (Math.abs(val) < 1e15) return String(Math.round(val));
      }
      const s = String(val);
      if (/e/i.test(s)) {
        try {
          return BigInt(Math.round(val)).toString();
        } catch {
          return s;
        }
      }
      return s;
    }
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    return String(val).replace(/^\s+|\s+$/g, '');
  }

  function cleanCyfry(txt) {
    const s = getStr(txt);
    let res = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (ch >= '0' && ch <= '9') res += ch;
    }
    return res;
  }

  function cleanPESEL(txt) {
    let s = getStr(txt);
    if (/e\+/i.test(s) || /e-/i.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) s = String(Math.round(n));
    }
    let res = cleanCyfry(s);
    if (res.length === 10) res = '0' + res;
    else if (res.length === 9) res = '00' + res;
    return res.length === 11 ? res : '';
  }

  function cleanNIP(txt) {
    return cleanCyfry(txt);
  }

  function cleanForMatch(txt) {
    let res = getStr(txt).toUpperCase();
    res = res.replace(/[.,\-"]/g, ' ');
    while (res.indexOf('  ') >= 0) res = res.replace(/  /g, ' ');
    return res.replace(/^\s+|\s+$/g, '');
  }

  function isDebtorMatched(dluPA, see18Names) {
    if (!dluPA) return false;
    const words = dluPA.split(' ');
    for (let i = 0; i < see18Names.length; i++) {
      const hay = see18Names[i];
      if (!hay) continue;
      let all = true;
      for (let w = 0; w < words.length; w++) {
        if (!words[w]) continue;
        if (hay.indexOf(words[w]) < 0) {
          all = false;
          break;
        }
      }
      if (all) return true;
    }
    return false;
  }

  function normalizeKlas(val) {
    return getStr(val).toUpperCase().replace(/[\s\-]/g, '');
  }

  function isWW1(val) {
    const k = normalizeKlas(val);
    return k === 'W' || k === 'W1';
  }

  function policzZnak(tekst, znak) {
    if (!znak) return 0;
    return String(tekst || '').split(znak).length - 1;
  }

  function wykryjSeparatorCSV(pierwszaLinia) {
    const liczbaSrednikow = policzZnak(pierwszaLinia, ';');
    const liczbaPrzecinkow = policzZnak(pierwszaLinia, ',');
    const liczbaTabulatorow = policzZnak(pierwszaLinia, '\t');
    if (liczbaSrednikow >= liczbaPrzecinkow && liczbaSrednikow >= liczbaTabulatorow && liczbaSrednikow > 0) {
      return ';';
    }
    if (liczbaTabulatorow >= liczbaPrzecinkow && liczbaTabulatorow > 0) {
      return '\t';
    }
    if (liczbaPrzecinkow > 0) return ',';
    return ';';
  }

  function parseDelimited(text, sep) {
    const s = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (s.charAt(i + 1) === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === sep) {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every(c => String(c || '').trim() === '')) {
      rows.pop();
    }
    let max = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i].length > max) max = rows[i].length;
    for (let i = 0; i < rows.length; i++) {
      while (rows[i].length < max) rows[i].push('');
    }
    return rows;
  }

  function wczytajCsvTekst(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '');
    const pierwsza = raw.split(/\r\n|\n|\r/, 1)[0] || '';
    const separator = wykryjSeparatorCSV(pierwsza);
    return { rows: parseDelimited(raw, separator), separator };
  }

  function decodeTextBuffer(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(u8);
    }
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(u8);
    }
    const utf8 = new TextDecoder('utf-8').decode(u8);
    const bad = (utf8.match(/\uFFFD/g) || []).length;
    if (bad > 2) {
      try {
        return new TextDecoder('windows-1250').decode(u8);
      } catch {
        return utf8;
      }
    }
    return utf8;
  }

  /* ── ZIP + pierwszy arkusz XLSX (Sheets(1)) ─────────────── */

  function u16(u8, i) { return u8[i] | (u8[i + 1] << 8); }
  function u32(u8, i) { return (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24)) >>> 0; }

  function inflateRawSyncOrAsync(compressed) {
    if (typeof require === 'function') {
      try {
        const zlib = require('zlib');
        return Promise.resolve(zlib.inflateRawSync(compressed));
      } catch {}
    }
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('Brak dekompresji ZIP (deflate)'));
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([compressed]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(b => new Uint8Array(b));
  }

  function listZipEntries(u8) {
    let eocd = -1;
    const start = Math.max(0, u8.length - 65557);
    for (let i = u8.length - 22; i >= start; i--) {
      if (u32(u8, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Nieprawidłowy plik XLSX (brak ZIP EOCD)');
    const cdOff = u32(u8, eocd + 16);
    const cdCount = u16(u8, eocd + 10);
    const entries = [];
    let p = cdOff;
    for (let n = 0; n < cdCount; n++) {
      if (u32(u8, p) !== 0x02014b50) break;
      const method = u16(u8, p + 10);
      const compSize = u32(u8, p + 20);
      const nameLen = u16(u8, p + 28);
      const extraLen = u16(u8, p + 30);
      const commentLen = u16(u8, p + 32);
      const localOff = u32(u8, p + 42);
      const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
      entries.push({ name, method, compSize, localOff });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function readZipFile(u8, entry) {
    const i = entry.localOff;
    if (u32(u8, i) !== 0x04034b50) throw new Error('Uszkodzony ZIP: ' + entry.name);
    const nameLen = u16(u8, i + 26);
    const extraLen = u16(u8, i + 28);
    const dataStart = i + 30 + nameLen + extraLen;
    const compressed = u8.subarray(dataStart, dataStart + entry.compSize);
    if (entry.method === 0) return compressed;
    if (entry.method === 8) return inflateRawSyncOrAsync(compressed);
    throw new Error('Nieobsługiwana kompresja ZIP: ' + entry.method);
  }

  function xmlUnescape(s) {
    return String(s || '')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  function parseSharedStrings(xml) {
    const out = [];
    const siRe = /<(?:[\w.]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?si>/g;
    let m;
    while ((m = siRe.exec(xml))) {
      const block = m[1];
      let text = '';
      const tRe = /<(?:[\w.]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?t>/g;
      let t;
      while ((t = tRe.exec(block))) text += t[1];
      out.push(xmlUnescape(text));
    }
    return out;
  }

  function colRowFromRef(ref) {
    const m = String(ref || '').match(/^([A-Z]+)(\d+)$/i);
    if (!m) return null;
    const letters = m[1].toUpperCase();
    let col = 0;
    for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
    return { col: col, row: parseInt(m[2], 10) };
  }

  function parseSheetXml(xml, shared) {
    const rowsMap = new Map();
    let maxCol = 0;
    let maxRow = 0;
    const cRe = /<(?:[\w.]+:)?c\b([^>]*)>([\s\S]*?)<\/(?:[\w.]+:)?c>/g;
    let m;
    while ((m = cRe.exec(xml))) {
      const attrs = m[1];
      const inner = m[2];
      const rM = attrs.match(/\br="([^"]+)"/);
      if (!rM) continue;
      const pos = colRowFromRef(rM[1]);
      if (!pos) continue;
      const tM = attrs.match(/\bt="([^"]+)"/);
      const t = tM ? tM[1] : '';
      let val = '';
      if (t === 'inlineStr' || t === 'str') {
        const tM2 = inner.match(/<(?:[\w.]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?t>/);
        val = tM2 ? xmlUnescape(tM2[1]) : '';
      } else if (t === 's') {
        const vM = inner.match(/<(?:[\w.]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?v>/);
        const idx = vM ? parseInt(vM[1], 10) : NaN;
        val = Number.isFinite(idx) ? (shared[idx] || '') : '';
      } else if (t === 'b') {
        const vM = inner.match(/<(?:[\w.]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?v>/);
        val = vM && String(vM[1]).trim() === '1' ? 'TRUE' : 'FALSE';
      } else if (t === 'e') {
        val = '';
      } else {
        const vM = inner.match(/<(?:[\w.]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?v>/);
        val = vM ? xmlUnescape(vM[1]) : '';
      }
      if (!rowsMap.has(pos.row)) rowsMap.set(pos.row, new Map());
      rowsMap.get(pos.row).set(pos.col, val);
      if (pos.col > maxCol) maxCol = pos.col;
      if (pos.row > maxRow) maxRow = pos.row;
    }
    const rows = [];
    for (let r = 1; r <= maxRow; r++) {
      const map = rowsMap.get(r);
      const row = [];
      for (let c = 1; c <= maxCol; c++) row.push(map && map.has(c) ? map.get(c) : '');
      rows.push(row);
    }
    return rows;
  }

  function firstSheetPath(files) {
    const wb = files['xl/workbook.xml'];
    const rels = files['xl/_rels/workbook.xml.rels'];
    if (wb && rels) {
      const sheets = [];
      const shRe = /<(?:[\w.]+:)?sheet\b([^>]*)\/?>/g;
      let m;
      while ((m = shRe.exec(wb))) {
        const idM = m[1].match(/\br:id="([^"]+)"/) || m[1].match(/\bid="([^"]+)"/);
        if (idM) sheets.push(idM[1]);
      }
      const relMap = {};
      const rRe = /<(?:[\w.]+:)?Relationship\b([^>]*)\/?>/g;
      while ((m = rRe.exec(rels))) {
        const id = (m[1].match(/\bId="([^"]+)"/) || [])[1];
        const target = (m[1].match(/\bTarget="([^"]+)"/) || [])[1];
        if (id && target) relMap[id] = target.replace(/\\/g, '/');
      }
      if (sheets[0] && relMap[sheets[0]]) {
        let t = relMap[sheets[0]];
        if (t.startsWith('/')) t = t.replace(/^\//, '');
        else if (!t.startsWith('xl/')) t = 'xl/' + t.replace(/^\.\//, '');
        if (files[t]) return t;
      }
    }
    const names = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)).sort();
    return names[0] || null;
  }

  async function readXlsxFirstSheet(arrayBuffer) {
    const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const listing = listZipEntries(u8);
    const files = {};
    for (const entry of listing) {
      if (!/\.xml$/i.test(entry.name)) continue;
      if (!/^xl\//i.test(entry.name) && entry.name !== '[Content_Types].xml') continue;
      const data = await readZipFile(u8, entry);
      files[entry.name.replace(/^\/+/, '')] = new TextDecoder('utf-8').decode(data);
    }
    const sheetPath = firstSheetPath(files);
    if (!sheetPath || !files[sheetPath]) {
      throw new Error('XLSX: nie znaleziono arkusza (Sheets(1))');
    }
    const shared = files['xl/sharedStrings.xml'] ? parseSharedStrings(files['xl/sharedStrings.xml']) : [];
    const rows = parseSheetXml(files[sheetPath], shared);
    return { rows, separator: '', kind: 'xlsx' };
  }

  function classifyDumpName(name) {
    const fName = String(name || '').toUpperCase();
    const base = fName.split(/[/\\]/).pop() || fName;
    if (base.indexOf('~$') === 0) return null;
    if (base.indexOf('SEE.11') >= 0 || base.indexOf('SEE_11') >= 0 || base.indexOf('SEE 11') >= 0 || base.indexOf('SEE11') >= 0) {
      return 'see11';
    }
    if (base.indexOf('SEE.18') >= 0 || base.indexOf('SEE_18') >= 0 || base.indexOf('SEE 18') >= 0 || base.indexOf('SEE18') >= 0) {
      return 'see18';
    }
    if (base.indexOf('OGNIVO') >= 0 || base.indexOf('OGNIVKO') >= 0) return 'ognivo';
    if (base.indexOf('AUM') >= 0) return 'aum';
    if (base.indexOf('PLATFORMA') >= 0 || base.indexOf('ANALITYCZNA') >= 0) return 'platforma';
    return null;
  }

  async function tableFromFile(file) {
    const name = String((file && file.name) || '').toLowerCase();
    if (/\.xls$/.test(name) && !/\.xlsx$/.test(name) && !/\.xlsm$/.test(name)) {
      throw new Error('Stary format .xls. Zapisz jako .xlsx albo CSV.');
    }
    if (/\.xlsx$|\.xlsm$/.test(name)) {
      const buf = await file.arrayBuffer();
      return readXlsxFirstSheet(buf);
    }
    const buf = await file.arrayBuffer();
    const parsed = wczytajCsvTekst(decodeTextBuffer(buf));
    return { rows: parsed.rows, separator: parsed.separator, kind: 'csv' };
  }

  function cell(row, col1) {
    if (!row || col1 < 1) return '';
    return getStr(row[col1 - 1]);
  }

  function padCols(rows, minCols) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ? rows[i].slice() : [];
      while (r.length < minCols) r.push('');
      rows[i] = r;
    }
    return rows;
  }

  function findOgnivoStartRow(rows) {
    let start = 2;
    const lim = Math.min(15, rows.length);
    for (let i = 0; i < lim; i++) {
      const b = cell(rows[i], 2);
      if (/identyfikator/i.test(b) || /pesel/i.test(b)) {
        start = i + 2;
        break;
      }
    }
    return start;
  }

  function splitBankList(listaBankow) {
    let s = getStr(listaBankow);
    if (!s.trim()) return [];
    s = s.replace(/\r\n/g, ',').replace(/\n/g, ',').replace(/;/g, ',');
    return s.split(',');
  }

  function tableToCsv(rows, sep) {
    const d = sep || ';';
    return rows.map(row => (row || []).map(v => {
      const s = v == null ? '' : String(v);
      if (/["\r\n;,]/.test(s) || (d !== ',' && s.indexOf(d) >= 0)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(d)).join('\r\n');
  }

  function timestampStamp(d) {
    const x = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + '_' +
      p(x.getHours()) + p(x.getMinutes()) + p(x.getSeconds());
  }

  /* ── Normalizacja nazwy banku (1:1 z VBA) ───────────────── */

  const BANK_CODE_RE = /^\s*\d{4,8}\s*[-–—:]?\s*/;

  function normalizujNazweBanku(nazwaIn) {
    let nazwa = getStr(nazwaIn).toUpperCase().trim();
    if (!nazwa) return '';

    nazwa = nazwa.replace(BANK_CODE_RE, '');

    nazwa = nazwa.replace(/ S\.A\./g, '');
    nazwa = nazwa.replace(/ S\. A\./g, '');
    nazwa = nazwa.replace(/ S A/g, '');
    nazwa = nazwa.replace(/ SA/g, '');
    nazwa = nazwa.replace(/ SPÓŁKA AKCYJNA/g, '');
    nazwa = nazwa.replace(/ SP\. Z O\.O\./g, '');
    nazwa = nazwa.replace(/ SP Z O\.O\./g, '');
    nazwa = nazwa.replace(/ SP\. Z O\. O\./g, '');
    nazwa = nazwa.replace(/ SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ/g, '');
    nazwa = nazwa.trim();

    if (nazwa.indexOf('GETIN') >= 0 || nazwa.indexOf('VELO') >= 0) return 'VELO';
    if (nazwa.indexOf('SANTANDER CONSUMER') >= 0) return 'SANTANDER_CONSUMER';
    if (nazwa.indexOf('ERSTE') >= 0 || nazwa.indexOf('BZ WBK') >= 0 ||
        (nazwa.indexOf('SANTANDER') >= 0 && nazwa.indexOf('CONSUMER') < 0)) return 'ERSTE';
    if (nazwa.indexOf('IDEA') >= 0 || nazwa.indexOf('PEKAO') >= 0 || nazwa.indexOf('OPIEKI') >= 0) return 'PEKAO';
    if (nazwa.indexOf('MBANK') >= 0) return 'MBANK';
    if (nazwa.indexOf('ING') >= 0 || nazwa.indexOf('ŚLĄSKI') >= 0 || nazwa.indexOf('SLASKI') >= 0) return 'ING';
    if (nazwa.indexOf('MILLENNIUM') >= 0 || nazwa.indexOf('MILENIUM') >= 0) return 'MILLENNIUM';
    if (nazwa.indexOf('ALIOR') >= 0) return 'ALIOR';
    if (nazwa.indexOf('PKO BP') >= 0 || nazwa.indexOf('POWSZECHNA KASA') >= 0 || nazwa.indexOf('PKO BANK POLSKI') >= 0) return 'PKOBP';
    if (nazwa.indexOf('POCZTOWY') >= 0) return 'POCZTOWY';
    if (nazwa.indexOf('BNP') >= 0 || nazwa.indexOf('PARIBAS') >= 0) return 'BNP';
    if (nazwa.indexOf('BPH') >= 0) return 'BPH';
    if (nazwa.indexOf('BPS') >= 0 || nazwa.indexOf('POLSKIEJ SPÓŁDZIELCZOŚCI') >= 0) return 'BPS';
    if (nazwa.indexOf('CREDIT AGRICOLE') >= 0 || nazwa.indexOf('LUKAS') >= 0) return 'CA';
    if (nazwa.indexOf('NEST') >= 0) return 'NEST';

    if (nazwa.indexOf('KRZESZOWIC') >= 0 || nazwa.indexOf('86120003') >= 0) return 'BS_KRZESZOWICE';
    if (nazwa.indexOf('MSZANIE DOLNEJ') >= 0 || nazwa.indexOf('88080006') >= 0) return 'BS_MSZANADOLNA';
    if (nazwa.indexOf('POMORSKI BANK SPÓŁDZIELCZY') >= 0 || nazwa.indexOf('ŚWIDWIN') >= 0 || nazwa.indexOf('85810004') >= 0) return 'PBS_SWIDWIN';
    if (nazwa.indexOf('WOLBROM') >= 0 || nazwa.indexOf('84500005') >= 0) return 'BS_WOLBROM';
    if (nazwa.indexOf('SUCHEJ BESKIDZKIEJ') >= 0 || nazwa.indexOf('81280005') >= 0) return 'BS_SUCHABESKIDZKA';
    if (nazwa.indexOf('MAŁOPOLSKI BANK SPÓŁDZIELCZY') >= 0 || nazwa.indexOf('86190006') >= 0) return 'MBS';
    if (nazwa.indexOf('SKAWIN') >= 0 || nazwa.indexOf('86000002') >= 0) return 'BS_SKAWINA';
    if (nazwa.indexOf('MIKOŁOWSKI BANK SPÓŁDZIELCZ') >= 0 || nazwa.indexOf('84360003') >= 0) return 'BS_MIKOLOW';
    if (nazwa.indexOf('NADSAŃSK') >= 0 || nazwa.indexOf('94300006') >= 0) return 'BS_NADSANSKI';
    if (nazwa.indexOf('SŁOMNIK') >= 0 || nazwa.indexOf('86140001') >= 0) return 'BS_SLOMNIKI';
    if (nazwa.indexOf('DĄBROWIE TARNOWSKIEJ') >= 0 || nazwa.indexOf('94620003') >= 0) return 'BS_DABROWATARNOWSKA';
    if (nazwa.indexOf('LIMANOW') >= 0 || nazwa.indexOf('88040000') >= 0) return 'BS_LIMANOWA';
    if (nazwa.indexOf('KRAKOWSKI BANK SPÓŁDZIELCZ') >= 0 || nazwa.indexOf('8591') >= 0) return 'KBS';

    if (nazwa.indexOf('STEFCZYK') >= 0 || nazwa.indexOf('30000065') >= 0) return 'SKOK_STEFCZYK';
    if (nazwa.indexOf('KRAKOWSKA SPÓŁDZIELCZA KASA') >= 0 || nazwa.indexOf('30000079') >= 0) return 'SKOK_KRAKOWSKA';
    if (nazwa.indexOf('CHMIELEWSKIEGO') >= 0 || nazwa.indexOf('30000061') >= 0) return 'SKOK_CHMIELEWSKIEGO';
    if (nazwa.indexOf('CENTRUM') >= 0 || nazwa.indexOf('30000115') >= 0) return 'SKOK_CENTRUM';

    nazwa = nazwa.replace(/ /g, '').replace(/-/g, '').replace(/\./g, '').replace(/"/g, '');
    return nazwa;
  }

  /* ── SITO OGNIVO ────────────────────────────────────────── */

  function analizaOgnivo(input) {
    const ognivo = (input && input.ognivo) || [];
    const see11 = padCols((input && input.see11) || [], 14);
    const see18 = padCols((input && input.see18) || [], 12);
    const separatorCSV = (input && input.separator) || ';';

    if (!ognivo.length) {
      return { ok: false, error: 'Nie udało się wczytać pliku OGNIVO CSV.', code: 'empty' };
    }
    const cols = ognivo[0] ? ognivo[0].length : 0;
    if (cols < 4) {
      return {
        ok: false,
        error: 'OGNIVO CSV zostało wczytane, ale ma tylko ' + cols + ' kolumn. Oczekiwane minimum to 4 (A–D). Wykryty separator: ' + JSON.stringify(separatorCSV),
        code: 'structure',
        separator: separatorCSV,
        columns: cols
      };
    }

    const dictSEE18 = Object.create(null);
    let liczbaSEE18 = 0;
    for (let i = 1; i < see18.length; i++) {
      const pesel = cleanPESEL(cell(see18[i], 8));
      if (isWW1(cell(see18[i], 11))) continue;
      const bank = normalizujNazweBanku(cell(see18[i], 12));
      if (pesel && bank) {
        dictSEE18[(pesel + '|' + bank).toUpperCase()] = true;
        liczbaSEE18++;
      }
    }

    const startRowOgnivo = findOgnivoStartRow(ognivo);
    const liczbaKolumnOgnivo = cols;
    let pierwszyPESEL = '';
    let pierwszyBank = '';
    for (let i = startRowOgnivo - 1; i < ognivo.length; i++) {
      pierwszyPESEL = cleanPESEL(cell(ognivo[i], 2));
      pierwszyBank = cell(ognivo[i], 4).trim();
      if (pierwszyPESEL) break;
    }

    const colsDoZajecia = cols + 1;
    const arrDoZajecia = [];
    for (let i = 0; i < startRowOgnivo - 1; i++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(ognivo[i][c]);
      row.push(i === startRowOgnivo - 2 ? 'Braki w K@WIE (do zajęcia):' : '');
      arrDoZajecia.push(row);
    }
    if (!arrDoZajecia.length) {
      const hdr = [];
      for (let c = 0; c < cols; c++) hdr.push(ognivo[0] ? ognivo[0][c] : '');
      hdr.push('Braki w K@WIE (do zajęcia):');
      arrDoZajecia.push(hdr);
    } else {
      arrDoZajecia[arrDoZajecia.length - 1][colsDoZajecia - 1] = 'Braki w K@WIE (do zajęcia):';
    }

    let rekordyOgnivo = 0;
    let osobyZNowymBankiem = 0;
    let liczbaNowychBankow = 0;
    let liczbaBankowWSEE18 = 0;
    let rekordyBezPESEL = 0;

    for (let i = startRowOgnivo - 1; i < ognivo.length; i++) {
      const pesel = cleanPESEL(cell(ognivo[i], 2));
      if (!pesel) {
        rekordyBezPESEL++;
        continue;
      }
      rekordyOgnivo++;
      let brakujaceBanki = '';
      let hasNewBank = false;
      const dictBankiOsoby = Object.create(null);
      const parts = splitBankList(cell(ognivo[i], 4));
      for (let p = 0; p < parts.length; p++) {
        const singleBank = String(parts[p] || '').trim();
        if (!singleBank) continue;
        const normBank = normalizujNazweBanku(singleBank);
        if (!normBank) continue;
        const nk = normBank.toUpperCase();
        if (dictBankiOsoby[nk]) continue;
        dictBankiOsoby[nk] = true;
        if (!dictSEE18[(pesel + '|' + normBank).toUpperCase()]) {
          brakujaceBanki = brakujaceBanki ? (brakujaceBanki + '; ' + singleBank) : singleBank;
          hasNewBank = true;
          liczbaNowychBankow++;
        } else {
          liczbaBankowWSEE18++;
        }
      }
      if (hasNewBank) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push(ognivo[i][c]);
        row.push(brakujaceBanki);
        arrDoZajecia.push(row);
        osobyZNowymBankiem++;
      }
    }

    const headerCount = Math.max(1, startRowOgnivo - 1);
    if (arrDoZajecia.length <= headerCount && osobyZNowymBankiem === 0) {
      return {
        ok: false,
        code: 'no-new-banks',
        error: 'OGNIVO – nie znaleziono żadnego nowego banku.',
        diagnostics: {
          separator: separatorCSV,
          liczbaKolumnOgnivo,
          pierwszyPESEL,
          pierwszyBank,
          rekordyOgnivo,
          rekordyBezPESEL,
          liczbaBankowWSEE18,
          liczbaSEE18,
          osobyZNowymBankiem,
          liczbaNowychBankow
        }
      };
    }

    const dictSEE11Istnieje = Object.create(null);
    const dictSEE11Odrzucone = Object.create(null);
    let liczbaSEE11 = 0;
    let liczbaPESELSEE11 = 0;
    let liczbaSEE11Odrzuconych = 0;

    for (let i = 1; i < see11.length; i++) {
      const pesel = cleanPESEL(cell(see11[i], 7));
      if (!pesel) continue;
      liczbaSEE11++;
      const klasC = normalizeKlas(cell(see11[i], 3));
      const klasN = normalizeKlas(cell(see11[i], 14));
      if (!dictSEE11Istnieje[pesel]) {
        dictSEE11Istnieje[pesel] = true;
        liczbaPESELSEE11++;
      }
      if (klasC === 'T' || klasN === 'W' || klasN === 'W1') {
        if (!dictSEE11Odrzucone[pesel]) {
          dictSEE11Odrzucone[pesel] = true;
          liczbaSEE11Odrzuconych++;
        }
      }
    }

    const arrFinal = [];
    let dopasowaniaKon = 0;
    let odrzuconeBrakSEE11 = 0;
    let odrzuconeSEE11 = 0;
    const headerRows = arrDoZajecia.slice(0, headerCount);
    headerRows.forEach(r => arrFinal.push(r.slice()));

    for (let i = headerCount; i < arrDoZajecia.length; i++) {
      const pesel = cleanPESEL(cell(arrDoZajecia[i], 2));
      if (!pesel) continue;
      if (dictSEE11Istnieje[pesel] && !dictSEE11Odrzucone[pesel]) {
        arrFinal.push(arrDoZajecia[i].slice());
        dopasowaniaKon++;
      } else if (!dictSEE11Istnieje[pesel]) {
        odrzuconeBrakSEE11++;
      } else {
        odrzuconeSEE11++;
      }
    }

    const diagnostics = {
      separator: separatorCSV,
      liczbaKolumnOgnivo,
      pierwszyPESEL,
      pierwszyBank,
      rekordyOgnivo,
      rekordyBezPESEL,
      osobyZNowymBankiem,
      liczbaNowychBankow,
      liczbaBankowWSEE18,
      liczbaSEE18,
      liczbaSEE11,
      liczbaPESELSEE11,
      liczbaSEE11Odrzuconych,
      odrzuconeBrakSEE11,
      odrzuconeSEE11,
      dopasowaniaKon
    };

    if (arrFinal.length < 2) {
      return {
        ok: false,
        code: 'zero',
        error: 'Brak rekordów do zajęcia.',
        diagnostics,
        rows: arrFinal
      };
    }

    return {
      ok: true,
      diagnostics,
      rows: arrFinal,
      startRow: headerCount + 1,
      fileName: 'DO_ZAJECIA_Ostateczne_' + timestampStamp() + '.csv'
    };
  }

  function formatOgnivoDiagnostics(d) {
    if (!d) return '';
    const lines = [
      'OGNIVO – diagnostyka',
      '-------------------------------------------------------',
      'Plik OGNIVO: CSV',
      'Wykryty separator: ' + d.separator,
      'Liczba kolumn OGNIVO: ' + d.liczbaKolumnOgnivo,
      'Pierwszy PESEL z B: ' + (d.pierwszyPESEL || ''),
      'Pierwszy bank z D: ' + (d.pierwszyBank || ''),
      'Rekordy OGNIVO z PESEL: ' + d.rekordyOgnivo,
      'Rekordy bez PESEL: ' + d.rekordyBezPESEL,
      'Osoby z nowym bankiem: ' + d.osobyZNowymBankiem,
      'Nowe banki: ' + d.liczbaNowychBankow,
      'Banki już w SEE.18: ' + d.liczbaBankowWSEE18,
      'SEE.11 – rekordy z PESEL: ' + d.liczbaSEE11,
      'SEE.11 – unikalne PESEL: ' + d.liczbaPESELSEE11,
      'SEE.11 – PESEL odrzucone C=T/W/W1: ' + d.liczbaSEE11Odrzuconych,
      'Odrzucone – brak SEE.11: ' + d.odrzuconeBrakSEE11,
      'Odrzucone – C=T/W/W1: ' + d.odrzuconeSEE11,
      'Wynik końcowy: ' + d.dopasowaniaKon
    ];
    return lines.join('\n');
  }

  function ognivoRowsToStore(rows, startRow1) {
    const start = Math.max(1, startRow1 || 2);
    const out = {};
    for (let i = start - 1; i < rows.length; i++) {
      const pesel = cleanPESEL(cell(rows[i], 2));
      if (!pesel) continue;
      const name = cell(rows[i], 1);
      const missing = cell(rows[i], rows[i].length);
      const banks = splitBankList(missing).map(s => s.trim()).filter(Boolean);
      if (!banks.length) continue;
      if (!out[pesel]) out[pesel] = { count: 0, banks: [], name: name, ts: new Date().toISOString() };
      banks.forEach(b => {
        if (out[pesel].banks.indexOf(b) < 0) out[pesel].banks.push(b);
      });
      out[pesel].count = out[pesel].banks.length;
    }
    return out;
  }

  function ognivoRowsToWro(rows, startRow1) {
    const start = Math.max(1, startRow1 || 2);
    const byId = {};
    const headers = ['Podmiot', 'PESEL', 'Liczba trafień', 'Zidentyfikowane banki', 'Braki w K@WIE (do zajęcia)'];
    for (let i = start - 1; i < rows.length; i++) {
      const pesel = cleanPESEL(cell(rows[i], 2));
      if (!pesel) continue;
      const row = [
        cell(rows[i], 1),
        pesel,
        cell(rows[i], 3),
        cell(rows[i], 4),
        cell(rows[i], rows[i].length)
      ];
      if (!byId[pesel]) byId[pesel] = { headers: headers, rows: [], name: cell(rows[i], 1), meta: { b3: pesel } };
      byId[pesel].rows.push(row);
    }
    return byId;
  }

  /* ── SITO JPK ───────────────────────────────────────────── */

  function analizaJpk(input) {
    const platforma = (input && input.platforma) || [];
    const see11 = padCols((input && input.see11) || [], 14);
    const see18raw = padCols((input && input.see18) || [], 12);

    if (!platforma.length) {
      return { ok: false, code: 'empty', error: 'Brak pliku Platforma.' };
    }

    const dictSEE11 = Object.create(null);
    for (let i = 1; i < see11.length; i++) {
      if (isWW1(cell(see11[i], 14))) continue;
      const nip = cleanNIP(cell(see11[i], 6));
      if (nip) dictSEE11[nip] = true;
    }

    const arrSEE18 = [];
    for (let i = 1; i < see18raw.length; i++) {
      if (isWW1(cell(see18raw[i], 11))) arrSEE18.push('');
      else arrSEE18.push(cleanForMatch(cell(see18raw[i], 12)));
    }

    const paCols = platforma[0] ? platforma[0].length : 0;
    let colsOut = paCols - 5;
    if (colsOut < 1) colsOut = paCols;

    const a1 = cell(platforma[0], 1);
    const startRow = /Platforma/i.test(a1) ? 2 : 1;

    const arrOut = [];
    let skippedDash = 0;
    let skippedSee11 = 0;
    let skippedSee18 = 0;

    for (let i = startRow - 1; i < platforma.length; i++) {
      if (i === startRow - 1) {
        const hdr = [];
        for (let c = 1; c <= paCols; c++) {
          if (c < 10 || c > 14) hdr.push(platforma[i][c - 1]);
        }
        arrOut.push(hdr);
        continue;
      }
      if (cell(platforma[i], 1) === '-' || cell(platforma[i], 2) === '-') {
        skippedDash++;
        continue;
      }
      const nip = cleanNIP(cell(platforma[i], 1));
      if (!dictSEE11[nip]) {
        skippedSee11++;
        continue;
      }
      const dluPA = cleanForMatch(cell(platforma[i], 4));
      if (isDebtorMatched(dluPA, arrSEE18)) {
        skippedSee18++;
        continue;
      }
      const row = [];
      for (let c = 1; c <= paCols; c++) {
        if (c < 10 || c > 14) row.push(platforma[i][c - 1]);
      }
      arrOut.push(row);
    }

    const diagnostics = {
      see11Whitelist: Object.keys(dictSEE11).length,
      outRows: Math.max(0, arrOut.length - 1),
      skippedDash,
      skippedSee11,
      skippedSee18,
      colsOut
    };

    if (arrOut.length < 2) {
      return {
        ok: false,
        code: 'zero',
        error: 'Żaden rekord nie przeszedł filtrów JPK.',
        diagnostics,
        rows: arrOut
      };
    }

    return {
      ok: true,
      diagnostics,
      rows: arrOut,
      fileName: 'JPK1_Wynik_' + timestampStamp() + '.csv'
    };
  }

  function formatJpkDiagnostics(d) {
    if (!d) return '';
    return [
      'JPK – diagnostyka',
      '-------------------------------------------------------',
      'SEE.11 – NIP na białej liście (N ≠ W/W1): ' + d.see11Whitelist,
      'Pominięte (A lub B = „-”): ' + d.skippedDash,
      'Pominięte (brak NIP w SEE.11): ' + d.skippedSee11,
      'Pominięte (dłużnik już w SEE.18): ' + d.skippedSee18,
      'Wynik końcowy: ' + d.outRows
    ].join('\n');
  }

  function splitAumAccounts(lista) {
    let s = getStr(lista);
    if (!s.trim()) return [];
    s = s.replace(/\r\n/g, '·').replace(/\n/g, '·').replace(/;/g, '·').replace(/•/g, '·');
    return s.split('·').map(x => String(x || '').trim()).filter(Boolean);
  }

  function detectAumLayout(rows) {
    const lim = Math.min(15, rows.length);
    for (let i = 0; i < lim; i++) {
      const h = (rows[i] || []).map(x => getStr(x).toLowerCase());
      const iPesel = h.findIndex(x => /pesel/.test(x));
      const iAcc = h.findIndex(x => /rachun/.test(x));
      if (iPesel >= 0 || iAcc >= 0) {
        const iNip = h.findIndex(x => /nip/.test(x));
        const iName = h.findIndex(x => /imi|nazw|podmiot|nazwa/.test(x));
        return {
          start: i + 2,
          iPesel: iPesel >= 0 ? iPesel : 0,
          iNip: iNip >= 0 ? iNip : 1,
          iName: iName >= 0 ? iName : 2,
          iAcc: iAcc >= 0 ? iAcc : 5
        };
      }
    }
    return { start: 2, iPesel: 0, iNip: 1, iName: 2, iAcc: 5 };
  }

  function analizaAum(input) {
    const aum = padCols((input && input.aum) || [], 6);
    const see11 = padCols((input && input.see11) || [], 14);
    const see18 = padCols((input && input.see18) || [], 12);
    if (!aum.length) {
      return { ok: false, code: 'empty', error: 'Brak pliku AUM.' };
    }

    const layout = detectAumLayout(aum);
    const dictSEE18 = Object.create(null);
    for (let i = 1; i < see18.length; i++) {
      if (isWW1(cell(see18[i], 11))) continue;
      const bank = normalizujNazweBanku(cell(see18[i], 12));
      if (!bank) continue;
      const pesel = cleanPESEL(cell(see18[i], 8));
      if (pesel) dictSEE18[(pesel + '|' + bank).toUpperCase()] = true;
    }

    const exists = Object.create(null);
    const rejected = Object.create(null);
    let liczbaSEE11 = 0;
    for (let i = 1; i < see11.length; i++) {
      const pesel = cleanPESEL(cell(see11[i], 7));
      const nip = cleanNIP(cell(see11[i], 6));
      if (!pesel && !nip) continue;
      liczbaSEE11++;
      if (pesel) exists[pesel] = true;
      if (nip) exists['n:' + nip] = true;
      const klasC = normalizeKlas(cell(see11[i], 3));
      if (klasC === 'T' || isWW1(cell(see11[i], 14))) {
        if (pesel) rejected[pesel] = true;
        if (nip) rejected['n:' + nip] = true;
      }
    }

    const headers = ['PESEL', 'NIP', 'Podmiot', 'Nowe rachunki (do zajęcia)'];
    const arrOut = [headers];
    let rekordyAum = 0;
    let zNowymBankiem = 0;
    let liczbaNowychBankow = 0;
    let liczbaBankowWSEE18 = 0;
    let odrzuconeSEE11 = 0;
    let odrzuconeBrakSEE11 = 0;

    for (let i = layout.start - 1; i < aum.length; i++) {
      const pesel = cleanPESEL(aum[i][layout.iPesel]);
      const nip = cleanNIP(aum[i][layout.iNip]);
      if (!pesel && !nip) continue;
      rekordyAum++;
      const name = getStr(aum[i][layout.iName]);
      const parts = splitAumAccounts(aum[i][layout.iAcc]);
      const seen = Object.create(null);
      const nowe = [];
      for (let p = 0; p < parts.length; p++) {
        const raw = parts[p];
        const norm = normalizujNazweBanku(raw);
        if (!norm || seen[norm]) continue;
        seen[norm] = true;
        const inSee = !!(pesel && dictSEE18[(pesel + '|' + norm).toUpperCase()]);
        if (inSee) liczbaBankowWSEE18++;
        else {
          nowe.push(raw);
          liczbaNowychBankow++;
        }
      }
      if (!nowe.length) continue;
      zNowymBankiem++;
      const rej = (pesel && rejected[pesel]) || (nip && rejected['n:' + nip]);
      if (rej) {
        odrzuconeSEE11++;
        continue;
      }
      const ex = (pesel && exists[pesel]) || (nip && exists['n:' + nip]);
      if (!ex) {
        odrzuconeBrakSEE11++;
        continue;
      }
      arrOut.push([pesel, nip, name, nowe.join(' · ')]);
    }

    const diagnostics = {
      rekordyAum,
      zNowymBankiem,
      liczbaNowychBankow,
      liczbaBankowWSEE18,
      liczbaSEE11,
      odrzuconeSEE11,
      odrzuconeBrakSEE11,
      outRows: Math.max(0, arrOut.length - 1)
    };

    if (arrOut.length < 2) {
      return {
        ok: false,
        code: 'zero',
        error: zNowymBankiem === 0 ? 'AUM – nie znaleziono żadnego nowego banku.' : 'Brak rekordów AUM do zajęcia.',
        diagnostics,
        rows: arrOut
      };
    }

    return {
      ok: true,
      diagnostics,
      rows: arrOut,
      fileName: 'AUM_Wynik_' + timestampStamp() + '.csv'
    };
  }

  function formatAumDiagnostics(d) {
    if (!d) return '';
    return [
      'AUM – diagnostyka',
      '-------------------------------------------------------',
      'Rekordy AUM (PESEL/NIP): ' + d.rekordyAum,
      'Osoby z nowym bankiem: ' + d.zNowymBankiem,
      'Nowe banki: ' + d.liczbaNowychBankow,
      'Banki już w SEE.18: ' + d.liczbaBankowWSEE18,
      'Odrzucone – C=T / N=W/W1: ' + d.odrzuconeSEE11,
      'Odrzucone – brak SEE.11: ' + d.odrzuconeBrakSEE11,
      'Wynik końcowy: ' + d.outRows
    ].join('\n');
  }

  function aumRowsToWro(rows) {
    const byId = {};
    if (!rows || rows.length < 2) return byId;
    const headers = (rows[0] || []).map(h => getStr(h));
    for (let i = 1; i < rows.length; i++) {
      const pesel = cleanPESEL(cell(rows[i], 1));
      const nip = cleanNIP(cell(rows[i], 2));
      const id = pesel || nip || ('AUM_' + i);
      if (!byId[id]) {
        byId[id] = {
          headers: headers,
          rows: [],
          name: cell(rows[i], 3) || id,
          meta: { b3: pesel, a3: nip }
        };
      }
      byId[id].rows.push((rows[i] || []).slice());
    }
    return byId;
  }

  function jpkRowsToWro(rows) {
    const byId = {};
    if (!rows || rows.length < 2) return byId;
    const headers = (rows[0] || []).map(h => getStr(h));
    for (let i = 1; i < rows.length; i++) {
      const nip = cleanNIP(cell(rows[i], 1));
      const id = nip || ('JPK_' + i);
      if (!byId[id]) {
        byId[id] = {
          headers: headers,
          rows: [],
          name: cell(rows[i], 4) || cell(rows[i], 2) || id,
          meta: { a3: nip }
        };
      }
      byId[id].rows.push((rows[i] || []).slice());
    }
    return byId;
  }

  const AutomatyCore = {
    getStr,
    cleanCyfry,
    cleanPESEL,
    cleanNIP,
    cleanForMatch,
    isDebtorMatched,
    normalizeKlas,
    isWW1,
    policzZnak,
    wykryjSeparatorCSV,
    parseDelimited,
    wczytajCsvTekst,
    decodeTextBuffer,
    readXlsxFirstSheet,
    classifyDumpName,
    tableFromFile,
    cell,
    normalizujNazweBanku,
    analizaOgnivo,
    formatOgnivoDiagnostics,
    ognivoRowsToStore,
    ognivoRowsToWro,
    analizaAum,
    formatAumDiagnostics,
    aumRowsToWro,
    analizaJpk,
    formatJpkDiagnostics,
    jpkRowsToWro,
    tableToCsv,
    timestampStamp,
    findOgnivoStartRow,
    detectAumLayout,
    splitAumAccounts
  };

  root.AutomatyCore = AutomatyCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = AutomatyCore;

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
