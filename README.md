# bolagsverket-nyabolaget-v2

Hämtar företag från SCB, sparar rådatan i `raw/` och bygger säljlister i `exports/`.

## Körning

Specifikt datum:

`npm run process -- 2026-03-02`

Utan datum:

`npm run process`

Om inget datum skickas in används gårdagens datum i serverns lokala tid.
