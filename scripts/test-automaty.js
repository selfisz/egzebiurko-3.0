#!/usr/bin/env node
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'automaty-core.js'));

let failed = 0;
let passed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    return;
  }
  failed++;
  console.error('FAIL:', msg);
}

function eq(a, b, msg) {
  const ok = a === b;
  assert(ok, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')');
}

function deep(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  assert(sa === sb, msg + ' (got ' + sa + ', expected ' + sb + ')');
}

/* ── PESEL / NIP ─────────────────────────────────────────── */
eq(C.cleanPESEL('90010112345'), '90010112345', 'PESEL 11 cyfr');
eq(C.cleanPESEL('09001011234'), '09001011234', 'PESEL z zerem');
eq(C.cleanPESEL('9001011234'), '09001011234', 'PESEL 10 cyfr → zero wiodące');
eq(C.cleanPESEL('900101123'), '00900101123', 'PESEL 9 cyfr → dwa zera');
eq(C.cleanPESEL('900101123456'), '', 'PESEL 12 cyfr odrzucony');
eq(C.cleanPESEL('9.0010112345e+10'), '90010112345', 'PESEL notacja naukowa');
eq(C.cleanPESEL('900-101-12-345'), '90010112345', 'PESEL z myślnikami');
eq(C.cleanNIP('123-456-78-90'), '1234567890', 'NIP cyfry');

/* ── separator CSV ───────────────────────────────────────── */
eq(C.wykryjSeparatorCSV('A;B;C;D'), ';', 'separator średnik');
eq(C.wykryjSeparatorCSV('A,B,C,D'), ',', 'separator przecinek');
eq(C.wykryjSeparatorCSV('A\tB\tC\tD'), '\t', 'separator TAB');
eq(C.wykryjSeparatorCSV('A;B,C'), ';', 'średnik wygrywa przy remisie z przecinkiem');

const csv = C.wczytajCsvTekst('Podmiot;Identyfikator;Trafienia;Banki\n"Kowalski Jan";90010112345;2;"10200003 - PKO BANK POLSKI, 12400001 - BANK PEKAO"\n');
eq(csv.separator, ';', 'CSV OGNIVO separator');
eq(csv.rows.length, 2, 'CSV 2 wiersze');
eq(csv.rows[1][1], '90010112345', 'CSV PESEL z kolumny B');
assert(csv.rows[1][3].indexOf('PKO') >= 0, 'CSV banki w D');

/* ── nazwy plików ────────────────────────────────────────── */
eq(C.classifyDumpName('OGNIVO_wynik.csv'), 'ognivo', 'nazwa OGNIVO');
eq(C.classifyDumpName('OGNIVKO.xlsx'), 'ognivo', 'nazwa OGNIVKO');
eq(C.classifyDumpName('SEE.11_raport.xlsx'), 'see11', 'SEE.11 kropka');
eq(C.classifyDumpName('SEE_11.xlsx'), 'see11', 'SEE_11');
eq(C.classifyDumpName('SEE 18.csv'), 'see18', 'SEE 18 spacja');
eq(C.classifyDumpName('SEE18.xlsx'), 'see18', 'SEE18');
eq(C.classifyDumpName('PLATFORMA_export.xlsx'), 'platforma', 'PLATFORMA');
eq(C.classifyDumpName('platforma_analityczna.xlsx'), 'platforma', 'analityczna');
eq(C.classifyDumpName('AUM_rachunki.xlsx'), 'aum', 'AUM');
eq(C.classifyDumpName('~$SEE.11.xlsx'), null, 'plik tymczasowy Excel');
eq(C.classifyDumpName('losowy.csv'), null, 'nieznana nazwa');

