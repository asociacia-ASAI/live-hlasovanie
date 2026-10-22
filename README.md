# Live hlasovanie – Google Formulár → web na Verceli

Študenti naskenujú QR kód, vyplnia Google Formulár a výsledky sa na webe
aktualizujú každé 3 sekundy. Všetko beží zadarmo (Google + GitHub + Vercel Hobby).

## Ako to funguje

Formulár → odpovede idú do Google Sheetu → Vercel funkcia `/api/results`
číta tabuľku a spočíta hlasy → stránka si ich každé 3 s vypýta a prekreslí grafy.

Web sám rozpozná typ otázky:
- výber z možností / stupnica → pruhový graf
- zaškrtávacie políčka → pruhový graf (súčet môže byť nad 100 %)
- otvorená odpoveď → zoznam posledných 30 odpovedí

## 1. Prepoj formulár s tabuľkou (2 min)

1. Otvor formulár → záložka **Odpovede** → **Prepojiť s Tabuľkami** → *Vytvoriť novú tabuľku*.
2. V tabuľke klikni **Zdieľať** → Všeobecný prístup: **Ktokoľvek s odkazom** → **Čitateľ**.
3. Skopíruj ID tabuľky z URL: `docs.google.com/spreadsheets/d/`**`TOTO_JE_ID`**`/edit`

## 2. Nahraj kód na GitHub (3 min)

1. Na github.com → **New repository** → názov napr. `live-hlasovanie` → Create.
2. Klikni **uploading an existing file** a pretiahni všetky súbory z tohto priečinka
   (`index.html`, `package.json`, `README.md` a priečinok `api`). → **Commit changes**.

## 3. Nasaď na Vercel (3 min)

1. vercel.com → prihlás sa cez GitHub → **Add New… → Project** → vyber repo → **Import**.
2. Pred kliknutím na Deploy otvor **Environment Variables** a pridaj:

| Názov | Hodnota |
|---|---|
| `SHEET_ID` | ID tabuľky z kroku 1 |
| `TITLE` | napr. `Anketa – AI v škole` (nepovinné) |
| `FORM_URL` | odkaz na vyplnenie formulára (nepovinné, predvolene je nastavený tvoj) |
| `SHEET_NAME` | názov hárku, len ak odpovede nie sú na prvom hárku (nepovinné) |

3. **Deploy**. O minútu máš adresu typu `live-hlasovanie.vercel.app`.

Bez `SHEET_ID` web ukazuje ukážkové dáta – dobré na otestovanie, že nasadenie prebehlo.

## Na prednáške

- Premietni web. Klikni na malý QR kód vpravo hore → zobrazí sa cez celú obrazovku.
  Ďalším kliknutím sa vrátiš k výsledkom.
- Pred prednáškou vo formulári skontroluj, že **nevyžaduje prihlásenie** (Nastavenia →
  Odpovede → vypni „Obmedziť na 1 odpoveď“, ak nechceš nútiť študentov prihlasovať sa do Google).

## Súkromie

Tabuľka je čitateľná pre každého, kto pozná jej odkaz. ID je uložené len vo Verceli
(na webe sa nezobrazuje), ale do formulára nezbieraj mená, e-maily ani iné osobné údaje.
Po akcii môžeš zdieľanie tabuľky vypnúť.

## Režim prezentácie

Klikni na ktorúkoľvek otázku a zobrazí sa cez celú obrazovku.
Šípkami ← → prepínaš otázky, klávesom Esc (alebo klikom) sa vrátiš na prehľad.
Stupnice (1–5, 1–10) sa zobrazia ako stĺpce s priemerom, ostatné otázky ako pruhy,
pričom vedúca odpoveď je zvýraznená oranžovou.

## Pódium (1., 2., 3. miesto)

Otázky, ktorých text obsahuje slovo „najčastejšie“, sa zobrazia ako stupne víťazov
(1. miesto v strede, 2. vľavo, 3. vpravo, ďalšie miesta pod pódiom).
Ak chceš pódium pri inej otázke, pridaj vo Verceli premennú `PODIUM` s časťou textu
otázky (viac otázok oddeľ čiarkou), napr. `najčastejšie,obľúbený`.
