import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from './cli.js';
import { hydrateProcessEnv } from './env-file.js';
import { assertDailySyncEnv } from './env-contract.js';
import { recordDailySyncState } from './run-state.js';
import { resolveRuntimePaths } from './runtime-paths.js';

const DEFAULT_SYNC_LOOKBACK_DAYS = 10;

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isCliEntrypoint(modulePath, argvPath) {
  if (!argvPath) {
    return false;
  }

  return path.resolve(modulePath) === path.resolve(argvPath);
}

export function resolveDailyDates(now = new Date(), lookbackDays = DEFAULT_SYNC_LOOKBACK_DAYS) {
  const days = [];

  for (let offset = lookbackDays; offset >= 1; offset -= 1) {
    const current = new Date(now);
    current.setDate(current.getDate() - offset);
    days.push(formatLocalDate(current));
  }

  return days;
}

export async function runDailySync(
  args = process.argv.slice(2),
  {
    write = (message) => process.stdout.write(message),
    now = new Date(),
    runProcess = async (dateArgs) => runCli([...dateArgs, '--require-publish']),
    loadEnv = () => hydrateProcessEnv(),
    assertEnv = () => assertDailySyncEnv(),
    resolvePaths = () => resolveRuntimePaths(),
    recordState = (snapshotDate, patch, options) =>
      recordDailySyncState(snapshotDate, patch, options),
  } = {},
) {
  const lookbackArg = args.find((value) => value.startsWith('--lookback='));
  const lookbackDays = Number.parseInt(
    lookbackArg?.split('=')[1] ?? String(DEFAULT_SYNC_LOOKBACK_DAYS),
    10,
  );
  const dates = resolveDailyDates(
    now,
    Number.isFinite(lookbackDays) && lookbackDays > 0
      ? lookbackDays
      : DEFAULT_SYNC_LOOKBACK_DAYS,
  );
  const runtimePaths = await resolvePaths();
  const stateOptions = {
    stateDir: runtimePaths.stateDir,
  };
  let hasFailure = false;

  await loadEnv();
  assertEnv();

  for (const date of dates) {
    const startedAt = new Date().toISOString();
    write(`Kör daglig sync för ${date}\n`);

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
        write(`Daglig sync misslyckades för ${date}\n`);
      }
    } catch (error) {
      hasFailure = true;

      await recordState(
        date,
        {
          status: 'failed',
          completedAt: new Date().toISOString(),
          exitCode: 1,
          errorMessage: error instanceof Error ? error.message : 'Unknown sync error',
        },
        stateOptions,
      );

      write(`Daglig sync misslyckades för ${date}\n`);
    }
  }

  return hasFailure ? 1 : 0;
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runDailySync();
  process.exitCode = exitCode;
}
