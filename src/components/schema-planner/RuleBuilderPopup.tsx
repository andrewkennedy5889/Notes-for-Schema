

import React, { useState, useCallback } from "react";
import type { RuleCondition, RuleRecord } from "./types";
import SearchableTablePicker from "./SearchableTablePicker";

const RULE_RELATIONSHIPS: Record<string, { label: string; tooltip: string }> = {
  operated_by: { label: "Operated By", tooltip: "The primary user entity — collects/manipulates inputs, determines outputs & their direction" },
  receives_input_from: { label: "Receives Input From", tooltip: "This module requires inputs from these business types or entities" },
  delivers_output_to: { label: "Delivers Output To", tooltip: "These business types or entities receive the results/deliverables" },
};

const CONDITION_OPERATORS = [
  { value: "equals", label: "=" },
  { value: "not_equals", label: "≠" },
  { value: "contains", label: "contains" },
  { value: "greater_than", label: ">" },
  { value: "less_than", label: "<" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "has value" },
  { value: "in", label: "is one of" },
] as const;

const LOGIC_OPTIONS = ["AND", "OR", "NOT"] as const;

function RuleBuilderPopup({
  moduleId,
  moduleName,
  relationship,
  rules,
  dataTables,
  dataFields,
  onSave,
  onClose,
}: {
  moduleId: number;
  moduleName: string;
  relationship: string;
  rules: RuleRecord[];
  dataTables: Array<{ tableId: number; tableName: string }>;
  dataFields: Array<{ fieldId: number; fieldName: string; dataTableId: number }>;
  onSave: (created: RuleRecord[], updated: RuleRecord[], deleted: number[]) => void;
  onClose: () => void;
}) {
  const [localRules, setLocalRules] = useState<RuleRecord[]>(() =>
    rules.map((r) => ({ ...r }))
  );
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [deletedIds, setDeletedIds] = useState<number[]>([]);
  const relInfo = RULE_RELATIONSHIPS[relationship];

  // Fields for the currently selected source table in the editing rule
  const fieldsForTable = useCallback(
    (tableName: string) => {
      const tbl = dataTables.find((t) => t.tableName === tableName);
      if (!tbl) return [];
      return dataFields.filter((f) => f.dataTableId === tbl.tableId);
    },
    [dataTables, dataFields]
  );

  const addRule = () => {
    const newRule: RuleRecord = {
      entityType: "module",
      entityId: moduleId,
      relationship,
      sourceTable: "",
      sourceRefId: null,
      sourceRefLabel: "",
      logic: "AND",
      conditions: [],
      sortOrder: localRules.length,
    };
    setLocalRules((prev) => [...prev, newRule]);
    setEditingIdx(localRules.length);
  };

  const updateRule = (idx: number, patch: Partial<RuleRecord>) => {
    setLocalRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRule = (idx: number) => {
    const rule = localRules[idx];
    if (rule.ruleId) setDeletedIds((prev) => [...prev, rule.ruleId!]);
    setLocalRules((prev) => prev.filter((_, i) => i !== idx));
    setEditingIdx(null);
  };

  const addCondition = (ruleIdx: number) => {
    setLocalRules((prev) =>
      prev.map((r, i) =>
        i === ruleIdx ? { ...r, conditions: [...r.conditions, { field: "", operator: "equals", value: "" }] } : r
      )
    );
  };

  const updateCondition = (ruleIdx: number, condIdx: number, patch: Partial<RuleCondition>) => {
    setLocalRules((prev) =>
      prev.map((r, i) =>
        i === ruleIdx
          ? { ...r, conditions: r.conditions.map((c, ci) => (ci === condIdx ? { ...c, ...patch } : c)) }
          : r
      )
    );
  };

  const removeCondition = (ruleIdx: number, condIdx: number) => {
    setLocalRules((prev) =>
      prev.map((r, i) =>
        i === ruleIdx ? { ...r, conditions: r.conditions.filter((_, ci) => ci !== condIdx) } : r
      )
    );
  };

  const handleSave = () => {
    // Validate — each rule needs a source table and label
    for (const r of localRules) {
      if (!r.sourceTable) {
        alert("Each rule needs a source table selected.");
        return;
      }
      if (!r.sourceRefLabel.trim()) {
        alert("Each rule needs a display label.");
        return;
      }
    }
    const created = localRules.filter((r) => !r.ruleId);
    const updated = localRules.filter((r) => r.ruleId);
    onSave(created, updated, deletedIds);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-12"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl border shadow-2xl w-[700px] max-w-[95vw] max-h-[80vh] flex flex-col"
        style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
          <div>
            <h4 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              {relInfo?.label || relationship}
            </h4>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              Module: <strong>{moduleName}</strong> — {relInfo?.tooltip}
            </p>
          </div>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: "var(--color-text-muted)" }}>&times;</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-3">
          {localRules.length === 0 && (
            <p className="text-xs text-center py-6" style={{ color: "var(--color-text-muted)" }}>
              No rules defined. Click &ldquo;+ Add Rule&rdquo; to start.
            </p>
          )}

          {localRules.map((rule, idx) => {
            const isEditing = editingIdx === idx;
            const availableFields = rule.sourceTable ? fieldsForTable(rule.sourceTable) : [];

            return (
              <div
                key={idx}
                className="rounded-lg border p-3"
                style={{
                  borderColor: isEditing ? "var(--color-primary)" : "var(--color-divider)",
                  backgroundColor: isEditing ? "var(--color-surface)" : "transparent",
                }}
              >
                {/* Rule summary / edit toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {!isEditing ? (
                      <button
                        onClick={() => setEditingIdx(idx)}
                        className="text-xs text-left hover:underline truncate"
                        style={{ color: "var(--color-text)" }}
                      >
                        <span className="font-medium">{rule.sourceRefLabel || "(unnamed)"}</span>
                        <span style={{ color: "var(--color-text-muted)" }}> — {rule.sourceTable || "no table"}</span>
                        {rule.conditions.length > 0 && (
                          <span className="ml-1 px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: "rgba(108,123,255,0.12)", color: "#6c7bff" }}>
                            {rule.conditions.length} condition{rule.conditions.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-xs font-medium" style={{ color: "var(--color-primary)" }}>Editing rule</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {isEditing && (
                      <button onClick={() => setEditingIdx(null)} className="text-xs px-2 py-0.5 rounded" style={{ color: "var(--color-text-muted)" }}>Done</button>
                    )}
                    <button
                      onClick={() => removeRule(idx)}
                      className="text-xs px-1.5 py-0.5 rounded hover:opacity-80"
                      style={{ color: "#e05555" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div className="mt-3 space-y-3">
                    {/* Source table */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-semibold block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Source Table</label>
                        <SearchableTablePicker
                          value={rule.sourceTable}
                          options={dataTables}
                          onChange={(tableName) => updateRule(idx, { sourceTable: tableName, sourceRefId: null })}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold block mb-0.5" style={{ color: "var(--color-text-muted)" }}>Display Label</label>
                        <input
                          type="text"
                          value={rule.sourceRefLabel}
                          onChange={(e) => updateRule(idx, { sourceRefLabel: e.target.value })}
                          placeholder="e.g. Service Company, Sales Managers"
                          className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
                          style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-background)", color: "var(--color-text)" }}
                        />
                      </div>
                    </div>

                    {/* Specific record (optional) */}
                    <div>
                      <label className="text-[10px] font-semibold block mb-0.5" style={{ color: "var(--color-text-muted)" }}>
                        Specific Record <span style={{ opacity: 0.5 }}>(optional — leave blank to match by conditions below)</span>
                      </label>
                      <input
                        type="number"
                        value={rule.sourceRefId ?? ""}
                        onChange={(e) => updateRule(idx, { sourceRefId: e.target.value ? Number(e.target.value) : null })}
                        placeholder="Record ID (optional)"
                        className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-background)", color: "var(--color-text)" }}
                      />
                    </div>

                    {/* Conditions */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[10px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
                          Conditions
                        </label>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Logic:</label>
                          <select
                            value={rule.logic}
                            onChange={(e) => updateRule(idx, { logic: e.target.value })}
                            className="px-1.5 py-0.5 text-[10px] rounded border"
                            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-background)", color: "var(--color-text)" }}
                          >
                            {LOGIC_OPTIONS.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {rule.conditions.length === 0 && (
                        <p className="text-[10px] py-2" style={{ color: "var(--color-text-muted)" }}>
                          No conditions — this rule matches all records in the source table.
                        </p>
                      )}

                      {rule.conditions.map((cond, ci) => (
                        <div key={ci} className="flex items-center gap-1.5 mb-1.5">
                          {/* Field picker */}
                          <select
                            value={cond.field}
                            onChange={(e) => updateCondition(idx, ci, { field: e.target.value })}
                            className="flex-1 px-1.5 py-1 text-xs rounded border"
                            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-background)", color: "var(--color-text)" }}
                          >
                            <option value="">— field —</option>
                            {availableFields.map((f) => (
                              <option key={f.fieldId} value={f.fieldName}>{f.fieldName}</option>
                            ))}
                            {/* Allow free-text for cross-table refs like org.business_type */}
                            {cond.field && !availableFields.find((f) => f.fieldName === cond.field) && (
                              <option value={cond.field}>{cond.field} (custom)</option>
                            )}
                          </select>

                          {/* Operator */}
                          <select
                            value={cond.operator}
                            onChange={(e) => updateCondition(idx, ci, { operator: e.target.value })}
                            className="w-24 px-1.5 py-1 text-xs rounded border"
                            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-background)", color: "var(--color-text)" }}
                          >
                            {CONDITION_OPERATORS.map((op) => (
                              <option key={op.value} value={op.value}>{op.label}</option>
                            ))}
                          </select>

                          {/* Value — hidden for is_empty/is_not_empty */}
                          {cond.operator !== "is_empty" && cond.operator !== "is_not_empty" ? (
                            <input
                              type="text"
                              value={cond.value}
                              onChange={(e) => updateCondition(idx, ci, { value: e.target.value })}
                              placeholder="value"
                              className="flex-1 px-1.5 py-1 text-xs rounded border"
                              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-background)", color: "var(--color-text)" }}
                            />
                          ) : (
                            <div className="flex-1" />
                          )}

                          <button
                            onClick={() => removeCondition(idx, ci)}
                            className="text-xs px-1 hover:opacity-80"
                            style={{ color: "#e05555" }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      <button
                        onClick={() => addCondition(idx)}
                        className="text-[10px] mt-1 hover:underline"
                        style={{ color: "var(--color-primary)" }}
                      >
                        + Add Condition
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button
            onClick={addRule}
            className="w-full py-2 rounded-lg border border-dashed text-xs hover:opacity-80"
            style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}
          >
            + Add Rule
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--color-divider)" }}>
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-md border" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>Cancel</button>
          <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-md font-medium" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-primary-text)" }}>Save Rules</button>
        </div>
      </div>
    </div>
  );
}

export default RuleBuilderPopup;
