import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { parseRow, prepareRow, camelToSnake } from './utils.js';
import { authRouter, authMiddleware } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_STORAGE = process.env.IMAGE_STORAGE_PATH || path.join(__dirname, '..', 'Image Storage');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// ─── Auth ────────────────────────────────────────────────────────────────────
app.use(authRouter);
app.use(authMiddleware);

// ─── Static serving ──────────────────────────────────────────────────────────
app.use('/images', express.static(IMAGE_STORAGE));
app.use('/prototypes', express.static(path.join(__dirname, '..', 'prototypes')));

// ─── Table registry ───────────────────────────────────────────────────────────
const TABLE_MAP: Record<string, { sqlTable: string; idCol: string; idKey: string; entityType: string }> = {
  '_splan_modules':               { sqlTable: '_splan_modules',               idCol: 'module_id',    idKey: 'moduleId',        entityType: 'module' },
  '_splan_data_tables':           { sqlTable: '_splan_data_tables',           idCol: 'table_id',     idKey: 'tableId',         entityType: 'table' },
  '_splan_data_fields':           { sqlTable: '_splan_data_fields',           idCol: 'field_id',     idKey: 'fieldId',         entityType: 'field' },
  '_splan_module_use_fields':     { sqlTable: '_splan_module_use_fields',     idCol: 'id',           idKey: 'id',              entityType: 'module_use_field' },
  '_splan_features':              { sqlTable: '_splan_features',              idCol: 'feature_id',   idKey: 'featureId',       entityType: 'feature' },
  '_splan_feature_concerns':      { sqlTable: '_splan_feature_concerns',      idCol: 'concern_id',   idKey: 'concernId',       entityType: 'concern' },
  '_splan_change_log':            { sqlTable: '_splan_change_log',            idCol: 'id',           idKey: 'id',              entityType: 'log' },
  '_splan_data_access_rules':     { sqlTable: '_splan_data_access_rules',     idCol: 'rule_id',      idKey: 'ruleId',          entityType: 'access_rule' },
  '_splan_feature_data_reviews':  { sqlTable: '_splan_feature_data_reviews',  idCol: 'review_id',    idKey: 'reviewId',        entityType: 'data_review' },
  '_splan_entity_or_module_rules':{ sqlTable: '_splan_entity_or_module_rules',idCol: 'rule_id',      idKey: 'ruleId',          entityType: 'module_rule' },
  '_splan_grouping_presets':      { sqlTable: '_splan_grouping_presets',      idCol: 'preset_id',    idKey: 'presetId',        entityType: 'grouping_preset' },
  '_splan_view_presets':          { sqlTable: '_splan_view_presets',          idCol: 'preset_id',    idKey: 'presetId',        entityType: 'view_preset' },
  '_splan_tag_catalog':           { sqlTable: '_splan_tag_catalog',           idCol: 'tag_id',       idKey: 'tagId',           entityType: 'tag_catalog' },
  '_splan_implementation_steps':  { sqlTable: '_splan_implementation_steps',  idCol: 'step_id',      idKey: 'stepId',          entityType: 'step' },
  '_splan_feature_tests':         { sqlTable: '_splan_feature_tests',         idCol: 'test_id',      idKey: 'testId',          entityType: 'feature_test' },
  '_splan_concept_tests':         { sqlTable: '_splan_concept_tests',         idCol: 'test_id',      idKey: 'testId',          entityType: 'concept_test' },
  '_splan_module_tests':          { sqlTable: '_splan_module_tests',          idCol: 'test_id',      idKey: 'testId',          entityType: 'module_test' },
  '_splan_prototypes':            { sqlTable: '_splan_prototypes',            idCol: 'prototype_id', idKey: 'prototypeId',     entityType: 'prototype' },
  '_splan_concepts':              { sqlTable: '_splan_concepts',              idCol: 'concept_id',  idKey: 'conceptId',       entityType: 'concept' },
  '_splan_research':              { sqlTable: '_splan_research',              idCol: 'research_id', idKey: 'researchId',      entityType: 'research' },
  '_splan_all_tests':             { sqlTable: '_splan_all_tests',             idCol: 'test_id',     idKey: 'testId',          entityType: 'test' },
  '_splan_projects':              { sqlTable: '_splan_projects',              idCol: 'project_id',  idKey: 'projectId',       entityType: 'project' },
  '_splan_code_changes':          { sqlTable: '_splan_code_changes',          idCol: 'change_id',   idKey: 'changeId',        entityType: 'code_change' },
};

