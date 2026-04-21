import https from 'node:https';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import puppeteer from 'puppeteer';

import { formatOutputDate } from './scb.js';
import { writeObjectsXlsx } from './xlsx.js';
import {
  cleanValue,
  hasValue,
  isAktiebolag,
  toCheckpointRow,
} from './company-contact.js';

const ALLABOLAG_HOME_URL = 'https://www.allabolag.se/';
const ALLABOLAG_SEARCH_URL = 'https://www.allabolag.se/search';
const ALLABOLAG_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const ALLABOLAG_JSON_HEADERS = {
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': ALLABOLAG_USER_AGENT,
  'x-nextjs-data': '1',
};
const ALLABOLAG_HTML_HEADERS = {
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': ALLABOLAG_USER_AGENT,
};
const CONTACT_FIELDS = [
  'phone',
  'phone2',
  'mobile',
  'mobile2',
  'faxNumber',
  'homePage',
  'email',
];
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30000;
const DEFAULT_REQUEST_DELAY_MS = 250;
const DEFAULT_PROTOCOL_TIMEOUT_MS = 120000;
const DEFAULT_CHECKPOINT_INTERVAL = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOrgNr(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function resolveConcurrency(options) {
  const configured = Number(
    options.concurrency ?? process.env.ALLABOLAG_CONCURRENCY ?? DEFAULT_CONCURRENCY,
  );

  if (!Number.isFinite(configured) || configured < 1) {
    return DEFAULT_CONCURRENCY;
  }

  return Math.floor(configured);
}

function resolveNavigationTimeout(options) {
  const configured = Number(
    options.navigationTimeoutMs ??
      process.env.ALLABOLAG_NAVIGATION_TIMEOUT_MS ??
      DEFAULT_NAVIGATION_TIMEOUT_MS,
  );

  if (!Number.isFinite(configured) || configured < 1000) {
    return DEFAULT_NAVIGATION_TIMEOUT_MS;
  }

  return Math.floor(configured);
}

function resolveRequestDelay(options) {
  const configured = Number(
    options.requestDelayMs ??
      process.env.ALLABOLAG_REQUEST_DELAY_MS ??
      DEFAULT_REQUEST_DELAY_MS,
  );

  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_REQUEST_DELAY_MS;
  }

  return Math.floor(configured);
}

function resolveProtocolTimeout(options) {
  const configured = Number(
    options.protocolTimeoutMs ??
      process.env.ALLABOLAG_PROTOCOL_TIMEOUT_MS ??
      DEFAULT_PROTOCOL_TIMEOUT_MS,
  );

  if (!Number.isFinite(configured) || configured < 1000) {
    return DEFAULT_PROTOCOL_TIMEOUT_MS;
  }

  return Math.floor(configured);
}

function resolveCheckpointInterval(options) {
  const configured = Number(
    options.checkpointInterval ??
      process.env.ALLABOLAG_CHECKPOINT_INTERVAL ??
      DEFAULT_CHECKPOINT_INTERVAL,
  );

  if (!Number.isFinite(configured) || configured < 1) {
    return DEFAULT_CHECKPOINT_INTERVAL;
  }

  return Math.floor(configured);
}

function resolveBrowserExecutablePath() {
  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    process.env.CHROME_PATH ??
    process.env.EDGE_PATH;

  if (envPath) {
    return envPath;
  }

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

async function readJsonFile(filePath, fallbackValue) {
  try {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallbackValue;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function httpGetText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body,
          });
        });
      },
    );

    request.on('error', reject);
    request.end();
  });
}

function buildSearchDataUrl(buildId, orgNr) {
  const params = new URLSearchParams({ q: orgNr });
  return `https://www.allabolag.se/_next/data/${buildId}/search.json?${params.toString()}`;
}

function normalizeContactPerson(contactPerson) {
  if (!contactPerson || typeof contactPerson !== 'object') {
    return null;
  }

  const normalized = {};

  for (const fieldName of ['type', 'name', 'role', 'id', 'birthDate']) {
    const value = cleanValue(contactPerson[fieldName]);
    if (value) {
      normalized[fieldName] = value;
    }
  }

  if (typeof contactPerson.businessPerson === 'boolean') {
    normalized.businessPerson = contactPerson.businessPerson;
  }

  if (Object.keys(normalized).length === 0) {
    return null;
  }

  return normalized;
}

