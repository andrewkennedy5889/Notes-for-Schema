// ─── Case Conversion ─────────────────────────────────────────────────────────

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toSnake(s: string): string {
  return s.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}

export function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[toCamel(key)] = val;
  }
  return result;
}

export function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    result[toSnake(key)] = val;
  }
  return result;
}

// ─── JSON columns that must be parsed on read / stringified on write ─────────

export const JSON_COLUMNS = new Set([
  'platforms',
  'tags',
  'modules',
  'data_tables',
  'data_fields',
  'images',
  'notes_fmt',
  'native_notes_fmt',
  'android_notes_fmt',
  'apple_notes_fmt',
  'other_notes_fmt',
  'impl_fmt',
  'collapsed_sections',
  'embedded_tables',
  'feature_tags',
  'checklist',
  'conditions',
  'config',
  'dependencies',
  'features',
  'tests',
  'view_config',
  'failed_tests',
  'linked_tables',
  'linked_fields',
  'sources',
  'options',
]);

// ─── Boolean integer columns ──────────────────────────────────────────────────

export const BOOL_COLUMNS = new Set([
  'is_system_created',
  'is_required',
  'is_unique',
  'is_foreign_key',
  'is_active',
]);

// ─── Parse a row coming OUT of SQLite ────────────────────────────────────────

export function parseRow(row: Record<string, unknown>): Record<string, unknown> {
  const camel = snakeToCamel(row);
  for (const [key, val] of Object.entries(camel)) {
    const snakeKey = toSnake(key);

    // Parse JSON columns
    if (JSON_COLUMNS.has(snakeKey) && typeof val === 'string') {
      try {
        camel[key] = JSON.parse(val);
      } catch {
        camel[key] = val;
      }
    }

    // Convert boolean integers
    if (BOOL_COLUMNS.has(snakeKey) && (val === 0 || val === 1)) {
      camel[key] = val === 1;
    }
  }
  return camel;
}

// ─── Prepare a row going INTO SQLite ─────────────────────────────────────────

export function prepareRow(obj: Record<string, unknown>): Record<string, unknown> {
  const snake = camelToSnake(obj);
  for (const [key, val] of Object.entries(snake)) {
    // Stringify JSON columns
    if (JSON_COLUMNS.has(key) && val !== null && val !== undefined && typeof val !== 'string') {
      snake[key] = JSON.stringify(val);
    }

    // Convert booleans to integers
    if (BOOL_COLUMNS.has(key) && typeof val === 'boolean') {
      snake[key] = val ? 1 : 0;
    }
  }
  return snake;
}