// ─── Multer setup ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const entityType = req.body?.entityType || 'features';
    const entityId = req.body?.entityId || req.body?.featureId || req.query?.featureId || 'misc';
    const dir = path.join(IMAGE_STORAGE, String(entityType), String(entityId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function logChange(params: {
  entityType: string;
  entityId: number;
  action: string;
  fieldChanged?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reasoning?: string;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO _splan_change_log (entity_type, entity_id, action, field_changed, old_value, new_value, reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.entityType,
    params.entityId,
    params.action,
    params.fieldChanged ?? null,
    params.oldValue !== undefined ? String(params.oldValue) : null,
    params.newValue !== undefined ? String(params.newValue) : null,
    params.reasoning ?? null,
  );
}

// ─── GET /api/schema-planner ──────────────────────────────────────────────────
app.get('/api/schema-planner', (req: Request, res: Response) => {
  const tableName = req.query.table as string;
  const meta = TABLE_MAP[tableName];
  if (!meta) return void res.status(400).json({ error: `Unknown table: ${tableName}` });

  const db = getDb();

  // Virtual union table: merge all test tables with entity info
  if (tableName === '_splan_all_tests') {
    const rows = db.prepare(`
      SELECT ft.test_id, ft.title, ft.description, ft.test_type, ft.status, ft.generated_code,
             ft.expected_result, ft.sort_order, ft.created_at, ft.updated_at,
             'feature' AS entity_type, ft.feature_id AS entity_id, f.feature_name AS entity_name
      FROM _splan_feature_tests ft
      LEFT JOIN _splan_features f ON f.feature_id = ft.feature_id
      UNION ALL
      SELECT ct.test_id, ct.title, ct.description, ct.test_type, ct.status, ct.generated_code,
             ct.expected_result, ct.sort_order, ct.created_at, ct.updated_at,
             'concept' AS entity_type, ct.concept_id AS entity_id, c.concept_name AS entity_name
      FROM _splan_concept_tests ct
      LEFT JOIN _splan_concepts c ON c.concept_id = ct.concept_id
      UNION ALL
      SELECT mt.test_id, mt.title, mt.description, mt.test_type, mt.status, mt.generated_code,
             mt.expected_result, mt.sort_order, mt.created_at, mt.updated_at,
             'module' AS entity_type, mt.module_id AS entity_id, m.module_name AS entity_name
      FROM _splan_module_tests mt
      LEFT JOIN _splan_modules m ON m.module_id = mt.module_id
    `).all() as Record<string, unknown>[];
    return void res.json(rows.map(parseRow));
  }

  const order = tableName === '_splan_change_log' ? ' ORDER BY changed_at DESC' : '';
  const rows = db.prepare(`SELECT * FROM ${meta.sqlTable}${order}`).all() as Record<string, unknown>[];
  return void res.json(rows.map(parseRow));
});

// ─── POST /api/schema-planner ─────────────────────────────────────────────────
app.post('/api/schema-planner', (req: Request, res: Response) => {
  const { table: tableName, data: rawData, reasoning } = req.body as {
    table: string;
    data: Record<string, unknown>;
    reasoning?: string;
  };
  const meta = TABLE_MAP[tableName];
  if (!meta) return void res.status(400).json({ error: `Unknown table: ${tableName}` });

  const db = getDb();

  // Enforce max 5 grouping presets per tab
  if (tableName === '_splan_grouping_presets' && rawData.tabKey) {
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM _splan_grouping_presets WHERE tab_key = ?').get(rawData.tabKey) as { cnt: number }).cnt;
    if (count >= 5) {
      return void res.status(400).json({ error: 'Maximum 5 grouping presets per tab' });
    }
  }
  // Enforce max 5 view presets per tab
  if (tableName === '_splan_view_presets' && rawData.tabKey) {
    const count = (db.prepare('SELECT COUNT(*) as cnt FROM _splan_view_presets WHERE tab_key = ?').get(rawData.tabKey) as { cnt: number }).cnt;
    if (count >= 5) {
      return void res.status(400).json({ error: 'Maximum 5 view presets per tab' });
    }
  }

  // Remove timestamps and nulls
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawData)) {
    if (k === 'createdAt' || k === 'updatedAt' || k === 'created_at' || k === 'updated_at') continue;
    if (v === null || v === undefined) continue;
    cleaned[k] = v;
  }

  // Auto-increment implementation_group for code changes
  if (tableName === '_splan_code_changes' && cleaned.implementationGroup === undefined) {
    const projectId = cleaned.projectId;
    const branch = cleaned.branch || 'primary_dev';
    const maxRow = db.prepare(
      'SELECT MAX(implementation_group) as maxGroup FROM _splan_code_changes WHERE project_id = ? AND branch = ?'
    ).get(projectId, branch) as { maxGroup: number | null } | undefined;
    cleaned.implementationGroup = ((maxRow?.maxGroup) ?? 0) + 1;
  }

  // Auto-cleanup stale dismissals when creating a code change record
  if (tableName === '_splan_code_changes' && cleaned.dependencies) {
    try {
      const deps = typeof cleaned.dependencies === 'string' ? JSON.parse(cleaned.dependencies) : cleaned.dependencies;
      if (Array.isArray(deps)) {
        for (const dep of deps as Array<{ type: string; id: number }>) {
          db.prepare('DELETE FROM _splan_test_staleness_dismissals WHERE entity_type = ? AND entity_id = ?').run(dep.type, dep.id);
        }
      }
    } catch { /* ignore parse errors */ }
  }

  const snakeData = prepareRow(cleaned);

  const cols = Object.keys(snakeData);
  const placeholders = cols.map(() => '?').join(', ');
  const values = Object.values(snakeData);

  const stmt = db.prepare(
    `INSERT INTO ${meta.sqlTable} (${cols.join(', ')}) VALUES (${placeholders})`
  );
  const info = stmt.run(...values);
  const newId = info.lastInsertRowid as number;

  // Log change (skip for grouping presets and change log itself)
  if (tableName !== '_splan_grouping_presets' && tableName !== '_splan_view_presets' && tableName !== '_splan_change_log') {
    logChange({
      entityType: meta.entityType,
      entityId: newId,
      action: 'INSERT',
      reasoning,
    });
  }

  const created = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(newId) as Record<string, unknown>;
  return void res.status(201).json(parseRow(created));
});

// ─── PUT /api/schema-planner ──────────────────────────────────────────────────
app.put('/api/schema-planner', (req: Request, res: Response) => {
  const { table: tableName, id, data: rawData, reasoning } = req.body as {
    table: string;
    id: number;
    data: Record<string, unknown>;
    reasoning?: string;
  };
  const meta = TABLE_MAP[tableName];
  if (!meta) return void res.status(400).json({ error: `Unknown table: ${tableName}` });

  const db = getDb();

  // Get old row for diffing
  const oldRow = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown> | undefined;
  if (!oldRow) return void res.status(404).json({ error: 'Row not found' });

  // Remove timestamps and nulls from update payload
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawData)) {
    if (k === 'createdAt' || k === 'created_at') continue;
    cleaned[k] = v;
  }

  // Always update updated_at for tables that have it
  cleaned.updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const snakeData = prepareRow(cleaned);

  // Remove id column from update data if present
  delete snakeData[meta.idCol];

  const setClauses = Object.keys(snakeData).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(snakeData), id];

  db.prepare(`UPDATE ${meta.sqlTable} SET ${setClauses} WHERE ${meta.idCol} = ?`).run(...values);

  // Diff and log changed fields
  if (tableName !== '_splan_grouping_presets' && tableName !== '_splan_view_presets' && tableName !== '_splan_change_log') {
    for (const [snakeKey, newVal] of Object.entries(snakeData)) {
      if (snakeKey === 'updated_at') continue;
      if (snakeKey === 'github_pat') continue; // Never log PAT values
      const oldVal = oldRow[snakeKey];
      const oldStr = oldVal === null || oldVal === undefined ? '' : String(oldVal);
      const newStr = newVal === null || newVal === undefined ? '' : String(newVal);
      if (oldStr !== newStr) {
        logChange({
          entityType: meta.entityType,
          entityId: id,
          action: 'UPDATE',
          fieldChanged: snakeKey,
          oldValue: oldVal,
          newValue: newVal,
          reasoning,
        });
      }
    }
  }

  const updated = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown>;
  return void res.json(parseRow(updated));
});

