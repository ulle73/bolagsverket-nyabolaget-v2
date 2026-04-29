import { cleanValue, getPrimaryEmail, getPrimaryPhone } from './company-contact.js';
import { formatOutputDate } from './scb.js';

function cleanText(value, fallback = null) {
  const cleaned = cleanValue(value);

  if (typeof cleaned !== 'string') {
    return cleaned ?? fallback;
  }

  return cleaned || fallback;
}

function normalizeDate(value) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

function normalizeOrgNumber(value, company) {
  const cleaned = String(value ?? '').replace(/\D/g, '');

  if (cleaned) {
    return cleaned;
  }

  const peOrgNr = String(company?.PeOrgNr ?? '').replace(/\D/g, '');
  return peOrgNr.slice(-10) || null;
}

/**
 * Normalizes a raw company object into a Supabase row.
 *
 * Stores EXACTLY the fields from the master export (exports/{date}/master.json).
 * No raw_payload, no enrichment source columns, no internal fields.
 */
export function normalizeForSupabaseRow(company, targetDate, options = {}) {
  const snapshotDate = formatOutputDate(targetDate);
  const importedAt = options.importedAt ?? new Date().toISOString();
  const orgNumber = normalizeOrgNumber(company?.OrgNr, company);

  if (!orgNumber) {
    throw new Error(`Missing OrgNr for row on ${snapshotDate}.`);
  }

  return {
    snapshot_id: options.snapshotId ?? null,
    snapshot_date: snapshotDate,
    org_number: orgNumber,
    pe_org_number: cleanText(company?.PeOrgNr),
    company_name: cleanText(company?.['Företagsnamn'] ?? company?.Firma, 'Okänt bolag'),
    firma: cleanText(company?.Firma),
    legal_form: cleanText(company?.['Juridisk form']),
    private_public: cleanText(company?.['Privat/Publikt']),
    registration_date: normalizeDate(company?.Registreringsdatum ?? company?.Startdatum) ?? snapshotDate,
    start_date: normalizeDate(company?.Startdatum),
    end_date: normalizeDate(company?.Slutdatum),
    company_status: cleanText(company?.Bolagsstatus),
    business_status: cleanText(company?.Företagsstatus),
    county: cleanText(company?.['Säteslän'], 'Ej svenskt län'),
    municipality: cleanText(company?.['Säteskommun'], 'Okänd kommun'),
    industry_code: cleanText(company?.['Bransch_1, kod']),
    industry: cleanText(company?.['Bransch_1'], 'Okänd'),
    a_region: cleanText(company?.ARegion),
    postal_address: cleanText(company?.PostAdress),
    postal_code: cleanText(company?.PostNr),
    postal_city: cleanText(company?.PostOrt),
    email: cleanText(getPrimaryEmail(company)),
    phone: cleanText(getPrimaryPhone(company)),
    f_tax_status: cleanText(company?.Fskattstatus),
    vat_status: cleanText(company?.Momsstatus),
    employer_status: cleanText(company?.Arbetsgivarstatus),
    size_class: cleanText(company?.['Storleksklass SME']),
    mailing_status: cleanText(company?.Utskick),
    advertising_status: cleanText(company?.Reklam),
    imported_at: importedAt,
  };
}

export function normalizeForSupabaseRows(companies, targetDate, options = {}) {
  const importedAt = options.importedAt ?? new Date().toISOString();

  return companies.map((company) =>
    normalizeForSupabaseRow(company, targetDate, {
      ...options,
      importedAt,
    }),
  );
}