/* ── banki ───────────────────────────────────────────────── */
eq(C.normalizujNazweBanku('10200003 - PKO BANK POLSKI'), 'PKOBP', 'OGNIVO PKO z kodem');
eq(C.normalizujNazweBanku('PKO BANK POLSKI S.A.'), 'PKOBP', 'SEE.18 PKO S.A.');
eq(C.normalizujNazweBanku('12400001 - BANK PEKAO'), 'PEKAO', 'Pekao z kodem');
eq(C.normalizujNazweBanku('Santander Consumer Bank'), 'SANTANDER_CONSUMER', 'Santander Consumer ≠ Erste');
eq(C.normalizujNazweBanku('Santander Bank Polska S.A.'), 'ERSTE', 'Santander bank → ERSTE');
eq(C.normalizujNazweBanku('Getin Noble Bank'), 'VELO', 'Getin → VELO');
eq(C.normalizujNazweBanku('VeloBank S.A.'), 'VELO', 'Velo');
eq(C.normalizujNazweBanku('ING Bank Śląski S.A.'), 'ING', 'ING śląski');
eq(C.normalizujNazweBanku('mBank S.A.'), 'MBANK', 'mBank');
eq(C.normalizujNazweBanku('Bank Millennium'), 'MILLENNIUM', 'Millennium');
eq(C.normalizujNazweBanku('Alior Bank'), 'ALIOR', 'Alior');
eq(C.normalizujNazweBanku('BNP Paribas'), 'BNP', 'BNP');
eq(C.normalizujNazweBanku('Bank Pocztowy'), 'POCZTOWY', 'Pocztowy');
eq(C.normalizujNazweBanku('Credit Agricole'), 'CA', 'CA');
eq(C.normalizujNazweBanku('Nest Bank'), 'NEST', 'Nest');
eq(C.normalizujNazweBanku('Krakowski Bank Spółdzielczy'), 'KBS', 'KBS');
eq(C.normalizujNazweBanku('SKOK im. Franciszka Stefczyka'), 'SKOK_STEFCZYK', 'Stefczyk');
eq(C.normalizujNazweBanku('SKOK 30000065'), 'SKOK_STEFCZYK', 'kod Stefczyka w środku nazwy');

/* ── CleanForMatch / dłużnik ─────────────────────────────── */
eq(C.cleanForMatch('Kowalski, Jan - A.B.'), 'KOWALSKI JAN A B', 'CleanForMatch');
assert(C.isDebtorMatched('PKO BANK POLSKI', ['PKO BANK POLSKI SA WARSZAWA']), 'dłużnik: wszystkie słowa');
assert(!C.isDebtorMatched('PKO BANK POLSKI', ['PEKAO BANK']), 'dłużnik: brak dopasowania');
assert(!C.isDebtorMatched('', ['X']), 'pusty dłużnik');

/* ── SITO OGNIVO ─────────────────────────────────────────── */
function pad(row, n) {
  const r = row.slice();
  while (r.length < n) r.push('');
  return r;
}

const OGNIVO = [
  ['Podmiot', 'Identyfikator', 'Liczba trafień', 'Zidentyfikowane banki'],
  ['Anna Nowak', '90010112345', '2', '10200003 - PKO BANK POLSKI, 12400001 - BANK PEKAO'],
  ['Jan Kowalski', '85051267890', '1', '11400000 - MBANK'],
  ['Odrzut C=T', '78091054321', '1', 'ING Bank Śląski'],
  ['Odrzut W', '92030198765', '1', 'Alior Bank'],
  ['Brak w SEE.11', '88121223456', '1', 'Nest Bank'],
  ['Bez PESEL', '', '0', '']
];

function see18row(pesel, klas, bank) {
  const r = pad([], 12);
  r[7] = pesel;
  r[10] = klas;
  r[11] = bank;
  return r;
}
function see11row(pesel, klasC, klasN, nip) {
  const r = pad([], 14);
  r[2] = klasC;
  r[5] = nip || '';
  r[6] = pesel;
  r[13] = klasN;
  return r;
}

const SEE18 = [
  pad(['h', '', '', '', '', '', '', 'PESEL', '', '', 'K', 'L'], 12),
  see18row('90010112345', 'A', 'PKO BANK POLSKI S.A.'),
  see18row('85051267890', 'W', 'mBank S.A.'),
  see18row('78091054321', 'A', 'PKO BANK POLSKI S.A.')
];

const SEE11 = [
  pad(['x'], 14),
  see11row('90010112345', 'A', 'A', '1111111111'),
  see11row('85051267890', 'A', 'A', '2222222222'),
  see11row('78091054321', 'T', 'A', '3333333333'),
  see11row('78091054321', 'A', 'A', '3333333333'),
  see11row('92030198765', 'A', 'W1', '4444444444'),
  see11row('11111111111', 'A', 'A', '5555555555')
];

