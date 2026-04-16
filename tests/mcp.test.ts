/**
 * MCP tool tests — exercises the MCP tool logic directly (no stdio transport),
 * using a separate test database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_TEST_DB = path.join(__dirname, '..', 'schema-planner-mcp-test.db');

// ─── Import server utilities ──────────────────────────────────────────────────

import { parseRow, prepareRow } from '../server/utils.js';
import { initSchema, cleanupTestDb } from './setup.js';

// ─── Inline MCP tool implementations (same logic as mcp-server/index.ts) ─────
// We test the logic directly rather than going through the stdio transport.

let db: Database.Database;

function getDb() { return db; }

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const JSON_COLUMNS_MCP = new Set([
  'platforms', 'tags', 'modules', 'data_tables', 'data_fields', 'images',
  'notes_fmt', 'native_notes_fmt', 'android_notes_fmt', 'apple_notes_fmt',
  'other_notes_fmt', 'impl_fmt', 'collapsed_sections', 'embedded_tables',
  'feature_tags', 'checklist', 'conditions', 'config',
]);

const BOOL_COLUMNS_MCP = new Set(['is_system_created', 'is_required', 'is_unique', 'is_foreign_key', 'is_active']);

function parseRowMcp(row: Record<string, unknown>): Record<string, unknown> {
  const camel: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    camel[toCamel(key)] = val;
  }
  for (const [key, val] of Object.entries(camel)) {
    const snakeKey = key.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
    if (JSON_COLUMNS_MCP.has(snakeKey) && typeof val === 'string') {
      try { camel[key] = JSON.parse(val); } catch { /* keep */ }
    }
    if (BOOL_COLUMNS_MCP.has(snakeKey) && (val === 0 || val === 1)) {
      camel[key] = val === 1;
    }
  }
  return camel;
}

const TABLE_MAP_MCP: Record<string, { sqlTable: string; idCol: string; entityType: string; searchCols: string[] }> = {
  module:     { sqlTable: '_splan_modules',            idCol: 'module_id',    entityType: 'module',      searchCols: ['module_name', 'module_description', 'module_purpose'] },
  feature:    { sqlTable: '_splan_features',           idCol: 'feature_id',   entityType: 'feature',     searchCols: ['feature_name', 'description', 'notes'] },
  table:      { sqlTable: '_splan_data_tables',        idCol: 'table_id',     entityType: 'table',       searchCols: ['table_name', 'description_purpose'] },
  field:      { sqlTable: '_splan_data_fields',        idCol: 'field_id',     entityType: 'field',       searchCols: ['field_name', 'name_reasoning'] },
  concern:    { sqlTable: '_splan_feature_concerns',   idCol: 'concern_id',   entityType: 'concern',     searchCols: ['concern_text', 'mitigation_text'] },
  rule:       { sqlTable: '_splan_data_access_rules',  idCol: 'rule_id',      entityType: 'access_rule', searchCols: ['scope_notes', 'ownership_notes', 'role', 'user_type'] },
  discussion: { sqlTable: '_splan_discussions',        idCol: 'discussion_id',entityType: 'discussion',  searchCols: ['title', 'content'] },
};

function logChangeMcp(params: { entityType: string; entityId: number; action: string; fieldChanged?: string; oldValue?: unknown; newValue?: unknown; reasoning?: string }) {
  getDb().prepare(`INSERT INTO _splan_change_log (entity_type, entity_id, action, field_changed, old_value, new_value, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(params.entityType, params.entityId, params.action, params.fieldChanged ?? null,
      params.oldValue !== undefined ? String(params.oldValue) : null,
      params.newValue !== undefined ? String(params.newValue) : null,
      params.reasoning ?? null);
}

// ─── Tool implementations ─────────────────────────────────────────────────────

function mcpSearch(query: string, entityType?: string): Record<string, unknown[]> {
  const term = `%${query}%`;
  const typesToSearch = entityType ? [entityType] : Object.keys(TABLE_MAP_MCP);
  const results: Record<string, unknown[]> = {};
  for (const type of typesToSearch) {
    const meta = TABLE_MAP_MCP[type];
    const whereClauses = meta.searchCols.map(col => `${col} LIKE ?`).join(' OR ');
    const rows = getDb().prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${whereClauses}`)
      .all(...meta.searchCols.map(() => term)) as Record<string, unknown>[];
    if (rows.length > 0) results[type] = rows.map(parseRowMcp);
  }
  return results;
}

