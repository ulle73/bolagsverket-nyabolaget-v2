export const PROCESS_REQUIRED_ENV = ['SCB_PASSWORD', 'SCB_PFX_PATH'];

// At least the active DB must be configured for publishing.
// Archive DB vars are optional (falls back to active if missing).
export const PUBLISH_REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

export const DAILY_SYNC_REQUIRED_ENV = [
  ...PROCESS_REQUIRED_ENV,
  ...PUBLISH_REQUIRED_ENV,
];

export function getMissingEnvVars(requiredEnvVars, env = process.env) {
  return requiredEnvVars.filter((key) => !String(env[key] ?? '').trim());
}

export function assertRequiredEnv(
  requiredEnvVars,
  { env = process.env, label = 'command' } = {},
) {
  const missing = getMissingEnvVars(requiredEnvVars, env);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for ${label}: ${missing.join(', ')}`,
    );
  }
}

export function assertProcessEnv(options = {}) {
  assertRequiredEnv(PROCESS_REQUIRED_ENV, {
    ...options,
    label: 'process',
  });
}

export function assertPublishEnv(options = {}) {
  assertRequiredEnv(PUBLISH_REQUIRED_ENV, {
    ...options,
    label: 'publish:snapshot',
  });
}

export function assertDailySyncEnv(options = {}) {
  assertRequiredEnv(DAILY_SYNC_REQUIRED_ENV, {
    ...options,
    label: 'sync:daily',
  });
}
