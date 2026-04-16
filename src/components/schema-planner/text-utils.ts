import type { FeatureRefInfo, ExtractedRef } from "./types";

export const REF_REGEX = /\(t:(\d+)(?::([^)]*))?\)|\(f:(\d+)(?::([^)]*))?\)|\(i:([a-zA-Z0-9_]+)(?::([^)]*))?\)|\(m:(\d+)(?::([^)]*))?\)|\(fe:(\d+)(?::([^)]*))?\)|\(c:(\d+)(?::([^)]*))?\)|\(r:(\d+)(?::([^)]*))?\)/g;

/** Extract all (t:ID), (f:ID), (m:ID), (fe:ID), (c:ID), (r:ID) references from a text string */
export function extractRefs(text: string | null | undefined): { tableIds: number[]; fieldIds: number[]; imageIds: string[]; moduleIds: number[]; featureIds: number[]; conceptIds: number[]; researchIds: number[] } {
  const tableIds: number[] = [];
  const fieldIds: number[] = [];
  const imageIds: string[] = [];
  const moduleIds: number[] = [];
  const featureIds: number[] = [];
  const conceptIds: number[] = [];
  const researchIds: number[] = [];
  if (!text) return { tableIds, fieldIds, imageIds, moduleIds, featureIds, conceptIds, researchIds };
  const re = new RegExp(REF_REGEX.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) tableIds.push(Number(m[1]));       // group 1: table ID, group 2: table fallback name
    if (m[3]) fieldIds.push(Number(m[3]));       // group 3: field ID, group 4: field fallback name
    if (m[5]) imageIds.push(m[5]);               // group 5: image ID, group 6: image fallback title
    if (m[7]) moduleIds.push(Number(m[7]));      // group 7: module ID, group 8: module fallback name
    if (m[9]) featureIds.push(Number(m[9]));     // group 9: feature ID, group 10: feature fallback name
    if (m[11]) conceptIds.push(Number(m[11]));   // group 11: concept ID, group 12: concept fallback name
    if (m[13]) researchIds.push(Number(m[13]));  // group 13: research ID, group 14: research fallback name
  }
  return { tableIds, fieldIds, imageIds, moduleIds, featureIds, conceptIds, researchIds };
}

/** Convert raw DB tokens (t:ID)/(f:ID)/(i:imgId)/(m:ID)/(fe:ID)/(c:ID)/(r:ID) → display names */
export function rawToDisplay(
  text: string,
  tables: Array<{ id: number; name: string }>,
  fields: Array<{ id: number; name: string; tableId: number; tableName: string }>,
  images?: Array<{ id: string; title: string }>,
  modules?: Array<{ id: number; name: string }>,
  features?: Array<{ id: number; name: string }>,
  concepts?: Array<{ id: number; name: string }>,
  research?: Array<{ id: number; name: string }>,
): string {
  return text
    .replace(/\(t:(\d+)(?::([^)]*))?\)/g, (_, idStr, fallback) => {
      const t = tables.find((x) => x.id === Number(idStr));
      if (t) return `(${t.name})`;
      return fallback ? `(⚠${fallback})` : "(deleted)";
    })
    .replace(/\(f:(\d+)(?::([^)]*))?\)/g, (_, idStr, fallback) => {
      const f = fields.find((x) => x.id === Number(idStr));
      if (f) return `(${f.tableName}.${f.name})`;
      return fallback ? `(⚠${fallback})` : "(deleted)";
    })
    .replace(/\(i:([a-zA-Z0-9_]+)(?::([^)]*))?\)/g, (_, imgId, fallback) => {
      const img = images?.find((x) => x.id === imgId);
      if (img) return `(🎨 ${img.title})`;
      return fallback ? `(⚠🎨 ${fallback})` : "(deleted)";
    })
    .replace(/\(m:(\d+)(?::([^)]*))?\)/g, (_, idStr, fallback) => {
      const mod = modules?.find((x) => x.id === Number(idStr));
      if (mod) return `(💻 ${mod.name})`;
      return fallback ? `(⚠💻 ${fallback})` : "(deleted)";
    })
    .replace(/\(fe:(\d+)(?::([^)]*))?\)/g, (_, idStr, fallback) => {
      const feat = features?.find((x) => x.id === Number(idStr));
      if (feat) return `(⚡ ${feat.name})`;
      return fallback ? `(⚠⚡ ${fallback})` : "(deleted)";
    })
    .replace(/\(c:(\d+)(?::([^)]*))?\)/g, (_, idStr, fallback) => {
      const con = concepts?.find((x) => x.id === Number(idStr));
      if (con) return `(💡 ${con.name})`;
      return fallback ? `(⚠💡 ${fallback})` : "(deleted)";
    })
    .replace(/\(r:(\d+)(?::([^)]*))?\)/g, (_, idStr, fallback) => {
      const res = research?.find((x) => x.id === Number(idStr));
      if (res) return `(🔬 ${res.name})`;
      return fallback ? `(⚠🔬 ${fallback})` : "(deleted)";
    });
}

