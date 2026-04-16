import path from 'node:path';
import { REQUIRED_OUTPUT_COLUMNS, DERIVED_COLUMNS } from './config.js';
import { readJsonArray, ensureDir, basenameWithoutExt, writeTextFile } from './lib/io.js';
import { normalizeRow } from './lib/normalize.js';
import { splitRows, groupByCounty } from './lib/filters.js';
import { writeCsv, writeCountyExports, buildStats } from './lib/exporters.js';
import { writeXlsx, writeCountyXlsxExports } from './lib/excel-exporters.js';

function resolveDateTag(inputPath, firstRow) {
  const fromRow = firstRow?.['Registreringsdatum'] || firstRow?.['Startdatum'] || '';
  if (fromRow) return fromRow;
  return basenameWithoutExt(inputPath);
}

async function main() {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error('Användning: node src/index.excel.js raw/2026-03-02.json');
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

  const masterCsvPath = path.join(processedDir, `master_${dateTag}.csv`);
  const masterXlsxPath = path.join(processedDir, `master_${dateTag}.xlsx`);
  const fullCsvPath = path.join(exportsDir, `full_${dateTag}.csv`);
  const fullXlsxPath = path.join(exportsDir, `full_${dateTag}.xlsx`);
  const mailCsvPath = path.join(exportsDir, `mail_only_${dateTag}.csv`);
  const mailXlsxPath = path.join(exportsDir, `mail_only_${dateTag}.xlsx`);

  writeCsv(masterCsvPath, full, columns);
  writeCsv(fullCsvPath, full, columns);
  writeCsv(mailCsvPath, mailOnly, columns);
  writeCountyExports(exportsDir, dateTag, groupedRows, columns);

  await writeXlsx(masterXlsxPath, full, columns, 'Master');
  await writeXlsx(fullXlsxPath, full, columns, 'Full');
  await writeXlsx(mailXlsxPath, mailOnly, columns, 'MailOnly');
  await writeCountyXlsxExports(exportsDir, dateTag, groupedRows, columns);

  const stats = buildStats(rawRows, full, mailOnly, groupedRows);
  writeTextFile(path.join(exportsDir, `stats_${dateTag}.json`), JSON.stringify(stats, null, 2));

  console.log(JSON.stringify({
    ...stats,
    generated_files: {
      master_csv: masterCsvPath,
      master_xlsx: masterXlsxPath,
      full_csv: fullCsvPath,
      full_xlsx: fullXlsxPath,
      mail_csv: mailCsvPath,
      mail_xlsx: mailXlsxPath,
      county_csv_count: Object.keys(groupedRows).length,
      county_xlsx_count: Object.keys(groupedRows).length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
