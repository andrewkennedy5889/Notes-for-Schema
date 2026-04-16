import { describe, it, expect } from 'vitest';
import { snakeToCamel, camelToSnake, parseRow, prepareRow, JSON_COLUMNS, BOOL_COLUMNS } from '../server/utils.js';

describe('snakeToCamel', () => {
  it('converts simple snake_case keys', () => {
    const result = snakeToCamel({ module_id: 1, module_name: 'Test' });
    expect(result).toEqual({ moduleId: 1, moduleName: 'Test' });
  });

  it('converts multi-word snake_case keys', () => {
    const result = snakeToCamel({ is_foreign_key: 1, data_table_id: 5 });
    expect(result).toEqual({ isForeignKey: 1, dataTableId: 5 });
  });

  it('leaves already-camelCase keys unchanged', () => {
    const result = snakeToCamel({ featureId: 1 });
    expect(result).toEqual({ featureId: 1 });
  });

  it('handles empty object', () => {
    expect(snakeToCamel({})).toEqual({});
  });

  it('handles keys with no underscores', () => {
    const result = snakeToCamel({ status: 'active', tier: 2 });
    expect(result).toEqual({ status: 'active', tier: 2 });
  });
});

describe('camelToSnake', () => {
  it('converts simple camelCase keys', () => {
    const result = camelToSnake({ moduleId: 1, moduleName: 'Test' });
    expect(result).toEqual({ module_id: 1, module_name: 'Test' });
  });

  it('converts multi-word camelCase keys', () => {
    const result = camelToSnake({ isForeignKey: true, dataTableId: 5 });
    expect(result).toEqual({ is_foreign_key: true, data_table_id: 5 });
  });

  it('handles empty object', () => {
    expect(camelToSnake({})).toEqual({});
  });

  it('leaves already-snake_case keys unchanged', () => {
    const result = camelToSnake({ status: 'active' });
    expect(result).toEqual({ status: 'active' });
  });

  it('round-trips with snakeToCamel', () => {
    const original = { module_name: 'Test', data_table_id: 3, is_required: 1 };
    const roundTripped = camelToSnake(snakeToCamel(original) as Record<string, unknown>);
    expect(roundTripped).toEqual(original);
  });
});

describe('parseRow (JSON columns)', () => {
  it('parses platforms JSON string to array', () => {
    const row = { platforms: '["Web App","Mobile"]' };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.platforms).toEqual(['Web App', 'Mobile']);
  });

  it('parses tags JSON string to array', () => {
    const row = { tags: '["auth","billing"]' };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.tags).toEqual(['auth', 'billing']);
  });

  it('parses collapsed_sections JSON object', () => {
    const row = { collapsed_sections: '{"notes":true}' };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.collapsedSections).toEqual({ notes: true });
  });

  it('handles malformed JSON gracefully (keeps as string)', () => {
    const row = { platforms: 'not-json' };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.platforms).toBe('not-json');
  });

  it('handles null JSON column values', () => {
    const row = { platforms: null };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.platforms).toBeNull();
  });
});

describe('parseRow (boolean columns)', () => {
  it('converts 1 to true for is_required', () => {
    const row = { is_required: 1 };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.isRequired).toBe(true);
  });

  it('converts 0 to false for is_required', () => {
    const row = { is_required: 0 };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.isRequired).toBe(false);
  });

  it('converts is_system_created 1 to true', () => {
    const row = { is_system_created: 1 };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.isSystemCreated).toBe(true);
  });

  it('does not convert non-bool integer columns', () => {
    const row = { tier: 2 };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.tier).toBe(2);
  });
});

describe('prepareRow (JSON columns)', () => {
  it('stringifies array values for JSON columns', () => {
    const input = { platforms: ['Web App', 'Mobile'] };
    const result = prepareRow(input as Record<string, unknown>);
    expect(result.platforms).toBe('["Web App","Mobile"]');
  });

  it('stringifies object values for JSON columns', () => {
    const input = { collapsedSections: { notes: true } };
    const result = prepareRow(input as Record<string, unknown>);
    expect(result.collapsed_sections).toBe('{"notes":true}');
  });

  it('leaves string JSON columns as-is (already stringified)', () => {
    const input = { platforms: '["Web App"]' };
    const result = prepareRow(input as Record<string, unknown>);
    expect(result.platforms).toBe('["Web App"]');
  });

  it('converts true to 1 for boolean columns', () => {
    const input = { isRequired: true };
    const result = prepareRow(input as Record<string, unknown>);
    expect(result.is_required).toBe(1);
  });

  it('converts false to 0 for boolean columns', () => {
    const input = { isSystemCreated: false };
    const result = prepareRow(input as Record<string, unknown>);
    expect(result.is_system_created).toBe(0);
  });
});

describe('JSON_COLUMNS and BOOL_COLUMNS sets', () => {
  it('JSON_COLUMNS includes expected entries', () => {
    expect(JSON_COLUMNS.has('platforms')).toBe(true);
    expect(JSON_COLUMNS.has('tags')).toBe(true);
    expect(JSON_COLUMNS.has('conditions')).toBe(true);
    expect(JSON_COLUMNS.has('config')).toBe(true);
    expect(JSON_COLUMNS.has('collapsed_sections')).toBe(true);
  });

  it('BOOL_COLUMNS includes expected entries', () => {
    expect(BOOL_COLUMNS.has('is_required')).toBe(true);
    expect(BOOL_COLUMNS.has('is_unique')).toBe(true);
    expect(BOOL_COLUMNS.has('is_system_created')).toBe(true);
    expect(BOOL_COLUMNS.has('is_active')).toBe(true);
  });

  it('JSON_COLUMNS does not include non-JSON columns', () => {
    expect(JSON_COLUMNS.has('module_name')).toBe(false);
    expect(JSON_COLUMNS.has('status')).toBe(false);
  });
});

describe('edge cases', () => {
  it('parseRow handles nested JSON objects in config column', () => {
    const row = { config: '{"groupBy":"status","sort":"asc","filters":[1,2,3]}' };
    const result = parseRow(row as Record<string, unknown>);
    expect(result.config).toEqual({ groupBy: 'status', sort: 'asc', filters: [1, 2, 3] });
  });

  it('prepareRow handles null values without throwing', () => {
    const input = { moduleName: null, platforms: null };
    const result = prepareRow(input as Record<string, unknown>);
    expect(result.module_name).toBeNull();
    expect(result.platforms).toBeNull();
  });

  it('prepareRow handles empty array for JSON column', () => {
    const input = { tags: [] };
    const result = prepareRow(input as Record<string, unknown>);
    expect(result.tags).toBe('[]');
  });

  it('snakeToCamel converts leading underscore segment (e.g. _private → Private)', () => {
    // The regex replaces _<letter> with uppercase letter, so _private → Private
    const result = snakeToCamel({ _private: 'value' });
    expect(result['Private']).toBe('value');
  });
});
