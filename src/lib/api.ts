const BASE = '/api';

// ─── Generic CRUD helpers ─────────────────────────────────────────────────────

export async function fetchTable(tableName: string): Promise<unknown[]> {
  const res = await fetch(`${BASE}/schema-planner?table=${encodeURIComponent(tableName)}`);
  if (!res.ok) throw new Error(`fetchTable failed: ${res.statusText}`);
  return res.json();
}

export async function createRow(
  table: string,
  data: Record<string, unknown>,
  reasoning?: string
): Promise<unknown> {
  const res = await fetch(`${BASE}/schema-planner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, data, reasoning }),
  });
  if (!res.ok) throw new Error(`createRow failed: ${res.statusText}`);
  return res.json();
}

export async function updateRow(
  table: string,
  id: number,
  data: Record<string, unknown>,
  reasoning?: string
): Promise<unknown> {
  const res = await fetch(`${BASE}/schema-planner`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, id, data, reasoning }),
  });
  if (!res.ok) throw new Error(`updateRow failed: ${res.statusText}`);
  return res.json();
}

export async function deleteRow(
  table: string,
  id: number,
  reasoning?: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/schema-planner`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table, id, reasoning }),
  });
  if (!res.ok) throw new Error(`deleteRow failed: ${res.statusText}`);
  return res.json();
}

// ─── Specialized endpoints ────────────────────────────────────────────────────

export async function fetchCounts(): Promise<Record<string, number>> {
  const res = await fetch(`${BASE}/schema-planner/counts`);
  if (!res.ok) throw new Error(`fetchCounts failed: ${res.statusText}`);
  return res.json();
}

export type ClaudeMdStats = { lines: number; bytes: number; mtime: number; path: string };

export async function fetchClaudeMdStats(): Promise<ClaudeMdStats> {
  const res = await fetch(`${BASE}/claude-md-stats`);
  if (!res.ok) throw new Error(`fetchClaudeMdStats failed: ${res.statusText}`);
  return res.json();
}

export async function fetchMatrix(): Promise<unknown[]> {
  const res = await fetch(`${BASE}/schema-planner/matrix`);
  if (!res.ok) throw new Error(`fetchMatrix failed: ${res.statusText}`);
  return res.json();
}

export async function fetchFeatureImpact(featureId: number): Promise<unknown> {
  const res = await fetch(`${BASE}/schema-planner/feature-impact?featureId=${featureId}`);
  if (!res.ok) throw new Error(`fetchFeatureImpact failed: ${res.statusText}`);
  return res.json();
}

export async function uploadImage(featureId: number, file: File, entityType?: string): Promise<{ url: string }> {
  const form = new FormData();
  form.append('image', file);
  form.append('entityId', String(featureId));
  form.append('entityType', entityType || 'features');
  const res = await fetch(`${BASE}/schema-planner/upload-image`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`uploadImage failed: ${res.statusText}`);
  return res.json();
}

// ─── Projects / GitHub routes ────────────────────────────────────────────────

export async function fetchGithubSync(projectId?: number): Promise<{ synced: number; errors: string[]; rateLimitRemaining: number | null }> {
  const res = await fetch(`${BASE}/projects/github-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  if (!res.ok) throw new Error(`fetchGithubSync failed: ${res.statusText}`);
  return res.json();
}

export async function fetchDependencyTests(changeId: number): Promise<{
  dependencies: Array<{ type: string; id: number; name: string }>;
  testCases: Array<{ source: string; sourceId: number; sourceName: string; testId: number; testName: string; status: string }>;
}> {
  const res = await fetch(`${BASE}/projects/dependency-tests?changeId=${changeId}`);
  if (!res.ok) throw new Error(`fetchDependencyTests failed: ${res.statusText}`);
  return res.json();
}

// ─── Discussion routes ────────────────────────────────────────────────────────

export async function fetchDiscussions(entityType: string, entityId: number): Promise<unknown[]> {
  const res = await fetch(`${BASE}/discussions?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`);
  if (!res.ok) throw new Error(`fetchDiscussions failed: ${res.statusText}`);
  return res.json();
}

export async function createDiscussion(data: {
  entityType: string;
  entityId: number;
  title: string;
  content: string;
  source?: string;
}): Promise<unknown> {
  const res = await fetch(`${BASE}/discussions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createDiscussion failed: ${res.statusText}`);
  return res.json();
}

export async function updateDiscussion(
  id: number,
  data: { title?: string; content?: string }
): Promise<unknown> {
  const res = await fetch(`${BASE}/discussions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateDiscussion failed: ${res.statusText}`);
  return res.json();
}

export async function deleteDiscussion(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/discussions/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`deleteDiscussion failed: ${res.statusText}`);
  return res.json();
}

// ─── Display Templates ──────────────────────────────────────────────────────

export interface DisplayTemplate {
  id: number;
  templateName: string;
  displayMode: 'text' | 'pill' | 'chip' | 'tag';
  fontSize: number | null;
  fontBold: boolean;
  fontUnderline: boolean;
  fontColor: string | null;
  alignment: 'left' | 'center' | 'right';
  wrap: boolean;
  lines: number;
  colorMapping: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnTemplateAssignment {
  id: number;
  entityType: string;
  columnKey: string;
  templateId: number;
}

export async function fetchDisplayTemplates(): Promise<DisplayTemplate[]> {
  const res = await fetch(`${BASE}/display-templates`);
  if (!res.ok) throw new Error(`fetchDisplayTemplates failed: ${res.statusText}`);
  return res.json();
}

export async function createDisplayTemplate(data: Partial<Omit<DisplayTemplate, 'id' | 'createdAt' | 'updatedAt'>>): Promise<DisplayTemplate> {
  const res = await fetch(`${BASE}/display-templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `createDisplayTemplate failed: ${res.statusText}`);
  }
  return res.json();
}

