# Phone-Only Audience Design

**Datum:** 2026-04-23

**Mål:** Lägg till `phone-only` överallt där `mail-only` redan finns, och skapa motsvarande `delivery-ready`-filer för telefonlistor.

**Beslut:**
- `phone-only` blir ett förstaklass-segment i sällexporterna, parallellt med `master` och `mail-only`.
- Urvalet för `phone-only` är samma säljurval som idag, men med kravet att primärt telefonnummer inte är tomt.
- `phone-only` skrivs ut i toppnivå, `by-lan`, `by-industry` och `by-industry-all`.
- `delivery-ready` för telefonlistor skrivs som speglade filer under `phone-only`-mapparna, på samma sätt som dagens `mail-only`-filer.
- Telefonflödet får separat historik och identitet så att telefonleveranser inte blandas ihop med e-postleveranser.

**Påverkade filer:**
- `src/sales-exports.js`
- `src/industry-exports.js`
- `src/delivery-ready.js`
- `src/history-state.js`
- `src/cli.js`
- `README.md`

**Verifiering:**
- Enhetstest för att `buildSalesSegments` skapar `phone-only`.
- Filsystemstest för att `writeSalesExports`, `writeIndustryExports` och `writeDeliveryReady` skriver `phone-only`-filer på rätt ställen.
- CLI-verifiering via riktade `node --test`-körningar.
