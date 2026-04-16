import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, cleanupTestDb, TEST_DB_PATH } from './setup.js';

let db: Database.Database;

beforeAll(() => {
  cleanupTestDb();
  db = createTestDb();
});

afterAll(() => {
  db.close();
  cleanupTestDb();
});

// ─── Table existence ──────────────────────────────────────────────────────────

describe('Schema: all 13 tables exist', () => {
  const expectedTables = [
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
    '_splan_discussions',
  ];

  for (const tableName of expectedTables) {
    it(`table ${tableName} exists`, () => {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(tableName);
      expect(row).toBeTruthy();
    });
  }
});

// ─── Column definitions ───────────────────────────────────────────────────────

describe('Schema: _splan_modules column definitions', () => {
  it('has module_id as primary key', () => {
    const cols = db.prepare('PRAGMA table_info(_splan_modules)').all() as Array<{ name: string; pk: number; type: string }>;
    const pk = cols.find(c => c.name === 'module_id');
    expect(pk).toBeTruthy();
    expect(pk!.pk).toBe(1);
  });

  it('has module_name as NOT NULL TEXT', () => {
    const cols = db.prepare('PRAGMA table_info(_splan_modules)').all() as Array<{ name: string; notnull: number; type: string }>;
    const col = cols.find(c => c.name === 'module_name');
    expect(col).toBeTruthy();
    expect(col!.notnull).toBe(1);
    expect(col!.type).toBe('TEXT');
  });

  it('has platforms with default [\"Web App\"]', () => {
    const cols = db.prepare('PRAGMA table_info(_splan_modules)').all() as Array<{ name: string; dflt_value: string | null }>;
    const col = cols.find(c => c.name === 'platforms');
    expect(col).toBeTruthy();
    expect(col!.dflt_value).toBe("'[\"Web App\"]'");
  });

  it('has is_system_created with default 0', () => {
    const cols = db.prepare('PRAGMA table_info(_splan_modules)').all() as Array<{ name: string; dflt_value: string | null }>;
    const col = cols.find(c => c.name === 'is_system_created');
    expect(col!.dflt_value).toBe('0');
  });
});

describe('Schema: _splan_data_fields references _splan_data_tables', () => {
  it('data_table_id column exists', () => {
    const cols = db.prepare('PRAGMA table_info(_splan_data_fields)').all() as Array<{ name: string }>;
    expect(cols.some(c => c.name === 'data_table_id')).toBe(true);
  });

  it('foreign key to _splan_data_tables is declared', () => {
    const fks = db.prepare('PRAGMA foreign_key_list(_splan_data_fields)').all() as Array<{ table: string; from: string }>;
    const fk = fks.find(f => f.table === '_splan_data_tables' && f.from === 'data_table_id');
    expect(fk).toBeTruthy();
  });
});

// ─── Foreign key enforcement ──────────────────────────────────────────────────

describe('Foreign key constraints', () => {
  it('rejects inserting a field with non-existent data_table_id', () => {
    expect(() => {
      db.prepare(
        'INSERT INTO _splan_data_fields (field_name, data_table_id) VALUES (?, ?)'
      ).run('bad_field', 99999);
    }).toThrow();
  });

  it('allows inserting a field when the parent table exists', () => {
    const tableInfo = db.prepare(
      "INSERT INTO _splan_data_tables (table_name) VALUES (?)"
    ).run('parent_table');
    const tableId = tableInfo.lastInsertRowid;

    const fieldInfo = db.prepare(
      'INSERT INTO _splan_data_fields (field_name, data_table_id) VALUES (?, ?)'
    ).run('valid_field', tableId);
    expect(Number(fieldInfo.lastInsertRowid)).toBeGreaterThan(0);
  });
});

// ─── JSON column round-trip ───────────────────────────────────────────────────

