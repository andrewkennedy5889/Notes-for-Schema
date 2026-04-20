import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { exec, execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';
import { parseRow, prepareRow, camelToSnake } from './utils.js';
import { authRouter, authMiddleware } from './auth.js';
import { getAppMode, requireLocal } from './app-mode.js';
import { getScheduledAgent, SCHEDULED_AGENTS } from './scheduled-agents/registry.js';
import { schemaFingerprint } from './schema-fingerprint.js';
import { extractDependencyRefs, DependencyRefType } from './text-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file in dev mode (no dependency needed)
if (process.env.NODE_ENV !== 'production') {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const IMAGE_STORAGE = process.env.IMAGE_STORAGE_PATH || path.join(__dirname, '..', 'Image Storage');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

// ─── Auth ────────────────────────────────────────────────────────────────────
app.use(authRouter);
app.use(authMiddleware);

// ─── App-mode config (local vs hosted) ───────────────────────────────────────
// Mode partitions dev-only features (shell-outs, filesystem writes, secret
// rotation) from the consumer-facing hosted surface. Any route that is unsafe
// to expose publicly must be wrapped in requireLocal.
app.get('/api/config', (_req: Request, res: Response) => {
  return void res.json({ mode: getAppMode() });
});

app.get('/api/claude-md-stats', requireLocal, (_req: Request, res: Response) => {
  const filePath = path.join(process.cwd(), 'CLAUDE.md');
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).length;
    return void res.json({ lines, bytes: stat.size, mtime: stat.mtimeMs, path: filePath });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return void res.status(404).json({ error: 'CLAUDE.md not found', path: filePath });
    return void res.status(500).json({ error: 'Failed to read CLAUDE.md' });
  }
});

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
  '_splan_feedback':              { sqlTable: '_splan_feedback',              idCol: 'feedback_id', idKey: 'feedbackId',      entityType: 'feedback' },
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

/** Look up the current display name for a ref. Returned name is cached on the
 *  dependency row so that if the target later moves/deletes, the stale row still
 *  renders something meaningful. Failures return null. */
