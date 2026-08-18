# Dane testowe — 15 fikcyjnych osób (Arkusz + Szafka + WRO)

Dwa pliki do szybkiego przetestowania integracji Arkusz ↔ Szafka teczek ↔ Analityka WRO,
bez potrzeby ręcznego wpisywania danych.

- `arkusz-szafka-baza-testowa.json` — 14 fikcyjnych osób/firm z pełnym kompletem kolumn
  (PESEL/NIP, adres, systemy KAWA/SINF/UFG/JPK/INFZ, Zawieszone). Ten sam plik działa
  **i w Arkuszu, i w Szafce** — to jest po prostu format skoroszytu.
- `wro-baza-testowa.js` — baza WRO (12 podmiotów) w formacie, jaki normalnie generuje
  makro Excela — gotowa do wgrania przyciskiem **„📥 Wczytaj bazę danych (.js)”** w module
  Analityka WRO (plik jest zapisany w UTF-16LE, tak jak realny eksport z makra).

15. osoba (PESEL `99010112399`) istnieje **tylko w WRO**, nie ma dla niej teczki w
Szafce — to jest specjalnie zrobiony przypadek do przetestowania listy „brakuje teczki”.

## Jak wgrać

### 1. Arkusz
W module **Arkusz** → przycisk **„Wczytaj”** w górnym pasku narzędzi (koło „Zapisz”)
→ wskaż `arkusz-szafka-baza-testowa.json`. Powinna się pojawić karta **„Zobowiązani”**
z 14 wierszami.

### 2. Szafka teczek
Jeśli Arkusz jest już otwarty z tymi danymi, Szafka zsynchronizuje się z nim automatycznie.
Można też wgrać ten sam plik od razu w Szafce, bez Arkusza: **Szafka teczek → „Wczytaj bazę”**
→ wskaż `arkusz-szafka-baza-testowa.json`.

### 3. Analityka WRO
**Analityka WRO** → **„📥 Wczytaj bazę danych (.js)”** → wskaż `wro-baza-testowa.js`.
Powinno się pojawić 12 podmiotów. Potem kliknij **„🔄 Synchronizuj z Szafką”**, żeby
przenieść dane do zakładki Majątek w teczkach.

## Co przetestować i czego się spodziewać

| Osoba (PESEL/NIP) | Scenariusz |
|---|---|
| Kowalski Jan (1) — `90010112345` | Komplet w Arkuszu, **bez danych WRO** — zakładka Majątek pokazuje komunikat o braku synchronizacji |
| Kowalski Jan (2) — `85051267890` | Ma OGNIVO (2 banki) + STIR — po synchronizacji powinien dostać badge **„🔥 Nowość WRO”** |
| Kowalski Jan (3) — `78091054321` | Ma AUM + Dochody (max 60 000 zł) — test filtra „min. dochód” i badge dochodu |
| Kowalski Jan (4) — `92030198765` | Braki w systemach, WRO: JPK + Raporter |
| Kowalski Jan (5) — `88121223456` | WRO: STIR + Księgi Wieczyste |
| Kowalski Jan (6) — `95070734567` | **Zawieszona** + WRO: OGNIVO — nie powinna dostać badge nowości (bo zawieszona) |
| Kowalski Jan (7) — `82041545678` | **Zawieszona** + WRO: AUM + STIR — bez badge nowości |
| Kowalski Jan (8) — `91112856789` | Bez danych WRO |
| Kowalski Jan (9) — `87061967890` | Bez danych WRO |
| Kowalski Jan (10) — `93022078901` | WRO: CRCM + Kontrahenci: ZAKUP (sekcje informacyjne — bez badge, bo to nie „Wynik:”) |
| Firma Kowalski Sp. z o.o. (11) — NIP `1234567890` | Dopasowanie **po NIP** — UFG CEPIK + Wynik: JPK |
| Firma Nowak i Wspólnicy (12) — NIP `9876543210` | Dopasowanie po NIP — Przychód + Wynik: OGNIVO |
| *(brak w Szafce)* — `99010112399` | Istnieje tylko w WRO → po synchronizacji powinna wylądować na liście **„brakuje teczki”** w dialogu i pod chipem **„🗂 Bez teczki w Szafce”** |
| Kowalski Jan (14) — `84030412345` | Dochody 120 000 zł — wysoki dochód (badge z innym kolorem) |
| Kowalski Jan (15) — `90111523456` | „Komplet danych” — wszystkie sekcje WRO naraz (OGNIVO, STIR, AUM, JPK, Dochody, Kontrahenci) |

### Test „zniknięcia” (Przegląd zniknięć)
Żeby przetestować kolejkę „Przegląd zniknięć”: po pierwszej synchronizacji, w pliku
`wro-baza-testowa.js` usuń ręcznie jedną sekcję (np. `"STIR"` osobie `85051267890`),
wgraj plik ponownie i kliknij **„🔄 Synchronizuj z Szafką”** jeszcze raz — osoba powinna
trafić do kolejki **„⚠️ Przegląd zniknięć”** z pytaniem Archiwizuj / Zostaw.

## Uwaga

To są **w 100% fikcyjne dane** (imiona, PESEL, NIP, adresy, kwoty) — nie odpowiadają
żadnym realnym osobom czy sprawom. Numery PESEL/NIP nie mają poprawnej sumy kontrolnej,
ale aplikacja i tak dopasowuje wyłącznie po cyfrach, więc to nie ma znaczenia dla testów.

## Zrzutnia w Analityce WRO

W **Analityce WRO** → **Wskaż folder** (ten sam zestaw co kiedyś `A:\Automaty\1_Zrzutnia\`),
potem przycisk **JPK** / **OGNIVO** / **AUM**. Wynik wchodzi na listę jako `Wynik: JPK` /
`Wynik: OGNIVO` / `Wynik: AUM`.

Mini-zestaw (fikcyjne PESEL-e z bazy 15 osób):

| Plik | Rola |
|---|---|
| `ognivo-sita.csv` | wynik OGNIVO (A podmiot, B PESEL, D banki) |
| `see11-sita.csv` | SEE.11 (C klasyfikacja, F NIP, G PESEL, N klasyfikacja) |
| `see18-sita.csv` | SEE.18 (H PESEL, K klasyfikacja, L bank/wierzyciel) |
| `platforma-sita.csv` | Platforma do sita JPK |
| `aum-sita.csv` | AUM (PESEL + rachunki w kolumnie F, rozdzielane `·`) |

Oczekiwany **OGNIVO** i **AUM**: Anna Nowak (nowy Pekao) i Jan Kowalski (mBank,
bo w SEE.18 ma K=W). Odrzut C=T / N=W1 / brak w SEE.11 nie przechodzą.

Oczekiwany **JPK**: jeden wiersz NIP `1111111111`.
