# Schema Planner

A full-stack planning tool for database schema design, feature management, and project tracking. Config-driven generic CRUD grid renders 15+ entity types from a single component.

## Quick Start

```bash
npm run dev              # Express (port 3100) + Vite (port 5173) concurrently
npm run dev:server       # Express server only (tsx watch)
npm run dev:client       # Vite dev server only
npm run build            # Production build to dist/
npm test                 # Vitest (run once)
npm run test:watch       # Vitest (watch mode)
npm run seed             # Seed database with sample data
npm run mcp              # Start MCP server (stdio transport)
```

PowerShell shortcut: `.\start-with-claude.ps1` launches dev server minimized + Claude Code.

## Tech Stack

- **Frontend**: React 19 + TypeScript 6 + Vite 8 + Tailwind CSS 4 + React Router 7
- **Backend**: Express 5 + better-sqlite3 (WAL mode) + tsx (JIT TypeScript)
- **Testing**: Vitest (node environment, 15s timeout)
- **MCP**: @modelcontextprotocol/sdk for Claude tool integration
- **Icons**: Lucide React | **DnD**: @dnd-kit | **IDs**: uuid

## Key Conventions

### Naming
- **Database columns**: `snake_case` — **API/frontend**: `camelCase` — converted automatically via `parseRow()`/`prepareRow()` in `server/utils.ts`
- **Components**: `PascalCase.tsx` | **Utilities**: `kebab-case.ts` | **Constants**: `UPPER_SNAKE_CASE`
- **DB tables**: All prefixed `_splan_` (e.g., `_splan_features`)
- **Computed fields**: Prefixed `_` (e.g., `_testCount`) — not stored in DB

### State Management
- **URL params** (`useSearchParams`) for active tab, sub-tab, selected entity
- **localStorage** for user preferences (colors, icons, column visibility)
- **React hooks** for ephemeral component state — no Redux/Zustand

### Data Flow
1. Tab selection sets URL param → `SchemaPlannerTab` mounts with matching `TABLE_CONFIGS` entry
2. `fetchTable()` via `src/lib/api.ts` → Express returns rows
3. Inline edits → `updateRow()` → server logs change to `_splan_change_log`
4. JSON columns auto-parsed on read, auto-stringified on write

## Gotchas

- **Case conversion is invisible** — a camelCase field not in the conversion map silently drops. Verify new fields in both `parseRow` and `prepareRow`.
- **JSON columns must be registered** — unregistered JSON columns won't be parsed/stringified correctly.
- **TABLE_MAP.idKey must match exactly** — used in WHERE clauses; mismatches cause CRUD failures.
- **`_splan_all_tests` is read-only** — it's a UNION view; writes must route to `_splan_feature_tests`, `_splan_concept_tests`, or `_splan_module_tests`.
- **FK cascades** — deleting a module cascades to `_splan_module_use_fields`; deleting a table cascades to its fields.
- **GitHub PAT** stored server-side only in `.github-config.json` — never expose to client.

## Path Aliases

Both Vite and TypeScript resolve: `@` → `src/`, `@server` → `server/`