// ─── DELETE /api/schema-planner ───────────────────────────────────────────────
app.delete('/api/schema-planner', (req: Request, res: Response) => {
  const { table: tableName, id, reasoning } = req.body as {
    table: string;
    id: number;
    reasoning?: string;
  };
  const meta = TABLE_MAP[tableName];
  if (!meta) return void res.status(400).json({ error: `Unknown table: ${tableName}` });

  const db = getDb();

  const existing = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id);
  if (!existing) return void res.status(404).json({ error: 'Row not found' });

  db.prepare(`DELETE FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).run(id);

  if (tableName !== '_splan_grouping_presets' && tableName !== '_splan_view_presets' && tableName !== '_splan_change_log') {
    logChange({
      entityType: meta.entityType,
      entityId: id,
      action: 'DELETE',
      reasoning,
    });
  }

  return void res.json({ success: true });
});

// ─── Column Definitions (user-added columns) ────────────────────────────────

const ENTITY_SQL_TABLE: Record<string, string> = {
  modules: '_splan_modules', features: '_splan_features', concepts: '_splan_concepts',
  data_tables: '_splan_data_tables', data_fields: '_splan_data_fields',
  projects: '_splan_projects', research: '_splan_research', prototypes: '_splan_prototypes',
};

app.get('/api/column-defs', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM _splan_column_defs ORDER BY entity_type, sort_order').all() as Record<string, unknown>[];
  return void res.json(rows.map(parseRow));
});

app.post('/api/column-defs', (req: Request, res: Response) => {
  const { entityType, columnKey, label, columnType, options, formula } = req.body as {
    entityType: string;
    columnKey: string;
    label: string;
    columnType: string;
    options?: string[];
    formula?: string;
  };

  const sqlTable = ENTITY_SQL_TABLE[entityType];
  if (!sqlTable) return void res.status(400).json({ error: `Unknown entity type: ${entityType}` });
  if (!columnKey || !label) return void res.status(400).json({ error: 'columnKey and label are required' });
  if (columnType === 'formula' && !formula?.trim()) return void res.status(400).json({ error: 'Formula expression is required' });

  const db = getDb();

  // Check for duplicate column key
  const existing = db.prepare('SELECT id FROM _splan_column_defs WHERE entity_type = ? AND column_key = ?').get(entityType, columnKey);
  if (existing) return void res.status(409).json({ error: `Column "${columnKey}" already exists for ${entityType}` });

  // Get next sort order
  const maxRow = db.prepare('SELECT MAX(sort_order) as mx FROM _splan_column_defs WHERE entity_type = ?').get(entityType) as { mx: number | null };
  const sortOrder = ((maxRow?.mx) ?? -1) + 1;

  // Formula columns are virtual (computed client-side) — no real DB column needed
  if (columnType !== 'formula') {
    const sqlType = columnType === 'int' ? 'INTEGER' : columnType === 'boolean' ? "INTEGER NOT NULL DEFAULT 0" : "TEXT NOT NULL DEFAULT ''";
    try {
      db.exec(`ALTER TABLE ${sqlTable} ADD COLUMN ${columnKey} ${sqlType}`);
    } catch {
      // Column may already exist from a previous partial creation
    }
  }

  // Insert the definition
  const info = db.prepare(
    'INSERT INTO _splan_column_defs (entity_type, column_key, label, column_type, options, formula, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(entityType, columnKey, label, columnType || 'text', JSON.stringify(options || []), formula || '', sortOrder);

  const created = db.prepare('SELECT * FROM _splan_column_defs WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
  return void res.status(201).json(parseRow(created));
});

app.delete('/api/column-defs/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const db = getDb();

  const def = db.prepare('SELECT * FROM _splan_column_defs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!def) return void res.status(404).json({ error: 'Column definition not found' });

  const sqlTable = ENTITY_SQL_TABLE[def.entity_type as string];

  // Drop the column from the actual table (formula columns have no real DB column)
  if (sqlTable && def.column_type !== 'formula') {
    try {
      db.exec(`ALTER TABLE ${sqlTable} DROP COLUMN ${def.column_key}`);
    } catch {
      // Column may not exist or SQLite version doesn't support DROP COLUMN
    }
  }

  db.prepare('DELETE FROM _splan_column_defs WHERE id = ?').run(id);
  return void res.json({ success: true });
});

// ─── GET /api/schema-planner/counts ──────────────────────────────────────────
app.get('/api/schema-planner/counts', (_req: Request, res: Response) => {
  const db = getDb();
  const counts: Record<string, number> = {};
  for (const [key, meta] of Object.entries(TABLE_MAP)) {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${meta.sqlTable}`).get() as { cnt: number };
    counts[key] = row.cnt;
  }
  return void res.json(counts);
});

// ─── GET /api/schema-planner/matrix ──────────────────────────────────────────
app.get('/api/schema-planner/matrix', (_req: Request, res: Response) => {
  const db = getDb();
  const tables = (db.prepare('SELECT * FROM _splan_data_tables').all() as Record<string, unknown>[]).map(parseRow);
  const rules = (db.prepare('SELECT * FROM _splan_data_access_rules').all() as Record<string, unknown>[]).map(parseRow);

  const rulesByTableId: Record<number, unknown[]> = {};
  for (const rule of rules) {
    const tId = (rule as Record<string, unknown>).tableId as number;
    if (!rulesByTableId[tId]) rulesByTableId[tId] = [];
    rulesByTableId[tId].push(rule);
  }

  // Build dimensions from existing rules
  const businessTypes = [...new Set(rules.map(r => (r as Record<string, unknown>).businessType as string).filter(Boolean))];
  const roles = [...new Set(rules.map(r => (r as Record<string, unknown>).role as string).filter(Boolean))];
  const userTypes = [...new Set(rules.map(r => (r as Record<string, unknown>).userType as string).filter(Boolean))];
  const tiersRaw = rules.flatMap(r => {
    const r_ = r as Record<string, unknown>;
    const tiers: number[] = [];
    if (typeof r_.tierMin === 'number') tiers.push(r_.tierMin);
    if (typeof r_.tierMax === 'number') tiers.push(r_.tierMax);
    return tiers;
  });
  const tiers = [...new Set(tiersRaw)].sort((a, b) => a - b);
  const swimlanes = [...new Set(rules.map(r => (r as Record<string, unknown>).swimlane as string).filter(Boolean))];

  const matrixTables = tables.map(t => ({
    ...(t as Record<string, unknown>),
    rules: rulesByTableId[(t as Record<string, unknown>).tableId as number] ?? [],
  }));

  return void res.json({
    tables: matrixTables,
    dimensions: { businessTypes, roles, userTypes, tiers, swimlanes },
  });
});

