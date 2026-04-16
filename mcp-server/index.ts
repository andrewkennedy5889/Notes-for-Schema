import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'schema-planner.db');

// ─── DB connection ────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

// ─── Case conversion ──────────────────────────────────────────────────────────

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[toCamel(key)] = val;
  }
  return result;
}

function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[toSnake(key)] = val;
  }
  return result;
}

const JSON_COLUMNS = new Set([
  'platforms', 'tags', 'modules', 'data_tables', 'data_fields', 'images',
  'notes_fmt', 'native_notes_fmt', 'android_notes_fmt', 'apple_notes_fmt',
  'other_notes_fmt', 'impl_fmt', 'collapsed_sections', 'embedded_tables',
  'feature_tags', 'checklist', 'conditions', 'config',
  'dependencies', 'features', 'tests',
]);

const BOOL_COLUMNS = new Set([
  'is_system_created', 'is_required', 'is_unique', 'is_foreign_key', 'is_active',
]);

function parseRow(row: Record<string, unknown>): Record<string, unknown> {
  const camel = snakeToCamel(row);
  for (const [key, val] of Object.entries(camel)) {
    const snakeKey = toSnake(key);
    if (JSON_COLUMNS.has(snakeKey) && typeof val === 'string') {
      try { camel[key] = JSON.parse(val); } catch { /* keep as-is */ }
    }
    if (BOOL_COLUMNS.has(snakeKey) && (val === 0 || val === 1)) {
      camel[key] = val === 1;
    }
  }
  return camel;
}

function prepareRow(obj: Record<string, unknown>): Record<string, unknown> {
  const snake = camelToSnake(obj);
  for (const [key, val] of Object.entries(snake)) {
    if (JSON_COLUMNS.has(key) && val !== null && val !== undefined && typeof val !== 'string') {
      snake[key] = JSON.stringify(val);
    }
    if (BOOL_COLUMNS.has(key) && typeof val === 'boolean') {
      snake[key] = val ? 1 : 0;
    }
  }
  return snake;
}

// ─── Table registry ───────────────────────────────────────────────────────────

const TABLE_MAP: Record<string, { sqlTable: string; idCol: string; entityType: string; searchCols: string[] }> = {
  module:      { sqlTable: '_splan_modules',               idCol: 'module_id',   entityType: 'module',       searchCols: ['module_name', 'module_description', 'module_purpose'] },
  feature:     { sqlTable: '_splan_features',              idCol: 'feature_id',  entityType: 'feature',      searchCols: ['feature_name', 'description', 'notes'] },
  table:       { sqlTable: '_splan_data_tables',           idCol: 'table_id',    entityType: 'table',        searchCols: ['table_name', 'description_purpose'] },
  field:       { sqlTable: '_splan_data_fields',           idCol: 'field_id',    entityType: 'field',        searchCols: ['field_name', 'name_reasoning'] },
  concern:     { sqlTable: '_splan_feature_concerns',      idCol: 'concern_id',  entityType: 'concern',      searchCols: ['concern_text', 'mitigation_text'] },
  rule:        { sqlTable: '_splan_data_access_rules',     idCol: 'rule_id',     entityType: 'access_rule',  searchCols: ['scope_notes', 'ownership_notes', 'role', 'user_type'] },
  discussion:  { sqlTable: '_splan_discussions',           idCol: 'discussion_id', entityType: 'discussion', searchCols: ['title', 'content'] },
  step:         { sqlTable: '_splan_implementation_steps', idCol: 'step_id',       entityType: 'step',         searchCols: ['title', 'description'] },
  feature_test: { sqlTable: '_splan_feature_tests',        idCol: 'test_id',       entityType: 'feature_test', searchCols: ['title', 'description', 'expected_result', 'preconditions'] },
  prototype:    { sqlTable: '_splan_prototypes',           idCol: 'prototype_id',  entityType: 'prototype',    searchCols: ['title', 'description', 'notes', 'tech_stack'] },
  concept:      { sqlTable: '_splan_concepts',            idCol: 'concept_id',    entityType: 'concept',      searchCols: ['concept_name', 'description', 'notes'] },
};

// ─── Change logger ────────────────────────────────────────────────────────────