/** Convert display names → raw DB tokens (t:ID)/(f:ID)/(i:imgId)/(m:ID)/(fe:ID)/(c:ID)/(r:ID) */
export function displayToRaw(
  text: string,
  tables: Array<{ id: number; name: string }>,
  fields: Array<{ id: number; name: string; tableId: number; tableName: string }>,
  images?: Array<{ id: string; title: string }>,
  modules?: Array<{ id: number; name: string }>,
  features?: Array<{ id: number; name: string }>,
  concepts?: Array<{ id: number; name: string }>,
  research?: Array<{ id: number; name: string }>,
): string {
  // Replace image refs first — store title as fallback name
  if (images) {
    const sortedImages = [...images].sort((a, b) => b.title.length - a.title.length);
    for (const img of sortedImages) {
      const display = `(🎨 ${img.title})`;
      if (text.includes(display)) {
        text = text.split(display).join(`(i:${img.id}:${img.title})`);
      }
    }
  }
  // Also handle deleted image refs that show with ⚠ prefix — preserve them as-is
  text = text.replace(/\(⚠🎨 ([^)]+)\)/g, (match, title) => {
    const img = images?.find((i) => i.title === title);
    return img ? `(i:${img.id}:${img.title})` : match.replace("⚠🎨 ", "i:unknown:");
  });

  // Replace field refs (longer patterns: table.field) — store name as fallback
  const sortedFields = [...fields].sort((a, b) => `${b.tableName}.${b.name}`.length - `${a.tableName}.${a.name}`.length);
  let result = text;
  for (const f of sortedFields) {
    const display = `(${f.tableName}.${f.name})`;
    if (result.includes(display)) {
      result = result.split(display).join(`(f:${f.id}:${f.tableName}.${f.name})`);
    }
  }
  // Handle deleted field refs with ⚠ prefix — preserve fallback
  result = result.replace(/\(⚠([^)]+)\)/g, (match, name) => {
    // Check if it's a field (contains .)
    if (name.includes(".")) {
      const f = fields.find((fld) => `${fld.tableName}.${fld.name}` === name);
      return f ? `(f:${f.id}:${name})` : match;
    }
    // Check if it's a table
    const t = tables.find((tbl) => tbl.name === name);
    return t ? `(t:${t.id}:${name})` : match;
  });

  // Replace table refs — store name as fallback
  const sortedTables = [...tables].sort((a, b) => b.name.length - a.name.length);
  for (const t of sortedTables) {
    const display = `(${t.name})`;
    if (result.includes(display)) {
      result = result.split(display).join(`(t:${t.id}:${t.name})`);
    }
  }

  // Replace feature refs — (⚡ FeatureName) → (fe:ID:name)
  if (features) {
    const sortedFeatures = [...features].sort((a, b) => b.name.length - a.name.length);
    for (const feat of sortedFeatures) {
      const display = `(⚡ ${feat.name})`;
      if (result.includes(display)) {
        result = result.split(display).join(`(fe:${feat.id}:${feat.name})`);
      }
    }
  }

  // Replace module refs — (💻 ModuleName) → (m:ID:name)
  if (modules) {
    const sortedModules = [...modules].sort((a, b) => b.name.length - a.name.length);
    for (const mod of sortedModules) {
      const display = `(💻 ${mod.name})`;
      if (result.includes(display)) {
        result = result.split(display).join(`(m:${mod.id}:${mod.name})`);
      }
    }
  }

  // Replace concept refs — (💡 ConceptName) → (c:ID:name)
  if (concepts) {
    const sortedConcepts = [...concepts].sort((a, b) => b.name.length - a.name.length);
    for (const con of sortedConcepts) {
      const display = `(💡 ${con.name})`;
      if (result.includes(display)) {
        result = result.split(display).join(`(c:${con.id}:${con.name})`);
      }
    }
  }

  // Replace research refs — (🔬 ResearchTitle) → (r:ID:name)
  if (research) {
    const sortedResearch = [...research].sort((a, b) => b.name.length - a.name.length);
    for (const res of sortedResearch) {
      const display = `(🔬 ${res.name})`;
      if (result.includes(display)) {
        result = result.split(display).join(`(r:${res.id}:${res.name})`);
      }
    }
  }

  return result;
}