// ─── GET /api/schema-planner/feature-impact ──────────────────────────────────
app.get('/api/schema-planner/feature-impact', (req: Request, res: Response) => {
  const featureId = Number(req.query.featureId);
  if (!featureId) return void res.status(400).json({ error: 'featureId required' });

  const db = getDb();
  const feature = db.prepare('SELECT * FROM _splan_features WHERE feature_id = ?').get(featureId) as Record<string, unknown> | undefined;
  if (!feature) return void res.status(404).json({ error: 'Feature not found' });

  const parsed = parseRow(feature);
  const tableIds: number[] = Array.isArray(parsed.dataTables) ? (parsed.dataTables as number[]) : [];
  const fieldIds: number[] = Array.isArray(parsed.dataFields) ? (parsed.dataFields as number[]) : [];

  const linkedTables = tableIds.length > 0
    ? (db.prepare(`SELECT * FROM _splan_data_tables WHERE table_id IN (${tableIds.map(() => '?').join(',')})`).all(...tableIds) as Record<string, unknown>[]).map(parseRow)
    : [];

  const linkedFields = fieldIds.length > 0
    ? (db.prepare(`SELECT * FROM _splan_data_fields WHERE field_id IN (${fieldIds.map(() => '?').join(',')})`).all(...fieldIds) as Record<string, unknown>[]).map(parseRow)
    : [];

  const rules = tableIds.length > 0
    ? (db.prepare(`SELECT * FROM _splan_data_access_rules WHERE table_id IN (${tableIds.map(() => '?').join(',')})`).all(...tableIds) as Record<string, unknown>[]).map(parseRow)
    : [];

  // Group rules by tableId so each table carries its own rules
  const rulesByTableId: Record<number, Record<string, unknown>[]> = {};
  for (const rule of rules) {
    const tId = (rule as Record<string, unknown>).tableId as number;
    if (!rulesByTableId[tId]) rulesByTableId[tId] = [];
    rulesByTableId[tId].push(rule as Record<string, unknown>);
  }

  const tables = linkedTables.map(t => ({
    ...(t as Record<string, unknown>),
    rules: rulesByTableId[(t as Record<string, unknown>).tableId as number] ?? [],
  }));

  // Gaps: tables with no access rules
  const gaps = tables.filter(t => (t.rules as unknown[]).length === 0);

  const existingReview = db.prepare('SELECT * FROM _splan_feature_data_reviews WHERE feature_id = ?').get(featureId) as Record<string, unknown> | undefined;

  return void res.json({
    feature: parsed,
    tables,
    linkedFields,
    gaps,
    review: existingReview ? parseRow(existingReview) : null,
  });
});

// ─── POST /api/schema-planner/upload-image ────────────────────────────────────
app.post('/api/schema-planner/upload-image', upload.single('image'), (req: Request, res: Response) => {
  if (!req.file) return void res.status(400).json({ error: 'No file uploaded' });

  const entityType = req.body?.entityType || 'features';
  const entityId = req.body?.entityId || req.body?.featureId || req.query?.featureId || 'misc';
  const filename = req.file.filename;
  const url = `/images/${entityType}/${entityId}/${filename}`;

  return void res.json({ url });
});

// ─── Discussion routes ────────────────────────────────────────────────────────

app.get('/api/discussions', (req: Request, res: Response) => {
  const { entityType, entityId } = req.query as { entityType: string; entityId: string };
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM _splan_discussions WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC'
  ).all(entityType, Number(entityId)) as Record<string, unknown>[];
  return void res.json(rows.map(parseRow));
});

app.post('/api/discussions', (req: Request, res: Response) => {
  const { entityType, entityId, title, content, source } = req.body as {
    entityType: string;
    entityId: number;
    title: string;
    content: string;
    source?: string;
  };
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO _splan_discussions (entity_type, entity_id, title, content, source) VALUES (?, ?, ?, ?, ?)'
  ).run(entityType, entityId, title, content, source ?? 'claude_code');
  const created = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
  return void res.status(201).json(parseRow(created));
});

app.put('/api/discussions/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { content, title } = req.body as { content?: string; title?: string };
  const db = getDb();
  const existing = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(id);
  if (!existing) return void res.status(404).json({ error: 'Discussion not found' });

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

app.delete('/api/discussions/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const db = getDb();
  const existing = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(id);
  if (!existing) return void res.status(404).json({ error: 'Discussion not found' });
  db.prepare('DELETE FROM _splan_discussions WHERE discussion_id = ?').run(id);
  return void res.json({ success: true });
});