const og = C.analizaOgnivo({ ognivo: OGNIVO, see11: SEE11, see18: SEE18, separator: ';' });
assert(og.ok, 'OGNIVO ok: ' + (og.error || ''));
eq(og.diagnostics.rekordyOgnivo, 5, '5 rekordów z PESEL (pusty wiersz nie liczy się)');
eq(og.diagnostics.rekordyBezPESEL, 1, '1 bez PESEL');
assert(og.diagnostics.liczbaBankowWSEE18 >= 1, 'PKO Anny już w SEE.18');
eq(og.diagnostics.liczbaSEE11Odrzuconych, 2, 'dwa PESEL odrzucone (C=T i W1)');
eq(og.diagnostics.odrzuconeSEE11, 2, 'odrzut przy zderzeniu: C=T i W1');
eq(og.diagnostics.odrzuconeBrakSEE11, 1, 'Nest — brak w SEE.11');
eq(og.diagnostics.dopasowaniaKon, 2, 'do zajęcia: Anna (Pekao nowy) + Jan (mBank, bo SEE.18 miało W)');

const outPesels = og.rows.slice(1).map(r => C.cleanPESEL(r[1])).sort();
deep(outPesels, ['85051267890', '90010112345'], 'PESEL w wyniku OGNIVO');

const anna = og.rows.find(r => C.cleanPESEL(r[1]) === '90010112345');
assert(anna && /PEKAO/i.test(anna[anna.length - 1]), 'Anna: tylko nowy Pekao w brakach');
assert(anna && !/PKO/i.test(anna[anna.length - 1]), 'Anna: PKO nie jest nowy');

const jan = og.rows.find(r => C.cleanPESEL(r[1]) === '85051267890');
assert(jan && /MBANK/i.test(jan[jan.length - 1]), 'Jan: mBank nowy, bo SEE.18 klasyfikacja W pomija wpis');

assert(!og.rows.some(r => C.cleanPESEL(r[1]) === '78091054321'), 'C=T odrzuca cały PESEL mimo drugiej linijki A');
assert(!og.rows.some(r => C.cleanPESEL(r[1]) === '92030198765'), 'N=W1 odrzuca');
assert(!og.rows.some(r => C.cleanPESEL(r[1]) === '88121223456'), 'brak w SEE.11 odrzuca');

const store = C.ognivoRowsToStore(og.rows, og.startRow);
assert(store['90010112345'] && store['90010112345'].banks.length === 1, 'store: Anna 1 bank');

/* ── SITO JPK ────────────────────────────────────────────── */
const PLATFORM = [
  ['NIP', 'B', 'C', 'Dłużnik', 'E', 'F', 'G', 'H', 'I', 'DROP1', 'DROP2', 'DROP3', 'DROP4', 'DROP5', 'Z'],
  ['1111111111', 'x', 'c', 'Nowy Kontrahent Sp', 'e', 'f', 'g', 'h', 'i', 'd1', 'd2', 'd3', 'd4', 'd5', 'keep'],
  ['-', 'x', 'c', 'Kreska A', '', '', '', '', '', '', '', '', '', '', ''],
  ['2222222222', '-', 'c', 'Kreska B', '', '', '', '', '', '', '', '', '', '', ''],
  ['9999999999', 'x', 'c', 'Nie ma w SEE.11', '', '', '', '', '', '', '', '', '', '', ''],
  ['3333333333', 'x', 'c', 'PKO BANK POLSKI', '', '', '', '', '', '', '', '', '', '', ''],
  ['4444444444', 'x', 'c', 'Firma W', '', '', '', '', '', '', '', '', '', '', '']
];

const SEE11J = [
  pad(['h'], 14),
  see11row('', 'A', 'A', '1111111111'),
  see11row('', 'A', 'W', '2222222222'),
  see11row('', 'A', 'A', '3333333333'),
  see11row('', 'A', 'W1', '4444444444')
];

const SEE18J = [
  pad(['h'], 12),
  see18row('90010112345', 'A', 'PKO BANK POLSKI S.A.'),
  see18row('11111111111', 'W', 'Nowy Kontrahent Sp. z o.o.')
];

