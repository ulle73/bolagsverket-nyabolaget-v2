import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { resolveCompaniesForPublish } from '../src/source-data.js';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

test('resolveCompaniesForPublish prefers enriched data and blocks raw fallback by default', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'publish-source-'));

  try {
    const rawPath = path.join(tempDir, '2026-04-13.json');
    await writeJson(rawPath, [{ OrgNr: '5595488353' }]);

    await assert.rejects(
      () => resolveCompaniesForPublish('2026-04-13', { rawDir: tempDir }),
      /Missing enriched source file/,
    );

    const rawFallback = await resolveCompaniesForPublish('2026-04-13', {
      rawDir: tempDir,
      allowRawFallback: true,
    });

    assert.equal(rawFallback.source, 'raw');

    const enrichedPath = path.join(tempDir, 'enriched', '2026-04-13.json');
    await writeJson(enrichedPath, [{ OrgNr: '5595488354' }]);

    const enriched = await resolveCompaniesForPublish('2026-04-13', { rawDir: tempDir });

    assert.equal(enriched.source, 'enriched');
    assert.equal(enriched.filePath, enrichedPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
