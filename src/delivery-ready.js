import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import {
  CONTACT_EXPORT_FIELDS,
  copyContactExportFields,
  getPrimaryEmail,
  getPrimaryPhone,
} from './company-contact.js';
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
  ...CONTACT_EXPORT_FIELDS,
];

function cleanValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function fallbackValue(value, fallback) {
  const cleaned = cleanValue(value);
  return cleaned || fallback;
}

function slugifySegment(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'unknown';
}

function toDeliveryReadyRow(company) {
  return {
    'E-post': cleanValue(getPrimaryEmail(company)),
    'Företagsnamn': cleanValue(company['Företagsnamn'] ?? ''),
    'OrgNr': cleanValue(company['OrgNr'] ?? ''),
    'Registreringsdatum': cleanValue(company['Registreringsdatum'] ?? ''),
    'Säteslän': fallbackValue(company['Säteslän'], 'Okänt län'),
    'Säteskommun': fallbackValue(company['Säteskommun'], 'Okänd kommun'),
    'Bransch': fallbackValue(company['Bransch_1'], 'Okänd'),
    'Telefon': cleanValue(getPrimaryPhone(company)),
    ...copyContactExportFields(company),
  };
}

function mapDeliveryEntriesToRows(entries) {
  return entries.map((entry) => toDeliveryReadyRow(entry.row));
}

function groupDeliveryEntries(entries, fieldName, { exclude = [], fallbackLabel = '' } = {}) {
  const groups = new Map();

  for (const entry of entries) {
    const rawValue = cleanValue(entry.row?.[fieldName]);
    const label = rawValue || fallbackLabel;

    if (!label || exclude.includes(label)) {
      continue;
    }

    const slug = slugifySegment(label);
    const group = groups.get(slug) ?? {
      label,
      entries: [],
    };

    group.entries.push(entry);
    groups.set(slug, group);
  }

  return groups;
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

async function writeGroupedDeliveryReady(rootDir, audienceFolder, groupFolder, fileStem, groups) {
  const written = [];

  for (const [slug, group] of groups.entries()) {
    const files = await writeDeliveryReadyFiles(
      path.join(rootDir, audienceFolder, groupFolder, slug, `${fileStem}-delivery-ready`),
      mapDeliveryEntriesToRows(group.entries),
    );

    written.push({
      Slug: slug,
      Etikett: group.label,
      Antal: group.entries.length,
      Filer: files,
    });
  }

  return written;
}

export async function writeDeliveryReady(companies, targetDate, options = {}) {
  const formattedDate = formatOutputDate(targetDate);
  const rootDir = path.join(path.resolve(options.outputRoot ?? 'exports'), formattedDate);
  if (companies.length === 0) {
    return {
      targetDate: formattedDate,
      rootDir,
      skipped: true,
    };
  }
  const stateDir = options.stateDir ?? 'state';
  const segments = buildSalesSegments(companies);
  const { filePath: deliveryHistoryFilePath, data: deliveryHistory } =
    await loadDeliveryHistory({ stateDir });

  const deliveryBuild = buildDeliveryEntries(
    segments['mail-only'],
    deliveryHistory,
    formattedDate,
  );

  const rows = mapDeliveryEntriesToRows(deliveryBuild.entries);
  const files = await writeDeliveryReadyFiles(
    path.join(rootDir, 'delivery-ready', formattedDate),
    rows,
  );
  const mirrored = {
    mailOnly: await writeDeliveryReadyFiles(
      path.join(rootDir, 'mail-only', `${formattedDate}-delivery-ready`),
      rows,
    ),
    byCounty: await writeGroupedDeliveryReady(
      rootDir,
      'by-lan',
      'mail-only',
      formattedDate,
      groupDeliveryEntries(deliveryBuild.entries, 'Säteslän'),
    ),
    byIndustry: await writeGroupedDeliveryReady(
      rootDir,
      'by-industry',
      'mail-only',
      formattedDate,
      groupDeliveryEntries(deliveryBuild.entries, 'Bransch_1', { exclude: ['Okänd'] }),
    ),
    byIndustryAll: await writeGroupedDeliveryReady(
      rootDir,
      'by-industry-all',
      'mail-only',
      formattedDate,
      groupDeliveryEntries(deliveryBuild.entries, 'Bransch_1', { fallbackLabel: 'Okänd' }),
    ),
  };

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
    AntalBortfiltreradeDublettmail: deliveryBuild.skippedDuplicateEmailCount,
    AntalBortfiltreradeUtanIdentitet: deliveryBuild.skippedMissingIdentityCount,
    LeveranshistorikFil: deliveryHistoryFilePath,
    AntalPosterILeveranshistorik: deliveryHistoryCommit.recipientCount,
    Filer: files,
    SpegladeFiler: {
      MailOnly: mirrored.mailOnly,
      AntalLänsgrupper: mirrored.byCounty.length,
      AntalBranschgrupper: mirrored.byIndustry.length,
      AntalBranschgrupperAlla: mirrored.byIndustryAll.length,
    },
  };

  const manifestPath = path.join(rootDir, 'delivery-ready', 'manifest.json');
  await writeJson(manifestPath, manifest);

  return {
    rootDir,
    files,
    mirrored,
    manifest,
    manifestPath,
    deliveryHistoryFilePath,
  };
}
