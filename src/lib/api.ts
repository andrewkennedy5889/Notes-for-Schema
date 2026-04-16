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