const jpk = C.analizaJpk({ platforma: PLATFORM, see11: SEE11J, see18: SEE18J });
assert(jpk.ok, 'JPK ok: ' + (jpk.error || ''));
eq(jpk.diagnostics.skippedDash, 2, 'JPK pominięte kreski A/B');
eq(jpk.diagnostics.skippedSee11, 2, 'JPK: 999 poza SEE.11, 444 ma N=W1 (222 odpada wcześniej przez B=„-”)');
eq(jpk.diagnostics.skippedSee18, 1, 'JPK: PKO dopasowany do SEE.18');
eq(jpk.diagnostics.outRows, 1, 'JPK jeden wynik: 1111111111');
eq(C.cleanNIP(jpk.rows[1][0]), '1111111111', 'JPK NIP wyniku');
assert(jpk.rows[0].indexOf('DROP1') < 0, 'JPK: kolumny 10–14 usunięte z nagłówka');
assert(jpk.rows[1].indexOf('d1') < 0, 'JPK: kolumny 10–14 usunięte z danych');
assert(jpk.rows[1].indexOf('keep') >= 0, 'JPK: kolumna 15 zostaje');

const PLATFORM_TITLE = [['Platforma zrzut 1']].concat(PLATFORM);
const jpk2 = C.analizaJpk({ platforma: PLATFORM_TITLE, see11: SEE11J, see18: SEE18J });
assert(jpk2.ok, 'JPK z wierszem Platforma w A1');
eq(C.cleanNIP(jpk2.rows[1][0]), '1111111111', 'JPK title-row: ten sam wynik, nagłówek z wiersza 2');

/* ── SITO AUM ────────────────────────────────────────────── */
const AUM = [
  ['PESEL', 'NIP', 'Imię i nazwisko', 'Adres', 'Klasyfikacja', 'Rachunki AUM'],
  ['90010112345', '', 'Anna Nowak', '', '', 'PKO BANK POLSKI S.A. · BANK PEKAO'],
  ['85051267890', '', 'Jan Kowalski', '', '', 'mBank S.A.'],
  ['78091054321', '', 'Odrzut T', '', '', 'ING Bank Śląski'],
  ['92030198765', '', 'Odrzut W', '', '', 'Alior Bank'],
  ['88121223456', '', 'Brak SEE.11', '', '', 'Nest Bank']
];
const aum = C.analizaAum({ aum: AUM, see11: SEE11, see18: SEE18 });
assert(aum.ok, 'AUM ok: ' + (aum.error || ''));
eq(aum.diagnostics.outRows, 2, 'AUM: Anna + Jan');
assert(aum.rows.some(r => r[0] === '90010112345' && /PEKAO/i.test(r[3]) && !/PKO/i.test(r[3])), 'AUM Anna: tylko nowy Pekao');
assert(aum.rows.some(r => r[0] === '85051267890'), 'AUM Jan: mBank nowy (SEE.18 K=W)');
assert(!aum.rows.some(r => r[0] === '78091054321'), 'AUM: C=T odrzuca');
assert(!aum.rows.some(r => r[0] === '92030198765'), 'AUM: N=W1 odrzuca');
assert(!aum.rows.some(r => r[0] === '88121223456'), 'AUM: brak SEE.11 odrzuca');

/* ── BAZA WRO Z TECZEK ───────────────────────────────────── */
eq(C.classifyWroFolderFile('90010112345.xlsx'), 'dossier', 'teczka PESEL');
eq(C.classifyWroFolderFile('osoba.xlsm'), 'dossier', 'teczka xlsm');
eq(C.classifyWroFolderFile('OGNIVO_wynik.xlsx'), 'ognivo', 'plik wynikowy OGNIVO');
eq(C.classifyWroFolderFile('JPK1_Wynik.xlsx'), 'jpk', 'plik wynikowy JPK');
eq(C.classifyWroFolderFile('SEE.11.xlsx'), null, 'SEE.11 nie jest teczką WRO');
eq(C.wroSectionFromSheetName('Stir'), 'STIR', 'arkusz STIR');
eq(C.wroSectionFromSheetName('Kw'), 'Księgi Wieczyste', 'arkusz Kw');
eq(C.wroSectionFromSheetName('UfgCepik'), 'UFG CEPIK', 'arkusz UFG');
eq(C.wroSectionFromSheetName('CRPZakonczenie'), '_crp', 'arkusz CRP');

