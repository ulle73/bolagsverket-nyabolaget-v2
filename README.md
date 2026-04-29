# bolagsverket-nyabolaget-v2

Daglig data-pipeline för `foretagslistor.se`.

Det här repot ansvarar för:

- SCB-hämtning per registreringsdatum
- normalisering till canonical snapshot-rader
- publicering till Supabase
- derivatfiler för `master`, `mail-only`, `phone-only`, `by-lan`, `by-industry` och `delivery-ready`

Allabolag-berikning är avstängd. Importpipelinen ska fortsätta använda SCB-raderna direkt så att sparning, filtrering, export och publicering fungerar som tidigare utan externa uppslagningar.

## Produktionsprincip

`foretagslistor.se` ska bara läsa publicerade snapshots från Supabase.

Det här repot är därför system of record för:

1. att skapa dagens canonical snapshot
2. att publicera snapshoten transaktionellt
3. att skriva operativ state till persistent `DATA_DIR`

## Kommandon

Kör hela pipelinen för ett specifikt datum:

```bash
npm run process -- 2026-04-13
```

Kräv att samma körning också publicerar till Supabase:

```bash
npm run process -- 2026-04-13 --require-publish
```

Kör hela pipelinen för gårdagen:

```bash
npm run process
```

Publicera befintliga filer till Supabase för ett datum:

```bash
npm run publish:snapshot -- 2026-04-13
```

Tillåt rådata-fallback uttryckligen:

```bash
npm run publish:snapshot -- 2026-04-13 --allow-raw-fallback
```

Kör rullande backfill för senaste 10 dagarna (publicerar automatiskt):

```bash
npm run sync:daily
```

Det kommandot ska köras varje dag även om SCB oftast bara ger nya företag en gång i veckan. Normalt kommer släppet på måndag, eller tisdag om måndagen är röd dag.

Kör ett manuellt datumintervall (publicerar automatiskt till rätt databas):

```bash
# För backfill till arkiv (datum före 2019-01-01)
npm run sync:range -- --from=2008-01-01 --to=2018-12-31
```

## Arkiv-hantering (Dual-DB)

Pipelinen routar automatiskt data baserat på snapshot-datum:

- **Arkiv (< 2019-01-01):** Hamnar i `SUPABASE_ARCHIVE_URL` (Projekt: `foretagslistor-se-archive`)
- **Aktiv (≥ 2019-01-01):** Hamnar i `SUPABASE_URL` (Projekt: `foretagslistor-se-active`)

Se till att både de vanliga och `SUPABASE_ARCHIVE_*` variablerna är satta i din `.env` för att historisk import ska fungera.

Processa köade adminförfrågningar från `foretagslistor.se`:

```bash
npm run process:admin-requests
```

Verifiera att senaste publicerade snapshot är färsk:

```bash
npm run verify:publication -- --max-age-days=9
```

Kör tester:

```bash
npm test
```

## Miljövariabler

För full pipeline:

- `DATA_DIR`
- `SCB_PASSWORD`
- `SCB_PFX_PATH`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Drift

Den schemalagda daily-körningen ska ligga på en self-hosted runner med persistent `DATA_DIR`.

State som måste överleva mellan körningar:

- leveranshistorik
- daily sync state
- rå- och exportfiler

Manuella adminkörningar via `foretagslistor.se/admin` kan däremot köras direkt via GitHub Actions `workflow_dispatch` på GitHub-hosted Linux. Då används en temporär runtime-mapp bara för den enskilda körningen, medan publiceringen till Supabase fortfarande sker på samma sätt som vanligt.

## Webbadmin

`foretagslistor.se` kan skapa två typer av förfrågningar i tabellen `admin_import_requests`:

- `daily`
- `range`

Det här repot ansvarar för att plocka upp och exekvera dem. Webbappen är bara kontrollager.

## Dokumentation

- [docs/import-contract.md](./docs/import-contract.md)
- [docs/daily-runbook.md](./docs/daily-runbook.md)
