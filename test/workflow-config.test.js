import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const WORKFLOW_PATH = path.resolve('C:/dev/bolagsverket-nyabolaget-v2/.github/workflows/daily-import.yml');

function extractJobBlock(workflow, jobName) {
  const lines = workflow.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line === `  ${jobName}:`);

  assert.notEqual(startIndex, -1, `Expected job ${jobName} to exist in workflow`);

  const block = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (index > startIndex && /^  [A-Za-z0-9_-]+:\s*$/.test(line)) {
      break;
    }

    block.push(line);
  }

  return block;
}

function extractRunsOn(jobBlock) {
  const runsOnIndex = jobBlock.findIndex((line) => line.startsWith('    runs-on:'));

  assert.notEqual(runsOnIndex, -1, 'Expected job to define runs-on');

  const runsOnLine = jobBlock[runsOnIndex];
  const inlineValue = runsOnLine.split(':')[1]?.trim();

  if (inlineValue) {
    return [inlineValue];
  }

  const values = [];

  for (let index = runsOnIndex + 1; index < jobBlock.length; index += 1) {
    const line = jobBlock[index];

    if (!line.startsWith('      - ')) {
      break;
    }

    values.push(line.replace('      - ', '').trim());
  }

  return values;
}

function hasLine(jobBlock, expectedLine) {
  return jobBlock.some((line) => line.trim() === expectedLine.trim());
}

test('scheduled and manual workflow jobs use the same runner configuration', async () => {
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');
  const scheduledRunsOn = extractRunsOn(extractJobBlock(workflow, 'sync-scheduled'));
  const manualRunsOn = extractRunsOn(extractJobBlock(workflow, 'sync-manual'));

  assert.deepEqual(scheduledRunsOn, manualRunsOn);
});

test('scheduled workflow queues and processes admin import requests instead of running sync:daily directly', async () => {
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');
  const scheduledJob = extractJobBlock(workflow, 'sync-scheduled');
  const scheduledJobText = scheduledJob.join('\n');

  assert.equal(
    hasLine(scheduledJob, 'run: npm run queue:scheduled-daily-request'),
    true,
    'Expected scheduled job to queue a daily admin request first',
  );
  assert.equal(
    hasLine(scheduledJob, 'run: npm run process:admin-requests'),
    true,
    'Expected scheduled job to process queued admin requests',
  );
  assert.equal(
    scheduledJobText.includes('npm run sync:daily'),
    false,
    'Expected scheduled job to avoid direct sync:daily execution',
  );
  assert.equal(
    scheduledJobText.includes('ADMIN_IMPORT_DAILY_ALREADY_RAN'),
    false,
    'Expected scheduled job to use the normal admin-request flow without skip flags',
  );
});

test('manual process_admin_requests workflow accepts request_id targeting and forwards it to the processor', async () => {
  const workflow = await readFile(WORKFLOW_PATH, 'utf8');

  assert.match(
    workflow,
    /request_id:\s*\n\s*description:\s*Specific admin_import_requests row to process/,
  );
  assert.match(
    workflow,
    /args\+=\("--request-id=\$\{\{\s*inputs\.request_id\s*\}\}"\)/,
  );
  assert.match(
    workflow,
    /npm run process:admin-requests -- "\$\{args\[@\]\}"/,
  );
});