describe('JSON column storage and retrieval', () => {
  it('stores and retrieves platforms array as JSON string', () => {
    const platforms = ['Web App', 'Mobile', 'Desktop'];
    const info = db.prepare(
      'INSERT INTO _splan_modules (module_name, platforms) VALUES (?, ?)'
    ).run('JSON Test Module', JSON.stringify(platforms));

    const row = db.prepare('SELECT platforms FROM _splan_modules WHERE module_id = ?').get(info.lastInsertRowid) as { platforms: string };
    const parsed = JSON.parse(row.platforms);
    expect(parsed).toEqual(platforms);
  });

  it('stores and retrieves tags array', () => {
    const tags = ['auth', 'billing', 'reporting'];
    const info = db.prepare(
      'INSERT INTO _splan_modules (module_name, tags) VALUES (?, ?)'
    ).run('Tags Test', JSON.stringify(tags));

    const row = db.prepare('SELECT tags FROM _splan_modules WHERE module_id = ?').get(info.lastInsertRowid) as { tags: string };
    expect(JSON.parse(row.tags)).toEqual(tags);
  });

  it('stores and retrieves collapsed_sections object', () => {
    const cs = { notes: true, implementation: false };
    const info = db.prepare(
      "INSERT INTO _splan_features (feature_name, collapsed_sections) VALUES (?, ?)"
    ).run('Section Test', JSON.stringify(cs));

    const row = db.prepare('SELECT collapsed_sections FROM _splan_features WHERE feature_id = ?').get(info.lastInsertRowid) as { collapsed_sections: string };
    expect(JSON.parse(row.collapsed_sections)).toEqual(cs);
  });
});

// ─── Boolean integer conversion ───────────────────────────────────────────────

describe('Boolean INTEGER ↔ boolean conversion', () => {
  it('stores is_system_created as 0 or 1', () => {
    const info = db.prepare(
      'INSERT INTO _splan_modules (module_name, is_system_created) VALUES (?, ?)'
    ).run('Bool Test', 1);

    const row = db.prepare('SELECT is_system_created FROM _splan_modules WHERE module_id = ?').get(info.lastInsertRowid) as { is_system_created: number };
    expect(row.is_system_created).toBe(1);
  });

  it('defaults is_system_created to 0 when not provided', () => {
    const info = db.prepare('INSERT INTO _splan_modules (module_name) VALUES (?)').run('Default Bool');
    const row = db.prepare('SELECT is_system_created FROM _splan_modules WHERE module_id = ?').get(info.lastInsertRowid) as { is_system_created: number };
    expect(row.is_system_created).toBe(0);
  });

  it('stores is_required for data fields correctly', () => {
    const tableInfo = db.prepare("INSERT INTO _splan_data_tables (table_name) VALUES (?)").run('req_table');
    const fieldInfo = db.prepare(
      'INSERT INTO _splan_data_fields (field_name, data_table_id, is_required) VALUES (?, ?, ?)'
    ).run('req_field', tableInfo.lastInsertRowid, 1);

    const row = db.prepare('SELECT is_required FROM _splan_data_fields WHERE field_id = ?').get(fieldInfo.lastInsertRowid) as { is_required: number };
    expect(row.is_required).toBe(1);
  });
});

// ─── Default values ───────────────────────────────────────────────────────────

describe('Default values', () => {
  it('module platforms defaults to ["Web App"]', () => {
    const info = db.prepare('INSERT INTO _splan_modules (module_name) VALUES (?)').run('Default Platforms Test');
    const row = db.prepare('SELECT platforms FROM _splan_modules WHERE module_id = ?').get(info.lastInsertRowid) as { platforms: string };
    expect(JSON.parse(row.platforms)).toEqual(['Web App']);
  });

  it('module tags defaults to []', () => {
    const info = db.prepare('INSERT INTO _splan_modules (module_name) VALUES (?)').run('Default Tags Test');
    const row = db.prepare('SELECT tags FROM _splan_modules WHERE module_id = ?').get(info.lastInsertRowid) as { tags: string };
    expect(JSON.parse(row.tags)).toEqual([]);
  });

  it('feature status defaults to Idea', () => {
    const info = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Status Default Test');
    const row = db.prepare('SELECT status FROM _splan_features WHERE feature_id = ?').get(info.lastInsertRowid) as { status: string };
    expect(row.status).toBe('Idea');
  });

  it('feature priority defaults to Medium', () => {
    const info = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Priority Default Test');
    const row = db.prepare('SELECT priority FROM _splan_features WHERE feature_id = ?').get(info.lastInsertRowid) as { priority: string };
    expect(row.priority).toBe('Medium');
  });

  it('data_access_rules access_level defaults to none', () => {
    const tableInfo = db.prepare("INSERT INTO _splan_data_tables (table_name) VALUES (?)").run('rule_table');
    const ruleInfo = db.prepare(
      "INSERT INTO _splan_data_access_rules (table_id) VALUES (?)"
    ).run(tableInfo.lastInsertRowid);
    const row = db.prepare('SELECT access_level FROM _splan_data_access_rules WHERE rule_id = ?').get(ruleInfo.lastInsertRowid) as { access_level: string };
    expect(row.access_level).toBe('none');
  });

  it('discussion source defaults to claude_code', () => {
    const info = db.prepare(
      "INSERT INTO _splan_discussions (entity_type, entity_id, title, content) VALUES (?, ?, ?, ?)"
    ).run('module', 1, 'Test', 'Content');
    const row = db.prepare('SELECT source FROM _splan_discussions WHERE discussion_id = ?').get(info.lastInsertRowid) as { source: string };
    expect(row.source).toBe('claude_code');
  });
});

