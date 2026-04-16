# All Test Cases Tab — Implementation Plan

## Overview

Add a new **"Test Cases"** sidebar tab under the **Quality** section that shows a unified, cross-entity view of all test cases from `_splan_feature_tests`, `_splan_concept_tests`, and `_splan_module_tests` merged into one grid. Reuses the existing view system (grouping, sorting, filtering, column visibility) — no custom component needed.

---

## Architecture Decision: Virtual Table vs Custom Component

**Approach: Virtual unified table served by a new API endpoint.**

The existing generic grid in `SchemaPlannerTab` handles rendering, inline editing, grouping, sorting, filtering, and column visibility for any `TABLE_CONFIGS` entry. Rather than building a custom component, we add a **new API endpoint** that merges the three test tables and returns unified rows with `entityType` and `entityName` columns. The frontend treats it like any other CRUD tab.

This means the View button, grouping presets, column toggles, search bar, row height — all work automatically with zero new UI code.

---

## Step-by-Step Plan

### Step 1: New API endpoint — `GET /api/schema-planner?table=_splan_all_tests`

**File:** `server/index.ts`

Add a special-case handler that:
1. Queries all three test tables
2. Adds `entity_type` ("feature" | "concept" | "module") and resolves `entity_name` by joining to the parent table
3. Returns unified rows with a synthetic `test_id` (prefixed to avoid collisions, e.g., `f_42`, `c_7`, `m_3`) — OR just use the raw `test_id` since each table's IDs are independent and the `entityType` column disambiguates

**Columns returned per row:**
| Column | Source |
|--------|--------|
| `testId` | `test_id` from source table |
| `entityType` | "feature" / "concept" / "module" (computed) |
| `entityId` | `feature_id` / `concept_id` / `module_id` |
| `entityName` | Resolved from parent table join |
| `title` | `title` |
| `description` | `description` |
| `testType` | `test_type` |
| `status` | `status` |
| `generatedCode` | `generated_code` |
| `expectedResult` | `expected_result` |
| `sortOrder` | `sort_order` |
| `createdAt` | `created_at` |
| `updatedAt` | `updated_at` |

**For writes (POST/PUT/DELETE):** Route to the correct source table based on `entityType` field in the request body. The TABLE_MAP entry for `_splan_all_tests` will be read-only for GET; writes go through the existing `_splan_feature_tests` / `_splan_concept_tests` / `_splan_module_tests` endpoints.

### Step 2: Add `TABLE_CONFIGS.all_test_cases` entry

**File:** `src/components/schema-planner/constants.ts`

```typescript
all_test_cases: {
  label: "Test Cases",
  apiTable: "_splan_all_tests",
  idKey: "testId",
  nameKey: "title",
  entityType: "test",
  readOnly: true,  // CRUD goes through per-entity popups, not inline
  columns: [
    { key: "title", label: "Title", type: "text", tooltip: "Short test description" },
    { key: "description", label: "Description", type: "textarea", tooltip: "Detailed bulleted description" },
    { key: "testType", label: "Test Type", type: "enum", options: ["unit", "integration", "e2e", "acceptance"], tooltip: "Category of test" },
    { key: "status", label: "Status", type: "enum", options: ["draft", "ready", "passing", "failing", "skipped"], tooltip: "Current test status" },
    { key: "entityName", label: "Entity", type: "text", tooltip: "The feature, concept, or module this test belongs to" },
    { key: "entityType", label: "Entity Type", type: "enum", options: ["feature", "concept", "module"], tooltip: "Whether this is a feature, concept, or module test" },
    { key: "generatedCode", label: "Code", type: "textarea", hideInGrid: true, tooltip: "Test code to run" },
    { key: "expectedResult", label: "Expected Result", type: "textarea", hideInGrid: true, tooltip: "Expected outcome" },
    { key: "createdAt", label: "Created", type: "readonly", badge: "ref" },
    { key: "updatedAt", label: "Updated", type: "readonly", badge: "ref" },
  ],
},
```

### Step 3: Add to sidebar navigation

**File:** `src/pages/SchemaPlanner.tsx`

1. Add `"all_test_cases"` to the Quality group in `TAB_GROUPS`:
   ```typescript
   { label: "Quality", tabs: ["feature_concerns", "data_reviews", "access_matrix", "all_test_cases", "prototypes"] },
   ```

2. Add icon:
   ```typescript
   TAB_ICONS.all_test_cases = "🧪";  // or "✓" — pick an icon
   ```
   Note: Prototypes currently uses 🧪. We could use `📋` for test cases or `✅` to differentiate.

3. Add label override (since config label is "Test Cases" but sidebar may want different display):
   ```typescript
   TAB_LABELS.all_test_cases = "Test Cases";
   ```

### Step 4: Register in `SUB_TABS` and `TAB_DEPS`

**File:** `src/components/schema-planner/constants.ts`

1. Add `"all_test_cases"` to the `SUB_TABS` array (after `data_reviews` / before `access_matrix`, matching the sidebar order).

