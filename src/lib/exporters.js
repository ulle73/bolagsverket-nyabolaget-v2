import path from 'node:path';
import { writeTextFile } from './io.js';

function escapeCsv(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function toCsv(rows, columns) {
  const header = columns.map(escapeCsv).join(',');
  const lines = rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(','));
  return [header, ...lines].join('\n');
}

export function writeCsv(filePath, rows, columns) {
  const csv = toCsv(rows, columns);
  writeTextFile(filePath, csv);
}

export function writeCountyExports(outputDir, dateTag, groupedRows, columns) {
  for (const [countySlug, rows] of Object.entries(groupedRows)) {
    const filePath = path.join(outputDir, 'by_lan', `${countySlug}_${dateTag}.csv`);
    writeCsv(filePath, rows, columns);
  }
}

export function buildStats(rawRows, fullRows, mailOnlyRows, groupedRows) {
  const perCounty = Object.fromEntries(
    Object.entries(groupedRows).map(([county, rows]) => [county, rows.length])
  );

  return {
    raw_rows: rawRows.length,
    relevant_new_companies: fullRows.length,
    rows_with_email: mailOnlyRows.length,
    counties: perCounty,
  };
}