// ─── CASCADE deletes ──────────────────────────────────────────────────────────

describe('CASCADE deletes', () => {
  it('deleting a data_table cascades to its fields', () => {
    const tableInfo = db.prepare("INSERT INTO _splan_data_tables (table_name) VALUES (?)").run('cascade_table');
    const tableId = Number(tableInfo.lastInsertRowid);

    db.prepare('INSERT INTO _splan_data_fields (field_name, data_table_id) VALUES (?, ?)').run('field_1', tableId);
    db.prepare('INSERT INTO _splan_data_fields (field_name, data_table_id) VALUES (?, ?)').run('field_2', tableId);

    const before = db.prepare('SELECT COUNT(*) as cnt FROM _splan_data_fields WHERE data_table_id = ?').get(tableId) as { cnt: number };
    expect(before.cnt).toBe(2);

    db.prepare('DELETE FROM _splan_data_tables WHERE table_id = ?').run(tableId);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM _splan_data_fields WHERE data_table_id = ?').get(tableId) as { cnt: number };
    expect(after.cnt).toBe(0);
  });

  it('deleting a feature cascades to its concerns', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('cascade_feature');
    const featureId = Number(featInfo.lastInsertRowid);

    db.prepare("INSERT INTO _splan_feature_concerns (feature_id, concern_text) VALUES (?, ?)").run(featureId, 'concern 1');
    db.prepare("INSERT INTO _splan_feature_concerns (feature_id, concern_text) VALUES (?, ?)").run(featureId, 'concern 2');

    db.prepare('DELETE FROM _splan_features WHERE feature_id = ?').run(featureId);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM _splan_feature_concerns WHERE feature_id = ?').get(featureId) as { cnt: number };
    expect(after.cnt).toBe(0);
  });

  it('deleting a data_table cascades to its access rules', () => {
    const tableInfo = db.prepare("INSERT INTO _splan_data_tables (table_name) VALUES (?)").run('rule_cascade_table');
    const tableId = Number(tableInfo.lastInsertRowid);

    db.prepare("INSERT INTO _splan_data_access_rules (table_id, access_level) VALUES (?, ?)").run(tableId, 'read');

    db.prepare('DELETE FROM _splan_data_tables WHERE table_id = ?').run(tableId);

    const after = db.prepare('SELECT COUNT(*) as cnt FROM _splan_data_access_rules WHERE table_id = ?').get(tableId) as { cnt: number };
    expect(after.cnt).toBe(0);
  });

  it('deleting a feature cascades to its implementation steps', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('cascade_steps_feature');
    const featureId = Number(featInfo.lastInsertRowid);

    db.prepare("INSERT INTO _splan_implementation_steps (feature_id, title) VALUES (?, ?)").run(featureId, 'Step 1');
    db.prepare("INSERT INTO _splan_implementation_steps (feature_id, title) VALUES (?, ?)").run(featureId, 'Step 2');
    db.prepare("INSERT INTO _splan_implementation_steps (feature_id, title) VALUES (?, ?)").run(featureId, 'Step 3');

    const before = (db.prepare('SELECT COUNT(*) as cnt FROM _splan_implementation_steps WHERE feature_id = ?').get(featureId) as { cnt: number }).cnt;
    expect(before).toBe(3);

    db.prepare('DELETE FROM _splan_features WHERE feature_id = ?').run(featureId);

    const after = (db.prepare('SELECT COUNT(*) as cnt FROM _splan_implementation_steps WHERE feature_id = ?').get(featureId) as { cnt: number }).cnt;
    expect(after).toBe(0);
  });
});

