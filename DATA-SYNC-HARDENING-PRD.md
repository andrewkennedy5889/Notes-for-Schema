# Data Sync Hardening PRD

**Purpose**: harden Schema Planner's data sync flow so (a) deploys can't silently lose remote data, (b) users can always tell whether their last sync succeeded, and (c) trivially-safe sync operations fire automatically.

**Target implementation**: separate session with fresh context. This document is self-contained.

---

## 1. Context for a fresh session

### 1.1 Project

Schema Planner is a React 19 + Vite 8 + Express 5 + better-sqlite3 full-stack planner. Runs locally (Node + Vite on ports 3100/5173) and is deployed to a Railway-hosted Express app that serves the same code against a separate SQLite DB.

### 1.2 Current sync model (already shipped)

The local app has three buttons in **Settings → Data Sync**:

- **Push Data** — local DB → remote via `/api/db-import`
- **Pull Data** — remote DB → local via `/api/db-export`
- **Deploy Code** — `git commit && git push` on local, then polls remote's `/api/version` endpoint for commit-match. On match, auto-pushes data. (Railway rebuilds the container with a fresh SQLite DB on every code deploy, so a post-deploy data push is required.)

### 1.3 Guardrails already in place (do not duplicate)

These were built in the session that preceded this PRD. The fresh session should *not* rebuild them:

- **Conflict detection**: `POST /api/sync/push` rejects with 409 if remote has unsynced changes (unless `?force=true`). `POST /api/sync/pull` rejects with 409 if local has unsynced changes (unless `?force=true`).
- **Schema fingerprint**: `/api/sync-status` returns `schemaTables: string[]`. `/api/sync/remote-status` computes `schema: { match, missingOnRemote, missingOnLocal }`. Push/pull reject on schema mismatch regardless of `force`.
- **Diff viewer**: `GET /api/sync/diff` + `src/components/schema-planner/SyncDiffViewer.tsx`. Renders per-table Edits / Added / Deleted breakdowns with record-level and field-level conflict highlighting.
- **Force Push / Force Pull** buttons appear when both sides have changes and pass destructive-action confirmations before firing.

### 1.4 Files to know

| Path | Role |
|---|---|
| `server/index.ts` | All Express routes, including `/api/sync/*`, `/api/db-export`, `/api/db-import`, `/api/sync-status`, `/api/version`, `/api/sync/deploy-code` |
| `src/lib/api.ts` | Frontend API client. Types: `SyncStatus`, `SyncDiff`. Functions: `syncPush`, `syncPull`, `deployCode`, `fetchSyncStatus`, `fetchVersion`, `fetchSyncDiff` |
| `src/pages/SchemaPlanner.tsx` | Main page. Sync state lives here (`syncStatus`, `syncLoading`, `syncResult`, `deployProgress`, `syncDiff`). `handleDeployCode` at ~line 225. Settings tab renders around line 842. Sidebar title around line 352. |
| `src/components/schema-planner/SyncDiffViewer.tsx` | Existing diff viewer component |
| `server/migrations/*` (or wherever migrations live) | SQLite schema migrations. Must add a new migration file here for the `_splan_sync_meta` extension |

### 1.5 Database tables used by sync

- `_splan_sync_meta` — one row per *successful* sync. Columns: `id, sync_direction, remote_url, synced_at, rows_synced`. Will be **extended** in this PRD.
- `_splan_change_log` — append-only log of entity mutations. Used to count "changes since last sync."
- All `_splan_*` tables — synced in bulk via `db-import`/`db-export`.

### 1.6 Skip list

`_splan_all_tests` (view), `_splan_grouping_presets`, `_splan_sync_meta`, `_splan_change_log` are excluded from diff/import/export in various places. `_splan_sync_meta` is explicitly in the push/pull SKIP set, so extending its schema only affects local + remote (after a deploy) — it does not get diffed or transmitted.

### 1.7 Conventions

- DB columns: `snake_case`. API/frontend: `camelCase`. Converted via `parseRow`/`prepareRow` helpers in `server/utils.ts`.
- New API fields must be round-tripped correctly (verify `parseRow` and `prepareRow` handle them).
- React state in `SchemaPlanner.tsx` is local `useState`; no Redux/Zustand.
- localStorage is used for user preferences (`depthColors`, etc.) — fine to add more keys.
- Tests use Vitest (node env, 15s timeout). Test files live next to source or in `__tests__/`.

### 1.8 CLAUDE.md constraints

Per `CLAUDE.md`:
- Don't add features beyond what's required.
- Don't add error handling for scenarios that can't happen.
- Default to no comments; only explain non-obvious *why*.
- For UI changes: test in a browser before claiming done.
- Read files before editing (enforced by hook).

---

## 2. Goals

