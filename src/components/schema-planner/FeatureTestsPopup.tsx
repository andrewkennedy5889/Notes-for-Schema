import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { rawToDisplay, REF_REGEX } from "./text-utils";
import { getRefColors } from "../../pages/SchemaPlanner";

const TEST_TYPES = ["unit", "integration", "e2e", "acceptance"] as const;

const TEST_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  unit:        { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
  integration: { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" },
  e2e:         { bg: "rgba(168,85,247,0.15)", text: "#a855f7", border: "rgba(168,85,247,0.3)" },
  acceptance:  { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" },
};

/** Maps entity type to its test table and FK column (camelCase) */
const ENTITY_TEST_CONFIG: Record<string, { apiTable: string; fkKey: string }> = {
  feature: { apiTable: "_splan_feature_tests", fkKey: "featureId" },
  concept: { apiTable: "_splan_concept_tests", fkKey: "conceptId" },
  module:  { apiTable: "_splan_module_tests",  fkKey: "moduleId" },
};

interface EntityTest {
  testId: number;
  [fk: string]: unknown; // featureId | conceptId | moduleId
  title: string;
  description: string | null;
  testType: string;
  status: string;
  generatedCode: string | null;
  expectedResult: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

function Pill({ value, colors }: { value: string; colors: Record<string, { bg: string; text: string; border: string }> }) {
  const c = colors[value] || { bg: "rgba(108,123,255,0.12)", text: "#6c7bff", border: "rgba(108,123,255,0.3)" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize"
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

interface RefLookup {
  tables: Array<{ id: number; name: string }>;
  fields: Array<{ id: number; name: string; tableId: number; tableName: string }>;
  modules: Array<{ id: number; name: string }>;
  features: Array<{ id: number; name: string }>;
  concepts: Array<{ id: number; name: string }>;
}

interface Props {
  entityType: "feature" | "concept" | "module";
  entityId: number;
  entityName: string;
  entityUpdatedAt: string;
  testsDismissedAt: string | null;
  onClose: () => void;
  onDismissStaleness: () => void;
  onTestCountChange: (count: number, latestTestUpdatedAt: string | null) => void;
  refLookup?: RefLookup;
}

export default function FeatureTestsPopup({
  entityType,
  entityId,
  entityName,
  entityUpdatedAt,
  testsDismissedAt,
  onClose,
  onDismissStaleness,
  onTestCountChange,
  refLookup,
}: Props) {
  const config = ENTITY_TEST_CONFIG[entityType];
  const [tests, setTests] = useState<EntityTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState<{ testId: number; field: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<string>("unit");
  const [deleteTarget, setDeleteTarget] = useState<EntityTest | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [showRegenPrompt, setShowRegenPrompt] = useState(false);
  const [regenCopied, setRegenCopied] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Staleness details
  const [stalenessExpanded, setStalenessExpanded] = useState(true);
  const [stalenessData, setStalenessData] = useState<{
    directChanges: Array<{ id: number; entityType: string; entityId: number; fieldChanged: string | null; oldValue: string | null; newValue: string | null; changedAt: string }>;
    referenceChanges: Array<{ id: number; entityType: string; entityId: number; fieldChanged: string | null; oldValue: string | null; newValue: string | null; changedAt: string }>;
    referencedEntities: Array<{ type: string; id: number; name: string }>;
    dismissedPairs: string[];
    dismissedRowIds: number[];
  } | null>(null);
  const [stalenessLoading, setStalenessLoading] = useState(false);
  const [diffModal, setDiffModal] = useState<{ field: string; oldValue: string | null; newValue: string | null; source: string } | null>(null);
  const [showDismissedSection, setShowDismissedSection] = useState(false);

  const entityLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);

  const loadTests = useCallback(async () => {
    try {
      const res = await fetch(`/api/schema-planner?table=${config.apiTable}`);
      if (res.ok) {
        const data = await res.json();
        const rows: EntityTest[] = (Array.isArray(data) ? data : data.rows || []) as EntityTest[];
        const filtered = rows
          .filter((t) => t[config.fkKey] === entityId)
          .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number));
        setTests(filtered);
        const latestUpdate = filtered.length > 0
          ? filtered.reduce((latest, t) => (t.updatedAt as string) > latest ? (t.updatedAt as string) : latest, filtered[0].updatedAt as string)
          : null;
        onTestCountChange(filtered.length, latestUpdate);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [entityId, config, onTestCountChange]);

  useEffect(() => { loadTests(); }, [loadTests]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !deleteTarget && !showRegenPrompt) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, deleteTarget, showRegenPrompt]);

  useEffect(() => {
    if (adding && addInputRef.current) addInputRef.current.focus();
  }, [adding]);

  const createTest = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: config.apiTable,
          data: { [config.fkKey]: entityId, title: newTitle.trim(), testType: newType, status: "draft", sortOrder: tests.length },
          reasoning: `Added test case for ${entityLabel} "${entityName}"`,
        }),
      });
      if (res.ok) { setNewTitle(""); setAdding(false); loadTests(); }
    } catch { /* ignore */ }
  }, [entityId, entityName, entityLabel, config, newTitle, newType, tests.length, loadTests]);

  const updateTest = useCallback(async (testId: number, data: Partial<EntityTest>) => {
    try {
      await fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: config.apiTable, id: testId, data, reasoning: `Updated test in ${entityLabel} "${entityName}"` }),
      });
      loadTests();
    } catch { /* ignore */ }
    setEditingCell(null);
  }, [entityName, entityLabel, config, loadTests]);

  const deleteTest = useCallback(async () => {
    if (!deleteTarget || !deleteReason.trim()) return;
    try {
      await fetch("/api/schema-planner", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: config.apiTable, id: deleteTarget.testId, reasoning: deleteReason }),
      });
      setDeleteTarget(null);
      setDeleteReason("");
      loadTests();
    } catch { /* ignore */ }
  }, [deleteTarget, deleteReason, config, loadTests]);

  // Staleness detection
  const latestTestUpdate = tests.length > 0
    ? tests.reduce((latest, t) => (t.updatedAt as string) > latest ? (t.updatedAt as string) : latest, tests[0].updatedAt as string)
    : null;
  const isStale = latestTestUpdate !== null && entityUpdatedAt > latestTestUpdate;
  const isDismissed = isStale && testsDismissedAt !== null && testsDismissedAt >= entityUpdatedAt;

  // Load staleness details on mount if stale
  useEffect(() => {
    if (isStale && !isDismissed && latestTestUpdate && !stalenessData) loadStalenessDetails();
  }, [isStale, isDismissed, latestTestUpdate]);

  // Load staleness details
  const loadStalenessDetails = useCallback(async () => {
    if (!latestTestUpdate || stalenessData) return;
    setStalenessLoading(true);
    try {
      const res = await fetch(`/api/projects/staleness-details?entityType=${entityType}&entityId=${entityId}&since=${encodeURIComponent(latestTestUpdate)}`);
      if (res.ok) setStalenessData(await res.json());
    } catch { /* ignore */ }
    setStalenessLoading(false);
  }, [entityType, entityId, latestTestUpdate, stalenessData]);

  // Find affected tests for a given change by exact field name match
  const findAffectedTests = useCallback((fieldChanged: string | null): number[] => {
    if (!fieldChanged) return [];
    const fieldLower = fieldChanged.toLowerCase().replace(/_/g, ' ');
    const fieldCamel = fieldChanged.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    return tests
      .filter(t => {
        const text = `${t.title} ${t.description || ''}`.toLowerCase();
        return text.includes(fieldChanged.toLowerCase()) || text.includes(fieldLower) || text.includes(fieldCamel.toLowerCase());
      })
      .map((_, i) => i + 1); // 1-indexed test numbers
  }, [tests]);

  // Get test IDs affected by a change
  const findAffectedTestIds = useCallback((fieldChanged: string | null): number[] => {
    if (!fieldChanged) return [];
    const fieldLower = fieldChanged.toLowerCase().replace(/_/g, ' ');
    const fieldCamel = fieldChanged.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    return tests
      .filter(t => {
        const text = `${t.title} ${t.description || ''}`.toLowerCase();
        return text.includes(fieldChanged.toLowerCase()) || text.includes(fieldLower) || text.includes(fieldCamel.toLowerCase());
      })
      .map(t => t.testId);
  }, [tests]);

  // Dismiss/un-dismiss an entire change row (persisted, test_id=0)
  const dismissRow = useCallback(async (changeLogId: number) => {
    try {
      await fetch('/api/projects/staleness-dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId, changeLogId, testId: 0 }),
      });
      setStalenessData(prev => prev ? { ...prev, dismissedRowIds: [...prev.dismissedRowIds, changeLogId] } : prev);
    } catch { /* ignore */ }
  }, [entityType, entityId]);

  const undismissRow = useCallback(async (changeLogId: number) => {
    try {
      await fetch('/api/projects/staleness-dismiss', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeLogId, testId: 0 }),
      });
      setStalenessData(prev => prev ? { ...prev, dismissedRowIds: prev.dismissedRowIds.filter(id => id !== changeLogId) } : prev);
    } catch { /* ignore */ }
  }, []);

  // Dismiss a specific change+test pair
  const dismissAffected = useCallback(async (changeLogId: number, testId: number) => {
    try {
      await fetch('/api/projects/staleness-dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId, changeLogId, testId }),
      });
      setStalenessData(prev => prev ? { ...prev, dismissedPairs: [...prev.dismissedPairs, `${changeLogId}:${testId}`] } : prev);
    } catch { /* ignore */ }
  }, [entityType, entityId]);

  // Compute the set of all affected test IDs across all non-dismissed changes (for row highlighting)
  const affectedTestIds = new Set<number>();
  if (stalenessData) {
    const allChanges = [...stalenessData.directChanges, ...stalenessData.referenceChanges];
    for (const ch of allChanges) {
      if (stalenessData.dismissedRowIds.includes(ch.id)) continue; // skip dismissed rows
      for (const tid of findAffectedTestIds(ch.fieldChanged)) {
        if (!stalenessData.dismissedPairs.includes(`${ch.id}:${tid}`)) {
          affectedTestIds.add(tid);
        }
      }
    }
  }

  // Build regenerate prompt
  const buildRegenPrompt = () => {
    const existingTests = tests.map((t) => `- ${t.title} (${t.testType}): ${t.description || "no description"}`).join("\n");
    return `I need you to review and regenerate test cases for my ${entityType} "${entityName}" (ID: ${entityId}).

The ${entityType} has been updated since the tests were last modified. Please review the current ${entityType} notes/description and:
1. Identify any test cases that are now outdated or incomplete
2. Suggest new test cases for any uncovered functionality
3. Update existing test descriptions and generated code as needed

Current test cases:
${existingTests || "(none)"}

For each test case, provide:
- Title: Short one-line description
- Description: Bulleted list of what the test verifies
- Test Type: one of unit, integration, e2e, acceptance
- Code: The test code to run

Please output each test case in a structured format I can review before applying.`;
  };

  // Resolve ref tags in a string to human-readable names
  const resolveRefs = useCallback((text: string | null): string => {
    if (!text || !refLookup) return text || "";
    return rawToDisplay(
      text,
      refLookup.tables,
      refLookup.fields,
      [],
      refLookup.modules,
      refLookup.features,
      refLookup.concepts,
    );
  }, [refLookup]);

  // For multi-line values, find changed lines and show excerpt with context
  // Returns raw text (ref tags intact) so resolveRefsJSX can color them
  const formatDiffExcerpt = useCallback((oldVal: string | null, newVal: string | null, contextLines = 2): { old: string; new: string } => {
    if (!oldVal && !newVal) return { old: "—", new: "—" };

    // If either is short (single line or < 120 chars), return as-is
    if ((!oldVal || oldVal.length < 120) && (!newVal || newVal.length < 120)) {
      return { old: oldVal || "—", new: newVal || "—" };
    }

    // Multi-line diff: find first changed line and show context
    const oldLines = (oldVal || "").split("\n");
    const newLines = (newVal || "").split("\n");

    // Find first differing line
    let firstDiff = 0;
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if ((oldLines[i] || "") !== (newLines[i] || "")) { firstDiff = i; break; }
    }

    // Find last differing line
    let lastDiff = firstDiff;
    for (let i = maxLen - 1; i > firstDiff; i--) {
      if ((oldLines[i] || "") !== (newLines[i] || "")) { lastDiff = i; break; }
    }

    const start = Math.max(0, firstDiff - contextLines);
    const endOld = Math.min(oldLines.length, lastDiff + contextLines + 1);
    const endNew = Math.min(newLines.length, lastDiff + contextLines + 1);

    const prefix = start > 0 ? "...\n" : "";
    const suffixOld = endOld < oldLines.length ? "\n..." : "";
    const suffixNew = endNew < newLines.length ? "\n..." : "";

    return {
      old: (prefix + oldLines.slice(start, endOld).join("\n") + suffixOld) || "—",
      new: (prefix + newLines.slice(start, endNew).join("\n") + suffixNew) || "—",
    };
  }, [resolveRefs]);

  // Count how many lines differ between old and new
  const countChangedLines = useCallback((oldVal: string | null, newVal: string | null): number => {
    const oldLines = (oldVal || "").split("\n");
    const newLines = (newVal || "").split("\n");
    let changed = 0;
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if ((oldLines[i] || "") !== (newLines[i] || "")) changed++;
    }
    return changed;
  }, []);

  // Resolve ref tags to JSX with colored spans using settings colors
  const resolveRefsJSX = useCallback((text: string): React.ReactNode[] => {
    const colors = getRefColors();
    const re = new RegExp(REF_REGEX.source, "g");
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      // Add text before this match
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      let refType = "";
      let refName = "";
      if (match[1]) { // table
        refType = "table";
        const t = refLookup?.tables.find(x => x.id === Number(match![1]));
        refName = t ? t.name : match[2] || "deleted";
      } else if (match[3]) { // field
        refType = "field";
        const f = refLookup?.fields.find(x => x.id === Number(match![3]));
        refName = f ? `${f.tableName}.${f.name}` : match[4] || "deleted";
      } else if (match[5]) { // image
        refType = "image";
        refName = match[6] || match[5];
      } else if (match[7]) { // module
        refType = "module";
        const m = refLookup?.modules.find(x => x.id === Number(match![7]));
        refName = m ? m.name : match[8] || "deleted";
      } else if (match[9]) { // feature
        refType = "feature";
        const f = refLookup?.features.find(x => x.id === Number(match![9]));
        refName = f ? f.name : match[10] || "deleted";
      } else if (match[11]) { // concept
        refType = "concept";
        const c = refLookup?.concepts.find(x => x.id === Number(match![11]));
        refName = c ? c.name : match[12] || "deleted";
      }

      const color = colors[refType] || "var(--color-text)";
      parts.push(
        <span key={match.index} style={{ color, fontWeight: 600 }}>({refName})</span>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return parts.length > 0 ? parts : [text];
  }, [refLookup]);

  const accentColor = "#6c7bff";

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--color-background)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b shrink-0"
        style={{ borderColor: "var(--color-divider)", background: "var(--color-surface)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="inline-block w-3 h-3 rounded-full cursor-pointer transition-all hover:scale-125 hover:ring-2 hover:ring-offset-1"
            style={{ backgroundColor: accentColor }}
            title="Close"
          />
          <label className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>
            {entityName} — Test Cases
          </label>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}44` }}>
            {tests.length} {tests.length === 1 ? "test" : "tests"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRegenPrompt(true)}
            className="px-3 py-1.5 text-xs rounded-md font-medium flex items-center gap-1.5 hover:bg-white/5 transition-colors"
            style={{ color: "#f2b661", border: "1px solid rgba(242,182,97,0.3)" }}
            title="Generate a prompt to regenerate test cases via Claude Code"
          >
            ⚡ Regenerate Prompt
          </button>
          <button
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-xs rounded-md font-medium hover:bg-white/5 transition-colors"
            style={{ color: "#4ecb71", border: "1px solid rgba(78,203,113,0.3)" }}
          >
            + Add Test
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-text-muted)" }}
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Staleness banner — expandable with change details */}
      {isStale && !isDismissed && (
        <div className="shrink-0" style={{ borderBottom: "1px solid rgba(242,182,97,0.2)" }}>
          {/* Summary row */}
          <div
            className="flex items-center justify-between px-6 py-2 text-xs cursor-pointer hover:bg-white/[0.02]"
            style={{ backgroundColor: "rgba(242,182,97,0.08)" }}
            onClick={() => { setStalenessExpanded(v => !v); if (!stalenessData) loadStalenessDetails(); }}
          >
            <span style={{ color: "#f2b661" }}>
              ⚠ {stalenessExpanded ? "▾" : "▸"} {entityLabel} or its references changed after tests were last modified
              {stalenessData && (() => {
                const total = stalenessData.directChanges.length + stalenessData.referenceChanges.length;
                const refCount = stalenessData.referencedEntities.length;
                return <span style={{ color: "var(--color-text-muted)" }}>
                  {" "}— {total} change{total !== 1 ? "s" : ""}{refCount > 0 ? ` across ${refCount + 1} entities` : ""}
                </span>;
              })()}
            </span>
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setShowRegenPrompt(true)}
                className="px-2 py-1 rounded text-[11px] font-medium hover:bg-white/5"
                style={{ color: "#f2b661", border: "1px solid rgba(242,182,97,0.3)" }}
              >
                ⚡ Regenerate
              </button>
              <button
                onClick={onDismissStaleness}
                className="px-2 py-1 rounded text-[11px] hover:bg-white/5"
                style={{ color: "var(--color-text-muted)" }}
              >
                Dismiss All
              </button>
            </div>
          </div>

          {/* Expanded details table */}
          {stalenessExpanded && (
            <div className="px-6 py-3" style={{ backgroundColor: "rgba(242,182,97,0.04)" }}>
              {stalenessLoading && (
                <div className="text-xs py-2" style={{ color: "var(--color-text-muted)" }}>Loading change details...</div>
              )}
              {stalenessData && (() => {
                const allChanges = [
                  ...stalenessData.directChanges.map(c => ({ ...c, source: entityLabel })),
                  ...stalenessData.referenceChanges.map(c => {
                    const ref = stalenessData.referencedEntities.find(r =>
                      (r.type === 'data_table' && c.entityType === 'table' && r.id === c.entityId) ||
                      (r.type === 'data_field' && c.entityType === 'field' && r.id === c.entityId) ||
                      (r.type === 'module' && c.entityType === 'module' && r.id === c.entityId) ||
                      (r.type === 'feature' && c.entityType === 'feature' && r.id === c.entityId)
                    );
                    return { ...c, source: ref ? `${ref.type === 'data_table' ? 'Table' : ref.type === 'data_field' ? 'Field' : ref.type.charAt(0).toUpperCase() + ref.type.slice(1)}: ${ref.name}` : c.entityType };
                  }),
                ];

                const activeChanges = allChanges.filter(ch => !stalenessData.dismissedRowIds.includes(ch.id));
                const dismissedChanges = allChanges.filter(ch => stalenessData.dismissedRowIds.includes(ch.id));

                const renderChangeRow = (ch: typeof allChanges[0], i: number, isDismissedRow: boolean) => {
                  const affected = findAffectedTests(ch.fieldChanged);
                  const affectedIds = findAffectedTestIds(ch.fieldChanged);
                  const excerpt = formatDiffExcerpt(ch.oldValue, ch.newValue);
                  const changedCount = countChangedLines(ch.oldValue, ch.newValue);
                  const isMultiLine = (ch.oldValue || "").includes("\n") || (ch.newValue || "").includes("\n");
                  return (
                    <tr key={`${ch.id}-${i}`} className="hover:bg-white/[0.02]" style={{ borderBottom: "1px solid var(--color-divider)" }}>
                      <td className="px-2 py-1.5" style={{ color: ch.source === entityLabel ? "#f2b661" : "#5bc0de" }}>{ch.source}</td>
                      <td className="px-2 py-1.5 font-mono" style={{ color: "var(--color-text)" }}>{ch.fieldChanged || "—"}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--color-text-muted)", whiteSpace: "pre-wrap", maxWidth: 250, overflow: "hidden", fontSize: "10px", lineHeight: "1.4" }}>
                        {resolveRefsJSX(excerpt.old)}
                        {isMultiLine && (
                          <div className="mt-1">
                            <button
                              onClick={() => setDiffModal({ field: ch.fieldChanged || "value", oldValue: ch.oldValue, newValue: ch.newValue, source: ch.source })}
                              className="text-[9px] px-1.5 py-0.5 rounded hover:bg-white/10"
                              style={{ color: "var(--color-primary)" }}
                            >
                              View Diff ({changedCount} line{changedCount !== 1 ? "s" : ""} changed)
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: "var(--color-text)", whiteSpace: "pre-wrap", maxWidth: 250, overflow: "hidden", fontSize: "10px", lineHeight: "1.4" }}>
                        {resolveRefsJSX(excerpt.new)}
                      </td>
                      <td className="px-2 py-1.5">
                        {affected.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {affected.map((num, j) => {
                              const testId = affectedIds[j];
                              const isDismissedPair = stalenessData.dismissedPairs.includes(`${ch.id}:${testId}`);
                              return (
                                <span
                                  key={num}
                                  className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[10px] cursor-pointer"
                                  style={{
                                    backgroundColor: isDismissedPair ? "rgba(102,102,128,0.1)" : "rgba(242,182,97,0.15)",
                                    color: isDismissedPair ? "var(--color-text-subtle)" : "#f2b661",
                                    textDecoration: isDismissedPair ? "line-through" : "none",
                                  }}
                                  title={isDismissedPair ? "Dismissed — click to un-dismiss" : `Test #${num} may be affected — click to dismiss`}
                                  onClick={() => {
                                    if (isDismissedPair) {
                                      fetch('/api/projects/staleness-dismiss', {
                                        method: 'DELETE',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ changeLogId: ch.id, testId }),
                                      }).then(() => {
                                        setStalenessData(prev => prev ? { ...prev, dismissedPairs: prev.dismissedPairs.filter(p => p !== `${ch.id}:${testId}`) } : prev);
                                      });
                                    } else {
                                      dismissAffected(ch.id, testId);
                                    }
                                  }}
                                >
                                  #{num}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span style={{ color: "var(--color-text-subtle)" }}>—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: "var(--color-text-subtle)", fontSize: "10px" }}>
                        {ch.changedAt ? new Date(ch.changedAt).toLocaleString(undefined, { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => isDismissedRow ? undismissRow(ch.id) : dismissRow(ch.id)}
                          className="text-[9px] px-1 py-0.5 rounded hover:bg-white/10"
                          style={{ color: isDismissedRow ? "#4ecb71" : "var(--color-text-subtle)" }}
                          title={isDismissedRow ? "Restore this change" : "Dismiss this change"}
                        >
                          {isDismissedRow ? "Restore" : "×"}
                        </button>
                      </td>
                    </tr>
                  );
                };

                const tableHeaders = (
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
                      <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-subtle)", width: "14%" }}>Source</th>
                      <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-subtle)", width: "10%" }}>Field</th>
                      <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-subtle)", width: "23%" }}>Old Value</th>
                      <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-subtle)", width: "23%" }}>New Value</th>
                      <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-subtle)", width: "12%" }}>Affected Tests</th>
                      <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-subtle)", width: "13%" }}>When</th>
                      <th className="text-left px-2 py-1 font-semibold" style={{ color: "var(--color-text-subtle)", width: "5%" }}></th>
                    </tr>
                  </thead>
                );

                if (allChanges.length === 0) {
                  return <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>No changes found since last code change record.</div>;
                }

                return (
                  <>
                    {/* Active changes */}
                    {activeChanges.length > 0 ? (
                      <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
                        {tableHeaders}
                        <tbody>{activeChanges.map((ch, i) => renderChangeRow(ch, i, false))}</tbody>
                      </table>
                    ) : (
                      <div className="text-xs py-2" style={{ color: "var(--color-text-muted)" }}>All changes dismissed.</div>
                    )}

                    {/* Dismissed changes — collapsible section */}
                    {dismissedChanges.length > 0 && (
                      <div className="mt-3">
                        <button
                          onClick={() => setShowDismissedSection(v => !v)}
                          className="text-[10px] px-2 py-1 rounded hover:bg-white/5 transition-colors"
                          style={{ color: "var(--color-text-subtle)" }}
                        >
                          {showDismissedSection ? "▾" : "▸"} {dismissedChanges.length} dismissed change{dismissedChanges.length !== 1 ? "s" : ""}
                        </button>
                        {showDismissedSection && (
                          <table className="w-full text-[11px] mt-1" style={{ borderCollapse: "collapse", opacity: 0.5 }}>
                            {tableHeaders}
                            <tbody>{dismissedChanges.map((ch, i) => renderChangeRow(ch, i, true))}</tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>Loading tests...</div>
        ) : (
          <>
            {tests.length > 0 && (
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
                    <th className="text-left px-3 py-2 w-8" style={{ color: "var(--color-text-muted)" }}>#</th>
                    <th className="text-left px-3 py-2" style={{ color: "var(--color-text-muted)", width: "20%" }}>Title</th>
                    <th className="text-left px-3 py-2" style={{ color: "var(--color-text-muted)", width: "30%" }}>Description</th>
                    <th className="text-left px-3 py-2 w-28" style={{ color: "var(--color-text-muted)" }}>Type</th>
                    <th className="text-left px-3 py-2" style={{ color: "var(--color-text-muted)", width: "35%" }}>Code</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {tests.map((test, idx) => (
                    <TestRow
                      key={test.testId as number}
                      test={test}
                      idx={idx}
                      editingCell={editingCell}
                      setEditingCell={setEditingCell}
                      updateTest={updateTest}
                      setDeleteTarget={setDeleteTarget}
                      isAffected={affectedTestIds.has(test.testId)}
                    />
                  ))}
                </tbody>
              </table>
            )}

            {/* Add test inline form */}
            {adding && (
              <div className="flex items-center gap-2 mt-4">
                <input
                  ref={addInputRef}
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Test title..."
                  className="flex-1 px-3 py-2 text-sm rounded border focus:outline-none focus:ring-1"
                  style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createTest();
                    if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
                  }}
                />
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="px-3 py-2 text-sm rounded border"
                  style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                >
                  {TEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={createTest} className="px-4 py-2 text-sm rounded font-medium" style={{ backgroundColor: "#4ecb71", color: "#fff" }}>Add</button>
                <button onClick={() => { setAdding(false); setNewTitle(""); }} className="px-3 py-2 text-sm rounded" style={{ color: "var(--color-text-muted)" }}>Cancel</button>
              </div>
            )}

            {tests.length === 0 && !adding && (
              <div className="text-sm py-8 text-center" style={{ color: "var(--color-text-muted)" }}>
                No test cases yet — click &ldquo;+ Add Test&rdquo; to define what this {entityType} should do.
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-xl border shadow-2xl w-[400px] p-5" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Delete Test?</h4>
            <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
              Are you sure you want to delete &ldquo;{deleteTarget.title as string}&rdquo;?
            </p>
            <label className="text-xs font-medium block mb-1" style={{ color: "#f2b661" }}>Reasoning *</label>
            <input
              type="text"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Why this deletion?"
              className="w-full px-3 py-1.5 text-sm rounded-md border mb-4 focus:outline-none focus:ring-1"
              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
              onKeyDown={(e) => { if (e.key === "Enter") deleteTest(); }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteTarget(null); setDeleteReason(""); }} className="px-3 py-1.5 text-xs rounded-md border" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>Cancel</button>
              <button onClick={deleteTest} className="px-3 py-1.5 text-xs rounded-md font-medium" style={{ backgroundColor: "#e05555", color: "#fff" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Diff modal — side-by-side with character-level highlighting */}
      {diffModal && (() => {
        const oldText = resolveRefs(diffModal.oldValue) || "";
        const newText = resolveRefs(diffModal.newValue) || "";
        const oldLines = oldText.split("\n");
        const newLines = newText.split("\n");
        const maxLines = Math.max(oldLines.length, newLines.length);

        // Simple character-level diff for a single line pair
        const charDiff = (a: string, b: string): { old: React.ReactNode; new: React.ReactNode } => {
          if (a === b) return { old: <>{resolveRefsJSX(a)}</>, new: <>{resolveRefsJSX(b)}</> };
          if (!a) return { old: null, new: <span style={{ color: "#4ecb71", backgroundColor: "rgba(78,203,113,0.1)" }}>{resolveRefsJSX(b)}</span> };
          if (!b) return { old: <span style={{ color: "#e05555", backgroundColor: "rgba(224,85,85,0.1)", textDecoration: "line-through" }}>{resolveRefsJSX(a)}</span>, new: null };

          // Find common prefix and suffix
          let prefixLen = 0;
          while (prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) prefixLen++;
          let suffixLen = 0;
          while (suffixLen < a.length - prefixLen && suffixLen < b.length - prefixLen && a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]) suffixLen++;

          const prefix = a.substring(0, prefixLen);
          const oldMid = a.substring(prefixLen, a.length - suffixLen);
          const newMid = b.substring(prefixLen, b.length - suffixLen);
          const suffix = a.substring(a.length - suffixLen);

          return {
            old: <>{resolveRefsJSX(prefix)}{oldMid && <span style={{ color: "#e05555", backgroundColor: "rgba(224,85,85,0.12)", textDecoration: "line-through" }}>{oldMid}</span>}{resolveRefsJSX(suffix)}</>,
            new: <>{resolveRefsJSX(prefix)}{newMid && <span style={{ color: "#4ecb71", backgroundColor: "rgba(78,203,113,0.12)" }}>{newMid}</span>}{resolveRefsJSX(suffix)}</>,
          };
        };

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={e => { if (e.target === e.currentTarget) setDiffModal(null); }}>
            <div className="rounded-xl border shadow-2xl flex flex-col" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", width: "90vw", maxWidth: 1100, maxHeight: "85vh" }}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ borderColor: "var(--color-divider)" }}>
                <div>
                  <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Diff — </span>
                  <span className="text-sm font-mono" style={{ color: "#f2b661" }}>{diffModal.field}</span>
                  <span className="text-xs ml-2" style={{ color: "var(--color-text-muted)" }}>({diffModal.source})</span>
                </div>
                <button onClick={() => setDiffModal(null)} className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>✕</button>
              </div>

              {/* Column headers */}
              <div className="flex shrink-0 border-b" style={{ borderColor: "var(--color-divider)" }}>
                <div className="w-8 shrink-0 px-1 py-1.5 text-center text-[9px] font-mono" style={{ color: "var(--color-text-subtle)" }}>#</div>
                <div className="flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#e05555", borderRight: "1px solid var(--color-divider)" }}>Old Value</div>
                <div className="flex-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#4ecb71" }}>New Value</div>
              </div>

              {/* Diff lines */}
              <div className="flex-1 overflow-auto font-mono text-[11px]" style={{ lineHeight: "1.6" }}>
                {Array.from({ length: maxLines }, (_, i) => {
                  const oldLine = oldLines[i] || "";
                  const newLine = newLines[i] || "";
                  const isChanged = oldLine !== newLine;
                  const diff = isChanged ? charDiff(oldLine, newLine) : null;

                  return (
                    <div key={i} className="flex" style={{ backgroundColor: isChanged ? "rgba(242,182,97,0.03)" : undefined, borderBottom: "1px solid var(--color-divider)" }}>
                      <div className="w-8 shrink-0 px-1 py-0.5 text-center select-none" style={{ color: "var(--color-text-subtle)", fontSize: 9, borderRight: "1px solid var(--color-divider)" }}>{i + 1}</div>
                      <div className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-words" style={{ color: "var(--color-text-muted)", borderRight: "1px solid var(--color-divider)", minHeight: 20 }}>
                        {diff ? diff.old : resolveRefsJSX(oldLine)}
                      </div>
                      <div className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-words" style={{ color: "var(--color-text)", minHeight: 20 }}>
                        {diff ? diff.new : resolveRefsJSX(newLine)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-2 border-t shrink-0" style={{ borderColor: "var(--color-divider)" }}>
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  {maxLines} lines total · {countChangedLines(diffModal.oldValue, diffModal.newValue)} changed
                </span>
                <button onClick={() => setDiffModal(null)} className="px-3 py-1 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Regenerate prompt modal */}
      {showRegenPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-xl border shadow-2xl w-[700px] max-h-[80vh] flex flex-col p-5" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: "var(--color-text)" }}>
              <span style={{ color: "#f2b661" }}>⚡</span> Regenerate Test Cases Prompt
            </h4>
            <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
              Copy this prompt and paste it into Claude Code to regenerate test cases for this {entityType}.
            </p>
            <textarea
              readOnly
              value={buildRegenPrompt()}
              className="flex-1 min-h-[200px] px-4 py-3 text-xs rounded-lg border font-mono resize-y"
              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => { setShowRegenPrompt(false); setRegenCopied(false); }}
                className="px-3 py-1.5 text-xs rounded-md border"
                style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}
              >
                Close
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildRegenPrompt());
                  setRegenCopied(true);
                  setTimeout(() => setRegenCopied(false), 2000);
                }}
                className="px-4 py-1.5 text-xs rounded-md font-medium"
                style={{ backgroundColor: regenCopied ? "#4ecb71" : "#f2b661", color: "#fff" }}
              >
                {regenCopied ? "Copied!" : "Copy to Clipboard"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Individual test row — extracted for readability */
function TestRow({
  test,
  idx,
  editingCell,
  setEditingCell,
  updateTest,
  setDeleteTarget,
  isAffected,
}: {
  test: EntityTest;
  idx: number;
  editingCell: { testId: number; field: string } | null;
  setEditingCell: (v: { testId: number; field: string } | null) => void;
  updateTest: (testId: number, data: Partial<EntityTest>) => void;
  setDeleteTarget: (t: EntityTest | null) => void;
  isAffected?: boolean;
}) {
  const isEditing = (field: string) => editingCell?.testId === (test.testId as number) && editingCell?.field === field;
  const isEditingType = isEditing("testType");

  return (
    <tr
      className="border-b transition-colors hover:bg-white/[0.02]"
      style={{
        borderColor: "var(--color-divider)",
        borderLeft: isAffected ? "3px solid #f2b661" : "3px solid transparent",
        backgroundColor: isAffected ? "rgba(242,182,97,0.04)" : undefined,
      }}
    >
      <td className="px-3 py-2 align-top" style={{ color: "var(--color-text-muted)" }}>{idx + 1}</td>

      {/* Title */}
      <td
        className="px-3 py-2 cursor-pointer align-top"
        style={{ color: "var(--color-text)" }}
        onClick={() => setEditingCell({ testId: test.testId as number, field: "title" })}
      >
        {isEditing("title") ? (
          <input
            type="text"
            autoFocus
            defaultValue={test.title as string}
            className="w-full px-2 py-1 text-sm rounded border focus:outline-none"
            style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            onBlur={(e) => updateTest(test.testId as number, { title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") updateTest(test.testId as number, { title: (e.target as HTMLInputElement).value });
              if (e.key === "Escape") setEditingCell(null);
            }}
          />
        ) : (
          <span className="font-medium">{test.title as string}</span>
        )}
      </td>

      {/* Description */}
      <td
        className="px-3 py-2 cursor-pointer align-top"
        style={{ color: "var(--color-text-muted)" }}
        onClick={() => setEditingCell({ testId: test.testId as number, field: "description" })}
      >
        {isEditing("description") ? (
          <textarea
            autoFocus
            defaultValue={(test.description as string) ?? ""}
            rows={4}
            className="w-full px-2 py-1 text-xs rounded border focus:outline-none resize-y"
            style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            placeholder="Bulleted description (use - for bullets)"
            onBlur={(e) => updateTest(test.testId as number, { description: e.target.value || null })}
            onKeyDown={(e) => { if (e.key === "Escape") setEditingCell(null); }}
          />
        ) : test.description ? (
          <div className="text-xs whitespace-pre-wrap leading-relaxed">{test.description as string}</div>
        ) : (
          <span className="text-xs italic" style={{ color: "var(--color-text-subtle)" }}>click to add</span>
        )}
      </td>

      {/* Type */}
      <td className="px-3 py-2 cursor-pointer align-top relative" onClick={() => setEditingCell(isEditingType ? null : { testId: test.testId as number, field: "testType" })}>
        <Pill value={test.testType as string} colors={TEST_TYPE_COLORS} />
        {isEditingType && (
          <>
            <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
            <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[140px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
              {TEST_TYPES.map((t) => (
                <div
                  key={t}
                  className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5"
                  onMouseDown={(e) => { e.preventDefault(); updateTest(test.testId as number, { testType: t }); }}
                >
                  <Pill value={t} colors={TEST_TYPE_COLORS} />
                  {test.testType === t && <span style={{ color: TEST_TYPE_COLORS[t].text }}>&#10003;</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </td>

      {/* Code */}
      <td
        className="px-3 py-2 cursor-pointer align-top"
        style={{ color: "var(--color-text-muted)" }}
        onClick={() => setEditingCell({ testId: test.testId as number, field: "generatedCode" })}
      >
        {isEditing("generatedCode") ? (
          <textarea
            autoFocus
            defaultValue={(test.generatedCode as string) ?? ""}
            rows={6}
            className="w-full px-2 py-1 text-xs rounded border focus:outline-none resize-y font-mono"
            style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            placeholder="Test code to run..."
            onBlur={(e) => updateTest(test.testId as number, { generatedCode: e.target.value || null })}
            onKeyDown={(e) => { if (e.key === "Escape") setEditingCell(null); }}
          />
        ) : test.generatedCode ? (
          <pre className="text-[11px] whitespace-pre-wrap font-mono leading-relaxed max-h-[120px] overflow-auto rounded p-2"
            style={{ backgroundColor: "var(--color-surface)" }}
          >{test.generatedCode as string}</pre>
        ) : (
          <span className="text-xs italic" style={{ color: "var(--color-text-subtle)" }}>click to add</span>
        )}
      </td>

      {/* Delete */}
      <td className="px-1 py-2 align-top">
        <button
          onClick={(e) => { e.stopPropagation(); setDeleteTarget(test); }}
          className="w-6 h-6 rounded flex items-center justify-center text-xs opacity-30 hover:opacity-100 hover:bg-red-500/20 transition-all"
          style={{ color: "#e05555" }}
          title={`Delete test "${test.title}"`}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
