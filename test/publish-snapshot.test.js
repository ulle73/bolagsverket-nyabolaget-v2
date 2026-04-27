import test from 'node:test';
import assert from 'node:assert/strict';

import { publishSnapshot } from '../src/publish-snapshot.js';

function buildRow(orgNumber) {
  return {
    snapshot_id: null,
    snapshot_date: '2026-04-13',
    org_number: orgNumber,
    company_name: `Bolag ${orgNumber}`,
    legal_form: 'Aktiebolag',
    registration_date: '2026-04-13',
    company_status: 'Normalläge',
    business_status: 'Är verksam',
    county: 'Stockholm',
    municipality: 'Stockholm',
    industry_code: '62010',
    industry_label: 'Dataprogrammering',
    industry: 'Dataprogrammering',
    scb_email: null,
    scb_phone: null,
    allabolag_email: null,
    allabolag_phone: null,
    email: null,
    phone: null,
    contact_name: null,
    contact_role: null,
    marketing_protected: false,
    allabolag_lookup_status: 'not-applicable',
    imported_at: '2026-04-24T12:00:00.000Z',
    raw_payload: {},
  };
}

test('publishSnapshot replaces a snapshot date and marks the import run as published', async () => {
  const operations = [];
  let importRunPayload;
  let updateImportRunPayload;
  let firstDataSnapshotPayload;
  let finalDataSnapshotPayload;
  let deletedSnapshotDate;
  const insertedBatches = [];

  const repository = {
    async createImportRun(payload) {
      operations.push('createImportRun');
      importRunPayload = payload;
      return 'run_123';
    },
    async updateImportRun(id, patch) {
      operations.push('updateImportRun');
      updateImportRunPayload = { id, patch };
    },
    async upsertDataSnapshot(row) {
      operations.push(`upsertDataSnapshot:${row.row_count}`);

      if (!firstDataSnapshotPayload) {
        firstDataSnapshotPayload = row;
      } else {
        finalDataSnapshotPayload = row;
      }

      return 'snapshot_123';
    },
    async deleteCompanySnapshots(snapshotDate) {
      operations.push('deleteCompanySnapshots');
      deletedSnapshotDate = snapshotDate;
    },
    async insertCompanySnapshotBatch(rows) {
      operations.push(`insertCompanySnapshotBatch:${rows.length}`);
      insertedBatches.push(rows);
    },
  };

  const rows = [buildRow('5595488353'), buildRow('5595488354'), buildRow('5595488355')];
  const result = await publishSnapshot(rows, {
    snapshotDate: '2026-04-13',
    sourceCommit: 'abc123',
    rawRowCount: 4,
    batchSize: 2,
    repository,
  });

  assert.equal(result.snapshotDate, '2026-04-13');
  assert.equal(result.rowCount, 3);
  assert.equal(result.batchCount, 2);
  assert.equal(importRunPayload.snapshot_date, '2026-04-13');
  assert.equal(importRunPayload.source_commit, 'abc123');
  assert.equal(importRunPayload.raw_row_count, 4);
  assert.equal(deletedSnapshotDate, '2026-04-13');
  assert.equal(firstDataSnapshotPayload.row_count, 0);
  assert.equal(firstDataSnapshotPayload.import_run_id, 'run_123');
  assert.equal(finalDataSnapshotPayload.row_count, 3);
  assert.equal(finalDataSnapshotPayload.import_run_id, 'run_123');
  assert.equal(updateImportRunPayload.id, 'run_123');
  assert.equal(updateImportRunPayload.patch.status, 'published');
  assert.equal(updateImportRunPayload.patch.published_row_count, 3);
  assert.equal(insertedBatches.length, 2);
  assert.equal(insertedBatches[0][0].snapshot_id, 'snapshot_123');
  assert.equal(insertedBatches[1][0].snapshot_id, 'snapshot_123');
  assert.deepEqual(operations, [
    'createImportRun',
    'upsertDataSnapshot:0',
    'deleteCompanySnapshots',
    'insertCompanySnapshotBatch:2',
    'insertCompanySnapshotBatch:1',
    'upsertDataSnapshot:3',
    'updateImportRun',
  ]);
});
