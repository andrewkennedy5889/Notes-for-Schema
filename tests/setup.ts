import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEST_DB_PATH = path.join(__dirname, '..', 'schema-planner-test.db');

// ─── Schema init (mirrors server/db.ts) ──────────────────────────────────────

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _splan_modules (
      module_id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_name TEXT NOT NULL,
      module_logo TEXT,
      module_purpose TEXT,
      module_creator INTEGER NOT NULL DEFAULT 0,
      is_system_created INTEGER NOT NULL DEFAULT 0,
      module_description TEXT,
      platforms TEXT NOT NULL DEFAULT '["Web App"]',
      tags TEXT NOT NULL DEFAULT '[]',
      group_label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_tag_catalog (
      tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_name TEXT NOT NULL UNIQUE,
      tier INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_data_tables (
      table_id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      description_purpose TEXT,
      record_ownership TEXT NOT NULL DEFAULT 'org_private',
      table_status TEXT NOT NULL DEFAULT 'planned',
      tags TEXT NOT NULL DEFAULT '[]',
      example_records TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_data_fields (
      field_id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_name TEXT NOT NULL,
      data_table_id INTEGER REFERENCES _splan_data_tables(table_id) ON DELETE CASCADE,
      field_status TEXT NOT NULL DEFAULT 'planned',
      name_reasoning TEXT,
      data_type TEXT NOT NULL DEFAULT 'Text',
      is_required INTEGER,
      is_unique INTEGER,
      default_value TEXT,
      is_foreign_key INTEGER,
      references_table INTEGER,
      references_field INTEGER,
      example_values TEXT
    );

    CREATE TABLE IF NOT EXISTS _splan_module_use_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER REFERENCES _splan_modules(module_id) ON DELETE CASCADE,
      field_id INTEGER REFERENCES _splan_data_fields(field_id) ON DELETE CASCADE,
      purpose TEXT,
      use_type TEXT NOT NULL DEFAULT 'View',
      is_required INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS _splan_features (
      feature_id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_name TEXT NOT NULL,
      description TEXT,
      notes TEXT,
      notes_fmt TEXT NOT NULL DEFAULT '[]',
      native_notes TEXT,
      native_notes_fmt TEXT NOT NULL DEFAULT '[]',
      android_notes TEXT,
      android_notes_fmt TEXT NOT NULL DEFAULT '[]',
      apple_notes TEXT,
      apple_notes_fmt TEXT NOT NULL DEFAULT '[]',
      other_notes TEXT,
      other_notes_fmt TEXT NOT NULL DEFAULT '[]',
      feature_tags TEXT NOT NULL DEFAULT '[]',
      modules TEXT NOT NULL DEFAULT '[]',
      data_tables TEXT NOT NULL DEFAULT '[]',
      data_fields TEXT NOT NULL DEFAULT '[]',
      implementation TEXT,
      impl_fmt TEXT NOT NULL DEFAULT '[]',
      images TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'Idea',
      priority TEXT NOT NULL DEFAULT 'Medium',
      platforms TEXT NOT NULL DEFAULT '["Web App"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      collapsed_sections TEXT NOT NULL DEFAULT '{}',
      embedded_tables TEXT NOT NULL DEFAULT '{}',
      dependencies TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_feature_concerns (
      concern_id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER REFERENCES _splan_features(feature_id) ON DELETE CASCADE,
      tier INTEGER NOT NULL DEFAULT 3,
      concern_text TEXT,
      mitigation_text TEXT,
      status TEXT NOT NULL DEFAULT 'Open'
    );

    CREATE TABLE IF NOT EXISTS _splan_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      field_changed TEXT,
      old_value TEXT,
      new_value TEXT,
      reasoning TEXT,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_data_access_rules (
      rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL REFERENCES _splan_data_tables(table_id) ON DELETE CASCADE,
      business_type TEXT,
      role TEXT,
      user_type TEXT,
      tier_min INTEGER,
      tier_max INTEGER,
      swimlane TEXT,
      access_level TEXT NOT NULL DEFAULT 'none',
      scope_notes TEXT,
      ownership_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_feature_data_reviews (
      review_id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER NOT NULL REFERENCES _splan_features(feature_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      summary TEXT,
      checklist TEXT NOT NULL DEFAULT '[]',
      reviewed_by TEXT,
      reviewed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_entity_or_module_rules (
      rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL DEFAULT 'module',
      entity_id INTEGER NOT NULL,
      relationship TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_ref_id INTEGER,
      source_ref_label TEXT,
      logic TEXT NOT NULL DEFAULT 'AND',
      conditions TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_grouping_presets (
      preset_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_key TEXT NOT NULL,
      preset_name TEXT NOT NULL DEFAULT 'Untitled',
      config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_discussions (
      discussion_id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'claude_code',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_implementation_steps (
      step_id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER NOT NULL REFERENCES _splan_features(feature_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      step_type TEXT NOT NULL DEFAULT 'implementation',
      status TEXT NOT NULL DEFAULT 'pending',
      sort_order INTEGER NOT NULL DEFAULT 0,
      assigned_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_feature_tests (
      test_id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER NOT NULL REFERENCES _splan_features(feature_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      test_type TEXT NOT NULL DEFAULT 'acceptance',
      status TEXT NOT NULL DEFAULT 'draft',
      dependencies TEXT NOT NULL DEFAULT '[]',
      preconditions TEXT,
      expected_result TEXT,
      generated_code TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_research (
      research_id INTEGER PRIMARY KEY AUTOINCREMENT,
      concept_id INTEGER REFERENCES _splan_concepts(concept_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT,
      findings TEXT,
      sources TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      researched_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_prototypes (
      prototype_id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      prototype_type TEXT NOT NULL DEFAULT 'component',
      status TEXT NOT NULL DEFAULT 'idea',
      features TEXT NOT NULL DEFAULT '[]',
      tests TEXT NOT NULL DEFAULT '[]',
      tech_stack TEXT,
      entry_point TEXT,
      source_path TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function createTestDb(): Database.Database {
  const db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

export function cleanupTestDb(): void {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch { /* ignore */ }
  try {
    fs.unlinkSync(TEST_DB_PATH + '-shm');
  } catch { /* ignore */ }
  try {
    fs.unlinkSync(TEST_DB_PATH + '-wal');
  } catch { /* ignore */ }
}
