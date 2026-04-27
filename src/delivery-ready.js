import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import {
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
  'Säteslän',
  'Säteskommun',
  'Bransch',
  'PostAdress',
  'PostNr',
  'Telefon',
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
    'Säteslän': fallbackValue(company['Säteslän'], 'Okänt län'),
    'Säteskommun': fallbackValue(company['Säteskommun'], 'Okänd kommun'),
    'Bransch': fallbackValue(company['Bransch_1'], 'Okänd'),
    'PostAdress': cleanValue(company['PostAdress'] ?? ''),
    'PostNr': cleanValue(company['PostNr'] ?? ''),
    'Telefon': cleanValue(getPrimaryPhone(company)),
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

async function writeMirroredAudienceDeliveryReady(rootDir, audienceFolder, fileStem, entries) {
  const rows = mapDeliveryEntriesToRows(entries);

  return {
    files: await writeDeliveryReadyFiles(
      path.join(rootDir, audienceFolder, `${fileStem}-delivery-ready`),
      rows,
    ),
    byCounty: await writeGroupedDeliveryReady(
      rootDir,
      'by-lan',
      audienceFolder,
      fileStem,
      groupDeliveryEntries(entries, 'Säteslän'),
    ),
    byIndustry: await writeGroupedDeliveryReady(
      rootDir,
      'by-industry',
      audienceFolder,
      fileStem,
      groupDeliveryEntries(entries, 'Bransch_1', { exclude: ['Okänd'] }),
    ),
    byIndustryAll: await writeGroupedDeliveryReady(
      rootDir,
      'by-industry-all',
      audienceFolder,
      fileStem,
      groupDeliveryEntries(entries, 'Bransch_1', { fallbackLabel: 'Okänd' }),
    ),
  };
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
  const { filePath: phoneDeliveryHistoryFilePath, data: phoneDeliveryHistory } =
    await loadDeliveryHistory({ stateDir, channel: 'phone' });

  const deliveryBuild = buildDeliveryEntries(
    segments['mail-only'],
    deliveryHistory,
    formattedDate,
  );
  const phoneDeliveryBuild = buildDeliveryEntries(
    segments['phone-only'],
    phoneDeliveryHistory,
    formattedDate,
    { channel: 'phone' },
  );

  const rows = mapDeliveryEntriesToRows(deliveryBuild.entries);
  const phoneRows = mapDeliveryEntriesToRows(phoneDeliveryBuild.entries);
  const files = await writeDeliveryReadyFiles(
    path.join(rootDir, 'delivery-ready', formattedDate),
    rows,
  );
  const mirroredMailOnly = await writeMirroredAudienceDeliveryReady(
    rootDir,
    'mail-only',
    formattedDate,
    deliveryBuild.entries,
  );
  const mirroredPhoneOnly = await writeMirroredAudienceDeliveryReady(
    rootDir,
    'phone-only',
    formattedDate,
    phoneDeliveryBuild.entries,
  );

  const deliveryHistoryCommit = await commitDeliveryHistory(
    deliveryBuild.entries,
    formattedDate,
    { stateDir },
  );
  const phoneDeliveryHistoryCommit = await commitDeliveryHistory(
    phoneDeliveryBuild.entries,
    formattedDate,
    { stateDir, channel: 'phone' },
  );

  const mirrored = {
    mailOnly: mirroredMailOnly.files,
    phoneOnly: mirroredPhoneOnly.files,
    byCounty: mirroredMailOnly.byCounty,
    byIndustry: mirroredMailOnly.byIndustry,
    byIndustryAll: mirroredMailOnly.byIndustryAll,
    phoneByCounty: mirroredPhoneOnly.byCounty,
    phoneByIndustry: mirroredPhoneOnly.byIndustry,
    phoneByIndustryAll: mirroredPhoneOnly.byIndustryAll,
  };

  const manifest = {
    Datum: formattedDate,
    AntalEpostklaraBolag: segments['mail-only'].length,
    AntalTelefonklaraBolag: segments['phone-only'].length,
    AntalUtskicksklaraBolag: rows.length,
    AntalTelefonUtskicksklaraBolag: phoneRows.length,
    AntalBortfiltreradeRedanKöade: deliveryBuild.skippedAlreadyQueuedCount,
    AntalBortfiltreradeDublettmail: deliveryBuild.skippedDuplicateContactCount,
    AntalBortfiltreradeUtanIdentitet: deliveryBuild.skippedMissingIdentityCount,
    LeveranshistorikFil: deliveryHistoryFilePath,
    AntalPosterILeveranshistorik: deliveryHistoryCommit.recipientCount,
    AntalTelefonBortfiltreradeRedanKöade: phoneDeliveryBuild.skippedAlreadyQueuedCount,
    AntalBortfiltreradeDublettnummer: phoneDeliveryBuild.skippedDuplicateContactCount,
    AntalTelefonBortfiltreradeUtanIdentitet: phoneDeliveryBuild.skippedMissingIdentityCount,
    TelefonleveranshistorikFil: phoneDeliveryHistoryFilePath,
    AntalPosterITelefonleveranshistorik: phoneDeliveryHistoryCommit.recipientCount,
    Filer: files,
    SpegladeFiler: {
      MailOnly: mirrored.mailOnly,
      PhoneOnly: mirrored.phoneOnly,
      AntalLänsgrupper: mirrored.byCounty.length,
      AntalBranschgrupper: mirrored.byIndustry.length,
      AntalBranschgrupperAlla: mirrored.byIndustryAll.length,
      AntalTelefonLänsgrupper: mirrored.phoneByCounty.length,
      AntalTelefonBranschgrupper: mirrored.phoneByIndustry.length,
      AntalTelefonBranschgrupperAlla: mirrored.phoneByIndustryAll.length,
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
    phoneDeliveryHistoryFilePath,
  };
}
