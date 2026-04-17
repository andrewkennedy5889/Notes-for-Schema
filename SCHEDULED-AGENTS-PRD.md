# Scheduled Agents PRD

**Purpose**: make scheduled Schema Planner agents (starting with Concept Researcher) run reliably against the Railway-hosted Schema Planner instance while the local device is off, without ever operating on stale schema, without silently wiping data, and with overnight output visible to the user the next morning.

**Target implementation**: separate session with fresh context. This document is self-contained.

---

## 1. Context for a fresh session

### 1.1 Project

Schema Planner — React 19 + Vite 8 + Express 5 + better-sqlite3. Runs locally on ports 3100/5173 and is deployed to Railway at `https://notes-for-schema-production.up.railway.app` using `railway.toml` + `Dockerfile`. The Railway instance runs identical code against a **separate SQLite database**; the two DBs are reconciled via explicit Push/Pull operations in Settings → Data Sync.

### 1.2 Existing agent system (already shipped — do not rebuild)

`src/components/schema-planner/AgentsTab.tsx` declares a static `AGENTS` array of nine agents. The schedulable ones (today only Concept Researcher, flagged `schedulable: true`) expose a SCHEDULE accordion in the UI.

Current flow:

- **On-demand Launch**: client interpolates params → `POST /api/agents/launch` (server/index.ts:1383) → server writes prompt file + PowerShell launcher → spawns local `claude -p` session → agent writes results to `.splan/agent-results/<runId>.json`.
- **Scheduled runs**: client → `POST /api/agents/schedules` (server/index.ts:1477) → server `exec`s `claude schedule create --name … --cron … --prompt …` → Anthropic's trigger system fires the prompt at cron time in a cloud runtime.

The cloud-fired Claude session has **no access** to the local `schema-planner` MCP (stdio transport only), so any prompt saying "Use the /schema skill…" fails silently in scheduled mode. This PRD fixes that.

### 1.3 Existing sync system (already shipped — depend on, don't rebuild)

Per `DATA-SYNC-HARDENING-PRD.md`:

- `GET /api/sync/remote-status` returns `{ lastSync, remote: {changeCount}, local: {changeCount}, schema: {match, missingOnRemote, missingOnLocal} }`.
- `POST /api/sync/push` and `/api/sync/pull` refuse on schema mismatch (not force-overridable). Conflict detection rejects with 409 unless `?force=true`.
- `POST /api/sync/deploy-code` commits + pushes + polls remote `/api/version` for SHA match + auto-pushes data post-deploy.
- Auto-sync setting fires push/pull automatically when only one side has changes and schemas match.
- `_splan_sync_meta` logs every sync attempt. `_splan_change_log` counts drift since last sync.

### 1.4 Files to know

| Path | Role |
|---|---|
| `server/index.ts` | All Express routes. New routes in this PRD go here. |
| `src/components/schema-planner/AgentsTab.tsx` | Agent definitions + launch/schedule UI. |
| `src/pages/SchemaPlanner.tsx` | Main page; departure-gate logic goes here. |
| `src/lib/api.ts` | Frontend API client. New endpoints get typed functions here. |
| `server/db.ts` | DB init + migrations. New `_splan_scheduled_runs` table added here. |
| `server/utils.ts` | `parseRow` / `prepareRow` case conversion. New fields must round-trip. |
| `railway.toml`, `Dockerfile` | Railway deployment config. Volume mount added here. |
| `.splan/agent-schedules.json` | Persisted schedule configs; extended with `expectedSchemaFingerprint`. |

### 1.5 Conventions

Per `CLAUDE.md`:

- DB columns `snake_case`, API/frontend `camelCase`, converted via `parseRow` / `prepareRow`.
- All DB tables prefixed `_splan_`.
- New JSON columns must be registered for auto-parse/stringify.
- No comments unless explaining non-obvious *why*. No feature flags or backwards-compat shims.
- For UI changes: test in browser before claiming done.
- Read files before editing (enforced by hook).

---

## 2. The three-state model

Every scheduled run falls into one of three states based on whether the local device is on and whether Railway schema matches the expected fingerprint. This PRD handles all three.

| State | Local on? | Railway schema fresh? | Handling |
|---|---|---|---|
| **S1** | yes | yes or no | Local Express server pre-flights (auto-deploy + auto-sync), then agent runs. |
| **S2** | no | yes | Server-side pre-flight passes. Agent runs against Railway. Local auto-pulls on next app open. |
| **S3** | no | no | Server-side pre-flight fails. Run is **skipped** with a logged reason. User is notified on next app open. Prevented in the common case by the **departure gate**. |

