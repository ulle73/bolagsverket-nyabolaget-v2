import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { formatOutputDate } from './scb.js';

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

export async function resolveCompaniesForPublish(
  targetDate,
  { rawDir = 'raw', allowRawFallback = false } = {},
) {
  const formattedDate = formatOutputDate(targetDate);
  const baseDir = path.resolve(rawDir);
  const enrichedFilePath = path.join(baseDir, 'enriched', `${formattedDate}.json`);
  const rawFilePath = path.join(baseDir, `${formattedDate}.json`);

  try {
    const companies = await readJson(enrichedFilePath);

    return {
      source: 'enriched',
      filePath: enrichedFilePath,
      companies,
      targetDate: formattedDate,
    };
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (!allowRawFallback) {
    throw new Error(
      `Missing enriched source file for ${formattedDate}. Re-run enrichment or pass allowRawFallback explicitly.`,
    );
  }

  const companies = await readJson(rawFilePath);

  return {
    source: 'raw',
    filePath: rawFilePath,
    companies,
    targetDate: formattedDate,
  };
}
