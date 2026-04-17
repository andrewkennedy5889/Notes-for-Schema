// Server-side port of the client's ref-extraction regex (src/components/schema-planner/text-utils.ts).
// Scope is intentionally narrow — only what the dependencies auto-extract needs.

export const REF_REGEX = /\(t:(\d+)(?::([^)]*))?\)|\(f:(\d+)(?::([^)]*))?\)|\(i:([a-zA-Z0-9_]+)(?::([^)]*))?\)|\(m:(\d+)(?::([^)]*))?\)|\(fe:(\d+)(?::([^)]*))?\)|\(c:(\d+)(?::([^)]*))?\)|\(r:(\d+)(?::([^)]*))?\)/g;

export type DependencyRefType = 'Table' | 'Field' | 'Module' | 'Feature' | 'Concept' | 'Research' | 'Image';

export interface DependencyRef {
  refType: DependencyRefType;
  refId: string;         // stored as TEXT — Image refs are UUIDs, others are numeric strings
  fallbackName: string | null;
}

/**
 * Extract every (t:ID)/(f:ID)/(m:ID)/(fe:ID)/(c:ID)/(r:ID)/(i:UUID) reference
 * from a piece of rich-notes text, deduplicated by (refType, refId).
 *
 * The capture-group layout MUST stay aligned with the client's REF_REGEX so the
 * two sides resolve identical refs.
 */
export function extractDependencyRefs(text: string | null | undefined): DependencyRef[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: DependencyRef[] = [];
  const re = new RegExp(REF_REGEX.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let refType: DependencyRefType;
    let refId: string;
    let fallbackName: string | null;
    if (m[1])       { refType = 'Table';    refId = m[1];  fallbackName = m[2]  ?? null; }
    else if (m[3])  { refType = 'Field';    refId = m[3];  fallbackName = m[4]  ?? null; }
    else if (m[5])  { refType = 'Image';    refId = m[5];  fallbackName = m[6]  ?? null; }
    else if (m[7])  { refType = 'Module';   refId = m[7];  fallbackName = m[8]  ?? null; }
    else if (m[9])  { refType = 'Feature';  refId = m[9];  fallbackName = m[10] ?? null; }
    else if (m[11]) { refType = 'Concept';  refId = m[11]; fallbackName = m[12] ?? null; }
    else if (m[13]) { refType = 'Research'; refId = m[13]; fallbackName = m[14] ?? null; }
    else continue;
    const key = `${refType}:${refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ refType, refId, fallbackName });
  }
  return out;
}
