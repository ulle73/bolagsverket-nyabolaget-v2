import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hydrateProcessEnv } from './env-file.js';
import { assertDailySyncEnv, assertPublishEnv } from './env-contract.js';
import { runDailySync, resolveDailyDates } from './daily-sync.js';
import { runSyncRange, resolveRangeDates } from './sync-range.js';
import { createSupabaseServiceClient } from './supabase-client.js';

const DEFAULT_SCHEDULED_ACTOR_EMAIL = 'scheduler@foretagslistor.se';

function isCliEntrypoint(modulePath, argvPath) {
  if (!argvPath) {
    return false;
  }

  return path.resolve(modulePath) === path.resolve(argvPath);
}

function createRepository(client) {
  return {
    async listPending(limit = 10) {
      const { data, error } = await client
        .from('admin_import_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(error.message);
      }

      return data ?? [];
    },
    async createDailyRequest({
      actorEmail = DEFAULT_SCHEDULED_ACTOR_EMAIL,
      dispatchStatus = 'requested',
    } = {}) {
      const { data, error } = await client
        .from('admin_import_requests')
        .insert({
          actor_email: actorEmail,
          request_type: 'daily',
          from_date: null,
          to_date: null,
          status: 'pending',
          dispatch_status: dispatchStatus,
          processed_dates_json: [],
        })
        .select('*')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
    async markProcessing(id) {
      const timestamp = new Date().toISOString();
      const { error } = await client
        .from('admin_import_requests')
        .update({
          status: 'processing',
          started_at: timestamp,
          updated_at: timestamp,
        })
        .eq('id', id);

      if (error) {
        throw new Error(error.message);
      }
    },
    async markCompleted(id, processedDates) {
      const timestamp = new Date().toISOString();
      const { error } = await client
        .from('admin_import_requests')
        .update({
          status: 'completed',
          processed_dates_json: processedDates,
          completed_at: timestamp,
          updated_at: timestamp,
          error_message: null,
        })
        .eq('id', id);

      if (error) {
        throw new Error(error.message);
      }
    },
    async markFailed(id, message) {
      const timestamp = new Date().toISOString();
      const { error } = await client
        .from('admin_import_requests')
        .update({
          status: 'failed',
          error_message: message,
          completed_at: timestamp,
          updated_at: timestamp,
        })
        .eq('id', id);

      if (error) {
        throw new Error(error.message);
      }
    },
  };
}

async function runSingleRequest(
  request,
  {
    now = new Date(),
    runDaily = (args) => runDailySync(args),
    runRange = (args) => runSyncRange(args),
    skipDailyBecauseAlreadyRan = process.env.ADMIN_IMPORT_DAILY_ALREADY_RAN === '1',
  } = {},
) {
  if (request.request_type === 'daily') {
    const processedDates = resolveDailyDates(now);

    if (skipDailyBecauseAlreadyRan) {
      return {
        exitCode: 0,
        processedDates,
      };
    }

    return {
      exitCode: await runDaily([]),
      processedDates,
    };
  }

  const processedDates = resolveRangeDates(request.from_date, request.to_date);
  return {
    exitCode: await runRange([`--from=${request.from_date}`, `--to=${request.to_date}`]),
    processedDates,
  };
}

export async function queueScheduledDailyImportRequest(
  args = process.argv.slice(2),
  {
    write = (message) => process.stdout.write(message),
    actorEmail = process.env.SCHEDULED_IMPORT_ACTOR_EMAIL?.trim() || DEFAULT_SCHEDULED_ACTOR_EMAIL,
    loadEnv = () => hydrateProcessEnv(),
    assertEnv = () => assertPublishEnv(),
    createClient = async () => {
      const result = await createSupabaseServiceClient();
      return result.client;
    },
    createRepositoryForClient = (client) => createRepository(client),
  } = {},
) {
  await loadEnv();
  assertEnv();

  const client = await createClient();
  const repository = createRepositoryForClient(client);
  const request = await repository.createDailyRequest({
    actorEmail,
    dispatchStatus: 'requested',
  });

  write(`Skapade schemalagd admin-importförfrågan ${request.id} (daily)\n`);
  return 0;
}

export async function processAdminImportRequests(
  args = process.argv.slice(2),
  {
    write = (message) => process.stdout.write(message),
    now = new Date(),
    loadEnv = () => hydrateProcessEnv(),
    assertEnv = () => assertDailySyncEnv(),
    createClient = async () => {
      // Admin import requests live in the ACTIVE database (where the dashboard is).
      // The actual data publishing routes to archive/active automatically per date.
      const result = await createSupabaseServiceClient();
      return result.client;
    },
    createRepositoryForClient = (client) => createRepository(client),
    runDaily = (dailyArgs) => runDailySync(dailyArgs),
    runRange = (rangeArgs) => runSyncRange(rangeArgs),
    skipDailyBecauseAlreadyRan = process.env.ADMIN_IMPORT_DAILY_ALREADY_RAN === '1',
  } = {},
) {
  const limitArg = args.find((value) => value.startsWith('--limit='));
  const limit = Number.parseInt(limitArg?.split('=')[1] ?? '10', 10);

  await loadEnv();
  assertEnv();

  const client = await createClient();
  const repository = createRepositoryForClient(client);
  const pendingRequests = await repository.listPending(
    Number.isFinite(limit) && limit > 0 ? limit : 10,
  );

  if (pendingRequests.length === 0) {
    write('Inga väntande admin-importförfrågningar.\n');
    return 0;
  }

  let hasFailure = false;

  for (const request of pendingRequests) {
    write(`Bearbetar admin-importförfrågan ${request.id} (${request.request_type})\n`);

    try {
      await repository.markProcessing(request.id);
      const result = await runSingleRequest(request, {
        now,
        runDaily,
        runRange,
        skipDailyBecauseAlreadyRan,
      });

      if (result.exitCode !== 0) {
        hasFailure = true;
        await repository.markFailed(
          request.id,
          'Importkommandot returnerade en icke-noll exit code.',
        );
        continue;
      }

      await repository.markCompleted(request.id, result.processedDates);
    } catch (error) {
      hasFailure = true;
      await repository.markFailed(
        request.id,
        error instanceof Error ? error.message : 'Unknown admin import error',
      );
    }
  }

  return hasFailure ? 1 : 0;
}

const modulePath = fileURLToPath(import.meta.url);

if (isCliEntrypoint(modulePath, process.argv[1])) {
  const exitCode = await processAdminImportRequests();
  process.exitCode = exitCode;
}
