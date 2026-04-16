import React, { useState, useCallback, useEffect, useRef } from "react";

const TEST_TYPES = ["unit", "integration", "e2e", "acceptance"] as const;
const TEST_STATUSES = ["draft", "ready", "passing", "failing", "skipped"] as const;

const TEST_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  unit:        { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
  integration: { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" },
  e2e:         { bg: "rgba(168,85,247,0.15)", text: "#a855f7", border: "rgba(168,85,247,0.3)" },
  acceptance:  { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" },
};

const TEST_STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  draft:   { bg: "rgba(102,102,128,0.15)", text: "#9999b3", border: "rgba(102,102,128,0.3)" },
  ready:   { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" },
  passing: { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
  failing: { bg: "rgba(224,85,85,0.15)", text: "#e05555", border: "rgba(224,85,85,0.3)" },
  skipped: { bg: "rgba(102,102,128,0.15)", text: "#666680", border: "rgba(102,102,128,0.3)" },
};

interface FeatureTest {
  testId: number;
  featureId: number;
  title: string;
  testType: string;
  status: string;
  expectedResult: string | null;
  dependencies: number[] | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

function Pill({ value, colors }: { value: string; colors: Record<string, { bg: string; text: string; border: string }> }) {
  const v = value ?? "unknown";
  const c = colors[v] || { bg: "rgba(108,123,255,0.12)", text: "#6c7bff", border: "rgba(108,123,255,0.3)" };
  const display = v.replace(/_/g, " ");
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize"
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {display}
    </span>
  );
}

interface Props {
  featureId: number;
  featureName: string;
  allFeatures?: Array<{ featureId: number; featureName: string }>;
}

export default function FeatureTestsGrid({ featureId, featureName, allFeatures = [] }: Props) {
  const [tests, setTests] = useState<FeatureTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<string>("unit");
  const [editingCell, setEditingCell] = useState<{ testId: number; field: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeatureTest | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const loadTests = useCallback(async () => {
    try {
      const res = await fetch(`/api/schema-planner?table=_splan_feature_tests`);
      if (res.ok) {
        const data = await res.json();
        const rows: FeatureTest[] = (Array.isArray(data) ? data : data.rows || []) as FeatureTest[];
        setTests(
          rows
            .filter((t) => t.featureId === featureId)
            .sort((a, b) => a.sortOrder - b.sortOrder)
        );
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [featureId]);

  useEffect(() => { loadTests(); }, [loadTests]);

  const createTest = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_feature_tests",
          data: {
            featureId,
            title: newTitle.trim(),
            testType: newType,
            status: "draft",
            sortOrder: tests.length,
          },
          reasoning: `Added test case for "${featureName}"`,
        }),
      });
      if (res.ok) {
        setNewTitle("");
        setAdding(false);
        loadTests();
      }
    } catch { /* ignore */ }
  }, [featureId, featureName, newTitle, newType, tests.length, loadTests]);

  const updateTest = useCallback(async (testId: number, data: Partial<FeatureTest>) => {
    try {
      await fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_feature_tests",
          id: testId,
          data,
          reasoning: `Updated test in "${featureName}"`,
        }),
      });
      loadTests();
    } catch { /* ignore */ }
    setEditingCell(null);
  }, [featureName, loadTests]);

  const deleteTest = useCallback(async () => {
    if (!deleteTarget || !deleteReason.trim()) return;
    try {
      await fetch("/api/schema-planner", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_feature_tests",
          id: deleteTarget.testId,
          reasoning: deleteReason,
        }),
      });
      setDeleteTarget(null);
      setDeleteReason("");
      loadTests();
    } catch { /* ignore */ }
  }, [deleteTarget, deleteReason, loadTests]);

  useEffect(() => {
    if (adding && addInputRef.current) addInputRef.current.focus();
  }, [adding]);

  const passingCount = tests.filter((t) => t.status === "passing").length;
  const totalCount = tests.length;
  const progressPct = totalCount > 0 ? Math.round((passingCount / totalCount) * 100) : 0;

  const resolveDeps = (deps: number[] | null): string => {
    if (!deps || deps.length === 0) return "—";
    return deps
      .map((id) => allFeatures.find((f) => f.featureId === id)?.featureName ?? `#${id}`)
      .join(", ");
  };

  if (loading) return <div className="text-[10px] py-2" style={{ color: "var(--color-text-muted)" }}>Loading tests...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <label className="font-semibold" style={{ color: "var(--color-text-muted)" }}>
          Test Cases
        </label>
        {totalCount > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-divider)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progressPct}%`, backgroundColor: progressPct === 100 ? "#4ecb71" : "#f2b661" }}
              />
            </div>
            <span className="text-[10px]" style={{ color: progressPct === 100 ? "#4ecb71" : "var(--color-text-muted)" }}>
              {passingCount}/{totalCount} passing
            </span>
          </div>
        )}
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] px-2 py-0.5 rounded font-medium hover:bg-white/5 transition-colors"
          style={{ color: "#4ecb71", border: "1px solid rgba(78,203,113,0.3)" }}
        >
          + Add Test
        </button>
      </div>

      {tests.length > 0 && (
        <table className="w-full text-xs mb-2" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
              <th className="text-left px-2 py-1.5 w-8" style={{ color: "var(--color-text-muted)" }}>#</th>
              <th className="text-left px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>Title</th>
              <th className="text-left px-2 py-1.5 w-24" style={{ color: "var(--color-text-muted)" }}>Type</th>
              <th className="text-left px-2 py-1.5 w-24" style={{ color: "var(--color-text-muted)" }}>Status</th>
              <th className="text-left px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>Expected Result</th>
              <th className="text-left px-2 py-1.5 w-36" style={{ color: "var(--color-text-muted)" }}>Dependencies</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {tests.map((test, idx) => {
              const isEditingTitle = editingCell?.testId === test.testId && editingCell?.field === "title";
              const isEditingExpected = editingCell?.testId === test.testId && editingCell?.field === "expectedResult";
              const isEditingType = editingCell?.testId === test.testId && editingCell?.field === "testType";
              const isEditingStatus = editingCell?.testId === test.testId && editingCell?.field === "status";

              return (
                <tr
                  key={test.testId}
                  className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{
                    borderColor: "var(--color-divider)",
                    opacity: test.status === "skipped" ? 0.5 : 1,
                  }}
                >
                  <td className="px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>{idx + 1}</td>

                  {/* Title */}
                  <td
                    className="px-2 py-1.5 cursor-pointer"
                    style={{
                      color: test.status === "passing" ? "#4ecb71" : test.status === "failing" ? "#e05555" : "var(--color-text)",
                      textDecoration: test.status === "skipped" ? "line-through" : "none",
                    }}
                    onClick={() => setEditingCell({ testId: test.testId, field: "title" })}
                  >
                    {isEditingTitle ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={test.title}
                        className="w-full px-1 py-0 text-xs rounded border focus:outline-none"
                        style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        onBlur={(e) => updateTest(test.testId, { title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updateTest(test.testId, { title: (e.target as HTMLInputElement).value });
                          if (e.key === "Escape") setEditingCell(null);
                        }}
                      />
                    ) : test.title}
                  </td>

                  {/* Type */}
                  <td className="px-2 py-1.5 cursor-pointer relative" onClick={() => setEditingCell(isEditingType ? null : { testId: test.testId, field: "testType" })}>
                    <Pill value={test.testType} colors={TEST_TYPE_COLORS} />
                    {isEditingType && (
                      <>
                        <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                        <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[140px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                          {TEST_TYPES.map((t) => (
                            <div
                              key={t}
                              className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5"
                              onMouseDown={(e) => { e.preventDefault(); updateTest(test.testId, { testType: t }); }}
                            >
                              <Pill value={t} colors={TEST_TYPE_COLORS} />
                              {test.testType === t && <span style={{ color: TEST_TYPE_COLORS[t].text }}>&#10003;</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1.5 cursor-pointer relative" onClick={() => setEditingCell(isEditingStatus ? null : { testId: test.testId, field: "status" })}>
                    <Pill value={test.status} colors={TEST_STATUS_COLORS} />
                    {isEditingStatus && (
                      <>
                        <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                        <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[140px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                          {TEST_STATUSES.map((s) => (
                            <div
                              key={s}
                              className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5"
                              onMouseDown={(e) => { e.preventDefault(); updateTest(test.testId, { status: s }); }}
                            >
                              <Pill value={s} colors={TEST_STATUS_COLORS} />
                              {test.status === s && <span style={{ color: TEST_STATUS_COLORS[s].text }}>&#10003;</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </td>

                  {/* Expected Result */}
                  <td
                    className="px-2 py-1.5 cursor-pointer max-w-[250px]"
                    style={{ color: "var(--color-text-muted)" }}
                    onClick={() => setEditingCell({ testId: test.testId, field: "expectedResult" })}
                  >
                    {isEditingExpected ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={test.expectedResult ?? ""}
                        className="w-full px-1 py-0 text-xs rounded border focus:outline-none"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        onBlur={(e) => updateTest(test.testId, { expectedResult: e.target.value || null })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updateTest(test.testId, { expectedResult: (e.target as HTMLInputElement).value || null });
                          if (e.key === "Escape") setEditingCell(null);
                        }}
                      />
                    ) : (
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap block">{test.expectedResult || "—"}</span>
                    )}
                  </td>

                  {/* Dependencies */}
                  <td className="px-2 py-1.5 max-w-[200px]">
                    {test.dependencies && test.dependencies.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {test.dependencies.map((depId) => {
                          const depName = allFeatures.find((f) => f.featureId === depId)?.featureName ?? `#${depId}`;
                          return (
                            <button
                              key={depId}
                              onClick={() => {
                                const params = new URLSearchParams(window.location.search);
                                params.set("sptab", "features");
                                window.history.pushState({}, "", `?${params.toString()}`);
                                window.location.reload();
                              }}
                              className="text-[10px] hover:underline cursor-pointer truncate max-w-[180px]"
                              style={{ color: "#5bc0de" }}
                              title={`Navigate to ${depName}`}
                            >
                              {depName}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>—</span>
                    )}
                  </td>

                  {/* Delete */}
                  <td className="px-1 py-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(test); }}
                      className="w-5 h-5 rounded flex items-center justify-center text-[10px] opacity-30 hover:opacity-100 hover:bg-red-500/20 transition-all"
                      style={{ color: "#e05555" }}
                      title={`Delete test "${test.title}"`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Add test inline form */}
      {adding && (
        <div className="flex items-center gap-2 mb-2">
          <input
            ref={addInputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Test title..."
            className="flex-1 px-2 py-1 text-xs rounded border focus:outline-none"
            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            onKeyDown={(e) => {
              if (e.key === "Enter") createTest();
              if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
            }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="px-2 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
          >
            {TEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={createTest} className="px-2 py-1 text-xs rounded font-medium" style={{ backgroundColor: "#4ecb71", color: "#fff" }}>Add</button>
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="px-2 py-1 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Cancel</button>
        </div>
      )}

      {tests.length === 0 && !adding && (
        <div className="text-[10px] py-1" style={{ color: "var(--color-text-muted)" }}>
          No test cases yet — click &ldquo;+ Add Test&rdquo; to define what this feature should do.
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-xl border shadow-2xl w-[400px] p-5" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Delete Test?</h4>
            <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
              Are you sure you want to delete &ldquo;{deleteTarget.title}&rdquo;?
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
    </div>
  );
}
