import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import {
  CONTACT_EXPORT_FIELDS,
  buildContactExportFields,
  getPrimaryEmail,
  getPrimaryPhone,
  isMarketingProtected,
} from './company-contact.js';
import { formatOutputDate } from './scb.js';
import { writeObjectsXlsx } from './xlsx.js';

const SALES_EXPORT_FIELDS = [
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
  ...CONTACT_EXPORT_FIELDS,
];

const ALLOWED_COMPANY_STATUSES = new Set([
  'Är verksam',
  'Har aldrig varit verksam',
]);

function cleanValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim();
}

function hasValue(value) {
  return Boolean(String(value ?? '').trim());
}

function isRelevantNewCompany(company) {
  return (
    hasValue(company['Registreringsdatum']) &&
    !hasValue(company['Slutdatum']) &&
    cleanValue(company['Bolagsstatus']) === 'Normalläge' &&
    ALLOWED_COMPANY_STATUSES.has(cleanValue(company['Företagsstatus']))
  );
}

function isExcludedCompanyName(companyName) {
  const normalizedName = cleanValue(companyName ?? '');

  if (!normalizedName) {
    return false;
  }

  return (
    /\bholding(s)?\b/i.test(normalizedName) ||
    /aktieholding/i.test(normalizedName) ||
    /^wint startup \d+ ab$/i.test(normalizedName) ||
    /^magnora project infra \d+ ab$/i.test(normalizedName)
  );
}

function isExcludedIndustry(industryName) {
  const normalizedIndustry = cleanValue(industryName ?? '');
  return /holdingverksamhet/i.test(normalizedIndustry);
}