function resolveRefName(refType: DependencyRefType, refId: string): string | null {
  const db = getDb();
  const n = Number(refId);
  try {
    switch (refType) {
      case 'Table':
        return (db.prepare('SELECT table_name FROM _splan_data_tables WHERE table_id = ?').get(n) as { table_name: string } | undefined)?.table_name ?? null;
      case 'Field':
        return (db.prepare(
          "SELECT t.table_name || '.' || f.field_name AS qname FROM _splan_data_fields f JOIN _splan_data_tables t ON t.table_id = f.data_table_id WHERE f.field_id = ?"
        ).get(n) as { qname: string } | undefined)?.qname ?? null;
      case 'Module':
        return (db.prepare('SELECT module_name FROM _splan_modules WHERE module_id = ?').get(n) as { module_name: string } | undefined)?.module_name ?? null;
      case 'Feature':
        return (db.prepare('SELECT feature_name FROM _splan_features WHERE feature_id = ?').get(n) as { feature_name: string } | undefined)?.feature_name ?? null;
      case 'Concept':
        return (db.prepare('SELECT concept_name FROM _splan_concepts WHERE concept_id = ?').get(n) as { concept_name: string } | undefined)?.concept_name ?? null;
      case 'Research':
        return (db.prepare('SELECT title FROM _splan_research WHERE research_id = ?').get(n) as { title: string } | undefined)?.title ?? null;
      case 'Image':
        return null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Sync the deps table with the refs present in a note. Called whenever a
 *  note's content changes.
 *
 *  Per PRD §5.3:
 *    - new refs  → INSERT auto_added=1, explanation='', last_analyzed_at=NULL
 *    - removed auto refs → UPDATE is_stale=1 (manual refs and user-edited rows survive)
 *    - previously-stale refs back in text → UPDATE is_stale=0
 *    - manual (auto_added=0) refs are never stale-marked — user owns them
 *
 *  Returns a summary string for the change-log entry. Callers log ONE entry
 *  per note save regardless of how many deps were touched (§D8).
 */
function syncDependencies(params: {
  entityType: string;
  entityId: number;
  noteKey: string;
  content: string | null;
}): { added: number; staled: number; unstaled: number } {
  const db = getDb();
  const { entityType, entityId, noteKey } = params;
  const refs = extractDependencyRefs(params.content);

  const existing = db.prepare(
    'SELECT * FROM _splan_entity_dependencies WHERE entity_type = ? AND entity_id = ? AND note_key = ?'
  ).all(entityType, entityId, noteKey) as Array<Record<string, unknown>>;

  const currentKeys = new Set(refs.map((r) => `${r.refType}:${r.refId}`));
  const existingByKey = new Map<string, Record<string, unknown>>();
  for (const row of existing) existingByKey.set(`${row.ref_type}:${row.ref_id}`, row);

  const insert = db.prepare(
    `INSERT INTO _splan_entity_dependencies
       (entity_type, entity_id, note_key, ref_type, ref_id, ref_name, explanation, auto_added)
     VALUES (?, ?, ?, ?, ?, ?, '', 1)`
  );
  const unstale = db.prepare(
    "UPDATE _splan_entity_dependencies SET is_stale = 0, updated_at = datetime('now') WHERE id = ?"
  );
  const stale = db.prepare(
    "UPDATE _splan_entity_dependencies SET is_stale = 1, updated_at = datetime('now') WHERE id = ?"
  );

  let added = 0;
  let staled = 0;
  let unstaled = 0;

  // Wrap all writes in a single transaction so a partial failure leaves the deps state consistent.
  const txn = db.transaction(() => {
    for (const r of refs) {
      const row = existingByKey.get(`${r.refType}:${r.refId}`);
      if (!row) {
        const refName = resolveRefName(r.refType, r.refId) ?? r.fallbackName;
        insert.run(entityType, entityId, noteKey, r.refType, r.refId, refName);
        added++;
      } else if (row.is_stale === 1) {
        unstale.run(row.id);
        unstaled++;
      }
    }
    for (const row of existing) {
      const key = `${row.ref_type}:${row.ref_id}`;
      if (currentKeys.has(key)) continue;
      if (row.auto_added !== 1) continue; // manual deps are user-owned
      if (row.is_stale === 1) continue;    // already stale
      stale.run(row.id);
      staled++;
    }
  });
  txn();

  return { added, staled, unstaled };
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

  // Cascade-delete any rich notes attached to this entity
  db.prepare('DELETE FROM _splan_entity_notes WHERE entity_type = ? AND entity_id = ?')
    .run(meta.entityType, id);
  db.prepare('DELETE FROM _splan_entity_dependencies WHERE entity_type = ? AND entity_id = ?')
    .run(meta.entityType, id);

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

  // Formula columns are virtual (computed client-side) — no real DB column needed.
  // Notes + dependencies columns store data in shared _splan_entity_* tables — no real DB column needed.
  if (columnType !== 'formula' && columnType !== 'notes' && columnType !== 'dependencies') {
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

  // Auto-pair: every custom Notes column gets a hidden-by-default Dependencies column right next to it.
  // Key convention is `{notesKey}_deps`. Per BUG-A6 the notesKey is uc_-prefixed client-side, so deps
  // inherit the same prefix automatically and survive mergeColumnDefs.
  if (columnType === 'notes') {
    const depsKey = `${columnKey}_deps`;
    const depsLabel = `${label} Dependencies`;
    const depsExists = db.prepare(
      'SELECT id FROM _splan_column_defs WHERE entity_type = ? AND column_key = ?'
    ).get(entityType, depsKey);
    if (!depsExists) {
      db.prepare(
        'INSERT INTO _splan_column_defs (entity_type, column_key, label, column_type, options, formula, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(entityType, depsKey, depsLabel, 'dependencies', '[]', '', sortOrder + 1);
    }
  }

  const created = db.prepare('SELECT * FROM _splan_column_defs WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
  return void res.status(201).json(parseRow(created));
});

app.delete('/api/column-defs/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const db = getDb();

  const def = db.prepare('SELECT * FROM _splan_column_defs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!def) return void res.status(404).json({ error: 'Column definition not found' });

  const sqlTable = ENTITY_SQL_TABLE[def.entity_type as string];

  // Drop the column from the actual table.
  // Formula/notes/dependencies columns are virtual — nothing to DROP COLUMN.
  if (sqlTable && def.column_type !== 'formula' && def.column_type !== 'notes' && def.column_type !== 'dependencies') {
    try {
      db.exec(`ALTER TABLE ${sqlTable} DROP COLUMN ${def.column_key}`);
    } catch {
      // Column may not exist or SQLite version doesn't support DROP COLUMN
    }
  }

  // For Notes columns, clean up the shared-store rows AND the auto-paired deps column_def.
  // Per D4, deletion is hard (no soft-delete window) and covers both the notes rows,
  // the deps rows, and the paired deps column_def.
  if (def.column_type === 'notes') {
    try {
      const entityType = (
        Object.entries({
          modules: 'module', features: 'feature', concepts: 'concept',
          data_tables: 'table', data_fields: 'field',
          projects: 'project', research: 'research', prototypes: 'prototype',
        }).find(([k]) => k === def.entity_type)?.[1]
      ) ?? String(def.entity_type);
      db.prepare('DELETE FROM _splan_entity_notes WHERE entity_type = ? AND note_key = ?')
        .run(entityType, def.column_key);
      db.prepare('DELETE FROM _splan_entity_dependencies WHERE entity_type = ? AND note_key = ?')
        .run(entityType, def.column_key);
      // Cascade the paired deps column_def (same entity, key = notesKey + '_deps').
      db.prepare('DELETE FROM _splan_column_defs WHERE entity_type = ? AND column_key = ?')
        .run(def.entity_type, `${def.column_key}_deps`);
    } catch { /* ignore */ }
  }

  db.prepare('DELETE FROM _splan_column_defs WHERE id = ?').run(id);
  return void res.json({ success: true });
});

// ─── Entity Notes (shared rich-notes store) ──────────────────────────────────
// Stores rich-text notes for any (entityType, entityId, noteKey) tuple.
// Used by built-in Notes columns and user-added 'notes'-typed custom columns.

app.get('/api/schema-planner/notes', (req: Request, res: Response) => {
  const entityType = String(req.query.entityType || '');
  const entityIdRaw = req.query.entityId;
  const noteKey = req.query.noteKey ? String(req.query.noteKey) : null;
  if (!entityType) return void res.status(400).json({ error: 'entityType required' });

  const db = getDb();

  // Batch by entity type only — returns all notes for the type (used to populate grid badge cache)
  if (entityIdRaw === undefined || entityIdRaw === '') {
    const rows = db.prepare(
      'SELECT * FROM _splan_entity_notes WHERE entity_type = ?'
    ).all(entityType) as Record<string, unknown>[];
    return void res.json(rows.map(parseRow));
  }

  const entityId = Number(entityIdRaw);
  if (!Number.isFinite(entityId) || entityId <= 0) return void res.status(400).json({ error: 'entityId must be a positive number (unsaved rows cannot have notes)' });

  if (noteKey) {
    const row = db.prepare(
      'SELECT * FROM _splan_entity_notes WHERE entity_type = ? AND entity_id = ? AND note_key = ?'
    ).get(entityType, entityId, noteKey) as Record<string, unknown> | undefined;
    if (!row) return void res.json(null);
    return void res.json(parseRow(row));
  }
  const rows = db.prepare(
    'SELECT * FROM _splan_entity_notes WHERE entity_type = ? AND entity_id = ?'
  ).all(entityType, entityId) as Record<string, unknown>[];
  return void res.json(rows.map(parseRow));
});

app.put('/api/schema-planner/notes', (req: Request, res: Response) => {
  const { entityType, entityId, noteKey = 'notes', content, notesFmt, collapsedSections, embeddedTables, reasoning } = req.body as {
    entityType: string;
    entityId: number;
    noteKey?: string;
    content?: string | null;
    notesFmt?: unknown;
    collapsedSections?: unknown;
    embeddedTables?: unknown;
    reasoning?: string;
  };
  if (!entityType) return void res.status(400).json({ error: 'entityType required' });
  if (!Number.isFinite(entityId) || entityId <= 0) return void res.status(400).json({ error: 'entityId must be a positive number (unsaved rows cannot have notes)' });

  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM _splan_entity_notes WHERE entity_type = ? AND entity_id = ? AND note_key = ?'
  ).get(entityType, entityId, noteKey) as Record<string, unknown> | undefined;

  const fmtJson = JSON.stringify(notesFmt ?? []);
  const collapsedJson = JSON.stringify(collapsedSections ?? {});
  const tablesJson = JSON.stringify(embeddedTables ?? {});
  const updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (existing) {
    db.prepare(
      'UPDATE _splan_entity_notes SET content = ?, notes_fmt = ?, collapsed_sections = ?, embedded_tables = ?, updated_at = ? WHERE id = ?'
    ).run(content ?? null, fmtJson, collapsedJson, tablesJson, updatedAt, existing.id);
  } else {
    db.prepare(
      'INSERT INTO _splan_entity_notes (entity_type, entity_id, note_key, content, notes_fmt, collapsed_sections, embedded_tables) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(entityType, entityId, noteKey, content ?? null, fmtJson, collapsedJson, tablesJson);
  }

  // Single change-log entry per save (covers content + formatting changes together).
  // Only log if anything actually changed.
  const oldContent = existing ? (existing.content ?? '') : '';
  const oldFmt = existing ? (existing.notes_fmt ?? '[]') : '[]';
  const oldCollapsed = existing ? (existing.collapsed_sections ?? '{}') : '{}';
  const oldTables = existing ? (existing.embedded_tables ?? '{}') : '{}';
  const newContent = content ?? '';
  const changed =
    String(oldContent) !== String(newContent) ||
    String(oldFmt) !== fmtJson ||
    String(oldCollapsed) !== collapsedJson ||
    String(oldTables) !== tablesJson;

  if (changed) {
    logChange({
      entityType,
      entityId,
      action: existing ? 'UPDATE' : 'INSERT',
      fieldChanged: noteKey,
      oldValue: oldContent,
      newValue: newContent,
      reasoning: reasoning ?? `Notes edit: ${noteKey}`,
    });
  }

  // Auto-extract refs from the new content and sync the paired deps table.
  // Only runs when the content (not just formatting) actually changed, since
  // formatting-only edits can't change which refs are present.
  if (String(oldContent) !== String(newContent)) {
    const summary = syncDependencies({ entityType, entityId, noteKey, content: newContent });
    const touched = summary.added + summary.staled + summary.unstaled;
    if (touched > 0) {
      const parts: string[] = [];
      if (summary.added) parts.push(`${summary.added} added`);
      if (summary.staled) parts.push(`${summary.staled} stale`);
      if (summary.unstaled) parts.push(`${summary.unstaled} un-stale`);
      logChange({
        entityType,
        entityId,
        action: 'UPDATE',
        fieldChanged: `${noteKey}_deps`,
        newValue: parts.join(', '),
        reasoning: `Auto-extract from notes edit: ${noteKey}`,
      });
    }
  }

  const fresh = db.prepare(
    'SELECT * FROM _splan_entity_notes WHERE entity_type = ? AND entity_id = ? AND note_key = ?'
  ).get(entityType, entityId, noteKey) as Record<string, unknown>;
  return void res.json(parseRow(fresh));
});

app.delete('/api/schema-planner/notes', (req: Request, res: Response) => {
  const { entityType, entityId, noteKey } = req.body as {
    entityType: string;
    entityId: number;
    noteKey?: string;
  };
  if (!entityType) return void res.status(400).json({ error: 'entityType required' });
  if (!Number.isFinite(entityId) || entityId <= 0) return void res.status(400).json({ error: 'entityId must be a positive number' });
  const db = getDb();
  if (noteKey) {
    db.prepare('DELETE FROM _splan_entity_notes WHERE entity_type = ? AND entity_id = ? AND note_key = ?')
      .run(entityType, entityId, noteKey);
  } else {
    db.prepare('DELETE FROM _splan_entity_notes WHERE entity_type = ? AND entity_id = ?')
      .run(entityType, entityId);
  }
  return void res.json({ success: true });
});

// ─── Entity Dependencies (paired with entity notes) ─────────────────────────
// Each note_key may have a set of dependency entries describing WHY the refs
// inside the note are deps of this (entityType, entityId). Auto-populated by
// note saves (next commit) and/or user/Claude edits.

app.get('/api/schema-planner/dependencies', (req: Request, res: Response) => {
  const entityType = req.query.entityType ? String(req.query.entityType) : null;
  const entityIdRaw = req.query.entityId;
  const noteKey = req.query.noteKey ? String(req.query.noteKey) : null;
  const refType = req.query.refType ? String(req.query.refType) : null;
  const refId = req.query.refId ? String(req.query.refId) : null;

  const db = getDb();

  // Reverse lookup: "who depends on this ref?"
  if (refType && refId) {
    const rows = db.prepare(
      'SELECT * FROM _splan_entity_dependencies WHERE ref_type = ? AND ref_id = ?'
    ).all(refType, refId) as Record<string, unknown>[];
    return void res.json(rows.map(parseRow));
  }

  if (!entityType) return void res.status(400).json({ error: 'entityType or (refType,refId) required' });

  // Batch by type only — for per-tab grid badge cache.
  if (entityIdRaw === undefined || entityIdRaw === '') {
    const rows = db.prepare(
      'SELECT * FROM _splan_entity_dependencies WHERE entity_type = ?'
    ).all(entityType) as Record<string, unknown>[];
    return void res.json(rows.map(parseRow));
  }

  const entityId = Number(entityIdRaw);
  if (!Number.isFinite(entityId) || entityId <= 0) {
    return void res.status(400).json({ error: 'entityId must be a positive number' });
  }

  if (noteKey) {
    const rows = db.prepare(
      'SELECT * FROM _splan_entity_dependencies WHERE entity_type = ? AND entity_id = ? AND note_key = ?'
    ).all(entityType, entityId, noteKey) as Record<string, unknown>[];
    return void res.json(rows.map(parseRow));
  }

  const rows = db.prepare(
    'SELECT * FROM _splan_entity_dependencies WHERE entity_type = ? AND entity_id = ?'
  ).all(entityType, entityId) as Record<string, unknown>[];
  return void res.json(rows.map(parseRow));
});

app.post('/api/schema-planner/dependencies', (req: Request, res: Response) => {
  const { entityType, entityId, noteKey, refType, refId, refName, explanation } = req.body as {
    entityType: string;
    entityId: number;
    noteKey: string;
    refType: string;
    refId: string | number;
    refName?: string | null;
    explanation?: string;
  };
  if (!entityType) return void res.status(400).json({ error: 'entityType required' });
  if (!Number.isFinite(entityId) || entityId <= 0) return void res.status(400).json({ error: 'entityId must be a positive number' });
  if (!noteKey) return void res.status(400).json({ error: 'noteKey required' });
  if (!refType) return void res.status(400).json({ error: 'refType required' });
  if (refId === undefined || refId === null || String(refId) === '') return void res.status(400).json({ error: 'refId required' });

  const db = getDb();
  const refIdStr = String(refId);
  const existing = db.prepare(
    'SELECT id FROM _splan_entity_dependencies WHERE entity_type = ? AND entity_id = ? AND note_key = ? AND ref_type = ? AND ref_id = ?'
  ).get(entityType, entityId, noteKey, refType, refIdStr) as { id: number } | undefined;
  if (existing) return void res.status(409).json({ error: 'Dependency already exists', id: existing.id });

  // Manual deps (auto_added=0) by default when created via this endpoint — auto-extract uses
  // the internal sync helper (next commit) with auto_added=1.
  const info = db.prepare(
    `INSERT INTO _splan_entity_dependencies
       (entity_type, entity_id, note_key, ref_type, ref_id, ref_name, explanation, auto_added)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(entityType, entityId, noteKey, refType, refIdStr, refName ?? null, explanation ?? '');

  const created = db.prepare('SELECT * FROM _splan_entity_dependencies WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
  return void res.status(201).json(parseRow(created));
});

app.put('/api/schema-planner/dependencies/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return void res.status(400).json({ error: 'Invalid id' });
  const { explanation, isStale, autoAdded } = req.body as {
    explanation?: string;
    isStale?: boolean;
    autoAdded?: boolean;
  };

  const db = getDb();
  const existing = db.prepare('SELECT * FROM _splan_entity_dependencies WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return void res.status(404).json({ error: 'Not found' });

  const updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const explanationChanged = explanation !== undefined && String(explanation) !== String(existing.explanation ?? '');
  const nextExplanation = explanation !== undefined ? explanation : (existing.explanation as string);
  const nextIsStale = isStale !== undefined ? (isStale ? 1 : 0) : (existing.is_stale as number);
  const nextAutoAdded = autoAdded !== undefined ? (autoAdded ? 1 : 0) : (existing.auto_added as number);
  const nextIsUserEdited = explanationChanged ? 1 : (existing.is_user_edited as number);
  // Per D6: when the user edits explanation, snapshot it in previous_user_edit so
  // the next Claude analyze pass can reconcile with the user's intent.
  const nextPreviousUserEdit = explanationChanged
    ? String(explanation)
    : (existing.previous_user_edit as string | null);

  db.prepare(
    `UPDATE _splan_entity_dependencies
       SET explanation = ?, is_stale = ?, is_user_edited = ?, auto_added = ?, previous_user_edit = ?, updated_at = ?
     WHERE id = ?`
  ).run(nextExplanation, nextIsStale, nextIsUserEdited, nextAutoAdded, nextPreviousUserEdit, updatedAt, id);

  const fresh = db.prepare('SELECT * FROM _splan_entity_dependencies WHERE id = ?').get(id) as Record<string, unknown>;
  return void res.json(parseRow(fresh));
});

app.delete('/api/schema-planner/dependencies/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return void res.status(400).json({ error: 'Invalid id' });
  const db = getDb();
  const info = db.prepare('DELETE FROM _splan_entity_dependencies WHERE id = ?').run(id);
  if (info.changes === 0) return void res.status(404).json({ error: 'Not found' });
  return void res.json({ success: true });
});

// ─── Dependencies analyze (Claude CLI, on-demand) ───────────────────────────
// Reads the note + its current deps, builds a prompt, runs `claude -p` headlessly,
// parses the returned JSON, and writes explanations into each matching dep row.
// Local-only — the hosted app has no Claude CLI access.

const DEFAULT_DEP_ANALYZER_PROMPT = `You are analyzing dependencies for {entityType} "{entityName}" in a database schema planning tool.

This entity has notes stored below. The notes mention several references to other entities (tables, fields, modules, features, concepts, research items). Your job is to write a short (max 20 words) explanation for each reference, saying WHY this {entityType} depends on that reference, based ONLY on the note context.

NOTE CONTENT:
{noteContent}

REFERENCES FOUND:
{refList}
{userEditsContextBlock}
Respond with JSON only, no prose:
{"dependencies": [{"refType": "...", "refId": "...", "refName": "...", "explanation": "..."}]}

Rules:
- One entry per reference in REFERENCES FOUND.
- Explanation must be <= 20 words, specific, grounded in the note content.
- If the note context doesn't clarify why the dep exists, write "Referenced in notes; dependency reason unclear."
- Do not invent refs that aren't in REFERENCES FOUND.`;

function buildDepAnalyzerPrompt(params: {
  entityType: string;
  entityName: string;
  noteContent: string;
  deps: Array<Record<string, unknown>>;
}): string {
  const cfg = readJson<Record<string, unknown>>(AGENT_CONFIG_FILE, {});
  const template = typeof cfg['dependencyAnalyzer.prompt'] === 'string'
    ? String(cfg['dependencyAnalyzer.prompt'])
    : DEFAULT_DEP_ANALYZER_PROMPT;

  const nonStale = params.deps.filter((d) => d.is_stale !== 1);
  const refList = nonStale
    .map((d) => `- refType=${d.ref_type}, refId=${d.ref_id}${d.ref_name ? `, refName="${d.ref_name}"` : ''}`)
    .join('\n') || '(none)';

  const userEdits = nonStale.filter((d) => d.previous_user_edit);
  const userEditsContextBlock = userEdits.length > 0
    ? `\nUSER-EDITED EXPLANATIONS (reconcile with these where applicable):\n${
        userEdits.map((d) => `- refType=${d.ref_type}, refName="${d.ref_name ?? d.ref_id}": "${d.previous_user_edit}"`).join('\n')
      }\n`
    : '';

  return template
    .replaceAll('{entityType}', params.entityType)
    .replaceAll('{entityName}', params.entityName)
    .replaceAll('{noteContent}', params.noteContent || '(empty)')
    .replaceAll('{refList}', refList)
    .replaceAll('{userEditsContextBlock}', userEditsContextBlock);
}

function runClaudeHeadless(prompt: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // Windows needs shell:true so `claude` resolves via PATH (.cmd shim).
    const proc = spawn('claude', ['-p'], { cwd: PROJECT_DIR, shell: process.platform === 'win32' });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('claude CLI timed out')); }, timeoutMs);
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
    proc.on('error', (err: Error) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code: number) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`));
      resolve(stdout);
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/** Pull the first JSON object out of a blob of text. Claude sometimes wraps
 *  output in ``` fences or prefaces with prose even when told not to. */
function extractJsonObject(blob: string): unknown {
  // Strip markdown code fences if present
  const fenceMatch = blob.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : blob;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No JSON object found in Claude output');
  }
  const slice = candidate.slice(firstBrace, lastBrace + 1);
  return JSON.parse(slice);
}

app.post('/api/schema-planner/dependencies/analyze', requireLocal, async (req: Request, res: Response) => {
  const { entityType, entityId, noteKey } = req.body as {
    entityType: string;
    entityId: number;
    noteKey: string;
  };
  if (!entityType) return void res.status(400).json({ error: 'entityType required' });
  if (!Number.isFinite(entityId) || entityId <= 0) return void res.status(400).json({ error: 'entityId must be a positive number' });
  if (!noteKey) return void res.status(400).json({ error: 'noteKey required' });

  const db = getDb();
  const note = db.prepare(
    'SELECT content FROM _splan_entity_notes WHERE entity_type = ? AND entity_id = ? AND note_key = ?'
  ).get(entityType, entityId, noteKey) as { content: string | null } | undefined;
  const noteContent = note?.content ?? '';

  const deps = db.prepare(
    'SELECT * FROM _splan_entity_dependencies WHERE entity_type = ? AND entity_id = ? AND note_key = ?'
  ).all(entityType, entityId, noteKey) as Array<Record<string, unknown>>;
  if (deps.length === 0) return void res.json({ analyzed: 0, dependencies: [] });

  // Resolve the entity's display name for the prompt header.
  let entityName = String(entityId);
  try {
    const table = ({
      module: '_splan_modules:module_id:module_name',
      feature: '_splan_features:feature_id:feature_name',
      concept: '_splan_concepts:concept_id:concept_name',
      table: '_splan_data_tables:table_id:table_name',
      field: '_splan_data_fields:field_id:field_name',
      research: '_splan_research:research_id:title',
    } as Record<string, string>)[entityType];
    if (table) {
      const [t, idCol, nameCol] = table.split(':');
      const row = db.prepare(`SELECT ${nameCol} AS name FROM ${t} WHERE ${idCol} = ?`).get(entityId) as { name: string } | undefined;
      if (row?.name) entityName = row.name;
    }
  } catch { /* fall back to id */ }

  const prompt = buildDepAnalyzerPrompt({ entityType, entityName, noteContent, deps });

  let raw: string;
  try {
    raw = await runClaudeHeadless(prompt);
  } catch (e) {
    return void res.status(502).json({ error: `Claude CLI failed: ${(e as Error).message}` });
  }

  let parsed: { dependencies?: Array<{ refType: string; refId: string; refName?: string | null; explanation?: string }> };
  try {
    parsed = extractJsonObject(raw) as typeof parsed;
  } catch (e) {
    return void res.status(502).json({ error: `Claude returned invalid JSON: ${(e as Error).message}`, raw: raw.slice(0, 500) });
  }

  const results = Array.isArray(parsed?.dependencies) ? parsed.dependencies : [];
  if (results.length === 0) return void res.json({ analyzed: 0, dependencies: [] });

  // Build a fast lookup so responses that shuffle order still land on the right row.
  const byRef = new Map<string, Record<string, unknown>>();
  for (const d of deps) byRef.set(`${d.ref_type}:${d.ref_id}`, d);

  const updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const updateStmt = db.prepare(
    `UPDATE _splan_entity_dependencies
       SET explanation = ?, previous_user_edit = NULL, is_user_edited = 0, last_analyzed_at = ?, updated_at = ?
     WHERE id = ?`
  );
  let analyzed = 0;
  const txn = db.transaction(() => {
    for (const r of results) {
      const row = byRef.get(`${r.refType}:${String(r.refId)}`);
      if (!row) continue;
      if (row.is_stale === 1) continue; // don't bother annotating stale rows
      const explanation = typeof r.explanation === 'string' ? r.explanation : '';
      updateStmt.run(explanation, updatedAt, updatedAt, row.id);
      analyzed++;
    }
  });
  txn();

  logChange({
    entityType,
    entityId,
    action: 'UPDATE',
    fieldChanged: `${noteKey}_deps`,
    newValue: `${analyzed} analyzed`,
    reasoning: 'claude-analyze',
  });

  const fresh = db.prepare(
    'SELECT * FROM _splan_entity_dependencies WHERE entity_type = ? AND entity_id = ? AND note_key = ?'
  ).all(entityType, entityId, noteKey) as Array<Record<string, unknown>>;
  return void res.json({ analyzed, dependencies: fresh.map(parseRow) });
});

// ─── Display Templates CRUD ─────────────────────────────────────────────────

app.get('/api/display-templates', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM _splan_display_templates ORDER BY template_name').all() as Record<string, unknown>[];
  return void res.json(rows.map(parseRow));
});

app.post('/api/display-templates', (req: Request, res: Response) => {
  const { templateName, displayMode, fontSize, fontBold, fontUnderline, fontColor, alignment, wrap, lines, colorMapping } = req.body;
  if (!templateName?.trim()) return void res.status(400).json({ error: 'templateName is required' });
  const db = getDb();
  try {
    const info = db.prepare(
      `INSERT INTO _splan_display_templates (template_name, display_mode, font_size, font_bold, font_underline, font_color, alignment, wrap, lines, color_mapping)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      templateName.trim(),
      displayMode || 'text',
      fontSize ?? null,
      fontBold ? 1 : 0,
      fontUnderline ? 1 : 0,
      fontColor || null,
      alignment || 'left',
      wrap ? 1 : 0,
      lines ?? 1,
      JSON.stringify(colorMapping || {})
    );
    const created = db.prepare('SELECT * FROM _splan_display_templates WHERE id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
    return void res.status(201).json(parseRow(created));
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) return void res.status(409).json({ error: `Template "${templateName}" already exists` });
    throw err;
  }
});

app.put('/api/display-templates/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const db = getDb();
  const existing = db.prepare('SELECT * FROM _splan_display_templates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return void res.status(404).json({ error: 'Template not found' });

  const fields: string[] = [];
  const values: unknown[] = [];
  const allowed: Record<string, (v: unknown) => unknown> = {
    template_name: (v) => v,
    display_mode: (v) => v,
    font_size: (v) => v,
    font_bold: (v) => v ? 1 : 0,
    font_underline: (v) => v ? 1 : 0,
    font_color: (v) => v || null,
    alignment: (v) => v,
    wrap: (v) => v ? 1 : 0,
    lines: (v) => v,
    color_mapping: (v) => JSON.stringify(v || {}),
  };

  for (const [camelKey, val] of Object.entries(req.body)) {
    const snakeKey = camelKey.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
    if (snakeKey in allowed && val !== undefined) {
      fields.push(`${snakeKey} = ?`);
      values.push(allowed[snakeKey](val));
    }
  }
  if (fields.length === 0) return void res.status(400).json({ error: 'No valid fields to update' });

  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE _splan_display_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM _splan_display_templates WHERE id = ?').get(id) as Record<string, unknown>;
  return void res.json(parseRow(updated));
});

app.delete('/api/display-templates/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const db = getDb();
  const existing = db.prepare('SELECT * FROM _splan_display_templates WHERE id = ?').get(id);
  if (!existing) return void res.status(404).json({ error: 'Template not found' });
  db.prepare('DELETE FROM _splan_display_templates WHERE id = ?').run(id);
  return void res.json({ success: true });
});

// ─── Column Template Assignments ────────────────────────────────────────────

app.get('/api/column-template-assignments', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM _splan_column_template_assignments').all() as Record<string, unknown>[];
  return void res.json(rows.map(parseRow));
});

app.post('/api/column-template-assignments', (req: Request, res: Response) => {
  const { entityType, columnKey, templateId } = req.body;
  if (!entityType || !columnKey || !templateId) return void res.status(400).json({ error: 'entityType, columnKey, and templateId are required' });
  const db = getDb();
  // Upsert: replace if exists
  db.prepare(
    `INSERT INTO _splan_column_template_assignments (entity_type, column_key, template_id)
     VALUES (?, ?, ?)
     ON CONFLICT(entity_type, column_key) DO UPDATE SET template_id = excluded.template_id`
  ).run(entityType, columnKey, templateId);
  const row = db.prepare('SELECT * FROM _splan_column_template_assignments WHERE entity_type = ? AND column_key = ?').get(entityType, columnKey) as Record<string, unknown>;
  return void res.json(parseRow(row));
});

app.delete('/api/column-template-assignments/:entityType/:columnKey', (req: Request, res: Response) => {
  const { entityType, columnKey } = req.params;
  const db = getDb();
  db.prepare('DELETE FROM _splan_column_template_assignments WHERE entity_type = ? AND column_key = ?').run(entityType, columnKey);
  return void res.json({ success: true });
});

// ─── Display Templates Seed ─────────────────────────────────────────────────

app.post('/api/display-templates/seed', (req: Request, res: Response) => {
  const db = getDb();
  // Only seed if no templates exist yet
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM _splan_display_templates').get() as { cnt: number }).cnt;
  if (count > 0) return void res.json({ seeded: false, message: 'Templates already exist' });

  // Client sends column assignments: Array<{ entityType, columnKey, columnType }>
  const columnMappings = (req.body.columns || []) as Array<{ entityType: string; columnKey: string; columnType: string }>;

  // Starter templates based on column type groups
  const starters: Array<{
    name: string; mode: string; fontSize: number | null;
    fontColor: string | null; colorMapping: Record<string, string>;
  }> = [
    { name: 'Colored Pill', mode: 'pill', fontSize: 12, fontColor: null, colorMapping: {} },
    { name: 'Outline Badge', mode: 'chip', fontSize: 10, fontColor: null, colorMapping: {} },
    { name: 'Plain Text', mode: 'text', fontSize: 12, fontColor: null, colorMapping: {} },
    { name: 'Gray Tag', mode: 'tag', fontSize: 10, fontColor: '#9999b3', colorMapping: {} },
    { name: 'Muted Timestamp', mode: 'text', fontSize: 10, fontColor: '#9999b3', colorMapping: {} },
    { name: 'FK Link', mode: 'text', fontSize: 12, fontColor: '#5bc0de', colorMapping: {} },
    { name: 'Boolean Toggle', mode: 'pill', fontSize: 12, fontColor: null, colorMapping: { 'true': '#4ecb71', 'false': '#e05555' } },
    { name: 'Count Badge', mode: 'text', fontSize: 10, fontColor: '#5bc0de', colorMapping: {} },
  ];

  const insertTpl = db.prepare(
    `INSERT INTO _splan_display_templates (template_name, display_mode, font_size, font_color, color_mapping) VALUES (?, ?, ?, ?, ?)`
  );
  const insertAssign = db.prepare(
    `INSERT OR IGNORE INTO _splan_column_template_assignments (entity_type, column_key, template_id) VALUES (?, ?, ?)`
  );

  // Map column types to template names
  const typeToTemplate: Record<string, string> = {
    'enum': 'Colored Pill',
    'boolean': 'Boolean Toggle',
    'multi-fk': 'Outline Badge',
    'text': 'Plain Text',
    'textarea': 'Plain Text',
    'int': 'Plain Text',
    'tags': 'Gray Tag',
    'module-tags': 'Gray Tag',
    'readonly': 'Muted Timestamp',
    'fk': 'FK Link',
    'image-carousel': 'Count Badge',
    'test-count': 'Count Badge',
    'note-fullscreen': 'Count Badge',
    'notes': 'Count Badge',
    'formula': 'Plain Text',
    'checklist': 'Plain Text',
    'platforms': 'Outline Badge',
    'ref-features': 'Count Badge',
    'ref-projects': 'Count Badge',
  };

  const tplIds: Record<string, number> = {};
  let assignCount = 0;

  const insertAll = db.transaction(() => {
    for (const s of starters) {
      const info = insertTpl.run(s.name, s.mode, s.fontSize, s.fontColor, JSON.stringify(s.colorMapping));
      tplIds[s.name] = Number(info.lastInsertRowid);
    }

    // Assign each column to its matching template
    for (const { entityType, columnKey, columnType } of columnMappings) {
      const tplName = typeToTemplate[columnType];
      if (tplName && tplIds[tplName]) {
        insertAssign.run(entityType, columnKey, tplIds[tplName]);
        assignCount++;
      }
    }
  });
  insertAll();

  return void res.json({ seeded: true, templates: Object.keys(tplIds).length, assignments: assignCount });
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

app.put('/api/projects/github-config', requireLocal, (req: Request, res: Response) => {
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

// ─── Agent-schedule SQL helpers (Option D: schedules live in DB, not file) ───
// Rows live in _splan_agent_schedules and round-trip through push/pull, so
// Railway learns about new schedules on the next sync. Callers get/store
// camelCase records so the UI + cron-Claude prompt builder keep the same shape
// that agent-schedules.json used to expose.

type ScheduleRecord = {
  agentId: string;
  cronExpression: string;
  cronLabel: string;
  promptOverride?: string | null;
  paramDefaults: Record<string, unknown>;
  triggerId: string;
  enabled: boolean;
  createdAt: string;
  cliOutput: string;
  cliError?: string | null;
  unregistered: boolean;
  expectedSchemaFingerprint?: string | null;
  pinnedAt?: string | null;
  promptSnapshot: string;
  promptSnapshotAt?: string | null;
};

function readAllSchedules(): Record<string, ScheduleRecord> {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM _splan_agent_schedules').all() as Array<Record<string, unknown>>;
  const out: Record<string, ScheduleRecord> = {};
  for (const row of rows) {
    const parsed = parseRow(row) as Record<string, unknown>;
    const agentId = parsed.agentId as string;
    out[agentId] = parsed as unknown as ScheduleRecord;
  }
  return out;
}

function loadSchedule(agentId: string): ScheduleRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM _splan_agent_schedules WHERE agent_id = ?').get(agentId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseRow(row) as unknown as ScheduleRecord;
}

function upsertSchedule(rec: ScheduleRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO _splan_agent_schedules
       (agent_id, cron_expression, cron_label, prompt_override, param_defaults,
        trigger_id, enabled, created_at, cli_output, cli_error, unregistered,
        expected_schema_fingerprint, pinned_at, prompt_snapshot, prompt_snapshot_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       cron_expression             = excluded.cron_expression,
       cron_label                  = excluded.cron_label,
       prompt_override             = excluded.prompt_override,
       param_defaults              = excluded.param_defaults,
       trigger_id                  = excluded.trigger_id,
       enabled                     = excluded.enabled,
       created_at                  = excluded.created_at,
       cli_output                  = excluded.cli_output,
       cli_error                   = excluded.cli_error,
       unregistered                = excluded.unregistered,
       expected_schema_fingerprint = excluded.expected_schema_fingerprint,
       pinned_at                   = excluded.pinned_at,
       prompt_snapshot             = excluded.prompt_snapshot,
       prompt_snapshot_at          = excluded.prompt_snapshot_at`
  ).run(
    rec.agentId,
    rec.cronExpression,
    rec.cronLabel,
    rec.promptOverride ?? null,
    JSON.stringify(rec.paramDefaults ?? {}),
    rec.triggerId,
    rec.enabled ? 1 : 0,
    rec.createdAt,
    rec.cliOutput ?? '',
    rec.cliError ?? null,
    rec.unregistered ? 1 : 0,
    rec.expectedSchemaFingerprint ?? null,
    rec.pinnedAt ?? null,
    rec.promptSnapshot ?? '',
    rec.promptSnapshotAt ?? null,
  );
}

function deleteScheduleRow(agentId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM _splan_agent_schedules WHERE agent_id = ?').run(agentId);
}

// One-time import: on boot, if the legacy file still exists and the new table
// is empty, pull the file rows in so nothing is lost for users upgrading.
function importSchedulesFromFileIfEmpty(): void {
  try {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) AS c FROM _splan_agent_schedules').get() as { c: number }).c;
    if (count > 0) return;
    if (!fs.existsSync(AGENT_SCHEDULES_FILE)) return;
    const raw = readJson<Record<string, Record<string, unknown>>>(AGENT_SCHEDULES_FILE, {});
    const entries = Object.entries(raw);
    if (entries.length === 0) return;
    for (const [agentId, s] of entries) {
      upsertSchedule({
        agentId,
        cronExpression: String(s.cronExpression ?? ''),
        cronLabel: String(s.cronLabel ?? ''),
        promptOverride: (s.promptOverride as string | undefined) ?? null,
        paramDefaults: (s.paramDefaults as Record<string, unknown>) ?? {},
        triggerId: String(s.triggerId ?? ''),
        enabled: s.enabled !== false,
        createdAt: String(s.createdAt ?? new Date().toISOString()),
        cliOutput: String(s.cliOutput ?? ''),
        cliError: (s.cliError as string | undefined) ?? null,
        unregistered: s.unregistered === true,
        expectedSchemaFingerprint: (s.expectedSchemaFingerprint as string | undefined) ?? null,
        pinnedAt: (s.pinnedAt as string | undefined) ?? null,
        promptSnapshot: String(s.promptSnapshot ?? ''),
        promptSnapshotAt: (s.promptSnapshotAt as string | undefined) ?? null,
      });
    }
    console.log(`[schedules] imported ${entries.length} schedule(s) from agent-schedules.json into _splan_agent_schedules`);
  } catch (e) {
    console.warn('[schedules] import from file failed:', (e as Error).message);
  }
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
app.post('/api/agents/launch', requireLocal, (req: Request, res: Response) => {
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
  return void res.json(readAllSchedules());
});

// Resolve the remote URL cron-Claude will call back into. Prefer an explicit
// override env so a user can point at a staging Railway without touching the
// existing SYNC_REMOTE_URL used by the data-sync system.
function getScheduledRemoteUrl(): string | null {
  const url = process.env.SCHEDULED_AGENT_REMOTE_URL ?? process.env.SYNC_REMOTE_URL ?? null;
  return url ? url.replace(/\/+$/, '') : null;
}

function buildScheduledPrompt(agentId: string): { prompt: string; reason?: string } {
  const def = getScheduledAgent(agentId);
  if (!def) return { prompt: '', reason: 'no_handler' };
  const url = getScheduledRemoteUrl();
  if (!url) return { prompt: '', reason: 'remote_url_not_configured' };
  const token = process.env.SCHEDULED_AGENT_TOKEN;
  if (!token) return { prompt: '', reason: 'token_not_configured' };
  const prompt = def.promptTemplate
    .replace(/\{RAILWAY_URL\}/g, url)
    .replace(/\{SCHEDULED_AGENT_TOKEN\}/g, token);
  return { prompt };
}

// POST /api/agents/schedules — create or update a schedule via claude CLI
app.post('/api/agents/schedules', async (req: Request, res: Response) => {
  const { agentId, agentName, config, prompt: clientPrompt } = req.body as {
    agentId?: string;
    agentName?: string;
    config?: { cronExpression: string; cronLabel: string; promptOverride?: string; paramDefaults?: Record<string, string>; triggerId?: string };
    prompt?: string;
  };
  if (!agentId || !config?.cronExpression) {
    return void res.status(400).json({ error: 'agentId and config.cronExpression are required' });
  }

  // For registered scheduled agents, the prompt is built server-side from the
  // code template. The client-supplied prompt is ignored — the code is the
  // source of truth so promptSnapshot is reviewable and drift-detectable.
  let prompt: string;
  const isScheduledAgent = !!getScheduledAgent(agentId);
  if (isScheduledAgent) {
    const built = buildScheduledPrompt(agentId);
    if (!built.prompt) {
      return void res.status(400).json({ error: `cannot_build_prompt:${built.reason}` });
    }
    prompt = built.prompt;
  } else {
    if (!clientPrompt) {
      return void res.status(400).json({ error: 'prompt is required for non-scheduled-registry agents' });
    }
    prompt = clientPrompt;
  }

  // If updating, remove the old trigger first
  if (config.triggerId) {
    try {
      await new Promise<void>((resolve) => {
        exec(`claude schedule delete ${config.triggerId}`, { shell: 'cmd.exe', cwd: PROJECT_DIR }, () => resolve());
      });
    } catch { /* old trigger may already be gone */ }
  }

  // Attempt to create the Anthropic trigger via the claude CLI. The current
  // claude CLI (2026) exposes scheduling through the in-session /schedule
  // skill (CronCreate tool) rather than a shell subcommand. If the shell call
  // fails, persist the schedule record anyway with unregistered: true so the
  // user can hand off the baked prompt to /schedule in a Claude Code session.
  const safePrompt = prompt
    .replace(/%/g, '%%')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '\\"');

  const scheduleCmd = `claude schedule create --name "${(agentName || agentId).replace(/"/g, '')}" --cron "${config.cronExpression}" --prompt "${safePrompt}"`;

  const persistSchedule = (triggerId: string, opts: { unregistered: boolean; cliOutput?: string; cliError?: string }) => {
    const nowIso = new Date().toISOString();
    upsertSchedule({
      agentId,
      cronExpression: config.cronExpression,
      cronLabel: config.cronLabel,
      promptOverride: config.promptOverride ?? null,
      paramDefaults: (config.paramDefaults as Record<string, unknown>) ?? {},
      triggerId,
      enabled: true,
      createdAt: nowIso,
      cliOutput: opts.cliOutput ?? '',
      cliError: opts.cliError ?? null,
      unregistered: opts.unregistered,
      expectedSchemaFingerprint: computeSchemaFingerprint(),
      pinnedAt: nowIso,
      promptSnapshot: prompt,
      promptSnapshotAt: nowIso,
    });
  };

  exec(scheduleCmd, { shell: 'cmd.exe', cwd: PROJECT_DIR }, (err, stdout, stderr) => {
    if (err) {
      console.warn('[schedules] claude CLI path unavailable — storing unregistered. Stderr:', stderr?.trim());
      const triggerId = `unregistered-${agentId}-${Date.now().toString(36)}`;
      persistSchedule(triggerId, { unregistered: true, cliError: err.message });
      return void res.json({
        saved: true,
        triggerId,
        unregistered: true,
        reason: 'claude_cli_unavailable',
        detail: 'Create the trigger via /schedule skill in Claude Code using the snapshotted prompt. See Inspect prompt in the UI.',
      });
    }

    let triggerId = '';
    const idMatch = stdout.match(/(?:trigger[_\s-]?id|id)[:\s]+([a-zA-Z0-9_-]+)/i);
    if (idMatch) {
      triggerId = idMatch[1];
    } else {
      triggerId = `splan-${agentId}-${Date.now().toString(36)}`;
    }
    persistSchedule(triggerId, { unregistered: false, cliOutput: stdout.trim() });
    return void res.json({ saved: true, triggerId });
  });
});

// POST /api/agents/schedules/:agentId/repin — recompute expected schema fingerprint
app.post('/api/agents/schedules/:agentId/repin', requireLocal, (req: Request, res: Response) => {
  const { agentId } = req.params;
  const existing = loadSchedule(agentId);
  if (!existing) return void res.status(404).json({ error: 'schedule_not_found' });
  const pinnedAt = new Date().toISOString();
  const expectedSchemaFingerprint = computeSchemaFingerprint();
  upsertSchedule({ ...existing, expectedSchemaFingerprint, pinnedAt });
  return void res.json({ repinned: true, expectedSchemaFingerprint, pinnedAt });
});

// DELETE /api/agents/schedules/:agentId — remove a schedule
app.delete('/api/agents/schedules/:agentId', (req: Request, res: Response) => {
  const { agentId } = req.params;
  const { triggerId } = req.body as { triggerId?: string };

  const doRemove = () => {
    deleteScheduleRow(agentId);
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

// GET /api/agents/scheduled-runs?agentId=&limit=&status= — list recent runs
app.get('/api/agents/scheduled-runs', (req: Request, res: Response) => {
  const agentId = (req.query.agentId as string | undefined) ?? null;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 500);
  const status = (req.query.status as string | undefined) ?? null;

  const db = getDb();
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (agentId) { clauses.push('agent_id = ?'); args.push(agentId); }
  if (status) { clauses.push('status = ?'); args.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  // Prune rows older than 90 days to match agent-history.json.
  const pruneCutoff = new Date(Date.now() - HISTORY_MAX_AGE_MS).toISOString();
  db.prepare('DELETE FROM _splan_scheduled_runs WHERE fired_at < ?').run(pruneCutoff);

  const rows = db.prepare(
    `SELECT * FROM _splan_scheduled_runs ${where} ORDER BY fired_at DESC LIMIT ?`
  ).all(...args, limit) as Array<Record<string, unknown>>;

  return void res.json(rows.map((r) => parseRow(r)));
});

// GET /api/agents/schedules/:agentId/prompt — return snapshot + drift state
app.get('/api/agents/schedules/:agentId/prompt', requireLocal, (req: Request, res: Response) => {
  const { agentId } = req.params;
  const schedule = loadSchedule(agentId);
  if (!schedule) return void res.status(404).json({ error: 'schedule_not_found' });
  const built = buildScheduledPrompt(agentId);
  const currentTemplate = built.prompt || '';
  const promptSnapshot = (schedule.promptSnapshot as string | undefined) ?? '';
  const promptSnapshotAt = (schedule.promptSnapshotAt as string | undefined) ?? null;
  const driftDetected = Boolean(currentTemplate) && currentTemplate !== promptSnapshot;
  return void res.json({ promptSnapshot, promptSnapshotAt, currentTemplate, driftDetected, buildReason: built.reason ?? null });
});

// POST /api/agents/schedules/:agentId/rebuild — recreate trigger with current template
app.post('/api/agents/schedules/:agentId/rebuild', requireLocal, async (req: Request, res: Response) => {
  const { agentId } = req.params;
  const schedule = loadSchedule(agentId);
  if (!schedule) return void res.status(404).json({ error: 'schedule_not_found' });

  const built = buildScheduledPrompt(agentId);
  if (!built.prompt) return void res.status(400).json({ error: `cannot_build_prompt:${built.reason}` });

  const oldTriggerId = schedule.triggerId as string | undefined;
  if (oldTriggerId) {
    await new Promise<void>((resolve) => {
      exec(`claude schedule delete ${oldTriggerId}`, { shell: 'cmd.exe', cwd: PROJECT_DIR }, () => resolve());
    });
  }

  const safePrompt = built.prompt.replace(/%/g, '%%').replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
  const scheduleCmd = `claude schedule create --name "${String(agentId).replace(/"/g, '')}" --cron "${schedule.cronExpression}" --prompt "${safePrompt}"`;

  exec(scheduleCmd, { shell: 'cmd.exe', cwd: PROJECT_DIR }, (err, stdout) => {
    const nowIso = new Date().toISOString();

    if (err) {
      const newTriggerId = `unregistered-${agentId}-${Date.now().toString(36)}`;
      upsertSchedule({
        ...(schedule as ScheduleRecord),
        triggerId: newTriggerId,
        unregistered: true,
        cliError: err.message,
        promptSnapshot: built.prompt,
        promptSnapshotAt: nowIso,
      });
      return void res.json({
        rebuilt: true,
        triggerId: newTriggerId,
        unregistered: true,
        reason: 'claude_cli_unavailable',
        promptSnapshotAt: nowIso,
      });
    }

    let newTriggerId = '';
    const idMatch = stdout.match(/(?:trigger[_\s-]?id|id)[:\s]+([a-zA-Z0-9_-]+)/i);
    if (idMatch) newTriggerId = idMatch[1];
    else newTriggerId = `splan-${agentId}-${Date.now().toString(36)}`;

    upsertSchedule({
      ...(schedule as ScheduleRecord),
      triggerId: newTriggerId,
      unregistered: false,
      cliError: null,
      promptSnapshot: built.prompt,
      promptSnapshotAt: nowIso,
      cliOutput: stdout.trim(),
    });
    return void res.json({ rebuilt: true, triggerId: newTriggerId, promptSnapshotAt: nowIso });
  });
});

// ─── Scheduled-agent work broker (Phase 4) ──────────────────────────────────
// Cron-fired Claude hits /inputs to receive preflight + work payload, then
// /results to post findings. Railway is a pure data broker — no LLM calls.

function requireScheduledToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.SCHEDULED_AGENT_TOKEN;
  if (!expected) {
    console.error('[scheduled-agents] SCHEDULED_AGENT_TOKEN not set — refusing request');
    return void res.status(503).json({ error: 'scheduled_agent_token_not_configured' });
  }
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || match[1].trim() !== expected) {
    return void res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const scheduledRateState = new Map<string, number>();
const SCHEDULED_RATE_WINDOW_MS = 60_000;
function rateLimitScheduled(agentId: string, endpoint: 'inputs' | 'results'): boolean {
  const key = `${agentId}:${endpoint}`;
  const now = Date.now();
  const last = scheduledRateState.get(key) ?? 0;
  if (now - last < SCHEDULED_RATE_WINDOW_MS) return false;
  scheduledRateState.set(key, now);
  return true;
}

type RunLogCore = {
  runId: string;
  agentId: string;
  scheduledAt: string;
  firedAt: string;
};

function logSkippedRun(params: RunLogCore & {
  skippedReason: string;
  expectedSchemaHash?: string | null;
  actualSchemaHash?: string | null;
  promptChars?: number;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO _splan_scheduled_runs
       (run_id, agent_id, scheduled_at, fired_at, completed_at, status,
        skipped_reason, expected_schema_hash, actual_schema_hash,
        prompt_chars, estimated_tokens)
     VALUES (?, ?, ?, ?, ?, 'skipped', ?, ?, ?, ?, ?)`
  ).run(
    params.runId,
    params.agentId,
    params.scheduledAt,
    params.firedAt,
    params.firedAt,
    params.skippedReason,
    params.expectedSchemaHash ?? null,
    params.actualSchemaHash ?? null,
    params.promptChars ?? null,
    params.promptChars != null ? Math.floor(params.promptChars / 4) : null
  );
}

function logPendingRun(params: RunLogCore & {
  expectedSchemaHash: string | null;
  actualSchemaHash: string;
  promptChars: number;
  inputChars: number;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO _splan_scheduled_runs
       (run_id, agent_id, scheduled_at, fired_at, status,
        expected_schema_hash, actual_schema_hash,
        prompt_chars, input_chars)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    params.runId,
    params.agentId,
    params.scheduledAt,
    params.firedAt,
    params.expectedSchemaHash,
    params.actualSchemaHash,
    params.promptChars,
    params.inputChars
  );
}

function loadPendingRun(runId: string): {
  runId: string;
  agentId: string;
  firedAt: string;
  promptChars: number | null;
  inputChars: number | null;
} | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT run_id, agent_id, fired_at, status, prompt_chars, input_chars
     FROM _splan_scheduled_runs WHERE run_id = ?`
  ).get(runId) as { run_id: string; agent_id: string; fired_at: string; status: string; prompt_chars: number | null; input_chars: number | null } | undefined;
  if (!row || row.status !== 'pending') return null;
  return {
    runId: row.run_id,
    agentId: row.agent_id,
    firedAt: row.fired_at,
    promptChars: row.prompt_chars,
    inputChars: row.input_chars,
  };
}

function logCompletedRun(params: {
  runId: string;
  status: 'success' | 'failed';
  skippedReason?: string;
  resultJson?: unknown;
  resultChars: number;
  toolCalls?: unknown;
}): void {
  const db = getDb();
  const existing = db.prepare(
    'SELECT fired_at, prompt_chars, input_chars FROM _splan_scheduled_runs WHERE run_id = ?'
  ).get(params.runId) as { fired_at: string; prompt_chars: number | null; input_chars: number | null } | undefined;

  const completedAt = new Date().toISOString();
  const durationMs = existing ? Math.max(0, Date.now() - Date.parse(existing.fired_at)) : null;
  const promptChars = existing?.prompt_chars ?? 0;
  const inputChars = existing?.input_chars ?? 0;
  const estimatedTokens = Math.floor((promptChars + inputChars + params.resultChars) / 4);

  db.prepare(
    `UPDATE _splan_scheduled_runs
     SET status = ?, completed_at = ?, duration_ms = ?,
         result_chars = ?, estimated_tokens = ?,
         result_json = ?, tool_calls_json = ?, skipped_reason = ?
     WHERE run_id = ?`
  ).run(
    params.status,
    completedAt,
    durationMs,
    params.resultChars,
    estimatedTokens,
    params.resultJson !== undefined ? JSON.stringify(params.resultJson) : null,
    params.toolCalls !== undefined ? JSON.stringify(params.toolCalls) : null,
    params.skippedReason ?? null,
    params.runId
  );
}

// GET /api/agents/work/:agentId/inputs — preflight + work payload
app.get('/api/agents/work/:agentId/inputs', requireScheduledToken, (req: Request, res: Response) => {
  const { agentId } = req.params;
  if (!rateLimitScheduled(agentId, 'inputs')) {
    return void res.status(429).json({ error: 'rate_limited' });
  }

  const runId = generateRunId();
  const firedAt = new Date().toISOString();
  const schedule = loadSchedule(agentId);
  const scheduledAt = (schedule?.scheduledAt as string | undefined) ?? firedAt;
  const baseRun = { runId, agentId, scheduledAt, firedAt };
  const promptSnapshot = (schedule?.promptSnapshot as string | undefined) ?? '';

  if (!schedule || schedule.enabled === false) {
    logSkippedRun({ ...baseRun, skippedReason: 'schedule_disabled', promptChars: promptSnapshot.length });
    return void res.json({ runId, skip: 'schedule_disabled' });
  }

  const expectedHash = (schedule.expectedSchemaFingerprint as string | undefined) ?? null;
  const actualHash = computeSchemaFingerprint();
  if (expectedHash && expectedHash !== actualHash) {
    logSkippedRun({
      ...baseRun,
      skippedReason: 'schema_stale',
      expectedSchemaHash: expectedHash,
      actualSchemaHash: actualHash,
      promptChars: promptSnapshot.length,
    });
    return void res.json({ runId, skip: 'schema_stale', actualHash, expectedHash });
  }

  const def = getScheduledAgent(agentId);
  if (!def) {
    logSkippedRun({ ...baseRun, skippedReason: 'no_handler', promptChars: promptSnapshot.length });
    return void res.json({ runId, skip: 'no_handler' });
  }

  let work: unknown;
  try {
    work = def.inputsBuilder({ db: getDb(), params: (schedule.paramDefaults as Record<string, unknown>) ?? {} });
  } catch (e) {
    logSkippedRun({
      ...baseRun,
      skippedReason: 'inputs_builder_threw',
      expectedSchemaHash: expectedHash,
      actualSchemaHash: actualHash,
      promptChars: promptSnapshot.length,
    });
    return void res.status(500).json({ runId, error: 'inputs_builder_threw', detail: (e as Error).message });
  }

  const workJson = JSON.stringify(work);
  logPendingRun({
    ...baseRun,
    expectedSchemaHash: expectedHash,
    actualSchemaHash: actualHash,
    promptChars: promptSnapshot.length,
    inputChars: workJson.length,
  });

  return void res.json({ runId, work, schemaHash: actualHash });
});

// POST /api/agents/work/:agentId/results — validate + write findings
app.post('/api/agents/work/:agentId/results', requireScheduledToken, (req: Request, res: Response) => {
  const { agentId } = req.params;
  if (!rateLimitScheduled(agentId, 'results')) {
    return void res.status(429).json({ error: 'rate_limited' });
  }

  const body = (req.body ?? {}) as { runId?: string; findings?: unknown[]; error?: string; toolCalls?: unknown };
  const runId = body.runId;
  if (!runId) return void res.status(400).json({ error: 'runId_required' });

  const run = loadPendingRun(runId);
  if (!run || run.agentId !== agentId) {
    return void res.status(404).json({ error: 'unknown_run' });
  }

  const resultChars = JSON.stringify(body).length;

  if (body.error) {
    logCompletedRun({
      runId,
      status: 'failed',
      skippedReason: 'claude_reported_error',
      resultJson: { error: body.error },
      resultChars,
      toolCalls: body.toolCalls,
    });
    return void res.json({ ok: true, recorded: 'failed' });
  }

  const def = getScheduledAgent(agentId);
  if (!def) {
    logCompletedRun({
      runId,
      status: 'failed',
      skippedReason: 'no_handler',
      resultJson: { error: 'no_handler' },
      resultChars,
      toolCalls: body.toolCalls,
    });
    return void res.status(400).json({ ok: false, reason: 'no_handler' });
  }

  const validation = def.resultsValidator({ findings: body.findings });
  if (!validation.ok) {
    logCompletedRun({
      runId,
      status: 'failed',
      skippedReason: 'invalid_result_shape',
      resultJson: { error: validation.error, received: body },
      resultChars,
      toolCalls: body.toolCalls,
    });
    return void res.status(400).json({ ok: false, reason: 'invalid_result_shape', detail: validation.error });
  }

  const schedule = loadSchedule(agentId);
  try {
    const summary = def.resultsWriter({
      db: getDb(),
      runId,
      findings: body.findings as unknown[],
      params: (schedule?.paramDefaults as Record<string, unknown>) ?? {},
    });
    logCompletedRun({
      runId,
      status: 'success',
      resultJson: summary,
      resultChars,
      toolCalls: body.toolCalls,
    });
    return void res.json({ ran: true, runId, ...(summary as Record<string, unknown>) });
  } catch (e) {
    logCompletedRun({
      runId,
      status: 'failed',
      skippedReason: 'writer_threw',
      resultJson: { error: (e as Error).message },
      resultChars,
      toolCalls: body.toolCalls,
    });
    return void res.status(500).json({ ok: false, reason: 'writer_threw', error: (e as Error).message });
  }
});

// Expose the registry keys so other routes (prompt inspector, etc.) can enumerate.
void SCHEDULED_AGENTS;

// ─── Notebook CRUD ──────────────────────────────────────────────────────────

app.get('/api/notebook', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM _splan_notebook ORDER BY pinned DESC, updated_at DESC').all();
  return void res.json(rows);
});

app.post('/api/notebook', (req: Request, res: Response) => {
  const db = getDb();
  const { title, content_html } = req.body as { title?: string; content_html?: string };
  const result = db.prepare(
    'INSERT INTO _splan_notebook (title, content_html) VALUES (?, ?)'
  ).run(title || 'Untitled', content_html || '');
  const row = db.prepare('SELECT * FROM _splan_notebook WHERE id = ?').get(result.lastInsertRowid);
  logChange({ entityType: 'notebook', entityId: result.lastInsertRowid as number, action: 'INSERT', newValue: title || 'Untitled' });
  return void res.json(row);
});

app.put('/api/notebook/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  const { title, content_html, pinned } = req.body as { title?: string; content_html?: string; pinned?: number };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (title !== undefined) { sets.push('title = ?'); vals.push(title); }
  if (content_html !== undefined) { sets.push('content_html = ?'); vals.push(content_html); }
  if (pinned !== undefined) { sets.push('pinned = ?'); vals.push(pinned); }
  if (sets.length === 0) return void res.status(400).json({ error: 'Nothing to update' });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE _splan_notebook SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  const row = db.prepare('SELECT * FROM _splan_notebook WHERE id = ?').get(id);
  // Log content changes (but not every keystroke detail — just that it changed)
  if (title !== undefined) logChange({ entityType: 'notebook', entityId: id, action: 'UPDATE', fieldChanged: 'title', newValue: title });
  if (content_html !== undefined) logChange({ entityType: 'notebook', entityId: id, action: 'UPDATE', fieldChanged: 'content_html' });
  return void res.json(row);
});

app.delete('/api/notebook/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT title FROM _splan_notebook WHERE id = ?').get(parseInt(req.params.id, 10)) as { title: string } | undefined;
  db.prepare('DELETE FROM _splan_notebook WHERE id = ?').run(parseInt(req.params.id, 10));
  logChange({ entityType: 'notebook', entityId: parseInt(req.params.id, 10), action: 'DELETE', oldValue: existing?.title });
  return void res.json({ success: true });
});

// ─── Sync endpoints (dev-only) ──────────────────────────────────────────────

// Auto-backup: copy DB before any sync operation (keeps last 10)
function backupDatabase() {
  const DB_FILE = process.env.DB_PATH || path.join(__dirname, '..', 'schema-planner.db');
  const backupDir = path.join(path.dirname(DB_FILE), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(backupDir, `schema-planner-${timestamp}.db`);

  try {
    // Use SQLite backup API via better-sqlite3 for a safe copy
    const db = getDb();
    db.backup(backupPath).then(() => {
      // Prune old backups, keep last 10
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('schema-planner-') && f.endsWith('.db'))
        .sort()
        .reverse();
      for (const old of files.slice(10)) {
        try { fs.unlinkSync(path.join(backupDir, old)); } catch { /* ignore */ }
      }
      console.log(`Backup saved: ${backupPath}`);
    }).catch((err: Error) => {
      console.error('Backup failed:', err.message);
      // Fallback: simple file copy
      try { fs.copyFileSync(DB_FILE, backupPath); } catch { /* ignore */ }
    });
  } catch {
    // Fallback: simple file copy
    try { fs.copyFileSync(DB_FILE, backupPath); } catch { /* ignore */ }
  }
}

const SYNC_REMOTE_URL = process.env.SYNC_REMOTE_URL || '';
const SYNC_REMOTE_PASSWORD = process.env.SYNC_REMOTE_PASSWORD || '';

function getSyncAuth(): { cookie: string; baseUrl: string } | null {
  if (!SYNC_REMOTE_URL || !SYNC_REMOTE_PASSWORD) return null;
  const token = crypto.createHmac('sha256', SYNC_REMOTE_PASSWORD).update('schema-planner-session').digest('hex');
  return { cookie: `splan_session=${token}`, baseUrl: SYNC_REMOTE_URL.replace(/\/+$/, '') };
}

// F2: record a sync attempt (success or failure) into _splan_sync_meta.
// Returns the attempt_id so it can be surfaced in API responses.
function recordSyncAttempt(params: {
  direction: 'push' | 'pull';
  source: string;
  success: boolean;
  remoteUrl?: string;
  rowsSynced?: number;
  errorMessage?: string;
  commitHash?: string;
}): { attemptId: string } {
  const attemptId = uuidv4();
  try {
    getDb().prepare(
      `INSERT INTO _splan_sync_meta
        (sync_direction, remote_url, rows_synced, success, error_message, source, attempt_id, commit_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      params.direction,
      params.remoteUrl || '',
      params.rowsSynced ?? 0,
      params.success ? 1 : 0,
      params.errorMessage ?? null,
      params.source,
      attemptId,
      params.commitHash ?? null,
    );
  } catch {
    // Pre-F2 schemas (e.g., remote during a migration gap) lack the new columns.
    // Fall back to the legacy 4-column insert so we don't crash the request.
    try {
      getDb().prepare(
        'INSERT INTO _splan_sync_meta (sync_direction, remote_url, rows_synced) VALUES (?, ?, ?)'
      ).run(params.direction, params.remoteUrl || '', params.rowsSynced ?? 0);
    } catch { /* swallow — recording is non-critical */ }
  }
  return { attemptId };
}

function normalizeSource(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  const trimmed = input.trim();
  return trimmed ? trimmed : fallback;
}

// Check if remote has changes since last sync
app.get('/api/sync/remote-status', async (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') return void res.status(404).json({ error: 'Not available' });
  const auth = getSyncAuth();
  if (!auth) return void res.json({ configured: false, error: 'Set SYNC_REMOTE_URL and SYNC_REMOTE_PASSWORD env vars' });

  try {
    const remote = await fetch(`${auth.baseUrl}/api/sync-status`, { headers: { Cookie: auth.cookie } });
    if (!remote.ok) return void res.json({ configured: true, error: `Remote returned ${remote.status}` });
    const remoteStatus = await remote.json() as { lastSync: unknown; changesSinceSync: unknown[]; changeCount: number; schemaTables?: string[] };

    // Also check local changes since last sync
    const db = getDb();
    const lastSync = db.prepare('SELECT * FROM _splan_sync_meta ORDER BY synced_at DESC LIMIT 1')
      .get() as { synced_at: string; sync_direction: string; rows_synced: number } | undefined;

    let localChangeCount = 0;
    let localChanges: unknown[] = [];
    if (lastSync) {
      localChanges = db.prepare(
        `SELECT entity_type, entity_id, action, field_changed, changed_at
         FROM _splan_change_log WHERE changed_at > ? ORDER BY changed_at DESC LIMIT 50`
      ).all(lastSync.synced_at);
      localChangeCount = (db.prepare(
        'SELECT COUNT(*) as cnt FROM _splan_change_log WHERE changed_at > ?'
      ).get(lastSync.synced_at) as { cnt: number }).cnt;
    }

    // Schema fingerprint: compare local and remote _splan_ table lists
    const localTables = getSchemaTables();
    const remoteTables = remoteStatus.schemaTables ?? null;
    let schema: { match: boolean; missingOnRemote: string[]; missingOnLocal: string[] } | null = null;
    if (remoteTables) {
      const localSet = new Set(localTables);
      const remoteSet = new Set(remoteTables);
      const missingOnRemote = localTables.filter(t => !remoteSet.has(t));
      const missingOnLocal = remoteTables.filter(t => !localSet.has(t));
      schema = {
        match: missingOnRemote.length === 0 && missingOnLocal.length === 0,
        missingOnRemote,
        missingOnLocal,
      };
    }

    return void res.json({
      configured: true,
      remoteUrl: auth.baseUrl,
      lastSync: lastSync ? { syncedAt: lastSync.synced_at, direction: lastSync.sync_direction, rowsSynced: lastSync.rows_synced } : null,
      remote: { changeCount: remoteStatus.changeCount, changes: remoteStatus.changesSinceSync },
      local: { changeCount: localChangeCount, changes: localChanges },
      schema,
    });
  } catch (e: unknown) {
    return void res.json({ configured: true, error: `Failed to reach remote: ${(e as Error).message}` });
  }
});

// Push local → remote
app.post('/api/sync/push', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') return void res.status(404).json({ error: 'Not available' });
  const auth = getSyncAuth();
  if (!auth) return void res.status(400).json({ error: 'Set SYNC_REMOTE_URL and SYNC_REMOTE_PASSWORD env vars' });

  // Server-side guardrails. ?force=true bypasses the change-count check but NOT
  // the schema check — a schema mismatch can't be meaningfully force-overridden.
  const force = req.query.force === 'true' || (req.body as { force?: boolean })?.force === true;
  const sourceRaw = (req.query.source as string | undefined) ?? (req.body as { source?: string } | undefined)?.source;
  const source = normalizeSource(sourceRaw, force ? 'force-push' : 'manual-push');
  const commitHashRaw = (req.query.commitHash as string | undefined) ?? (req.body as { commitHash?: string } | undefined)?.commitHash;
  const commitHash = (typeof commitHashRaw === 'string' && commitHashRaw.trim()) ? commitHashRaw.trim() : undefined;

  try {
    const remote = await fetch(`${auth.baseUrl}/api/sync-status`, { headers: { Cookie: auth.cookie } });
    if (remote.ok) {
      const s = await remote.json() as { changeCount: number; schemaTables?: string[] };

      // Schema mismatch: if local has tables remote doesn't, push would silently skip them.
      if (s.schemaTables) {
        const remoteSet = new Set(s.schemaTables);
        const missingOnRemote = getSchemaTables().filter(t => !remoteSet.has(t));
        if (missingOnRemote.length > 0) {
          const errMsg = `Schema mismatch: remote is missing ${missingOnRemote.length} table(s) (${missingOnRemote.slice(0, 3).join(', ')}${missingOnRemote.length > 3 ? '…' : ''}). Deploy Code first so remote's schema matches.`;
          const { attemptId } = recordSyncAttempt({ direction: 'push', source, success: false, remoteUrl: auth.baseUrl, errorMessage: errMsg, commitHash });
          return void res.status(409).json({
            error: errMsg,
            schemaMismatch: true,
            missingOnRemote,
            attemptId,
          });
        }
      }

      if (!force && s.changeCount > 0) {
        const errMsg = `Remote has ${s.changeCount} unsynced change(s). Pull first, or retry with force=true to overwrite remote.`;
        const { attemptId } = recordSyncAttempt({ direction: 'push', source, success: false, remoteUrl: auth.baseUrl, errorMessage: errMsg, commitHash });
        return void res.status(409).json({
          error: errMsg,
          conflict: true,
          remoteChangeCount: s.changeCount,
          attemptId,
        });
      }
    }
  } catch { /* if we can't reach remote status, fall through to the push itself which will fail cleanly */ }

  backupDatabase();

  try {
    const db = getDb();
    const SKIP = new Set(['_splan_all_tests', '_splan_grouping_presets', '_splan_sync_meta', '_splan_scheduled_runs']);
    const tableRows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_splan_%' ORDER BY name"
    ).all() as Array<{ name: string }>;

    const tables: Record<string, unknown[]> = {};
    let totalRows = 0;
    for (const { name } of tableRows) {
      if (SKIP.has(name)) continue;
      const rows = db.prepare(`SELECT * FROM ${name}`).all();
      tables[name] = rows;
      totalRows += rows.length;
    }

    const importRes = await fetch(`${auth.baseUrl}/api/db-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: auth.cookie, 'X-Sync-Source': 'local-push' },
      body: JSON.stringify({ tables }),
    });

    if (!importRes.ok) {
      const errText = await importRes.text();
      const errMsg = `Remote import failed: ${errText.substring(0, 300)}`;
      const { attemptId } = recordSyncAttempt({ direction: 'push', source, success: false, remoteUrl: auth.baseUrl, errorMessage: errMsg, commitHash });
      return void res.status(500).json({ error: errMsg, attemptId });
    }

    const result = await importRes.json() as { success: boolean; imported: Record<string, number> };

    const { attemptId } = recordSyncAttempt({ direction: 'push', source, success: true, remoteUrl: auth.baseUrl, rowsSynced: totalRows, commitHash });
    return void res.json({ success: true, totalRows, imported: result.imported, attemptId });
  } catch (e: unknown) {
    const errMsg = (e as Error).message;
    const { attemptId } = recordSyncAttempt({ direction: 'push', source, success: false, remoteUrl: auth.baseUrl, errorMessage: errMsg, commitHash });
    return void res.status(500).json({ error: errMsg, attemptId });
  }
});

// Pull remote → local
app.post('/api/sync/pull', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') return void res.status(404).json({ error: 'Not available' });
  const auth = getSyncAuth();
  if (!auth) return void res.status(400).json({ error: 'Set SYNC_REMOTE_URL and SYNC_REMOTE_PASSWORD env vars' });

  const force = req.query.force === 'true' || (req.body as { force?: boolean })?.force === true;
  const sourceRaw = (req.query.source as string | undefined) ?? (req.body as { source?: string } | undefined)?.source;
  const source = normalizeSource(sourceRaw, force ? 'force-pull' : 'manual-pull');
  const remoteUrlForLog = auth.baseUrl;

  // Schema check: if remote has tables local doesn't, a pull would silently skip
  // the data in those tables (db-import skips unknown tables). Block regardless of force.
  try {
    const remote = await fetch(`${auth.baseUrl}/api/sync-status`, { headers: { Cookie: auth.cookie } });
    if (remote.ok) {
      const s = await remote.json() as { schemaTables?: string[] };
      if (s.schemaTables) {
        const localSet = new Set(getSchemaTables());
        const missingOnLocal = s.schemaTables.filter(t => !localSet.has(t));
        if (missingOnLocal.length > 0) {
          const errMsg = `Schema mismatch: local is missing ${missingOnLocal.length} table(s) (${missingOnLocal.slice(0, 3).join(', ')}${missingOnLocal.length > 3 ? '…' : ''}). Deploy Code on the local side or re-pull the codebase first.`;
          const { attemptId } = recordSyncAttempt({ direction: 'pull', source, success: false, remoteUrl: remoteUrlForLog, errorMessage: errMsg });
          return void res.status(409).json({
            error: errMsg,
            schemaMismatch: true,
            missingOnLocal,
            attemptId,
          });
        }
      }
    }
  } catch { /* fall through */ }

  // Change-count guardrail (overridable via force)
  if (!force) {
    const dbCheck = getDb();
    const lastSync = dbCheck.prepare('SELECT synced_at FROM _splan_sync_meta ORDER BY synced_at DESC LIMIT 1')
      .get() as { synced_at: string } | undefined;
    if (lastSync) {
      const localCount = (dbCheck.prepare(
        'SELECT COUNT(*) as cnt FROM _splan_change_log WHERE changed_at > ?'
      ).get(lastSync.synced_at) as { cnt: number }).cnt;
      if (localCount > 0) {
        const errMsg = `Local has ${localCount} unsynced change(s). Push first, or retry with force=true to discard local changes.`;
        const { attemptId } = recordSyncAttempt({ direction: 'pull', source, success: false, remoteUrl: remoteUrlForLog, errorMessage: errMsg });
        return void res.status(409).json({
          error: errMsg,
          conflict: true,
          localChangeCount: localCount,
          attemptId,
        });
      }
    }
  }

  backupDatabase();

  try {
    const exportRes = await fetch(`${auth.baseUrl}/api/db-export`, { headers: { Cookie: auth.cookie } });
    if (!exportRes.ok) {
      const errMsg = `Remote export failed: ${exportRes.status}`;
      const { attemptId } = recordSyncAttempt({ direction: 'pull', source, success: false, remoteUrl: remoteUrlForLog, errorMessage: errMsg });
      return void res.status(500).json({ error: errMsg, attemptId });
    }

    // Safety check: don't overwrite a full local DB with an empty remote
    const db0 = getDb();
    const localTotal = (db0.prepare(
      "SELECT SUM(cnt) as total FROM (SELECT COUNT(*) as cnt FROM _splan_modules UNION ALL SELECT COUNT(*) FROM _splan_features UNION ALL SELECT COUNT(*) FROM _splan_data_tables UNION ALL SELECT COUNT(*) FROM _splan_concepts)"
    ).get() as { total: number }).total || 0;

    const { tables } = await exportRes.json() as { tables: Record<string, Record<string, unknown>[]> };

    // Count remote rows in key tables
    const remoteTotal = (tables['_splan_modules']?.length || 0) + (tables['_splan_features']?.length || 0)
      + (tables['_splan_data_tables']?.length || 0) + (tables['_splan_concepts']?.length || 0);

    if (localTotal > 100 && remoteTotal === 0) {
      const errMsg = `Safety check: local has ${localTotal} rows in core tables but remote has 0. The remote may have been wiped by a redeploy. Push your local data first instead.`;
      const { attemptId } = recordSyncAttempt({ direction: 'pull', source, success: false, remoteUrl: remoteUrlForLog, errorMessage: errMsg });
      return void res.status(400).json({ error: errMsg, attemptId });
    }

    const db = getDb();
    const SKIP = new Set(['_splan_all_tests', '_splan_grouping_presets', '_splan_sync_meta', '_splan_scheduled_runs']);
    const ENTITY_TABLE_MAP: Record<string, string> = {
      modules: '_splan_modules', features: '_splan_features', concepts: '_splan_concepts',
      data_tables: '_splan_data_tables', data_fields: '_splan_data_fields',
      projects: '_splan_projects', research: '_splan_research', prototypes: '_splan_prototypes',
    };

    db.pragma('foreign_keys = OFF');
    let totalRows = 0;

    try {
      const importAll = db.transaction(() => {
        // Phase 1: column_defs
        if (tables['_splan_column_defs']?.length) {
          const cdRows = tables['_splan_column_defs'];
          db.exec('DELETE FROM _splan_column_defs');
          const cols = Object.keys(cdRows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const stmt = db.prepare(`INSERT INTO _splan_column_defs (${cols.join(', ')}) VALUES (${placeholders})`);
          for (const row of cdRows) stmt.run(...cols.map(c => row[c] ?? null));
          for (const def of cdRows) {
            const sqlTable = ENTITY_TABLE_MAP[def.entity_type as string];
            if (!sqlTable || def.column_type === 'formula') continue;
            const sqlType = def.column_type === 'int' ? 'INTEGER' : def.column_type === 'boolean' ? "INTEGER NOT NULL DEFAULT 0" : "TEXT NOT NULL DEFAULT ''";
            try { db.exec(`ALTER TABLE ${sqlTable} ADD COLUMN ${def.column_key} ${sqlType}`); } catch { /* exists */ }
          }
        }

        // Phase 2: all other tables
        for (const [tableName, rows] of Object.entries(tables)) {
          if (SKIP.has(tableName) || tableName === '_splan_column_defs' || !Array.isArray(rows)) continue;
          const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
          if (!exists) continue;
          db.exec(`DELETE FROM ${tableName}`);
          if (rows.length === 0) continue;
          const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
          const existingCols = new Set(tableInfo.map(c => c.name));
          const cols = Object.keys(rows[0]).filter(c => existingCols.has(c));
          if (cols.length === 0) continue;
          const stmt = db.prepare(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
          for (const row of rows) { stmt.run(...cols.map(c => row[c] ?? null)); totalRows++; }
        }
      });
      importAll();
    } finally {
      db.pragma('foreign_keys = ON');
    }

    const { attemptId } = recordSyncAttempt({ direction: 'pull', source, success: true, remoteUrl: remoteUrlForLog, rowsSynced: totalRows });

    // Tell the remote that its changes were consumed (so remote sync-status resets)
    try {
      await fetch(`${auth.baseUrl}/api/db-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: auth.cookie, 'X-Sync-Source': 'local-pull-ack' },
        body: JSON.stringify({ tables: {} }),
      });
    } catch { /* non-critical — remote badge may stay yellow until next push */ }

    return void res.json({ success: true, totalRows, attemptId });
  } catch (e: unknown) {
    const errMsg = (e as Error).message;
    const { attemptId } = recordSyncAttempt({ direction: 'pull', source, success: false, remoteUrl: remoteUrlForLog, errorMessage: errMsg });
    return void res.status(500).json({ error: errMsg, attemptId });
  }
});