export async function updateDisplayTemplate(id: number, data: Partial<Omit<DisplayTemplate, 'id' | 'createdAt' | 'updatedAt'>>): Promise<DisplayTemplate> {
  const res = await fetch(`${BASE}/display-templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateDisplayTemplate failed: ${res.statusText}`);
  return res.json();
}

export async function deleteDisplayTemplate(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/display-templates/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`deleteDisplayTemplate failed: ${res.statusText}`);
  return res.json();
}

export async function fetchColumnTemplateAssignments(): Promise<ColumnTemplateAssignment[]> {
  const res = await fetch(`${BASE}/column-template-assignments`);
  if (!res.ok) throw new Error(`fetchColumnTemplateAssignments failed: ${res.statusText}`);
  return res.json();
}

export async function assignColumnTemplate(entityType: string, columnKey: string, templateId: number): Promise<ColumnTemplateAssignment> {
  const res = await fetch(`${BASE}/column-template-assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType, columnKey, templateId }),
  });
  if (!res.ok) throw new Error(`assignColumnTemplate failed: ${res.statusText}`);
  return res.json();
}

export async function removeColumnTemplateAssignment(entityType: string, columnKey: string): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/column-template-assignments/${encodeURIComponent(entityType)}/${encodeURIComponent(columnKey)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`removeColumnTemplateAssignment failed: ${res.statusText}`);
  return res.json();
}

export async function seedDisplayTemplates(
  columns: Array<{ entityType: string; columnKey: string; columnType: string }>
): Promise<{ seeded: boolean; templates?: number; assignments?: number; message?: string }> {
  const res = await fetch(`${BASE}/display-templates/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columns }),
  });
  if (!res.ok) throw new Error(`seedDisplayTemplates failed: ${res.statusText}`);
  return res.json();
}

// ─── Column Definitions (user-added columns) ────────────────────────────────

export interface ColumnDef {
  id: number;
  entityType: string;
  columnKey: string;
  label: string;
  columnType: string;
  options: string[];
  formula: string;
  sortOrder: number;
  createdAt: string;
}

export async function fetchColumnDefs(): Promise<ColumnDef[]> {
  const res = await fetch(`${BASE}/column-defs`);
  if (!res.ok) throw new Error(`fetchColumnDefs failed: ${res.statusText}`);
  return res.json();
}

export async function createColumnDef(data: {
  entityType: string;
  columnKey: string;
  label: string;
  columnType: string;
  options?: string[];
  formula?: string;
}): Promise<ColumnDef> {
  const res = await fetch(`${BASE}/column-defs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `createColumnDef failed: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteColumnDef(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/column-defs/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`deleteColumnDef failed: ${res.statusText}`);
  return res.json();
}

// ─── Entity Notes (shared rich-notes store) ─────────────────────────────────

export interface EntityNote {
  id: number;
  entityType: string;
  entityId: number;
  noteKey: string;
  content: string | null;
  notesFmt: unknown[];
  collapsedSections: Record<string, unknown>;
  embeddedTables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export async function fetchEntityNote(
  entityType: string,
  entityId: number,
  noteKey: string
): Promise<EntityNote | null> {
  const url = `${BASE}/schema-planner/notes?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}&noteKey=${encodeURIComponent(noteKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchEntityNote failed: ${res.statusText}`);
  return res.json();
}

export async function fetchEntityNotes(
  entityType: string,
  entityId: number
): Promise<EntityNote[]> {
  const url = `${BASE}/schema-planner/notes?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchEntityNotes failed: ${res.statusText}`);
  return res.json();
}