2. Add tab dependencies — the API endpoint resolves names server-side, so no FK deps needed on the client:
   ```typescript
   TAB_DEPS.all_test_cases = [];
   ```

### Step 5: Add PILL_COLORS for test types and statuses

**File:** `src/components/schema-planner/constants.ts`

Add the test type and status colors to `PILL_COLORS` so the enum columns render with proper colors:
```typescript
// Test types
unit: { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
integration: { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" },
e2e: { bg: "rgba(168,85,247,0.15)", text: "#a855f7", border: "rgba(168,85,247,0.3)" },
acceptance: { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" },

// Test statuses
ready: { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" },
passing: { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
failing: { bg: "rgba(224,85,85,0.15)", text: "#e05555", border: "rgba(224,85,85,0.3)" },
skipped: { bg: "rgba(102,102,128,0.15)", text: "#666680", border: "rgba(102,102,128,0.3)" },
```

Note: Some of these keys (`draft`, `passing`, etc.) may already exist in PILL_COLORS from other contexts — check for conflicts. If a key already exists with different colors, we may need a prefixed approach (e.g., `"test:passing"`) or accept the shared color.

### Step 6: Add virtual table entry to server TABLE_MAP

**File:** `server/index.ts`

Add a TABLE_MAP entry (needed for the GET handler to not reject the table name):
```typescript
'_splan_all_tests': { sqlTable: '_splan_all_tests', idCol: 'test_id', idKey: 'testId', entityType: 'test' },
```

Then add a special-case in the GET handler (before the generic query) that intercepts `_splan_all_tests` and runs the union query:

```sql
SELECT ft.*, 'feature' AS entity_type, f.feature_name AS entity_name
FROM _splan_feature_tests ft
LEFT JOIN _splan_features f ON f.feature_id = ft.feature_id

UNION ALL

SELECT ct.*, 'concept' AS entity_type, c.concept_name AS entity_name
FROM _splan_concept_tests ct
LEFT JOIN _splan_concepts c ON c.concept_id = ct.concept_id

UNION ALL

SELECT mt.*, 'module' AS entity_type, m.module_name AS entity_name
FROM _splan_module_tests mt
LEFT JOIN _splan_modules m ON m.module_id = mt.module_id

ORDER BY updated_at DESC
```

### Step 7: Default view preset for grouping by Entity Type

**File:** `server/db.ts` (in the seed section, ~line 298+)

Seed a default view preset for the `all_test_cases` tab that groups by Entity Type:
```json
{
  "groupingConfig": {
    "layers": [{
      "rules": [
        { "groupName": "Feature Tests", "logic": "AND", "conditions": [{ "column": "entityType", "operator": "equals", "value": "feature" }] },
        { "groupName": "Concept Tests", "logic": "AND", "conditions": [{ "column": "entityType", "operator": "equals", "value": "concept" }] },
        { "groupName": "Module Tests", "logic": "AND", "conditions": [{ "column": "entityType", "operator": "equals", "value": "module" }] }
      ],
      "ungroupedLabel": "Other"
    }],
    "ungroupedLabel": "Other"
  }
}
```

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `server/index.ts` | Add `_splan_all_tests` to TABLE_MAP, add special-case GET handler for union query |
| `server/db.ts` | Seed default view preset for `all_test_cases` tab |
| `src/components/schema-planner/constants.ts` | Add `TABLE_CONFIGS.all_test_cases`, add to `SUB_TABS`, add `TAB_DEPS`, add PILL_COLORS for test types/statuses |
| `src/pages/SchemaPlanner.tsx` | Add `"all_test_cases"` to `TAB_GROUPS` Quality section, add icon and label |

**No new React components needed.** The existing generic grid handles everything.

---

## What You Get Automatically (Zero Code)

- ✅ Search bar (filters by title/description/entityName)
- ✅ View button with grouping, sorting, column visibility, row height
- ✅ View presets (save/load)
- ✅ Column reordering and separators
- ✅ Pagination (Show 10/25/50/100/All)
- ✅ Enum pills with colors for testType and status
- ✅ Created/Updated timestamps
- ✅ Group-by any column (entity type, test type, status, etc.)

---

## What Won't Work (Read-Only Limitation)

Since this is a **union view** of three tables, inline editing is not straightforward — the grid wouldn't know which table to write to. The plan marks the tab as `readOnly: true`.

**To edit tests:** Users click through to the per-entity test popup (already built) from the Features/Concepts/Modules tabs. We could add a "clickable entity name" column that navigates to the parent entity's tab in a future iteration.

---

## Risks

- **PILL_COLORS key conflicts:** `draft`, `passing`, etc. may already exist with different colors from other contexts (e.g., concept status "draft"). Need to verify and either accept shared colors or prefix.
- **Union query performance:** With thousands of tests across three tables, the union + join could be slow. Unlikely at current scale but worth noting. Could add pagination to the SQL if needed.
- **Read-only constraint:** Users can't inline-edit from this view. This is intentional per the architecture but may feel limiting. Future: add write routing based on `entityType`.
