import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAndSaveCompaniesByExactRegistrationDate } from './scb.js';
import { writeSalesExports } from './sales-exports.js';
import { writeDeliveryReady } from './delivery-ready.js';
import { writeIndustryExports } from './industry-exports.js';
import { resolveRuntimePaths } from './runtime-paths.js';

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

export async function runCli(
  args = process.argv.slice(2),
  {
    fetchRegistrationDate = fetchAndSaveCompaniesByExactRegistrationDate,
    writeSales = writeSalesExports,
    writeDelivery = writeDeliveryReady,
    writeIndustry = writeIndustryExports,
    write = (message) => process.stdout.write(message),
    now = new Date(),
  } = {},
) {
  if (args.includes('--help') || args.includes('-h')) {
    write('Användning: node src/cli.js [YYYY-MM-DD]\n');
    write('Om inget datum anges används gårdagens datum i serverns lokala tid.\n');
    write('Sätt DATA_DIR eller GOOGLE_DRIVE_DATA_DIR i .env för att skriva till delad Drive-mapp.\n');
    return 0;
  }

  const targetDate = resolveTargetDate(args, now);
  const runtimePaths = await resolveRuntimePaths();

  try {
    write(`Kör SCB-pipeline för ${targetDate}\n`);

    if (runtimePaths.baseDir) {
      write(`Sparar filer till delad basmapp: ${runtimePaths.baseDir}\n`);
    }

    const result = await fetchRegistrationDate(targetDate, {
      outputDir: runtimePaths.rawDir,
    });
    const salesExports = await writeSales(result.companies, result.targetDate, {
      outputRoot: runtimePaths.exportsDir,
    });
    const deliveryReady = await writeDelivery(result.companies, result.targetDate, {
      outputRoot: runtimePaths.exportsDir,
      stateDir: runtimePaths.stateDir,
    });
    const industryExports = await writeIndustry(result.companies, result.targetDate, {
      outputRoot: runtimePaths.exportsDir,
    });

    write(
      `Sparade rådata från SCB (${result.count} rader) för ${result.targetDate} till ${result.filePath} och ${result.xlsxFilePath}\n`,
    );
    write(`Skapade försäljningsexporter i ${salesExports.rootDir}\n`);
    write(`Master CSV: ${salesExports.files.master.Csvfil}\n`);
    write(`Mail-only CSV: ${salesExports.files['mail-only'].Csvfil}\n`);
    write(`Utskicksklar CSV: ${deliveryReady.files.Csvfil}\n`);
    write(`Utskicksklar manifest: ${deliveryReady.manifestPath}\n`);
    write(`Leveranshistorik: ${deliveryReady.deliveryHistoryFilePath}\n`);
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
