import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { createSupabaseServiceClient, isArchiveDate } from '../src/supabase-client.js';

const SUPABASE_ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ARCHIVE_URL',
  'SUPABASE_ARCHIVE_SERVICE_ROLE_KEY',
];

async function withClearedSupabaseEnv(fn) {
  const originalValues = Object.fromEntries(
    SUPABASE_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  for (const key of SUPABASE_ENV_KEYS) {
    delete process.env[key];
  }

  try {
    await fn();
  } finally {
    for (const key of SUPABASE_ENV_KEYS) {
      if (originalValues[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValues[key];
      }
    }
  }
}

test('isArchiveDate routes dates before the cutoff to the archive database', () => {
  assert.equal(isArchiveDate('2024-12-31'), true);
  assert.equal(isArchiveDate('2025-01-01'), false);
});

test('createSupabaseServiceClient uses the archive database when archive credentials are configured', async () => {
  await withClearedSupabaseEnv(async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'supabase-client-'));

    try {
      const envPath = path.join(tempDir, '.env');
      await writeFile(
        envPath,
        [
          'SUPABASE_URL=https://active.example.supabase.co',
          'SUPABASE_SERVICE_ROLE_KEY=active-key',
          'SUPABASE_ARCHIVE_URL=https://archive.example.supabase.co',
          'SUPABASE_ARCHIVE_SERVICE_ROLE_KEY=archive-key',
        ].join('\n'),
        'utf8',
      );

      const result = await createSupabaseServiceClient({
        snapshotDate: '2024-12-31',
        envPath,
      });

      assert.equal(result.target, 'archive');
      assert.equal(typeof result.client.from, 'function');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

test('createSupabaseServiceClient requires archive credentials for archive dates', async () => {
  await withClearedSupabaseEnv(async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'supabase-client-'));

    try {
      const envPath = path.join(tempDir, '.env');
      await writeFile(
        envPath,
        [
          'SUPABASE_URL=https://active.example.supabase.co',
          'SUPABASE_SERVICE_ROLE_KEY=active-key',
        ].join('\n'),
        'utf8',
      );

      await assert.rejects(
        () =>
          createSupabaseServiceClient({
            snapshotDate: '2024-12-31',
            envPath,
          }),
        /SUPABASE_ARCHIVE_URL|SUPABASE_ARCHIVE_SERVICE_ROLE_KEY/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
