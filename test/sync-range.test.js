import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { resolveRangeDates, runSyncRange } from '../src/sync-range.js';

test('resolveRangeDates returns an inclusive date interval', () => {
  assert.deepEqual(resolveRangeDates('2026-04-20', '2026-04-23'), [
    '2026-04-20',
    '2026-04-21',
    '2026-04-22',
    '2026-04-23',
  ]);
});

test('runSyncRange runs the process command oldest to newest', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'range-sync-order-'));
  const seenDates = [];

  try {
    const exitCode = await runSyncRange(['--from=2026-04-20', '--to=2026-04-22'], {
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
      '2026-04-20',
      '2026-04-21',
      '2026-04-22',
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('runSyncRange persists per-date run state for operations', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'range-sync-state-'));

  try {
    const exitCode = await runSyncRange(['--from=2026-04-20', '--to=2026-04-21'], {
      write: () => {},
      loadEnv: async () => {},
      assertEnv: () => {},
      resolvePaths: async () => ({
        stateDir: tempDir,
      }),
      runProcess: async (args) => (args[0] === '2026-04-20' ? 1 : 0),
    });

    assert.equal(exitCode, 1);

    const state = JSON.parse(
      await readFile(path.join(tempDir, 'daily-sync-state.json'), 'utf8'),
    );

    assert.equal(state.version, 1);
    assert.equal(state.dates['2026-04-20'].status, 'failed');
    assert.equal(state.dates['2026-04-21'].status, 'completed');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
