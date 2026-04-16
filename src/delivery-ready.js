import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { formatOutputDate } from './scb.js';
import { buildSalesSegments } from './sales-exports.js';
import { writeObjectsXlsx } from './xlsx.js';
import {
  loadDeliveryHistory,
  buildDeliveryEntries,
  commitDeliveryHistory,
} from './history-state.js';

const DELIVERY_READY_FIELDS = [
  'E-post',
  'Företagsnamn',
  'OrgNr',
  'Registreringsdatum',
  'Säteslän',
  'Säteskommun',
  'Bransch',
  'Telefon',
];

function cleanValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function fallbackValue(value, fallback) {
  const cleaned = cleanValue(value);
  return cleaned || fallback;
}

function toDeliveryReadyRow(company) {
  return {
    'E-post': cleanValue(company['E-post'] ?? ''),
    'Företagsnamn': cleanValue(company['Företagsnamn'] ?? ''),
    'OrgNr': cleanValue(company['OrgNr'] ?? ''),
    'Registreringsdatum': cleanValue(company['Registreringsdatum'] ?? ''),
    'Säteslän': fallbackValue(company['Säteslän'], 'Okänt län'),
    'Säteskommun': fallbackValue(company['Säteskommun'], 'Okänd kommun'),
    'Bransch': fallbackValue(company['Bransch_1'], 'Okänd'),
    'Telefon': cleanValue(company['Telefon'] ?? ''),
  };
}

function toCsv(rows, headers) {
  const escapeCell = (value) => {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const csvRows = [headers.map(escapeCell).join(',')];

  for (const row of rows) {
    csvRows.push(headers.map((header) => escapeCell(row?.[header])).join(','));
  }

  return csvRows.join('\n');
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function writeCsv(filePath, rows, headers) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, toCsv(rows, headers), 'utf8');
}

async function writeDeliveryReadyFiles(basePath, rows) {
  const jsonPath = `${basePath}.json`;
  const csvPath = `${basePath}.csv`;
  const xlsxPath = `${basePath}.xlsx`;

  await Promise.all([
    writeJson(jsonPath, rows),
    writeCsv(csvPath, rows, DELIVERY_READY_FIELDS),
    writeObjectsXlsx(xlsxPath, rows, {
      sheetName: 'Utskicksklar',
      headers: DELIVERY_READY_FIELDS,
    }),
  ]);

  return {
    Jsonfil: jsonPath,
    Csvfil: csvPath,
    Xlsxfil: xlsxPath,
  };
}

export async function writeDeliveryReady(companies, targetDate, options = {}) {
  const formattedDate = formatOutputDate(targetDate);
  const rootDir = path.join(path.resolve(options.outputRoot ?? 'exports'), formattedDate);
  const stateDir = options.stateDir ?? 'state';
  const segments = buildSalesSegments(companies);
  const { filePath: deliveryHistoryFilePath, data: deliveryHistory } =
    await loadDeliveryHistory({ stateDir });

  const deliveryBuild = buildDeliveryEntries(
    segments['mail-only'],
    deliveryHistory,
    formattedDate,
  );

  const rows = deliveryBuild.entries.map((entry) => toDeliveryReadyRow(entry.row));
  const files = await writeDeliveryReadyFiles(
    path.join(rootDir, 'delivery-ready', formattedDate),
    rows,
  );

  const deliveryHistoryCommit = await commitDeliveryHistory(
    deliveryBuild.entries,
    formattedDate,
    { stateDir },
  );

  const manifest = {
    Datum: formattedDate,
    AntalEpostklaraBolag: segments['mail-only'].length,
    AntalUtskicksklaraBolag: rows.length,
    AntalBortfiltreradeRedanKöade: deliveryBuild.skippedAlreadyQueuedCount,
    AntalBortfiltreradeUtanIdentitet: deliveryBuild.skippedMissingIdentityCount,
    LeveranshistorikFil: deliveryHistoryFilePath,
    AntalPosterILeveranshistorik: deliveryHistoryCommit.recipientCount,
    Filer: files,
  };

  const manifestPath = path.join(rootDir, 'delivery-ready', 'manifest.json');
  await writeJson(manifestPath, manifest);

  return {
    rootDir,
    files,
    manifest,
    manifestPath,
    deliveryHistoryFilePath,
  };
}
