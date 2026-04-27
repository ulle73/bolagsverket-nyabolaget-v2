import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSnapshotAgeDays,
  parseVerifyPublicationArgs,
  runVerifyPublication,
} from '../src/verify-publication.js';

test('parseVerifyPublicationArgs reads date and max-age arguments', () => {
  const result = parseVerifyPublicationArgs(
    ['--date=2026-04-24', '--max-age-days=5'],
    {},
  );

  assert.deepEqual(result, {
    targetDate: '2026-04-24',
    maxAgeDays: 5,
  });
});

test('getSnapshotAgeDays calculates snapshot age in days', () => {
  assert.equal(getSnapshotAgeDays('2026-04-23', new Date('2026-04-25T08:00:00Z')), 2);
});

test('runVerifyPublication fails when no snapshot exists', async () => {
  const output = [];
  const exitCode = await runVerifyPublication([], {
    write: (message) => output.push(message),
    now: new Date('2026-04-25T08:00:00Z'),
    loadEnv: async () => {},
    assertEnv: () => {},
    createClient: async () => ({}),
    fetchSnapshot: async () => null,
  });

  assert.equal(exitCode, 1);
  assert.match(output.join(''), /Ingen publicerad snapshot hittades/);
});

test('runVerifyPublication fails when latest snapshot is stale', async () => {
  const output = [];
  const exitCode = await runVerifyPublication(['--max-age-days=9'], {
    write: (message) => output.push(message),
    now: new Date('2026-04-25T08:00:00Z'),
    loadEnv: async () => {},
    assertEnv: () => {},
    createClient: async () => ({}),
    fetchSnapshot: async () => ({
      snapshot_date: '2026-04-13',
      row_count: 3250,
    }),
  });

  assert.equal(exitCode, 1);
  assert.match(output.join(''), /överskrider gränsen 9 dagar/);
});

test('runVerifyPublication passes when latest snapshot is fresh', async () => {
  const output = [];
  const exitCode = await runVerifyPublication(['--max-age-days=9'], {
    write: (message) => output.push(message),
    now: new Date('2026-04-25T08:00:00Z'),
    loadEnv: async () => {},
    assertEnv: () => {},
    createClient: async () => ({}),
    fetchSnapshot: async () => ({
      snapshot_date: '2026-04-24',
      row_count: 3250,
    }),
  });

  assert.equal(exitCode, 0);
  assert.match(output.join(''), /Verifierad senaste snapshot 2026-04-24/);
});

test('runVerifyPublication keeps a weekly Monday snapshot valid through Tuesday holiday slack', async () => {
  const output = [];
  const exitCode = await runVerifyPublication(['--max-age-days=9'], {
    write: (message) => output.push(message),
    now: new Date('2026-04-29T08:00:00Z'),
    loadEnv: async () => {},
    assertEnv: () => {},
    createClient: async () => ({}),
    fetchSnapshot: async () => ({
      snapshot_date: '2026-04-20',
      row_count: 3250,
    }),
  });

  assert.equal(exitCode, 0);
  assert.match(output.join(''), /Ålder: 9 dagar/);
});
