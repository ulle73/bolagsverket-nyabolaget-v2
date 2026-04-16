# Lokal körning

## Nuvarande status

Kärnstrukturen för v2 finns i `src/` och kan köras direkt med Node.

## Körning

```bash
node src/index.js raw/2026-03-02.json
```

## Vad som genereras

- `processed/master_<datum>.csv`
- `exports/full_<datum>.csv`
- `exports/mail_only_<datum>.csv`
- `exports/by_lan/<lan>_<datum>.csv`
- `exports/stats_<datum>.json`

## Filterlogik

En rad behålls om:

- `Registreringsdatum` finns
- `Slutdatum` är tomt
- `Bolagsstatus` = `Normalläge`
- `Företagsstatus` är `Är verksam` eller `Har aldrig varit verksam`

## Nästa naturliga steg

- lägga till branschspecifika exporter
- validera e-postformat
- lägga till databaslager
- koppla till foretagslistor.se
