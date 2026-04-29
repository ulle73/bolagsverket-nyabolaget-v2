import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const DAILY_SYNC_STATE_FILE = 'daily-sync-state.json';

async function readJson(filePath, fallbackValue) {
  try {
    const text = await readFile(filePath, 'utf8');

    if (!text.trim()) {
      return fallbackValue;
    }

    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallbackValue;
    }

    throw error;
  }
}

export async function loadDailySyncState(
  { stateDir = 'state', fileName = DAILY_SYNC_STATE_FILE } = {},
) {
  const filePath = path.join(path.resolve(stateDir), fileName);
  const data = await readJson(filePath, {
    version: 1,
    updatedAt: null,
    dates: {},
  });

  return {
    filePath,
    data: {
      version: 1,
      updatedAt: data?.updatedAt ?? null,
      dates: data?.dates ?? {},
    },
  };
}

async function renameWithRetry(source, target, maxRetries = 5, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (error && error.code === 'EPERM' && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
}

export async function recordDailySyncState(
  snapshotDate,
  patch,
  { stateDir = 'state', fileName = DAILY_SYNC_STATE_FILE } = {},
) {
  const { filePath, data } = await loadDailySyncState({ stateDir, fileName });
  const existing = data.dates[snapshotDate] ?? {};

  data.dates[snapshotDate] = {
    snapshotDate,
    ...existing,
    ...patch,
  };
  data.updatedAt = new Date().toISOString();

  await mkdir(path.dirname(filePath), { recursive: true });
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf8');
  await renameWithRetry(tempFilePath, filePath);

  return {
    filePath,
    entry: data.dates[snapshotDate],
  };
}
