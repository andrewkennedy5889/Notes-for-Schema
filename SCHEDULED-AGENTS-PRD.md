# Scheduled Agents PRD

**Purpose**: make scheduled Schema Planner agents (starting with Concept Researcher) run reliably against the Railway-hosted Schema Planner instance while the local device is off, without ever operating on stale schema, without silently wiping data, with overnight output visible to the user the next morning, and **without any metered Anthropic API charges** — all LLM work is performed by the cron-fired Claude Code session, which is billed against the user's Max subscription.

**Target implementation**: separate session with fresh context. This document is self-contained.

**Revision note (2026-04-17)**: this PRD was re-architected mid-plan when the original design required `@anthropic-ai/sdk` on Railway (API-metered). The revised design — inputs-broker + cron-Claude-as-worker — keeps all token usage on the Max plan. See §1.6 for the billing-constraint rationale.

---

## 0. How to execute this PRD

### 0.1 Execution mode

Implement **pure-code phases** (2, 3, 4, 5, 7, 8) end-to-end on a single branch. Stop and hand back to the user at every `[REQUIRES USER]` checkpoint. Do **not** attempt infrastructure actions (Railway volume, Railway env vars, cron migrations) yourself — those are user-driven.

§12 "Rollout" describes a multi-week soak with 48h observation gates. **Ignore that for session execution.** Land all implemented phases on one branch with logical per-phase commits; the user will handle soak, flag flipping, and production cutover manually after review.

### 0.2 Per-phase user checkpoints

| Phase | Who executes | Why |
|---|---|---|
| 1 — Railway volume | **User** | Requires Railway CLI + account access to create a mounted volume. |
| 2 — `_splan_scheduled_runs` table | Agent | Pure migration in `server/db.ts`. |
| 3 — Schema fingerprint pinning | Agent | Pure code. |
| 4 — `work/:agentId/inputs` + `work/:agentId/results` endpoints | Agent | Pure code. Two endpoints, not one. |
| 5 — Concept Researcher inputs-builder + prompt template | Agent | Pure code. **No Anthropic SDK.** |
| 6 — Rewrite cron prompt + migrate existing schedules | **User** | Requires `claude schedule` CLI against Anthropic's cloud; deleting/recreating live triggers is destructive. |
| 7 — Departure gate | Agent | Pure React in `SchemaPlanner.tsx`. |
| 8 — Auto-pull + history panel + prompt inspector | Agent | Pure code. Phase 8 now also covers the monitoring UI from §14. |

### 0.3 Commit conventions

One commit per phase. Message format: `phase-N: <short summary>` (e.g., `phase-2: add _splan_scheduled_runs table`). Matches the terseness of recent project history without adopting conventional-commits prefixes.

### 0.4 Hard constraints (do not violate)

- **Do not touch `POST /api/agents/launch`** (server/index.ts:1383) or any path exercised by the on-demand Launch button. Goal #7 is that the interactive path stays identical.
- **Do not modify the `/schema` skill** at `~/.claude/skills/schema/skill.md`. It stays stdio-only for interactive use. This PRD's solution routes around it, not through it.
- **Do not add backwards-compat shims** for the old prompt-based scheduled flow. Per `CLAUDE.md`, delete cleanly.
- **Do not run `claude schedule delete` on existing live triggers** — the user handles that as part of Phase 6.
- **Do not add `@anthropic-ai/sdk` as a dependency.** Do not add `ANTHROPIC_API_KEY` as an env var. All LLM work happens inside the cron-fired Claude Code session (Max-billed).

### 0.5 Testing the running app

Use the `schema-planner-start` skill (available in this environment) to start the Vite + Express dev stack rather than invoking `npm run dev` manually. Run `npm test` (Vitest) after each phase; the project has a 15s per-test timeout and runs in the node environment.

For UI changes (Phase 7, Phase 8), per `CLAUDE.md` you must drive the feature in a browser before claiming done. If you cannot (no browser access in this environment), say so explicitly in the handoff note rather than claiming success.

### 0.6 When to stop and ask

- If `_splan_research` or `_splan_concepts` tables don't exist when you reach Phase 5 (see Phase 5 precondition check).
- If any `[REQUIRES USER]` marker is encountered and skipping it would block subsequent phases.
- If the project's `getSchemaTables()` helper (referenced in §5.2 and §6.3) is not found where expected.
- If a test you write fails for a reason you can't diagnose in under 10 minutes.

---

## 1. Context for a fresh session

### 1.1 Project

Schema Planner — React 19 + Vite 8 + Express 5 + better-sqlite3. Runs locally on ports 3100/5173 and is deployed to Railway at `https://notes-for-schema-production.up.railway.app` using `railway.toml` + `Dockerfile`. The Railway instance runs identical code against a **separate SQLite database**; the two DBs are reconciled via explicit Push/Pull operations in Settings → Data Sync.

### 1.2 Existing agent system (already shipped — do not rebuild)

`src/components/schema-planner/AgentsTab.tsx` declares a static `AGENTS` array of nine agents. The schedulable ones (today only Concept Researcher, flagged `schedulable: true`) expose a SCHEDULE accordion in the UI.

Current flow:

- **On-demand Launch**: client interpolates params → `POST /api/agents/launch` (server/index.ts:1383) → server writes prompt file + PowerShell launcher → spawns local `claude -p` session → agent writes results to `.splan/agent-results/<runId>.json`.
- **Scheduled runs**: client → `POST /api/agents/schedules` (server/index.ts:1477) → server `exec`s `claude schedule create --name … --cron … --prompt …` → Anthropic's trigger system fires the prompt at cron time in a cloud Claude Code runtime (**billed against the user's Max subscription**, same pool as interactive Claude Code usage).

The cloud-fired Claude session has **no access** to the local `schema-planner` MCP (stdio transport only), so any prompt saying "Use the /schema skill…" fails silently in scheduled mode. This PRD fixes that by giving the cron session **REST endpoints** to read/write against instead.

### 1.3 Existing sync system (already shipped — depend on, don't rebuild)

Per `docs/prds/DATA-SYNC-HARDENING-PRD.md`:

- `GET /api/sync/remote-status` returns `{ lastSync, remote: {changeCount}, local: {changeCount}, schema: {match, missingOnRemote, missingOnLocal} }`.
- `POST /api/sync/push` and `/api/sync/pull` refuse on schema mismatch (not force-overridable). Conflict detection rejects with 409 unless `?force=true`.
- `POST /api/sync/deploy-code` commits + pushes + polls remote `/api/version` for SHA match + auto-pushes data post-deploy.
- Auto-sync setting fires push/pull automatically when only one side has changes and schemas match.
- `_splan_sync_meta` logs every sync attempt. `_splan_change_log` counts drift since last sync.

### 1.4 Files to know

| Path | Role |
|---|---|
| `server/index.ts` | All Express routes. New routes in this PRD go here. |
| `src/components/schema-planner/AgentsTab.tsx` | Agent definitions + launch/schedule UI. Prompt inspector + history panel go here. |
| `src/pages/SchemaPlanner.tsx` | Main page; departure-gate logic goes here. |
| `src/lib/api.ts` | Frontend API client. New endpoints get typed functions here. |
| `server/db.ts` | DB init + migrations. New `_splan_scheduled_runs` table added here. |
| `server/utils.ts` | `parseRow` / `prepareRow` case conversion. New fields must round-trip. |
| `server/scheduled-agents/concept-researcher.ts` | **New** — inputs-builder + prompt template + results-validator. Pure code, no SDK. |
| `railway.toml`, `Dockerfile` | Railway deployment config. Volume mount added here. |
| `.splan/agent-schedules.json` | Persisted schedule configs; extended with `expectedSchemaFingerprint` + `promptSnapshot`. |

### 1.5 Conventions

Per `CLAUDE.md`:

- DB columns `snake_case`, API/frontend `camelCase`, converted via `parseRow` / `prepareRow`.
- All DB tables prefixed `_splan_`.
- New JSON columns must be registered for auto-parse/stringify.
- No comments unless explaining non-obvious *why*. No feature flags or backwards-compat shims.
- For UI changes: test in browser before claiming done.
- Read files before editing (enforced by hook).

### 1.6 Billing constraint (non-negotiable)

**All scheduled-agent token usage must be covered by the user's Claude Max subscription. No metered Anthropic API charges under any circumstances.**

This rules out `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY` — that SDK authenticates against the API billing pool, which is separate from Max and metered per token.

What IS covered by Max:
- Interactive Claude Code CLI sessions (OAuth-authenticated).
- **`claude schedule` cron triggers**, which fire headless Claude Code sessions in Anthropic's cloud. These are billed against the subscription that created the trigger, exactly like interactive CLI use.

The architecture in §5 is built around this: the cron-fired Claude session **is** the LLM worker. Railway is a pure data broker with no LLM calls of its own.

---

## 2. The three-state model

Every scheduled run falls into one of three states based on whether the local device is on and whether Railway schema matches the expected fingerprint. This PRD handles all three.

| State | Local on? | Railway schema fresh? | Handling |
|---|---|---|---|
| **S1** | yes | yes or no | Local Express server pre-flights (auto-deploy + auto-sync), then cron runs. |
| **S2** | no | yes | Server-side pre-flight passes. Cron runs against Railway. Local auto-pulls on next app open. |
| **S3** | no | no | Server-side pre-flight fails. Cron is **skipped before any LLM work** with a logged reason. User is notified on next app open. Prevented in the common case by the **departure gate**. |

The departure gate (goal 3) makes S3 rare. The server-side pre-flight (goal 2) makes S3 safe when it happens anyway — and critically, the preflight happens in `GET /inputs` **before** Claude does any token-consuming work. Auto-pull on open (goal 4) makes S2 transparent to the user.

---

## 3. Goals

1. **Scheduled agents run against Railway** without needing any local process alive.
2. **No scheduled run operates on stale schema.** Every run is gated by a server-side fingerprint check that fires before LLM work begins.
3. **User cannot walk away with unresolved sync state.** A departure gate blocks app close when remote is behind or schema mismatches.
4. **Output from overnight runs reaches the local UI automatically.** Auto-pull on app mount when local is clean and remote is ahead.
5. **Every scheduled firing is logged** with a success/skipped/failed verdict visible in the Agents tab. Character counts and estimated token usage surfaced per run (§14).
6. **Railway DB survives code deploys.** Persistent volume for `data/schema.db`.
7. **On-demand agent path is untouched.** The local `Launch` button, `.splan/agent-results/`, stdio MCP, and `/schema` skill all keep working exactly as they do today.
8. **All token usage is covered by the user's Max subscription.** No Anthropic API keys, no metered charges.
9. **Prompt and usage are inspectable.** User can read the exact prompt baked into each schedule, see per-run character counts, and view a rolling estimated-token total per agent.

---

## 4. Non-goals

- Migrating off the two-DB local-plus-Railway model. Turso/libSQL is out of scope.
- Replacing the `/schema` skill. It stays stdio-only for interactive local use.
- Hosting MCP-over-HTTP on Railway. Scheduled agents use the REST API directly; no remote MCP registration.
- **Calling Anthropic's API directly from Railway.** The `@anthropic-ai/sdk` is not a dependency. Railway never makes LLM calls.
- Supporting scheduled agents that *read* schema state the cron-fired Claude cannot reach. Any agent added to this system must either work entirely through the REST API or be flagged `runtime: "local"` and fall back to Windows Task Scheduler (deferred to a follow-up PRD).
- Authenticating individual end users. The Railway endpoints added here use a single shared bearer token (`SCHEDULED_AGENT_TOKEN` env var), consistent with the existing `SYNC_REMOTE_PASSWORD` pattern.
- Tracking exact billed tokens. We expose character counts and rough token estimates (≈ 4 chars/token). Actual billed usage lives in Anthropic's Max dashboard; we link to it from the UI.

---

## 5. Architecture

### 5.1 Scheduled run lifecycle

