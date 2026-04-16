# Excel-stöd

Jag kunde inte skriva över befintliga `package.json` via connectorn, så jag lade till en separat Excel-klar körväg.

## Nya filer

- `src/lib/excel-exporters.js`
- `src/index.excel.js`
- `PACKAGE_EXCEL_TEMPLATE.json`

## Så aktiverar du det fullt ut

1. Ersätt innehållet i repo-ts befintliga `package.json` med innehållet i `PACKAGE_EXCEL_TEMPLATE.json`
2. Kör:

```bash
npm install
```

3. Kör därefter:

```bash
npm run process:excel -- raw/2026-03-02.json
```

## Vad som genereras

För varje CSV genereras nu också motsvarande XLSX:

- `processed/master_<datum>.csv`
- `processed/master_<datum>.xlsx`
- `exports/full_<datum>.csv`
- `exports/full_<datum>.xlsx`
- `exports/mail_only_<datum>.csv`
- `exports/mail_only_<datum>.xlsx`
- `exports/by_lan/<lan>_<datum>.csv`
- `exports/by_lan/<lan>_<datum>.xlsx`