const dossierWb = {
  sheetOrder: ['Okladka', 'Raporter', 'STIR', 'CRPZakonczenie'],
  sheets: {
    Okladka: [
      ['x'],
      ['x'],
      ['1111111111', '90010112345']
    ],
    Raporter: [
      ['Kol1', 'Kol2'],
      ['a', 'b']
    ],
    STIR: [
      ['Rachunek'],
      ['PL00']
    ],
    CRPZakonczenie: [
      [],
      [],
      ['', '', '90010112345']
    ]
  }
};
const built = C.buildWroBaza({
  dossiers: [{ name: '90010112345.xlsx', workbook: dossierWb }],
  actions: [{
    kind: 'ognivo',
    name: 'OGNIVO.xlsx',
    workbook: {
      sheetOrder: ['Wynik'],
      sheets: {
        Wynik: [
          ['PESEL', 'Bank'],
          ['90010112345', 'Alior'],
          ['85051267890', 'mBank']
        ]
      }
    }
  }]
});
assert(built['90010112345'], 'baza: teczka po C3/PESEL');
assert(built['90010112345']['Raporter'] && built['90010112345']['Raporter'].length === 2, 'baza: Raporter');
assert(built['90010112345']['STIR'], 'baza: STIR');
assert(built['90010112345']['Wynik: OGNIVO'] && built['90010112345']['Wynik: OGNIVO'].length === 2, 'baza: OGNIVO wstrzyknięte do teczki');
assert(built['85051267890'] && built['85051267890']['Wynik: OGNIVO'], 'baza: stub dla OGNIVO bez teczki');
eq(built['90010112345']._meta.a3, '1111111111', 'meta A3 = NIP');
eq(built['90010112345']._meta.b3, '90010112345', 'meta B3 = PESEL');

/* ── XLSX pierwszy arkusz ────────────────────────────────── */
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) {
    c ^= u8[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const centrals = [];
  let offset = 0;
  Object.keys(files).forEach(name => {
    const nameU8 = enc.encode(name);
    const data = typeof files[name] === 'string' ? enc.encode(files[name]) : files[name];
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameU8.length, 26);
    chunks.push(local, nameU8, Buffer.from(data));
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameU8.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameU8);
    offset += 30 + nameU8.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const n = Object.keys(files).length;
  eocd.writeUInt16LE(n, 8);
  eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat(chunks.concat([cd, eocd]));
}

(async () => {
  const xlsx = zipStore({
    '[Content_Types].xml': '<?xml version="1.0"?><Types></Types>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SEE11" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<?xml version="1.0"?><sst><si><t>PESEL</t></si><si><t>90010112345</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="G1" t="s"><v>1</v></c></row><row r="2"><c r="C2"><v>A</v></c><c r="G2" t="s"><v>1</v></c><c r="N2"><v>A</v></c></row></sheetData></worksheet>'
  });
  const parsed = await C.readXlsxFirstSheet(xlsx);
  eq(parsed.kind, 'xlsx', 'xlsx kind');
  eq(parsed.rows[0][0], 'PESEL', 'xlsx A1 shared string');
  eq(parsed.rows[0][6], '90010112345', 'xlsx G1');
  eq(parsed.rows[1][2], 'A', 'xlsx C2 liczba/tekst');
  eq(parsed.rows[1][13], 'A', 'xlsx N2 (kolumna 14)');

  const multi = zipStore({
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Raporter" sheetId="1" r:id="rId1"/><sheet name="STIR" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>H</v></c></row><row r="2"><c r="A2"><v>1</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>Rachunek</v></c></row><row r="2"><c r="A2"><v>PL1</v></c></row></sheetData></worksheet>'
  });
  const wb = await C.readXlsxWorkbook(multi);
  deep(wb.sheetOrder, ['Raporter', 'STIR'], 'xlsx kolejność arkuszy');
  eq(wb.sheets.Raporter[1][0], '1', 'xlsx Raporter wiersz 2');
  eq(wb.sheets.STIR[1][0], 'PL1', 'xlsx STIR wiersz 2');

  console.log('\nPassed: ' + passed + '  Failed: ' + failed);
  if (failed) process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
