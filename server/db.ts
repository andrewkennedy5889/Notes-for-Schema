import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'schema-planner.db');
let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
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
      images TEXT NOT NULL DEFAULT '[]',
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

    CREATE TABLE IF NOT EXISTS _splan_view_presets (
      preset_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_key TEXT NOT NULL,
      preset_name TEXT NOT NULL DEFAULT 'Untitled',
      view_config TEXT NOT NULL DEFAULT '{}',
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

    CREATE TABLE IF NOT EXISTS _splan_concept_tests (
      test_id INTEGER PRIMARY KEY AUTOINCREMENT,
      concept_id INTEGER NOT NULL REFERENCES _splan_concepts(concept_id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS _splan_module_tests (
      test_id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL REFERENCES _splan_modules(module_id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS _splan_concepts (
      concept_id INTEGER PRIMARY KEY AUTOINCREMENT,
      concept_name TEXT NOT NULL,
      description TEXT,
      concept_type TEXT NOT NULL DEFAULT 'Idea',
      status TEXT NOT NULL DEFAULT 'draft',
      tags TEXT NOT NULL DEFAULT '[]',
      features TEXT NOT NULL DEFAULT '[]',
      modules TEXT NOT NULL DEFAULT '[]',
      data_tables TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      notes_fmt TEXT NOT NULL DEFAULT '[]',
      collapsed_sections TEXT NOT NULL DEFAULT '{}',
      embedded_tables TEXT NOT NULL DEFAULT '{}',
      images TEXT NOT NULL DEFAULT '[]',
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

    CREATE TABLE IF NOT EXISTS _splan_feedback (
      feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      systems TEXT NOT NULL DEFAULT '[]',
      related_concept_id INTEGER REFERENCES _splan_concepts(concept_id) ON DELETE SET NULL,
      notes TEXT,
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

    CREATE TABLE IF NOT EXISTS _splan_projects (
      project_id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name            TEXT    NOT NULL,
      description             TEXT,
      github_repo             TEXT,
      github_pat              TEXT,
      branch_live_name        TEXT NOT NULL DEFAULT 'main',
      branch_primary_name     TEXT NOT NULL DEFAULT 'develop',
      branch_secondary_name   TEXT NOT NULL DEFAULT 'feature',
      last_synced_sha_live    TEXT,
      last_synced_sha_primary TEXT,
      last_synced_sha_secondary TEXT,
      status                  TEXT NOT NULL DEFAULT 'active',
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_code_changes (
      change_id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id             INTEGER NOT NULL REFERENCES _splan_projects(project_id) ON DELETE CASCADE,
      branch                 TEXT    NOT NULL DEFAULT 'primary_dev',
      change_name            TEXT    NOT NULL,
      change_type            TEXT    NOT NULL DEFAULT 'Working Through',
      implementation_prompt  TEXT,
      execution_results      TEXT,
      file_locations         TEXT,
      dependencies           TEXT    NOT NULL DEFAULT '[]',
      failed_tests           TEXT    NOT NULL DEFAULT '[]',
      failure_explanations   TEXT,
      implementation_group   INTEGER,
      github_commit_hash     TEXT,
      github_commit_url      TEXT,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_column_defs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type      TEXT NOT NULL,
      column_key       TEXT NOT NULL,
      label            TEXT NOT NULL,
      column_type      TEXT NOT NULL DEFAULT 'text',
      options          TEXT NOT NULL DEFAULT '[]',
      formula          TEXT NOT NULL DEFAULT '',
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(entity_type, column_key)
    );

    CREATE TABLE IF NOT EXISTS _splan_test_staleness_dismissals (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type      TEXT NOT NULL,
      entity_id        INTEGER NOT NULL,
      change_log_id    INTEGER NOT NULL,
      test_id          INTEGER NOT NULL,
      dismissed_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(change_log_id, test_id)
    );

    CREATE TABLE IF NOT EXISTS _splan_display_templates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      template_name   TEXT NOT NULL UNIQUE,
      display_mode    TEXT NOT NULL DEFAULT 'text',
      font_size       INTEGER,
      font_bold       INTEGER NOT NULL DEFAULT 0,
      font_underline  INTEGER NOT NULL DEFAULT 0,
      font_color      TEXT,
      alignment       TEXT NOT NULL DEFAULT 'left',
      wrap            INTEGER NOT NULL DEFAULT 0,
      lines           INTEGER NOT NULL DEFAULT 1,
      color_mapping   TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_column_template_assignments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type     TEXT NOT NULL,
      column_key      TEXT NOT NULL,
      template_id     INTEGER NOT NULL REFERENCES _splan_display_templates(id) ON DELETE CASCADE,
      UNIQUE(entity_type, column_key)
    );

    CREATE TABLE IF NOT EXISTS _splan_notebook (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      title           TEXT NOT NULL DEFAULT 'Untitled',
      content_html    TEXT NOT NULL DEFAULT '',
      pinned          INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _splan_sync_meta (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_direction  TEXT NOT NULL,
      remote_url      TEXT NOT NULL,
      synced_at       TEXT NOT NULL DEFAULT (datetime('now')),
      rows_synced     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS _splan_entity_notes (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type         TEXT NOT NULL,
      entity_id           INTEGER NOT NULL,
      note_key            TEXT NOT NULL DEFAULT 'notes',
      content             TEXT,
      notes_fmt           TEXT NOT NULL DEFAULT '[]',
      collapsed_sections  TEXT NOT NULL DEFAULT '{}',
      embedded_tables     TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(entity_type, entity_id, note_key)
    );
  `);

  // Migrations: add columns to existing tables (safe to re-run — ignores if column exists)
  const migrate = (table: string, col: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* column already exists */ }
  };
  migrate('_splan_concepts', 'notes_fmt', "TEXT NOT NULL DEFAULT '[]'");
  migrate('_splan_concepts', 'collapsed_sections', "TEXT NOT NULL DEFAULT '{}'");
  migrate('_splan_concepts', 'embedded_tables', "TEXT NOT NULL DEFAULT '{}'");
  migrate('_splan_concepts', 'images', "TEXT NOT NULL DEFAULT '[]'");
  migrate('_splan_modules', 'images', "TEXT NOT NULL DEFAULT '[]'");
  migrate('_splan_features', 'tests_dismissed_at', "TEXT");
  migrate('_splan_concepts', 'tests_dismissed_at', "TEXT");
  migrate('_splan_modules', 'tests_dismissed_at', "TEXT");
  migrate('_splan_code_changes', 'linked_entity_type', "TEXT");
  migrate('_splan_code_changes', 'linked_entity_id', "INTEGER");
  migrate('_splan_code_changes', 'linked_tables', "TEXT NOT NULL DEFAULT '[]'");
  migrate('_splan_code_changes', 'linked_fields', "TEXT NOT NULL DEFAULT '[]'");
  migrate('_splan_column_defs', 'formula', "TEXT NOT NULL DEFAULT ''");

  // ─── F2: Extend _splan_sync_meta to record attempts (success + failure) ───
  migrate('_splan_sync_meta', 'success', "INTEGER NOT NULL DEFAULT 1");
  migrate('_splan_sync_meta', 'error_message', "TEXT");
  migrate('_splan_sync_meta', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  migrate('_splan_sync_meta', 'attempt_id', "TEXT");
  // Backfill attempt_id for any pre-F2 rows
  try {
    db.exec("UPDATE _splan_sync_meta SET attempt_id = 'legacy-' || id WHERE attempt_id IS NULL");
  } catch { /* table missing or already filled */ }

  // ─── Backfill _splan_entity_notes from existing concept notes (idempotent) ───
  // Source columns on _splan_concepts stay populated as a safety net.
  try {
    const concepts = db.prepare(
      "SELECT concept_id, notes, notes_fmt, collapsed_sections, embedded_tables FROM _splan_concepts WHERE notes IS NOT NULL AND notes != ''"
    ).all() as Array<{ concept_id: number; notes: string; notes_fmt: string; collapsed_sections: string; embedded_tables: string }>;
    const insertNote = db.prepare(
      "INSERT OR IGNORE INTO _splan_entity_notes (entity_type, entity_id, note_key, content, notes_fmt, collapsed_sections, embedded_tables) VALUES ('concept', ?, 'notes', ?, ?, ?, ?)"
    );
    const txn = db.transaction((rows: typeof concepts) => {
      for (const r of rows) {
        insertNote.run(
          r.concept_id,
          r.notes,
          r.notes_fmt || '[]',
          r.collapsed_sections || '{}',
          r.embedded_tables || '{}'
        );
      }
    });
    txn(concepts);
  } catch { /* concepts table may not exist on first run */ }

  // ─── Apply user-defined columns from _splan_column_defs ───
  const ENTITY_SQL_TABLE: Record<string, string> = {
    modules: '_splan_modules', features: '_splan_features', concepts: '_splan_concepts',
    data_tables: '_splan_data_tables', data_fields: '_splan_data_fields',
    projects: '_splan_projects', research: '_splan_research', prototypes: '_splan_prototypes',
  };
  try {
    const colDefs = db.prepare('SELECT * FROM _splan_column_defs').all() as Array<Record<string, unknown>>;
    for (const def of colDefs) {
      const sqlTable = ENTITY_SQL_TABLE[def.entity_type as string];
      if (!sqlTable) continue;
      const colType = def.column_type as string;
      // Formula columns are virtual (computed client-side) — no real DB column
      if (colType === 'formula') continue;
      const sqlType = colType === 'int' ? 'INTEGER' : colType === 'boolean' ? "INTEGER NOT NULL DEFAULT 0" : colType === 'tags' || colType === 'enum' ? "TEXT NOT NULL DEFAULT ''" : "TEXT NOT NULL DEFAULT ''";
      migrate(sqlTable, def.column_key as string, sqlType);
    }
  } catch { /* _splan_column_defs may not exist yet on first run */ }

  // ─── Migrate grouping presets → view presets ───
  // If old table has data and new table is empty, migrate then drop
  try {
    const oldCount = (db.prepare("SELECT COUNT(*) as cnt FROM _splan_grouping_presets").get() as { cnt: number }).cnt;
    const newCount = (db.prepare("SELECT COUNT(*) as cnt FROM _splan_view_presets").get() as { cnt: number }).cnt;
    if (oldCount > 0 && newCount === 0) {
      const oldRows = db.prepare("SELECT * FROM _splan_grouping_presets").all() as Array<Record<string, unknown>>;
      const insertStmt = db.prepare(
        "INSERT INTO _splan_view_presets (tab_key, preset_name, view_config, is_active, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      for (const row of oldRows) {
        const viewConfig = JSON.stringify({ groupingConfig: typeof row.config === 'string' ? JSON.parse(row.config as string) : row.config });
        insertStmt.run(row.tab_key, row.preset_name, viewConfig, row.is_active, row.order_index, row.created_at, row.updated_at);
      }
      console.log(`Migrated ${oldRows.length} grouping presets to view presets`);
    }
    // Drop old table if new table has data (migration complete)
    const finalNewCount = (db.prepare("SELECT COUNT(*) as cnt FROM _splan_view_presets").get() as { cnt: number }).cnt;
    if (finalNewCount > 0) {
      db.exec("DROP TABLE IF EXISTS _splan_grouping_presets");
    }
  } catch { /* old table may already be gone */ }

  // Seed default view preset for concepts (group by Type) if none exists
  try {
    const conceptPresetCount = (db.prepare(
      "SELECT COUNT(*) as cnt FROM _splan_view_presets WHERE tab_key = 'concepts'"
    ).get() as { cnt: number }).cnt;
    if (conceptPresetCount === 0) {
      const viewConfig = JSON.stringify({
        groupingConfig: {
          layers: [{
            rules: [
              { groupName: "Idea", logic: "AND", conditions: [{ column: "conceptType", operator: "equals", value: "Idea" }] },
              { groupName: "Principle", logic: "AND", conditions: [{ column: "conceptType", operator: "equals", value: "Principle" }] },
              { groupName: "Dev Term", logic: "AND", conditions: [{ column: "conceptType", operator: "equals", value: "Dev Term" }] },
            ],
            ungroupedLabel: "Uncategorized",
          }],
          ungroupedLabel: "Uncategorized",
        },
      });
      db.prepare(
        "INSERT INTO _splan_view_presets (tab_key, preset_name, view_config, is_active, order_index) VALUES (?, ?, ?, 1, 0)"
      ).run("concepts", "By Type", viewConfig);
    }
  } catch { /* ignore */ }

  // Seed default view preset for all_test_cases (group by Entity Type) if none exists
  try {
    const testPresetCount = (db.prepare(
      "SELECT COUNT(*) as cnt FROM _splan_view_presets WHERE tab_key = 'all_test_cases'"
    ).get() as { cnt: number }).cnt;
    if (testPresetCount === 0) {
      const viewConfig = JSON.stringify({
        groupingConfig: {
          layers: [{
            rules: [
              { groupName: "Feature Tests", logic: "AND", conditions: [{ column: "entityType", operator: "equals", value: "feature" }] },
              { groupName: "Concept Tests", logic: "AND", conditions: [{ column: "entityType", operator: "equals", value: "concept" }] },
              { groupName: "Module Tests", logic: "AND", conditions: [{ column: "entityType", operator: "equals", value: "module" }] },
            ],
            ungroupedLabel: "Other",
          }],
          ungroupedLabel: "Other",
        },
      });
      db.prepare(
        "INSERT INTO _splan_view_presets (tab_key, preset_name, view_config, is_active, order_index) VALUES (?, ?, ?, 1, 0)"
      ).run("all_test_cases", "By Entity Type", viewConfig);
    }
  } catch { /* ignore */ }
}
