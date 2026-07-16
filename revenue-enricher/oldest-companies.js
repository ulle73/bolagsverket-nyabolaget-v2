import { createSupabaseServiceClient } from '../src/supabase-client.js';

const PAGE_SIZE = 1000;

/**
 * Bygger ett OR-filter (för Supabase `.or()`) som matchar en plats mot
 * län (county), kommun (municipality) och postort (postal_city).
 * Escapar värdet så kommatecken/parenteser inte bryter filtret.
 */
function buildLocationOrFilter(location) {
  const value = String(location ?? '').trim();
  if (!value) {
    return null;
  }

  // Supabase PostgREST: specialtecken i .or() bör undvikas; ta bort dem defensivt.
  const safe = value.replace(/[(),*]/g, ' ').replace(/\s+/g, ' ').trim();
  const pattern = `%${safe}%`;

  return `county.ilike.${pattern},municipality.ilike.${pattern},postal_city.ilike.${pattern}`;
}

/**
 * Hämtar de N äldsta unika bolagen (efter registreringsdatum) från databaserna.
 *
 * De äldsta bolagen ligger i arkiv-DB:n (registreringsdatum före 2021-01-01).
 * Om arkivet inte räcker faller vi tillbaka till aktiva DB:n.
 *
 * Bolag kan förekomma i flera snapshots, så vi deduplicerar på org_number och
 * behåller den första (äldsta) förekomsten.
 *
 * Med `location` filtreras bolag där län, kommun ELLER postort innehåller värdet
 * (t.ex. "Stockholm").
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

    let offset = 0;

    while (collected.length < wanted) {
      let queryBuilder = client
        .from('company_snapshots')
        .select('org_number,company_name,registration_date,county,municipality,postal_city');

      if (orFilter) {
        queryBuilder = queryBuilder.or(orFilter);
      }

      const { data, error } = await queryBuilder
        .order('registration_date', { ascending: true })
        .order('org_number', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Fel vid hämtning från ${target.label}-databasen: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const row of data) {
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

      if (data.length < PAGE_SIZE) {
        break;
      }

      offset += PAGE_SIZE;
    }
  }

  return collected.slice(0, wanted);
}