function extractBuildIdFromText(text) {
  if (!text) {
    return '';
  }

  const nextDataMatch = text.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i,
  );

  if (nextDataMatch) {
    try {
      const payload = JSON.parse(nextDataMatch[1]);
      if (payload?.buildId) {
        return payload.buildId;
      }
    } catch {
      // Ignore and continue with regex fallbacks.
    }
  }

  const regexMatches = [
    text.match(/\/_next\/data\/([^/]+)\//i),
    text.match(/\/_next\/static\/([^/]+)\//i),
    text.match(/"buildId"\s*:\s*"([^"]+)"/i),
  ];

  for (const match of regexMatches) {
    if (match?.[1]) {
      return match[1];
    }
  }

  return '';
}

function buildLookupEntry(orgNr, status, hit, sourceUrl, errorMessage = '') {
  const entry = {
    orgNr,
    status,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
  };

  if (errorMessage) {
    entry.error = errorMessage;
  }

  if (typeof hit?.marketingProtection === 'boolean') {
    entry.marketingProtection = hit.marketingProtection;
  }

  for (const fieldName of CONTACT_FIELDS) {
    const value = cleanValue(hit?.[fieldName]);
    if (value) {
      entry[fieldName] = value;
    }
  }

  const contactPerson = normalizeContactPerson(hit?.contactPerson);
  if (contactPerson) {
    entry.contactPerson = contactPerson;
  }

  if (status === 'found' && entry.marketingProtection === true) {
    entry.status = 'marketing-protected';
  }

  if (status === 'found' && entry.status !== 'marketing-protected') {
    entry.status = 'enriched';
  }

  return entry;
}

function extractSearchCompanies(payload) {
  return (
    payload?.pageProps?.hydrationData?.searchStore?.companies?.companies ??
    payload?.pageProps?.searchStore?.companies?.companies ??
    []
  );
}

function findExactCompanyHit(companies, orgNr) {
  return (
    companies.find(
      (company) =>
        normalizeOrgNr(company?.orgnr) === orgNr ||
        normalizeOrgNr(company?.customerId) === orgNr,
    ) ?? null
  );
}

