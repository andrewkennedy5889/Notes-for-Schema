

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MentionTextarea } from "./MentionTextarea";
import { rawToDisplay, displayToRaw, FmtRange } from "./text-utils";
import type { EmbeddedTable } from "./types";

/**
 * Wrapper: converts raw DB tokens ↔ display names on load/save.
 * Manages both text and formatting ranges.
 */
export function FeatureMentionField({
  initial,
  initialFmt,
  onCommit,
  tables,
  fields,
  tableNames,
  fieldDisplayNames,
  images,
  modules,
  features,
  concepts,
  placeholder,
  onRefNavigate,
  onCreateRef,
  tableDetails,
  onPickTableForField,
  initialCollapsed,
  onCollapsedChange,
  initialTables,
  onTablesChange,
  noteContext,
}: {
  initial: string;
  initialFmt: FmtRange[];
  onCommit: (text: string, fmt: FmtRange[], collapsed?: Record<string, { body: string; bodyFmt: FmtRange[] }>, tables?: Record<string, EmbeddedTable>) => void;
  tables: Array<{ id: number; name: string }>;
  fields: Array<{ id: number; name: string; tableId: number; tableName: string }>;
  tableNames: Set<string>;
  fieldDisplayNames: Set<string>;
  images?: Array<{ id: string; title: string; url?: string }>;
  modules?: Array<{ id: number; name: string }>;
  features?: Array<{ id: number; name: string; modules?: string }>;
  concepts?: Array<{ id: number; name: string }>;
  placeholder?: string;
  onRefNavigate?: (type: string, name: string) => void;
  onCreateRef?: (type: "table" | "field", name: string, options?: { parentTableId?: number; description?: string; recordOwnership?: string; tableStatus?: string }) => Promise<{ id: number; name: string } | null>;
  tableDetails?: Array<Record<string, unknown>>;
  onPickTableForField?: (fieldSnakeName: string, fieldRawName: string) => void;
  initialCollapsed?: Record<string, { body: string; bodyFmt: FmtRange[] }>;
  onCollapsedChange?: (collapsed: Record<string, { body: string; bodyFmt: FmtRange[] }>) => void;
  initialTables?: Record<string, EmbeddedTable>;
  onTablesChange?: (tables: Record<string, EmbeddedTable>) => void;
  noteContext?: { module?: string; moduleColor?: string; feature?: string; featureColor?: string; field?: string; fieldColor?: string };
}) {
  const imageDisplayNames = useMemo(() => new Set((images || []).map((img) => img.title)), [images]);
  const moduleDisplayNames = useMemo(() => new Set((modules || []).map((m) => m.name)), [modules]);
  const featureDisplayNames = useMemo(() => new Set((features || []).map((f) => f.name)), [features]);
  const conceptDisplayNames = useMemo(() => new Set((concepts || []).map((c) => c.name)), [concepts]);
  const initialDisplay = useMemo(() => rawToDisplay(initial, tables, fields, images, modules, features, concepts), [initial, tables, fields, images, modules, features, concepts]);
  const [val, setVal] = useState(initialDisplay);
  const [fmt, setFmt] = useState<FmtRange[]>(initialFmt);
  const committedText = useRef(initial);
  const committedFmt = useRef(initialFmt);
  const skipNextSync = useRef(false); // Skip useEffect sync after internal collapse/expand commits

  useEffect(() => {
    if (skipNextSync.current) { skipNextSync.current = false; return; }
    // Only reset when the actual text/fmt data changed externally — not when tables/fields/images refs change
    if (initial === committedText.current && JSON.stringify(initialFmt) === JSON.stringify(committedFmt.current)) return;
    const d = rawToDisplay(initial, tables, fields, images, modules, features, concepts);
    setVal(d);
    setFmt(initialFmt);
    committedText.current = initial;
    committedFmt.current = initialFmt;
  }, [initial, initialFmt, tables, fields, images]);

  const handleBlur = useCallback(() => {
    // Save text as-is (with collapsed sections still collapsed)
    const raw = displayToRaw(val, tables, fields, images, modules, features, concepts);
    const textChanged = raw !== committedText.current;
    const fmtChanged = JSON.stringify(fmt) !== JSON.stringify(committedFmt.current);
    if (textChanged || fmtChanged) {
      onCommit(raw, fmt);
      committedText.current = raw;
      committedFmt.current = fmt;
    }
  }, [val, fmt, onCommit, tables, fields, images]);

  // Debounced auto-commit while typing (2s after last keystroke) — saves without needing blur
  const autoCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Only auto-commit if there are actual uncommitted changes
    const raw = displayToRaw(val, tables, fields, images, modules, features, concepts);
    const textChanged = raw !== committedText.current;
    const fmtChanged = JSON.stringify(fmt) !== JSON.stringify(committedFmt.current);
    if (!textChanged && !fmtChanged) return;

    if (autoCommitTimer.current) clearTimeout(autoCommitTimer.current);
    autoCommitTimer.current = setTimeout(() => {
      autoCommitTimer.current = null;
      const rawNow = displayToRaw(val, tables, fields, images, modules, features, concepts);
      if (rawNow !== committedText.current || JSON.stringify(fmt) !== JSON.stringify(committedFmt.current)) {
        onCommit(rawNow, fmt);
        committedText.current = rawNow;
        committedFmt.current = fmt;
      }
    }, 2000);

    return () => { if (autoCommitTimer.current) clearTimeout(autoCommitTimer.current); };
  }, [val, fmt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track current table data for blur commits
  const currentTablesRef = useRef<Record<string, EmbeddedTable>>(initialTables ?? {});

  const handleImmediateCommit = useCallback((newVal: string, newFmt: FmtRange[], collapsed: Record<string, { body: string; bodyFmt: FmtRange[] }>) => {
    // Collapse/expand or table insert changed the text — commit immediately without waiting for blur
    // Skip the next useEffect sync so it doesn't overwrite the collapsed text
    skipNextSync.current = true;
    const raw = displayToRaw(newVal, tables, fields, images, modules, features, concepts);
    // Commit text + collapsed state + tables atomically via onCommit
    onCommit(raw, newFmt, collapsed, currentTablesRef.current);
    committedText.current = raw;
    committedFmt.current = newFmt;
  }, [onCommit, tables, fields, images]);

  const handleTablesChange = useCallback((tbls: Record<string, EmbeddedTable>) => {
    currentTablesRef.current = tbls;
    if (onTablesChange) onTablesChange(tbls);
  }, [onTablesChange]);

  return (
    <div onBlur={handleBlur}>
      <MentionTextarea
        value={val}
        onChange={setVal}
        fmtRanges={fmt}
        onFmtChange={setFmt}
        tables={tables}
        fields={fields}
        tableNames={tableNames}
        fieldDisplayNames={fieldDisplayNames}
        images={images}
        imageDisplayNames={imageDisplayNames}
        modules={modules}
        moduleDisplayNames={moduleDisplayNames}
        features={features}
        featureDisplayNames={featureDisplayNames}
        concepts={concepts}
        conceptDisplayNames={conceptDisplayNames}
        placeholder={placeholder}
        rows={15}
        onRefNavigate={onRefNavigate}
        onCreateRef={onCreateRef}
        tableDetails={tableDetails}
        onPickTableForField={onPickTableForField}
        initialCollapsed={initialCollapsed}
        onCollapsedChange={onCollapsedChange}
        onImmediateCommit={handleImmediateCommit}
        initialTables={initialTables}
        onTablesChange={handleTablesChange}
        noteContext={noteContext}
      />
    </div>
  );
}
