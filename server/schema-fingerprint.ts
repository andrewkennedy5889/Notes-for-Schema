import crypto from 'crypto';
import type Database from 'better-sqlite3';

export function listSchemaTables(db: Database.Database): string[] {
  return (db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_splan_%' ORDER BY name"
  ).all() as Array<{ name: string }>).map((t) => t.name);
}

export function hashSchemaTables(tables: string[]): string {
  return crypto.createHash('sha256').update(tables.join('\n')).digest('hex');
}

export function schemaFingerprint(db: Database.Database): string {
  return hashSchemaTables(listSchemaTables(db));
}
