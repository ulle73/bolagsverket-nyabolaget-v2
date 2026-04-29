import { createClient } from '@supabase/supabase-js';
import { readEnvValues } from './env-file.js';

/**
 * Cutoff date: Dates before this go to the archive DB,
 * dates on or after go to the active DB.
 * Format: YYYY-MM-DD
 */
const ARCHIVE_CUTOFF_DATE = '2019-01-01';

export async function readSupabaseConfig({ envPath = '.env' } = {}) {
  const envValues = await readEnvValues(envPath);

  return {
    // Active DB (current/recent data)
    url: process.env.SUPABASE_URL ?? envValues.SUPABASE_URL ?? '',
    serviceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      envValues.SUPABASE_SERVICE_ROLE_KEY ??
      '',
    // Archive DB (historical data before cutoff)
    archiveUrl: process.env.SUPABASE_ARCHIVE_URL ?? envValues.SUPABASE_ARCHIVE_URL ?? '',
    archiveServiceRoleKey:
      process.env.SUPABASE_ARCHIVE_SERVICE_ROLE_KEY ??
      envValues.SUPABASE_ARCHIVE_SERVICE_ROLE_KEY ??
      '',
  };
}

export async function hasSupabasePublishingConfig(options = {}) {
  const config = await readSupabaseConfig(options);
  // At least one target must be configured
  return Boolean(
    (config.url && config.serviceRoleKey) ||
    (config.archiveUrl && config.archiveServiceRoleKey),
  );
}

function buildClient(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Determines whether a snapshot date should be published to
 * the archive or active database.
 */
export function isArchiveDate(snapshotDate) {
  return snapshotDate < ARCHIVE_CUTOFF_DATE;
}

/**
 * Creates the appropriate Supabase client for a given snapshot date.
 * - Dates before ARCHIVE_CUTOFF_DATE → archive DB
 * - Dates on or after → active DB
 *
 * Archive dates require archive credentials. Do not silently fall back to the
 * active database because that can publish historical data to the wrong store.
 */
export async function createSupabaseServiceClient({ snapshotDate, ...options } = {}) {
  const config = await readSupabaseConfig(options);

  if (snapshotDate && isArchiveDate(snapshotDate)) {
    if (!config.archiveUrl || !config.archiveServiceRoleKey) {
      throw new Error(
        'Missing SUPABASE_ARCHIVE_URL or SUPABASE_ARCHIVE_SERVICE_ROLE_KEY for archive snapshot publishing.',
      );
    }

    return {
      client: buildClient(config.archiveUrl, config.archiveServiceRoleKey),
      target: 'archive',
    };
  }

  if (!config.url || !config.serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for snapshot publishing.');
  }

  return {
    client: buildClient(config.url, config.serviceRoleKey),
    target: 'active',
  };
}

export { ARCHIVE_CUTOFF_DATE };