// ─── POST /api/projects/github-sync ─────────────────────────────────────────
app.post('/api/projects/github-sync', async (req: Request, res: Response) => {
  const db = getDb();
  const { projectId } = req.body as { projectId?: number };
  const globalPat = (req.headers['x-github-pat'] as string | undefined) || readGithubConfig().pat;

  const projects = projectId
    ? [db.prepare('SELECT * FROM _splan_projects WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined].filter(Boolean) as Record<string, unknown>[]
    : (db.prepare("SELECT * FROM _splan_projects WHERE status = 'active' AND github_repo IS NOT NULL AND github_repo != ''").all() as Record<string, unknown>[]);

  if (projects.length === 0) return void res.json({ synced: 0, errors: [], rateLimitRemaining: null });

  let totalSynced = 0;
  const errors: string[] = [];
  let rateLimitRemaining: number | null = null;

  const branchTypes = [
    { key: 'live', nameCol: 'branch_live_name', shaCol: 'last_synced_sha_live' },
    { key: 'primary_dev', nameCol: 'branch_primary_name', shaCol: 'last_synced_sha_primary' },
    { key: 'secondary_dev', nameCol: 'branch_secondary_name', shaCol: 'last_synced_sha_secondary' },
  ];

  for (const proj of projects) {
    const pat = (proj.github_pat as string) || globalPat;
    if (!pat) { errors.push(`Project ${proj.project_id}: no PAT configured`); continue; }

    const repo = proj.github_repo as string;
    const headers: Record<string, string> = {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SchemaPlanner',
    };

    for (const bt of branchTypes) {
      const branchName = proj[bt.nameCol] as string;
      const lastSha = proj[bt.shaCol] as string | null;

      try {
        const commitsRes = await fetch(
          `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branchName)}&per_page=30`,
          { headers }
        );
        rateLimitRemaining = Number(commitsRes.headers.get('X-RateLimit-Remaining') ?? rateLimitRemaining);
        if (rateLimitRemaining !== null && rateLimitRemaining < 50) {
          errors.push(`Rate limit low (${rateLimitRemaining} remaining), stopping sync`);
          break;
        }
        if (!commitsRes.ok) {
          // 404/409 = branch doesn't exist or repo is empty — skip silently
          if (commitsRes.status === 404 || commitsRes.status === 409) continue;
          errors.push(`Project ${proj.project_id} branch ${branchName}: ${commitsRes.status} ${commitsRes.statusText}`);
          continue;
        }

        const commits = await commitsRes.json() as Array<{ sha: string; commit: { message: string; author: { date: string } } }>;

        // Filter to commits newer than last synced SHA
        let newCommits = commits;
        if (lastSha) {
          const idx = commits.findIndex(c => c.sha === lastSha);
          newCommits = idx > 0 ? commits.slice(0, idx) : (idx === 0 ? [] : commits);
        }
        // Cap at 50 commits per sync
        newCommits = newCommits.slice(0, 50);

        let newestSha = lastSha;
        for (const commit of newCommits.reverse()) {
          // Check if commit already exists
          const exists = db.prepare(
            'SELECT 1 FROM _splan_code_changes WHERE github_commit_hash = ? AND project_id = ?'
          ).get(commit.sha, proj.project_id);
          if (exists) { newestSha = commit.sha; continue; }

          // Fetch changed files
          let fileLocations = '';
          try {
            const detailRes = await fetch(
              `https://api.github.com/repos/${repo}/commits/${commit.sha}`,
              { headers }
            );
            if (detailRes.ok) {
              const detail = await detailRes.json() as { files?: Array<{ filename: string }> };
              fileLocations = (detail.files || []).map(f => f.filename).join('\n');
            }
            rateLimitRemaining = Number(detailRes.headers.get('X-RateLimit-Remaining') ?? rateLimitRemaining);
          } catch { /* ignore file fetch errors */ }

          // Auto-increment implementation_group
          const maxRow = db.prepare(
            'SELECT MAX(implementation_group) as maxGroup FROM _splan_code_changes WHERE project_id = ? AND branch = ?'
          ).get(proj.project_id, bt.key) as { maxGroup: number | null } | undefined;
          const implGroup = ((maxRow?.maxGroup) ?? 0) + 1;

          db.prepare(`
            INSERT INTO _splan_code_changes (project_id, branch, change_name, change_type, file_locations, implementation_group, github_commit_hash, github_commit_url, created_at)
            VALUES (?, ?, ?, 'Git Push', ?, ?, ?, ?, ?)
          `).run(
            proj.project_id,
            bt.key,
            commit.commit.message.split('\n')[0].substring(0, 200),
            fileLocations,
            implGroup,
            commit.sha,
            `https://github.com/${repo}/commit/${commit.sha}`,
            commit.commit.author.date
          );
          newestSha = commit.sha;
          totalSynced++;
        }

        // Update last synced SHA
        if (newestSha && newestSha !== lastSha) {
          db.prepare(`UPDATE _splan_projects SET ${bt.shaCol} = ? WHERE project_id = ?`).run(newestSha, proj.project_id);
        }
      } catch (e) {
        errors.push(`Project ${proj.project_id} branch ${branchName}: ${(e as Error).message}`);
      }
    }
    if (rateLimitRemaining !== null && rateLimitRemaining < 50) break;
  }

  return void res.json({ synced: totalSynced, errors, rateLimitRemaining });
});

// ─── GET /api/projects/dependency-tests ─────────────────────────────────────
app.get('/api/projects/dependency-tests', (req: Request, res: Response) => {
  const changeId = Number(req.query.changeId);
  if (!changeId) return void res.status(400).json({ error: 'changeId required' });

  const db = getDb();
  const changeRow = db.prepare('SELECT * FROM _splan_code_changes WHERE change_id = ?').get(changeId) as Record<string, unknown> | undefined;
  if (!changeRow) return void res.status(404).json({ error: 'Code change not found' });

  let deps: Array<{ type: string; id: number }> = [];
  try {
    deps = JSON.parse((changeRow.dependencies as string) || '[]');
  } catch { /* ignore */ }

  const resolved: Array<{ type: string; id: number; name: string }> = [];
  const testCases: Array<{ source: string; sourceId: number; sourceName: string; testId: number; testName: string; status: string }> = [];

  const typeConfig: Record<string, { table: string; idCol: string; nameCol: string; testTable?: string; testFk?: string }> = {
    module:     { table: '_splan_modules',     idCol: 'module_id',  nameCol: 'module_name',  testTable: '_splan_module_tests',  testFk: 'module_id' },
    feature:    { table: '_splan_features',    idCol: 'feature_id', nameCol: 'feature_name', testTable: '_splan_feature_tests', testFk: 'feature_id' },
    concept:    { table: '_splan_concepts',    idCol: 'concept_id', nameCol: 'concept_name', testTable: '_splan_concept_tests', testFk: 'concept_id' },
    data_table: { table: '_splan_data_tables', idCol: 'table_id',   nameCol: 'table_name' },
    data_field: { table: '_splan_data_fields', idCol: 'field_id',   nameCol: 'field_name' },
  };

  for (const dep of deps) {
    const cfg = typeConfig[dep.type];
    if (!cfg) continue;

    const entity = db.prepare(`SELECT ${cfg.nameCol} FROM ${cfg.table} WHERE ${cfg.idCol} = ?`).get(dep.id) as Record<string, unknown> | undefined;
    const name = entity ? String(entity[cfg.nameCol]) : `Unknown ${dep.type} #${dep.id}`;
    resolved.push({ type: dep.type, id: dep.id, name });

    if (cfg.testTable && cfg.testFk) {
      const tests = db.prepare(`SELECT * FROM ${cfg.testTable} WHERE ${cfg.testFk} = ?`).all(dep.id) as Record<string, unknown>[];
      for (const t of tests) {
        testCases.push({
          source: dep.type,
          sourceId: dep.id,
          sourceName: name,
          testId: t.test_id as number,
          testName: String(t.test_name || t.scenario || ''),
          status: String(t.status || 'pending'),
        });
      }
    }
  }

  return void res.json({ dependencies: resolved, testCases });
});

// ─── GET /api/projects/staleness-details ────────────────────────────────────
app.get('/api/projects/staleness-details', (req: Request, res: Response) => {
  const entityType = req.query.entityType as string;
  const entityId = Number(req.query.entityId);
  const sinceParam = req.query.since as string; // latest test update timestamp (fallback)

  if (!entityType || !entityId || !sinceParam) {
    return void res.status(400).json({ error: 'entityType, entityId, and since are required' });
  }

  const db = getDb();

  // Find the latest code change record that references this entity as a dependency
  // Use its created_at as the cutoff instead of test update time
  let since = sinceParam;
  let latestCodeChangeAt: string | null = null;
  try {
    const allChanges = db.prepare(
      'SELECT created_at, dependencies FROM _splan_code_changes ORDER BY created_at DESC'
    ).all() as Array<{ created_at: string; dependencies: string }>;
    for (const cc of allChanges) {
      let deps: Array<{ type: string; id: number }> = [];
      try { deps = JSON.parse(cc.dependencies || '[]'); } catch { /* ignore */ }
      if (Array.isArray(deps) && deps.some(d => d.type === entityType && d.id === entityId)) {
        latestCodeChangeAt = cc.created_at;
        break;
      }
    }
    if (latestCodeChangeAt && latestCodeChangeAt > since) {
      since = latestCodeChangeAt;
    }
  } catch { /* ignore — table might not exist yet */ }

  // Map entity type to change_log entity_type values
  const entityTypeMap: Record<string, string> = {
    feature: 'feature', module: 'module', concept: 'concept',
    data_table: 'table', data_field: 'field',
  };
  const logEntityType = entityTypeMap[entityType] || entityType;

  // 1. Get direct changes to this entity since the timestamp
  const directChanges = db.prepare(
    `SELECT id, entity_type, entity_id, action, field_changed, old_value, new_value, changed_at
     FROM _splan_change_log
     WHERE entity_type = ? AND entity_id = ? AND changed_at > ?
     ORDER BY changed_at DESC`
  ).all(logEntityType, entityId, since) as Array<Record<string, unknown>>;

  // 2. Get referenced entities from the entity's notes (for features/concepts)
  // Look up data_tables and data_fields referenced via FK arrays
  const refChanges: Array<Record<string, unknown>> = [];
  const referencedEntities: Array<{ type: string; id: number; name: string }> = [];

  if (entityType === 'feature') {
    const feature = db.prepare('SELECT data_tables, data_fields, modules FROM _splan_features WHERE feature_id = ?').get(entityId) as Record<string, unknown> | undefined;
    if (feature) {
      // Parse JSON FK arrays
      const parseIds = (val: unknown): number[] => {
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
        return [];
      };
      const tableIds = parseIds(feature.data_tables);
      const fieldIds = parseIds(feature.data_fields);
      const moduleIds = parseIds(feature.modules);

      for (const tid of tableIds) {
        const t = db.prepare('SELECT table_name FROM _splan_data_tables WHERE table_id = ?').get(tid) as Record<string, unknown> | undefined;
        if (t) referencedEntities.push({ type: 'data_table', id: tid, name: String(t.table_name) });
        const changes = db.prepare(
          `SELECT id, entity_type, entity_id, action, field_changed, old_value, new_value, changed_at
           FROM _splan_change_log WHERE entity_type = 'table' AND entity_id = ? AND changed_at > ? ORDER BY changed_at DESC`
        ).all(tid, since) as Array<Record<string, unknown>>;
        refChanges.push(...changes);
      }
      for (const fid of fieldIds) {
        const f = db.prepare('SELECT field_name FROM _splan_data_fields WHERE field_id = ?').get(fid) as Record<string, unknown> | undefined;
        if (f) referencedEntities.push({ type: 'data_field', id: fid, name: String(f.field_name) });
        const changes = db.prepare(
          `SELECT id, entity_type, entity_id, action, field_changed, old_value, new_value, changed_at
           FROM _splan_change_log WHERE entity_type = 'field' AND entity_id = ? AND changed_at > ? ORDER BY changed_at DESC`
        ).all(fid, since) as Array<Record<string, unknown>>;
        refChanges.push(...changes);
      }
      for (const mid of moduleIds) {
        const m = db.prepare('SELECT module_name FROM _splan_modules WHERE module_id = ?').get(mid) as Record<string, unknown> | undefined;
        if (m) referencedEntities.push({ type: 'module', id: mid, name: String(m.module_name) });
        const changes = db.prepare(
          `SELECT id, entity_type, entity_id, action, field_changed, old_value, new_value, changed_at
           FROM _splan_change_log WHERE entity_type = 'module' AND entity_id = ? AND changed_at > ? ORDER BY changed_at DESC`
        ).all(mid, since) as Array<Record<string, unknown>>;
        refChanges.push(...changes);
      }
    }
  } else if (entityType === 'concept') {
    const concept = db.prepare('SELECT features, modules, data_tables FROM _splan_concepts WHERE concept_id = ?').get(entityId) as Record<string, unknown> | undefined;
    if (concept) {
      const parseIds = (val: unknown): number[] => {
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
        return [];
      };
      for (const tid of parseIds(concept.data_tables)) {
        const t = db.prepare('SELECT table_name FROM _splan_data_tables WHERE table_id = ?').get(tid) as Record<string, unknown> | undefined;
        if (t) referencedEntities.push({ type: 'data_table', id: tid, name: String(t.table_name) });
        const changes = db.prepare(
          `SELECT id, entity_type, entity_id, action, field_changed, old_value, new_value, changed_at FROM _splan_change_log WHERE entity_type = 'table' AND entity_id = ? AND changed_at > ? ORDER BY changed_at DESC`
        ).all(tid, since) as Array<Record<string, unknown>>;
        refChanges.push(...changes);
      }
      for (const mid of parseIds(concept.modules)) {
        const m = db.prepare('SELECT module_name FROM _splan_modules WHERE module_id = ?').get(mid) as Record<string, unknown> | undefined;
        if (m) referencedEntities.push({ type: 'module', id: mid, name: String(m.module_name) });
        const changes = db.prepare(
          `SELECT id, entity_type, entity_id, action, field_changed, old_value, new_value, changed_at FROM _splan_change_log WHERE entity_type = 'module' AND entity_id = ? AND changed_at > ? ORDER BY changed_at DESC`
        ).all(mid, since) as Array<Record<string, unknown>>;
        refChanges.push(...changes);
      }
    }
  }

  // 3. Get existing dismissals for this entity's tests
  const dismissals = db.prepare(
    'SELECT change_log_id, test_id FROM _splan_test_staleness_dismissals WHERE entity_type = ? AND entity_id = ?'
  ).all(entityType, entityId) as Array<{ change_log_id: number; test_id: number }>;

  const dismissedSet = new Set(dismissals.map(d => `${d.change_log_id}:${d.test_id}`));
  // Row-level dismissals use test_id = 0
  const dismissedRowIds = new Set(dismissals.filter(d => d.test_id === 0).map(d => d.change_log_id));

  // 4. Cleanup: delete dismissals for change_log entries older than our cutoff
  const allChangeIds = [...directChanges, ...refChanges].map(c => c.id as number);
  if (allChangeIds.length > 0) {
    const existingDismissalIds = dismissals.map(d => d.change_log_id);
    const staleIds = existingDismissalIds.filter(id => !allChangeIds.includes(id));
    if (staleIds.length > 0) {
      db.prepare(
        `DELETE FROM _splan_test_staleness_dismissals WHERE entity_type = ? AND entity_id = ? AND change_log_id IN (${staleIds.join(',')})`
      ).run(entityType, entityId);
    }
  }

  return void res.json({
    directChanges: directChanges.map(parseRow),
    referenceChanges: refChanges.map(parseRow),
    referencedEntities,
    dismissedPairs: [...dismissedSet],
    dismissedRowIds: [...dismissedRowIds],
    sinceTimestamp: since,
    latestCodeChangeAt,
  });
});

// ─── POST/DELETE /api/projects/staleness-dismiss ────────────────────────────
app.post('/api/projects/staleness-dismiss', (req: Request, res: Response) => {
  const { entityType, entityId, changeLogId, testId } = req.body as { entityType: string; entityId: number; changeLogId: number; testId: number };
  const db = getDb();
  try {
    db.prepare(
      'INSERT OR IGNORE INTO _splan_test_staleness_dismissals (entity_type, entity_id, change_log_id, test_id) VALUES (?, ?, ?, ?)'
    ).run(entityType, entityId, changeLogId, testId);
  } catch { /* ignore duplicates */ }
  return void res.json({ success: true });
});

app.delete('/api/projects/staleness-dismiss', (req: Request, res: Response) => {
  const { changeLogId, testId } = req.body as { changeLogId: number; testId: number };
  const db = getDb();
  db.prepare('DELETE FROM _splan_test_staleness_dismissals WHERE change_log_id = ? AND test_id = ?').run(changeLogId, testId);
  return void res.json({ success: true });
});

// ─── GitHub config (PAT stored in local file, not browser) ──────────────────
const GITHUB_CONFIG_PATH = path.join(__dirname, '..', '.github-config.json');

function readGithubConfig(): { pat: string } {
  try {
    if (fs.existsSync(GITHUB_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(GITHUB_CONFIG_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return { pat: '' };
}

function writeGithubConfig(config: { pat: string }) {
  fs.writeFileSync(GITHUB_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

app.get('/api/projects/github-config', (_req: Request, res: Response) => {
  const config = readGithubConfig();
  return void res.json({
    hasToken: !!config.pat,
    preview: config.pat ? config.pat.substring(0, 7) + '...' + config.pat.substring(config.pat.length - 4) : '',
  });
});

app.put('/api/projects/github-config', (req: Request, res: Response) => {
  const { pat } = req.body as { pat: string };
  writeGithubConfig({ pat: pat ?? '' });
  return void res.json({ success: true });
});

// ─── GET /api/projects/github-repos — list user's GitHub repos ──────────────
app.get('/api/projects/github-repos', async (_req: Request, res: Response) => {
  const pat = readGithubConfig().pat;
  if (!pat) return void res.status(400).json({ error: 'No GitHub PAT configured. Add one in Settings.' });

  try {
    const ghRes = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', {
      headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'SchemaPlanner' },
    });
    if (!ghRes.ok) {
      const body = await ghRes.text();
      return void res.status(ghRes.status).json({ error: `GitHub API error: ${ghRes.status} ${body.substring(0, 200)}` });
    }
    const repos = await ghRes.json() as Array<{ full_name: string; name: string; description: string | null; private: boolean; html_url: string; default_branch: string; updated_at: string }>;
    // Return simplified list
    return void res.json(repos.map(r => ({
      fullName: r.full_name,
      name: r.name,
      description: r.description,
      isPrivate: r.private,
      url: r.html_url,
      defaultBranch: r.default_branch,
      updatedAt: r.updated_at,
    })));
  } catch (e) {
    return void res.status(500).json({ error: (e as Error).message });
  }
});

// ─── POST /api/projects/github-repos — create a new repo on GitHub ──────────
app.post('/api/projects/github-repos', async (req: Request, res: Response) => {
  const pat = readGithubConfig().pat;
  if (!pat) return void res.status(400).json({ error: 'No GitHub PAT configured. Add one in Settings.' });

  const { name, description, isPrivate } = req.body as { name: string; description?: string; isPrivate?: boolean };
  if (!name) return void res.status(400).json({ error: 'Repository name is required' });

  try {
    const ghRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'SchemaPlanner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || '', private: isPrivate !== false, auto_init: true }),
    });
    if (!ghRes.ok) {
      const body = await ghRes.text();
      return void res.status(ghRes.status).json({ error: `GitHub API error: ${ghRes.status} ${body.substring(0, 200)}` });
    }
    const repo = await ghRes.json() as { full_name: string; name: string; html_url: string; default_branch: string };
    return void res.json({ fullName: repo.full_name, name: repo.name, url: repo.html_url, defaultBranch: repo.default_branch });
  } catch (e) {
    return void res.status(500).json({ error: (e as Error).message });
  }
});

// ─── Agent infrastructure (file-based in .splan/) ───────────────────────────
const PROJECT_DIR = path.resolve(__dirname, '..');
const SPLAN_DIR = path.join(PROJECT_DIR, '.splan');
const AGENT_CONFIG_FILE = path.join(SPLAN_DIR, 'agent-configs.json');
const AGENT_HISTORY_FILE = path.join(SPLAN_DIR, 'agent-history.json');
const AGENT_RESULTS_DIR = path.join(SPLAN_DIR, 'agent-results');
const AGENT_SCHEDULES_FILE = path.join(SPLAN_DIR, 'agent-schedules.json');
const HISTORY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function ensureSplanDir() { fs.mkdirSync(SPLAN_DIR, { recursive: true }); }
function ensureResultsDir() { fs.mkdirSync(AGENT_RESULTS_DIR, { recursive: true }); }

function readJson<T>(filePath: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function generateRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `run-${ts}-${rand}`;
}

function pruneResults() {
  try {
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    const files = fs.readdirSync(AGENT_RESULTS_DIR);
    for (const file of files) {
      const fp = path.join(AGENT_RESULTS_DIR, file);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(fp);
    }
  } catch { /* dir may not exist yet */ }
}

// ─── Agent launcher ──────────────────────────────────────────────────────────
app.post('/api/agents/launch', (req: Request, res: Response) => {
  const { agentName, prompt, runId } = req.body as { agentName?: string; prompt?: string; runId?: string };
  if (!prompt || typeof prompt !== 'string') {
    return void res.status(400).json({ error: 'prompt is required' });
  }

  const id = runId || generateRunId();
  const tmpDir = path.join(os.tmpdir(), 'splan-agents');
  fs.mkdirSync(tmpDir, { recursive: true });

  const safeTitle = (agentName || 'Agent').replace(/[&|<>^%"]/g, '');

  const stamp = Date.now();
  const promptFile = path.join(tmpDir, `prompt-${stamp}.txt`);
  fs.writeFileSync(promptFile, prompt, 'utf-8');

  const ps1File = path.join(tmpDir, `launch-${stamp}.ps1`);
  fs.writeFileSync(ps1File, [
    `$Host.UI.RawUI.WindowTitle = '${safeTitle}'`,
    `Set-Location '${PROJECT_DIR.replace(/'/g, "''")}'`,
    `Get-Content '${promptFile.replace(/'/g, "''")}' -Raw -Encoding UTF8 | claude -p`,
    `Write-Host ''`,
    `Read-Host 'Press Enter to close'`,
  ].join('\r\n'), 'utf-8');

  exec(`start powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1File}"`, { shell: 'cmd.exe' }, (err) => {
    if (err) {
      console.error('Agent launch failed:', err.message);
      return void res.status(500).json({ error: err.message });
    }
    return void res.json({ launched: true, runId: id });
  });
});

// GET /api/agents/config — read custom prompt overrides
app.get('/api/agents/config', (_req: Request, res: Response) => {
  return void res.json(readJson<Record<string, unknown>>(AGENT_CONFIG_FILE, {}));
});

// PUT /api/agents/config — save custom prompt overrides
app.put('/api/agents/config', (req: Request, res: Response) => {
  ensureSplanDir();
  fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf-8');
  return void res.json({ saved: true });
});

// GET /api/agents/history — read execution history (auto-prunes > 90 days)
app.get('/api/agents/history', (_req: Request, res: Response) => {
  const raw = readJson<{ ts: number }[]>(AGENT_HISTORY_FILE, []);
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  const pruned = raw.filter((e) => e.ts >= cutoff);
  if (pruned.length < raw.length) {
    ensureSplanDir();
    fs.writeFileSync(AGENT_HISTORY_FILE, JSON.stringify(pruned, null, 2), 'utf-8');
    pruneResults();
  }
  return void res.json(pruned);
});

// POST /api/agents/history — log an execution
app.post('/api/agents/history', (req: Request, res: Response) => {
  ensureSplanDir();
  const history = readJson<Record<string, unknown>[]>(AGENT_HISTORY_FILE, []);
  history.unshift({ ...req.body, ts: Date.now() });
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  const pruned = history.filter((e) => (e.ts as number) >= cutoff);
  fs.writeFileSync(AGENT_HISTORY_FILE, JSON.stringify(pruned, null, 2), 'utf-8');
  return void res.json({ logged: true });
});

// GET /api/agents/results/:runId — read results for a specific run
app.get('/api/agents/results/:runId', (req: Request, res: Response) => {
  const fp = path.join(AGENT_RESULTS_DIR, `${req.params.runId}.json`);
  const data = readJson<null>(fp, null);
  if (!data) return void res.json({ found: false });
  return void res.json({ found: true, data });
});

// PUT /api/agents/results/:runId — manually write results for a run
app.put('/api/agents/results/:runId', (req: Request, res: Response) => {
  ensureResultsDir();
  const fp = path.join(AGENT_RESULTS_DIR, `${req.params.runId}.json`);
  fs.writeFileSync(fp, JSON.stringify({ ...req.body, completedAt: Date.now() }, null, 2), 'utf-8');
  return void res.json({ saved: true });
});

// ─── Agent schedules ─────────────────────────────────────────────────────────

// GET /api/agents/schedules — read all saved schedules
app.get('/api/agents/schedules', (_req: Request, res: Response) => {
  return void res.json(readJson<Record<string, unknown>>(AGENT_SCHEDULES_FILE, {}));
});

// POST /api/agents/schedules — create or update a schedule via claude CLI
app.post('/api/agents/schedules', async (req: Request, res: Response) => {
  const { agentId, agentName, config, prompt } = req.body as {
    agentId?: string;
    agentName?: string;
    config?: { cronExpression: string; cronLabel: string; promptOverride?: string; paramDefaults?: Record<string, string>; triggerId?: string };
    prompt?: string;
  };
  if (!agentId || !config?.cronExpression || !prompt) {
    return void res.status(400).json({ error: 'agentId, config.cronExpression, and prompt are required' });
  }

  // If updating, remove the old trigger first
  if (config.triggerId) {
    try {
      await new Promise<void>((resolve) => {
        exec(`claude schedule delete ${config.triggerId}`, { shell: 'cmd.exe', cwd: PROJECT_DIR }, () => resolve());
      });
    } catch { /* old trigger may already be gone */ }
  }

  // Create the schedule via claude CLI
  const safePrompt = prompt
    .replace(/%/g, '%%')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '\\"');

  const scheduleCmd = `claude schedule create --name "${(agentName || agentId).replace(/"/g, '')}" --cron "${config.cronExpression}" --prompt "${safePrompt}"`;

  exec(scheduleCmd, { shell: 'cmd.exe', cwd: PROJECT_DIR }, (err, stdout, stderr) => {
    if (err) {
      console.error('Schedule create failed:', err.message, stderr);
      return void res.status(500).json({ error: `Schedule creation failed: ${err.message}` });
    }

    // Parse trigger ID from output (claude schedule create outputs the trigger info)
    let triggerId = '';
    const idMatch = stdout.match(/(?:trigger[_\s-]?id|id)[:\s]+([a-zA-Z0-9_-]+)/i);
    if (idMatch) {
      triggerId = idMatch[1];
    } else {
      // Fallback: use the full stdout trimmed as a reference
      triggerId = `splan-${agentId}-${Date.now().toString(36)}`;
    }

    // Persist the schedule config
    ensureSplanDir();
    const schedules = readJson<Record<string, unknown>>(AGENT_SCHEDULES_FILE, {});
    schedules[agentId] = {
      cronExpression: config.cronExpression,
      cronLabel: config.cronLabel,
      promptOverride: config.promptOverride,
      paramDefaults: config.paramDefaults,
      triggerId,
      enabled: true,
      createdAt: new Date().toISOString(),
      cliOutput: stdout.trim(),
    };
    fs.writeFileSync(AGENT_SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf-8');

    return void res.json({ saved: true, triggerId });
  });
});

// DELETE /api/agents/schedules/:agentId — remove a schedule
app.delete('/api/agents/schedules/:agentId', (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { triggerId } = req.body as { triggerId?: string };

  const doRemove = () => {
    ensureSplanDir();
    const schedules = readJson<Record<string, unknown>>(AGENT_SCHEDULES_FILE, {});
    delete schedules[agentId];
    fs.writeFileSync(AGENT_SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf-8');
    return void res.json({ removed: true });
  };

  if (triggerId) {
    exec(`claude schedule delete ${triggerId}`, { shell: 'cmd.exe', cwd: PROJECT_DIR }, (err) => {
      if (err) console.error('Schedule delete warning:', err.message);
      // Remove from our file regardless — the trigger may have been manually deleted
      doRemove();
    });
  } else {
    doRemove();
  }
});

// ─── Production: serve built frontend ────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  // SPA fallback — serve index.html for non-API, non-auth routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3100', 10);
app.listen(PORT, () => {
  console.log(`Schema Planner API running on port ${PORT}`);
  getDb();
});
