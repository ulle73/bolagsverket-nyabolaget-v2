import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAILY_SYNC_REQUIRED_ENV,
  PROCESS_REQUIRED_ENV,
  PUBLISH_REQUIRED_ENV,
  assertDailySyncEnv,
  assertProcessEnv,
  assertPublishEnv,
  getMissingEnvVars,
} from '../src/env-contract.js';

test('getMissingEnvVars reports exactly the required missing variables', () => {
  const missing = getMissingEnvVars(['SCB_PASSWORD', 'SUPABASE_URL'], {
    SCB_PASSWORD: 'secret',
    SUPABASE_URL: '',
  });

  assert.deepEqual(missing, ['SUPABASE_URL']);
});

test('process env contract requires SCB credentials', () => {
  assert.deepEqual(PROCESS_REQUIRED_ENV, ['SCB_PASSWORD', 'SCB_PFX_PATH']);
  assert.throws(
    () => assertProcessEnv({ env: { SCB_PASSWORD: 'secret' } }),
    /SCB_PFX_PATH/,
  );
});

test('publish env contract requires Supabase credentials', () => {
  assert.deepEqual(PUBLISH_REQUIRED_ENV, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  assert.throws(
    () => assertPublishEnv({ env: { SUPABASE_URL: 'https://example.supabase.co' } }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test('daily sync env contract requires the full pipeline configuration', () => {
  assert.deepEqual(DAILY_SYNC_REQUIRED_ENV, [
    'SCB_PASSWORD',
    'SCB_PFX_PATH',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);

  assert.throws(
    () =>
      assertDailySyncEnv({
        env: {
          SCB_PASSWORD: 'secret',
          SCB_PFX_PATH: '/tmp/scb.pfx',
          SUPABASE_URL: 'https://example.supabase.co',
        },
      }),
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
});
