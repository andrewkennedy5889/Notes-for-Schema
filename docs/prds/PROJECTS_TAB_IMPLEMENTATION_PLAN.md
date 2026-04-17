# Projects Tab — Full Implementation Plan

## Your Requirements

### R1. Projects Tab (Sidebar)
A completely separate tab in the sidebar for Projects. Position it above the Core group (modules/features/concepts) so projects are the first thing visible.

### R2. Project Structure
Each project has:
- A name and description
- An associated GitHub repository (owner/repo format)
- Exactly 3 branches: **Live**, **Primary Dev**, **Secondary Dev**
- Branch names default to `main`, `develop`, `feature` but are customizable per project
- Expected scale: 1-7 projects

### R3. Code Change Records
Each branch has a table of code change records with these fields:
- **Code Change Name** (text)
- **Time Created** (auto, readonly)
- **Time Modified** (auto, readonly)
- **Change Type** (enum: Prototype, Git Push, Working Through, Data Change) — manually selected
- **Project** (FK to project — implicit from context)
- **Implementation Prompt** (textarea, /ap format — varies by change type)
- **Execution Results** (textarea — filled by slash command)
- **File Locations** (text — clickable to open prototype in separate browser window)
- **Dependencies** (multi-entity FK — connects to modules, features, concepts, data tables, data fields)
- **Failed Tests** (list of test failures)
- **Failure Explanations** (textarea — likely explanations + potential conflicts)
- **Implementation Group Number** (integer — auto-increment per project + branch)
- **Calculated Context Column** (computed — aggregates all info needed for Claude Code execution, click to copy)

### R4. GitHub Integration
- Connect each project to a GitHub repo via a Personal Access Token (PAT)
- PAT managed in the Settings page
- Poll GitHub API on page load to auto-populate "Git Push" code change records
- Auto-populated fields: change_name (commit message), created_at (commit timestamp), file_locations (changed files list), commit hash + URL
- Change type must be manually selected (defaults to "Git Push" for auto-populated records)

### R5. Test Case Verification Flow
- Test cases already exist for features (`_splan_feature_tests`), concepts (`_splan_concept_tests`), and modules (`_splan_module_tests`)
- All test cases associated with a code change record's dependencies should be verified **before** commitment and **after** commitment
- A slash command orchestrates this: gather dependency test cases, run verification, implement, then run tests again
- The calculated context column provides the necessary info to execute this in Claude Code

### R6. Retry Button / Prompt Popup
- Each code change record has a "Retry" button
- Clicking it opens a popup with a pre-formatted prompt containing:
  - Original /ap-style implementation description
  - Execution results
  - "Please fix: [user enters feedback here]"
- The prompt is displayed in a popup for the user to copy and paste into Claude Code
- The implementation_prompt format varies by change type (Prototype, Working Through, Git Push, Data Change)

### R7. Implementation Grouping
- One implementation attempt may produce multiple code change records
- `implementation_group` integer auto-increments per project + branch
- Groups related code change records visually

### R8. Relationship to Existing Data
- Features, modules, and concepts connect to projects **indirectly** through code change record dependencies (0-many)
- They can indirectly belong to multiple projects through different code change records
- Projects exist independently from the rest of the schema planner

### R9. Cross-References on Existing Tables
- Data tables and data fields should show a column indicating which projects reference them (via code change dependencies)

### R10. Settings Page — GitHub PAT
- Add a GitHub Personal Access Token input field to the Settings page
- Stored in localStorage (never written to DB change_log)
- Per-project PAT override is also possible (stored on the project record)

### R11. Slash Command for Commit Verification
- A Claude Code slash command (skill file) that:
  1. Reads a code change record's dependencies
  2. Gathers all test cases for those dependencies (from feature_tests, concept_tests, module_tests)
  3. Verifies tests pass before commitment
  4. Executes the commit
  5. Verifies tests pass after commitment
  6. Fills in the Execution Results, Dependencies, and calculated context columns in the Schema Planner code change record

---

## Additional Requirements Identified