// ─── Implementation Steps schema ─────────────────────────────────────────────

describe('Schema: _splan_implementation_steps', () => {
  it('table exists', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_splan_implementation_steps'").get();
    expect(row).toBeTruthy();
  });

  it('has step_id as primary key', () => {
    const cols = db.prepare('PRAGMA table_info(_splan_implementation_steps)').all() as Array<{ name: string; pk: number }>;
    const pk = cols.find(c => c.name === 'step_id');
    expect(pk).toBeTruthy();
    expect(pk!.pk).toBe(1);
  });

  it('has FK to _splan_features', () => {
    const fks = db.prepare('PRAGMA foreign_key_list(_splan_implementation_steps)').all() as Array<{ table: string; from: string }>;
    const fk = fks.find(f => f.table === '_splan_features' && f.from === 'feature_id');
    expect(fk).toBeTruthy();
  });

  it('step_type defaults to implementation', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Default Step Type Test');
    const stepInfo = db.prepare("INSERT INTO _splan_implementation_steps (feature_id, title) VALUES (?, ?)").run(featInfo.lastInsertRowid, 'Test step');
    const row = db.prepare('SELECT step_type FROM _splan_implementation_steps WHERE step_id = ?').get(stepInfo.lastInsertRowid) as { step_type: string };
    expect(row.step_type).toBe('implementation');
  });

  it('status defaults to pending', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Default Status Test');
    const stepInfo = db.prepare("INSERT INTO _splan_implementation_steps (feature_id, title) VALUES (?, ?)").run(featInfo.lastInsertRowid, 'Test step');
    const row = db.prepare('SELECT status FROM _splan_implementation_steps WHERE step_id = ?').get(stepInfo.lastInsertRowid) as { status: string };
    expect(row.status).toBe('pending');
  });

  it('rejects step with non-existent feature_id', () => {
    expect(() => {
      db.prepare("INSERT INTO _splan_implementation_steps (feature_id, title) VALUES (?, ?)").run(999999, 'Orphan');
    }).toThrow();
  });
});

// ─── Feature Tests schema ────────────────────────────────────────────────────

describe('Schema: _splan_feature_tests', () => {
  it('table exists', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_splan_feature_tests'").get();
    expect(row).toBeTruthy();
  });

  it('has test_id as primary key', () => {
    const cols = db.prepare('PRAGMA table_info(_splan_feature_tests)').all() as Array<{ name: string; pk: number }>;
    const pk = cols.find(c => c.name === 'test_id');
    expect(pk).toBeTruthy();
    expect(pk!.pk).toBe(1);
  });

  it('has FK to _splan_features', () => {
    const fks = db.prepare('PRAGMA foreign_key_list(_splan_feature_tests)').all() as Array<{ table: string; from: string }>;
    const fk = fks.find(f => f.table === '_splan_features' && f.from === 'feature_id');
    expect(fk).toBeTruthy();
  });

  it('test_type defaults to acceptance', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Test Type Default');
    const testInfo = db.prepare("INSERT INTO _splan_feature_tests (feature_id, title) VALUES (?, ?)").run(featInfo.lastInsertRowid, 'Test case');
    const row = db.prepare('SELECT test_type FROM _splan_feature_tests WHERE test_id = ?').get(testInfo.lastInsertRowid) as { test_type: string };
    expect(row.test_type).toBe('acceptance');
  });

  it('status defaults to draft', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Test Status Default');
    const testInfo = db.prepare("INSERT INTO _splan_feature_tests (feature_id, title) VALUES (?, ?)").run(featInfo.lastInsertRowid, 'Test case');
    const row = db.prepare('SELECT status FROM _splan_feature_tests WHERE test_id = ?').get(testInfo.lastInsertRowid) as { status: string };
    expect(row.status).toBe('draft');
  });

  it('dependencies defaults to empty JSON array', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Deps Default');
    const testInfo = db.prepare("INSERT INTO _splan_feature_tests (feature_id, title) VALUES (?, ?)").run(featInfo.lastInsertRowid, 'Test');
    const row = db.prepare('SELECT dependencies FROM _splan_feature_tests WHERE test_id = ?').get(testInfo.lastInsertRowid) as { dependencies: string };
    expect(JSON.parse(row.dependencies)).toEqual([]);
  });

  it('stores dependencies JSON roundtrip', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Deps Roundtrip');
    const deps = [1, 2, 3];
    const testInfo = db.prepare("INSERT INTO _splan_feature_tests (feature_id, title, dependencies) VALUES (?, ?, ?)").run(featInfo.lastInsertRowid, 'Cross test', JSON.stringify(deps));
    const row = db.prepare('SELECT dependencies FROM _splan_feature_tests WHERE test_id = ?').get(testInfo.lastInsertRowid) as { dependencies: string };
    expect(JSON.parse(row.dependencies)).toEqual(deps);
  });

  it('cascade deletes tests when feature deleted', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Cascade Tests Feature');
    const fid = Number(featInfo.lastInsertRowid);
    db.prepare("INSERT INTO _splan_feature_tests (feature_id, title) VALUES (?, ?)").run(fid, 'T1');
    db.prepare("INSERT INTO _splan_feature_tests (feature_id, title) VALUES (?, ?)").run(fid, 'T2');
    db.prepare('DELETE FROM _splan_features WHERE feature_id = ?').run(fid);
    const after = (db.prepare('SELECT COUNT(*) as cnt FROM _splan_feature_tests WHERE feature_id = ?').get(fid) as { cnt: number }).cnt;
    expect(after).toBe(0);
  });

  it('rejects test with non-existent feature_id', () => {
    expect(() => {
      db.prepare("INSERT INTO _splan_feature_tests (feature_id, title) VALUES (?, ?)").run(999999, 'Orphan');
    }).toThrow();
  });
});

