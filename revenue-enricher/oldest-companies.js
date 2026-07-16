import { createSupabaseServiceClient } from '../src/supabase-client.js';

const PAGE_SIZE = 500;
const MAX_QUERY_RETRIES = 5;
const RETRY_BACKOFF_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bygger ett OR-filter (för Supabase `.or()`) som matchar en plats mot
 * län (county), kommun (municipality) och postort (postal_city).
 */
function buildLocationOrFilter(location) {
  const value = String(location ?? '').trim();
  if (!value) {
    return null;
  }

  const safe = value.replace(/[(),*]/g, ' ').replace(/\s+/g, ' ').trim();
  const pattern = `%${safe}%`;

  return `county.ilike.${pattern},municipality.ilike.${pattern},postal_city.ilike.${pattern}`;
}

function isTimeoutError(error) {
  return /timeout|canceling statement|statement due to/i.test(String(error?.message || ''));
}

const SELECT_COLUMNS =
  'org_number,company_name,registration_date,county,municipality,postal_city';

/**
 * Kör en enskild query med omförsök vid Postgres statement timeout.
 * `applyFilters(builder)` sätter datum-/keyset-villkoren.
 */
async function runWithRetry(client, orFilter, applyFilters, write, label) {
  let attempt = 0;

  while (true) {
    let builder = client.from('company_snapshots').select(SELECT_COLUMNS);

    if (orFilter) {
      builder = builder.or(orFilter);
    }

    builder = applyFilters(builder)
      .order('registration_date', { ascending: true })
      .order('org_number', { ascending: true })
      .limit(PAGE_SIZE);

    const { data, error } = await builder;

    if (!error) {
      return data ?? [];
    }

    if (isTimeoutError(error) && attempt < MAX_QUERY_RETRIES) {
      const backoff = RETRY_BACKOFF_MS * (attempt + 1);
      write(
        `  ⚠ Databas-timeout${label ? ` (${label})` : ''}, försöker igen om ` +
          `${Math.round(backoff / 1000)} s (${attempt + 1}/${MAX_QUERY_RETRIES})...\n`,
      );
      await sleep(backoff);
      attempt += 1;
      continue;
    }

    throw new Error(error.message);
  }
}

/**
 * Hämtar de N äldsta unika bolagen (efter registreringsdatum) från databaserna.
 *
 * De äldsta bolagen ligger i arkiv-DB:n (registreringsdatum före 2021-01-01).
 * Om arkivet inte räcker faller vi tillbaka till aktiva DB:n.
 *
 * Använder keyset-pagination istället för OFFSET, eftersom OFFSET/ORDER över hela
 * tabellen orsakar statement timeout i Supabase. Vi går datum för datum:
 *   1. Hämtar nästa datum (strikt > cursorDate).
 *   2. Betar av alla rader inom det datumet med org_number-keyset (klarar >500/datum).
 * Bolag dedupliceras på org_number.
 *
 * Med `location` filtreras bolag där län, kommun ELLER postort innehåller värdet.
 */
export async function fetchOldestCompanies(count, { write = () => {}, location = null } = {}) {
  const wanted = Math.max(0, Number.parseInt(count, 10) || 0);
  if (wanted === 0) {
    return [];
  }

  const orFilter = buildLocationOrFilter(location);
  if (location) {
    write(`Filtrerar på plats (län/kommun/postort innehåller): "${location}"\n`);
  }

  const collected = [];
  const seen = new Set();

  const targets = [
    { label: 'arkiv', snapshotDate: '2002-01-01' },
    { label: 'aktiv', snapshotDate: '2025-01-01' },
  ];

  for (const target of targets) {
    if (collected.length >= wanted) {
      break;
    }

    let client;
    try {
      ({ client } = await createSupabaseServiceClient({ snapshotDate: target.snapshotDate }));
    } catch (error) {
      write(`Kunde inte ansluta till ${target.label}-databasen: ${error.message}\n`);
      continue;
    }

    write(`Hämtar äldsta bolagen från ${target.label}-databasen...\n`);

    let cursorDate = null; // senaste färdigbetade datumet (exklusivt)

    while (collected.length < wanted) {
      // Steg 1: hitta nästa datum efter cursorDate.
      const peek = await runWithRetry(
        client,
        orFilter,
        (builder) => (cursorDate ? builder.gt('registration_date', cursorDate) : builder),
        write,
        'nästa datum',
      );

      if (!peek || peek.length === 0) {
        break;
      }

      const currentDate = peek[0].registration_date;

      // Steg 2: beta av HELA det datumet med org_number-keyset.
      let orgCursor = null;
      while (collected.length < wanted) {
        const rows = await runWithRetry(
          client,
          orFilter,
          (builder) => {
            let b = builder.eq('registration_date', currentDate);
            if (orgCursor) {
              b = b.gt('org_number', orgCursor);
            }
            return b;
          },
          write,
          `datum ${currentDate}`,
        );

        if (!rows || rows.length === 0) {
          break;
        }

        for (const row of rows) {
          const orgNumber = String(row.org_number ?? '').trim();
          if (!orgNumber || seen.has(orgNumber)) {
            continue;
          }

          seen.add(orgNumber);
          collected.push({
            orgNumber,
            companyName: row.company_name ?? null,
            registrationDate: row.registration_date ?? null,
            county: row.county ?? null,
            municipality: row.municipality ?? null,
            postalCity: row.postal_city ?? null,
          });

          if (collected.length >= wanted) {
            break;
          }
        }

        orgCursor = rows[rows.length - 1].org_number;

        if (rows.length < PAGE_SIZE) {
          break; // klar med detta datum
        }
      }

      cursorDate = currentDate;
      write(`  ...${collected.length}/${wanted} unika bolag hittills (t.o.m. ${cursorDate})\n`);
    }
  }

  return collected.slice(0, wanted);
}