1. **Deploy Code must never silently lose remote data.** Every deploy ends with an unambiguous verdict: data is on remote, or it isn't and here's what to do.
2. **Sync status must survive page refresh.** Whether the last sync succeeded or failed must be visible regardless of when you arrived at the page.
3. **Trivially-safe syncs should fire automatically.** If only one side has changes and schemas match, don't make the user click a button.
4. **Users must have an opt-out.** Auto-sync and tab-title notifications default on, but are toggleable in Settings.

---

## 3. Non-goals

- New user-facing settings beyond the two specified here
- Cross-device sync awareness (per-browser localStorage is fine)
- Background sync via service workers
- Changes to the existing conflict/diff/schema-fingerprint guardrails
- Automatic Deploy Code (user must always explicitly trigger deploys)

---

## 4. Build order

Do items in this order. Each is atomic-committable.

1. **F1** — `handleDeployCode` hardening (all four sub-fixes in one pass)
2. **F2** — Extend `_splan_sync_meta` schema + write attempt rows
3. **F3** — `GET /api/sync/last-attempt` endpoint
4. **F4** — Sidebar title status dot
5. **F5** — Dismissible top banner on failure
6. **F6** — Auto-sync on page load + after Deploy Code
7. **F7** — Persistent "Remote is up to date" version badge
8. **F8** — localStorage deploy resume
9. **F9** — Tab-title notification during deploys
10. **F10** — Deploy timeout 5min → 10min
11. **F11** — Settings toggle: auto-sync
12. **F12** — Settings toggle: tab-title notification
13. **F13** — Re-sync if change count grew mid-push (race mitigation)

---

## 5. Feature specs

### F1 — `handleDeployCode` hardening

**File**: `src/pages/SchemaPlanner.tsx`, existing `handleDeployCode` callback.

**Four sub-changes**:

**F1.1 — Refresh sync status at click time.**
- Currently uses `syncStatus?.remoteUrl` which is cached (60s polling).
- On Deploy Code click, **first** call `fetchSyncStatus()` and wait for the result before using `remoteUrl`.
- If the fresh status has no `remoteUrl`, abort the deploy with error `"Can't deploy: remote is not configured or unreachable"`.

**F1.2 — Fallback push on timeout.**
- Currently, when the 10-min (post-F10) polling timeout fires, the code sets a message and bails with no data push.
- **New behavior**: on timeout, attempt `syncPush()` regardless.
  - If it succeeds: set message `"⚠️ Deploy timed out but data push succeeded ({N} rows). Remote may still be on the old code — check Railway."`
  - If it fails with 409 (schema mismatch): `"❌ Deploy timed out AND data push blocked: schema mismatch. Check Railway dashboard manually."`
  - If it fails for other reasons: `"❌ Deploy timed out AND data push failed: {error}. Click Push Data to retry."`

**F1.3 — Replace ambiguous messages with loud verdicts.**
- All success messages MUST contain either `"✅"` or the word `"success"`/`"succeeded"`.
- All failure messages MUST contain either `"❌"` or `"FAILED"`.
- On the happy path (deploy succeeded + data pushed): `"✅ Deploy complete: commit {short} ({elapsed}s) + pushed {N} rows"`.
- On any failure: include a call-to-action sentence (e.g., `"Click Push Data now to retry."`).
- Remove the current copy `"Pushed {N} files — {commit}"` and `"deploy may still be in progress"` — those are the ambiguous cases.

**F1.4 — Normalize commit-hash comparison.**
- Current code: `remote.commit === targetCommit` (strict equality).
- New helper:
  ```ts
  function commitsMatch(a: string | null, b: string | null): boolean {
    if (!a || !b) return false;
    const na = a.trim().toLowerCase();
    const nb = b.trim().toLowerCase();
    if (na === nb) return true;
    // One side may be full SHA, the other abbreviated
    return na.startsWith(nb) || nb.startsWith(na);
  }
  ```
- Use `commitsMatch(remote.commit, targetCommit)` everywhere the comparison is made (polling loop + version badge in F7).

**Test conditions for F1**:

| Scenario | Expected |
|---|---|
| Click Deploy Code with in-memory `syncStatus.remoteUrl === undefined` but the server actually has it configured | A pre-flight `fetchSyncStatus` runs and the deploy proceeds |
| Click Deploy Code when remote is truly not configured | Abort with the "Can't deploy: remote is not configured" message |
| Mock `fetchVersion` to never return the target commit; advance clock past 10min | `syncPush` is called exactly once in the timeout path |
| `fetchVersion` returns `"ABC1234\n"` while `targetCommit === "abc1234"` | `commitsMatch` returns true; polling loop exits on match |
| `fetchVersion` returns `"abc1234567890"` while `targetCommit === "abc1234"` | `commitsMatch` returns true (prefix match) |
| Deploy succeeds and auto-push succeeds | `syncResult` message contains `"✅"` and the row count |
| Deploy succeeds but auto-push fails with a generic error | `syncResult` message contains `"❌"` and the phrase `"click Push Data"` |
| Deploy times out but fallback push succeeds | Message contains `"⚠️"` and explicitly says `"Remote may still be on the old code"` |
| Unit test `commitsMatch(null, "abc")` | false |
| Unit test `commitsMatch("  ABC \n", "abc")` | true |