function isIncludedForSale(company) {
  return (
    isRelevantNewCompany(company) &&
    !isMarketingProtected(company) &&
    !isExcludedCompanyName(company['Företagsnamn']) &&
    !isExcludedIndustry(company['Bransch_1'])
  );
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

function groupBy(companies, fieldName, { exclude = [] } = {}) {
  const groups = new Map();

  for (const company of companies) {
    const rawValue = cleanValue(company[fieldName]);

    if (!rawValue || exclude.includes(rawValue)) {
      continue;
    }

    const key = slugifySegment(rawValue);
    const group = groups.get(key) ?? {
      label: rawValue,
      companies: [],
    };

    group.companies.push(company);
    groups.set(key, group);
  }

  return groups;
}

export function sanitizeCompanyForSale(company) {
  const sanitized = {};

  for (const fieldName of SALES_EXPORT_FIELDS) {
    if (fieldName === 'E-post') {
      sanitized[fieldName] = getPrimaryEmail(company);
      continue;
    }

    if (fieldName === 'Telefon') {
      sanitized[fieldName] = getPrimaryPhone(company);
      continue;
    }

    if (CONTACT_EXPORT_FIELDS.includes(fieldName)) {
      continue;
    }

    sanitized[fieldName] = cleanValue(company[fieldName] ?? '');
  }

  Object.assign(sanitized, buildContactExportFields(company));

  return sanitized;
}

export function buildSalesSegments(companies) {
  const relevantSource = companies.filter(isIncludedForSale);
  const full = relevantSource.map(sanitizeCompanyForSale);
  const mailOnlySource = relevantSource.filter((company) =>
    hasValue(getPrimaryEmail(company)),
  );
  const mailOnly = mailOnlySource.map(sanitizeCompanyForSale);
  const phoneOnlySource = relevantSource.filter((company) =>
    hasValue(getPrimaryPhone(company)),
  );
  const phoneOnly = phoneOnlySource.map(sanitizeCompanyForSale);

  return {
    master: full,
    'mail-only': mailOnly,
    'phone-only': phoneOnly,
    byCounty: {
      master: groupBy(full, 'Säteslän'),
      'mail-only': groupBy(mailOnly, 'Säteslän'),
      'phone-only': groupBy(phoneOnly, 'Säteslän'),
    },
    byIndustry: {
      master: groupBy(full, 'Bransch_1', { exclude: ['Okänd'] }),
      'mail-only': groupBy(mailOnly, 'Bransch_1', { exclude: ['Okänd'] }),
      'phone-only': groupBy(phoneOnly, 'Bransch_1', { exclude: ['Okänd'] }),
    },
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

async function writeJsonFile(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function writeCsvFile(filePath, companies) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, toCsv(companies, SALES_EXPORT_FIELDS), 'utf8');
}

async function writeJsonCsvXlsx(baseFilePathWithoutExtension, companies) {
  const jsonFilePath = `${baseFilePathWithoutExtension}.json`;
  const csvFilePath = `${baseFilePathWithoutExtension}.csv`;
  const xlsxFilePath = `${baseFilePathWithoutExtension}.xlsx`;

  await Promise.all([
    writeJsonFile(jsonFilePath, companies),
    writeCsvFile(csvFilePath, companies),
    writeObjectsXlsx(xlsxFilePath, companies, {
      sheetName: 'Companies',
      headers: SALES_EXPORT_FIELDS,
    }),
  ]);

  return {
    Jsonfil: jsonFilePath,
    Csvfil: csvFilePath,
    Xlsxfil: xlsxFilePath,
  };
}

async function writeGroupedSegments(rootDir, audienceFolder, groupFolder, fileStem, groups) {
  const written = [];

  for (const [slug, group] of groups.entries()) {
    const fileBase = path.join(rootDir, audienceFolder, groupFolder, slug, fileStem);
    const files = await writeJsonCsvXlsx(fileBase, group.companies);
    written.push({
      Slug: slug,
      Etikett: group.label,
      Antal: group.companies.length,
      Filer: files,
    });
  }

  return written;
}

export async function writeSalesExports(
  companies,
  targetDate,
  { outputRoot = 'exports' } = {},
) {
  const formattedDate = formatOutputDate(targetDate);
  const rootDir = path.join(path.resolve(outputRoot), formattedDate);
  if (companies.length === 0) {
    return {
      targetDate: formattedDate,
      rootDir,
      skipped: true,
    };
  }
  const fileStem = formattedDate;
  const segments = buildSalesSegments(companies);

  const masterFiles = await writeJsonCsvXlsx(
    path.join(rootDir, 'master', fileStem),
    segments.master,
  );
  const mailOnlyFiles = await writeJsonCsvXlsx(
    path.join(rootDir, 'mail-only', fileStem),
    segments['mail-only'],
  );
  const phoneOnlyFiles = await writeJsonCsvXlsx(
    path.join(rootDir, 'phone-only', fileStem),
    segments['phone-only'],
  );

  const grouped = {
    byCounty: {
      master: await writeGroupedSegments(
        rootDir,
        'by-lan',
        'master',
        fileStem,
        segments.byCounty.master,
      ),
      'mail-only': await writeGroupedSegments(
        rootDir,
        'by-lan',
        'mail-only',
        fileStem,
        segments.byCounty['mail-only'],
      ),
      'phone-only': await writeGroupedSegments(
        rootDir,
        'by-lan',
        'phone-only',
        fileStem,
        segments.byCounty['phone-only'],
      ),
    },
    byIndustry: {
      master: await writeGroupedSegments(
        rootDir,
        'by-industry',
        'master',
        fileStem,
        segments.byIndustry.master,
      ),
      'mail-only': await writeGroupedSegments(
        rootDir,
        'by-industry',
        'mail-only',
        fileStem,
        segments.byIndustry['mail-only'],
      ),
      'phone-only': await writeGroupedSegments(
        rootDir,
        'by-industry',
        'phone-only',
        fileStem,
        segments.byIndustry['phone-only'],
      ),
    },
  };

  const stats = {
    Datum: formattedDate,
    AntalRåposter: companies.length,
    AntalMasterposter: segments.master.length,
    AntalEpostposter: segments['mail-only'].length,
    AntalTelefonposter: segments['phone-only'].length,
    AntalTelefonnummer: segments.master.filter((company) => hasValue(company['Telefon']))
      .length,
    AntalKontaktspärradeBolag: companies.filter((company) => isMarketingProtected(company))
      .length,
    AntalAllabolagEpost: segments.master.filter((company) => hasValue(company['Allabolag e-post']))
      .length,
    AntalKontaktpersoner: segments.master.filter((company) => hasValue(company['Kontaktperson namn']))
      .length,
    AntalLänsgrupper: grouped.byCounty.master.length,
    AntalBranschgrupper: grouped.byIndustry.master.length,
  };
  const statsFilePath = path.join(rootDir, 'stats.json');

  await writeJsonFile(statsFilePath, stats);

  return {
    targetDate: formattedDate,
    rootDir,
    files: {
      master: masterFiles,
      'mail-only': mailOnlyFiles,
      'phone-only': phoneOnlyFiles,
    },
    grouped,
    stats,
    statsFilePath,
  };
}