/** Convert text to snake_case */
export function toSnakeCase(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1_$2") // camelCase → camel_Case
    .replace(/[\s\-]+/g, "_") // spaces/hyphens → underscores
    .replace(/[^a-zA-Z0-9_]/g, "") // remove non-alphanumeric
    .replace(/_+/g, "_") // collapse multiple underscores
    .replace(/^_|_$/g, "") // trim leading/trailing underscores
    .toLowerCase();
}

/** Validate a field/table name against Supabase column naming rules */
export function validateFieldName(name: string): string | null {
  if (!name) return "Name is required";
  if (name.length < 2) return "Must be at least 2 characters";
  if (!/^[a-z]/.test(name)) return "Must start with a lowercase letter";
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return "Only lowercase letters, numbers, and underscores allowed";
  if (name.includes("__")) return "No consecutive underscores allowed";
  if (name.endsWith("_")) return "Cannot end with an underscore";
  return null;
}

/** Compute similarity score between two names using word stems + substring + character overlap */
export function nameSimilarity(a: string, b: string): number {
  const aWords = a.split("_").filter(Boolean);
  const bWords = b.split("_").filter(Boolean);
  // Shared word stems (highest weight) — includes 3+ char common prefix matching
  let sharedWords = 0;
  for (const aw of aWords) {
    for (const bw of bWords) {
      if (aw === bw || aw.startsWith(bw) || bw.startsWith(aw)) { sharedWords++; break; }
      // Common prefix of 3+ chars (catches "snake435" ↔ "snakefake")
      const minLen = Math.min(aw.length, bw.length);
      if (minLen >= 3) {
        let prefixLen = 0;
        for (let i = 0; i < minLen; i++) { if (aw[i] === bw[i]) prefixLen++; else break; }
        if (prefixLen >= 3) { sharedWords += prefixLen / Math.max(aw.length, bw.length); break; }
      }
    }
  }
  const wordScore = sharedWords / Math.max(aWords.length, bWords.length, 1);
  // Substring containment — full or partial (3+ char overlap)
  let subScore = 0;
  if (a.includes(b) || b.includes(a)) { subScore = 0.3; }
  else {
    // Check if either contains a 4+ char substring of the other
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    for (let len = Math.min(shorter.length, 8); len >= 4; len--) {
      let found = false;
      for (let i = 0; i <= shorter.length - len; i++) {
        if (longer.includes(shorter.slice(i, i + len))) { subScore = 0.15 + (len / shorter.length) * 0.15; found = true; break; }
      }
      if (found) break;
    }
  }
  // Character-level: common character ratio
  const maxLen = Math.max(a.length, b.length, 1);
  let common = 0;
  const bChars = b.split("");
  for (const c of a) { const idx = bChars.indexOf(c); if (idx >= 0) { common++; bChars.splice(idx, 1); } }
  const charScore = common / maxLen * 0.2;
  return wordScore + subScore + charScore;
}

