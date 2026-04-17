

import React, { useState } from "react";
import { rawToDisplay } from "./text-utils";

interface RefSummaryPopupProps {
  type: "module" | "feature" | "table" | "concept" | "research";
  record: Record<string, unknown>;
  features?: Record<string, unknown>[]; // all features (for module → feature list)
  tables: Array<{ id: number; name: string }>;
  fields: Array<{ id: number; name: string; tableId: number; tableName: string }>;
  allFields?: Record<string, unknown>[]; // full field records for table view
  modules?: Array<{ id: number; name: string }>;
  allFeatures?: Array<{ id: number; name: string }>;
  allConcepts?: Array<{ id: number; name: string }>;
  highlightFieldName?: string; // highlight a specific field row when opened from a field ref
  onClose: () => void;
  onOpenFeature?: (featureRecord: Record<string, unknown>) => void;
  onFieldUpdate?: (fieldRecord: Record<string, unknown>) => void;
}

const DATA_TYPE_OPTIONS = ["UUID", "Text", "Int4", "Date", "Bool", "Timestamp", "JSONB", "Enum", "Array"];

export default function RefSummaryPopup({
  type,
  record,
  features,
  tables,
  fields,
  allFields,
  modules,
  allFeatures,
  allConcepts,
  highlightFieldName,
  onClose,
  onOpenFeature,
  onFieldUpdate,
}: RefSummaryPopupProps) {
  const [expandedFeatureId, setExpandedFeatureId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ fieldId: number; col: string } | null>(null);
  const [pendingEdit, setPendingEdit] = useState<{ fieldRecord: Record<string, unknown>; col: string; oldValue: unknown; newValue: unknown } | null>(null);

  const name = type === "module" ? String(record.moduleName ?? "") : type === "table" ? String(record.tableName ?? "") : type === "concept" ? String(record.conceptName ?? "") : type === "research" ? String(record.title ?? "") : String(record.featureName ?? "");
  const description = type === "module" ? String(record.moduleDescription ?? "") : type === "table" ? String(record.descriptionPurpose ?? "") : type === "concept" ? String(record.description ?? "") : type === "research" ? String(record.summary ?? "") : String(record.description ?? "");
  const purpose = type === "module" ? String(record.modulePurpose ?? "") : "";

  // For tables: get fields
  const tableFields = type === "table" && allFields
    ? allFields.filter((f) => f.dataTableId === record.tableId).sort((a, b) => String(a.fieldName ?? "").localeCompare(String(b.fieldName ?? "")))
    : [];

  // For modules: get features that belong to this module
  const moduleFeatures = type === "module" && features
    ? features.filter((f) => {
        const mods = f.modules as number[] | undefined;
        return Array.isArray(mods) && mods.includes(record.moduleId as number);
      })
    : [];

  // For features: get notes
  const noteFields = type === "feature" ? [
    { key: "notes", label: "Web App Notes" },
    { key: "nativeNotes", label: "Native Notes" },
    { key: "androidNotes", label: "Android Notes" },
    { key: "appleNotes", label: "Apple Notes" },
    { key: "otherNotes", label: "Other Notes" },
    { key: "implementation", label: "Implementation" },
  ].filter((n) => record[n.key]) : [];

  const displayNote = (raw: string) => rawToDisplay(raw, tables, fields, undefined, modules, allFeatures);

  const badgeColor = type === "module"
    ? { bg: "rgba(230,125,74,0.15)", text: "#e67d4a", border: "rgba(230,125,74,0.3)" }
    : type === "table"
    ? { bg: "rgba(168,85,247,0.15)", text: "#a855f7", border: "rgba(168,85,247,0.3)" }
    : type === "concept"
    ? { bg: "rgba(242,182,97,0.15)", text: "#f2b661", border: "rgba(242,182,97,0.3)" }
    : type === "research"
    ? { bg: "rgba(91,192,222,0.15)", text: "#5bc0de", border: "rgba(91,192,222,0.3)" }
    : { bg: "rgba(168,85,247,0.15)", text: "#a855f7", border: "rgba(168,85,247,0.3)" };

  return (
    <div className="fixed z-[200] rounded-xl border shadow-2xl w-[700px] max-w-[45vw] max-h-[75vh] flex flex-col" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", top: "10vh", right: 24 }}>
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: "var(--color-divider)" }}>
          <span
            className="px-3 py-1 rounded text-xs font-bold uppercase"
            style={{ backgroundColor: badgeColor.bg, color: badgeColor.text, border: `1px solid ${badgeColor.border}` }}
          >
            {type === "module" ? "Module" : type === "table" ? "Table" : type === "concept" ? "Concept" : type === "research" ? "Research" : "Feature"}
          </span>
          <span className="text-lg font-semibold flex-1" style={{ color: "var(--color-text)" }}>{name}</span>
          <button onClick={onClose} className="text-xl leading-none px-2 rounded hover:bg-black/10" style={{ color: "var(--color-text-muted)" }}>&times;</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1 space-y-5">
          {/* Description */}
          {description && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>Description</div>
              <p className="text-base" style={{ color: "var(--color-text)" }}>{description}</p>
            </div>
          )}

          {/* Purpose (modules only) */}
          {purpose && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>Purpose</div>
              <p className="text-base" style={{ color: "var(--color-text)" }}>{purpose}</p>
            </div>
          )}

          {/* Module: feature list */}
          {type === "module" && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-text-muted)" }}>
                Features ({moduleFeatures.length})
              </div>
              {moduleFeatures.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No features assigned to this module.</p>
              ) : (
                <div className="space-y-1">
                  {moduleFeatures.map((feat) => {
                    const fid = feat.featureId as number;
                    const fname = String(feat.featureName ?? "");
                    const fdesc = String(feat.description ?? "");
                    const fstatus = String(feat.status ?? "Idea");
                    const isExpanded = expandedFeatureId === fid;
                    const statusColor = fstatus === "Implemented" ? "#4ecb71" : fstatus === "Approved" ? "#5bc0de" : "#9999b3";
                    return (
                      <div key={fid} className="rounded border" style={{ borderColor: "var(--color-divider)" }}>
                        <button
                          onClick={() => setExpandedFeatureId(isExpanded ? null : fid)}
                          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-black/5"
                        >
                          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{isExpanded ? "▼" : "▶"}</span>
                          <span className="text-sm font-medium flex-1" style={{ color: "var(--color-text)" }}>{fname}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${statusColor}22`, color: statusColor }}>{fstatus}</span>
                          {fdesc && <span className="text-xs truncate max-w-[250px]" style={{ color: "var(--color-text-muted)" }}>{fdesc}</span>}
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-3 pt-2 border-t space-y-2" style={{ borderColor: "var(--color-divider)" }}>
                            {fdesc && <p className="text-sm" style={{ color: "var(--color-text)" }}>{fdesc}</p>}
                            {/* Feature notes */}
                            {[
                              { key: "notes", label: "Web App Notes" },
                              { key: "nativeNotes", label: "Native Notes" },
                              { key: "androidNotes", label: "Android Notes" },
                              { key: "appleNotes", label: "Apple Notes" },
                              { key: "otherNotes", label: "Other Notes" },
                              { key: "implementation", label: "Implementation" },
                            ].filter((n) => feat[n.key]).map((n) => (
                              <div key={n.key}>
                                <div className="text-[11px] font-semibold uppercase mb-1" style={{ color: "var(--color-text-muted)" }}>{n.label}</div>
                                <pre className="text-sm whitespace-pre-wrap rounded p-3" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text)", fontFamily: "inherit" }}>
                                  {displayNote(String(feat[n.key]))}
                                </pre>
                              </div>
                            ))}
                            {!feat.notes && !feat.implementation && (
                              <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No notes yet.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Feature: notes */}
          {type === "feature" && noteFields.length > 0 && (
            <div className="space-y-4">
              {noteFields.map((n) => (
                <div key={n.key}>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>{n.label}</div>
                  <pre className="text-base whitespace-pre-wrap rounded p-4" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text)", fontFamily: "inherit", lineHeight: 1.6 }}>
                    {displayNote(String(record[n.key]))}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {type === "feature" && noteFields.length === 0 && !description && (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>No description or notes yet.</p>
          )}

          {/* Concept: type, status, notes, linked features/modules */}
          {type === "concept" && (
            <>
              {(record.conceptType || record.status) && (
                <div className="flex items-center gap-2">
                  {record.conceptType && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(242,182,97,0.15)", color: "#f2b661" }}>
                      {String(record.conceptType)}
                    </span>
                  )}
                  {record.status && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71" }}>
                      {String(record.status)}
                    </span>
                  )}
                </div>
              )}
              {record.notes && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>Notes</div>
                  <pre className="text-base whitespace-pre-wrap rounded p-4" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text)", fontFamily: "inherit", lineHeight: 1.6 }}>
                    {displayNote(String(record.notes))}
                  </pre>
                </div>
              )}
              {Array.isArray(record.features) && (record.features as number[]).length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                    Linked Features ({(record.features as number[]).length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(record.features as number[]).map((fid) => {
                      const feat = allFeatures?.find((f) => f.id === fid);
                      return (
                        <span key={fid} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(168,85,247,0.15)", color: "#a855f7" }}>
                          {feat ? feat.name : `#${fid}`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {Array.isArray(record.modules) && (record.modules as number[]).length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                    Linked Modules ({(record.modules as number[]).length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(record.modules as number[]).map((mid) => {
                      const mod = modules?.find((m) => m.id === mid);
                      return (
                        <span key={mid} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(230,125,74,0.15)", color: "#e67d4a" }}>
                          {mod ? mod.name : `#${mid}`}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {!description && !record.notes && (
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>No description or notes yet.</p>
              )}
            </>
          )}

          {/* Research: summary, findings, sources */}
          {type === "research" && (
            <>
              {record.status && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(91,192,222,0.15)", color: "#5bc0de" }}>
                    {String(record.status)}
                  </span>
                  {record.researchedAt && (
                    <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                      Researched: {String(record.researchedAt).split("T")[0]}
                    </span>
                  )}
                </div>
              )}
              {record.conceptId && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>Parent Concept</div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(242,182,97,0.15)", color: "#f2b661" }}>
                    {allConcepts?.find((c) => c.id === record.conceptId)?.name || `#${record.conceptId}`}
                  </span>
                </div>
              )}
              {record.findings && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>Findings</div>
                  <pre className="text-base whitespace-pre-wrap rounded p-4" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text)", fontFamily: "inherit", lineHeight: 1.6 }}>
                    {String(record.findings)}
                  </pre>
                </div>
              )}
              {record.sources && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>Sources</div>
                  <pre className="text-sm whitespace-pre-wrap rounded p-3" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text)", fontFamily: "inherit" }}>
                    {String(record.sources)}
                  </pre>
                </div>
              )}
              {!description && !record.findings && (
                <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>No summary or findings yet.</p>
              )}
            </>
          )}

          {/* Table: field grid */}
          {type === "table" && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                  Fields ({tableFields.length})
                </div>
                {record.recordOwnership ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(230,125,74,0.15)", color: "#e67d4a" }}>
                    {String(record.recordOwnership)}
                  </span>
                ) : null}
                {Array.isArray(record.tags) && (record.tags as string[]).length > 0 ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "rgba(91,192,222,0.15)", color: "#5bc0de" }}>
                    {(record.tags as string[]).join(", ")}
                  </span>
                ) : null}
              </div>
              {tableFields.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No fields defined for this table.</p>
              ) : (
                <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-divider)" }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ backgroundColor: "var(--color-surface)" }}>
                        <th className="text-left py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Field Name</th>
                        <th className="text-left py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Type</th>
                        <th className="text-center py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Req</th>
                        <th className="text-center py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Unique</th>
                        <th className="text-center py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>FK</th>
                        <th className="text-left py-2 px-3 font-semibold" style={{ color: "var(--color-text-muted)" }}>Ref Table</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableFields.map((f, i) => {
                        const fid = f.fieldId as number;
                        const fname = String(f.fieldName ?? "");
                        const dtype = String(f.dataType ?? "Text");
                        const isReq = f.isRequired === true;
                        const isUniq = f.isUnique === true;
                        const isFK = f.isForeignKey === true;
                        const refTable = isFK && f.referencesTable
                          ? tables.find((t) => t.id === f.referencesTable)?.name || `#${f.referencesTable}`
                          : "";
                        const isHighlighted = highlightFieldName === fname;
                        const isEditingThis = (col: string) => editingCell?.fieldId === fid && editingCell?.col === col;

                        const commitEdit = (col: string, newVal: unknown) => {
                          setEditingCell(null);
                          if (f[col] === newVal) return;
                          setPendingEdit({ fieldRecord: f, col, oldValue: f[col], newValue: newVal });
                        };

                        return (
                          <tr key={i} className="border-t" style={{ borderColor: "var(--color-divider)", backgroundColor: isHighlighted ? "rgba(91,192,222,0.15)" : undefined, outline: isHighlighted ? "2px solid #5bc0de" : undefined, outlineOffset: -2 }}>
                            <td className="py-1.5 px-3 font-mono cursor-pointer" style={{ color: "var(--color-text)" }} onClick={() => setEditingCell({ fieldId: fid, col: "fieldName" })}>
                              {isEditingThis("fieldName") ? (
                                <input autoFocus defaultValue={fname} className="w-full px-1 py-0.5 rounded text-sm font-mono" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                                  onBlur={(e) => commitEdit("fieldName", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }} />
                              ) : fname}
                            </td>
                            <td className="py-1.5 px-3 cursor-pointer" onClick={() => setEditingCell({ fieldId: fid, col: "dataType" })}>
                              {isEditingThis("dataType") ? (
                                <select autoFocus defaultValue={dtype} className="px-1 py-0.5 rounded text-sm" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                                  onBlur={(e) => commitEdit("dataType", e.target.value)} onChange={(e) => commitEdit("dataType", e.target.value)}>
                                  {DATA_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: "rgba(91,192,222,0.12)", color: "#5bc0de" }}>{dtype}</span>
                              )}
                            </td>
                            <td className="py-1.5 px-3 text-center cursor-pointer" onClick={() => commitEdit("isRequired", !isReq)}>
                              {isReq ? <span style={{ color: "#4ecb71" }}>Yes</span> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                            </td>
                            <td className="py-1.5 px-3 text-center cursor-pointer" onClick={() => commitEdit("isUnique", !isUniq)}>
                              {isUniq ? <span style={{ color: "#4ecb71" }}>Yes</span> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                            </td>
                            <td className="py-1.5 px-3 text-center cursor-pointer" onClick={() => commitEdit("isForeignKey", !isFK)}>
                              {isFK ? <span style={{ color: "#4ecb71" }}>Yes</span> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                            </td>
                            <td className="py-1.5 px-3 cursor-pointer" style={{ color: refTable ? "#5bc0de" : "var(--color-text-muted)" }} onClick={() => setEditingCell({ fieldId: fid, col: "referencesTable" })}>
                              {isEditingThis("referencesTable") ? (
                                <select autoFocus defaultValue={String(f.referencesTable ?? "")} className="px-1 py-0.5 rounded text-sm" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                                  onBlur={(e) => commitEdit("referencesTable", e.target.value ? Number(e.target.value) : null)} onChange={(e) => commitEdit("referencesTable", e.target.value ? Number(e.target.value) : null)}>
                                  <option value="">—</option>
                                  {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                              ) : refTable || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Confirmation dialog for field edits */}
              {pendingEdit && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }} onClick={() => setPendingEdit(null)}>
                  <div className="rounded-lg border shadow-xl p-5 w-[380px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }} onClick={(e) => e.stopPropagation()}>
                    <div className="text-base font-semibold mb-3" style={{ color: "var(--color-text)" }}>Confirm Change</div>
                    <p className="text-sm mb-4" style={{ color: "var(--color-text-muted)" }}>
                      Change <span className="font-mono font-semibold" style={{ color: "var(--color-text)" }}>{pendingEdit.col}</span> from{" "}
                      <span className="font-semibold" style={{ color: "#e05555" }}>{String(pendingEdit.oldValue ?? "—")}</span> to{" "}
                      <span className="font-semibold" style={{ color: "#4ecb71" }}>{String(pendingEdit.newValue ?? "—")}</span>?
                    </p>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setPendingEdit(null)} className="px-3 py-1.5 text-sm rounded" style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-divider)" }}>Cancel</button>
                      <button onClick={() => {
                        if (onFieldUpdate) {
                          const updated = { ...pendingEdit.fieldRecord, [pendingEdit.col]: pendingEdit.newValue };
                          onFieldUpdate(updated);
                        }
                        setPendingEdit(null);
                      }} className="px-3 py-1.5 text-sm rounded font-medium" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-primary-text)" }}>Yes, Change</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