function logChange(params: {
  entityType: string;
  entityId: number;
  action: string;
  fieldChanged?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reasoning?: string;
}) {
  getDb().prepare(`
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

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'schema-planner',
  version: '1.0.0',
});

// ─── schema_search ────────────────────────────────────────────────────────────

server.tool(
  'schema_search',
  'Search across Schema Planner entities by name, description, or notes',
  {
    query: z.string().describe('Search term (matched with LIKE on name/description/notes)'),
    entityType: z.enum(['module', 'feature', 'table', 'field', 'concern', 'rule', 'discussion', 'step', 'feature_test', 'prototype', 'concept'])
      .optional()
      .describe('Limit search to one entity type; omit to search all'),
  },
  async ({ query, entityType }) => {
    const db = getDb();
    const term = `%${query}%`;
    const typesToSearch = entityType ? [entityType] : Object.keys(TABLE_MAP);
    const results: Record<string, unknown[]> = {};

    for (const type of typesToSearch) {
      const meta = TABLE_MAP[type];
      const whereClauses = meta.searchCols.map(col => `${col} LIKE ?`).join(' OR ');
      const rows = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${whereClauses}`)
        .all(...meta.searchCols.map(() => term)) as Record<string, unknown>[];
      if (rows.length > 0) {
        results[type] = rows.map(parseRow);
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(results, null, 2),
      }],
    };
  },
);

// ─── schema_get ───────────────────────────────────────────────────────────────

server.tool(
  'schema_get',
  'Get a specific entity by type and ID. For features, includes linked concerns, data tables, discussions, tests, and prototypes.',
  {
    entityType: z.enum(['module', 'feature', 'table', 'field', 'concern', 'rule', 'discussion', 'step', 'feature_test', 'prototype', 'concept']),
    id: z.number().describe('Entity primary key'),
  },
  async ({ entityType, id }) => {
    const db = getDb();
    const meta = TABLE_MAP[entityType];

    const row = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `${entityType} with id ${id} not found` }) }] };
    }

    const entity = parseRow(row);

    if (entityType === 'feature') {
      // Include linked concerns
      const concerns = (db.prepare('SELECT * FROM _splan_feature_concerns WHERE feature_id = ?').all(id) as Record<string, unknown>[]).map(parseRow);
      // Include linked discussions
      const discussions = (db.prepare("SELECT * FROM _splan_discussions WHERE entity_type = 'feature' AND entity_id = ? ORDER BY created_at DESC").all(id) as Record<string, unknown>[]).map(parseRow);
      // Include implementation steps
      const implementationSteps = (db.prepare('SELECT * FROM _splan_implementation_steps WHERE feature_id = ? ORDER BY sort_order').all(id) as Record<string, unknown>[]).map(parseRow);
      // Include linked data tables
      const tableIds: number[] = Array.isArray(entity.dataTables) ? (entity.dataTables as number[]) : [];
      const linkedTables = tableIds.length > 0
        ? (db.prepare(`SELECT * FROM _splan_data_tables WHERE table_id IN (${tableIds.map(() => '?').join(',')})`).all(...tableIds) as Record<string, unknown>[]).map(parseRow)
        : [];
      // Include feature tests
      const featureTests = (db.prepare('SELECT * FROM _splan_feature_tests WHERE feature_id = ? ORDER BY sort_order').all(id) as Record<string, unknown>[]).map(parseRow);
      // Include prototypes that reference this feature
      const allPrototypes = (db.prepare('SELECT * FROM _splan_prototypes').all() as Record<string, unknown>[]).map(parseRow);
      const linkedPrototypes = allPrototypes.filter(p => {
        const features = Array.isArray(p.features) ? p.features as number[] : [];
        return features.includes(id);
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ...entity, concerns, discussions, implementationSteps, linkedTables, featureTests, linkedPrototypes }, null, 2),
        }],
      };
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(entity, null, 2) }],
    };
  },
);

// ─── schema_list ──────────────────────────────────────────────────────────────

server.tool(
  'schema_list',
  'List all entities of a given type with optional pagination',
  {
    entityType: z.enum(['module', 'feature', 'table', 'field', 'concern', 'rule', 'discussion', 'step', 'feature_test', 'prototype', 'concept']),
    limit: z.number().optional().default(50).describe('Max rows to return (default 50)'),
    offset: z.number().optional().default(0).describe('Row offset for pagination (default 0)'),
  },
  async ({ entityType, limit, offset }) => {
    const db = getDb();
    const meta = TABLE_MAP[entityType];
    const rows = db.prepare(`SELECT * FROM ${meta.sqlTable} LIMIT ? OFFSET ?`).all(limit, offset) as Record<string, unknown>[];
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM ${meta.sqlTable}`).get() as { cnt: number }).cnt;

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ total, offset, limit, rows: rows.map(parseRow) }, null, 2),
      }],
    };
  },
);

// ─── schema_create ────────────────────────────────────────────────────────────

server.tool(
  'schema_create',
  'Create a new entity in Schema Planner',
  {
    entityType: z.enum(['module', 'feature', 'table', 'field', 'concern', 'rule', 'discussion', 'step', 'feature_test', 'prototype', 'concept']),
    data: z.record(z.unknown()).describe('Entity fields in camelCase'),
  },
  async ({ entityType, data }) => {
    const db = getDb();
    const meta = TABLE_MAP[entityType];

    // Remove timestamps and nulls
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'createdAt' || k === 'updatedAt' || k === 'created_at' || k === 'updated_at') continue;
      if (v === null || v === undefined) continue;
      cleaned[k] = v;
    }

    const snakeData = prepareRow(cleaned);
    const cols = Object.keys(snakeData);
    const placeholders = cols.map(() => '?').join(', ');
    const values = Object.values(snakeData);

    const info = db.prepare(`INSERT INTO ${meta.sqlTable} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
    const newId = info.lastInsertRowid as number;

    logChange({ entityType: meta.entityType, entityId: newId, action: 'INSERT', reasoning: 'via MCP schema_create' });

    const created = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(newId) as Record<string, unknown>;
    return { content: [{ type: 'text' as const, text: JSON.stringify(parseRow(created), null, 2) }] };
  },
);

