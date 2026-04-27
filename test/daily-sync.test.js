import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { resolveDailyDates, runDailySync } from '../src/daily-sync.js';

test('resolveDailyDates returns the configured rolling backfill window ending yesterday', () => {
  const dates = resolveDailyDates(new Date('2026-04-24T10:00:00+02:00'), 10);

  assert.deepEqual(dates, [
    '2026-04-14',
    '2026-04-15',
    '2026-04-16',
    '2026-04-17',
    '2026-04-18',
    '2026-04-19',
    '2026-04-20',
    '2026-04-21',
    '2026-04-22',
    '2026-04-23',
  ]);
});

test('runDailySync runs the process command oldest to newest', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'daily-sync-order-'));
  const seenDates = [];

  try {
    const exitCode = await runDailySync([], {
      now: new Date('2026-04-24T10:00:00+02:00'),
      write: () => {},
      loadEnv: async () => {},
      assertEnv: () => {},
      resolvePaths: async () => ({
        stateDir: tempDir,
      }),
      runProcess: async (args) => {
        seenDates.push(args[0]);
        return 0;
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(seenDates, [
      '2026-04-14',
      '2026-04-15',
      '2026-04-16',
      '2026-04-17',
      '2026-04-18',
      '2026-04-19',
      '2026-04-20',
      '2026-04-21',
      '2026-04-22',
      '2026-04-23',
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('runDailySync persists per-date run state for operations', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'daily-sync-state-'));

  try {
    const exitCode = await runDailySync(['--lookback=2'], {
      now: new Date('2026-04-24T10:00:00+02:00'),
      write: () => {},
      loadEnv: async () => {},
      assertEnv: () => {},
      resolvePaths: async () => ({
        stateDir: tempDir,
      }),
      runProcess: async (args) => (args[0] === '2026-04-22' ? 1 : 0),
    });

    assert.equal(exitCode, 1);

    const state = JSON.parse(
      await readFile(path.join(tempDir, 'daily-sync-state.json'), 'utf8'),
    );

    assert.equal(state.version, 1);
    assert.equal(state.dates['2026-04-22'].status, 'failed');
    assert.equal(state.dates['2026-04-22'].exitCode, 1);
    assert.equal(state.dates['2026-04-23'].status, 'completed');
    assert.equal(state.dates['2026-04-23'].exitCode, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
