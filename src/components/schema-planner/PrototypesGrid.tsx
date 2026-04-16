import React, { useState, useCallback, useEffect, useRef } from "react";

const PROTO_TYPES = ["component", "endpoint", "service", "workflow", "integration"] as const;
const PROTO_STATUSES = ["idea", "building", "working", "broken", "archived"] as const;

const PROTO_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  component:   { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
  endpoint:    { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" },
  service:     { bg: "rgba(168,85,247,0.15)", text: "#a855f7", border: "rgba(168,85,247,0.3)" },
  workflow:    { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" },
  integration: { bg: "rgba(230,125,74,0.15)", text: "#e67d4a", border: "rgba(230,125,74,0.3)" },
};

const PROTO_STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  idea:     { bg: "rgba(102,102,128,0.15)", text: "#9999b3", border: "rgba(102,102,128,0.3)" },
  building: { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" },
  working:  { bg: "rgba(78,203,113,0.15)", text: "#4ecb71", border: "rgba(78,203,113,0.3)" },
  broken:   { bg: "rgba(224,85,85,0.15)", text: "#e05555", border: "rgba(224,85,85,0.3)" },
  archived: { bg: "rgba(102,102,128,0.15)", text: "#666680", border: "rgba(102,102,128,0.3)" },
};

interface Prototype {
  prototypeId: number;
  title: string;
  prototypeType: string;
  status: string;
  features: number[] | null;
  tests: number[] | null;
  techStack: string | null;
  entryPoint: string | null;
  sourcePath: string | null;
  description: string | null;
  notes: string | null;
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
  featureId?: number;
  featureName?: string;
  allFeatures?: Array<{ featureId: number; featureName: string }>;
}

export default function PrototypesGrid({ featureId, featureName, allFeatures = [] }: Props) {
  const isStandalone = featureId === undefined;

  const [prototypes, setPrototypes] = useState<Prototype[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<string>("component");
  const [editingCell, setEditingCell] = useState<{ prototypeId: number; field: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Prototype | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const loadPrototypes = useCallback(async () => {
    try {
      const res = await fetch(`/api/schema-planner?table=_splan_prototypes`);
      if (res.ok) {
        const data = await res.json();
        let rows: Prototype[] = (Array.isArray(data) ? data : data.rows || []) as Prototype[];
        if (!isStandalone && featureId !== undefined) {
          rows = rows.filter((p) => {
            const feats = p.features;
            return Array.isArray(feats) && feats.includes(featureId);
          });
        }
        rows = rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setPrototypes(rows);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [featureId, isStandalone]);

  useEffect(() => { loadPrototypes(); }, [loadPrototypes]);

  const createPrototype = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_prototypes",
          data: {
            title: newTitle.trim(),
            prototypeType: newType,
            status: "idea",
            features: featureId !== undefined ? [featureId] : [],
          },
          reasoning: featureName
            ? `Added prototype for "${featureName}"`
            : `Added prototype "${newTitle.trim()}"`,
        }),
      });
      if (res.ok) {
        setNewTitle("");
        setAdding(false);
        loadPrototypes();
      }
    } catch { /* ignore */ }
  }, [featureId, featureName, newTitle, newType, prototypes.length, loadPrototypes]);

  const updatePrototype = useCallback(async (prototypeId: number, data: Partial<Prototype>) => {
    try {
      await fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_prototypes",
          id: prototypeId,
          data,
          reasoning: featureName
            ? `Updated prototype in "${featureName}"`
            : `Updated prototype`,
        }),
      });
      loadPrototypes();
    } catch { /* ignore */ }
    setEditingCell(null);
  }, [featureName, loadPrototypes]);

  const deletePrototype = useCallback(async () => {
    if (!deleteTarget || !deleteReason.trim()) return;
    try {
      await fetch("/api/schema-planner", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: "_splan_prototypes",
          id: deleteTarget.prototypeId,
          reasoning: deleteReason,
        }),
      });
      setDeleteTarget(null);
      setDeleteReason("");
      loadPrototypes();
    } catch { /* ignore */ }
  }, [deleteTarget, deleteReason, loadPrototypes]);

  useEffect(() => {
    if (adding && addInputRef.current) addInputRef.current.focus();
  }, [adding]);

  const workingCount = prototypes.filter((p) => p.status === "working").length;
  const totalCount = prototypes.length;
  const progressPct = totalCount > 0 ? Math.round((workingCount / totalCount) * 100) : 0;

  const resolveFeatureNames = (features: number[] | null): string => {
    if (!features || features.length === 0) return "—";
    return features
      .map((id) => allFeatures.find((f) => f.featureId === id)?.featureName ?? `#${id}`)
      .join(", ");
  };

  if (loading) return <div className="text-[10px] py-2" style={{ color: "var(--color-text-muted)" }}>Loading prototypes...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <label className="font-semibold" style={{ color: "var(--color-text-muted)" }}>
          Prototypes
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
              {workingCount}/{totalCount} working
            </span>
          </div>
        )}
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] px-2 py-0.5 rounded font-medium hover:bg-white/5 transition-colors"
          style={{ color: "#4ecb71", border: "1px solid rgba(78,203,113,0.3)" }}
        >
          + Add Prototype
        </button>
      </div>

      {prototypes.length > 0 && (
        <table className="w-full text-xs mb-2" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
              <th className="text-left px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>Title</th>
              <th className="text-left px-2 py-1.5 w-28" style={{ color: "var(--color-text-muted)" }}>Type</th>
              <th className="text-left px-2 py-1.5 w-24" style={{ color: "var(--color-text-muted)" }}>Status</th>
              {isStandalone && (
                <th className="text-left px-2 py-1.5 w-36" style={{ color: "var(--color-text-muted)" }}>Features</th>
              )}
              <th className="text-left px-2 py-1.5 w-20" style={{ color: "var(--color-text-muted)" }}>Tests</th>
              <th className="text-left px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>Tech Stack</th>
              <th className="text-left px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>Entry Point</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {prototypes.map((proto) => {
              const isEditingTitle = editingCell?.prototypeId === proto.prototypeId && editingCell?.field === "title";
              const isEditingTech = editingCell?.prototypeId === proto.prototypeId && editingCell?.field === "techStack";
              const isEditingEntry = editingCell?.prototypeId === proto.prototypeId && editingCell?.field === "entryPoint";
              const isEditingType = editingCell?.prototypeId === proto.prototypeId && editingCell?.field === "prototypeType";
              const isEditingStatus = editingCell?.prototypeId === proto.prototypeId && editingCell?.field === "status";
              const testCount = Array.isArray(proto.tests) ? proto.tests.length : 0;

              return (
                <tr
                  key={proto.prototypeId}
                  className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{
                    borderColor: "var(--color-divider)",
                    opacity: proto.status === "archived" ? 0.5 : 1,
                  }}
                >
                  {/* Title */}
                  <td
                    className="px-2 py-1.5 cursor-pointer"
                    style={{
                      color: proto.status === "working" ? "#4ecb71" : proto.status === "broken" ? "#e05555" : "var(--color-text)",
                    }}
                    onClick={() => setEditingCell({ prototypeId: proto.prototypeId, field: "title" })}
                  >
                    {isEditingTitle ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={proto.title}
                        className="w-full px-1 py-0 text-xs rounded border focus:outline-none"
                        style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        onBlur={(e) => updatePrototype(proto.prototypeId, { title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updatePrototype(proto.prototypeId, { title: (e.target as HTMLInputElement).value });
                          if (e.key === "Escape") setEditingCell(null);
                        }}
                      />
                    ) : proto.title}
                  </td>

                  {/* Type */}
                  <td className="px-2 py-1.5 cursor-pointer relative" onClick={() => setEditingCell(isEditingType ? null : { prototypeId: proto.prototypeId, field: "prototypeType" })}>
                    <Pill value={proto.prototypeType} colors={PROTO_TYPE_COLORS} />
                    {isEditingType && (
                      <>
                        <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                        <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[140px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                          {PROTO_TYPES.map((t) => (
                            <div
                              key={t}
                              className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5"
                              onMouseDown={(e) => { e.preventDefault(); updatePrototype(proto.prototypeId, { prototypeType: t }); }}
                            >
                              <Pill value={t} colors={PROTO_TYPE_COLORS} />
                              {proto.prototypeType === t && <span style={{ color: PROTO_TYPE_COLORS[t].text }}>&#10003;</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1.5 cursor-pointer relative" onClick={() => setEditingCell(isEditingStatus ? null : { prototypeId: proto.prototypeId, field: "status" })}>
                    <Pill value={proto.status} colors={PROTO_STATUS_COLORS} />
                    {isEditingStatus && (
                      <>
                        <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                        <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[140px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                          {PROTO_STATUSES.map((s) => (
                            <div
                              key={s}
                              className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5"
                              onMouseDown={(e) => { e.preventDefault(); updatePrototype(proto.prototypeId, { status: s }); }}
                            >
                              <Pill value={s} colors={PROTO_STATUS_COLORS} />
                              {proto.status === s && <span style={{ color: PROTO_STATUS_COLORS[s].text }}>&#10003;</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </td>

                  {/* Features (standalone only) */}
                  {isStandalone && (
                    <td className="px-2 py-1.5 max-w-[150px]">
                      <div className="flex flex-wrap gap-1">
                        {Array.isArray(proto.features) && proto.features.length > 0
                          ? proto.features.map((fid) => {
                              const name = allFeatures.find((f) => f.featureId === fid)?.featureName ?? `#${fid}`;
                              return (
                                <span
                                  key={fid}
                                  className="inline-flex items-center px-1.5 py-0 rounded text-[10px]"
                                  style={{ backgroundColor: "rgba(66,139,202,0.12)", color: "#428bca", border: "1px solid rgba(66,139,202,0.25)" }}
                                  title={name}
                                >
                                  {name.length > 12 ? name.slice(0, 12) + "…" : name}
                                </span>
                              );
                            })
                          : <span style={{ color: "var(--color-text-muted)" }}>—</span>
                        }
                      </div>
                    </td>
                  )}

                  {/* Tests count */}
                  <td className="px-2 py-1.5" style={{ color: "var(--color-text-muted)" }}>
                    <span className="text-[10px]">
                      {testCount > 0 ? `${testCount} test${testCount !== 1 ? "s" : ""}` : "—"}
                    </span>
                  </td>

                  {/* Tech Stack */}
                  <td
                    className="px-2 py-1.5 cursor-pointer"
                    style={{ color: "var(--color-text-muted)" }}
                    onClick={() => setEditingCell({ prototypeId: proto.prototypeId, field: "techStack" })}
                  >
                    {isEditingTech ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={proto.techStack ?? ""}
                        className="w-full px-1 py-0 text-xs rounded border focus:outline-none"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        onBlur={(e) => updatePrototype(proto.prototypeId, { techStack: e.target.value || null })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updatePrototype(proto.prototypeId, { techStack: (e.target as HTMLInputElement).value || null });
                          if (e.key === "Escape") setEditingCell(null);
                        }}
                      />
                    ) : (
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap block">{proto.techStack || "—"}</span>
                    )}
                  </td>

                  {/* Entry Point — click to open, double-click to edit */}
                  <td
                    className="px-2 py-1.5"
                    onDoubleClick={() => setEditingCell({ prototypeId: proto.prototypeId, field: "entryPoint" })}
                  >
                    {isEditingEntry ? (
                      <input
                        type="text"
                        autoFocus
                        defaultValue={proto.entryPoint ?? ""}
                        className="w-full px-1 py-0 text-xs rounded border focus:outline-none"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        onBlur={(e) => updatePrototype(proto.prototypeId, { entryPoint: e.target.value || null })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") updatePrototype(proto.prototypeId, { entryPoint: (e.target as HTMLInputElement).value || null });
                          if (e.key === "Escape") setEditingCell(null);
                        }}
                      />
                    ) : proto.entryPoint ? (
                      <a
                        href={`/${proto.entryPoint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="overflow-hidden text-ellipsis whitespace-nowrap block text-[10px] font-mono hover:underline cursor-pointer"
                        style={{ color: "#5bc0de" }}
                        title={`Open ${proto.entryPoint} in new tab (double-click to edit)`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {proto.entryPoint} ↗
                      </a>
                    ) : (
                      <span className="cursor-pointer" style={{ color: "var(--color-text-muted)" }} onClick={() => setEditingCell({ prototypeId: proto.prototypeId, field: "entryPoint" })}>+ add path</span>
                    )}
                  </td>

                  {/* Delete */}
                  <td className="px-1 py-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(proto); }}
                      className="w-5 h-5 rounded flex items-center justify-center text-[10px] opacity-30 hover:opacity-100 hover:bg-red-500/20 transition-all"
                      style={{ color: "#e05555" }}
                      title={`Delete prototype "${proto.title}"`}
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

      {/* Add prototype inline form */}
      {adding && (
        <div className="flex items-center gap-2 mb-2">
          <input
            ref={addInputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Prototype title..."
            className="flex-1 px-2 py-1 text-xs rounded border focus:outline-none"
            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            onKeyDown={(e) => {
              if (e.key === "Enter") createPrototype();
              if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
            }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="px-2 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
          >
            {PROTO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={createPrototype} className="px-2 py-1 text-xs rounded font-medium" style={{ backgroundColor: "#4ecb71", color: "#fff" }}>Add</button>
          <button onClick={() => { setAdding(false); setNewTitle(""); }} className="px-2 py-1 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Cancel</button>
        </div>
      )}

      {prototypes.length === 0 && !adding && (
        <div className="text-[10px] py-1" style={{ color: "var(--color-text-muted)" }}>
          {isStandalone
            ? "No prototypes yet — create prototypes from feature details to prove ideas work."
            : "No prototypes yet — click \u201c+ Add Prototype\u201d to prove this feature works in isolation."}
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-xl border shadow-2xl w-[400px] p-5" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Delete Prototype?</h4>
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
              onKeyDown={(e) => { if (e.key === "Enter") deletePrototype(); }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteTarget(null); setDeleteReason(""); }} className="px-3 py-1.5 text-xs rounded-md border" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>Cancel</button>
              <button onClick={deletePrototype} className="px-3 py-1.5 text-xs rounded-md font-medium" style={{ backgroundColor: "#e05555", color: "#fff" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
