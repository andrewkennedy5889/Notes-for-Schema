/**
 * API endpoint tests — spins up an Express server on port 3199 using a
 * dedicated test database (schema-planner-test.db) so the production DB
 * is never touched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { createTestDb, cleanupTestDb, TEST_DB_PATH } from './setup.js';
import { parseRow, prepareRow } from '../server/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 3199;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// ─── Minimal test server (mirrors server/index.ts but uses testDb) ────────────

let testDb: Database.Database;
let server: http.Server;

function getTestDb() {
  return testDb;
}

const TABLE_MAP: Record<string, { sqlTable: string; idCol: string; idKey: string; entityType: string }> = {
  '_splan_modules':               { sqlTable: '_splan_modules',               idCol: 'module_id',    idKey: 'moduleId',  entityType: 'module' },
  '_splan_data_tables':           { sqlTable: '_splan_data_tables',           idCol: 'table_id',     idKey: 'tableId',   entityType: 'table' },
  '_splan_data_fields':           { sqlTable: '_splan_data_fields',           idCol: 'field_id',     idKey: 'fieldId',   entityType: 'field' },
  '_splan_features':              { sqlTable: '_splan_features',              idCol: 'feature_id',   idKey: 'featureId', entityType: 'feature' },
  '_splan_feature_concerns':      { sqlTable: '_splan_feature_concerns',      idCol: 'concern_id',   idKey: 'concernId', entityType: 'concern' },
  '_splan_change_log':            { sqlTable: '_splan_change_log',            idCol: 'id',           idKey: 'id',        entityType: 'log' },
  '_splan_data_access_rules':     { sqlTable: '_splan_data_access_rules',     idCol: 'rule_id',      idKey: 'ruleId',    entityType: 'access_rule' },
  '_splan_feature_data_reviews':  { sqlTable: '_splan_feature_data_reviews',  idCol: 'review_id',    idKey: 'reviewId',  entityType: 'data_review' },
  '_splan_entity_or_module_rules':{ sqlTable: '_splan_entity_or_module_rules',idCol: 'rule_id',      idKey: 'ruleId',    entityType: 'module_rule' },
  '_splan_grouping_presets':      { sqlTable: '_splan_grouping_presets',      idCol: 'preset_id',    idKey: 'presetId',  entityType: 'grouping_preset' },
  '_splan_tag_catalog':           { sqlTable: '_splan_tag_catalog',           idCol: 'tag_id',       idKey: 'tagId',     entityType: 'tag_catalog' },
  '_splan_discussions':           { sqlTable: '_splan_discussions',           idCol: 'discussion_id',idKey: 'discussionId', entityType: 'discussion' },
  '_splan_implementation_steps':  { sqlTable: '_splan_implementation_steps',  idCol: 'step_id',      idKey: 'stepId',          entityType: 'step' },
  '_splan_feature_tests':         { sqlTable: '_splan_feature_tests',         idCol: 'test_id',      idKey: 'testId',          entityType: 'feature_test' },
  '_splan_prototypes':            { sqlTable: '_splan_prototypes',            idCol: 'prototype_id', idKey: 'prototypeId',     entityType: 'prototype' },
};

function logChange(params: { entityType: string; entityId: number; action: string; fieldChanged?: string; oldValue?: unknown; newValue?: unknown; reasoning?: string }) {
  getTestDb().prepare(`
    INSERT INTO _splan_change_log (entity_type, entity_id, action, field_changed, old_value, new_value, reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(params.entityType, params.entityId, params.action, params.fieldChanged ?? null,
    params.oldValue !== undefined ? String(params.oldValue) : null,
    params.newValue !== undefined ? String(params.newValue) : null,
    params.reasoning ?? null);
}

function buildTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // GET list
  app.get('/api/schema-planner', (req: Request, res: Response) => {
    const tableName = req.query.table as string;
    const meta = TABLE_MAP[tableName];
    if (!meta) return void res.status(400).json({ error: `Unknown table: ${tableName}` });
    const db = getTestDb();
    const rows = db.prepare(`SELECT * FROM ${meta.sqlTable}`).all() as Record<string, unknown>[];
    return void res.json(rows.map(parseRow));
  });

  // POST create
  app.post('/api/schema-planner', (req: Request, res: Response) => {
    const { table: tableName, data: rawData, reasoning } = req.body as { table: string; data: Record<string, unknown>; reasoning?: string };
    const meta = TABLE_MAP[tableName];
    if (!meta) return void res.status(400).json({ error: `Unknown table: ${tableName}` });
    const db = getTestDb();

    if (tableName === '_splan_grouping_presets' && rawData.tabKey) {
      const count = (db.prepare('SELECT COUNT(*) as cnt FROM _splan_grouping_presets WHERE tab_key = ?').get(rawData.tabKey) as { cnt: number }).cnt;
      if (count >= 5) return void res.status(400).json({ error: 'Maximum 5 grouping presets per tab' });
    }

    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawData)) {
      if (k === 'createdAt' || k === 'updatedAt' || k === 'created_at' || k === 'updated_at') continue;
      if (v === null || v === undefined) continue;
      cleaned[k] = v;
    }

    const snakeData = prepareRow(cleaned);
    const cols = Object.keys(snakeData);
    const info = db.prepare(`INSERT INTO ${meta.sqlTable} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...Object.values(snakeData));
    const newId = info.lastInsertRowid as number;

    if (tableName !== '_splan_grouping_presets' && tableName !== '_splan_change_log') {
      logChange({ entityType: meta.entityType, entityId: newId, action: 'INSERT', reasoning });
    }

    const created = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(newId) as Record<string, unknown>;
    return void res.status(201).json(parseRow(created));
  });

  // PUT update
  app.put('/api/schema-planner', (req: Request, res: Response) => {
    const { table: tableName, id, data: rawData, reasoning } = req.body as { table: string; id: number; data: Record<string, unknown>; reasoning?: string };
    const meta = TABLE_MAP[tableName];
    if (!meta) return void res.status(400).json({ error: `Unknown table: ${tableName}` });
    const db = getTestDb();

    const oldRow = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown> | undefined;
    if (!oldRow) return void res.status(404).json({ error: 'Row not found' });

    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawData)) {
      if (k === 'createdAt' || k === 'created_at') continue;
      cleaned[k] = v;
    }
    cleaned.updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const snakeData = prepareRow(cleaned);
    delete snakeData[meta.idCol];

    const setClauses = Object.keys(snakeData).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE ${meta.sqlTable} SET ${setClauses} WHERE ${meta.idCol} = ?`).run(...Object.values(snakeData), id);

    if (tableName !== '_splan_grouping_presets' && tableName !== '_splan_change_log') {
      for (const [snakeKey, newVal] of Object.entries(snakeData)) {
        if (snakeKey === 'updated_at') continue;
        const oldVal = oldRow[snakeKey];
        if (String(oldVal ?? '') !== String(newVal ?? '')) {
          logChange({ entityType: meta.entityType, entityId: id, action: 'UPDATE', fieldChanged: snakeKey, oldValue: oldVal, newValue: newVal, reasoning });
        }
      }
    }

    const updated = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown>;
    return void res.json(parseRow(updated));
  });

  // DELETE
  app.delete('/api/schema-planner', (req: Request, res: Response) => {
    const { table: tableName, id, reasoning } = req.body as { table: string; id: number; reasoning?: string };
    const meta = TABLE_MAP[tableName];
    if (!meta) return void res.status(400).json({ error: `Unknown table: ${tableName}` });
    const db = getTestDb();
    const existing = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id);
    if (!existing) return void res.status(404).json({ error: 'Row not found' });
    db.prepare(`DELETE FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).run(id);
    if (tableName !== '_splan_grouping_presets' && tableName !== '_splan_change_log') {
      logChange({ entityType: meta.entityType, entityId: id, action: 'DELETE', reasoning });
    }
    return void res.json({ success: true });
  });

  // Counts
  app.get('/api/schema-planner/counts', (_req, res: Response) => {
    const db = getTestDb();
    const counts: Record<string, number> = {};
    for (const [key, meta] of Object.entries(TABLE_MAP)) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${meta.sqlTable}`).get() as { cnt: number };
      counts[key] = row.cnt;
    }
    return void res.json(counts);
  });

  // Matrix
  app.get('/api/schema-planner/matrix', (_req, res: Response) => {
    const db = getTestDb();
    const tables = (db.prepare('SELECT * FROM _splan_data_tables').all() as Record<string, unknown>[]).map(parseRow);
    const rules = (db.prepare('SELECT * FROM _splan_data_access_rules').all() as Record<string, unknown>[]).map(parseRow);
    const rulesByTableId: Record<number, unknown[]> = {};
    for (const rule of rules) {
      const tId = (rule as Record<string, unknown>).tableId as number;
      if (!rulesByTableId[tId]) rulesByTableId[tId] = [];
      rulesByTableId[tId].push(rule);
    }
    const matrix = tables.map(t => ({ ...t, accessRules: rulesByTableId[(t as Record<string, unknown>).tableId as number] ?? [] }));
    return void res.json(matrix);
  });

  // Feature impact
  app.get('/api/schema-planner/feature-impact', (req: Request, res: Response) => {
    const featureId = Number(req.query.featureId);
    if (!featureId) return void res.status(400).json({ error: 'featureId required' });
    const db = getTestDb();
    const feature = db.prepare('SELECT * FROM _splan_features WHERE feature_id = ?').get(featureId) as Record<string, unknown> | undefined;
    if (!feature) return void res.status(404).json({ error: 'Feature not found' });
    const parsed = parseRow(feature);
    const tableIds: number[] = Array.isArray(parsed.dataTables) ? (parsed.dataTables as number[]) : [];
    const linkedTables = tableIds.length > 0
      ? (db.prepare(`SELECT * FROM _splan_data_tables WHERE table_id IN (${tableIds.map(() => '?').join(',')})`).all(...tableIds) as Record<string, unknown>[]).map(parseRow)
      : [];
    const rules = tableIds.length > 0
      ? (db.prepare(`SELECT * FROM _splan_data_access_rules WHERE table_id IN (${tableIds.map(() => '?').join(',')})`).all(...tableIds) as Record<string, unknown>[]).map(parseRow)
      : [];
    const tablesWithRules = new Set(rules.map(r => (r as Record<string, unknown>).tableId));
    const gaps = linkedTables.filter(t => !tablesWithRules.has((t as Record<string, unknown>).tableId));
    const existingReview = db.prepare('SELECT * FROM _splan_feature_data_reviews WHERE feature_id = ?').get(featureId) as Record<string, unknown> | undefined;
    return void res.json({ feature: parsed, linkedTables, rules, gaps, existingReview: existingReview ? parseRow(existingReview) : null });
  });

  // Discussion GET
  app.get('/api/discussions', (req: Request, res: Response) => {
    const { entityType, entityId } = req.query as { entityType: string; entityId: string };
    const db = getTestDb();
    const rows = db.prepare('SELECT * FROM _splan_discussions WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC').all(entityType, Number(entityId)) as Record<string, unknown>[];
    return void res.json(rows.map(parseRow));
  });

  // Discussion POST
  app.post('/api/discussions', (req: Request, res: Response) => {
    const { entityType, entityId, title, content, source } = req.body as { entityType: string; entityId: number; title: string; content: string; source?: string };
    const db = getTestDb();
    const info = db.prepare('INSERT INTO _splan_discussions (entity_type, entity_id, title, content, source) VALUES (?, ?, ?, ?, ?)').run(entityType, entityId, title, content, source ?? 'claude_code');
    const created = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
    return void res.status(201).json(parseRow(created));
  });

  // Discussion PUT
  app.put('/api/discussions/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { content, title } = req.body as { content?: string; title?: string };
    const db = getTestDb();
    const existing = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(id);
    if (!existing) return void res.status(404).json({ error: 'Not found' });
    const updates: string[] = [];
    const values: unknown[] = [];
    if (content !== undefined) { updates.push('content = ?'); values.push(content); }
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    updates.push('updated_at = ?');
    values.push(new Date().toISOString().replace('T', ' ').substring(0, 19));
    values.push(id);
    db.prepare(`UPDATE _splan_discussions SET ${updates.join(', ')} WHERE discussion_id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(id) as Record<string, unknown>;
    return void res.json(parseRow(updated));
  });

  // Discussion DELETE
  app.delete('/api/discussions/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const db = getTestDb();
    const existing = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(id);
    if (!existing) return void res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM _splan_discussions WHERE discussion_id = ?').run(id);
    return void res.json({ success: true });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  cleanupTestDb();
  testDb = createTestDb();
  const app = buildTestApp();
  await new Promise<void>((resolve) => {
    server = app.listen(TEST_PORT, resolve);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  testDb.close();
  cleanupTestDb();
});

// Clean tables between tests to keep counts predictable
beforeEach(() => {
  testDb.exec(`
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

// ─── GET tests ────────────────────────────────────────────────────────────────

describe('GET /api/schema-planner', () => {
  it('returns 400 for unknown table', async () => {
    const { status, body } = await api('GET', '/api/schema-planner?table=nonexistent');
    expect(status).toBe(400);
    expect(body.error).toMatch(/Unknown table/);
  });

  it('returns empty array for empty modules table', async () => {
    const { status, body } = await api('GET', '/api/schema-planner?table=_splan_modules');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns seeded modules', async () => {
    testDb.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('Auth Module');
    const { body } = await api('GET', '/api/schema-planner?table=_splan_modules');
    expect(body).toHaveLength(1);
    expect(body[0].moduleName).toBe('Auth Module');
  });
});

// ─── POST tests ───────────────────────────────────────────────────────────────

describe('POST /api/schema-planner', () => {
  it('creates a module and returns camelCase keys', async () => {
    const { status, body } = await api('POST', '/api/schema-planner', {
      table: '_splan_modules',
      data: { moduleName: 'New Module', modulePurpose: 'Testing' },
    });
    expect(status).toBe(201);
    expect(body.moduleName).toBe('New Module');
    expect(body.modulePurpose).toBe('Testing');
    expect(typeof body.moduleId).toBe('number');
  });

  it('creates a module with JSON platforms array', async () => {
    const { body } = await api('POST', '/api/schema-planner', {
      table: '_splan_modules',
      data: { moduleName: 'Platform Module', platforms: ['Web App', 'Mobile'] },
    });
    expect(Array.isArray(body.platforms)).toBe(true);
    expect(body.platforms).toContain('Mobile');
  });

  it('logs INSERT in change_log on create', async () => {
    const { body } = await api('POST', '/api/schema-planner', {
      table: '_splan_modules',
      data: { moduleName: 'Log Test' },
    });
    const log = testDb.prepare("SELECT * FROM _splan_change_log WHERE entity_id = ? AND action = 'INSERT'").get(body.moduleId) as Record<string, unknown> | undefined;
    expect(log).toBeTruthy();
    expect(log!.entity_type).toBe('module');
  });

  it('returns 400 for unknown table', async () => {
    const { status } = await api('POST', '/api/schema-planner', { table: 'bad_table', data: {} });
    expect(status).toBe(400);
  });
});

// ─── PUT tests ────────────────────────────────────────────────────────────────

describe('PUT /api/schema-planner', () => {
  it('updates a module and returns updated camelCase data', async () => {
    const created = (await api('POST', '/api/schema-planner', { table: '_splan_modules', data: { moduleName: 'Old Name' } })).body;
    const { status, body } = await api('PUT', '/api/schema-planner', {
      table: '_splan_modules',
      id: created.moduleId,
      data: { moduleName: 'New Name' },
    });
    expect(status).toBe(200);
    expect(body.moduleName).toBe('New Name');
  });

  it('logs UPDATE with field_changed in change_log', async () => {
    const created = (await api('POST', '/api/schema-planner', { table: '_splan_modules', data: { moduleName: 'Before' } })).body;
    testDb.exec('DELETE FROM _splan_change_log');
    await api('PUT', '/api/schema-planner', {
      table: '_splan_modules',
      id: created.moduleId,
      data: { moduleName: 'After' },
    });
    const log = testDb.prepare("SELECT * FROM _splan_change_log WHERE action = 'UPDATE' AND field_changed = 'module_name'").get() as Record<string, unknown> | undefined;
    expect(log).toBeTruthy();
    expect(log!.old_value).toBe('Before');
    expect(log!.new_value).toBe('After');
  });

  it('returns 404 for non-existent id', async () => {
    const { status } = await api('PUT', '/api/schema-planner', {
      table: '_splan_modules',
      id: 999999,
      data: { moduleName: 'Ghost' },
    });
    expect(status).toBe(404);
  });
});

// ─── DELETE tests ─────────────────────────────────────────────────────────────

describe('DELETE /api/schema-planner', () => {
  it('deletes a module and it is gone', async () => {
    const created = (await api('POST', '/api/schema-planner', { table: '_splan_modules', data: { moduleName: 'ToDelete' } })).body;
    const { status, body } = await api('DELETE', '/api/schema-planner', { table: '_splan_modules', id: created.moduleId });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const remaining = testDb.prepare('SELECT * FROM _splan_modules WHERE module_id = ?').get(created.moduleId);
    expect(remaining).toBeUndefined();
  });

  it('logs DELETE in change_log', async () => {
    const created = (await api('POST', '/api/schema-planner', { table: '_splan_modules', data: { moduleName: 'DeleteLog' } })).body;
    testDb.exec('DELETE FROM _splan_change_log');
    await api('DELETE', '/api/schema-planner', { table: '_splan_modules', id: created.moduleId });
    const log = testDb.prepare("SELECT * FROM _splan_change_log WHERE action = 'DELETE'").get() as Record<string, unknown> | undefined;
    expect(log).toBeTruthy();
    expect(log!.entity_type).toBe('module');
  });

  it('returns 404 when deleting non-existent row', async () => {
    const { status } = await api('DELETE', '/api/schema-planner', { table: '_splan_modules', id: 999999 });
    expect(status).toBe(404);
  });
});

// ─── Counts endpoint ──────────────────────────────────────────────────────────

describe('GET /api/schema-planner/counts', () => {
  it('returns zero counts for empty database', async () => {
    const { status, body } = await api('GET', '/api/schema-planner/counts');
    expect(status).toBe(200);
    expect(body['_splan_modules']).toBe(0);
    expect(body['_splan_features']).toBe(0);
  });

  it('reflects actual row counts after inserts', async () => {
    testDb.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('M1');
    testDb.prepare("INSERT INTO _splan_modules (module_name) VALUES (?)").run('M2');
    const { body } = await api('GET', '/api/schema-planner/counts');
    expect(body['_splan_modules']).toBe(2);
  });
});

// ─── Matrix endpoint ──────────────────────────────────────────────────────────

describe('GET /api/schema-planner/matrix', () => {
  it('returns tables with accessRules arrays', async () => {
    const tableInfo = testDb.prepare("INSERT INTO _splan_data_tables (table_name) VALUES (?)").run('matrix_table');
    const tableId = Number(tableInfo.lastInsertRowid);
    testDb.prepare("INSERT INTO _splan_data_access_rules (table_id, access_level) VALUES (?, ?)").run(tableId, 'read');

    const { status, body } = await api('GET', '/api/schema-planner/matrix');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const entry = body.find((t: Record<string, unknown>) => t.tableId === tableId);
    expect(entry).toBeTruthy();
    expect(Array.isArray(entry.accessRules)).toBe(true);
    expect(entry.accessRules).toHaveLength(1);
  });

  it('returns empty array when no tables exist', async () => {
    const { body } = await api('GET', '/api/schema-planner/matrix');
    expect(body).toEqual([]);
  });
});

// ─── Feature impact endpoint ──────────────────────────────────────────────────

describe('GET /api/schema-planner/feature-impact', () => {
  it('returns 400 when featureId not provided', async () => {
    const { status } = await api('GET', '/api/schema-planner/feature-impact');
    expect(status).toBe(400);
  });

  it('returns 404 for non-existent feature', async () => {
    const { status } = await api('GET', '/api/schema-planner/feature-impact?featureId=99999');
    expect(status).toBe(404);
  });

  it('returns feature with empty linked tables and gaps', async () => {
    const info = testDb.prepare("INSERT INTO _splan_features (feature_name) VALUES (?)").run('Impact Feature');
    const { status, body } = await api('GET', `/api/schema-planner/feature-impact?featureId=${info.lastInsertRowid}`);
    expect(status).toBe(200);
    expect(body.feature.featureName).toBe('Impact Feature');
    expect(body.linkedTables).toEqual([]);
    expect(body.gaps).toEqual([]);
    expect(body.existingReview).toBeNull();
  });

  it('identifies tables with no access rules as gaps', async () => {
    const tableInfo = testDb.prepare("INSERT INTO _splan_data_tables (table_name) VALUES (?)").run('no_rules_table');
    const tableId = Number(tableInfo.lastInsertRowid);
    const featInfo = testDb.prepare(
      "INSERT INTO _splan_features (feature_name, data_tables) VALUES (?, ?)"
    ).run('Gap Feature', JSON.stringify([tableId]));
    const { body } = await api('GET', `/api/schema-planner/feature-impact?featureId=${featInfo.lastInsertRowid}`);
    expect(body.linkedTables).toHaveLength(1);
    expect(body.gaps).toHaveLength(1);
  });
});

// ─── Grouping preset max-5 limit ─────────────────────────────────────────────

describe('Grouping presets max-5 limit', () => {
  it('allows creating up to 5 presets for the same tab', async () => {
    for (let i = 1; i <= 5; i++) {
      const { status } = await api('POST', '/api/schema-planner', {
        table: '_splan_grouping_presets',
        data: { tabKey: 'features', presetName: `Preset ${i}` },
      });
      expect(status).toBe(201);
    }
  });

  it('rejects a 6th preset for the same tab', async () => {
    for (let i = 1; i <= 5; i++) {
      await api('POST', '/api/schema-planner', {
        table: '_splan_grouping_presets',
        data: { tabKey: 'tables', presetName: `Preset ${i}` },
      });
    }
    const { status, body } = await api('POST', '/api/schema-planner', {
      table: '_splan_grouping_presets',
      data: { tabKey: 'tables', presetName: 'Preset 6' },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Maximum 5/);
  });
});

// ─── Discussion CRUD ──────────────────────────────────────────────────────────

describe('Discussion CRUD', () => {
  it('GET returns empty array when no discussions', async () => {
    const { body } = await api('GET', '/api/discussions?entityType=module&entityId=1');
    expect(body).toEqual([]);
  });

  it('POST creates a discussion and returns it', async () => {
    const { status, body } = await api('POST', '/api/discussions', {
      entityType: 'module',
      entityId: 1,
      title: 'Analysis Notes',
      content: 'This module handles authentication.',
    });
    expect(status).toBe(201);
    expect(body.title).toBe('Analysis Notes');
    expect(body.source).toBe('claude_code');
    expect(typeof body.discussionId).toBe('number');
  });

  it('PUT updates discussion title and content', async () => {
    const created = (await api('POST', '/api/discussions', {
      entityType: 'module', entityId: 2, title: 'Old Title', content: 'Old Content',
    })).body;
    const { body } = await api('PUT', `/api/discussions/${created.discussionId}`, {
      title: 'New Title', content: 'New Content',
    });
    expect(body.title).toBe('New Title');
    expect(body.content).toBe('New Content');
  });

  it('DELETE removes a discussion', async () => {
    const created = (await api('POST', '/api/discussions', {
      entityType: 'feature', entityId: 5, title: 'To Delete', content: 'Bye',
    })).body;
    const { body } = await api('DELETE', `/api/discussions/${created.discussionId}`);
    expect(body.success).toBe(true);

    const remaining = testDb.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(created.discussionId);
    expect(remaining).toBeUndefined();
  });
});

// ─── Implementation Steps CRUD ───────────────────────────────────────────────

describe('Implementation Steps CRUD', () => {
  it('creates a step linked to a feature', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Step Feature' } })).body;
    const { status, body } = await api('POST', '/api/schema-planner', {
      table: '_splan_implementation_steps',
      data: { featureId: feat.featureId, title: 'Build API endpoint', stepType: 'implementation', status: 'pending', sortOrder: 0 },
    });
    expect(status).toBe(201);
    expect(body.title).toBe('Build API endpoint');
    expect(body.stepType).toBe('implementation');
    expect(body.status).toBe('pending');
    expect(typeof body.stepId).toBe('number');
  });

  it('updates step status', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Update Step Feature' } })).body;
    const step = (await api('POST', '/api/schema-planner', {
      table: '_splan_implementation_steps',
      data: { featureId: feat.featureId, title: 'Write tests', stepType: 'test', status: 'pending' },
    })).body;
    const { body } = await api('PUT', '/api/schema-planner', {
      table: '_splan_implementation_steps',
      id: step.stepId,
      data: { status: 'implemented' },
    });
    expect(body.status).toBe('implemented');
  });

  it('deletes a step', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Delete Step Feature' } })).body;
    const step = (await api('POST', '/api/schema-planner', {
      table: '_splan_implementation_steps',
      data: { featureId: feat.featureId, title: 'Temp step', stepType: 'research' },
    })).body;
    const { body } = await api('DELETE', '/api/schema-planner', { table: '_splan_implementation_steps', id: step.stepId });
    expect(body.success).toBe(true);
    const remaining = testDb.prepare('SELECT * FROM _splan_implementation_steps WHERE step_id = ?').get(step.stepId);
    expect(remaining).toBeUndefined();
  });

  it('cascades delete when feature is deleted', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Cascade Feature' } })).body;
    await api('POST', '/api/schema-planner', {
      table: '_splan_implementation_steps',
      data: { featureId: feat.featureId, title: 'Step 1', stepType: 'implementation' },
    });
    await api('POST', '/api/schema-planner', {
      table: '_splan_implementation_steps',
      data: { featureId: feat.featureId, title: 'Step 2', stepType: 'test' },
    });
    const before = (testDb.prepare('SELECT COUNT(*) as cnt FROM _splan_implementation_steps WHERE feature_id = ?').get(feat.featureId) as { cnt: number }).cnt;
    expect(before).toBe(2);

    await api('DELETE', '/api/schema-planner', { table: '_splan_features', id: feat.featureId });

    const after = (testDb.prepare('SELECT COUNT(*) as cnt FROM _splan_implementation_steps WHERE feature_id = ?').get(feat.featureId) as { cnt: number }).cnt;
    expect(after).toBe(0);
  });

  it('defaults stepType to implementation and status to pending', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Default Step Feature' } })).body;
    const { body } = await api('POST', '/api/schema-planner', {
      table: '_splan_implementation_steps',
      data: { featureId: feat.featureId, title: 'Minimal step' },
    });
    expect(body.stepType).toBe('implementation');
    expect(body.status).toBe('pending');
    expect(body.sortOrder).toBe(0);
  });

  it('lists steps for a feature via GET', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'List Steps Feature' } })).body;
    await api('POST', '/api/schema-planner', { table: '_splan_implementation_steps', data: { featureId: feat.featureId, title: 'A' } });
    await api('POST', '/api/schema-planner', { table: '_splan_implementation_steps', data: { featureId: feat.featureId, title: 'B' } });
    const { body } = await api('GET', '/api/schema-planner?table=_splan_implementation_steps');
    const forFeature = body.filter((s: Record<string, unknown>) => s.featureId === feat.featureId);
    expect(forFeature).toHaveLength(2);
  });

  it('rejects step with non-existent feature_id (FK constraint)', async () => {
    const { status } = await api('POST', '/api/schema-planner', {
      table: '_splan_implementation_steps',
      data: { featureId: 999999, title: 'Orphan step' },
    });
    expect(status).toBe(500);
  });
});

// ─── Feature Tests CRUD ──────────────────────────────────────────────────────

describe('Feature Tests CRUD', () => {
  it('creates a test linked to a feature', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Test Feature' } })).body;
    const { status, body } = await api('POST', '/api/schema-planner', {
      table: '_splan_feature_tests',
      data: { featureId: feat.featureId, title: 'User can log in', testType: 'acceptance', expectedResult: 'Redirect to dashboard' },
    });
    expect(status).toBe(201);
    expect(body.title).toBe('User can log in');
    expect(body.testType).toBe('acceptance');
    expect(body.status).toBe('draft');
    expect(body.expectedResult).toBe('Redirect to dashboard');
  });

  it('updates test status to passing', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Pass Feature' } })).body;
    const test = (await api('POST', '/api/schema-planner', {
      table: '_splan_feature_tests',
      data: { featureId: feat.featureId, title: 'Auth test' },
    })).body;
    const { body } = await api('PUT', '/api/schema-planner', {
      table: '_splan_feature_tests',
      id: test.testId,
      data: { status: 'passing' },
    });
    expect(body.status).toBe('passing');
  });

  it('stores dependencies as JSON array', async () => {
    const feat1 = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Dep Feature 1' } })).body;
    const feat2 = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Dep Feature 2' } })).body;
    const test = (await api('POST', '/api/schema-planner', {
      table: '_splan_feature_tests',
      data: { featureId: feat1.featureId, title: 'Cross-feature test', dependencies: [feat2.featureId] },
    })).body;
    expect(Array.isArray(test.dependencies)).toBe(true);
    expect(test.dependencies).toContain(feat2.featureId);
  });

  it('cascades delete when feature is deleted', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Cascade Test Feature' } })).body;
    await api('POST', '/api/schema-planner', { table: '_splan_feature_tests', data: { featureId: feat.featureId, title: 'T1' } });
    await api('POST', '/api/schema-planner', { table: '_splan_feature_tests', data: { featureId: feat.featureId, title: 'T2' } });
    await api('DELETE', '/api/schema-planner', { table: '_splan_features', id: feat.featureId });
    const after = (testDb.prepare('SELECT COUNT(*) as cnt FROM _splan_feature_tests WHERE feature_id = ?').get(feat.featureId) as { cnt: number }).cnt;
    expect(after).toBe(0);
  });

  it('defaults test_type to acceptance and status to draft', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Default Test Feature' } })).body;
    const { body } = await api('POST', '/api/schema-planner', {
      table: '_splan_feature_tests',
      data: { featureId: feat.featureId, title: 'Minimal test' },
    });
    expect(body.testType).toBe('acceptance');
    expect(body.status).toBe('draft');
  });

  it('rejects test with non-existent feature_id', async () => {
    const { status } = await api('POST', '/api/schema-planner', {
      table: '_splan_feature_tests',
      data: { featureId: 999999, title: 'Orphan test' },
    });
    expect(status).toBe(500);
  });
});

// ─── Prototypes CRUD ─────────────────────────────────────────────────────────

describe('Prototypes CRUD', () => {
  it('creates a prototype with features array', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Proto Feature' } })).body;
    const { status, body } = await api('POST', '/api/schema-planner', {
      table: '_splan_prototypes',
      data: { title: 'Login Form', prototypeType: 'component', features: [feat.featureId], techStack: 'React + Vite' },
    });
    expect(status).toBe(201);
    expect(body.title).toBe('Login Form');
    expect(body.prototypeType).toBe('component');
    expect(body.status).toBe('idea');
    expect(Array.isArray(body.features)).toBe(true);
    expect(body.features).toContain(feat.featureId);
    expect(body.techStack).toBe('React + Vite');
  });

  it('updates prototype status to working', async () => {
    const proto = (await api('POST', '/api/schema-planner', {
      table: '_splan_prototypes',
      data: { title: 'Email Service', prototypeType: 'service' },
    })).body;
    const { body } = await api('PUT', '/api/schema-planner', {
      table: '_splan_prototypes',
      id: proto.prototypeId,
      data: { status: 'working' },
    });
    expect(body.status).toBe('working');
  });

  it('stores tests array as JSON', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Test Link Feature' } })).body;
    const test = (await api('POST', '/api/schema-planner', {
      table: '_splan_feature_tests',
      data: { featureId: feat.featureId, title: 'Linked test' },
    })).body;
    const { body } = await api('POST', '/api/schema-planner', {
      table: '_splan_prototypes',
      data: { title: 'Auth Prototype', tests: [test.testId], features: [feat.featureId] },
    });
    expect(Array.isArray(body.tests)).toBe(true);
    expect(body.tests).toContain(test.testId);
  });

  it('deletes a prototype', async () => {
    const proto = (await api('POST', '/api/schema-planner', {
      table: '_splan_prototypes',
      data: { title: 'Temp Proto' },
    })).body;
    const { body } = await api('DELETE', '/api/schema-planner', { table: '_splan_prototypes', id: proto.prototypeId });
    expect(body.success).toBe(true);
    const remaining = testDb.prepare('SELECT * FROM _splan_prototypes WHERE prototype_id = ?').get(proto.prototypeId);
    expect(remaining).toBeUndefined();
  });

  it('defaults prototype_type to component and status to idea', async () => {
    const { body } = await api('POST', '/api/schema-planner', {
      table: '_splan_prototypes',
      data: { title: 'Minimal Proto' },
    });
    expect(body.prototypeType).toBe('component');
    expect(body.status).toBe('idea');
  });

  it('prototype is not cascade-deleted (no FK to features)', async () => {
    const feat = (await api('POST', '/api/schema-planner', { table: '_splan_features', data: { featureName: 'Proto Cascade Test' } })).body;
    const proto = (await api('POST', '/api/schema-planner', {
      table: '_splan_prototypes',
      data: { title: 'Surviving Proto', features: [feat.featureId] },
    })).body;
    await api('DELETE', '/api/schema-planner', { table: '_splan_features', id: feat.featureId });
    const remaining = testDb.prepare('SELECT * FROM _splan_prototypes WHERE prototype_id = ?').get(proto.prototypeId);
    expect(remaining).toBeTruthy();
  });
});
