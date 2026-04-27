import path from 'node:path';
import { readEnvValues } from './env-file.js';

function resolveBaseDir(envValues) {
  const configured = process.env.DATA_DIR ?? envValues.DATA_DIR ?? process.env.GOOGLE_DRIVE_DATA_DIR ?? envValues.GOOGLE_DRIVE_DATA_DIR;

  if (!configured) {
    return null;
  }

  return path.resolve(configured);
}

export async function resolveRuntimePaths({ envPath = '.env' } = {}) {
  const envValues = await readEnvValues(envPath);
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
