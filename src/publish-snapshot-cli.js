import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hydrateProcessEnv } from './env-file.js';
import { normalizeForSupabaseRows } from './normalize-for-supabase.js';
import { publishSnapshot } from './publish-snapshot.js';
import { resolveRuntimePaths } from './runtime-paths.js';
import { resolveCompaniesForPublish } from './source-data.js';
import { assertPublishEnv } from './env-contract.js';

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

export async function runPublishSnapshotCli(
  args = process.argv.slice(2),
  {
    write = (message) => process.stdout.write(message),
    now = new Date(),
    loadEnv = () => hydrateProcessEnv(),
    assertEnv = () => assertPublishEnv(),
  } = {},
) {
  const targetDate = resolveTargetDate(args, now);
  const runtimePaths = await resolveRuntimePaths();
  const allowRawFallback = args.includes('--allow-raw-fallback');

  try {
    await loadEnv();
    assertEnv();

    const sourceData = await resolveCompaniesForPublish(targetDate, {
      rawDir: runtimePaths.rawDir,
      allowRawFallback,
    });
    const normalizedRows = normalizeForSupabaseRows(sourceData.companies, sourceData.targetDate);
    const result = await publishSnapshot(normalizedRows, {
      snapshotDate: sourceData.targetDate,
      details: {
        source: sourceData.source,
        sourceFilePath: sourceData.filePath,
      },
      rawRowCount: sourceData.companies.length,
    });

    write(
      `Publicerade snapshot ${result.snapshotDate} (${result.rowCount} rader) från ${sourceData.source} (${sourceData.filePath}).\n`,
    );
    return 0;
  } catch (error) {
    write(
      `Snapshot-publicering misslyckades för ${targetDate}: ${error instanceof Error ? error.message : 'okänt fel'}\n`,
    );
    return 1;
  }
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runPublishSnapshotCli();
  process.exitCode = exitCode;
}
