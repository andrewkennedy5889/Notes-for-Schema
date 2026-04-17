

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FeatureRefInfo } from "./types";
import { PILL_COLORS } from "./constants";

/* ═══════════════════════════════════════════════════════════════
   LOCAL CONSTANTS (used only by these components)
   ═══════════════════════════════════════════════════════════════ */

const DATA_TYPE_DESCRIPTIONS: Array<{ value: string; desc: string }> = [
  { value: "UUID", desc: "Unique identifier (128-bit)" },
  { value: "Text", desc: "Variable-length string" },
  { value: "Int4", desc: "32-bit integer number" },
  { value: "Date", desc: "Calendar date (no time)" },
  { value: "Bool", desc: "True / false" },
  { value: "Timestamp", desc: "Date + time with timezone" },
  { value: "JSONB", desc: "Structured JSON object" },
  { value: "Enum", desc: "Fixed set of allowed values" },
  { value: "Array", desc: "List of values (typed)" },
];

const FIELD_SUB_COLS: Array<{ key: string; label: string; width?: string; badge?: string; tooltip?: string }> = [
  { key: "fieldName", label: "Field Name", width: "18%", tooltip: "Column name as it appears in the database" },
  { key: "fieldStatus", label: "Status", width: "6%", tooltip: "live = exists in DB, planned = not yet created" },
  { key: "dataType", label: "Type", width: "7%", tooltip: "PostgreSQL data type for this column" },
  { key: "isRequired", label: "Req", width: "4%", tooltip: "Is this field required (NOT NULL)?" },
  { key: "isUnique", label: "Unique", width: "5%", tooltip: "Does this field have a uniqueness constraint?" },
  { key: "isForeignKey", label: "FK", width: "4%", tooltip: "Is this field a foreign key referencing another table?" },
  { key: "referencesTable", label: "Ref Table", width: "10%", tooltip: "If FK, which table does this field reference?" },
  { key: "referencesField", label: "Ref Field", width: "10%", tooltip: "If FK, which specific field in that table?" },
  { key: "exampleValues", label: "Examples", badge: "2-7", tooltip: "2-7 example values illustrating what this field contains" },
  { key: "_referencedBy", label: "Referenced By", width: "12%", badge: "calc", tooltip: "Features that mention this field in their notes" },
];

/* ═══════════════════════════════════════════════════════════════
   LOCAL HELPERS: Pill, BoolPill
   ═══════════════════════════════════════════════════════════════ */

function Pill({ value }: { value: string }) {
  const c = PILL_COLORS[value] || { bg: "rgba(108,123,255,0.12)", text: "#6c7bff", border: "rgba(108,123,255,0.3)" };
  // Strip context prefix (e.g. "field:live" → "live") for display
  const display = value.includes(":") ? value.split(":").pop()! : value;
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {display}
    </span>
  );
}

function BoolPill({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: "rgba(78,203,113,0.12)", color: "#4ecb71", border: "1px solid rgba(78,203,113,0.3)" }}>
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: "rgba(102,102,128,0.12)", color: "#666680", border: "1px solid rgba(102,102,128,0.2)" }}>
      No
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTS: MultiSelect, TagsInput
   ═══════════════════════════════════════════════════════════════ */