function mcpGet(entityType: string, id: number): Record<string, unknown> | null {
  const meta = TABLE_MAP_MCP[entityType];
  const row = getDb().prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const entity = parseRowMcp(row);
  if (entityType === 'feature') {
    const concerns = (getDb().prepare('SELECT * FROM _splan_feature_concerns WHERE feature_id = ?').all(id) as Record<string, unknown>[]).map(parseRowMcp);
    const discussions = (getDb().prepare("SELECT * FROM _splan_discussions WHERE entity_type = 'feature' AND entity_id = ?").all(id) as Record<string, unknown>[]).map(parseRowMcp);
    const tableIds: number[] = Array.isArray(entity.dataTables) ? (entity.dataTables as number[]) : [];
    const linkedTables = tableIds.length > 0
      ? (getDb().prepare(`SELECT * FROM _splan_data_tables WHERE table_id IN (${tableIds.map(() => '?').join(',')})`).all(...tableIds) as Record<string, unknown>[]).map(parseRowMcp)
      : [];
    return { ...entity, concerns, discussions, linkedTables };
  }
  return entity;
}

function mcpList(entityType: string, limit = 50, offset = 0) {
  const meta = TABLE_MAP_MCP[entityType];
  const rows = (getDb().prepare(`SELECT * FROM ${meta.sqlTable} LIMIT ? OFFSET ?`).all(limit, offset) as Record<string, unknown>[]).map(parseRowMcp);
  const total = (getDb().prepare(`SELECT COUNT(*) as cnt FROM ${meta.sqlTable}`).get() as { cnt: number }).cnt;
  return { total, offset, limit, rows };
}

function mcpCreate(entityType: string, data: Record<string, unknown>) {
  const meta = TABLE_MAP_MCP[entityType];
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'createdAt' || k === 'updatedAt' || k === 'created_at' || k === 'updated_at') continue;
    if (v === null || v === undefined) continue;
    cleaned[k] = v;
  }
  const snakeData = prepareRow(cleaned);
  const cols = Object.keys(snakeData);
  const info = getDb().prepare(`INSERT INTO ${meta.sqlTable} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(snakeData));
  const newId = info.lastInsertRowid as number;
  logChangeMcp({ entityType: meta.entityType, entityId: newId, action: 'INSERT', reasoning: 'via MCP schema_create' });
  const created = getDb().prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(newId) as Record<string, unknown>;
  return parseRowMcp(created);
}

function mcpUpdate(entityType: string, id: number, data: Record<string, unknown>) {
  const meta = TABLE_MAP_MCP[entityType];
  const oldRow = getDb().prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown> | undefined;
  if (!oldRow) return null;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === 'createdAt' || k === 'created_at') continue;
    cleaned[k] = v;
  }
  cleaned.updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const snakeData = prepareRow(cleaned);
  delete snakeData[meta.idCol];
  const setClauses = Object.keys(snakeData).map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE ${meta.sqlTable} SET ${setClauses} WHERE ${meta.idCol} = ?`).run(...Object.values(snakeData), id);
  for (const [snakeKey, newVal] of Object.entries(snakeData)) {
    if (snakeKey === 'updated_at') continue;
    const oldVal = oldRow[snakeKey];
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      logChangeMcp({ entityType: meta.entityType, entityId: id, action: 'UPDATE', fieldChanged: snakeKey, oldValue: oldVal, newValue: newVal, reasoning: 'via MCP schema_update' });
    }
  }
  return parseRowMcp(getDb().prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown>);
}

