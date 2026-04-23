const HITTA_BASE_URL = 'https://www.hitta.se';
const DEFAULT_HEADERS = {
  'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function splitTokens(value) {
  return normalizeForMatch(value).split(' ').filter(Boolean);
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
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function buildSearchQuery(contactPerson, locationHint) {
  const parts = [
    contactPerson?.name,
    locationHint,
    contactPerson?.city,
    contactPerson?.municipality,
    contactPerson?.postalCity,
  ].filter(Boolean);

  return normalizeWhitespace(parts.join(' '));
}

function buildSearchUrl(query) {
  const tokens = normalizeWhitespace(query).split(' ').filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('Kan inte bygga Hitta-sokning utan namn eller plats');
  }

  return `${HITTA_BASE_URL}/sök?vad=${encodeURIComponent(tokens.join(' '))}`;
}

async function fetchHtml(url, options = {}) {
  if (/https:\/\/www\.hitta\.se\//i.test(url)) {
    return fetchHtmlWithBrowser(url, options);
  }

  if (typeof fetch !== 'function') {
    throw new Error('global fetch finns inte i denna Node-version');
  }

  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...(options.headers || {}),
    },
    redirect: 'follow',
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} vid hamtning av ${url}`);
  }

  return response.text();
}

function resolveHeadlessMode(options = {}) {
  if (typeof options.headless === 'boolean') {
    return options.headless;
  }

  const rawValue = String(process.env.ENIRO_HEADLESS || '').trim().toLowerCase();
  if (!rawValue) {
    return false;
  }

  return rawValue === '1' || rawValue === 'true' || rawValue === 'yes';
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

function getHittaSearchQueryFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const vad = urlObj.searchParams.get('vad');
    return vad || null;
  } catch (_error) {
    return null;
  }
}

function looksLikeUsefulHittaPage(html) {
  return (
    /href="\/[^"]+\/person\//i.test(html) ||
    /data-test="search-list-link"/i.test(html) ||
    /hitta\.se.*person/i.test(html) ||
    /telefonnummer/i.test(html)
  );
}

function looksLikeBlockedPage(html) {
  return /access denied|forbidden|captcha|verify you are human|unusual traffic|blocked/i.test(
    htmlToText(html)
  );
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
    await page.setExtraHTTPHeaders({
      'accept-language': DEFAULT_HEADERS['accept-language'],
    });
  }

  if (page.setUserAgent) {
    await page.setUserAgent(DEFAULT_HEADERS['user-agent']);
  }

  if (page.setViewportSize) {
    await page.setViewportSize({ width: 1366, height: 900 });
  }
}

async function createBrowserSession(options = {}) {
  const headless = resolveHeadlessMode(options);

  try {
    const playwright = await import('playwright');
    if (playwright?.chromium) {
      const userDataDir = options.userDataDir || '.eniro-browser-profile';
      const context = await playwright.chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless,
        ignoreHTTPSErrors: true,
        locale: 'sv-SE',
        timezoneId: 'Europe/Stockholm',
        userAgent: DEFAULT_HEADERS['user-agent'],
        viewport: { width: 1366, height: 900 },
        args: getBrowserArgs(),
      });
      const page = context.pages()[0] || (await context.newPage());
      await ensureStealthLikePage(page);

      return {
        type: 'playwright',
        page,
        close: () => context.close(),
      };
    }
  } catch (_error) {
    // Ignore and try the next option.
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

      return {
        type: 'puppeteer',
        page,
        close: () => browser.close(),
      };
    }
  } catch (_error) {
    // Ignore and throw a clearer error below.
  }

  throw new Error(
    'Hitta blockerar vanlig fetch. Installera playwright eller puppeteer for att lasa sidan i en riktig browser.'
  );
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

async function sleep(page, milliseconds) {
  if (page.waitForTimeout) {
    await page.waitForTimeout(milliseconds);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function navigateAndCaptureHtml(page, url, options = {}) {
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: options.timeoutMs || 45000,
  });

  await waitForSettledDom(page);
  const html = await page.content();
  const status =
    response && typeof response.status === 'function' ? response.status() : null;

  return { html, status };
}

async function trySearchThroughHomePage(page, searchQuery, options = {}) {
  const homeResult = await navigateAndCaptureHtml(page, HITTA_BASE_URL, options);
  if (homeResult.status && homeResult.status >= 400 && !looksLikeUsefulHittaPage(homeResult.html)) {
    return null;
  }

  await maybeAcceptCookies(page);

  const submitted = await page.evaluate((query) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const input = inputs.find((element) => {
      const haystack = [
        element.name,
        element.id,
        element.placeholder,
        element.getAttribute('aria-label'),
        element.type,
      ]
        .filter(Boolean)
        .join(' ');

      return /s[oö]k|person|adress|telefon/i.test(haystack);
    });

    if (!input) {
      return false;
    }

    input.focus();
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const form = input.form || input.closest('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
      return true;
    }

    const button = Array.from(document.querySelectorAll('button,[role="button"]')).find((element) =>
      /s[oö]k/i.test((element.innerText || element.textContent || '').trim())
    );
    if (button) {
      button.click();
      return true;
    }

    return false;
  }, searchQuery);

  if (!submitted) {
    return null;
  }

  const timeoutAt = Date.now() + (options.timeoutMs || 45000);
  while (Date.now() < timeoutAt) {
    if (/\/sök/i.test(page.url()) || /\/person\//i.test(page.url())) {
      await waitForSettledDom(page);
      return {
        html: await page.content(),
        status: 200,
      };
    }

    await sleep(page, 500);
  }

  return null;
}

async function fetchHtmlWithBrowser(url, options = {}) {
  const session = options.browserSession || (await createBrowserSession(options));
  const ownsSession = !options.browserSession;

  try {
    const { page } = session;
    const directResult = await navigateAndCaptureHtml(page, url, options);

    if (
      (!directResult.status || directResult.status < 400) &&
      !looksLikeBlockedPage(directResult.html)
    ) {
      return directResult.html;
    }

    if (looksLikeUsefulHittaPage(directResult.html)) {
      return directResult.html;
    }

    const searchQuery = getHittaSearchQueryFromUrl(url);
    if (searchQuery) {
      const fallbackResult = await trySearchThroughHomePage(page, searchQuery, options);
      if (fallbackResult && looksLikeUsefulHittaPage(fallbackResult.html)) {
        return fallbackResult.html;
      }
    }

    const statusLabel = directResult.status ? `HTTP ${directResult.status}` : 'okand status';
    throw new Error(`${statusLabel} vid browser-hamtning av ${url}`);
  } finally {
    if (ownsSession) {
      await session.close();
    }
  }
}

async function waitForSettledDom(page) {
  if (page.waitForLoadState) {
    try {
      await page.waitForLoadState('networkidle', { timeout: 8000 });
    } catch (_error) {
      // Eniro kan ha bakgrundsanrop som aldrig blir helt idle.
    }
  }

  if (page.waitForTimeout) {
    await page.waitForTimeout(2500);
  }
}

function extractProfileHrefs(searchHtml) {
  const matches = searchHtml.matchAll(/href="(\/[^"]+\/person\/[^"]+)"/gi);
  const unique = new Set();

  for (const match of matches) {
    unique.add(match[1]);
  }

  return Array.from(unique);
}

function scoreProfileHref(href, contactPerson, locationHint) {
  const haystack = normalizeForMatch(href);
  const nameTokens = splitTokens(contactPerson?.name);
  const locationTokens = splitTokens(locationHint);

  let score = 0;

  for (const token of nameTokens) {
    if (haystack.includes(token)) {
      score += 10;
    }
  }

  for (const token of locationTokens) {
    if (haystack.includes(token)) {
      score += 3;
    }
  }

  return score;
}

function pickBestProfileHref(searchHtml, contactPerson, locationHint) {
  const hrefs = extractProfileHrefs(searchHtml);
  if (hrefs.length === 0) {
    return null;
  }

  const ranked = hrefs
    .map((href, index) => ({
      href,
      index,
      score: scoreProfileHref(href, contactPerson, locationHint),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    });

  return ranked[0]?.href || null;
}

function extractPhoneCandidates(text) {
  const matches = text.matchAll(/(?:\+46|0)[\d\s-]{6,}\d/g);
  const unique = new Set();

  for (const match of matches) {
    unique.add(normalizeWhitespace(match[0]));
  }

  return Array.from(unique);
}

function extractPhoneNumber(profileHtml) {
  const text = htmlToText(profileHtml);
  if (!text) {
    return null;
  }

  if (/telefonnummer\s+nummer saknas/i.test(text) || /\bnummer saknas\b/i.test(text)) {
    return null;
  }

  const phoneSectionIndex = text.search(/telefonnummer/i);
  const scopedText =
    phoneSectionIndex >= 0 ? text.slice(phoneSectionIndex, phoneSectionIndex + 1000) : text;
  const candidates = extractPhoneCandidates(scopedText);

  return candidates[0] || null;
}

async function clickToRevealPhone(page) {
  try {
    const revealed = await page.evaluate(() => {
      const phoneElements = document.querySelectorAll('[class*="phone"], [class*="telefon"], [data-test*="phone"]');
      for (const el of phoneElements) {
        const clickable = el.closest('[role="button"], button, a, [class*="reveal"], [class*="click"], [class*="show"]');
        if (clickable) {
          clickable.click();
          return true;
        }
        const parent = el.parentElement;
        if (parent && (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button')) {
          parent.click();
          return true;
        }
      }
      return false;
    });

    if (revealed) {
      await sleep(page, 1500);
    }

    return revealed;
  } catch (_error) {
    return false;
  }
}

async function extractPhoneFromProfilePage(page, profileUrl) {
  await navigateAndCaptureHtml(page, profileUrl, {});
  await waitForSettledDom(page);
  
  await maybeAcceptCookies(page);
  
  await clickToRevealPhone(page);
  
  const html = await page.content();
  const phoneNumber = extractPhoneNumber(html);
  
  if (!phoneNumber) {
    const text = htmlToText(html);
    const phonePattern = /(?:\+46|0)[\d\s\-]{6,}\d/;
    const match = text.match(phonePattern);
    if (match) {
      return normalizeWhitespace(match[0]);
    }
  }
  
  return phoneNumber;
}

async function enrichContactPersonPhone(contactPerson, options = {}) {
  if (!contactPerson?.name) {
    return {
      status: 'skipped',
      reason: 'missing-contact-person-name',
      phoneNumber: null,
      hittaProfileUrl: null,
      hittaSearchUrl: null,
    };
  }

  const locationHint = normalizeWhitespace(options.locationHint || '');
  const searchQuery = buildSearchQuery(contactPerson, locationHint);
  const searchUrl = buildSearchUrl(searchQuery);
  const browserSession = await createBrowserSession(options);

  try {
    const searchHtml = await fetchHtml(searchUrl, {
      ...options,
      browserSession,
    });
    const relativeProfileHref = pickBestProfileHref(searchHtml, contactPerson, locationHint);

    if (!relativeProfileHref) {
      return {
        status: 'not-found',
        phoneNumber: null,
        hittaProfileUrl: null,
        hittaSearchUrl: searchUrl,
      };
    }

    const hittaProfileUrl = new URL(relativeProfileHref, HITTA_BASE_URL).toString();
    const { page } = browserSession;
    const phoneNumber = await extractPhoneFromProfilePage(page, hittaProfileUrl);

    return {
      status: phoneNumber ? 'found' : 'missing',
      phoneNumber,
      hittaProfileUrl,
      hittaSearchUrl: searchUrl,
    };
  } finally {
    await browserSession.close();
  }
}

async function enrichRecordContactPhone(record, options = {}) {
  const locationHint =
    options.locationHint ||
    record?.location?.city ||
    record?.address?.city ||
    record?.municipality ||
    record?.postalCity ||
    '';

  const result = await enrichContactPersonPhone(record?.contactPerson, {
    ...options,
    locationHint,
  });

  if (record?.contactPerson && typeof record.contactPerson === 'object') {
    record.contactPerson.phoneNumber = result.phoneNumber;
    record.contactPerson.phoneSource = 'hitta';
    record.contactPerson.phoneSourceUrl = result.hittaProfileUrl;
    record.contactPerson.phoneStatus = result.status;
  }

  return result;
}

async function main() {
  const name = process.argv[2];
  const locationHint = process.argv[3] || '';

  if (!name) {
    console.error('Anvandning: node phone-enrich.js "Namn" "Ort"');
    process.exit(1);
  }

  const result = await enrichContactPersonPhone({ name }, { locationHint });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function isDirectInvocation() {
  const entryFile = process?.argv?.[1] || '';
  return /(^|[\\/])phone-enrich\.js$/.test(entryFile);
}

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildSearchQuery,
    buildSearchUrl,
    enrichContactPersonPhone,
    enrichRecordContactPhone,
    extractPhoneNumber,
    pickBestProfileHref,
    clickToRevealPhone,
  };
}
