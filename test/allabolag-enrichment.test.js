import test from 'node:test';
import assert from 'node:assert/strict';

import { runAllabolagEnrichmentCli } from '../src/allabolag-enrichment-cli.js';

test('standalone Allabolag enrichment command exits without running enrichment', async () => {
  const messages = [];
  const exitCode = await runAllabolagEnrichmentCli([], {
    write: (message) => messages.push(message),
  });

  assert.equal(exitCode, 0);
  assert.match(messages.join(''), /Allabolag-berikning är avstängd/);
});

test('standalone Allabolag enrichment help explains disabled state', async () => {
  const messages = [];
  const exitCode = await runAllabolagEnrichmentCli(['--help'], {
    write: (message) => messages.push(message),
  });

  assert.equal(exitCode, 0);
  assert.match(messages.join(''), /Allabolag-berikning är avstängd/);
});
