import React, { useState, useCallback, useEffect, useRef } from "react";

const STEP_TYPES = ["implementation", "test", "research", "design"] as const;
const STEP_STATUSES = ["pending", "in_progress", "implemented", "blocked"] as const;

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  implementation: { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
  test:           { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" },
  research:       { bg: "rgba(168,85,247,0.15)", text: "#a855f7", border: "rgba(168,85,247,0.3)" },
  design:         { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" },
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending:       { bg: "rgba(102,102,128,0.15)", text: "#9999b3", border: "rgba(102,102,128,0.3)" },
  in_progress:   { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" },
  implemented:   { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
  blocked:       { bg: "rgba(224,85,85,0.15)", text: "#e05555", border: "rgba(224,85,85,0.3)" },
};

interface Step {
  stepId: number;
  featureId: number;
  title: string;
  description: string | null;
  stepType: string;
  status: string;
  sortOrder: number;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
}

function Pill({ value, colors }: { value: string; colors: Record<string, { bg: string; text: string; border: string }> }) {
  const c = colors[value] || { bg: "rgba(108,123,255,0.12)", text: "#6c7bff", border: "rgba(108,123,255,0.3)" };
  const display = value.replace(/_/g, " ");
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
}

export default function ImplementationStepsGrid({ featureId, featureName }: Props) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<string>("implementation");
  const [editingCell, setEditingCell] = useState<{ stepId: number; field: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Step | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const loadSteps = useCallback(async () => {
    try {
      const res = await fetch(`/api/schema-planner?table=_splan_implementation_steps`);
      if (res.ok) {
        const data = await res.json();
        const rows: Step[] = (Array.isArray(data) ? data : data.rows || []) as Step[];
        setSteps(rows.filter((s) => s.featureId === featureId).sort((a, b) => a.sortOrder - b.sortOrder));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [featureId]);

  useEffect(() => { loadSteps(); }, [loadSteps]);

  const createStep = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_implementation_steps",
          data: {
            featureId,
            title: newTitle.trim(),
            stepType: newType,
            status: "pending",
            sortOrder: steps.length,
          },
          reasoning: `Added implementation step for "${featureName}"`,
        }),
      });
      if (res.ok) {
        setNewTitle("");
        setAdding(false);
        loadSteps();
      }
    } catch { /* ignore */ }
  }, [featureId, featureName, newTitle, newType, steps.length, loadSteps]);

  const updateStep = useCallback(async (stepId: number, data: Partial<Step>) => {
    try {
      await fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_implementation_steps",
          id: stepId,
          data,
          reasoning: `Updated step in "${featureName}"`,
        }),
      });
      loadSteps();
    } catch { /* ignore */ }
    setEditingCell(null);
  }, [featureName, loadSteps]);

  const deleteStep = useCallback(async () => {
    if (!deleteTarget || !deleteReason.trim()) return;
    try {
      await fetch("/api/schema-planner", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_implementation_steps",
          id: deleteTarget.stepId,
          reasoning: deleteReason,
        }),
      });
      setDeleteTarget(null);
      setDeleteReason("");
      loadSteps();
    } catch { /* ignore */ }
  }, [deleteTarget, deleteReason, loadSteps]);

  // Focus add input when "adding" toggles on
  useEffect(() => {
    if (adding && addInputRef.current) addInputRef.current.focus();
  }, [adding]);

  const implementedCount = steps.filter((s) => s.status === "implemented").length;
  const totalCount = steps.length;
  const progressPct = totalCount > 0 ? Math.round((implementedCount / totalCount) * 100) : 0;

  if (loading) return <div className="text-[10px] py-2" style={{ color: "var(--color-text-muted)" }}>Loading steps...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <label className="font-semibold" style={{ color: "var(--color-text-muted)" }}>
          Implementation Steps
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
              {implementedCount}/{totalCount}
            </span>
          </div>
        )}
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] px-2 py-0.5 rounded font-medium hover:bg-white/5 transition-colors"
          style={{ color: "#4ecb71", border: "1px solid rgba(78,203,113,0.3)" }}
        >
          + Add Step
        </button>
      </div>

      {steps.length > 0 && (
        <table className="w-full text-xs mb-2" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
              <th className="text-left px-2 py-1.5 w-8" style={{ color: "var(--color-text-muted)" }}>#</th>
              <th className="text-left px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>Title</th>
              <th className="text-left px-2 py-1.5 w-24" style={{ color: "var(--color-text-muted)" }}>Type</th>
              <th className="text-left px-2 py-1.5 w-24" style={{ color: "var(--color-text-muted)" }}>Status</th>
              <th className="text-left px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>Description</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {steps.map((step, idx) => {
              const isEditingTitle = editingCell?.stepId === step.stepId && editingCell?.field === "title";
              const isEditingDesc = editingCell?.stepId === step.stepId && editingCell?.field === "description";
              const isEditingType = editingCell?.stepId === step.stepId && editingCell?.field === "stepType";
              const isEditingStatus = editingCell?.stepId === step.stepId && editingCell?.field === "status";

              return (
                <tr
                  key={step.stepId}
                  className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{
                    borderColor: "var(--color-divider)",
                    opacity: step.status === "implemented" ? 0.6 : 1,
                  }}
                >
                  <td className="px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>{idx + 1}</td>

                  {/* Title */}
                  <td
                    className="px-2 py-1.5 cursor-pointer"
                    style={{ color: step.status === "implemented" ? "#4ecb71" : "var(--color-text)", textDecoration: step.status === "implemented" ? "line-through" : "none" }}
                    onClick={() => setEditingCell({ stepId: step.stepId, field: "title" })}
                  >
                    {isEditingTitle ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={step.title}
                        className="w-full px-1 py-0 text-xs rounded border focus:outline-none"
                        style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        onBlur={(e) => updateStep(step.stepId, { title: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") updateStep(step.stepId, { title: (e.target as HTMLInputElement).value }); if (e.key === "Escape") setEditingCell(null); }}
                      />
                    ) : step.title}
                  </td>

                  {/* Type */}
                  <td className="px-2 py-1.5 cursor-pointer relative" onClick={() => setEditingCell(isEditingType ? null : { stepId: step.stepId, field: "stepType" })}>
                    <Pill value={step.stepType} colors={TYPE_COLORS} />
                    {isEditingType && (
                      <>
                        <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                        <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[140px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                          {STEP_TYPES.map((t) => (
                            <div
                              key={t}
                              className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5"
                              onMouseDown={(e) => { e.preventDefault(); updateStep(step.stepId, { stepType: t }); }}
                            >
                              <Pill value={t} colors={TYPE_COLORS} />
                              {step.stepType === t && <span style={{ color: TYPE_COLORS[t].text }}>&#10003;</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1.5 cursor-pointer relative" onClick={() => setEditingCell(isEditingStatus ? null : { stepId: step.stepId, field: "status" })}>
                    <Pill value={step.status} colors={STATUS_COLORS} />
                    {isEditingStatus && (
                      <>
                        <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                        <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[140px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                          {STEP_STATUSES.map((s) => (
                            <div
                              key={s}
                              className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5"
                              onMouseDown={(e) => { e.preventDefault(); updateStep(step.stepId, { status: s }); }}
                            >
                              <Pill value={s} colors={STATUS_COLORS} />
                              {step.status === s && <span style={{ color: STATUS_COLORS[s].text }}>&#10003;</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </td>

                  {/* Description */}
                  <td
                    className="px-2 py-1.5 cursor-pointer max-w-[250px]"
                    style={{ color: "var(--color-text-muted)" }}
                    onClick={() => setEditingCell({ stepId: step.stepId, field: "description" })}
                  >
                    {isEditingDesc ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={step.description ?? ""}
                        className="w-full px-1 py-0 text-xs rounded border focus:outline-none"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        onBlur={(e) => updateStep(step.stepId, { description: e.target.value || null })}
                        onKeyDown={(e) => { if (e.key === "Enter") updateStep(step.stepId, { description: (e.target as HTMLInputElement).value || null }); if (e.key === "Escape") setEditingCell(null); }}
                      />
                    ) : (
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap block">{step.description || "—"}</span>
                    )}
                  </td>

                  {/* Delete */}
                  <td className="px-1 py-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(step); }}
                      className="w-5 h-5 rounded flex items-center justify-center text-[10px] opacity-30 hover:opacity-100 hover:bg-red-500/20 transition-all"
                      style={{ color: "#e05555" }}
                      title={`Delete step "${step.title}"`}
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

      {/* Add step inline form */}
      {adding && (
        <div className="flex items-center gap-2 mb-2">
          <input
            ref={addInputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Step title..."
            className="flex-1 px-2 py-1 text-xs rounded border focus:outline-none"
            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            onKeyDown={(e) => { if (e.key === "Enter") createStep(); if (e.key === "Escape") { setAdding(false); setNewTitle(""); } }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="px-2 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
          >
            {STEP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={createStep} className="px-2 py-1 text-xs rounded font-medium" style={{ backgroundColor: "#4ecb71", color: "#fff" }}>Add</button>
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="px-2 py-1 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Cancel</button>
        </div>
      )}

      {steps.length === 0 && !adding && (
        <div className="text-[10px] py-1" style={{ color: "var(--color-text-muted)" }}>
          No implementation steps yet — click "+ Add Step" to break this feature into trackable parts.
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-xl border shadow-2xl w-[400px] p-5" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Delete Step?</h4>
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
              onKeyDown={(e) => { if (e.key === "Enter") deleteStep(); }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteTarget(null); setDeleteReason(""); }} className="px-3 py-1.5 text-xs rounded-md border" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>Cancel</button>
              <button onClick={deleteStep} className="px-3 py-1.5 text-xs rounded-md font-medium" style={{ backgroundColor: "#e05555", color: "#fff" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
