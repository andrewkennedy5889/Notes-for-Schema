#!/usr/bin/env node

/**
 * Pull data from a remote Schema Planner instance into the local database.
 *
 * Usage:
 *   node scripts/sync-from-remote.mjs <remote-url> <password> [--force]
 *
 * Example:
 *   node scripts/sync-from-remote.mjs https://notes-for-schema-production.up.railway.app mypassword
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
  console.error('Usage: node scripts/sync-from-remote.mjs <remote-url> <password> [--force]');
  console.error('Example: node scripts/sync-from-remote.mjs https://notes-for-schema-production.up.railway.app mypassword');
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

// ─── Safety check: are there unsaved local changes? ─────────────────────────

const localDb = new Database(DB_PATH);

// Ensure sync_meta table exists locally
localDb.exec(`CREATE TABLE IF NOT EXISTS _splan_sync_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_direction TEXT NOT NULL,
  remote_url TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  rows_synced INTEGER NOT NULL DEFAULT 0
)`);

const lastSync = localDb.prepare(
  'SELECT * FROM _splan_sync_meta ORDER BY synced_at DESC LIMIT 1'
).get();

if (lastSync && !forceFlag) {
  const localChanges = localDb.prepare(
    `SELECT entity_type, entity_id, action, field_changed, new_value, changed_at
     FROM _splan_change_log
     WHERE changed_at > ?
     ORDER BY changed_at DESC`
  ).all(lastSync.synced_at);

  if (localChanges.length > 0) {
    console.warn(`\n⚠  WARNING: You have ${localChanges.length} local change(s) since the last sync (${lastSync.synced_at}).\n`);
    console.warn('These changes will be OVERWRITTEN if you pull:\n');

    const preview = localChanges.slice(0, 20);
    for (const ch of preview) {
      const detail = ch.field_changed ? ` → ${ch.field_changed}` : '';
      console.warn(`  ${ch.action} ${ch.entity_type} #${ch.entity_id}${detail}  (${ch.changed_at})`);
    }
    if (localChanges.length > 20) {
      console.warn(`  ... and ${localChanges.length - 20} more`);
    }

    console.warn('\nTo push local changes first:  node scripts/sync-to-remote.mjs <url> <password>');
    console.warn('To pull anyway (overwrite):   add --force flag\n');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(resolve => {
      rl.question('Proceed anyway? (yes/no): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      localDb.close();
      console.log('Aborted.');
      process.exit(0);
    }
  } else {
    console.log('No unsaved local changes — safe to pull.\n');
  }
} else if (!lastSync) {
  console.log('No previous sync recorded — first pull.\n');
} else {
  console.log('Overriding local safety check with --force.\n');
}

localDb.close();

// ─── Fetch remote data ─────────────────────────────────────────────────────

console.log('Downloading data from remote...');
const exportRes = await fetch(`${baseUrl}/api/db-export`, {
  headers: { 'Cookie': sessionCookie },
});

if (!exportRes.ok) {
  const errText = await exportRes.text();
  console.error(`Export failed with status ${exportRes.status}:`);
  console.error(errText.substring(0, 500));
  process.exit(1);
}

const { tables } = await exportRes.json();
const tableNames = Object.keys(tables);
let totalRows = 0;

console.log('\nReceived tables:');
for (const [name, rows] of Object.entries(tables)) {
  console.log(`  ${name}: ${rows.length} rows`);
  totalRows += rows.length;
}
console.log(`\nTotal: ${tableNames.length} tables, ${totalRows} rows\n`);

// ─── Import into local DB ───────────────────────────────────────────────────

console.log('Importing into local database...');
const db = new Database(DB_PATH);

const SKIP_TABLES = new Set(['_splan_all_tests', '_splan_grouping_presets', '_splan_sync_meta']);

// Same two-phase approach as the server's db-import endpoint
const ENTITY_TABLE_MAP = {
  modules: '_splan_modules', features: '_splan_features', concepts: '_splan_concepts',
  data_tables: '_splan_data_tables', data_fields: '_splan_data_fields',
  projects: '_splan_projects', research: '_splan_research', prototypes: '_splan_prototypes',
};

db.pragma('foreign_keys = OFF');

try {
  const importAll = db.transaction(() => {
    // Phase 1: Import column_defs first and apply user-defined columns
    if (tables['_splan_column_defs'] && Array.isArray(tables['_splan_column_defs'])) {
      const cdRows = tables['_splan_column_defs'];
      db.exec('DELETE FROM _splan_column_defs');
      if (cdRows.length > 0) {
        const cols = Object.keys(cdRows[0]);
        const placeholders = cols.map(() => '?').join(', ');
        const insertStmt = db.prepare(`INSERT INTO _splan_column_defs (${cols.join(', ')}) VALUES (${placeholders})`);
        for (const row of cdRows) { insertStmt.run(...cols.map(c => row[c] ?? null)); }
      }

      for (const def of cdRows) {
        const sqlTable = ENTITY_TABLE_MAP[def.entity_type];
        if (!sqlTable) continue;
        const colType = def.column_type;
        if (colType === 'formula') continue;
        const sqlType = colType === 'int' ? 'INTEGER' : colType === 'boolean' ? "INTEGER NOT NULL DEFAULT 0" : "TEXT NOT NULL DEFAULT ''";
        try { db.exec(`ALTER TABLE ${sqlTable} ADD COLUMN ${def.column_key} ${sqlType}`); } catch { /* already exists */ }
      }
    }

    // Phase 2: Import all other tables
    for (const [tableName, rows] of Object.entries(tables)) {
      if (SKIP_TABLES.has(tableName)) continue;
      if (tableName === '_splan_column_defs') continue;
      if (!Array.isArray(rows)) continue;

      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(tableName);
      if (!tableExists) continue;

      db.exec(`DELETE FROM ${tableName}`);

      if (rows.length === 0) continue;

      const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
      const existingCols = new Set(tableInfo.map(c => c.name));
      const cols = Object.keys(rows[0]).filter(c => existingCols.has(c));
      if (cols.length === 0) continue;

      const placeholders = cols.map(() => '?').join(', ');
      const insertStmt = db.prepare(
        `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`
      );

      for (const row of rows) {
        insertStmt.run(...cols.map(c => row[c] ?? null));
      }
    }
  });

  importAll();
} finally {
  db.pragma('foreign_keys = ON');
}

// ─── Record sync locally ────────────────────────────────────────────────────

db.prepare(
  'INSERT INTO _splan_sync_meta (sync_direction, remote_url, rows_synced) VALUES (?, ?, ?)'
).run('pull', baseUrl, totalRows);

db.close();

// ─── Report ─────────────────────────────────────────────────────────────────

console.log('\n✓ Pull successful!');
console.log(`\nTotal rows pulled: ${totalRows}`);
console.log('Your local database is now in sync with the remote.');
