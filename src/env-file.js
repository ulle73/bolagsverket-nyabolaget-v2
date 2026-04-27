import { readFile } from 'node:fs/promises';

export async function readEnvFile(envPath = '.env') {
  try {
    return await readFile(envPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

export function parseDotEnv(text) {
  const values = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

export async function readEnvValues(envPath = '.env') {
  const text = await readEnvFile(envPath);
  return parseDotEnv(text);
}

export async function hydrateProcessEnv({
  envPath = '.env',
  target = process.env,
} = {}) {
  const envValues = await readEnvValues(envPath);

  for (const [key, value] of Object.entries(envValues)) {
    if (!String(target[key] ?? '').trim()) {
      target[key] = value;
    }
  }

  return target;
}