async function resolveBuildId(page) {
  await page.setExtraHTTPHeaders(ALLABOLAG_HTML_HEADERS);

  try {
    const response = await page.goto(ALLABOLAG_HOME_URL, {
      waitUntil: 'domcontentloaded',
    });

    if (response && response.status() < 400) {
      const html = await page.content();
      const buildIdFromHtml = extractBuildIdFromText(html);
      if (buildIdFromHtml) {
        return buildIdFromHtml;
      }

      const buildIdFromPage = await page.evaluate(() => {
        const nextDataNode = document.querySelector('#__NEXT_DATA__');
        if (nextDataNode?.textContent) {
          try {
            const payload = JSON.parse(nextDataNode.textContent);
            if (payload?.buildId) {
              return payload.buildId;
            }
          } catch {
            // Ignore and continue with resource inspection.
          }
        }

        const scripts = Array.from(document.scripts)
          .map((script) => script.src || script.textContent || '')
          .join('\n');

        const scriptMatch =
          scripts.match(/\/_next\/static\/([^/]+)\//i) ||
          scripts.match(/\/_next\/data\/([^/]+)\//i) ||
          scripts.match(/"buildId"\s*:\s*"([^"]+)"/i);

        return scriptMatch?.[1] ?? '';
      });

      if (buildIdFromPage) {
        return buildIdFromPage;
      }
    }
  } catch {
    // Fall through to HTTP fallback below.
  }

  const httpResponse = await httpGetText(ALLABOLAG_HOME_URL, ALLABOLAG_HTML_HEADERS);
  if (httpResponse.statusCode >= 200 && httpResponse.statusCode < 400) {
    const buildIdFromHttp = extractBuildIdFromText(httpResponse.body);
    if (buildIdFromHttp) {
      return buildIdFromHttp;
    }
  }

  throw new Error('Could not resolve Allabolag buildId from page content or HTTP fallback.');
}

async function fetchSearchPayload(page, buildId, orgNr) {
  const sourceUrl = buildSearchDataUrl(buildId, orgNr);
  await page.setExtraHTTPHeaders({
    ...ALLABOLAG_JSON_HEADERS,
    Referer: `${ALLABOLAG_SEARCH_URL}?q=${orgNr}`,
  });

  const response = await page.goto(sourceUrl, {
    waitUntil: 'domcontentloaded',
  });

  if (!response) {
    throw new Error(`Allabolag search did not return a response for ${orgNr}.`);
  }

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Allabolag search response was not valid JSON for ${orgNr}: ${error.message}`);
  }

  return {
    payload,
    sourceUrl,
    status: response.status(),
  };
}

async function lookupOrgNr(page, orgNr, initialBuildId) {
  let buildId = initialBuildId;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchSearchPayload(page, buildId, orgNr);

      if (response.status === 404 || response.payload?.page === '/_error') {
        buildId = await resolveBuildId(page);
        continue;
      }

      const companies = extractSearchCompanies(response.payload);
      const hit = findExactCompanyHit(companies, orgNr);

      if (!hit) {
        return {
          buildId,
          entry: buildLookupEntry(orgNr, 'not-found', null, response.sourceUrl),
        };
      }

      return {
        buildId,
        entry: buildLookupEntry(orgNr, 'found', hit, response.sourceUrl),
      };
    } catch (error) {
      if (attempt === 2) {
        return {
          buildId,
          entry: buildLookupEntry(orgNr, 'failed', null, buildSearchDataUrl(buildId, orgNr), error.message),
        };
      }

      buildId = await resolveBuildId(page);
    }
  }

  return {
    buildId,
    entry: buildLookupEntry(orgNr, 'not-found', null, buildSearchDataUrl(buildId, orgNr)),
  };
}

async function loadAllabolagCache({ stateDir = 'state' } = {}) {
  const filePath = path.join(path.resolve(stateDir), 'allabolag-cache.json');
  const data = await readJsonFile(filePath, {
    version: 1,
    companies: {},
  });

  return {
    filePath,
    data: {
      version: 1,
      companies: data?.companies ?? {},
    },
  };
}

async function saveAllabolagCache(filePath, data) {
  await writeJsonFile(filePath, data);
}

function mergeLookupIntoCompany(company, lookupEntry) {
  if (!lookupEntry) {
    return {
      ...company,
      allabolagLookupStatus: isAktiebolag(company) ? 'missing' : 'not-applicable',
    };
  }

  const merged = {
    ...company,
    allabolagLookupStatus: lookupEntry.status,
    allabolagFetchedAt: lookupEntry.fetchedAt ?? '',
    allabolagSourceUrl: lookupEntry.sourceUrl ?? '',
  };

  if (lookupEntry.error) {
    merged.allabolagLookupError = lookupEntry.error;
  }

  if (typeof lookupEntry.marketingProtection === 'boolean') {
    merged.marketingProtection = lookupEntry.marketingProtection;
  }

  for (const fieldName of CONTACT_FIELDS) {
    if (hasValue(lookupEntry[fieldName])) {
      merged[fieldName] = lookupEntry[fieldName];
    }
  }

  if (lookupEntry.contactPerson) {
    merged.contactPerson = lookupEntry.contactPerson;
  }

  return merged;
}

async function launchBrowser(options = {}) {
  const executablePath = resolveBrowserExecutablePath();
  const launchOptions = {
    headless: true,
    protocolTimeout: resolveProtocolTimeout(options),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  return puppeteer.launch(launchOptions);
}

async function saveEnrichedCompaniesJson(companies, targetDate, outputDir) {
  const checkpointDir = path.join(path.resolve(outputDir), 'enriched');
  const filePath = path.join(checkpointDir, `${formatOutputDate(targetDate)}.json`);
  await writeJsonFile(filePath, companies);
  return filePath;
}

async function saveEnrichedCompaniesXlsx(companies, targetDate, outputDir) {
  const checkpointDir = path.join(path.resolve(outputDir), 'enriched');
  const filePath = path.join(checkpointDir, `${formatOutputDate(targetDate)}.xlsx`);
  const rows = companies.map((company) => toCheckpointRow(company));
  await writeObjectsXlsx(filePath, rows, {
    sheetName: 'AllabolagEnriched',
  });
  return filePath;
}

async function saveEnrichmentStats(stats, targetDate, outputDir) {
  const checkpointDir = path.join(path.resolve(outputDir), 'enriched');
  const filePath = path.join(checkpointDir, `${formatOutputDate(targetDate)}-stats.json`);
  await writeJsonFile(filePath, stats);
  return filePath;
}

async function saveEnrichmentCheckpointSnapshot(
  companies,
  targetDate,
  outputDir,
  progress,
) {
  const checkpointDir = path.join(path.resolve(outputDir), 'enriched');
  const filePath = path.join(
    checkpointDir,
    `${formatOutputDate(targetDate)}.checkpoint.json`,
  );

  await writeJsonFile(filePath, {
    Datum: formatOutputDate(targetDate),
    Progress: progress,
    Companies: companies,
  });

  return filePath;
}

function buildEnrichmentStats(companies, uniqueAktiebolagOrgNrs, fromCacheCount, fetchedCount) {
  const statusCounts = new Map();

  for (const company of companies) {
    const status = String(company?.allabolagLookupStatus ?? '').trim();
    if (!status) {
      continue;
    }

    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  return {
    AntalRåposter: companies.length,
    AntalAktiebolag: uniqueAktiebolagOrgNrs.length,
    AntalUppslagningarFrånCache: fromCacheCount,
    AntalUppslagningarViaPuppeteer: fetchedCount,
    AntalBolagMedAllabolagEpost: companies.filter((company) => hasValue(company?.email)).length,
    AntalBolagMedKontaktperson: companies.filter((company) => company?.contactPerson).length,
    Statusfördelning: Object.fromEntries(statusCounts.entries()),
  };
}

export async function enrichAndSaveCompaniesWithAllabolag(
  companies,
  targetDate,
  options = {},
) {
  const formattedDate = formatOutputDate(targetDate);
  const outputDir = options.outputDir ?? 'raw';
  const stateDir = options.stateDir ?? 'state';
  const log =
    typeof options.writeProgress === 'function' ? options.writeProgress : () => {};
  const concurrency = resolveConcurrency(options);
  const navigationTimeoutMs = resolveNavigationTimeout(options);
  const requestDelayMs = resolveRequestDelay(options);
  const protocolTimeoutMs = resolveProtocolTimeout(options);
  const checkpointInterval = resolveCheckpointInterval(options);

  const clonedCompanies = companies.map((company) => ({ ...company }));
  const aktiebolagOrgNrs = Array.from(
    new Set(
      clonedCompanies
        .filter((company) => isAktiebolag(company))
        .map((company) => normalizeOrgNr(company?.OrgNr))
        .filter(Boolean),
    ),
  );

  const { filePath: cacheFilePath, data: cacheData } = await loadAllabolagCache({
    stateDir,
  });
  const lookupByOrgNr = new Map();
  let fromCacheCount = 0;

  for (const orgNr of aktiebolagOrgNrs) {
    const cachedEntry = cacheData.companies[orgNr];
    if (!cachedEntry) {
      continue;
    }

    lookupByOrgNr.set(orgNr, cachedEntry);
    fromCacheCount += 1;
  }

  const pendingOrgNrs = aktiebolagOrgNrs.filter((orgNr) => !lookupByOrgNr.has(orgNr));
  let fetchedCount = 0;
  let lastCheckpointCompletedCount = 0;

  const saveCheckpoint = async (completedCount) => {
    if (completedCount <= lastCheckpointCompletedCount) {
      return;
    }

    const snapshotCompanies = clonedCompanies.map((company) => {
      if (!isAktiebolag(company)) {
        return {
          ...company,
          allabolagLookupStatus: 'not-applicable',
        };
      }

      const orgNr = normalizeOrgNr(company?.OrgNr);
      return mergeLookupIntoCompany(company, lookupByOrgNr.get(orgNr));
    });

    const snapshotStats = {
      Datum: formattedDate,
      ...buildEnrichmentStats(
        snapshotCompanies,
        aktiebolagOrgNrs,
        fromCacheCount,
        fetchedCount,
      ),
      AntalBearbetadeAktiebolag: completedCount,
      AntalKvarvarandeAktiebolag: Math.max(0, pendingOrgNrs.length - completedCount),
    };

    const [snapshotPath] = await Promise.all([
      saveEnrichmentCheckpointSnapshot(snapshotCompanies, formattedDate, outputDir, {
        completed: completedCount,
        total: pendingOrgNrs.length,
        fetchedCount,
        fromCacheCount,
      }),
      saveEnrichmentStats(snapshotStats, formattedDate, outputDir),
      saveAllabolagCache(cacheFilePath, cacheData),
    ]);

    lastCheckpointCompletedCount = completedCount;
    log(`Allabolag-checkpoint sparad ${completedCount}/${pendingOrgNrs.length}: ${snapshotPath}\n`);
  };

  if (pendingOrgNrs.length > 0) {
    log(
      `Berikar ${pendingOrgNrs.length} aktiebolag via Allabolag med Puppeteer (cacheträffar: ${fromCacheCount}).\n`,
    );

    const browser = await launchBrowser({ protocolTimeoutMs });
    let nextIndex = 0;
    let completedCount = 0;

    try {
      const workerCount = Math.min(concurrency, pendingOrgNrs.length);

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          const page = await browser.newPage();
          page.setDefaultNavigationTimeout(navigationTimeoutMs);
          await page.setUserAgent(ALLABOLAG_USER_AGENT);
          let buildId = await resolveBuildId(page);

          try {
            while (true) {
              const currentIndex = nextIndex;
              nextIndex += 1;

              if (currentIndex >= pendingOrgNrs.length) {
                break;
              }

              const orgNr = pendingOrgNrs[currentIndex];
              const lookup = await lookupOrgNr(page, orgNr, buildId);
              buildId = lookup.buildId;
              lookupByOrgNr.set(orgNr, lookup.entry);
              cacheData.companies[orgNr] = lookup.entry;
              fetchedCount += 1;
              completedCount += 1;

              if (completedCount === pendingOrgNrs.length || completedCount % 25 === 0) {
                log(`Allabolag-berikning ${completedCount}/${pendingOrgNrs.length}\n`);
              }

              if (
                completedCount === pendingOrgNrs.length ||
                completedCount % checkpointInterval === 0
              ) {
                await saveCheckpoint(completedCount);
              }

              if (requestDelayMs > 0) {
                await sleep(requestDelayMs);
              }
            }
          } finally {
            await page.close();
          }
        }),
      );
    } finally {
      await browser.close();
    }
  } else {
    log(`Allabolag-cache täckte alla ${aktiebolagOrgNrs.length} aktiebolag.\n`);
  }

  const enrichedCompanies = clonedCompanies.map((company) => {
    if (!isAktiebolag(company)) {
      return {
        ...company,
        allabolagLookupStatus: 'not-applicable',
      };
    }

    const orgNr = normalizeOrgNr(company?.OrgNr);
    return mergeLookupIntoCompany(company, lookupByOrgNr.get(orgNr));
  });

  const stats = {
    Datum: formattedDate,
    ...buildEnrichmentStats(
      enrichedCompanies,
      aktiebolagOrgNrs,
      fromCacheCount,
      fetchedCount,
    ),
  };

  const [filePath, xlsxFilePath, statsFilePath] = await Promise.all([
    saveEnrichedCompaniesJson(enrichedCompanies, formattedDate, outputDir),
    saveEnrichedCompaniesXlsx(enrichedCompanies, formattedDate, outputDir),
    saveEnrichmentStats(stats, formattedDate, outputDir),
    saveAllabolagCache(cacheFilePath, cacheData),
  ]);

  return {
    companies: enrichedCompanies,
    count: enrichedCompanies.length,
    targetDate: formattedDate,
    filePath,
    xlsxFilePath,
    stats,
    statsFilePath,
    cacheFilePath,
  };
}
