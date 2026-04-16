import https from 'node:https';
import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

import { writeObjectsXlsx } from './xlsx.js';

export const SCB_MAX_ROWS_PER_REQUEST = 2000;
const SCB_REQUEST_INTERVAL_MS = 1100;

let nextScbRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForScbRequestSlot() {
  const now = Date.now();
  const waitMs = Math.max(0, nextScbRequestAt - now);

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  nextScbRequestAt = Date.now() + SCB_REQUEST_INTERVAL_MS;
}

export function formatScbDate(targetDate) {
  if (/^\d{8}$/.test(targetDate)) {
    return targetDate;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);

  if (!isoMatch) {
    throw new Error('SCB date must use YYYY-MM-DD or YYYYMMDD format.');
  }

  const [, year, month, day] = isoMatch;
  return `${year}${month}${day}`;
}

export function formatOutputDate(targetDate) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return targetDate;
  }

  const compactMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(targetDate);

  if (!compactMatch) {
    throw new Error('Output date must use YYYY-MM-DD or YYYYMMDD format.');
  }

  const [, year, month, day] = compactMatch;
  return `${year}-${month}-${day}`;
}

function buildExactDateQuery(variableName, targetDate, options = {}) {
  const { orgNumberPrefix = '' } = options;
  const scbDate = formatScbDate(targetDate);
  const query = {
    Variabler: [
      {
        Variabel: variableName,
        Operator: 'FranOchMed',
        Varde1: scbDate,
        Varde2: '',
      },
      {
        Variabel: variableName,
        Operator: 'TillOchMed',
        Varde1: scbDate,
        Varde2: '',
      },
    ],
  };

  if (orgNumberPrefix) {
    query.Variabler.push({
      Variabel: 'OrgNr (10 siffror)',
      Operator: 'BorjarPa',
      Varde1: orgNumberPrefix,
      Varde2: '',
    });
  }

  return query;
}

export function buildExactRegistrationDateQuery(targetDate, options = {}) {
  return buildExactDateQuery('Registreringsdatum', targetDate, options);
}

export function dedupeCompaniesByIdentity(companies) {
  const seen = new Set();
  const deduped = [];

  for (const company of companies) {
    const identity = company.PeOrgNr || company.OrgNr || JSON.stringify(company);

    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    deduped.push(company);
  }

  return deduped;
}

function parseDotEnv(text) {
  const values = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

async function readEnvFile(envPath) {
  try {
    return await readFile(envPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

async function resolveScbCredentials({ envPath = '.env', scbDir = 'scb' } = {}) {
  const envFileText = await readEnvFile(envPath);
  const envFileValues = parseDotEnv(envFileText);
  const passphrase = process.env.SCB_PASSWORD ?? envFileValues.SCB_PASSWORD;

  if (!passphrase) {
    throw new Error(`Missing SCB_PASSWORD in process environment or ${envPath}.`);
  }

  const configuredPfxPath = process.env.SCB_PFX_PATH ?? envFileValues.SCB_PFX_PATH;

  let pfxPath;

  if (configuredPfxPath) {
    pfxPath = path.resolve(configuredPfxPath);
  } else {
    const entries = await readdir(scbDir, { withFileTypes: true });
    const pfxEntry = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pfx'),
    );

    if (!pfxEntry) {
      throw new Error(`Could not find a .pfx file in ${scbDir}.`);
    }

    pfxPath = path.resolve(scbDir, pfxEntry.name);
  }

  return {
    passphrase,
    pfxPath,
  };
}

async function scbRequest(pathname, body, { pfxBuffer, passphrase }) {
  await waitForScbRequestSlot();

  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify(body);

    const request = https.request(
      {
        hostname: 'privateapi.scb.se',
        path: pathname,
        method: 'POST',
        pfx: pfxBuffer,
        passphrase,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(requestBody),
          Connection: 'close',
        },
        agent: false,
      },
      (response) => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(responseBody);
            return;
          }

          reject(
            new Error(
              `SCB request to ${pathname} failed with status ${response.statusCode ?? 'unknown'}: ${responseBody}`,
            ),
          );
        });
      },
    );

    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });
}

async function scbRequestWithRetry(pathname, body, credentials, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await scbRequest(pathname, body, credentials);
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      await sleep(500 * attempt);
    }
  }

  throw lastError;
}

