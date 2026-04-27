import {
  cleanValue,
  getPrimaryEmail,
  getPrimaryPhone,
  hasValue,
  isMarketingProtected,
} from './company-contact.js';
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

function normalizeAllabolagPhone(company) {
  const candidates = [
    company?.phone,
    company?.mobile,
    company?.phone2,
    company?.mobile2,
    company?.faxNumber,
  ];

  for (const candidate of candidates) {
    const cleaned = cleanText(candidate);

    if (cleaned) {
      return cleaned;
    }
  }

  return null;
}

function normalizeContactName(company) {
  if (company?.contactPerson && typeof company.contactPerson === 'object') {
    return cleanText(company.contactPerson.name);
  }

  return cleanText(company?.['Kontaktperson namn']);
}

function normalizeContactRole(company) {
  if (company?.contactPerson && typeof company.contactPerson === 'object') {
    return cleanText(company.contactPerson.role);
  }

  return cleanText(company?.['Kontaktperson roll']);
}

export function normalizeForSupabaseRow(company, targetDate, options = {}) {
  const snapshotDate = formatOutputDate(targetDate);
  const importedAt = options.importedAt ?? new Date().toISOString();
  const orgNumber = normalizeOrgNumber(company?.OrgNr, company);

  if (!orgNumber) {
    throw new Error(`Missing OrgNr for row on ${snapshotDate}.`);
  }

  const industryLabel = cleanText(company?.['Bransch_1'], 'Okänd');
  const primaryEmail = cleanText(getPrimaryEmail(company));
  const primaryPhone = cleanText(getPrimaryPhone(company));

  return {
    snapshot_id: options.snapshotId ?? null,
    snapshot_date: snapshotDate,
    org_number: orgNumber,
    company_name: cleanText(company?.['Företagsnamn'] ?? company?.Firma, 'Okänt bolag'),
    legal_form: cleanText(company?.['Juridisk form']),
    registration_date: normalizeDate(company?.Registreringsdatum ?? company?.Startdatum) ?? snapshotDate,
    company_status: cleanText(company?.Bolagsstatus),
    business_status: cleanText(company?.Företagsstatus),
    county: cleanText(company?.['Säteslän'], 'Ej svenskt län'),
    municipality: cleanText(company?.['Säteskommun'], 'Okänd kommun'),
    industry_code: cleanText(company?.['Bransch_1, kod']),
    industry_label: industryLabel,
    industry: industryLabel,
    scb_email: cleanText(company?.['E-post']),
    scb_phone: cleanText(company?.Telefon),
    allabolag_email: cleanText(company?.email ?? company?.['Allabolag e-post']),
    allabolag_phone: normalizeAllabolagPhone(company),
    email: primaryEmail,
    phone: primaryPhone,
    contact_name: normalizeContactName(company),
    contact_role: normalizeContactRole(company),
    marketing_protected: isMarketingProtected(company),
    allabolag_lookup_status: cleanText(company?.allabolagLookupStatus, hasValue(company?.contactPerson) ? 'enriched' : 'not-applicable'),
    imported_at: importedAt,
    raw_payload: company,
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
