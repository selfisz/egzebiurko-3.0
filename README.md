# egzebiurko-3.0

Aplikacja **w 100% lokalna / offline**: **Arkusz**, **Szafka teczek**, **OGNIVO**, **Analityka WRO**, narzędzia.

- bez instalacji Node / npm
- bez serwera w chmurze i bazy SQL
- **bez połączeń z internetem** (CSP: `connect-src 'none'`, brak CDN)
- dane spraw tylko z plików, które sam wczytasz; świeża instalacja = **pusto**
- stan zostaje w `localStorage` **tej** przeglądarki na tym komputerze

## Struktura

```text
egzebiurko-3.0/
├── index.html
├── app.js
├── arkusz.js
├── ognivo.js
├── automaty-core.js / automaty.js   ← zrzutnia + składanie bazy WRO z teczek
├── wro.js
├── zobowiazani.js
├── akumulator.js / rozliczenia.js / przelew.js / balanser.js
├── html/arkusz3.html  ← Arkusz
├── scripts/serve.py
└── README.md
```

## Uruchomienie (ZIP)

1. Na GitHubie: **Code → Download ZIP**.
2. Rozpakuj archiwum.
3. Wejdź do folderu z `index.html` (np. `egzebiurko-3.0-main`).
4. Uruchom:

```bash
python scripts/serve.py
```

albo:

```bash
python -m http.server 8080
```

5. Otwórz: **http://127.0.0.1:8080/**

Lokalny `serve.py` / `http.server` tylko serwuje pliki z dysku — **nic nie wysyła do sieci**.

### Gdy Python jest zablokowany

Otwórz `index.html` dwuklikiem. Potem:

1. **Analityka WRO** → **Wczytaj bazę danych (.js)** → wskaż plik bazy
2. **OGNIVO** → przeciągnij pliki `.xml`

## Co wczytywać

| Moduł | Plik |
|-------|------|
| Analityka WRO | folder teczek (setki `.xlsx` / `.xlsm`, 10 zakładek, PESEL = `CRPZakonczenie` kol. B) → **Zbuduj bazę WRO**; folder zrzutni → JPK/OGNIVO/AUM; albo gotowy `baza_danych.js` |
| OGNIVO | odpowiedzi banków `.xml` |
| Szafka teczek | baza `.json` / `.js` (przycisk **Wczytaj JSON**) albo dane z Arkusza |
| Wklepywator Excel (zakładka 1) | generator wierszy Excela + lista zbiorcza / Ctrl+V z programu A |
| Rozliczenia (zakładka 2) | wbudowany weryfikator EXCEL↔EGA + analizator ZDP |
| Druk przelewu (zakładka 3) | generator druku polecenia przelewu / schematu |
| Balanser (zakładka 4) | korekta należności / alokacja zwrotu na odsetki |
| Arkusz | `html/arkusz3.html` (w paczce ZIP) |

**Karty narzędzi:** LPM w menu po lewej otwiera kartę u góry; **PPM** — otwórz / zamknij / zamknij inne (jak w przeglądarce). Stan formularzy zostaje przy przełączaniu.

## Offline / prywatność

- Brak Google Fonts, analytics, API, telemetrii.
- Arkusz ma osobne CSP (`connect-src 'none'`).
- Shell (`index.html`) też blokuje `connect-src` i zewnętrzne fonty.
- Dane nie wychodzą z przeglądarki, dopóki sam nie użyjesz **Zapisz** / **Zapisz wszystko** (plik na dysk).

## Uwagi

- Jeśli coś „nie ładuje”, użyj `scripts/serve.py` zamiast otwierania pliku z dysku.
- Dane zostają w przeglądarce na tym komputerze (`localStorage`).
