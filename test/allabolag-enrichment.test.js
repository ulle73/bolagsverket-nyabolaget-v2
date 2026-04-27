import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveBrowserArgs,
  shouldDisableBrowserSandbox,
} from '../src/allabolag-enrichment.js';

function withEnv(overrides, fn) {
  const previous = {};
  const keys = Object.keys(overrides);

  for (const key of keys) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('shouldDisableBrowserSandbox honors explicit override', () => {
  assert.equal(shouldDisableBrowserSandbox({ disableSandbox: true }), true);
  assert.equal(shouldDisableBrowserSandbox({ disableSandbox: false }), false);
});

test('shouldDisableBrowserSandbox auto-enables on GitHub Actions Linux', () => {
  withEnv(
    {
      GITHUB_ACTIONS: 'true',
      ALLABOLAG_DISABLE_SANDBOX: undefined,
    },
    () => {
      assert.equal(shouldDisableBrowserSandbox({}), process.platform === 'linux');
    },
  );
});

test('resolveBrowserArgs adds sandbox bypass flags when sandbox is disabled', () => {
  const args = resolveBrowserArgs({ disableSandbox: true });

  assert.ok(args.includes('--no-sandbox'));
  assert.ok(args.includes('--disable-setuid-sandbox'));
});

test('resolveBrowserArgs keeps default args when sandbox remains enabled', () => {
  const args = resolveBrowserArgs({ disableSandbox: false });

  assert.ok(args.includes('--disable-blink-features=AutomationControlled'));
  assert.ok(!args.includes('--no-sandbox'));
  assert.ok(!args.includes('--disable-setuid-sandbox'));
});
