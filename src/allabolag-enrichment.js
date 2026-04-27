import { formatOutputDate } from './scb.js';

// Allabolag enrichment is intentionally disabled.
// Keep this module as a no-op compatibility layer so older imports do not trigger
// external lookups, Puppeteer startup, cache writes, or enriched checkpoint work.

export function shouldDisableBrowserSandbox() {
  return false;
}

export function resolveBrowserArgs() {
  return [];
}

export async function enrichAndSaveCompaniesWithAllabolag(
  companies,
  targetDate,
  options = {},
) {
  const formattedDate = formatOutputDate(targetDate);
  const sourceResult = options.sourceResult ?? {};
  const log =
    typeof options.writeProgress === 'function' ? options.writeProgress : () => {};

  log(
    `Allabolag-berikning är avstängd. ${companies.length} SCB-rader går vidare oförändrade.\n`,
  );

  return {
    companies,
    count: companies.length,
    targetDate: formattedDate,
    filePath: sourceResult.filePath ?? '',
    xlsxFilePath: sourceResult.xlsxFilePath ?? '',
    stats: {
      Datum: formattedDate,
      AntalRåposter: companies.length,
      Status: 'allabolag-enrichment-disabled',
    },
    statsFilePath: '',
    cacheFilePath: '',
  };
}
