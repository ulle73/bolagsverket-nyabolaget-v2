import { createSupabaseServiceClient, isArchiveDate } from './supabase-client.js';

const DEFAULT_BATCH_SIZE = 500;

function chunkRows(rows, size = DEFAULT_BATCH_SIZE) {
  const chunks = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

export function createSupabaseSnapshotRepository(client) {
  return {
    async createImportRun(payload) {
      const { data, error } = await client
        .from('import_runs')
        .insert(payload)
        .select('id')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return data.id;
    },
    async updateImportRun(id, patch) {
      const { error } = await client.from('import_runs').update(patch).eq('id', id);

      if (error) {
        throw new Error(error.message);
      }
    },
    async upsertDataSnapshot(row) {
      const { data, error } = await client
        .from('data_snapshots')
        .upsert(row, { onConflict: 'snapshot_date' })
        .select('id')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return data.id;
    },
    async deleteCompanySnapshots(snapshotDate) {
      const { error } = await client
        .from('company_snapshots')
        .delete()
        .eq('snapshot_date', snapshotDate);

      if (error) {
        throw new Error(error.message);
      }
    },
    async insertCompanySnapshotBatch(rows) {
      const { error } = await client.from('company_snapshots').insert(rows);

      if (error) {
        throw new Error(error.message);
      }
    },
  };
}

export async function publishSnapshot(
  normalizedRows,
  {
    snapshotDate,
    sourceRepo = 'bolagsverket-nyabolaget-v2',
    sourceCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null,
    details = {},
    rawRowCount = normalizedRows.length,
    batchSize = DEFAULT_BATCH_SIZE,
    repository,
    client,
    write = () => {},
  } = {},
) {
  if (!snapshotDate) {
    throw new Error('snapshotDate is required for publishSnapshot.');
  }

  let resolvedClient = client;
  let targetLabel = 'active';

  if (!repository && !resolvedClient) {
    const result = await createSupabaseServiceClient({ snapshotDate });
    resolvedClient = result.client;
    targetLabel = result.target;
  }

  const repo =
    repository ??
    createSupabaseSnapshotRepository(resolvedClient);

  write(`Publicerar till ${targetLabel} databas (${isArchiveDate(snapshotDate) ? 'arkiv' : 'aktiv'})...\n`);

  const startedAt = new Date().toISOString();
  const importRunId = await repo.createImportRun({
    snapshot_date: snapshotDate,
    source_repo: sourceRepo,
    source_commit: sourceCommit,
    status: 'started',
    raw_row_count: rawRowCount,
    details_json: details,
    started_at: startedAt,
    created_at: startedAt,
    updated_at: startedAt,
  });

  try {
    const snapshotId = await repo.upsertDataSnapshot({
      snapshot_date: snapshotDate,
      source_repo: sourceRepo,
      source_commit: sourceCommit,
      source_run_at: startedAt,
      row_count: 0,
      import_run_id: importRunId,
      updated_at: startedAt,
    });

    await repo.deleteCompanySnapshots(snapshotDate);

    const batches = chunkRows(
      normalizedRows.map((row) => ({
        ...row,
        snapshot_id: snapshotId,
      })),
      batchSize,
    );

    for (const batch of batches) {
      if (batch.length > 0) {
        await repo.insertCompanySnapshotBatch(batch);
      }
    }

    const completedAt = new Date().toISOString();

    await repo.upsertDataSnapshot({
      snapshot_date: snapshotDate,
      source_repo: sourceRepo,
      source_commit: sourceCommit,
      source_run_at: completedAt,
      row_count: normalizedRows.length,
      import_run_id: importRunId,
      updated_at: completedAt,
    });

    await repo.updateImportRun(importRunId, {
      status: 'published',
      published_row_count: normalizedRows.length,
      completed_at: completedAt,
      updated_at: completedAt,
    });

    return {
      importRunId,
      snapshotDate,
      rowCount: normalizedRows.length,
      batchCount: batches.length,
      target: targetLabel,
    };
  } catch (error) {
    const failedAt = new Date().toISOString();

    await repo.updateImportRun(importRunId, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown publish error',
      completed_at: failedAt,
      updated_at: failedAt,
    });

    throw error;
  }
}
