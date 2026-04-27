import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';

import { writeDeliveryReady } from '../src/delivery-ready.js';
import { writeIndustryExports } from '../src/industry-exports.js';
import { buildSalesSegments, writeSalesExports } from '../src/sales-exports.js';

function buildCompany(overrides = {}) {
  return {
    OrgNr: '556000-0001',
    PeOrgNr: '165560000001',
    Företagsnamn: 'Exempelbolaget AB',
    Firma: 'Exempelbolaget AB',
    'Juridisk form': 'Aktiebolag',
    'Privat/Publikt': 'Privat',
    Registreringsdatum: '2026-04-20',
    Startdatum: '2026-04-20',
    Slutdatum: '',
    Bolagsstatus: 'Normalläge',
    Företagsstatus: 'Är verksam',
    Bransch_1: 'Konsultverksamhet',
    'Bransch_1, kod': '62020',
    Säteskommun: 'Stockholm',
    Säteslän: 'Stockholm',
    ARegion: '01',
    PostAdress: 'Testgatan 1',
    PostNr: '11122',
    PostOrt: 'Stockholm',
    'E-post': '',
    Telefon: '',
    Reklam: '',
    Utskick: '',
    ...overrides,
  };
}

test('buildSalesSegments exposes phone-only audience alongside mail-only', () => {
  const companies = [
    buildCompany({
      OrgNr: '556000-0001',
      PeOrgNr: '165560000001',
      'E-post': 'mail@example.se',
    }),
    buildCompany({
      OrgNr: '556000-0002',
      PeOrgNr: '165560000002',
      Telefon: '08-123 45 67',
    }),
  ];

  const segments = buildSalesSegments(companies);

  assert.equal(segments['mail-only'].length, 1);
  assert.equal(segments['phone-only'].length, 1);
  assert.equal(segments.byCounty['phone-only'].get('stockholm').companies.length, 1);
  assert.equal(segments.byIndustry['phone-only'].get('konsultverksamhet').companies.length, 1);
});

test('phone-only exports are written wherever mail-only exists', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'phone-only-'));
  const outputRoot = path.join(tempDir, 'exports');
  const stateDir = path.join(tempDir, 'state');
  const companies = [
    buildCompany({
      OrgNr: '556000-0001',
      PeOrgNr: '165560000001',
      'E-post': 'mail@example.se',
      Telefon: '08-111 11 11',
    }),
    buildCompany({
      OrgNr: '556000-0002',
      PeOrgNr: '165560000002',
      Telefon: '08-222 22 22',
    }),
    buildCompany({
      OrgNr: '556000-0003',
      PeOrgNr: '165560000003',
      'E-post': 'only-mail@example.se',
    }),
  ];

  try {
    const salesExports = await writeSalesExports(companies, '2026-04-23', { outputRoot });
    const industryExports = await writeIndustryExports(companies, '2026-04-23', { outputRoot });
    const deliveryReady = await writeDeliveryReady(companies, '2026-04-23', {
      outputRoot,
      stateDir,
    });

    assert.ok(salesExports.files['phone-only']);
    assert.ok(industryExports.phoneOnly);
    assert.ok(deliveryReady.mirrored.phoneOnly);
    assert.ok(deliveryReady.manifest.SpegladeFiler.PhoneOnly);

    await stat(path.join(outputRoot, '2026-04-23', 'phone-only', '2026-04-23.json'));
    await stat(
      path.join(
        outputRoot,
        '2026-04-23',
        'by-lan',
        'phone-only',
        'stockholm',
        '2026-04-23.json',
      ),
    );
    await stat(
      path.join(
        outputRoot,
        '2026-04-23',
        'by-industry',
        'phone-only',
        'konsultverksamhet',
        '2026-04-23.json',
      ),
    );
    await stat(
      path.join(
        outputRoot,
        '2026-04-23',
        'by-industry-all',
        'phone-only',
        'konsultverksamhet',
        '2026-04-23.json',
      ),
    );
    await stat(
      path.join(outputRoot, '2026-04-23', 'phone-only', '2026-04-23-delivery-ready.json'),
    );
    await stat(
      path.join(
        outputRoot,
        '2026-04-23',
        'by-lan',
        'phone-only',
        'stockholm',
        '2026-04-23-delivery-ready.json',
      ),
    );
    await stat(
      path.join(
        outputRoot,
        '2026-04-23',
        'by-industry',
        'phone-only',
        'konsultverksamhet',
        '2026-04-23-delivery-ready.json',
      ),
    );
    await stat(
      path.join(
        outputRoot,
        '2026-04-23',
        'by-industry-all',
        'phone-only',
        'konsultverksamhet',
        '2026-04-23-delivery-ready.json',
      ),
    );
    await stat(path.join(stateDir, 'telefonleveranshistorik.json'));

    const phoneDeliveryReadyRows = JSON.parse(
      await readFile(
        path.join(outputRoot, '2026-04-23', 'phone-only', '2026-04-23-delivery-ready.json'),
        'utf8',
      ),
    );

    assert.equal(phoneDeliveryReadyRows.length, 2);
    assert.deepEqual(Object.keys(phoneDeliveryReadyRows[0]), [
      'E-post',
      'Företagsnamn',
      'OrgNr',
      'Säteslän',
      'Säteskommun',
      'Bransch',
      'Telefon',
      'Kontaktperson namn',
      'Kontaktperson roll',
    ]);
    assert.equal(Object.keys(phoneDeliveryReadyRows[0]).includes('Registreringsdatum'), false);
    assert.equal(
      phoneDeliveryReadyRows.every((row) => typeof row.Telefon === 'string' && row.Telefon.trim()),
      true,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