// ─── Prototypes schema ───────────────────────────────────────────────────────

describe('Schema: _splan_prototypes', () => {
  it('table exists', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_splan_prototypes'").get();
    expect(row).toBeTruthy();
  });

  it('has prototype_id as primary key', () => {
    const cols = db.prepare('PRAGMA table_info(_splan_prototypes)').all() as Array<{ name: string; pk: number }>;
    const pk = cols.find(c => c.name === 'prototype_id');
    expect(pk).toBeTruthy();
    expect(pk!.pk).toBe(1);
  });

  it('prototype_type defaults to component', () => {
    const info = db.prepare("INSERT INTO _splan_prototypes (title) VALUES (?)").run('Default Type');
    const row = db.prepare('SELECT prototype_type FROM _splan_prototypes WHERE prototype_id = ?').get(info.lastInsertRowid) as { prototype_type: string };
    expect(row.prototype_type).toBe('component');
  });

  it('status defaults to idea', () => {
    const info = db.prepare("INSERT INTO _splan_prototypes (title) VALUES (?)").run('Default Status');
    const row = db.prepare('SELECT status FROM _splan_prototypes WHERE prototype_id = ?').get(info.lastInsertRowid) as { status: string };
    expect(row.status).toBe('idea');
  });

  it('features defaults to empty JSON array', () => {
    const info = db.prepare("INSERT INTO _splan_prototypes (title) VALUES (?)").run('Default Features');
    const row = db.prepare('SELECT features FROM _splan_prototypes WHERE prototype_id = ?').get(info.lastInsertRowid) as { features: string };
    expect(JSON.parse(row.features)).toEqual([]);
  });

  it('stores features and tests JSON roundtrip', () => {
    const features = [1, 2];
    const tests = [10, 20, 30];
    const info = db.prepare("INSERT INTO _splan_prototypes (title, features, tests) VALUES (?, ?, ?)").run('JSON Proto', JSON.stringify(features), JSON.stringify(tests));
    const row = db.prepare('SELECT features, tests FROM _splan_prototypes WHERE prototype_id = ?').get(info.lastInsertRowid) as { features: string; tests: string };
    expect(JSON.parse(row.features)).toEqual(features);
    expect(JSON.parse(row.tests)).toEqual(tests);
  });

  it('has no FK to features (prototypes survive feature deletion)', () => {
    const fks = db.prepare('PRAGMA foreign_key_list(_splan_prototypes)').all() as Array<{ table: string }>;
    const featureFk = fks.find(f => f.table === '_splan_features');
    expect(featureFk).toBeUndefined();
  });
});
