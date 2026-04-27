import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  return normalizeText(value)
    .replace(/^00/, '+')
    .replace(/[\s()-]+/g, '');
}

function getDeliveryChannelField(channel) {
  return channel === 'phone' ? 'Telefon' : 'E-post';
}

function getDeliveryHistoryFileName(channel) {
  return channel === 'phone' ? 'telefonleveranshistorik.json' : 'leveranshistorik.json';
}

function normalizeDeliveryValue(value, channel) {
  return channel === 'phone' ? normalizePhone(value) : normalizeEmail(value);
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

export function buildDeliveryIdentity(row, { channel = 'email' } = {}) {
  const orgNr = normalizeText(row?.OrgNr ?? row?.['OrgNr']);
  const contactField = getDeliveryChannelField(channel);
  const contactValue = normalizeDeliveryValue(row?.[contactField], channel);

  if (orgNr && contactValue) {
    return `${orgNr}::${contactValue}`;
  }

  return orgNr || contactValue || '';
}

export async function loadDeliveryHistory({ stateDir = 'state', channel = 'email', fileName } = {}) {
  const resolvedFileName = fileName ?? getDeliveryHistoryFileName(channel);
  const filePath = path.join(path.resolve(stateDir), resolvedFileName);
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

function buildLatestQueuedDateByContact(historyData, channel) {
  const mottagare = historyData?.mottagare ?? historyData?.recipients ?? {};
  const latestQueuedDateByContact = new Map();
  const contactField = getDeliveryChannelField(channel);

  for (const entry of Object.values(mottagare)) {
    const contactValue = normalizeDeliveryValue(
      entry?.[contactField] ?? entry?.contact,
      channel,
    );
    const latestQueuedDate = normalizeText(entry?.SenasteKödatum ?? entry?.lastQueuedDate);

    if (!contactValue || !latestQueuedDate) {
      continue;
    }

    const current = latestQueuedDateByContact.get(contactValue);

    if (!current || latestQueuedDate > current) {
      latestQueuedDateByContact.set(contactValue, latestQueuedDate);
    }
  }

  return latestQueuedDateByContact;
}

export function buildDeliveryEntries(rows, historyData, targetDate, { channel = 'email' } = {}) {
  const mottagare = historyData?.mottagare ?? historyData?.recipients ?? {};
  const latestQueuedDateByContact = buildLatestQueuedDateByContact(historyData, channel);
  const seenContacts = new Set();
  const contactField = getDeliveryChannelField(channel);
  const entries = [];
  let skippedAlreadyQueuedCount = 0;
  let skippedDuplicateContactCount = 0;
  let skippedMissingIdentityCount = 0;

  for (const row of rows) {
    const deliveryKey = buildDeliveryIdentity(row, { channel });
    const contactValue = normalizeDeliveryValue(row?.[contactField], channel);

    if (!deliveryKey) {
      skippedMissingIdentityCount += 1;
      continue;
    }

    const existing = mottagare[deliveryKey];
    const senasteKodag = existing?.SenasteKödatum ?? existing?.lastQueuedDate;
    const senasteKodagForContact = latestQueuedDateByContact.get(contactValue);

    if (
      (senasteKodag && senasteKodag !== targetDate) ||
      (contactValue && senasteKodagForContact && senasteKodagForContact !== targetDate)
    ) {
      skippedAlreadyQueuedCount += 1;
      continue;
    }

    if (contactValue && seenContacts.has(contactValue)) {
      skippedDuplicateContactCount += 1;
      continue;
    }

    if (contactValue) {
      seenContacts.add(contactValue);
    }

    entries.push({
      deliveryKey,
      row,
    });
  }

  return {
    entries,
    skippedAlreadyQueuedCount,
    skippedDuplicateContactCount,
    skippedMissingIdentityCount,
  };
}

export async function commitDeliveryHistory(
  entries,
  targetDate,
  { stateDir = 'state', channel = 'email', fileName } = {},
) {
  const { filePath, data } = await loadDeliveryHistory({ stateDir, channel, fileName });
  const mottagare = data.mottagare ?? {};
  const kötid = new Date().toISOString();
  const contactField = getDeliveryChannelField(channel);

  for (const entry of entries) {
    const row = entry.row;
    const existing = mottagare[entry.deliveryKey] ?? {};

    mottagare[entry.deliveryKey] = {
      Leveransnyckel: entry.deliveryKey,
      OrgNr: normalizeText(row?.OrgNr),
      [contactField]: normalizeDeliveryValue(row?.[contactField], channel),
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