The departure gate (goal 3) makes S3 rare. The server-side pre-flight (goal 2) makes S3 safe when it happens anyway. Auto-pull on open (goal 4) makes S2 transparent to the user.

---

## 3. Goals

1. **Scheduled agents run against Railway** without needing any local process alive.
2. **No scheduled run operates on stale schema.** Every run is gated by a server-side fingerprint check.
3. **User cannot walk away with unresolved sync state.** A departure gate blocks app close when remote is behind or schema mismatches.
4. **Output from overnight runs reaches the local UI automatically.** Auto-pull on app mount when local is clean and remote is ahead.
5. **Every scheduled firing is logged** with a success/skipped/failed verdict visible in the Agents tab.
6. **Railway DB survives code deploys.** Persistent volume for `data/schema.db`.
7. **On-demand agent path is untouched.** The local `Launch` button, `.splan/agent-results/`, stdio MCP, and `/schema` skill all keep working exactly as they do today.

---

## 4. Non-goals

- Migrating off the two-DB local-plus-Railway model. Turso/libSQL is out of scope.
- Replacing the `/schema` skill. It stays stdio-only for interactive local use.
- Hosting MCP-over-HTTP on Railway. Scheduled agents use the REST API directly; no remote MCP registration.
- Supporting scheduled agents that *read* schema state the cron-fired Claude cannot reach. Any agent added to this system must either work entirely through the REST API or be flagged `runtime: "local"` and fall back to Windows Task Scheduler (deferred to a follow-up PRD).
- Authenticating individual end users. The Railway endpoints added here use a single shared bearer token (`SCHEDULED_AGENT_TOKEN` env var), consistent with the existing `SYNC_REMOTE_PASSWORD` pattern.

---

## 5. Architecture

### 5.1 Scheduled run lifecycle

```
[cron fires in Anthropic cloud]
        │
        ▼
[Claude cloud session]
        │  prompt: "POST to {RAILWAY_URL}/api/agents/run-scheduled/{agentId}"
        ▼
[Railway Express]  POST /api/agents/run-scheduled/:agentId
        │
        ├─ load schedule record (expectedSchemaFingerprint, paramDefaults, promptTemplate)
        ├─ compute live schema fingerprint
        ├─ if mismatch: log skipped + return { ran: false, reason: "schema_stale" }
        ├─ on match: allocate runId, execute agent body against Railway DB,
        │           write result to _splan_scheduled_runs
        └─ return { ran: true, runId, summary }
        │
        ▼
[Claude cloud session]  summarizes outcome in its stdout (for trigger log visibility)

[next morning, user opens local Schema Planner]
        │
        ▼
[SchemaPlanner.tsx mount]
        │  fetchRemoteStatus()
        ├─ if local clean && remote ahead && schema match: auto-pull
        ├─ fetchScheduledRuns() → render in Agents tab history panel
        └─ if any skipped with reason schema_stale: surface prompt "Deploy now?"
```

### 5.2 Agent body execution on Railway

Each scheduled agent registers a server-side handler in `server/scheduled-agents/<agentId>.ts` with signature:

```ts
export async function runConceptResearcher(ctx: ScheduledRunContext): Promise<AgentResult>
```