// ─── GET /api/sync/diff — per-table diff of local vs remote ──────────────────
// Drives the conflict-resolution UI. Compares rows by primary key across every
// _splan_ table, then consults both sides' change logs to classify
// added/deleted/edited and flag record-level + field-level conflicts.
app.get('/api/sync/diff', async (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') return void res.status(404).json({ error: 'Not available' });
  const auth = getSyncAuth();
  if (!auth) return void res.status(400).json({ error: 'Sync not configured' });

  try {
    const db = getDb();

    // 1. Remote full DB + remote change log
    const [exportRes, statusRes] = await Promise.all([
      fetch(`${auth.baseUrl}/api/db-export`, { headers: { Cookie: auth.cookie } }),
      fetch(`${auth.baseUrl}/api/sync-status`, { headers: { Cookie: auth.cookie } }),
    ]);
    if (!exportRes.ok) return void res.status(500).json({ error: `Remote export failed: ${exportRes.status}` });
    if (!statusRes.ok) return void res.status(500).json({ error: `Remote status failed: ${statusRes.status}` });

    const { tables: remoteTables } = await exportRes.json() as { tables: Record<string, Record<string, unknown>[]> };
    const remoteStatus = await statusRes.json() as {
      changesSinceSync: Array<{ entity_type: string; entity_id: number; action: string; field_changed: string | null }>;
    };

    // 2. Local change log since last sync
    const lastSync = db.prepare('SELECT * FROM _splan_sync_meta ORDER BY synced_at DESC LIMIT 1')
      .get() as { synced_at: string } | undefined;
    const localChanges = lastSync
      ? db.prepare(
          `SELECT entity_type, entity_id, action, field_changed
           FROM _splan_change_log WHERE changed_at > ?`
        ).all(lastSync.synced_at) as Array<{ entity_type: string; entity_id: number; action: string; field_changed: string | null }>
      : [];

    // 3. Build change-log indexes: entity_type → id → { actions, fields }
    type ChangeIndex = Map<string, Map<number, { deleted: boolean; created: boolean; fields: Set<string> }>>;
    const buildIndex = (changes: typeof localChanges): ChangeIndex => {
      const idx: ChangeIndex = new Map();
      for (const c of changes) {
        if (!idx.has(c.entity_type)) idx.set(c.entity_type, new Map());
        const byId = idx.get(c.entity_type)!;
        const rec = byId.get(c.entity_id) || { deleted: false, created: false, fields: new Set<string>() };
        if (c.action === 'delete') rec.deleted = true;
        if (c.action === 'create') rec.created = true;
        if (c.field_changed) rec.fields.add(c.field_changed);
        byId.set(c.entity_id, rec);
      }
      return idx;
    };
    const localIdx = buildIndex(localChanges);
    const remoteIdx = buildIndex(remoteStatus.changesSinceSync);

    // 4. Per-table diff
    const SKIP = new Set(['_splan_all_tests', '_splan_grouping_presets', '_splan_sync_meta', '_splan_change_log', '_splan_scheduled_runs']);
    const IGNORE_FIELDS = new Set(['updated_at', 'created_at']);
    const tablesOut: Array<Record<string, unknown>> = [];

    for (const [tableName, meta] of Object.entries(TABLE_MAP)) {
      if (SKIP.has(tableName)) continue;
      const idCol = meta.idCol;
      const entityType = meta.entityType;

      const localRows = db.prepare(`SELECT * FROM ${tableName}`).all() as Record<string, unknown>[];
      const remoteRows = remoteTables[tableName] || [];

      // Guess a name column: {entityType}_name, then common fallbacks
      const sampleRow = localRows[0] || remoteRows[0];
      const nameCol = sampleRow
        ? [`${entityType}_name`, 'name', 'title', 'label', 'field_name', 'table_name'].find(c => c in sampleRow) || null
        : null;

      const localById = new Map<string | number, Record<string, unknown>>();
      for (const r of localRows) { const k = r[idCol] as string | number; if (k != null) localById.set(k, r); }
      const remoteById = new Map<string | number, Record<string, unknown>>();
      for (const r of remoteRows) { const k = r[idCol] as string | number; if (k != null) remoteById.set(k, r); }

      const allIds = new Set<string | number>([...localById.keys(), ...remoteById.keys()]);
      const localChangeMap = localIdx.get(entityType) || new Map();
      const remoteChangeMap = remoteIdx.get(entityType) || new Map();

      const edits: Array<Record<string, unknown>> = [];
      const added: Array<Record<string, unknown>> = [];
      const deleted: Array<Record<string, unknown>> = [];

      for (const id of allIds) {
        const l = localById.get(id);
        const r = remoteById.get(id);
        const lChange = localChangeMap.get(Number(id));
        const rChange = remoteChangeMap.get(Number(id));

        if (l && r) {
          // Compare fields
          const fieldKeys = new Set([...Object.keys(l), ...Object.keys(r)]);
          const changes: Array<Record<string, unknown>> = [];
          for (const f of fieldKeys) {
            if (IGNORE_FIELDS.has(f)) continue;
            const lv = l[f];
            const rv = r[f];
            if (lv === rv) continue;
            // Normalize null/undefined/empty-string comparison
            const lNorm = lv == null ? '' : String(lv);
            const rNorm = rv == null ? '' : String(rv);
            if (lNorm === rNorm) continue;
            const fieldConflict = !!(lChange?.fields.has(f) && rChange?.fields.has(f));
            changes.push({ field: f, local: lNorm, remote: rNorm, fieldConflict });
          }
          if (changes.length > 0) {
            const recordConflict = !!(lChange && rChange && !lChange.deleted && !rChange.deleted);
            edits.push({
              id,
              name: nameCol ? String(l[nameCol] ?? r[nameCol] ?? '') : '',
              recordConflict,
              changes,
            });
          }
        } else if (l && !r) {
          // Exists locally only → added-local OR deleted-remote
          const side = rChange?.deleted ? 'remote-deleted' : 'local';
          const bucket = side === 'remote-deleted' ? deleted : added;
          bucket.push({
            id,
            name: nameCol ? String(l[nameCol] ?? '') : '',
            side: side === 'remote-deleted' ? 'remote' : 'local',
          });
        } else if (!l && r) {
          // Exists remotely only → added-remote OR deleted-local
          const side = lChange?.deleted ? 'local-deleted' : 'remote';
          const bucket = side === 'local-deleted' ? deleted : added;
          bucket.push({
            id,
            name: nameCol ? String(r[nameCol] ?? '') : '',
            side: side === 'local-deleted' ? 'local' : 'remote',
          });
        }
      }

      if (edits.length === 0 && added.length === 0 && deleted.length === 0) continue;

      // Sort: conflicts to top, then by name
      edits.sort((a, b) => {
        const ac = a.recordConflict ? 0 : 1;
        const bc = b.recordConflict ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return String(a.name).localeCompare(String(b.name));
      });

      // Label: strip _splan_ prefix, title-case
      const label = tableName.replace(/^_splan_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      tablesOut.push({ tableName, label, idCol, nameCol, edits, added, deleted });
    }

    const hasConflict = (localChanges.length > 0) && (remoteStatus.changesSinceSync.length > 0);

    return void res.json({ hasConflict, tables: tablesOut });
  } catch (e: unknown) {
    return void res.status(500).json({ error: (e as Error).message });
  }
});

// F3: Most recent sync attempt (success or failure) — drives the sidebar dot + banner
app.get('/api/sync/last-attempt', (_req: Request, res: Response) => {
  const db = getDb();
  let row: {
    attempt_id: string | null;
    sync_direction: string;
    source: string | null;
    success: number | null;
    rows_synced: number | null;
    error_message: string | null;
    synced_at: string;
    id: number;
  } | undefined;
  try {
    row = db.prepare(
      `SELECT attempt_id, sync_direction, source, success, rows_synced, error_message, synced_at, id
         FROM _splan_sync_meta
         ORDER BY synced_at DESC, id DESC
         LIMIT 1`
    ).get() as typeof row;
  } catch {
    // Pre-F2 schema: fall back to legacy columns
    try {
      const legacy = db.prepare(
        'SELECT id, sync_direction, rows_synced, synced_at FROM _splan_sync_meta ORDER BY synced_at DESC, id DESC LIMIT 1'
      ).get() as { id: number; sync_direction: string; rows_synced: number; synced_at: string } | undefined;
      if (legacy) {
        row = { attempt_id: `legacy-${legacy.id}`, sync_direction: legacy.sync_direction, source: 'manual', success: 1, rows_synced: legacy.rows_synced, error_message: null, synced_at: legacy.synced_at, id: legacy.id };
      }
    } catch { /* table missing */ }
  }
  if (!row) return void res.json({ attempt: null });
  const direction = row.sync_direction === 'pull' ? 'pull' : 'push';
  return void res.json({
    attempt: {
      id: row.attempt_id || `legacy-${row.id}`,
      direction,
      source: row.source || 'manual',
      success: row.success == null ? true : row.success === 1,
      rowsSynced: row.rows_synced,
      errorMessage: row.error_message,
      attemptedAt: row.synced_at,
    },
  });
});

// Local git state — how many commits ahead of origin/main, and whether the working tree is dirty.
// Drives the "N commits ahead — will push on next Deploy" indicator. Local-only; returns zeros on hosted.
app.get('/api/sync/local-git-status', requireLocal, (_req: Request, res: Response) => {
  const PROJECT_ROOT = path.join(__dirname, '..');
  const opts = { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] };

  let commitsAhead = 0;
  let dirty = false;
  let headCommit: string | null = null;
  try {
    const ahead = execSync('git log origin/main..HEAD --oneline', opts).toString().trim();
    commitsAhead = ahead ? ahead.split('\n').length : 0;
  } catch { /* no upstream or not a git repo */ }
  try {
    const status = execSync('git status --porcelain', opts).toString().trim();
    dirty = status.length > 0;
  } catch { /* ignore */ }
  try {
    headCommit = execSync('git rev-parse --short HEAD', opts).toString().trim() || null;
  } catch { /* ignore */ }

  return void res.json({ commitsAhead, dirty, headCommit });
});

