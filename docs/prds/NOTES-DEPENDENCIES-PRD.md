# Notes & Dependencies PRD

**Purpose**: turn every Notes column in Schema Planner into a first-class, rich, reference-aware editor backed by a shared store, with an auto-paired **Dependencies** column whose entries are Claude-written explanations of *why* each reference is a dep. Purpose of the dep column: give current and future Claude Code sessions a structured, at-a-glance map of what each entity depends on, so revising a module/feature/concept/table/field won't silently break something else downstream.

**Target implementation**: separate session with fresh context. This document is self-contained.

**Phase sequence**: A → B → C → E, with Phase D (auto-analyze) as a secondary follow-on. Each phase lands atomically behind a smoke-test gate before the next begins.

---

## 1. Context for a fresh session

### 1.1 Project

Schema Planner is a React 19 + Vite 8 + Express 5 + better-sqlite3 full-stack planner. Runs locally (Node on 3100 + Vite on 5173 concurrently) and is deployed to a Railway-hosted Express app.

### 1.2 What's already shipped (Phase 1 — DO NOT rebuild)

A prior session landed the **shared notes store plumbing**. The following exists and works:

- **`_splan_entity_notes` SQL table** (server/db.ts): keyed `(entity_type, entity_id, note_key)` UNIQUE. Stores `content TEXT`, `notes_fmt JSON`, `collapsed_sections JSON`, `embedded_tables JSON`, timestamps.
- **One-time backfill block** (server/db.ts, after migrations): copies existing `_splan_concepts.notes` + companion columns into `_splan_entity_notes` rows with `note_key='notes'`. Idempotent via `INSERT OR IGNORE`. Source columns remain populated as a safety net.
- **Cascade-delete hook** (server/index.ts, DELETE `/api/schema-planner`): removes any `_splan_entity_notes` rows when an entity is deleted.
- **Notes API** (server/index.ts):
  - `GET /api/schema-planner/notes?entityType&entityId&noteKey` → single note
  - `GET /api/schema-planner/notes?entityType&entityId` → all notes for entity
  - `GET /api/schema-planner/notes?entityType` → all notes for type (batch fetch)
  - `PUT /api/schema-planner/notes` → upsert with single change-log entry per save
  - `DELETE /api/schema-planner/notes` → explicit removal
- **`'notes'` column type** in `ColDef.type` union (src/components/schema-planner/types.ts:4). Added to the Add Column type-picker (SchemaPlannerTab.tsx ~line 4218). Custom columns of type `notes` skip `ALTER TABLE` (server/index.ts ~line 379) and live entirely in the shared store.
- **Client API** (src/lib/api.ts ~line 299-370): `fetchEntityNote`, `fetchEntityNotes`, `fetchEntityNotesByType`, `saveEntityNote`, `deleteEntityNote`, `EntityNote` type.
- **Generalized fullscreen note overlay** (SchemaPlannerTab.tsx): state `fullscreenNote: {row, tabKey, noteKey}` replaces the old Concepts-only `fullscreenConceptNote`. Opens for any tab's Notes column. Editor reads from `entityNotesCache` (per-tab batch prefetch), saves via `saveEntityNote`.
- **Click-handler wrapper** (SchemaPlannerTab.tsx ~line 3340): both `note-fullscreen` (legacy Concepts) and `notes` (new generic) types route to the same overlay.
- **Add Column form UX fix**: disabled Create button now shows inline "Enter a name to create" hint + tooltip + `cursor: not-allowed`.

### 1.3 Files to know

| Path | Role |
|---|---|
| `server/db.ts` | SQLite schema + migrations. Add `_splan_entity_dependencies` here. |
| `server/index.ts` | All Express routes. Add `/api/schema-planner/dependencies/*` + `/api/agents/launch-headless` here. Agent infra at ~line 1384. `logChange()` at ~line 103. |
| `server/utils.ts` | `parseRow`/`prepareRow` case conversion + JSON column set. Add new JSON columns (e.g., `last_analyzed_at` is timestamp, no JSON needed). |
| `src/lib/api.ts` | Frontend API client. Add `fetchDependencies`, `saveDependency`, `dismissDependency`, `analyzeDependencies`, `DependencyEntry` type. |
| `src/components/schema-planner/types.ts` | Add `dependencies` to `ColDef.type` union. |
| `src/components/schema-planner/constants.ts` | `TABLE_CONFIGS` + `PLATFORM_NOTE_SECTIONS`. Built-in Notes+Dependencies column declarations + legacy platform-notes config (to be removed in Phase E). |
| `src/components/schema-planner/SchemaPlannerTab.tsx` | 7500+ line grid component. Add dependencies cache, renderer, side panel, analyze-now button. Fullscreen note overlay at ~line 7390. Expanded-feature-row UI with `PLATFORM_NOTE_SECTIONS` rendering at ~line 5195 + References panel at ~line 5394 (to be removed in Phase E). |
| `src/components/schema-planner/text-utils.ts` | `extractRefs(text)` returns `{tableIds, fieldIds, imageIds, moduleIds, featureIds, conceptIds, researchIds}`. `extractRefsFromNotes` for display. Re-used by auto-extract in Phase B. |
| `src/components/schema-planner/FeatureMentionField.tsx` | Rich editor component. `onCommit` debounces at 2s. Reused as-is. |
| `AGENT_CONFIG_FILE`, `AGENT_HISTORY_FILE`, `AGENT_RESULTS_DIR` (constants in server/index.ts) | Agent storage for schedules/history/results. Reused in Phase C/D. |

### 1.4 Conventions

