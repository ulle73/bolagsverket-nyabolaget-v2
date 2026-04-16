import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import ExcelJS from 'exceljs';

function normalizeCellValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
}

function collectHeaders(rows) {
  const headers = [];
  const seen = new Set();

  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      headers.push(key);
    }
  }

  return headers;
}

function columnWidthFor(values, header) {
  let width = Math.max(String(header).length, 12);

  for (const value of values) {
    const text = String(normalizeCellValue(value) ?? '');
    width = Math.max(width, text.length);

    if (width >= 40) {
      return 40;
    }
  }

  return Math.min(width + 2, 40);
}

export async function writeObjectsXlsx(
  filePath,
  rows,
  { sheetName = 'Companies', headers } = {},
) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  const finalHeaders = headers ?? collectHeaders(rows);

  if (finalHeaders.length > 0) {
    worksheet.columns = finalHeaders.map((header) => ({
      header,
      width: 12,
    }));
  }

  for (const row of rows) {
    worksheet.addRow(
      finalHeaders.map((header) => normalizeCellValue(row?.[header])),
    );
  }

  if (finalHeaders.length > 0) {
    for (let index = 0; index < finalHeaders.length; index += 1) {
      const header = finalHeaders[index];
      const columnValues = rows.map((row) => row?.[header]);
      worksheet.getColumn(index + 1).width = columnWidthFor(columnValues, header);
    }
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);

  return filePath;
}