// Most recent deploy attempt (success, timeout, or failure) + repo URL for linking
app.get('/api/sync/last-deploy', (_req: Request, res: Response) => {
  const db = getDb();

  // Resolve repo URL from `git remote get-url origin` (local only; on hosted returns null)
  let repoUrl: string | null = null;
  try {
    const PROJECT_ROOT = path.join(__dirname, '..');
    const remoteOut = execSync('git remote get-url origin', { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const match = remoteOut.match(/github\.com[/:](.+?)(?:\.git)?$/);
    if (match) repoUrl = `https://github.com/${match[1]}`;
  } catch { /* no git or not github — leave null */ }

  let row: {
    attempt_id: string | null;
    source: string;
    success: number | null;
    rows_synced: number | null;
    error_message: string | null;
    synced_at: string;
    commit_hash: string | null;
    id: number;
  } | undefined;

  try {
    row = db.prepare(
      `SELECT attempt_id, source, success, rows_synced, error_message, synced_at, commit_hash, id
         FROM _splan_sync_meta
         WHERE source LIKE 'deploy-push%'
         ORDER BY synced_at DESC, id DESC
         LIMIT 1`
    ).get() as typeof row;
  } catch { /* pre-migration schema */ }

  if (!row) return void res.json({ deploy: null, repoUrl });

  let status: 'success' | 'timeout' | 'failed';
  if (row.source === 'deploy-push' && row.success === 1) status = 'success';
  else if (row.source === 'deploy-push-timeout' && row.success === 1) status = 'timeout';
  else status = 'failed';

  return void res.json({
    deploy: {
      id: row.attempt_id || `legacy-${row.id}`,
      status,
      commitHash: row.commit_hash,
      rowsSynced: row.rows_synced,
      errorMessage: row.error_message,
      attemptedAt: row.synced_at,
    },
    repoUrl,
  });
});

// Deploy code: git add, commit, push (local-only — shells out to git)
app.post('/api/sync/deploy-code', requireLocal, (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') return void res.status(404).json({ error: 'Not available' });

  const PROJECT_ROOT = path.join(__dirname, '..');
  const message = (req.body as { message?: string })?.message || 'Deploy from Schema Planner';
  const execOpts = { cwd: PROJECT_ROOT } as const;

  // Read GitHub PAT for authenticated push (credential manager doesn't work in child_process)
  const ghConfigPath = path.join(PROJECT_ROOT, '.github-config.json');
  let pushCmd = 'git push origin main';
  try {
    const ghConfig = JSON.parse(fs.readFileSync(ghConfigPath, 'utf-8'));
    if (ghConfig.pat) {
      // Build authenticated push URL from remote origin
      const remoteUrl = execSync('git remote get-url origin', { cwd: PROJECT_ROOT }).toString().trim();
      const match = remoteUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
      if (match) {
        pushCmd = `git push https://${ghConfig.pat}@github.com/${match[1]}.git HEAD:main`;
      }
    }
  } catch { /* no PAT, try default push */ }

  // First check if there are changes
  exec('git status --porcelain', execOpts, (statusErr, statusOut) => {
    if (statusErr) return void res.status(500).json({ error: `git status failed: ${statusErr.message}` });

    if (!statusOut.trim()) {
      // No changes — just push in case there are unpushed commits
      exec('git log origin/main..HEAD --oneline', execOpts, (logErr, logOut) => {
        if (logErr || !logOut.trim()) {
          return void res.json({ success: true, status: 'nothing', message: 'No changes to deploy' });
        }
        exec(pushCmd, execOpts, (pushErr) => {
          if (pushErr) return void res.status(500).json({ error: `git push failed: ${pushErr.message}` });
          // Capture HEAD so the client has a commit hash to poll for
          exec('git rev-parse --short HEAD', execOpts, (_hashErr, hashOut) => {
            return void res.json({
              success: true,
              status: 'pushed',
              message: 'Pushed unpushed commits',
              commitHash: hashOut?.trim() || null,
              filesChanged: logOut.trim().split('\n').length,
            });
          });
        });
      });
      return;
    }

    // There are changes — add, commit, push
    const commitMsg = `${message}\n\nCo-Authored-By: Schema Planner <noreply@schemaplanner.dev>`;
    exec('git add -A', execOpts, (addErr) => {
      if (addErr) return void res.status(500).json({ error: `git add failed: ${addErr.message}` });
      exec(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, execOpts, (commitErr, commitOut) => {
        if (commitErr) return void res.status(500).json({ error: `git commit failed: ${commitErr.message}` });
        const hashMatch = commitOut.match(/\[main ([a-f0-9]+)\]/);
        exec(pushCmd, execOpts, (pushErr) => {
          if (pushErr) return void res.status(500).json({ error: `git push failed: ${pushErr.message}` });
          // Update local remote tracking
          exec('git fetch origin', execOpts, () => {
            return void res.json({
              success: true,
              status: 'deployed',
              message: 'Committed and pushed',
              commitHash: hashMatch?.[1] || null,
              filesChanged: statusOut.trim().split('\n').length,
            });
          });
        });
      });
    });
  });
});

// Pull code: git fetch + pull (local-only — shells out to git, inverse of deploy-code)
app.post('/api/sync/pull-code', requireLocal, (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') return void res.status(404).json({ error: 'Not available' });

  const PROJECT_ROOT = path.join(__dirname, '..');
  const execOpts = { cwd: PROJECT_ROOT } as const;

  // Read GitHub PAT for authenticated fetch (credential manager doesn't work in child_process)
  const ghConfigPath = path.join(PROJECT_ROOT, '.github-config.json');
  let fetchCmd = 'git fetch origin';
  let pullCmd = 'git pull origin main';
  try {
    const ghConfig = JSON.parse(fs.readFileSync(ghConfigPath, 'utf-8'));
    if (ghConfig.pat) {
      const remoteUrl = execSync('git remote get-url origin', { cwd: PROJECT_ROOT }).toString().trim();
      const match = remoteUrl.match(/github\.com[/:](.+?)(?:\.git)?$/);
      if (match) {
        const authUrl = `https://${ghConfig.pat}@github.com/${match[1]}.git`;
        fetchCmd = `git fetch ${authUrl}`;
        pullCmd = `git pull ${authUrl} main`;
      }
    }
  } catch { /* no PAT, try default */ }

  // Refuse to pull onto a dirty tree — user must deploy or discard first
  exec('git status --porcelain', execOpts, (statusErr, statusOut) => {
    if (statusErr) return void res.status(500).json({ error: `git status failed: ${statusErr.message}` });

    if (statusOut.trim()) {
      return void res.status(409).json({
        success: false,
        status: 'dirty',
        error: 'Uncommitted changes detected — Deploy Code or discard local changes before pulling.',
        filesChanged: statusOut.trim().split('\n').length,
      });
    }

    exec(fetchCmd, execOpts, (fetchErr) => {
      if (fetchErr) return void res.status(500).json({ error: `git fetch failed: ${fetchErr.message}` });

      exec(pullCmd, execOpts, (pullErr, pullOut) => {
        if (pullErr) return void res.status(500).json({ error: `git pull failed: ${pullErr.message}` });

        if (/Already up to date/i.test(pullOut)) {
          return void res.json({ success: true, status: 'nothing', message: 'Already up to date', filesChanged: 0 });
        }

        // Parse "N files changed" from pull's shortstat-style summary when present.
        const fileCountMatch = pullOut.match(/(\d+)\s+files?\s+changed/);
        const filesChanged = fileCountMatch
          ? parseInt(fileCountMatch[1], 10)
          : pullOut.split('\n').filter((l) => /^\s*\S+\s+\|\s+\d+/.test(l)).length;

        return void res.json({
          success: true,
          status: 'pulled',
          message: `Pulled latest from origin/main (${filesChanged} file${filesChanged === 1 ? '' : 's'} changed)`,
          filesChanged,
        });
      });
    });
  });
});

// ─── GET /api/version — current git commit hash ────────────────────────────
// Prefer platform-provided build-time env vars (Railway, Vercel, Render) since
// hosted containers typically have no .git directory. Fall back to git CLI for
// local dev. Returns a 7-char short SHA; commitsMatch handles full-vs-short.
app.get('/api/version', (_req: Request, res: Response) => {
  const envCommit =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.SOURCE_COMMIT;
  if (envCommit && envCommit.trim()) {
    return void res.json({ commit: envCommit.trim().slice(0, 7) });
  }
  const PROJECT_ROOT = path.join(__dirname, '..');
  const execOpts = { cwd: PROJECT_ROOT, shell: os.platform() === 'win32' ? 'cmd.exe' : undefined } as const;
  exec('git rev-parse --short HEAD', execOpts, (err, stdout) => {
    if (err) return void res.json({ commit: null });
    return void res.json({ commit: stdout.trim() });
  });
});

// ─── GET /api/db-export — bulk export all tables ────────────────────────────
app.get('/api/db-export', (_req: Request, res: Response) => {
  const db = getDb();
  const SKIP_TABLES = new Set(['_splan_all_tests', '_splan_grouping_presets', '_splan_scheduled_runs']);

  const tableRows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_splan_%' ORDER BY name"
  ).all() as Array<{ name: string }>;

  const tables: Record<string, unknown[]> = {};
  for (const { name } of tableRows) {
    if (SKIP_TABLES.has(name)) continue;
    tables[name] = db.prepare(`SELECT * FROM ${name}`).all();
  }

  return void res.json({ tables });
});

// List of _splan_ tables present in the current schema. Used to detect code drift
// (remote deployed an older codebase that's missing tables the local app defines).
function getSchemaTables(): string[] {
  const db = getDb();
  return (db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_splan_%' ORDER BY name"
  ).all() as Array<{ name: string }>).map(t => t.name);
}

