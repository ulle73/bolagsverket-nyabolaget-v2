# revenue-enricher



node revenue-enricher/enrich.js --1000 --stockholm --headless=1 --delay=6000 --jitter=3000



Skript som berikar bolag med omsättning (och resultat, bolagsform, registreringsår)
från allabolag.se via deras publika `bransch-sök`-sökning och företagssidor.

Skriptet öppnar allabolag i en riktig browser (Playwright eller Puppeteer, samma
mönster som `phone-enrich.js`) eftersom allabolags JSON-endpoints är blockerade.
Det följer första träffen i sökresultatet till företagssidan och läser ut
`Omsättning`, `Resultat efter finansnetto`, `Bolagsform` och `Registreringsår`
från `StatsWidget`-blocken, samt `Organisationsnummer`, `Omsättning intervall`
och `Telefon` från den officiella företagsinformationen
(`OfficialCompanyInformationCard`). Omsättningsintervall och telefon fångas även
för enskilda näringsidkare som saknar full årsredovisning.

## Batch-läge: berika de N äldsta bolagen (`--N`)

```bash
node revenue-enricher/enrich.js --200
node revenue-enricher/enrich.js --200 --headless=1 --out=revenue-enricher/oldest.json
```

`--N` (t.ex. `--200`) hämtar de N **äldsta** bolagen (lägsta registreringsdatum)
från Supabase. De äldsta bolagen ligger i arkiv-databasen; om arkivet inte räcker
faller skriptet tillbaka till aktiva databasen. Bolag dedupliceras på org.nr.

### Platsfilter (t.ex. `--stockholm`)

```bash
node revenue-enricher/enrich.js --200 --stockholm --headless=1
node revenue-enricher/enrich.js --500 --location="västra götaland" --headless=1
```

Lägg till en platsflagga för att bara hämta bolag där **län (`county`), kommun
(`municipality`) ELLER postort (`postal_city`)** innehåller platsen. Matchningen är
skiftlägesokänslig och gör en delsträngsmatchning, så `--stockholm` fångar bl.a.
län Stockholm, kommun Stockholm och postort STOCKHOLM (samt kringkommuner i länet
som Danderyd, Huddinge osv).

- Enkel plats utan specialtecken: `--stockholm`, `--göteborg`, `--malmö`.
- Plats med bindestreck/blanksteg: använd `--location="västra götaland"`.
- Vid platsfilter blir standardfilen `oldest-revenue-<plats>.json` (om `--out` inte anges),
  så olika platser hamnar i olika checkpoint-filer.

För varje bolag söks org.nr upp på allabolag och skriptet skriver `name`, `orgnr`,
`county`, `municipality`, `postalCity`, `revenue`, `revenueRange`, `phone`, `status`
m.m. till en JSON-fil.

- **Checkpoint:** filen sparas var 5:e bolag (och alltid vid avslut), så en avbruten
  körning inte tappar allt.
- **Återupptagning:** redan hämtade org.nr i checkpoint-filen hoppas över vid omkörning,
  så du kan stoppa och köra igen utan att hämta om samma bolag. Kör du ett större `--N`
  fortsätter den bara med de nya bolagen.
- **Verifiering:** sökt org.nr jämförs mot org.nr på profilsidan (maskerade personnummer
  som `400224-XXXX` hanteras). Vid missmatch sätts `status: "mismatch"`.
- **Rate limit-skydd:** en paus (`--delay`, default 4000 ms) med slumpmässig jitter
  (`--jitter`, default 2000 ms) läggs mellan varje bolag. Vid blockering/fel görs
  automatiska omförsök (`--retries`, default 3) med exponentiell backoff.
- Kräver Supabase-credentials i `.env` (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
  och `SUPABASE_ARCHIVE_URL` / `SUPABASE_ARCHIVE_SERVICE_ROLE_KEY`).

Standardfil om `--out` saknas: `revenue-enricher/oldest-revenue.json`.

## Användning (enstaka sökningar)

```bash
npm run revenue:enrich -- "DLE redovisning"
npm run revenue:enrich -- --query="DLE redovisning" --year=2025
npm run revenue:enrich -- --orgnr=5591234567 --json
npm run revenue:enrich -- "Bolag A" "Bolag B" "Bolag C" --year=2025 --json --out=revenue.json
```

Kör headless (inga browserfönster):

```bash
node revenue-enricher/enrich.js --headless=1 --year=2025 "DLE redovisning"
```

## Flaggor

| Flagga          | Beskrivning                                                          |
| --------------- | -------------------------------------------------------------------- |
| `--N`           | Batch-läge: hämta de N äldsta bolagen från databasen (t.ex. `--200`).|
| `--PLATS`       | Platsfilter i batch-läge: län/kommun/postort (t.ex. `--stockholm`).  |
| `--location=X`  | Platsfilter för platser med bindestreck/blanksteg (t.ex. `--location="västra götaland"`). |
| `--query=TEXT`  | Sökfras till allabolag (kan anges flera gånger).                     |
| `--orgnr=XXXX`  | Organisationsnummer att söka på (kan anges flera gånger).           |
| `--year=YYYY`   | Förväntat år för omsättningen (t.ex. 2025). Används när rubriken saknar år. |
| `--limit=N`     | Antal företagsmatchningar att följa per sökning (default 1).         |
| `--delay=MS`    | Paus mellan bolag i batch-läge (default 4000 ms).                    |
| `--jitter=MS`   | Slumpmässigt påhäng ovanpå delay (default 2000 ms).                  |
| `--retries=N`   | Antal omförsök med backoff vid blockering (default 3).               |
| `--headless=1`  | Tvinga headless-läge för browsern (annars synligt fönster).          |
| `--json`        | Skriv resultatet som JSON istället för läsbar text.                 |
| `--out=FIL`     | Skriv resultatet till en fil (checkpoint-fil i batch-läge).         |
| `--help`, `-h`  | Visa hjälptext.                                                      |

## Miljövariabler

- `ALLABOLAG_HEADLESS=1` – motsvarar `--headless=1` om flaggan inte ges.

## Resultat

Enstaka sökning ger objekt med `status` (`found` / `missing` / `not-found` /
`mismatch` / `error`), `revenue`, `revenueYear`, `revenueRange`, `phone`, `result`,
`legalForm`, `registeredYear`, `orgOnPage`, `orgMatch`, `profileUrl` och `note`.

Batch-läge (`--N`) skriver en array med `name`, `orgnr`, `revenue`, `revenueYear`,
`revenueRange`, `phone`, `status`, `orgMatch` och `profileUrl` per bolag.