```
[cron fires in Anthropic cloud — Max-billed Claude Code session]
        │
        │  prompt: (see §6.6 for shape) — tells Claude to:
        │    1. GET {RAILWAY_URL}/api/agents/work/concept-researcher/inputs
        │    2. If { skip: "..." } in response, print the reason and exit.
        │    3. Otherwise do the work per spec, then POST results.
        │
        ├─────── GET /api/agents/work/:agentId/inputs ────────▶ [Railway Express]
        │                                                            │
        │                                                            ├─ load schedule record
        │                                                            ├─ compute schema fingerprint
        │                                                            ├─ if disabled → { skip: "schedule_disabled" }
        │                                                            ├─ if mismatch → { skip: "schema_stale", actualHash }
        │                                                            │     (log skipped row to _splan_scheduled_runs)
        │                                                            └─ on match → inputs-builder for agentId
        │                                                                (e.g., SELECT concepts needing research,
        │                                                                 existing notes as context, current findings list)
        │                                                                returns { runId, work: { ... } }
        │
        │  [Claude reasons + runs WebSearch in its own context]
        │
        └─────── POST /api/agents/work/:agentId/results ──────▶ [Railway Express]
                     body: { runId, findings: [ ... ] }              │
                                                                     ├─ validate body shape
                                                                     ├─ inside db.transaction:
                                                                     │    write to _splan_research,
                                                                     │    append (r:<id>:<title>) to concept notes
                                                                     ├─ log success row to _splan_scheduled_runs
                                                                     │    (with char counts, estimated tokens)
                                                                     └─ return { ran: true, inserted: N }

[next morning, user opens local Schema Planner]
        │
        ▼
[SchemaPlanner.tsx mount]
        │  fetchRemoteStatus()
        ├─ if local clean && remote ahead && schema match: auto-pull
        ├─ fetchScheduledRuns() → render in Agents tab history panel
        └─ if any skipped with reason schema_stale: surface prompt "Deploy now?"
```

### 5.2 Split of responsibilities: Railway vs. cron Claude

**Railway is a data broker. It never calls an LLM.** Its entire role per scheduled agent is:

1. **Preflight** on `GET /inputs`: schedule enabled? schema fingerprint matches? If no, return `{ skip: reason }` and log a skipped row — zero tokens consumed by Claude.
2. **Build inputs**: agent-specific SQL — e.g., for Concept Researcher, `SELECT * FROM _splan_concepts WHERE status = ? ORDER BY updated_at ASC LIMIT ?` plus existing notes for context. Returned as JSON.
3. **Validate results** on `POST /results`: enforce shape (reject with 400 if invalid), enforce runId matches a pending run, write findings inside a single `db.transaction(() => { ... })()` so a mid-run failure rolls back cleanly.
4. **Log**: write to `_splan_scheduled_runs` with char counts, estimated token usage, duration.