function computeSchemaFingerprint(): string {
  return schemaFingerprint(getDb());
}

// ─── GET /api/sync-status — changes since last sync ─────────────────────────
app.get('/api/sync-status', (_req: Request, res: Response) => {
  const db = getDb();

  // Get last sync record
  const lastSync = db.prepare(
    'SELECT * FROM _splan_sync_meta ORDER BY synced_at DESC LIMIT 1'
  ).get() as { id: number; sync_direction: string; remote_url: string; synced_at: string; rows_synced: number } | undefined;

  const schemaTables = getSchemaTables();

  if (!lastSync) {
    return void res.json({ lastSync: null, changesSinceSync: [], changeCount: 0, schemaTables });
  }

  // Get change_log entries since last sync
  const changes = db.prepare(
    `SELECT entity_type, entity_id, action, field_changed, new_value, changed_at
     FROM _splan_change_log
     WHERE changed_at > ?
     ORDER BY changed_at DESC`
  ).all(lastSync.synced_at) as Array<{
    entity_type: string; entity_id: number; action: string;
    field_changed: string | null; new_value: string | null; changed_at: string;
  }>;

  return void res.json({
    lastSync: {
      direction: lastSync.sync_direction,
      remoteUrl: lastSync.remote_url,
      syncedAt: lastSync.synced_at,
      rowsSynced: lastSync.rows_synced,
    },
    changesSinceSync: changes.slice(0, 50), // cap at 50 for readability
    changeCount: changes.length,
    schemaTables,
  });
});

