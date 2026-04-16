# bolagsverket-nyabolaget-v2

Hämtar företag från SCB för ett exakt registreringsdatum, sparar rådata och bygger säljlister för nya bolag.

## Vad scriptet gör

1. Hämtar alla företag med exakt `Registreringsdatum` för valt datum från SCB.
2. Sparar råexporten till både JSON och XLSX i `output/`.
3. Filtrerar fram relevanta nystartade bolag.
4. Skapar säljlister i JSON, CSV och XLSX i `exports/`.

## Definition av relevant nystartat bolag

En rad behålls om:

- `Registreringsdatum` finns
- `Slutdatum` är tomt
- `Bolagsstatus` = `Normalläge`
- `Företagsstatus` är `Är verksam` eller `Har aldrig varit verksam`

Alla juridiska former behålls.

## Exporter som skapas

För varje körning skapas:

- `output/YYYY-MM-DD.json`
- `output/YYYY-MM-DD.xlsx`
- `exports/YYYY-MM-DD/master/YYYY-MM-DD.json`
- `exports/YYYY-MM-DD/master/YYYY-MM-DD.csv`
- `exports/YYYY-MM-DD/master/YYYY-MM-DD.xlsx`
- `exports/YYYY-MM-DD/mail-only/YYYY-MM-DD.json`
- `exports/YYYY-MM-DD/mail-only/YYYY-MM-DD.csv`
- `exports/YYYY-MM-DD/mail-only/YYYY-MM-DD.xlsx`
- grupperade exporter per `Säteslän`
- grupperade exporter per `Bransch_1`
- `exports/YYYY-MM-DD/stats.json`

## Setup

### 1. Installera beroenden

```bash
npm install
```

### 2. Lägg SCB-certifikatet i `scb/`

Lägg din `.pfx`-fil i mappen `scb/`, eller ange sökvägen via `SCB_PFX_PATH`.

### 3. Ange lösenord till certifikatet

Via miljövariabel:

```bash
SCB_PASSWORD=your-password
```

eller i en `.env`-fil:

```env
SCB_PASSWORD=your-password
SCB_PFX_PATH=./scb/your-certificate.pfx
```

## Körning

Direkt med Node:

```bash
node src/cli.js 2026-03-02
```

eller med npm:

```bash
npm run process -- 2026-03-02
```

## Notering

SCB har en gräns på 2000 rader per request. Scriptet segmenterar då automatiskt vidare på organisationsnummerprefix för att få hem hela dagsmängden.