export function MultiSelect({
  options,
  selected,
  onChange,
}: {
  options: { id: number; name: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  // Always show selected items; filter the rest by substring match, prefix matches ranked first, capped at 10.
  const selectedOptions = options.filter((o) => selected.includes(o.id));
  const q = query.trim().toLowerCase();
  const unselected = options.filter((o) => !selected.includes(o.id));
  const filtered = q
    ? unselected
        .map((o) => {
          const name = o.name.toLowerCase();
          const idx = name.indexOf(q);
          if (idx === -1) return null;
          return { o, rank: idx === 0 ? 0 : 1, idx };
        })
        .filter((x): x is { o: { id: number; name: string }; rank: number; idx: number } => x !== null)
        .sort((a, b) => a.rank - b.rank || a.idx - b.idx || a.o.name.localeCompare(b.o.name))
        .slice(0, 10)
        .map((x) => x.o)
    : unselected.slice(0, 10);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 text-sm rounded-md border text-left flex items-center justify-between focus:outline-none"
        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
      >
        {selected.length ? `${selected.length} selected` : "— Select —"}
        <span style={{ color: "var(--color-text-muted)" }}>▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-md border shadow-lg max-h-64 overflow-y-auto z-10" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
          <div className="sticky top-0 p-1.5 border-b" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search..."
              className="w-full px-2 py-1 text-xs rounded border focus:outline-none"
              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            />
          </div>
          {selectedOptions.length > 0 && (
            <div className="py-0.5">
              {selectedOptions.map((o) => (
                <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-black/5 text-sm" style={{ color: "var(--color-text)" }}>
                  <input
                    type="checkbox"
                    checked
                    onChange={() => onChange(selected.filter((id) => id !== o.id))}
                    style={{ accentColor: "var(--color-primary)" }}
                  />
                  {o.name}
                </label>
              ))}
              <div className="border-t my-0.5" style={{ borderColor: "var(--color-divider)" }} />
            </div>
          )}
          {filtered.map((o) => (
            <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-black/5 text-sm" style={{ color: "var(--color-text)" }}>
              <input
                type="checkbox"
                checked={false}
                onChange={() => onChange([...selected, o.id])}
                style={{ accentColor: "var(--color-primary)" }}
              />
              {o.name}
            </label>
          ))}
          {options.length === 0 && <p className="px-3 py-2 text-xs" style={{ color: "var(--color-text-muted)" }}>No options available</p>}
          {options.length > 0 && filtered.length === 0 && selectedOptions.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: "var(--color-text-muted)" }}>No matches</p>
          )}
          {!q && unselected.length > 10 && (
            <p className="px-3 py-1.5 text-[10px] border-t" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}>
              Showing 10 of {unselected.length}. Type to search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function TagsInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const val = input.trim();
    if (!val || tags.includes(val)) return;
    onChange([...tags, val]);
    setInput("");
  };

  return (
    <div
      className="flex flex-wrap gap-1.5 items-center px-2 py-1.5 rounded-md border min-h-[36px] cursor-text"
      style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}
      onClick={() => {
        const inp = document.getElementById("tags-input-inner");
        if (inp) inp.focus();
      }}
    >
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: "rgba(108,123,255,0.12)", color: "#6c7bff", border: "1px solid rgba(108,123,255,0.3)" }}
        >
          {t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-xs leading-none opacity-60 hover:opacity-100">&times;</button>
        </span>
      ))}
      <input
        id="tags-input-inner"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
        placeholder={tags.length === 0 ? "Type and press Enter..." : ""}
        className="flex-1 min-w-[80px] bg-transparent outline-none text-sm"
        style={{ color: "var(--color-text)" }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CHECKLIST EDITOR
   ═══════════════════════════════════════════════════════════════ */

export function ChecklistEditor({
  items,
  onChange,
}: {
  items: Array<{ item: string; checked: boolean }>;
  onChange: (items: Array<{ item: string; checked: boolean }>) => void;
}) {
  const [newItem, setNewItem] = useState("");

  return (
    <div className="space-y-1.5">
      {items.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-2 group">
          <input
            type="checkbox"
            checked={entry.checked}
            onChange={(e) => {
              const updated = [...items];
              updated[idx] = { ...entry, checked: e.target.checked };
              onChange(updated);
            }}
            className="w-3.5 h-3.5 rounded flex-shrink-0"
            style={{ accentColor: "var(--color-primary)" }}
          />
          <span className="text-xs flex-1" style={{ color: entry.checked ? "var(--color-text-muted)" : "var(--color-text)", textDecoration: entry.checked ? "line-through" : "none" }}>
            {entry.item}
          </span>
          <button
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
            className="text-xs leading-none opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
            style={{ color: "#e05555" }}
          >
            &times;
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newItem.trim()) {
              e.preventDefault();
              onChange([...items, { item: newItem.trim(), checked: false }]);
              setNewItem("");
            }
          }}
          placeholder="Add checklist item..."
          className="flex-1 px-2 py-1 text-xs rounded border focus:outline-none"
          style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EXPANDED FIELD ROWS (inside Data Tables expandable)
   ═══════════════════════════════════════════════════════════════ */

export function ExpandedFieldRows({
  tableId,
  fields,
  loading,
  colSpan,
  search,
  searchMode,
  resolveFK,
  getFKOptions,
  featureRefMap,
  hiddenCols,
  onToggleCol,
  onFieldUpdate,
  newFieldRow,
  onNewFieldChange,
  fkPickMode,
  onStartFkPick,
  onFkPickField,
  onFieldDelete,
  onAddField,
}: {
  tableId: number;
  fields: Record<string, unknown>[];
  loading: boolean;
  colSpan: number;
  search: string;
  searchMode: string;
  resolveFK: (tableName: string, id: unknown) => string;
  getFKOptions: (tableName: string, filterKey?: string, filterValue?: unknown) => Array<{ id: number; name: string }>;
  featureRefMap: Map<number, FeatureRefInfo[]>;
  hiddenCols: Set<string>;
  onToggleCol: (key: string) => void;
  onFieldUpdate: (updatedField: Record<string, unknown>) => void;
  newFieldRow?: { fieldName: string; dataType: string; isRequired: boolean; isUnique: boolean; isForeignKey: boolean; referencesTable: number | null; referencesField: number | null; exampleValues?: string } | null;
  onNewFieldChange?: (updates: Partial<{ fieldName: string; dataType: string; isRequired: boolean; isUnique: boolean; isForeignKey: boolean; referencesTable: number | null; referencesField: number | null; exampleValues: string }>) => void;
  fkPickMode?: { sourceFieldId: number; sourceTableId: number; fieldName: string; isNewField?: boolean } | null;
  onStartFkPick?: (fieldId: number, fieldName: string) => void;
  onFkPickField?: (targetTableId: number, targetFieldId: number) => void;
  onFieldDelete?: (field: Record<string, unknown>) => void;
  onAddField?: (field: Record<string, unknown>) => void;
}) {
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [editingCell, setEditingCell] = useState<{ fieldId: number; colKey: string } | null>(null);
  const [hoveredColKey, setHoveredColKey] = useState<string | null>(null);
  const [newFieldEditCell, setNewFieldEditCell] = useState<{ colKey: string; top: number; left: number } | null>(null);

  // Self-contained inline "add field" state (independent of picker mode)
  const [addingField, setAddingField] = useState(false);
  const [addFieldData, setAddFieldData] = useState({ fieldName: "", dataType: "Text", isRequired: false, isUnique: false, isForeignKey: false, referencesTable: null as number | null, referencesField: null as number | null, exampleValues: "" });
  const [addFieldEditCell, setAddFieldEditCell] = useState<string | null>(null);
  const addFieldNameRef = useRef<HTMLInputElement>(null);

  const resetAddField = () => {
    setAddingField(false);
    setAddFieldData({ fieldName: "", dataType: "Text", isRequired: false, isUnique: false, isForeignKey: false, referencesTable: null, referencesField: null, exampleValues: "" });
    setAddFieldEditCell(null);
  };

  const commitAddField = () => {
    if (!addFieldData.fieldName.trim() || !onAddField) return;
    onAddField({
      fieldName: addFieldData.fieldName.trim(),
      dataTableId: tableId,
      fieldStatus: "planned",
      dataType: addFieldData.dataType,
      isRequired: addFieldData.isRequired,
      isUnique: addFieldData.isUnique,
      isForeignKey: addFieldData.isForeignKey,
      referencesTable: addFieldData.referencesTable,
      referencesField: addFieldData.referencesField,
      exampleValues: addFieldData.exampleValues || null,
    });
    resetAddField();
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setColMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const visibleCols = FIELD_SUB_COLS.filter((c) => !hiddenCols.has(c.key));

  const DATA_TYPE_OPTIONS = DATA_TYPE_DESCRIPTIONS.map((d) => d.value);
  const STATUS_OPTIONS = ["live", "planned"];

  const commitFieldEdit = (field: Record<string, unknown>, colKey: string, newValue: unknown) => {
    if (field[colKey] === newValue) { setEditingCell(null); return; }
    const updated = { ...field, [colKey]: newValue };
    // Clear ref fields when FK is toggled off
    if (colKey === "isForeignKey" && !newValue) {
      updated.referencesTable = null;
      updated.referencesField = null;
    }
    // Clear referencesField when referencesTable changes
    if (colKey === "referencesTable") {
      updated.referencesField = null;
    }
    onFieldUpdate(updated);
    setEditingCell(null);
  };

  return (
    <tr className="border-b" style={{ borderColor: "var(--color-divider)" }}>
      <td colSpan={colSpan} className="p-0">
        {loading ? (
          <div className="py-3 px-6 text-[11px]" style={{ color: "var(--color-text-muted)" }}>Loading fields...</div>
        ) : (
          <div className="py-2 px-6" style={{ backgroundColor: "var(--color-surface)" }}>
            <div className="text-[10px] font-semibold mb-1.5 flex items-center gap-2" style={{ color: "var(--color-text-muted)" }}>
              Fields
              <span className="font-mono px-1 rounded" style={{ backgroundColor: "var(--color-divider)" }}>
                {fields.length}
              </span>
              {onAddField && !addingField && (
                <button
                  onClick={(e) => { e.stopPropagation(); setAddingField(true); setTimeout(() => addFieldNameRef.current?.focus(), 50); }}
                  className="px-1.5 py-0.5 rounded border text-[9px] font-medium hover:brightness-125"
                  style={{ borderColor: "#4ecb7155", color: "#4ecb71" }}
                >+ Add Field</button>
              )}
              {/* Column toggle for field sub-table */}
              <div className="relative ml-auto" ref={menuRef}>
                <button
                  onClick={(e) => { e.stopPropagation(); setColMenuOpen((v) => !v); }}
                  className="relative px-1.5 py-0.5 text-[9px] rounded border"
                  style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}
                >
                  Cols
                  {hiddenCols.size > 0 && (
                    <sup className="absolute -top-1 -right-1 min-w-[12px] h-[12px] flex items-center justify-center rounded-full text-[7px] font-bold" style={{ backgroundColor: "#e05555", color: "#fff" }}>{hiddenCols.size}</sup>
                  )}
                </button>
                {colMenuOpen && (
                  <div className="absolute top-full right-0 mt-1 rounded-md border shadow-lg z-20 py-1 min-w-[140px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                    {FIELD_SUB_COLS.map((col) => (
                      <label key={col.key} className="flex items-center gap-2 px-2.5 py-0.5 cursor-pointer hover:bg-black/5 text-[11px]" style={{ color: "var(--color-text)" }}>
                        <input
                          type="checkbox"
                          checked={!hiddenCols.has(col.key)}
                          onChange={() => onToggleCol(col.key)}
                          className="w-3 h-3"
                          style={{ accentColor: "var(--color-primary)" }}
                        />
                        {col.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {fields.length === 0 ? (
              <p className="text-[11px] py-1" style={{ color: "var(--color-text-muted)" }}>No fields defined.</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--color-divider)" }}>
                    {visibleCols.map((col) => (
                      <th
                        key={col.key}
                        className="text-left py-1 px-2 font-semibold relative cursor-default"
                        style={{ color: col.key === "_referencedBy" ? "#5bc0de" : "var(--color-text-muted)", width: col.width }}
                        onMouseEnter={() => setHoveredColKey(col.key)}
                        onMouseLeave={() => setHoveredColKey(null)}
                      >
                        {col.label}
                        {col.badge && <sup className="ml-0.5 font-normal" style={{ fontSize: "7px", color: col.key === "_referencedBy" ? "#5bc0de" : "#9999b3" }}>{col.badge}</sup>}
                        {/* Shared column guide tooltip */}
                        {hoveredColKey === col.key && (
                          <div
                            className="absolute z-40 mt-1 rounded-md border shadow-lg py-1.5 px-1"
                            style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", left: 0, top: "100%", minWidth: 280, pointerEvents: "none" }}
                          >
                            <div className="text-[9px] font-semibold uppercase tracking-wide px-2 pb-1 mb-1 border-b" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}>Field Columns</div>
                            {FIELD_SUB_COLS.filter((c) => c.tooltip).map((c) => (
                              <div
                                key={c.key}
                                className="flex gap-2 px-2 py-0.5 rounded text-[10px]"
                                style={{ backgroundColor: c.key === col.key ? "var(--color-surface)" : "transparent" }}
                              >
                                <span className="font-semibold shrink-0 w-[80px]" style={{ color: c.key === col.key ? "var(--color-text)" : "var(--color-text-muted)" }}>{c.label}</span>
                                <span style={{ color: c.key === col.key ? "var(--color-text)" : "var(--color-text-muted)", opacity: c.key === col.key ? 1 : 0.7 }}>{c.tooltip}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field, fi) => {
                    const matchesSearch = search && (searchMode === "fields" || searchMode === "examples");
                    const s = search?.toLowerCase() || "";
                    const fieldNameMatch = matchesSearch && searchMode === "fields" && String(field.fieldName ?? "").toLowerCase().includes(s);
                    const exampleMatch = matchesSearch && searchMode === "examples" && String(field.exampleValues ?? "").toLowerCase().includes(s);
                    const highlight = fieldNameMatch || exampleMatch;
                    const fieldId = field.fieldId as number;
                    const refByNames = featureRefMap.get(fieldId);
                    const isEditing = (colKey: string) => editingCell?.fieldId === fieldId && editingCell?.colKey === colKey;

                    const renderEditableText = (colKey: string, mono?: boolean) => {
                      if (isEditing(colKey)) {
                        return (
                          <td key={colKey} className="py-0.5 px-1">
                            <input
                              autoFocus
                              defaultValue={String(field[colKey] ?? "")}
                              className={`w-full px-1 py-0.5 rounded text-[11px] ${mono ? "font-mono" : ""}`}
                              style={{ backgroundColor: "var(--color-background)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                              onBlur={(e) => commitFieldEdit(field, colKey, e.target.value || null)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }}
                            />
                          </td>
                        );
                      }
                      const val = field[colKey];
                      return (
                        <td key={colKey} className={`py-1 px-2 cursor-pointer ${mono ? "font-mono" : ""}`} style={{ color: val ? "var(--color-text)" : "var(--color-text-muted)" }} onClick={() => setEditingCell({ fieldId, colKey })}>
                          {val ? String(val) : <span style={{ opacity: 0.4 }}>{colKey === "exampleValues" ? "no examples" : "—"}</span>}
                        </td>
                      );
                    };

                    const renderEditableEnum = (colKey: string, options: string[]) => {
                      if (isEditing(colKey)) {
                        return (
                          <td key={colKey} className="py-0.5 px-1">
                            <select
                              autoFocus
                              defaultValue={String(field[colKey] ?? options[0])}
                              className="px-1 py-0.5 rounded text-[11px]"
                              style={{ backgroundColor: "var(--color-background)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                              onBlur={(e) => commitFieldEdit(field, colKey, e.target.value)}
                              onChange={(e) => commitFieldEdit(field, colKey, e.target.value)}
                            >
                              {options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </td>
                        );
                      }
                      return (
                        <td key={colKey} className="py-1 px-2 cursor-pointer" onClick={() => setEditingCell({ fieldId, colKey })}>
                          <Pill value={String(field[colKey] ?? options[0])} />
                        </td>
                      );
                    };

                    const renderEditableBool = (colKey: string) => {
                      const val = field[colKey];
                      const display = val === true ? <BoolPill value={true} /> : val === false ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "rgba(224,85,85,0.15)", color: "#e05555" }}>No</span> : <span style={{ color: "var(--color-text-muted)" }}>—</span>;
                      if (isEditing(colKey)) {
                        const options: Array<{ value: true | false | null; label: string; color: string }> = [
                          { value: true, label: "Yes", color: "#4ecb71" },
                          { value: false, label: "No", color: "#e05555" },
                          { value: null, label: "—", color: "var(--color-text-muted)" },
                        ];
                        return (
                          <td key={colKey} className="py-0.5 px-1 relative">
                            <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                            <div
                              className="absolute z-30 rounded-md border shadow-lg py-1"
                              style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 80, left: 0, top: "100%" }}
                            >
                              {options.map((opt) => (
                                <div
                                  key={String(opt.value)}
                                  className="flex items-center gap-2 px-3 py-1 cursor-pointer text-[11px]"
                                  style={{ backgroundColor: val === opt.value ? "var(--color-surface)" : "transparent" }}
                                  onMouseDown={(e) => { e.preventDefault(); commitFieldEdit(field, colKey, opt.value); }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = val === opt.value ? "var(--color-surface)" : "transparent"; }}
                                >
                                  <span className="font-medium" style={{ color: opt.color }}>{opt.label}</span>
                                </div>
                              ))}
                            </div>
                            {display}
                          </td>
                        );
                      }
                      return (
                        <td key={colKey} className="py-1 px-2 cursor-pointer" onClick={() => setEditingCell({ fieldId, colKey })}>
                          {display}
                        </td>
                      );
                    };

                    const renderEditableFK = (colKey: string, fkTable: string, filterKey?: string, filterValue?: unknown) => {
                      if (isEditing(colKey)) {
                        const opts = getFKOptions(fkTable, filterKey, filterValue);
                        return (
                          <td key={colKey} className="py-0.5 px-1">
                            <select
                              autoFocus
                              defaultValue={String(field[colKey] ?? "")}
                              className="px-1 py-0.5 rounded text-[11px] max-w-[150px]"
                              style={{ backgroundColor: "var(--color-background)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                              onBlur={(e) => commitFieldEdit(field, colKey, e.target.value ? Number(e.target.value) : null)}
                              onChange={(e) => commitFieldEdit(field, colKey, e.target.value ? Number(e.target.value) : null)}
                            >
                              <option value="">—</option>
                              {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                          </td>
                        );
                      }
                      const val = field[colKey];
                      return (
                        <td key={colKey} className="py-1 px-2 cursor-pointer" style={{ color: val ? "#5bc0de" : "var(--color-text-muted)" }} onClick={() => setEditingCell({ fieldId, colKey })}>
                          {val ? resolveFK(fkTable, val) : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                        </td>
                      );
                    };

                    const isFkPickActive = !!fkPickMode && fkPickMode.sourceFieldId !== fieldId;

                    return (
                      <tr
                        key={fi}
                        className={`border-b last:border-b-0 ${isFkPickActive ? "cursor-pointer hover:!bg-[rgba(91,192,222,0.12)]" : ""}`}
                        style={{ borderColor: "var(--color-divider)", backgroundColor: highlight ? "rgba(91,192,222,0.06)" : isFkPickActive ? "rgba(91,192,222,0.04)" : "transparent", outline: isFkPickActive ? "1px dashed #5bc0de" : undefined, outlineOffset: -1 }}
                        onClick={isFkPickActive ? (e) => {
                          e.stopPropagation();
                          onFkPickField?.(tableId, fieldId);
                        } : undefined}
                      >
                        {visibleCols.map((col) => {
                          switch (col.key) {
                            case "fieldName": {
                              if (isFkPickActive) {
                                return <td key={col.key} className="py-1 px-2 font-mono cursor-pointer" style={{ color: "#5bc0de" }}>{String(field.fieldName ?? "")}</td>;
                              }
                              return renderEditableText("fieldName", true);
                            }
                            case "fieldStatus": {
                              if (isEditing("fieldStatus")) {
                                return (
                                  <td key={col.key} className="py-0.5 px-1 relative">
                                    <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                                    <div className="absolute z-30 rounded-md border shadow-lg py-1" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 80, left: 0, top: "100%" }}>
                                      {STATUS_OPTIONS.map((o) => (
                                        <div key={o} className="px-3 py-1 cursor-pointer text-[11px]" style={{ backgroundColor: String(field.fieldStatus) === o ? "var(--color-surface)" : "transparent", color: "var(--color-text)" }}
                                          onMouseDown={(e) => { e.preventDefault(); commitFieldEdit(field, "fieldStatus", o); }}
                                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"; }}
                                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = String(field.fieldStatus) === o ? "var(--color-surface)" : "transparent"; }}
                                        ><Pill value={`field:${o}`} /></div>
                                      ))}
                                    </div>
                                    <Pill value={`field:${String(field.fieldStatus ?? "planned")}`} />
                                  </td>
                                );
                              }
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => setEditingCell({ fieldId, colKey: "fieldStatus" })}>
                                  <Pill value={`field:${String(field.fieldStatus ?? "planned")}`} />
                                </td>
                              );
                            }
                            case "dataType": {
                              if (isEditing("dataType")) {
                                return (
                                  <td key={col.key} className="py-0.5 px-1 relative">
                                    <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
                                    <div
                                      className="absolute z-30 rounded-md border shadow-lg py-1"
                                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 260, left: 0, top: "100%" }}
                                    >
                                      {DATA_TYPE_DESCRIPTIONS.map((dt) => (
                                        <div
                                          key={dt.value}
                                          className="flex items-center gap-3 px-3 py-1.5 cursor-pointer text-[11px]"
                                          style={{ backgroundColor: String(field.dataType) === dt.value ? "var(--color-surface)" : "transparent" }}
                                          onMouseDown={(e) => { e.preventDefault(); commitFieldEdit(field, "dataType", dt.value); }}
                                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"; }}
                                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = String(field.dataType) === dt.value ? "var(--color-surface)" : "transparent"; }}
                                        >
                                          <span className="font-mono font-medium w-[70px] shrink-0" style={{ color: "var(--color-text)" }}>{dt.value}</span>
                                          <span style={{ color: "var(--color-text-muted)" }}>{dt.desc}</span>
                                        </div>
                                      ))}
                                    </div>
                                    <Pill value={String(field.dataType ?? "Text")} />
                                  </td>
                                );
                              }
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => setEditingCell({ fieldId, colKey: "dataType" })}>
                                  <Pill value={String(field.dataType ?? "Text")} />
                                </td>
                              );
                            }
                            case "isRequired": return renderEditableBool("isRequired");
                            case "isUnique": return renderEditableBool("isUnique");
                            case "isForeignKey": {
                              const fkVal = !!field.isForeignKey;
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => commitFieldEdit(field, "isForeignKey", !fkVal)}>
                                  {fkVal
                                    ? <BoolPill value={true} />
                                    : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>No</span>
                                  }
                                </td>
                              );
                            }
                            case "referencesTable": {
                              if (!field.isForeignKey) return <td key={col.key} className="py-1 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>N/A</span></td>;
                              const refTableName = field.referencesTable ? resolveFK("data_tables", field.referencesTable) : null;
                              const isPickingThis = fkPickMode?.sourceFieldId === fieldId;
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" style={{ color: refTableName ? "#5bc0de" : "var(--color-text-muted)" }} onClick={() => onStartFkPick?.(fieldId, String(field.fieldName ?? ""))}>
                                  {isPickingThis ? <span className="text-[10px] font-medium animate-pulse" style={{ color: "var(--color-primary)" }}>selecting...</span> : refTableName || <span style={{ color: "var(--color-text-muted)" }}>— click to pick —</span>}
                                </td>
                              );
                            }
                            case "referencesField": {
                              if (!field.isForeignKey) return <td key={col.key} className="py-1 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>N/A</span></td>;
                              const refFieldName = field.referencesField ? resolveFK("data_fields", field.referencesField) : null;
                              const isPickingThisField = fkPickMode?.sourceFieldId === fieldId;
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" style={{ color: refFieldName ? "#5bc0de" : "var(--color-text-muted)" }} onClick={() => onStartFkPick?.(fieldId, String(field.fieldName ?? ""))}>
                                  {isPickingThisField ? <span className="text-[10px] font-medium animate-pulse" style={{ color: "var(--color-primary)" }}>selecting...</span> : refFieldName || <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                                </td>
                              );
                            }
                            case "exampleValues": return renderEditableText("exampleValues");
                            case "_referencedBy": return (
                              <td key={col.key} className="py-1 px-2">
                                {refByNames && refByNames.length > 0 ? (
                                  <span
                                    className="px-1 py-0.5 rounded text-[9px] cursor-default"
                                    style={{ backgroundColor: "rgba(91,192,222,0.12)", border: "1px solid rgba(91,192,222,0.3)", color: "#5bc0de" }}
                                    title={refByNames.map((r) => r.moduleNames ? `${r.featureName} (${r.moduleNames})` : r.featureName).join("\n")}
                                  >
                                    {refByNames.length} {refByNames.length === 1 ? "feature" : "features"}
                                  </span>
                                ) : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                              </td>
                            );
                            default: return null;
                          }
                        })}
                        {onFieldDelete && !isFkPickActive && (
                          <td className="py-1 px-2 text-right">
                            <button
                              className="text-[10px] hover:underline"
                              style={{ color: "#e05555" }}
                              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete field "${field.fieldName}"?`)) onFieldDelete(field); }}
                            >Del</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {/* Inline new field row — matches existing field editing pattern */}
                  {newFieldRow && onNewFieldChange && (() => {
                    const isNfEditing = (colKey: string) => newFieldEditCell?.colKey === colKey;
                    const nfBoolRender = (colKey: "isRequired" | "isUnique") => (
                      <td key={colKey} className="py-1 px-2 cursor-pointer" onClick={() => onNewFieldChange({ [colKey]: !newFieldRow[colKey] })}>
                        {newFieldRow[colKey]
                          ? <BoolPill value={true} />
                          : <span style={{ color: "var(--color-text-muted)" }}>—</span>
                        }
                      </td>
                    );
                    return (
                      <tr className="border-t" style={{ borderColor: "#5bc0de", backgroundColor: "rgba(91,192,222,0.06)" }}>
                        {visibleCols.map((col) => {
                          switch (col.key) {
                            case "fieldName": return (
                              <td key={col.key} className="py-1 px-2 font-mono" style={{ color: newFieldRow.fieldName ? "#5bc0de" : "var(--color-text-muted)" }}>
                                {newFieldRow.fieldName || <span style={{ opacity: 0.4 }}>enter name above</span>}
                              </td>
                            );
                            case "fieldStatus": return <td key={col.key} className="py-1 px-2"><Pill value="field:planned" /></td>;
                            case "dataType": {
                              if (isNfEditing("dataType")) {
                                return (
                                  <td key={col.key} className="py-0.5 px-1">
                                    <div className="fixed inset-0 z-20" onMouseDown={() => setNewFieldEditCell(null)} />
                                    <div className="fixed z-30 rounded-md border shadow-lg py-1" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 260, left: newFieldEditCell?.left ?? 0, top: newFieldEditCell?.top ?? 0 }}>
                                      {DATA_TYPE_DESCRIPTIONS.map((dt) => (
                                        <div key={dt.value} className="flex items-center gap-3 px-3 py-1.5 cursor-pointer text-[11px]"
                                          style={{ backgroundColor: newFieldRow.dataType === dt.value ? "var(--color-surface)" : "transparent" }}
                                          onMouseDown={(e) => { e.preventDefault(); onNewFieldChange({ dataType: dt.value }); setNewFieldEditCell(null); }}
                                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"; }}
                                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = newFieldRow.dataType === dt.value ? "var(--color-surface)" : "transparent"; }}
                                        >
                                          <span className="font-mono font-medium w-[70px] shrink-0" style={{ color: "var(--color-text)" }}>{dt.value}</span>
                                          <span style={{ color: "var(--color-text-muted)" }}>{dt.desc}</span>
                                        </div>
                                      ))}
                                    </div>
                                    {newFieldRow.dataType ? <Pill value={newFieldRow.dataType} /> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                                  </td>
                                );
                              }
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={(e) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setNewFieldEditCell({ colKey: "dataType", top: rect.bottom + 2, left: rect.left }); }}>
                                  {newFieldRow.dataType ? <Pill value={newFieldRow.dataType} /> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                                </td>
                              );
                            }
                            case "isRequired": return nfBoolRender("isRequired");
                            case "isUnique": return nfBoolRender("isUnique");
                            case "isForeignKey": return (
                              <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => onNewFieldChange({ isForeignKey: !newFieldRow.isForeignKey, ...(!newFieldRow.isForeignKey ? {} : { referencesTable: null, referencesField: null }) })}>
                                {newFieldRow.isForeignKey ? <BoolPill value={true} /> : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>No</span>}
                              </td>
                            );
                            case "referencesTable": {
                              if (!newFieldRow.isForeignKey) return <td key={col.key} className="py-1 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>N/A</span></td>;
                              const nfRefTableName = newFieldRow.referencesTable ? resolveFK("data_tables", newFieldRow.referencesTable) : null;
                              const nfIsPickingTable = fkPickMode?.isNewField && fkPickMode?.sourceTableId === tableId;
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" style={{ color: nfRefTableName ? "#5bc0de" : "var(--color-text-muted)" }}
                                  onClick={() => onStartFkPick?.(-1, newFieldRow.fieldName || "new field")}
                                >
                                  {nfIsPickingTable ? <span className="text-[10px] font-medium animate-pulse" style={{ color: "var(--color-primary)" }}>selecting...</span> : nfRefTableName || <span style={{ color: "var(--color-text-muted)" }}>— click to pick —</span>}
                                </td>
                              );
                            }
                            case "referencesField": {
                              if (!newFieldRow.isForeignKey) return <td key={col.key} className="py-1 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>N/A</span></td>;
                              const nfRefFieldName = newFieldRow.referencesField ? resolveFK("data_fields", newFieldRow.referencesField) : null;
                              const nfIsPickingField = fkPickMode?.isNewField && fkPickMode?.sourceTableId === tableId;
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" style={{ color: nfRefFieldName ? "#5bc0de" : "var(--color-text-muted)" }}
                                  onClick={() => onStartFkPick?.(-1, newFieldRow.fieldName || "new field")}
                                >
                                  {nfIsPickingField ? <span className="text-[10px] font-medium animate-pulse" style={{ color: "var(--color-primary)" }}>selecting...</span> : nfRefFieldName || <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                                </td>
                              );
                            }
                            case "exampleValues": {
                              if (isNfEditing("exampleValues")) {
                                return (
                                  <td key={col.key} className="py-0.5 px-1">
                                    <input
                                      autoFocus
                                      defaultValue={newFieldRow.exampleValues ?? ""}
                                      className="w-full px-1 py-0.5 rounded text-[11px]"
                                      style={{ backgroundColor: "var(--color-background)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                                      onBlur={(e) => { onNewFieldChange({ exampleValues: e.target.value || undefined } as Record<string, unknown>); setNewFieldEditCell(null); }}
                                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNewFieldEditCell(null); }}
                                      placeholder="e.g. value1, value2"
                                    />
                                  </td>
                                );
                              }
                              return (
                                <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={(e) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setNewFieldEditCell({ colKey: "exampleValues", top: rect.bottom + 2, left: rect.left }); }}>
                                  {newFieldRow.exampleValues
                                    ? <span className="text-[10px] italic" style={{ color: "var(--color-text-muted)" }}>e.g. {newFieldRow.exampleValues}</span>
                                    : <span className="text-[10px]" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>no examples</span>
                                  }
                                </td>
                              );
                            }
                            case "_referencedBy": return <td key={col.key} className="py-1 px-2" style={{ color: "var(--color-text-muted)" }}>—</td>;
                            default: return <td key={col.key} className="py-1 px-2" style={{ color: "var(--color-text-muted)" }}>—</td>;
                          }
                        })}
                      </tr>
                    );
                  })()}
                  {/* Self-contained inline add field row */}
                  {addingField && onAddField && (() => {
                    const isAfe = (colKey: string) => addFieldEditCell === colKey;
                    return (
                      <tr className="border-t" style={{ borderColor: "#4ecb71", backgroundColor: "rgba(78,203,113,0.06)" }}>
                        {visibleCols.map((col) => {
                          switch (col.key) {
                            case "fieldName": return (
                              <td key={col.key} className="py-0.5 px-1">
                                <input
                                  ref={addFieldNameRef}
                                  value={addFieldData.fieldName}
                                  onChange={(e) => setAddFieldData((p) => ({ ...p, fieldName: e.target.value }))}
                                  onKeyDown={(e) => { if (e.key === "Enter") commitAddField(); if (e.key === "Escape") resetAddField(); }}
                                  placeholder="field_name"
                                  className="w-full px-1 py-0.5 rounded text-[11px] font-mono"
                                  style={{ backgroundColor: "var(--color-background)", color: "#4ecb71", border: "1px solid #4ecb7155", outline: "none" }}
                                />
                              </td>
                            );
                            case "fieldStatus": return <td key={col.key} className="py-1 px-2"><Pill value="field:planned" /></td>;
                            case "dataType": {
                              if (isAfe("dataType")) {
                                return (
                                  <td key={col.key} className="py-0.5 px-1 relative">
                                    <div className="fixed inset-0 z-20" onMouseDown={() => setAddFieldEditCell(null)} />
                                    <div className="absolute z-30 rounded-md border shadow-lg py-1" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 260, left: 0, top: "100%" }}>
                                      {DATA_TYPE_DESCRIPTIONS.map((dt) => (
                                        <div key={dt.value} className="flex items-center gap-3 px-3 py-1.5 cursor-pointer text-[11px]"
                                          style={{ backgroundColor: addFieldData.dataType === dt.value ? "var(--color-surface)" : "transparent" }}
                                          onMouseDown={(e) => { e.preventDefault(); setAddFieldData((p) => ({ ...p, dataType: dt.value })); setAddFieldEditCell(null); }}
                                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"; }}
                                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = addFieldData.dataType === dt.value ? "var(--color-surface)" : "transparent"; }}
                                        >
                                          <span className="font-mono font-medium w-[70px] shrink-0" style={{ color: "var(--color-text)" }}>{dt.value}</span>
                                          <span style={{ color: "var(--color-text-muted)" }}>{dt.desc}</span>
                                        </div>
                                      ))}
                                    </div>
                                    <Pill value={addFieldData.dataType} />
                                  </td>
                                );
                              }
                              return <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => setAddFieldEditCell("dataType")}><Pill value={addFieldData.dataType} /></td>;
                            }
                            case "isRequired": return (
                              <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => setAddFieldData((p) => ({ ...p, isRequired: !p.isRequired }))}>
                                {addFieldData.isRequired ? <BoolPill value={true} /> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                              </td>
                            );
                            case "isUnique": return (
                              <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => setAddFieldData((p) => ({ ...p, isUnique: !p.isUnique }))}>
                                {addFieldData.isUnique ? <BoolPill value={true} /> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                              </td>
                            );
                            case "isForeignKey": return (
                              <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => setAddFieldData((p) => ({ ...p, isForeignKey: !p.isForeignKey, ...(!p.isForeignKey ? {} : { referencesTable: null, referencesField: null }) }))}>
                                {addFieldData.isForeignKey ? <BoolPill value={true} /> : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>No</span>}
                              </td>
                            );
                            case "referencesTable": {
                              if (!addFieldData.isForeignKey) return <td key={col.key} className="py-1 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>N/A</span></td>;
                              if (isAfe("referencesTable")) {
                                const opts = getFKOptions("data_tables");
                                return (
                                  <td key={col.key} className="py-0.5 px-1">
                                    <select autoFocus defaultValue={String(addFieldData.referencesTable ?? "")}
                                      className="px-1 py-0.5 rounded text-[11px] max-w-[150px]"
                                      style={{ backgroundColor: "var(--color-background)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                                      onBlur={(e) => { setAddFieldData((p) => ({ ...p, referencesTable: e.target.value ? Number(e.target.value) : null, referencesField: null })); setAddFieldEditCell(null); }}
                                      onChange={(e) => { setAddFieldData((p) => ({ ...p, referencesTable: e.target.value ? Number(e.target.value) : null, referencesField: null })); setAddFieldEditCell(null); }}
                                    >
                                      <option value="">—</option>
                                      {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                                    </select>
                                  </td>
                                );
                              }
                              return <td key={col.key} className="py-1 px-2 cursor-pointer" style={{ color: addFieldData.referencesTable ? "#5bc0de" : "var(--color-text-muted)" }} onClick={() => setAddFieldEditCell("referencesTable")}>{addFieldData.referencesTable ? resolveFK("data_tables", addFieldData.referencesTable) : "—"}</td>;
                            }
                            case "referencesField": {
                              if (!addFieldData.isForeignKey) return <td key={col.key} className="py-1 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>N/A</span></td>;
                              if (isAfe("referencesField") && addFieldData.referencesTable) {
                                const opts = getFKOptions("data_fields", "dataTableId", addFieldData.referencesTable);
                                return (
                                  <td key={col.key} className="py-0.5 px-1">
                                    <select autoFocus defaultValue={String(addFieldData.referencesField ?? "")}
                                      className="px-1 py-0.5 rounded text-[11px] max-w-[150px]"
                                      style={{ backgroundColor: "var(--color-background)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                                      onBlur={(e) => { setAddFieldData((p) => ({ ...p, referencesField: e.target.value ? Number(e.target.value) : null })); setAddFieldEditCell(null); }}
                                      onChange={(e) => { setAddFieldData((p) => ({ ...p, referencesField: e.target.value ? Number(e.target.value) : null })); setAddFieldEditCell(null); }}
                                    >
                                      <option value="">—</option>
                                      {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                                    </select>
                                  </td>
                                );
                              }
                              return <td key={col.key} className="py-1 px-2 cursor-pointer" style={{ color: addFieldData.referencesField ? "#5bc0de" : "var(--color-text-muted)" }} onClick={() => addFieldData.referencesTable ? setAddFieldEditCell("referencesField") : undefined}>{addFieldData.referencesField ? resolveFK("data_fields", addFieldData.referencesField) : "—"}</td>;
                            }
                            case "exampleValues": {
                              if (isAfe("exampleValues")) {
                                return (
                                  <td key={col.key} className="py-0.5 px-1">
                                    <input autoFocus value={addFieldData.exampleValues} onChange={(e) => setAddFieldData((p) => ({ ...p, exampleValues: e.target.value }))}
                                      onBlur={() => setAddFieldEditCell(null)} onKeyDown={(e) => { if (e.key === "Enter") setAddFieldEditCell(null); if (e.key === "Escape") setAddFieldEditCell(null); }}
                                      placeholder="e.g. value1, value2" className="w-full px-1 py-0.5 rounded text-[11px]"
                                      style={{ backgroundColor: "var(--color-background)", color: "var(--color-text)", border: "1px solid var(--color-primary)", outline: "none" }}
                                    />
                                  </td>
                                );
                              }
                              return <td key={col.key} className="py-1 px-2 cursor-pointer" onClick={() => setAddFieldEditCell("exampleValues")}><span style={{ color: "var(--color-text-muted)", opacity: addFieldData.exampleValues ? 1 : 0.4 }}>{addFieldData.exampleValues || "no examples"}</span></td>;
                            }
                            case "_referencedBy": return <td key={col.key} className="py-1 px-2" style={{ color: "var(--color-text-muted)" }}>—</td>;
                            default: return <td key={col.key} className="py-1 px-2">—</td>;
                          }
                        })}
                        <td className="py-1 px-2 text-right whitespace-nowrap">
                          <button className="text-[10px] font-medium mr-2 hover:underline" style={{ color: addFieldData.fieldName.trim() ? "#4ecb71" : "var(--color-text-muted)" }} onClick={commitAddField} disabled={!addFieldData.fieldName.trim()}>Save</button>
                          <button className="text-[10px] hover:underline" style={{ color: "var(--color-text-muted)" }} onClick={resetAddField}>Cancel</button>
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
