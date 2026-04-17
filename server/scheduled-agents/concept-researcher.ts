import type Database from 'better-sqlite3';

export type ConceptResearcherParams = { limit?: number | string; status?: string };

export type InputsBuilderCtx = {
  db: Database.Database;
  params: ConceptResearcherParams;
};

export type WriterCtx = {
  db: Database.Database;
  runId: string;
  findings: ConceptFinding[];
  params: ConceptResearcherParams;
};

export type ConceptFinding = {
  conceptId: number;
  title: string;
  summary: string;
  findings: string;
  sources: Array<{ url: string; title: string }>;
};

export type Validation = { ok: true } | { ok: false; error: string };

export type Summary = { runId: string; insertedResearchIds: number[]; summary: string };

export type Work = {
  concepts: Array<{
    conceptId: number;
    name: string;
    description: string;
    existingNotes: string;
    existingResearchTitles: string[];
  }>;
};

export const CONCEPT_RESEARCHER_PROMPT_TEMPLATE = `You are Concept Researcher running as a scheduled agent. Your job is to research one or more concepts from a product planning database and return findings as JSON.

Steps:
1. Call: curl -sS -H "Authorization: Bearer {SCHEDULED_AGENT_TOKEN}" {RAILWAY_URL}/api/agents/work/concept-researcher/inputs
2. If the response contains { skip: "..." }, print the reason and exit. Do NOT do any research.
3. Otherwise parse { runId, work: { concepts: [...] } }. For each concept:
   - Read concept.name, concept.description, concept.existingNotes, concept.existingResearchTitles.
   - Use WebSearch (max 3 queries per concept) to find sources that inform the concept.
   - Synthesize a short research entry: title (<=80 chars), summary (<=400 chars), findings (<=1500 chars), sources (array of {url, title}).
4. POST the results:
   curl -sS -X POST -H "Authorization: Bearer {SCHEDULED_AGENT_TOKEN}" -H "Content-Type: application/json" \\
        -d '{"runId":"...","findings":[{"conceptId":N,"title":"...","summary":"...","findings":"...","sources":[...]}], "toolCalls":[...optional]}' \\
        {RAILWAY_URL}/api/agents/work/concept-researcher/results

Hard rules:
- findings[].conceptId MUST match one of the concepts in the input.
- findings[].sources MUST be a JSON array of objects with "url" and "title" string fields.
- If any research fails, omit that entry from findings rather than POSTing a partial bad shape.
- If the whole firing fails, POST { runId, error: "description" } so the run is still logged.
- Do not exceed 5 concepts per firing even if inputs contains more — POST what you have and stop.

Output: nothing on stdout other than the curl response bodies. Do not narrate.`;

export function buildConceptResearcherInputs({ db, params }: InputsBuilderCtx): Work {
  const limit = Math.min(Math.max(Number(params.limit ?? 5) || 5, 1), 5);
  const statusFilter = params.status === 'all' ? null : (params.status ?? 'draft');

  const rows = (statusFilter
    ? db.prepare(
        `SELECT concept_id, concept_name, description, notes, status, updated_at
         FROM _splan_concepts WHERE status = ? ORDER BY updated_at ASC LIMIT ?`
      ).all(statusFilter, limit)
    : db.prepare(
        `SELECT concept_id, concept_name, description, notes, status, updated_at
         FROM _splan_concepts ORDER BY updated_at ASC LIMIT ?`
      ).all(limit)) as Array<{
        concept_id: number;
        concept_name: string;
        description: string | null;
        notes: string | null;
        status: string;
        updated_at: string;
      }>;

  const titleStmt = db.prepare(
    'SELECT title FROM _splan_research WHERE concept_id = ? ORDER BY research_id DESC LIMIT 20'
  );

  const concepts = rows.map((r) => ({
    conceptId: r.concept_id,
    name: r.concept_name,
    description: r.description ?? '',
    existingNotes: (r.notes ?? '').slice(0, 2000),
    existingResearchTitles: (titleStmt.all(r.concept_id) as Array<{ title: string }>).map((x) => x.title),
  }));

  return { concepts };
}

export function validateConceptResearcherResults({ findings }: { findings: unknown }): Validation {
  if (!Array.isArray(findings)) return { ok: false, error: 'findings_not_array' };
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i] as Record<string, unknown> | null | undefined;
    if (!f || typeof f !== 'object') return { ok: false, error: `findings[${i}]_not_object` };
    if (typeof f.conceptId !== 'number') return { ok: false, error: `findings[${i}].conceptId_missing` };
    if (typeof f.title !== 'string' || !f.title.trim()) return { ok: false, error: `findings[${i}].title_missing` };
    if (typeof f.summary !== 'string') return { ok: false, error: `findings[${i}].summary_missing` };
    if (typeof f.findings !== 'string') return { ok: false, error: `findings[${i}].findings_missing` };
    if (!Array.isArray(f.sources)) return { ok: false, error: `findings[${i}].sources_not_array` };
    for (let j = 0; j < f.sources.length; j++) {
      const s = f.sources[j] as Record<string, unknown> | null | undefined;
      if (!s || typeof s !== 'object') return { ok: false, error: `findings[${i}].sources[${j}]_not_object` };
      if (typeof s.url !== 'string') return { ok: false, error: `findings[${i}].sources[${j}].url_missing` };
      if (typeof s.title !== 'string') return { ok: false, error: `findings[${i}].sources[${j}].title_missing` };
    }
  }
  return { ok: true };
}

export function writeConceptResearcherResults({ db, runId, findings }: WriterCtx): Summary {
  const inserted: number[] = [];
  const insertStmt = db.prepare(
    `INSERT INTO _splan_research (concept_id, title, summary, findings, sources, status, researched_at)
     VALUES (?, ?, ?, ?, ?, 'new', datetime('now'))`
  );
  const appendNoteStmt = db.prepare(
    `UPDATE _splan_concepts SET notes = COALESCE(notes, '') || ?, updated_at = datetime('now')
     WHERE concept_id = ?`
  );

  const txn = db.transaction(() => {
    for (const f of findings) {
      const info = insertStmt.run(
        f.conceptId,
        f.title.slice(0, 200),
        f.summary.slice(0, 600),
        f.findings.slice(0, 4000),
        JSON.stringify(f.sources)
      );
      const researchId = Number(info.lastInsertRowid);
      inserted.push(researchId);
      const marker = ` (r:${researchId}:${f.title.replace(/[)(]/g, '').slice(0, 60)})`;
      appendNoteStmt.run(marker, f.conceptId);
    }
  });
  txn();

  return { runId, insertedResearchIds: inserted, summary: `Added ${inserted.length} research row(s).` };
}
