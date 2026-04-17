#!/usr/bin/env node

/**
 * Push local schema-planner.db to a remote Schema Planner instance.
 *
 * Usage:
 *   node scripts/sync-to-remote.mjs <remote-url> <password> [--force]
 *
 * Example:
 *   node scripts/sync-to-remote.mjs https://notes-for-schema-production.up.railway.app mypassword
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'schema-planner.db');

// ─── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const forceFlag = args.includes('--force');
const positional = args.filter(a => a !== '--force');
const [remoteUrl, password] = positional;

if (!remoteUrl || !password) {
  console.error('Usage: node scripts/sync-to-remote.mjs <remote-url> <password> [--force]');
  console.error('Example: node scripts/sync-to-remote.mjs https://notes-for-schema-production.up.railway.app mypassword');
  process.exit(1);
}

// Strip trailing slash
const baseUrl = remoteUrl.replace(/\/+$/, '');

// ─── Auth ───────────────────────────────────────────────────────────────────
const token = crypto.createHmac('sha256', password).update('schema-planner-session').digest('hex');
const sessionCookie = `splan_session=${token}`;

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

// ─── Safety check: are there unsaved changes on the remote? ─────────────────

console.log('Checking remote for unsaved changes...');
const statusRes = await fetch(`${baseUrl}/api/sync-status`, {
  headers: { 'Cookie': sessionCookie },
});
const syncStatus = await statusRes.json();

if (syncStatus.changeCount > 0 && !forceFlag) {
  console.warn(`\n⚠  WARNING: The remote has ${syncStatus.changeCount} change(s) since the last sync (${syncStatus.lastSync?.syncedAt || 'never'}).\n`);
  console.warn('These changes will be OVERWRITTEN if you push:\n');

  // Show up to 20 changes
  const preview = syncStatus.changesSinceSync.slice(0, 20);
  for (const ch of preview) {
    const detail = ch.field_changed ? ` → ${ch.field_changed}` : '';
    console.warn(`  ${ch.action} ${ch.entity_type} #${ch.entity_id}${detail}  (${ch.changed_at})`);
  }
  if (syncStatus.changeCount > 20) {
    console.warn(`  ... and ${syncStatus.changeCount - 20} more`);
  }

  console.warn('\nTo pull remote changes first:  node scripts/sync-from-remote.mjs <url> <password>');
  console.warn('To push anyway (overwrite):    add --force flag\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => {
    rl.question('Proceed anyway? (yes/no): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
    console.log('Aborted.');
    process.exit(0);
  }
} else if (syncStatus.changeCount === 0) {
  console.log('Remote is clean — no unsaved changes.\n');
} else {
  console.log(`Remote has ${syncStatus.changeCount} change(s) — overriding with --force.\n`);
}

// ─── Read local database ────────────────────────────────────────────────────

console.log(`Opening local database: ${DB_PATH}`);
const db = new Database(DB_PATH, { readonly: true });

const tableRows = db.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_splan_%' ORDER BY name"
).all();

const SKIP_TABLES = new Set(['_splan_all_tests', '_splan_grouping_presets', '_splan_sync_meta']);

const tables = {};
let totalRows = 0;

for (const { name } of tableRows) {
  if (SKIP_TABLES.has(name)) {
    console.log(`  Skipping ${name}`);
    continue;
  }

  const rows = db.prepare(`SELECT * FROM ${name}`).all();
  tables[name] = rows;
  totalRows += rows.length;
  console.log(`  ${name}: ${rows.length} rows`);
}

db.close();
console.log(`\nTotal: ${Object.keys(tables).length} tables, ${totalRows} rows\n`);

// ─── Upload ─────────────────────────────────────────────────────────────────

console.log('Uploading data to remote...');

const payload = JSON.stringify({ tables });
const sizeMb = (Buffer.byteLength(payload) / 1024 / 1024).toFixed(2);
console.log(`Payload size: ${sizeMb} MB`);

const importRes = await fetch(`${baseUrl}/api/db-import`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': sessionCookie,
    'X-Sync-Source': 'local-push',
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

// ─── Record sync locally ────────────────────────────────────────────────────

const localDb = new Database(DB_PATH);
try {
  localDb.exec(`CREATE TABLE IF NOT EXISTS _splan_sync_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_direction TEXT NOT NULL,
    remote_url TEXT NOT NULL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    rows_synced INTEGER NOT NULL DEFAULT 0
  )`);
  localDb.prepare(
    'INSERT INTO _splan_sync_meta (sync_direction, remote_url, rows_synced) VALUES (?, ?, ?)'
  ).run('push', baseUrl, totalRows);
} finally {
  localDb.close();
}

// ─── Report ─────────────────────────────────────────────────────────────────

if (result.success) {
  console.log('\n✓ Push successful!\n');
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
