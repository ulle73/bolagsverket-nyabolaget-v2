import { createClient } from '@supabase/supabase-js';
import { readEnvValues } from './env-file.js';

export async function readSupabaseConfig({ envPath = '.env' } = {}) {
  const envValues = await readEnvValues(envPath);

  return {
    url: process.env.SUPABASE_URL ?? envValues.SUPABASE_URL ?? '',
    serviceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      envValues.SUPABASE_SERVICE_ROLE_KEY ??
      '',
  };
}

export async function hasSupabasePublishingConfig(options = {}) {
  const config = await readSupabaseConfig(options);
  return Boolean(config.url && config.serviceRoleKey);
}

export async function createSupabaseServiceClient(options = {}) {
  const config = await readSupabaseConfig(options);

  if (!config.url || !config.serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for snapshot publishing.');
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