function mcpDiscuss(entityType: string, entityId: number, title: string, content: string) {
  const info = getDb().prepare('INSERT INTO _splan_discussions (entity_type, entity_id, title, content, source) VALUES (?, ?, ?, ?, ?)').run(entityType, entityId, title, content, 'claude_code');
  return parseRowMcp(getDb().prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(info.lastInsertRowid) as Record<string, unknown>);
}

function mcpStats() {
  const allTables = [
    '_splan_modules', '_splan_data_tables', '_splan_data_fields',
    '_splan_features', '_splan_feature_concerns', '_splan_data_access_rules',
    '_splan_feature_data_reviews', '_splan_entity_or_module_rules',
    '_splan_grouping_presets', '_splan_tag_catalog', '_splan_discussions',
    '_splan_change_log', '_splan_module_use_fields',
  ];
  const counts: Record<string, number> = {};
  for (const table of allTables) {
    const row = getDb().prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
    counts[table] = row.cnt;
  }
  return counts;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(() => {
  try { fs.unlinkSync(MCP_TEST_DB); } catch { /* ignore */ }
  try { fs.unlinkSync(MCP_TEST_DB + '-shm'); } catch { /* ignore */ }
  try { fs.unlinkSync(MCP_TEST_DB + '-wal'); } catch { /* ignore */ }
  db = new Database(MCP_TEST_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
});

afterAll(() => {
  db.close();
  try { fs.unlinkSync(MCP_TEST_DB); } catch { /* ignore */ }
  try { fs.unlinkSync(MCP_TEST_DB + '-shm'); } catch { /* ignore */ }
  try { fs.unlinkSync(MCP_TEST_DB + '-wal'); } catch { /* ignore */ }
});

beforeEach(() => {
  db.exec(`
    DELETE FROM _splan_change_log;
    DELETE FROM _splan_discussions;
    DELETE FROM _splan_feature_concerns;
    DELETE FROM _splan_feature_data_reviews;
    DELETE FROM _splan_data_access_rules;
    DELETE FROM _splan_data_fields;
    DELETE FROM _splan_module_use_fields;
    DELETE FROM _splan_features;
    DELETE FROM _splan_data_tables;
    DELETE FROM _splan_modules;
    DELETE FROM _splan_grouping_presets;
    DELETE FROM _splan_tag_catalog;
    DELETE FROM _splan_entity_or_module_rules;
    DELETE FROM _splan_implementation_steps;
    DELETE FROM _splan_feature_tests;
    DELETE FROM _splan_prototypes;
  `);
});

// ─── schema_search ────────────────────────────────────────────────────────────

describe('schema_search', () => {
  it('returns matching modules by name', () => {
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('Authentication');
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('Reporting');
    const results = mcpSearch('Auth');
    expect(results.module).toBeDefined();
    expect(results.module).toHaveLength(1);
    expect((results.module[0] as Record<string, unknown>).moduleName).toBe('Authentication');
  });

  it('returns empty object when no match', () => {
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('Auth');
    const results = mcpSearch('zzz_no_match');
    expect(Object.keys(results)).toHaveLength(0);
  });

  it('limits search to specified entityType', () => {
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('Billing Module');
    db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Billing Feature');
    const results = mcpSearch('Billing', 'module');
    expect(results.module).toBeDefined();
    expect(results.feature).toBeUndefined();
  });

  it('searches across all types when entityType not provided', () => {
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('Universal Test');
    db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Universal Feature');
    const results = mcpSearch('Universal');
    expect(results.module).toBeDefined();
    expect(results.feature).toBeDefined();
  });

  it('matches on description fields', () => {
    db.prepare("INSERT INTO _splan_modules (module_name, module_description) VALUES (?, ?)").run('SomeModule', 'handles invoice payments');
    const results = mcpSearch('invoice');
    expect(results.module).toBeDefined();
    expect(results.module).toHaveLength(1);
  });
});

// ─── schema_get ───────────────────────────────────────────────────────────────

describe('schema_get', () => {
  it('returns a module by id', () => {
    const info = db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('Get Test');
    const result = mcpGet('module', Number(info.lastInsertRowid));
    expect(result).toBeTruthy();
    expect((result as Record<string, unknown>).moduleName).toBe('Get Test');
  });

  it('returns null for non-existent id', () => {
    const result = mcpGet('module', 999999);
    expect(result).toBeNull();
  });

  it('returns feature with concerns and discussions', () => {
    const featInfo = db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Feature With Extras');
    const featureId = Number(featInfo.lastInsertRowid);
    db.prepare("INSERT INTO _splan_feature_concerns (feature_id, concern_text) VALUES (?, ?)").run(featureId, 'Security concern');
    db.prepare("INSERT INTO _splan_discussions (entity_type, entity_id, title, content) VALUES (?, ?, ?, ?)").run('feature', featureId, 'Note', 'Content');

    const result = mcpGet('feature', featureId) as Record<string, unknown>;
    expect(result).toBeTruthy();
    expect(Array.isArray(result.concerns)).toBe(true);
    expect((result.concerns as unknown[]).length).toBe(1);
    expect(Array.isArray(result.discussions)).toBe(true);
    expect((result.discussions as unknown[]).length).toBe(1);
  });

  it('parses JSON columns in result', () => {
    const info = db.prepare("INSERT INTO _splan_modules (module_name, platforms) VALUES (?, ?)").run('JSON Test', '["Web App","Mobile"]');
    const result = mcpGet('module', Number(info.lastInsertRowid)) as Record<string, unknown>;
    expect(Array.isArray(result.platforms)).toBe(true);
    expect(result.platforms).toContain('Mobile');
  });
});

// ─── schema_list ──────────────────────────────────────────────────────────────

describe('schema_list', () => {
  it('returns total count and rows', () => {
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('M1');
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('M2');
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('M3');
    const { total, rows } = mcpList('module');
    expect(total).toBe(3);
    expect(rows).toHaveLength(3);
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run(`Module ${i}`);
    const { total, rows } = mcpList('module', 3, 0);
    expect(total).toBe(10);
    expect(rows).toHaveLength(3);
  });

  it('respects offset for pagination', () => {
    for (let i = 1; i <= 5; i++) db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run(`Module ${i}`);
    const page1 = mcpList('module', 2, 0);
    const page2 = mcpList('module', 2, 2);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    const p1Ids = page1.rows.map(r => (r as Record<string, unknown>).moduleId);
    const p2Ids = page2.rows.map(r => (r as Record<string, unknown>).moduleId);
    expect(p1Ids.some(id => p2Ids.includes(id))).toBe(false);
  });

  it('returns empty array when no rows', () => {
    const { total, rows } = mcpList('module');
    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
  });
});

// ─── schema_create ────────────────────────────────────────────────────────────

describe('schema_create', () => {
  it('inserts a module and returns it', () => {
    const result = mcpCreate('module', { moduleName: 'Created Module' }) as Record<string, unknown>;
    expect(result.moduleName).toBe('Created Module');
    expect(typeof result.moduleId).toBe('number');
  });

  it('creates feature with JSON columns', () => {
    const result = mcpCreate('feature', {
      featureName: 'Test Feature',
      platforms: ['Web App', 'Mobile'],
    }) as Record<string, unknown>;
    expect(Array.isArray(result.platforms)).toBe(true);
    expect((result.platforms as string[]).length).toBe(2);
  });

  it('logs INSERT in change_log', () => {
    const result = mcpCreate('module', { moduleName: 'Log Test' }) as Record<string, unknown>;
    const log = db.prepare("SELECT * FROM _splan_change_log WHERE entity_id = ? AND action = 'INSERT'").get(result.moduleId) as Record<string, unknown> | undefined;
    expect(log).toBeTruthy();
    expect(log!.entity_type).toBe('module');
  });

  it('skips null values in create data', () => {
    const result = mcpCreate('module', { moduleName: 'Null Test', moduleDescription: null }) as Record<string, unknown>;
    expect(result.moduleName).toBe('Null Test');
  });
});

// ─── schema_update ────────────────────────────────────────────────────────────

describe('schema_update', () => {
  it('updates a module field and returns updated row', () => {
    const created = mcpCreate('module', { moduleName: 'Before Update' }) as Record<string, unknown>;
    const updated = mcpUpdate('module', created.moduleId as number, { moduleName: 'After Update' }) as Record<string, unknown>;
    expect(updated.moduleName).toBe('After Update');
  });

  it('returns null for non-existent entity', () => {
    const result = mcpUpdate('module', 999999, { moduleName: 'Ghost' });
    expect(result).toBeNull();
  });

  it('creates UPDATE change log entries for changed fields', () => {
    const created = mcpCreate('module', { moduleName: 'Old' }) as Record<string, unknown>;
    db.exec('DELETE FROM _splan_change_log');
    mcpUpdate('module', created.moduleId as number, { moduleName: 'New' });
    const log = db.prepare("SELECT * FROM _splan_change_log WHERE action = 'UPDATE' AND field_changed = 'module_name'").get() as Record<string, unknown> | undefined;
    expect(log).toBeTruthy();
    expect(log!.old_value).toBe('Old');
    expect(log!.new_value).toBe('New');
  });

  it('does not log unchanged fields', () => {
    const created = mcpCreate('module', { moduleName: 'Same' }) as Record<string, unknown>;
    db.exec('DELETE FROM _splan_change_log');
    mcpUpdate('module', created.moduleId as number, { moduleName: 'Same' });
    const count = (db.prepare("SELECT COUNT(*) as cnt FROM _splan_change_log WHERE action = 'UPDATE'").get() as { cnt: number }).cnt;
    expect(count).toBe(0);
  });
});

// ─── schema_discuss ───────────────────────────────────────────────────────────

describe('schema_discuss', () => {
  it('creates a discussion record', () => {
    const result = mcpDiscuss('module', 1, 'Architecture Note', 'This module uses event sourcing.') as Record<string, unknown>;
    expect(result.title).toBe('Architecture Note');
    expect(result.content).toBe('This module uses event sourcing.');
    expect(result.source).toBe('claude_code');
    expect(result.entityType).toBe('module');
    expect(result.entityId).toBe(1);
  });

  it('assigns discussion_id autoincrement', () => {
    const d1 = mcpDiscuss('feature', 5, 'Note 1', 'Content 1') as Record<string, unknown>;
    const d2 = mcpDiscuss('feature', 5, 'Note 2', 'Content 2') as Record<string, unknown>;
    expect(Number(d2.discussionId)).toBeGreaterThan(Number(d1.discussionId));
  });

  it('persists in _splan_discussions table', () => {
    const result = mcpDiscuss('table', 3, 'Schema note', 'Important constraint') as Record<string, unknown>;
    const row = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(result.discussionId) as Record<string, unknown> | undefined;
    expect(row).toBeTruthy();
    expect(row!.content).toBe('Important constraint');
  });
});

// ─── schema_stats ─────────────────────────────────────────────────────────────

describe('schema_stats', () => {
  it('returns zero counts for empty database', () => {
    const stats = mcpStats();
    expect(stats['_splan_modules']).toBe(0);
    expect(stats['_splan_features']).toBe(0);
    expect(stats['_splan_discussions']).toBe(0);
  });

  it('reflects correct counts after inserts', () => {
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('M1');
    db.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('M2');
    db.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('F1');
    const stats = mcpStats();
    expect(stats['_splan_modules']).toBe(2);
    expect(stats['_splan_features']).toBe(1);
  });

  it('returns counts for all 13 tables', () => {
    const stats = mcpStats();
    expect(Object.keys(stats).length).toBe(13);
  });

  it('increments discussion count', () => {
    mcpDiscuss('module', 1, 'Test', 'Content');
    const stats = mcpStats();
    expect(stats['_splan_discussions']).toBe(1);
  });
});
