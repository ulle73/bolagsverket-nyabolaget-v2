import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { enrichAndSaveCompaniesWithAllabolag } from './allabolag-enrichment.js';
import { resolveRuntimePaths } from './runtime-paths.js';

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveTargetDate(args = process.argv.slice(2), now = new Date()) {
  const dateArg = args.find((value) => value && !value.startsWith('--'));

  if (dateArg) {
    return dateArg;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return formatLocalDate(yesterday);
}

function isCliEntrypoint(modulePath, argvPath) {
  if (!argvPath) {
    return false;
  }

  return path.resolve(modulePath) === path.resolve(argvPath);
}

export async function runAllabolagEnrichmentCli(
  args = process.argv.slice(2),
  {
    write = (message) => process.stdout.write(message),
    now = new Date(),
  } = {},
) {
  if (args.includes('--help') || args.includes('-h')) {
    write('Användning: node src/allabolag-enrichment-cli.js [YYYY-MM-DD]\n');
    write('Läser rådata från raw/YYYY-MM-DD.json och sparar enriched checkpoint i raw/enriched/.\n');
    return 0;
  }

  const targetDate = resolveTargetDate(args, now);
  const runtimePaths = await resolveRuntimePaths();
  const inputFilePath = path.join(path.resolve(runtimePaths.rawDir), `${targetDate}.json`);

  try {
    const fileContent = await readFile(inputFilePath, 'utf8');
    const companies = JSON.parse(fileContent);
    const result = await enrichAndSaveCompaniesWithAllabolag(companies, targetDate, {
      outputDir: runtimePaths.rawDir,
      stateDir: runtimePaths.stateDir,
      writeProgress: write,
    });

    write(`Allabolag-checkpoint sparad: ${result.filePath}\n`);
    write(`Allabolag-checkpoint XLSX: ${result.xlsxFilePath}\n`);
    write(`Allabolag-statistik: ${result.statsFilePath}\n`);
    write(`Allabolag-cache: ${result.cacheFilePath}\n`);
    return 0;
  } catch (error) {
    write(`Allabolag-berikning misslyckades för ${targetDate}: ${error.message}\n`);
    return 1;
  }
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runAllabolagEnrichmentCli();
  process.exitCode = exitCode;
}
