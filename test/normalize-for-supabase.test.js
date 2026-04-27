import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeForSupabaseRow, normalizeForSupabaseRows } from '../src/normalize-for-supabase.js';

function buildCompany(overrides = {}) {
  return {
    OrgNr: '5595488353',
    PeOrgNr: '165595488353',
    Företagsnamn: 'Example AB',
    Firma: 'Example AB',
    'Juridisk form': 'Aktiebolag',
    Registreringsdatum: '2026-04-13',
    Företagsstatus: 'Är verksam',
    Bolagsstatus: 'Normalläge',
    'Säteslän': 'Stockholm',
    'Säteskommun': 'Täby',
    'Bransch_1, kod': '81210',
    'Bransch_1': 'Lokalvård',
    'E-post': 'info@example.se',
    Telefon: '',
    allabolagLookupStatus: 'enriched',
    marketingProtection: false,
    contactPerson: {
      name: 'Anna Andersson',
      role: 'Ledamot',
    },
    ...overrides,
  };
}

test('normalizeForSupabaseRow maps enriched SCB company data into canonical snapshot fields', () => {
  const row = normalizeForSupabaseRow(buildCompany(), '2026-04-13', {
    importedAt: '2026-04-24T12:00:00.000Z',
  });

  assert.deepEqual(row, {
    snapshot_id: null,
    snapshot_date: '2026-04-13',
    org_number: '5595488353',
    company_name: 'Example AB',
    legal_form: 'Aktiebolag',
    registration_date: '2026-04-13',
    company_status: 'Normalläge',
    business_status: 'Är verksam',
    county: 'Stockholm',
    municipality: 'Täby',
    industry_code: '81210',
    industry_label: 'Lokalvård',
    industry: 'Lokalvård',
    scb_email: 'info@example.se',
    scb_phone: null,
    allabolag_email: null,
    allabolag_phone: null,
    email: 'info@example.se',
    phone: null,
    contact_name: 'Anna Andersson',
    contact_role: 'Ledamot',
    marketing_protected: false,
    allabolag_lookup_status: 'enriched',
    imported_at: '2026-04-24T12:00:00.000Z',
    raw_payload: buildCompany(),
  });
});

test('normalizeForSupabaseRows reuses importedAt across the full batch', () => {
  const rows = normalizeForSupabaseRows([buildCompany(), buildCompany({ OrgNr: '5595488354' })], '2026-04-13', {
    importedAt: '2026-04-24T12:00:00.000Z',
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].imported_at, '2026-04-24T12:00:00.000Z');
  assert.equal(rows[1].imported_at, '2026-04-24T12:00:00.000Z');
});
