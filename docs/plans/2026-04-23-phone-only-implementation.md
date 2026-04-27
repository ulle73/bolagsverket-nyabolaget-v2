# Phone-Only Audience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `phone-only` audience everywhere `mail-only` exists today, including mirrored `delivery-ready` files for phone exports.

**Architecture:** Extend the shared sales segmentation so `phone-only` is produced once and consumed by all export writers. Keep phone delivery history separate from email delivery history so queued phone exports dedupe on phone identity rather than email identity.

**Tech Stack:** Node.js ESM, `node:test`, JSON/CSV/XLSX file writers

---

### Task 1: Add failing audience tests

**Files:**
- Create: `test/phone-only.test.js`

**Step 1: Write the failing test**

Add tests that expect:
- `buildSalesSegments()` to return `phone-only`
- `writeSalesExports()` to create `phone-only` and `by-lan/phone-only`
- `writeIndustryExports()` to create `by-industry-all/phone-only`
- `writeDeliveryReady()` to create `phone-only/*-delivery-ready`

**Step 2: Run test to verify it fails**

Run: `node --test test/phone-only.test.js`

Expected: FAIL because `phone-only` outputs do not exist yet.

### Task 2: Implement shared phone-only segments

**Files:**
- Modify: `src/sales-exports.js`
- Modify: `src/industry-exports.js`

**Step 1: Write minimal implementation**

Add `phone-only` rows and grouped exports using `getPrimaryPhone(company)`.

**Step 2: Run test to verify progress**

Run: `node --test test/phone-only.test.js`

Expected: sales and industry assertions move forward while delivery-ready still fails.

### Task 3: Implement phone delivery-ready flow

**Files:**
- Modify: `src/delivery-ready.js`
- Modify: `src/history-state.js`

**Step 1: Write minimal implementation**

Add phone-delivery entries, separate phone history file, and mirrored `phone-only` delivery-ready files under top-level and grouped folders.

**Step 2: Run test to verify it passes**

Run: `node --test test/phone-only.test.js`

Expected: PASS.

### Task 4: Update surfaced outputs

**Files:**
- Modify: `src/cli.js`
- Modify: `README.md`

**Step 1: Update CLI output and docs**

Expose `phone-only` export paths in CLI output and mention the new audience in the README.

**Step 2: Re-run focused verification**

Run:
- `node --test test/phone-only.test.js`
- `node --check src/sales-exports.js`
- `node --check src/delivery-ready.js`
- `node --check src/history-state.js`

Expected: PASS / exit code 0.
