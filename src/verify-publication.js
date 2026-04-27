import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPublishEnv } from './env-contract.js';
import { hydrateProcessEnv } from './env-file.js';
import { createSupabaseServiceClient } from './supabase-client.js';

// Veckovis SCB-release på måndag, eller tisdag vid röd dag, plus en dags operativ marginal.
const DEFAULT_MAX_SNAPSHOT_AGE_DAYS = 9;

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

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toUtcDay(snapshotDate) {
  const [year, month, day] = snapshotDate.split('-').map(Number);
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

export function getSnapshotAgeDays(snapshotDate, now = new Date()) {
  const currentUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((currentUtcDay - toUtcDay(snapshotDate)) / 86_400_000));
}

export function parseVerifyPublicationArgs(
  args = process.argv.slice(2),
  env = process.env,
) {
  const targetDate = args
    .find((value) => value.startsWith('--date='))
    ?.split('=')[1] ?? null;

  const maxAgeDays = parsePositiveInteger(
    args.find((value) => value.startsWith('--max-age-days='))?.split('=')[1] ??
      env.MAX_SNAPSHOT_AGE_DAYS,
    DEFAULT_MAX_SNAPSHOT_AGE_DAYS,
  );

  return {
    targetDate,
    maxAgeDays,
  };
}

export async function fetchPublishedSnapshot(targetDate, client) {
  let query = client
    .from('data_snapshots')
    .select('snapshot_date, row_count')
    .gt('row_count', 0);

  if (targetDate) {
    query = query.eq('snapshot_date', targetDate);
  }

  const { data, error } = await query
    .order('snapshot_date', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return data?.[0] ?? null;
}

export async function runVerifyPublication(
  args = process.argv.slice(2),
  {
    write = (message) => process.stdout.write(message),
    now = new Date(),
    loadEnv = () => hydrateProcessEnv(),
    assertEnv = () => assertPublishEnv(),
    createClient = () => createSupabaseServiceClient(),
    fetchSnapshot = (targetDate, client) => fetchPublishedSnapshot(targetDate, client),
  } = {},
) {
  const { targetDate, maxAgeDays } = parseVerifyPublicationArgs(args);

  try {
    await loadEnv();
    assertEnv();

    const client = await createClient();
    const snapshot = await fetchSnapshot(targetDate, client);

    if (!snapshot) {
      write(
        targetDate
          ? `Ingen publicerad snapshot hittades för ${targetDate}.\n`
          : 'Ingen publicerad snapshot hittades i Supabase.\n',
      );
      return 1;
    }

    const snapshotAgeDays = getSnapshotAgeDays(snapshot.snapshot_date, now);

    if (snapshotAgeDays > maxAgeDays) {
      write(
        `Senaste publicerade snapshot ${snapshot.snapshot_date} är ${snapshotAgeDays} dagar gammal, vilket överskrider gränsen ${maxAgeDays} dagar.\n`,
      );
      return 1;
    }

    const label = targetDate
      ? `Verifierad snapshot ${snapshot.snapshot_date}`
      : `Verifierad senaste snapshot ${snapshot.snapshot_date}`;

    write(
      `${label} med ${snapshot.row_count} rader. Ålder: ${snapshotAgeDays} dagar. Max tillåten ålder: ${maxAgeDays} dagar.\n`,
    );
    return 0;
  } catch (error) {
    write(
      `Publiceringsverifiering misslyckades ${formatLocalDate(now)}: ${error instanceof Error ? error.message : 'okänt fel'}\n`,
    );
    return 1;
  }
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await runVerifyPublication();
  process.exitCode = exitCode;
}