/** Find the N most similar names from a list */
export function findSimilarNames(query: string, names: string[], limit: number): string[] {
  if (!query || query.length < 2) return [];
  return names
    .map((n) => ({ name: n, score: nameSimilarity(query, n) }))
    .filter((r) => r.score > 0.1 && r.name !== query)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.name);
}

/** Extract all (t:ID:name), (f:ID:name), (i:ID:name), (m:ID:name), (fe:ID:name), (c:ID:name), (r:ID:name) references from notes text, deduplicated with line numbers */
export function extractRefsFromNotes(
  notesSections: { key: string; label: string; text: string }[],
  resolveTableName: (id: number) => string | null,
  resolveFieldName: (id: number) => string | null,
  resolveModuleName?: (id: number) => string | null,
  resolveFeatureName?: (id: number) => string | null,
  resolveConceptName?: (id: number) => string | null,
  resolveResearchName?: (id: number) => string | null,
): ExtractedRef[] {
  const refMap = new Map<string, ExtractedRef>(); // key = "type:id"
  for (const sec of notesSections) {
    if (!sec.text) continue;
    const lines = sec.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const re = new RegExp(REF_REGEX.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(lines[i])) !== null) {
        let type: "Table" | "Field" | "Image" | "Module" | "Feature" | "Concept" | "Research";
        let id: number | string;
        let name: string;
        if (m[1]) {
          type = "Table"; id = Number(m[1]); name = m[2] || resolveTableName(id as number) || `#${id}`;
        } else if (m[3]) {
          type = "Field"; id = Number(m[3]); name = m[4] || resolveFieldName(id as number) || `#${id}`;
        } else if (m[7]) {
          type = "Module"; id = Number(m[7]); name = m[8] || resolveModuleName?.(id as number) || `#${id}`;
        } else if (m[9]) {
          type = "Feature"; id = Number(m[9]); name = m[10] || resolveFeatureName?.(id as number) || `#${id}`;
        } else if (m[11]) {
          type = "Concept"; id = Number(m[11]); name = m[12] || resolveConceptName?.(id as number) || `#${id}`;
        } else if (m[13]) {
          type = "Research"; id = Number(m[13]); name = m[14] || resolveResearchName?.(id as number) || `#${id}`;
        } else if (m[5]) {
          type = "Image"; id = m[5]; name = m[6] || String(id);
        } else continue;
        const key = `${type}:${id}`;
        const existing = refMap.get(key);
        if (existing) {
          if (!existing.lines.includes(lineNum)) existing.lines.push(lineNum);
        } else {
          refMap.set(key, { type, name, id, lines: [lineNum], source: sec.label });
        }
      }
    }
  }
  return Array.from(refMap.values());
}

export type FmtType = "bold" | "underline" | "dblunderline" | "strike" | "highlight" | "red" | "yellow" | "green";
export interface FmtRange { start: number; end: number; type: FmtType }

/** Build CSS for a set of active format types */
export function fmtStyle(types: Set<FmtType>): string {
  const parts: string[] = [];
  if (types.has("bold")) parts.push("text-shadow:0.3px 0 0 currentColor,-0.3px 0 0 currentColor,0 0.3px 0 currentColor");
  const decoLines: string[] = [];
  if (types.has("underline")) { decoLines.push("underline"); parts.push("text-decoration-thickness:2px"); }
  if (types.has("dblunderline")) decoLines.push("underline");
  if (types.has("strike")) decoLines.push("line-through");
  if (decoLines.length) {
    parts.push(`text-decoration-line:${decoLines.join(" ")}`);
    if (types.has("dblunderline")) parts.push("text-decoration-style:double");
    parts.push("text-underline-offset:2px");
  }
  if (types.has("highlight")) parts.push("background:#f2b66155;border-radius:2px;padding:0 1px");
  if (types.has("red")) parts.push("color:#e05555");
  else if (types.has("yellow")) parts.push("color:#f2b661");
  else if (types.has("green")) parts.push("color:#4ecb71");
  return parts.join(";");
}