export async function fetchEntityNotesByType(entityType: string): Promise<EntityNote[]> {
  const url = `${BASE}/schema-planner/notes?entityType=${encodeURIComponent(entityType)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchEntityNotesByType failed: ${res.statusText}`);
  return res.json();
}

export async function saveEntityNote(data: {
  entityType: string;
  entityId: number;
  noteKey?: string;
  content: string | null;
  notesFmt?: unknown;
  collapsedSections?: unknown;
  embeddedTables?: unknown;
  reasoning?: string;
}): Promise<EntityNote> {
  const res = await fetch(`${BASE}/schema-planner/notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`saveEntityNote failed: ${res.statusText}`);
  return res.json();
}

export async function deleteEntityNote(
  entityType: string,
  entityId: number,
  noteKey?: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/schema-planner/notes`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType, entityId, noteKey }),
  });
  if (!res.ok) throw new Error(`deleteEntityNote failed: ${res.statusText}`);
  return res.json();
}

// ─── Entity Dependencies (paired with entity notes) ─────────────────────────

export type DependencyRefType = 'Table' | 'Field' | 'Module' | 'Feature' | 'Concept' | 'Research' | 'Image';

export interface DependencyEntry {
  id: number;
  entityType: string;
  entityId: number;
  noteKey: string;
  refType: DependencyRefType;
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

export async function fetchDependenciesByType(entityType: string): Promise<DependencyEntry[]> {
  const url = `${BASE}/schema-planner/dependencies?entityType=${encodeURIComponent(entityType)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchDependenciesByType failed: ${res.statusText}`);
  return res.json();
}

export async function fetchDependencies(
  entityType: string,
  entityId: number,
  noteKey?: string
): Promise<DependencyEntry[]> {
  const q = new URLSearchParams({ entityType, entityId: String(entityId) });
  if (noteKey) q.set('noteKey', noteKey);
  const res = await fetch(`${BASE}/schema-planner/dependencies?${q.toString()}`);
  if (!res.ok) throw new Error(`fetchDependencies failed: ${res.statusText}`);
  return res.json();
}

export async function fetchDependenciesForRef(refType: string, refId: string): Promise<DependencyEntry[]> {
  const q = new URLSearchParams({ refType, refId });
  const res = await fetch(`${BASE}/schema-planner/dependencies?${q.toString()}`);
  if (!res.ok) throw new Error(`fetchDependenciesForRef failed: ${res.statusText}`);
  return res.json();
}

export async function createDependency(data: {
  entityType: string;
  entityId: number;
  noteKey: string;
  refType: DependencyRefType;
  refId: string;
  refName?: string | null;
  explanation?: string;
}): Promise<DependencyEntry> {
  const res = await fetch(`${BASE}/schema-planner/dependencies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `createDependency failed: ${res.statusText}`);
  }
  return res.json();
}

export async function updateDependency(
  id: number,
  patch: { explanation?: string; isStale?: boolean; autoAdded?: boolean }
): Promise<DependencyEntry> {
  const res = await fetch(`${BASE}/schema-planner/dependencies/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateDependency failed: ${res.statusText}`);
  return res.json();
}

export async function deleteDependency(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/schema-planner/dependencies/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`deleteDependency failed: ${res.statusText}`);
  return res.json();
}

export async function analyzeDependencies(
  entityType: string,
  entityId: number,
  noteKey: string
): Promise<{ analyzed: number; dependencies: DependencyEntry[] }> {
  const res = await fetch(`${BASE}/schema-planner/dependencies/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType, entityId, noteKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `analyzeDependencies failed: ${res.statusText}`);
  }
  return res.json();
}

// ─── Data Sync ──────────────────────────────────────────────────────────────

export interface SyncStatus {
  configured: boolean;
  error?: string;
  remoteUrl?: string;
  lastSync?: { syncedAt: string; direction: string; rowsSynced: number } | null;
  remote?: { changeCount: number; changes: Array<{ entity_type: string; entity_id: number; action: string; field_changed?: string; changed_at: string }> };
  local?: { changeCount: number; changes: Array<{ entity_type: string; entity_id: number; action: string; field_changed?: string; changed_at: string }> };
  schema?: { match: boolean; missingOnRemote: string[]; missingOnLocal: string[] } | null;
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch(`${BASE}/sync/remote-status`);
  if (res.status === 404) return { configured: false, error: 'Sync not available in production' };
  if (!res.ok) throw new Error(`fetchSyncStatus failed: ${res.statusText}`);
  return res.json();
}

