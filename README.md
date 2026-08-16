# egzebiurko-3.0

Aplikacja lokalna do pracy ze sprawami: **Arkusz**, **Baza zobowiązanych**, **OGNIVO**, **Analityka WRO**.

- bez instalacji Node / npm
- bez serwera produkcyjnego i bazy SQL
- dane spraw wczytujesz z własnych plików na dysku

## Struktura

```text
egzebiurko-3.0/
├── index.html
├── app.js
├── arkusz.js
├── ognivo.js
├── wro.js
├── zobowiazani.js
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

### Gdy Python jest zablokowany

Otwórz `index.html` dwuklikiem. Potem:

1. **Analityka WRO** → **Wczytaj bazę danych (.js)** → wskaż plik bazy
2. **OGNIVO** → przeciągnij pliki `.xml`

## Co wczytywać

| Moduł | Plik |
|-------|------|
| Analityka WRO | baza `.js` / `.json` z makra Excel |
| OGNIVO | odpowiedzi banków `.xml` |
| Szafka teczek | baza `.json` / `.js` (przycisk **Wczytaj JSON**) albo dane z Arkusza |
| Arkusz | `html/arkusz3.html` (w paczce ZIP) |

## Uwagi

- Jeśli coś „nie ładuje”, użyj `scripts/serve.py` zamiast otwierania pliku z dysku.
- Dane zostają w przeglądarce na tym komputerze (`localStorage`).