// ─── schema_update ────────────────────────────────────────────────────────────

server.tool(
  'schema_update',
  'Update an existing entity and log the changes',
  {
    entityType: z.enum(['module', 'feature', 'table', 'field', 'concern', 'rule', 'discussion', 'step', 'feature_test', 'prototype', 'concept']),
    id: z.number().describe('Entity primary key'),
    data: z.record(z.unknown()).describe('Fields to update in camelCase'),
  },
  async ({ entityType, id, data }) => {
    const db = getDb();
    const meta = TABLE_MAP[entityType];

    const oldRow = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown> | undefined;
    if (!oldRow) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `${entityType} with id ${id} not found` }) }] };
    }

    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'createdAt' || k === 'created_at') continue;
      cleaned[k] = v;
    }
    cleaned.updatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const snakeData = prepareRow(cleaned);
    delete snakeData[meta.idCol];

    const setClauses = Object.keys(snakeData).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(snakeData), id];

    db.prepare(`UPDATE ${meta.sqlTable} SET ${setClauses} WHERE ${meta.idCol} = ?`).run(...values);

    // Diff and log changed fields
    for (const [snakeKey, newVal] of Object.entries(snakeData)) {
      if (snakeKey === 'updated_at') continue;
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
          reasoning: 'via MCP schema_update',
        });
      }
    }

    const updated = db.prepare(`SELECT * FROM ${meta.sqlTable} WHERE ${meta.idCol} = ?`).get(id) as Record<string, unknown>;
    return { content: [{ type: 'text' as const, text: JSON.stringify(parseRow(updated), null, 2) }] };
  },
);

// ─── schema_discuss ───────────────────────────────────────────────────────────

server.tool(
  'schema_discuss',
  'Add a discussion note to any entity (ideal for storing Claude Code research and analysis)',
  {
    entityType: z.string().describe('Entity type the note relates to (module, feature, table, etc.)'),
    entityId: z.number().describe('ID of the entity'),
    title: z.string().describe('Short title for the discussion'),
    content: z.string().describe('Full discussion content / analysis'),
  },
  async ({ entityType, entityId, title, content }) => {
    const db = getDb();
    const info = db.prepare(
      'INSERT INTO _splan_discussions (entity_type, entity_id, title, content, source) VALUES (?, ?, ?, ?, ?)'
    ).run(entityType, entityId, title, content, 'claude_code');

    const created = db.prepare('SELECT * FROM _splan_discussions WHERE discussion_id = ?').get(info.lastInsertRowid) as Record<string, unknown>;
    return { content: [{ type: 'text' as const, text: JSON.stringify(parseRow(created), null, 2) }] };
  },
);

// ─── schema_stats ─────────────────────────────────────────────────────────────

server.tool(
  'schema_stats',
  'Get row counts for all Schema Planner entity tables',
  {},
  async () => {
    const db = getDb();
    const allTables = [
      '_splan_modules', '_splan_data_tables', '_splan_data_fields',
      '_splan_features', '_splan_feature_concerns', '_splan_data_access_rules',
      '_splan_feature_data_reviews', '_splan_entity_or_module_rules',
      '_splan_grouping_presets', '_splan_tag_catalog', '_splan_discussions',
      '_splan_change_log', '_splan_module_use_fields', '_splan_implementation_steps',
      '_splan_feature_tests', '_splan_prototypes',
    ];

    const counts: Record<string, number> = {};
    for (const table of allTables) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
      counts[table] = row.cnt;
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(counts, null, 2) }] };
  },
);

// ─── Start transport ──────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
