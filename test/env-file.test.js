import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { hydrateProcessEnv } from '../src/env-file.js';

test('hydrateProcessEnv loads missing values from .env without overriding explicit env', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'env-file-'));

  try {
    const envPath = path.join(tempDir, '.env');
    await writeFile(
      envPath,
      ['DATA_DIR=/tmp/data', 'SUPABASE_URL=https://example.supabase.co', 'SCB_PASSWORD=file-secret'].join('\n'),
      'utf8',
    );

    const target = {
      SCB_PASSWORD: 'runtime-secret',
      SUPABASE_URL: '',
    };

    await hydrateProcessEnv({
      envPath,
      target,
    });

    assert.deepEqual(target, {
      DATA_DIR: '/tmp/data',
      SCB_PASSWORD: 'runtime-secret',
      SUPABASE_URL: 'https://example.supabase.co',
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