- DB columns: `snake_case`. API/frontend: `camelCase`. Converted via `parseRow`/`prepareRow` in `server/utils.ts`. Any new camelCase field must be in the conversion map or it silently drops.
- JSON columns must be registered in `JSON_COLUMNS` set (server/utils.ts). Add `auto_added`, `is_stale`, `is_user_edited` to `BOOL_COLUMNS` if they're SQLite INTEGER 0/1.
- Tables prefixed `_splan_`.
- Computed fields prefixed `_`.
- React state in `SchemaPlannerTab.tsx` is local `useState`. No Redux.
- URL params for active tab/selection. localStorage for user prefs.
- `TABLE_MAP` (server/index.ts:58) registers every entity table — do NOT add `_splan_entity_notes` or `_splan_entity_dependencies` to TABLE_MAP (they are not CRUD'd via generic endpoints; they have dedicated routes).

### 1.5 CLAUDE.md non-negotiables (from project root)

- **Case conversion is invisible** — a camelCase field not in the conversion map silently drops.
- **GitHub PAT** stored server-side only in `.github-config.json` — never expose to client.
- **No destructive smoke tests** — never PUT/POST placeholder payloads to secret-holding endpoints.
- Prefer editing existing files over creating new ones. No emojis unless user asks.

---

## 2. Design decisions (user-confirmed — do not revisit)

| # | Decision | Rationale |
|---|---|---|
| D1 | Scope of legacy-notes migration: **only rich-editor narrative fields**. Migrate: `features.{notes, nativeNotes, androidNotes, appleNotes, otherNotes, implementation}`, `concepts.notes` (already done). **Do NOT migrate** plain textareas that ARE the record's primary content: `feedback.notes`, `data_reviews.notes`, `data_access_rules.scopeNotes`/`ownershipNotes`, `data_fields.nameReasoning`, `data_tables.descriptionPurpose`. Those stay as regular fields. | Plain textareas serve a different role than notes-about-an-entity. |
| D2 | Dependencies column visibility: **hidden in grid by default, visible in expanded-row panel**. User can opt-in to grid visibility via the View panel. | Preserve grid scannability; auto-pairing can create many columns. |
| D3 | Features' 5 platform notes + implementation: **fully deprecated and merged into ONE unified Notes column per Feature**. Content preserved by concatenating into the unified note with section markers (`## Web App Notes`, `## Native Notes`, etc.). Platform-conditional visibility (`PLATFORM_NOTE_SECTIONS`) is removed entirely — the unified note's existing collapsible-section feature handles user hiding of irrelevant platforms. | User explicitly chose "one replacement column" over per-platform note_keys. Simplifies model. |
| D4 | Custom Notes column delete: **hard-deletes both `_splan_entity_notes` rows AND paired `_splan_entity_dependencies` rows** for that note_key. No soft-delete window. | User can re-add column if they change their mind; undoing is rare. |
| D5 | Built-in Notes: **paired Dependencies column declared in `TABLE_CONFIGS`** for every entity that has a built-in Notes column. Existing backfilled notes get analyzed on first Claude run (lazy, not eager on boot). | Avoids slamming Claude on startup with dozens of un-analyzed notes. |
| D6 | User edits to Claude-written explanations: **still re-analyzed on next auto-run**, BUT the prior user-edited explanation is passed into the Claude prompt as context (so the new explanation reconciles with the user's intent rather than overwriting it). Column `previous_user_edit TEXT` stores the last user version; `explanation` holds the live (possibly Claude-rewritten) value. | User's edits inform Claude's next pass without being overwritten blindly. |
| D7 | Headless agent mode: **`POST /api/agents/launch-headless`** variant that runs `claude -p` silently (no PowerShell window), writes result to `AGENT_RESULTS_DIR`, returns `{runId}`. Phase D (auto-analyze) depends on this. | Existing `/api/agents/launch` pops a window per run — unusable for background use. |
| D8 | One change-log entry per save per notes column AND per deps column, regardless of how many individual edits/deps changed. Auto-analyze writes tagged `reasoning='auto-analyze'` so sync-diff can filter. | User explicitly requested this granularity earlier. |

---

## 3. Data model additions

### 3.1 `_splan_entity_dependencies` (new table)

```sql
CREATE TABLE IF NOT EXISTS _splan_entity_dependencies (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type          TEXT NOT NULL,              -- 'module', 'feature', 'concept', 'table', 'field', etc.
  entity_id            INTEGER NOT NULL,
  note_key             TEXT NOT NULL,              -- matches _splan_entity_notes.note_key
  ref_type             TEXT NOT NULL,              -- 'Table', 'Field', 'Module', 'Feature', 'Concept', 'Research', 'Image'
  ref_id               TEXT NOT NULL,              -- stored as TEXT because Image refs are UUIDs; numeric refs stored as string
  ref_name             TEXT,                       -- cached display name at time of analysis (for orphan display)
  explanation          TEXT NOT NULL DEFAULT '',   -- the current visible explanation (Claude-authored or user-edited)
  previous_user_edit   TEXT,                       -- last user-edited version of explanation, preserved as context for re-analysis
  is_stale             INTEGER NOT NULL DEFAULT 0, -- 1 if ref has been removed from notes but dep entry retained
  is_user_edited       INTEGER NOT NULL DEFAULT 0, -- 1 if user manually edited explanation since last Claude analyze
  auto_added           INTEGER NOT NULL DEFAULT 1, -- 0 if user manually added a dep (not derivable from notes)
  last_analyzed_at     TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id, note_key, ref_type, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_deps_by_entity
  ON _splan_entity_dependencies(entity_type, entity_id, note_key);
CREATE INDEX IF NOT EXISTS idx_entity_deps_by_ref
  ON _splan_entity_dependencies(ref_type, ref_id);
```

### 3.2 Additions to `_splan_entity_notes`

```sql
ALTER TABLE _splan_entity_notes ADD COLUMN last_analyzed_at TEXT;
```

Used by Phase D scheduler to detect notes dirty-since-last-analyze.

### 3.3 Additions to `_splan_column_defs` (no schema change; semantics only)

- New valid `column_type`: `'dependencies'`. Auto-created when a `'notes'` column is created. Column_key convention: `{notesKey}_deps`.
- Deleting a notes column_def hard-deletes its paired deps column_def (server-side cascade).

### 3.4 Register in parseRow/prepareRow

Add to `BOOL_COLUMNS` (server/utils.ts):
- `is_stale`, `is_user_edited`, `auto_added`

No new `JSON_COLUMNS` needed for dependencies.

---

## 4. Phase A — Smoke test current Notes + bug fixes

**Goal**: validate that Phase 1 (shared notes store) works correctly across all entity types and fix any bugs surfaced before building Dependencies on top.

### 4.1 Manual test plan

Run each test in browser against a local dev server (`npm run dev`).

**A1. Concepts regression (backfill verification)**
1. Open Concepts tab, pick any pre-existing concept with notes.
2. Click the Notes cell → fullscreen overlay opens.
3. Verify: content loads exactly as it did pre-migration, including formatting, collapsed sections, embedded tables.
4. Edit the content, close, refresh the page.
5. Verify: edits persist.
6. Check `_splan_change_log` (via Change Log tab): one entry with `field_changed='notes'`, `reasoning='Notes edit: notes'`.

**A2. Modules — add a custom Notes column**
1. Open Modules tab, click View → + Add Column → name "Design Notes", type Notes, Create.
2. Verify: column appears in grid with `0 Lines` count badges.
3. Click a Module's Design Notes cell → fullscreen overlay opens with the module's name in the header.
4. Type `(OnSite Monitor)` — ref autocomplete should work.
5. Close overlay, reload.
6. Verify: content persists, badge updates to `1 Line`.
7. Verify nested feature dropdown still works: click expand chevron on the module row → features table renders unchanged.

**A3. Features — add a custom Notes column alongside existing platform-notes**
1. Add a custom Notes column "Scratch Pad" on Features.
2. Verify: platform-notes (Web App / Native / Android / Apple) in the expanded row still render correctly — NOT touched.
3. Type content in "Scratch Pad" with a `(table_name)` ref.
4. Verify: persists, refs resolve.
5. Verify: the Features expanded-row "References (extracted from notes)" panel still works (reads from legacy notes columns, not the new store — this mismatch is resolved in Phase E).

**A4. Data Tables / Data Fields — add a Notes column**
1. Add "Design Notes" column to Data Tables.
2. Verify: click-to-open works, content persists, refs resolve.
3. Same for Data Fields.

**A5. Delete cascade**
1. Create a throwaway concept with notes content.
2. Delete the concept.
3. Verify (SQLite query): `SELECT * FROM _splan_entity_notes WHERE entity_type='concept' AND entity_id=<deleted_id>` returns 0 rows.

**A6. Custom Notes column delete cascade**
1. Add a custom Notes column, write content to several rows.
2. Delete the column via the View panel.
3. Verify: all `_splan_entity_notes` rows with that `note_key` are gone.

**A7. Sync diff granularity**
1. Edit a note, make ~5 small changes within 30 seconds, close.
2. Check Change Log: should see 1 entry (debounced commit), not 5.
3. Open SyncDiffViewer (Settings → Data Sync): notes change should appear as ONE row for that column, not per-line-diff.

### 4.2 Known-or-suspected bugs — Phase A findings

Findings from the Phase A audit run on 2026-04-17:

- **BUG-A1** *(not a bug)*: Null-value handling verified correct. The click-handler wrapper computes `displayValue = cached?.content ?? value` before delegating to `renderCell`, so a custom Notes column with content in the shared-store cache renders the line-count badge correctly. The `renderCell` early-return "null" fires only when both the cache AND the row value are truly empty, which is the right behavior. **No fix needed.**

- **BUG-A2** *(deferred, low priority)*: First-render flash is real but minor. The batch fetch resolves in typically <100ms for modest tab sizes; cells briefly show "null" before the cache populates. Deferred to future optimization. **No fix in Phase A.**

- **BUG-A3** *(deferred, low priority)*: `entityNotesCache` grows across tab switches with no eviction. Likely benign for realistic session lengths (<10k entries); consider LRU eviction if memory concerns arise. **No fix in Phase A.**

- **BUG-A4** *(FIXED — this was the important one)*: Opening Notes on an unsaved row (which has a negative tempId, see `applyLocalCreate` at SchemaPlannerTab.tsx:1965) would have written an orphan `_splan_entity_notes` row with a negative `entity_id`. Fix applied in two layers:
  - *Client guard* — `SchemaPlannerTab.tsx` click-handler wrapper for `note-fullscreen` / `notes` types: `const isUnsaved = !eid || eid <= 0;` Cell becomes non-clickable with `cursor: not-allowed`, opacity 0.5, and tooltip "Save this row first before adding notes".
  - *Server guards* — `server/index.ts` GET/PUT/DELETE `/api/schema-planner/notes`: `if (!Number.isFinite(entityId) || entityId <= 0) return 400 "entityId must be a positive number (unsaved rows cannot have notes)"`. Defense in depth: rejects negative IDs even if a stale client bypasses the UI guard. (The previous `!entityId` check was insufficient because JavaScript treats `-1729` as truthy.)

- **BUG-A5** *(verified working)*: Formatting-only saves DO trigger a change-log entry. The PUT `/api/schema-planner/notes` `changed` computation compares content AND fmt AND collapsed AND tables separately, so any of the four changing triggers a log write. **No fix needed.**

### 4.3 Verification run-log (2026-04-17)

| Check | Result |
|---|---|
| `npx vite build` | ✅ Passes after BUG-A4 fix. Bundle size unchanged. |
| `npx tsx server/index.ts` boot | ✅ "Schema Planner API running on port 3100" |
| `SELECT COUNT(*) FROM _splan_entity_notes` | ✅ 9 rows present (Concepts backfill worked on first server boot) |
| Sample row preview | ✅ Existing concept notes content preserved verbatim |
| Client build warnings | None material (only pre-existing 500kB chunk-size notice) |

### 4.4 Browser tests not yet run

The following tests in §4.1 **require manual browser verification** (the audit session did code-level verification + DB spot-check only):

- A1 test 2-5: click through a Concept's Notes, edit, save, reload, confirm persistence.
- A2 all: add a custom Notes column to Modules, verify nested feature dropdown still expands correctly.
- A3 all: add a custom Notes column to Features, confirm platform-notes untouched.
- A4 all: add Notes columns to Data Tables + Data Fields.
- A5: delete an entity, verify DB cascade.
- A6: add custom Notes column, write content, delete column, verify DB cascade.
- A7: make several rapid edits, verify ONE change-log entry per save + single sync-diff entry.

**These tests should run in the fresh session at the start of Phase B** (§11 execution order), as the first action. Any regression found there must be fixed before Phase B can proceed.

### 4.3 Acceptance

- All A1–A7 tests pass.
- Known bugs fixed (or explicitly documented as won't-fix with rationale).
- `git commit` after fixes with message referencing PRD Phase A.

### 4.4 Rollback

Phase A is verification only. No schema changes. Rollback = revert bug-fix commits.

---

## 5. Phase B — Dependencies column (storage + UI, no Claude yet)

**Goal**: users can see and manually edit a Dependencies side-panel for any Notes column, auto-populated from note refs.

### 5.1 SQL changes

Apply §3.1 (`_splan_entity_dependencies` table) in `server/db.ts` inside `initSchema`.

### 5.2 Server API additions

All in `server/index.ts`. Place adjacent to existing `/api/schema-planner/notes` routes.

```typescript
// GET /api/schema-planner/dependencies?entityType&entityId&noteKey
//   → DependencyEntry[] — all deps for this (entity, noteKey)
// GET /api/schema-planner/dependencies?entityType&entityId
//   → DependencyEntry[] — all deps for this entity across all noteKeys
// GET /api/schema-planner/dependencies?refType&refId
//   → DependencyEntry[] — reverse lookup: "who depends on this ref?"
// PUT /api/schema-planner/dependencies/:id
//   body: { explanation?: string, isStale?: boolean, dismissStale?: boolean }
//   → updated entry. Sets is_user_edited=1 if explanation changes.
// POST /api/schema-planner/dependencies
//   body: { entityType, entityId, noteKey, refType, refId, refName, explanation? }
//   → new manual dep (auto_added=0). 409 if already exists.
// DELETE /api/schema-planner/dependencies/:id
//   → permanent removal (used for stale rows or manual deps).
```

### 5.3 Auto-extract hook

Extend `PUT /api/schema-planner/notes` (existing endpoint) to run after the note upsert:

```typescript
// Inside PUT /api/schema-planner/notes, after the save, before logChange:
if (changed && content != null) {
  const refs = extractRefsFromContent(content);  // server-side port of text-utils.ts extractRefs
  syncDependencies({
    entityType, entityId, noteKey,
    currentRefs: refs,
    preserveUserEdits: true,
  });
}
```

`syncDependencies` logic:
1. Load existing deps for `(entityType, entityId, noteKey)`.
2. For each ref in `currentRefs` not in existing: INSERT with `auto_added=1`, empty `explanation`, `last_analyzed_at=NULL`.
3. For each existing dep whose ref is NOT in `currentRefs` AND `auto_added=1`: UPDATE `is_stale=1`.
4. For each existing stale dep whose ref IS now back in `currentRefs`: UPDATE `is_stale=0`.
5. Log ONE change-log entry with `field_changed={noteKey}_deps`, summarizing net change count. Action=UPDATE.

**Server-side `extractRefs` port**: copy the regex + resolution logic from `src/components/schema-planner/text-utils.ts` into a new `server/text-utils.ts`. This keeps auto-extract server-authoritative (client can't forge deps).

### 5.4 Auto-pair on Notes column creation

Extend `POST /api/column-defs` (server/index.ts ~line 353):

```typescript
if (columnType === 'notes') {
  // After inserting the notes column_def, also insert the paired deps column_def
  const depsKey = `${columnKey}_deps`;
  const depsLabel = `${label} Dependencies`;
  const depsSortOrder = sortOrder + 0.5;  // positions right after notes column
  db.prepare(
    'INSERT INTO _splan_column_defs (entity_type, column_key, label, column_type, options, formula, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(entityType, depsKey, depsLabel, 'dependencies', '[]', '', depsSortOrder);
}
```

Extend `DELETE /api/column-defs/:id` to cascade-delete the paired deps column_def AND its `_splan_entity_dependencies` rows when deleting a notes column.

### 5.5 Client API additions (src/lib/api.ts)

```typescript
export interface DependencyEntry {
  id: number;
  entityType: string;
  entityId: number;
  noteKey: string;
  refType: 'Table' | 'Field' | 'Module' | 'Feature' | 'Concept' | 'Research' | 'Image';
  refId: string;
  refName: string | null;
  explanation: string;
  previousUserEdit: string | null;
  isStale: boolean;
  isUserEdited: boolean;
  autoAdded: boolean;
  lastAnalyzedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchDependencies(entityType: string, entityId: number, noteKey?: string): Promise<DependencyEntry[]>;
export async function fetchDependenciesForRef(refType: string, refId: string): Promise<DependencyEntry[]>;  // reverse lookup
export async function saveDependency(id: number, patch: Partial<Pick<DependencyEntry, 'explanation' | 'isStale'>>): Promise<DependencyEntry>;
export async function createDependency(data: Omit<DependencyEntry, 'id' | 'createdAt' | 'updatedAt' | ...>): Promise<DependencyEntry>;
export async function deleteDependency(id: number): Promise<{success: boolean}>;
```

### 5.6 Type system

Add `'dependencies'` to `ColDef.type` union (src/components/schema-planner/types.ts:4).

### 5.7 UI

**Grid cell renderer** (SchemaPlannerTab.tsx ~line 2664 case block):
```tsx
case 'dependencies': {
  // value is not meaningful for this type; read from deps cache
  const cfg = TABLE_CONFIGS[subTab];
  const eid = row[cfg.idKey] as number;
  const deps = dependenciesCache[`${cfg.entityType}:${eid}:${noteKeyForDeps(col.key)}`] || [];
  const total = deps.length;
  const stale = deps.filter(d => d.isStale).length;
  if (total === 0) return <span style={{color: 'var(--color-text-muted)', fontStyle: 'italic'}}>null</span>;
  return <span style={{color: '#a78bfa'}}>{total} dep{total === 1 ? '' : 's'}{stale > 0 ? ` · ${stale} stale` : ''}</span>;
}
```

**Click handler wrapper** (SchemaPlannerTab.tsx ~line 3340 area):
```tsx
if (col.type === 'dependencies') {
  return (
    <span className="cursor-pointer hover:bg-black/5 rounded px-0.5 -mx-0.5 block min-h-[1.2em]"
          onClick={(e) => { e.stopPropagation(); setDepPanel({row, tabKey: subTab, depColKey: col.key}); }}
          title="Click to view dependencies">
      {renderCell(col, value)}
    </span>
  );
}
```

**Dependencies side panel** — new overlay state `depPanel: {row, tabKey, depColKey} | null`. Renders a right-docked panel (400-500px wide) with:
- Header: `{entityName} — {Notes Label} Dependencies` + close button
- "Analyze Now" button (Phase C — renders disabled in Phase B with tooltip "Available in next release")
- List of deps grouped by ref type (Tables, Fields, Modules, Features, Concepts, Research, Images)
- Per-dep row:
  - Ref type icon (colored per existing convention: Table=#a855f7, Field=#5bc0de, Module=#f2b661, Feature=#4ecb71, Concept=#c084fc)
  - Ref name (clickable → opens `RefSummaryPopup` already used elsewhere)
  - Explanation textarea (inline-editable, 2-4 line max)
  - Metadata footer: `Auto-added · Last analyzed: never` / `Manually added` / `Edited by you · Will be re-analyzed with your edit in context`
  - Stale rows: entire entry gets strikethrough + red-tinted background + "Dismiss" button (removes the row) + "Keep" button (marks as manual so it survives future auto-runs)

**Dependencies cache** — new React state in `SchemaPlannerTab.tsx`:
```tsx
const [dependenciesCache, setDependenciesCache] = useState<Record<string, DependencyEntry[]>>({});
const depCacheKey = (entityType: string, entityId: number, noteKey: string) => `${entityType}:${entityId}:${noteKey}`;
```

Load pattern: new useEffect triggered on tab change, calls a new server endpoint `GET /api/schema-planner/dependencies?entityType={type}` (batch by type). Cache key strips `_deps` suffix from column key to get the notes key.

**Auto-pairing helper** — `noteKeyForDeps(depColKey: string): string` returns `depColKey` with `_deps` suffix stripped.

### 5.8 View-panel integration

When a user creates a Notes column via the View panel:
1. Client POSTs `/api/column-defs` with `columnType: 'notes'`.
2. Server creates BOTH the notes def and the paired deps def.
3. Client reloads column defs (`reloadColumnDefs()`) — both columns appear.
4. Per D2, the new deps column is **hidden by default** — add its key to the default `hiddenCols` array for that tab's view preset.

### 5.9 Test plan

**B1. Auto-extract on note save**
1. Add a custom Notes column to Modules.
2. Open a module's Notes, type: `This depends on (data_tables) and the (features) module.`
3. Close overlay (wait for 2s debounce + save).
4. Check `_splan_entity_dependencies`: 2 new rows with `auto_added=1`, `explanation=''`.

**B2. Stale marking**
1. Open the same note from B1.
2. Delete the `(data_tables)` ref.
3. Close and check DB: `data_tables` dep row has `is_stale=1`.
4. Re-add `(data_tables)` to the note.
5. Close and check: `is_stale=0` (un-stale).

**B3. Manual dep creation**
1. Open Dependencies side panel for an entity.
2. Click "+ Add manual dep" (if present — optional feature).
3. Pick a ref, add explanation.
4. Verify: saved with `auto_added=0`.
5. Verify: removing the ref from notes does NOT stale-mark it (manual deps are not auto-managed).

**B4. User edits explanation**
1. Open Dependencies panel, edit an auto-added dep's explanation.
2. Verify: saves with `is_user_edited=1`, `previous_user_edit=<new text>`.

**B5. Notes column delete → deps cascade**
1. Create notes column, let deps auto-populate for a row.
2. Delete the notes column.
3. Verify: both column_defs rows gone + all related deps rows gone.

**B6. Change log granularity**
1. Edit a note, adding 3 new refs at once.
2. Verify: ONE change-log entry for the deps column, summarizing net change (e.g., "3 deps added").

### 5.10 Acceptance

- B1–B6 pass.
- Deps column appears auto-paired on notes column creation.
- Deps column hidden by default in grid; appears in expanded-row panel.
- Change-log shows one entry per save per column (notes + deps separately).
- No regressions in Phase A tests.

### 5.11 Rollback

- Drop `_splan_entity_dependencies` table.
- Revert `server/index.ts` endpoints.
- Revert client additions.
- Existing notes continue to work (Phase 1 state).

---

## 6. Phase C — "Analyze Now" button (Claude-authored explanations, on-demand)

**Goal**: clicking "Analyze Now" in the Dependencies side panel fires a Claude agent that reads the note + current deps, writes short explanations into each row.

### 6.1 Agent prompt template

Stored as a key in `AGENT_CONFIG_FILE` (existing mechanism): `dependencyAnalyzer.prompt`. User-editable via existing Agents tab.

**Default prompt** (text file or inline):
```
You are analyzing dependencies for {entityType} "{entityName}" in a database schema planning tool.

This entity has notes stored below. The notes mention several references to other entities (tables, fields, modules, features, concepts, research items). Your job is to write a short (max 20 words) explanation for each reference, saying WHY this {entityType} depends on that reference, based ONLY on the note context.

NOTE CONTENT:
{noteContent}

REFERENCES FOUND:
{refList}

{userEditsContextBlock}

Respond with JSON only, no prose:
{"dependencies": [{"refType": "...", "refId": "...", "refName": "...", "explanation": "..."}]}

Rules:
- One entry per reference in REFERENCES FOUND.
- Explanation must be ≤20 words, specific, grounded in the note content.
- If the note context doesn't clarify why the dep exists, write "Referenced in notes; dependency reason unclear."
- Do not invent refs that aren't in REFERENCES FOUND.
```

`{userEditsContextBlock}` is populated when any dep has a `previous_user_edit`:
```
USER-EDITED EXPLANATIONS (reconcile with these where applicable):
- refType={...}, refName={...}: "{previous_user_edit}"
```

Per D6: user edits get re-analyzed; Claude sees the user's prior edit and writes a new explanation that reconciles with it.

### 6.2 Server endpoint

`POST /api/schema-planner/dependencies/analyze`:
```typescript
// body: { entityType, entityId, noteKey, mode?: 'interactive' | 'headless' }
// mode defaults to 'interactive' (opens a PowerShell window — fine for button press).
// Phase D uses 'headless' for the background scheduler.
// 1. Load note content + all deps for (entityType, entityId, noteKey)
// 2. Build prompt from template
// 3. Call POST /api/agents/launch (Phase C) or /launch-headless (Phase D, see §8.5)
// 4. Wait for result file in AGENT_RESULTS_DIR (polling with timeout, or long-poll)
// 5. Parse JSON, validate shape
// 6. For each returned entry: UPDATE _splan_entity_dependencies SET explanation=?, previous_user_edit=NULL, is_user_edited=0, last_analyzed_at=now(), updated_at=now() WHERE (entity_type, entity_id, note_key, ref_type, ref_id) matches
// 7. Return the updated deps list
// 8. Log ONE change-log entry: field_changed='{noteKey}_deps', reasoning='claude-analyze'
```

### 6.3 Interactive-mode behavior (Phase C only)

Existing `/api/agents/launch` pops a PowerShell window running `claude -p`. For Phase C, this is acceptable because it's user-triggered (the user clicked a button; they expect visible agent activity). The result file is polled by the analyze endpoint; when the window closes, the endpoint reads the file and updates the DB.

### 6.4 UI

- "Analyze Now" button in Dependencies side panel header. Disabled during run, shows spinner + "Analyzing…".
- After completion, deps list re-renders with Claude's explanations. A toast: `Analyzed N dependencies in {duration}s`.
- Per-dep timestamp: `Last analyzed: {ago}` / `Not yet analyzed` / `Edited by you · Will re-analyze on next run`.
- If analysis errors (bad JSON, Claude refused, timeout): show error toast, leave explanations untouched.

### 6.5 Test plan

**C1. Happy path**
1. Open deps panel for an entity with 3 auto-added refs.
2. Click Analyze Now.
3. Verify: PowerShell window opens, `claude -p` runs, closes.
4. Verify: explanations populated, `last_analyzed_at` set, `is_user_edited=0`.

**C2. User-edit reconciliation**
1. Edit one dep's explanation manually (sets `is_user_edited=1`, `previous_user_edit=<text>`).
2. Click Analyze Now.
3. Inspect the prompt file in `%TEMP%\splan-agents\prompt-*.txt`: verify it includes the user's prior edit in USER-EDITED EXPLANATIONS section.
4. Verify: explanation gets rewritten (Claude's reconciled version), `previous_user_edit` cleared, `is_user_edited=0`.

**C3. Stale deps not analyzed**
1. Note has 5 refs, 2 stale.
2. Analyze.
3. Verify: only 3 non-stale deps get new explanations.

**C4. Error handling**
1. Simulate Claude returning invalid JSON (modify prompt to "return plain text").
2. Verify: error toast, no DB writes.

**C5. Prompt editability**
1. Open Agents tab.
2. Edit the `dependencyAnalyzer.prompt` override.
3. Analyze again.
4. Verify: new prompt used.

### 6.6 Acceptance

- C1–C5 pass.
- Prompt user-editable via Agents tab.
- Analysis writes single change-log entry.
- Runs successfully against a real Claude CLI install (local-mode only; `requireLocal`).

### 6.7 Rollback

- Remove `/api/schema-planner/dependencies/analyze` endpoint.
- Remove Analyze Now button (revert to Phase B disabled state).
- Dependencies continue to work without explanations.

---

## 7. Phase E — Deprecate legacy notes + Features refactor

**Goal**: remove the legacy Features platform-notes system entirely, migrate all content to unified Notes store, refactor the Features expanded-row UI to read from the new store.

### 7.1 Migration

New migration block in `server/db.ts`, after existing `_splan_concepts` backfill:

```typescript
// Backfill Features rich-notes into _splan_entity_notes (idempotent)
try {
  const features = db.prepare(
    "SELECT feature_id, notes, notes_fmt, native_notes, native_notes_fmt, android_notes, android_notes_fmt, apple_notes, apple_notes_fmt, other_notes, other_notes_fmt, implementation, impl_fmt, collapsed_sections, embedded_tables FROM _splan_features"
  ).all() as Array<Record<string, unknown>>;
  const insertNote = db.prepare(
    "INSERT OR IGNORE INTO _splan_entity_notes (entity_type, entity_id, note_key, content, notes_fmt, collapsed_sections, embedded_tables) VALUES ('feature', ?, 'notes', ?, ?, ?, ?)"
  );
  const txn = db.transaction((rows: typeof features) => {
    for (const r of rows) {
      // Merge all 5 platform notes + implementation into one unified note with section headers
      const sections: string[] = [];
      const webApp = (r.notes as string | null) || '';
      const native = (r.native_notes as string | null) || '';
      const android = (r.android_notes as string | null) || '';
      const apple = (r.apple_notes as string | null) || '';
      const other = (r.other_notes as string | null) || '';
      const impl = (r.implementation as string | null) || '';
      if (webApp.trim()) sections.push(`## Web App Notes\n${webApp}`);
      if (native.trim()) sections.push(`## Native Notes\n${native}`);
      if (android.trim()) sections.push(`## Android Notes\n${android}`);
      if (apple.trim()) sections.push(`## Apple Notes\n${apple}`);
      if (other.trim()) sections.push(`## Other Notes\n${other}`);
      if (impl.trim()) sections.push(`## Implementation\n${impl}`);
      const merged = sections.join('\n\n');
      if (merged.trim()) {
        insertNote.run(
          r.feature_id,
          merged,
          '[]',  // fmt arrays for individual platform notes can't be trivially merged; reset to empty. User re-formats if desired.
          r.collapsed_sections || '{}',
          r.embedded_tables || '{}',
        );
      }
    }
  });
  txn(features);
} catch (e) {
  console.error('Features notes backfill failed:', e);
}
```

**Note**: per D3, `notes_fmt` from the 5 platform columns is LOST during merge (can't align ranges after concatenation). User re-applies formatting if important. Flag this as a known loss in the user-facing changelog.

### 7.2 Remove legacy TABLE_CONFIGS entries

In `src/components/schema-planner/constants.ts`:

Before:
```typescript
{ key: "notes", label: "Web App Notes", type: "textarea", hideInGrid: true, ... },
{ key: "nativeNotes", label: "Native Notes", type: "textarea", hideInGrid: true, ... },
{ key: "androidNotes", ... },
{ key: "appleNotes", ... },
{ key: "otherNotes", ... },
{ key: "implementation", label: "Implementation", type: "textarea", ... },
```

After:
```typescript
{ key: "notes", label: "Notes", type: "notes", tooltip: "Rich narrative notes with references — click to open fullscreen editor" },
// Auto-paired deps column added by TABLE_CONFIGS loader or declared explicitly:
{ key: "notes_deps", label: "Notes Dependencies", type: "dependencies", hideInGrid: true },
```

Delete the `PLATFORM_NOTE_SECTIONS` constant.

### 7.3 Remove Features expanded-row platform-notes rendering

In `SchemaPlannerTab.tsx` ~line 5195, the block that iterates `PLATFORM_NOTE_SECTIONS` and renders per-platform `FeatureMentionField` instances gets replaced with a single unified `FeatureMentionField` for the `notes` note_key, using the same shared-store approach as the fullscreen overlay.

Also remove the References panel at ~line 5394 (legacy text-scan). The Dependencies side panel (Phase B) replaces it.

### 7.4 Mark legacy SQL columns as read-only

Do NOT drop columns in this phase (safety net). Instead:
- App no longer writes to `_splan_features.notes` / `.native_notes` / etc. after migration.
- Add a comment block in `server/db.ts`: `// Legacy Features notes columns (deprecated 2026-XX-XX — data in _splan_entity_notes with note_key='notes'). Safe to drop after 1 release.`
- A future cleanup phase (not in this PRD) runs `ALTER TABLE _splan_features DROP COLUMN notes` etc.

### 7.5 Sync diff handling

Legacy columns get excluded from sync diff (avoid showing "changed" when migration ran but new app doesn't write to them anymore). Add to skip set in `SyncDiffViewer.tsx` or equivalent.

### 7.6 Test plan

**E1. Migration idempotency**
1. Back up DB.
2. Run server boot twice.
3. Verify: `_splan_entity_notes` rows for features are NOT duplicated (UNIQUE constraint protects).

**E2. Content preservation**
1. Before migration: note content across 3 platform notes in feature X.
2. Run migration.
3. Open feature X in new UI.
4. Verify: all 3 sections visible with `## Web App Notes`, `## Native Notes`, etc. headers.

**E3. Features expanded-row**
1. Open a feature's expanded row.
2. Verify: ONE unified Notes editor renders, not 5 platform-specific ones.
3. Dependencies panel accessible from the row.

**E4. Platform selection no longer affects notes visibility**
1. Change feature's platforms from `[Web App, Native]` to `[Web App]`.
2. Verify: the unified note still shows ALL sections (Native section still visible because it's just text).

**E5. Refs resolve in unified note**
1. Type `(table_name)` in the migrated note.
2. Verify: ref resolves, deps auto-populate.

**E6. Legacy column read-only**
1. Query `_splan_features` directly: legacy columns still populated with pre-migration values.
2. Save a change via app UI.
3. Verify: change goes to `_splan_entity_notes`, NOT legacy columns.

### 7.7 Acceptance

- E1–E6 pass.
- `PLATFORM_NOTE_SECTIONS` constant deleted.
- Features expanded-row uses one unified Notes editor.
- References panel (legacy) gone; Dependencies panel visible instead.
- Migration idempotent and lossless (content preserved; formatting ranges lost — documented).

### 7.8 Rollback

- Migration is idempotent and keeps source columns intact. Rollback = revert UI changes to restore the `PLATFORM_NOTE_SECTIONS` rendering. Data is safe.

---

## 8. Phase D — 5-minute idle auto-analyze (secondary deliverable)

**Goal**: after a note has been idle (no edits) for ≥5 minutes, automatically fire Claude analysis on the Dependencies for that note. Saves user from clicking Analyze Now every time.

**This phase is explicitly secondary**: the user has confirmed willingness to ship without it. Implement after A+B+C+E are stable.

### 8.1 Headless agent mode (blocker — D7)

New endpoint `POST /api/agents/launch-headless`:
```typescript
// body: { prompt: string, runId?: string }
// Writes prompt to temp file.
// Spawns claude CLI via child_process.spawn (NOT exec with PowerShell window).
// Detaches, pipes stdout+stderr to a log file in AGENT_RESULTS_DIR.
// Returns { runId } immediately; does NOT block on completion.
// Separate polling endpoint (existing GET /api/agents/results/:runId) returns result when ready.
```

Existing `/api/agents/launch` (PowerShell window variant) stays unchanged for interactive use.

### 8.2 Scheduler

Boot-time `setInterval` in `server/index.ts`:
```typescript
const AUTO_ANALYZE_INTERVAL_MS = 60_000;  // check every minute
const IDLE_THRESHOLD_MS = 5 * 60_000;      // 5 min

setInterval(async () => {
  if (!AUTO_ANALYZE_ENABLED) return;  // setting
  if (runningAnalyses.size > 0) return; // concurrency guard — max 1 at a time

  const db = getDb();
  const cutoff = new Date(Date.now() - IDLE_THRESHOLD_MS).toISOString().replace('T',' ').substring(0,19);
  const dirty = db.prepare(`
    SELECT entity_type, entity_id, note_key
    FROM _splan_entity_notes
    WHERE updated_at < ?
      AND (last_analyzed_at IS NULL OR last_analyzed_at < updated_at)
    LIMIT 1
  `).get(cutoff) as {entity_type: string, entity_id: number, note_key: string} | undefined;

  if (!dirty) return;

  runningAnalyses.add(dirty);
  try {
    await analyzeDepencenciesHeadless(dirty.entity_type, dirty.entity_id, dirty.note_key);
  } catch (e) {
    console.error('Auto-analyze failed:', e);
  } finally {
    runningAnalyses.delete(dirty);
  }
}, AUTO_ANALYZE_INTERVAL_MS);
```

### 8.3 Settings

New user setting: `autoAnalyzeEnabled: boolean` (default off; user opts in via settings tab). Stored in `AGENT_CONFIG_FILE` alongside other agent config.

### 8.4 Kill switch

Env var `SPLAN_AUTO_ANALYZE=0` disables the scheduler regardless of setting. Safety net for runaway Claude CLI spawns.

### 8.5 Cost/rate controls

- Max 1 concurrent analysis.
- Skip note if content-hash unchanged since last analyze (idempotency via `last_analyzed_at` + content hash stored in `_splan_entity_notes`).
- Hard cap: no more than N analyses per day (setting, default 50).

### 8.6 Change-log tagging

Auto-analyze writes get `reasoning='auto-analyze'`. Sync-diff viewer filters these from the default view (opt-in toggle to show auto-analyze churn).

### 8.7 Test plan

**D1. Scheduler fires after 5 min idle**
1. Edit a note at t=0.
2. Observe server logs at t=5m+: scheduler logs `Auto-analyzing {entityType} {entityId} {noteKey}`.
3. Verify: `last_analyzed_at` stamped.

**D2. Scheduler skips active edits**
1. Edit a note at t=0, continue editing at t=4m.
2. Observe: no auto-analyze at t=5m (because most recent edit was t=4m, not yet 5m idle).
3. Stop editing. At t=9m: scheduler fires.

**D3. Kill switch**
1. Set `SPLAN_AUTO_ANALYZE=0`.
2. Restart server.
3. Edit note, wait 10 min.
4. Verify: no auto-analyze runs.

**D4. Concurrency**
1. With 5 dirty notes, observe: only 1 analysis runs at a time.

**D5. Rate cap**
1. Set daily cap to 3, fire 5 analyses.
2. Verify: 4th and 5th skipped with log message "Daily auto-analyze cap reached".

### 8.8 Acceptance

- D1–D5 pass.
- Auto-analyze opt-in via setting.
- Headless mode produces no PowerShell windows.
- Sync-diff viewer filters auto-analyze entries by default.

### 8.9 Rollback

- Remove `setInterval` block.
- Keep `/api/agents/launch-headless` (useful regardless).

---

## 9. Cross-phase concerns

### 9.1 CLAUDE.md updates

After Phase E lands, update `CLAUDE.md`:
- Add `_splan_entity_notes` and `_splan_entity_dependencies` under "Key Tables".
- Update "Gotchas": remove the `PLATFORM_NOTE_SECTIONS` reference; add "Rich notes live in `_splan_entity_notes`, NOT on the entity table — don't add new columns for notes content."
- Document the auto-pairing behavior for custom Notes columns.

### 9.2 Change-log granularity

All phases respect user's D8 rule:
- One change-log entry per (entity, column, save). Not per keystroke, not per individual dep change.
- Auto-analyze writes tagged `reasoning='auto-analyze'`.
- Formatting-only edits ARE logged (user chose this earlier).

### 9.3 Sync diff handling

- `_splan_entity_notes` and `_splan_entity_dependencies` get included in sync push/pull.
- Per-record, per-column granularity in diff viewer. One note = one diff entry regardless of content-line count.
- Auto-analyze entries hidden from default sync-diff view.
- Add both new tables to the safety-threshold scan (warn if > 100 rows would be wiped).

### 9.4 Performance

- Note editor debounce: existing 2s timer in `FeatureMentionField` unchanged.
- Dependencies batch fetch: one `GET /api/schema-planner/dependencies?entityType={X}` per tab load (same pattern as notes cache).
- Dependencies cache invalidation: on any `POST`/`PUT`/`DELETE` to deps endpoints, re-fetch for the affected entity.
- Auto-extract runs server-side on each note save. For 1000-char note with 20 refs, extraction + upsert should complete in <50ms. Profile if noticeable.

### 9.5 Security

- Claude CLI runs locally only (`requireLocal` middleware).
- Prompt file written to OS temp dir; NOT committed to git (add `%TEMP%\splan-agents\` implicit exclusion).
- Never include PAT, secrets, or user PII in prompt. (Current prompt template doesn't — enforced by reviewing template before shipping.)

### 9.6 Testing infrastructure

Vitest setup already exists (`tests/setup.ts`). Each phase adds integration tests:
- Phase B: deps CRUD, auto-extract on note save, cascade delete.
- Phase C: prompt template rendering, JSON parsing, user-edit reconciliation.
- Phase E: migration idempotency, content preservation.
- Phase D: scheduler tick logic (mock time via `vi.useFakeTimers()`).

---

## 10. Out of scope

The following came up in discussion but are **explicitly deferred** to a later PRD or backlog:

- **Cross-entity dependency roll-up on Modules** (showing union of child features' deps). Phase B scope is per-entity only.
- **Manual additions to Dependencies that aren't in notes** (`auto_added=0` rows). Schema supports it, but the "+ Add manual dep" UI button is out of scope for Phase B. Future.
- **Dropping legacy columns** (`ALTER TABLE _splan_features DROP COLUMN notes`). Safety net; wait one release after Phase E.
- **Deprecating plain textareas that are record content** (feedback.notes, data_reviews.notes, etc.). Per D1, those are NOT notes — they're the record's primary content.
- **Dependency-snapshot export** (`GET /api/schema-planner/dependencies/snapshot?entityType&entityId`). Useful for pasting into Claude Code sessions; nice-to-have, not critical.
- **Reverse dep navigation UI** (from Tables/Fields: "who depends on me?"). Schema supports the query (idx_entity_deps_by_ref); UI surface is future.

---

## 11. Execution order & recommended commits

Each phase should land as its own commit (or small commit series) with the message prefix `[NOTES-DEPS-{A|B|C|E|D}]` for traceability.

1. **A.1** Smoke test + bug fixes. Commit: `[NOTES-DEPS-A] Verify Phase 1 notes; fix rendering edge cases`.
2. **B.1** SQL table + server endpoints. Commit: `[NOTES-DEPS-B] Add _splan_entity_dependencies + CRUD endpoints`.
3. **B.2** Auto-extract on note save + auto-pair on column creation. Commit: `[NOTES-DEPS-B] Wire auto-extract into note save + auto-pair column creation`.
4. **B.3** UI: deps panel + cache + grid cell badge. Commit: `[NOTES-DEPS-B] Dependencies side panel UI`.
5. **B.4** Tests + smoke test. Commit: `[NOTES-DEPS-B] Tests + smoke verification`.
6. **C.1** Prompt template + analyze endpoint. Commit: `[NOTES-DEPS-C] Claude analyzer endpoint + prompt template`.
7. **C.2** Analyze Now button + UI integration. Commit: `[NOTES-DEPS-C] Wire Analyze Now button + result polling`.
8. **C.3** User-edit reconciliation + tests. Commit: `[NOTES-DEPS-C] User-edit reconciliation + tests`.
9. **E.1** Features notes migration. Commit: `[NOTES-DEPS-E] Migrate Features platform-notes to shared store`.
10. **E.2** Remove PLATFORM_NOTE_SECTIONS + expanded-row refactor. Commit: `[NOTES-DEPS-E] Remove legacy Features notes rendering`.
11. **E.3** Update CLAUDE.md + tests. Commit: `[NOTES-DEPS-E] Update docs + tests`.
12. **(Secondary) D.1** Headless agent mode. Commit: `[NOTES-DEPS-D] Add /api/agents/launch-headless`.
13. **(Secondary) D.2** Scheduler + settings + kill switch. Commit: `[NOTES-DEPS-D] 5-min idle auto-analyze scheduler`.

---

## 12. Pre-existing state snapshot (for fresh session)

**As of 2026-04-17 after Phase A audit + BUG-A4 fix**, the following changes exist **uncommitted** in the working tree:

### 12.1 Phase 1 plumbing (landed in a prior session, uncommitted)

- `server/db.ts`: `_splan_entity_notes` table definition + idempotent Concepts backfill block.
- `server/index.ts`:
  - `/api/schema-planner/notes` — GET (single + batch-by-entity + batch-by-type), PUT (upsert + change-log), DELETE (single + entity-wide)
  - Cascade-delete hook in generic entity DELETE handler
  - `/api/column-defs` POST: skip `ALTER TABLE` for `columnType='notes'`
  - `/api/column-defs/:id` DELETE: cascade-clean `_splan_entity_notes` rows when a custom Notes column is removed
  - Display-template `typeToTemplate` map: `'notes': 'Count Badge'`
- `src/lib/api.ts`: `EntityNote` type + `fetchEntityNote`, `fetchEntityNotes`, `fetchEntityNotesByType`, `saveEntityNote`, `deleteEntityNote`
- `src/components/schema-planner/types.ts`: `ColDef.type` union includes `"notes"`
- `src/components/schema-planner/SchemaPlannerTab.tsx`:
  - State `fullscreenNote: {row, tabKey, noteKey}` (replaces Concepts-only `fullscreenConceptNote`)
  - State `entityNotesCache: Record<string, EntityNote>` with `noteCacheKey(type, id, key)` helper
  - Batch-fetch `useEffect` on subTab change (`fetchEntityNotesByType`)
  - Cell renderer cases `"note-fullscreen" | "notes"` unified
  - Click-handler wrapper routes both types to generalized overlay
  - Generalized fullscreen overlay block (replaces Concepts-specific one) — reads from cache, saves via `saveEntityNote`, shows Images gallery only when `tabKey === "concepts"`
  - Add Column type-picker includes "Notes" button (purple styling)
  - Create-button UX: inline "Enter a name to create" hint + `cursor: not-allowed` when disabled

### 12.2 Phase A fixes (this session, uncommitted)

- **BUG-A4 client guard** — `SchemaPlannerTab.tsx` click-handler wrapper adds `isUnsaved = !eid || eid <= 0` check; unsaved rows show disabled styling + tooltip "Save this row first before adding notes"
- **BUG-A4 server guards** — `server/index.ts` GET/PUT/DELETE `/api/schema-planner/notes` reject `entityId <= 0` with 400

### 12.3 Other (unrelated to this PRD)

- `M src/components/schema-planner/NotebookTab.tsx` (unrelated work)
- `M src/pages/SchemaPlanner.tsx` (unrelated work)
- `?? src/components/schema-planner/SyncDiffViewer.tsx` (unrelated work from a different session)

### 12.4 Recommended action for fresh session

**Commit the Phase 1 + Phase A work first** to establish a clean baseline before starting Phase B. Suggested commit message:

```
[NOTES-DEPS-A] Phase 1 plumbing + BUG-A4 unsaved-row guard

Phase 1 (shared notes store):
- Add _splan_entity_notes table with Concepts backfill
- Add /api/schema-planner/notes endpoints (GET/PUT/DELETE)
- Add cascade-delete for notes on entity delete + column delete
- Add 'notes' column type to ColDef union + Add Column picker
- Generalize fullscreen overlay from Concepts-only to all tabs
- Add EntityNote client API + entity-notes cache
- UX fix: inline hint for disabled Create button

Phase A (audit):
- Fix BUG-A4: block Notes click on unsaved rows (tempId<0) to
  prevent orphan _splan_entity_notes rows. Client guards the
  click; server rejects negative entityId defensively.

PRD: docs/prds/NOTES-DEPENDENCIES-PRD.md
```

Leave unrelated files (NotebookTab, SchemaPlanner page, SyncDiffViewer) to their owners — don't bundle them into this commit.

---

## 13. Definition of done (entire PRD)

- All phases A, B, C, E shipped and passing smoke tests.
- Phase D shipped OR explicitly deferred with issue filed.
- `CLAUDE.md` updated to reflect new dependency-aware notes model.
- No regression in existing Schema Planner features (Concepts notes, Modules nesting, Features expanded-row, sync).
- All new tables (`_splan_entity_dependencies`) included in sync push/pull with safety-threshold guard.
- User can: create a custom Notes column, type refs in it, see a Dependencies count badge + side panel, click Analyze Now, see Claude-written explanations, dismiss stale deps. For Concepts and Features, same behavior on their unified Notes columns.

