import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAndSaveCompaniesByExactRegistrationDate } from './scb.js';
import { writeSalesExports } from './sales-exports.js';

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
  } = {},
) {
  const targetDate = args[0];

  if (!targetDate) {
    write('Usage: node src/cli.js YYYY-MM-DD\n');
    return 1;
  }

  try {
    const result = await fetchRegistrationDate(targetDate);
    const salesExports = await writeSales(result.companies, result.targetDate);

    write(
      `Saved raw SCB data (${result.count} rows) for ${result.targetDate} to ${result.filePath} and ${result.xlsxFilePath}\n`,
    );
    write(`Created sales exports in ${salesExports.rootDir}\n`);
    write(`Master CSV: ${salesExports.files.master.csv}\n`);
    write(`Master XLSX: ${salesExports.files.master.xlsx}\n`);
    return 0;
  } catch (error) {
    write(`SCB fetch failed: ${error.message}\n`);
    return 1;
  }
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