---

### F2 — Extend `_splan_sync_meta` and write on every attempt

**Goal**: every push/pull/deploy-push attempt writes a row (success or failure), so the most-recent row always tells truth about the last attempt.

**Migration** (new file in migrations directory, e.g., `server/migrations/009_sync_meta_attempts.sql` — match whatever naming convention exists):

```sql
ALTER TABLE _splan_sync_meta ADD COLUMN success INTEGER NOT NULL DEFAULT 1;
ALTER TABLE _splan_sync_meta ADD COLUMN error_message TEXT;
ALTER TABLE _splan_sync_meta ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE _splan_sync_meta ADD COLUMN attempt_id TEXT;
-- Backfill existing rows: they were all successes, attempt_id derived from rowid
UPDATE _splan_sync_meta SET attempt_id = 'legacy-' || id WHERE attempt_id IS NULL;
```

**Column semantics**:
- `success` — 1 for success, 0 for failure
- `error_message` — null on success, human-readable error on failure
- `source` — one of: `manual-push`, `manual-pull`, `force-push`, `force-pull`, `deploy-push`, `auto-push`, `auto-pull` (string, validated but not enum-constrained in SQL)
- `attempt_id` — UUID v4. Stable identifier for client-side dismissal tracking.

**Code changes** in `server/index.ts`:

- Add helper `recordSyncAttempt(params: { direction: 'push' | 'pull'; source: string; success: boolean; rowsSynced?: number; errorMessage?: string }): { attemptId: string }`
  - Generates a UUID (use existing `uuid` package).
  - Inserts a row with all fields.
  - Returns `{ attemptId }` so it can be surfaced in the API response.
- In `POST /api/sync/push`: call `recordSyncAttempt` in BOTH the success branch AND every failure branch (schema mismatch 409, conflict 409, network error, and catch block).
- In `POST /api/sync/pull`: same.
- In `POST /api/sync/deploy-code`: add `recordSyncAttempt` for the internal auto-push step specifically (so deploy-push is traceable in the log).
- `source` mapping:
  - Plain `POST /api/sync/push` with no `force` → `manual-push`
  - Plain `POST /api/sync/push` with `force=true` → `force-push`
  - The internal auto-push inside deploy-code → `deploy-push`
  - Auto-sync from F6 → `auto-push` / `auto-pull`
  - (The request body or query param can carry `source` from the client; default to `manual-*` if absent.)
- Update `syncPush`/`syncPull` in `src/lib/api.ts` to accept and send a `source` string.

**Test conditions for F2**:

| Scenario | Expected |
|---|---|
| Successful manual push | New row with `success=1`, `source='manual-push'`, `error_message=null`, valid `attempt_id` |
| Push blocked by schema mismatch | New row with `success=0`, `source='manual-push'`, `error_message` contains `"Schema mismatch"` |
| Push rejected by change-count conflict (409) | New row with `success=0`, `error_message` contains the change count |
| Force push that succeeds | New row with `success=1`, `source='force-push'` |
| Deploy Code internal auto-push succeeds | New row with `source='deploy-push'`, `success=1` |
| Deploy Code internal auto-push fails | New row with `source='deploy-push'`, `success=0`, error captured |
| All rows have non-null `attempt_id` | true (including backfilled legacy rows) |
| Running the migration is idempotent (re-run on a migrated DB) | No-op — verify with `PRAGMA table_info` check before ALTER |

---

### F3 — `GET /api/sync/last-attempt`

**File**: `server/index.ts`.

**Contract**:

```ts
GET /api/sync/last-attempt

Response 200:
{
  attempt: {
    id: string;            // attempt_id
    direction: 'push' | 'pull';
    source: string;        // manual-push, auto-push, etc.
    success: boolean;
    rowsSynced: number | null;
    errorMessage: string | null;
    attemptedAt: string;   // ISO 8601 UTC
  } | null;
}
```

Returns `{ attempt: null }` if the table is empty.

**Client-side** add to `src/lib/api.ts`:

```ts
export interface LastSyncAttempt {
  id: string;
  direction: 'push' | 'pull';
  source: string;
  success: boolean;
  rowsSynced: number | null;
  errorMessage: string | null;
  attemptedAt: string;
}

export async function fetchLastSyncAttempt(): Promise<LastSyncAttempt | null>;
```

**Test conditions for F3**:

| Scenario | Expected |
|---|---|
| Fresh DB, no attempts | `{ attempt: null }` |
| One successful push | Returns that attempt with `success: true` |
| Three attempts (fail, fail, success) — query right after third | Returns the success (most recent by `synced_at` / `id`) |
| Fetch after page load | Frontend renders correct status based on `success` |

---

### F4 — Sidebar title status dot