**The cron-fired Claude session is the LLM worker.** It does:
- Web search (Claude Code's built-in WebSearch tool — same one used interactively).
- Reasoning over concept context + search results.
- Drafting findings per the JSON schema Railway specified.
- Retry logic (if POST /results returns 400 with a shape error, Claude gets one chance to reformat and retry).

This is the opposite split from the original PRD draft, which put LLM work server-side via `@anthropic-ai/sdk`. That draft is abandoned because of the billing constraint in §1.6.

### 5.3 Why this split works

- **Preflight without LLM tokens**: the fingerprint check happens in `/inputs` before Claude starts reasoning. Stale-schema firings cost one HTTP round-trip, not a research cycle.
- **Schema-aware inputs are code, not prompt**: Railway's inputs-builder is deterministic SQL. Changing what concepts get researched is a code change, not a prompt edit.
- **Prompt is inspectable**: we snapshot the prompt at schedule-creation time (see §14). User can read exactly what Claude received.
- **No CLI/MCP dependency in the cloud**: cron Claude only needs WebSearch + WebFetch (or curl via Bash) tools — all standard Claude Code capabilities available in cloud triggers.
- **Re-runs are semi-deterministic**: same DB state → same inputs → Claude's work varies (LLM non-determinism + web search drift), but the write path (shape, transaction, logging) is identical.
- **Future agents plug into the same two endpoints**: new agent = new inputs-builder function + new prompt-template constant + new results-validator. No new endpoints, no new server infrastructure.

The on-demand interactive flow stays prompt-driven and uses `/schema`. Scheduled flow becomes inputs+results + code-validated. Both share `.splan/agent-results/<runId>.json` as the output format so the history UI treats them identically (scheduled runs write an equivalent JSON blob into `_splan_scheduled_runs.result_json` for rendering).

---

## 6. Implementation phases

Each phase is independently shippable and each makes the next safer.

### Phase 1 — Railway SQLite volume (infra prereq)   `[REQUIRES USER]`

**Why first**: nothing else matters if deploys keep wiping research output.

**User steps** (do not attempt from the agent session):

- Create a Railway volume mounted at `/app/data`.
- Set `DB_PATH=/app/data/schema.db` as a Railway env var on the `notes-for-schema-production` service.
- Set `SCHEDULED_AGENT_TOKEN=<generated-secret>` as a Railway env var.
- Deploy twice back-to-back and confirm row counts survive (`SELECT COUNT(*) FROM _splan_features` before/after).

**Agent-side code change** (safe to do in the same branch as Phases 2–5):

- Change DB path in `server/db.ts` to `process.env.DB_PATH ?? path.join(__dirname, '../data/schema.db')`.
- Audit `Dockerfile` to confirm no DB is baked into the image. If one is, remove it.

**Acceptance**: after `git push → Railway redeploy`, `SELECT COUNT(*) FROM _splan_features` on Railway returns the pre-deploy value.

### Phase 2 — `_splan_scheduled_runs` table

Migration in `server/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS _splan_scheduled_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,        -- ISO timestamp; when the cron was supposed to fire
  fired_at TEXT NOT NULL,            -- ISO timestamp; when /inputs was called
  completed_at TEXT,                 -- ISO timestamp; when /results was received (NULL if skipped/never-completed)
  status TEXT NOT NULL,              -- 'success' | 'skipped' | 'failed' | 'pending'
  skipped_reason TEXT,               -- 'schema_stale' | 'schedule_disabled' | 'no_handler' | 'invalid_result_shape' | 'timeout' | ...
  expected_schema_hash TEXT,
  actual_schema_hash TEXT,
  result_json TEXT,                  -- AgentResult serialized (what was written + summary)
  duration_ms INTEGER,
  prompt_chars INTEGER,              -- size of the baseline prompt baked into the schedule (from promptSnapshot)
  input_chars INTEGER,               -- size of the /inputs response body
  result_chars INTEGER,              -- size of the /results POST body
  estimated_tokens INTEGER,          -- (prompt_chars + input_chars + result_chars) / 4, integer division
  tool_calls_json TEXT               -- optional: JSON array of tool calls Claude self-reported, nullable
);
CREATE INDEX idx_scheduled_runs_agent ON _splan_scheduled_runs (agent_id, fired_at DESC);
```

Add to skip list in push/pull (§1.3 hardening PRD's skip set): this table is Railway-authoritative and must never be overwritten by a push.

Register `result_json`, `tool_calls_json` as JSON columns in `server/utils.ts` (`JSON_COLUMNS`).

### Phase 3 — Schema fingerprint pinning

Extend the schedule record in `.splan/agent-schedules.json`:

```ts
{
  // existing fields: cronExpression, cronLabel, promptOverride, paramDefaults, triggerId, enabled
  expectedSchemaFingerprint: string;  // SHA256 of sorted _splan_ table list
  pinnedAt: string;                   // ISO timestamp
  promptSnapshot: string;             // the exact prompt baked into claude schedule create; see §14
  promptSnapshotAt: string;           // ISO timestamp of when promptSnapshot was written
}
```

Compute the fingerprint via `getSchemaTables()` (already defined in `server/index.ts`) → sort → SHA256. Store on schedule create and on manual "re-pin" (new endpoint `POST /api/agents/schedules/:agentId/repin`).

UI: when fingerprint drifts from current schema, show a "Re-pin" button next to the schedule card — the user is asserting the new schema is intentional.

`promptSnapshot` / `promptSnapshotAt` are written every time the schedule is created or the cron prompt template changes (see §14 — when the stored prompt differs from the current code template, the UI shows a "Prompt out of date — Rebuild schedule" button).

### Phase 4 — Inputs + results endpoints

Two new routes in `server/index.ts`. Auth: bearer token `SCHEDULED_AGENT_TOKEN` in `Authorization` header. Reject if missing or wrong.

```ts
// 4a. Input broker — called by cron Claude at the start of every firing.
app.get('/api/agents/work/:agentId/inputs', requireScheduledToken, async (req, res) => {
  const { agentId } = req.params;
  const schedule = loadSchedule(agentId);
  const runId = generateRunId();
  const firedAt = new Date().toISOString();
  const baseRun = { runId, agentId, scheduledAt: schedule?.scheduledAt ?? firedAt, firedAt };

  if (!schedule?.enabled) {
    logSkippedRun({ ...baseRun, status: 'skipped', skippedReason: 'schedule_disabled' });
    return res.json({ runId, skip: 'schedule_disabled' });
  }

  const actualHash = computeSchemaFingerprint();
  if (actualHash !== schedule.expectedSchemaFingerprint) {
    logSkippedRun({ ...baseRun, status: 'skipped', skippedReason: 'schema_stale',
                   expectedSchemaHash: schedule.expectedSchemaFingerprint, actualSchemaHash: actualHash });
    return res.json({ runId, skip: 'schema_stale', actualHash, expectedHash: schedule.expectedSchemaFingerprint });
  }

  const builder = getInputsBuilder(agentId);
  if (!builder) {
    logSkippedRun({ ...baseRun, status: 'skipped', skippedReason: 'no_handler' });
    return res.json({ runId, skip: 'no_handler' });
  }

  const work = builder({ db: getDb(), params: schedule.paramDefaults ?? {} });

  // Write a pending row so /results can match it; also records prompt_chars from snapshot.
  logPendingRun({ ...baseRun, status: 'pending',
                  expectedSchemaHash: schedule.expectedSchemaFingerprint,
                  actualSchemaHash: actualHash,
                  promptChars: (schedule.promptSnapshot ?? '').length,
                  inputChars: JSON.stringify(work).length });

  return res.json({ runId, work, schemaHash: actualHash });
});

// 4b. Results receiver — called by cron Claude after it finishes its work.
app.post('/api/agents/work/:agentId/results', requireScheduledToken, async (req, res) => {
  const { agentId } = req.params;
  const { runId, findings, error, toolCalls } = req.body ?? {};
  const run = loadPendingRun(runId);
  if (!run || run.agentId !== agentId) {
    return res.status(404).json({ error: 'unknown_run' });
  }

  const resultChars = JSON.stringify(req.body ?? {}).length;

  if (error) {
    logCompletedRun({ runId, status: 'failed', skippedReason: 'claude_reported_error',
                      resultJson: { error }, resultChars, toolCalls });
    return res.json({ ok: true, recorded: 'failed' });
  }

  const validator = getResultsValidator(agentId);
  const validation = validator({ findings });
  if (!validation.ok) {
    logCompletedRun({ runId, status: 'failed', skippedReason: 'invalid_result_shape',
                      resultJson: { error: validation.error, received: req.body }, resultChars, toolCalls });
    return res.status(400).json({ ok: false, reason: 'invalid_result_shape', detail: validation.error });
  }

  try {
    const writer = getResultsWriter(agentId);
    const summary = writer({ db: getDb(), runId, findings, params: run.paramDefaults });
    logCompletedRun({ runId, status: 'success', resultJson: summary, resultChars, toolCalls });
    return res.json({ ran: true, ...summary });
  } catch (e) {
    logCompletedRun({ runId, status: 'failed', skippedReason: 'writer_threw',
                      resultJson: { error: (e as Error).message }, resultChars, toolCalls });
    return res.status(500).json({ ok: false, reason: 'writer_threw', error: (e as Error).message });
  }
});
```

Helpers (`logSkippedRun`, `logPendingRun`, `logCompletedRun`) all update `_splan_scheduled_runs`. `estimated_tokens` is computed at completion as `Math.floor((prompt_chars + input_chars + result_chars) / 4)`.

Rate limit: 1 request per `(agentId, endpoint)` per 60s to prevent replay from a compromised token.

### Phase 5 — First agent: `scheduled-agents/concept-researcher.ts`

**Preconditions (verify before coding — stop and ask if any fail):**

- `_splan_concepts` table exists with at least `concept_id`, `status`, `updated_at`, `notes` columns. Run `SELECT name FROM sqlite_master WHERE type='table' AND name='_splan_concepts'`.
- `_splan_research` table exists with `research_id`, `concept_id`, `title`, `summary`, `findings`, `sources` (JSON), `status`. **Already verified 2026-04-17 at server/db.ts:280 — safe to proceed.**
- `getSchemaTables()` helper exists in `server/index.ts:2418`. **Already verified.**

**Module exports (single file):**

```ts
// server/scheduled-agents/concept-researcher.ts

export const CONCEPT_RESEARCHER_PROMPT_TEMPLATE = `
You are Concept Researcher running as a scheduled agent. Your job is to research one or more concepts from a product planning database and return findings as JSON.

Steps:
1. Call: curl -sS -H "Authorization: Bearer $SCHEDULED_AGENT_TOKEN" {RAILWAY_URL}/api/agents/work/concept-researcher/inputs
2. If the response contains { skip: "..." }, print the reason and exit. Do NOT do any research.
3. Otherwise parse { runId, work: { concepts: [...] } }. For each concept:
   - Read concept.name, concept.description, concept.existingNotes, concept.existingResearchTitles.
   - Use WebSearch (max 3 queries per concept) to find sources that inform the concept.
   - Synthesize a short research entry: title (≤80 chars), summary (≤400 chars), findings (≤1500 chars), sources (array of {url, title}).
4. POST the results:
   curl -sS -X POST -H "Authorization: Bearer $SCHEDULED_AGENT_TOKEN" -H "Content-Type: application/json" \\
        -d '{"runId":"...","findings":[{"conceptId":N,"title":"...","summary":"...","findings":"...","sources":[...]}], "toolCalls":[...optional]}' \\
        {RAILWAY_URL}/api/agents/work/concept-researcher/results

Hard rules:
- findings[].conceptId MUST match one of the concepts in the input.
- findings[].sources MUST be a JSON array of objects with "url" and "title" string fields.
- If any research fails, omit that entry from findings rather than POSTing a partial bad shape.
- If the whole firing fails, POST { runId, error: "description" } so the run is still logged.
- Do not exceed 5 concepts per firing even if inputs contains more — POST what you have and stop.

Output: nothing on stdout other than the curl response bodies. Do not narrate.
`;

export function buildConceptResearcherInputs({ db, params }: InputsBuilderCtx): Work {
  const limit = Math.min(Number(params.limit ?? 5), 5);
  const statusFilter = params.status === 'all' ? null : (params.status ?? 'new');
  const rows = statusFilter
    ? db.prepare(`SELECT concept_id, concept_name, description, notes, status, updated_at
                  FROM _splan_concepts WHERE status = ? ORDER BY updated_at ASC LIMIT ?`).all(statusFilter, limit)
    : db.prepare(`SELECT concept_id, concept_name, description, notes, status, updated_at
                  FROM _splan_concepts ORDER BY updated_at ASC LIMIT ?`).all(limit);

  const concepts = rows.map(r => ({
    conceptId: r.concept_id,
    name: r.concept_name,
    description: r.description ?? '',
    existingNotes: (r.notes ?? '').slice(0, 2000),
    existingResearchTitles: db.prepare(
      'SELECT title FROM _splan_research WHERE concept_id = ? ORDER BY research_id DESC LIMIT 20'
    ).all(r.concept_id).map(x => x.title),
  }));

  return { concepts };
}

export function validateConceptResearcherResults({ findings }: { findings: unknown }): Validation {
  if (!Array.isArray(findings)) return { ok: false, error: 'findings_not_array' };
  for (const [i, f] of findings.entries()) {
    if (typeof f?.conceptId !== 'number') return { ok: false, error: `findings[${i}].conceptId_missing` };
    if (typeof f?.title !== 'string' || !f.title.trim()) return { ok: false, error: `findings[${i}].title_missing` };
    if (typeof f?.summary !== 'string') return { ok: false, error: `findings[${i}].summary_missing` };
    if (typeof f?.findings !== 'string') return { ok: false, error: `findings[${i}].findings_missing` };
    if (!Array.isArray(f?.sources)) return { ok: false, error: `findings[${i}].sources_not_array` };
  }
  return { ok: true };
}

export function writeConceptResearcherResults({ db, runId, findings, params }: WriterCtx): Summary {
  const inserted: number[] = [];
  const txn = db.transaction(() => {
    for (const f of findings) {
      const row = db.prepare(`
        INSERT INTO _splan_research (concept_id, title, summary, findings, sources, status, researched_at)
        VALUES (?, ?, ?, ?, ?, 'new', datetime('now'))
      `).run(f.conceptId, f.title.slice(0, 200), f.summary.slice(0, 600),
             f.findings.slice(0, 4000), JSON.stringify(f.sources));
      const researchId = row.lastInsertRowid as number;
      inserted.push(researchId);

      const marker = ` (r:${researchId}:${f.title.replace(/[)(]/g, '').slice(0, 60)})`;
      db.prepare(`UPDATE _splan_concepts SET notes = COALESCE(notes, '') || ?, updated_at = datetime('now')
                  WHERE concept_id = ?`).run(marker, f.conceptId);
    }
  });
  txn();
  return { runId, insertedResearchIds: inserted, summary: `Added ${inserted.length} research row(s).` };
}
```

**Register in an agent map** (in `server/index.ts` or a new `server/scheduled-agents/registry.ts`):

```ts
const SCHEDULED_AGENTS = {
  'concept-researcher': {
    promptTemplate: CONCEPT_RESEARCHER_PROMPT_TEMPLATE,
    inputsBuilder: buildConceptResearcherInputs,
    resultsValidator: validateConceptResearcherResults,
    resultsWriter: writeConceptResearcherResults,
  },
};
```

**No `@anthropic-ai/sdk` import. No `ANTHROPIC_API_KEY` env var. No LLM call on Railway.** The cron-fired Claude does all reasoning and web search in its Max-billed context.

### Phase 6 — Rewrite the cron prompt   `[REQUIRES USER]` for live-trigger migration

**Agent-side code change** (safe in session):

- Update the `scheduleCmd` construction in `POST /api/agents/schedules` (server/index.ts ~line 1503) so that new schedules bake the **full `CONCEPT_RESEARCHER_PROMPT_TEMPLATE`** into `claude schedule create`, with `{RAILWAY_URL}` and `{SCHEDULED_AGENT_TOKEN}` placeholders interpolated.
- Also snapshot the interpolated prompt into the schedule record's `promptSnapshot` field (§14).
- Add a migration-marker file helper at `.splan/migrations-applied.json` (create if missing) with key `schedules.v2: true` so repeat runs don't re-migrate.

**User steps** (do not attempt from agent session):

- After the code is deployed, run `npm run migrate-schedules-v2` (new script scaffolded in this phase) which iterates `.splan/agent-schedules.json`, calls `claude schedule delete <oldTriggerId>` and re-creates each with the new prompt. This touches live Anthropic cloud triggers and is destructive — user drives it.
- Agent should scaffold the script but **leave it opt-in**: no auto-migration on server boot.

### Phase 7 — Departure gate UX

In `src/pages/SchemaPlanner.tsx`:

- `window.addEventListener('beforeunload', handler)` that checks the cached `syncStatus`.
- If `remote.changeCount > 0 && local.changeCount === 0` → auto-pull silently if the auto-sync setting is on.
- If schema mismatch exists → show a blocking modal: "Remote is missing tables. Scheduled agents may skip. Deploy now?" with buttons: Deploy, Close anyway, Cancel.
- If local has unpushed changes → modal: "You have N unpushed changes. Push before closing?"
- The modal sets `event.returnValue` to force the browser's native confirm dialog as a fallback if the user dismisses the in-app modal.
- Controllable via a new setting: `enforceSyncBeforeClose` (default on), stored in localStorage alongside existing sync settings.

### Phase 8 — Auto-pull + scheduled-run history + prompt inspector

- On `SchemaPlanner.tsx` mount, if `syncStatus.remote.changeCount > 0 && syncStatus.local.changeCount === 0 && syncStatus.schema.match`, fire auto-pull.
- New endpoint `GET /api/agents/scheduled-runs?agentId=&limit=` returning recent rows from `_splan_scheduled_runs` (camelCased via `parseRow`).
- New endpoint `GET /api/agents/schedules/:agentId/prompt` returning `{ promptSnapshot, promptSnapshotAt, currentTemplate, driftDetected }` where `currentTemplate` is the in-code template and `driftDetected` is true when they differ (signals "rebuild schedule").
- New component `ScheduledRunHistory` in `AgentsTab.tsx`, rendered inside each schedulable agent card under the SCHEDULE accordion when a schedule exists. Columns: fired-at (relative), status (colored dot), duration, reason (if skipped), `promptChars`, `inputChars`, `resultChars`, `estimatedTokens`, result summary (expandable).
- New inline **Prompt inspector**: "Inspect prompt" button on each schedule card → opens a modal showing `promptSnapshot` verbatim. If `driftDetected`, show a yellow banner "This schedule's prompt is out of date. Rebuild schedule to sync." with a Rebuild button (which re-runs `claude schedule delete + create`).
- Rolling usage totals: at the top of each schedulable agent card, show "Last 30 days: N runs · ~X estimated tokens" computed from `_splan_scheduled_runs` client-side from the fetched rows.
- On mount, if any `status = 'skipped' AND skipped_reason = 'schema_stale'` rows exist from overnight, surface a top-of-page banner: "N scheduled runs skipped due to schema mismatch. Deploy to fix."

---

## 7. API contracts

### New endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/agents/work/:agentId/inputs` | Bearer token | Preflight + inputs for this firing. Returns `{ runId, skip?, work? }`. |
| POST | `/api/agents/work/:agentId/results` | Bearer token | Receive findings. Validate shape, write in txn, log. |
| GET | `/api/agents/scheduled-runs` | requireLocal (local) or Bearer (Railway) | List recent runs with char counts + estimated tokens. Query: `agentId?`, `limit=50`, `status?`. |
| POST | `/api/agents/schedules/:agentId/repin` | requireLocal | Recompute + save the expected schema fingerprint. |
| GET | `/api/agents/schedules/:agentId/prompt` | requireLocal | Return `{ promptSnapshot, promptSnapshotAt, currentTemplate, driftDetected }`. |
| POST | `/api/agents/schedules/:agentId/rebuild` | requireLocal | Delete + re-create the Anthropic trigger with the current-code prompt; update `promptSnapshot`. |

### Modified endpoints

- `POST /api/agents/schedules` — on create, compute and store `expectedSchemaFingerprint` + `promptSnapshot`. On update, repin only if explicitly requested; re-snapshot prompt if template changed.

### Response shapes

```ts
type InputsResponse =
  | { runId: string; skip: 'schedule_disabled' | 'schema_stale' | 'no_handler'; actualHash?: string; expectedHash?: string }
  | { runId: string; work: Record<string, unknown>; schemaHash: string };

type ResultsRequest = {
  runId: string;
  findings?: unknown[];
  error?: string;
  toolCalls?: Array<{ name: string; durationMs?: number; detail?: string }>;
};

type ResultsResponse =
  | { ok: true; recorded: 'failed' }
  | { ran: true; runId: string; insertedResearchIds?: number[]; summary?: string }
  | { ok: false; reason: 'invalid_result_shape' | 'writer_threw' | 'unknown_run'; detail?: string };

type ScheduledRunRow = {
  runId: string;
  agentId: string;
  scheduledAt: string;
  firedAt: string;
  completedAt: string | null;
  status: 'success' | 'skipped' | 'failed' | 'pending';
  skippedReason?: string;
  durationMs: number | null;
  promptChars: number | null;
  inputChars: number | null;
  resultChars: number | null;
  estimatedTokens: number | null;
  toolCalls?: Array<{ name: string; durationMs?: number; detail?: string }>;
  resultJson?: unknown;
};

type PromptInspection = {
  promptSnapshot: string;
  promptSnapshotAt: string;
  currentTemplate: string;
  driftDetected: boolean;
};
```

---

## 8. Data model changes

- **New table**: `_splan_scheduled_runs` (see Phase 2). Added to push/pull skip set. `result_json` + `tool_calls_json` registered in JSON_COLUMNS.
- **Extended file**: `.splan/agent-schedules.json` — adds `expectedSchemaFingerprint`, `pinnedAt`, `promptSnapshot`, `promptSnapshotAt` per schedule.
- **New env vars** (Railway-only):
  - `SCHEDULED_AGENT_TOKEN` — bearer token for the inputs/results endpoints. Set on Railway and interpolated into the cron prompt at schedule-creation time.
  - `DB_PATH` — absolute path to SQLite file on the mounted volume.
- **Explicitly NOT added**: `ANTHROPIC_API_KEY`. If this env var appears in a future draft, the design has drifted back to API-metered billing — reject it.

All env vars documented in `README.md` deployment section.

---

## 9. Security

- The inputs/results endpoints are publicly reachable but token-gated. Rotate `SCHEDULED_AGENT_TOKEN` if compromised: rotate env var on Railway, then re-create every existing schedule so the new token is baked into the cron prompt. Add a CLI helper `npm run rotate-agent-token` that does both.
- Tokens are never returned from any API; only written into `claude schedule create` stdin and stored in Railway env.
- The bearer token appears in Anthropic's trigger storage (it's in the prompt). Treat Anthropic trigger storage as a credential store — acceptable given the blast radius is one DB.
- Rate-limit each endpoint to 1 req per `(agentId, endpoint)` per 60s to prevent prompt-injected replay from cloud session.
- Log every call to `_splan_scheduled_runs` with full request metadata minus the bearer, so tampering leaves a trail.
- The cron-fired Claude runs with the same permissions as any Claude Code session — the user is trusting their own Max subscription's session. No new auth surface.

---

## 10. Risk analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| Railway volume misconfigured → data lost on first deploy | Medium | User deploys to staging first; verifies volume survives two deploys before cutting over. |
| Fingerprint false positives (harmless table renames trip pre-flight) | Medium | Re-pin button in UI; fingerprint is a soft gate. |
| Cron Claude produces malformed results → data loss | Medium | Strict shape validation on /results; invalid → 400 + logged as `failed`, no DB write. Claude sees 400 and can retry in same session. |
| Cron Claude's WebSearch quality degrades | Low | Same tool used interactively; quality tracks Claude Code generally. User reviews research rows in UI. |
| Server-side writer throws midway | Medium | Writer body wrapped in single SQLite transaction; rollback on throw. |
| Departure gate blocks legitimate closes | Low | Auto-sync on close handles the common case silently. |
| Token leaks via Railway logs | Low | Strip `Authorization` header before logging. Redaction test in `server/scheduled-runs.test.ts`. |
| Two agents schedule at the same minute → DB contention | Low | SQLite WAL handles this; transaction wrapping as belt-and-suspenders. |
| Departure gate races with browser tab close | Low | Native `beforeunload` forces browser confirm as fallback. |
| Anthropic's trigger CLI flags change | Medium | Wrap `claude schedule create` in a single helper; one place to update. |
| Prompt template drifts from shipped schedule | Medium | `promptSnapshot` in schedule record; UI surfaces drift and offers one-click Rebuild. |
| Cron session tokens blow through Max limits | Medium | Per-run char counts + estimated tokens in history UI; daily cap on runs per agent (setting; default 3/day per agent). User sees usage before it becomes a problem. |

---

## 11. Test plan

### Unit (Vitest, node env)

- `server/scheduled-agents/concept-researcher.test.ts`:
  - `buildConceptResearcherInputs` returns expected shape on empty DB, non-empty DB.
  - `validateConceptResearcherResults` accepts well-formed findings, rejects each shape violation with the right error code.
  - `writeConceptResearcherResults` writes research rows + appends concept notes inside a transaction; rolls back on thrown writer.
- `server/schema-fingerprint.test.ts`: fingerprint is stable across row insertions, changes on table add/drop.
- `server/scheduled-runs.test.ts`:
  - `/inputs` returns `skip: schema_stale` when fingerprint drifts, `skip: schedule_disabled` when disabled, full work payload when match.
  - `/results` rejects malformed body with 400 + logs failed row, accepts valid body + logs success row.
  - char counts + estimated_tokens match expected formula.
  - Authorization header is stripped from any log line that includes request metadata.

### Integration

- Start Express locally with a test DB; GET `/inputs` with test token → expect work payload. POST `/results` with matching runId → verify `_splan_research` row written.
- Drift the schema (add a dummy table), re-GET `/inputs`; verify skip with `schema_stale`.
- Disable the schedule; re-GET `/inputs`; verify skip with `schedule_disabled`.
- POST `/results` with unknown runId → 404 + not written.
- POST `/results` with invalid findings shape → 400 + failed row logged + no DB write.

### Manual end-to-end (required before declaring done)

1. Deploy Phase 1 (volume). Confirm row persistence across two deploys.
2. Create a Concept Researcher schedule via the UI with daily 9am ET.
3. Temporarily trigger an ad-hoc firing (`claude schedule run-now <triggerId>` if available; otherwise use `curl` locally to hit `/inputs` then `/results` with the test token).
4. Wait for firing. Verify Railway logs show the GET/POST pair, `_splan_scheduled_runs` has a success row with realistic char counts, `_splan_research` has N new rows.
5. Close local app. Reopen. Verify auto-pull fires and the new research rows are visible in the UI.
6. Drift the schema by adding a column locally without deploying. Close app — departure gate must block.
7. Close app anyway. Wait for overnight firing. Verify skipped row exists with `schema_stale`, no research rows written, and next-morning banner appears on app open.
8. Open the Prompt inspector for Concept Researcher. Verify the stored snapshot matches what Claude received. Edit `CONCEPT_RESEARCHER_PROMPT_TEMPLATE` in code, redeploy; verify drift banner appears; click Rebuild; verify the banner clears.

---

## 12. Rollout (reference only — not executed in the implementing session)

> **Session-execution note (see §0):** Do **not** try to soak, observe, or cut over. Land all pure-code phases on one branch with clean per-phase commits and stop. The user drives the rollout sequence below manually post-merge.

1. Merge the branch to `main` so Phase 1 code changes (DB path env var) ship first. User creates the Railway volume and sets `DB_PATH` + `SCHEDULED_AGENT_TOKEN` before the deploy lands.
2. After volume is confirmed (two successful deploys with persistent rows), user runs `npm run migrate-schedules-v2` to cut existing schedules over to the new prompt shape.
3. User watches `_splan_scheduled_runs` overnight; confirms success rows for the first two firings.
4. User toggles `enforceSyncBeforeClose` setting on (defaults on) and validates the departure gate in real use.
5. User checks "Last 30 days: ~X estimated tokens" on each agent card after a week; if it's trending hot, tune the daily cap setting or shrink prompts.

No feature flag. The original `FEATURE_SCHEDULED_AGENTS_V2` gate proposed in an earlier draft is withdrawn — cleaner to roll forward.

---

## 13. Open questions

**Pre-answered (implement per the proposal — no need to ask):**

- **Pruning**: `_splan_scheduled_runs` keeps last 90 days, matching `agent-history.json`. Add prune-on-read in the GET endpoint just like `agent-history.json` does today.
- **Repin + history**: historical runs keep the hash they fired against. History reflects reality.
- **Estimated-token formula**: `Math.floor((prompt_chars + input_chars + result_chars) / 4)`. Rough — English averages ~4 chars/token. Good enough for trend-spotting; exact billed totals live in Anthropic's Max dashboard.

**Deferred — decide during code, don't block on them:**

- **Ad-hoc test fires**: if `claude schedule create --run-now` or equivalent isn't available on the installed CLI version, test via `curl` against the local Express server with `SCHEDULED_AGENT_TOKEN` set in `.env`. Document whichever worked in the handoff note.

**User decisions — skip in session, flag in handoff:**

- **Whether to also expose on-demand runs against Railway** (the symmetric "cloud launch" button) — explicitly out of scope for this PRD, but worth flagging in the handoff so the user knows it's the natural next step.
- **Whether to surface tool-call logs by default in the history UI** — `tool_calls_json` is captured but expanded-only on click to avoid clutter. Default collapsed.

---

## 14. Prompt + usage monitoring

Goal: user can see exactly what Claude received at schedule time, what Claude returned at firing time, and how much that cost in rough terms — without ever adding an LLM dependency to Railway.

### 14.1 Prompt snapshotting

At `claude schedule create` time, the server interpolates `{RAILWAY_URL}` and `{SCHEDULED_AGENT_TOKEN}` into the template and stores the result verbatim in the schedule record's `promptSnapshot` field, with `promptSnapshotAt` timestamp. The raw bearer value is NOT redacted in the snapshot — it's the exact string Claude receives, and the user is the only reader (protected by `requireLocal` on the prompt-inspection endpoint).

When the in-code template differs from `promptSnapshot`, `GET /api/agents/schedules/:agentId/prompt` returns `driftDetected: true`. The UI surfaces a banner + Rebuild button. Rebuild deletes the old Anthropic trigger and creates a new one with the current template, overwriting the snapshot.

### 14.2 Per-run character counts

Every `_splan_scheduled_runs` row stores:

- `prompt_chars`: length of `promptSnapshot` at firing time. Same across all firings of a given schedule until rebuild.
- `input_chars`: length of the `/inputs` JSON response body. Varies per firing based on current DB state.
- `result_chars`: length of the `/results` POST body (whatever Claude sent, malformed or not).
- `estimated_tokens`: `Math.floor((prompt_chars + input_chars + result_chars) / 4)`.
- `tool_calls_json`: optional array of `{name, durationMs, detail}` the cron session self-reports. The prompt template instructs Claude to include this where reasonable; absence is tolerated.

These are **character counts only**, computed by Railway as HTTP bodies flow through. Railway never calls an LLM and never sees Anthropic's official token counts. The UI labels these as "estimated" and links to the Anthropic Max usage dashboard for authoritative billed totals.

### 14.3 UI surface

In `AgentsTab.tsx`, each schedulable agent card gains:

1. **Above the schedule accordion**: a usage row — "Last 30 days: 18 runs · ~412,000 estimated tokens · avg ~22,900/run". Computed client-side from the fetched history rows.
2. **Inside the schedule accordion**: an "Inspect prompt" button that opens a modal rendering `promptSnapshot` in a monospace textarea + metadata (snapshot timestamp, current-template hash, drift indicator). If drift is detected, a Rebuild button is offered inline.
3. **`ScheduledRunHistory` panel** (Phase 8): one row per run with columns: Fired (relative) · Status (colored dot) · Duration · Prompt · Input · Result · Est. tokens · Summary (expandable). Clicking a row expands to show `result_json` and `tool_calls_json` pretty-printed.

### 14.4 Tuning loop

The intended usage pattern: user checks the 30-day estimated-token number weekly. If it's trending high, the user edits the in-code prompt template (shorter wording, tighter per-concept limits, fewer max queries), then clicks Rebuild on any schedule where drift is flagged. No code redeploy needed for prompt tweaks beyond the initial push, because schedules pick up the new template via Rebuild.

This is why the prompt lives in a TS constant in a file (`server/scheduled-agents/concept-researcher.ts` → `CONCEPT_RESEARCHER_PROMPT_TEMPLATE`), not in JSON config. The prompt is code, reviewed and versioned like code. Edits are visible in git history; `promptSnapshotAt` lets the user correlate usage changes with specific prompt edits.
