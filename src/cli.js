import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAndSaveCompaniesByExactRegistrationDate } from './scb.js';
import { writeSalesExports } from './sales-exports.js';

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
    write = (message) => process.stdout.write(message),
    now = new Date(),
  } = {},
) {
  if (args.includes('--help') || args.includes('-h')) {
    write('Usage: node src/cli.js [YYYY-MM-DD]\n');
    write('If no date is provided, the script uses yesterday in local server time.\n');
    return 0;
  }

  const targetDate = resolveTargetDate(args, now);

  try {
    write(`Running SCB pipeline for ${targetDate}\n`);

    const result = await fetchRegistrationDate(targetDate);
    const salesExports = await writeSales(result.companies, result.targetDate);

    write(
      `Saved raw SCB data (${result.count} rows) for ${result.targetDate} to ${result.filePath} and ${result.xlsxFilePath}\n`,
    );
    write(`Created sales exports in ${salesExports.rootDir}\n`);
    write(`Master CSV: ${salesExports.files.master.csv}\n`);
    write(`Master XLSX: ${salesExports.files.master.xlsx}\n`);
    write(`Mail-only CSV: ${salesExports.files['mail-only'].csv}\n`);
    write(`Stats JSON: ${salesExports.statsFilePath}\n`);
    return 0;
  } catch (error) {
    write(`SCB fetch failed for ${targetDate}: ${error.message}\n`);
    return 1;
  }
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
