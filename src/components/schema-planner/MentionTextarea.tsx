

import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  FmtType,
  FmtRange,
  fmtStyle,
  toggleFmtRange,
  clearFmtRange,
  adjustRangesForEdit,
  toggleListPrefix,
  toSnakeCase,
} from "./text-utils";
import type { EmbeddedTable } from "./types";
import { TablePasteModal } from "./TablePasteModal";
import { InlineTableGrid } from "./InlineTableGrid";

interface MentionOption {
  type: "table" | "field" | "image" | "module" | "feature" | "concept" | "research";
  id: number;
  label: string;       // display name
  parentLabel?: string; // table name for fields, module names for features
  imageId?: string;     // string ID for images
}

type MentionType = "table" | "field" | "module" | "feature" | "image" | "concept" | "research";
const ALL_MENTION_TYPES = new Set<MentionType>(["table", "field", "module", "feature", "image", "concept", "research"]);

/** Escape HTML */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TABLE_COLORS = ["#5bc0de", "#a855f7", "#e67d4a", "#4ecb71", "#e05555", "#f2b661"];
const DEFAULT_DEPTH_COLORS = ["#f2b661", "#5bc0de", "#a855f7", "#4ecb71", "#e05555"];
function getDepthColors(): string[] {
  try { const s = localStorage.getItem("splan_depth_colors"); return s ? JSON.parse(s) : DEFAULT_DEPTH_COLORS; } catch { return DEFAULT_DEPTH_COLORS; }
}
function getDepthColor(depth: number): string {
  const colors = getDepthColors();
  return colors[(depth - 1) % colors.length] || DEFAULT_DEPTH_COLORS[0];
}

interface ParsedSection {
  headerKey: string;
  headerTitle: string;
  headerLineIdx: number;
  headerStart: number;
  headerEnd: number;
  bodyStart: number;
  bodyEnd: number;
  depth: number;
}

/**
 * Parse ## section headers and ---§ end markers from text.
 * Defined at module level so it's never stale (avoids useCallback/HMR caching issues).
 * Name matching pairs each ---§ marker to its header for correct nesting.
 */
function parseSections(text: string): ParsedSection[] {
  const lines = text.split("\n");
  const sections: ParsedSection[] = [];
  const endMarkers: Array<{ lineIdx: number; charOffset: number; name: string; lineLen: number }> = [];
  let charOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#{2,6}) /);
    if (headerMatch) {
      const depth = headerMatch[1].length - 1; // ## = 1, ### = 2, #### = 3, ##### = 4, ###### = 5
      const headerPrefix = headerMatch[0]; // "## ", "### ", etc.
      const headerTitle = line.slice(headerPrefix.length).replace(/ \[\d+ lines?\]$/, "");
      sections.push({
        headerKey: headerTitle.trim().toLowerCase(),
        headerTitle,
        headerLineIdx: i,
        headerStart: charOffset,
        headerEnd: charOffset + line.length,
        bodyStart: charOffset + line.length + 1, // +1 for newline
        bodyEnd: -1, // filled in next pass
        depth,
      });
    }
    // Track end markers: ---§ Name or bare ---§
    const endMatch = line.match(/^---§(?: (.+))?$/);
    if (endMatch) {
      endMarkers.push({ lineIdx: i, charOffset, name: (endMatch[1] || "").trim().toLowerCase(), lineLen: line.length });
    }
    charOffset += line.length + 1; // +1 for \n
  }

  // Pair end markers to sections — track which markers are consumed
  const usedMarkers = new Set<number>();

  // Pass 1: named matching (handles nesting correctly)
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    for (let j = 0; j < endMarkers.length; j++) {
      if (usedMarkers.has(j)) continue;
      const em = endMarkers[j];
      if (em.lineIdx <= sec.headerLineIdx) continue; // must be after header
      if (em.name && em.name === sec.headerKey) {
        // bodyEnd = end of the ---§ line (NOT including trailing \n — that stays as separator)
        sec.bodyEnd = em.charOffset + em.lineLen;
        usedMarkers.add(j);
        break;
      }
    }
  }

  // Pass 2: bare ---§ fallback — match to nearest unclosed section above (stack-based)
  for (let j = 0; j < endMarkers.length; j++) {
    if (usedMarkers.has(j)) continue;
    const em = endMarkers[j];
    if (em.name) continue; // named markers handled in pass 1
    // Find the closest section above this marker that has no bodyEnd yet
    let bestIdx = -1;
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].bodyEnd !== -1) continue; // already matched
      if (sections[i].headerLineIdx >= em.lineIdx) continue; // must be above marker
      // Check no deeper child between this section and the marker already claimed it
      bestIdx = i;
      break;
    }
    if (bestIdx >= 0) {
      sections[bestIdx].bodyEnd = em.charOffset + em.lineLen;
      usedMarkers.add(j);
    }
  }

  // Pass 3: fallback for sections with no end marker — next header of same/lesser depth, or end of text
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].bodyEnd !== -1) continue;
    let nextBoundary = text.length;
    for (let j = i + 1; j < sections.length; j++) {
      if (sections[j].depth <= sections[i].depth) {
        nextBoundary = sections[j].headerStart > 0 ? sections[j].headerStart - 1 : sections[j].headerStart;
        break;
      }
    }
    sections[i].bodyEnd = nextBoundary;
  }

  return sections;
}

/**
 * Build highlight HTML from clean text + format ranges.
 * No markers in text — styles come entirely from ranges.
 */
function buildHighlightHTML(
  text: string,
  ranges: FmtRange[],
  tableNames: Set<string>,
  fieldDisplayNames: Set<string>,
  imageDisplayNames?: Set<string>,
  collapsedKeys?: Set<string>,
  moduleDisplayNames?: Set<string>,
  featureDisplayNames?: Set<string>,
  tableTitles?: Map<string, string>,
  tableColorMap?: Map<string, string>,
  conceptDisplayNames?: Set<string>,
  researchDisplayNames?: Set<string>,
): string {
  if (!text) return "\n";

  // Build a list of boundary points where formatting changes
  const boundaries = new Set<number>();
  boundaries.add(0);
  boundaries.add(text.length);
  for (const r of ranges) {
    boundaries.add(Math.max(0, r.start));
    boundaries.add(Math.min(text.length, r.end));
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  let html = "";
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i];
    const segEnd = sorted[i + 1];
    const segment = text.slice(segStart, segEnd);
    if (!segment) continue;

    // Determine which formats are active for this segment
    const active = new Set<FmtType>();
    for (const r of ranges) {
      if (r.start <= segStart && r.end >= segEnd) active.add(r.type);
    }

    let escaped = esc(segment);

    // Color table/field/image references — add data attributes for hover previews
    escaped = escaped.replace(/\(([^()]+)\)/g, (match, inner) => {
      if (inner.startsWith("🎨 ") && imageDisplayNames?.has(inner.slice(3))) {
        const title = inner.slice(3);
        return `<span style="color:#4ecb71;pointer-events:auto;cursor:pointer" data-ref-type="image" data-ref-name="${esc(title)}">(${inner})</span>`;
      }
      if (fieldDisplayNames.has(inner)) {
        const tblName = inner.split(".")[0];
        return `<span style="color:#5bc0de;pointer-events:auto;cursor:pointer" data-ref-type="field" data-ref-name="${esc(inner)}">(${inner})</span>`;
      }
      if (tableNames.has(inner)) {
        return `<span style="color:#a855f7;pointer-events:auto;cursor:pointer" data-ref-type="table" data-ref-name="${esc(inner)}">(${inner})</span>`;
      }
      if (inner.startsWith("💻 ") && moduleDisplayNames?.has(inner.slice(3))) {
        const name = inner.slice(3);
        return `<span style="color:#e67d4a;pointer-events:auto;cursor:pointer" data-ref-type="module" data-ref-name="${esc(name)}">(${inner})</span>`;
      }
      if (inner.startsWith("⚡ ") && featureDisplayNames?.has(inner.slice(3))) {
        const name = inner.slice(3);
        return `<span style="color:#a855f7;pointer-events:auto;cursor:pointer" data-ref-type="feature" data-ref-name="${esc(name)}">(${inner})</span>`;
      }
      if (inner.startsWith("💡 ") && conceptDisplayNames?.has(inner.slice(3))) {
        const name = inner.slice(3);
        return `<span style="color:#f2b661;pointer-events:auto;cursor:pointer" data-ref-type="concept" data-ref-name="${esc(name)}">(${inner})</span>`;
      }
      if (inner.startsWith("🔬 ") && researchDisplayNames?.has(inner.slice(3))) {
        const name = inner.slice(3);
        return `<span style="color:#5bc0de;pointer-events:auto;cursor:pointer" data-ref-type="research" data-ref-name="${esc(name)}">(${inner})</span>`;
      }
      if (inner === "deleted") return `<span style="color:#e05555;text-decoration:line-through">(deleted)</span>`;
      // Deleted refs with last-known name: (⚠name) or (⚠🎨 title)
      if (inner.startsWith("⚠")) {
        const delName = inner.slice(1);
        return `<span style="color:#e05555;text-decoration:line-through">(${esc(delName)})</span>`;
      }
      return match;
    });

    const style = fmtStyle(active);
    html += style ? `<span style="${style}">${escaped}</span>` : escaped;
  }

  // Post-process: style ##–###### section header lines — hide hashes, bold underline title, muted line count badge
  if (collapsedKeys) {
    html = html.replace(/(^|\n)(#{2,6}) (.+)/g, (_match, prefix, hashes, rest) => {
      // Extract title (strip [N lines] indicator and HTML tags for key matching)
      const fullTitle = rest.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      const lineCountMatch = fullTitle.match(/ \[(\d+ lines?)\]$/);
      const cleanTitle = fullTitle.replace(/ \[\d+ lines?\]$/, "").replace(/<[^>]*>/g, "").trim();
      const key = cleanTitle.toLowerCase();
      const isCollapsed = collapsedKeys.has(key);
      const hashStr = hashes + " "; // e.g. "## ", "### ", etc.
      // Hide hash prefix visually but keep chars for cursor alignment
      const hiddenHash = `<span style="color:transparent;user-select:none">${hashStr}</span>`;
      // Indent title by depth: ## = 0px, ### = 16px, #### = 32px, etc.
      const depth = hashes.length - 1; // ## = 1, ### = 2, etc.
      const indent = (depth - 1) * 16;
      const indentStyle = indent > 0 ? `padding-left:${indent}px;` : "";
      // Title: bold, underlined, same font size as textarea for cursor alignment
      const titleHtml = rest.replace(/ \[\d+ lines?\]$/, "");
      const titleSpan = `<span style="font-weight:700;text-decoration:underline;text-underline-offset:3px;color:var(--color-text);${indentStyle}">${titleHtml}</span>`;
      // Line count: render inline at muted color (same chars as textarea, just styled differently)
      const countSpan = lineCountMatch
        ? `<span style="opacity:0.4;color:var(--color-text-muted)"> ${lineCountMatch[0].slice(1)}</span>`
        : "";
      return `${prefix}${hiddenHash}${titleSpan}${countSpan}`;
    });
  }

  // Render ---§ separator lines with section depth color
  // Pre-compute section key → depth for color lookup
  const sectionDepthMap = new Map<string, number>();
  for (const sec of parseSections(text)) {
    sectionDepthMap.set(sec.headerKey, sec.depth);
  }
  html = html.replace(/(^|\n)(---§(?: ([^\n]*))?)((?:\n|$))/g, (_match, prefix, fullMarker, markerName, suffix) => {
    let sectionName = (markerName || "").trim();
    // Fallback for bare ---§: walk upward to find nearest header
    if (!sectionName) {
      const before = html.slice(0, html.indexOf(fullMarker));
      const hdrMatch = before.match(/#{2,6} ([^\n]+?)(?:\s*\[\d+ lines?\])?\s*(?:\n|$)/g);
      if (hdrMatch) {
        const lastHdr = hdrMatch[hdrMatch.length - 1];
        const nameMatch = lastHdr.match(/#{2,6} (.+?)(?:\s*\[\d+ lines?\])?\s*$/);
        sectionName = nameMatch ? nameMatch[1].replace(/<[^>]*>/g, "").trim() : "";
      }
    }
    // Look up depth color for this section
    const sectionKey = sectionName.toLowerCase();
    const depth = sectionDepthMap.get(sectionKey) || 1;
    const markerColor = getDepthColor(depth);
    // Clean label: strip (...), [...], {...} from the title UNLESS it starts with one (table/field ref)
    if (sectionName && !/^[\(\[\{]/.test(sectionName)) {
      sectionName = sectionName.replace(/\s*[\(\[\{][^\)\]\}]*[\)\]\}]/g, "").trim();
    }
    // Keep raw chars transparent for cursor alignment, overlay visible label absolutely positioned
    const label = sectionName ? `--- ${esc(sectionName)} --- End ---§` : `---§`;
    const labelSpan = `<span style="position:absolute;left:0;top:0;color:${markerColor};white-space:nowrap;pointer-events:none">${label}</span>`;
    return `${prefix}<span style="color:transparent;position:relative">${esc(fullMarker)}${labelSpan}</span>${suffix}`;
  });

  // Post-process: render [TABLE:id] tokens as styled badges
  html = html.replace(/\[TABLE:([^\]]+)\]/g, (_match, id) => {
    const escapedId = esc(id);
    const title = tableTitles?.get(id) || escapedId;
    const barColor = tableColorMap?.get(id) || "#8899a6";
    return `<span style="display:inline;background:rgba(136,153,166,0.08);color:#8899a6;border-radius:3px;padding:1px 6px;border-left:9px solid ${barColor};pointer-events:auto;cursor:pointer" data-table-id="${escapedId}">📊 ${esc(title)}</span>`;
  });

  return html + "\n";
}

