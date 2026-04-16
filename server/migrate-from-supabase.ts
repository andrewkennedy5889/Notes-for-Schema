/**
 * Migration script: Pull all _splan_* data from Supabase Postgres → local SQLite
 */
import pg from 'pg';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'schema-planner.db');

const DATABASE_URL = 'postgresql://postgres.xyollalkbotbqnbvmfrw:werdnaCXP081%24%21@aws-0-us-west-2.pooler.supabase.com:5432/postgres';

// All schema planner tables with their column mappings
const TABLES = [
  '_splan_modules',
  '_splan_tag_catalog',
  '_splan_data_tables',
  '_splan_data_fields',
  '_splan_module_use_fields',
  '_splan_features',
  '_splan_feature_concerns',
  '_splan_change_log',
  '_splan_data_access_rules',
  '_splan_feature_data_reviews',
  '_splan_entity_or_module_rules',
  '_splan_grouping_presets',
];

// Columns that are JSON in Postgres and need to be stringified for SQLite
const JSON_COLUMNS = new Set([
  'platforms', 'tags', 'modules', 'data_tables', 'data_fields', 'images',
  'notes_fmt', 'native_notes_fmt', 'android_notes_fmt', 'apple_notes_fmt',
  'other_notes_fmt', 'impl_fmt', 'collapsed_sections', 'embedded_tables',
  'feature_tags', 'checklist', 'conditions', 'config',
]);

// Boolean columns stored as INTEGER in SQLite
const BOOL_COLUMNS = new Set([
  'is_system_created', 'is_required', 'is_unique', 'is_foreign_key', 'is_active',
]);

function convertValue(colName: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;

  // JSON columns: stringify objects/arrays
  if (JSON_COLUMNS.has(colName)) {
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  }

  // Boolean columns: convert to 0/1
  if (BOOL_COLUMNS.has(colName)) {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  }

  // Timestamps: convert Date objects to string
  if (value instanceof Date) {
    return value.toISOString().replace('T', ' ').substring(0, 19);
  }

  return value;
}

async function migrate() {
  console.log('Connecting to Supabase Postgres...');
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected!\n');

  console.log('Opening local SQLite database...');
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF'); // Disable during migration to allow any insert order

  let totalRows = 0;

  for (const table of TABLES) {
    // Check if table exists in Postgres
    const tableCheck = await client.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
      [table]
    );
    if (!tableCheck.rows[0].exists) {
      console.log(`  ⚠ Table ${table} not found in Postgres, skipping`);
      continue;
    }

    // Fetch all rows from Postgres
    const result = await client.query(`SELECT * FROM ${table}`);
    const rowCount = result.rows.length;

    if (rowCount === 0) {
      console.log(`  ${table}: 0 rows (empty)`);
      continue;
    }

    // Clear existing data in SQLite for this table
    sqlite.prepare(`DELETE FROM ${table}`).run();

    // Get column names from the first row
    const pgColumns = Object.keys(result.rows[0]);

    // Check which columns exist in SQLite
    const sqliteColInfo = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const sqliteColumns = new Set(sqliteColInfo.map(c => c.name));

    // Only use columns that exist in both
    const columns = pgColumns.filter(c => sqliteColumns.has(c));

    const placeholders = columns.map(() => '?').join(', ');
    const insertStmt = sqlite.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);

    const insertMany = sqlite.transaction((rows: unknown[][]) => {
      for (const row of rows) {
        insertStmt.run(...row);
      }
    });

    const rowData = result.rows.map(row =>
      columns.map(col => convertValue(col, row[col]))
    );

    insertMany(rowData);
    totalRows += rowCount;
    console.log(`  ${table}: ${rowCount} rows migrated`);
  }

  // Re-enable foreign keys
  sqlite.pragma('foreign_keys = ON');
  sqlite.close();

  await client.end();

  console.log(`\n✓ Migration complete! ${totalRows} total rows imported into ${DB_PATH}`);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
