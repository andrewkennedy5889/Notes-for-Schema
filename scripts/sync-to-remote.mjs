#!/usr/bin/env node

/**
 * Sync local schema-planner.db to a remote Schema Planner instance.
 *
 * Usage:
 *   node scripts/sync-to-remote.mjs <remote-url> <password>
 *
 * Example:
 *   node scripts/sync-to-remote.mjs https://notes-for-schema-production.up.railway.app mypassword
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'schema-planner.db');

// ─── Parse CLI args ──────────────────────────────────────────────────────────

const [,, remoteUrl, password] = process.argv;

if (!remoteUrl || !password) {
  console.error('Usage: node scripts/sync-to-remote.mjs <remote-url> <password>');
  console.error('Example: node scripts/sync-to-remote.mjs https://notes-for-schema-production.up.railway.app mypassword');
  process.exit(1);
}

// Strip trailing slash
const baseUrl = remoteUrl.replace(/\/+$/, '');

// ─── Step 1: Read local database ─────────────────────────────────────────────

console.log(`Opening local database: ${DB_PATH}`);
const db = new Database(DB_PATH, { readonly: true });

// Get all _splan_ tables (skip views like _splan_all_tests)
const tableRows = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_splan_%' ORDER BY name"
).all();

const SKIP_TABLES = new Set(['_splan_all_tests', '_splan_grouping_presets']);

const tables = {};
let totalRows = 0;

for (const { name } of tableRows) {
  if (SKIP_TABLES.has(name)) {
    console.log(`  Skipping ${name} (view/deprecated)`);
    continue;
  }

  const rows = db.prepare(`SELECT * FROM ${name}`).all();
  tables[name] = rows;
  totalRows += rows.length;
  console.log(`  ${name}: ${rows.length} rows`);
}

db.close();
console.log(`\nTotal: ${Object.keys(tables).length} tables, ${totalRows} rows\n`);

// ─── Step 2: Compute auth token directly ────────────────────────────────────
// The auth token is HMAC-SHA256(password, 'schema-planner-session') — same as server/auth.ts
const token = crypto.createHmac('sha256', password).update('schema-planner-session').digest('hex');
const sessionCookie = `splan_session=${token}`;

// Verify the token works by hitting the auth check endpoint
console.log(`Authenticating with ${baseUrl}...`);
const checkRes = await fetch(`${baseUrl}/auth/check`, {
  headers: { 'Cookie': sessionCookie },
});
const checkData = await checkRes.json();
if (!checkData.authenticated) {
  console.error('Authentication failed. The password may be incorrect.');
  process.exit(1);
}
console.log('Authenticated successfully.\n');

// ─── Step 3: POST the data to /api/db-import ────────────────────────────────

console.log('Uploading data to remote...');

const payload = JSON.stringify({ tables });
const sizeMb = (Buffer.byteLength(payload) / 1024 / 1024).toFixed(2);
console.log(`Payload size: ${sizeMb} MB`);

const importRes = await fetch(`${baseUrl}/api/db-import`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': sessionCookie,
  },
  body: payload,
});

if (!importRes.ok) {
  const errText = await importRes.text();
  console.error(`Import failed with status ${importRes.status}:`);
  console.error(errText.substring(0, 500));
  process.exit(1);
}

const result = await importRes.json();

// ─── Step 4: Report results ─────────────────────────────────────────────────

if (result.success) {
  console.log('\nImport successful!\n');
  console.log('Imported rows per table:');
  for (const [table, count] of Object.entries(result.imported)) {
    console.log(`  ${table}: ${count}`);
  }
  const totalImported = Object.values(result.imported).reduce((a, b) => a + b, 0);
  console.log(`\nTotal rows imported: ${totalImported}`);
} else {
  console.error('\nImport returned an unexpected response:');
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
