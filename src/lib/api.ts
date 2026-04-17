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

// ─── Data Sync ──────────────────────────────────────────────────────────────

export interface SyncStatus {
  configured: boolean;
  error?: string;
  remoteUrl?: string;
  lastSync?: { syncedAt: string; direction: string; rowsSynced: number } | null;
  remote?: { changeCount: number; changes: Array<{ entity_type: string; entity_id: number; action: string; field_changed?: string; changed_at: string }> };
  local?: { changeCount: number; changes: Array<{ entity_type: string; entity_id: number; action: string; field_changed?: string; changed_at: string }> };
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch(`${BASE}/sync/remote-status`);
  if (res.status === 404) return { configured: false, error: 'Sync not available in production' };
  if (!res.ok) throw new Error(`fetchSyncStatus failed: ${res.statusText}`);
  return res.json();
}

export async function syncPush(): Promise<{ success: boolean; totalRows: number; error?: string }> {
  const res = await fetch(`${BASE}/sync/push`, { method: 'POST' });
  return res.json();
}

export async function syncPull(): Promise<{ success: boolean; totalRows: number; error?: string }> {
  const res = await fetch(`${BASE}/sync/pull`, { method: 'POST' });
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
