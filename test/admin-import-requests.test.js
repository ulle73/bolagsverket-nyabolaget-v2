import test from 'node:test';
import assert from 'node:assert/strict';

import {
  processAdminImportRequests,
  queueScheduledDailyImportRequest,
} from '../src/admin-import-requests.js';

test('processAdminImportRequests completes a queued daily request without rerunning daily sync when it already ran in the same workflow', async () => {
  let dailyRuns = 0;
  const completedRequests = [];

  const exitCode = await processAdminImportRequests([], {
    write: () => {},
    now: new Date('2026-04-27T08:00:00+02:00'),
    loadEnv: async () => {},
    assertEnv: () => {},
    createClient: async () => ({}),
    createRepositoryForClient: () => ({
      listPending: async () => [
        {
          id: 'req_daily',
          request_type: 'daily',
          from_date: null,
          to_date: null,
        },
      ],
      markProcessing: async () => {},
      markCompleted: async (id, processedDates) => {
        completedRequests.push({
          id,
          processedDates,
        });
      },
      markFailed: async () => {
        throw new Error('Request should not fail in this test');
      },
    }),
    runDaily: async () => {
      dailyRuns += 1;
      return 0;
    },
    skipDailyBecauseAlreadyRan: true,
  });

  assert.equal(exitCode, 0);
  assert.equal(dailyRuns, 0);
  assert.deepEqual(completedRequests, [
    {
      id: 'req_daily',
      processedDates: [
        '2026-04-17',
        '2026-04-18',
        '2026-04-19',
        '2026-04-20',
        '2026-04-21',
        '2026-04-22',
        '2026-04-23',
        '2026-04-24',
        '2026-04-25',
        '2026-04-26',
      ],
    },
  ]);
});

test('processAdminImportRequests runs range backfills with explicit dates', async () => {
  const seenArgs = [];
  const completedRequests = [];

  const exitCode = await processAdminImportRequests([], {
    write: () => {},
    loadEnv: async () => {},
    assertEnv: () => {},
    createClient: async () => ({}),
    createRepositoryForClient: () => ({
      listPending: async () => [
        {
          id: 'req_range',
          request_type: 'range',
          from_date: '2026-04-07',
          to_date: '2026-04-09',
        },
      ],
      markProcessing: async () => {},
      markCompleted: async (id, processedDates) => {
        completedRequests.push({
          id,
          processedDates,
        });
      },
      markFailed: async () => {
        throw new Error('Request should not fail in this test');
      },
    }),
    runRange: async (args) => {
      seenArgs.push(args);
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(seenArgs, [[
    '--from=2026-04-07',
    '--to=2026-04-09',
  ]]);
  assert.deepEqual(completedRequests, [
    {
      id: 'req_range',
      processedDates: ['2026-04-07', '2026-04-08', '2026-04-09'],
    },
  ]);
});

test('queueScheduledDailyImportRequest creates a pending daily admin request for the scheduler actor', async () => {
  const createdRequests = [];
  const writes = [];

  const exitCode = await queueScheduledDailyImportRequest([], {
    write: (message) => {
      writes.push(message);
    },
    loadEnv: async () => {},
    assertEnv: () => {},
    createClient: async () => ({}),
    createRepositoryForClient: () => ({
      createDailyRequest: async (input) => {
        createdRequests.push(input);
        return {
          id: 'req_scheduled_daily',
          ...input,
        };
      },
    }),
    actorEmail: 'scheduler@foretagslistor.se',
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(createdRequests, [
    {
      actorEmail: 'scheduler@foretagslistor.se',
      dispatchStatus: 'requested',
    },
  ]);
  assert.match(writes.join(''), /req_scheduled_daily/);
});
