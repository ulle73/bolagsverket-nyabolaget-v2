import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAndSaveCompaniesByExactRegistrationDate } from './scb.js';
import { writeSalesExports } from './sales-exports.js';
import { writeDeliveryReady } from './delivery-ready.js';
import { writeIndustryExports } from './industry-exports.js';
import { normalizeForSupabaseRows } from './normalize-for-supabase.js';
import { publishSnapshot } from './publish-snapshot.js';
import { hydrateProcessEnv } from './env-file.js';
import { resolveRuntimePaths } from './runtime-paths.js';
import { hasSupabasePublishingConfig } from './supabase-client.js';
import { assertProcessEnv, assertPublishEnv } from './env-contract.js';

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveTargetDate(args = process.argv.slice(2), now = new Date()) {
  const dateArg = args.find((value) => value && !value.startsWith('--'));

  if (dateArg) {
    return dateArg;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return formatLocalDate(yesterday);
}

export function isCliEntrypoint(modulePath, argvPath) {
  if (!argvPath) {
    return false;
  }

  return path.resolve(modulePath) === path.resolve(argvPath);
}

function buildPassthroughEnrichmentResult(companies, targetDate, options = {}) {
  const sourceResult = options.sourceResult ?? {};

  return {
    companies,
    count: companies.length,
    targetDate,
    filePath: sourceResult.filePath,
    xlsxFilePath: sourceResult.xlsxFilePath,
    stats: {
      Datum: targetDate,
      AntalRåposter: companies.length,
      Status: 'allabolag-enrichment-disabled',
    },
    statsFilePath: '',
    cacheFilePath: '',
  };
}

export async function runCli(
  args = process.argv.slice(2),
  {
    fetchRegistrationDate = fetchAndSaveCompaniesByExactRegistrationDate,
    enrichCompanies = buildPassthroughEnrichmentResult,
    writeSales = writeSalesExports,
    writeDelivery = writeDeliveryReady,
    writeIndustry = writeIndustryExports,
    normalizeRows = normalizeForSupabaseRows,
    publish = publishSnapshot,
    canPublish = hasSupabasePublishingConfig,
    assertProcess = assertProcessEnv,
    assertPublish = assertPublishEnv,
    loadEnv = () => hydrateProcessEnv(),
    write = (message) => process.stdout.write(message),
    now = new Date(),
  } = {},
) {
  if (args.includes('--help') || args.includes('-h')) {
    write('Användning: node src/cli.js [YYYY-MM-DD] [--require-publish]\n');
    write('Om inget datum anges används gårdagens datum i serverns lokala tid.\n');
    write('Datum före 2025-01-01 publiceras automatiskt till arkiv-databasen.\n');
    write('Sätt DATA_DIR eller GOOGLE_DRIVE_DATA_DIR i .env för att skriva till delad Drive-mapp.\n');
    return 0;
  }

  const targetDate = resolveTargetDate(args, now);
  const requirePublish = args.includes('--require-publish');
  const runtimePaths = await resolveRuntimePaths();

  try {
    await loadEnv();
    assertProcess();

    if (requirePublish) {
      assertPublish();
    }

    write(`Kör SCB-pipeline för ${targetDate}\n`);

    if (runtimePaths.baseDir) {
      write(`Sparar filer till delad basmapp: ${runtimePaths.baseDir}\n`);
    }

    const result = await fetchRegistrationDate(targetDate, {
      outputDir: runtimePaths.rawDir,
    });

    write(
      `Sparade rådata från SCB (${result.count} rader) för ${result.targetDate} till ${result.filePath} och ${result.xlsxFilePath}\n`,
    );

    if (result.count === 0) {
      write(`Inga poster hittades för ${result.targetDate}. Inga exportmappar skapades.\n`);
      return 0;
    }

    const enrichmentResult = await enrichCompanies(result.companies, result.targetDate, {
      outputDir: runtimePaths.rawDir,
      stateDir: runtimePaths.stateDir,
      writeProgress: write,
      sourceResult: result,
    });

    write(
      `Hoppar över Allabolag-berikning (${enrichmentResult.count} rader går vidare oförändrade från SCB).\n`,
    );

    const normalizedRows = normalizeRows(enrichmentResult.companies, result.targetDate);

    if (await canPublish()) {
      const publishResult = await publish(normalizedRows, {
        snapshotDate: enrichmentResult.targetDate,
        rawRowCount: result.count,
        details: {
          rawFilePath: result.filePath,
          enrichedFilePath: '',
          xlsxFilePath: result.xlsxFilePath,
        },
        write,
      });

      write(
        `Publicerade snapshot ${publishResult.snapshotDate} till ${publishResult.target} (${publishResult.rowCount} rader, ${publishResult.batchCount} batcher)\n`,
      );
    } else {
      if (requirePublish) {
        throw new Error(
          'Supabase-publicering krävs för den här körningen men SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas.',
        );
      }

      write('Hoppar över snapshot-publicering eftersom SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY saknas.\n');
    }

    const salesExports = await writeSales(enrichmentResult.companies, result.targetDate, {
      outputRoot: runtimePaths.exportsDir,
    });
    const deliveryReady = await writeDelivery(enrichmentResult.companies, result.targetDate, {
      outputRoot: runtimePaths.exportsDir,
      stateDir: runtimePaths.stateDir,
    });
    const industryExports = await writeIndustry(enrichmentResult.companies, result.targetDate, {
      outputRoot: runtimePaths.exportsDir,
    });

    write(`Skapade försäljningsexporter i ${salesExports.rootDir}\n`);
    write(`Master CSV: ${salesExports.files.master.Csvfil}\n`);
    write(`Mail-only CSV: ${salesExports.files['mail-only'].Csvfil}\n`);
    write(`Phone-only CSV: ${salesExports.files['phone-only'].Csvfil}\n`);
    write(`Utskicksklar CSV: ${deliveryReady.files.Csvfil}\n`);
    write(`Phone-only delivery-ready CSV: ${deliveryReady.mirrored.phoneOnly.Csvfil}\n`);
    write(`Utskicksklar manifest: ${deliveryReady.manifestPath}\n`);
    write(`Leveranshistorik: ${deliveryReady.deliveryHistoryFilePath}\n`);
    write(`Telefonleveranshistorik: ${deliveryReady.phoneDeliveryHistoryFilePath}\n`);
    write(`Branschmanifest: ${industryExports.manifestPath}\n`);
    write(`Statistik JSON: ${salesExports.statsFilePath}\n`);
    return 0;
  } catch (error) {
    write(`SCB-körning misslyckades för ${targetDate}: ${error.message}\n`);
    return 1;
  }
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
