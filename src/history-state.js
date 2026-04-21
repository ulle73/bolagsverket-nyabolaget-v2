import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
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

export function buildDeliveryIdentity(row) {
  const orgNr = normalizeText(row?.OrgNr ?? row?.['OrgNr']);
  const email = normalizeEmail(row?.['E-post'] ?? row?.['E-post']);

  if (orgNr && email) {
    return `${orgNr}::${email}`;
  }

  return orgNr || email || '';
}

export async function loadDeliveryHistory({ stateDir = 'state' } = {}) {
  const filePath = path.join(path.resolve(stateDir), 'leveranshistorik.json');
  const data = await readJsonFile(filePath, {
    version: 1,
    mottagare: {},
  });

  return {
    filePath,
    data: {
      version: 1,
      mottagare: data?.mottagare ?? data?.recipients ?? {},
    },
  };
}

function buildLatestQueuedDateByEmail(historyData) {
  const mottagare = historyData?.mottagare ?? historyData?.recipients ?? {};
  const latestQueuedDateByEmail = new Map();

  for (const entry of Object.values(mottagare)) {
    const email = normalizeEmail(entry?.['E-post'] ?? entry?.email);
    const latestQueuedDate = normalizeText(entry?.SenasteKödatum ?? entry?.lastQueuedDate);

    if (!email || !latestQueuedDate) {
      continue;
    }

    const current = latestQueuedDateByEmail.get(email);

    if (!current || latestQueuedDate > current) {
      latestQueuedDateByEmail.set(email, latestQueuedDate);
    }
  }

  return latestQueuedDateByEmail;
}

export function buildDeliveryEntries(rows, historyData, targetDate) {
  const mottagare = historyData?.mottagare ?? historyData?.recipients ?? {};
  const latestQueuedDateByEmail = buildLatestQueuedDateByEmail(historyData);
  const seenEmails = new Set();
  const entries = [];
  let skippedAlreadyQueuedCount = 0;
  let skippedDuplicateEmailCount = 0;
  let skippedMissingIdentityCount = 0;

  for (const row of rows) {
    const deliveryKey = buildDeliveryIdentity(row);
    const email = normalizeEmail(row?.['E-post']);

    if (!deliveryKey) {
      skippedMissingIdentityCount += 1;
      continue;
    }

    const existing = mottagare[deliveryKey];
    const senasteKodag = existing?.SenasteKödatum ?? existing?.lastQueuedDate;
    const senasteKodagForEpost = latestQueuedDateByEmail.get(email);

    if (
      (senasteKodag && senasteKodag !== targetDate) ||
      (senasteKodagForEpost && senasteKodagForEpost !== targetDate)
    ) {
      skippedAlreadyQueuedCount += 1;
      continue;
    }

    if (email && seenEmails.has(email)) {
      skippedDuplicateEmailCount += 1;
      continue;
    }

    if (email) {
      seenEmails.add(email);
    }

    entries.push({
      deliveryKey,
      row,
    });
  }

  return {
    entries,
    skippedAlreadyQueuedCount,
    skippedDuplicateEmailCount,
    skippedMissingIdentityCount,
  };
}

export async function commitDeliveryHistory(entries, targetDate, { stateDir = 'state' } = {}) {
  const { filePath, data } = await loadDeliveryHistory({ stateDir });
  const mottagare = data.mottagare ?? {};
  const kötid = new Date().toISOString();

  for (const entry of entries) {
    const row = entry.row;
    const existing = mottagare[entry.deliveryKey] ?? {};

    mottagare[entry.deliveryKey] = {
      Leveransnyckel: entry.deliveryKey,
      OrgNr: normalizeText(row?.OrgNr),
      'E-post': normalizeEmail(row?.['E-post']),
      Företagsnamn: normalizeText(row?.['Företagsnamn']),
      FörstaKödatum: existing.FörstaKödatum ?? existing.firstQueuedDate ?? targetDate,
      SenasteKödatum: targetDate,
      FörstaKötid: existing.FörstaKötid ?? existing.firstQueuedAt ?? kötid,
      SenasteKötid: kötid,
    };
  }

  data.version = 1;
  data.mottagare = mottagare;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

  return {
    filePath,
    recipientCount: Object.keys(mottagare).length,
  };
}
