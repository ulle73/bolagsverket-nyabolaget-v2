import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from './cli.js';
import { hydrateProcessEnv } from './env-file.js';
import { assertDailySyncEnv } from './env-contract.js';
import { recordDailySyncState } from './run-state.js';
import { resolveRuntimePaths } from './runtime-paths.js';

function isCliEntrypoint(modulePath, argvPath) {
  if (!argvPath) {
    return false;
  }

  return path.resolve(modulePath) === path.resolve(argvPath);
}

function parseDateArg(value, label) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Missing or invalid ${label}. Use YYYY-MM-DD.`);
  }

  return value;
}

function toUtcDay(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

function formatUtcDay(timestamp) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveRangeDates(fromDate, toDate) {
  const normalizedFromDate = parseDateArg(fromDate, 'from');
  const normalizedToDate = parseDateArg(toDate, 'to');

  if (normalizedFromDate > normalizedToDate) {
    throw new Error('from date must be before or equal to to date.');
  }

  const dates = [];

  for (let current = toUtcDay(normalizedFromDate); current <= toUtcDay(normalizedToDate); current += 86_400_000) {
    dates.push(formatUtcDay(current));
  }

  return dates;
}

export async function runSyncRange(
  args = process.argv.slice(2),
  {
    write = (message) => process.stdout.write(message),
    runProcess = async (dateArgs) => runCli([...dateArgs, '--require-publish']),
    loadEnv = () => hydrateProcessEnv(),
    assertEnv = () => assertDailySyncEnv(),
    resolvePaths = () => resolveRuntimePaths(),
    recordState = (snapshotDate, patch, options) =>
      recordDailySyncState(snapshotDate, patch, options),
  } = {},
) {
  const fromDate = args.find((value) => value.startsWith('--from='))?.split('=')[1];
  const toDate = args.find((value) => value.startsWith('--to='))?.split('=')[1];
  const dates = resolveRangeDates(fromDate, toDate);
  const runtimePaths = await resolvePaths();
  const stateOptions = {
    stateDir: runtimePaths.stateDir,
  };
  let hasFailure = false;

  await loadEnv();
  assertEnv();

  for (const date of dates) {
    const startedAt = new Date().toISOString();
    write(`Kör range-sync för ${date}\n`);

    await recordState(
      date,
      {
        status: 'started',
        startedAt,
        completedAt: null,
        exitCode: null,
        errorMessage: null,
      },
      stateOptions,
    );

    try {
      const exitCode = await runProcess([date]);
      const completedAt = new Date().toISOString();

      await recordState(
        date,
        {
          status: exitCode === 0 ? 'completed' : 'failed',
          completedAt,
          exitCode,
          errorMessage: exitCode === 0 ? null : 'Process command returned a non-zero exit code.',
        },
        stateOptions,
      );

      if (exitCode !== 0) {
        hasFailure = true;
        write(`Range-sync misslyckades för ${date}\n`);
      }
    } catch (error) {
      hasFailure = true;

      await recordState(
        date,
        {
          status: 'failed',
          completedAt: new Date().toISOString(),
          exitCode: 1,
          errorMessage: error instanceof Error ? error.message : 'Unknown range sync error',
        },
        stateOptions,
      );

      write(`Range-sync misslyckades för ${date}\n`);
    }
  }

  return hasFailure ? 1 : 0;
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runSyncRange();
  process.exitCode = exitCode;
}