export async function syncPush(opts?: { force?: boolean; source?: string; commitHash?: string }): Promise<{ success: boolean; totalRows: number; error?: string; conflict?: boolean; remoteChangeCount?: number; attemptId?: string }> {
  const params = new URLSearchParams();
  if (opts?.force) params.set('force', 'true');
  if (opts?.source) params.set('source', opts.source);
  if (opts?.commitHash) params.set('commitHash', opts.commitHash);
  const qs = params.toString();
  const url = qs ? `${BASE}/sync/push?${qs}` : `${BASE}/sync/push`;
  const res = await fetch(url, { method: 'POST' });
  return res.json();
}

export async function syncPull(opts?: { force?: boolean; source?: string }): Promise<{ success: boolean; totalRows: number; error?: string; conflict?: boolean; localChangeCount?: number; attemptId?: string }> {
  const params = new URLSearchParams();
  if (opts?.force) params.set('force', 'true');
  if (opts?.source) params.set('source', opts.source);
  const qs = params.toString();
  const url = qs ? `${BASE}/sync/pull?${qs}` : `${BASE}/sync/pull`;
  const res = await fetch(url, { method: 'POST' });
  return res.json();
}

// F3: most-recent sync attempt (success or failure)
export interface LastSyncAttempt {
  id: string;
  direction: 'push' | 'pull';
  source: string;
  success: boolean;
  rowsSynced: number | null;
  errorMessage: string | null;
  attemptedAt: string;
}

export async function fetchLastSyncAttempt(): Promise<LastSyncAttempt | null> {
  const res = await fetch(`${BASE}/sync/last-attempt`);
  if (!res.ok) return null;
  const json = await res.json() as { attempt: LastSyncAttempt | null };
  return json.attempt;
}

// Most recent deploy attempt (success, timeout, or failure). Derived from rows
// in _splan_sync_meta where source starts with 'deploy-push'.
export interface LastDeploy {
  id: string;
  status: 'success' | 'timeout' | 'failed';
  commitHash: string | null;
  rowsSynced: number | null;
  errorMessage: string | null;
  attemptedAt: string;
}

export async function fetchLastDeploy(): Promise<{ deploy: LastDeploy | null; repoUrl: string | null }> {
  const res = await fetch(`${BASE}/sync/last-deploy`);
  if (!res.ok) return { deploy: null, repoUrl: null };
  return res.json();
}

// Local git state — populated on local instance, 404 on hosted
export interface LocalGitStatus {
  commitsAhead: number;
  dirty: boolean;
  headCommit: string | null;
}

export async function fetchLocalGitStatus(): Promise<LocalGitStatus | null> {
  const res = await fetch(`${BASE}/sync/local-git-status`);
  if (!res.ok) return null;
  return res.json();
}

// ─── Sync diff ───────────────────────────────────────────────────────────────

export interface SyncDiffChange {
  field: string;
  local: string;
  remote: string;
  fieldConflict: boolean;
}

export interface SyncDiffEdit {
  id: string | number;
  name: string;
  recordConflict: boolean;
  changes: SyncDiffChange[];
}

export interface SyncDiffSideRecord {
  id: string | number;
  name: string;
  side: 'local' | 'remote';
}

export interface SyncDiffTable {
  tableName: string;
  label: string;
  idCol: string;
  nameCol: string | null;
  edits: SyncDiffEdit[];
  added: SyncDiffSideRecord[];
  deleted: SyncDiffSideRecord[];
}

export interface SyncDiff {
  hasConflict: boolean;
  tables: SyncDiffTable[];
  error?: string;
}

export async function fetchSyncDiff(): Promise<SyncDiff> {
  const res = await fetch(`${BASE}/sync/diff`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    return { hasConflict: false, tables: [], error: err.error || res.statusText };
  }
  return res.json();
}

export async function deployCode(message?: string): Promise<{ success: boolean; status: string; message: string; commitHash?: string; filesChanged?: number; error?: string; detail?: string }> {
  const res = await fetch(`${BASE}/sync/deploy-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return res.json();
}

export async function pullCode(): Promise<{ success: boolean; status: string; message?: string; filesChanged?: number; error?: string }> {
  const res = await fetch(`${BASE}/sync/pull-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}

// ─── App mode (local vs hosted) ──────────────────────────────────────────────

export type AppMode = 'local' | 'hosted';

export interface AppConfig {
  mode: AppMode;
}

export async function fetchAppConfig(): Promise<AppConfig> {
  const res = await fetch(`${BASE}/config`);
  if (!res.ok) throw new Error(`fetchAppConfig failed: ${res.statusText}`);
  return res.json();
}

export async function fetchVersion(baseUrl?: string): Promise<{ commit: string | null }> {
  const url = baseUrl ? `${baseUrl}/api/version` : `${BASE}/version`;
  try {
    const res = await fetch(url, { credentials: baseUrl ? 'omit' : 'same-origin' });
    if (!res.ok) return { commit: null };
    return res.json();
  } catch { return { commit: null }; }
}