`ScheduledRunContext` exposes: `params`, `db` (Railway's `better-sqlite3` handle), `webSearch()` (HTTP call to a hosted search API or an LLM-tool passthrough — see §6.5), `logFinding()` (append to `_splan_research` or equivalent).

The cloud-fired Claude session no longer *does* the research directly. It just triggers the Railway-side handler, which does the deterministic parts (list concepts, fetch recents, write rows). Web search and LLM summarization happen inside the handler via a server-side Anthropic SDK call with a web-search tool enabled.

This is the key architectural shift and what makes scheduled runs reliable: **the cron-fired Claude is reduced to a one-shot HTTP invoker**. The actual agent logic is code, not a prompt.

### 5.3 Why move logic server-side

- Eliminates the `/schema` skill availability problem.
- Prompts are version-controlled code instead of mutable JSON.
- Pre-flight and logging are inline with execution; no "agent wrote garbage and we can't tell" failure mode.
- Re-runs are deterministic: same inputs → same result (modulo web search drift).
- Future agents can be added by writing a `scheduled-agents/<id>.ts` module; no CLI/MCP machinery.

The on-demand interactive flow stays prompt-driven and uses `/schema`. Scheduled flow becomes code-driven. Both share `.splan/agent-results/<runId>.json` as the output format so the history UI treats them identically.

---

## 6. Implementation phases

Each phase is independently shippable and each makes the next safer.

### Phase 1 — Railway SQLite volume (infra prereq)

**Why first**: nothing else matters if deploys keep wiping research output.

- Add a Railway volume mounted at `/app/data`.
- Change DB path in `server/db.ts` to `process.env.DB_PATH ?? path.join(__dirname, '../data/schema.db')`.
- Set `DB_PATH=/app/data/schema.db` as a Railway env var.
- Update `Dockerfile` to not bake a DB into the image.
- Manual verification: deploy twice back-to-back, confirm row counts survive.

**Acceptance**: after `git push → Railway redeploy`, `SELECT COUNT(*) FROM _splan_features` on Railway returns the pre-deploy value.

### Phase 2 — `_splan_scheduled_runs` table

Migration in `server/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS _splan_scheduled_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,        -- ISO timestamp
  fired_at TEXT NOT NULL,            -- ISO timestamp
  status TEXT NOT NULL,              -- 'success' | 'skipped' | 'failed'
  skipped_reason TEXT,               -- 'schema_stale' | 'schedule_disabled' | etc.
  expected_schema_hash TEXT,
  actual_schema_hash TEXT,
  result_json TEXT,                  -- AgentResult serialized
  duration_ms INTEGER
);
CREATE INDEX idx_scheduled_runs_agent ON _splan_scheduled_runs (agent_id, fired_at DESC);
```

Add to skip list in push/pull (§1.3 hardening PRD's skip set): this table is Railway-authoritative and must never be overwritten by a push.

### Phase 3 — Schema fingerprint pinning

Extend the schedule record in `.splan/agent-schedules.json`:

```ts
{
  // existing fields: cronExpression, cronLabel, promptOverride, paramDefaults, triggerId, enabled
  expectedSchemaFingerprint: string;  // SHA256 of sorted _splan_ table list
  pinnedAt: string;                   // ISO timestamp
}
```

Compute the fingerprint via `getSchemaTables()` (already defined in `server/index.ts`) → sort → SHA256. Store on schedule create and on manual "re-pin" (new endpoint `POST /api/agents/schedules/:agentId/repin`).

UI: when fingerprint drifts from current schema, show a "Re-pin" button next to the schedule card — the user is asserting the new schema is intentional.

### Phase 4 — `POST /api/agents/run-scheduled/:agentId`

New route in `server/index.ts`. Auth: bearer token `SCHEDULED_AGENT_TOKEN` in `Authorization` header. Reject if missing or wrong.

```ts
app.post('/api/agents/run-scheduled/:agentId', requireScheduledToken, async (req, res) => {
  const { agentId } = req.params;
  const schedule = loadSchedule(agentId);
  if (!schedule?.enabled) return void logAndReturn('skipped', 'schedule_disabled');

  const actualHash = computeSchemaFingerprint();
  if (actualHash !== schedule.expectedSchemaFingerprint) {
    return void logAndReturn('skipped', 'schema_stale', { actualHash });
  }

  const handler = getAgentHandler(agentId);  // lookup in scheduled-agents registry
  if (!handler) return void logAndReturn('skipped', 'no_handler');

  const runId = generateRunId();
  const started = Date.now();
  try {
    const result = await handler({ params: schedule.paramDefaults ?? {}, db: getDb() });
    logRun({ runId, agentId, status: 'success', result, durationMs: Date.now() - started });
    return void res.json({ ran: true, runId, result });
  } catch (e) {
    logRun({ runId, agentId, status: 'failed', result: { summary: (e as Error).message }, durationMs: Date.now() - started });
    return void res.status(500).json({ ran: false, reason: 'handler_threw', error: (e as Error).message });
  }
});
```

### Phase 5 — First handler: `scheduled-agents/concept-researcher.ts`

Server-side port of the current Concept Researcher prompt. Uses:

- `getDb().prepare('SELECT * FROM _splan_concepts WHERE status = ? ORDER BY updated_at ASC LIMIT ?')` for concept selection.
- Anthropic SDK with `web_search_20250305` tool for research.
- Model: `claude-opus-4-7` per `CLAUDE.md` default. Prompt caching enabled on the concept-context block.
- Writes to `_splan_research` and appends `(r:<id>:<title>)` to concept notes exactly as the current prompt does.

Requires `ANTHROPIC_API_KEY` env var on Railway.

### Phase 6 — Rewrite the cron prompt

On next schedule create, the prompt sent to `claude schedule create` becomes:

> *"POST to https://notes-for-schema-production.up.railway.app/api/agents/run-scheduled/concept-researcher with header `Authorization: Bearer {TOKEN}` and empty body. Print the JSON response. If `ran: false`, the response explains why."*

Existing schedules must be migrated: on server startup, any schedule whose `triggerId` doesn't have the new prompt shape gets its trigger deleted and recreated. Gated behind a migration flag `schedules.v2` stored in `.splan/migrations-applied.json`.

### Phase 7 — Departure gate UX

In `src/pages/SchemaPlanner.tsx`:

- `window.addEventListener('beforeunload', handler)` that checks the cached `syncStatus`.
- If `remote.changeCount > 0 && local.changeCount === 0` → auto-pull silently if the auto-sync setting is on.
- If schema mismatch exists → show a blocking modal: "Remote is missing tables. Scheduled agents may skip. Deploy now?" with buttons: Deploy, Close anyway, Cancel.
- If local has unpushed changes → modal: "You have N unpushed changes. Push before closing?"
- The modal sets `event.returnValue` to force the browser's native confirm dialog as a fallback if the user dismisses the in-app modal.
- Controllable via a new setting: `enforceSyncBeforeClose` (default on), stored in localStorage alongside existing sync settings.

### Phase 8 — Auto-pull on mount + scheduled-run history

- On `SchemaPlanner.tsx` mount, if `syncStatus.remote.changeCount > 0 && syncStatus.local.changeCount === 0 && syncStatus.schema.match`, fire auto-pull. Already specified as goal #3 in the sync hardening PRD; this PRD depends on it.
- New endpoint `GET /api/agents/scheduled-runs?agentId=&limit=` returning recent rows from `_splan_scheduled_runs`.
- New component `ScheduledRunHistory` in `AgentsTab.tsx`, rendered inside each schedulable agent card under the SCHEDULE accordion when a schedule exists. Columns: fired-at (relative), status (colored dot), duration, reason (if skipped), result summary (expandable).
- On mount, if any `status = 'skipped' AND skipped_reason = 'schema_stale'` rows exist from overnight, surface a top-of-page banner: "N scheduled runs skipped due to schema mismatch. Deploy to fix."

---

## 7. API contracts

### New endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/agents/run-scheduled/:agentId` | Bearer token | Fire the scheduled handler. Returns `{ ran, runId?, result?, reason? }`. |
| GET | `/api/agents/scheduled-runs` | requireLocal (local) or Bearer (Railway) | List recent runs. Query: `agentId?`, `limit=50`, `status?`. |
| POST | `/api/agents/schedules/:agentId/repin` | requireLocal | Recompute + save the expected schema fingerprint. |

### Modified endpoints

- `POST /api/agents/schedules` — on create, compute and store `expectedSchemaFingerprint`. On update, repin only if explicitly requested.

### Response shapes

```ts
type RunScheduledResponse =
  | { ran: true; runId: string; result: AgentResult }
  | { ran: false; reason: 'schedule_disabled' | 'schema_stale' | 'no_handler' | 'handler_threw'; actualHash?: string; expectedHash?: string; error?: string };

type ScheduledRunRow = {
  runId: string;
  agentId: string;
  firedAt: string;
  status: 'success' | 'skipped' | 'failed';
  skippedReason?: string;
  durationMs: number;
  summary?: string;
};
```

---

## 8. Data model changes

- **New table**: `_splan_scheduled_runs` (see Phase 2). Added to push/pull skip set.
- **Extended file**: `.splan/agent-schedules.json` — adds `expectedSchemaFingerprint`, `pinnedAt` per schedule.
- **New env vars**:
  - `SCHEDULED_AGENT_TOKEN` — bearer token for the run-scheduled endpoint. Set on Railway and echoed into the cron prompt.
  - `ANTHROPIC_API_KEY` — for Railway-side Claude calls from agent handlers.
  - `DB_PATH` — absolute path to SQLite file on the mounted volume.

All three documented in `README.md` deployment section.

---

## 9. Security

- The run-scheduled endpoint is publicly reachable but token-gated. Rotate `SCHEDULED_AGENT_TOKEN` if compromised: rotate env var on Railway, then re-create every existing schedule so the new token is baked into the cron prompt. Add a CLI helper `npm run rotate-agent-token` that does both.
- Tokens are never returned from any API; only written into `claude schedule create` stdin and stored in Railway env.
- The bearer token appears in Anthropic's trigger storage (it's in the prompt). Treat Anthropic trigger storage as a credential store — acceptable given the blast radius is one DB.
- Rate-limit the endpoint to 1 req per agentId per 60s to prevent prompt-injected replay from cloud session.
- Log every call to `_splan_scheduled_runs` with full request headers minus the bearer, so tampering leaves a trail.

---

## 10. Risk analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| Railway volume misconfigured → data lost on first deploy | Medium | Deploy to a staging Railway project first; verify volume survives two deploys before cutting over. |
| Fingerprint false positives (harmless table renames trip pre-flight) | Medium | Re-pin button in UI; fingerprint is a soft gate, not a hard one. |
| Cron-fired Claude session charges for tokens just to POST | Low | Prompt is a one-liner; cost is negligible vs. the full research prompt it replaces. |
| Server-side handler crashes midway through writes | Medium | Wrap handler body in a SQLite transaction; rollback on throw. |
| Departure gate blocks legitimate closes (e.g., laptop dies) | Low | Auto-sync on close handles the common case silently; modal only appears when actual conflict exists. |
| Concept Researcher's Anthropic SDK call fails → no research written | Medium | Retry with exponential backoff (3 attempts). Log failure in run row. User sees skipped+failed status in morning. |
| Token leaks via Railway logs | Low | Strip `Authorization` header before logging. Add a redaction test. |
| Two agents schedule at the same minute → DB contention | Low | SQLite WAL handles this; add transaction wrapping as belt-and-suspenders. |
| Departure gate races with browser tab close before modal renders | Low | Native `beforeunload` returns a string to force the browser's own confirm dialog as fallback. |
| Anthropic's trigger system changes its CLI flags | Medium | Wrap `claude schedule create` in a single helper; one place to update. |

---

## 11. Test plan

### Unit (Vitest, node env)

- `server/scheduled-agents/concept-researcher.test.ts`: handler returns expected shape on empty DB, non-empty DB, failing web search.
- `server/schema-fingerprint.test.ts`: fingerprint is stable across row insertions, changes on table add/drop.
- `server/scheduled-runs.test.ts`: pre-flight returns `skipped: schema_stale` when fingerprint drifts; `success` when it matches.

### Integration

- Start Express locally with a test DB; POST `/api/agents/run-scheduled/concept-researcher` with a test token; verify a `_splan_scheduled_runs` row is written and a `_splan_research` row appears.
- Drift the schema (add a dummy table), re-POST; verify the run is skipped with `schema_stale`.
- Disable the schedule; re-POST; verify skipped with `schedule_disabled`.

### Manual end-to-end (required before declaring done)

1. Deploy Phase 1 (volume). Confirm row persistence across two deploys.
2. Create a Concept Researcher schedule via the UI with daily 9am ET.
3. Temporarily override the cron to fire 2 minutes from now (Anthropic CLI supports ad-hoc test fires; if not, use `curl` to hit the endpoint directly with the stored token).
4. Wait for firing. Verify Railway logs show the POST, `_splan_scheduled_runs` has a success row, `_splan_research` has a new row.
5. Close local app. Reopen. Verify auto-pull fires and the new research row is visible in the UI.
6. Drift the schema by adding a column locally without deploying. Close app — departure gate must block.
7. Close app anyway. Wait for overnight firing. Verify skipped row exists with `schema_stale` and next-morning banner appears on app open.

---

## 12. Rollout

1. Phase 1 (volume) shipped alone and verified for 48h.
2. Phases 2–5 shipped together behind a feature flag `FEATURE_SCHEDULED_AGENTS_V2=true` in Railway env. Existing schedules untouched.
3. With flag on in staging, manually migrate one schedule (Concept Researcher) via §6 migration code path. Observe for 48h.
4. Phases 6–8 (UI) shipped with the flag still gating the cron prompt shape. UI shows history panel for migrated schedules only.
5. Once stable, remove the flag. Migrate any remaining schedules automatically on server boot.

---

## 13. Open questions for the implementing session

- Does `claude schedule create` currently support ad-hoc test fires via CLI, or does testing require waiting for cron? (Affects the test plan.)
- Should `_splan_scheduled_runs` be pruned? Propose: keep last 90 days, same as `agent-history.json`.
- Is the Anthropic SDK server-side call allowed to consume tokens on a Railway bill, or does the user want the cost accounted separately? (Operational; doesn't block implementation.)
- When a schedule is repinned, should historical runs be re-labeled with the new expected hash, or stay with the hash at time of firing? Propose: stay — history reflects reality.
