import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildConceptResearcherInputs,
  validateConceptResearcherResults,
  writeConceptResearcherResults,
  CONCEPT_RESEARCHER_PROMPT_TEMPLATE,
} from './concept-researcher.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE _splan_concepts (
      concept_id INTEGER PRIMARY KEY AUTOINCREMENT,
      concept_name TEXT NOT NULL,
      description TEXT,
      concept_type TEXT NOT NULL DEFAULT 'Idea',
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE _splan_research (
      research_id INTEGER PRIMARY KEY AUTOINCREMENT,
      concept_id INTEGER REFERENCES _splan_concepts(concept_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT,
      findings TEXT,
      sources TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      researched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

let db: Database.Database;

beforeEach(() => { db = freshDb(); });
afterEach(() => { db.close(); });

describe('buildConceptResearcherInputs', () => {
  it('returns empty concepts array on empty DB', () => {
    const work = buildConceptResearcherInputs({ db, params: {} });
    expect(work.concepts).toEqual([]);
  });

  it('filters by status=draft by default', () => {
    db.prepare(
      `INSERT INTO _splan_concepts (concept_name, description, notes, status) VALUES (?, ?, ?, ?)`
    ).run('Alpha', 'desc A', 'notes A', 'draft');
    db.prepare(
      `INSERT INTO _splan_concepts (concept_name, status) VALUES (?, ?)`
    ).run('Beta', 'researched');

    const work = buildConceptResearcherInputs({ db, params: {} });
    expect(work.concepts).toHaveLength(1);
    expect(work.concepts[0].name).toBe('Alpha');
    expect(work.concepts[0].description).toBe('desc A');
    expect(work.concepts[0].existingNotes).toBe('notes A');
  });

  it('honors explicit status filter', () => {
    db.prepare(
      `INSERT INTO _splan_concepts (concept_name, status) VALUES (?, ?)`
    ).run('Gamma', 'researched');
    const work = buildConceptResearcherInputs({ db, params: { status: 'researched' } });
    expect(work.concepts).toHaveLength(1);
    expect(work.concepts[0].name).toBe('Gamma');
  });

  it('status=all ignores filter', () => {
    db.prepare(`INSERT INTO _splan_concepts (concept_name, status) VALUES ('A','draft')`).run();
    db.prepare(`INSERT INTO _splan_concepts (concept_name, status) VALUES ('B','archived')`).run();
    const work = buildConceptResearcherInputs({ db, params: { status: 'all' } });
    expect(work.concepts).toHaveLength(2);
  });

  it('caps limit at 5', () => {
    for (let i = 0; i < 8; i++) {
      db.prepare(`INSERT INTO _splan_concepts (concept_name, status) VALUES (?, 'draft')`).run(`c${i}`);
    }
    const work = buildConceptResearcherInputs({ db, params: { limit: 99 } });
    expect(work.concepts).toHaveLength(5);
  });

  it('includes recent research titles as context', () => {
    db.prepare(`INSERT INTO _splan_concepts (concept_id, concept_name, status) VALUES (1, 'C', 'draft')`).run();
    db.prepare(`INSERT INTO _splan_research (concept_id, title) VALUES (1, 'Prior 1'), (1, 'Prior 2')`).run();
    const work = buildConceptResearcherInputs({ db, params: {} });
    expect(work.concepts[0].existingResearchTitles).toEqual(['Prior 2', 'Prior 1']);
  });
});

describe('validateConceptResearcherResults', () => {
  const good = {
    conceptId: 1,
    title: 'Test',
    summary: 's',
    findings: 'f',
    sources: [{ url: 'https://x', title: 't' }],
  };

  it('accepts well-formed findings', () => {
    expect(validateConceptResearcherResults({ findings: [good] })).toEqual({ ok: true });
  });

  it('rejects non-array findings', () => {
    expect(validateConceptResearcherResults({ findings: {} })).toEqual({ ok: false, error: 'findings_not_array' });
  });

  it('rejects missing conceptId', () => {
    const bad = { ...good, conceptId: 'one' as unknown as number };
    expect(validateConceptResearcherResults({ findings: [bad] })).toEqual({ ok: false, error: 'findings[0].conceptId_missing' });
  });

  it('rejects empty title', () => {
    expect(validateConceptResearcherResults({ findings: [{ ...good, title: '  ' }] }))
      .toEqual({ ok: false, error: 'findings[0].title_missing' });
  });

  it('rejects non-array sources', () => {
    expect(validateConceptResearcherResults({ findings: [{ ...good, sources: 'nope' }] }))
      .toEqual({ ok: false, error: 'findings[0].sources_not_array' });
  });

  it('rejects source without url', () => {
    expect(validateConceptResearcherResults({ findings: [{ ...good, sources: [{ title: 't' }] }] }))
      .toEqual({ ok: false, error: 'findings[0].sources[0].url_missing' });
  });
});

describe('writeConceptResearcherResults', () => {
  it('writes research rows and appends concept notes in transaction', () => {
    db.prepare(`INSERT INTO _splan_concepts (concept_id, concept_name, status, notes) VALUES (1, 'C', 'draft', 'pre')`).run();
    const summary = writeConceptResearcherResults({
      db,
      runId: 'run-x',
      findings: [{
        conceptId: 1,
        title: 'My finding',
        summary: 'sum',
        findings: 'body',
        sources: [{ url: 'https://a', title: 'A' }],
      }],
      params: {},
    });
    expect(summary.insertedResearchIds).toHaveLength(1);
    const row = db.prepare('SELECT * FROM _splan_research').get() as Record<string, string | number>;
    expect(row.title).toBe('My finding');
    expect(row.sources).toBe('[{"url":"https://a","title":"A"}]');
    const concept = db.prepare('SELECT notes FROM _splan_concepts WHERE concept_id = 1').get() as { notes: string };
    expect(concept.notes).toMatch(/^pre \(r:\d+:My finding\)/);
  });

  it('rolls back on thrown writer (foreign-key violation)', () => {
    const countBefore = (db.prepare('SELECT COUNT(*) as c FROM _splan_research').get() as { c: number }).c;
    expect(() => writeConceptResearcherResults({
      db,
      runId: 'run-y',
      findings: [
        { conceptId: 999, title: 'will-fail', summary: '', findings: '', sources: [] },
      ],
      params: {},
    })).toThrow();
    const countAfter = (db.prepare('SELECT COUNT(*) as c FROM _splan_research').get() as { c: number }).c;
    expect(countAfter).toBe(countBefore);
  });
});

describe('prompt template', () => {
  it('contains both placeholders for later interpolation', () => {
    expect(CONCEPT_RESEARCHER_PROMPT_TEMPLATE).toContain('{RAILWAY_URL}');
    expect(CONCEPT_RESEARCHER_PROMPT_TEMPLATE).toContain('{SCHEDULED_AGENT_TOKEN}');
  });
});