/** Toggle a format type on the given selection range within a ranges array */
export function toggleFmtRange(ranges: FmtRange[], start: number, end: number, type: FmtType): FmtRange[] {
  if (start >= end) return ranges;

  // Check if this exact region is already fully covered by this format type
  const covering = ranges.filter((r) => r.type === type && r.start <= start && r.end >= end);
  if (covering.length > 0) {
    // Remove — punch a hole in covering ranges
    const result = ranges.filter((r) => !(r.type === type && r.start <= start && r.end >= end));
    for (const c of covering) {
      // Add back the parts outside the selection
      if (c.start < start) result.push({ start: c.start, end: start, type });
      if (c.end > end) result.push({ start: end, end: c.end, type });
    }
    return result;
  }

  // Add — merge with adjacent/overlapping ranges of same type
  let newStart = start;
  let newEnd = end;
  const result = ranges.filter((r) => {
    if (r.type !== type) return true;
    if (r.end < start || r.start > end) return true; // no overlap
    // Overlapping or adjacent — absorb into new range
    newStart = Math.min(newStart, r.start);
    newEnd = Math.max(newEnd, r.end);
    return false;
  });
  result.push({ start: newStart, end: newEnd, type });
  return result;
}

/** Clear all formatting from a range */
export function clearFmtRange(ranges: FmtRange[], start: number, end: number): FmtRange[] {
  if (start >= end) return ranges;
  const result: FmtRange[] = [];
  for (const r of ranges) {
    if (r.end <= start || r.start >= end) {
      result.push(r); // outside selection, keep
    } else {
      // Partially or fully overlapping — trim or split
      if (r.start < start) result.push({ start: r.start, end: start, type: r.type });
      if (r.end > end) result.push({ start: end, end: r.end, type: r.type });
    }
  }
  return result;
}

/** Adjust formatting ranges after text insertion/deletion */
export function adjustRangesForEdit(ranges: FmtRange[], editStart: number, oldLen: number, newLen: number): FmtRange[] {
  const delta = newLen - oldLen;
  if (delta === 0) return ranges;
  const editEnd = editStart + oldLen;

  return ranges.map((r) => {
    if (r.end <= editStart) return r; // before edit, unchanged
    if (r.start >= editEnd) return { ...r, start: r.start + delta, end: r.end + delta }; // after edit, shift
    // Overlapping — adjust end
    return {
      ...r,
      start: Math.min(r.start, editStart),
      end: Math.max(r.end + delta, editStart + newLen),
    };
  }).filter((r) => r.start < r.end); // remove collapsed ranges
}

/** Toggle bullet/number list prefix on selected lines */
export function toggleListPrefix(
  value: string,
  selStart: number,
  selEnd: number,
  type: "bullet" | "number",
): { newValue: string; newStart: number; newEnd: number; rangesDelta: Array<{ lineStart: number; oldLen: number; newLen: number }> } {
  const lineStart = value.lastIndexOf("\n", selStart - 1) + 1;
  const lineEnd = value.indexOf("\n", selEnd);
  const blockEnd = lineEnd === -1 ? value.length : lineEnd;
  const block = value.slice(lineStart, blockEnd);
  const lines = block.split("\n");

  const allHavePrefix = lines.every((l) =>
    type === "bullet" ? l.startsWith("- ") : /^\d+\. /.test(l)
  );

  const deltas: Array<{ lineStart: number; oldLen: number; newLen: number }> = [];
  let offset = lineStart;
  const newLines = lines.map((l, i) => {
    const oldLen = l.length;
    let newLine: string;
    if (allHavePrefix) {
      newLine = type === "bullet" ? l.slice(2) : l.replace(/^\d+\. /, "");
    } else {
      newLine = type === "bullet"
        ? (l.startsWith("- ") ? l : `- ${l}`)
        : (/^\d+\. /.test(l) ? l : `${i + 1}. ${l}`);
    }
    deltas.push({ lineStart: offset, oldLen, newLen: newLine.length });
    offset += oldLen + 1; // +1 for \n
    return newLine;
  });

  const newBlock = newLines.join("\n");
  return {
    newValue: value.slice(0, lineStart) + newBlock + value.slice(blockEnd),
    newStart: lineStart,
    newEnd: lineStart + newBlock.length,
    rangesDelta: deltas,
  };
}

export type { FeatureRefInfo, ExtractedRef };