async function countCompaniesByQuery(query, options = {}) {
  const { passphrase, pfxPath } = await resolveScbCredentials(options);
  const pfxBuffer = await readFile(pfxPath);
  const responseBody = await scbRequestWithRetry(
    '/nv0101/v1/sokpavar/api/je/raknaforetag',
    query,
    { pfxBuffer, passphrase },
  );
  const count = Number.parseInt(responseBody.trim(), 10);

  if (!Number.isFinite(count)) {
    throw new Error(`SCB count response was not a number: ${responseBody}`);
  }

  return count;
}

async function fetchCompaniesPageByQuery(query, options = {}) {
  const { passphrase, pfxPath } = await resolveScbCredentials(options);
  const pfxBuffer = await readFile(pfxPath);
  const responseBody = await scbRequestWithRetry(
    '/nv0101/v1/sokpavar/api/je/hamtaforetag',
    query,
    { pfxBuffer, passphrase },
  );

  let companies;

  try {
    companies = JSON.parse(responseBody);
  } catch (error) {
    throw new Error(`SCB company response could not be parsed as JSON: ${error.message}`);
  }

  if (!Array.isArray(companies)) {
    throw new Error('SCB company response must be an array of company objects.');
  }

  return companies;
}

async function fetchCompaniesByQuery(query, targetDate, options = {}) {
  const count = await countCompaniesByQuery(query, options);

  if (count > SCB_MAX_ROWS_PER_REQUEST) {
    throw new Error(
      `SCB returned ${count} rows for ${formatOutputDate(targetDate)}. That exceeds the ${SCB_MAX_ROWS_PER_REQUEST} row limit per request.`,
    );
  }

  if (count === 0) {
    return [];
  }

  return fetchCompaniesPageByQuery(query, options);
}

function expandOrgNumberPrefixes(prefix) {
  return Array.from({ length: 10 }, (_, digit) => `${prefix}${digit}`);
}

async function fetchCompaniesByRegistrationDateSegment(targetDate, options = {}, prefix = '') {
  const query = buildExactRegistrationDateQuery(targetDate, {
    orgNumberPrefix: prefix,
  });
  const count = await countCompaniesByQuery(query, options);

  if (count === 0) {
    return [];
  }

  if (count <= SCB_MAX_ROWS_PER_REQUEST) {
    return fetchCompaniesPageByQuery(query, options);
  }

  if (prefix.length >= 10) {
    throw new Error(`Could not segment ${formatOutputDate(targetDate)} any further for prefix ${prefix}.`);
  }

  const companies = [];

  for (const childPrefix of expandOrgNumberPrefixes(prefix)) {
    const segmentCompanies = await fetchCompaniesByRegistrationDateSegment(targetDate, options, childPrefix);
    companies.push(...segmentCompanies);
  }

  return dedupeCompaniesByIdentity(companies);
}

export async function countCompaniesByExactRegistrationDate(targetDate, options = {}) {
  return countCompaniesByQuery(buildExactRegistrationDateQuery(targetDate), options);
}

export async function fetchCompaniesByExactRegistrationDate(targetDate, options = {}) {
  const initialCount = await countCompaniesByExactRegistrationDate(targetDate, options);

  if (initialCount === 0) {
    return [];
  }

  if (initialCount <= SCB_MAX_ROWS_PER_REQUEST) {
    return fetchCompaniesByQuery(buildExactRegistrationDateQuery(targetDate), targetDate, options);
  }

  return fetchCompaniesByRegistrationDateSegment(targetDate, options);
}

export async function saveCompaniesJson(companies, targetDate, { outputDir = 'raw' } = {}) {
  const datedFileName = `${formatOutputDate(targetDate)}.json`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, datedFileName);

  await mkdir(absoluteOutputDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(companies, null, 2), 'utf8');

  return filePath;
}

export async function saveCompaniesXlsx(companies, targetDate, { outputDir = 'raw' } = {}) {
  const datedFileName = `${formatOutputDate(targetDate)}.xlsx`;
  const absoluteOutputDir = path.resolve(outputDir);
  const filePath = path.join(absoluteOutputDir, datedFileName);

  await writeObjectsXlsx(filePath, companies, {
    sheetName: 'Companies',
  });

  return filePath;
}

export async function fetchAndSaveCompaniesByExactRegistrationDate(targetDate, options = {}) {
  const companies = await fetchCompaniesByExactRegistrationDate(targetDate, options);
  const [filePath, xlsxFilePath] = await Promise.all([
    saveCompaniesJson(companies, targetDate, options),
    saveCompaniesXlsx(companies, targetDate, options),
  ]);

  return {
    companies,
    count: companies.length,
    filePath,
    xlsxFilePath,
    targetDate: formatOutputDate(targetDate),
  };
}
