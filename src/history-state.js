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
  const orgNr = normalizeText(row?.OrgNr ?? row?.orgnr);
  const email = normalizeEmail(row?.['E-post'] ?? row?.email);

  if (orgNr && email) {
    return `${orgNr}::${email}`;
  }

  return orgNr || email || '';
}

export async function loadDeliveryHistory({ stateDir = 'state' } = {}) {
  const filePath = path.join(path.resolve(stateDir), 'delivery-history.json');
  const data = await readJsonFile(filePath, {
    version: 1,
    recipients: {},
  });

  return {
    filePath,
    data: {
      version: 1,
      recipients: data?.recipients ?? {},
    },
  };
}

export function buildDeliveryEntries(rows, historyData, targetDate) {
  const recipients = historyData?.recipients ?? {};
  const entries = [];
  let skippedAlreadyQueuedCount = 0;
  let skippedMissingIdentityCount = 0;

  for (const row of rows) {
    const deliveryKey = buildDeliveryIdentity(row);

    if (!deliveryKey) {
      skippedMissingIdentityCount += 1;
      continue;
    }

    const existing = recipients[deliveryKey];

    if (existing && existing.lastQueuedDate && existing.lastQueuedDate !== targetDate) {
      skippedAlreadyQueuedCount += 1;
      continue;
    }

    entries.push({
      deliveryKey,
      row,
    });
  }

  return {
    entries,
    skippedAlreadyQueuedCount,
    skippedMissingIdentityCount,
  };
}

export async function commitDeliveryHistory(entries, targetDate, { stateDir = 'state' } = {}) {
  const { filePath, data } = await loadDeliveryHistory({ stateDir });
  const recipients = data.recipients ?? {};
  const queuedAt = new Date().toISOString();

  for (const entry of entries) {
    const row = entry.row;
    const existing = recipients[entry.deliveryKey] ?? {};

    recipients[entry.deliveryKey] = {
      deliveryKey: entry.deliveryKey,
      orgNr: normalizeText(row?.OrgNr ?? row?.orgnr),
      email: normalizeEmail(row?.['E-post'] ?? row?.email),
      companyName: normalizeText(row?.['Företagsnamn'] ?? row?.company_name),
      firstQueuedDate: existing.firstQueuedDate ?? targetDate,
      lastQueuedDate: targetDate,
      firstQueuedAt: existing.firstQueuedAt ?? queuedAt,
      lastQueuedAt: queuedAt,
    };
  }

  data.version = 1;
  data.recipients = recipients;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

  return {
    filePath,
    recipientCount: Object.keys(recipients).length,
  };
}
