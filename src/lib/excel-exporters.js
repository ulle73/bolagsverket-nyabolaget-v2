import ExcelJS from 'exceljs';
import path from 'node:path';
import { ensureDir } from './io.js';

export async function writeXlsx(filePath, rows, columns, sheetName = 'Data') {
  ensureDir(path.dirname(filePath));

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = columns.map((column) => ({
    header: column,
    key: column,
    width: Math.min(Math.max(column.length + 2, 14), 40),
  }));

  for (const row of rows) {
    worksheet.addRow(Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])));
  }

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const column of worksheet.columns) {
    let maxLength = column.header ? String(column.header).length : 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = cell.value == null ? '' : String(cell.value);
      maxLength = Math.max(maxLength, value.length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 14), 60);
  }

  await workbook.xlsx.writeFile(filePath);
}

export async function writeCountyXlsxExports(outputDir, dateTag, groupedRows, columns) {
  for (const [countySlug, rows] of Object.entries(groupedRows)) {
    const filePath = path.join(outputDir, 'by_lan', `${countySlug}_${dateTag}.xlsx`);
    await writeXlsx(filePath, rows, columns, countySlug.slice(0, 31) || 'Data');
  }
}
