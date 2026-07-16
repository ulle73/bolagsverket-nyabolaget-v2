import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile, mkdir } from 'node:fs/promises';

import { fetchOldestCompanies } from './oldest-companies.js';

const CHECKPOINT_EVERY = 5;
const DEFAULT_BATCH_OUT = path.join('revenue-enricher', 'oldest-revenue.json');

// Rate limiting defaults. Halls medvetet snalla for att inte bli blockerad av allabolag.
const DEFAULT_DELAY_MS = 4000; // paus mellan bolag i batch-lage
const DEFAULT_JITTER_MS = 2000; // slumpmassigt pahang ovanpa delay
const DEFAULT_RETRIES = 3; // antal omforsok per bolag vid fel/blockering
const BACKOFF_BASE_MS = 15000; // grundpaus vid backoff (dubblas per forsok)

const ALLABOLAG_BASE_URL = 'https://www.allabolag.se';

const DEFAULT_HEADERS = {
  'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const DEFAULT_USER_AGENT = DEFAULT_HEADERS['user-agent'];

function parseArgs(argv) {
  const args = {
    queries: [],
    orgNrs: [],
    year: null,
    headless: null,
    limit: 1,
    json: false,
    help: false,
    out: null,
    batchCount: null,
    delayMs: DEFAULT_DELAY_MS,
    jitterMs: DEFAULT_JITTER_MS,
    retries: DEFAULT_RETRIES,
    location: null,
  };

  const KNOWN_KEY_FLAGS = new Set([
    'query',
    'orgnr',
    'year',
    'limit',
    'headless',
    'out',
    'delay',
    'jitter',
    'retries',
    'location',
  ]);

  for (const token of argv) {
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--json') {
      args.json = true;
      continue;
    }

    const batchMatch = token.match(/^--(\d+)$/);
    if (batchMatch) {
      args.batchCount = Number.parseInt(batchMatch[1], 10);
      continue;
    }

    const eqMatch = token.match(/^--([a-z-]+)=(.*)$/);
    if (token.startsWith('--') && eqMatch) {
      const key = eqMatch[1];
      const value = eqMatch[2];

      if (key === 'query') {
        args.queries.push(value);
      } else if (key === 'orgnr') {
        args.orgNrs.push(value);
      } else if (key === 'year') {
        const parsed = Number.parseInt(value, 10);
        args.year = Number.isFinite(parsed) ? parsed : null;
      } else if (key === 'limit') {
        const parsed = Number.parseInt(value, 10);
        args.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : args.limit;
      } else if (key === 'headless') {
        args.headless = value === '1' || value === 'true' || value === 'yes';
      } else if (key === 'out') {
        args.out = value;
      } else if (key === 'delay') {
        const parsed = Number.parseInt(value, 10);
        args.delayMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : args.delayMs;
      } else if (key === 'jitter') {
        const parsed = Number.parseInt(value, 10);
        args.jitterMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : args.jitterMs;
      } else if (key === 'retries') {
        const parsed = Number.parseInt(value, 10);
        args.retries = Number.isFinite(parsed) && parsed >= 0 ? parsed : args.retries;
      } else if (key === 'location') {
        args.location = value.trim() || null;
      } else {
        throw new Error(`Okänd flagga: --${key}`);
      }
      continue;
    }

    // En "naken" flagga som inte är en känd nyckelflagga eller ett tal, t.ex.
    // --stockholm, tolkas som platsfilter (län/kommun/postort).
    const bareFlagMatch = token.match(/^--([a-zA-ZåäöÅÄÖ][\wåäöÅÄÖ-]*)$/);
    if (bareFlagMatch && !KNOWN_KEY_FLAGS.has(bareFlagMatch[1].toLowerCase())) {
      args.location = bareFlagMatch[1];
      continue;
    }

    if (token.startsWith('--')) {
      throw new Error(`Okänd flagga: ${token}`);
    }

    args.queries.push(token);
  }

  return args;
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function htmlToText(html) {
  return normalizeWhitespace(
    decodeHtmlEntities(
      String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

function buildSearchUrl(query) {
  return `${ALLABOLAG_BASE_URL}/bransch-s%C3%B6k?q=${encodeURIComponent(query)}`;
}

function buildOrgNrSearchUrl(orgNr) {
  return `${ALLABOLAG_BASE_URL}/bransch-s%C3%B6k?q=${encodeURIComponent(orgNr)}`;
}

function getBrowserArgs() {
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-infobars',
    '--lang=sv-SE',
    '--no-default-browser-check',
    '--start-maximized',
  ];
}

async function ensureStealthLikePage(page) {
  const initScript = `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['sv-SE', 'sv', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = window.chrome || { runtime: {} };
  `;

  if (page.addInitScript) {
    await page.addInitScript(initScript);
  } else if (page.evaluateOnNewDocument) {
    await page.evaluateOnNewDocument(initScript);
  }

  if (page.setExtraHTTPHeaders) {
    await page.setExtraHTTPHeaders({ 'accept-language': DEFAULT_HEADERS['accept-language'] });
  }

  if (page.setUserAgent) {
    await page.setUserAgent(DEFAULT_USER_AGENT);
  }

  if (page.setViewportSize) {
    await page.setViewportSize({ width: 1366, height: 900 });
  }
}

function resolveHeadless(options) {
  if (typeof options.headless === 'boolean') {
    return options.headless;
  }

  const rawValue = String(process.env.ALLABOLAG_HEADLESS || '').trim().toLowerCase();
  if (!rawValue) {
    return false;
  }

  return rawValue === '1' || rawValue === 'true' || rawValue === 'yes';
}

async function createBrowserSession(options = {}) {
  const headless = resolveHeadless(options);

  try {
    const playwright = await import('playwright');
    if (playwright?.chromium) {
      const context = await playwright.chromium.launchPersistentContext('.allabolag-revenue-profile', {
        channel: 'chrome',
        headless,
        ignoreHTTPSErrors: true,
        locale: 'sv-SE',
        timezoneId: 'Europe/Stockholm',
        userAgent: DEFAULT_USER_AGENT,
        viewport: { width: 1366, height: 900 },
        args: getBrowserArgs(),
      });
      const page = context.pages()[0] || (await context.newPage());
      await ensureStealthLikePage(page);

      return { type: 'playwright', page, close: () => context.close() };
    }
  } catch (_error) {
    // Fall through to puppeteer.
  }

  try {
    const puppeteerModule = await import('puppeteer');
    const puppeteer = puppeteerModule?.default || puppeteerModule;
    if (puppeteer?.launch) {
      const browser = await puppeteer.launch({
        channel: 'chrome',
        headless,
        defaultViewport: { width: 1366, height: 900 },
        args: getBrowserArgs(),
      });
      const page = await browser.newPage();
      await ensureStealthLikePage(page);

      return { type: 'puppeteer', page, close: () => browser.close() };
    }
  } catch (_error) {
    // Fall through to error below.
  }

  throw new Error(
    'Allabolag kraver en riktig browser. Installera playwright eller puppeteer for att lasa sidan.',
  );
}

async function sleep(page, milliseconds) {
  if (page.waitForTimeout) {
    await page.waitForTimeout(milliseconds);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSettledDom(page) {
  if (page.waitForLoadState) {
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch (_error) {
      // Allabolag kan ha bakgrundsanrop som aldrig blir helt idle.
    }
  }

  if (page.waitForTimeout) {
    await page.waitForTimeout(2500);
  }
}

async function maybeAcceptCookies(page) {
  try {
    await page.evaluate(() => {
      const labels = [/godk[aä]nn/i, /acceptera/i, /accept/i, /till[aå]t alla/i];
      const clickable = Array.from(document.querySelectorAll('button,[role="button"],a'));
      const match = clickable.find((element) => {
        const text = (element.innerText || element.textContent || '').trim();
        return labels.some((pattern) => pattern.test(text));
      });

      if (match) {
        match.click();
      }
    });
  } catch (_error) {
    // Ignore cookie handling failures.
  }

  await sleep(page, 500);
}

async function navigateAndCaptureHtml(page, url, options = {}) {
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: options.timeoutMs || 45000,
  });

  await waitForSettledDom(page);
  const html = await page.content();
  const status = response && typeof response.status === 'function' ? response.status() : null;

  return { html, status };
}

function looksLikeBlockedPage(html) {
  return /access denied|forbidden|captcha|verify you are human|unusual traffic|blocked/i.test(
    htmlToText(html),
  );
}

function looksLikeSearchResultsPage(html) {
  return (
    /Foretag/i.test(html) ||
    /class="[^"]*SearchResult[^"]*"/i.test(html) ||
    /bransch-s[öo]k/i.test(html) ||
    /StatsWidget-header/i.test(html)
  );
}

function extractCompanyProfileHrefs(searchHtml, limit) {
  const matches = searchHtml.matchAll(/href="(\/foretag\/[^"?#]+)"/gi);
  const unique = [];
  const seen = new Set();

  for (const match of matches) {
    const href = match[1];
    if (seen.has(href)) {
      continue;
    }

    seen.add(href);
    unique.push(href);

    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function parseTurnoverFromCompanyHtml(html, year) {
  const container = html.match(/StatsWidget-cell[^>]*>([\s\S]*?)<\/div>/gi) || [];

  let revenue = null;
  let revenueYear = null;
  let result = null;
  let legalForm = null;
  let registeredYear = null;

  const requestedYear = year ? Number.parseInt(year, 10) : null;

  for (const cell of container) {
    const headerMatch = cell.match(/StatsWidget-header">([^<]+)</);
    const valueMatch = cell.match(/StatsWidget-value">([\s\S]*?)<\/span>/);
    if (!headerMatch || !valueMatch) {
      continue;
    }

    const header = normalizeWhitespace(decodeHtmlEntities(headerMatch[1]));
    const value = normalizeWhitespace(decodeHtmlEntities(valueMatch[1]));

    if (/^Omsättning/i.test(header)) {
      const yearMatch = header.match(/(\d{4})/);
      if (yearMatch) {
        revenueYear = Number.parseInt(yearMatch[1], 10);
      } else if (requestedYear) {
        revenueYear = requestedYear;
      }

      const numeric = value.replace(/[^\d]/g, '');
      revenue = numeric ? Number.parseInt(numeric, 10) : null;
    } else if (/^Resultat efter finansnetto/i.test(header)) {
      const numeric = value.replace(/[^\d-]/g, '');
      result = numeric ? Number.parseInt(numeric, 10) : null;
    } else if (/^Bolagsform/i.test(header)) {
      legalForm = value;
    } else if (/^Registreringsår/i.test(header)) {
      registeredYear = value ? Number.parseInt(value, 10) : null;
    }
  }

  if (requestedYear && revenueYear && revenueYear !== requestedYear) {
    return {
      revenue: null,
      revenueYear,
      result,
      legalForm,
      registeredYear,
      note: `Hittade omsattning for ${revenueYear}, inte ${requestedYear}`,
    };
  }

  return { revenue, revenueYear, result, legalForm, registeredYear, note: null };
}

/**
 * Läser ut fält från "OfficialCompanyInformationCard" (den officiella
 * företagsinformationen), t.ex. organisationsnummer, omsättningsintervall
 * och telefonnummer. Dessa finns även för enskilda näringsidkare som saknar
 * full årsredovisning (och därmed saknar StatsWidget-omsättning).
 */
function parseOfficialInfoFromCompanyHtml(html) {
  const info = {
    orgNumber: null,
    phone: null,
    revenueRange: null,
    officialLegalForm: null,
    officialStatus: null,
  };

  const properties = html.matchAll(
    /OfficialCompanyInformationCard-property">([^<]+)<\/span><span class="OfficialCompanyInformationCard-propertyValue[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
  );

  for (const match of properties) {
    const label = normalizeWhitespace(decodeHtmlEntities(match[1]));
    const rawValue = match[2];
    const value = normalizeWhitespace(htmlToText(rawValue));

    if (/^Organisationsnummer/i.test(label)) {
      info.orgNumber = value || null;
    } else if (/^Telefon/i.test(label)) {
      info.phone = value || null;
    } else if (/^Omsättning intervall/i.test(label)) {
      // Ta bort ev. efterföljande info-ikon-text.
      const cleaned = value.replace(/\s*Oms[äa]ttningsintervallet.*$/i, '').trim();
      info.revenueRange = cleaned || null;
    } else if (/^Bolagsform/i.test(label)) {
      info.officialLegalForm = value || null;
    } else if (/^Status/i.test(label)) {
      info.officialStatus = value || null;
    }
  }

  return info;
}

/**
 * Jämför ett sökt org.nr med org.nr som visas på profilsidan. Allabolag maskerar
 * personnummer för enskilda näringsidkare (t.ex. "400224-XXXX"), så vi jämför
 * bara den synliga (icke-maskerade) delen.
 */
function orgNumbersMatch(searched, onPage) {
  const wanted = String(searched ?? '').replace(/\D/g, '');
  const found = String(onPage ?? '');

  if (!wanted || !found) {
    return null; // okänt – kunde inte verifiera
  }

  // Bygg regex från sidans org.nr där X/x = valfri siffra.
  const pattern = found
    .replace(/[^0-9Xx]/g, '')
    .replace(/[Xx]/g, '\\d');

  if (!pattern) {
    return null;
  }

  try {
    return new RegExp(`^${pattern}$`).test(wanted);
  } catch (_error) {
    return null;
  }
}

async function fetchHtmlWithBrowser(url, options = {}) {
  const session = options.browserSession || (await createBrowserSession(options));
  const ownsSession = !options.browserSession;

  try {
    const { page } = session;

    const directResult = await navigateAndCaptureHtml(page, url, options);
    if (
      (!directResult.status || directResult.status < 400) &&
      !looksLikeBlockedPage(directResult.html) &&
      looksLikeSearchResultsPage(directResult.html)
    ) {
      return directResult.html;
    }

    throw new Error(
      `Kunde inte lasa ${url} (status ${directResult.status || 'okand'}, blockerad=${looksLikeBlockedPage(directResult.html)})`,
    );
  } finally {
    if (ownsSession) {
      await session.close();
    }
  }
}

async function enrichRevenue(query, options = {}) {
  const browserSession = options.browserSession || (await createBrowserSession(options));
  const ownsSession = !options.browserSession;
  const { page } = browserSession;
  const limit = options.limit ?? 1;
  const searchUrl = options.searchUrl || buildSearchUrl(query);

  try {
    const searchHtml = await fetchHtmlWithBrowser(searchUrl, { ...options, browserSession });
    await maybeAcceptCookies(page);

    const hrefs = extractCompanyProfileHrefs(searchHtml, limit);
    if (hrefs.length === 0) {
      return {
        query,
        status: 'not-found',
        searchUrl,
        profileUrl: null,
        revenue: null,
        revenueYear: null,
        revenueRange: null,
        phone: null,
        result: null,
        legalForm: null,
        registeredYear: null,
        orgOnPage: null,
        orgMatch: null,
        note: 'Inga foretagsmatchningar hittades',
      };
    }

    const profileUrl = new URL(hrefs[0], ALLABOLAG_BASE_URL).toString();
    const profileResult = await navigateAndCaptureHtml(page, profileUrl, options);
    await maybeAcceptCookies(page);

    const parsed = parseTurnoverFromCompanyHtml(profileResult.html, options.year ?? null);
    const official = parseOfficialInfoFromCompanyHtml(profileResult.html);

    const expectedOrgNr = options.expectedOrgNr ?? null;
    const orgMatch = expectedOrgNr ? orgNumbersMatch(expectedOrgNr, official.orgNumber) : null;

    const hasRevenue = parsed.revenue !== null;
    const hasRange = Boolean(official.revenueRange);

    let status;
    let note = parsed.note;
    if (orgMatch === false) {
      status = 'mismatch';
      note = `Profilens org.nr (${official.orgNumber}) matchar inte sokt (${expectedOrgNr})`;
    } else if (hasRevenue || hasRange) {
      status = 'found';
    } else {
      status = 'missing';
    }

    return {
      query,
      status,
      searchUrl,
      profileUrl,
      revenue: parsed.revenue,
      revenueYear: parsed.revenueYear,
      revenueRange: official.revenueRange,
      phone: official.phone,
      result: parsed.result,
      legalForm: parsed.legalForm ?? official.officialLegalForm,
      registeredYear: parsed.registeredYear,
      orgOnPage: official.orgNumber,
      orgMatch,
      note,
    };
  } catch (error) {
    return {
      query,
      status: 'error',
      searchUrl,
      profileUrl: null,
      revenue: null,
      revenueYear: null,
      revenueRange: null,
      phone: null,
      result: null,
      legalForm: null,
      registeredYear: null,
      orgOnPage: null,
      orgMatch: null,
      note: error && error.message ? error.message : String(error),
    };
  } finally {
    if (ownsSession) {
      await browserSession.close();
    }
  }
}

function sleepMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Paus mellan bolag med lite slumpmässig jitter så trafiken inte ser robotaktig ut.
 */
async function delayWithJitter(delayMs, jitterMs, write = () => {}) {
  const base = Math.max(0, delayMs || 0);
  const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  const total = base + jitter;

  if (total <= 0) {
    return;
  }

  await sleepMs(total);
}

/**
 * Bedömer om ett resultat tyder på rate limiting / blockering och att vi bör backa av.
 */
function looksRateLimited(result) {
  if (!result) {
    return false;
  }

  if (result.status === 'error') {
    return /429|rate|too many|blockerad|blocked|captcha|forbidden|timeout|status 5\d\d/i.test(
      String(result.note || ''),
    );
  }

  // Om vi plötsligt inte hittar något OCH sidan verkar blockerad räknas det också.
  return false;
}

/**
 * Kör enrichRevenue med automatisk backoff + retry vid fel/blockering.
 */
async function enrichRevenueWithRetry(query, options, { retries, write }) {
  let attempt = 0;
  let lastResult = null;

  while (attempt <= retries) {
    const result = await enrichRevenue(query, options);
    lastResult = result;

    if (result.status !== 'error' && !looksRateLimited(result)) {
      return result;
    }

    if (attempt === retries) {
      break;
    }

    const backoff = BACKOFF_BASE_MS * 2 ** attempt;
    write(
      `  ⚠ Problem (${result.status}: ${result.note || 'okänt'}). ` +
        `Backar av ${Math.round(backoff / 1000)} s och försöker igen (${attempt + 1}/${retries})...\n`,
    );
    await sleepMs(backoff);
    attempt += 1;
  }

  return lastResult;
}

async function loadCheckpoint(outPath) {
  try {
    const raw = await readFile(outPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.companies)) {
      return parsed.companies;
    }
    return [];
  } catch (_error) {
    return [];
  }
}

async function saveCheckpoint(outPath, rows) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp`;
  const payload = `${JSON.stringify(rows, null, 2)}\n`;
  await writeFile(tmpPath, payload, 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, outPath);
}

async function runBatch(args, { write }) {
  const count = args.batchCount;
  const defaultOut = args.location
    ? path.join(
        'revenue-enricher',
        `oldest-revenue-${String(args.location).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}.json`,
      )
    : DEFAULT_BATCH_OUT;
  const outPath = path.resolve(args.out || defaultOut);

  write(`Hämtar ${count} äldsta bolagen och berikar med omsättning.\n`);
  if (args.location) {
    write(`Platsfilter: "${args.location}" (matchar län, kommun eller postort)\n`);
  }
  write(`Checkpoint-fil: ${outPath}\n`);

  const existing = await loadCheckpoint(outPath);
  const alreadyDone = new Map();
  for (const row of existing) {
    if (row && row.orgnr) {
      alreadyDone.set(String(row.orgnr), row);
    }
  }

  if (alreadyDone.size > 0) {
    write(`Hittade ${alreadyDone.size} redan hämtade bolag i checkpoint-filen. Hoppar över dem.\n`);
  }

  let companies;
  try {
    companies = await fetchOldestCompanies(count, { write, location: args.location });
  } catch (error) {
    write(`Kunde inte hämta bolag från databasen: ${error.message}\n`);
    return 1;
  }

  write(`Fick ${companies.length} bolag från databasen.\n`);

  const pending = companies.filter((company) => !alreadyDone.has(company.orgNumber));
  write(`${pending.length} bolag återstår att berika.\n`);

  if (pending.length === 0) {
    write('Inget nytt att göra. Alla begärda bolag är redan hämtade.\n');
    return 0;
  }

  const results = [...existing];
  const browserSession = await createBrowserSession(args);
  let processedSinceCheckpoint = 0;
  let processed = 0;

  write(
    `Rate limit-skydd: ${args.delayMs} ms paus (+ upp till ${args.jitterMs} ms jitter) mellan bolag, ` +
      `${args.retries} omförsök med backoff vid blockering.\n`,
  );

  try {
    for (const company of pending) {
      processed += 1;
      const searchUrl = buildOrgNrSearchUrl(company.orgNumber);

      const enriched = await enrichRevenueWithRetry(
        company.orgNumber,
        {
          ...args,
          browserSession,
          searchUrl,
          expectedOrgNr: company.orgNumber,
        },
        { retries: args.retries, write },
      );

      const row = {
        name: company.companyName,
        orgnr: company.orgNumber,
        county: company.county,
        municipality: company.municipality,
        postalCity: company.postalCity,
        revenue: enriched.revenue,
        revenueYear: enriched.revenueYear,
        revenueRange: enriched.revenueRange,
        phone: enriched.phone,
        status: enriched.status,
        orgMatch: enriched.orgMatch,
        profileUrl: enriched.profileUrl,
      };

      results.push(row);
      alreadyDone.set(company.orgNumber, row);
      processedSinceCheckpoint += 1;

      write(
        `[${processed}/${pending.length}] ${company.orgNumber} ${company.companyName ?? ''} -> ` +
          `${enriched.status}` +
          `${enriched.revenue !== null ? ` oms=${enriched.revenue}` : ''}` +
          `${enriched.revenueRange ? ` intervall=${enriched.revenueRange}` : ''}` +
          `${enriched.phone ? ` tel=${enriched.phone}` : ''}\n`,
      );

      if (processedSinceCheckpoint >= CHECKPOINT_EVERY) {
        await saveCheckpoint(outPath, results);
        processedSinceCheckpoint = 0;
        write(`  ...checkpoint sparad (${results.length} rader)\n`);
      }

      // Paus mellan bolag för att inte trigga rate limiting (hoppas över efter sista bolaget).
      if (processed < pending.length) {
        await delayWithJitter(args.delayMs, args.jitterMs, write);
      }
    }
  } finally {
    await saveCheckpoint(outPath, results);
    await browserSession.close();
  }

  write(`\nKlart. Sparade ${results.length} rader till ${outPath}\n`);
  return 0;
}

function printUsage(write) {
  write(`Anvandning: node revenue-enricher/enrich.js [flaggor] [fritext-sokningar...]

Flaggor:
  --N                 Hamta de N aldsta bolagen fran databasen och berika (t.ex. --200)
  --PLATS             Filtrera batch pa plats: lan/kommun/postort (t.ex. --stockholm)
  --location=PLATS    Samma som ovan, for platser med bindestreck/blanksteg
  --query=TEXT        Sokfras att skicka till Allabolag (kan anges flera ganger)
  --orgnr=XXXXXX      Organisationsnummer att soka pa (kan anges flera ganger)
  --year=YYYY         Forvanta omsattning for ett specifikt ar (t.ex. 2025)
  --limit=N           Antal foreagsmatchningar att folja per sokning (default 1)
  --delay=MS          Paus mellan bolag i batch-lage (default ${DEFAULT_DELAY_MS} ms)
  --jitter=MS         Slumpmassigt pahang ovanpa delay (default ${DEFAULT_JITTER_MS} ms)
  --retries=N         Antal omforsok med backoff vid blockering (default ${DEFAULT_RETRIES})
  --headless=1|0      Tvinga headless-lage for browsern
  --json              Skriv resultatet som JSON istallet for lasbar text
  --out=FIL           Skriv resultatet till en fil (checkpoint-fil i batch-lage)
  --help, -h          Visa denna hjalp

Batch-lage (--N):
  Hamtar de N aldsta bolagen (aldsta registreringsdatum, bade arkiv- och aktiv-DB),
  soker upp varje bolag pa Allabolag via org.nr och skriver namn, org.nr och omsattning
  till en JSON-fil. Filen sparas var 5:e bolag (checkpoint) och redan hamtade bolag
  hoppas over vid omkorning. Standardfil: ${DEFAULT_BATCH_OUT}
  Med en platsflagga (t.ex. --stockholm) hamtas bara bolag dar lan, kommun eller
  postort innehaller platsen.

Exempel:
  node revenue-enricher/enrich.js --200
  node revenue-enricher/enrich.js --200 --stockholm --headless=1
  node revenue-enricher/enrich.js --500 --location="västra götaland" --headless=1
  node revenue-enricher/enrich.js --200 --headless=1 --out=revenue-enricher/oldest.json
  node revenue-enricher/enrich.js "DLE redovisning"
  node revenue-enricher/enrich.js --orgnr=5591234567 --json
`);
}

function printResults(results, write) {
  for (const result of results) {
    write(`\n=== ${result.query} ===\n`);
    write(`Status:        ${result.status}\n`);
    if (result.profileUrl) {
      write(`Profil:        ${result.profileUrl}\n`);
    }
    write(`Omsattning:    ${result.revenue === null ? '-' : `${result.revenue} (${result.revenueYear})`}\n`);
    if (result.revenueRange) {
      write(`Oms.intervall: ${result.revenueRange}\n`);
    }
    if (result.phone) {
      write(`Telefon:       ${result.phone}\n`);
    }
    if (result.result !== null) {
      write(`Resultat:      ${result.result}\n`);
    }
    if (result.legalForm) {
      write(`Bolagsform:    ${result.legalForm}\n`);
    }
    if (result.registeredYear) {
      write(`Reg.ar:       ${result.registeredYear}\n`);
    }
    if (result.orgOnPage) {
      write(`Org.nr sida:   ${result.orgOnPage}${result.orgMatch === false ? ' (MISSMATCH!)' : ''}\n`);
    }
    if (result.note) {
      write(`Notering:      ${result.note}\n`);
    }
  }
}

async function run(argv = process.argv.slice(2), { write = (message) => process.stdout.write(message) } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    write(`${error.message}\n`);
    printUsage(write);
    return 2;
  }

  if (args.help) {
    printUsage(write);
    return 0;
  }

  if (args.batchCount && args.batchCount > 0) {
    return runBatch(args, { write });
  }

  const queries = [...args.queries, ...args.orgNrs.map((orgNr) => ({ orgNr }))];
  if (queries.length === 0) {
    write('Ingen sokfras angavs.\n');
    printUsage(write);
    return 2;
  }

  const browserSession = await createBrowserSession(args);
  const results = [];

  try {
    for (const entry of queries) {
      const query = typeof entry === 'string' ? entry : entry.orgNr;
      const isOrgNr = typeof entry !== 'string';
      const searchUrl = isOrgNr ? buildOrgNrSearchUrl(query) : buildSearchUrl(query);

      const result = await enrichRevenue(query, {
        ...args,
        browserSession,
        searchUrl,
      });
      results.push(result);

      if (!args.json) {
        printResults([result], write);
      }
    }
  } finally {
    await browserSession.close();
  }

  if (args.json) {
    const payload = JSON.stringify(results, null, 2);
    write(`${payload}\n`);
  }

  if (args.out) {
    const outPath = path.resolve(args.out);
    const payload = JSON.stringify(results, null, 2);
    await writeFile(outPath, `${payload}\n`, 'utf8');
    write(`\nSkrev resultat till ${outPath}\n`);
  }

  const failed = results.filter((result) => result.status !== 'found').length;
  return failed === 0 ? 0 : 1;
}

const modulePath = fileURLToPath(import.meta.url);

function isCliEntrypoint(argvPath) {
  if (!argvPath) {
    return false;
  }

  return path.resolve(modulePath) === path.resolve(argvPath);
}

if (isCliEntrypoint(process.argv[1])) {
  const exitCode = await run();
  process.exitCode = exitCode;
}

export {
  buildSearchUrl,
  buildOrgNrSearchUrl,
  createBrowserSession,
  enrichRevenue,
  extractCompanyProfileHrefs,
  navigateAndCaptureHtml,
  parseTurnoverFromCompanyHtml,
  parseOfficialInfoFromCompanyHtml,
  orgNumbersMatch,
  run,
};