These are things you'll need that weren't explicitly stated but are required for the above to work correctly:

### A1. Server-Side GitHub API Proxy
GitHub API calls must go through the Express server (not directly from browser). Reasons:
- Keeps the PAT out of browser network logs
- Avoids CORS issues with GitHub API
- Allows the server to track last-synced commit SHA per branch to avoid duplicates

### A2. Last-Synced SHA Tracking
The `_splan_projects` table needs columns to track the last-synced commit SHA for each branch (`last_synced_sha_live`, `last_synced_sha_primary`, `last_synced_sha_secondary`). Without these, every page load would re-import all commits.

### A3. Multi-Entity Dependency Picker Component
The existing `multi-fk` ColDef type only picks from a single table. The Dependencies field needs to pick from 5 entity types simultaneously (modules, features, concepts, data_tables, data_fields). This requires a new UI component: a multi-entity picker with type tabs or grouped sections.

### A4. GitHub Commit Detail Fetching
Getting the list of changed files for a commit requires a separate GitHub API call per commit (`GET /repos/{owner}/{repo}/commits/{sha}`). For large syncs (many new commits), this has rate limit implications (5000 req/hr for PATs). The sync route must check `X-RateLimit-Remaining` and bail gracefully if low.

### A5. Change Log Integration
Project and code change CRUD operations should be tracked in `_splan_change_log`. This happens automatically via TABLE_MAP registration, but the change_log should exclude PAT values (never log `github_pat` field changes).

### A6. Selected Project Persistence
The currently selected project should be remembered across page refreshes via localStorage, so users don't have to re-select their project every time they visit the tab.

### A7. Prototype File Serving
For "Prototype" change type records, `file_locations` should point to files under the existing `/prototypes` static route (`server/index.ts:19`). Clicking a prototype file should open `http://localhost:5173/prototypes/{path}` in a new browser tab.

### A8. Constants Registration
Both new tables (`projects`, `code_changes`) need entries in:
- `TABLE_CONFIGS` (for column metadata if ever shown in generic grid)
- `TAB_DEPS` (projects tab needs modules, features, concepts, data_tables, data_fields loaded for the dependency picker)
- `TAB_INVALIDATES` (when code_changes are saved, data_tables/data_fields may need to update their cross-ref columns)

### A9. Commands Panel Update
The Commands panel in SchemaPlanner.tsx should list the new `/commit-verify` slash command so users know it exists.

---

## Implementation Plan

### Phase 1: Database & Server Foundation
**Goal**: Create tables, register in API, add GitHub sync route

#### 1.1 Create `_splan_projects` table
**File**: `server/db.ts` — add to `initSchema()` after `_splan_prototypes` block

