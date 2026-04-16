import path from 'node:path';
import { REQUIRED_OUTPUT_COLUMNS, DERIVED_COLUMNS } from './config.js';
import { readJsonArray, ensureDir, basenameWithoutExt, writeTextFile } from './lib/io.js';
import { normalizeRow } from './lib/normalize.js';
import { splitRows, groupByCounty } from './lib/filters.js';
import { writeCsv, writeCountyExports, buildStats } from './lib/exporters.js';

function resolveDateTag(inputPath, firstRow) {
  const fromRow = firstRow?.['Registreringsdatum'] || firstRow?.['Startdatum'] || '';
  if (fromRow) return fromRow;
  return basenameWithoutExt(inputPath);
}

function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error('Användning: node src/index.js raw/2026-03-02.json');
    process.exit(1);
  }

  const rawRows = readJsonArray(inputPath);
  const columns = [...REQUIRED_OUTPUT_COLUMNS, ...DERIVED_COLUMNS];
  const normalizedRows = rawRows.map((row) => normalizeRow(row, REQUIRED_OUTPUT_COLUMNS));
  const { full, mailOnly } = splitRows(normalizedRows);
  const groupedRows = groupByCounty(full);

  const dateTag = resolveDateTag(inputPath, rawRows[0]);
  const processedDir = 'processed';
  const exportsDir = 'exports';

  ensureDir(processedDir);
  ensureDir(exportsDir);
  ensureDir(path.join(exportsDir, 'by_lan'));

  writeCsv(path.join(processedDir, `master_${dateTag}.csv`), full, columns);
  writeCsv(path.join(exportsDir, `full_${dateTag}.csv`), full, columns);
  writeCsv(path.join(exportsDir, `mail_only_${dateTag}.csv`), mailOnly, columns);
  writeCountyExports(exportsDir, dateTag, groupedRows, columns);

  const stats = buildStats(rawRows, full, mailOnly, groupedRows);
  writeTextFile(path.join(exportsDir, `stats_${dateTag}.json`), JSON.stringify(stats, null, 2));

  console.log(JSON.stringify(stats, null, 2));
}

main();
