import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { listSchemaTables, hashSchemaTables, schemaFingerprint } from './schema-fingerprint.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE _splan_a (id INTEGER PRIMARY KEY);
    CREATE TABLE _splan_b (id INTEGER PRIMARY KEY);
    CREATE TABLE some_other_table (id INTEGER PRIMARY KEY);
  `);
});
afterEach(() => { db.close(); });

describe('schemaFingerprint', () => {
  it('lists only _splan_ tables, sorted', () => {
    expect(listSchemaTables(db)).toEqual(['_splan_a', '_splan_b']);
  });

  it('is stable across row insertions', () => {
    const before = schemaFingerprint(db);
    db.exec(`INSERT INTO _splan_a DEFAULT VALUES; INSERT INTO _splan_b DEFAULT VALUES;`);
    expect(schemaFingerprint(db)).toBe(before);
  });

  it('changes when a table is added', () => {
    const before = schemaFingerprint(db);
    db.exec('CREATE TABLE _splan_c (id INTEGER PRIMARY KEY);');
    expect(schemaFingerprint(db)).not.toBe(before);
  });

  it('changes when a table is dropped', () => {
    const before = schemaFingerprint(db);
    db.exec('DROP TABLE _splan_b;');
    expect(schemaFingerprint(db)).not.toBe(before);
  });

  it('hashSchemaTables is deterministic', () => {
    expect(hashSchemaTables(['_splan_x', '_splan_y'])).toBe(hashSchemaTables(['_splan_x', '_splan_y']));
    expect(hashSchemaTables(['_splan_x', '_splan_y'])).not.toBe(hashSchemaTables(['_splan_y', '_splan_x']));
  });
});