```sql
CREATE TABLE IF NOT EXISTS _splan_projects (
  project_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name            TEXT    NOT NULL,
  description             TEXT,
  github_repo             TEXT,
  github_pat              TEXT,
  branch_live_name        TEXT NOT NULL DEFAULT 'main',
  branch_primary_name     TEXT NOT NULL DEFAULT 'develop',
  branch_secondary_name   TEXT NOT NULL DEFAULT 'feature',
  last_synced_sha_live    TEXT,
  last_synced_sha_primary TEXT,
  last_synced_sha_secondary TEXT,
  status                  TEXT NOT NULL DEFAULT 'active',
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 1.2 Create `_splan_code_changes` table
**File**: `server/db.ts` — add after `_splan_projects`

```sql
CREATE TABLE IF NOT EXISTS _splan_code_changes (
  change_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id             INTEGER NOT NULL REFERENCES _splan_projects(project_id) ON DELETE CASCADE,
  branch                 TEXT    NOT NULL DEFAULT 'primary_dev',
  change_name            TEXT    NOT NULL,
  change_type            TEXT    NOT NULL DEFAULT 'Working Through',
  implementation_prompt  TEXT,
  execution_results      TEXT,
  file_locations         TEXT,
  dependencies           TEXT    NOT NULL DEFAULT '[]',
  failed_tests           TEXT    NOT NULL DEFAULT '[]',
  failure_explanations   TEXT,
  implementation_group   INTEGER,
  github_commit_hash     TEXT,
  github_commit_url      TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 1.3 Register in TABLE_MAP
**File**: `server/index.ts` — add to TABLE_MAP

```typescript
'_splan_projects':     { sqlTable: '_splan_projects',     idCol: 'project_id', idKey: 'projectId', entityType: 'project' },
'_splan_code_changes': { sqlTable: '_splan_code_changes', idCol: 'change_id',  idKey: 'changeId',  entityType: 'code_change' },
```

#### 1.4 Register JSON columns
**File**: `server/utils.ts` — add to `JSON_COLUMNS` set

```typescript
'failed_tests',
```

Note: `dependencies` is already in `JSON_COLUMNS`.

#### 1.5 Add implementation_group auto-increment
**File**: `server/index.ts` — in POST handler, before INSERT

Special-case: when creating a `_splan_code_changes` row, query `MAX(implementation_group)` for the same `project_id` + `branch` and assign `max + 1`.

#### 1.6 Exclude github_pat from change_log
**File**: `server/index.ts` — in PUT handler, skip logging changes to `github_pat` field

#### 1.7 Add GitHub sync route
**File**: `server/index.ts` — new route: `POST /api/projects/github-sync`

Logic:
1. Accept `projectId` in body (optional — omit to sync all active projects)
2. For each project with a `github_repo`:
   - Resolve PAT: project's `github_pat` ?? global PAT from `x-github-pat` header
   - For each branch (live, primary_dev, secondary_dev):
     - Map branch type to actual branch name from project record
     - Fetch `GET https://api.github.com/repos/{owner}/{repo}/commits?sha={branchName}&per_page=30`
     - Filter to commits newer than `last_synced_sha_{branch}`
     - For each new commit:
       - Fetch `GET https://api.github.com/repos/{owner}/{repo}/commits/{sha}` for file list
       - INSERT code change record with change_type='Git Push'
     - Update project's `last_synced_sha_{branch}` column
3. Check `X-RateLimit-Remaining` header, bail if < 50
4. Return `{ synced: number, errors: string[], rateLimitRemaining: number }`

#### 1.8 Add dependency summary route
**File**: `server/index.ts` — new route: `GET /api/projects/dependency-tests`

Logic:
1. Accept `changeId` query param
2. Read the code change's `dependencies` JSON array
3. For each dependency `{type, id}`:
   - Look up the entity name from its table
   - Gather all associated test cases from the appropriate tests table
4. Return `{ dependencies: [...], testCases: [...] }`

---

### Phase 2: Frontend Navigation & Routing
**Goal**: Make the Projects tab appear in the sidebar and route correctly

#### 2.1 Add to sidebar navigation
**File**: `src/pages/SchemaPlanner.tsx`

- Add `projects: "📁"` to `TAB_ICONS` (line 54)
- Add `{ label: "Projects", tabs: ["projects"] }` as the **first** entry in `TAB_GROUPS` (line 74), before "Core"
- Add `"projects"` to `ALL_VALID_TABS` (line 142)

#### 2.2 Add to SchemaPlannerTab routing
**File**: `src/components/schema-planner/SchemaPlannerTab.tsx`

- Add `"projects"` to the tab validation list (line ~298)
- Add `subTab === "projects"` to `isSpecialTab` (line 2981)
- Add render guard: `{subTab === "projects" && <ProjectsGrid ... />}` after the prototypes block (line ~3123)
- Add data loading: in the `useEffect` for tab switching (line ~1069), add a `subTab === "projects"` case that loads `["projects", "code_changes", ...TAB_DEPS.projects]`

#### 2.3 Add TABLE_CONFIGS entries
**File**: `src/components/schema-planner/constants.ts`

Add `projects` and `code_changes` to `TABLE_CONFIGS`, `TAB_DEPS`, `TAB_INVALIDATES`.

---

### Phase 3: Core ProjectsGrid Component
**Goal**: Build the main UI — project selector + 3 branch tables

#### 3.1 Create ProjectsGrid.tsx
**File**: `src/components/schema-planner/ProjectsGrid.tsx` (NEW)

Structure:
```
ProjectsGrid
  |- Project selector (dropdown at top)
  |- Project detail bar (repo, status, branch names)
  |- Sync GitHub button + status indicator
  |- Branch section: Live
  |    |- Code change records table (inline editable)
  |    |- [+ Add Change] button
  |- Branch section: Primary Dev
  |    |- Code change records table
  |    |- [+ Add Change] button
  |- Branch section: Secondary Dev
       |- Code change records table
       |- [+ Add Change] button
```

Props (from SchemaPlannerTab):
- `allModules`, `allFeatures`, `allConcepts`, `allDataTables`, `allDataFields` — for dependency name resolution

State:
- `projects: Project[]`
- `selectedProjectId: number | null` (persisted to localStorage)
- `changes: CodeChange[]` (filtered by selectedProjectId)
- `editingCell: { changeId: number; field: string } | null`
- `syncing: boolean`, `syncStatus: string | null`
- `retryTarget: CodeChange | null` (opens RetryPromptPopup)
- `addingChange: { branch: string } | null`
- `deleteTarget: CodeChange | null`

Per-branch table columns:
1. `#` (implementation_group — readonly, auto-set)
2. Change Name (inline text edit)
3. Type (pill dropdown: Prototype / Git Push / Working Through / Data Change)
4. Implementation Prompt (truncated textarea, click to expand)
5. Execution Results (truncated textarea, click to expand)
6. File Locations (text, clickable link for Prototype type)
7. Dependencies (badge list with multi-entity picker popup)
8. Failed Tests (tag list)
9. Failure Explanations (truncated text)
10. Context (calculated, click to copy)
11. Commit (shown for Git Push only — hash linked to GitHub URL)
12. Created (readonly timestamp)
13. Retry (button)
14. Delete (button)

#### 3.2 Project CRUD
Within ProjectsGrid:
- "New Project" button → inline form or modal for project creation
- Edit project name/repo/branches inline
- Delete project with confirmation

#### 3.3 Code Change CRUD
- "Add Change" per branch → inline new row
- Inline cell editing (same pattern as PrototypesGrid)
- Delete with reasoning modal

---

### Phase 4: Multi-Entity Dependency Picker
**Goal**: Build the UI for selecting dependencies from 5 entity types

#### 4.1 Create DependencyPicker component
Can be a section within ProjectsGrid or a separate small component.

- Opens as a popup/popover when clicking the Dependencies cell
- Tabs or grouped sections: Modules | Features | Concepts | Data Tables | Data Fields
- Each section shows a searchable checkbox list of entities
- Selected items stored as `[{type: "feature", id: 5}, {type: "module", id: 2}, ...]`
- Display as colored badges: "Feature: Login" / "Module: Auth" / etc.

---

### Phase 5: Retry Prompt Popup
**Goal**: Build the prompt assembly and display popup

#### 5.1 Create RetryPromptPopup.tsx
**File**: `src/components/schema-planner/RetryPromptPopup.tsx` (NEW)

Props:
- `change: CodeChange`
- `project: Project`
- `resolvedDependencies: { type, id, name }[]`
- `onClose: () => void`

Prompt format (assembled from code change record):
```
/ap [change_name]

## Context
Project: [project_name] | Branch: [branch_display_name] | Group: #[implementation_group]
Files: [file_locations, newline-separated]

## What Was Attempted
[implementation_prompt]

## Results
[execution_results]

## Failed Tests
[failed_tests, bulleted]

## Likely Issues
[failure_explanations]

## Dependencies
- Module: [name]
- Feature: [name]
- Data Table: [name]

## Feedback
Please fix: [EDITABLE AREA — user types here]
```

UI:
- `<pre>` block with the assembled prompt (read-only)
- Editable "Please fix:" textarea at the bottom
- "Copy to Clipboard" button
- "Close" button

---

### Phase 6: GitHub Sync UI
**Goal**: Wire the sync button and show sync status

#### 6.1 Sync button in ProjectsGrid header
- "Sync GitHub" button next to project selector
- Shows spinner while syncing
- Shows result toast: "Synced 3 new commits" or "Error: Invalid PAT"
- Auto-triggers on component mount if project has a `github_repo`

#### 6.2 Sync status display
- Rate limit remaining shown as a small indicator
- Last sync time shown per project
- Errors displayed as a dismissible banner

---

### Phase 7: Settings Page — GitHub PAT
**Goal**: Add PAT management to Settings

#### 7.1 Add GitHub Integration section
**File**: `src/pages/SchemaPlanner.tsx` — after the "Reference Appearance" section (line ~467)

- `<h3>GitHub Integration</h3>`
- Description text explaining what the PAT is for
- Password input with show/hide toggle
- "Test Connection" button (optional — calls GitHub API `/user` endpoint)
- Stored in `localStorage` under `splan_github_pat`

#### 7.2 Add state management
- `const [githubPat, setGithubPat] = useState(() => localStorage.getItem('splan_github_pat') ?? '')`
- Save to localStorage on change

---

### Phase 8: Cross-References on Data Tables & Data Fields
**Goal**: Show which projects reference each data table/field

#### 8.1 Add computed "Projects" column to data_tables config
**File**: `src/components/schema-planner/constants.ts` — add column to `data_tables.columns`

This would be a new `"ref-projects"` column type that queries code_change dependencies to find which projects reference this table.

#### 8.2 Add computed "Projects" column to data_fields config
Same pattern as 8.1 for data_fields.

#### 8.3 Implement rendering
**File**: `src/components/schema-planner/SchemaPlannerTab.tsx` — add `ref-projects` rendering case in `renderCell`

Display as a list of project names with links to the Projects tab.

---

### Phase 9: Calculated Context Column
**Goal**: Assemble commit context for Claude Code

#### 9.1 Implement computed column in ProjectsGrid
The "Context" column is not stored in DB — it's computed client-side from:
- Implementation group number
- Branch display name
- File locations
- Resolved dependency names and their test case count
- Implementation prompt summary

Rendered as a truncated preview. Click to copy full context to clipboard.

The format should be designed to paste directly into Claude Code as input for the /commit-verify slash command.

---

### Phase 10: Slash Command — /commit-verify
**Goal**: Create a Claude Code skill for test verification and commit workflow

#### 10.1 Create skill file
**File**: `C:\Users\murde\.claude\skills\commit-verify\SKILL.md` (NEW)

The skill should:
1. Accept a code change record ID or implementation group number
2. Query the Schema Planner API to get the code change record(s) and their dependencies
3. Query test cases for all dependencies via `/api/projects/dependency-tests`
4. Present the test verification checklist
5. Execute the implementation
6. Re-run test verification
7. Update the code change record with execution results via PUT to the API

#### 10.2 Update Commands panel
**File**: `src/pages/SchemaPlanner.tsx` — add to COMMAND_GROUPS

```typescript
{ cmd: "/commit-verify", desc: "Verify tests, commit, and verify again" },
```

---

### Phase 11: Implementation Prompt Format Templates
**Goal**: Different /ap templates per change type

#### 11.1 Define templates in ProjectsGrid
Each change type gets a slightly different implementation_prompt template:

**Prototype:**
```
## Understanding
Quick UI mockup / backend endpoint prototype for: [description]

## Implementation Plan
- Create prototype at: [file_locations]
- Focus: [UI layout / API endpoint / data flow]

## Dependencies
[resolved dependency names]
```

**Working Through:**
```
## Understanding
Iterating on implementation: [description]

## Implementation Plan
[step-by-step approach]

## Files
[file_locations]

## Dependencies
[resolved dependency names]

## Previous Attempt
[execution_results from prior group records]
```

**Git Push:**
```
## Commit Summary
[change_name]

## Files Changed
[file_locations]

## Dependencies Affected
[resolved dependency names]
```

**Data Change:**
```
## Schema Change
[description of what data/schema changed]

## Affected Tables/Fields
[dependencies filtered to data_tables + data_fields]

## Impact
[which projects/features are affected]
```

---

## Files Summary

### New Files to Create
| # | File | Purpose |
|---|------|---------|
| 1 | `src/components/schema-planner/ProjectsGrid.tsx` | Main Projects tab component |
| 2 | `src/components/schema-planner/RetryPromptPopup.tsx` | Retry prompt assembly and display popup |
| 3 | `C:\Users\murde\.claude\skills\commit-verify\SKILL.md` | Slash command for test verification + commit |

### Existing Files to Modify
| # | File | Changes |
|---|------|---------|
| 1 | `server/db.ts` | Add `_splan_projects` and `_splan_code_changes` DDL |
| 2 | `server/index.ts` | Add TABLE_MAP entries, implementation_group auto-increment, github-sync route, dependency-tests route, PAT exclusion from change_log |
| 3 | `server/utils.ts` | Add `failed_tests` to JSON_COLUMNS |
| 4 | `src/components/schema-planner/constants.ts` | Add TABLE_CONFIGS (projects, code_changes), TAB_DEPS, TAB_INVALIDATES |
| 5 | `src/pages/SchemaPlanner.tsx` | Add TAB_ICONS, TAB_GROUPS (new "Projects" group first), ALL_VALID_TABS, GitHub PAT settings section, Commands panel update |
| 6 | `src/components/schema-planner/SchemaPlannerTab.tsx` | Add isSpecialTab for projects, render guard, data loading case, ProjectsGrid mount with props |
| 7 | `src/components/schema-planner/types.ts` | (Optional) Add Project and CodeChange interfaces if shared across files |
| 8 | `src/lib/api.ts` | Add fetchGithubSync and fetchDependencyTests helpers |

### Untouched but Relevant (Read-Only Reference)
| File | Why |
|------|-----|
| `src/components/schema-planner/PrototypesGrid.tsx` | Template pattern for special tab components |
| `src/components/schema-planner/FeatureTestsPopup.tsx` | Already supports concept_tests and module_tests — test case queries can reuse this |
| `server/utils.ts` (parseRow/prepareRow) | Handles serialization automatically — no changes needed beyond JSON_COLUMNS |

---

## Build Order (Recommended)

```
Phase 1  ──► Phase 2  ──► Phase 3  ──► Phase 4
(DB+API)     (Nav)        (Core UI)     (Dep Picker)
                              │
                              ▼
Phase 5  ──► Phase 6  ──► Phase 7
(Retry)      (GH Sync)    (Settings)
                              │
                              ▼
Phase 8  ──► Phase 9  ──► Phase 10 ──► Phase 11
(X-Refs)     (Context)    (Slash Cmd)   (Templates)
```

Phases 1-3 are the critical path. Phases 4-7 can be built in any order after Phase 3. Phases 8-11 are enhancements that build on the core.

---

## Risk Areas

1. **GitHub API Rate Limits**: With PAT auth, 5000 requests/hour. Each commit detail fetch is 1 call. A project with 100+ new commits since last sync would consume significant quota. Mitigation: track last-synced SHA, cap per-sync at 50 commits, show rate limit status.

2. **SchemaPlannerTab.tsx size**: Already ~6000 lines. Adding projects data loading adds more state. Mitigation: ProjectsGrid is self-contained (like PrototypesGrid), only the mounting point and data-pass-through touch SchemaPlannerTab.

3. **Multi-entity dependency picker**: No existing pattern for picking from 5 tables simultaneously. This is the most novel UI component. Mitigation: start with a simple grouped dropdown, refine to tabs later.

4. **Slash command reliability**: The /commit-verify command needs to call the Schema Planner API, which requires the dev server to be running. If the user runs the command outside of a Schema Planner session, it would fail. Mitigation: the command should check API availability first and error gracefully.

5. **PAT security**: Stored in localStorage (cleartext in browser storage) and in the projects table (cleartext in SQLite). Acceptable for a local-only dev tool, but worth noting. Never log PAT values to change_log.
