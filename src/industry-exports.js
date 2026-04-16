import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { formatOutputDate } from './scb.js';
import { buildSalesSegments } from './sales-exports.js';
import { writeObjectsXlsx } from './xlsx.js';

const INDUSTRY_FIELDS = [
  'OrgNr',
  'PeOrgNr',
  'Företagsnamn',
  'Firma',
  'Juridisk form',
  'Privat/Publikt',
  'Registreringsdatum',
  'Startdatum',
  'Slutdatum',
  'Bolagsstatus',
  'Företagsstatus',
  'Bransch_1',
  'Bransch_1, kod',
  'Säteskommun',
  'Säteslän',
  'ARegion',
  'PostAdress',
  'PostNr',
  'PostOrt',
  'E-post',
  'Telefon',
  'Fskattstatus',
  'Momsstatus',
  'Arbetsgivarstatus',
  'Storleksklass SME',
  'Utskick',
  'Reklam',
];

function cleanValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function slugifySegment(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'okand';
}

function groupByIndustry(rows) {
  const groups = new Map();

  for (const row of rows) {
    const label = cleanValue(row['Bransch_1']) || 'Okänd';
    const slug = slugifySegment(label);
    const group = groups.get(slug) ?? { label, rows: [] };
    group.rows.push({ ...row, 'Bransch_1': label });
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

async function writeCsv(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, toCsv(rows, INDUSTRY_FIELDS), 'utf8');
}

async function writeGroupFiles(basePath, rows) {
  const jsonPath = `${basePath}.json`;
  const csvPath = `${basePath}.csv`;
  const xlsxPath = `${basePath}.xlsx`;

  await Promise.all([
    writeJson(jsonPath, rows),
    writeCsv(csvPath, rows),
    writeObjectsXlsx(xlsxPath, rows, {
      sheetName: 'Bransch',
      headers: INDUSTRY_FIELDS,
    }),
  ]);

  return { Jsonfil: jsonPath, Csvfil: csvPath, Xlsxfil: xlsxPath };
}

async function writeAudience(rootDir, audienceFolder, rows, formattedDate) {
  const groups = groupByIndustry(rows);
  const written = [];

  for (const [slug, group] of groups.entries()) {
    const files = await writeGroupFiles(
      path.join(rootDir, 'by-industry-all', audienceFolder, slug, formattedDate),
      group.rows,
    );
    written.push({ Slug: slug, Etikett: group.label, Antal: group.rows.length, Filer: files });
  }

  return written;
}

export async function writeIndustryExports(companies, targetDate, { outputRoot = 'exports' } = {}) {
  const formattedDate = formatOutputDate(targetDate);
  const rootDir = path.join(path.resolve(outputRoot), formattedDate);
  const segments = buildSalesSegments(companies);

  const master = await writeAudience(rootDir, 'master', segments.master, formattedDate);
  const mailOnly = await writeAudience(rootDir, 'mail-only', segments['mail-only'], formattedDate);

  const manifest = {
    Datum: formattedDate,
    AntalBranschgrupperMaster: master.length,
    AntalBranschgrupperEpost: mailOnly.length,
  };
  const manifestPath = path.join(rootDir, 'by-industry-all', 'manifest.json');
  await writeJson(manifestPath, manifest);

  return {
    rootDir,
    master,
    mailOnly,
    manifestPath,
  };
}
