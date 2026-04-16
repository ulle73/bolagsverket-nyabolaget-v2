import path from 'node:path';
import { readFile } from 'node:fs/promises';

async function readEnvFile(envPath = '.env') {
  try {
    return await readFile(envPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

function parseDotEnv(text) {
  const values = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function resolveBaseDir(envValues) {
  const configured = process.env.DATA_DIR ?? envValues.DATA_DIR ?? process.env.GOOGLE_DRIVE_DATA_DIR ?? envValues.GOOGLE_DRIVE_DATA_DIR;

  if (!configured) {
    return null;
  }

  return path.resolve(configured);
}

export async function resolveRuntimePaths({ envPath = '.env' } = {}) {
  const envText = await readEnvFile(envPath);
  const envValues = parseDotEnv(envText);
  const baseDir = resolveBaseDir(envValues);

  if (!baseDir) {
    return {
      baseDir: null,
      rawDir: 'raw',
      exportsDir: 'exports',
      stateDir: 'state',
    };
  }

  return {
    baseDir,
    rawDir: path.join(baseDir, 'raw'),
    exportsDir: path.join(baseDir, 'exports'),
    stateDir: path.join(baseDir, 'state'),
  };
}