/**
 * MentionTextarea — range-based formatting + reference autocomplete.
 * Text is clean (no markers). Formatting is separate metadata.
 * Overlay and textarea have IDENTICAL text = perfect cursor alignment.
 */
export function MentionTextarea({
  value,
  onChange,
  fmtRanges,
  onFmtChange,
  tables,
  fields,
  tableNames,
  fieldDisplayNames,
  images,
  imageDisplayNames,
  modules,
  moduleDisplayNames,
  features,
  featureDisplayNames,
  concepts,
  conceptDisplayNames,
  research,
  researchDisplayNames,
  placeholder,
  rows = 15,
  onRefNavigate,
  onCreateRef,
  tableDetails,
  onPickTableForField,
  onBlurExpanded,
  initialCollapsed,
  onCollapsedChange,
  onImmediateCommit,
  initialTables,
  onTablesChange,
  noteContext,
}: {
  value: string;
  onChange: (v: string) => void;
  fmtRanges: FmtRange[];
  onFmtChange: (ranges: FmtRange[]) => void;
  tables: Array<{ id: number; name: string }>;
  fields: Array<{ id: number; name: string; tableId: number; tableName: string }>;
  tableNames: Set<string>;
  fieldDisplayNames: Set<string>;
  images?: Array<{ id: string; title: string; url?: string }>;
  imageDisplayNames?: Set<string>;
  modules?: Array<{ id: number; name: string }>;
  moduleDisplayNames?: Set<string>;
  features?: Array<{ id: number; name: string; modules?: string }>;
  featureDisplayNames?: Set<string>;
  concepts?: Array<{ id: number; name: string }>;
  conceptDisplayNames?: Set<string>;
  research?: Array<{ id: number; name: string }>;
  researchDisplayNames?: Set<string>;
  placeholder?: string;
  rows?: number;
  onRefNavigate?: (type: string, name: string) => void;
  onCreateRef?: (type: "table" | "field", name: string, options?: { parentTableId?: number; description?: string; recordOwnership?: string; tableStatus?: string }) => Promise<{ id: number; name: string } | null>;
  tableDetails?: Array<Record<string, unknown>>;
  onPickTableForField?: (fieldSnakeName: string, fieldRawName: string) => void;
  onBlurExpanded?: (expandedValue: string, expandedFmt: FmtRange[]) => void;
  initialCollapsed?: Record<string, { body: string; bodyFmt: FmtRange[] }>;
  onCollapsedChange?: (collapsed: Record<string, { body: string; bodyFmt: FmtRange[] }>) => void;
  onImmediateCommit?: (value: string, fmt: FmtRange[], collapsed: Record<string, { body: string; bodyFmt: FmtRange[] }>) => void;
  initialTables?: Record<string, EmbeddedTable>;
  onTablesChange?: (tables: Record<string, EmbeddedTable>) => void;
  noteContext?: { module?: string; moduleColor?: string; feature?: string; featureColor?: string; field?: string; fieldColor?: string };
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [query, setQuery] = useState("");
  const [triggerIdx, setTriggerIdx] = useState(-1);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [imageOnlyMode, setImageOnlyMode] = useState(false); // (( trigger
  const [activeTypes, setActiveTypes] = useState<Set<MentionType>>(new Set(ALL_MENTION_TYPES));
  const [createMode, setCreateMode] = useState<null | { type: "table" | "field"; step: "confirm" | "pick-table"; snakeName: string; rawName: string }>(null);
  const [createEditName, setCreateEditName] = useState("");
  const [createTableId, setCreateTableId] = useState<number | null>(null);
  const [tablePickerSearch, setTablePickerSearch] = useState("");
  const [tablePickerIdx, setTablePickerIdx] = useState(0);
  // Extra fields for table creation popup
  const [createTableDesc, setCreateTableDesc] = useState("");
  const [createTableOwnership, setCreateTableOwnership] = useState("org_private");
  const [createTableStatus, setCreateTableStatus] = useState("planned");

  // Floating format toolbar
  const [formatBar, setFormatBar] = useState(false);

  // Collapsible sections — lines starting with ## are section headers
  const collapsedBuffers = useRef<Map<string, { body: string; bodyFmt: FmtRange[] }>>(new Map(
    initialCollapsed ? Object.entries(initialCollapsed) : []
  ));
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(
    () => new Set(initialCollapsed ? Object.keys(initialCollapsed) : [])
  );

  // Inline rename editor for section headers (collapsed or expanded)
  const [renameState, setRenameState] = useState<{ headerKey: string; title: string; localTitle: string; lineStart: number; lineEnd: number; hashes: string; countSuffix: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openRename = useCallback((sec: ParsedSection) => {
    const lineEnd = value.indexOf("\n", sec.headerStart);
    const line = value.slice(sec.headerStart, lineEnd === -1 ? value.length : lineEnd);
    const hdrMatch = line.match(/^(#{2,6}) /);
    if (!hdrMatch) return;
    const hashes = hdrMatch[1];
    const countMatch = line.match(/( \[\d+ lines?\])$/);
    const countSuffix = countMatch ? countMatch[1] : "";
    const titleEnd = countMatch ? line.length - countMatch[0].length : line.length;
    const title = line.slice(hdrMatch[0].length, titleEnd);
    setRenameState({
      headerKey: sec.headerKey,
      title,
      localTitle: title,
      lineStart: sec.headerStart,
      lineEnd: lineEnd === -1 ? value.length : lineEnd,
      hashes,
      countSuffix,
    });
    requestAnimationFrame(() => renameInputRef.current?.focus());
  }, [value]);

  // Flush pending rename to the actual value
  const flushRename = useCallback((newTitle: string, rs: NonNullable<typeof renameState>) => {
    const oldTitle = rs.title;
    if (newTitle === oldTitle) return;
    const newHeaderLine = `${rs.hashes} ${newTitle}${rs.countSuffix}`;
    let newVal = value.slice(0, rs.lineStart) + newHeaderLine + value.slice(rs.lineEnd);
    // Update the matching ---§ end marker
    const oldMarker = `---§ ${oldTitle}`;
    const newMarker = `---§ ${newTitle}`;
    const markerIdx = newVal.indexOf(oldMarker, rs.lineStart + newHeaderLine.length);
    if (markerIdx !== -1) {
      newVal = newVal.slice(0, markerIdx) + newMarker + newVal.slice(markerIdx + oldMarker.length);
    }
    // Update collapsed buffer key
    const oldKey = oldTitle.trim().toLowerCase();
    const newKey = newTitle.trim().toLowerCase();
    if (collapsedBuffers.current.has(oldKey)) {
      const buf = collapsedBuffers.current.get(oldKey)!;
      collapsedBuffers.current.delete(oldKey);
      collapsedBuffers.current.set(newKey, buf);
      if (buf.body.includes(oldMarker)) {
        buf.body = buf.body.replace(oldMarker, newMarker);
      }
    }
    setCollapsedKeys((prev) => {
      const n = new Set(prev);
      if (n.has(oldKey)) { n.delete(oldKey); n.add(newKey); }
      return n;
    });
    const oldLen = rs.lineEnd - rs.lineStart;
    const newLen = newHeaderLine.length;
    const adjusted = adjustRangesForEdit(fmtRanges, rs.lineStart, oldLen, newLen);
    onChange(newVal);
    onFmtChange(adjusted);
    const collapsedObj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
    collapsedBuffers.current.forEach((v, k) => { collapsedObj[k] = v; });
    if (onImmediateCommit) onImmediateCommit(newVal, adjusted, collapsedObj);
    // Update renameState to reflect committed state
    const newLineEnd = rs.lineStart + newHeaderLine.length;
    setRenameState((prev) => prev ? {
      ...prev,
      headerKey: newKey,
      title: newTitle,
      lineStart: rs.lineStart,
      lineEnd: newLineEnd,
    } : null);
  }, [value, fmtRanges, onChange, onFmtChange, onImmediateCommit]);

  const handleRenameInput = useCallback((newTitle: string) => {
    if (!renameState) return;
    // Update local display immediately
    setRenameState((prev) => prev ? { ...prev, localTitle: newTitle } : null);
    // Debounce the actual commit by 2000ms
    if (renameTimerRef.current) clearTimeout(renameTimerRef.current);
    renameTimerRef.current = setTimeout(() => {
      flushRename(newTitle, renameState);
    }, 2000);
  }, [renameState, flushRename]);

  const deleteSection = useCallback((rs: NonNullable<typeof renameState>) => {
    // Find the full section range (header through ---§ end marker)
    const sections = parseSections(value);
    const sec = sections.find((s) => s.headerStart === rs.lineStart);
    if (!sec) { setRenameState(null); return; }

    // Determine delete range: from headerStart to bodyEnd (includes ---§ marker)
    // If collapsed, body is in the buffer — just remove the header line
    const isCollapsed = collapsedKeys.has(sec.headerKey);
    let deleteStart = sec.headerStart;
    let deleteEnd = isCollapsed ? rs.lineEnd : sec.bodyEnd;
    // Include the trailing newline if present
    if (deleteEnd < value.length && value[deleteEnd] === "\n") deleteEnd++;
    // Also include leading newline if not at start of text
    if (deleteStart > 0 && value[deleteStart - 1] === "\n") deleteStart--;

    let newVal = value.slice(0, Math.max(0, deleteStart)) + value.slice(deleteEnd);

    // Remove collapsed buffer if present
    const key = sec.headerKey;
    collapsedBuffers.current.delete(key);
    setCollapsedKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });

    // Also remove any orphan ---§ marker that matches this section's title
    const title = rs.title.trim();
    if (title) {
      const orphanPattern = new RegExp(`(^|\\n)---§ ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\n|$)`);
      const orphanMatch = newVal.match(orphanPattern);
      if (orphanMatch && orphanMatch.index !== undefined) {
        const oStart = orphanMatch[1] === "\n" ? orphanMatch.index : orphanMatch.index;
        const oEnd = orphanMatch.index + orphanMatch[0].length;
        // Don't double-remove the leading newline if it's at the very start
        const cleanStart = orphanMatch[1] === "\n" ? oStart : oStart;
        const cleanEnd = orphanMatch[2] === "\n" ? oEnd : oEnd;
        newVal = newVal.slice(0, cleanStart) + newVal.slice(cleanEnd);
      }
    }

    // Adjust format ranges
    const deletedLen = value.length - newVal.length;
    const adjusted = adjustRangesForEdit(fmtRanges, Math.max(0, deleteStart), deletedLen, 0);
    onChange(newVal);
    onFmtChange(adjusted);
    const collapsedObj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
    collapsedBuffers.current.forEach((v, k) => { collapsedObj[k] = v; });
    if (onImmediateCommit) onImmediateCommit(newVal, adjusted, collapsedObj);
    setRenameState(null);
  }, [value, fmtRanges, onChange, onFmtChange, onImmediateCommit, collapsedKeys]);

  const closeRename = useCallback(() => {
    if (renameTimerRef.current) {
      clearTimeout(renameTimerRef.current);
      renameTimerRef.current = null;
    }
    if (renameState) {
      const trimmed = renameState.localTitle.trim();
      if (trimmed === "") {
        // Empty title — confirm deletion
        if (window.confirm("Are you sure you want to delete this section? This will remove the header and all content within it.")) {
          deleteSection(renameState);
          return;
        } else {
          // Restore original title
          setRenameState(null);
          return;
        }
      }
      // Non-empty — flush if changed
      if (renameState.localTitle !== renameState.title) {
        flushRename(renameState.localTitle, renameState);
      }
    }
    setRenameState(null);
  }, [renameState, flushRename, deleteSection]);

  // Notify parent when collapsed state changes
  const notifyCollapsedChange = useCallback(() => {
    if (!onCollapsedChange) return;
    const obj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
    collapsedBuffers.current.forEach((v, k) => { obj[k] = v; });
    onCollapsedChange(obj);
  }, [onCollapsedChange]);

  // Auto-migrate bare ---§ markers to named format (---§ HeaderName)
  const migrationDone = useRef(false);
  React.useEffect(() => {
    if (migrationDone.current || !value) return;
    migrationDone.current = true;
    const lines = value.split("\n");
    let currentHeader = "";
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const hdrMatch = lines[i].match(/^#{2,6} (.+)/);
      if (hdrMatch) {
        currentHeader = hdrMatch[1].replace(/ \[\d+ lines?\]$/, "").trim();
      }
      if (lines[i] === "---§" && currentHeader) {
        lines[i] = `---§ ${currentHeader}`;
        changed = true;
      }
    }
    if (changed) {
      onChange(lines.join("\n"));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag-and-drop reordering of collapsed sections
  const [dragState, setDragState] = useState<{ headerKey: string; startY: number; currentY: number } | null>(null);
  const [dropLineIdx, setDropLineIdx] = useState<number | null>(null);
  const dragLineHeight = 28.8;
  const dragPadTop = 6;
  // Refs to avoid stale closures in global mouse event handlers
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const dropLineIdxRef = useRef(dropLineIdx);
  dropLineIdxRef.current = dropLineIdx;
  const valueRef = useRef(value);
  valueRef.current = value;
  const fmtRangesRef = useRef(fmtRanges);
  fmtRangesRef.current = fmtRanges;

  // Embedded tables — stored as [TABLE:id] tokens in text, data in a separate map
  const tableDataRef = useRef<Map<string, EmbeddedTable>>(new Map(
    initialTables ? Object.entries(initialTables) : []
  ));
  const [expandedTableIds, setExpandedTableIds] = useState<Set<string>>(new Set());
  const [showTableModal, setShowTableModal] = useState(false);
  const [tableHelpId, setTableHelpId] = useState<string | null>(null);
  const helpBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [heightSliderId, setHeightSliderId] = useState<string | null>(null);
  const heightSnapshotRef = useRef<Map<string, number[]>>(new Map());
  const [tablePanelPos, setTablePanelPos] = useState<Map<string, { x: number; y: number }>>(new Map());
  const tableDrag = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const notifyTablesChange = useCallback(() => {
    if (!onTablesChange) return;
    const obj: Record<string, EmbeddedTable> = {};
    tableDataRef.current.forEach((v, k) => { obj[k] = v; });
    onTablesChange(obj);
  }, [onTablesChange]);

  const insertTable = useCallback((table: EmbeddedTable) => {
    // Sequential ID: find the highest existing tN and increment
    let maxNum = 0;
    tableDataRef.current.forEach((_, k) => {
      const m = k.match(/^t(\d+)$/);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    });
    const id = `t${maxNum + 1}`;
    tableDataRef.current.set(id, table);
    const ta = textareaRef.current;
    const cursor = ta ? ta.selectionStart : value.length;
    // Insert token on its own line
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const needNewlineBefore = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const needNewlineAfter = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    const token = `[TABLE:${id}]`;
    const newVal = before + needNewlineBefore + token + needNewlineAfter + after;
    const delta = newVal.length - value.length;
    const editPos = cursor;
    const adjusted = adjustRangesForEdit(fmtRanges, editPos, 0, delta);
    onChange(newVal);
    onFmtChange(adjusted);
    prevValueRef.current = newVal;
    setExpandedTableIds((prev) => new Set([...prev, id]));
    setShowTableModal(false);
    notifyTablesChange();
    // Commit immediately so table data is saved
    const collapsedObj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
    collapsedBuffers.current.forEach((v, k) => { collapsedObj[k] = v; });
    if (onImmediateCommit) onImmediateCommit(newVal, adjusted, collapsedObj);
  }, [value, fmtRanges, onChange, onFmtChange, notifyTablesChange, onImmediateCommit]);

  // Undo history for embedded tables — stores {id, previous state (or null if new), text/fmt snapshot for deletes}
  const tableUndoStack = useRef<Array<{ id: string; prev: EmbeddedTable | null; action: "update" | "delete"; textSnapshot?: string; fmtSnapshot?: FmtRange[] }>>([]);
  const [undoCount, setUndoCount] = useState(0); // trigger re-renders when stack changes

  const undoTableAction = useCallback(() => {
    const entry = tableUndoStack.current.pop();
    if (!entry) return;
    if (entry.action === "update" && entry.prev) {
      tableDataRef.current.set(entry.id, entry.prev);
      notifyTablesChange();
    } else if (entry.action === "delete" && entry.prev && entry.textSnapshot !== undefined) {
      // Re-insert the table token and restore table data
      tableDataRef.current.set(entry.id, entry.prev);
      const token = `[TABLE:${entry.id}]`;
      const newVal = value + "\n" + token;
      const adjusted = fmtRanges;
      onChange(newVal);
      prevValueRef.current = newVal;
      setExpandedTableIds((prev) => new Set(prev).add(entry.id));
      notifyTablesChange();
      const collapsedObj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
      collapsedBuffers.current.forEach((v, k) => { collapsedObj[k] = v; });
      if (onImmediateCommit) onImmediateCommit(newVal, adjusted, collapsedObj);
    }
    setUndoCount(tableUndoStack.current.length);
  }, [value, fmtRanges, onChange, notifyTablesChange, onImmediateCommit]);

  const updateTableData = useCallback((id: string, updated: EmbeddedTable) => {
    const prev = tableDataRef.current.get(id);
    if (prev) tableUndoStack.current.push({ id, prev: { ...prev, rows: prev.rows.map((r) => [...r]), headers: [...prev.headers], rowHeights: prev.rowHeights ? [...prev.rowHeights] : undefined }, action: "update" });
    // Cap undo stack at 50
    if (tableUndoStack.current.length > 50) tableUndoStack.current.shift();
    setUndoCount(tableUndoStack.current.length);
    tableDataRef.current.set(id, updated);
    notifyTablesChange();
  }, [notifyTablesChange]);

  const deleteTable = useCallback((id: string) => {
    const prev = tableDataRef.current.get(id);
    if (prev) tableUndoStack.current.push({ id, prev: { ...prev, rows: prev.rows.map((r) => [...r]), headers: [...prev.headers], rowHeights: prev.rowHeights ? [...prev.rowHeights] : undefined }, action: "delete", textSnapshot: value, fmtSnapshot: [...fmtRanges] });
    setUndoCount(tableUndoStack.current.length);
    tableDataRef.current.delete(id);
    // Remove [TABLE:id] token from text
    const token = `[TABLE:${id}]`;
    const idx = value.indexOf(token);
    if (idx === -1) return;
    // Remove token and surrounding newlines
    let removeStart = idx;
    let removeEnd = idx + token.length;
    if (removeStart > 0 && value[removeStart - 1] === "\n") removeStart--;
    if (removeEnd < value.length && value[removeEnd] === "\n") removeEnd++;
    const newVal = value.slice(0, removeStart) + value.slice(removeEnd);
    const adjusted = adjustRangesForEdit(fmtRanges, removeStart, removeEnd - removeStart, 0);
    onChange(newVal);
    onFmtChange(adjusted);
    prevValueRef.current = newVal;
    setExpandedTableIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    notifyTablesChange();
    const collapsedObj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
    collapsedBuffers.current.forEach((v, k) => { collapsedObj[k] = v; });
    if (onImmediateCommit) onImmediateCommit(newVal, adjusted, collapsedObj);
  }, [value, fmtRanges, onChange, onFmtChange, notifyTablesChange, onImmediateCommit]);

  // parseSections is now a module-level function (defined above component) — never stale

  // Drag-and-drop callbacks for collapsed section reordering
  const handleDragMove = useCallback((e: MouseEvent) => {
    setDragState((prev) => prev ? { ...prev, currentY: e.clientY } : null);
    const ta = textareaRef.current;
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const relY = e.clientY - rect.top + ta.scrollTop - dragPadTop;
    const lineIdx = Math.max(0, Math.round(relY / dragLineHeight));
    setDropLineIdx(lineIdx);
  }, []);

  const handleDragEnd = useCallback(() => {
    window.removeEventListener("mousemove", handleDragMove);
    window.removeEventListener("mouseup", handleDragEnd);

    const ds = dragStateRef.current;
    const dli = dropLineIdxRef.current;
    if (!ds || dli === null) {
      setDragState(null);
      setDropLineIdx(null);
      return;
    }

    const currentValue = valueRef.current;
    const currentFmt = fmtRangesRef.current;
    const sections = parseSections(currentValue);
    const sec = sections.find((s) => s.headerKey === ds.headerKey);
    if (!sec) { setDragState(null); setDropLineIdx(null); return; }

    const lines = currentValue.split("\n");
    const sourceLineIdx = sec.headerLineIdx;

    let targetLineIdx = Math.min(dli, lines.length);
    if (targetLineIdx === sourceLineIdx || targetLineIdx === sourceLineIdx + 1) {
      setDragState(null);
      setDropLineIdx(null);
      return;
    }

    const headerLine = lines[sourceLineIdx];
    const newLines = [...lines];
    newLines.splice(sourceLineIdx, 1);
    if (targetLineIdx > sourceLineIdx) targetLineIdx--;
    // Clamp to array bounds so we never insert past the last real line
    targetLineIdx = Math.min(targetLineIdx, newLines.length);
    newLines.splice(targetLineIdx, 0, headerLine);

    const newValue = newLines.join("\n");

    // Adjust format ranges for the line move
    const oldLineStart = lines.slice(0, sourceLineIdx).join("\n").length + (sourceLineIdx > 0 ? 1 : 0);
    const lineLen = headerLine.length;
    let adjusted = currentFmt;
    adjusted = adjustRangesForEdit(adjusted, oldLineStart, lineLen + 1, 0);
    const newLineStart = newLines.slice(0, targetLineIdx).join("\n").length + (targetLineIdx > 0 ? 1 : 0);
    adjusted = adjustRangesForEdit(adjusted, newLineStart, 0, lineLen + 1);

    onChange(newValue);
    onFmtChange(adjusted);
    const collapsedObj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
    collapsedBuffers.current.forEach((v, k) => { collapsedObj[k] = v; });
    if (onImmediateCommit) onImmediateCommit(newValue, adjusted, collapsedObj);

    setDragState(null);
    setDropLineIdx(null);
  }, [handleDragMove, onChange, onFmtChange, onImmediateCommit]);

  const startDrag = useCallback((headerKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    setDragState({ headerKey, startY: e.clientY, currentY: e.clientY });
    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
  }, [handleDragMove, handleDragEnd]);

  // Cleanup drag listeners on unmount
  React.useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleDragMove);
      window.removeEventListener("mouseup", handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  const collapseSection = useCallback((headerKey: string) => {
    const sections = parseSections(value);
    const sec = sections.find((s) => s.headerKey === headerKey);
    if (!sec || sec.bodyStart > value.length) return;

    const bodyText = value.slice(sec.bodyStart, sec.bodyEnd);
    if (!bodyText) return; // nothing to collapse

    const bodyLineCount = bodyText.split("\n").length;

    // Store body text and its format ranges
    const bodyFmt = fmtRanges.filter((r) => r.start >= sec.bodyStart && r.end <= sec.bodyEnd)
      .map((r) => ({ ...r, start: r.start - sec.bodyStart, end: r.end - sec.bodyStart }));
    collapsedBuffers.current.set(headerKey, { body: bodyText, bodyFmt });

    // Remove body from value, append line count indicator to header
    const headerLine = value.slice(sec.headerStart, sec.headerEnd);
    const newHeader = `${headerLine} [${bodyLineCount} line${bodyLineCount !== 1 ? "s" : ""}]`;
    const newValue = value.slice(0, sec.headerStart) + newHeader + value.slice(sec.bodyEnd);

    // Adjust format ranges: remove body ranges, shift everything after
    const bodyLen = sec.bodyEnd - sec.bodyStart;
    const headerDelta = newHeader.length - (sec.headerEnd - sec.headerStart);
    const adjusted = adjustRangesForEdit(
      fmtRanges.filter((r) => !(r.start >= sec.bodyStart && r.end <= sec.bodyEnd)),
      sec.headerEnd,
      bodyLen,
      0 // removing body
    );
    // Adjust for header expansion (line count indicator)
    const finalRanges = headerDelta !== 0
      ? adjustRangesForEdit(adjusted, sec.headerEnd, 0, headerDelta)
      : adjusted;

    // Track collapsed children — any child section headers within the body that were already collapsed
    const childCollapsedKeys: string[] = [];
    for (const s of sections) {
      if (s.headerStart > sec.headerStart && s.headerStart < sec.bodyEnd && s.depth > sec.depth) {
        if (collapsedBuffers.current.has(s.headerKey) && s.headerKey !== headerKey) {
          childCollapsedKeys.push(s.headerKey);
        }
      }
    }

    onChange(newValue);
    onFmtChange(finalRanges);
    // Build collapsed state snapshot and commit atomically
    const collapsedObj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
    collapsedBuffers.current.forEach((v, k) => { collapsedObj[k] = v; });
    if (onImmediateCommit) onImmediateCommit(newValue, finalRanges, collapsedObj);
    // Add parent key, keep child keys (their buffers remain for when parent is expanded)
    setCollapsedKeys((prev) => { const n = new Set(prev); n.add(headerKey); return n; });

    // Place cursor at end of header
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        const pos = sec.headerStart + newHeader.length;
        ta.selectionStart = pos;
        ta.selectionEnd = pos;
        ta.focus();
      }
    });
  }, [value, fmtRanges, onChange, onFmtChange, onImmediateCommit]);

  const expandSection = useCallback((headerKey: string) => {
    const buf = collapsedBuffers.current.get(headerKey);
    if (!buf) return;

    const sections = parseSections(value);
    const sec = sections.find((s) => s.headerKey === headerKey);
    if (!sec) return;

    // Remove the " [N lines]" indicator from header
    const headerLine = value.slice(sec.headerStart, sec.headerEnd);
    const cleanHeader = headerLine.replace(/ \[\d+ lines?\]$/, "");

    // Insert body text after cleaned header (body already contains any ---§ separators)
    const newValue = value.slice(0, sec.headerStart) + cleanHeader + "\n" + buf.body + value.slice(sec.headerEnd);

    // Adjust format ranges: shift everything after header, then insert body ranges
    const indicatorLen = headerLine.length - cleanHeader.length;
    let adjusted = fmtRanges;
    // First remove the indicator
    if (indicatorLen > 0) {
      adjusted = adjustRangesForEdit(adjusted, sec.headerStart + cleanHeader.length, indicatorLen, 0);
    }
    // Then insert space for body (at position after header + newline)
    const insertPos = sec.headerStart + cleanHeader.length + 1; // +1 for \n
    adjusted = adjustRangesForEdit(adjusted, insertPos, 0, buf.body.length);
    // Re-add body format ranges at the correct offset
    const restoredFmt = buf.bodyFmt.map((r) => ({ ...r, start: r.start + insertPos, end: r.end + insertPos }));
    adjusted = [...adjusted, ...restoredFmt];

    collapsedBuffers.current.delete(headerKey);
    onChange(newValue);
    onFmtChange(adjusted);
    const collapsedObj: Record<string, { body: string; bodyFmt: FmtRange[] }> = {};
    collapsedBuffers.current.forEach((v, k) => { collapsedObj[k] = v; });
    if (onImmediateCommit) onImmediateCommit(newValue, adjusted, collapsedObj);
    setCollapsedKeys((prev) => { const n = new Set(prev); n.delete(headerKey); return n; });
  }, [value, fmtRanges, onChange, onFmtChange, onImmediateCommit]);

  // Expand all collapsed sections — returns the full text and ranges (used before commit)
  // Multi-pass: parents must expand first to reveal hidden children inside their bodies
  const expandAll = useCallback(() => {
    if (collapsedBuffers.current.size === 0) return { text: value, fmt: fmtRanges };

    let currentText = value;
    let currentFmt = fmtRanges;
    let maxIter = 10; // safety limit for nesting depth
    while (collapsedBuffers.current.size > 0 && maxIter-- > 0) {
      const sections = parseSections(currentText);
      // Find collapsed sections currently visible in text (bottom-to-top for offset safety)
      const toExpand = sections
        .filter((s) => collapsedBuffers.current.has(s.headerKey))
        .reverse();
      if (toExpand.length === 0) break; // no more visible collapsed sections

      for (const sec of toExpand) {
        const buf = collapsedBuffers.current.get(sec.headerKey);
        if (!buf) continue;

        const headerLine = currentText.slice(sec.headerStart, sec.headerEnd);
        const cleanHeader = headerLine.replace(/ \[\d+ lines?\]$/, "");
        const indicatorLen = headerLine.length - cleanHeader.length;

        let adjusted = currentFmt;
        if (indicatorLen > 0) {
          adjusted = adjustRangesForEdit(adjusted, sec.headerStart + cleanHeader.length, indicatorLen, 0);
        }
        const insertPos = sec.headerStart + cleanHeader.length + 1;
        adjusted = adjustRangesForEdit(adjusted, insertPos, 0, buf.body.length);
        const restoredFmt = buf.bodyFmt.map((r) => ({ ...r, start: r.start + insertPos, end: r.end + insertPos }));
        adjusted = [...adjusted, ...restoredFmt];

        currentText = currentText.slice(0, sec.headerStart) + cleanHeader + "\n" + buf.body + currentText.slice(sec.headerEnd);
        currentFmt = adjusted;
        collapsedBuffers.current.delete(sec.headerKey);
      }
    }
    setCollapsedKeys(new Set());
    return { text: currentText, fmt: currentFmt };
  }, [value, fmtRanges, collapsedKeys]);

  // Hover tooltip for references
  const [refTooltip, setRefTooltip] = useState<{ type: string; name: string; rect: DOMRect } | null>(null);
  const refTooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const handleRefHover = useCallback((ref: { type: string; name: string; rect: DOMRect } | null) => {
    if (refTooltipTimer.current) clearTimeout(refTooltipTimer.current);
    if (ref) {
      setRefTooltip(ref);
      setTooltipVisible(false);
      refTooltipTimer.current = setTimeout(() => setTooltipVisible(true), 800);
    } else {
      setTooltipVisible(false);
      setRefTooltip(null);
    }
  }, []);

  const handleRefNavigate = useCallback((type: string, name: string) => {
    if (onRefNavigate) onRefNavigate(type, name);
  }, [onRefNavigate]);

  const checkSelection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || ta.selectionStart === ta.selectionEnd) {
      setFormatBar(false);
      return;
    }
    setFormatBar(true);
  }, []);

  const handleFormat = useCallback((type: FmtType) => {
    const ta = textareaRef.current;
    if (!ta || ta.selectionStart === ta.selectionEnd) return;
    const newRanges = toggleFmtRange(fmtRanges, ta.selectionStart, ta.selectionEnd, type);
    onFmtChange(newRanges);
    // Keep selection and toolbar open
    requestAnimationFrame(() => ta.focus());
  }, [fmtRanges, onFmtChange]);

  const handleList = useCallback((type: "bullet" | "number") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const result = toggleListPrefix(value, ta.selectionStart, ta.selectionEnd, type);
    // Adjust format ranges for the text changes
    let adjusted = fmtRanges;
    for (const d of result.rangesDelta) {
      adjusted = adjustRangesForEdit(adjusted, d.lineStart, d.oldLen, d.newLen);
    }
    onChange(result.newValue);
    onFmtChange(adjusted);
    setFormatBar(false);
    requestAnimationFrame(() => {
      ta.selectionStart = result.newStart;
      ta.selectionEnd = result.newEnd;
      ta.focus();
    });
  }, [value, fmtRanges, onChange, onFmtChange]);

  const handleClear = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || ta.selectionStart === ta.selectionEnd) return;
    const newRanges = clearFmtRange(fmtRanges, ta.selectionStart, ta.selectionEnd);
    onFmtChange(newRanges);
    setFormatBar(false);
    requestAnimationFrame(() => ta.focus());
  }, [fmtRanges, onFmtChange]);

  const handleSection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    // Find the start of the current line
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineText = value.slice(lineStart, end);
    const firstLineEnd = lineText.indexOf("\n");
    const firstLine = firstLineEnd === -1 ? lineText : lineText.slice(0, firstLineEnd);

    // Check if first line already has a section header (any depth ##–######)
    // Also match collapsed headers with [N lines] suffix
    const existingHeader = firstLine.match(/^(#{2,6}) /);
    if (existingHeader) {
      // If this is a collapsed section, expand it first before removing
      const hdrTitle = firstLine.slice(existingHeader[0].length).replace(/ \[\d+ lines?\]$/, "").trim();
      const hdrKey = hdrTitle.toLowerCase();
      if (collapsedKeys.has(hdrKey)) {
        expandSection(hdrKey);
        return; // expand first, user can click § again to remove
      }
      // Remove header prefix and ---§ end marker if present
      const prefixLen = existingHeader[0].length; // "## " or "### " etc.
      let removeText = firstLine.slice(prefixLen) + (firstLineEnd === -1 ? "" : lineText.slice(firstLineEnd));
      let afterEnd = value.slice(end);
      let adjusted = adjustRangesForEdit(fmtRanges, lineStart, prefixLen, 0);
      // Check if named ---§ follows the selection and remove it (---§ Name or bare ---§)
      const endMarkerMatch = afterEnd.match(/^\n---§(?: [^\n]*)?\n/) || afterEnd.match(/^\n---§(?: [^\n]*)?$/);
      if (endMarkerMatch) {
        const markerLen = endMarkerMatch[0].length;
        removeText += afterEnd.slice(0, markerLen);
        afterEnd = afterEnd.slice(markerLen);
        adjusted = adjustRangesForEdit(adjusted, lineStart + removeText.length, markerLen, 0);
      }
      const newVal = value.slice(0, lineStart) + removeText + afterEnd;
      onChange(newVal);
      onFmtChange(adjusted);
    } else {
      // Auto-detect parent depth: if selection is inside an existing section's body, use parent depth + 1
      const sections = parseSections(value);
      let parentDepth = 0;
      for (const sec of sections) {
        if (lineStart > sec.headerEnd && lineStart <= sec.bodyEnd && sec.depth > parentDepth) {
          parentDepth = sec.depth;
        }
      }
      const newDepth = Math.min(parentDepth + 1, 5); // cap at ###### (depth 5)
      const hashes = "#".repeat(newDepth + 1) + " "; // depth 1 = "## ", depth 2 = "### ", etc.

      const sectionTitle = firstLine.trim();
      const endMarker = `\n---§ ${sectionTitle}`;
      const newVal = value.slice(0, lineStart) + hashes + lineText + endMarker + value.slice(end);
      let adjusted = adjustRangesForEdit(fmtRanges, lineStart, 0, hashes.length);
      adjusted = adjustRangesForEdit(adjusted, end + hashes.length, 0, endMarker.length);
      onChange(newVal);
      onFmtChange(adjusted);
    }
    setFormatBar(false);
    requestAnimationFrame(() => ta.focus());
  }, [value, fmtRanges, onChange, onFmtChange]);

  // Sync scroll between textarea and highlight layer
  const [taScrollTop, setTaScrollTop] = useState(0);
  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      setTaScrollTop(textareaRef.current.scrollTop);
    }
  }, []);

  // Build table titles map for overlay rendering (re-derive when value changes since inserts/deletes change it)
  const tableTitles = useMemo(() => {
    const m = new Map<string, string>();
    tableDataRef.current.forEach((t, k) => m.set(k, t.title));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, expandedTableIds]);

  // Assign colors to expanded tables for visual matching
  const tableColorMap = useMemo(() => {
    const m = new Map<string, string>();
    let i = 0;
    expandedTableIds.forEach((id) => {
      m.set(id, TABLE_COLORS[i % TABLE_COLORS.length]);
      i++;
    });
    return m;
  }, [expandedTableIds]);

  // Highlight HTML — same text as textarea, with formatting from ranges + reference coloring
  const highlightHTML = useMemo(
    () => buildHighlightHTML(value, fmtRanges, tableNames, fieldDisplayNames, imageDisplayNames, collapsedKeys, moduleDisplayNames, featureDisplayNames, tableTitles, tableColorMap, conceptDisplayNames, researchDisplayNames),
    [value, fmtRanges, tableNames, fieldDisplayNames, imageDisplayNames, collapsedKeys, moduleDisplayNames, featureDisplayNames, tableTitles, tableColorMap, conceptDisplayNames, researchDisplayNames]
  );

  // refBtnTick removed — highlightHTML and taScrollTop already trigger re-renders naturally

  // Build filtered autocomplete options
  const options = useMemo<MentionOption[]>(() => {
    const q = query.toLowerCase();
    if (imageOnlyMode) {
      return (images || [])
        .filter((img) => img.title.toLowerCase().includes(q))
        .slice(0, 10)
        .map((img) => ({ type: "image" as const, id: 0, label: img.title, imageId: img.id }));
    }
    const allActive = activeTypes.size === ALL_MENTION_TYPES.size;
    const perType = allActive ? 6 : 15;
    const tOpts: MentionOption[] = activeTypes.has("table") ? tables
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, perType)
      .map((t) => ({ type: "table", id: t.id, label: t.name })) : [];
    const fOpts: MentionOption[] = activeTypes.has("field") ? fields
      .filter((fd) => fd.name.toLowerCase().includes(q) || fd.tableName.toLowerCase().includes(q) || `${fd.tableName}.${fd.name}`.toLowerCase().includes(q))
      .slice(0, perType)
      .map((fd) => ({ type: "field", id: fd.id, label: fd.name, parentLabel: fd.tableName })) : [];
    const mOpts: MentionOption[] = activeTypes.has("module") ? (modules || [])
      .filter((mod) => mod.name.toLowerCase().includes(q))
      .slice(0, perType)
      .map((mod) => ({ type: "module", id: mod.id, label: mod.name })) : [];
    const feOpts: MentionOption[] = activeTypes.has("feature") ? (features || [])
      .filter((fe) => fe.name.toLowerCase().includes(q) || (fe.modules || "").toLowerCase().includes(q))
      .slice(0, perType)
      .map((fe) => ({ type: "feature", id: fe.id, label: fe.name, parentLabel: fe.modules })) : [];
    const iOpts: MentionOption[] = activeTypes.has("image") ? (images || [])
      .filter((img) => img.title.toLowerCase().includes(q))
      .slice(0, 4)
      .map((img) => ({ type: "image" as const, id: 0, label: img.title, imageId: img.id })) : [];
    const cOpts: MentionOption[] = activeTypes.has("concept") ? (concepts || [])
      .filter((con) => con.name.toLowerCase().includes(q))
      .slice(0, perType)
      .map((con) => ({ type: "concept" as const, id: con.id, label: con.name })) : [];
    const rOpts: MentionOption[] = activeTypes.has("research") ? (research || [])
      .filter((res) => res.name.toLowerCase().includes(q))
      .slice(0, perType)
      .map((res) => ({ type: "research" as const, id: res.id, label: res.name })) : [];
    return [...mOpts, ...feOpts, ...cOpts, ...rOpts, ...tOpts, ...fOpts, ...iOpts];
  }, [query, tables, fields, images, modules, features, concepts, research, imageOnlyMode, activeTypes]);

  // Track previous value for range adjustment
  const prevValueRef = useRef(value);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newVal = e.target.value;
      const oldVal = prevValueRef.current;

      // Protect collapsed header lines — allow title edits but prevent changes to ## prefix or [N lines] suffix
      if (newVal !== oldVal && collapsedKeys.size > 0) {
        const cursor = e.target.selectionStart;
        const delta = newVal.length - oldVal.length;
        const editPos = delta > 0 ? cursor - delta : cursor;
        // Check if edit position falls on a collapsed header line in the old value
        const lineStart = oldVal.lastIndexOf("\n", editPos - 1) + 1;
        const lineEnd = oldVal.indexOf("\n", editPos);
        const line = oldVal.slice(lineStart, lineEnd === -1 ? oldVal.length : lineEnd);
        if (/^#{2,6} /.test(line) && / \[\d+ lines?\]$/.test(line)) {
          // Extract the structural parts
          const hdrMatch = line.match(/^(#{2,6} )/);
          const countMatch = line.match(/( \[\d+ lines?\])$/);
          if (hdrMatch && countMatch) {
            const newLineStart = newVal.lastIndexOf("\n", Math.min(editPos, newVal.length - 1) - 1) + 1;
            const newLineEnd = newVal.indexOf("\n", newLineStart);
            const newLine = newVal.slice(newLineStart, newLineEnd === -1 ? newVal.length : newLineEnd);
            // Check that the ## prefix and [N lines] suffix are preserved
            const newHdrMatch = newLine.match(/^(#{2,6} )/);
            const newCountMatch = newLine.match(/( \[\d+ lines?\])$/);
            if (!newHdrMatch || !newCountMatch || newHdrMatch[1] !== hdrMatch[1] || newCountMatch[1] !== countMatch[1]) {
              // Structural parts were modified — revert
              e.target.value = oldVal;
              return;
            }
            // Title portion changed — this is allowed, no revert needed
          }
        }
      }

      // Adjust formatting ranges for the edit
      if (newVal !== oldVal) {
        const cursor = e.target.selectionStart;
        // Approximate: find where the edit happened by comparing old/new
        const delta = newVal.length - oldVal.length;
        if (delta !== 0) {
          const editPos = delta > 0 ? cursor - delta : cursor;
          const oldLen = delta < 0 ? -delta : 0;
          const newLen = delta > 0 ? delta : 0;
          const adjusted = adjustRangesForEdit(fmtRanges, editPos, oldLen, newLen);
          onFmtChange(adjusted);
        }
      }

      // Header rename sync — if the edit is on a ## header line, update the matching ---§ end marker
      let finalVal = newVal;
      if (newVal !== oldVal) {
        const cursor = e.target.selectionStart;
        const delta = newVal.length - oldVal.length;
        const editPos = delta > 0 ? cursor - delta : cursor;
        // Find the line being edited in the NEW value
        const newLineStart = newVal.lastIndexOf("\n", cursor - 1) + 1;
        const newLineEnd = newVal.indexOf("\n", cursor);
        const newLine = newVal.slice(newLineStart, newLineEnd === -1 ? newVal.length : newLineEnd);
        // Find the same line position in the OLD value
        const oldLineStart = oldVal.lastIndexOf("\n", editPos - 1) + 1;
        const oldLineEnd = oldVal.indexOf("\n", editPos);
        const oldLine = oldVal.slice(oldLineStart, oldLineEnd === -1 ? oldVal.length : oldLineEnd);
        // Check if we're editing a ## header line
        const oldHdr = oldLine.match(/^(#{2,6}) (.+?)$/);
        const newHdr = newLine.match(/^(#{2,6}) (.+?)$/);
        if (oldHdr && newHdr) {
          const oldName = oldHdr[2].replace(/ \[\d+ lines?\]$/, "").trim();
          const newName = newHdr[2].replace(/ \[\d+ lines?\]$/, "").trim();
          if (oldName !== newName && oldName) {
            // Find and update the matching ---§ end marker
            const oldMarker = `---§ ${oldName}`;
            const newMarker = `---§ ${newName}`;
            const markerIdx = finalVal.indexOf(oldMarker, newLineEnd === -1 ? 0 : newLineEnd);
            if (markerIdx !== -1) {
              finalVal = finalVal.slice(0, markerIdx) + newMarker + finalVal.slice(markerIdx + oldMarker.length);
              // Also update collapsed buffer key if this section is collapsed
              const oldKey = oldName.toLowerCase();
              const newKey = newName.toLowerCase();
              if (collapsedBuffers.current.has(oldKey)) {
                const buf = collapsedBuffers.current.get(oldKey)!;
                collapsedBuffers.current.delete(oldKey);
                collapsedBuffers.current.set(newKey, buf);
                setCollapsedKeys((prev) => {
                  const n = new Set(prev);
                  if (n.has(oldKey)) { n.delete(oldKey); n.add(newKey); }
                  return n;
                });
              }
            }
          }
        }
      }

      prevValueRef.current = finalVal;
      onChange(finalVal);

      const cursorPos = e.target.selectionStart;
      const textBefore = newVal.slice(0, cursorPos);
      const lastOpen = textBefore.lastIndexOf("(");
      if (lastOpen >= 0) {
        const between = textBefore.slice(lastOpen + 1);
        // Detect (( for image-only mode
        const isDoubleParen = lastOpen > 0 && newVal[lastOpen - 1] === "(";
        const queryText = isDoubleParen ? between.replace(/^\(/, "") : between;
        if (!between.includes(")") && !between.includes("\n") && queryText.length <= 40) {
          setTriggerIdx(isDoubleParen ? lastOpen - 1 : lastOpen);
          setQuery(queryText);
          setSelectedIdx(0);
          setImageOnlyMode(isDoubleParen);
          setShowMenu(true);
          const ta = textareaRef.current;
          if (ta) {
            const lineCount = textBefore.split("\n").length;
            const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 19;
            setMenuPos({ top: lineCount * lineHeight + 8 - ta.scrollTop, left: 0 });
          }
          return;
        }
      }
      setShowMenu(false);
      setImageOnlyMode(false);
    },
    [onChange, fmtRanges, onFmtChange, collapsedKeys]
  );

  // Insert display-format name: (tableName) or (table.field)
  const insertRef = useCallback(
    (opt: MentionOption) => {
      const ta = textareaRef.current;
      if (!ta || triggerIdx < 0) return;
      // Insert display format — FeatureMentionField wrapper converts to (t:ID:name) on blur
      const displayToken = opt.type === "table"
        ? `(${opt.label})`
        : opt.type === "image"
        ? `(🎨 ${opt.label})`
        : opt.type === "module"
        ? `(💻 ${opt.label})`
        : opt.type === "feature"
        ? `(⚡ ${opt.label})`
        : opt.type === "concept"
        ? `(💡 ${opt.label})`
        : opt.type === "research"
        ? `(🔬 ${opt.label})`
        : `(${opt.parentLabel}.${opt.label})`;
      const before = value.slice(0, triggerIdx);
      const after = value.slice(ta.selectionStart);
      const newVal = before + displayToken + after;
      onChange(newVal);
      setShowMenu(false);
      setImageOnlyMode(false);
      setActiveTypes(new Set(ALL_MENTION_TYPES));
      requestAnimationFrame(() => {
        const pos = triggerIdx + displayToken.length;
        ta.selectionStart = pos;
        ta.selectionEnd = pos;
        ta.focus();
      });
    },
    [value, triggerIdx, onChange]
  );

  // Check if cursor is on a protected region (---§ lines, or the [N lines] / ## prefix of collapsed headers)
  const isOnProtectedLine = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return false;
    const cursor = ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEnd = value.indexOf("\n", cursor);
    const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
    // Collapsed header lines — only protect the ## prefix and [N lines] suffix, not the title
    if (collapsedKeys.size > 0 && /^#{2,6} /.test(line) && / \[\d+ lines?\]$/.test(line)) {
      const hdrMatch = line.match(/^(#{2,6} )/);
      const countMatch = line.match(/ \[\d+ lines?\]$/);
      if (hdrMatch && countMatch) {
        const titleStart = lineStart + hdrMatch[0].length;
        const titleEnd = lineStart + line.length - countMatch[0].length;
        // Cursor is in the editable title zone — not protected
        if (cursor >= titleStart && cursor <= titleEnd) return false;
        // Cursor is in the ## prefix or [N lines] suffix — protected
        return true;
      }
    }
    // ---§ separator lines (bare or named) — only protect if a section header exists above
    if (/^---§(?: .+)?$/.test(line)) {
      const textAbove = value.slice(0, lineStart);
      if (/#{2,6} .+\n/.test(textAbove)) return true;
    }
    return false;
  }, [value, collapsedKeys]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Tab/Shift+Tab on section header lines: adjust nesting depth
      if (e.key === "Tab" && !showMenu) {
        const ta = textareaRef.current;
        if (ta) {
          const cursor = ta.selectionStart;
          const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
          const lineEnd = value.indexOf("\n", cursor);
          const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);
          const hdrMatch = line.match(/^(#{2,6}) /);
          if (hdrMatch) {
            e.preventDefault();
            const oldHashes = hdrMatch[1]; // "##" or "###" etc.
            const oldDepth = oldHashes.length - 1; // ## = 1, ### = 2
            let newDepth: number;
            if (e.shiftKey) {
              newDepth = Math.max(1, oldDepth - 1); // demote (min ## = depth 1)
            } else {
              newDepth = Math.min(5, oldDepth + 1); // promote (max ###### = depth 5)
            }
            if (newDepth === oldDepth) return; // no change possible
            const newHashes = "#".repeat(newDepth + 1); // depth 1 = "##", depth 2 = "###"
            const newLine = newHashes + line.slice(oldHashes.length); // replace hash prefix
            const title = line.slice(oldHashes.length + 1).replace(/ \[\d+ lines?\]$/, "").trim();
            let newVal = value.slice(0, lineStart) + newLine + value.slice(lineEnd === -1 ? value.length : lineEnd);
            // Also update the matching ---§ end marker if present
            const oldMarker = `---§ ${title}`;
            const markerIdx = newVal.indexOf(oldMarker, lineStart + newLine.length);
            // End marker doesn't change content — it stays as ---§ Title regardless of depth
            // Adjust format ranges for the hash length change
            const delta = newHashes.length - oldHashes.length;
            const adjusted = adjustRangesForEdit(fmtRanges, lineStart, oldHashes.length, newHashes.length);
            onChange(newVal);
            onFmtChange(adjusted);
            // Update collapsed buffer key if needed (key doesn't change — it's based on title, not hashes)
            requestAnimationFrame(() => {
              ta.selectionStart = cursor + delta;
              ta.selectionEnd = cursor + delta;
              ta.focus();
            });
            return;
          }
        }
      }

      // Protect collapsed section header lines from editing
      if (isOnProtectedLine()) {
        const allowed = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Tab", "Escape", "PageUp", "PageDown", "Enter"];
        const isNav = allowed.includes(e.key) || e.ctrlKey || e.metaKey;
        if (!isNav) {
          e.preventDefault();
          return;
        }
      }

      if (!showMenu || options.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + options.length) % options.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertRef(options[selectedIdx]);
      } else if (e.key === "Escape") {
        setShowMenu(false);
      }
    },
    [showMenu, options, selectedIdx, insertRef, isOnProtectedLine, value, fmtRanges, onChange, onFmtChange]
  );

  const textStyle = "px-[15px] py-1.5 text-[18px] leading-[1.6]";

  return (
    <div className="relative" ref={containerRef}>
      {/* Highlight backdrop — identical text, but table refs purple, field refs blue */}
      <div
        ref={highlightRef}
        aria-hidden
        className={`${textStyle} w-full rounded border overflow-auto whitespace-pre-wrap break-words pointer-events-none`}
        style={{ position: "absolute", inset: 0, borderColor: "var(--color-divider)", backgroundColor: "var(--color-background)", color: "var(--color-text)", zIndex: 0 }}
        dangerouslySetInnerHTML={{ __html: highlightHTML }}
        onMouseOver={(e) => {
          const span = (e.target as HTMLElement).closest("[data-ref-type]") as HTMLElement | null;
          if (span) handleRefHover({ type: span.dataset.refType!, name: span.dataset.refName!, rect: span.getBoundingClientRect() });
        }}
        onMouseOut={(e) => {
          const span = (e.target as HTMLElement).closest("[data-ref-type]") as HTMLElement | null;
          if (span) handleRefHover(null);
        }}
        onClick={(e) => {
          const span = (e.target as HTMLElement).closest("[data-ref-type]") as HTMLElement | null;
          if (span) { e.stopPropagation(); handleRefNavigate(span.dataset.refType!, span.dataset.refName!); }
        }}
        onDoubleClick={(e) => {
          const span = (e.target as HTMLElement).closest("[data-ref-type]") as HTMLElement | null;
          if (span) handleRefNavigate(span.dataset.refType!, span.dataset.refName!);
        }}
      />

      {/* Textarea — transparent text, visible caret. Identical content to highlight div = perfect cursor alignment. */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onMouseUp={checkSelection}
        onSelect={checkSelection}
        onBlur={() => {
          setTimeout(() => setShowMenu(false), 200);
          setTimeout(() => setFormatBar(false), 200);
        }}
        rows={rows}
        placeholder={!value ? placeholder : undefined}
        className={`${textStyle} w-full rounded border focus:outline-none focus:ring-1 resize-y`}
        style={{ borderColor: "var(--color-divider)", backgroundColor: "transparent", color: "transparent", caretColor: "var(--color-text)", position: "relative", zIndex: 1 }}
      />

      {/* Always-visible insert table button — top-right corner */}
      <button
        onMouseDown={(e) => { e.preventDefault(); setShowTableModal(true); }}
        className="absolute flex items-center gap-1.5 px-3 py-1 rounded text-[14px] font-medium hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        style={{ top: 4, right: 8, zIndex: 3, color: "#4ecb71", opacity: 0.7 }}
        title="Insert table (paste markdown)"
      >
        ⊞ Add Table
      </button>

      {/* Collapse arrows + drag handles — positioned on top of textarea at header lines (##–######) */}
      {(() => {
        const sections = parseSections(value);
        if (sections.length === 0) return null;
        // Line height from the textStyle: text-[18px] leading-[1.6] = 18*1.6 = 28.8px
        // Plus padding: py-1.5 = 6px top
        const lineHeight = 28.8;
        const padTop = 6;
        const taHeight = textareaRef.current?.clientHeight || 200;
        const elements: React.ReactNode[] = [];
        sections.forEach((sec) => {
          const isCollapsed = collapsedKeys.has(sec.headerKey);
          const top = padTop + sec.headerLineIdx * lineHeight - taScrollTop;
          // Hide arrows that are scrolled out of view
          if (top + lineHeight < 0 || top > taHeight) return;
          // Indent arrows by depth: depth 1 (##) = 0px, depth 2 (###) = 16px, etc.
          const depthIndent = (sec.depth - 1) * 16;
          const isDragging = dragState?.headerKey === sec.headerKey;
          const arrowColor = getDepthColor(sec.depth);
          elements.push(
            <button
              key={sec.headerKey}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent textarea blur
                // Flush any pending rename before collapse/expand
                if (renameState && renameState.localTitle !== renameState.title) {
                  if (renameTimerRef.current) { clearTimeout(renameTimerRef.current); renameTimerRef.current = null; }
                  flushRename(renameState.localTitle, renameState);
                  setRenameState(null);
                  // Defer collapse/expand to next frame so flushed value is picked up
                  requestAnimationFrame(() => {
                    if (isCollapsed) expandSection(sec.headerKey);
                    else collapseSection(sec.headerKey);
                  });
                  return;
                }
                if (renameState) setRenameState(null);
                if (isCollapsed) expandSection(sec.headerKey);
                else collapseSection(sec.headerKey);
              }}
              className="absolute flex items-center justify-center"
              style={{
                left: -2 + depthIndent,
                top,
                width: 28,
                height: lineHeight,
                zIndex: 2,
                cursor: "pointer",
                color: arrowColor,
                fontSize: 22,
                userSelect: "none",
                opacity: isDragging ? 0.4 : 1,
              }}
              title={isCollapsed ? `Expand "${sec.headerTitle}"` : `Collapse "${sec.headerTitle}"`}
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          );
          {/* Drag handle — only visible on collapsed sections, appears to the right of the arrow */}
          if (isCollapsed) {
            elements.push(
              <div
                key={`drag-${sec.headerKey}`}
                onMouseDown={(e) => startDrag(sec.headerKey, e)}
                className="absolute flex items-center justify-center"
                style={{
                  left: 24 + depthIndent,
                  top,
                  width: 20,
                  height: lineHeight,
                  zIndex: 3,
                  cursor: isDragging ? "grabbing" : "grab",
                  color: "var(--color-text-muted)",
                  fontSize: 14,
                  userSelect: "none",
                  opacity: isDragging ? 0.4 : 0.5,
                }}
                title={`Drag to reorder "${sec.headerTitle}"`}
              >
                ⠿
              </div>
            );
          }
          // Clickable title zone + rename input — works for both collapsed and expanded headers
          const isRenaming = renameState?.headerKey === sec.headerKey;
          if (!isRenaming) {
            elements.push(
              <div
                key={`title-click-${sec.headerKey}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openRename(sec);
                }}
                className="absolute"
                style={{
                  left: 44 + depthIndent,
                  top,
                  right: isCollapsed ? 120 : 40,
                  height: lineHeight,
                  zIndex: 4,
                  cursor: "text",
                }}
              />
            );
          }
          if (isRenaming) {
            elements.push(
              <input
                key={`rename-${sec.headerKey}`}
                ref={renameInputRef}
                type="text"
                value={renameState.localTitle}
                onChange={(e) => handleRenameInput(e.target.value)}
                onBlur={closeRename}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); closeRename(); } }}
                className="absolute rounded px-1"
                style={{
                  left: 44 + depthIndent,
                  top: top + 2,
                  right: isCollapsed ? 120 : 40,
                  height: lineHeight - 4,
                  zIndex: 10,
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--color-text)",
                  backgroundColor: "var(--color-surface)",
                  border: `1px solid ${arrowColor}`,
                  outline: "none",
                  lineHeight: `${lineHeight - 4}px`,
                }}
              />
            );
          }
        });
        {/* Section border boxes — colored 1px border around each section's range */}
        const textLines = value.split("\n");
        sections.forEach((sec) => {
          const boxColor = getDepthColor(sec.depth);
          const isCollapsed = collapsedKeys.has(sec.headerKey);
          // Box starts at the header line, ends at the body end line
          const bodyEndLineIdx = isCollapsed
            ? sec.headerLineIdx // collapsed = single line
            : Math.min(value.slice(0, sec.bodyEnd).split("\n").length - 1, textLines.length - 1);
          let boxTop = padTop + sec.headerLineIdx * lineHeight - taScrollTop;
          let boxBottom = padTop + (bodyEndLineIdx + 1) * lineHeight - taScrollTop;
          // Skip if entirely out of view
          if (boxBottom < 0 || boxTop > taHeight) return;
          // Clamp to textarea visible bounds so boxes never extend outside
          boxTop = Math.max(0, boxTop);
          boxBottom = Math.min(taHeight, boxBottom);
          const boxHeight = boxBottom - boxTop;
          if (boxHeight <= 0) return;
          // Depth offsets from component edge: depth 1=3px, 2=5px, 3=7px, 4=9px, 5=11px
          const depthOffsets = [3, 5, 7, 9, 11];
          const boxLeft = depthOffsets[Math.min(sec.depth - 1, depthOffsets.length - 1)];
          elements.push(
            <div
              key={`box-${sec.headerKey}`}
              className="absolute pointer-events-none"
              style={{
                left: boxLeft,
                top: boxTop,
                right: 0,
                height: boxHeight,
                border: `1px solid ${boxColor}`,
                borderRadius: 2,
                opacity: 0.25,
                zIndex: 1,
              }}
            />
          );
        });
        {/* Drop indicator line */}
        if (dragState && dropLineIdx !== null) {
          const indicatorTop = padTop + dropLineIdx * lineHeight - taScrollTop - 1;
          elements.push(
            <div
              key="drop-indicator"
              className="absolute pointer-events-none"
              style={{
                left: 0,
                right: 0,
                top: indicatorTop,
                height: 2,
                backgroundColor: "#f2b661",
                zIndex: 10,
                borderRadius: 1,
              }}
            />
          );
        }
        return elements;
      })()}

      {/* Floating format toolbar — appears on text selection */}
      {formatBar && (
        <div
          className="absolute z-50 flex items-center gap-0 rounded-lg border shadow-xl overflow-hidden"
          style={{ top: -28, right: 4, backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}
        >
          {([
            { type: "bold" as FmtType, label: "B", style: { fontWeight: 900 }, title: "Bold" },
            { type: "underline" as FmtType, label: "U", style: { textDecoration: "underline", textDecorationThickness: "2px" }, title: "Underline" },
            { type: "dblunderline" as FmtType, label: "U", style: { textDecoration: "underline double" }, title: "Double underline" },
            { type: "strike" as FmtType, label: "S", style: { textDecoration: "line-through" }, title: "Strikethrough" },
            { type: "highlight" as FmtType, label: "H", style: { color: "#f2b661", background: "rgba(242,182,97,0.12)" }, title: "Highlight" },
          ]).map((btn) => (
            <button key={btn.type} onMouseDown={(e) => { e.preventDefault(); handleFormat(btn.type); }}
              className="w-10 h-10 flex items-center justify-center text-[16px] hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              style={{ color: "var(--color-text)", ...btn.style }} title={btn.title}>
              {btn.label}
            </button>
          ))}

          <div className="w-px h-7 mx-0.5" style={{ backgroundColor: "var(--color-divider)" }} />

          {([
            { type: "red" as FmtType, color: "#e05555" },
            { type: "yellow" as FmtType, color: "#f2b661" },
            { type: "green" as FmtType, color: "#4ecb71" },
          ]).map((btn) => (
            <button key={btn.type} onMouseDown={(e) => { e.preventDefault(); handleFormat(btn.type); }}
              className="w-10 h-10 flex items-center justify-center text-[16px] font-bold hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              style={{ color: btn.color }} title={`${btn.type} text`}>
              A
            </button>
          ))}

          <div className="w-px h-7 mx-0.5" style={{ backgroundColor: "var(--color-divider)" }} />

          <button onMouseDown={(e) => { e.preventDefault(); handleList("bullet"); }}
            className="w-10 h-10 flex items-center justify-center text-[16px] hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-text)" }} title="Bullet list">&#8226;</button>
          <button onMouseDown={(e) => { e.preventDefault(); handleList("number"); }}
            className="w-10 h-10 flex items-center justify-center text-[14px] hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-text)" }} title="Numbered list">1.</button>

          <div className="w-px h-7 mx-0.5" style={{ backgroundColor: "var(--color-divider)" }} />

          <button onMouseDown={(e) => { e.preventDefault(); handleSection(); }}
            className="w-10 h-10 flex items-center justify-center text-[14px] hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-text)", fontWeight: 700 }} title="Toggle collapsible section (## header)">§</button>
          <button onMouseDown={(e) => { e.preventDefault(); setShowTableModal(true); setFormatBar(false); }}
            className="w-10 h-10 flex items-center justify-center text-[13px] hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            style={{ color: "#5bc0de" }} title="Insert table (paste markdown)">⊞</button>

          <div className="w-px h-7 mx-0.5" style={{ backgroundColor: "var(--color-divider)" }} />

          <button onMouseDown={(e) => { e.preventDefault(); handleClear(); }}
            className="w-10 h-10 flex items-center justify-center text-[14px] hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-text-muted)" }} title="Clear formatting">✕</button>
        </div>
      )}

      {/* Autocomplete dropdown */}
      {showMenu && (options.length > 0 || (query.length > 0 && !imageOnlyMode)) && !createMode && (
        <div
          className="absolute z-50 rounded-lg border shadow-xl overflow-hidden"
          style={{ top: menuPos.top, left: 0, width: 320, maxHeight: 300, backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}
        >
          <div className="px-2 py-1.5 border-b" style={{ borderColor: "var(--color-divider)" }}>
            <div className="flex gap-1 mb-1 flex-wrap">
              {([
                { key: "table" as MentionType, label: "Tables", color: "#a855f7" },
                { key: "field" as MentionType, label: "Fields", color: "#5bc0de" },
                { key: "module" as MentionType, label: "Modules", color: "#e67d4a" },
                { key: "feature" as MentionType, label: "Features", color: "#a855f7" },
                { key: "concept" as MentionType, label: "Concepts", color: "#f2b661" },
                { key: "image" as MentionType, label: "Images", color: "#4ecb71" },
              ] as const).map((pill) => {
                const isActive = activeTypes.has(pill.key);
                return (
                  <button
                    key={pill.key}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setActiveTypes((prev) => {
                        const next = new Set(prev);
                        if (next.has(pill.key)) { if (next.size > 1) next.delete(pill.key); }
                        else next.add(pill.key);
                        return next;
                      });
                      setSelectedIdx(0);
                    }}
                    className="px-2 py-0.5 rounded-full font-medium transition-all"
                    style={{
                      fontSize: "11px",
                      backgroundColor: isActive ? `${pill.color}22` : "transparent",
                      color: isActive ? pill.color : "var(--color-text-muted)",
                      border: `1px solid ${isActive ? `${pill.color}66` : "var(--color-divider)"}`,
                      opacity: isActive ? 1 : 0.5,
                    }}
                  >{pill.label}</button>
                );
              })}
            </div>
            <div className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>↑↓ navigate &middot; Enter select</div>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            {options.map((opt, i) => {
              const badgeStyle = opt.type === "table"
                ? { bg: "rgba(168,85,247,0.15)", color: "#a855f7", label: "TBL" }
                : opt.type === "image"
                ? { bg: "rgba(78,203,113,0.15)", color: "#4ecb71", label: "IMG" }
                : opt.type === "module"
                ? { bg: "rgba(230,125,74,0.15)", color: "#e67d4a", label: "MOD" }
                : opt.type === "feature"
                ? { bg: "rgba(168,85,247,0.15)", color: "#a855f7", label: "FTR" }
                : opt.type === "concept"
                ? { bg: "rgba(242,182,97,0.15)", color: "#f2b661", label: "CON" }
                : { bg: "rgba(91,192,222,0.15)", color: "#5bc0de", label: "FLD" };
              return (
                <div
                  key={`${opt.type}-${opt.imageId || opt.id}`}
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-xs"
                  style={{ backgroundColor: i === selectedIdx ? "var(--color-primary)" : "transparent", color: i === selectedIdx ? "var(--color-primary-text)" : "var(--color-text)" }}
                  onMouseDown={(e) => { e.preventDefault(); insertRef(opt); }}
                  onMouseEnter={() => setSelectedIdx(i)}
                >
                  <span className="text-[10px] font-bold rounded px-1 py-0.5" style={{
                    backgroundColor: badgeStyle.bg,
                    color: badgeStyle.color,
                  }}>
                    {badgeStyle.label}
                  </span>
                  <span className="truncate">
                    {opt.parentLabel ? <span style={{ color: i === selectedIdx ? "var(--color-primary-text)" : "var(--color-text-muted)" }}>{opt.parentLabel}.</span> : null}
                    {opt.label}
                  </span>
                </div>
              );
            })}
            {/* Create new table/field options */}
            {query.length > 0 && !imageOnlyMode && onCreateRef && (
              <>
                <div className="border-t my-1" style={{ borderColor: "var(--color-divider)" }} />
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-xs hover:bg-black/5"
                  style={{ color: "#4ecb71" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const snake = toSnakeCase(query);
                    setCreateMode({ type: "table", step: "confirm", snakeName: snake, rawName: query });
                    setCreateEditName(snake);
                    setCreateTableDesc("");
                    setCreateTableOwnership("org_private");
                    setCreateTableStatus("planned");
                  }}
                >
                  <span className="text-[10px] font-bold rounded px-1 py-0.5" style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71" }}>+</span>
                  <span>Create table <strong>&quot;{toSnakeCase(query)}&quot;</strong> <span style={{ color: "var(--color-text-muted)" }}>(planned)</span></span>
                </div>
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-xs hover:bg-black/5"
                  style={{ color: "#5bc0de" }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const snake = toSnakeCase(query);
                    const rawName = query;
                    setShowMenu(false);
                    if (onPickTableForField) {
                      // Delegate to parent — parent handles table picker + confirmation + insertion
                      onPickTableForField(snake, rawName);
                    } else {
                      setCreateMode({ type: "field", step: "pick-table", snakeName: snake, rawName });
                      setCreateEditName(snake);
                      setCreateTableId(null);
                    }
                  }}
                >
                  <span className="text-[10px] font-bold rounded px-1 py-0.5" style={{ backgroundColor: "rgba(91,192,222,0.15)", color: "#5bc0de" }}>+</span>
                  <span>Create field <strong>&quot;{toSnakeCase(query)}&quot;</strong> <span style={{ color: "var(--color-text-muted)" }}>(planned)</span></span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create new reference confirmation/table-picker overlay */}
      {createMode && (
        <div
          className="absolute z-50 rounded-lg border shadow-xl p-4 space-y-3"
          style={{ top: menuPos.top, left: 0, width: (createMode.type === "field" && createMode.step === "pick-table") ? 700 : (createMode.type === "table" ? 440 : 340), backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}
        >
          <div className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
            {createMode.type === "table" ? "Create New Table (planned)" : createMode.step === "pick-table" ? "Select Table for New Field" : "Create New Field (planned)"}
          </div>

          {/* Table picker step for fields — searchable combo box */}
          {createMode.type === "field" && createMode.step === "pick-table" && (() => {
            const q = tablePickerSearch.toLowerCase();
            const detailMap = new Map((tableDetails || []).map((d) => [d.tableId as number, d]));
            const filtered = tables.filter((t) => t.name.toLowerCase().includes(q));
            return (
              <div className="space-y-2">
                <label className="text-[10px] block" style={{ color: "var(--color-text-muted)" }}>Which table does this field belong to?</label>
                <input
                  type="text"
                  className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1 font-mono"
                  style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                  placeholder="Search tables..."
                  value={tablePickerSearch}
                  onChange={(e) => { setTablePickerSearch(e.target.value); setTablePickerIdx(0); }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") { e.preventDefault(); setTablePickerIdx((i) => Math.min(i + 1, filtered.length - 1)); }
                    else if (e.key === "ArrowUp") { e.preventDefault(); setTablePickerIdx((i) => Math.max(i - 1, 0)); }
                    else if (e.key === "Enter" && filtered[tablePickerIdx]) { e.preventDefault(); setCreateTableId(filtered[tablePickerIdx].id); setCreateMode({ ...createMode!, step: "confirm" }); }
                    else if (e.key === "Escape") { setCreateMode(null); setShowMenu(false); }
                  }}
                />
                {createTableId && (
                  <div className="text-[10px] px-2 py-1 rounded" style={{ backgroundColor: "rgba(168,85,247,0.12)", color: "#a855f7" }}>
                    Selected: {tables.find((t) => t.id === createTableId)?.name}
                  </div>
                )}
                <div className="overflow-y-auto rounded border" style={{ maxHeight: 220, borderColor: "var(--color-divider)" }}>
                  <table className="w-full text-[10px]" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--color-divider)", position: "sticky", top: 0, backgroundColor: "var(--color-background)" }}>
                        <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-muted)" }}>Table</th>
                        <th className="text-left px-2 py-1 font-semibold w-14" style={{ color: "var(--color-text-muted)" }}>Status</th>
                        <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-muted)" }}>Description</th>
                        <th className="text-left px-2 py-1 font-semibold w-20" style={{ color: "var(--color-text-muted)" }}>Ownership</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t, i) => {
                        const detail = detailMap.get(t.id);
                        const isSelected = createTableId === t.id;
                        const isHighlighted = i === tablePickerIdx;
                        return (
                          <tr
                            key={t.id}
                            className="cursor-pointer"
                            style={{
                              borderBottom: "1px solid var(--color-divider)",
                              backgroundColor: isSelected ? "rgba(168,85,247,0.15)" : isHighlighted ? "rgba(255,255,255,0.05)" : "transparent",
                            }}
                            onMouseDown={(e) => { e.preventDefault(); setCreateTableId(t.id); setCreateMode({ ...createMode!, step: "confirm" }); }}
                            onMouseEnter={() => setTablePickerIdx(i)}
                          >
                            <td className="px-2 py-1 font-mono" style={{ color: "var(--color-text)" }}>{t.name}</td>
                            <td className="px-2 py-1">
                              {detail?.tableStatus ? (
                                <span className="px-1 py-0.5 rounded text-[9px]" style={{
                                  backgroundColor: String(detail.tableStatus) === "live" ? "rgba(78,203,113,0.15)" : "rgba(242,182,97,0.15)",
                                  color: String(detail.tableStatus) === "live" ? "#4ecb71" : "#f2b661",
                                }}>{String(detail.tableStatus)}</span>
                              ) : "—"}
                            </td>
                            <td className="px-2 py-1 truncate max-w-[200px]" style={{ color: "var(--color-text-muted)" }}>
                              {detail?.descriptionPurpose ? String(detail.descriptionPurpose).slice(0, 60) : "—"}
                            </td>
                            <td className="px-2 py-1" style={{ color: "var(--color-text-muted)" }}>
                              {detail?.recordOwnership ? String(detail.recordOwnership) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && (
                        <tr><td colSpan={4} className="px-2 py-3 text-center" style={{ color: "var(--color-text-muted)" }}>No tables match</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2 justify-end">
                  <button className="px-3 py-1 text-xs rounded" style={{ color: "var(--color-text-muted)" }} onMouseDown={(e) => { e.preventDefault(); setCreateMode(null); setShowMenu(false); }}>Cancel</button>
                </div>
              </div>
            );
          })()}

          {/* Name confirmation step */}
          {createMode.step === "confirm" && (
            <div className="space-y-2">
              {createMode.snakeName !== createMode.rawName && (
                <div className="text-[10px] px-2 py-1 rounded" style={{ backgroundColor: "rgba(242,182,97,0.12)", color: "#f2b661" }}>
                  Converted to snake_case: &quot;{createMode.rawName}&quot; → &quot;{createMode.snakeName}&quot;
                </div>
              )}
              <label className="text-[10px] block" style={{ color: "var(--color-text-muted)" }}>
                {createMode.type === "table" ? "Table name:" : `Field name (in ${tables.find((t) => t.id === createTableId)?.name || "?"}):`}
              </label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1 font-mono"
                style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                value={createEditName}
                onChange={(e) => setCreateEditName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setCreateMode(null); setShowMenu(false); }
                }}
              />
              {/* Extra fields for table creation */}
              {createMode.type === "table" && (
                <>
                  <label className="text-[10px] block" style={{ color: "var(--color-text-muted)" }}>Description / purpose:</label>
                  <textarea
                    className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
                    style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", resize: "vertical", minHeight: 48 }}
                    rows={2}
                    placeholder="What is this table for?"
                    value={createTableDesc}
                    onChange={(e) => setCreateTableDesc(e.target.value)}
                  />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] block mb-1" style={{ color: "var(--color-text-muted)" }}>Status:</label>
                      <select
                        className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        value={createTableStatus}
                        onChange={(e) => setCreateTableStatus(e.target.value)}
                      >
                        <option value="planned">Planned</option>
                        <option value="in_progress">In Progress</option>
                        <option value="live">Live</option>
                        <option value="deprecated">Deprecated</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] block mb-1" style={{ color: "var(--color-text-muted)" }}>Record ownership:</label>
                      <select
                        className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        value={createTableOwnership}
                        onChange={(e) => setCreateTableOwnership(e.target.value)}
                      >
                        <option value="org_private">Org Private</option>
                        <option value="org_shared">Org Shared</option>
                        <option value="user_private">User Private</option>
                        <option value="system">System</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
              <div className="flex gap-2 justify-end">
                <button className="px-3 py-1 text-xs rounded" style={{ color: "var(--color-text-muted)" }} onMouseDown={(e) => { e.preventDefault(); setCreateMode(null); setShowMenu(false); }}>Cancel</button>
                <button
                  className="px-3 py-1 text-xs rounded"
                  style={{ backgroundColor: createEditName.trim() ? "var(--color-primary)" : "var(--color-divider)", color: createEditName.trim() ? "var(--color-primary-text)" : "var(--color-text-muted)" }}
                  disabled={!createEditName.trim()}
                  onMouseDown={async (e) => {
                    e.preventDefault();
                    if (!onCreateRef || !createEditName.trim()) return;
                    const finalName = toSnakeCase(createEditName.trim());
                    const opts = createMode.type === "table"
                      ? { description: createTableDesc || undefined, recordOwnership: createTableOwnership, tableStatus: createTableStatus }
                      : { parentTableId: createTableId ?? undefined };
                    const result = await onCreateRef(createMode.type, finalName, opts);
                    if (result) {
                      // Insert the reference into the textarea — replace from triggerIdx through the query text
                      const ta = textareaRef.current;
                      if (ta && triggerIdx >= 0) {
                        const parentTable = createMode.type === "field" ? tables.find((t) => t.id === createTableId) : null;
                        // Insert display format — wrapper converts to (t:ID:name) on blur
                        const storedToken = createMode.type === "table"
                          ? `(${result.name})`
                          : `(${parentTable?.name || "?"}.${result.name})`;
                        const before = value.slice(0, triggerIdx);
                        // Replace the "(" + query text that the user typed to trigger the menu
                        const afterIdx = triggerIdx + 1 + createMode.rawName.length; // 1 for the "("
                        const after = value.slice(afterIdx);
                        const newVal = before + storedToken + after;
                        onChange(newVal);
                        requestAnimationFrame(() => {
                          const pos = triggerIdx + storedToken.length;
                          ta.selectionStart = pos;
                          ta.selectionEnd = pos;
                          ta.focus();
                        });
                      }
                    }
                    setCreateMode(null);
                    setShowMenu(false);
                  }}
                >
                  Create
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reference hover tooltip */}
      {tooltipVisible && refTooltip && (() => {
        const { type, name, rect } = refTooltip;
        const tooltipStyle: React.CSSProperties = {
          position: "fixed",
          top: rect.bottom + 6,
          left: rect.left,
          zIndex: 100,
          maxWidth: type === "image" ? 1200 : 320,
          backgroundColor: "var(--color-background)",
          border: "1px solid var(--color-divider)",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          padding: type === "image" ? 4 : 12,
          fontSize: 11,
          color: "var(--color-text)",
          pointerEvents: "none",
        };

        if (type === "image") {
          const img = images?.find((i) => i.title === name);
          if (!img?.url) return null;
          return (
            <div style={tooltipStyle}>
              <img src={img.url} alt={name} style={{ maxWidth: 1200, maxHeight: 1200, borderRadius: 6, display: "block" }} />
            </div>
          );
        }

        if (type === "table") {
          const tbl = tables.find((t) => t.name === name);
          return (
            <div style={tooltipStyle}>
              <div style={{ fontWeight: 600, color: "#a855f7", marginBottom: 4 }}>{name}</div>
              {tbl && <div style={{ color: "var(--color-text-muted)" }}>Table #{tbl.id}</div>}
              <div style={{ marginTop: 6, fontSize: 10, color: "var(--color-text-muted)" }}>Double-click to navigate</div>
            </div>
          );
        }

        if (type === "field") {
          const parts = name.split(".");
          const tblName = parts[0];
          const fldName = parts.slice(1).join(".");
          const fld = fields.find((f) => f.tableName === tblName && f.name === fldName);
          return (
            <div style={tooltipStyle}>
              <div style={{ fontWeight: 600, color: "#5bc0de", marginBottom: 4 }}>{name}</div>
              {fld && <div style={{ color: "var(--color-text-muted)" }}>Field #{fld.id} · Table: {fld.tableName}</div>}
              <div style={{ marginTop: 6, fontSize: 10, color: "var(--color-text-muted)" }}>Double-click to navigate</div>
            </div>
          );
        }

        return null;
      })()}

      {/* Expand/Collapse buttons on table token lines */}
      {(() => {
        const tableTokens: Array<{ id: string; lineIdx: number }> = [];
        const lines = value.split("\n");
        lines.forEach((line, i) => {
          const m = line.match(/^\[TABLE:([^\]]+)\]$/);
          if (m) tableTokens.push({ id: m[1], lineIdx: i });
        });
        if (tableTokens.length === 0) return null;
        const lineHeight = 28.8;
        const padTop = 6;
        return tableTokens.map(({ id, lineIdx }) => {
          const tableData = tableDataRef.current.get(id);
          if (!tableData) return null;
          const isExpanded = expandedTableIds.has(id);
          const top = padTop + lineIdx * lineHeight - taScrollTop;
          const titleText = `📊 ${tableData.title}`;
          const titlePixelWidth = titleText.length * 10.8 + 24;
          const btnLeft = titlePixelWidth + 15;
          return (
            <button
              key={`tbl-toggle-${id}`}
              onMouseDown={(e) => {
                e.preventDefault();
                if (isExpanded) {
                  setExpandedTableIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
                } else {
                  // Set initial panel position near the token
                  if (!tablePanelPos.has(id) && containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect();
                    setTablePanelPos((prev) => {
                      const n = new Map(prev);
                      n.set(id, { x: rect.left + 20, y: rect.top + top + lineHeight + 10 });
                      return n;
                    });
                  }
                  setExpandedTableIds((prev) => new Set([...prev, id]));
                }
              }}
              className="absolute flex items-center gap-1 px-2 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
              style={{
                left: btnLeft,
                top,
                height: lineHeight,
                zIndex: 2,
                cursor: "pointer",
                color: "#5bc0de",
                fontSize: 13,
                fontWeight: 500,
                userSelect: "none",
              }}
              title={isExpanded ? "Collapse table" : "Expand table"}
            >
              {isExpanded ? "▴ Collapse" : "▾ Expand"}
            </button>
          );
        });
      })()}

      {/* Reference view buttons — positioned from actual DOM positions of ref spans */}
      {(() => {
        void taScrollTop; // dependency: re-position buttons on scroll
        if (!onRefNavigate || !highlightRef.current) return null;
        const spans = highlightRef.current.querySelectorAll("[data-ref-type]");
        if (spans.length === 0) return null;
        const btnWidth = 11;
        return Array.from(spans).map((span, i) => {
          const el = span as HTMLElement;
          const type = el.dataset.refType!;
          const name = el.dataset.refName!;
          const top = el.offsetTop;
          const left = el.offsetLeft;
          const height = el.offsetHeight;
          const adjustedTop = top - taScrollTop;
          const taHeight = highlightRef.current?.clientHeight ?? 400;
          if (adjustedTop < -10 || adjustedTop > taHeight) return null;
          const color = type === "module" ? "#e67d4a" : type === "feature" ? "#a855f7" : type === "field" ? "#5bc0de" : type === "concept" ? "#f2b661" : type === "research" ? "#5bc0de" : "#a855f7";
          return (
            <button
              key={`ref-btn-${i}-${type}-${name}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleRefNavigate(type, name);
              }}
              className="absolute flex items-center justify-center rounded hover:brightness-125"
              style={{
                left: left - btnWidth - 3,
                top: top - taScrollTop + 2,
                width: btnWidth,
                height: Math.max(height - 4, 16),
                zIndex: 2,
                cursor: "pointer",
                color,
                fontSize: 16,
                fontWeight: 600,
                userSelect: "none",
                background: `${color}22`,
                borderRadius: 4,
                border: `1px solid ${color}44`,
              }}
              title={`View ${name}`}
            >
              ↗
            </button>
          );
        });
      })()}

      {/* Floating draggable table panels */}
      {Array.from(expandedTableIds).map((id) => {
        const tableData = tableDataRef.current.get(id);
        const pos = tablePanelPos.get(id);
        if (!tableData || !pos) return null;
        const panelColor = tableColorMap.get(id) || "#5bc0de";
        return (
          <div
            key={`panel-${id}`}
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              zIndex: 50,
              maxWidth: "80vw",
              maxHeight: "70vh",
              overflow: "auto",
              boxShadow: `0 8px 32px rgba(0,0,0,0.35), 0 0 0 2px ${panelColor}40`,
              borderRadius: 8,
              borderLeft: `12px solid ${panelColor}`,
            }}
          >
            {/* Single merged header row — entire bar is draggable */}
            <div
              className="flex items-center justify-between px-3 py-1.5 rounded-t-lg"
              style={{
                backgroundColor: "var(--color-surface, #1a1a2e)",
                borderBottom: "1px solid var(--color-divider)",
                userSelect: "none",
                cursor: "grab",
              }}
              onMouseDown={(e) => {
                // Only start drag if not clicking a button/interactive element
                if ((e.target as HTMLElement).closest("button, input, [data-no-drag]")) return;
                e.preventDefault();
                tableDrag.current = { id, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
                const onMove = (ev: MouseEvent) => {
                  if (!tableDrag.current) return;
                  const dx = ev.clientX - tableDrag.current.startX;
                  const dy = ev.clientY - tableDrag.current.startY;
                  setTablePanelPos((prev) => {
                    const n = new Map(prev);
                    n.set(tableDrag.current!.id, {
                      x: tableDrag.current!.origX + dx,
                      y: tableDrag.current!.origY + dy,
                    });
                    return n;
                  });
                };
                const onUp = () => {
                  tableDrag.current = null;
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            >
              <span className="text-[20px] font-semibold flex items-center gap-1.5" style={{ color: "#5bc0de" }}>
                📊 <span
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  className="outline-none border-b border-transparent hover:border-[#5bc0de44] focus:border-[#5bc0de] transition-colors"
                  style={{ minWidth: 40, cursor: "text" }}
                  onBlur={(e) => {
                    const newTitle = e.currentTarget.textContent?.trim();
                    if (newTitle && newTitle !== tableData.title) {
                      updateTableData(id, { ...tableData, title: newTitle });
                    } else if (!newTitle) {
                      e.currentTarget.textContent = tableData.title;
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                  onMouseDown={(e) => e.stopPropagation()}
                >{tableData.title}</span>
                <span className="text-[11px]" style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                  ({tableData.headers.length}×{tableData.rows.length + 1})
                </span>
              </span>
              <div className="flex items-center gap-1">
                {/* Height slider dropdown */}
                <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      if (!heightSnapshotRef.current.has(id)) {
                        heightSnapshotRef.current.set(id, tableData.rowHeights ? [...tableData.rowHeights] : tableData.rows.map(() => 28));
                      }
                      setHeightSliderId((prev) => prev === id ? null : id);
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                    style={{ color: "#5bc0de" }}
                    title="Set height for all rows"
                  >↕ Height</button>
                  {heightSliderId === id && (
                    <>
                      {/* Click-outside backdrop */}
                      <div className="fixed inset-0 z-[299]" onClick={() => setHeightSliderId(null)} />
                      <div
                        className="fixed z-[300] rounded-lg border shadow-2xl p-3 flex items-end gap-3"
                        style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", height: 200, top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
                        data-no-drag
                      >
                        <div className="flex flex-col items-center gap-1 h-full">
                          <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>300</span>
                          <input
                            type="range"
                            min={20}
                            max={300}
                            value={tableData.rowHeights?.[0] ?? 28}
                            onChange={(e) => {
                              const h = parseInt(e.target.value);
                              updateTableData(id, { ...tableData, rowHeights: tableData.rows.map(() => h) });
                            }}
                            className="flex-1"
                            style={{ writingMode: "vertical-lr", direction: "rtl", width: 24 }}
                          />
                          <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>20</span>
                        </div>
                        <div className="flex flex-col gap-2 justify-end">
                          <span className="text-sm font-mono text-center font-semibold" style={{ color: "var(--color-text)" }}>
                            {tableData.rowHeights?.[0] ?? 28}px
                          </span>
                          <button
                            onClick={() => {
                              const snapshot = heightSnapshotRef.current.get(id);
                              if (snapshot) {
                                updateTableData(id, { ...tableData, rowHeights: [...snapshot] });
                                heightSnapshotRef.current.delete(id);
                              }
                              setHeightSliderId(null);
                            }}
                            className="text-[10px] px-2 py-1 rounded hover:bg-black/10 dark:hover:bg-white/10 whitespace-nowrap"
                            style={{ color: "#f2b661" }}
                            title="Revert to previous per-row heights"
                          >↩ Revert</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => updateTableData(id, { ...tableData, rows: [...tableData.rows, new Array(tableData.headers.length).fill("")] })}
                  className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                  style={{ color: "#4ecb71" }}
                  title="Add row"
                >+ Row</button>
                <button
                  onClick={() => updateTableData(id, { ...tableData, headers: [...tableData.headers, ""], rows: tableData.rows.map((r) => [...r, ""]) })}
                  className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                  style={{ color: "#4ecb71" }}
                  title="Add column"
                >+ Col</button>
                <button
                  onClick={() => setExpandedTableIds((prev) => { const n = new Set(prev); n.delete(id); return n; })}
                  className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                  style={{ color: "#5bc0de" }}
                >▴ Collapse</button>
                {tableUndoStack.current.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); undoTableAction(); }}
                    className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                    style={{ color: "#f2b661" }}
                    title={`Undo last table edit (${tableUndoStack.current.length})`}
                  >↩ Undo</button>
                )}
                <button
                  onClick={() => deleteTable(id)}
                  className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                  style={{ color: "#e05555" }}
                  title="Delete table"
                >✕</button>
                {/* Help popover toggle — far right, after delete */}
                <button
                  ref={(el) => { if (el) helpBtnRefs.current.set(id, el); }}
                  onClick={() => setTableHelpId((prev) => prev === id ? null : id)}
                  className="text-[16px] leading-none px-1.5 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 font-bold"
                  style={{ color: "var(--color-text-muted)" }}
                  title="Table help"
                >?</button>
              </div>
            </div>
            <InlineTableGrid
              table={tableData}
              onChange={(updated) => updateTableData(id, updated)}
              onCollapse={() => setExpandedTableIds((prev) => { const n = new Set(prev); n.delete(id); return n; })}
              onDelete={() => deleteTable(id)}
              onHeaderMouseDown={(e) => {
                e.preventDefault();
                tableDrag.current = { id, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
                const onMove = (ev: MouseEvent) => {
                  if (!tableDrag.current) return;
                  const dx = ev.clientX - tableDrag.current.startX;
                  const dy = ev.clientY - tableDrag.current.startY;
                  setTablePanelPos((prev) => {
                    const n = new Map(prev);
                    n.set(tableDrag.current!.id, {
                      x: tableDrag.current!.origX + dx,
                      y: tableDrag.current!.origY + dy,
                    });
                    return n;
                  });
                };
                const onUp = () => {
                  tableDrag.current = null;
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            />
          </div>
        );
      })}

      {/* Help popover — rendered fixed so it escapes overflow:auto parents */}
      {tableHelpId && (() => {
        const btn = helpBtnRefs.current.get(tableHelpId);
        if (!btn) return null;
        const rect = btn.getBoundingClientRect();
        return (
          <div
            className="fixed z-[400] rounded-lg border shadow-2xl p-3"
            style={{
              backgroundColor: "var(--color-background)",
              borderColor: "var(--color-divider)",
              width: 540,
              top: rect.bottom + 6,
              right: Math.max(8, window.innerWidth - rect.right),
            }}
            data-no-drag
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold" style={{ color: "#5bc0de" }}>Table Reference</span>
              <button onClick={() => setTableHelpId(null)} className="text-xs px-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>✕</button>
            </div>
            <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
                  <th className="text-left px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-muted)", width: 170 }}>Action</th>
                  <th className="text-left px-2 py-1.5 font-semibold" style={{ color: "var(--color-text-muted)" }}>How</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["📊", "#5bc0de", "Move table", "Drag anywhere on the title bar or column headers"],
                  ["✎", "var(--color-text)", "Edit a cell", "Click any cell to start editing"],
                  ["⇥", "var(--color-text)", "Navigate cells", "Tab → next · Shift+Tab → prev · Enter → down · Esc → cancel"],
                  ["↔", "#5bc0de", "Resize column", "Drag the right edge of any column header"],
                  ["↕", "#5bc0de", "Resize row", "Drag the bottom edge of the first cell in a row"],
                  ["⤢", "#5bc0de", "Fit column", "Double-click a column's right edge"],
                  ["⤢", "#5bc0de", "Fit row", "Double-click a row's bottom edge"],
                  ["↕", "#5bc0de", "All row heights", "Click ↕ Height and use the slider"],
                  ["+", "#4ecb71", "Row", "Click + Row in the header bar"],
                  ["+", "#4ecb71", "Col", "Click + Col in the header bar"],
                  ["✕", "#e05555", "Delete row", "Hover over a row → click ✕ on the right edge"],
                  ["✕", "#e05555", "Delete column", "Hover over a column header → click ✕"],
                  ["▴", "#5bc0de", "Collapse", "Click ▴ Collapse to hide the grid (token stays in text)"],
                  ["▾", "#5bc0de", "Expand", "Click ▾ Expand on the table badge in the textarea"],
                  ["✕", "#e05555", "Delete table", "Click ✕ (red) in the header bar"],
                ] as [string, string, string, string][]).map(([icon, iconColor, action, how], i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--color-divider)" }}>
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                      <span style={{ color: iconColor, marginRight: 6 }}>{icon}</span>{action}
                    </td>
                    <td className="px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>{how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Table paste modal */}
      {showTableModal && (
        <TablePasteModal
          onInsert={insertTable}
          onClose={() => setShowTableModal(false)}
          existingTables={Array.from(tableDataRef.current.entries()).map(([id, t]) => ({
            id,
            title: t.title,
            cols: t.headers.length,
            rows: t.rows.length,
            headers: t.headers,
            data: t.rows,
            referencedIn: noteContext || { field: "This note" },
          }))}
          onUpdateTable={(id, headers, rows) => {
            const existing = tableDataRef.current.get(id);
            if (existing) {
              updateTableData(id, { ...existing, headers, rows });
            }
          }}
        />
      )}
    </div>
  );
}
