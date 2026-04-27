# Import Contract

`bolagsverket-nyabolaget-v2` är källrepo för daglig sync och snapshot-publicering till Supabase.

## Källor

- SCB rådata per `Registreringsdatum`
- Allabolag-berikning är avstängd och ska inte köras i pipeline eller manuella kommandon

## Publiceringsprincip

- En publicerad snapshot motsvarar exakt ett `snapshot_date`.
- Snapshoten skrivs transaktionellt som:
  - en rad i `public.import_runs`
  - en rad i `public.data_snapshots`
  - många rader i `public.company_snapshots`
- Samma datum kan publiceras om. Då ersätts tidigare `company_snapshots` för det datumet.

## Canonical fält

Varje publicerad rad i `company_snapshots` ska innehålla:

- `snapshot_date`
- `org_number`
- `company_name`
- `legal_form`
- `registration_date`
- `company_status`
- `business_status`
- `county`
- `municipality`
- `industry_code`
- `industry_label`
- `industry`
- `scb_email`
- `scb_phone`
- `allabolag_email`
- `allabolag_phone`
- `email`
- `phone`
- `contact_name`
- `contact_role`
- `marketing_protected`
- `allabolag_lookup_status`
- `imported_at`
- `raw_payload`

## Deriverade regler

- `email` = primär leveransbar e-post
- `phone` = primärt leveransbart telefonnummer
- `industry` = samma som `industry_label`
- `marketing_protected` kommer bara från SCB/rådata om fältet redan finns; Allabolag fyller inte längre på detta
- `allabolag_*`-fält finns kvar av bakåtkompatibilitetsskäl men fylls inte på av importpipelinen

## Listdefinitioner

Följande listor är derivat av canonical snapshot-data och ska inte lagras som egna tabeller:

- `master`
- `mail-only`
- `phone-only`
- `by-lan`
- `by-industry`
- `by-industry-all`
- `delivery-ready`

## Kommandon

- `npm run process -- 2026-04-13`
  - hämtar SCB, publicerar snapshot och skriver exportfiler utan Allabolag-berikning
- `npm run publish:snapshot -- 2026-04-13`
  - publicerar befintlig råfil `raw/YYYY-MM-DD.json`; äldre `raw/enriched/YYYY-MM-DD.json` kan fortfarande läsas om filen finns
- `npm run sync:daily`
  - kör rullande backfill för senaste 10 dagarna för att täcka SCB:s veckosläpp och tisdagssläpp vid röd dag
- `npm run sync:range -- --from=2026-04-07 --to=2026-04-14`
  - kör ett explicit datumintervall äldst till nyast
- `npm run process:admin-requests`
  - processar köade `daily`- och `range`-förfrågningar från `foretagslistor.se`

## Adminförfrågningar

`foretagslistor.se` får skapa rader i `public.admin_import_requests`.

Importrepons ansvar är att:

- läsa väntande förfrågningar i skapelseordning
- markera dem `processing`
- köra rätt kommando
- skriva `processed_dates_json`
- markera `completed` eller `failed`