// ─── POST /api/db-import — bulk import all tables ───────────────────────────
app.post('/api/db-import', express.json({ limit: '50mb' }), (req: Request, res: Response) => {
  const { tables } = req.body as { tables: Record<string, Record<string, unknown>[]> };
  if (!tables || typeof tables !== 'object') {
    return void res.status(400).json({ error: 'Request body must contain a "tables" object' });
  }

  const db = getDb();

  // Tables/views to skip
  const SKIP_TABLES = new Set(['_splan_all_tests', '_splan_grouping_presets', '_splan_scheduled_runs']);

  const imported: Record<string, number> = {};

  // PRAGMA foreign_keys cannot be changed inside a transaction — set it before
  db.pragma('foreign_keys = OFF');

  // Entity type → SQL table mapping for user-defined columns
  const IMPORT_ENTITY_TABLE: Record<string, string> = {
    modules: '_splan_modules', features: '_splan_features', concepts: '_splan_concepts',
    data_tables: '_splan_data_tables', data_fields: '_splan_data_fields',
    projects: '_splan_projects', research: '_splan_research', prototypes: '_splan_prototypes',
  };

  try {
    const importAll = db.transaction(() => {
      // Phase 1: Import _splan_column_defs FIRST, then apply user-defined columns
      // so that data tables have the necessary columns before we insert rows
      if (tables['_splan_column_defs'] && Array.isArray(tables['_splan_column_defs'])) {
        const cdRows = tables['_splan_column_defs'];
        db.exec('DELETE FROM _splan_column_defs');
        if (cdRows.length > 0) {
          const cols = Object.keys(cdRows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const insertStmt = db.prepare(`INSERT INTO _splan_column_defs (${cols.join(', ')}) VALUES (${placeholders})`);
          for (const row of cdRows) { insertStmt.run(...cols.map(c => row[c] ?? null)); }
          imported['_splan_column_defs'] = cdRows.length;
        } else {
          imported['_splan_column_defs'] = 0;
        }

        // Apply user-defined columns to their target tables
        for (const def of cdRows) {
          const sqlTable = IMPORT_ENTITY_TABLE[def.entity_type as string];
          if (!sqlTable) continue;
          const colType = def.column_type as string;
          if (colType === 'formula') continue; // virtual, no DB column
          const sqlType = colType === 'int' ? 'INTEGER' : colType === 'boolean' ? "INTEGER NOT NULL DEFAULT 0" : "TEXT NOT NULL DEFAULT ''";
          try { db.exec(`ALTER TABLE ${sqlTable} ADD COLUMN ${def.column_key} ${sqlType}`); } catch { /* already exists */ }
        }
      }

      // Phase 2: Import all other tables
      for (const [tableName, rows] of Object.entries(tables)) {
        if (SKIP_TABLES.has(tableName)) continue;
        if (tableName === '_splan_column_defs') continue; // already handled above
        if (!Array.isArray(rows)) continue;

        // Verify this table actually exists in the database
        const tableExists = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
        ).get(tableName);
        if (!tableExists) continue;

        // Clear existing data
        db.exec(`DELETE FROM ${tableName}`);

        if (rows.length === 0) {
          imported[tableName] = 0;
          continue;
        }

        // Filter columns to only those that exist in the target table
        const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        const existingCols = new Set(tableInfo.map(c => c.name));
        const cols = Object.keys(rows[0]).filter(c => existingCols.has(c));
        if (cols.length === 0) continue;

        const placeholders = cols.map(() => '?').join(', ');
        const insertStmt = db.prepare(
          `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`
        );

        let count = 0;
        for (const row of rows) {
          const values = cols.map(c => row[c] ?? null);
          insertStmt.run(...values);
          count++;
        }
        imported[tableName] = count;
      }
    });

    importAll();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  // Record sync metadata (remote side records the inbound push as a "push" attempt)
  const totalImported = Object.values(imported).reduce((a, b) => a + b, 0);
  const remoteUrl = req.headers['x-sync-source'] as string || 'unknown';
  recordSyncAttempt({ direction: 'push', source: 'inbound', success: true, remoteUrl, rowsSynced: totalImported });

  return void res.json({ success: true, imported });
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
  importSchedulesFromFileIfEmpty();
});