**File**: `src/pages/SchemaPlanner.tsx`, sidebar title region (~line 352, the `<span>Schema Planner</span>` block).

**Design**:

- **Dot location**: immediately to the right of the "Schema Planner" text in the sidebar title bar.
- **Colors and semantics** (dot size: 8×8px, full-circle):
  - 🟢 `#4ecb71` — last attempt (from `fetchLastSyncAttempt`) was successful
  - 🔴 `#e05555` — last attempt failed
  - ⚪ `#8899a6` — no attempts recorded yet
- **Click target**: dot is a button. On click, opens a **popover** (absolute-positioned div anchored to the dot) showing:
  - Status line: `"✓ Last push succeeded"` / `"✗ Last pull failed"` / `"No sync attempts yet"`
  - Timestamp: `"2 minutes ago at 10:53 AM"` (use a simple relative-time helper)
  - Source: `"Source: deploy-push"` (human-readable version of source string)
  - Rows: `"Rows synced: 238"` (only on success)
  - Error: `"Error: {errorMessage}"` (only on failure, red text, truncated at 300 chars with expand)
  - Close button
- **Poll**: re-fetch last-attempt every 30s while page is open (lighter than 60s since this is a freshness signal), and immediately after any push/pull/deploy-push completes.
- When sidebar is collapsed (width 48px), the dot still shows but slightly smaller (6×6px) and the title text is hidden.

**State**:
```ts
const [lastAttempt, setLastAttempt] = useState<LastSyncAttempt | null>(null);
const [popoverOpen, setPopoverOpen] = useState(false);
```

**Accessibility**:
- Dot `<button>` with `aria-label="Last sync status: {success|failed|unknown}"`
- Popover closes on `Escape` key and on outside click

**Test conditions for F4**:

| Scenario | Expected |
|---|---|
| Fresh DB | Gray dot, popover shows "No sync attempts yet" |
| After successful push | Dot turns green within 30s or immediately post-action |
| After failed push | Dot turns red |
| Click gray dot | Popover opens, shows "No sync attempts yet" |
| Click green dot | Popover shows green checkmark, timestamp, source, rows |
| Click red dot | Popover shows error in red with error message |
| Sidebar collapsed | Dot still visible at smaller size |
| Press Escape while popover open | Popover closes |
| Click outside popover | Popover closes |

---

### F5 — Dismissible top banner on failure

**File**: `src/pages/SchemaPlanner.tsx`, top of the page render (above the main flex container).

**Design**:

- If `lastAttempt.success === false` AND `lastAttempt.id` is NOT in the localStorage `dismissedAttempts` set, render a full-width red banner above the entire app.
- Banner content:
  - Icon: ❌
  - Text: `"Last {direction} failed at {localTime}: {errorMessage}"` (truncate errorMessage to 200 chars)
  - Right side: two buttons — `[View Differences]` (only if `direction === 'push'` and the diff endpoint returns non-empty) and `[Dismiss]`
- `[Dismiss]`:
  - Adds `lastAttempt.id` to `localStorage.splan_dismissedAttempts` (JSON array, bounded to last 50 entries via shift)
  - Hides the banner
  - Does NOT affect the red dot — dot stays red until next successful attempt
- Banner re-appears automatically when a NEW failure occurs (different `attempt_id`), even if a previous one was dismissed.

**localStorage shape**:
```ts
localStorage.splan_dismissedAttempts = JSON.stringify(["uuid-1", "uuid-2", ...])
```

**Edge**: if localStorage is full or corrupted, fail gracefully — just show the banner as if nothing were dismissed.

**Test conditions for F5**:

| Scenario | Expected |
|---|---|
| First-time failure | Banner shows with correct direction, time, error |
| Click [Dismiss] | Banner hides, localStorage contains attempt ID |
| Refresh page | Banner still hidden (dismissed) |
| New failure with different ID | New banner shows (previous dismissal doesn't suppress it) |
| Click [View Differences] on a push failure | Opens the existing `SyncDiffViewer` panel in Settings, or scrolls to it |
| Successful attempt after dismissed failure | Banner stays hidden, red dot turns green |
| 51st dismissal | Oldest ID is evicted from localStorage |
| Corrupt localStorage (invalid JSON) | Banner shows as if no dismissals; localStorage gets reset to `[]` |

---

### F6 — Auto-sync on page load + after Deploy Code

**File**: `src/pages/SchemaPlanner.tsx`.

**Design**:

Add a new `useEffect` that fires exactly once per "auto-sync opportunity." Opportunity = one of:
1. First successful `fetchSyncStatus` on page mount
2. Successful completion of Deploy Code (after its own internal auto-push — so this is a safety net, not a duplicate)

**Logic** (pseudo-code):

```ts
function shouldAutoSync(status: SyncStatus, autoSyncEnabled: boolean): 'push' | 'pull' | null {
  if (!autoSyncEnabled) return null;
  if (!status.configured) return null;
  if (status.schema && !status.schema.match) return null;
  const local = status.local?.changeCount ?? 0;
  const remote = status.remote?.changeCount ?? 0;
  if (local > 0 && remote === 0) return 'push';
  if (remote > 0 && local === 0) return 'pull';
  return null;  // both zero (in sync) OR both non-zero (conflict)
}
```

**Triggering**:

```ts
const hasAutoSyncedOnMount = useRef(false);

useEffect(() => {
  if (!syncStatus || hasAutoSyncedOnMount.current) return;
  if (syncLoading) return;
  const direction = shouldAutoSync(syncStatus, autoSyncEnabled);
  if (!direction) return;
  hasAutoSyncedOnMount.current = true;
  if (direction === 'push') handleSyncPush({ source: 'auto-push' });
  else handleSyncPull({ source: 'auto-pull' });
}, [syncStatus, autoSyncEnabled, syncLoading]);
```

**After Deploy Code**: in the existing deploy completion handler, after the internal auto-push finishes (whether it succeeded or failed), re-fetch sync status. The auto-sync effect above will then trigger a second push if the internal one failed or if new changes accumulated. To prevent infinite loops, set `hasAutoSyncedOnMount.current = false` only when Deploy Code completes (so it fires at most once on mount, and at most once after each deploy).

**Signature changes**: `handleSyncPush` and `handleSyncPull` need to accept a `source` parameter that gets passed through to `syncPush`/`syncPull` → eventually to the server `source` column.

**UX**:
- Success: show a **toast** (new component, position top-right of screen, auto-dismiss after 5s): `"✅ Auto-synced: pushed 238 rows"`.
- Failure: show nothing extra — the F5 banner + F4 red dot already cover the failure case, and the `syncResult` text shows the specific error.

**Toast component**: simple div, fixed positioning, fade-in/out via CSS transition. No toast library — keep it local and minimal. Place in `src/components/schema-planner/AutoSyncToast.tsx`.

**Test conditions for F6**:

| Scenario | Expected |
|---|---|
| Page loads, local has 238 changes, remote clean, schema match, setting on | Auto-push fires within ~1s after status loads. Toast appears. |
| Page loads, remote has 50 changes, local clean, schema match, setting on | Auto-pull fires. |
| Page loads, both sides have changes | No auto-sync. Conflict banner shows (existing behavior). |
| Page loads, schema mismatch | No auto-sync regardless of change counts. Purple schema banner shows. |
| Setting off | No auto-sync fires ever. |
| Deploy Code completes → internal auto-push fails → F6 refetches status → still 238 local changes | Second auto-push fires as recovery |
| User clicks Push Data manually, then navigates away and comes back | Exactly one auto-sync attempt fires after nav return (not repeated) |
| Auto-push succeeds | Toast `"✅ Auto-synced: pushed {N} rows"` appears top-right for 5s |
| Auto-push fails | No toast; F5 banner appears; F4 dot red |
| Server records this attempt with `source: 'auto-push'` | Verify in DB |
| 60s poll fires and status unchanged | No *additional* auto-sync (`hasAutoSyncedOnMount` still true) |

---

### F7 — Persistent "Remote is up to date" version badge

**File**: `server/index.ts` + `src/lib/api.ts` + `src/pages/SchemaPlanner.tsx`.

**Goal**: in the Data Sync section, show a line that always tells you whether the deployed remote is at the same git commit as your local code.

**Backend**:

- `fetchVersion` already exists. Reuse it.
- No new endpoint needed; compare client-side using existing `fetchVersion()` (local) + `fetchVersion(remoteUrl)` (remote).

**Frontend state**:

```ts
const [versionState, setVersionState] = useState<{
  local: string | null;
  remote: string | null;
  match: boolean;
  checkedAt: string;
} | null>(null);
```

- Fetch on mount, after Deploy Code completes, and every 30s while on the Settings tab (to refresh the indicator as Railway finishes deploying).
- Use `commitsMatch()` helper from F1.4 for comparison.

**UI** (render directly above the three sync buttons in the Data Sync section):

- **Match** (green): `"✅ Remote code is up to date (commit {short})"`
- **Mismatch** (amber): `"⚠️ Remote is behind — local at {local} · remote at {remote}. Deploy Code to sync."`
- **Can't reach remote** (dim gray): `"Can't verify remote code version."`
- **Loading** (dim gray): `"Checking remote code version..."`

**Test conditions for F7**:

| Scenario | Expected |
|---|---|
| Local and remote commits match | Green badge shows short SHA |
| Commits differ | Amber badge shows both short SHAs |
| Remote unreachable | Gray "Can't verify" message |
| Remote `/api/version` returns `{ commit: null }` | Gray message, not a false-positive green |
| After successful Deploy Code | Badge goes amber → green within 30s of Railway going live |
| `commitsMatch("abc1234\n", "ABC1234")` in the comparison | Returns true (verifies F1.4 integration) |
| Settings tab open for >30s | Badge refreshes automatically |

---

### F8 — localStorage resume for in-flight deploys

**File**: `src/pages/SchemaPlanner.tsx`.

**Goal**: if user refreshes mid-deploy, the polling resumes. When complete, they see the final result rather than a lost progress indicator.

**localStorage shape**:

```ts
localStorage.splan_pendingDeploy = JSON.stringify({
  targetCommit: string;
  startTime: number;      // Date.now()
  filesChanged: number;
})
```

- Written at the start of `handleDeployCode` (right after `deployCode()` returns success).
- Cleared when:
  - The polling loop exits on commit match (success)
  - The polling loop hits timeout (10min)
  - The user clicks Deploy Code again (prior pending is superseded)

**Resume logic** (add to the existing mount `useEffect`):

```ts
useEffect(() => {
  const pending = safeParseJSON(localStorage.getItem('splan_pendingDeploy'));
  if (!pending || !pending.targetCommit) return;
  const ageMs = Date.now() - pending.startTime;
  // If it's been more than 30 minutes, assume it's stale — clear and bail
  if (ageMs > 30 * 60 * 1000) {
    localStorage.removeItem('splan_pendingDeploy');
    return;
  }
  resumeDeployPolling(pending);
}, []);

async function resumeDeployPolling(pending: { targetCommit: string; startTime: number; filesChanged: number }) {
  // Fetch current remote version first — if it already matches, we're done.
  const remote = await fetchVersion(remoteUrl);
  if (commitsMatch(remote.commit, pending.targetCommit)) {
    // Already live. Show success toast + trigger auto-push via F6.
    setSyncResult(`✅ Deploy complete (resumed): commit ${pending.targetCommit}`);
    localStorage.removeItem('splan_pendingDeploy');
    return;
  }
  // Otherwise, resume the polling with elapsed time preserved.
  // Reuse the existing poll logic by calling it with the preserved startTime.
  startDeployPolling(pending.targetCommit, pending.startTime);
}
```

**Edge**: if the fresh session's `remoteUrl` disagrees with what the original deploy used, bail gracefully with a message: `"Can't resume deploy — remote config changed."`

**Test conditions for F8**:

| Scenario | Expected |
|---|---|
| Start deploy, refresh page 10s later | On mount, polling resumes. Status indicator shows elapsed time continuing, not resetting. |
| Start deploy, refresh page 2min later, remote is already live | No polling; immediately shows "✅ Deploy complete (resumed)"; localStorage cleared |
| Start deploy, refresh page 35min later | localStorage auto-cleared (stale); no phantom polling |
| Successful deploy finishes normally | localStorage cleared |
| Deploy times out at 10min | localStorage cleared |
| Click Deploy Code while a `splan_pendingDeploy` already exists | New deploy overwrites; old one is abandoned (user initiated replacement) |
| Resume when remote is unreachable | Polling retries until timeout or success |

---

### F9 — Tab-title notification during deploys

**File**: `src/pages/SchemaPlanner.tsx`.

**Design**:

- Only active when setting F12 is on (default: on).
- Watch `document.visibilityState` via `visibilitychange` event.
- When deploy starts AND tab is hidden: set `document.title = "⏳ Deploying — Schema Planner"`.
- When deploy completes (success or failure) AND tab is hidden: set `document.title = "✅ Deploy complete — Schema Planner"` (success) or `document.title = "❌ Deploy failed — Schema Planner"` (failure).
- When tab regains focus (`visibilitychange → visible`): restore title to its original (`"Schema Planner"` or whatever it was).
- Also restore on unmount via cleanup.

**Store the original title** in a ref at first effect run to handle any future title changes elsewhere.

**Test conditions for F9**:

| Scenario | Expected |
|---|---|
| Start deploy, switch to another tab | Title changes to "⏳ Deploying — Schema Planner" |
| Return to tab while deploy in progress | Title restores |
| Switch away, deploy completes | Title changes to "✅ Deploy complete — Schema Planner" |
| Switch back | Title restores |
| Deploy fails while tab backgrounded | Title is "❌ Deploy failed — Schema Planner" |
| Setting F12 is off | Title never changes |
| Unmount during deploy | Title restored |

---

### F10 — Deploy timeout 5min → 10min

**File**: `src/pages/SchemaPlanner.tsx`, inside `handleDeployCode`.

- Change `if (elapsed > 300)` to `if (elapsed > 600)`.
- Update the timeout message to `"Deploy timed out after 10 minutes"`.
- Integrates with F1.2 (fallback push on timeout).

**Test condition**: mock clock, verify poll continues past 305s and exits at 601s.

---

### F11 — Settings toggle: "Auto-sync when only one side has changes"

**File**: `src/pages/SchemaPlanner.tsx`, Settings tab render.

**Placement**: inside the Data Sync section, ABOVE the three sync buttons.

**Component**: a checkbox `<input type="checkbox">` with inline label:
> `[x] Auto-sync when only one side has changes`
> `Automatically push or pull when it's unambiguous which direction to go. Disable if you prefer manual control.`

**Persistence**: localStorage key `splan_autoSyncEnabled`, boolean, default `true`.

**State**:
```ts
const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(() => {
  const raw = localStorage.getItem('splan_autoSyncEnabled');
  return raw === null ? true : raw === 'true';
});
useEffect(() => {
  localStorage.setItem('splan_autoSyncEnabled', String(autoSyncEnabled));
}, [autoSyncEnabled]);
```

**Test conditions for F11**:

| Scenario | Expected |
|---|---|
| First visit | Checkbox is checked (default on) |
| Uncheck, refresh | Checkbox remains unchecked |
| Uncheck, then trigger F6 conditions | No auto-sync fires |
| Check, refresh | Checkbox checked, auto-sync resumes |
| localStorage value is `"false"` string | Loads as unchecked |
| localStorage value is missing | Defaults to checked |

---

### F12 — Settings toggle: "Notify in tab title during deploys"

Same pattern as F11.

- **localStorage key**: `splan_tabTitleNotifications`
- **Default**: `true`
- **Label**: `[x] Notify in tab title during deploys`
- **Description**: `Changes this browser tab's title when a deploy starts or finishes so you can spot it from another tab.`

**Test conditions**: same structure as F11 (check persistence and on/off behavior).

---

### F13 — Re-sync if change count grew mid-push (race mitigation)

**File**: `src/pages/SchemaPlanner.tsx` (client-side only — server does not enforce this).

**Goal**: if a user adds changes during an auto-push, auto-fire a follow-up push so the new changes don't get stranded.

**Design**:

- Just before auto-push fires, snapshot `localChangeCountBefore = syncStatus.local.changeCount`.
- After push returns success, fetch fresh sync status.
- If `newStatus.local.changeCount > 0`:
  - Log informational message in `syncResult`: `"ℹ️ Additional changes accumulated during sync — running follow-up push..."`
  - Fire a second `handleSyncPush({ source: 'auto-push' })`.
- Bound recursion: track a `followUpCount` variable. Max 2 follow-ups per original trigger (so at most 3 pushes in a chain). After that, log `"ℹ️ {N} local changes still pending after follow-ups. Click Push Data to send them."` and stop.
- Only applies to auto-push (not manual push — a manual push that leaves pending changes is the user's problem to notice).
- Analogous logic for auto-pull not needed (remote change count can't grow from client's actions).

**Test conditions for F13**:

| Scenario | Expected |
|---|---|
| Auto-push starts with 238 local changes, no new edits during | One push, no follow-up |
| Auto-push starts with 238, user edits a record during push (via CRUD API), push completes | Second push fires automatically, syncs the new change |
| Third iteration: user keeps editing every push | Chain stops at follow-up 2 with informational message |
| Manual push (via Push Data button) leaves pending changes | No follow-up fires (by design — only auto-push recurses) |
| Each follow-up push writes its own `_splan_sync_meta` row with `source: 'auto-push'` | Verify via DB |

---

## 6. Technical gotchas

### 6.1 Read-before-edit hook

Every existing file you edit must be read (via Read tool) earlier in the session. The hook enforces this. Cheap to satisfy — just Read the file once before your first Edit to it.

### 6.2 Schema migration deployment order

F2's `ALTER TABLE _splan_sync_meta` changes schema. The new columns are added locally on next app start. For remote to have them, a Deploy Code must follow F2. Until that deploy happens:
- Remote will still write to the old schema on pushes (it won't crash — SQLite silently ignores unknown columns in some contexts, but the writes from `recordSyncAttempt` may fail on remote).
- Therefore, **deploy code immediately after F2 lands locally**, before testing F3+.
- Add a fallback in `recordSyncAttempt` server code: `try { INSERT with new columns } catch { INSERT with old columns }` — but this is ugly and probably overkill. Cleaner approach: Deploy Code right after F2 and accept a brief window where F3 returns degraded results.

### 6.3 UUID generation

`uuid` package is already a dependency. Use `import { v4 as uuidv4 } from 'uuid'`.

### 6.4 Popover positioning (F4)

Since there's no popover library in the project, implement as a raw `<div>` with `position: absolute` below the dot. Close on outside click by attaching a document-level listener in a `useEffect` that mounts only when `popoverOpen === true`. Reference `src/components/schema-planner/*.tsx` for existing patterns.

### 6.5 React 19 + useRef

React 19 requires `useRef` initial value to be passed explicitly (no longer undefined-by-default). Use `useRef<boolean>(false)`.

### 6.6 Timing in tests

For timeouts and polling, use Vitest's fake timers:
```ts
import { vi } from 'vitest';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
// Then: vi.advanceTimersByTime(600_000); // 10min
```

### 6.7 Server-side vs client-side source attribution

The `source` string is set by the client and trusted by the server. That's acceptable here — it's not a security boundary, just a categorization for the user's own sync log. Don't over-engineer validation.

### 6.8 Attempt ID vs row ID

Two separate identifiers on `_splan_sync_meta` rows:
- `id` (integer, PK, already exists) — internal only
- `attempt_id` (string UUID, new) — stable identifier exposed to the client for dismissal tracking

Clients reference `attempt_id`. Never expose the integer `id` in API responses.

### 6.9 Edge case: concurrent browser tabs

If the user has two browser tabs open on the local app, auto-sync could fire from both. The server-side conflict/schema guardrails will cause one of them to fail with 409, which is fine — the failure is visible via F4/F5. Don't add cross-tab coordination; not worth the complexity.

### 6.10 Don't regress existing features

Critical: the following must still work unchanged after this PRD lands:
- Conflict detection (local + remote both have changes → both Push and Pull disabled with banner)
- Schema mismatch detection (purple banner + all sync buttons disabled except Deploy Code)
- Force Push / Force Pull with confirmation dialogs
- `SyncDiffViewer` rendering in Settings
- Manual Push Data / Pull Data / Deploy Code button flows

Add regression tests if practical:
- Existing test file list should be at `src/**/*.test.ts{,x}` or `test/**/*.test.ts{,x}` — check `package.json` for the `test` script pattern.

---

## 7. Definition of done

For each feature F1-F13:

1. ✅ Code compiles (`npm run build` exits 0)
2. ✅ All listed test conditions for that feature pass (automated or manual — document which)
3. ✅ No regression in the features listed in §6.10
4. ✅ Atomic git commit per feature with descriptive message

For the full set:

1. ✅ A full end-to-end manual test: set up a conflict scenario, resolve it; trigger Deploy Code and verify the full happy path (deploy → auto-push → green dot → success banner disappears); trigger a failure and verify red banner + red dot + dismissibility; refresh mid-deploy and verify resume; toggle the settings and verify both settings actually change behavior.
2. ✅ Run `npm run build` and `npm test` on the final commit.
3. ✅ Browse to `localhost:5173?sptab=settings` and visually confirm:
   - Sidebar has a colored status dot next to "Schema Planner"
   - Data Sync section has the remote version badge above the buttons
   - Two new checkboxes exist (auto-sync, tab-title notifications)
   - Top banner appears on failure and is dismissible
4. ✅ Deploy the code to Railway (via Deploy Code). After the deploy completes, verify everything continues to work (especially F2's schema extension).

---

## 8. Out-of-scope safety rails

Do NOT build any of the following even if they seem helpful:

- Automatic Deploy Code triggering (deploy is always user-initiated)
- Settings UI beyond F11 and F12 (no "advanced" settings panel)
- Cross-device sync coordination (per-browser is fine)
- Background service worker
- Email/push notifications
- Analytics or logging beyond the existing `_splan_change_log` and the extended `_splan_sync_meta`
- Optimistic UI during auto-sync (let the toast/banner be the feedback channel)
- Rate-limiting on auto-sync (the `hasAutoSyncedOnMount` ref is enough)
- A global "Dismiss all failures" button (one-by-one dismissal is intentional)

---

## 9. Open questions for the implementer

If any of these come up during implementation, make a judgment call and document it in the commit message:

1. If the `_splan_sync_meta` migration fails on an existing DB (column already exists), how to handle? → Wrap in `try/catch` per column and log.
2. If `fetchLastSyncAttempt` returns null AFTER an attempt was recorded (race), how to display? → Treat as "no attempts" (gray dot). Next poll will catch up.
3. Should auto-sync fire if there's a `syncResult` showing a previous failure? → Yes. The previous failure is history; current state is what matters. But if auto-sync itself just failed (same mount), don't re-trigger — the `hasAutoSyncedOnMount` ref prevents this.
4. If user disables F11 mid-session while auto-sync is in flight, cancel it? → No, let it complete. The setting only affects *future* triggers.

---

## 10. Summary

| ID | Feature | Lines of code (est.) |
|---|---|---|
| F1 | `handleDeployCode` hardening (4 sub-fixes) | ~80 (rewriting existing handler) |
| F2 | Extend `_splan_sync_meta` + record attempts | ~60 server + migration |
| F3 | `/api/sync/last-attempt` endpoint | ~25 server + ~15 client |
| F4 | Sidebar status dot + popover | ~120 |
| F5 | Dismissible top banner | ~60 |
| F6 | Auto-sync + toast | ~100 + ~40 for toast |
| F7 | Remote version badge | ~50 |
| F8 | localStorage deploy resume | ~50 |
| F9 | Tab-title notifications | ~40 |
| F10 | Timeout constant change | ~2 |
| F11 | Auto-sync setting toggle | ~25 |
| F12 | Tab-title setting toggle | ~25 |
| F13 | Mid-push re-sync recovery | ~40 |
| **Total** | | **~700 LOC across ~5 files** |

Estimated implementation time in a fresh session: **3-5 focused hours** including testing.
