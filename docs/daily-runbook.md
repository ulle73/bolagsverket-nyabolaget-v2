# Daily Runbook

## Syfte

Köra den dagliga SCB -> Supabase-pipelinen och hålla `foretagslistor.se` uppdaterad med publicerade snapshots som är färska nog att säljas ifrån.

Allabolag-berikning är avstängd. Pipelinen ska använda SCB-raderna direkt och därefter fortsätta med samma normalisering, publicering och exportsteg som tidigare.

## Produktionskrav

Det här ska köras på en self-hosted runner med persistent `DATA_DIR`.

`DATA_DIR` måste överleva mellan körningar eftersom följande state är operativt viktigt:

- `raw/`
- `exports/`
- `state/leveranshistorik.json`
- `state/telefonleveranshistorik.json`
- `state/daily-sync-state.json`

Kör inte den här pipelinen på Vercel eller på en ephemeral CI-runner utan monterad persistent disk.

## Krävs i miljön

- `DATA_DIR`
- `SCB_PASSWORD`
- `SCB_PFX_PATH`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ARCHIVE_URL`
- `SUPABASE_ARCHIVE_SERVICE_ROLE_KEY`

## Daglig körning

Standardkommandot är:

```bash
npm run sync:daily
```

Det kör senaste 10 dagarna, äldst först. Det är avsiktligt längre än en vecka för att täcka SCB:s normala måndagssläpp, tisdagssläpp vid röd dag och mindre driftglapp. Varje datum går igenom:

1. SCB-hämtning
2. canonical normalisering
3. snapshot-publicering till Supabase
4. derivatfiler för försäljning och leverans

`sync:daily` kräver Supabase-publicering och kommer att faila om publicering inte kan göras.

Verifiera därefter att senaste publicerade snapshot faktiskt är färsk:

```bash
npm run verify:publication -- --max-age-days=9
```

Att vissa dagar ger `0` nya bolag är normalt. Pipelinen ska ändå köras dagligen; det viktiga är att senaste icke-tomma publicerade snapshot fortfarande ligger inom den veckovisa SCB-kadensen.

Efter den schemalagda daily-körningen ska runnern också processa köade adminförfrågningar från `foretagslistor.se`.
Det görs med:

```bash
npm run process:admin-requests
```

I den schemalagda GitHub-workflown ska det steget köras med `ADMIN_IMPORT_DAILY_ALREADY_RAN=1` så att en köad `daily`-förfrågan inte dubblar samma sync direkt efter nattens ordinarie körning.

## Enstaka datum

Kör hela pipelinen för ett specifikt datum:

```bash
npm run process -- 2026-04-13
```

Tvinga samma körning att faila om Supabase-publicering inte är möjlig:

```bash
npm run process -- 2026-04-13 --require-publish
```

Publicera befintliga filer för ett datum:

```bash
npm run publish:snapshot -- 2026-04-13
```

Om du medvetet vill publicera från råfil krävs explicit flagga när ingen tidigare kompatibel fil finns:

```bash
npm run publish:snapshot -- 2026-04-13 --allow-raw-fallback
```

Detta ska bara användas manuellt i undantagsfall.

## Manuellt intervall

Kör ett explicit datumintervall:

```bash
npm run sync:range -- --from=2026-04-07 --to=2026-04-14
```

Det här kommandot används både för manuell backfill i terminal och för köade `range`-förfrågningar från adminpanelen.

## Operativ state

Dagliga körningar skriver ett state-file här:

```txt
$DATA_DIR/state/daily-sync-state.json
```

Per datum lagras minst:

- `status`
- `startedAt`
- `completedAt`
- `exitCode`
- `errorMessage`

Det är första stället att kontrollera när en nattlig sync har fallit.

## Felsökning

Kontrollera senaste publicering i Supabase:

```sql
select snapshot_date, status, raw_row_count, published_row_count, completed_at
from public.import_runs
order by created_at desc
limit 20;
```

Kontrollera publicerade snapshots:

```sql
select snapshot_date, row_count, updated_at
from public.data_snapshots
order by snapshot_date desc;
```

Kontrollera statefilen:

```bash
cat "$DATA_DIR/state/daily-sync-state.json"
```

## Återhämtning

- Om SCB-hämtningen misslyckar: kör om `npm run process -- YYYY-MM-DD --require-publish`
- Om publiceringen misslyckar: kör om hela datumet via `npm run process -- YYYY-MM-DD --require-publish`
- Om exportfilerna är trasiga men snapshoten är publicerad: kör om `npm run process -- YYYY-MM-DD --require-publish`

## Produktionsscheduler

GitHub-workflown i `.github/workflows/daily-import.yml` är avsedd för:

- self-hosted Linux-runner
- persistent `FORETAGSLISTOR_DATA_DIR`
- SCB-certifikat via secret
- rullande 10-dagars backfill

Den workflown ska behandlas som den primära scheduler-konfigurationen för drift.

Efter sync kör workflown också `verify:publication` för att faila om senaste snapshot fortfarande är för gammal eller saknas.
