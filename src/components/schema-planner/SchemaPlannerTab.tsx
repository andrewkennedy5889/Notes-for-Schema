

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

// ─── Local persisted preference hook (localStorage-backed) ─────────────────────
function usePersistedPreference<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return JSON.parse(stored) as T;
    } catch { /* ignore */ }
    return defaultValue;
  });
  const setValueAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* ignore */ }
      return resolved;
    });
  }, [key]) as React.Dispatch<React.SetStateAction<T>>;
  return [value, setValueAndPersist];
}
function usePreferencesLoaded() { return true; }
function usePreferencesPending() { return { hasPendingPrefs: false, flushPrefs: async () => {} }; }
import { DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";

// Schema planner extracted modules
import type { ColDef, TableConfig, GroupingOperator, GroupingRule, GroupingConfig, GroupingCondition, FeatureRefInfo, ExtractedRef, SortEntry, FilterRule, ColDisplayConfig, ColumnSeparator, ViewPresetConfig, RuleCondition, RuleRecord } from "./types";
import { TABLE_CONFIGS, CRUD_TABS, SUB_TABS, TAB_DEPS, TAB_INVALIDATES, DEFAULT_CHECKLIST_ITEMS, PILL_COLORS, MODULE_FEATURE_COLS, PLATFORM_OPTIONS, PLATFORM_COLORS, PLATFORM_NOTE_SECTIONS, OWNERSHIP_OPTIONS, EMPTY_IMAGES, GROUP_COLORS, DATA_TYPE_DESCRIPTIONS, FIELD_SUB_COLS, PAGE_SIZE_OPTIONS, TAG_TIER_COLORS } from "./constants";
import { GROUPING_OPERATORS, evaluateMultiLevelGrouping, normalizeGroupingConfig, deriveValueFromRule, flattenGroupNodes } from "./grouping-engine";
import { REF_REGEX, extractRefs, rawToDisplay, displayToRaw, toSnakeCase, validateFieldName, nameSimilarity, findSimilarNames, extractRefsFromNotes, FmtType, FmtRange, fmtStyle, toggleFmtRange, clearFmtRange, adjustRangesForEdit, toggleListPrefix } from "./text-utils";
import { RichRefText } from "./RichRefText";
import { MentionTextarea } from "./MentionTextarea";
import { FeatureMentionField } from "./FeatureMentionField";
import FeatureImageGallery from "./FeatureImageGallery";
import { ImageCarouselModal } from "./ImageCarouselModal";
import RuleBuilderPopup from "./RuleBuilderPopup";
import SearchableTablePicker from "./SearchableTablePicker";
import AccessMatrixView from "./AccessMatrixView";
import { ExpandedFieldRows, MultiSelect, TagsInput, ChecklistEditor } from "./ExpandedFieldRows";
import ModuleTagsEditor from "./ModuleTagsEditor";
import RefSummaryPopup from "./RefSummaryPopup";
import ImplementationStepsGrid from "./ImplementationStepsGrid";
import FeatureTestsGrid from "./FeatureTestsGrid";
import FeatureTestsPopup from "./FeatureTestsPopup";
import PrototypesGrid from "./PrototypesGrid";
import ProjectsGrid from "./ProjectsGrid";
import DependedOnBySection from "./DependedOnBySection";
import { FullscreenNoteWrapper } from "./FullscreenNoteWrapper";
import { fetchColumnDefs, createColumnDef, deleteColumnDef, type ColumnDef, fetchDisplayTemplates, fetchColumnTemplateAssignments, seedDisplayTemplates, createDisplayTemplate, updateDisplayTemplate, deleteDisplayTemplate, assignColumnTemplate, removeColumnTemplateAssignment, type DisplayTemplate, type ColumnTemplateAssignment, fetchEntityNotesByType, saveEntityNote, type EntityNote } from "@/lib/api";
import { evaluateFormula } from "@/lib/formula-eval";

/** Draggable table row grip handle */
function DragGrip({ id, groupName }: { id: string; groupName: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { sourceGroup: groupName },
  });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="inline-flex items-center justify-center w-4 h-4 rounded cursor-grab active:cursor-grabbing"
      style={{ opacity: isDragging ? 0.3 : 0.5, color: "var(--color-text-muted)", touchAction: "none" }}
      title="Drag to move between groups"
    >
      ⠿
    </span>
  );
}

/** Droppable group header wrapper */
function DroppableGroupHeader({ groupKey, children }: { groupKey: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: groupKey });
  return (
    <tr
      ref={setNodeRef}
      className="cursor-pointer select-none transition-colors"
      style={{
        backgroundColor: isOver ? "rgba(var(--color-primary-rgb, 66,139,202), 0.15)" : "var(--color-surface)",
        outline: isOver ? "2px solid var(--color-primary)" : undefined,
        outlineOffset: -2,
      }}
    >
      {children}
    </tr>
  );
}

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

// ─── Template display mode helpers ──────────────────────────────────────────

const TEMPLATE_PALETTE = ["#5bc0de", "#4ecb71", "#f2b661", "#e67d4a", "#e05555", "#a855f7", "#6c7bff", "#9999b3", "#ff7eb3", "#38bdf8"];

function hashColor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return TEMPLATE_PALETTE[Math.abs(hash) % TEMPLATE_PALETTE.length];
}

function resolveTemplateColor(value: string, template: DisplayTemplate): string {
  // Priority: colorMapping override > PILL_COLORS > auto-hash
  if (template.colorMapping[value]) return template.colorMapping[value];
  const pill = PILL_COLORS[value];
  if (pill) return pill.text;
  return hashColor(value);
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Render a single value using a template's display mode */
function TemplateValue({ value, template }: { value: string; template: DisplayTemplate }) {
  const color = resolveTemplateColor(value, template);
  switch (template.displayMode) {
    case "pill":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: hexToRgba(color, 0.15), color, border: `1px solid ${hexToRgba(color, 0.3)}` }}>
          {value}
        </span>
      );
    case "chip":
      return (
        <span className="px-1.5 py-0.5 rounded text-xs"
          style={{ backgroundColor: "var(--color-surface)", border: `1px solid ${hexToRgba(color, 0.4)}`, color: "var(--color-text-muted)" }}>
          {value}
        </span>
      );
    case "tag":
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px]"
          style={{ backgroundColor: hexToRgba(color, 0.1), color, border: `1px solid ${hexToRgba(color, 0.2)}` }}>
          {value}
        </span>
      );
    case "text":
    default:
      return <span style={{ color: template.fontColor || undefined }}>{value}</span>;
  }
}

interface SortableFeatureHeaderProps {
  col: typeof MODULE_FEATURE_COLS[number];
  colWidths: Record<string, number>;
  onResizeStart: (e: React.MouseEvent, tabKey: string, colKey: string, currentWidth: number) => void;
  featureColColor: string;
  featureColBold: boolean;
  featureColUnderline: boolean;
}
const SortableFeatureHeader = ({ col, colWidths, onResizeStart, featureColColor, featureColBold, featureColUnderline }: SortableFeatureHeaderProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  const style: React.CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    color: featureColColor,
    backgroundColor: "var(--color-surface)",
    position: "relative",
    overflow: "hidden",
    width: colWidths[`module_features:${col.key}`] ?? undefined,
    fontWeight: featureColBold ? 1000 : 400,
    textDecoration: featureColUnderline ? "underline" : undefined,
    textDecorationThickness: featureColUnderline ? "2px" : undefined,
    textUnderlineOffset: featureColUnderline ? "3px" : undefined,
    cursor: "grab",
  };
  return (
    <th ref={setNodeRef} style={style} className="py-1.5 px-3 text-left group/th" {...attributes} {...listeners}>
      {col.label}
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:!opacity-100 transition-opacity"
        style={{ backgroundColor: featureColColor }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const th = e.currentTarget.parentElement as HTMLElement | null;
          onResizeStart(e, "module_features", col.key, th?.offsetWidth || 100);
        }}
        onClick={(e) => e.stopPropagation()}
      />
    </th>
  );
};

interface SortableColItemProps {
  col: ColDef;
  subTab: string;
  isColVisible: (tabKey: string, colKey: string) => boolean;
  toggleColVisibility: (tabKey: string, colKey: string) => void;
  accentColor: string;
  highlight?: boolean;
  onDelete?: (colKey: string) => void;
}
const SortableColItem = ({ col, subTab, isColVisible, toggleColVisibility, accentColor, highlight, onDelete }: SortableColItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  const style = { transform: DndCSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, ...(highlight ? { background: "rgba(78,203,113,0.08)", borderLeft: "2px solid #4ecb71" } : {}) };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1 px-2 py-0.5 hover:bg-black/5 text-xs group/colitem" {...attributes}>
      <span {...listeners} className="cursor-grab text-[12px] select-none shrink-0 pr-0.5" style={{ color: "var(--color-text-muted)", lineHeight: 1 }} title="Drag to reorder">⠿</span>
      <input type="checkbox" checked={isColVisible(subTab, col.key)} onChange={() => toggleColVisibility(subTab, col.key)} className="w-3 h-3 flex-shrink-0" style={{ accentColor }} />
      <span className="flex-1 cursor-pointer" onClick={() => toggleColVisibility(subTab, col.key)} style={highlight ? { color: "#4ecb71" } : col.badge ? { color: col.badge === "calc" ? "#5bc0de" : "#9999b3" } : { color: "var(--color-text)" }}>
        {col.label}
        {col.badge && <sup className="ml-0.5" style={{ fontSize: "7px" }}>{col.badge}</sup>}
      </span>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(col.key); }}
          className="shrink-0 opacity-0 group-hover/colitem:opacity-100 transition-opacity w-3.5 h-3.5 flex items-center justify-center rounded text-[9px]"
          style={{ color: "#e05555" }}
          title={col.key.startsWith("uc_") ? `Delete column "${col.label}"` : `Hide column "${col.label}"`}
        >✕</button>
      )}
    </div>
  );
};

const SEP_PRESET_COLORS = [
  { label: "Blue", value: "#428bca" },
  { label: "Red", value: "#e05555" },
  { label: "Green", value: "#4ecb71" },
  { label: "Orange", value: "#e8943a" },
  { label: "Purple", value: "#9b59b6" },
  { label: "Cyan", value: "#5bc0de" },
  { label: "Pink", value: "#e84393" },
  { label: "Invisible", value: "transparent" },
];

interface SortableSeparatorItemProps {
  sep: ColumnSeparator;
  tabKey: string;
  onUpdate: (sepId: string, patch: Partial<ColumnSeparator>) => void;
  onRemove: (tabKey: string, sepId: string) => void;
  colorPickerOpen: string | null;
  setColorPickerOpen: React.Dispatch<React.SetStateAction<string | null>>;
}
const SortableSeparatorItem = ({ sep, tabKey, onUpdate, onRemove, colorPickerOpen, setColorPickerOpen }: SortableSeparatorItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sep.id });
  const style = { transform: DndCSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const isPickerOpen = colorPickerOpen === sep.id;
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1 px-2 py-0.5 hover:bg-black/5 text-xs" {...attributes}>
      <span {...listeners} className="cursor-grab text-[12px] select-none shrink-0 pr-0.5" style={{ color: "var(--color-text-muted)", lineHeight: 1 }} title="Drag to reorder">⠿</span>
      {/* Color swatch — click to open color picker */}
      <div className="relative">
        <button
          onClick={() => setColorPickerOpen(isPickerOpen ? null : sep.id)}
          className="w-3.5 h-3.5 rounded border flex-shrink-0 transition-transform hover:scale-110"
          style={{
            backgroundColor: sep.color === "transparent" ? "var(--color-surface)" : sep.color,
            borderColor: sep.color === "transparent" ? "var(--color-text-muted)" : sep.color,
            backgroundImage: sep.color === "transparent" ? "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%)" : undefined,
            backgroundSize: sep.color === "transparent" ? "6px 6px" : undefined,
          }}
          title="Set separator color"
        />
        {isPickerOpen && (
          <div className="absolute z-50 left-0 top-5 rounded-md border shadow-lg p-2 space-y-2" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", width: 150 }} onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-4 gap-1">
              {SEP_PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => { onUpdate(sep.id, { color: c.value }); setColorPickerOpen(null); }}
                  className="w-6 h-6 rounded border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c.value === "transparent" ? "var(--color-surface)" : c.value,
                    borderColor: sep.color === c.value ? "var(--color-text)" : "transparent",
                    backgroundImage: c.value === "transparent" ? "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%)" : undefined,
                    backgroundSize: c.value === "transparent" ? "6px 6px" : undefined,
                  }}
                  title={c.label}
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] shrink-0" style={{ color: "var(--color-text-muted)" }}>Custom:</span>
              <input type="color" value={sep.color === "transparent" ? "#428bca" : sep.color} onChange={(e) => onUpdate(sep.id, { color: e.target.value })} className="w-5 h-5 rounded cursor-pointer border-0 p-0" style={{ backgroundColor: "transparent" }} />
            </div>
          </div>
        )}
      </div>
      <span className="flex-1 truncate" style={{ color: "var(--color-text-muted)" }}>
        ── separator ──
      </span>
      {/* Thickness stepper */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={() => onUpdate(sep.id, { thickness: Math.max(1, sep.thickness - 1) })} className="w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-black/10 text-[10px] leading-none" style={{ color: "var(--color-text-muted)" }}>−</button>
        <span className="text-[9px] w-4 text-center" style={{ color: "var(--color-text)" }}>{sep.thickness}</span>
        <button onClick={() => onUpdate(sep.id, { thickness: Math.min(10, sep.thickness + 1) })} className="w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-black/10 text-[10px] leading-none" style={{ color: "var(--color-text-muted)" }}>+</button>
      </div>
      {/* Delete */}
      <button onClick={() => onRemove(tabKey, sep.id)} className="shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-black/10 text-[10px]" style={{ color: "#e05555" }} title="Remove separator">✕</button>
    </div>
  );
};

interface SortableFeatColItemProps {
  col: typeof MODULE_FEATURE_COLS[number];
  hiddenModuleFeatureCols: Set<string>;
  setHiddenModuleFeatureCols: React.Dispatch<React.SetStateAction<Set<string>>>;
  accentColor: string;
}
const SortableFeatColItem = ({ col, hiddenModuleFeatureCols, setHiddenModuleFeatureCols, accentColor }: SortableFeatColItemProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  const style = { transform: DndCSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const toggle = () => setHiddenModuleFeatureCols((prev) => { const n = new Set(prev); n.has(col.key) ? n.delete(col.key) : n.add(col.key); localStorage.setItem("splan_hidden_module_feature_cols", JSON.stringify([...n])); return n; });
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-1 px-2 py-0.5 hover:bg-black/5 text-xs" {...attributes}>
      <span {...listeners} className="cursor-grab text-[12px] select-none shrink-0 pr-0.5" style={{ color: "var(--color-text-muted)", lineHeight: 1 }} title="Drag to reorder">⠿</span>
      <input type="checkbox" checked={!hiddenModuleFeatureCols.has(col.key)} onChange={toggle} className="w-3 h-3 flex-shrink-0" style={{ accentColor }} />
      <span className="flex-1 cursor-pointer" style={{ color: "var(--color-text)" }} onClick={toggle}>{col.label}</span>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

/** Simple fetch wrapper (no auth retry needed for local app) */
async function fetchWithRetry(url: string, _retries = 3, _delay = 500): Promise<Response> {
  return fetch(url);
}

/** Map tab keys to entity_type values used in _splan_column_defs */
const TAB_ENTITY_MAP: Record<string, string> = {
  modules: "modules", features: "features", concepts: "concepts",
  data_tables: "data_tables", data_fields: "data_fields",
  projects: "projects", research: "research", prototypes: "prototypes",
  feedback: "feedback",
};

/** Merge user-defined column defs into TABLE_CONFIGS (mutates in place, idempotent) */
function mergeColumnDefs(defs: ColumnDef[]) {
  // First, strip any previously-merged user columns (keys starting with "uc_")
  for (const cfg of Object.values(TABLE_CONFIGS)) {
    cfg.columns = cfg.columns.filter((c) => !c.key.startsWith("uc_"));
  }
  // Append user columns before the readonly timestamps
  for (const def of defs) {
    const tabKey = Object.entries(TAB_ENTITY_MAP).find(([, v]) => v === def.entityType)?.[0];
    if (!tabKey || !TABLE_CONFIGS[tabKey]) continue;
    const col: ColDef = {
      key: def.columnKey,
      label: def.label,
      type: def.columnType as ColDef["type"],
      ...(def.options && def.options.length > 0 ? { options: def.options } : {}),
      ...(def.columnType === "formula" ? { formula: def.formula, badge: "calc" as const } : {}),
    };
    // Insert before createdAt/updatedAt if they exist, otherwise append
    const cols = TABLE_CONFIGS[tabKey].columns;
    const createdIdx = cols.findIndex((c) => c.key === "createdAt");
    if (createdIdx >= 0) {
      cols.splice(createdIdx, 0, col);
    } else {
      cols.push(col);
    }
  }
}

export default function SchemaPlannerTab({ onPickerModeChange, onDataChanged, subTab: subTabProp, onSubTabChange, depthColors }: { onPickerModeChange?: (active: boolean) => void; onDataChanged?: () => void; subTab?: string; onSubTabChange?: (tab: string) => void; depthColors?: string[] }) {
  return <SchemaPlannerTabInner onPickerModeChange={onPickerModeChange} onDataChanged={onDataChanged} subTabProp={subTabProp} onSubTabChange={onSubTabChange} depthColors={depthColors} />;
}

function SchemaPlannerTabInner({ onPickerModeChange, onDataChanged, subTabProp, onSubTabChange, depthColors }: { onPickerModeChange?: (active: boolean) => void; onDataChanged?: () => void; subTabProp?: string; onSubTabChange?: (tab: string) => void; depthColors?: string[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Use prop if provided (lifted state from parent), otherwise fall back to URL
  const resolvedTab = subTabProp || searchParams.get("sptab") || "modules";
  const ALL_VALID_TABS = [...SUB_TABS, "prototypes"];
  const subTab = ALL_VALID_TABS.includes(resolvedTab) ? resolvedTab : "modules";

  // Ref that tracks whether the active tab has pending module data changes — allows
  // setSubTab (defined early) to check for unsaved changes without a stale closure.
  const activeTabHasPendingRef = useRef(false);

  const setSubTab = useCallback((tab: string) => {
    // Warn if switching away from a tab with unsaved module data changes
    if (activeTabHasPendingRef.current && !window.confirm("You have unsaved changes. Switch tabs anyway? Unsaved data changes will be lost.")) {
      return; // don't switch
    }
    onSubTabChange?.(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("sptab", tab);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, onSubTabChange]);

  // ─── User-defined column definitions ───
  const [columnDefs, setColumnDefs] = useState<ColumnDef[]>([]);
  const columnDefsLoadedRef = useRef(false);
  const reloadColumnDefs = useCallback(async () => {
    try {
      const defs = await fetchColumnDefs();
      setColumnDefs(defs);
      mergeColumnDefs(defs);
    } catch { /* ignore on first load */ }
    columnDefsLoadedRef.current = true;
  }, []);
  useEffect(() => { reloadColumnDefs(); }, [reloadColumnDefs]);

  // ─── Display Templates & Assignments ───
  const [displayTemplates, setDisplayTemplates] = useState<DisplayTemplate[]>([]);
  const [templateAssignments, setTemplateAssignments] = useState<ColumnTemplateAssignment[]>([]);

  const reloadDisplayTemplates = useCallback(async () => {
    try {
      const [tpls, assigns] = await Promise.all([fetchDisplayTemplates(), fetchColumnTemplateAssignments()]);
      setDisplayTemplates(tpls);
      setTemplateAssignments(assigns);
    } catch { /* ignore on first load */ }
  }, []);

  // Seed templates on first load if none exist, then load them
  useEffect(() => {
    (async () => {
      try {
        const tpls = await fetchDisplayTemplates();
        if (tpls.length === 0) {
          // Build column mappings from TABLE_CONFIGS for seeding
          const columns: Array<{ entityType: string; columnKey: string; columnType: string }> = [];
          for (const [tabKey, cfg] of Object.entries(TABLE_CONFIGS)) {
            const entityType = TAB_ENTITY_MAP[tabKey] || tabKey;
            for (const col of cfg.columns) {
              if (col.type === "separator" || col.hideInGrid) continue;
              columns.push({ entityType, columnKey: col.key, columnType: col.type });
            }
          }
          await seedDisplayTemplates(columns);
          await reloadDisplayTemplates();
        } else {
          const assigns = await fetchColumnTemplateAssignments();
          setDisplayTemplates(tpls);
          setTemplateAssignments(assigns);
        }
      } catch { /* ignore */ }
    })();
  }, [reloadDisplayTemplates]);

  // ─── Persistent undo history for template actions ───
  interface TemplateUndoEntry {
    id: string;
    timestamp: string;
    description: string;
    undoPayload: { type: "assign"; entityType: string; columnKey: string; templateId: number }
      | { type: "detach"; entityType: string; columnKey: string };
  }
  const [templateUndoHistory, setTemplateUndoHistory] = usePersistedPreference<TemplateUndoEntry[]>("splan_template_undo_history", []);
  const [undoHistoryOpen, setUndoHistoryOpen] = useState(false);

  const pushTemplateUndo = useCallback((description: string, undoPayload: TemplateUndoEntry["undoPayload"]) => {
    setTemplateUndoHistory((prev) => {
      const entry: TemplateUndoEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: new Date().toLocaleTimeString(), description, undoPayload };
      const next = [entry, ...prev];
      return next.slice(0, 50); // cap at 50
    });
  }, [setTemplateUndoHistory]);

  const executeUndo = useCallback(async (entry: TemplateUndoEntry) => {
    try {
      if (entry.undoPayload.type === "assign") {
        await assignColumnTemplate(entry.undoPayload.entityType, entry.undoPayload.columnKey, entry.undoPayload.templateId);
      } else {
        await removeColumnTemplateAssignment(entry.undoPayload.entityType, entry.undoPayload.columnKey);
      }
      await reloadDisplayTemplates();
      setTemplateUndoHistory((prev) => prev.filter((e) => e.id !== entry.id));
    } catch {
      window.alert("Undo failed — the template may have been deleted.");
      setTemplateUndoHistory((prev) => prev.filter((e) => e.id !== entry.id));
    }
  }, [reloadDisplayTemplates, setTemplateUndoHistory]);

  // Lookup: get template for a given entity+column
  const getColumnTemplate = useCallback((entityType: string, columnKey: string): DisplayTemplate | null => {
    const assignment = templateAssignments.find((a) => a.entityType === entityType && a.columnKey === columnKey);
    if (!assignment) return null;
    return displayTemplates.find((t) => t.id === assignment.templateId) || null;
  }, [displayTemplates, templateAssignments]);

  const [data, setData] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());
  const loadedTabsRef = useRef<Set<string>>(new Set());
  const [tabLoading, setTabLoading] = useState<string | null>(null);
  const dirtyTabs = new Set<string>(); // No-op — always live, no dirty tracking
  const [saving, setSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Multi-sort: primary + secondary (persisted to localStorage)
  const [sortConfig, setSortConfig] = usePersistedPreference<{ primary: SortEntry | null; secondary: SortEntry | null }>("splan_sort_config", { primary: null, secondary: null });
  const [featureSortConfig, setFeatureSortConfig] = usePersistedPreference<{ primary: SortEntry | null; secondary: SortEntry | null }>("splan_feature_sort_config", { primary: null, secondary: null });
  // Rule-based filters
  const [moduleFilterRules, setModuleFilterRules] = useState<FilterRule[]>([]);
  const [featureFilterRules, setFeatureFilterRules] = useState<FilterRule[]>([]);
  const [moduleFilterSectionOpen, setModuleFilterSectionOpen] = useState(false);
  const [featureFilterSectionOpen, setFeatureFilterSectionOpen] = useState(false);
  const [featureSortSectionOpen, setFeatureSortSectionOpen] = useState(false);
  // Convenience aliases for backwards compat with existing code
  const sortCol = sortConfig.primary?.col ?? null;
  const sortDir = sortConfig.primary?.dir ?? "asc";
  const [statusFilter, setStatusFilter] = useState<"all" | "live" | "planned">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  // Pagination — per-tab page size persisted to Supabase
  const [pageSizes, setPageSizes] = usePersistedPreference<Record<string, number>>("splan_page_sizes", {});
  const [pageSize, setPageSize] = useState(pageSizes[subTab] ?? 25);
  const [currentPage, setCurrentPage] = useState(1);

  // Sync page size when tab changes
  useEffect(() => {
    setPageSize(pageSizes[subTab] ?? 25);
    setCurrentPage(1);
  }, [subTab, pageSizes]);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    setPageSizes((prev) => ({ ...prev, [subTab]: size }));
  }, [subTab, setPageSizes]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRecord, setModalRecord] = useState<Record<string, unknown> | null>(null);
  const [modalIsNew, setModalIsNew] = useState(false);
  const [modalReason, setModalReason] = useState("");

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const [deleteTargetTab, setDeleteTargetTab] = useState<string | null>(null); // which tab the delete target belongs to (null = current subTab)
  const [deleteReason, setDeleteReason] = useState("");

  // Access Matrix state
  const [matrixData, setMatrixData] = useState<{ tables: Array<{ tableId: number; tableName: string; recordOwnership: string | null; tableStatus: string; rules: Array<Record<string, unknown>> }>; dimensions: { businessTypes: string[]; roles: string[]; userTypes: string[]; tiers: number[]; swimlanes: string[] } } | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixBizFilter, setMatrixBizFilter] = useState<string>("all");
  const [matrixTierFilter, setMatrixTierFilter] = useState<string>("all");
  const [matrixSwimFilter, setMatrixSwimFilter] = useState<string>("all");

  // Fullscreen note overlay (generalized: any tab, any notes column)
  const [fullscreenNote, setFullscreenNote] = useState<{ row: Record<string, unknown>; tabKey: string; noteKey: string } | null>(null);
  useEffect(() => {
    if (!fullscreenNote) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreenNote(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreenNote]);

  // Shared notes cache: cacheKey = `${entityType}:${entityId}:${noteKey}` → EntityNote.
  // Populated by tab-load fetch + on-save updates. Cell badges and editor reads use this.
  const [entityNotesCache, setEntityNotesCache] = useState<Record<string, EntityNote>>({});
  const noteCacheKey = useCallback((entityType: string, entityId: number, noteKey: string) => `${entityType}:${entityId}:${noteKey}`, []);
  // Load all notes for the active tab's entity type whenever tab data refreshes
  useEffect(() => {
    const cfg = TABLE_CONFIGS[subTab];
    if (!cfg) return;
    let cancelled = false;
    (async () => {
      try {
        const entityType = cfg.entityType;
        const notes = await fetchEntityNotesByType(entityType);
        if (cancelled) return;
        setEntityNotesCache((prev) => {
          const next = { ...prev };
          for (const note of notes) {
            next[noteCacheKey(entityType, note.entityId, note.noteKey)] = note;
          }
          return next;
        });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  // Re-fetch when tab changes or when row count changes (new rows may have been added)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, (data[subTab] || []).length]);

  // Image carousel modal
  const [carouselState, setCarouselState] = useState<{ row: Record<string, unknown>; tabKey: string } | null>(null);

  // Entity tests popup (features, concepts, modules)
  const [testPopupState, setTestPopupState] = useState<{ row: Record<string, unknown>; entityType: "feature" | "concept" | "module"; tabKey: string; idKey: string; nameKey: string } | null>(null);
  const [entityTestCounts, setEntityTestCounts] = useState<Record<string, Record<number, { count: number; latestUpdatedAt: string | null }>>>({});
  // Load test counts for features, concepts, and modules
  useEffect(() => {
    const tables = [
      { tab: "features", apiTable: "_splan_feature_tests", fkKey: "featureId" },
      { tab: "concepts", apiTable: "_splan_concept_tests", fkKey: "conceptId" },
      { tab: "modules", apiTable: "_splan_module_tests", fkKey: "moduleId" },
    ];
    const relevantTable = tables.find((t) => t.tab === subTab);
    if (!relevantTable) return;
    (async () => {
      try {
        const res = await fetch(`/api/schema-planner?table=${relevantTable.apiTable}`);
        if (!res.ok) return;
        const rows = await res.json();
        const arr = Array.isArray(rows) ? rows : rows.rows || [];
        const counts: Record<number, { count: number; latestUpdatedAt: string | null }> = {};
        for (const t of arr) {
          const eid = t[relevantTable.fkKey] as number;
          if (!counts[eid]) counts[eid] = { count: 0, latestUpdatedAt: null };
          counts[eid].count++;
          if (!counts[eid].latestUpdatedAt || t.updatedAt > counts[eid].latestUpdatedAt!) {
            counts[eid].latestUpdatedAt = t.updatedAt;
          }
        }
        setEntityTestCounts((prev) => ({ ...prev, [subTab]: counts }));
      } catch { /* ignore */ }
    })();
  }, [subTab, data.features, data.concepts, data.modules]);

  // Features: inline edit, expand, module filter
  const [expandedFeatureId, setExpandedFeatureId] = useState<number | null>(null);
  // Modules tab: expand a module to see its features (one at a time)
  const [expandedModuleId, setExpandedModuleId] = useState<number | null>(null);
  const [expandedModuleFeatureId, setExpandedModuleFeatureId] = useState<number | null>(null);
  const [moduleQuickAddId, setModuleQuickAddId] = useState<number | null>(null); // which module has the quick-add input open
  const [moduleQuickAddName, setModuleQuickAddName] = useState("");
  const moduleQuickAddRect = useRef<DOMRect | null>(null); // position anchor for combo box
  const [comboSort, setComboSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "featureName", dir: "asc" });
  const [editingModuleFeatureCell, setEditingModuleFeatureCell] = useState<{ fid: number; key: string } | null>(null);
  const toggleModuleExpand = useCallback((moduleId: number) => {
    setExpandedModuleId((prev) => {
      if (prev === moduleId) { setExpandedModuleFeatureId(null); setModuleQuickAddId(null); return null; } // collapse
      setExpandedModuleFeatureId(null); // collapse any feature when switching modules
      setModuleQuickAddId(null);
      return moduleId;
    });
  }, []);
  const [editingCell, setEditingCell] = useState<{ rowId: number; colKey: string } | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [hoveredMainColKey, setHoveredMainColKey] = useState<string | null>(null);

  // Table picker modal for "Create new field" — reuses Data Tables grid in picker mode
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [tablePickerCallback, setTablePickerCallback] = useState<{ resolve: (id: number | null) => void } | null>(null);
  const savedSubTabRef = useRef<string | null>(null);

  // FK pick mode — select a table or field as a foreign key reference
  const [fkPickMode, setFkPickMode] = useState<{ sourceFieldId: number; sourceTableId: number; fieldName: string; isNewField?: boolean } | null>(null);
  const fkPickLabelRef = useRef<HTMLDivElement>(null);

  // ─── Pending preferences (formatting/view settings) ───
  const { hasPendingPrefs, flushPrefs } = usePreferencesPending();

  // ─── Always-Live Mode (local SQLite — instant saves, no batch/dirty pattern) ───
  const liveMode = true;
  const [liveStatus, setLiveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [liveFailedRows, setLiveFailedRows] = useState<Set<string>>(new Set()); // "tabKey:rowId"
  const liveDebounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const livePendingRows = useRef<Map<string, { tabKey: string; record: Record<string, unknown>; reasoning: string }>>(new Map());

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      liveDebounceTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Mouse-following label for FK pick mode
  useEffect(() => {
    if (!fkPickMode) return;
    const label = fkPickLabelRef.current;
    if (!label) return;
    const handler = (e: MouseEvent) => {
      label.style.left = `${e.clientX + 14}px`;
      label.style.top = `${e.clientY + 14}px`;
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFkPickMode(null);
    };
    document.addEventListener("mousemove", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousemove", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [fkPickMode]);

  // Cancel FK pick mode on tab switch
  useEffect(() => { setFkPickMode(null); }, [subTab]);

  // Notify parent of picker mode changes
  useEffect(() => { onPickerModeChange?.(tablePickerOpen); }, [tablePickerOpen, onPickerModeChange]);

  // Pending field creation state — lives at parent level to survive tab switches
  const [similarNamesOpen, setSimilarNamesOpen] = useState(true);
  // Inline new field state — lives at parent level, rendered as a new row in ExpandedFieldRows
  const [inlineNewField, setInlineNewField] = useState<{
    tableId: number; featureRow: Record<string, unknown>; noteKey: string;
    fieldName: string; dataType: string; isRequired: boolean; isUnique: boolean;
    isForeignKey: boolean; referencesTable: number | null; referencesField: number | null;
    exampleValues?: string;
  } | null>(null);

  // Data Tables: expandable rows with lazy-loaded fields
  const [expandedTableIds, setExpandedTableIds] = useState<Set<number>>(new Set());
  const [tableFieldsCache, setTableFieldsCache] = useState<Record<number, Record<string, unknown>[]>>({});
  const [tableFieldsLoading, setTableFieldsLoading] = useState<Set<number>>(new Set());
  const [dataTableSearchMode, setDataTableSearchMode] = useState<"tables" | "fields" | "examples">("tables");

  // Column visibility per tab — persisted to Supabase
  const [hiddenColsArr, setHiddenColsArr] = usePersistedPreference<string[]>("splan_hidden_cols", []);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set(hiddenColsArr));
  const [colDropdownOpen, setColDropdownOpen] = useState(false);
  const colDropdownRef = useRef<HTMLDivElement>(null);

  // Sync from persisted on load
  useEffect(() => { setHiddenCols(new Set(hiddenColsArr)); }, [hiddenColsArr]);

  const isColVisible = useCallback((tabKey: string, colKey: string) => {
    return !hiddenCols.has(`${tabKey}:${colKey}`);
  }, [hiddenCols]);

  const toggleColVisibility = useCallback((tabKey: string, colKey: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      const key = `${tabKey}:${colKey}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setHiddenColsArr([...next]);
      return next;
    });
  }, [setHiddenColsArr]);

  // Column order per tab — persisted to Supabase
  const [colOrder, setColOrder] = usePersistedPreference<Record<string, string[]>>("splan_col_order", {});

  const moveCol = useCallback((tabKey: string, colKey: string, direction: "up" | "down") => {
    setColOrder((prev) => {
      const cfg = TABLE_CONFIGS[tabKey];
      if (!cfg) return prev;
      const defaultOrder = cfg.columns.filter((c) => !c.hideInGrid).map((c) => c.key);
      const current = prev[tabKey] || defaultOrder;
      const idx = current.indexOf(colKey);
      if (idx < 0) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= current.length) return prev;
      const next = [...current];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      const updated = { ...prev, [tabKey]: next };
      return updated;
    });
  }, []);

  // Column widths per tab — persisted to Supabase (local state during drag, persist on mouseup)
  const [savedColWidths, setSavedColWidths] = usePersistedPreference<Record<string, number>>("splan_col_widths", {});
  const [colWidths, setColWidths] = useState<Record<string, number>>(savedColWidths);
  const resizingRef = useRef<{ tabKey: string; colKey: string; startX: number; startWidth: number } | null>(null);

  // Sync from persisted on load
  useEffect(() => { setColWidths(savedColWidths); }, [savedColWidths]);

  const onResizeStart = useCallback((e: React.MouseEvent, tabKey: string, colKey: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { tabKey, colKey, startX: e.clientX, startWidth: currentWidth };

    const onMouseMove = (me: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = me.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startWidth + delta);
      const key = `${resizingRef.current.tabKey}:${resizingRef.current.colKey}`;
      setColWidths((prev) => ({ ...prev, [key]: newWidth }));
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Persist to Supabase
      setColWidths((prev) => { setSavedColWidths(prev); return prev; });
      resizingRef.current = null;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // Column display config — persisted to Supabase
  const defaultColDisplay: Record<string, ColDisplayConfig> = {
    "modules:moduleDescription": { lines: 2, wrap: true },
    "modules:moduleName": { fontSize: 16, wrap: true, lines: 2 },
    "features:description": { lines: 2, wrap: true },
    "data_tables:descriptionPurpose": { lines: 2, wrap: true },
  };
  const [colDisplayConfig, setColDisplayConfig] = usePersistedPreference<Record<string, ColDisplayConfig>>("splan_col_display", defaultColDisplay);
  const [colDisplayPopover, setColDisplayPopover] = useState<{ colKey: string; rect: DOMRect } | null>(null);

  // Column separators — persisted to localStorage
  const [colSeparators, setColSeparators] = usePersistedPreference<Record<string, ColumnSeparator>>("splan_col_separators", {});
  const [sepColorPickerOpen, setSepColorPickerOpen] = useState<string | null>(null);

  const addSeparator = useCallback((tabKey: string) => {
    const id = `sep_${Date.now()}`;
    const sep: ColumnSeparator = { id, color: "#428bca", thickness: 2 };
    setColSeparators((prev) => ({ ...prev, [id]: sep }));
    // Append to column order
    setColOrder((prev) => {
      const cfg = TABLE_CONFIGS[tabKey];
      if (!cfg) return prev;
      const defaultOrder = cfg.columns.filter((c) => !c.hideInGrid).map((c) => c.key);
      const current = prev[tabKey] || defaultOrder;
      return { ...prev, [tabKey]: [...current, id] };
    });
  }, [setColSeparators, setColOrder]);

  const removeSeparator = useCallback((tabKey: string, sepId: string) => {
    setColSeparators((prev) => { const next = { ...prev }; delete next[sepId]; return next; });
    setColOrder((prev) => {
      const current = prev[tabKey];
      if (!current) return prev;
      return { ...prev, [tabKey]: current.filter((k) => k !== sepId) };
    });
  }, [setColSeparators, setColOrder]);

  const updateSeparator = useCallback((sepId: string, patch: Partial<ColumnSeparator>) => {
    setColSeparators((prev) => {
      const existing = prev[sepId];
      if (!existing) return prev;
      return { ...prev, [sepId]: { ...existing, ...patch } };
    });
  }, [setColSeparators]);

  // Add Column form state
  const [addColOpen, setAddColOpen] = useState(false);
  const [addColName, setAddColName] = useState("");
  const [addColType, setAddColType] = useState<string>("text");
  const [addColOptions, setAddColOptions] = useState<string[]>([]);
  const [addColOptionInput, setAddColOptionInput] = useState("");
  const [addColFormula, setAddColFormula] = useState("");
  const addColFormulaRef = useRef<HTMLTextAreaElement>(null);
  const [formulaFuncOpen, setFormulaFuncOpen] = useState(false);
  const [addColSaving, setAddColSaving] = useState(false);
  const [addColError, setAddColError] = useState<string | null>(null);
  const [addColHighlight, setAddColHighlight] = useState<string | null>(null);

  const resetAddColForm = useCallback(() => {
    setAddColOpen(false);
    setAddColName("");
    setAddColType("text");
    setAddColOptions([]);
    setAddColOptionInput("");
    setAddColFormula("");
    setAddColError(null);
    setFormulaFuncOpen(false);
  }, []);

  const handleAddColumn = useCallback(async () => {
    if (!addColName.trim()) { setAddColError("Name is required"); return; }
    if (addColType === "formula" && !addColFormula.trim()) { setAddColError("Formula expression is required"); return; }
    const entityType = TAB_ENTITY_MAP[subTab];
    if (!entityType) { setAddColError("Cannot add columns to this tab"); return; }
    // Generate snake_case column key with uc_ prefix
    const columnKey = "uc_" + addColName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!columnKey || columnKey === "uc_") { setAddColError("Invalid column name"); return; }
    // Check for duplicate
    const cfg = TABLE_CONFIGS[subTab];
    if (cfg?.columns.some((c) => c.key === columnKey)) { setAddColError("Column already exists"); return; }

    setAddColSaving(true);
    setAddColError(null);
    try {
      await createColumnDef({
        entityType,
        columnKey,
        label: addColName.trim(),
        columnType: addColType,
        options: addColType === "enum" ? addColOptions : undefined,
        formula: addColType === "formula" ? addColFormula.trim() : undefined,
      });
      await reloadColumnDefs();
      // Force re-fetch current tab data so new column values appear
      try {
        const tabCfg = TABLE_CONFIGS[subTab];
        if (tabCfg) {
          const r = await fetchWithRetry(`/api/schema-planner?table=${tabCfg.apiTable}`);
          if (r.ok) {
            const json = await r.json();
            setData((prev) => ({ ...prev, [subTab]: Array.isArray(json) ? json : (json.rows || []) }));
          }
        }
      } catch { /* ignore */ }
      setAddColHighlight(columnKey);
      setTimeout(() => setAddColHighlight(null), 2000);
      resetAddColForm();
    } catch (err) {
      setAddColError(err instanceof Error ? err.message : "Failed to create column");
    } finally {
      setAddColSaving(false);
    }
  }, [addColName, addColType, addColOptions, addColFormula, subTab, reloadColumnDefs, resetAddColForm]);

  // Permanently hidden (deleted) built-in columns — persisted to localStorage
  const [permHiddenCols, setPermHiddenCols] = usePersistedPreference<string[]>("splan_perm_hidden_cols", []);
  const permHiddenSet = useMemo(() => new Set(permHiddenCols), [permHiddenCols]);

  const handleDeleteColumn = useCallback(async (colKey: string) => {
    const tabCfg = TABLE_CONFIGS[subTab];
    if (!tabCfg) return;
    const isUserCol = colKey.startsWith("uc_");
    const colLabel = tabCfg.columns.find((c) => c.key === colKey)?.label || colKey;

    if (isUserCol) {
      if (!window.confirm(`Delete column "${colLabel}"?\n\nThis permanently removes the column and all its data from every row. This cannot be undone.`)) return;
      const def = columnDefs.find((d) => d.columnKey === colKey && d.entityType === TAB_ENTITY_MAP[subTab]);
      if (!def) return;
      try {
        await deleteColumnDef(def.id);
        await reloadColumnDefs();
        // Re-fetch tab data
        try {
          const r = await fetchWithRetry(`/api/schema-planner?table=${tabCfg.apiTable}`);
          if (r.ok) {
            const json = await r.json();
            setData((prev) => ({ ...prev, [subTab]: Array.isArray(json) ? json : (json.rows || []) }));
          }
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    } else {
      if (!window.confirm(`Hide column "${colLabel}"?\n\nThis removes it from the column list. You can restore it later via "+ Restore Hidden".`)) return;
      const key = `${subTab}:${colKey}`;
      setPermHiddenCols((prev) => prev.includes(key) ? prev : [...prev, key]);
    }
  }, [subTab, columnDefs, reloadColumnDefs, setPermHiddenCols]);

  const handleRestoreColumn = useCallback((tabKey: string, colKey: string) => {
    const key = `${tabKey}:${colKey}`;
    setPermHiddenCols((prev) => prev.filter((k) => k !== key));
  }, [setPermHiddenCols]);

  // Row height per table context — persisted
  const [rowHeights, setRowHeights] = usePersistedPreference<Record<string, number>>("splan_row_heights", {});
  const getRowHeight = useCallback((tabKey: string): number | undefined => rowHeights[tabKey], [rowHeights]);
  const setRowHeight = useCallback((tabKey: string, h: number | undefined) => {
    setRowHeights((prev) => {
      if (h === undefined) { const next = { ...prev }; delete next[tabKey]; return next; }
      return { ...prev, [tabKey]: h };
    });
  }, [setRowHeights]);

  const updateColDisplay = useCallback((tabKey: string, colKey: string, patch: Partial<ColDisplayConfig>) => {
    setColDisplayConfig((prev) => {
      const key = `${tabKey}:${colKey}`;
      return { ...prev, [key]: { ...prev[key], ...patch } };
    });
  }, [setColDisplayConfig]);

  const getColDisplay = useCallback((tabKey: string, colKey: string): ColDisplayConfig => {
    return colDisplayConfig[`${tabKey}:${colKey}`] || {};
  }, [colDisplayConfig]);

  // Expanded field sub-table columns — persisted to Supabase
  const [hiddenFieldColsArr, setHiddenFieldColsArr] = usePersistedPreference<string[]>("splan_hidden_field_cols", []);
  const [hiddenFieldCols, setHiddenFieldCols] = useState<Set<string>>(() => new Set(hiddenFieldColsArr));

  useEffect(() => { setHiddenFieldCols(new Set(hiddenFieldColsArr)); }, [hiddenFieldColsArr]);

  // Nested feature sub-table columns within expanded modules — persisted to Supabase
  const defaultHiddenModuleFeatureCols = MODULE_FEATURE_COLS.filter((c) => !c.defaultVisible).map((c) => c.key);
  const [hiddenModuleFeatureColsArr, setHiddenModuleFeatureColsArr] = usePersistedPreference<string[] | null>("splan_hidden_module_feature_cols", null);
  const [hiddenModuleFeatureCols, setHiddenModuleFeatureCols] = useState<Set<string>>(() =>
    new Set(hiddenModuleFeatureColsArr ?? defaultHiddenModuleFeatureCols)
  );

  useEffect(() => { setHiddenModuleFeatureCols(new Set(hiddenModuleFeatureColsArr ?? defaultHiddenModuleFeatureCols)); }, [hiddenModuleFeatureColsArr]);
  const [moduleColColor, setModuleColColor] = usePersistedPreference<string>("splan_module_col_color", "#428bca");
  const [featureColColor, setFeatureColColor] = usePersistedPreference<string>("splan_feature_col_color", "#5bc0de");
  const [moduleColBold, setModuleColBold] = usePersistedPreference<boolean>("splan_module_col_bold", true);
  const [moduleColUnderline, setModuleColUnderline] = usePersistedPreference<boolean>("splan_module_col_underline", true);
  const [featureColBold, setFeatureColBold] = usePersistedPreference<boolean>("splan_feature_col_bold", true);
  const [featureColUnderline, setFeatureColUnderline] = usePersistedPreference<boolean>("splan_feature_col_underline", true);
  const [refSummaryPopup, setRefSummaryPopup] = useState<{ type: "module" | "feature" | "table" | "concept" | "research"; record: Record<string, unknown>; highlightField?: string } | null>(null);
  const [imageViewer, setImageViewer] = useState<{ url: string; title: string; x: number; y: number; width: number; height: number; zoom: number; originX: number; originY: number } | null>(null);
  const imageDrag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const imageResize = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const imagePan = useRef<{ startX: number; startY: number; origScrollLeft: number; origScrollTop: number } | null>(null);
  const [fieldColDropdownOpen, setFieldColDropdownOpen] = useState(false);
  const fieldColDropdownRef = useRef<HTMLDivElement>(null);

  // ─── View presets (DB-backed — captures full View panel state) ───
  interface ViewPreset { presetId: number; tabKey: string; presetName: string; viewConfig: ViewPresetConfig; isActive: boolean; orderIndex: number }
  const [viewPresets, setViewPresets] = useState<ViewPreset[]>([]);
  const [viewPresetsLoaded, setViewPresetsLoaded] = useState(false);
  const [presetAppliedForTab, setPresetAppliedForTab] = useState<string | null>(null);
  const [collapsedGroupsArr, setCollapsedGroupsArr] = usePersistedPreference<string[]>("splan_collapsed_groups", []);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(collapsedGroupsArr));

  useEffect(() => { setCollapsedGroups(new Set(collapsedGroupsArr)); }, [collapsedGroupsArr]);
  const [groupPopoverOpen, setGroupPopoverOpen] = useState(false);
  const groupPopoverRef = useRef<HTMLDivElement>(null);
  const [sortSectionOpen, setSortSectionOpen] = useState(true);
  const [colsSectionOpen, setColsSectionOpen] = useState(true);
  const [moduleFeatureColOrder, setModuleFeatureColOrder] = useState<string[]>(() => {
    try { const s = localStorage.getItem("splan_module_feature_col_order"); return s ? JSON.parse(s) : MODULE_FEATURE_COLS.map((c) => c.key); } catch { return MODULE_FEATURE_COLS.map((c) => c.key); }
  });
  const orderedVisibleFeatCols = useMemo(() => {
    const result = moduleFeatureColOrder
      .map((k) => MODULE_FEATURE_COLS.find((c) => c.key === k))
      .filter((c): c is typeof MODULE_FEATURE_COLS[number] => c != null && !hiddenModuleFeatureCols.has(c.key));
    MODULE_FEATURE_COLS.forEach((c) => {
      if (!hiddenModuleFeatureCols.has(c.key) && !result.find((o) => o.key === c.key)) {
        result.push(c);
      }
    });
    return result;
  }, [moduleFeatureColOrder, hiddenModuleFeatureCols]);
  // Computed primary color hex for the color picker default
  const computedPrimaryColor = useMemo(() => {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim(); return v || "#428bca"; } catch { return "#428bca"; }
  }, []);
  // Local draft for the popover — edits are instant, no API calls until save
  const [draftGroupingConfig, setDraftGroupingConfig] = useState<GroupingConfig | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);

  // Active grouping = draft (when popover open) or saved preset config (normalized from legacy if needed)
  const activePreset = viewPresets.find((p) => p.tabKey === subTab && p.isActive) || null;
  const activeGrouping = draftGroupingConfig ?? (activePreset?.viewConfig?.groupingConfig ? normalizeGroupingConfig(activePreset.viewConfig.groupingConfig) : null);

  const reloadViewPresets = useCallback(async () => {
    try {
      const res = await fetchWithRetry("/api/schema-planner?table=_splan_view_presets");
      if (res.ok) {
        const json = await res.json();
        const rows = Array.isArray(json) ? json : (json.rows || []);
        setViewPresets(rows.map((r: Record<string, unknown>) => ({
          presetId: r.presetId as number,
          tabKey: r.tabKey as string,
          presetName: r.presetName as string,
          viewConfig: (r.viewConfig || {}) as ViewPresetConfig,
          isActive: r.isActive as boolean,
          orderIndex: r.orderIndex as number,
        })));
      }
    } catch { /* ignore */ }
    setViewPresetsLoaded(true);
  }, []);

  // Fetch all presets on mount
  useEffect(() => {
    reloadViewPresets();
  }, []);

  const tabPresets = viewPresets.filter((p) => p.tabKey === subTab).sort((a, b) => a.orderIndex - b.orderIndex);

  // ─── Snapshot current View state into a ViewPresetConfig ───
  const snapshotViewConfig = useCallback((): ViewPresetConfig => {
    const tabHidden = [...hiddenCols].filter((k) => k.startsWith(`${subTab}:`)).map((k) => k.replace(`${subTab}:`, ""));
    // Collect separators referenced by this tab's colOrder
    const order = colOrder[subTab];
    const tabSeps: Record<string, ColumnSeparator> = {};
    if (order) {
      for (const key of order) {
        if (key.startsWith("sep_") && colSeparators[key]) tabSeps[key] = colSeparators[key];
      }
    }
    // Collect colDisplayConfig entries for this tab
    const tabColDisplay: Record<string, ColDisplayConfig> = {};
    for (const [k, v] of Object.entries(colDisplayConfig)) {
      if (k.startsWith(`${subTab}:`)) tabColDisplay[k.replace(`${subTab}:`, "")] = v;
    }
    return {
      groupingConfig: draftGroupingConfig,
      sortConfig,
      colOrder: order || undefined,
      hiddenCols: tabHidden.length > 0 ? tabHidden : undefined,
      colSeparators: Object.keys(tabSeps).length > 0 ? tabSeps : undefined,
      colHeaderColor: moduleColColor,
      colHeaderBold: moduleColBold,
      colHeaderUnderline: moduleColUnderline,
      rowHeight: rowHeights[subTab] ?? null,
      filterRules: moduleFilterRules.length > 0 ? moduleFilterRules : undefined,
      colDisplayConfig: Object.keys(tabColDisplay).length > 0 ? tabColDisplay : undefined,
    };
  }, [subTab, hiddenCols, colOrder, colSeparators, colDisplayConfig, draftGroupingConfig, sortConfig, moduleColColor, moduleColBold, moduleColUnderline, rowHeights, moduleFilterRules]);

  // ─── Apply a ViewPresetConfig to all View state ───
  const applyViewPreset = useCallback((vc: ViewPresetConfig, tabKey: string) => {
    // Grouping (normalize legacy single-column format)
    setDraftGroupingConfig(vc.groupingConfig ? normalizeGroupingConfig(vc.groupingConfig) : null);
    setDraftDirty(false);
    // Sort
    if (vc.sortConfig !== undefined) setSortConfig(vc.sortConfig);
    // Column order
    if (vc.colOrder) setColOrder((prev) => ({ ...prev, [tabKey]: vc.colOrder! }));
    // Hidden cols — replace tab-specific hidden cols
    if (vc.hiddenCols !== undefined) {
      setHiddenCols((prev) => {
        const next = new Set([...prev].filter((k) => !k.startsWith(`${tabKey}:`)));
        for (const col of vc.hiddenCols!) next.add(`${tabKey}:${col}`);
        setHiddenColsArr([...next]);
        return next;
      });
    }
    // Separators — merge tab separators into global state, remove old ones for this tab
    if (vc.colSeparators !== undefined) {
      setColSeparators((prev) => {
        const next = { ...prev };
        // Remove old seps that were in this tab's colOrder
        const tabOrder = colOrder[tabKey] || [];
        for (const key of tabOrder) { if (key.startsWith("sep_")) delete next[key]; }
        // Add new ones from preset
        for (const [k, v] of Object.entries(vc.colSeparators!)) next[k] = v;
        return next;
      });
    }
    // Column header styling
    if (vc.colHeaderColor !== undefined) setModuleColColor(vc.colHeaderColor);
    if (vc.colHeaderBold !== undefined) setModuleColBold(vc.colHeaderBold);
    if (vc.colHeaderUnderline !== undefined) setModuleColUnderline(vc.colHeaderUnderline);
    // Row height
    if (vc.rowHeight !== undefined) {
      setRowHeights((prev) => {
        if (vc.rowHeight === null) { const next = { ...prev }; delete next[tabKey]; return next; }
        return { ...prev, [tabKey]: vc.rowHeight! };
      });
    }
    // Filters
    if (vc.filterRules !== undefined) setModuleFilterRules(vc.filterRules);
    // Column display config
    if (vc.colDisplayConfig !== undefined) {
      setColDisplayConfig((prev) => {
        const next = { ...prev };
        // Remove old entries for this tab
        for (const k of Object.keys(next)) { if (k.startsWith(`${tabKey}:`)) delete next[k]; }
        // Add new ones from preset
        for (const [k, v] of Object.entries(vc.colDisplayConfig!)) next[`${tabKey}:${k}`] = v;
        return next;
      });
    }
  }, [colOrder, setColOrder, setHiddenCols, setHiddenColsArr, setColSeparators, setModuleColColor, setModuleColBold, setModuleColUnderline, setRowHeights, setColDisplayConfig, setSortConfig, setModuleFilterRules]);

  // API helpers for presets (live save — not batch)
  const savePreset = useCallback(async (preset: { tabKey: string; viewConfig: ViewPresetConfig; presetName: string; orderIndex?: number }) => {
    try {
      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "_splan_view_presets", data: { tabKey: preset.tabKey, presetName: preset.presetName, viewConfig: preset.viewConfig, isActive: true, orderIndex: preset.orderIndex ?? tabPresets.length }, reasoning: "" }),
      });
      if (res.ok) {
        const created = await res.json();
        // Deactivate other presets for this tab locally
        setViewPresets((prev) => [
          ...prev.map((p) => p.tabKey === preset.tabKey ? { ...p, isActive: false } : p),
          { presetId: created.presetId, tabKey: preset.tabKey, presetName: preset.presetName, viewConfig: preset.viewConfig, isActive: true, orderIndex: preset.orderIndex ?? tabPresets.length },
        ]);
        // Also deactivate others in DB
        for (const p of viewPresets.filter((pp) => pp.tabKey === preset.tabKey && pp.isActive)) {
          fetch("/api/schema-planner", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ table: "_splan_view_presets", id: p.presetId, data: { isActive: false }, reasoning: "" }),
          });
        }
        return created;
      }
    } catch { /* ignore */ }
    return null;
  }, [viewPresets, tabPresets.length]);

  const updatePreset = useCallback(async (presetId: number, patch: Partial<ViewPreset>) => {
    try {
      await fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "_splan_view_presets", id: presetId, data: { ...patch, updatedAt: new Date().toISOString() }, reasoning: "" }),
      });
      setViewPresets((prev) => prev.map((p) => p.presetId === presetId ? { ...p, ...patch } : p));
    } catch { /* ignore */ }
  }, []);

  const activatePreset = useCallback(async (presetId: number | null) => {
    // Deactivate all for this tab, then activate the chosen one
    const tabPs = viewPresets.filter((p) => p.tabKey === subTab);
    for (const p of tabPs) {
      if (p.isActive && p.presetId !== presetId) {
        fetch("/api/schema-planner", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table: "_splan_view_presets", id: p.presetId, data: { isActive: false }, reasoning: "" }),
        });
      }
    }
    if (presetId) {
      fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "_splan_view_presets", id: presetId, data: { isActive: true }, reasoning: "" }),
      });
      // Apply the preset's view config
      const preset = viewPresets.find((p) => p.presetId === presetId);
      if (preset) applyViewPreset(preset.viewConfig, subTab);
    }
    setViewPresets((prev) => prev.map((p) => p.tabKey === subTab ? { ...p, isActive: p.presetId === presetId } : p));
  }, [viewPresets, subTab, applyViewPreset]);

  const deletePreset = useCallback(async (presetId: number) => {
    try {
      await fetch("/api/schema-planner", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "_splan_view_presets", id: presetId, reasoning: "" }),
      });
      setViewPresets((prev) => prev.filter((p) => p.presetId !== presetId));
    } catch { /* ignore */ }
  }, []);

  // ─── Auto-apply first preset (orderIndex 0) on tab load ───
  useEffect(() => {
    if (!viewPresetsLoaded || presetAppliedForTab === subTab) return;
    const firstPreset = viewPresets
      .filter((p) => p.tabKey === subTab)
      .sort((a, b) => a.orderIndex - b.orderIndex)[0];
    if (firstPreset) {
      applyViewPreset(firstPreset.viewConfig, subTab);
      // Mark it active in state (don't save to DB — it may already be active)
      setViewPresets((prev) => prev.map((p) => p.tabKey === subTab ? { ...p, isActive: p.presetId === firstPreset.presetId } : p));
    }
    setPresetAppliedForTab(subTab);
  }, [viewPresetsLoaded, subTab, presetAppliedForTab]);

  // ─── Auto-persist view changes to active preset (debounced) ───
  const viewAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewAutoSaveSkip = useRef(true); // Skip the first trigger (initial load / preset apply)
  useEffect(() => {
    // Don't auto-save until presets have loaded and initial apply has fired
    if (!viewPresetsLoaded || presetAppliedForTab !== subTab) return;
    // Skip the first render after preset apply to avoid saving the state we just loaded
    if (viewAutoSaveSkip.current) { viewAutoSaveSkip.current = false; return; }
    const ap = viewPresets.find((p) => p.tabKey === subTab && p.isActive);
    if (!ap) return;
    if (viewAutoSaveTimer.current) clearTimeout(viewAutoSaveTimer.current);
    viewAutoSaveTimer.current = setTimeout(() => {
      viewAutoSaveTimer.current = null;
      const vc = snapshotViewConfig();
      updatePreset(ap.presetId, { viewConfig: vc });
    }, 1500);
    return () => { if (viewAutoSaveTimer.current) clearTimeout(viewAutoSaveTimer.current); };
  }, [hiddenCols, colOrder, colSeparators, colDisplayConfig, sortConfig, moduleColColor, moduleColBold, moduleColUnderline, rowHeights, moduleFilterRules]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reset skip flag when tab changes so the next tab's initial apply doesn't trigger auto-save
  useEffect(() => { viewAutoSaveSkip.current = true; }, [subTab]);

  // Update local draft — instant, no API calls. Live mode debounces a save; non-live marks dirty for batch save.
  const groupingLiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setGroupingForTab = useCallback((_tab: string, config: GroupingConfig | null) => {
    setDraftGroupingConfig(config);
    setDraftDirty(true);

    // Live mode: debounce persist (1s) — saves full view config to active preset
    if (liveMode && config) {
      if (groupingLiveTimer.current) clearTimeout(groupingLiveTimer.current);
      groupingLiveTimer.current = setTimeout(async () => {
        groupingLiveTimer.current = null;
        const ap = viewPresets.find((p) => p.tabKey === subTab && p.isActive);
        if (ap) {
          await updatePreset(ap.presetId, { viewConfig: { ...ap.viewConfig, groupingConfig: config } });
        }
        setDraftDirty(false);
      }, 1000);
    }
  }, [liveMode, viewPresets, subTab, updatePreset]);

  // Persist draft to DB (called by batchSave)
  const persistGroupingDraft = useCallback(async () => {
    if (!draftDirty || !draftGroupingConfig) return;
    const ap = viewPresets.find((p) => p.tabKey === subTab && p.isActive);
    if (ap) {
      await updatePreset(ap.presetId, { viewConfig: { ...ap.viewConfig, groupingConfig: draftGroupingConfig } });
    }
    setDraftDirty(false);
  }, [draftDirty, draftGroupingConfig, viewPresets, subTab, updatePreset]);

  // Sync draft from preset when switching tabs or when a different preset is activated
  useEffect(() => {
    setDraftGroupingConfig(activePreset?.viewConfig?.groupingConfig ? normalizeGroupingConfig(activePreset.viewConfig.groupingConfig) : null);
    setDraftDirty(false);
  }, [subTab, activePreset?.presetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush live timer on unmount
  useEffect(() => {
    return () => { if (groupingLiveTimer.current) clearTimeout(groupingLiveTimer.current); };
  }, []);

  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      setCollapsedGroupsArr([...next]);
      return next;
    });
  }, [setCollapsedGroupsArr]);

  const toggleAllGroups = useCallback((collapse: boolean, groupNames: string[]) => {
    setCollapsedGroups(() => {
      const next = collapse ? new Set(groupNames.map((n) => `${subTab}:${n}`)) : new Set<string>();
      setCollapsedGroupsArr([...next]);
      return next;
    });
  }, [subTab, setCollapsedGroupsArr]);

  // ─── DnD between groups (state only — callbacks after applyLocalUpdate) ───
  const [dragActiveRowId, setDragActiveRowId] = useState<string | null>(null);
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Create Code Change from entity
  const [codeChangeEntity, setCodeChangeEntity] = useState<{ type: string; id: number; name: string } | null>(null);
  const [codeChangeProject, setCodeChangeProject] = useState<number | null>(null);
  const [codeChangeBranch, setCodeChangeBranch] = useState("primary_dev");
  const [codeChangeType, setCodeChangeType] = useState("Working Through");
  const [codeChangeProjects, setCodeChangeProjects] = useState<Array<{ projectId: number; projectName: string }>>([]);
  const [codeChangeCopied, setCodeChangeCopied] = useState(false);
  const [codeChangeCreated, setCodeChangeCreated] = useState(false);

  // Feature Impact modal state
  const [impactFeatureId, setImpactFeatureId] = useState<number | null>(null);
  const [impactData, setImpactData] = useState<{ feature: Record<string, unknown>; tables: Array<{ tableId: number; tableName: string; recordOwnership: string | null; rules: Array<Record<string, unknown>> }>; review: Record<string, unknown> | null; gaps: Array<{ tableId: number; tableName: string }> } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  // Module relationship rules
  const [moduleRules, setModuleRules] = useState<Record<string, unknown>[]>([]);
  const [ruleBuilderOpen, setRuleBuilderOpen] = useState<{ moduleId: number; moduleName: string; relationship: string } | null>(null);

  // Pending changes queue — per-tab, keyed by tab name
  const pendingRef = useRef<Record<string, Array<{ type: "create" | "update" | "delete"; tableName: string; record: Record<string, unknown>; reasoning: string }>>>({});

  /* ───── Load specific tabs (lazy, with dependency resolution) ───── */

  const loadTabs = useCallback(async (tabKeys: string[], force = false) => {
    setTabLoading(tabKeys[0]); // show spinner for the primary tab
    const result: Record<string, Record<string, unknown>[]> = {};
    const toFetch = force ? tabKeys.filter((k) => TABLE_CONFIGS[k]) : tabKeys.filter((k) => TABLE_CONFIGS[k]);
    if (toFetch.length === 0) { setTabLoading(null); return; }

    await Promise.all(
      toFetch.map(async (key) => {
        const cfg = TABLE_CONFIGS[key];
        try {
          const res = await fetchWithRetry(`/api/schema-planner?table=${cfg.apiTable}`);
          if (res.ok) {
            const json = await res.json();
            result[key] = Array.isArray(json) ? json : (json.rows || []);
          } else {
            result[key] = [];
          }
        } catch {
          result[key] = [];
        }
      })
    );
    setData((prev) => ({ ...prev, ...result }));
    setLoadedTabs((prev) => {
      const next = new Set(prev);
      toFetch.forEach((k) => next.add(k));
      loadedTabsRef.current = next;
      return next;
    });
    setTabLoading(null);
  }, []); // stable — no deps, uses only TABLE_CONFIGS (constant) and setters

  const loadModuleRules = useCallback(async () => {
    try {
      const res = await fetch("/api/schema-planner?table=_splan_entity_or_module_rules");
      if (res.ok) {
        const json = await res.json();
        setModuleRules(Array.isArray(json) ? json : (json.rows || []));
      }
    } catch { /* ignore */ }
  }, []);

  // Load active tab + its FK dependencies whenever subTab changes
  useEffect(() => {
    if (subTab === "access_matrix") return; // handled separately
    if (subTab === "prototypes") {
      // Prototypes grid handles its own data; only need features for allFeatures prop
      const unloaded = ["features"].filter((k) => TABLE_CONFIGS[k] && !loadedTabsRef.current.has(k));
      if (unloaded.length > 0) loadTabs(unloaded);
      return;
    }
    if (subTab === "projects") {
      // ProjectsGrid handles its own project/change data; load dependency picker sources
      const needed = ["modules", "features", "concepts", "data_tables", "data_fields"];
      const unloaded = needed.filter((k) => TABLE_CONFIGS[k] && !loadedTabsRef.current.has(k));
      if (unloaded.length > 0) loadTabs(unloaded);
      return;
    }
    const deps = TAB_DEPS[subTab] || [];
    const needed = [subTab, ...deps];
    const unloaded = needed.filter((k) => TABLE_CONFIGS[k] && !loadedTabsRef.current.has(k));
    if (unloaded.length > 0) {
      loadTabs(unloaded);
    }
  }, [subTab, loadTabs]);

  useEffect(() => {
    if (subTab === "modules") loadModuleRules();
  }, [subTab, loadModuleRules]);

  // Refresh: force-reload active tab + deps, clear their cache
  const refreshActiveTab = useCallback(async () => {
    if (subTab === "access_matrix") {
      // Re-fetch matrix
      setMatrixLoading(true);
      fetch("/api/schema-planner/matrix")
        .then((r) => r.json())
        .then((d) => setMatrixData(d))
        .catch(() => setMatrixData(null))
        .finally(() => setMatrixLoading(false));
      return;
    }
    if (subTab === "prototypes" || subTab === "projects") return; // These grids handle their own refresh
    const deps = TAB_DEPS[subTab] || [];
    const toReload = [subTab, ...deps];
    // Clear expanded field cache on data_tables refresh
    if (subTab === "data_tables") setTableFieldsCache({});
    // Clear from loaded so they're re-fetched
    setLoadedTabs((prev) => {
      const next = new Set(prev);
      toReload.forEach((k) => next.delete(k));
      loadedTabsRef.current = next;
      return next;
    });
    await loadTabs(toReload, true);
    // Secondary: re-fetch view presets after data is loaded
    await reloadViewPresets();
  }, [subTab, loadTabs, reloadViewPresets]);

  /* ───── Load access matrix when tab selected ───── */

  useEffect(() => {
    if (subTab !== "access_matrix") return;
    setMatrixLoading(true);
    fetch("/api/schema-planner/matrix")
      .then((r) => r.json())
      .then((d) => {
        setMatrixData(d);
        // Dynamically populate businessType options in access_rules config
        if (d.dimensions?.businessTypes) {
          const cfg = TABLE_CONFIGS.data_access_rules;
          const bizCol = cfg.columns.find((c) => c.key === "businessType");
          if (bizCol) bizCol.options = d.dimensions.businessTypes;
        }
      })
      .catch(() => setMatrixData(null))
      .finally(() => setMatrixLoading(false));
  }, [subTab]);

  /* ───── Close column dropdown on click outside ───── */

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colDropdownRef.current && !colDropdownRef.current.contains(e.target as Node)) setColDropdownOpen(false);
      if (fieldColDropdownRef.current && !fieldColDropdownRef.current.contains(e.target as Node)) setFieldColDropdownOpen(false);
      if (groupPopoverRef.current && !groupPopoverRef.current.contains(e.target as Node)) setGroupPopoverOpen(false);
      // Close column display popover on click outside
      if (colDisplayPopover) {
        const popEl = document.getElementById("col-display-popover");
        if (popEl && !popEl.contains(e.target as Node)) setColDisplayPopover(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* ───── Load projects for code change popup ───── */
  useEffect(() => {
    if (!codeChangeEntity) return;
    fetch("/api/schema-planner?table=_splan_projects")
      .then(r => r.json())
      .then((rows: Array<Record<string, unknown>>) => {
        const projs = (Array.isArray(rows) ? rows : []).map(r => ({ projectId: r.projectId as number, projectName: String(r.projectName) }));
        setCodeChangeProjects(projs);
        if (projs.length > 0 && !codeChangeProject) setCodeChangeProject(projs[0].projectId);
      })
      .catch(() => {});
    setCodeChangeCopied(false);
    setCodeChangeCreated(false);
  }, [codeChangeEntity]);

  /* ───── Fetch feature impact ───── */

  useEffect(() => {
    if (impactFeatureId == null) return;
    setImpactLoading(true);
    fetch(`/api/schema-planner/feature-impact?featureId=${impactFeatureId}`)
      .then((r) => r.json())
      .then((d) => setImpactData(d))
      .catch(() => setImpactData(null))
      .finally(() => setImpactLoading(false));
  }, [impactFeatureId]);

  /* ───── Data Tables: toggle expand + lazy field loading ───── */

  const toggleTableExpand = useCallback(async (tableId: number) => {
    setExpandedTableIds((prev) => {
      const next = new Set(prev);
      if (next.has(tableId)) {
        next.delete(tableId);
      } else {
        next.add(tableId);
      }
      return next;
    });
    // Always re-fetch fields on expand (no cache — fresh data every time)
    setTableFieldsLoading((prev) => new Set(prev).add(tableId));
    try {
      const res = await fetch(`/api/schema-planner?table=_splan_data_fields`);
      if (res.ok) {
        const json = await res.json();
        const allFields = (Array.isArray(json) ? json : (json.rows || [])) as Record<string, unknown>[];
        const tableFields = allFields.filter((f) => f.dataTableId === tableId);
        setTableFieldsCache((prev) => ({ ...prev, [tableId]: tableFields }));
      }
    } catch { /* ignore */ }
    setTableFieldsLoading((prev) => {
      const next = new Set(prev);
      next.delete(tableId);
      return next;
    });
  }, []);

  // Compute field counts per table from already-loaded data_fields (if loaded)
  const fieldCountsByTable = useMemo(() => {
    const counts = new Map<number, number>();
    const fields = data.data_fields || [];
    for (const f of fields) {
      const tid = f.dataTableId as number;
      counts.set(tid, (counts.get(tid) || 0) + 1);
    }
    return counts;
  }, [data]);

  // Feature counts per module (for the Modules tab expansion badge)
  const featureCountsByModule = useMemo(() => {
    const counts = new Map<number, number>();
    const features = data.features || [];
    for (const f of features) {
      const mods = f.modules;
      if (Array.isArray(mods)) {
        for (const mid of mods) {
          counts.set(mid as number, (counts.get(mid as number) || 0) + 1);
        }
      }
    }
    return counts;
  }, [data]);

  // Features grouped by module (for the Modules tab expansion)
  const featuresByModule = useMemo(() => {
    const map = new Map<number, Record<string, unknown>[]>();
    const features = data.features || [];
    for (const f of features) {
      const mods = f.modules;
      if (Array.isArray(mods)) {
        for (const mid of mods) {
          if (!map.has(mid as number)) map.set(mid as number, []);
          map.get(mid as number)!.push(f);
        }
      }
    }
    return map;
  }, [data]);

  // Computed platforms for each module (union of all feature platforms + per-platform count)
  const computedModulePlatforms = useMemo(() => {
    const result: Record<number, { platforms: string[]; counts: Record<string, number> }> = {};
    for (const [modIdStr, feats] of featuresByModule.entries()) {
      const counts: Record<string, number> = {};
      for (const feat of feats) {
        const fp = Array.isArray(feat.platforms) ? (feat.platforms as string[]) : ["Web App"];
        for (const p of fp) counts[p] = (counts[p] || 0) + 1;
      }
      result[Number(modIdStr)] = { platforms: Object.keys(counts), counts };
    }
    return result;
  }, [featuresByModule]);

  /* ───── FK resolution ───── */

  const resolveFK = useCallback(
    (tableName: string, id: unknown) => {
      const cfg = TABLE_CONFIGS[tableName];
      if (!cfg || !cfg.nameKey || !data[tableName]) return String(id ?? "");
      const rec = data[tableName].find((r) => r[cfg.idKey] === id);
      return rec ? String(rec[cfg.nameKey!] ?? `#${id}`) : String(id ?? "");
    },
    [data]
  );

  const getFKOptions = useCallback(
    (tableName: string, filterKey?: string, filterValue?: unknown) => {
      const cfg = TABLE_CONFIGS[tableName];
      if (!cfg || !data[tableName]) return [];
      let records = data[tableName];
      if (filterKey && filterValue != null) {
        records = records.filter((r) => r[filterKey] == filterValue);
      }
      return records.map((r) => ({
        id: r[cfg.idKey] as number,
        name: cfg.nameKey ? String(r[cfg.nameKey!] ?? `#${r[cfg.idKey]}`) : `#${r[cfg.idKey]}`,
      }));
    },
    [data]
  );

  /* ───── Mention/reference helpers ───── */

  // Flat lists for MentionTextarea autocomplete
  const mentionTables = useMemo(() =>
    (data.data_tables || []).map((r) => ({ id: r.tableId as number, name: String(r.tableName) })),
    [data]
  );
  const mentionFields = useMemo(() =>
    (data.data_fields || []).map((r) => {
      const tbl = (data.data_tables || []).find((t) => t.tableId === r.dataTableId);
      return {
        id: r.fieldId as number,
        name: String(r.fieldName),
        tableId: r.dataTableId as number,
        tableName: tbl ? String(tbl.tableName) : `#${r.dataTableId}`,
      };
    }),
    [data]
  );

  // Name sets for highlight layer coloring
  const mentionTableNames = useMemo(() => new Set(mentionTables.map((t) => t.name)), [mentionTables]);
  const mentionFieldDisplayNames = useMemo(() => new Set(mentionFields.map((f) => `${f.tableName}.${f.name}`)), [mentionFields]);

  // Module/feature data for mention autocomplete
  const mentionModules = useMemo(() =>
    (data.modules || []).map((r) => ({ id: r.moduleId as number, name: String(r.moduleName) })),
    [data]
  );
  const mentionFeatures = useMemo(() =>
    (data.features || []).map((r) => {
      const mods = (r.modules as number[]) || [];
      const modNames = mods.map((mid) => {
        const m = (data.modules || []).find((mod) => mod.moduleId === mid);
        return m ? String(m.moduleName) : "";
      }).filter(Boolean).join(", ");
      return { id: r.featureId as number, name: String(r.featureName), modules: modNames };
    }),
    [data]
  );
  const mentionConcepts = useMemo(() =>
    (data.concepts || []).map((r) => ({ id: r.conceptId as number, name: String(r.conceptName) })),
    [data]
  );
  const mentionResearch = useMemo(() =>
    (data.research || []).map((r) => ({ id: r.researchId as number, name: String(r.title) })),
    [data]
  );

  // Resolvers for RichRefText and extractRefsFromNotes
  const resolveTableName = useCallback((id: number): string | null => {
    const t = (data.data_tables || []).find((r) => r.tableId === id);
    return t ? String(t.tableName) : null;
  }, [data]);

  const resolveFieldName = useCallback((id: number): string | null => {
    const f = (data.data_fields || []).find((r) => r.fieldId === id);
    return f ? String(f.fieldName) : null;
  }, [data]);

  const fieldTableIdLookup = useCallback((fieldId: number): number | null => {
    const f = (data.data_fields || []).find((r) => r.fieldId === fieldId);
    return f ? (f.dataTableId as number) : null;
  }, [data]);

  const resolveModuleName = useCallback((id: number): string | null => {
    const m = (data.modules || []).find((r) => r.moduleId === id);
    return m ? String(m.moduleName) : null;
  }, [data]);

  const resolveFeatureName = useCallback((id: number): string | null => {
    const f = (data.features || []).find((r) => r.featureId === id);
    return f ? String(f.featureName) : null;
  }, [data]);
  const resolveConceptName = useCallback((id: number): string | null => {
    const c = (data.concepts || []).find((r) => r.conceptId === id);
    return c ? String(c.conceptName) : null;
  }, [data]);
  const resolveResearchName = useCallback((id: number): string | null => {
    const r = (data.research || []).find((res) => res.researchId === id);
    return r ? String(r.title) : null;
  }, [data]);

  const handleRefSummaryClick = useCallback((type: "module" | "feature" | "table" | "concept" | "research", name: string) => {
    if (type === "module") {
      const mod = (data.modules || []).find((m) => String(m.moduleName) === name);
      if (mod) setRefSummaryPopup({ type: "module", record: mod as Record<string, unknown> });
    } else if (type === "table") {
      const tbl = (data.data_tables || []).find((t) => String(t.tableName) === name);
      if (tbl) setRefSummaryPopup({ type: "table", record: tbl as Record<string, unknown> });
    } else if (type === "concept") {
      const con = (data.concepts || []).find((c) => String(c.conceptName) === name);
      if (con) setRefSummaryPopup({ type: "concept", record: con as Record<string, unknown> });
    } else if (type === "research") {
      const res = (data.research || []).find((r) => String(r.title) === name);
      if (res) setRefSummaryPopup({ type: "research", record: res as Record<string, unknown> });
    } else {
      const feat = (data.features || []).find((f) => String(f.featureName) === name);
      if (feat) setRefSummaryPopup({ type: "feature", record: feat as Record<string, unknown> });
    }
  }, [data]);

  // Resolve module names for a feature
  const resolveModuleNames = useCallback((feat: Record<string, unknown>): string => {
    const moduleIds = Array.isArray(feat.modules) ? feat.modules as number[] : [];
    if (moduleIds.length === 0) return "";
    return moduleIds.map((mid) => {
      const mod = (data.modules || []).find((m) => m.moduleId === mid);
      return mod ? String(mod.moduleName) : "";
    }).filter(Boolean).join(", ");
  }, [data]);

  // Reverse lookup: which features reference each table/field via (t:ID)/(f:ID) tokens in notes
  const featureRefMaps = useMemo(() => {
    const tableToFeatures = new Map<number, FeatureRefInfo[]>();
    const fieldToFeatures = new Map<number, FeatureRefInfo[]>();

    for (const feat of (data.features || [])) {
      const featureName = String(feat.featureName ?? "");
      const moduleNames = resolveModuleNames(feat);
      const info: FeatureRefInfo = { featureName, moduleNames };
      const noteFields = [feat.notes, feat.nativeNotes, feat.androidNotes, feat.appleNotes, feat.otherNotes, feat.implementation].filter(Boolean).map(String);
      // Also scan collapsed section buffers — refs hidden inside collapsed sections would otherwise be missed
      const collapsedSections = feat.collapsedSections as Record<string, Record<string, { body: string }>> | null;
      if (collapsedSections) {
        for (const sectionGroup of Object.values(collapsedSections)) {
          if (sectionGroup && typeof sectionGroup === "object") {
            for (const buf of Object.values(sectionGroup)) {
              if (buf?.body) noteFields.push(buf.body);
            }
          }
        }
      }
      const seenTables = new Set<number>();
      const seenFields = new Set<number>();
      for (const txt of noteFields) {
        const { tableIds, fieldIds } = extractRefs(txt);
        for (const tid of tableIds) {
          if (!seenTables.has(tid)) {
            seenTables.add(tid);
            if (!tableToFeatures.has(tid)) tableToFeatures.set(tid, []);
            tableToFeatures.get(tid)!.push(info);
          }
        }
        for (const fid of fieldIds) {
          if (!seenFields.has(fid)) {
            seenFields.add(fid);
            if (!fieldToFeatures.has(fid)) fieldToFeatures.set(fid, []);
            fieldToFeatures.get(fid)!.push(info);
          }
        }
      }
    }
    return { tableToFeatures, fieldToFeatures };
  }, [data, resolveModuleNames]);

  /* ───── Live Mode: debounced per-row save ───── */

  const liveSaveRow = useCallback(async (rowKey: string) => {
    const entry = livePendingRows.current.get(rowKey);
    if (!entry) return;
    livePendingRows.current.delete(rowKey);

    const { tabKey, record, reasoning } = entry;
    const cfg = TABLE_CONFIGS[tabKey];
    if (!cfg) return;

    const id = record[cfg.idKey] as number;
    if (typeof id === "number" && id < 0) return;

    setLiveStatus("saving");

    try {
      const sendData = { ...record };
      delete sendData[cfg.idKey];
      delete sendData.createdAt;
      for (const k of Object.keys(sendData)) { if (k.startsWith("_")) delete sendData[k]; }

      const res = await fetch("/api/schema-planner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: cfg.apiTable, id, data: sendData, reasoning }),
      });

      if (res.ok) {
        setLiveFailedRows((prev) => {
          if (!prev.has(rowKey)) return prev;
          const next = new Set(prev);
          next.delete(rowKey);
          return next;
        });
        setLiveStatus("saved");
        setTimeout(() => setLiveStatus((s) => s === "saved" ? "idle" : s), 1500);
      } else {
        setLiveFailedRows((prev) => { const next = new Set(prev); next.add(rowKey); return next; });
        setLiveStatus("failed");
        setTimeout(() => setLiveStatus((s) => s === "failed" ? "idle" : s), 3000);
      }
    } catch {
      setLiveFailedRows((prev) => { const next = new Set(prev); next.add(rowKey); return next; });
      setLiveStatus("failed");
      setTimeout(() => setLiveStatus((s) => s === "failed" ? "idle" : s), 3000);
    }
  }, []);

  const queueLiveSave = useCallback((tabKey: string, record: Record<string, unknown>, reasoning: string) => {
    const cfg = TABLE_CONFIGS[tabKey];
    if (!cfg) return;
    const id = record[cfg.idKey] as number;
    if (typeof id === "number" && id < 0) return;

    const rowKey = `${tabKey}:${id}`;

    const existing = livePendingRows.current.get(rowKey);
    if (existing) {
      livePendingRows.current.set(rowKey, {
        tabKey,
        record: { ...existing.record, ...record },
        reasoning: existing.reasoning === reasoning ? reasoning : `${existing.reasoning}; ${reasoning}`,
      });
    } else {
      livePendingRows.current.set(rowKey, { tabKey, record, reasoning });
    }

    const existingTimer = liveDebounceTimers.current.get(rowKey);
    if (existingTimer) clearTimeout(existingTimer);
    liveDebounceTimers.current.set(rowKey, setTimeout(() => {
      liveDebounceTimers.current.delete(rowKey);
      liveSaveRow(rowKey);
    }, 300));
  }, [liveSaveRow]);

  const liveCreateRow = useCallback(async (tabKey: string, record: Record<string, unknown>, reasoning: string): Promise<number | null> => {
    const cfg = TABLE_CONFIGS[tabKey];
    if (!cfg) return null;

    setLiveStatus("saving");
    try {
      const sendData = { ...record };
      delete sendData[cfg.idKey];
      delete sendData.createdAt;
      delete sendData.updatedAt;
      for (const k of Object.keys(sendData)) { if (k.startsWith("_")) delete sendData[k]; }

      const res = await fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: cfg.apiTable, data: sendData, reasoning }),
      });

      if (res.ok) {
        const json = await res.json();
        const newId = json[cfg.idKey] ?? json.row?.[cfg.idKey] ?? json.id ?? null;
        setLiveStatus("saved");
        setTimeout(() => setLiveStatus((s) => s === "saved" ? "idle" : s), 1500);
        return newId as number | null;
      } else {
        setLiveStatus("failed");
        setTimeout(() => setLiveStatus((s) => s === "failed" ? "idle" : s), 3000);
        return null;
      }
    } catch {
      setLiveStatus("failed");
      setTimeout(() => setLiveStatus((s) => s === "failed" ? "idle" : s), 3000);
      return null;
    }
  }, []);

  // Flush all pending live debounce timers immediately (fire saves now)
  const flushLiveTimers = useCallback(() => {
    liveDebounceTimers.current.forEach((timer, rowKey) => {
      clearTimeout(timer);
      liveSaveRow(rowKey);
    });
    liveDebounceTimers.current.clear();
  }, [liveSaveRow]);

  // Flush pending live saves on page leave (keepalive fetch survives unload)
  // Also warn if there are any unsaved module data or preference changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      // Warn user if there are unsaved changes (module data or preferences)
      // Flush any pending debounced saves before page unload
      if (liveDebounceTimers.current.size > 0) {
        liveDebounceTimers.current.forEach((timer, rowKey) => {
          clearTimeout(timer);
          const entry = livePendingRows.current.get(rowKey);
          if (entry) {
            const cfg = TABLE_CONFIGS[entry.tabKey];
            if (cfg) {
              const id = entry.record[cfg.idKey] as number;
              if (typeof id === "number" && id > 0) {
                const sendData = { ...entry.record };
                delete sendData[cfg.idKey];
                delete sendData.createdAt;
                for (const k of Object.keys(sendData)) { if (k.startsWith("_")) delete sendData[k]; }
                fetch("/api/schema-planner", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ table: cfg.apiTable, id, data: sendData, reasoning: entry.reasoning }),
                  keepalive: true,
                });
              }
            }
            livePendingRows.current.delete(rowKey);
          }
        });
        liveDebounceTimers.current.clear();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  /* ───── Local mutation helpers ───── */

  const markTabDirty = useCallback((_tabKey: string) => {
    // No-op — always in live mode, no dirty tracking needed
  }, []);

  const applyLocalCreate = useCallback((tabKey: string, record: Record<string, unknown>, reasoning: string) => {
    const cfg = TABLE_CONFIGS[tabKey];
    // Assign a temp negative ID for local tracking
    const tempId = -(Date.now() + Math.random());
    record[cfg.idKey] = tempId;
    record.createdAt = new Date().toISOString();
    record.updatedAt = new Date().toISOString();

    setData((prev) => ({ ...prev, [tabKey]: [...(prev[tabKey] || []), record] }));

    // Live mode: POST immediately, then swap temp ID with real ID
    if (liveMode) {
      liveCreateRow(tabKey, record, reasoning).then((newId) => {
        if (newId != null) {
          // Replace temp ID with server-assigned ID in local state
          setData((prev) => ({
            ...prev,
            [tabKey]: (prev[tabKey] || []).map((r) =>
              r[cfg.idKey] === tempId ? { ...r, [cfg.idKey]: newId } : r
            ),
          }));
        }
      });
      return;
    }

    if (!pendingRef.current[tabKey]) pendingRef.current[tabKey] = [];
    pendingRef.current[tabKey].push({ type: "create", tableName: tabKey, record, reasoning });
    markTabDirty(tabKey);
  }, [markTabDirty, liveMode, liveCreateRow]);

  const applyLocalUpdate = useCallback((tabKey: string, record: Record<string, unknown>, reasoning: string) => {
    const cfg = TABLE_CONFIGS[tabKey];
    const id = record[cfg.idKey];
    record.updatedAt = new Date().toISOString();

    setData((prev) => ({
      ...prev,
      [tabKey]: (prev[tabKey] || []).map((r) => (r[cfg.idKey] === id ? { ...r, ...record } : r)),
    }));

    // Live mode: skip dirty tracking, queue debounced save for real rows
    if (liveMode && typeof id === "number" && id > 0) {
      queueLiveSave(tabKey, record, reasoning);
      return;
    }

    if (!pendingRef.current[tabKey]) pendingRef.current[tabKey] = [];
    pendingRef.current[tabKey].push({ type: "update", tableName: tabKey, record, reasoning });
    markTabDirty(tabKey);
  }, [markTabDirty, liveMode, queueLiveSave]);

  const applyLocalDelete = useCallback((tabKey: string, record: Record<string, unknown>, reasoning: string) => {
    const cfg = TABLE_CONFIGS[tabKey];
    const id = record[cfg.idKey];

    setData((prev) => ({
      ...prev,
      [tabKey]: (prev[tabKey] || []).filter((r) => r[cfg.idKey] !== id),
    }));

    // Live mode: DELETE immediately for real rows
    if (liveMode && typeof id === "number" && id > 0) {
      (async () => {
        setLiveStatus("saving");
        try {
          const res = await fetch("/api/schema-planner", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ table: cfg.apiTable, id, reasoning }),
          });
          if (res.ok) {
            setLiveStatus("saved");
            setTimeout(() => setLiveStatus((s) => s === "saved" ? "idle" : s), 1500);
          } else {
            setLiveStatus("failed");
            setTimeout(() => setLiveStatus((s) => s === "failed" ? "idle" : s), 3000);
          }
        } catch {
          setLiveStatus("failed");
          setTimeout(() => setLiveStatus((s) => s === "failed" ? "idle" : s), 3000);
        }
      })();
      return;
    }

    if (!pendingRef.current[tabKey]) pendingRef.current[tabKey] = [];
    pendingRef.current[tabKey].push({ type: "delete", tableName: tabKey, record, reasoning });
    markTabDirty(tabKey);
  }, [markTabDirty, liveMode]);

  // ─── DnD between groups (callbacks — after applyLocalUpdate is defined) ───
  const handleGroupDragEnd = useCallback((event: DragEndEvent) => {
    setDragActiveRowId(null);
    const { active, over } = event;
    if (!over || !activeGrouping) return;

    const targetGroupName = String(over.id).replace(`${subTab}:`, "").split("/").pop() || "";
    const sourceGroupName = active.data.current?.sourceGroup;
    if (targetGroupName === sourceGroupName) return;

    const rowId = String(active.id).replace("drag-", "");
    const tabCfg = TABLE_CONFIGS[subTab];
    if (!tabCfg) return;
    const allRows = data[subTab] || [];
    const row = allRows.find((r) => String(r[tabCfg.idKey]) === rowId);
    if (!row) return;

    // Find matching rule — use first condition's column for DnD
    const matchingRule = activeGrouping.rules.find((r) => r.groupName === targetGroupName);

    if (matchingRule) {
      const derived = deriveValueFromRule(matchingRule, row[matchingRule.conditions[0]?.column]);
      if (!derived) return;
      const updated = { ...row, [derived.column]: derived.value };
      applyLocalUpdate(subTab, updated, `Moved to group "${targetGroupName}": set ${derived.column} = "${derived.value}"`);
    } else if (targetGroupName === (activeGrouping.ungroupedLabel || "Other")) {
      // Auto-group: use autoGroup column; manual: use first rule's first condition column
      const col = activeGrouping.autoGroup?.column || activeGrouping.rules[0]?.conditions[0]?.column;
      if (!col) return;
      const updated = { ...row, [col]: "" };
      applyLocalUpdate(subTab, updated, `Moved to group "${targetGroupName}": set ${col} = ""`);
    }
  }, [activeGrouping, subTab, data, applyLocalUpdate]);

  const handleGroupDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveRowId(String(event.active.id).replace("drag-", ""));
  }, []);

  /* ───── Batch save (active tab + bundled field edits) ───── */

  const batchSave = useCallback(async () => {
    // On Data Tables tab, also flush data_fields pending changes; on Modules tab, also flush features
    const tabsToSave = subTab === "data_tables" ? ["data_tables", "data_fields"] : subTab === "modules" ? ["modules", "features"] : [subTab];
    const allPending: Array<{ type: string; tableName: string; record: Record<string, unknown>; reasoning: string }> = [];
    for (const tab of tabsToSave) {
      const tabPending = pendingRef.current[tab];
      if (tabPending && tabPending.length > 0) {
        allPending.push(...tabPending);
        pendingRef.current[tab] = [];
      }
    }
    const hasGroupingChanges = draftDirty && !liveMode;
    if (allPending.length === 0 && !hasGroupingChanges) return;
    setSaving(true);

    // Persist grouping preset changes alongside other data
    if (hasGroupingChanges) {
      try { await persistGroupingDraft(); } catch { /* non-fatal */ }
    }

    // If only grouping changed (no row-level pending), show flash and exit
    if (allPending.length === 0) {
      setSaving(false);
      setSaveFlash(subTab);
      setTimeout(() => setSaveFlash(null), 2000);
      onDataChanged?.();
      return;
    }

    const pending = allPending;

    const errors: string[] = [];

    // Merge inline edits (updates) into their corresponding create entries for temp records.
    // When a record is created locally (temp negative ID) and then inline-edited, the updates
    // reference the same temp ID. We fold those updates into the create so the POST includes all fields.
    const mergedPending: typeof pending = [];
    const createsByTempId = new Map<number, (typeof pending)[0]>();
    for (const op of pending) {
      const cfg = TABLE_CONFIGS[op.tableName];
      const id = op.record[cfg.idKey] as number;
      if (op.type === "create" && typeof id === "number" && id < 0) {
        createsByTempId.set(id, { ...op, record: { ...op.record } });
        mergedPending.push(createsByTempId.get(id)!);
      } else if (op.type === "update" && typeof id === "number" && id < 0) {
        // Merge updated fields into the create entry
        const createOp = createsByTempId.get(id);
        if (createOp) {
          Object.assign(createOp.record, op.record);
          // Append reasoning
          if (op.reasoning && !createOp.reasoning.includes(op.reasoning)) {
            createOp.reasoning += `; ${op.reasoning}`;
          }
        }
        // Don't push the update — it's merged into the create
      } else if (op.type === "delete" && typeof id === "number" && id < 0) {
        // Remove the create from mergedPending entirely — record was created then deleted locally
        const idx = mergedPending.findIndex((p) => p.type === "create" && p.record[TABLE_CONFIGS[p.tableName].idKey] === id);
        if (idx >= 0) mergedPending.splice(idx, 1);
        createsByTempId.delete(id);
      } else {
        mergedPending.push(op);
      }
    }

    try {
      for (const op of mergedPending) {
        const cfg = TABLE_CONFIGS[op.tableName];
        const apiTable = cfg.apiTable;
        let res: Response;

        if (op.type === "create") {
          const sendData = { ...op.record };
          delete sendData[cfg.idKey];
          delete sendData.createdAt;
          delete sendData.updatedAt;
          // Strip virtual keys (separators, computed columns)
          for (const k of Object.keys(sendData)) { if (k.startsWith("_")) delete sendData[k]; }
          res = await fetch("/api/schema-planner", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ table: apiTable, data: sendData, reasoning: op.reasoning }),
          });
        } else if (op.type === "update") {
          const id = op.record[cfg.idKey];
          if (typeof id === "number" && id < 0) continue; // shouldn't happen after merge, but safety check
          const sendData = { ...op.record };
          delete sendData[cfg.idKey];
          delete sendData.createdAt;
          for (const k of Object.keys(sendData)) { if (k.startsWith("_")) delete sendData[k]; }
          res = await fetch("/api/schema-planner", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ table: apiTable, id, data: sendData, reasoning: op.reasoning }),
          });
        } else if (op.type === "delete") {
          const id = op.record[cfg.idKey];
          if (typeof id === "number" && id < 0) continue;
          res = await fetch("/api/schema-planner", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ table: apiTable, id, reasoning: op.reasoning }),
          });
        } else {
          continue;
        }

        if (!res!.ok) {
          let detail = `${res!.status}`;
          try {
            const body = await res!.json();
            if (body?.error) detail = body.error;
          } catch { /* ignore parse errors */ }
          const name = op.record[cfg.nameKey || ""] ?? `#${op.record[cfg.idKey] ?? "?"}`;
          errors.push(`${op.type} ${cfg.label.replace(/s$/, "")} "${name}": ${detail}`);
        }
      }

      // Targeted reload: active tab + bundled tabs (to get server-assigned IDs)
      await loadTabs(tabsToSave, true);

      // Refresh tableFieldsCache if we saved data_fields from Data Tables tab
      if (subTab === "data_tables") {
        const allFields = (data.data_fields || []) as Record<string, unknown>[];
        const newCache: Record<number, Record<string, unknown>[]> = {};
        for (const f of allFields) {
          const tid = f.dataTableId as number;
          if (!newCache[tid]) newCache[tid] = [];
          newCache[tid].push(f);
        }
        setTableFieldsCache(newCache);
      }

      // Invalidate dependent tabs' caches so they re-fetch on next visit
      const invalidatedSet = new Set<string>();
      for (const tab of tabsToSave) {
        for (const inv of (TAB_INVALIDATES[tab] || [])) invalidatedSet.add(inv);
      }
      // Don't invalidate tabs we just saved
      for (const tab of tabsToSave) invalidatedSet.delete(tab);
      if (invalidatedSet.size > 0) {
        setLoadedTabs((prev) => {
          const next = new Set(prev);
          invalidatedSet.forEach((k) => next.delete(k));
          loadedTabsRef.current = next;
          return next;
        });
      }

      if (errors.length === 0) {
        setDirtyTabs((prev) => { const n = new Set(prev); for (const tab of tabsToSave) n.delete(tab); return n; });
        // Flash "Saved!" for 2 seconds
        setSaveFlash(subTab);
        setTimeout(() => setSaveFlash(null), 2000);
        onDataChanged?.();
      } else {
        // Re-mark dirty so user knows not everything saved
        setDirtyTabs((prev) => { const n = new Set(prev); for (const tab of tabsToSave) n.add(tab); return n; });
        alert(`${errors.length} operation(s) failed:\n\n${errors.join("\n")}`);
      }
    } catch (err) {
      console.error("Save error:", err);
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      // Put remaining ops back so they aren't lost (group by tableName)
      for (const op of pending) {
        if (!pendingRef.current[op.tableName]) pendingRef.current[op.tableName] = [];
        pendingRef.current[op.tableName].push(op as typeof pendingRef.current[string][0]);
      }
      setDirtyTabs((prev) => { const n = new Set(prev); for (const tab of tabsToSave) n.add(tab); return n; });
    } finally {
      setSaving(false);
    }
  }, [subTab, loadTabs]);

  /* ───── Modal open/close ───── */

  const openCreate = useCallback(() => {
    const cfg = TABLE_CONFIGS[subTab];
    const rec: Record<string, unknown> = {};
    cfg.columns.forEach((col) => {
      if (col.type === "separator" || col.type === "ref-features" || col.type === "ref-projects" || col.type === "formula") return;
      if (col.type === "boolean") rec[col.key] = false;
      else if (col.type === "multi-fk" || col.type === "tags") rec[col.key] = [];
      else if (col.type === "platforms") rec[col.key] = ["Web App"];
      else if (col.type === "checklist") rec[col.key] = DEFAULT_CHECKLIST_ITEMS.map((item) => ({ item, checked: false }));
      else rec[col.key] = null;
    });
    setModalRecord(rec);
    setModalIsNew(true);
    setModalReason("");
    setModalOpen(true);
  }, [subTab]);

  const openEdit = useCallback(
    (record: Record<string, unknown>) => {
      setModalRecord({ ...record });
      setModalIsNew(false);
      setModalReason("");
      setModalOpen(true);
    },
    []
  );

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setModalRecord(null);
  }, []);

  const handleModalSave = useCallback(() => {
    if (!modalRecord) return;

    const cfg = TABLE_CONFIGS[subTab];
    // Validate required fields (also catch empty arrays for multi-fk)
    const missing = cfg.columns.filter((col) => {
      if (!col.required) return false;
      const v = modalRecord[col.key];
      if (v == null || v === "") return true;
      if (Array.isArray(v) && v.length === 0) return true;
      return false;
    });
    if (missing.length) {
      alert(`Required: ${missing.map((c) => c.label).join(", ")}`);
      return;
    }

    // Reasoning is optional — auto-generate if blank
    const reason = modalReason.trim() || (modalIsNew ? `Created ${cfg.label.replace(/s$/, "")}` : `Updated ${cfg.label.replace(/s$/, "")}`);

    if (modalIsNew) {
      applyLocalCreate(subTab, modalRecord, reason);
    } else {
      applyLocalUpdate(subTab, modalRecord, reason);
    }
    closeModal();
  }, [subTab, modalRecord, modalIsNew, modalReason, applyLocalCreate, applyLocalUpdate, closeModal]);

  /* ───── Delete confirm ───── */

  const confirmDelete = useCallback((record: Record<string, unknown>, targetTab?: string) => {
    setDeleteTarget(record);
    setDeleteTargetTab(targetTab ?? null);
    setDeleteReason("");
  }, []);

  const executeDelete = useCallback(() => {
    if (!deleteTarget || !deleteReason.trim()) {
      alert("Reasoning is required.");
      return;
    }
    const tab = deleteTargetTab ?? subTab;
    applyLocalDelete(tab, deleteTarget, deleteReason);
    setDeleteTarget(null);
    setDeleteTargetTab(null);
  }, [subTab, deleteTarget, deleteTargetTab, deleteReason, applyLocalDelete]);

  /* ───── Available tags (for filter dropdown) ───── */

  const availableTags = useMemo(() => {
    const allTags = new Set<string>();
    (data.data_tables || []).forEach((r) => {
      const tags = r.tags;
      if (Array.isArray(tags)) tags.forEach((t: string) => allTags.add(t));
    });
    return Array.from(allTags).sort();
  }, [data]);

  /* ───── Sorting & filtering ───── */

  const hasStatusFilter = subTab === "data_tables" || subTab === "data_fields";
  const hasTagFilter = subTab === "data_tables";
  const statusKey = subTab === "data_tables" ? "tableStatus" : "fieldStatus";

  const applyFilterRules = useCallback((rows: Record<string, unknown>[], rules: FilterRule[]) => {
    if (rules.length === 0) return rows;
    return rows.filter((row) =>
      rules.every((rule) => {
        const val = row[rule.col];
        const str = val == null ? "" : Array.isArray(val) ? val.map(String).join(", ") : String(val);
        const strLc = str.toLowerCase();
        const ruleLc = rule.value.toLowerCase();
        switch (rule.op) {
          case "equals": return strLc === ruleLc;
          case "not_equals": return strLc !== ruleLc;
          case "contains": return strLc.includes(ruleLc);
          case "not_contains": return !strLc.includes(ruleLc);
          case "is_empty": return str === "";
          case "not_empty": return str !== "";
          default: return true;
        }
      })
    );
  }, []);

  const filteredRows = useMemo(() => {
    const cfg = TABLE_CONFIGS[subTab];
    if (!cfg) return []; // special tabs like access_matrix
    let rows = data[subTab] || [];

    // Rule-based module filters (applies to modules sub-tab)
    if (subTab === "modules" && moduleFilterRules.length > 0) {
      rows = applyFilterRules(rows, moduleFilterRules);
    }

    // Status filter (live/planned) for data_tables and data_fields
    if (hasStatusFilter && statusFilter !== "all") {
      rows = rows.filter((r) => r[statusKey] === statusFilter);
    }

    // Tag filter for data_tables
    if (hasTagFilter && tagFilter !== "all") {
      rows = rows.filter((r) => {
        const tags = r.tags;
        return Array.isArray(tags) && tags.includes(tagFilter);
      });
    }

    // Module filter for features
    if (subTab === "features" && moduleFilter !== "all") {
      const modId = Number(moduleFilter);
      rows = rows.filter((r) => {
        const mods = r.modules;
        return Array.isArray(mods) && mods.includes(modId);
      });
    }

    if (search) {
      const s = search.toLowerCase();
      // Data Tables: search mode determines what we search
      if (subTab === "data_tables" && dataTableSearchMode !== "tables") {
        const allFields = data.data_fields || [];
        const matchingTableIds = new Set<number>();
        for (const f of allFields) {
          if (dataTableSearchMode === "fields") {
            const name = String(f.fieldName ?? "").toLowerCase();
            const dtype = String(f.dataType ?? "").toLowerCase();
            if (name.includes(s) || dtype.includes(s)) matchingTableIds.add(f.dataTableId as number);
          } else if (dataTableSearchMode === "examples") {
            const examples = String(f.exampleValues ?? "").toLowerCase();
            if (examples.includes(s)) matchingTableIds.add(f.dataTableId as number);
          }
        }
        rows = rows.filter((r) => matchingTableIds.has(r.tableId as number));
        // Auto-expand matching tables
        if (matchingTableIds.size > 0 && matchingTableIds.size <= 10) {
          setExpandedTableIds(matchingTableIds);
          // Lazy load fields for expanded tables
          for (const tid of matchingTableIds) {
            if (!tableFieldsCache[tid]) toggleTableExpand(tid);
          }
        }
      } else {
        rows = rows.filter((r) =>
          cfg.columns.some((col) => {
            const v = r[col.key];
            if (v == null) return false;
            if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase().includes(s));
            return String(v).toLowerCase().includes(s);
          })
        );
      }
    }

    // Multi-sort: primary then secondary
    if (sortConfig.primary) {
      const compareCol = (a: Record<string, unknown>, b: Record<string, unknown>, col: string, dir: "asc" | "desc") => {
        const va = a[col] ?? "";
        const vb = b[col] ?? "";
        if (typeof va === "number" && typeof vb === "number") return dir === "asc" ? va - vb : vb - va;
        return dir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      };
      rows = [...rows].sort((a, b) => {
        const primary = compareCol(a, b, sortConfig.primary!.col, sortConfig.primary!.dir);
        if (primary !== 0 || !sortConfig.secondary) return primary;
        return compareCol(a, b, sortConfig.secondary.col, sortConfig.secondary.dir);
      });
    }

    return rows;
  }, [data, subTab, search, sortConfig, statusFilter, tagFilter, hasStatusFilter, hasTagFilter, statusKey, moduleFilter, dataTableSearchMode, tableFieldsCache, toggleTableExpand, moduleFilterRules, applyFilterRules]);

  // Pagination computed values
  const totalRows = filteredRows.length;
  const totalPages = pageSize > 0 ? Math.ceil(totalRows / pageSize) : 1;
  const safePage = Math.min(currentPage, Math.max(1, totalPages));
  const paginatedRows = useMemo(() => {
    if (pageSize === 0) return filteredRows; // "All"
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, pageSize, safePage]);

  // Enrich rows with computed column values so grouping/sorting can access them
  const enrichedRows = useMemo(() => {
    // Check if any rule/condition references a computed column
    const allColumns = activeGrouping ? [
      ...(activeGrouping.autoGroup ? [activeGrouping.autoGroup.column] : []),
      ...(activeGrouping.rules || []).flatMap((r) => [
        ...(r.conditions || []).map((c) => c.column),
        ...(r.subRules?.flatMap((sr) => (sr.conditions || []).map((c) => c.column)) || []),
      ]),
    ] : [];
    const hasComputedCol = allColumns.some((c) => c.startsWith("_"));
    if (!activeGrouping || !hasComputedCol) return filteredRows;
    const cfg = TABLE_CONFIGS[subTab];
    if (!cfg) return filteredRows;
    const idKey = cfg.idKey;
    // Inject _referencedBy as a string value for grouping evaluation
    if (allColumns.includes("_referencedBy") && (subTab === "data_tables" || subTab === "data_fields")) {
      const refMap = subTab === "data_tables" ? featureRefMaps.tableToFeatures : featureRefMaps.fieldToFeatures;
      return filteredRows.map((row) => {
        const id = row[idKey] as number;
        const refs = refMap.get(id);
        const val = refs && refs.length > 0 ? `${refs.length} ${refs.length === 1 ? "feature" : "features"}` : "";
        return { ...row, _referencedBy: val };
      });
    }
    return filteredRows;
  }, [filteredRows, activeGrouping, subTab, featureRefMaps]);

  // Grouped rows — when grouping is active, evaluate rules on ALL filtered rows (bypass pagination)
  const groupedResult = useMemo(() => {
    if (!activeGrouping) return null;
    // Check if config has rules or autoGroup
    const hasContent = activeGrouping.rules.length > 0 || activeGrouping.autoGroup;
    if (!hasContent) return null;
    return evaluateMultiLevelGrouping(enrichedRows, activeGrouping);
  }, [enrichedRows, activeGrouping]);

  // Flatten nested groups into a linear list for rendering
  const flatSections = useMemo(() => {
    if (!groupedResult) return null;
    return flattenGroupNodes(groupedResult.groups, subTab, "", activeGrouping ?? undefined);
  }, [groupedResult, subTab, activeGrouping]);

  // Backward-compat alias so existing code referencing groupedRows still works
  const groupedRows = groupedResult;

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, tagFilter, moduleFilter, sortConfig]);

  const handleSort = useCallback(
    (_key: string) => {
      // Sort is now controlled via the Cols dropdown Sort section — this is a no-op kept for any residual references
    },
    []
  );

  /* ───── Cell renderer ───── */

  const renderCell = useCallback(
    (col: ColDef, value: unknown) => {
      if (value == null || value === "") {
        if (col.type === "note-fullscreen" || col.type === "notes" || col.type === "image-carousel" || col.type === "test-count") return <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>null</span>;
        return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
      }

      // ─── Template-aware rendering ───
      const entityType = TAB_ENTITY_MAP[subTab] || subTab;
      const tpl = getColumnTemplate(entityType, col.key);
      if (tpl) {
        // Array values (multi-fk, tags, etc.) — render each item with the template
        if (Array.isArray(value)) {
          if (value.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
          const items = (value as unknown[]).map((v) => {
            if (col.type === "multi-fk" && col.fkTable && typeof v === "number") return resolveFK(col.fkTable, v);
            if (typeof v === "object" && v && "name" in (v as Record<string, unknown>)) return (v as { name: string }).name;
            return String(v);
          });
          return (
            <span className="flex flex-wrap gap-1">
              {items.map((item, i) => <TemplateValue key={i} value={item} template={tpl} />)}
            </span>
          );
        }
        // Boolean values
        if (col.type === "boolean") {
          return <TemplateValue value={value ? "Yes" : "No"} template={tpl} />;
        }
        // FK values — resolve name first
        if (col.type === "fk" && col.fkTable) {
          return <TemplateValue value={resolveFK(col.fkTable, value)} template={tpl} />;
        }
        // Single value
        return <TemplateValue value={String(value)} template={tpl} />;
      }

      // ─── Default type-based rendering (no template assigned) ───
      switch (col.type) {
        case "boolean":
          return <BoolPill value={!!value} />;

        case "enum":
          if (col.key === "tier") {
            const tierColors: Record<string, string> = { "1": "#e05555", "2": "#f2b661", "3": "#4ecb71" };
            return (
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
                style={{ backgroundColor: `${tierColors[String(value)] || "#6c7bff"}22`, color: tierColors[String(value)] || "#6c7bff", border: `1px solid ${tierColors[String(value)] || "#6c7bff"}44` }}
              >
                {String(value)}
              </span>
            );
          }
          // Field status uses field-specific colors
          if (col.key === "fieldStatus") return <Pill value={`field:${String(value)}`} />;
          return <Pill value={String(value)} />;

        case "fk":
          if (!col.fkTable) return String(value);
          return <span style={{ color: "#5bc0de" }}>{resolveFK(col.fkTable, value)}</span>;

        case "multi-fk": {
          if (!Array.isArray(value) || value.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
          return (
            <span className="flex flex-wrap gap-1">
              {(value as number[]).map((id) => (
                <span key={id} className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)", color: "var(--color-text-muted)" }}>
                  {resolveFK(col.fkTable!, id)}
                </span>
              ))}
            </span>
          );
        }

        case "tags": {
          if (!Array.isArray(value) || value.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
          return (
            <span className="flex flex-wrap gap-1">
              {(value as string[]).map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded text-xs" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)" }}>
                  {t}
                </span>
              ))}
            </span>
          );
        }

        case "module-tags": {
          if (!Array.isArray(value) || value.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
          // Normalize: handle plain strings (legacy) and {name,tier} objects
          const mtags = (value as Array<unknown>).map((v) =>
            typeof v === "string" ? { name: v, tier: 2 } : (v as { name: string; tier: number })
          ).filter((t) => t && typeof t.name === "string");
          const sorted = [...mtags].sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name));
          return (
            <span className="flex flex-wrap gap-1">
              {sorted.map((t) => {
                const c = TAG_TIER_COLORS[t.tier] || TAG_TIER_COLORS[2];
                return (
                  <span key={`${t.tier}-${t.name}`} className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                    {t.tier === 1 && <span style={{ opacity: 0.6, marginRight: 2 }}>★</span>}{t.name}
                  </span>
                );
              })}
            </span>
          );
        }

        case "platforms": {
          const plats = Array.isArray(value) ? (value as string[]) : ["Web App"];
          return (
            <span className="flex flex-wrap gap-1">
              {plats.map((p) => {
                const c = PLATFORM_COLORS[p] || PLATFORM_COLORS["Other"];
                return (
                  <span key={p} className="px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                    {p}
                  </span>
                );
              })}
            </span>
          );
        }

        case "checklist": {
          if (!Array.isArray(value) || value.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
          const items = value as Array<{ item: string; checked: boolean }>;
          const done = items.filter((i) => i.checked).length;
          return <span className="text-xs">{done}/{items.length} checked</span>;
        }

        case "readonly": {
          const str = String(value);
          if (str.includes("T")) {
            try {
              return <span className="font-mono text-xs" style={{ color: "var(--color-text-muted)" }}>{new Date(str).toLocaleString()}</span>;
            } catch { /* fall through */ }
          }
          return <span style={{ color: "var(--color-text-muted)" }}>{str}</span>;
        }

        case "ref-features":
        case "ref-projects":
          // Handled specially in grid rendering — shouldn't reach here
          return <span style={{ color: "var(--color-text-muted)" }}>—</span>;

        case "module-rules":
          // Virtual column — handled in renderInlineCell
          return <span style={{ color: "var(--color-text-muted)" }}>—</span>;

        case "note-fullscreen":
        case "notes": {
          // Count badge reads from shared notes cache, falling back to legacy row value
          // (e.g., the original concepts.notes column before backfill is in cache).
          const noteStr = (() => {
            if (value != null && value !== "") return String(value);
            return null;
          })();
          if (!noteStr) return <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>null</span>;
          const lineCount = noteStr.split("\n").filter((l) => l.trim()).length;
          return <span style={{ color: "#5bc0de" }}>{lineCount} {lineCount === 1 ? "Line" : "Lines"}</span>;
        }

        case "image-carousel": {
          const imgs = Array.isArray(value) ? value : [];
          if (imgs.length === 0) return <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>null</span>;
          return <span style={{ color: "#4ecb71" }}>{imgs.length} {imgs.length === 1 ? "Image" : "Images"}</span>;
        }

        case "textarea": {
          const s = String(value);
          // Check for (t:ID) or (f:ID) references
          if (REF_REGEX.test(s)) {
            REF_REGEX.lastIndex = 0;
            return <RichRefText text={s.length > 80 ? s.slice(0, 80) + "..." : s} resolveTable={resolveTableName} resolveField={resolveFieldName} fieldTableId={fieldTableIdLookup} resolveModule={resolveModuleName} resolveFeature={resolveFeatureName} resolveConcept={resolveConceptName} resolveResearch={resolveResearchName} onRefClick={handleRefSummaryClick} />;
          }
          return s.length > 60 ? s.slice(0, 60) + "..." : s;
        }

        case "formula":
          // Formula columns are rendered via renderFormulaCell (needs full row context)
          // This fallback just shows the raw value if called without row context
          return <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>calc</span>;

        default: {
          const s = String(value);
          return s.length > 60 ? s.slice(0, 60) + "..." : s;
        }
      }
    },
    [resolveFK, resolveTableName, resolveFieldName, fieldTableIdLookup, subTab, getColumnTemplate]
  );

  /* ───── Inline edit helpers (all CRUD tabs) ───── */

  const inlineCommit = useCallback(
    (row: Record<string, unknown>, colKey: string, newValue: unknown) => {
      const tabCfg = TABLE_CONFIGS[subTab];
      if (!tabCfg) return;
      const updated = { ...row, [colKey]: newValue };
      applyLocalUpdate(subTab, updated, `Inline edit: ${colKey}`);
      setEditingCell(null);
    },
    [applyLocalUpdate, subTab]
  );

  // Auto-save while typing — saves without closing the editing cell
  const inlineAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inlineAutoSave = useCallback(
    (row: Record<string, unknown>, colKey: string, newValue: unknown) => {
      if (inlineAutoSaveTimer.current) clearTimeout(inlineAutoSaveTimer.current);
      inlineAutoSaveTimer.current = setTimeout(() => {
        inlineAutoSaveTimer.current = null;
        const tabCfg = TABLE_CONFIGS[subTab];
        if (!tabCfg) return;
        const updated = { ...row, [colKey]: newValue };
        applyLocalUpdate(subTab, updated, `Inline edit: ${colKey}`);
      }, 1200);
    },
    [applyLocalUpdate, subTab]
  );
  // Cleanup auto-save timer on unmount
  useEffect(() => { return () => { if (inlineAutoSaveTimer.current) clearTimeout(inlineAutoSaveTimer.current); }; }, []);

  const renderInlineCell = useCallback(
    (col: ColDef, row: Record<string, unknown>) => {
      const tabCfg = TABLE_CONFIGS[subTab];
      if (!tabCfg) return null;
      const rowId = row[tabCfg.idKey] as number;
      const value = row[col.key];
      const isEditing = editingCell?.rowId === rowId && editingCell?.colKey === col.key;

      // During FK pick mode, suppress inline editing — just show display values
      if (fkPickMode) return renderCell(col, value);

      // Module-rules virtual columns — show rule pills or "+ Add rules" button
      if (col.type === "module-rules") {
        const relMap: Record<string, string> = {
          "_operatedBy": "operated_by",
          "_receivesInputFrom": "receives_input_from",
          "_deliversOutputTo": "delivers_output_to",
        };
        const relationship = relMap[col.key];
        const moduleId = row.moduleId as number;
        const moduleName = String(row.moduleName ?? "");
        const rules = moduleRules.filter(
          (r) => r.entityType === "module" && r.entityId === moduleId && r.relationship === relationship
        );

        if (rules.length === 0) {
          return (
            <button
              onClick={(e) => { e.stopPropagation(); setRuleBuilderOpen({ moduleId, moduleName, relationship: relationship! }); }}
              className="text-xs hover:underline"
              style={{ color: "var(--color-text-muted)" }}
            >
              + Add rules
            </button>
          );
        }

        return (
          <button
            onClick={(e) => { e.stopPropagation(); setRuleBuilderOpen({ moduleId, moduleName, relationship: relationship! }); }}
            className="flex flex-wrap gap-1 text-left hover:opacity-80"
          >
            {rules.map((r) => (
              <span
                key={r.ruleId as number}
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  backgroundColor: "rgba(108,123,255,0.12)",
                  border: "1px solid rgba(108,123,255,0.3)",
                  color: "#6c7bff",
                }}
              >
                {String(r.sourceRefLabel || r.sourceTable)}
                {(r.conditions as unknown[])?.length > 0 && (
                  <span style={{ opacity: 0.6 }}> +{(r.conditions as unknown[]).length}</span>
                )}
              </span>
            ))}
          </button>
        );
      }

      // Field status uses field-specific colors (blue for live, green for planned)
      if (col.key === "fieldStatus" && col.type === "enum") {
        if (isEditing) {
          return (
            <span className="relative">
              <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
              <div className="absolute z-30 rounded-md border shadow-lg py-1" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 80, left: 0, top: "100%" }}>
                {(col.options || []).map((o) => (
                  <div key={o} className="px-3 py-1 cursor-pointer text-[11px]"
                    style={{ backgroundColor: String(value) === o ? "var(--color-surface)" : "transparent" }}
                    onMouseDown={(e) => { e.preventDefault(); inlineCommit(row, col.key, o); setEditingCell(null); }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = String(value) === o ? "var(--color-surface)" : "transparent"; }}
                  ><Pill value={`field:${o}`} /></div>
                ))}
              </div>
              <Pill value={`field:${String(value ?? "planned")}`} />
            </span>
          );
        }
        return (
          <span className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowId, colKey: col.key }); }}>
            <Pill value={`field:${String(value ?? "planned")}`} />
          </span>
        );
      }

      // Ref Table / Ref Field show N/A when FK is not true
      if ((col.key === "referencesTable" || col.key === "referencesField") && !row.isForeignKey) {
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>N/A</span>;
      }

      // Foreign Key boolean — two-state toggle (Yes green / No gray), no undecided
      if (col.key === "isForeignKey" && col.type === "boolean") {
        const fkVal = !!value;
        return (
          <span className="cursor-pointer" onClick={(e) => { e.stopPropagation(); inlineCommit(row, "isForeignKey", !fkVal); }}>
            {fkVal
              ? <BoolPill value={true} />
              : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>No</span>
            }
          </span>
        );
      }

      // Required / Unique — 3-option dropdown (Yes green / No gray / — undecided)
      if ((col.key === "isRequired" || col.key === "isUnique") && col.type === "boolean") {
        const boolDisplay = value === true
          ? <BoolPill value={true} />
          : value === false
          ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: "rgba(224,85,85,0.15)", color: "#e05555" }}>No</span>
          : <span style={{ color: "var(--color-text-muted)" }}>—</span>;
        if (isEditing) {
          const boolOpts: Array<{ value: true | false | null; label: string; color: string }> = [
            { value: true, label: "Yes", color: "#4ecb71" },
            { value: false, label: "No", color: "#e05555" },
            { value: null, label: "—", color: "var(--color-text-muted)" },
          ];
          return (
            <span className="relative">
              <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
              <div
                className="absolute z-30 rounded-md border shadow-lg py-1"
                style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 80, left: 0, top: "100%" }}
              >
                {boolOpts.map((opt) => (
                  <div
                    key={String(opt.value)}
                    className="flex items-center gap-2 px-3 py-1 cursor-pointer text-[11px]"
                    style={{ backgroundColor: value === opt.value ? "var(--color-surface)" : "transparent" }}
                    onMouseDown={(e) => { e.preventDefault(); inlineCommit(row, col.key, opt.value); setEditingCell(null); }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = value === opt.value ? "var(--color-surface)" : "transparent"; }}
                  >
                    <span className="font-medium" style={{ color: opt.color }}>{opt.label}</span>
                  </div>
                ))}
              </div>
              {boolDisplay}
            </span>
          );
        }
        return (
          <span className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowId, colKey: col.key }); }}>
            {boolDisplay}
          </span>
        );
      }

      // Data Type — two-column descriptive dropdown
      if (col.key === "dataType" && col.type === "enum") {
        if (isEditing) {
          return (
            <span className="relative">
              <div className="fixed inset-0 z-20" onMouseDown={() => setEditingCell(null)} />
              <div
                className="absolute z-30 rounded-md border shadow-lg py-1"
                style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 260, left: 0, top: "100%" }}
              >
                {DATA_TYPE_DESCRIPTIONS.map((dt) => (
                  <div
                    key={dt.value}
                    className="flex items-center gap-3 px-3 py-1.5 cursor-pointer text-[11px]"
                    style={{ backgroundColor: String(value) === dt.value ? "var(--color-surface)" : "transparent" }}
                    onMouseDown={(e) => { e.preventDefault(); inlineCommit(row, "dataType", dt.value); setEditingCell(null); }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-surface)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = String(value) === dt.value ? "var(--color-surface)" : "transparent"; }}
                  >
                    <span className="font-mono font-medium w-[70px] shrink-0" style={{ color: "var(--color-text)" }}>{dt.value}</span>
                    <span style={{ color: "var(--color-text-muted)" }}>{dt.desc}</span>
                  </div>
                ))}
              </div>
              <Pill value={String(value ?? "Text")} />
            </span>
          );
        }
        return (
          <span className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowId, colKey: col.key }); }}>
            <Pill value={String(value ?? "Text")} />
          </span>
        );
      }

      // Readonly columns are never editable
      if (col.type === "readonly") return renderCell(col, value);

      // Formula columns — evaluate expression against the full row, render read-only
      if (col.type === "formula" && col.formula) {
        const result = evaluateFormula(col.formula, row);
        if (result === "#ERR") {
          return <span className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: "rgba(224,85,85,0.12)", color: "#e05555" }}>#ERR</span>;
        }
        return <span style={{ color: "var(--color-text)" }}>{result || <span style={{ color: "var(--color-text-muted)" }}>—</span>}</span>;
      }

      // Module tags — inline popover editor (fixed position, stays open until backdrop click)
      if (col.type === "module-tags") {
        const currentTags = (Array.isArray(value) ? value : []) as Array<{ name: string; tier: number }>;
        if (isEditing) {
          return (
            <>
              <div className="fixed inset-0 z-[100]" onMouseDown={() => setEditingCell(null)} />
              <div
                ref={(el) => {
                  if (el && !el.dataset.positioned) {
                    const td = el.closest("td");
                    if (td) {
                      const rect = td.getBoundingClientRect();
                      el.style.position = "fixed";
                      el.style.top = `${rect.bottom + 4}px`;
                      el.style.right = `${window.innerWidth - rect.right}px`;
                      el.dataset.positioned = "1";
                    }
                  }
                }}
                className="z-[101] rounded-lg border shadow-xl p-3"
                style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 320, maxWidth: 400 }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <ModuleTagsEditor
                  tags={currentTags}
                  onChange={(newTags) => {
                    const updated = { ...row, [col.key]: newTags };
                    applyLocalUpdate(subTab, updated, `Inline edit: ${col.key}`);
                  }}
                />
              </div>
              {renderCell(col, value)}
            </>
          );
        }
        return (
          <span className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowId, colKey: col.key }); }}>
            {renderCell(col, value)}
          </span>
        );
      }

      // Freeform tags — inline popover editor (features, data tables)
      if (col.type === "tags") {
        const currentTags = (Array.isArray(value) ? value : []) as string[];
        if (isEditing) {
          return (
            <>
              <div className="fixed inset-0 z-[100]" onMouseDown={() => setEditingCell(null)} />
              <div
                ref={(el) => {
                  if (el && !el.dataset.positioned) {
                    const td = el.closest("td");
                    if (td) {
                      const rect = td.getBoundingClientRect();
                      el.style.position = "fixed";
                      el.style.top = `${rect.bottom + 4}px`;
                      el.style.right = `${window.innerWidth - rect.right}px`;
                      el.dataset.positioned = "1";
                    }
                  }
                }}
                className="z-[101] rounded-lg border shadow-xl p-3"
                style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 280, maxWidth: 380 }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <TagsInput
                  tags={currentTags}
                  onChange={(newTags) => {
                    const updated = { ...row, [col.key]: newTags };
                    applyLocalUpdate(subTab, updated, `Inline edit: ${col.key}`);
                  }}
                />
              </div>
              {renderCell(col, value)}
            </>
          );
        }
        return (
          <span className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingCell({ rowId, colKey: col.key }); }}>
            {renderCell(col, value)}
          </span>
        );
      }

      // Editing state
      if (isEditing) {
        switch (col.type) {
          case "text":
            return (
              <input
                autoFocus
                defaultValue={String(value ?? "")}
                onChange={(e) => inlineAutoSave(row, col.key, e.target.value || null)}
                onBlur={(e) => { if (inlineAutoSaveTimer.current) { clearTimeout(inlineAutoSaveTimer.current); inlineAutoSaveTimer.current = null; } inlineCommit(row, col.key, e.target.value || null); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }}
                className="w-full px-1.5 py-0.5 text-xs rounded border focus:outline-none focus:ring-1"
                style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
              />
            );
          case "textarea":
            return (
              <textarea
                autoFocus
                defaultValue={String(value ?? "")}
                onChange={(e) => inlineAutoSave(row, col.key, e.target.value || null)}
                onBlur={(e) => { if (inlineAutoSaveTimer.current) { clearTimeout(inlineAutoSaveTimer.current); inlineAutoSaveTimer.current = null; } inlineCommit(row, col.key, e.target.value || null); }}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === "Escape") setEditingCell(null); }}
                rows={3}
                className="w-full px-1.5 py-0.5 text-xs rounded border focus:outline-none focus:ring-1 resize-y"
                style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
              />
            );
          case "enum":
            return (
              <select
                autoFocus
                defaultValue={String(value ?? "")}
                onChange={(e) => inlineCommit(row, col.key, e.target.value || null)}
                onBlur={() => setEditingCell(null)}
                className="w-full px-1 py-0.5 text-xs rounded border focus:outline-none cursor-pointer"
                style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
              >
                <option value="">—</option>
                {(col.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            );
          case "int":
            return (
              <input
                autoFocus
                type="number"
                defaultValue={value != null ? String(value) : ""}
                onChange={(e) => inlineAutoSave(row, col.key, e.target.value ? parseInt(e.target.value) : null)}
                onBlur={(e) => { if (inlineAutoSaveTimer.current) { clearTimeout(inlineAutoSaveTimer.current); inlineAutoSaveTimer.current = null; } inlineCommit(row, col.key, e.target.value ? parseInt(e.target.value) : null); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingCell(null); }}
                className="w-full px-1.5 py-0.5 text-xs rounded border focus:outline-none focus:ring-1"
                style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", width: 80 }}
              />
            );
          case "boolean":
            return (
              <input
                type="checkbox"
                checked={!!value}
                onChange={(e) => inlineCommit(row, col.key, e.target.checked)}
                className="w-3.5 h-3.5"
                style={{ accentColor: "var(--color-primary)" }}
              />
            );
          case "fk":
            return (
              <select
                autoFocus
                defaultValue={String(value ?? "")}
                onChange={(e) => inlineCommit(row, col.key, e.target.value ? parseInt(e.target.value) : null)}
                onBlur={() => setEditingCell(null)}
                className="w-full px-1 py-0.5 text-xs rounded border focus:outline-none cursor-pointer"
                style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
              >
                <option value="">—</option>
                {getFKOptions(col.fkTable!).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            );
          default:
            // multi-fk, tags, module-tags, checklist — fall back to modal for complex types
            return renderCell(col, value);
        }
      }

      // Platforms: for modules, computed read-only from features; for other tabs, editable toggle pills
      if (col.type === "platforms") {
        if (subTab === "modules") {
          // Read-only: computed platforms + feature count header + add combo box
          const moduleId = row[TABLE_CONFIGS.modules.idKey] as number;
          const modPlat = computedModulePlatforms[moduleId] ?? { platforms: ["Web App"], counts: {} };
          const fCount = featureCountsByModule.get(moduleId) || 0;
          const isAddOpen = moduleQuickAddId === moduleId;
          return (
            <span className="flex flex-col gap-1.5 relative">
              {/* Header bar: feature count + add button in a bordered box */}
              <span
                className="flex items-center rounded border px-2 py-1 gap-1"
                style={{ borderColor: "var(--color-divider)", backgroundColor: "rgba(91,192,222,0.04)" }}
              >
                <span
                  className="text-[11px] font-semibold cursor-pointer hover:brightness-125 flex-1"
                  style={{ color: "var(--color-text)", textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1px" }}
                  onClick={(e) => { e.stopPropagation(); toggleModuleExpand(moduleId); }}
                >
                  <span style={{ color: "#5bc0de" }}>{fCount}</span> Feature{fCount !== 1 ? "s" : ""}
                </span>
                <span
                  className="w-5 h-5 flex items-center justify-center rounded border cursor-pointer hover:bg-black/10 transition-colors text-[13px] font-bold leading-none shrink-0"
                  style={{ color: "#4ecb71", borderColor: "#4ecb7155" }}
                  title="Add or attach feature"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isAddOpen) { setModuleQuickAddId(null); setModuleQuickAddName(""); }
                    else {
                      // Capture the td bounding rect for combo box positioning
                      const td = (e.currentTarget as HTMLElement).closest("td");
                      if (td) moduleQuickAddRect.current = td.getBoundingClientRect();
                      setModuleQuickAddId(moduleId); setModuleQuickAddName(""); if (expandedModuleId !== moduleId) toggleModuleExpand(moduleId);
                    }
                  }}
                >
                  +
                </span>
              </span>
              {/* Platform pills row */}
              <span className="flex flex-wrap gap-1">
                {PLATFORM_OPTIONS.map((p) => {
                  const count = modPlat.counts[p] || 0;
                  if (count === 0) return null;
                  const c = PLATFORM_COLORS[p];
                  return (
                    <span
                      key={p}
                      className="relative px-1.5 py-0.5 rounded text-[10px] font-medium cursor-default"
                      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                    >
                      {p}
                      <span
                        className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[9px] font-bold leading-none"
                        style={{ backgroundColor: c.text, color: "#fff" }}
                      >
                        {count}
                      </span>
                    </span>
                  );
                })}
              </span>
              {isAddOpen && (() => {
                const allFeatures = (data.features || []) as Record<string, unknown>[];
                const currentModFeatureIds = allFeatures.filter((f) => Array.isArray(f.modules) && (f.modules as number[]).includes(moduleId)).map((f) => f.featureId as number);
                const unattached = allFeatures.filter((f) => !currentModFeatureIds.includes(f.featureId as number));
                const q = moduleQuickAddName.toLowerCase().trim();
                const filtered = q ? unattached.filter((f) => String(f.featureName ?? "").toLowerCase().includes(q)) : unattached;
                const exactMatch = q && allFeatures.some((f) => String(f.featureName ?? "").toLowerCase() === q);
                return (
                  <>
                    <div className="fixed inset-0 z-[100]" onMouseDown={() => { setModuleQuickAddId(null); setModuleQuickAddName(""); }} />
                    <div className="fixed z-[101] rounded-lg border shadow-xl overflow-hidden" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", width: 1020, top: moduleQuickAddRect.current ? `${moduleQuickAddRect.current.bottom}px` : 0, left: moduleQuickAddRect.current ? `${moduleQuickAddRect.current.left}px` : 0 }}>
                      <div className="p-2 border-b" style={{ borderColor: "var(--color-divider)" }}>
                        <input
                          type="text"
                          autoFocus
                          value={moduleQuickAddName}
                          onChange={(e) => setModuleQuickAddName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && q && !exactMatch) {
                              applyLocalCreate("features", { featureName: moduleQuickAddName.trim(), modules: [moduleId], status: "Idea", priority: "N/A", platforms: ["Web App"] }, `Create feature "${moduleQuickAddName.trim()}" on module`);
                              setModuleQuickAddId(null); setModuleQuickAddName("");
                            }
                            if (e.key === "Escape") { setModuleQuickAddId(null); setModuleQuickAddName(""); }
                          }}
                          placeholder="Search or create feature…"
                          className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
                          style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                        />
                      </div>
                      {/* Column headers — Name, Status, Priority are sortable */}
                      <div className="flex items-center px-2 py-1 border-b text-[9px] font-bold uppercase tracking-wide select-none" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>
                        {([["featureName", "Name", "w-[180px]"], ["status", "Status", "w-[70px]"], ["priority", "Priority", "w-[70px]"]] as const).map(([key, label, w]) => (
                          <span
                            key={key}
                            className={`${w} shrink-0 px-1 cursor-pointer hover:brightness-150 transition-colors`}
                            style={{ color: comboSort.col === key ? "#5bc0de" : undefined }}
                            onMouseDown={(e) => { e.preventDefault(); setComboSort((prev) => prev.col === key ? { col: key, dir: prev.dir === "asc" ? "desc" : "asc" } : { col: key, dir: "asc" }); }}
                          >
                            {label} {comboSort.col === key ? (comboSort.dir === "asc" ? "▲" : "▼") : ""}
                          </span>
                        ))}
                        <span className="w-[200px] shrink-0 px-1">Description</span>
                        <span className="flex-1 px-1">Web App Notes</span>
                        <span className="w-[44px] shrink-0" />
                      </div>
                      <div className="max-h-[450px] overflow-y-auto">
                        {[...filtered].sort((a, b) => {
                          const av = String(a[comboSort.col] ?? "").toLowerCase();
                          const bv = String(b[comboSort.col] ?? "").toLowerCase();
                          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                          return comboSort.dir === "asc" ? cmp : -cmp;
                        }).slice(0, 30).map((f) => {
                          const statusColor = PILL_COLORS[String(f.status ?? "Idea")] || PILL_COLORS.Idea;
                          const priorityColor = PILL_COLORS[String(f.priority ?? "N/A")] || PILL_COLORS.Low;
                          const notes = String(f.notes ?? "").slice(0, 150);
                          return (
                            <div
                              key={f.featureId as number}
                              className="flex items-start px-2 py-1.5 text-xs cursor-pointer hover:bg-white/5 border-b"
                              style={{ borderColor: "var(--color-divider)" }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                const existingMods = Array.isArray(f.modules) ? (f.modules as number[]) : [];
                                applyLocalUpdate("features", { ...f, modules: [...existingMods, moduleId] }, `Attached feature "${f.featureName}" to module`);
                                setModuleQuickAddId(null); setModuleQuickAddName("");
                              }}
                            >
                              <span className="w-[180px] shrink-0 px-1 truncate font-medium pt-0.5" style={{ color: "#5bc0de" }}>{String(f.featureName ?? "")}</span>
                              <span className="w-[70px] shrink-0 px-1 pt-0.5"><span className="px-1.5 py-0 rounded-full text-[10px]" style={{ backgroundColor: statusColor.bg, color: statusColor.text, border: `1px solid ${statusColor.border}` }}>{String(f.status ?? "Idea")}</span></span>
                              <span className="w-[70px] shrink-0 px-1 pt-0.5"><span className="px-1.5 py-0 rounded-full text-[10px]" style={{ backgroundColor: priorityColor.bg, color: priorityColor.text, border: `1px solid ${priorityColor.border}` }}>{String(f.priority ?? "N/A")}</span></span>
                              <div className="w-[200px] shrink-0 px-1 text-[10px]" style={{ color: "var(--color-text-muted)", whiteSpace: "normal", wordBreak: "break-word", lineHeight: "1.4", maxHeight: "4.8em", overflow: "hidden" }}>{String(f.description ?? "—")}</div>
                              <div className="flex-1 min-w-0 px-1 text-[10px]" style={{ color: "var(--color-text-muted)", whiteSpace: "normal", wordBreak: "break-word", lineHeight: "1.4", maxHeight: "4.8em", overflow: "hidden" }}>{notes || "—"}</div>
                              <span className="w-[44px] shrink-0 text-[9px] text-right font-medium pt-0.5" style={{ color: "#4ecb71" }}>attach</span>
                            </div>
                          );
                        })}
                        {filtered.length === 0 && !q && <div className="px-3 py-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>All features already attached</div>}
                        {q && !exactMatch && (
                          <div
                            className="px-3 py-1.5 text-xs cursor-pointer hover:bg-white/5 border-t flex items-center gap-1"
                            style={{ borderColor: "var(--color-divider)", color: "#4ecb71" }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applyLocalCreate("features", { featureName: moduleQuickAddName.trim(), modules: [moduleId], status: "Idea", priority: "N/A", platforms: ["Web App"] }, `Create feature "${moduleQuickAddName.trim()}" on module`);
                              setModuleQuickAddId(null); setModuleQuickAddName("");
                            }}
                          >
                            <span className="font-bold">+</span> Create &ldquo;{moduleQuickAddName.trim()}&rdquo;
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </span>
          );
        }
        const plats = Array.isArray(value) ? (value as string[]) : ["Web App"];
        return (
          <span className="flex flex-wrap gap-1">
            {PLATFORM_OPTIONS.map((p) => {
              const active = plats.includes(p);
              const isPermanent = p === "Web App";
              const c = PLATFORM_COLORS[p];
              return (
                <button
                  key={p}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isPermanent) return;
                    const next = active ? plats.filter((x) => x !== p) : [...plats, p];
                    inlineCommit(row, col.key, next);
                  }}
                  className={`px-1.5 py-0.5 rounded text-xs font-medium transition-all ${isPermanent ? "cursor-default" : "cursor-pointer hover:opacity-80"}`}
                  style={{
                    backgroundColor: active ? c.bg : "transparent",
                    color: active ? c.text : "var(--color-text-muted)",
                    border: `1px solid ${active ? c.border : "var(--color-divider)"}`,
                    opacity: active ? 1 : 0.5,
                  }}
                  title={isPermanent ? "Web App is always enabled" : `Toggle ${p}`}
                >
                  {p}
                </button>
              );
            })}
          </span>
        );
      }

      // Note fullscreen — clickable cell that opens fullscreen note editor.
      // Both legacy "note-fullscreen" type and new generic "notes" type route here.
      if (col.type === "note-fullscreen" || col.type === "notes") {
        const tabCfg = TABLE_CONFIGS[subTab];
        const eid = tabCfg?.idKey ? (row[tabCfg.idKey] as number) : 0;
        const entityType = tabCfg?.entityType || subTab;
        // Prefer cache (shared store), fall back to row value (legacy concepts.notes during transition)
        const cached = entityNotesCache[noteCacheKey(entityType, eid, col.key)];
        const displayValue = cached?.content ?? value;
        return (
          <span
            className="cursor-pointer hover:bg-black/5 rounded px-0.5 -mx-0.5 block min-h-[1.2em]"
            onClick={(e) => { e.stopPropagation(); setFullscreenNote({ row, tabKey: subTab, noteKey: col.key }); }}
            title="Click to open notes"
          >
            {renderCell(col, displayValue)}
          </span>
        );
      }

      // Image carousel — clickable cell that opens image carousel modal
      if (col.type === "image-carousel") {
        return (
          <span
            className="cursor-pointer hover:bg-black/5 rounded px-0.5 -mx-0.5 block min-h-[1.2em]"
            onClick={(e) => { e.stopPropagation(); setCarouselState({ row, tabKey: subTab }); }}
            title="Click to view images"
          >
            {renderCell(col, value)}
          </span>
        );
      }

      // Test count — clickable badge that opens test cases popup
      if (col.type === "test-count") {
        const tabCfg = TABLE_CONFIGS[subTab];
        const eid = tabCfg?.idKey ? (row[tabCfg.idKey] as number) : 0;
        const entityType = (tabCfg?.entityType ?? "feature") as "feature" | "concept" | "module";
        const tc = (entityTestCounts[subTab] ?? {})[eid];
        const count = tc?.count ?? 0;
        const entityUpdated = String(row.updatedAt ?? "");
        const latestTestUpdated = tc?.latestUpdatedAt;
        const isStale = count > 0 && latestTestUpdated !== null && entityUpdated > latestTestUpdated;
        const testsDismissedAt = (row.testsDismissedAt as string | null) ?? null;
        const isDismissed = isStale && testsDismissedAt !== null && testsDismissedAt >= entityUpdated;
        return (
          <span
            className="cursor-pointer hover:bg-black/5 rounded px-0.5 -mx-0.5 block min-h-[1.2em] flex items-center gap-1"
            onClick={(e) => {
              e.stopPropagation();
              setTestPopupState({ row, entityType, tabKey: subTab, idKey: tabCfg?.idKey ?? "", nameKey: tabCfg?.nameKey ?? "" });
            }}
            title="Click to view test cases"
          >
            {count === 0 ? (
              <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>null</span>
            ) : (
              <>
                <span style={{ color: "#6c7bff" }}>{count} {count === 1 ? "Test" : "Tests"}</span>
                {isStale && !isDismissed && <span title="Tests may be outdated" style={{ color: "#f2b661", fontSize: 10 }}>●</span>}
              </>
            )}
          </span>
        );
      }

      // Display state — clickable (except complex types that need the modal)
      const isComplexType = col.type === "multi-fk" || col.type === "tags" || col.type === "checklist";
      if (isComplexType) return renderCell(col, value);

      if (tablePickerOpen) return renderCell(col, value);
      return (
        <span
          className="cursor-pointer hover:bg-black/5 rounded px-0.5 -mx-0.5 block min-h-[1.2em]"
          onClick={(e) => { e.stopPropagation(); setEditingCell({ rowId, colKey: col.key }); }}
          title="Click to edit"
        >
          {renderCell(col, value)}
        </span>
      );
    },
    [editingCell, renderCell, inlineCommit, getFKOptions, subTab, moduleRules, tablePickerOpen, fkPickMode, computedModulePlatforms, featureCountsByModule, moduleQuickAddId, moduleQuickAddName, toggleModuleExpand, expandedModuleId, data.features, applyLocalCreate, applyLocalUpdate, comboSort, entityTestCounts]
  );

  /* ═══════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════ */

  const isSpecialTab = subTab === "access_matrix" || subTab === "prototypes" || subTab === "projects";
  const isTabLoading = tabLoading === subTab || (!isSpecialTab && !loadedTabs.has(subTab));
  // On Data Tables tab, include data_fields pending changes too
  const activeTabHasPending = (pendingRef.current[subTab] || []).length > 0
    || (subTab === "data_tables" && (pendingRef.current["data_fields"] || []).length > 0)
    || (subTab === "modules" && (pendingRef.current["features"] || []).length > 0)
    || (draftDirty && !liveMode);

  const hasAnyDirtyTab = dirtyTabs.size > 0;
  const hasAnyUnsaved = hasAnyDirtyTab || hasPendingPrefs || (draftDirty && !liveMode);

  // Ref so the beforeunload handler (which can't reliably read React state) can see the latest value
  const hasAnyUnsavedRef = useRef(false);
  useEffect(() => { hasAnyUnsavedRef.current = hasAnyUnsaved; }, [hasAnyUnsaved]);

  // Keep activeTabHasPendingRef in sync so setSubTab (defined earlier) can read it
  useEffect(() => { activeTabHasPendingRef.current = activeTabHasPending; }, [activeTabHasPending]);

  const cfg = TABLE_CONFIGS[subTab] || TABLE_CONFIGS.modules; // fallback for special tabs
  const allGridColsUnordered = cfg.columns.filter((c) => !c.hideInGrid && !permHiddenSet.has(`${subTab}:${c.key}`));
  // Apply saved column order if it exists for this tab
  const savedOrder = colOrder[subTab];
  const allGridCols = savedOrder
    ? [...allGridColsUnordered].sort((a, b) => {
        const ai = savedOrder.indexOf(a.key);
        const bi = savedOrder.indexOf(b.key);
        // Columns not in saved order go to the end
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
    : allGridColsUnordered;
  const gridCols = allGridCols.filter((c) => isColVisible(subTab, c.key));

  // Build mixed column+separator order for View panel and table rendering
  const mixedColOrder: Array<{ type: "col"; col: ColDef } | { type: "sep"; sep: ColumnSeparator }> = useMemo(() => {
    const order = colOrder[subTab];
    if (!order) {
      // No saved order — just columns, no separators
      return allGridCols.map((c) => ({ type: "col" as const, col: c }));
    }
    const colMap = new Map(allGridColsUnordered.map((c) => [c.key, c]));
    const items: Array<{ type: "col"; col: ColDef } | { type: "sep"; sep: ColumnSeparator }> = [];
    const seen = new Set<string>();
    for (const key of order) {
      if (key.startsWith("sep_")) {
        const sep = colSeparators[key];
        if (sep) { items.push({ type: "sep", sep }); seen.add(key); }
      } else {
        const col = colMap.get(key);
        if (col) { items.push({ type: "col", col }); seen.add(key); }
      }
    }
    // Append any columns not in saved order
    for (const col of allGridColsUnordered) {
      if (!seen.has(col.key)) items.push({ type: "col", col });
    }
    return items;
  }, [colOrder, subTab, allGridCols, allGridColsUnordered, colSeparators]);

  // Visible mixed items for table rendering (filters out hidden columns but keeps separators)
  const visibleMixedCols = useMemo(() => {
    return mixedColOrder.filter((item) => item.type === "sep" || isColVisible(subTab, item.col.key));
  }, [mixedColOrder, isColVisible, subTab]);

  return (
    <div className="space-y-4">
      {/* FK pick mode — mouse-following label */}
      {fkPickMode && (
        <div
          ref={fkPickLabelRef}
          className="fixed z-50 pointer-events-none px-3 py-1.5 rounded-md shadow-lg text-xs font-medium"
          style={{ backgroundColor: "var(--color-primary)", color: "var(--color-primary-text)", whiteSpace: "nowrap", top: 0, left: 0 }}
        >
          Select a foreign key table or field for <span className="font-mono">{fkPickMode.fieldName}</span>
          <span className="ml-2 opacity-60">(Esc to cancel)</span>
        </div>
      )}
      {/* ─── Refresh + Save button (sub-tab bar removed — tabs live in sidebar popover) ─── */}
      {!tablePickerOpen && <div className="flex items-center justify-end gap-2">
          {/* Refresh button */}
          <button
            onClick={refreshActiveTab}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
            style={{
              backgroundColor: "var(--color-surface)",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-divider)",
            }}
            title="Refresh current tab from server"
          >
            <svg className={`w-3.5 h-3.5 ${tabLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0113.29-3.29L20 9M20 15a8 8 0 01-13.29 3.29L4 15" />
            </svg>
            Refresh
          </button>

          {/* Auto-save status indicator — clickable to flush pending saves */}
          <button
            onClick={() => { if (inlineAutoSaveTimer.current) { clearTimeout(inlineAutoSaveTimer.current); inlineAutoSaveTimer.current = null; } flushLiveTimers(); }}
            className="px-3 py-1.5 text-xs rounded-md font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all cursor-pointer hover:brightness-110"
            style={{
              backgroundColor: liveStatus === "failed" ? "rgba(224,85,85,0.15)" : liveStatus === "saving" ? "rgba(78,203,113,0.10)" : liveStatus === "saved" ? "rgba(78,203,113,0.20)" : "rgba(78,203,113,0.12)",
              color: liveStatus === "failed" ? "#e05555" : "#4ecb71",
              border: liveStatus === "failed" ? "1px solid rgba(224,85,85,0.4)" : "1px solid rgba(78,203,113,0.35)",
            }}
            title="Click to save all pending changes now"
          >
            <span className="relative flex h-2 w-2">
              {liveStatus === "saving" && <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ backgroundColor: "#4ecb71" }} />}
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: liveStatus === "failed" ? "#e05555" : "#4ecb71" }} />
            </span>
            {liveStatus === "saving" ? "Saving..."
              : liveStatus === "saved" ? "Saved"
              : liveStatus === "failed" ? "Failed"
              : "Auto-save"}
          </button>
      </div>}

      {/* ═══════ ACCESS MATRIX VIEW ═══════ */}
      {subTab === "access_matrix" && (
        <AccessMatrixView
          matrixData={matrixData}
          matrixLoading={matrixLoading}
          bizFilter={matrixBizFilter}
          tierFilter={matrixTierFilter}
          swimFilter={matrixSwimFilter}
          onBizFilter={setMatrixBizFilter}
          onTierFilter={setMatrixTierFilter}
          onSwimFilter={setMatrixSwimFilter}
          onNavigateToRule={(tableId) => {
            setSubTab("data_access_rules");
            setSearch(String(tableId));
          }}
        />
      )}

      {/* ═══════ PROTOTYPES TAB VIEW ═══════ */}
      {subTab === "prototypes" && (
        <div className="mt-4">
          <h3 className="text-base font-semibold mb-3" style={{ color: "var(--color-text)" }}>All Prototypes</h3>
          <PrototypesGrid allFeatures={(data.features || []).map(f => ({ featureId: f.featureId as number, featureName: String(f.featureName ?? "") }))} />
        </div>
      )}

      {/* ═══════ PROJECTS TAB VIEW ═══════ */}
      {subTab === "projects" && (
        <div className="mt-4">
          <ProjectsGrid
            allModules={(data.modules || []).map(m => ({ moduleId: m.moduleId as number, moduleName: String(m.moduleName ?? "") }))}
            allFeatures={(data.features || []).map(f => ({ featureId: f.featureId as number, featureName: String(f.featureName ?? "") }))}
            allConcepts={(data.concepts || []).map(c => ({ conceptId: c.conceptId as number, conceptName: String(c.conceptName ?? "") }))}
            allDataTables={(data.data_tables || []).map(t => ({ tableId: t.tableId as number, tableName: String(t.tableName ?? "") }))}
            allDataFields={(data.data_fields || []).map(f => ({ fieldId: f.fieldId as number, fieldName: String(f.fieldName ?? ""), dataTableId: f.dataTableId as number }))}
          />
        </div>
      )}

      {/* ─── Loading spinner for lazy tab ─── */}
      {isTabLoading && subTab !== "access_matrix" && subTab !== "prototypes" && subTab !== "projects" && (
        <div className="flex justify-center py-12">
          <svg className="w-6 h-6 animate-spin" style={{ color: "var(--color-primary)" }} fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}

      {/* ─── Table Picker Banner ─── */}
      {tablePickerOpen && (() => {
        const nf = inlineNewField;
        const hasTable = nf && nf.tableId > 0;
        const selectedTableName = hasTable ? String(((data.data_tables || []).find((t) => (t as Record<string, unknown>).tableId === nf.tableId) as Record<string, unknown>)?.tableName ?? "?") : "";
        const nameErr = nf ? validateFieldName(nf.fieldName) : null;
        const existingFields = hasTable ? (data.data_fields || []).filter((f) => (f as Record<string, unknown>).dataTableId === nf.tableId) : [];
        const isDup = hasTable && !nameErr && existingFields.some((f) => String((f as Record<string, unknown>).fieldName) === nf?.fieldName);
        const canCreate = hasTable && !nameErr && !isDup && nf!.fieldName.length >= 2 && nf!.dataType !== "" && (!nf!.isForeignKey || nf!.referencesTable !== null);
        const allTableNames = (data.data_tables || []).map((t) => String((t as Record<string, unknown>).tableName));
        const allFieldNames = (data.data_fields || []).map((f) => String((f as Record<string, unknown>).fieldName));
        const similarTables = nf?.fieldName ? findSimilarNames(nf.fieldName, allTableNames, 7) : [];
        const similarFields = nf?.fieldName ? findSimilarNames(nf.fieldName, allFieldNames, 7) : [];

        return (
          <div className="rounded-lg border mb-3 overflow-hidden" style={{ borderColor: "#5bc0de" }}>
            <div className="flex items-start px-4 py-3 gap-4" style={{ backgroundColor: "rgba(91,192,222,0.08)" }}>
              {/* Zone 1: Field input + badge */}
              <div className="flex-shrink-0">
                <div className="text-[10px] mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                  {hasTable
                    ? <>Adding field to <span className="font-semibold" style={{ color: "#a855f7" }}>{selectedTableName}</span></>
                    : "Select a table below to add a new field"
                  }
                </div>
                {hasTable ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={nf!.fieldName}
                      placeholder="field_name"
                      className="px-2.5 py-1.5 text-xs rounded border font-mono w-[200px] focus:outline-none focus:ring-1"
                      style={{
                        borderColor: nameErr || isDup ? "#e05555" : "#5bc0de",
                        backgroundColor: "var(--color-background)",
                        color: "var(--color-text)",
                        boxShadow: "0 0 0 1px " + (nameErr || isDup ? "rgba(224,85,85,0.2)" : "rgba(91,192,222,0.2)"),
                      }}
                      onChange={(e) => setInlineNewField((prev) => prev ? { ...prev, fieldName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") } : null)}
                      autoFocus
                    />
                    {nf!.fieldName.length >= 2 && !nameErr && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap" style={{
                        backgroundColor: isDup ? "rgba(224,85,85,0.12)" : "rgba(78,203,113,0.12)",
                        color: isDup ? "#e05555" : "#4ecb71",
                      }}>
                        {isDup ? "Not unique" : "Unique"}
                      </span>
                    )}
                    {nameErr && nf!.fieldName.length > 0 && (
                      <span className="text-[10px] whitespace-nowrap" style={{ color: "#e05555" }}>{nameErr}</span>
                    )}
                  </div>
                ) : (
                  <div className="text-sm font-semibold" style={{ color: "#5bc0de" }}>
                    Click a table row to select it, or expand to browse fields
                  </div>
                )}
              </div>

              {/* Zone 2: Similar names inline */}
              {nf && nf.fieldName.length >= 2 && (similarTables.length > 0 || similarFields.length > 0) && (
                <div className="flex gap-4 flex-1 min-w-0">
                  {similarTables.length > 0 && (
                    <div className="flex-shrink-0" style={{ marginRight: 15 }}>
                      <div className="text-[9px] font-semibold mb-0.5 uppercase tracking-wider" style={{ color: "#a855f7" }}>Tables ({similarTables.length})</div>
                      {similarTables.map((n) => (
                        <div key={n} className="text-[10px] font-mono leading-tight" style={{ color: "var(--color-text-muted)" }}>{n}</div>
                      ))}
                    </div>
                  )}
                  {similarFields.length > 0 && (
                    <div className="flex-shrink-0">
                      <div className="text-[9px] font-semibold mb-0.5 uppercase tracking-wider" style={{ color: "#5bc0de" }}>Fields ({similarFields.length})</div>
                      {similarFields.map((n) => (
                        <div key={n} className="text-[10px] font-mono leading-tight" style={{ color: "var(--color-text-muted)" }}>{n}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Zone 3: Action buttons (anchored right) */}
              <div className="flex items-start gap-2 flex-shrink-0 ml-auto">
                <button
                  className="px-3 py-1.5 text-xs rounded border font-medium whitespace-nowrap"
                  style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}
                  onClick={() => {
                    setInlineNewField(null);
                    setTablePickerOpen(false);
                    setTablePickerCallback(null);
                    if (savedSubTabRef.current) { setSubTab(savedSubTabRef.current); savedSubTabRef.current = null; }
                  }}
                >
                  Cancel
                </button>
                {hasTable && (
                  <button
                    className="px-4 py-1.5 text-xs rounded font-semibold whitespace-nowrap"
                    style={{ backgroundColor: canCreate ? "#4ecb71" : "var(--color-divider)", color: canCreate ? "#000" : "var(--color-text-muted)" }}
                    disabled={!canCreate}
                    onClick={async () => {
                      if (!nf || !canCreate) return;
                      try {
                        const res = await fetch("/api/schema-planner?table=_splan_data_fields", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ table: "_splan_data_fields", data: { fieldName: nf.fieldName, dataTableId: nf.tableId, fieldStatus: "planned", dataType: nf.dataType, isRequired: nf.isRequired, isUnique: nf.isUnique, isForeignKey: nf.isForeignKey, ...(nf.isForeignKey && nf.referencesTable ? { referencesTable: nf.referencesTable } : {}), ...(nf.isForeignKey && nf.referencesField ? { referencesField: nf.referencesField } : {}) }, reasoning: `Created planned field "${nf.fieldName}" (${nf.dataType}) from feature notes` }),
                        });
                        if (res.ok) {
                          const created = await res.json();
                          setData((prev) => ({ ...prev, data_fields: [...(prev.data_fields || []), created] }));
                          const ref = `(f:${created.fieldId}:${selectedTableName}.${nf.fieldName})`;
                          const currentNotes = String(nf.featureRow[nf.noteKey] ?? "");
                          const updatedNotes = currentNotes ? currentNotes + "\n" + ref : ref;
                          const updated = { ...nf.featureRow, [nf.noteKey]: updatedNotes };
                          applyLocalUpdate("features", updated, `Added planned field reference: ${selectedTableName}.${nf.fieldName}`);
                          setTableFieldsCache((prev) => ({ ...prev, [nf.tableId]: [...(prev[nf.tableId] || []), created] }));
                        }
                      } catch { /* silently fail */ }
                      setInlineNewField(null);
                      setTablePickerOpen(false);
                      if (savedSubTabRef.current) { setSubTab(savedSubTabRef.current); savedSubTabRef.current = null; }
                    }}
                  >
                    Create
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Toolbar + Grid (CRUD tabs only) ─── */}
      {!isSpecialTab && !isTabLoading && <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>{cfg.label}</h3>
          {/* Status filter for data_tables and data_fields */}
          {hasStatusFilter && (
            <div className="flex gap-1">
              {(["all", "live", "planned"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setStatusFilter(v)}
                  className="px-2.5 py-1 text-[11px] rounded-full font-medium transition-colors"
                  style={{
                    backgroundColor: statusFilter === v
                      ? (v === "live" ? "rgba(78,203,113,0.2)" : v === "planned" ? "rgba(168,85,247,0.2)" : "var(--color-primary)")
                      : "var(--color-surface)",
                    color: statusFilter === v
                      ? (v === "live" ? "#4ecb71" : v === "planned" ? "#a855f7" : "var(--color-primary-text)")
                      : "var(--color-text-muted)",
                    border: statusFilter === v ? "none" : "1px solid var(--color-divider)",
                  }}
                >
                  {v === "all" ? "All" : v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          )}
          {/* Tag filter for data_tables */}
          {hasTagFilter && availableTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="px-2 py-1 text-[11px] rounded-md border focus:outline-none"
              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            >
              <option value="all">All Tags</option>
              {availableTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
          {/* Search mode for data_tables */}
          {subTab === "data_tables" && (
            <div className="flex gap-0.5 border rounded-md overflow-hidden" style={{ borderColor: "var(--color-divider)" }}>
              {(["tables", "fields", "examples"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => { setDataTableSearchMode(mode); setSearch(""); }}
                  className="px-2 py-1 text-[10px] font-medium transition-colors"
                  style={{
                    backgroundColor: dataTableSearchMode === mode ? "var(--color-primary)" : "var(--color-surface)",
                    color: dataTableSearchMode === mode ? "var(--color-primary-text)" : "var(--color-text-muted)",
                  }}
                >
                  {mode === "tables" ? "Tables" : mode === "fields" ? "Fields" : "Examples"}
                </button>
              ))}
            </div>
          )}
          {/* Module filter for features */}
          {subTab === "features" && (data.modules || []).length > 0 && (
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="px-2 py-1 text-[11px] rounded-md border focus:outline-none"
              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            >
              <option value="all">All Modules</option>
              {(data.modules || []).map((m) => (
                <option key={String(m.moduleId)} value={String(m.moduleId)}>{String(m.moduleName)}</option>
              ))}
            </select>
          )}
          {/* Rows per page */}
          <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="px-1.5 py-0.5 rounded border focus:outline-none text-[11px]"
              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n === 0 ? "All" : n}</option>
              ))}
            </select>
            <span>of {totalRows}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={subTab === "data_tables" ? `Search ${dataTableSearchMode}...` : `Search ${cfg.label.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-md border focus:outline-none focus:ring-1"
            style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", width: 200 }}
          />
          {/* ─── Combined View Settings button (Grouping + Columns + Sort) ─── */}
          {!tablePickerOpen && <div className="relative" ref={groupPopoverRef}>
            <button
              onClick={() => { setGroupPopoverOpen((v) => !v); setColDropdownOpen(false); }}
              className="relative px-2.5 py-1.5 text-xs rounded-md border font-medium flex items-center gap-1"
              style={{
                borderColor: activeGrouping ? "var(--color-primary)" : "var(--color-divider)",
                backgroundColor: activeGrouping ? "rgba(var(--color-primary-rgb, 66,139,202), 0.15)" : groupPopoverOpen ? "var(--color-primary)" : "var(--color-surface)",
                color: activeGrouping ? "var(--color-primary)" : groupPopoverOpen ? "var(--color-primary-text)" : "var(--color-text-muted)",
              }}
              title="View settings: grouping, sorting, columns"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h6" />
              </svg>
              View
              {(() => {
                const groupCount = activeGrouping ? activeGrouping.rules.length + (activeGrouping.autoGroup ? 1 : 0) : 0;
                const hiddenCount = [...hiddenCols].filter((k) => k.startsWith(subTab + ":")).length;
                const total = groupCount + hiddenCount + (sortConfig.primary ? 1 : 0);
                return total > 0 ? (
                  <span className="ml-0.5 px-1 py-0 rounded text-[9px] font-bold" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-primary-text)" }}>{total}</span>
                ) : null;
              })()}
            </button>
            {groupPopoverOpen && (() => {
              const tabCfg2 = TABLE_CONFIGS[subTab];
              if (!tabCfg2) return null;
              const groupableCols = tabCfg2.columns.filter((c) => c.type !== "separator");
              const draft: GroupingConfig = activeGrouping || { rules: [], ungroupedLabel: "Other" };
              const updateDraft = (config: GroupingConfig) => setGroupingForTab(subTab, config);
              const addRule = () => {
                const newRule: GroupingRule = { groupName: `Group ${draft.rules.length + 1}`, logic: "AND", conditions: [{ column: groupableCols[0]?.key || "", operator: "equals" as GroupingOperator, value: "" }] };
                updateDraft({ ...draft, rules: [...draft.rules, newRule] });
              };
              const removeRule = (ri: number) => {
                const next = draft.rules.filter((_, idx) => idx !== ri);
                if (next.length === 0 && !draft.autoGroup) { setGroupingForTab(subTab, null); return; }
                updateDraft({ ...draft, rules: next });
              };
              const updateRule = (ri: number, patch: Partial<GroupingRule>) => {
                const next = draft.rules.map((r, idx) => idx === ri ? { ...r, ...patch } : r);
                updateDraft({ ...draft, rules: next });
              };
              const moveRule = (ri: number, dir: "up" | "down") => {
                const ni = dir === "up" ? ri - 1 : ri + 1;
                if (ni < 0 || ni >= draft.rules.length) return;
                const next = [...draft.rules]; [next[ri], next[ni]] = [next[ni], next[ri]];
                updateDraft({ ...draft, rules: next });
              };
              const addCondition = (ri: number) => {
                const rule = draft.rules[ri];
                if (rule.conditions.length >= 7) return;
                const newCond: GroupingCondition = { column: groupableCols[0]?.key || "", operator: "equals" as GroupingOperator, value: "" };
                updateRule(ri, { conditions: [...rule.conditions, newCond] });
              };
              const removeCondition = (ri: number, ci: number) => {
                const rule = draft.rules[ri];
                const next = rule.conditions.filter((_, idx) => idx !== ci);
                if (next.length === 0) { removeRule(ri); return; }
                updateRule(ri, { conditions: next });
              };
              const updateCondition = (ri: number, ci: number, patch: Partial<GroupingCondition>) => {
                const rule = draft.rules[ri];
                const next = rule.conditions.map((c, idx) => idx === ci ? { ...c, ...patch } : c);
                updateRule(ri, { conditions: next });
              };
              // Sub-rule helpers (for per-rule sub-grouping)
              const addSubRule = (ri: number) => {
                const rule = draft.rules[ri];
                const subRules = rule.subRules || [];
                const newSub: GroupingRule = { groupName: `Sub ${subRules.length + 1}`, logic: "AND", conditions: [{ column: groupableCols[0]?.key || "", operator: "equals" as GroupingOperator, value: "" }] };
                updateRule(ri, { subRules: [...subRules, newSub] });
              };
              const removeSubRule = (ri: number, si: number) => {
                const rule = draft.rules[ri];
                const next = (rule.subRules || []).filter((_, idx) => idx !== si);
                updateRule(ri, { subRules: next.length > 0 ? next : undefined, subUngroupedLabel: next.length > 0 ? rule.subUngroupedLabel : undefined, subSort: next.length > 0 ? rule.subSort : undefined });
              };
              const updateSubRule = (ri: number, si: number, patch: Partial<GroupingRule>) => {
                const rule = draft.rules[ri];
                const next = (rule.subRules || []).map((r, idx) => idx === si ? { ...r, ...patch } : r);
                updateRule(ri, { subRules: next });
              };
              const addSubCondition = (ri: number, si: number) => {
                const sub = (draft.rules[ri].subRules || [])[si];
                if (!sub || sub.conditions.length >= 7) return;
                const newCond: GroupingCondition = { column: groupableCols[0]?.key || "", operator: "equals" as GroupingOperator, value: "" };
                updateSubRule(ri, si, { conditions: [...sub.conditions, newCond] });
              };
              const removeSubCondition = (ri: number, si: number, ci: number) => {
                const sub = (draft.rules[ri].subRules || [])[si];
                if (!sub) return;
                const next = sub.conditions.filter((_, idx) => idx !== ci);
                if (next.length === 0) { removeSubRule(ri, si); return; }
                updateSubRule(ri, si, { conditions: next });
              };
              const updateSubCondition = (ri: number, si: number, ci: number, patch: Partial<GroupingCondition>) => {
                const sub = (draft.rules[ri].subRules || [])[si];
                if (!sub) return;
                const next = sub.conditions.map((c, idx) => idx === ci ? { ...c, ...patch } : c);
                updateSubRule(ri, si, { conditions: next });
              };

              const orderedFeatCols = moduleFeatureColOrder.map((k) => MODULE_FEATURE_COLS.find((c) => c.key === k)).filter(Boolean) as typeof MODULE_FEATURE_COLS[number][];
              // Include any cols not yet in the order
              MODULE_FEATURE_COLS.forEach((c) => { if (!orderedFeatCols.find((o) => o.key === c.key)) orderedFeatCols.push(c); });

              return (
                <div className="absolute top-full right-0 mt-1 rounded-lg border shadow-xl z-30 flex" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", maxHeight: "75vh" }}>
                  {/* LEFT COLUMN: Grouping */}
                  <div className="w-[420px] border-r overflow-y-auto" style={{ borderColor: "var(--color-divider)", backgroundColor: "rgba(var(--color-primary-rgb, 66,139,202), 0.03)" }}>
                    <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--color-divider)" }}>
                      <span className="text-[10px] font-bold uppercase tracking-wide pb-1 border-b" title="Define rules to group rows into collapsible sections" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}>Grouping</span>
                      {activePreset && (
                        <button onClick={() => { activatePreset(null); setDraftGroupingConfig(null); setDraftDirty(false); }} className="text-[10px] px-2 py-0.5 rounded hover:bg-black/10" style={{ color: "#e05555" }}>Deactivate</button>
                      )}
                    </div>
                    <div className="px-3 py-2 border-b space-y-1.5" style={{ borderColor: "var(--color-divider)" }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium" style={{ color: "var(--color-text-muted)" }}>View Presets ({tabPresets.length}/5)</span>
                        {tabPresets.length < 5 && (
                          <button onClick={() => savePreset({ tabKey: subTab, presetName: `Preset ${tabPresets.length + 1}`, viewConfig: snapshotViewConfig() })} className="text-[10px] px-2 py-0.5 rounded font-medium hover:bg-black/10" style={{ color: "var(--color-primary)" }}>+ Save Current View</button>
                        )}
                      </div>
                      {tabPresets.length === 0 && <div className="text-[10px] py-1" style={{ color: "var(--color-text-muted)" }}>No saved presets.</div>}
                      {tabPresets.map((preset, pi) => {
                        const vc = preset.viewConfig || {};
                        const badges: string[] = [];
                        const gc = vc.groupingConfig ? normalizeGroupingConfig(vc.groupingConfig) : null;
                        const gCount = gc ? gc.rules.length + (gc.autoGroup ? 1 : 0) : 0;
                        if (gCount > 0) badges.push(`${gCount}g`);
                        if (vc.sortConfig?.primary) badges.push("sort");
                        if (vc.hiddenCols?.length) badges.push(`${vc.hiddenCols.length}h`);
                        if (vc.colSeparators && Object.keys(vc.colSeparators).length) badges.push(`${Object.keys(vc.colSeparators).length}s`);
                        if (vc.filterRules?.length) badges.push(`${vc.filterRules.length}f`);
                        return (
                        <div key={preset.presetId} className="flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] group/preset" style={{ borderColor: preset.isActive ? "var(--color-primary)" : "var(--color-divider)", backgroundColor: preset.isActive ? "rgba(var(--color-primary-rgb, 66,139,202), 0.1)" : "transparent" }}>
                          {pi === 0 && <span className="text-[8px] shrink-0" style={{ color: "var(--color-text-muted)" }} title="Default view on page load">★</span>}
                          <button onClick={() => { if (preset.isActive) { activatePreset(null); setDraftGroupingConfig(null); } else { activatePreset(preset.presetId); } setDraftDirty(false); }} className="w-3 h-3 rounded-full border-2 shrink-0" style={{ borderColor: preset.isActive ? "var(--color-primary)" : "var(--color-text-muted)", backgroundColor: preset.isActive ? "var(--color-primary)" : "transparent" }} title={pi === 0 ? "Default preset — applied on page load" : "Click to activate"} />
                          <input type="text" value={preset.presetName} onChange={(e) => setViewPresets((prev) => prev.map((p) => p.presetId === preset.presetId ? { ...p, presetName: e.target.value } : p))} onBlur={() => updatePreset(preset.presetId, { presetName: preset.presetName })} className="flex-1 bg-transparent text-[10px] font-medium focus:outline-none border-b border-transparent focus:border-current" style={{ color: preset.isActive ? "var(--color-primary)" : "var(--color-text)", minWidth: 0 }} />
                          {badges.length > 0 && <span className="text-[8px] shrink-0 opacity-60" style={{ color: "var(--color-text-muted)" }}>{badges.join(" ")}</span>}
                          {/* Resave current view into this preset */}
                          {preset.isActive && <button onClick={() => updatePreset(preset.presetId, { viewConfig: snapshotViewConfig() })} className="text-[9px] px-1 rounded opacity-0 group-hover/preset:opacity-100 transition-opacity hover:bg-black/10 shrink-0" style={{ color: "var(--color-primary)" }} title="Update this preset with current view settings">↻</button>}
                          <button onClick={() => deletePreset(preset.presetId)} className="text-[10px] px-0.5 rounded opacity-0 group-hover/preset:opacity-100 transition-opacity hover:bg-red-500/10" style={{ color: "#e05555" }}>✕</button>
                        </div>
                        );
                      })}
                    </div>
                    <div className="p-3 space-y-3 overflow-y-auto">
                      {(() => {
                        const isAutoGroup = !!draft.autoGroup;
                        const primaryColor = depthColors[0] || "var(--color-primary)";
                        const subColor = depthColors[1] || "var(--color-primary)";
                        return (
                          <div className="rounded-lg border" style={{ borderColor: primaryColor + "60" }}>
                            {/* Header with Auto toggle */}
                            <div className="flex items-center justify-between px-2 py-1.5 rounded-t-lg" style={{ backgroundColor: primaryColor + "15" }}>
                              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: primaryColor }}>Grouping Rules</span>
                              <button onClick={() => updateDraft(isAutoGroup ? { ...draft, autoGroup: undefined } : { ...draft, autoGroup: { column: groupableCols[0]?.key || "" }, rules: [] })} className="text-[9px] px-1.5 py-0.5 rounded font-medium hover:bg-black/10" style={{ color: isAutoGroup ? primaryColor : "var(--color-text-muted)", backgroundColor: isAutoGroup ? primaryColor + "20" : "transparent" }} title={isAutoGroup ? "Switch to custom rules" : "Auto-group by distinct values"}>{isAutoGroup ? "Auto ✓" : "Auto"}</button>
                            </div>
                            <div className="p-2 space-y-2">
                              {/* Auto-group mode */}
                              {isAutoGroup && (
                                <div className="flex items-center gap-2">
                                  <label className="text-[10px] font-medium shrink-0" style={{ color: "var(--color-text-muted)" }}>Column:</label>
                                  <select value={draft.autoGroup!.column} onChange={(e) => updateDraft({ ...draft, autoGroup: { column: e.target.value } })} className="flex-1 px-2 py-1 text-[11px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}>
                                    {groupableCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                  </select>
                                </div>
                              )}
                              {/* Sort groups */}
                              {(isAutoGroup || draft.rules.length > 0) && (
                                <div className="flex items-center gap-2">
                                  <label className="text-[10px] font-medium shrink-0" style={{ color: "var(--color-text-muted)" }}>Sort:</label>
                                  <select value={draft.sortGroups || ""} onChange={(e) => updateDraft({ ...draft, sortGroups: (e.target.value as GroupingConfig["sortGroups"]) || undefined })} className="flex-1 px-2 py-0.5 text-[10px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}>
                                    <option value="">Default order</option>
                                    <option value="asc">A → Z</option>
                                    <option value="desc">Z → A</option>
                                    <option value="count-desc">Most rows first</option>
                                    <option value="count-asc">Fewest rows first</option>
                                  </select>
                                </div>
                              )}
                              {/* Custom rules mode */}
                              {!isAutoGroup && (
                                <>
                                  {draft.rules.length === 0 && <div className="text-center py-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>No rules. Add a rule or switch to Auto mode.</div>}
                                  {draft.rules.map((rule, ri) => (
                                    <div key={ri} className="rounded-md border p-2 space-y-1.5" style={{ borderColor: "var(--color-divider)", borderLeft: `3px solid ${rule.color || primaryColor}` }}>
                                      {/* Rule header: color, name, logic toggle, move, delete */}
                                      <div className="flex items-center gap-1.5">
                                        <input type="color" value={rule.color || primaryColor} onChange={(e) => updateRule(ri, { color: e.target.value })} className="w-4 h-4 rounded cursor-pointer shrink-0 border-0 p-0" style={{ backgroundColor: "transparent" }} title="Group color" />
                                        {rule.color && <button onClick={() => updateRule(ri, { color: undefined })} className="text-[9px] shrink-0 rounded hover:bg-black/10" style={{ color: "var(--color-text-muted)" }} title="Reset to default">↺</button>}
                                        <input type="text" value={rule.groupName} onChange={(e) => updateRule(ri, { groupName: e.target.value })} className="flex-1 px-2 py-0.5 text-[11px] rounded border font-medium focus:outline-none focus:ring-1" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", minWidth: 0 }} placeholder="Group name" />
                                        {rule.conditions.length > 1 && (
                                          <button onClick={() => updateRule(ri, { logic: rule.logic === "AND" ? "OR" : "AND" })} className="text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0" style={{ backgroundColor: rule.logic === "AND" ? "rgba(108,123,255,0.15)" : "rgba(242,182,97,0.15)", color: rule.logic === "AND" ? "#6c7bff" : "#f2b661", border: `1px solid ${rule.logic === "AND" ? "rgba(108,123,255,0.3)" : "rgba(242,182,97,0.3)"}` }} title={`Switch to ${rule.logic === "AND" ? "OR" : "AND"} logic`}>{rule.logic}</button>
                                        )}
                                        <button onClick={() => moveRule(ri, "up")} disabled={ri === 0} className="text-[10px] px-0.5 rounded disabled:opacity-20 hover:bg-black/10" style={{ color: "var(--color-text-muted)" }}>▲</button>
                                        <button onClick={() => moveRule(ri, "down")} disabled={ri === draft.rules.length - 1} className="text-[10px] px-0.5 rounded disabled:opacity-20 hover:bg-black/10" style={{ color: "var(--color-text-muted)" }}>▼</button>
                                        <button onClick={() => removeRule(ri)} className="text-[10px] px-1 rounded hover:bg-red-500/10" style={{ color: "#e05555" }}>✕</button>
                                      </div>
                                      {/* Conditions */}
                                      {rule.conditions.map((cond, ci) => {
                                        const opDef = GROUPING_OPERATORS.find((o) => o.value === cond.operator)!;
                                        return (
                                          <div key={ci} className="flex items-center gap-1 pl-5">
                                            {ci > 0 && <span className="text-[8px] font-bold w-5 shrink-0 text-center" style={{ color: rule.logic === "AND" ? "#6c7bff" : "#f2b661" }}>{rule.logic}</span>}
                                            {ci === 0 && <span className="w-5 shrink-0" />}
                                            <select value={cond.column} onChange={(e) => updateCondition(ri, ci, { column: e.target.value })} className="px-1 py-0.5 text-[10px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", maxWidth: 100 }}>
                                              {groupableCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                            </select>
                                            <select value={cond.operator} onChange={(e) => updateCondition(ri, ci, { operator: e.target.value as GroupingOperator })} className="px-1 py-0.5 text-[10px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}>
                                              {GROUPING_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                            {opDef?.needsValue && <input type="text" value={cond.value} onChange={(e) => updateCondition(ri, ci, { value: e.target.value })} className="flex-1 px-1.5 py-0.5 text-[10px] rounded border focus:outline-none focus:ring-1" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", minWidth: 0 }} placeholder="value" />}
                                            {opDef?.needsValue2 && <><span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>and</span><input type="text" value={cond.value2 || ""} onChange={(e) => updateCondition(ri, ci, { value2: e.target.value })} className="flex-1 px-1.5 py-0.5 text-[10px] rounded border focus:outline-none focus:ring-1" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", minWidth: 0 }} placeholder="value" /></>}
                                            <button onClick={() => removeCondition(ri, ci)} className="text-[9px] px-0.5 rounded hover:bg-red-500/10 shrink-0" style={{ color: "#e05555" }}>✕</button>
                                          </div>
                                        );
                                      })}
                                      {rule.conditions.length < 7 && (
                                        <button onClick={() => addCondition(ri)} className="ml-5 text-[9px] px-2 py-0.5 rounded border border-dashed hover:bg-black/5" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>+ Condition ({rule.conditions.length}/7)</button>
                                      )}
                                      {/* ─── Per-rule sub-grouping ─── */}
                                      <div className="mt-1 pt-1 border-t" style={{ borderColor: "var(--color-divider)" }}>
                                        {(rule.subRules?.length ?? 0) > 0 ? (
                                          <div className="space-y-1.5 pl-3" style={{ borderLeft: `2px solid ${subColor}40` }}>
                                            <div className="flex items-center justify-between">
                                              <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: subColor }}>Sub-groups</span>
                                              <div className="flex items-center gap-1">
                                                <select value={rule.subSort || ""} onChange={(e) => updateRule(ri, { subSort: (e.target.value as GroupingRule["subSort"]) || undefined })} className="px-1 py-0 text-[9px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}>
                                                  <option value="">Default order</option>
                                                  <option value="asc">A→Z</option>
                                                  <option value="desc">Z→A</option>
                                                  <option value="count-desc">Most first</option>
                                                  <option value="count-asc">Fewest first</option>
                                                </select>
                                                <button onClick={() => updateRule(ri, { subRules: undefined, subUngroupedLabel: undefined, subSort: undefined })} className="text-[9px] px-1 rounded hover:bg-red-500/10" style={{ color: "#e05555" }} title="Remove all sub-groups">✕</button>
                                              </div>
                                            </div>
                                            {rule.subRules!.map((sub, si) => (
                                              <div key={si} className="rounded border p-1.5 space-y-1" style={{ borderColor: "var(--color-divider)", borderLeft: `2px solid ${sub.color || subColor}` }}>
                                                <div className="flex items-center gap-1">
                                                  <input type="color" value={sub.color || subColor} onChange={(e) => updateSubRule(ri, si, { color: e.target.value })} className="w-3 h-3 rounded cursor-pointer shrink-0 border-0 p-0" style={{ backgroundColor: "transparent" }} />
                                                  <input type="text" value={sub.groupName} onChange={(e) => updateSubRule(ri, si, { groupName: e.target.value })} className="flex-1 px-1.5 py-0 text-[10px] rounded border font-medium focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", minWidth: 0 }} placeholder="Sub-group name" />
                                                  {sub.conditions.length > 1 && (
                                                    <button onClick={() => updateSubRule(ri, si, { logic: sub.logic === "AND" ? "OR" : "AND" })} className="text-[8px] px-1 py-0 rounded font-bold shrink-0" style={{ backgroundColor: sub.logic === "AND" ? "rgba(108,123,255,0.15)" : "rgba(242,182,97,0.15)", color: sub.logic === "AND" ? "#6c7bff" : "#f2b661" }}>{sub.logic}</button>
                                                  )}
                                                  <button onClick={() => removeSubRule(ri, si)} className="text-[9px] px-0.5 rounded hover:bg-red-500/10 shrink-0" style={{ color: "#e05555" }}>✕</button>
                                                </div>
                                                {sub.conditions.map((cond, ci) => {
                                                  const opDef = GROUPING_OPERATORS.find((o) => o.value === cond.operator)!;
                                                  return (
                                                    <div key={ci} className="flex items-center gap-1 pl-4">
                                                      {ci > 0 && <span className="text-[7px] font-bold w-4 shrink-0 text-center" style={{ color: sub.logic === "AND" ? "#6c7bff" : "#f2b661" }}>{sub.logic}</span>}
                                                      {ci === 0 && <span className="w-4 shrink-0" />}
                                                      <select value={cond.column} onChange={(e) => updateSubCondition(ri, si, ci, { column: e.target.value })} className="px-1 py-0 text-[9px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", maxWidth: 85 }}>
                                                        {groupableCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                                      </select>
                                                      <select value={cond.operator} onChange={(e) => updateSubCondition(ri, si, ci, { operator: e.target.value as GroupingOperator })} className="px-1 py-0 text-[9px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}>
                                                        {GROUPING_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                      </select>
                                                      {opDef?.needsValue && <input type="text" value={cond.value} onChange={(e) => updateSubCondition(ri, si, ci, { value: e.target.value })} className="flex-1 px-1 py-0 text-[9px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", minWidth: 0 }} placeholder="value" />}
                                                      {opDef?.needsValue2 && <><span className="text-[8px]" style={{ color: "var(--color-text-muted)" }}>and</span><input type="text" value={cond.value2 || ""} onChange={(e) => updateSubCondition(ri, si, ci, { value2: e.target.value })} className="flex-1 px-1 py-0 text-[9px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", minWidth: 0 }} placeholder="value" /></>}
                                                      <button onClick={() => removeSubCondition(ri, si, ci)} className="text-[8px] px-0.5 rounded hover:bg-red-500/10 shrink-0" style={{ color: "#e05555" }}>✕</button>
                                                    </div>
                                                  );
                                                })}
                                                {sub.conditions.length < 7 && (
                                                  <button onClick={() => addSubCondition(ri, si)} className="ml-4 text-[8px] px-1.5 py-0 rounded border border-dashed hover:bg-black/5" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>+ Condition</button>
                                                )}
                                              </div>
                                            ))}
                                            <button onClick={() => addSubRule(ri)} className="w-full py-0.5 text-[9px] rounded border border-dashed font-medium hover:bg-black/5" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>+ Add Sub-rule</button>
                                            {/* Sub-group unmatched label */}
                                            <div className="flex items-center gap-1.5">
                                              <label className="text-[9px] font-medium shrink-0" style={{ color: "var(--color-text-muted)" }}>Unmatched:</label>
                                              <input type="text" value={rule.subUngroupedLabel || ""} onChange={(e) => updateRule(ri, { subUngroupedLabel: e.target.value })} className="flex-1 px-1.5 py-0 text-[9px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }} placeholder={draft.ungroupedLabel || "Other"} />
                                            </div>
                                          </div>
                                        ) : (
                                          <button onClick={() => addSubRule(ri)} className="w-full py-0.5 text-[9px] rounded border border-dashed font-medium hover:bg-black/5" style={{ borderColor: subColor + "50", color: subColor + "90" }}>+ Add Sub-group</button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  <button onClick={addRule} className="w-full py-1 text-[10px] rounded-md border border-dashed font-medium hover:bg-black/5 transition-colors" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>+ Add Rule</button>
                                </>
                              )}
                              {/* Unmatched label */}
                              {(draft.rules.length > 0 || isAutoGroup) && (
                                <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: "var(--color-divider)" }}>
                                  <label className="text-[10px] font-medium shrink-0" style={{ color: "var(--color-text-muted)" }}>Unmatched:</label>
                                  <input type="text" value={draft.ungroupedLabel} onChange={(e) => updateDraft({ ...draft, ungroupedLabel: e.target.value })} className="flex-1 px-2 py-0.5 text-[10px] rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }} placeholder="Other" />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    {draftDirty && !liveMode && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t" style={{ borderColor: "var(--color-divider)" }}>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>Unsaved — use Save button above</span>
                      </div>
                    )}
                  </div>

                  {/* RIGHT COLUMN: Sort + Columns */}
                  <div className="w-[240px] overflow-y-auto py-1">
                    {/* Module sort by section — collapsible */}
                    <button onClick={() => setSortSectionOpen((v) => !v)} className="w-full flex items-center gap-1 px-3 pt-1 pb-1.5 text-left" title="Primary and secondary sort order for modules">
                      <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>{sortSectionOpen ? "▼" : "▶"}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wide pb-1 border-b flex-1" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}>{cfg.label} Sort By</span>
                    </button>
                    {sortSectionOpen && (
                      <div className="px-3 pb-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <select value={sortConfig.primary?.col ?? ""} onChange={(e) => { const col = e.target.value || null; setSortConfig((prev) => ({ ...prev, primary: col ? { col, dir: prev.primary?.dir ?? "asc" } : null, secondary: col ? prev.secondary : null })); }} className="flex-1 px-2 py-1 text-xs focus:outline-none cursor-pointer" style={{ backgroundColor: "transparent", color: sortConfig.primary ? "var(--color-text)" : "var(--color-text-muted)", border: "none", borderBottom: "1px solid var(--color-divider)" }}>
                            <option value="">None</option>
                            {allGridCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                          </select>
                          <select value={sortConfig.primary?.dir ?? "asc"} onChange={(e) => setSortConfig((prev) => ({ ...prev, primary: prev.primary ? { ...prev.primary, dir: e.target.value as "asc" | "desc" } : null }))} disabled={!sortConfig.primary} className="px-2 py-1 text-xs focus:outline-none cursor-pointer shrink-0 disabled:opacity-30" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)", width: 52 }}>
                            <option value="asc">A→Z</option>
                            <option value="desc">Z→A</option>
                          </select>
                        </div>
                        {sortConfig.primary && (
                          <>
                            <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>then by</div>
                            <div className="flex items-center gap-2">
                              <select value={sortConfig.secondary?.col ?? ""} onChange={(e) => { const col = e.target.value || null; setSortConfig((prev) => ({ ...prev, secondary: col ? { col, dir: prev.secondary?.dir ?? "asc" } : null })); }} className="flex-1 px-2 py-1 text-xs focus:outline-none cursor-pointer" style={{ backgroundColor: "transparent", color: sortConfig.secondary ? "var(--color-text)" : "var(--color-text-muted)", border: "none", borderBottom: "1px solid var(--color-divider)" }}>
                                <option value="">None</option>
                                {allGridCols.filter((c) => c.key !== sortConfig.primary?.col).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                              </select>
                              <select value={sortConfig.secondary?.dir ?? "asc"} onChange={(e) => setSortConfig((prev) => ({ ...prev, secondary: prev.secondary ? { ...prev.secondary, dir: e.target.value as "asc" | "desc" } : null }))} disabled={!sortConfig.secondary} className="px-2 py-1 text-xs focus:outline-none cursor-pointer shrink-0 disabled:opacity-30" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)", width: 52 }}>
                                <option value="asc">A→Z</option>
                                <option value="desc">Z→A</option>
                              </select>
                            </div>
                          </>
                        )}
                        {sortConfig.primary && (
                          <button onClick={() => setSortConfig({ primary: null, secondary: null })} className="text-[10px] hover:underline" style={{ color: "#e05555" }}>Clear sort</button>
                        )}
                      </div>
                    )}
                    {/* Module Filters section — collapsible */}
                    {subTab === "modules" && (
                      <>
                        <div className="mx-1 my-0.5 border-t" style={{ borderColor: "var(--color-divider)" }} />
                        <button onClick={() => setModuleFilterSectionOpen((v) => !v)} className="w-full flex items-center gap-1 px-3 pt-1 pb-0.5 text-left" title="Filter module records by column values">
                          <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>{moduleFilterSectionOpen ? "▼" : "▶"}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wide pb-1 border-b flex-1" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}>Module Filters{moduleFilterRules.length > 0 ? ` (${moduleFilterRules.length})` : ""}</span>
                        </button>
                        {moduleFilterSectionOpen && (
                          <div className="px-3 pb-2 space-y-1.5">
                            {moduleFilterRules.map((rule, i) => (
                              <div key={i} className="flex items-center gap-1 text-[10px]">
                                <select value={rule.col} onChange={(e) => { const next = [...moduleFilterRules]; next[i] = { ...rule, col: e.target.value }; setModuleFilterRules(next); }} className="flex-1 px-1 py-0.5 text-[10px] focus:outline-none cursor-pointer" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)" }}>
                                  {allGridCols.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                </select>
                                <select value={rule.op} onChange={(e) => { const next = [...moduleFilterRules]; next[i] = { ...rule, op: e.target.value as FilterRule["op"] }; setModuleFilterRules(next); }} className="px-1 py-0.5 text-[10px] focus:outline-none cursor-pointer shrink-0" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)", width: 72 }}>
                                  <option value="equals">equals</option>
                                  <option value="not_equals">not equals</option>
                                  <option value="contains">contains</option>
                                  <option value="not_contains">not contains</option>
                                  <option value="is_empty">is empty</option>
                                  <option value="not_empty">not empty</option>
                                </select>
                                {rule.op !== "is_empty" && rule.op !== "not_empty" && (
                                  <input type="text" value={rule.value} onChange={(e) => { const next = [...moduleFilterRules]; next[i] = { ...rule, value: e.target.value }; setModuleFilterRules(next); }} className="flex-1 px-1 py-0.5 text-[10px] rounded focus:outline-none" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)", minWidth: 40 }} placeholder="value" />
                                )}
                                <button onClick={() => setModuleFilterRules((prev) => prev.filter((_, j) => j !== i))} className="shrink-0 text-[10px] px-0.5 rounded hover:bg-black/10" style={{ color: "#e05555" }} title="Remove filter">✕</button>
                              </div>
                            ))}
                            <button onClick={() => setModuleFilterRules((prev) => [...prev, { col: allGridCols[0]?.key || "name", op: "contains", value: "" }])} className="text-[10px] hover:underline" style={{ color: "var(--color-primary)" }}>+ Add Filter</button>
                            {moduleFilterRules.length > 0 && (
                              <button onClick={() => setModuleFilterRules([])} className="text-[10px] hover:underline ml-3" style={{ color: "#e05555" }}>Clear all</button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    <div className="mx-1 my-0.5 border-t" style={{ borderColor: "var(--color-divider)" }} />
                    {/* Columns section — collapsible */}
                    <button onClick={() => setColsSectionOpen((v) => !v)} className="w-full flex items-center gap-1 px-3 pt-1 pb-0.5 text-left" title="Show/hide and reorder columns">
                      <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>{colsSectionOpen ? "▼" : "▶"}</span>
                      <input type="color" value={moduleColColor} onChange={(e) => setModuleColColor(e.target.value)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded cursor-pointer shrink-0 border-0 p-0" style={{ backgroundColor: "transparent" }} title="Module columns color" />
                      <span className="text-[10px] font-bold uppercase tracking-wide pb-1 border-b flex-1" style={{ color: moduleColColor, borderColor: "var(--color-divider)" }}>{cfg.label} Columns</span>
                      <button onClick={(e) => { e.stopPropagation(); setModuleColBold(!moduleColBold); }} className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold" style={{ color: moduleColBold ? moduleColColor : "var(--color-text-muted)", backgroundColor: moduleColBold ? `${moduleColColor}22` : "transparent" }} title="Bold column headers">B</button>
                      <button onClick={(e) => { e.stopPropagation(); setModuleColUnderline(!moduleColUnderline); }} className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] underline" style={{ color: moduleColUnderline ? moduleColColor : "var(--color-text-muted)", backgroundColor: moduleColUnderline ? `${moduleColColor}22` : "transparent" }} title="Underline column headers">U</button>
                    </button>
                    {colsSectionOpen && (
                      <>
                      <DndContext
                        sensors={dndSensors}
                        onDragEnd={(event: DragEndEvent) => {
                          const { active, over } = event;
                          if (!over || active.id === over.id) return;
                          const keys = mixedColOrder.map((item) => item.type === "col" ? item.col.key : item.sep.id);
                          const oldIdx = keys.indexOf(active.id as string);
                          const newIdx = keys.indexOf(over.id as string);
                          if (oldIdx < 0 || newIdx < 0) return;
                          const newOrder = arrayMove(keys, oldIdx, newIdx);
                          setColOrder((prev) => ({ ...prev, [subTab]: newOrder }));
                        }}
                      >
                        <SortableContext items={mixedColOrder.map((item) => item.type === "col" ? item.col.key : item.sep.id)} strategy={verticalListSortingStrategy}>
                          {mixedColOrder.map((item) =>
                            item.type === "col" ? (
                              <SortableColItem key={item.col.key} col={item.col} subTab={subTab} isColVisible={isColVisible} toggleColVisibility={toggleColVisibility} accentColor={moduleColColor} highlight={addColHighlight === item.col.key} onDelete={item.col.key !== cfg.nameKey ? handleDeleteColumn : undefined} />
                            ) : (
                              <SortableSeparatorItem key={item.sep.id} sep={item.sep} tabKey={subTab} onUpdate={updateSeparator} onRemove={removeSeparator} colorPickerOpen={sepColorPickerOpen} setColorPickerOpen={setSepColorPickerOpen} />
                            )
                          )}
                        </SortableContext>
                      </DndContext>
                      {/* Add Column inline form */}
                      {addColOpen && (
                        <div className="mx-1 mt-1 p-2.5 rounded" style={{ background: "rgba(59,130,246,0.04)", borderTop: "1px solid var(--color-divider)" }}>
                          <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "#4ecb71" }}>New Column</div>
                          <div className="mb-2">
                            <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--color-text-muted)" }}>Name</div>
                            <input
                              type="text"
                              value={addColName}
                              onChange={(e) => { setAddColName(e.target.value); setAddColError(null); }}
                              placeholder="e.g. Complexity, Owner, Due Date…"
                              className="w-full px-2 py-1 text-[11px] rounded outline-none focus:ring-1 focus:ring-blue-500"
                              style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-divider)", color: "var(--color-text)" }}
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter" && !addColSaving) handleAddColumn(); if (e.key === "Escape") resetAddColForm(); }}
                            />
                          </div>
                          <div className="mb-2">
                            <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--color-text-muted)" }}>Type</div>
                            <div className="grid grid-cols-4 gap-1">
                              {(["text", "textarea", "int", "boolean", "enum", "tags", "formula", "notes"] as const).map((t) => (
                                <button
                                  key={t}
                                  onClick={() => { setAddColType(t); if (t !== "enum") setAddColOptions([]); if (t !== "formula") setAddColFormula(""); }}
                                  className="text-[10px] py-1 px-2 rounded text-center cursor-pointer transition-colors"
                                  style={{
                                    border: `1px solid ${addColType === t ? (t === "formula" ? "#5bc0de" : t === "notes" ? "#a78bfa" : "#3b82f6") : "var(--color-divider)"}`,
                                    background: addColType === t ? (t === "formula" ? "rgba(91,192,222,0.1)" : t === "notes" ? "rgba(167,139,250,0.1)" : "rgba(59,130,246,0.1)") : "var(--color-bg-base)",
                                    color: addColType === t ? (t === "formula" ? "#5bc0de" : t === "notes" ? "#a78bfa" : "#60a5fa") : "var(--color-text-muted)",
                                  }}
                                  title={t === "notes" ? "Rich notes — click to open fullscreen editor with references and formatting" : undefined}
                                >
                                  {t === "int" ? "Number" : t === "boolean" ? "Bool" : t === "formula" ? "Formula" : t === "notes" ? "Notes" : t.charAt(0).toUpperCase() + t.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>
                          {addColType === "enum" && (
                            <div className="mb-2">
                              <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--color-text-muted)" }}>Enum Values</div>
                              {addColOptions.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-1">
                                  {addColOptions.map((opt, i) => (
                                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                                      {opt}
                                      <span className="cursor-pointer opacity-60 hover:opacity-100" onClick={() => setAddColOptions((prev) => prev.filter((_, j) => j !== i))}>✕</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="flex gap-1">
                                <input
                                  type="text"
                                  value={addColOptionInput}
                                  onChange={(e) => setAddColOptionInput(e.target.value)}
                                  placeholder="Add option…"
                                  className="flex-1 px-2 py-1 text-[10px] rounded outline-none"
                                  style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-divider)", color: "var(--color-text)" }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && addColOptionInput.trim()) {
                                      e.preventDefault();
                                      setAddColOptions((prev) => [...prev, addColOptionInput.trim()]);
                                      setAddColOptionInput("");
                                    }
                                  }}
                                />
                                <button
                                  onClick={() => { if (addColOptionInput.trim()) { setAddColOptions((prev) => [...prev, addColOptionInput.trim()]); setAddColOptionInput(""); } }}
                                  className="text-[10px] px-2 py-1 rounded"
                                  style={{ border: "1px solid var(--color-divider)", color: "#4ecb71" }}
                                >+ Add</button>
                              </div>
                            </div>
                          )}
                          {addColType === "formula" && (
                            <div className="mb-2">
                              <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: "var(--color-text-muted)" }}>
                                Expression <span style={{ color: "#5bc0de", fontWeight: 400, textTransform: "none" }}>— click a variable below to insert</span>
                              </div>
                              <textarea
                                ref={addColFormulaRef}
                                value={addColFormula}
                                onChange={(e) => { setAddColFormula(e.target.value); setAddColError(null); }}
                                placeholder={'IF({status} == "Approved", "Ready", "Pending")'}
                                rows={2}
                                className="w-full px-2 py-1.5 text-[10px] rounded outline-none focus:ring-1 focus:ring-cyan-400 font-mono"
                                style={{ background: "var(--color-bg-base)", border: "1px solid var(--color-divider)", color: "var(--color-text)", resize: "vertical" }}
                              />
                              {/* ── Available column variables ── */}
                              {(() => {
                                const cfg = TABLE_CONFIGS[subTab];
                                const cols = cfg?.columns.filter((c) => c.type !== "separator" && c.type !== "image-carousel" && c.type !== "test-count" && c.type !== "ref-projects" && c.type !== "ref-features" && c.type !== "module-rules") || [];
                                if (!cols.length) return null;
                                return (
                                  <div className="mt-1.5 mb-1">
                                    <div className="text-[8px] uppercase tracking-wide mb-1" style={{ color: "var(--color-text-muted)" }}>Columns</div>
                                    <div className="flex flex-wrap gap-1">
                                      {cols.map((c) => (
                                        <button
                                          key={c.key}
                                          type="button"
                                          className="text-[9px] px-1.5 py-0.5 rounded font-mono cursor-pointer hover:brightness-125 transition-all"
                                          style={{ background: "rgba(91,192,222,0.12)", color: "#5bc0de", border: "1px solid rgba(91,192,222,0.25)" }}
                                          title={`Insert {${c.key}} — ${c.label}`}
                                          onClick={() => {
                                            const ta = addColFormulaRef.current;
                                            const token = `{${c.key}}`;
                                            if (ta) {
                                              const start = ta.selectionStart ?? addColFormula.length;
                                              const end = ta.selectionEnd ?? start;
                                              const next = addColFormula.slice(0, start) + token + addColFormula.slice(end);
                                              setAddColFormula(next);
                                              setAddColError(null);
                                              requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + token.length; });
                                            } else {
                                              setAddColFormula((prev) => prev + token);
                                            }
                                          }}
                                        >
                                          {"{" + c.key + "}"}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* ── Function reference ── */}
                              <div className="mt-1.5">
                                <button
                                  type="button"
                                  className="text-[8px] uppercase tracking-wide flex items-center gap-1 cursor-pointer"
                                  style={{ color: "var(--color-text-muted)" }}
                                  onClick={() => setFormulaFuncOpen((p) => !p)}
                                >
                                  Functions
                                  <span style={{ fontSize: "7px", transform: formulaFuncOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>▼</span>
                                </button>
                                {formulaFuncOpen && (
                                  <div className="mt-1 rounded p-1.5 flex flex-col gap-1" style={{ background: "rgba(91,192,222,0.06)", border: "1px solid rgba(91,192,222,0.15)" }}>
                                    {[
                                      { name: "IF", sig: "IF(condition, then, else?)", desc: "Conditional — supports ==, !=, >, <, >=, <=, EMPTY(), NOT_EMPTY()", ex: 'IF({status} == "Done", "✓", "Pending")' },
                                      { name: "CONCAT", sig: "CONCAT(a, b, …)", desc: "Join values into a single string", ex: 'CONCAT({firstName}, " ", {lastName})' },
                                      { name: "COALESCE", sig: "COALESCE(a, b, …)", desc: "First non-empty value", ex: 'COALESCE({nickname}, {name}, "Unknown")' },
                                      { name: "UPPER", sig: "UPPER(value)", desc: "Convert to uppercase", ex: "UPPER({status})" },
                                      { name: "LOWER", sig: "LOWER(value)", desc: "Convert to lowercase", ex: "LOWER({email})" },
                                      { name: "LEN", sig: "LEN(value)", desc: "String length", ex: "LEN({description})" },
                                      { name: "SUM", sig: "SUM(a, b, …)", desc: "Add numbers together", ex: "SUM({score}, {bonus})" },
                                      { name: "ROUND", sig: "ROUND(value, digits?)", desc: "Round to N decimal places (default 0)", ex: "ROUND({price}, 2)" },
                                    ].map((fn) => (
                                      <div key={fn.name} className="flex flex-col gap-0.5">
                                        <div className="flex items-baseline gap-1.5">
                                          <span className="text-[9px] font-mono font-semibold" style={{ color: "#5bc0de" }}>{fn.sig}</span>
                                        </div>
                                        <div className="text-[8px] pl-1" style={{ color: "var(--color-text-muted)" }}>
                                          {fn.desc} — <span className="font-mono" style={{ color: "var(--color-text)", opacity: 0.7 }}>{fn.ex}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {!formulaFuncOpen && (
                                  <div className="text-[8px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                                    IF · CONCAT · COALESCE · UPPER · LOWER · LEN · SUM · ROUND
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {addColError && <div className="text-[10px] mb-1" style={{ color: "#e05555" }}>{addColError}</div>}
                          <div className="flex justify-end items-center gap-1.5 mt-2">
                            {!addColName.trim() && !addColSaving && (
                              <span className="text-[10px] italic mr-auto" style={{ color: "var(--color-text-muted)" }}>Enter a name to create</span>
                            )}
                            <button onClick={resetAddColForm} className="text-[10px] px-2.5 py-1 rounded" style={{ border: "1px solid var(--color-divider)", color: "var(--color-text-muted)" }}>Cancel</button>
                            <button
                              onClick={handleAddColumn}
                              disabled={addColSaving || !addColName.trim()}
                              className="text-[10px] px-3 py-1 rounded font-semibold"
                              style={{ background: "#4ecb71", color: "var(--color-bg-base)", opacity: addColSaving || !addColName.trim() ? 0.5 : 1, cursor: addColSaving || !addColName.trim() ? "not-allowed" : "pointer" }}
                              title={!addColName.trim() ? "Enter a column name above" : addColSaving ? "Saving…" : "Create column"}
                            >{addColSaving ? "Creating…" : "Create"}</button>
                          </div>
                        </div>
                      )}
                      {/* Bottom buttons: Add Column + Add Separator */}
                      <div className="flex" style={{ borderTop: "1px solid var(--color-divider)", marginTop: "4px" }}>
                        <button
                          onClick={() => { if (!addColOpen && TAB_ENTITY_MAP[subTab]) setAddColOpen(true); }}
                          className="flex-1 text-[10px] py-1.5 hover:underline"
                          style={{ color: addColOpen || !TAB_ENTITY_MAP[subTab] ? "var(--color-text-muted)" : "#4ecb71", opacity: addColOpen || !TAB_ENTITY_MAP[subTab] ? 0.4 : 1, borderRight: "1px solid var(--color-divider)" }}
                          disabled={addColOpen || !TAB_ENTITY_MAP[subTab]}
                        >+ Add Column</button>
                        <button onClick={() => addSeparator(subTab)} className="flex-1 text-[10px] py-1.5 hover:underline" style={{ color: "var(--color-text-muted)" }}>+ Add Separator</button>
                      </div>
                      {/* Restore permanently hidden columns */}
                      {(() => {
                        const hiddenForTab = permHiddenCols.filter((k) => k.startsWith(`${subTab}:`));
                        if (hiddenForTab.length === 0) return null;
                        return (
                          <div className="px-2 pb-1">
                            <details className="text-[10px]">
                              <summary className="cursor-pointer hover:underline py-0.5" style={{ color: "var(--color-text-muted)" }}>+ Restore Hidden ({hiddenForTab.length})</summary>
                              <div className="mt-1 space-y-0.5">
                                {hiddenForTab.map((key) => {
                                  const colKey = key.split(":").slice(1).join(":");
                                  const colDef = cfg.columns.find((c) => c.key === colKey) || { label: colKey };
                                  return (
                                    <div key={key} className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-black/5">
                                      <span className="flex-1" style={{ color: "var(--color-text-muted)" }}>{colDef.label}</span>
                                      <button onClick={() => handleRestoreColumn(subTab, colKey)} className="text-[9px] px-1.5 py-0.5 rounded hover:underline" style={{ color: "#4ecb71" }}>Restore</button>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          </div>
                        );
                      })()}
                      </>
                    )}
                    {subTab === "modules" && (
                      <>
                        <div className="mx-2 my-1 border-t" style={{ borderColor: "var(--color-divider)" }} />
                        {/* Feature Sort By — collapsible */}
                        <button onClick={() => setFeatureSortSectionOpen((v) => !v)} className="w-full flex items-center gap-1 px-3 pt-1 pb-0.5 text-left" title="Sort features within expanded modules">
                          <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>{featureSortSectionOpen ? "▼" : "▶"}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wide pb-1 border-b flex-1" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}>Feature Sort By</span>
                        </button>
                        {featureSortSectionOpen && (
                          <div className="px-3 pb-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <select value={featureSortConfig.primary?.col ?? ""} onChange={(e) => { const col = e.target.value || null; setFeatureSortConfig((prev) => ({ ...prev, primary: col ? { col, dir: prev.primary?.dir ?? "asc" } : null, secondary: col ? prev.secondary : null })); }} className="flex-1 px-2 py-1 text-xs focus:outline-none cursor-pointer" style={{ backgroundColor: "transparent", color: featureSortConfig.primary ? "var(--color-text)" : "var(--color-text-muted)", border: "none", borderBottom: "1px solid var(--color-divider)" }}>
                                <option value="">None</option>
                                {MODULE_FEATURE_COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                              </select>
                              <select value={featureSortConfig.primary?.dir ?? "asc"} onChange={(e) => setFeatureSortConfig((prev) => ({ ...prev, primary: prev.primary ? { ...prev.primary, dir: e.target.value as "asc" | "desc" } : null }))} disabled={!featureSortConfig.primary} className="px-2 py-1 text-xs focus:outline-none cursor-pointer shrink-0 disabled:opacity-30" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)", width: 52 }}>
                                <option value="asc">A→Z</option>
                                <option value="desc">Z→A</option>
                              </select>
                            </div>
                            {featureSortConfig.primary && (
                              <>
                                <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>then by</div>
                                <div className="flex items-center gap-2">
                                  <select value={featureSortConfig.secondary?.col ?? ""} onChange={(e) => { const col = e.target.value || null; setFeatureSortConfig((prev) => ({ ...prev, secondary: col ? { col, dir: prev.secondary?.dir ?? "asc" } : null })); }} className="flex-1 px-2 py-1 text-xs focus:outline-none cursor-pointer" style={{ backgroundColor: "transparent", color: featureSortConfig.secondary ? "var(--color-text)" : "var(--color-text-muted)", border: "none", borderBottom: "1px solid var(--color-divider)" }}>
                                    <option value="">None</option>
                                    {MODULE_FEATURE_COLS.filter((c) => c.key !== featureSortConfig.primary?.col).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                  </select>
                                  <select value={featureSortConfig.secondary?.dir ?? "asc"} onChange={(e) => setFeatureSortConfig((prev) => ({ ...prev, secondary: prev.secondary ? { ...prev.secondary, dir: e.target.value as "asc" | "desc" } : null }))} disabled={!featureSortConfig.secondary} className="px-2 py-1 text-xs focus:outline-none cursor-pointer shrink-0 disabled:opacity-30" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)", width: 52 }}>
                                    <option value="asc">A→Z</option>
                                    <option value="desc">Z→A</option>
                                  </select>
                                </div>
                              </>
                            )}
                            {featureSortConfig.primary && (
                              <button onClick={() => setFeatureSortConfig({ primary: null, secondary: null })} className="text-[10px] hover:underline" style={{ color: "#e05555" }}>Clear sort</button>
                            )}
                          </div>
                        )}
                        {/* Feature Filters — collapsible */}
                        <div className="mx-1 my-0.5 border-t" style={{ borderColor: "var(--color-divider)" }} />
                        <button onClick={() => setFeatureFilterSectionOpen((v) => !v)} className="w-full flex items-center gap-1 px-3 pt-1 pb-0.5 text-left" title="Filter feature records by column values">
                          <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>{featureFilterSectionOpen ? "▼" : "▶"}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wide pb-1 border-b flex-1" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}>Feature Filters{featureFilterRules.length > 0 ? ` (${featureFilterRules.length})` : ""}</span>
                        </button>
                        {featureFilterSectionOpen && (
                          <div className="px-3 pb-2 space-y-1.5">
                            {featureFilterRules.map((rule, i) => (
                              <div key={i} className="flex items-center gap-1 text-[10px]">
                                <select value={rule.col} onChange={(e) => { const next = [...featureFilterRules]; next[i] = { ...rule, col: e.target.value }; setFeatureFilterRules(next); }} className="flex-1 px-1 py-0.5 text-[10px] focus:outline-none cursor-pointer" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)" }}>
                                  {MODULE_FEATURE_COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                                </select>
                                <select value={rule.op} onChange={(e) => { const next = [...featureFilterRules]; next[i] = { ...rule, op: e.target.value as FilterRule["op"] }; setFeatureFilterRules(next); }} className="px-1 py-0.5 text-[10px] focus:outline-none cursor-pointer shrink-0" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)", width: 72 }}>
                                  <option value="equals">equals</option>
                                  <option value="not_equals">not equals</option>
                                  <option value="contains">contains</option>
                                  <option value="not_contains">not contains</option>
                                  <option value="is_empty">is empty</option>
                                  <option value="not_empty">not empty</option>
                                </select>
                                {rule.op !== "is_empty" && rule.op !== "not_empty" && (
                                  <input type="text" value={rule.value} onChange={(e) => { const next = [...featureFilterRules]; next[i] = { ...rule, value: e.target.value }; setFeatureFilterRules(next); }} className="flex-1 px-1 py-0.5 text-[10px] rounded focus:outline-none" style={{ backgroundColor: "transparent", color: "var(--color-text)", border: "none", borderBottom: "1px solid var(--color-divider)", minWidth: 40 }} placeholder="value" />
                                )}
                                <button onClick={() => setFeatureFilterRules((prev) => prev.filter((_, j) => j !== i))} className="shrink-0 text-[10px] px-0.5 rounded hover:bg-black/10" style={{ color: "#e05555" }} title="Remove filter">✕</button>
                              </div>
                            ))}
                            <button onClick={() => setFeatureFilterRules((prev) => [...prev, { col: MODULE_FEATURE_COLS[0]?.key || "featureName", op: "contains", value: "" }])} className="text-[10px] hover:underline" style={{ color: "var(--color-primary)" }}>+ Add Filter</button>
                            {featureFilterRules.length > 0 && (
                              <button onClick={() => setFeatureFilterRules([])} className="text-[10px] hover:underline ml-3" style={{ color: "#e05555" }}>Clear all</button>
                            )}
                          </div>
                        )}
                        <div className="mx-1 my-0.5 border-t" style={{ borderColor: "var(--color-divider)" }} />
                        {/* Feature Columns header */}
                        <div className="px-2 py-1 text-[10px] font-bold border-b pb-1 uppercase tracking-wide flex items-center gap-1" title="Columns shown when a module's features are expanded" style={{ borderColor: "var(--color-divider)" }}>
                          <input type="color" value={featureColColor} onChange={(e) => setFeatureColColor(e.target.value)} className="w-4 h-4 rounded cursor-pointer shrink-0 border-0 p-0" style={{ backgroundColor: "transparent" }} title="Feature columns color" />
                          <span className="flex-1" style={{ color: featureColColor }}>Feature Columns</span>
                          <button onClick={() => setFeatureColBold(!featureColBold)} className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold" style={{ color: featureColBold ? featureColColor : "var(--color-text-muted)", backgroundColor: featureColBold ? `${featureColColor}22` : "transparent" }} title="Bold feature column headers">B</button>
                          <button onClick={() => setFeatureColUnderline(!featureColUnderline)} className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] underline" style={{ color: featureColUnderline ? featureColColor : "var(--color-text-muted)", backgroundColor: featureColUnderline ? `${featureColColor}22` : "transparent" }} title="Underline feature column headers">U</button>
                        </div>
                        <DndContext
                          sensors={dndSensors}
                          onDragEnd={(event: DragEndEvent) => {
                            const { active, over } = event;
                            if (!over || active.id === over.id) return;
                            const keys = orderedFeatCols.map((c) => c.key as string);
                            const oldIdx = keys.indexOf(active.id as string);
                            const newIdx = keys.indexOf(over.id as string);
                            if (oldIdx < 0 || newIdx < 0) return;
                            const newOrder = arrayMove(keys, oldIdx, newIdx);
                            setModuleFeatureColOrder(newOrder);
                            localStorage.setItem("splan_module_feature_col_order", JSON.stringify(newOrder));
                          }}
                        >
                          <SortableContext items={orderedFeatCols.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                            {orderedFeatCols.map((col) => (
                              <SortableFeatColItem key={col.key} col={col} hiddenModuleFeatureCols={hiddenModuleFeatureCols} setHiddenModuleFeatureCols={setHiddenModuleFeatureCols} accentColor={featureColColor} />
                            ))}
                          </SortableContext>
                        </DndContext>
                      </>
                    )}

                    {/* Row Height */}
                    <div className="px-3 py-2 border-t" style={{ borderColor: "var(--color-divider)" }}>
                      <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--color-text-muted)" }}>Row Height</div>
                      <div className="space-y-1.5">
                        <div className="flex gap-1">
                          {[
                            { label: "Compact", value: 28 },
                            { label: "Default", value: undefined },
                            { label: "Comfortable", value: 52 },
                          ].map((preset) => (
                            <button
                              key={preset.label}
                              onClick={() => setRowHeight(subTab, preset.value)}
                              className="px-2 py-0.5 text-[10px] rounded transition-colors"
                              style={{
                                backgroundColor: getRowHeight(subTab) === preset.value ? "var(--color-primary)" : "var(--color-surface)",
                                color: getRowHeight(subTab) === preset.value ? "var(--color-primary-text)" : "var(--color-text-muted)",
                                border: "1px solid var(--color-divider)",
                              }}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        {getRowHeight(subTab) !== undefined && (
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min={20}
                              max={80}
                              value={getRowHeight(subTab) ?? 40}
                              onChange={(e) => setRowHeight(subTab, Number(e.target.value))}
                              className="flex-1"
                              style={{ accentColor: "var(--color-primary)" }}
                            />
                            <span className="text-[10px] w-6 text-center" style={{ color: "var(--color-text)" }}>{getRowHeight(subTab)}px</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* Active filter summary chips — shown below View button when dropdown is closed */}
            {!groupPopoverOpen && (activeGrouping || sortConfig.primary) && (
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                {activeGrouping && (
                  <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-medium" style={{ backgroundColor: "rgba(var(--color-primary-rgb, 66,139,202), 0.12)", color: "var(--color-primary)", border: "1px solid rgba(var(--color-primary-rgb, 66,139,202), 0.25)" }}>
                    Group: {activeGrouping.rules.length + (activeGrouping.autoGroup ? 1 : 0)} rule{activeGrouping.rules.length + (activeGrouping.autoGroup ? 1 : 0) !== 1 ? "s" : ""}
                  </span>
                )}
                {sortConfig.primary && (
                  <span className="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-medium" style={{ backgroundColor: "rgba(var(--color-primary-rgb, 66,139,202), 0.08)", color: "var(--color-text-muted)", border: "1px solid var(--color-divider)" }}>
                    Sort: {allGridCols.find((c) => c.key === sortConfig.primary?.col)?.label ?? sortConfig.primary.col} {sortConfig.primary.dir === "asc" ? "A→Z" : "Z→A"}
                  </span>
                )}
              </div>
            )}
          </div>}
          {!tablePickerOpen && !cfg.readOnly && (
            <button onClick={openCreate} className="px-3 py-1.5 text-xs rounded-md font-medium" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-primary-text)" }}>
              + Add
            </button>
          )}
        </div>
      </div>

      {/* ─── Grid ─── */}
      {filteredRows.length === 0 ? (
        <div className="text-center py-12" style={{ color: "var(--color-text-muted)" }}>
          <p className="text-sm">{search ? "No matching records." : cfg.readOnly ? "No changes logged yet." : `No ${cfg.label.toLowerCase()} yet.`}</p>
        </div>
      ) : (
        <DndContext sensors={dndSensors} onDragStart={handleGroupDragStart} onDragEnd={handleGroupDragEnd}>
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-divider)" }}>
          <table className="w-full text-xs" style={{ tableLayout: (gridCols.some((c) => colWidths[`${subTab}:${c.key}`]) || visibleMixedCols.some((item) => item.type === "sep")) ? "fixed" : undefined }}>
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--color-divider)" }}>
                {/* Drag grip column header (only when grouped) */}
                {flatSections && !tablePickerOpen && <th className="py-2 px-1 w-6" style={{ backgroundColor: "var(--color-surface)" }} />}
                {(subTab === "features" || subTab === "data_tables" || subTab === "modules") && <th className="py-2 pl-3 pr-0 w-5" style={{ backgroundColor: "var(--color-surface)" }} />}
                {visibleMixedCols.map((item) => {
                  if (item.type === "sep") {
                    return (
                      <th
                        key={item.sep.id}
                        className="p-0"
                        style={{
                          width: `${item.sep.thickness}px`,
                          minWidth: `${item.sep.thickness}px`,
                          maxWidth: `${item.sep.thickness}px`,
                          backgroundColor: item.sep.color === "transparent" ? "transparent" : item.sep.color,
                          padding: 0,
                        }}
                      />
                    );
                  }
                  const col = item.col;
                  const widthKey = `${subTab}:${col.key}`;
                  const savedWidth = colWidths[widthKey];
                  const colsWithTooltips = gridCols.filter((c) => c.tooltip);
                  return (
                    <th
                      key={col.key}
                      onClick={(e) => {
                        // Open display settings popover (not sort)
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setColDisplayPopover((prev) => prev?.colKey === col.key ? null : { colKey: col.key, rect });
                      }}
                      className="text-left py-2 px-3 font-semibold cursor-pointer select-none whitespace-nowrap relative group/th"
                      style={{ color: col.badge ? (col.badge === "calc" ? "#5bc0de" : moduleColColor) : moduleColColor, backgroundColor: "var(--color-surface)", width: savedWidth ? `${savedWidth}px` : undefined, minWidth: 60, fontWeight: moduleColBold ? 1000 : 400, textDecoration: moduleColUnderline ? "underline" : undefined, textDecorationThickness: moduleColUnderline ? "2px" : undefined, textUnderlineOffset: moduleColUnderline ? "3px" : undefined }}
                      onMouseEnter={() => setHoveredMainColKey(col.key)}
                      onMouseLeave={() => setHoveredMainColKey(null)}
                    >
                      <span style={col.badge ? { opacity: 0.8 } : undefined}>{col.label}</span>
                      {col.badge && (
                        <sup className="ml-0.5 font-normal" style={{ fontSize: "8px", color: col.badge === "calc" ? "#5bc0de" : "#9999b3", verticalAlign: "super" }}>
                          {col.badge}
                        </sup>
                      )}
                      {sortConfig.primary?.col === col.key && <span className="ml-1 text-[10px]" style={{ color: "var(--color-primary)" }}>{sortConfig.primary.dir === "asc" ? "▲" : "▼"}</span>}
                      {sortConfig.secondary?.col === col.key && <span className="ml-0.5 text-[9px]" style={{ color: "var(--color-text-muted)" }}>{sortConfig.secondary.dir === "asc" ? "²▲" : "²▼"}</span>}
                      {/* Column guide tooltip */}
                      {hoveredMainColKey === col.key && colsWithTooltips.length > 0 && !colDisplayPopover && (
                        <div
                          className="absolute z-40 mt-1 rounded-md border shadow-lg py-1.5 px-1"
                          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", left: 0, top: "100%", minWidth: 420, pointerEvents: "none" }}
                        >
                          <div className="text-[9px] font-semibold uppercase tracking-wide px-2 pb-1 mb-1 border-b" style={{ color: "var(--color-text-muted)", borderColor: "var(--color-divider)" }}>{cfg.label} Columns</div>
                          {colsWithTooltips.map((c) => {
                            const tplForTip = getColumnTemplate(TAB_ENTITY_MAP[subTab] || subTab, c.key);
                            const tplName = tplForTip?.templateName;
                            return (
                              <div
                                key={c.key}
                                className="flex gap-2 px-2 py-0.5 rounded text-[10px]"
                                style={{ backgroundColor: c.key === col.key ? "var(--color-surface)" : "transparent" }}
                              >
                                <span className="font-semibold shrink-0 w-[100px]" style={{ color: c.key === col.key ? "var(--color-text)" : "var(--color-text-muted)" }}>{c.label}</span>
                                <span className="flex-1" style={{ color: c.key === col.key ? "var(--color-text)" : "var(--color-text-muted)", opacity: c.key === col.key ? 1 : 0.7 }}>{c.tooltip}</span>
                                <span className="shrink-0 text-[9px] truncate max-w-[80px]" style={{ color: tplName ? "#5bc0de" : "var(--color-text-muted)", opacity: tplName ? 0.8 : 0.4 }}>{tplName || "Default"}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Resize handle */}
                      <div
                        className="absolute top-0 right-0 w-1 h-full cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:!opacity-100 transition-opacity"
                        style={{ backgroundColor: "var(--color-primary)" }}
                        onMouseDown={(e) => {
                          const th = e.currentTarget.parentElement;
                          onResizeStart(e, subTab, col.key, th?.offsetWidth || 120);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  );
                })}
                {!cfg.readOnly && !tablePickerOpen && <th className="py-2 px-1 w-[48px]" style={{ backgroundColor: "var(--color-surface)", position: "sticky", right: 0, zIndex: 2 }} />}
              </tr>
            </thead>
            <tbody>
              {/* ─── Group headers + sections ─── */}
              {(() => {
                // Build display sections: either one flat section or multiple grouped sections
                const isGrouped = flatSections && !tablePickerOpen;
                const sections: Array<{ name: string | null; rows: Record<string, unknown>[]; colorIndex: number; color?: string; depth: number; groupKey: string | null; parentKey: string; rowCount: number; type: string; aggregate?: { label: string; value: string }[] }> = isGrouped
                  ? flatSections.map((s) => ({ name: s.name, rows: s.rows, colorIndex: s.colorIndex, color: s.color, depth: s.depth, groupKey: s.groupKey, parentKey: s.parentKey, rowCount: s.rowCount, type: s.type, aggregate: s.aggregate }))
                  : [{ name: null, rows: paginatedRows, colorIndex: 0, depth: 0, groupKey: null, parentKey: "", rowCount: paginatedRows.length, type: "rows" }];
                const totalColSpan = visibleMixedCols.length + ((subTab === "features" || subTab === "data_tables" || subTab === "modules") ? 1 : 0) + (!cfg.readOnly && !tablePickerOpen ? 1 : 0) + (isGrouped ? 1 : 0);

                // Check if any ancestor is collapsed (for nested groups)
                const isAncestorCollapsed = (parentKey: string): boolean => {
                  if (!parentKey) return false;
                  // Check each ancestor in the chain
                  const parts = parentKey.replace(`${subTab}:`, "").split("/");
                  let key = `${subTab}:${parts[0]}`;
                  if (collapsedGroups.has(key)) return true;
                  for (let i = 1; i < parts.length; i++) {
                    key += `/${parts[i]}`;
                    if (collapsedGroups.has(key)) return true;
                  }
                  return false;
                };

                return (
                  <>
                    {/* Expand/Collapse all (only when grouped) */}
                    {isGrouped && (() => {
                      const allGroupKeys = flatSections.filter((s) => s.type === "header").map((s) => s.groupKey);
                      const allCollapsed = allGroupKeys.every((k) => collapsedGroups.has(k));
                      return (
                        <tr>
                          <td colSpan={totalColSpan} className="py-1 px-3" style={{ backgroundColor: "var(--color-surface)" }}>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const next = new Set(collapsedGroups);
                                  allGroupKeys.forEach((k) => allCollapsed ? next.delete(k) : next.add(k));
                                  setCollapsedGroups(next);
                                }}
                                className="text-[10px] font-medium px-2 py-0.5 rounded hover:bg-black/10 transition-colors"
                                style={{ color: "var(--color-text-muted)" }}
                              >
                                {allCollapsed ? "▶ Expand All" : "▼ Collapse All"}
                              </button>
                              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                                {groupedResult!.totalGroups} group{groupedResult!.totalGroups !== 1 ? "s" : ""} · {filteredRows.length} row{filteredRows.length !== 1 ? "s" : ""}
                                {activeGrouping && activeGrouping.rules.some((r) => r.subRules?.length) && ` · nested`}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                    {sections.map((section, si) => {
                      const groupKey = section.groupKey;
                      // Skip if any ancestor is collapsed
                      if (section.parentKey && isAncestorCollapsed(section.parentKey)) return null;
                      const isCollapsed = groupKey ? collapsedGroups.has(groupKey) : false;
                      const depthColor = depthColors[section.depth] || "var(--color-primary)";
                      const color = section.color || depthColor;

                      return (
                        <React.Fragment key={groupKey ? `${groupKey}:${section.type}` : "flat"}>
                          {/* Group header row (only for header-type sections) — droppable for DnD */}
                          {section.type === "header" && groupKey && (
                            <DroppableGroupHeader groupKey={groupKey}>
                              <td
                                colSpan={totalColSpan}
                                className="py-1.5 cursor-pointer"
                                style={{ borderLeft: `3px solid ${color}`, paddingLeft: `${12 + section.depth * 20}px` }}
                                onClick={() => toggleGroupCollapse(groupKey)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px]" style={{ color, display: "inline-block", transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.15s" }}>&#9654;</span>
                                  <span className="text-xs font-semibold" style={{ color }}>{section.name}</span>
                                  <span
                                    className="text-[10px] px-1.5 py-0 rounded-full font-medium"
                                    style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
                                  >
                                    {section.rowCount}
                                  </span>
                                  {/* Aggregate badges */}
                                  {section.aggregate?.map((agg, ai) => (
                                    <span key={ai} className="text-[9px] px-1 py-0 rounded" style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-surface)" }}>{agg.label}: {agg.value}</span>
                                  ))}
                                  {/* Add record to this group (only for leaf group headers — headers whose next section is rows) */}
                                  {(() => {
                                    const nextSection = sections[si + 1];
                                    const isLeaf = nextSection?.type === "rows" && nextSection?.groupKey === groupKey;
                                    if (!isLeaf) return null;
                                    return (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!activeGrouping) return;
                                          const cfg2 = TABLE_CONFIGS[subTab];
                                          const newRecord: Record<string, unknown> = {};
                                          // Pre-fill from matching rule's first condition
                                          const matchingRule = activeGrouping.rules.find((r) => r.groupName === section.name);
                                          if (matchingRule) {
                                            const derived = deriveValueFromRule(matchingRule, "");
                                            if (derived) newRecord[derived.column] = derived.value;
                                          } else if (activeGrouping.autoGroup) {
                                            newRecord[activeGrouping.autoGroup.column] = section.name;
                                          }
                                          const nameKey = cfg2.nameKey || "name";
                                          newRecord[nameKey] = "";
                                          applyLocalCreate(subTab, newRecord, `Add to group "${section.name}"`);
                                          if (isCollapsed && groupKey) toggleGroupCollapse(groupKey);
                                        }}
                                        className="text-[12px] w-5 h-5 flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                                        style={{ color, fontWeight: 700 }}
                                        title={`Add new ${TABLE_CONFIGS[subTab]?.label?.replace(/s$/, "") || "record"} to "${section.name}"`}
                                      >+</button>
                                    );
                                  })()}
                                </div>
                              </td>
                            </DroppableGroupHeader>
                          )}
                          {/* Data rows (only for rows-type sections, hidden when parent group is collapsed) */}
                          {section.type === "rows" && !isCollapsed && !isAncestorCollapsed(section.groupKey || "") && section.rows.map((row, idx) => {
                const rowId = row[cfg.idKey];
                const isFeatures = subTab === "features";
                const isDataTables = subTab === "data_tables";
                const isModules = subTab === "modules";
                const moduleFeatureCount = isModules ? (featureCountsByModule.get(rowId as number) || 0) : 0;
                const pickerMode = isDataTables && tablePickerOpen;
                const isExpandable = isFeatures || isDataTables || isModules; // modules always get the column for layout
                const isExpanded = isFeatures
                  ? expandedFeatureId === rowId
                  : isDataTables
                  ? expandedTableIds.has(rowId as number)
                  : isModules
                  ? expandedModuleId === rowId
                  : false;

                return (
                  <React.Fragment key={String(rowId ?? idx)}>
                    <tr
                      className={`border-b transition-colors hover:bg-black/5 ${(isFeatures || pickerMode || (isDataTables && fkPickMode)) ? "cursor-pointer" : ""}`}
                      style={{ borderColor: "var(--color-divider)", outline: (isDataTables && fkPickMode) ? "1px dashed var(--color-primary)" : undefined, outlineOffset: -1, opacity: dragActiveRowId === String(rowId) ? 0.3 : undefined, ...(liveMode && liveFailedRows.has(`${subTab}:${rowId}`) ? { borderLeft: "3px solid #e05555" } : {}), ...(getRowHeight(subTab) ? { height: getRowHeight(subTab), maxHeight: getRowHeight(subTab), overflow: "hidden" } : {}) }}
                      onClick={(isDataTables && fkPickMode) ? () => {
                        // FK pick: clicking a table row sets Ref Table on the source field
                        const targetTableId = rowId as number;
                        if (fkPickMode.isNewField) {
                          // Route to new-field change handler
                          setInlineNewField((prev) => prev ? { ...prev, isForeignKey: true, referencesTable: targetTableId, referencesField: null } : null);
                        } else {
                          const sourceTableId = fkPickMode.sourceTableId;
                          const sourceFieldId = fkPickMode.sourceFieldId;
                          const cachedFields = tableFieldsCache[sourceTableId] || [];
                          const sourceField = cachedFields.find((f) => f.fieldId === sourceFieldId);
                          if (sourceField) {
                            const updated = { ...sourceField, referencesTable: targetTableId, referencesField: null, isForeignKey: true };
                            setTableFieldsCache((prev) => ({
                              ...prev,
                              [sourceTableId]: (prev[sourceTableId] || []).map((f) => f.fieldId === sourceFieldId ? { ...f, ...updated } : f),
                            }));
                            applyLocalUpdate("data_fields", updated, `FK pick: set referencesTable to ${resolveFK("data_tables", targetTableId)}`);
                          }
                        }
                        setFkPickMode(null);
                      } : pickerMode ? () => {
                        // Expand this table and initialize inline new field
                        if (!expandedTableIds.has(rowId as number)) toggleTableExpand(rowId as number);
                        // Discard any prior inline field if switching tables
                        const featureRow = inlineNewField?.featureRow || (tablePickerCallback as unknown as { featureRow?: Record<string, unknown> })?.featureRow;
                        const noteKey = inlineNewField?.noteKey || "notes";
                        setInlineNewField({
                          tableId: rowId as number, featureRow: featureRow || {}, noteKey,
                          fieldName: inlineNewField?.fieldName ?? "",
                          dataType: "", isRequired: false, isUnique: false,
                          isForeignKey: false, referencesTable: null, referencesField: null,
                        });
                      } : isFeatures ? () => setExpandedFeatureId(isExpanded ? null : (rowId as number)) : undefined}
                    >
                      {/* Drag grip (only when grouped) */}
                      {flatSections && !tablePickerOpen && (
                        <td className="py-2 px-1 w-6" style={{ color: "var(--color-text-muted)", opacity: dragActiveRowId === String(rowId) ? 0.3 : 1 }}>
                          <DragGrip id={`drag-${rowId}`} groupName={section.name || ""} />
                        </td>
                      )}
                      {/* Expand chevron for features, data_tables, modules (modules: hidden when 0 features) */}
                      {isExpandable && (
                        <td
                          className={`py-2 pl-3 pr-1 w-7 ${(isModules && moduleFeatureCount === 0) ? "" : "cursor-pointer"}`}
                          style={{ color: "var(--color-text-muted)", padding: pickerMode ? "10px 10px 10px 12px" : undefined }}
                          onClick={isDataTables ? (e) => { e.stopPropagation(); toggleTableExpand(rowId as number); } : (isModules && moduleFeatureCount > 0) ? (e) => { e.stopPropagation(); toggleModuleExpand(rowId as number); } : undefined}
                        >
                          {/* Hide chevron for modules with 0 features */}
                          {!(isModules && moduleFeatureCount === 0) && (
                            <span className="text-[10px] select-none" style={{ display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>&#9654;</span>
                          )}
                        </td>
                      )}
                      {visibleMixedCols.map((item) => {
                        if (item.type === "sep") {
                          return (
                            <td
                              key={item.sep.id}
                              className="p-0"
                              style={{
                                width: `${item.sep.thickness}px`,
                                minWidth: `${item.sep.thickness}px`,
                                maxWidth: `${item.sep.thickness}px`,
                                backgroundColor: item.sep.color === "transparent" ? "transparent" : item.sep.color,
                                padding: 0,
                              }}
                            />
                          );
                        }
                        const col = item.col;
                        const cdCfg = getColDisplay(subTab, col.key);
                        // Merge template settings (base) with localStorage overrides (top)
                        const tplForCell = getColumnTemplate(TAB_ENTITY_MAP[subTab] || subTab, col.key);
                        const mergedFontSize = cdCfg.fontSize ?? tplForCell?.fontSize ?? undefined;
                        const mergedFontColor = cdCfg.fontColor ?? tplForCell?.fontColor ?? undefined;
                        const mergedFontBold = cdCfg.fontBold ?? tplForCell?.fontBold ?? undefined;
                        const mergedFontUnderline = cdCfg.fontUnderline ?? tplForCell?.fontUnderline ?? undefined;
                        const mergedWrap = cdCfg.wrap ?? tplForCell?.wrap ?? false;
                        const mergedLines = cdCfg.lines ?? tplForCell?.lines ?? 1;
                        const isMultiLine = mergedWrap && mergedLines > 1;
                        const lineCount = mergedLines;
                        const isEditingThis = editingCell?.rowId === rowId && editingCell?.colKey === col.key;
                        const forceExpand = isDataTables && isExpanded && col.key === "descriptionPurpose";
                        return (
                        <td key={col.key} className={`py-2 ${isDataTables && col.key === "tableName" ? "pl-1 pr-3" : "px-3"} ${forceExpand ? "" : "max-w-[250px] overflow-hidden"}`} style={{ color: mergedFontColor || "var(--color-text)", fontSize: mergedFontSize ? `${mergedFontSize}px` : undefined, fontWeight: mergedFontBold ? "bold" : undefined, textDecoration: mergedFontUnderline ? "underline" : undefined, textAlign: tplForCell?.alignment || undefined, ...(forceExpand ? { whiteSpace: "normal", wordBreak: "break-word", overflow: "visible", textOverflow: "clip", maxWidth: 375 } : isMultiLine && !isEditingThis ? { whiteSpace: "normal", wordBreak: "break-word", maxHeight: `${lineCount * 1.35}em`, overflow: "hidden" } : !isEditingThis ? { whiteSpace: "nowrap", textOverflow: "ellipsis" } : {}) }}>
                          {col.type === "ref-features" ? (
                            (() => {
                              const id = row[cfg.idKey] as number;
                              const refs = subTab === "data_tables"
                                ? featureRefMaps.tableToFeatures.get(id)
                                : subTab === "data_fields"
                                ? featureRefMaps.fieldToFeatures.get(id)
                                : null;
                              if (!refs || refs.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
                              const tooltipText = refs.map((r) => r.moduleNames ? `${r.featureName} (${r.moduleNames})` : r.featureName).join("\n");
                              return (
                                <span
                                  className="px-1.5 py-0.5 rounded text-xs cursor-default"
                                  style={{ backgroundColor: "rgba(91,192,222,0.12)", border: "1px solid rgba(91,192,222,0.3)", color: "#5bc0de" }}
                                  title={tooltipText}
                                >
                                  {refs.length} {refs.length === 1 ? "feature" : "features"}
                                </span>
                              );
                            })()
                          ) : col.type === "ref-projects" ? (
                            (() => {
                              const entityId = row[cfg.idKey] as number;
                              const depTypeMap: Record<string, string> = { data_tables: "data_table", data_fields: "data_field", modules: "module", features: "feature", concepts: "concept" };
                              const depType = depTypeMap[subTab] || null;
                              if (!depType) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
                              const codeChanges = (data.code_changes || []) as Array<Record<string, unknown>>;
                              const projectRows = (data.projects || []) as Array<Record<string, unknown>>;
                              const projectIds = new Set<number>();
                              for (const cc of codeChanges) {
                                const deps = (cc.dependencies || []) as Array<{ type: string; id: number }>;
                                if (Array.isArray(deps) && deps.some(d => d.type === depType && d.id === entityId)) {
                                  projectIds.add(cc.projectId as number);
                                }
                              }
                              if (projectIds.size === 0) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
                              // Find most recent code change branch per project for this entity
                              const projectLatest = new Map<number, { branch: string; updatedAt: string }>();
                              for (const cc of codeChanges) {
                                const deps = (cc.dependencies || []) as Array<{ type: string; id: number }>;
                                if (Array.isArray(deps) && deps.some(d => d.type === depType && d.id === entityId)) {
                                  const pid = cc.projectId as number;
                                  const ts = String(cc.updatedAt ?? "");
                                  const prev = projectLatest.get(pid);
                                  if (!prev || ts > prev.updatedAt) {
                                    projectLatest.set(pid, { branch: String(cc.branch ?? ""), updatedAt: ts });
                                  }
                                }
                              }
                              const branchLabels: Record<string, { short: string; color: string; label: string }> = {
                                live:          { short: "L", color: "#4ecb71", label: "Live" },
                                primary_dev:   { short: "P", color: "#f0c040", label: "Primary Dev" },
                                secondary_dev: { short: "S", color: "#e8853d", label: "Secondary Dev" },
                              };
                              const projInfos = [...projectIds].map(pid => {
                                const p = projectRows.find(pr => (pr.projectId as number) === pid);
                                const name = p ? String(p.projectName) : `#${pid}`;
                                const latestBranch = projectLatest.get(pid)?.branch || "";
                                return { pid, name, latestBranch };
                              });
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {projInfos.map((p) => {
                                    const bl = branchLabels[p.latestBranch] || { short: "?", color: "var(--color-text-muted)", label: p.latestBranch };
                                    return (
                                      <span
                                        key={p.pid}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-default"
                                        style={{ backgroundColor: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)", color: "#a855f7" }}
                                        title={`${p.name} — latest: ${bl.label}`}
                                      >
                                        {p.name}
                                        <span
                                          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] font-bold"
                                          style={{ backgroundColor: bl.color, color: "#fff" }}
                                        >
                                          {bl.short}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              );
                            })()
                          ) : (
                            <span className={isDataTables && col.key === "tableName" ? "inline-flex items-center gap-1.5" : ""}>
                              {/* Show full description text when data table row is expanded */}
                              {isDataTables && isExpanded && col.key === "descriptionPurpose"
                                ? <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(row[col.key] ?? "")}</span>
                                : !cfg.readOnly ? renderInlineCell(col, row) : renderCell(col, row[col.key])}
                              {/* Field count badge on tableName column — also triggers expand */}
                              {isDataTables && col.key === "tableName" && (
                                <span
                                  className="text-[9px] font-mono px-1 py-0.5 rounded whitespace-nowrap cursor-pointer hover:brightness-125"
                                  style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}
                                  onClick={(e) => { e.stopPropagation(); toggleTableExpand(rowId as number); }}
                                >
                                  {fieldCountsByTable.get(rowId as number) || 0} fields
                                </span>
                              )}
                              {/* Feature count + add moved to Platforms column */}
                            </span>
                          )}
                        </td>
                      );
                      })}
                      {!cfg.readOnly && !pickerMode && (
                        <td className="py-1 px-1" style={{ position: "sticky", right: 0, zIndex: 1, backgroundColor: "var(--color-background)" }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 20px)", gap: 3, justifyContent: "center" }}>
                            {cfg.columns.some((c) => c.hideInGrid) && (
                              <button onClick={() => openEdit(row)} className="flex items-center justify-center rounded" style={{ width: 18, height: 18, color: "var(--color-text-muted)", fontSize: 9, border: "1px solid var(--color-divider)" }} title="More / Edit hidden fields">⋯</button>
                            )}
                            {isFeatures && (
                              <button onClick={() => setImpactFeatureId(row.featureId as number)} className="flex items-center justify-center rounded" style={{ width: 18, height: 18, color: "#a855f7", fontSize: 9, border: "1px solid #a855f740" }} title="Impact analysis">⚡</button>
                            )}
                            {(subTab === "features" || subTab === "modules" || subTab === "concepts") && (
                              <button
                                onClick={() => {
                                  const entityType = subTab === "features" ? "feature" : subTab === "modules" ? "module" : "concept";
                                  const nameKey = cfg.nameKey || cfg.idKey;
                                  setCodeChangeEntity({ type: entityType, id: rowId as number, name: String(row[nameKey] ?? `#${rowId}`) });
                                }}
                                className="flex items-center justify-center rounded"
                                style={{ width: 18, height: 18, color: "#4ecb71", fontSize: 9, fontWeight: 700, border: "1px solid #4ecb7140" }}
                                title="Create a code change record"
                              >+C</button>
                            )}
                            <button onClick={() => confirmDelete(row)} className="flex items-center justify-center rounded" style={{ width: 18, height: 18, color: "#e05555", fontSize: 9, border: "1px solid #e0555540" }} title="Delete">✕</button>
                          </div>
                        </td>
                      )}
                    </tr>

                    {/* Expanded field rows for data_tables */}
                    {isDataTables && isExpanded && (
                      <ExpandedFieldRows
                        tableId={rowId as number}
                        fields={tableFieldsCache[rowId as number] || []}
                        loading={tableFieldsLoading.has(rowId as number)}
                        colSpan={visibleMixedCols.length + 2}
                        search={search}
                        searchMode={dataTableSearchMode}
                        resolveFK={resolveFK}
                        getFKOptions={getFKOptions}
                        featureRefMap={featureRefMaps.fieldToFeatures}
                        hiddenCols={hiddenFieldCols}
                        onToggleCol={(key) => setHiddenFieldCols((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); setHiddenFieldColsArr([...n]); return n; })}
                        onFieldUpdate={(updatedField) => {
                          // Update tableFieldsCache locally
                          setTableFieldsCache((prev) => {
                            const tid = rowId as number;
                            const existing = prev[tid] || [];
                            return { ...prev, [tid]: existing.map((f) => f.fieldId === updatedField.fieldId ? { ...f, ...updatedField } : f) };
                          });
                          // Push to data_fields pending changes
                          applyLocalUpdate("data_fields", updatedField, `Inline edit from Data Tables`);
                        }}
                        newFieldRow={pickerMode && inlineNewField?.tableId === (rowId as number) ? inlineNewField : null}
                        onNewFieldChange={pickerMode ? (updates) => setInlineNewField((prev) => prev ? { ...prev, ...updates } : null) : undefined}
                        fkPickMode={fkPickMode}
                        onStartFkPick={(fid, fname) => setFkPickMode({ sourceFieldId: fid, sourceTableId: rowId as number, fieldName: fname, isNewField: fid === -1 })}
                        onFkPickField={(targetTableId, targetFieldId) => {
                          if (!fkPickMode) return;
                          if (fkPickMode.isNewField) {
                            setInlineNewField((prev) => prev ? { ...prev, isForeignKey: true, referencesTable: targetTableId, referencesField: targetFieldId } : null);
                          } else {
                            const srcTid = fkPickMode.sourceTableId;
                            const srcFid = fkPickMode.sourceFieldId;
                            const cachedFields = tableFieldsCache[srcTid] || [];
                            const sourceField = cachedFields.find((f) => f.fieldId === srcFid);
                            if (sourceField) {
                              const updated = { ...sourceField, referencesTable: targetTableId, referencesField: targetFieldId, isForeignKey: true };
                              setTableFieldsCache((prev) => ({
                                ...prev,
                                [srcTid]: (prev[srcTid] || []).map((f) => f.fieldId === srcFid ? { ...f, ...updated } : f),
                              }));
                              applyLocalUpdate("data_fields", updated, `FK pick: set ref to ${resolveFK("data_tables", targetTableId)}.${resolveFK("data_fields", targetFieldId)}`);
                            }
                          }
                          setFkPickMode(null);
                        }}
                        onFieldDelete={!pickerMode ? (field) => {
                          const tid = rowId as number;
                          setTableFieldsCache((prev) => ({
                            ...prev,
                            [tid]: (prev[tid] || []).filter((f) => f.fieldId !== field.fieldId),
                          }));
                          applyLocalDelete("data_fields", field, `Delete field ${field.fieldName} from ${resolveFK("data_tables", tid)}`);
                        } : undefined}
                        onAddField={!pickerMode ? (field) => {
                          const tid = rowId as number;
                          applyLocalCreate("data_fields", field, `Add field ${field.fieldName} to ${resolveFK("data_tables", tid)}`);
                          // Also add to local cache so it appears immediately
                          setTableFieldsCache((prev) => ({
                            ...prev,
                            [tid]: [...(prev[tid] || []), field],
                          }));
                        } : undefined}
                      />
                    )}

                    {/* Expanded detail panel for features */}
                    {isFeatures && isExpanded && (() => {
                      // Platforms come from the feature's own platforms field
                      const featurePlatforms = new Set<string>(
                        Array.isArray(row.platforms) ? (row.platforms as string[]) : ["Web App"]
                      );
                      const hasAnyNative = featurePlatforms.has("Android") || featurePlatforms.has("Apple") || featurePlatforms.has("Other");

                      // Feature images for mention autocomplete
                      const featureImages = (Array.isArray(row.images) ? row.images : EMPTY_IMAGES) as Array<{ id: string; url: string; title: string; createdAt: string }>;

                      // Navigation handler for double-clicking references
                      // Create a new planned table or field immediately (needs real ID for reference token)
                      const handleCreateRef = async (type: "table" | "field", name: string, options?: { parentTableId?: number; description?: string; recordOwnership?: string; tableStatus?: string }): Promise<{ id: number; name: string } | null> => {
                        try {
                          if (type === "table") {
                            const res = await fetch("/api/schema-planner?table=_splan_data_tables", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ table: "_splan_data_tables", data: { tableName: name, tableStatus: options?.tableStatus || "planned", descriptionPurpose: options?.description || null, recordOwnership: options?.recordOwnership || "org_private" }, reasoning: `Created table "${name}" from feature notes` }),
                            });
                            if (!res.ok) return null;
                            const created = await res.json();
                            // Add to local data so it appears in autocomplete immediately
                            setData((prev) => ({ ...prev, data_tables: [...(prev.data_tables || []), created] }));
                            return { id: created.tableId, name: created.tableName };
                          } else {
                            const parentTableId = options?.parentTableId;
                            if (!parentTableId) return null;
                            const res = await fetch("/api/schema-planner?table=_splan_data_fields", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ table: "_splan_data_fields", data: { fieldName: name, dataTableId: parentTableId, fieldStatus: "planned", dataType: "Text" }, reasoning: `Created planned field "${name}" from feature notes` }),
                            });
                            if (!res.ok) return null;
                            const created = await res.json();
                            setData((prev) => ({ ...prev, data_fields: [...(prev.data_fields || []), created] }));
                            return { id: created.fieldId, name: created.fieldName };
                          }
                        } catch { return null; }
                      };

                      const openTablePickerForField = (fieldSnakeName: string, _fieldRawName: string) => {
                        savedSubTabRef.current = subTab;
                        setSubTab("data_tables");
                        setTablePickerOpen(true);
                        // Pre-populate field name; table selection happens via row click in picker mode
                        setInlineNewField({
                          tableId: -1, featureRow: row, noteKey: "notes",
                          fieldName: fieldSnakeName, dataType: "", isRequired: false, isUnique: false,
                          isForeignKey: false, referencesTable: null, referencesField: null,
                        });
                      };

                      const handleRefNav = (type: string, name: string) => {
                        if (type === "table") {
                          const tbl = (data.data_tables || []).find((t) => String(t.tableName) === name);
                          if (tbl) setRefSummaryPopup({ type: "table", record: tbl as Record<string, unknown> });
                        } else if (type === "field") {
                          const parts = name.split(".");
                          const tblName = parts[0];
                          const fieldName = parts.slice(1).join(".");
                          const tbl = (data.data_tables || []).find((t) => String(t.tableName) === tblName);
                          if (tbl) setRefSummaryPopup({ type: "table", record: tbl as Record<string, unknown>, highlightField: fieldName });
                        } else if (type === "image") {
                          // Find image URL from this feature's images
                          const imgs = (Array.isArray(row.images) ? row.images : []) as Array<{ id: string; url: string; title: string }>;
                          const img = imgs.find((im) => im.title === name);
                          if (img?.url) setImageViewer({ url: img.url, title: img.title, x: 100, y: 100, width: 1200, height: 600, zoom: 1, originX: 50, originY: 50 });
                        } else if (type === "module") {
                          const mod = (data.modules || []).find((m) => String(m.moduleName) === name);
                          if (mod) setRefSummaryPopup({ type: "module", record: mod as Record<string, unknown> });
                        } else if (type === "feature") {
                          const feat = (data.features || []).find((f) => String(f.featureName) === name);
                          if (feat) setRefSummaryPopup({ type: "feature", record: feat as Record<string, unknown> });
                        } else if (type === "concept") {
                          const con = (data.concepts || []).find((c) => String(c.conceptName) === name);
                          if (con) setRefSummaryPopup({ type: "concept", record: con as Record<string, unknown> });
                        } else if (type === "research") {
                          const res = (data.research || []).find((r) => String(r.title) === name);
                          if (res) setRefSummaryPopup({ type: "research", record: res as Record<string, unknown> });
                        }
                      };

                      // Filter visible note sections based on feature's own platforms
                      const visibleSections = PLATFORM_NOTE_SECTIONS.filter((sec) => {
                        if ("showWhenAnyNative" in sec && sec.showWhenAnyNative) return hasAnyNative;
                        return sec.platform ? featurePlatforms.has(sec.platform) : false;
                      });

                      return (
                      <tr className="border-b" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}>
                        <td colSpan={visibleMixedCols.length + 2} className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-3 text-xs">
                            {/* Web App Notes — full width */}
                            {(() => {
                              const webAppSec = visibleSections.find((s) => s.key === "notes");
                              if (!webAppSec) return null;
                              const platformColor = PLATFORM_COLORS["Web App"];
                              return (
                                <FullscreenNoteWrapper label={webAppSec.label} platformColor={platformColor.text}>
                                  <FeatureMentionField
                                    initial={String(row[webAppSec.key] ?? "")}
                                    initialFmt={(Array.isArray(row[webAppSec.fmtKey]) ? row[webAppSec.fmtKey] : []) as FmtRange[]}
                                    onCommit={(text, fmt, collapsed, tables) => {
                                      const prev = (row.collapsedSections as Record<string, unknown>) ?? {};
                                      const prevTables = (row.embeddedTables as Record<string, unknown>) ?? {};
                                      const updated = { ...row, [webAppSec.key]: text || null, [webAppSec.fmtKey]: fmt, ...(collapsed !== undefined ? { collapsedSections: { ...prev, [webAppSec.key]: Object.keys(collapsed).length > 0 ? collapsed : undefined } } : {}), ...(tables !== undefined ? { embeddedTables: { ...prevTables, [webAppSec.key]: Object.keys(tables).length > 0 ? tables : undefined } } : {}) };
                                      applyLocalUpdate("features", updated, `Inline edit: ${webAppSec.key}`);
                                    }}
                                    tables={mentionTables}
                                    fields={mentionFields}
                                    tableNames={mentionTableNames}
                                    fieldDisplayNames={mentionFieldDisplayNames}
                                    images={featureImages}
                                    modules={mentionModules}
                                    features={mentionFeatures}
                                concepts={mentionConcepts}
                                research={mentionResearch}
                                    onRefNavigate={handleRefNav}
                                    onCreateRef={handleCreateRef}
                                    tableDetails={data.data_tables as Array<Record<string, unknown>>}
                                    onPickTableForField={openTablePickerForField}
                                    placeholder={`${webAppSec.label}... type ( to reference a table, field, or image`}
                                    initialCollapsed={((row.collapsedSections as Record<string, Record<string, { body: string; bodyFmt: FmtRange[] }>> | null) ?? {})[webAppSec.key]}
                                    onCollapsedChange={(collapsed) => {
                                      const prev = (row.collapsedSections as Record<string, unknown>) ?? {};
                                      const updated = { ...row, collapsedSections: { ...prev, [webAppSec.key]: Object.keys(collapsed).length > 0 ? collapsed : undefined } };
                                      applyLocalUpdate("features", updated, `Collapse state: ${webAppSec.key}`);
                                    }}
                                    initialTables={((row.embeddedTables as Record<string, Record<string, unknown>> | null) ?? {})[webAppSec.key] as Record<string, import("./schema-planner/types").EmbeddedTable> | undefined}
                                    onTablesChange={(tbls) => {
                                      const prev = (row.embeddedTables as Record<string, unknown>) ?? {};
                                      const updated = { ...row, embeddedTables: { ...prev, [webAppSec.key]: Object.keys(tbls).length > 0 ? tbls : undefined } };
                                      applyLocalUpdate("features", updated, `Table change: ${webAppSec.key}`);
                                    }}
                                    noteContext={{ module: section.name || undefined, moduleColor: moduleColColor, feature: String(row.featureName || ""), featureColor: featureColColor, field: webAppSec.label, fieldColor: "#4ecb71" }}
                                  />
                                </FullscreenNoteWrapper>
                              );
                            })()}
                            {/* Other platform note sections — 2-column grid */}
                            {visibleSections.filter((s) => s.key !== "notes").length > 0 && (
                            <div className="grid grid-cols-2 gap-4">
                              {visibleSections.filter((s) => s.key !== "notes").map((sec) => {
                                const platformColor = sec.platform ? PLATFORM_COLORS[sec.platform] : (sec.key === "nativeNotes" ? { bg: "rgba(242,182,97,0.1)", text: "#f2b661", border: "#f2b66133" } : null);
                                return (
                                  <FullscreenNoteWrapper key={sec.key} label={sec.label} platformColor={platformColor?.text || "#f2b661"}>
                                    <FeatureMentionField
                                      initial={String(row[sec.key] ?? "")}
                                      initialFmt={(Array.isArray(row[sec.fmtKey]) ? row[sec.fmtKey] : []) as FmtRange[]}
                                      onCommit={(text, fmt, collapsed, tables) => {
                                        const prev = (row.collapsedSections as Record<string, unknown>) ?? {};
                                        const prevTables = (row.embeddedTables as Record<string, unknown>) ?? {};
                                        const updated = { ...row, [sec.key]: text || null, [sec.fmtKey]: fmt, ...(collapsed !== undefined ? { collapsedSections: { ...prev, [sec.key]: Object.keys(collapsed).length > 0 ? collapsed : undefined } } : {}), ...(tables !== undefined ? { embeddedTables: { ...prevTables, [sec.key]: Object.keys(tables).length > 0 ? tables : undefined } } : {}) };
                                        applyLocalUpdate("features", updated, `Inline edit: ${sec.key}`);
                                      }}
                                      tables={mentionTables}
                                      fields={mentionFields}
                                      tableNames={mentionTableNames}
                                      fieldDisplayNames={mentionFieldDisplayNames}
                                      images={featureImages}
                                      modules={mentionModules}
                                      features={mentionFeatures}
                                concepts={mentionConcepts}
                                research={mentionResearch}
                                      onRefNavigate={handleRefNav}
                                      onCreateRef={handleCreateRef}
                                      tableDetails={data.data_tables as Array<Record<string, unknown>>}
                                      onPickTableForField={openTablePickerForField}
                                      placeholder={`${sec.label}... type ( to reference a table, field, or image`}
                                      initialCollapsed={((row.collapsedSections as Record<string, Record<string, { body: string; bodyFmt: FmtRange[] }>> | null) ?? {})[sec.key]}
                                      onCollapsedChange={(collapsed) => {
                                        const prev = (row.collapsedSections as Record<string, unknown>) ?? {};
                                        const updated = { ...row, collapsedSections: { ...prev, [sec.key]: Object.keys(collapsed).length > 0 ? collapsed : undefined } };
                                        applyLocalUpdate("features", updated, `Collapse state: ${sec.key}`);
                                      }}
                                      initialTables={((row.embeddedTables as Record<string, Record<string, unknown>> | null) ?? {})[sec.key] as Record<string, import("./schema-planner/types").EmbeddedTable> | undefined}
                                      onTablesChange={(tbls) => {
                                        const prev = (row.embeddedTables as Record<string, unknown>) ?? {};
                                        const updated = { ...row, embeddedTables: { ...prev, [sec.key]: Object.keys(tbls).length > 0 ? tbls : undefined } };
                                        applyLocalUpdate("features", updated, `Table change: ${sec.key}`);
                                      }}
                                      noteContext={{ module: section.name || undefined, moduleColor: moduleColColor, feature: String(row.featureName || ""), featureColor: featureColColor, field: sec.label, fieldColor: sec.platform ? (PLATFORM_COLORS[sec.platform]?.text || "#f2b661") : "#f2b661" }}
                                    />
                                  </FullscreenNoteWrapper>
                                );
                              })}
                            </div>
                            )}
                            {/* Implementation — with mention autocomplete */}
                            <div>
                              <label className="font-semibold block mb-1" style={{ color: "var(--color-text-muted)" }}>
                                Implementation <span className="font-normal" style={{ color: "var(--color-text-muted)", opacity: 0.6 }}>— type ( to reference</span>
                              </label>
                              <FeatureMentionField
                                initial={String(row.implementation ?? "")}
                                initialFmt={(Array.isArray(row.implFmt) ? row.implFmt : []) as FmtRange[]}
                                onCommit={(text, fmt, collapsed, tables) => {
                                  const prev = (row.collapsedSections as Record<string, unknown>) ?? {};
                                  const prevTables = (row.embeddedTables as Record<string, unknown>) ?? {};
                                  const updated = { ...row, implementation: text || null, implFmt: fmt, ...(collapsed !== undefined ? { collapsedSections: { ...prev, implementation: Object.keys(collapsed).length > 0 ? collapsed : undefined } } : {}), ...(tables !== undefined ? { embeddedTables: { ...prevTables, implementation: Object.keys(tables).length > 0 ? tables : undefined } } : {}) };
                                  applyLocalUpdate("features", updated, "Inline edit: implementation");
                                }}
                                tables={mentionTables}
                                fields={mentionFields}
                                tableNames={mentionTableNames}
                                fieldDisplayNames={mentionFieldDisplayNames}
                                images={featureImages}
                                modules={mentionModules}
                                features={mentionFeatures}
                                concepts={mentionConcepts}
                                research={mentionResearch}
                                onRefNavigate={handleRefNav}
                                onCreateRef={handleCreateRef}
                                      tableDetails={data.data_tables as Array<Record<string, unknown>>}
                                      onPickTableForField={openTablePickerForField}
                                placeholder="Implementation details... type ( to reference a table, field, or image"
                                initialCollapsed={((row.collapsedSections as Record<string, Record<string, { body: string; bodyFmt: FmtRange[] }>> | null) ?? {})["implementation"]}
                                onCollapsedChange={(collapsed) => {
                                  const prev = (row.collapsedSections as Record<string, unknown>) ?? {};
                                  const updated = { ...row, collapsedSections: { ...prev, implementation: Object.keys(collapsed).length > 0 ? collapsed : undefined } };
                                  applyLocalUpdate("features", updated, "Collapse state: implementation");
                                }}
                                initialTables={((row.embeddedTables as Record<string, Record<string, unknown>> | null) ?? {})["implementation"] as Record<string, import("./schema-planner/types").EmbeddedTable> | undefined}
                                onTablesChange={(tbls) => {
                                  const prev = (row.embeddedTables as Record<string, unknown>) ?? {};
                                  const updated = { ...row, embeddedTables: { ...prev, implementation: Object.keys(tbls).length > 0 ? tbls : undefined } };
                                  applyLocalUpdate("features", updated, "Table change: implementation");
                                }}
                                noteContext={{ module: section.name || undefined, moduleColor: moduleColColor, feature: String(row.featureName || ""), featureColor: featureColColor, field: "Implementation", fieldColor: "var(--color-text-muted)" }}
                              />
                            </div>
                            {/* ─── Depended On By ─── */}
                            <DependedOnBySection featureId={row.featureId as number} />
                            {/* ─── Test Cases Grid ─── */}
                            <FeatureTestsGrid featureId={row.featureId as number} featureName={String(row.featureName ?? "")} allFeatures={(data.features || []).map(f => ({ featureId: f.featureId as number, featureName: String(f.featureName ?? "") }))} />
                            {/* ─── Implementation Steps Grid ─── */}
                            <ImplementationStepsGrid featureId={row.featureId as number} featureName={String(row.featureName ?? "")} />
                            {/* ─── Prototypes Grid ─── */}
                            <PrototypesGrid featureId={row.featureId as number} featureName={String(row.featureName ?? "")} allFeatures={(data.features || []).map(f => ({ featureId: f.featureId as number, featureName: String(f.featureName ?? "") }))} />
                            {/* ─── References (extracted from notes) ─── */}
                            {(() => {
                              const notesSections = [
                                { key: "notes", label: "Web App", text: (row.notes as string) || "" },
                                { key: "nativeNotes", label: "Native", text: (row.nativeNotes as string) || "" },
                                { key: "androidNotes", label: "Android", text: (row.androidNotes as string) || "" },
                                { key: "appleNotes", label: "Apple", text: (row.appleNotes as string) || "" },
                                { key: "otherNotes", label: "Other", text: (row.otherNotes as string) || "" },
                              ];
                              const refs = extractRefsFromNotes(notesSections, resolveTableName, resolveFieldName);
                              return (
                                <div>
                                  <label className="font-semibold block mb-1" style={{ color: "var(--color-text-muted)" }}>References (extracted from notes)</label>
                                  {refs.length > 0 ? (
                                    <table className="text-xs" style={{ borderCollapse: "collapse" }}>
                                      <thead>
                                        <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
                                          <th className="text-left px-2 py-1 w-8" style={{ color: "var(--color-text-muted)" }}>#</th>
                                          <th className="text-left px-2 py-1 w-16" style={{ color: "var(--color-text-muted)" }}>Type</th>
                                          <th className="text-left px-2 py-1" style={{ color: "var(--color-text-muted)" }}>Name</th>
                                          <th className="text-left px-2 py-1" style={{ color: "var(--color-text-muted)" }}>Line</th>
                                          <th className="text-left px-2 py-1" style={{ color: "var(--color-text-muted)" }}>Source</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {refs.map((ref, idx) => (
                                          <tr key={`${ref.type}:${ref.name}`} style={{ borderBottom: "1px solid var(--color-divider)" }}>
                                            <td className="px-2 py-1" style={{ color: "var(--color-text-muted)" }}>{idx + 1}</td>
                                            <td className="px-2 py-1" style={{ color: ref.type === "Table" ? "#a855f7" : ref.type === "Field" ? "#5bc0de" : "#4ecb71" }}>{ref.type}</td>
                                            <td className="px-2 py-1" style={{ color: "var(--color-text)" }}>{ref.type === "Image" ? `🎨 ${ref.name}` : ref.name}</td>
                                            <td className="px-2 py-1" style={{ color: "var(--color-text-muted)" }}>
                                              {ref.lines.length === 1 ? ref.lines[0] : `${ref.lines.length}(${ref.lines.join(",")})`}
                                            </td>
                                            <td className="px-2 py-1" style={{ color: "var(--color-text-muted)" }}>{ref.source}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>No references found — type (table_name) in notes to reference tables, fields, or images</span>
                                  )}
                                </div>
                              );
                            })()}
                            {/* ─── Images ─── */}
                            <FeatureImageGallery
                              images={(Array.isArray(row.images) ? row.images : []) as Array<{ id: string; url: string; title: string; createdAt: string }>}
                              featureId={row.featureId as number}
                              onUpdate={(images) => {
                                const updated = { ...row, images };
                                applyLocalUpdate("features", updated, "Updated images");
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                      );
                    })()}

                    {/* ═══════ Expanded features under a Module row ═══════ */}
                    {isModules && isExpanded && (() => {
                      let moduleFeatures = featuresByModule.get(rowId as number) || [];
                      // Apply feature filters
                      if (featureFilterRules.length > 0) {
                        moduleFeatures = applyFilterRules(moduleFeatures, featureFilterRules);
                      }
                      // Apply feature sort
                      if (featureSortConfig.primary) {
                        const compareCol = (a: Record<string, unknown>, b: Record<string, unknown>, col: string, dir: "asc" | "desc") => {
                          const va = a[col] ?? "";
                          const vb = b[col] ?? "";
                          if (typeof va === "number" && typeof vb === "number") return dir === "asc" ? va - vb : vb - va;
                          return dir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
                        };
                        moduleFeatures = [...moduleFeatures].sort((a, b) => {
                          const primary = compareCol(a, b, featureSortConfig.primary!.col, featureSortConfig.primary!.dir);
                          if (primary !== 0 || !featureSortConfig.secondary) return primary;
                          return compareCol(a, b, featureSortConfig.secondary.col, featureSortConfig.secondary.dir);
                        });
                      }
                      if (moduleFeatures.length === 0) {
                        return (
                          <tr style={{ backgroundColor: "var(--color-surface)" }}>
                            <td colSpan={totalColSpan}>
                              <div className="py-3 pl-10 text-xs" style={{ color: "var(--color-text-muted)" }}>No features — use <span style={{ color: "#4ecb71", fontWeight: "bold" }}>+</span> in Platforms column to add.</div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <>
                          {/* Feature sub-table header */}
                          <tr style={{ backgroundColor: "var(--color-surface)" }}>
                            <td colSpan={totalColSpan} className="py-0 px-0">
                              <table className="w-full text-xs">
                                <thead>
                                  <DndContext
                                    sensors={dndSensors}
                                    onDragEnd={(event: DragEndEvent) => {
                                      const { active, over } = event;
                                      if (!over || active.id === over.id) return;
                                      const fullOld = moduleFeatureColOrder.indexOf(active.id as string);
                                      const fullNew = moduleFeatureColOrder.indexOf(over.id as string);
                                      if (fullOld < 0 || fullNew < 0) return;
                                      const newOrder = arrayMove(moduleFeatureColOrder, fullOld, fullNew);
                                      setModuleFeatureColOrder(newOrder);
                                      localStorage.setItem("splan_module_feature_col_order", JSON.stringify(newOrder));
                                    }}
                                  >
                                    <SortableContext items={orderedVisibleFeatCols.map((c) => c.key)} strategy={horizontalListSortingStrategy}>
                                      <tr className="border-b" style={{ borderColor: "var(--color-divider)" }}>
                                        <th className="py-1.5 pl-10 pr-1 w-5" style={{ backgroundColor: "var(--color-surface)" }} />
                                        {orderedVisibleFeatCols.map((col) => (
                                          <SortableFeatureHeader key={col.key} col={col} colWidths={colWidths} onResizeStart={onResizeStart} featureColColor={featureColColor} featureColBold={featureColBold} featureColUnderline={featureColUnderline} />
                                        ))}
                                        <th className="w-8" style={{ backgroundColor: "var(--color-surface)" }} />
                                      </tr>
                                    </SortableContext>
                                  </DndContext>
                                </thead>
                                <tbody>
                                  {moduleFeatures.map((feat) => {
                                    const fid = feat.featureId as number;
                                    const isFeatureExpanded = expandedModuleFeatureId === fid;

                                    // Platforms come from the feature's own platforms field
                                    const featurePlatforms = new Set<string>(
                                      Array.isArray(feat.platforms) ? (feat.platforms as string[]) : ["Web App"]
                                    );
                                    const hasNative = featurePlatforms.has("Android") || featurePlatforms.has("Apple") || featurePlatforms.has("Other");

                                    return (
                                      <React.Fragment key={fid}>
                                        <tr
                                          className="border-b transition-colors hover:bg-black/5 cursor-pointer"
                                          style={{ borderColor: "var(--color-divider)", backgroundColor: isFeatureExpanded ? "rgba(91,192,222,0.05)" : undefined }}
                                          onClick={() => setExpandedModuleFeatureId(isFeatureExpanded ? null : fid)}
                                        >
                                          <td className="py-1.5 pl-10 pr-1 w-5" style={{ color: "var(--color-text-muted)" }}>
                                            <span className="text-[10px] select-none" style={{ display: "inline-block", transform: isFeatureExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>&#9654;</span>
                                          </td>
                                          {orderedVisibleFeatCols.map((col) => {
                                            const k = col.key;
                                            const isEditing = editingModuleFeatureCell?.fid === fid && editingModuleFeatureCell?.key === k;
                                            const commitEdit = (newVal: string) => {
                                              const updated = { ...feat, [k]: newVal };
                                              applyLocalUpdate("features", updated, `Inline edit: ${k} = "${newVal}"`);
                                              setEditingModuleFeatureCell(null);
                                            };

                                            // Editable: featureName
                                            if (k === "featureName") return (
                                              <td key={k} className="py-1.5 px-3 font-medium" style={{ color: "#5bc0de", width: colWidths[`module_features:${k}`] ?? undefined }} onClick={(e) => { e.stopPropagation(); setEditingModuleFeatureCell({ fid, key: k }); }}>
                                                {isEditing ? (
                                                  <input type="text" autoFocus defaultValue={String(feat.featureName ?? "")} className="w-full px-1 py-0 text-xs rounded border focus:outline-none" style={{ borderColor: "#5bc0de", backgroundColor: "var(--color-surface)", color: "#5bc0de" }} onBlur={(e) => commitEdit(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitEdit((e.target as HTMLInputElement).value); if (e.key === "Escape") setEditingModuleFeatureCell(null); }} />
                                                ) : String(feat.featureName ?? "")}
                                              </td>
                                            );

                                            // Editable: modules (multi-select)
                                            if (k === "modules") {
                                              const currentModIds = Array.isArray(feat.modules) ? (feat.modules as number[]) : [];
                                              const names = resolveModuleNames(feat);
                                              return (
                                                <td key={k} className="py-1.5 px-3 cursor-pointer relative" style={{ width: colWidths[`module_features:${k}`] ?? undefined }} onClick={(e) => { e.stopPropagation(); setEditingModuleFeatureCell(isEditing ? null : { fid, key: k }); }}>
                                                  {names ? <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{names}</span> : <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                                                  {isEditing && (
                                                    <>
                                                      <div className="fixed inset-0 z-20" onMouseDown={() => setEditingModuleFeatureCell(null)} />
                                                      <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[200px] max-h-[200px] overflow-y-auto" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                                                        {(data.modules || []).map((mod) => {
                                                          const mid = mod.moduleId as number;
                                                          const mname = String(mod.moduleName ?? `Module #${mid}`);
                                                          const isChecked = currentModIds.includes(mid);
                                                          return (
                                                            <label key={mid} className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5 text-xs" onMouseDown={(e) => e.preventDefault()}>
                                                              <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                onChange={() => {
                                                                  const newModIds = isChecked ? currentModIds.filter((id) => id !== mid) : [...currentModIds, mid];
                                                                  const updated = { ...feat, modules: newModIds };
                                                                  applyLocalUpdate("features", updated, `Updated modules for feature "${feat.featureName}"`);
                                                                }}
                                                                className="w-3 h-3"
                                                                style={{ accentColor: "var(--color-primary)" }}
                                                              />
                                                              <span style={{ color: "var(--color-text)" }}>{mname}</span>
                                                            </label>
                                                          );
                                                        })}
                                                      </div>
                                                    </>
                                                  )}
                                                </td>
                                              );
                                            }

                                            // Editable: status (floating dropdown with pills)
                                            if (k === "status") {
                                              const statusOpts = ["Idea", "Approved", "Partially Implemented", "Implemented"];
                                              return (
                                                <td key={k} className="py-1.5 px-3 cursor-pointer relative" style={{ width: colWidths[`module_features:${k}`] ?? undefined }} onClick={(e) => { e.stopPropagation(); setEditingModuleFeatureCell(isEditing ? null : { fid, key: k }); }}>
                                                  <Pill value={String(feat.status ?? "Idea")} />
                                                  {isEditing && (
                                                    <>
                                                      <div className="fixed inset-0 z-20" onMouseDown={() => setEditingModuleFeatureCell(null)} />
                                                      <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[200px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                                                        {statusOpts.map((opt) => {
                                                          const c = PILL_COLORS[opt] || { bg: "rgba(102,102,128,0.12)", text: "#9999b3", border: "rgba(102,102,128,0.3)" };
                                                          const isActive = String(feat.status ?? "Idea") === opt;
                                                          return (
                                                            <div key={opt} className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5" onMouseDown={(e) => { e.preventDefault(); commitEdit(opt); }}>
                                                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>{opt}</span>
                                                              {isActive && <span style={{ color: c.text }}>&#10003;</span>}
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    </>
                                                  )}
                                                </td>
                                              );
                                            }

                                            // Editable: priority (floating dropdown with pills)
                                            if (k === "priority") {
                                              const priorityOpts = ["Critical", "High", "Medium", "Low", "N/A"];
                                              return (
                                                <td key={k} className="py-1.5 px-3 cursor-pointer relative" style={{ width: colWidths[`module_features:${k}`] ?? undefined }} onClick={(e) => { e.stopPropagation(); setEditingModuleFeatureCell(isEditing ? null : { fid, key: k }); }}>
                                                  <Pill value={String(feat.priority ?? "N/A")} />
                                                  {isEditing && (
                                                    <>
                                                      <div className="fixed inset-0 z-20" onMouseDown={() => setEditingModuleFeatureCell(null)} />
                                                      <div className="absolute left-0 top-full mt-1 z-30 rounded-lg border shadow-xl overflow-hidden py-1 min-w-[160px]" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
                                                        {priorityOpts.map((opt) => {
                                                          const c = PILL_COLORS[opt] || { bg: "rgba(102,102,128,0.12)", text: "#9999b3", border: "rgba(102,102,128,0.3)" };
                                                          const isActive = String(feat.priority ?? "N/A") === opt;
                                                          return (
                                                            <div key={opt} className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/5" onMouseDown={(e) => { e.preventDefault(); commitEdit(opt); }}>
                                                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>{opt}</span>
                                                              {isActive && <span style={{ color: c.text }}>&#10003;</span>}
                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    </>
                                                  )}
                                                </td>
                                              );
                                            }

                                            // Editable: platforms (toggle pills)
                                            if (k === "platforms") {
                                              const currentPlatforms: string[] = Array.isArray(feat.platforms) ? (feat.platforms as string[]) : ["Web App"];
                                              return (
                                                <td key={k} className="py-1.5 px-3" style={{ width: colWidths[`module_features:${k}`] ?? undefined }} onClick={(e) => e.stopPropagation()}>
                                                  <div className="flex items-center gap-1 flex-wrap">
                                                    {PLATFORM_OPTIONS.map((p) => {
                                                      const active = currentPlatforms.includes(p);
                                                      const c = PLATFORM_COLORS[p] || { bg: "rgba(102,102,128,0.15)", text: "#9999b3", border: "rgba(102,102,128,0.3)" };
                                                      return (
                                                        <button
                                                          key={p}
                                                          onClick={() => {
                                                            const newPlatforms = active
                                                              ? currentPlatforms.filter((x) => x !== p)
                                                              : [...currentPlatforms, p];
                                                            applyLocalUpdate("features", { ...feat, platforms: newPlatforms }, `Updated platforms for "${feat.featureName}"`);
                                                          }}
                                                          className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium transition-opacity"
                                                          style={{
                                                            backgroundColor: active ? c.bg : "transparent",
                                                            color: active ? c.text : "var(--color-text-muted)",
                                                            border: `1px solid ${active ? c.border : "var(--color-divider)"}`,
                                                            opacity: active ? 1 : 0.4,
                                                          }}
                                                        >
                                                          {p}
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                </td>
                                              );
                                            }

                                            // Editable: description
                                            if (k === "description") return (
                                              <td key={k} className="py-1.5 px-3 max-w-[300px]" style={{ color: "var(--color-text-muted)", width: colWidths[`module_features:${k}`] ?? undefined }} onClick={(e) => { e.stopPropagation(); setEditingModuleFeatureCell({ fid, key: k }); }}>
                                                {isEditing ? (
                                                  <input type="text" autoFocus defaultValue={String(feat.description ?? "")} className="w-full px-1 py-0 text-xs rounded border focus:outline-none" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }} onBlur={(e) => commitEdit(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitEdit((e.target as HTMLInputElement).value); if (e.key === "Escape") setEditingModuleFeatureCell(null); }} />
                                                ) : <span className="overflow-hidden text-ellipsis whitespace-nowrap block">{String(feat.description ?? "—")}</span>}
                                              </td>
                                            );

                                            // Read-only: tags
                                            if (k === "featureTags") {
                                              const tags = Array.isArray(feat.featureTags) ? feat.featureTags as string[] : [];
                                              return <td key={k} className="py-1.5 px-3" style={{ width: colWidths[`module_features:${k}`] ?? undefined }}>{tags.length > 0 ? tags.join(", ") : <span style={{ color: "var(--color-text-muted)" }}>—</span>}</td>;
                                            }
                                            // Read-only: timestamps
                                            if (k === "createdAt" || k === "updatedAt") {
                                              const v = feat[k];
                                              return <td key={k} className="py-1.5 px-3 whitespace-nowrap" style={{ color: "var(--color-text-muted)", width: colWidths[`module_features:${k}`] ?? undefined }}>{v ? new Date(String(v)).toLocaleString() : "—"}</td>;
                                            }
                                            return <td key={k} className="py-1.5 px-3" style={{ color: "var(--color-text-muted)", width: colWidths[`module_features:${k}`] ?? undefined }}>{String(feat[k] ?? "—")}</td>;
                                          })}
                                          {/* Delete feature button */}
                                          <td className="py-1.5 px-2 w-8" onClick={(e) => e.stopPropagation()}>
                                            <button
                                              onClick={() => confirmDelete(feat, "features")}
                                              className="w-5 h-5 rounded flex items-center justify-center text-[10px] opacity-30 hover:opacity-100 hover:bg-red-500/20 transition-all"
                                              style={{ color: "#e05555" }}
                                              title={`Delete feature "${feat.featureName}"`}
                                            >
                                              ✕
                                            </button>
                                          </td>
                                        </tr>

                                        {/* ─── Feature detail (editable: notes, implementation, images) ─── */}
                                        {isFeatureExpanded && (() => {
                                          const featureImages = (Array.isArray(feat.images) ? feat.images : EMPTY_IMAGES) as Array<{ id: string; title: string; url?: string }>;
                                          const hasAnyNative = featurePlatforms.has("Android") || featurePlatforms.has("Apple") || featurePlatforms.has("Other");

                                          // Navigation helpers (same as Features tab)
                                          const handleRefNav = (type: string, name: string) => {
                                            if (type === "table") {
                                              const tbl = (data.data_tables || []).find((t) => String(t.tableName) === name);
                                              if (tbl) setRefSummaryPopup({ type: "table", record: tbl as Record<string, unknown> });
                                            } else if (type === "field") {
                                              const parts = name.split(".");
                                              const tbl = (data.data_tables || []).find((t) => String(t.tableName) === parts[0]);
                                              if (tbl) setRefSummaryPopup({ type: "table", record: tbl as Record<string, unknown>, highlightField: parts.slice(1).join(".") });
                                            } else if (type === "module") {
                                              const mod = (data.modules || []).find((m) => String(m.moduleName) === name);
                                              if (mod) setRefSummaryPopup({ type: "module", record: mod as Record<string, unknown> });
                                            } else if (type === "feature") {
                                              const f2 = (data.features || []).find((f) => String(f.featureName) === name);
                                              if (f2) setRefSummaryPopup({ type: "feature", record: f2 as Record<string, unknown> });
                                            } else if (type === "concept") {
                                              const con = (data.concepts || []).find((c) => String(c.conceptName) === name);
                                              if (con) setRefSummaryPopup({ type: "concept", record: con as Record<string, unknown> });
                                            } else if (type === "research") {
                                              const res = (data.research || []).find((r) => String(r.title) === name);
                                              if (res) setRefSummaryPopup({ type: "research", record: res as Record<string, unknown> });
                                            } else if (type === "image") {
                                              const imgs = (Array.isArray(feat.images) ? feat.images : []) as Array<{ id: string; url: string; title: string }>;
                                              const img = imgs.find((im) => im.title === name);
                                              if (img?.url) setImageViewer({ url: img.url, title: img.title, x: 100, y: 100, width: 1200, height: 600, zoom: 1, originX: 50, originY: 50 });
                                            }
                                          };
                                          const handleCreateRef = async (type: "table" | "field", name: string, options?: { parentTableId?: number; description?: string; recordOwnership?: string; tableStatus?: string }): Promise<{ id: number; name: string } | null> => {
                                            try {
                                              if (type === "table") {
                                                const res = await fetch("/api/schema-planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table: "_splan_data_tables", data: { tableName: name, tableStatus: options?.tableStatus || "planned", descriptionPurpose: options?.description || null, recordOwnership: options?.recordOwnership || "org_private" }, reasoning: `Created table "${name}" from feature notes` }) });
                                                if (!res.ok) return null;
                                                const created = await res.json();
                                                setData((prev) => ({ ...prev, data_tables: [...(prev.data_tables || []), created] }));
                                                return { id: created.tableId, name: created.tableName };
                                              } else {
                                                const parentTableId = options?.parentTableId;
                                                if (!parentTableId) return null;
                                                const res = await fetch("/api/schema-planner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table: "_splan_data_fields", data: { fieldName: name, dataTableId: parentTableId, fieldStatus: "planned", dataType: "Text" }, reasoning: `Created planned field "${name}" from feature notes` }) });
                                                if (!res.ok) return null;
                                                const created = await res.json();
                                                setData((prev) => ({ ...prev, data_fields: [...(prev.data_fields || []), created] }));
                                                return { id: created.fieldId, name: created.fieldName };
                                              }
                                            } catch { return null; }
                                          };
                                          const openTablePickerForField = (fieldSnakeName: string, _fieldRawName: string) => {
                                            savedSubTabRef.current = subTab;
                                            setSubTab("data_tables");
                                            setTablePickerOpen(true);
                                            setInlineNewField({ tableId: 0, featureRow: feat, noteKey: "notes", fieldName: fieldSnakeName, dataType: "Text", isRequired: false, isUnique: false, isForeignKey: false, referencesTable: null, referencesField: null });
                                          };
                                          const visibleNoteSections = PLATFORM_NOTE_SECTIONS.filter((sec) => {
                                            if ("showWhenAnyNative" in sec && sec.showWhenAnyNative) return hasAnyNative;
                                            return sec.platform ? featurePlatforms.has(sec.platform) : false;
                                          });
                                          const webAppSec = visibleNoteSections.find((s) => s.key === "notes");
                                          const otherSections = visibleNoteSections.filter((s) => s.key !== "notes");
                                          return (
                                          <tr style={{ backgroundColor: "rgba(91,192,222,0.03)" }}>
                                            <td colSpan={1 + orderedVisibleFeatCols.length} className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                                              <div className="space-y-3 text-xs">
                                                {/* Web App Notes — full width */}
                                                {webAppSec && (
                                                  <FullscreenNoteWrapper label={webAppSec.label} platformColor={PLATFORM_COLORS["Web App"].text}>
                                                    <FeatureMentionField
                                                      initial={String(feat[webAppSec.key] ?? "")}
                                                      initialFmt={(Array.isArray(feat[webAppSec.fmtKey]) ? feat[webAppSec.fmtKey] : []) as FmtRange[]}
                                                      onCommit={(text, fmt, collapsed, tables) => {
                                                        const prev = (feat.collapsedSections as Record<string, unknown>) ?? {};
                                                        const prevTables = (feat.embeddedTables as Record<string, unknown>) ?? {};
                                                        const updated = { ...feat, [webAppSec.key]: text || null, [webAppSec.fmtKey]: fmt, ...(collapsed !== undefined ? { collapsedSections: { ...prev, [webAppSec.key]: Object.keys(collapsed).length > 0 ? collapsed : undefined } } : {}), ...(tables !== undefined ? { embeddedTables: { ...prevTables, [webAppSec.key]: Object.keys(tables).length > 0 ? tables : undefined } } : {}) };
                                                        applyLocalUpdate("features", updated, `Inline edit: ${webAppSec.key}`);
                                                      }}
                                                      tables={mentionTables}
                                                      fields={mentionFields}
                                                      tableNames={mentionTableNames}
                                                      fieldDisplayNames={mentionFieldDisplayNames}
                                                      images={featureImages}
                                                      modules={mentionModules}
                                                      features={mentionFeatures}
                                concepts={mentionConcepts}
                                research={mentionResearch}
                                                      onRefNavigate={handleRefNav}
                                                      onCreateRef={handleCreateRef}
                                                      tableDetails={data.data_tables as Array<Record<string, unknown>>}
                                                      onPickTableForField={openTablePickerForField}
                                                      placeholder={`${webAppSec.label}... type ( to reference a table, field, or image`}
                                                      initialCollapsed={((feat.collapsedSections as Record<string, Record<string, { body: string; bodyFmt: FmtRange[] }>> | null) ?? {})[webAppSec.key]}
                                                      initialTables={((feat.embeddedTables as Record<string, Record<string, unknown>> | null) ?? {})[webAppSec.key] as Record<string, import("./schema-planner/types").EmbeddedTable> | undefined}
                                                      onTablesChange={(tbls) => {
                                                        const prev = (feat.embeddedTables as Record<string, unknown>) ?? {};
                                                        const updated = { ...feat, embeddedTables: { ...prev, [webAppSec.key]: Object.keys(tbls).length > 0 ? tbls : undefined } };
                                                        applyLocalUpdate("features", updated, `Table change: ${webAppSec.key}`);
                                                      }}
                                                      noteContext={{ module: (feat.modules as number[])?.map((mid: number) => { const m = (data.modules || []).find((mm) => mm.moduleId === mid); return m ? String(m.moduleName) : ""; }).filter(Boolean).join(", ") || undefined, moduleColor: moduleColColor, feature: String(feat.featureName || ""), featureColor: featureColColor, field: webAppSec.label, fieldColor: "#4ecb71" }}
                                                    />
                                                  </FullscreenNoteWrapper>
                                                )}
                                                {/* Other platform notes — 2-column grid */}
                                                {otherSections.length > 0 && (
                                                <div className="grid grid-cols-2 gap-4">
                                                  {otherSections.map((sec) => {
                                                    const platformColor = sec.platform ? PLATFORM_COLORS[sec.platform] : (sec.key === "nativeNotes" ? { bg: "rgba(242,182,97,0.1)", text: "#f2b661", border: "#f2b66133" } : null);
                                                    return (
                                                      <FullscreenNoteWrapper key={sec.key} label={sec.label} platformColor={platformColor?.text || "#f2b661"}>
                                                        <FeatureMentionField
                                                          initial={String(feat[sec.key] ?? "")}
                                                          initialFmt={(Array.isArray(feat[sec.fmtKey]) ? feat[sec.fmtKey] : []) as FmtRange[]}
                                                          onCommit={(text, fmt, collapsed, tables) => {
                                                            const prev = (feat.collapsedSections as Record<string, unknown>) ?? {};
                                                            const prevTables = (feat.embeddedTables as Record<string, unknown>) ?? {};
                                                            const updated = { ...feat, [sec.key]: text || null, [sec.fmtKey]: fmt, ...(collapsed !== undefined ? { collapsedSections: { ...prev, [sec.key]: Object.keys(collapsed).length > 0 ? collapsed : undefined } } : {}), ...(tables !== undefined ? { embeddedTables: { ...prevTables, [sec.key]: Object.keys(tables).length > 0 ? tables : undefined } } : {}) };
                                                            applyLocalUpdate("features", updated, `Inline edit: ${sec.key}`);
                                                          }}
                                                          tables={mentionTables}
                                                          fields={mentionFields}
                                                          tableNames={mentionTableNames}
                                                          fieldDisplayNames={mentionFieldDisplayNames}
                                                          images={featureImages}
                                                          modules={mentionModules}
                                                          features={mentionFeatures}
                                concepts={mentionConcepts}
                                research={mentionResearch}
                                                          onRefNavigate={handleRefNav}
                                                          onCreateRef={handleCreateRef}
                                                          tableDetails={data.data_tables as Array<Record<string, unknown>>}
                                                          onPickTableForField={openTablePickerForField}
                                                          placeholder={`${sec.label}... type ( to reference a table, field, or image`}
                                                          initialCollapsed={((feat.collapsedSections as Record<string, Record<string, { body: string; bodyFmt: FmtRange[] }>> | null) ?? {})[sec.key]}
                                                          initialTables={((feat.embeddedTables as Record<string, Record<string, unknown>> | null) ?? {})[sec.key] as Record<string, import("./schema-planner/types").EmbeddedTable> | undefined}
                                                          onTablesChange={(tbls) => {
                                                            const prev = (feat.embeddedTables as Record<string, unknown>) ?? {};
                                                            const updated = { ...feat, embeddedTables: { ...prev, [sec.key]: Object.keys(tbls).length > 0 ? tbls : undefined } };
                                                            applyLocalUpdate("features", updated, `Table change: ${sec.key}`);
                                                          }}
                                                          noteContext={{ feature: String(feat.featureName || ""), featureColor: featureColColor, field: sec.label, fieldColor: sec.platform ? (PLATFORM_COLORS[sec.platform]?.text || "#f2b661") : "#f2b661" }}
                                                        />
                                                      </FullscreenNoteWrapper>
                                                    );
                                                  })}
                                                </div>
                                                )}
                                                {/* Implementation */}
                                                <div>
                                                  <label className="font-semibold block mb-1" style={{ color: "var(--color-text-muted)" }}>
                                                    Implementation <span className="font-normal" style={{ opacity: 0.6 }}>— type ( to reference</span>
                                                  </label>
                                                  <FeatureMentionField
                                                    initial={String(feat.implementation ?? "")}
                                                    initialFmt={(Array.isArray(feat.implFmt) ? feat.implFmt : []) as FmtRange[]}
                                                    onCommit={(text, fmt, collapsed, tables) => {
                                                      const prev = (feat.collapsedSections as Record<string, unknown>) ?? {};
                                                      const prevTables = (feat.embeddedTables as Record<string, unknown>) ?? {};
                                                      const updated = { ...feat, implementation: text || null, implFmt: fmt, ...(collapsed !== undefined ? { collapsedSections: { ...prev, implementation: Object.keys(collapsed).length > 0 ? collapsed : undefined } } : {}), ...(tables !== undefined ? { embeddedTables: { ...prevTables, implementation: Object.keys(tables).length > 0 ? tables : undefined } } : {}) };
                                                      applyLocalUpdate("features", updated, "Inline edit: implementation");
                                                    }}
                                                    tables={mentionTables}
                                                    fields={mentionFields}
                                                    tableNames={mentionTableNames}
                                                    fieldDisplayNames={mentionFieldDisplayNames}
                                                    images={featureImages}
                                                    modules={mentionModules}
                                                    features={mentionFeatures}
                                concepts={mentionConcepts}
                                research={mentionResearch}
                                                    onRefNavigate={handleRefNav}
                                                    onCreateRef={handleCreateRef}
                                                    tableDetails={data.data_tables as Array<Record<string, unknown>>}
                                                    onPickTableForField={openTablePickerForField}
                                                    placeholder="Implementation details... type ( to reference a table, field, or image"
                                                    initialCollapsed={((feat.collapsedSections as Record<string, Record<string, { body: string; bodyFmt: FmtRange[] }>> | null) ?? {})["implementation"]}
                                                    initialTables={((feat.embeddedTables as Record<string, Record<string, unknown>> | null) ?? {})["implementation"] as Record<string, import("./schema-planner/types").EmbeddedTable> | undefined}
                                                    onTablesChange={(tbls) => {
                                                      const prev = (feat.embeddedTables as Record<string, unknown>) ?? {};
                                                      const updated = { ...feat, embeddedTables: { ...prev, implementation: Object.keys(tbls).length > 0 ? tbls : undefined } };
                                                      applyLocalUpdate("features", updated, "Table change: implementation");
                                                    }}
                                                    noteContext={{ feature: String(feat.featureName || ""), featureColor: featureColColor, field: "Implementation", fieldColor: "var(--color-text-muted)" }}
                                                  />
                                                </div>
                                                {/* Depended On By */}
                                                <DependedOnBySection featureId={fid} />
                                                {/* Test Cases Grid */}
                                                <FeatureTestsGrid featureId={fid} featureName={String(feat.featureName ?? "")} allFeatures={(data.features || []).map(f => ({ featureId: f.featureId as number, featureName: String(f.featureName ?? "") }))} />
                                                {/* Implementation Steps Grid */}
                                                <ImplementationStepsGrid featureId={fid} featureName={String(feat.featureName ?? "")} />
                                                {/* Prototypes Grid */}
                                                <PrototypesGrid featureId={fid} featureName={String(feat.featureName ?? "")} allFeatures={(data.features || []).map(f => ({ featureId: f.featureId as number, featureName: String(f.featureName ?? "") }))} />
                                                {/* Tags */}
                                                {Array.isArray(feat.featureTags) && (feat.featureTags as string[]).length > 0 && (
                                                  <div className="flex items-center gap-1 flex-wrap">
                                                    <span className="text-[10px] font-semibold mr-1" style={{ color: "var(--color-text-muted)" }}>Tags:</span>
                                                    {(feat.featureTags as string[]).map((tag) => (
                                                      <span key={tag} className="px-1.5 py-0 rounded text-[10px]" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>{tag}</span>
                                                    ))}
                                                  </div>
                                                )}
                                                {/* References (extracted from notes) */}
                                                {(() => {
                                                  const notesSections = [
                                                    { key: "notes", label: "Web App", text: (feat.notes as string) || "" },
                                                    { key: "nativeNotes", label: "Native", text: (feat.nativeNotes as string) || "" },
                                                    { key: "androidNotes", label: "Android", text: (feat.androidNotes as string) || "" },
                                                    { key: "appleNotes", label: "Apple", text: (feat.appleNotes as string) || "" },
                                                    { key: "otherNotes", label: "Other", text: (feat.otherNotes as string) || "" },
                                                  ];
                                                  const refs = extractRefsFromNotes(notesSections, resolveTableName, resolveFieldName, resolveModuleName, resolveFeatureName);
                                                  return (
                                                    <div>
                                                      <label className="font-semibold block mb-1" style={{ color: "var(--color-text-muted)" }}>References (extracted from notes)</label>
                                                      {refs.length > 0 ? (
                                                        <table className="text-xs" style={{ borderCollapse: "collapse" }}>
                                                          <thead>
                                                            <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
                                                              <th className="text-left px-2 py-1 w-8" style={{ color: "var(--color-text-muted)" }}>#</th>
                                                              <th className="text-left px-2 py-1 w-16" style={{ color: "var(--color-text-muted)" }}>Type</th>
                                                              <th className="text-left px-2 py-1" style={{ color: "var(--color-text-muted)" }}>Name</th>
                                                              <th className="text-left px-2 py-1" style={{ color: "var(--color-text-muted)" }}>Line</th>
                                                              <th className="text-left px-2 py-1" style={{ color: "var(--color-text-muted)" }}>Source</th>
                                                            </tr>
                                                          </thead>
                                                          <tbody>
                                                            {refs.map((ref, idx) => (
                                                              <tr key={`${ref.type}:${ref.name}`} style={{ borderBottom: "1px solid var(--color-divider)" }}>
                                                                <td className="px-2 py-1" style={{ color: "var(--color-text-muted)" }}>{idx + 1}</td>
                                                                <td className="px-2 py-1" style={{ color: ref.type === "Table" ? "#a855f7" : ref.type === "Field" ? "#5bc0de" : ref.type === "Module" ? "#e67d4a" : ref.type === "Feature" ? "#a855f7" : "#4ecb71" }}>{ref.type}</td>
                                                                <td className="px-2 py-1" style={{ color: "var(--color-text)" }}>{ref.type === "Image" ? `🎨 ${ref.name}` : ref.name}</td>
                                                                <td className="px-2 py-1" style={{ color: "var(--color-text-muted)" }}>
                                                                  {ref.lines.length === 1 ? ref.lines[0] : `${ref.lines.length}(${ref.lines.join(",")})`}
                                                                </td>
                                                                <td className="px-2 py-1" style={{ color: "var(--color-text-muted)" }}>{ref.source}</td>
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                      ) : (
                                                        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>No references found — type (table_name) in notes to reference tables, fields, or images</span>
                                                      )}
                                                    </div>
                                                  );
                                                })()}
                                                {/* Images */}
                                                <FeatureImageGallery
                                                  images={(Array.isArray(feat.images) ? feat.images : []) as Array<{ id: string; url: string; title: string; createdAt: string }>}
                                                  featureId={feat.featureId as number}
                                                  onUpdate={(images) => {
                                                    const updated = { ...feat, images };
                                                    applyLocalUpdate("features", updated, "Updated images");
                                                  }}
                                                />
                                              </div>
                                            </td>
                                          </tr>
                                          );
                                        })()}
                                      </React.Fragment>
                                    );
                                  })}
                                  {/* Quick-add moved to Platforms column combo box */}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        </>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
                          {/* Subtle spacer after grouped section */}
                          {section.name !== null && !isCollapsed && (
                            <tr><td colSpan={totalColSpan} className="py-0" style={{ height: 4 }} /></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>

        {/* ─── Column display settings popover ─── */}
        {colDisplayPopover && (() => {
          const colKey = colDisplayPopover.colKey;
          const colDef = TABLE_CONFIGS[subTab]?.columns.find((c) => c.key === colKey);
          if (!colDef) return null;
          const displayKey = `${subTab}:${colKey}`;
          const cfg2 = colDisplayConfig[displayKey] || {};
          const isTextCol = colDef.type === "text" || colDef.type === "textarea";
          const currentLines = cfg2.lines ?? 1;
          const isWrap = cfg2.wrap ?? false;

          // Template state for this column
          const entityType = TAB_ENTITY_MAP[subTab] || subTab;
          const currentTpl = getColumnTemplate(entityType, colKey);
          const currentTplId = currentTpl?.id ?? 0;

          // Incompatibility warnings
          const incompatWarnings: Record<string, Record<string, string>> = {
            textarea: { pill: "Long text may not display well as pills — content will be truncated", chip: "Long text may not display well as chips — content will be truncated", tag: "Long text may not display well as tags — content will be truncated" },
            "image-carousel": { pill: "Image columns show count badges — pill mode may look unexpected", chip: "Image columns show count badges — chip mode may look unexpected", tag: "Image columns show count badges — tag mode may look unexpected" },
            "module-rules": { pill: "Rule columns have complex rendering — template may not apply fully", chip: "Rule columns have complex rendering — template may not apply fully", tag: "Rule columns have complex rendering — template may not apply fully" },
          };
          const warning = currentTpl ? incompatWarnings[colDef.type]?.[currentTpl.displayMode] : null;

          // Connector line + offset positioning
          const headerCenterX = colDisplayPopover.rect.left + colDisplayPopover.rect.width / 2;
          const headerBottom = colDisplayPopover.rect.bottom;
          const vertDrop = 20;
          const horizOffset = 150;
          // Determine if this column is in the last 4 visible columns → go left
          const colIdx = gridCols?.findIndex((c) => c.key === colKey) ?? -1;
          const goLeft = colIdx >= 0 && gridCols && colIdx >= gridCols.length - 4;
          const popoverWidth = 250;
          let popoverLeft = goLeft
            ? headerCenterX - horizOffset - popoverWidth
            : headerCenterX + horizOffset;
          // Clamp to viewport
          popoverLeft = Math.max(8, Math.min(popoverLeft, window.innerWidth - popoverWidth - 8));
          const popoverTop = headerBottom + vertDrop;
          // Connector line endpoints
          const lineStartX = headerCenterX;
          const lineStartY = headerBottom;
          const lineEndX = goLeft ? popoverLeft + popoverWidth : popoverLeft;
          const lineEndY = popoverTop;

          return (
            <>
            {/* Connector line */}
            <svg className="fixed z-50 pointer-events-none" style={{ top: 0, left: 0, width: "100vw", height: "100vh", overflow: "visible" }}>
              <polyline
                points={`${lineStartX},${lineStartY} ${lineStartX},${lineStartY + vertDrop} ${lineEndX},${lineEndY}`}
                fill="none"
                stroke="rgba(91,192,222,0.5)"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <circle cx={lineStartX} cy={lineStartY} r="2.5" fill="#5bc0de" opacity="0.7" />
            </svg>
            <div
              id="col-display-popover"
              className="fixed z-50 rounded-lg border shadow-xl w-[250px]"
              style={{
                backgroundColor: "var(--color-background)",
                borderColor: "var(--color-divider)",
                top: popoverTop,
                left: popoverLeft,
                maxHeight: "calc(100vh - 100px)",
                overflowY: "auto",
              }}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--color-divider)" }}>
                <div>
                  <span className="text-[11px] font-semibold" style={{ color: "var(--color-text)" }}>{colDef.label}</span>
                  <span className="text-[9px] ml-1.5 px-1 py-0 rounded" style={{ backgroundColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>{colDef.type}</span>
                </div>
                <button onClick={() => setColDisplayPopover(null)} className="text-[10px] px-1 rounded hover:bg-black/10" style={{ color: "var(--color-text-muted)" }}>✕</button>
              </div>
              <div className="p-3 space-y-3">
                {/* ─── Template selector ─── */}
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Template</div>
                  <select
                    className="w-full text-[11px] px-2 py-1 rounded border"
                    style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                    value={currentTplId}
                    onChange={async (e) => {
                      const newId = Number(e.target.value);
                      const prevTplId = currentTplId;
                      if (newId === 0) {
                        await removeColumnTemplateAssignment(entityType, colKey);
                        if (prevTplId) pushTemplateUndo(`Detached template from ${colDef.label}`, { type: "assign", entityType, columnKey: colKey, templateId: prevTplId });
                      } else {
                        await assignColumnTemplate(entityType, colKey, newId);
                        const newTpl = displayTemplates.find((t) => t.id === newId);
                        if (prevTplId) {
                          pushTemplateUndo(`Applied "${newTpl?.templateName}" to ${colDef.label}`, { type: "assign", entityType, columnKey: colKey, templateId: prevTplId });
                        } else {
                          pushTemplateUndo(`Applied "${newTpl?.templateName}" to ${colDef.label}`, { type: "detach", entityType, columnKey: colKey });
                        }
                      }
                      await reloadDisplayTemplates();
                    }}
                  >
                    <option value={0}>— None (Default) —</option>
                    {displayTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.templateName}</option>
                    ))}
                  </select>
                  {currentTpl && (
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={async () => {
                          const prevTplId = currentTpl.id;
                          const prevTplName = currentTpl.templateName;
                          await removeColumnTemplateAssignment(entityType, colKey);
                          await reloadDisplayTemplates();
                          pushTemplateUndo(`Detached "${prevTplName}" from ${colDef.label}`, { type: "assign", entityType, columnKey: colKey, templateId: prevTplId });
                        }}
                        className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-red-500/10"
                        style={{ color: "#e05555", border: "1px solid rgba(224,85,85,0.3)" }}
                      >Detach</button>
                    </div>
                  )}
                </div>

                {/* ─── Display Mode buttons ─── */}
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Display Mode</div>
                  <div className="flex gap-1">
                    {(["text", "pill", "chip", "tag"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={async () => {
                          if (currentTpl) {
                            // Check how many columns use this template
                            const usageCount = templateAssignments.filter((a) => a.templateId === currentTpl.id).length;
                            if (usageCount > 1 && !window.confirm(`This template is used by ${usageCount} columns — changes will apply to all. Continue?`)) return;
                            await updateDisplayTemplate(currentTpl.id, { displayMode: mode });
                            await reloadDisplayTemplates();
                          }
                        }}
                        className="px-2 py-0.5 text-[10px] rounded transition-colors"
                        style={{
                          backgroundColor: currentTpl?.displayMode === mode ? "var(--color-primary)" : "var(--color-surface)",
                          color: currentTpl?.displayMode === mode ? "var(--color-primary-text)" : "var(--color-text-muted)",
                          border: "1px solid var(--color-divider)",
                          opacity: currentTpl ? 1 : 0.5,
                        }}
                        disabled={!currentTpl}
                        title={currentTpl ? `Switch to ${mode} mode` : "Assign a template first"}
                      >{mode.charAt(0).toUpperCase() + mode.slice(1)}</button>
                    ))}
                  </div>
                </div>

                {/* ─── Incompatibility warning ─── */}
                {warning && (
                  <div className="text-[9px] px-2 py-1 rounded" style={{ backgroundColor: "rgba(242,182,97,0.12)", color: "#f2b661", border: "1px solid rgba(242,182,97,0.3)" }}>
                    {warning}
                  </div>
                )}

                {/* ─── Alignment ─── */}
                {currentTpl && (
                  <div>
                    <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Alignment</div>
                    <div className="flex gap-1">
                      {(["left", "center", "right"] as const).map((align) => (
                        <button
                          key={align}
                          onClick={async () => {
                            const usageCount = templateAssignments.filter((a) => a.templateId === currentTpl.id).length;
                            if (usageCount > 1 && !window.confirm(`This template is used by ${usageCount} columns — changes will apply to all. Continue?`)) return;
                            await updateDisplayTemplate(currentTpl.id, { alignment: align });
                            await reloadDisplayTemplates();
                          }}
                          className="px-2 py-0.5 text-[10px] rounded transition-colors"
                          style={{
                            backgroundColor: currentTpl.alignment === align ? "var(--color-primary)" : "var(--color-surface)",
                            color: currentTpl.alignment === align ? "var(--color-primary-text)" : "var(--color-text-muted)",
                            border: "1px solid var(--color-divider)",
                          }}
                        >{align.charAt(0).toUpperCase() + align.slice(1)}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ─── Text wrapping controls ─── */}
                {isTextCol && (
                  <>
                    <div>
                      <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Display</div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => updateColDisplay(subTab, colKey, { wrap: false, lines: 1 })}
                          className="px-2 py-0.5 text-[10px] rounded transition-colors"
                          style={{
                            backgroundColor: !isWrap ? "var(--color-primary)" : "var(--color-surface)",
                            color: !isWrap ? "var(--color-primary-text)" : "var(--color-text-muted)",
                            border: "1px solid var(--color-divider)",
                          }}
                        >Single line</button>
                        <button
                          onClick={() => updateColDisplay(subTab, colKey, { wrap: true, lines: currentLines < 2 ? 2 : currentLines })}
                          className="px-2 py-0.5 text-[10px] rounded transition-colors"
                          style={{
                            backgroundColor: isWrap ? "var(--color-primary)" : "var(--color-surface)",
                            color: isWrap ? "var(--color-primary-text)" : "var(--color-text-muted)",
                            border: "1px solid var(--color-divider)",
                          }}
                        >Multi-line</button>
                      </div>
                    </div>
                    {isWrap && (
                      <div>
                        <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Lines: {currentLines}</div>
                        <div className="flex items-center gap-2">
                          <input type="range" min={1} max={5} value={currentLines}
                            onChange={(e) => updateColDisplay(subTab, colKey, { lines: Number(e.target.value) })}
                            className="flex-1" style={{ accentColor: "var(--color-primary)" }} />
                          <span className="text-[10px] w-4 text-center" style={{ color: "var(--color-text)" }}>{currentLines}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {/* ─── Font size ─── */}
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Font Size: {cfg2.fontSize ?? currentTpl?.fontSize ?? 12}px</div>
                  <div className="flex items-center gap-2">
                    <input type="range" min={9} max={24} value={cfg2.fontSize ?? currentTpl?.fontSize ?? 12}
                      onChange={(e) => updateColDisplay(subTab, colKey, { fontSize: Number(e.target.value) })}
                      className="flex-1" style={{ accentColor: "var(--color-primary)" }} />
                    <span className="text-[10px] w-6 text-center" style={{ color: "var(--color-text)" }}>{cfg2.fontSize ?? currentTpl?.fontSize ?? 12}</span>
                  </div>
                </div>
                {/* ─── Bold & Underline ─── */}
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Style</div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => updateColDisplay(subTab, colKey, { fontBold: !cfg2.fontBold })}
                      className="w-7 h-7 rounded text-[13px] font-bold transition-colors"
                      style={{
                        backgroundColor: cfg2.fontBold ? "var(--color-primary)" : "var(--color-surface)",
                        color: cfg2.fontBold ? "var(--color-primary-text)" : "var(--color-text-muted)",
                        border: "1px solid var(--color-divider)",
                      }}
                      title="Bold"
                    >B</button>
                    <button
                      onClick={() => updateColDisplay(subTab, colKey, { fontUnderline: !cfg2.fontUnderline })}
                      className="w-7 h-7 rounded text-[13px] transition-colors"
                      style={{
                        backgroundColor: cfg2.fontUnderline ? "var(--color-primary)" : "var(--color-surface)",
                        color: cfg2.fontUnderline ? "var(--color-primary-text)" : "var(--color-text-muted)",
                        border: "1px solid var(--color-divider)",
                        textDecoration: "underline",
                      }}
                      title="Underline"
                    >U</button>
                  </div>
                </div>
                {/* ─── Font color swatches ─── */}
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Font Color</div>
                  <div className="flex gap-1 flex-wrap">
                    {[
                      { color: undefined, label: "Default" },
                      { color: "#ffffff", label: "White" },
                      { color: "#9999b3", label: "Muted" },
                      { color: "#5bc0de", label: "Cyan" },
                      { color: "#4ecb71", label: "Green" },
                      { color: "#f2b661", label: "Gold" },
                      { color: "#e67d4a", label: "Orange" },
                      { color: "#e05555", label: "Red" },
                      { color: "#a855f7", label: "Purple" },
                      { color: "#6c7bff", label: "Blue" },
                    ].map((s) => (
                      <button
                        key={s.label}
                        onClick={() => updateColDisplay(subTab, colKey, { fontColor: s.color })}
                        className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                        style={{
                          backgroundColor: s.color || "var(--color-text)",
                          borderColor: (cfg2.fontColor ?? undefined) === s.color ? "var(--color-primary)" : "transparent",
                          boxShadow: (cfg2.fontColor ?? undefined) === s.color ? "0 0 0 1px var(--color-primary)" : undefined,
                        }}
                        title={s.label}
                      />
                    ))}
                  </div>
                </div>
                {/* ─── Save / Update actions ─── */}
                <div className="border-t pt-2 space-y-1" style={{ borderColor: "var(--color-divider)" }}>
                  <button
                    onClick={async () => {
                      const name = window.prompt("Template name:");
                      if (!name?.trim()) return;
                      try {
                        const tpl = await createDisplayTemplate({
                          templateName: name.trim(),
                          displayMode: currentTpl?.displayMode || "text",
                          fontSize: cfg2.fontSize ?? currentTpl?.fontSize ?? 12,
                          fontBold: cfg2.fontBold ?? currentTpl?.fontBold ?? false,
                          fontUnderline: cfg2.fontUnderline ?? currentTpl?.fontUnderline ?? false,
                          fontColor: cfg2.fontColor ?? currentTpl?.fontColor ?? null,
                          alignment: currentTpl?.alignment || "left",
                          wrap: cfg2.wrap ?? currentTpl?.wrap ?? false,
                          lines: cfg2.lines ?? currentTpl?.lines ?? 1,
                          colorMapping: currentTpl?.colorMapping || {},
                        });
                        await assignColumnTemplate(entityType, colKey, tpl.id);
                        await reloadDisplayTemplates();
                      } catch (err: unknown) {
                        window.alert(err instanceof Error ? err.message : "Failed to create template");
                      }
                    }}
                    className="w-full text-[10px] px-2 py-1 rounded transition-colors hover:bg-white/5"
                    style={{ color: "#5bc0de", border: "1px solid rgba(91,192,222,0.3)" }}
                  >Save as New Template</button>
                  {currentTpl && (
                    <button
                      onClick={async () => {
                        const usageCount = templateAssignments.filter((a) => a.templateId === currentTpl.id).length;
                        if (usageCount > 1 && !window.confirm(`This will update "${currentTpl.templateName}" across ${usageCount} columns. Continue?`)) return;
                        await updateDisplayTemplate(currentTpl.id, {
                          fontSize: cfg2.fontSize ?? currentTpl.fontSize,
                          fontBold: cfg2.fontBold ?? currentTpl.fontBold,
                          fontUnderline: cfg2.fontUnderline ?? currentTpl.fontUnderline,
                          fontColor: cfg2.fontColor ?? currentTpl.fontColor,
                          wrap: cfg2.wrap ?? currentTpl.wrap,
                          lines: cfg2.lines ?? currentTpl.lines,
                        });
                        await reloadDisplayTemplates();
                      }}
                      className="w-full text-[10px] px-2 py-1 rounded transition-colors hover:bg-white/5"
                      style={{ color: "#4ecb71", border: "1px solid rgba(78,203,113,0.3)" }}
                    >Update "{currentTpl.templateName}"</button>
                  )}
                </div>

                {/* ─── Value color overrides (pill/chip/tag modes) ─── */}
                {currentTpl && (currentTpl.displayMode === "pill" || currentTpl.displayMode === "chip" || currentTpl.displayMode === "tag") && (() => {
                  // Collect distinct values for this column from the current data
                  const rows = (data[subTab] || []) as Record<string, unknown>[];
                  const valSet = new Set<string>();
                  for (const row of rows) {
                    const v = row[colKey];
                    if (v == null || v === "") continue;
                    if (Array.isArray(v)) {
                      for (const item of v) {
                        if (item != null) valSet.add(String(typeof item === "object" && "name" in (item as Record<string, unknown>) ? (item as { name: string }).name : item));
                      }
                    } else {
                      valSet.add(String(v));
                    }
                  }
                  const values = Array.from(valSet).sort();
                  if (values.length === 0) return null;
                  return (
                    <div className="border-t pt-2" style={{ borderColor: "var(--color-divider)" }}>
                      <div className="text-[10px] font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>Value Colors</div>
                      <div className="space-y-1 max-h-[120px] overflow-y-auto">
                        {values.map((val) => {
                          const autoColor = resolveTemplateColor(val, currentTpl);
                          const hasOverride = !!currentTpl.colorMapping[val];
                          return (
                            <div key={val} className="flex items-center gap-2 text-[10px]">
                              <span className="flex-1 truncate" style={{ color: "var(--color-text)" }}>{val}</span>
                              <div className="flex gap-0.5">
                                {TEMPLATE_PALETTE.map((c) => (
                                  <button
                                    key={c}
                                    onClick={async () => {
                                      const newMapping = { ...currentTpl.colorMapping, [val]: c };
                                      await updateDisplayTemplate(currentTpl.id, { colorMapping: newMapping });
                                      await reloadDisplayTemplates();
                                    }}
                                    className="w-3.5 h-3.5 rounded-full border transition-transform hover:scale-125"
                                    style={{
                                      backgroundColor: c,
                                      borderColor: autoColor === c ? "white" : "transparent",
                                      boxShadow: autoColor === c ? "0 0 0 1px " + c : undefined,
                                    }}
                                  />
                                ))}
                                {hasOverride && (
                                  <button
                                    onClick={async () => {
                                      const newMapping = { ...currentTpl.colorMapping };
                                      delete newMapping[val];
                                      await updateDisplayTemplate(currentTpl.id, { colorMapping: newMapping });
                                      await reloadDisplayTemplates();
                                    }}
                                    className="text-[8px] px-1 rounded hover:bg-red-500/10"
                                    style={{ color: "#e05555" }}
                                    title="Reset to auto"
                                  >x</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* ─── Manage Templates section ─── */}
                <details className="border-t pt-1" style={{ borderColor: "var(--color-divider)" }}>
                  <summary className="text-[10px] cursor-pointer py-1" style={{ color: "#5bc0de" }}>Manage Templates</summary>
                  <div className="space-y-1.5 mt-1 max-h-[200px] overflow-y-auto">
                    {displayTemplates.map((t) => {
                      const usageCount = templateAssignments.filter((a) => a.templateId === t.id).length;
                      return (
                        <div key={t.id} className="flex items-center gap-1 text-[10px] px-1 py-0.5 rounded" style={{ backgroundColor: currentTplId === t.id ? "var(--color-surface)" : "transparent" }}>
                          <span className="flex-1 truncate font-medium" style={{ color: currentTplId === t.id ? "#5bc0de" : "var(--color-text)" }}>{t.templateName}</span>
                          <span className="shrink-0 text-[9px]" style={{ color: "var(--color-text-muted)" }}>{usageCount} col{usageCount !== 1 ? "s" : ""}</span>
                          <button
                            onClick={async () => {
                              const name = window.prompt("Rename template:", t.templateName);
                              if (!name?.trim() || name.trim() === t.templateName) return;
                              try {
                                await updateDisplayTemplate(t.id, { templateName: name.trim() });
                                await reloadDisplayTemplates();
                              } catch (err: unknown) { window.alert(err instanceof Error ? err.message : "Rename failed"); }
                            }}
                            className="text-[9px] px-1 rounded hover:bg-white/10"
                            style={{ color: "var(--color-text-muted)" }}
                            title="Rename"
                          >Rn</button>
                          <button
                            onClick={async () => {
                              try {
                                await createDisplayTemplate({
                                  templateName: t.templateName + " (copy)",
                                  displayMode: t.displayMode,
                                  fontSize: t.fontSize,
                                  fontBold: t.fontBold,
                                  fontUnderline: t.fontUnderline,
                                  fontColor: t.fontColor,
                                  alignment: t.alignment,
                                  wrap: t.wrap,
                                  lines: t.lines,
                                  colorMapping: t.colorMapping,
                                });
                                await reloadDisplayTemplates();
                              } catch (err: unknown) { window.alert(err instanceof Error ? err.message : "Duplicate failed"); }
                            }}
                            className="text-[9px] px-1 rounded hover:bg-white/10"
                            style={{ color: "var(--color-text-muted)" }}
                            title="Duplicate"
                          >Dp</button>
                          <button
                            onClick={async () => {
                              if (usageCount > 0 && !window.confirm(`Delete "${t.templateName}"? ${usageCount} column${usageCount !== 1 ? "s" : ""} will revert to default.`)) return;
                              await deleteDisplayTemplate(t.id);
                              await reloadDisplayTemplates();
                            }}
                            className="text-[9px] px-1 rounded hover:bg-red-500/10"
                            style={{ color: "#e05555" }}
                            title="Delete"
                          >x</button>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </div>
            </div>
            </>
          );
        })()}

        {/* Reference summary popup (read-only module/feature viewer) */}
        {refSummaryPopup && (
          <RefSummaryPopup
            type={refSummaryPopup.type}
            record={refSummaryPopup.record}
            features={data.features as Record<string, unknown>[]}
            tables={mentionTables}
            fields={mentionFields}
            allFields={data.data_fields as Record<string, unknown>[]}
            modules={mentionModules}
            allFeatures={mentionFeatures}
            allConcepts={mentionConcepts}
            highlightFieldName={refSummaryPopup.highlightField}
            onClose={() => setRefSummaryPopup(null)}
            onFieldUpdate={(updatedField) => {
              applyLocalUpdate("data_fields", updatedField, `Edit field from ref popup`);
            }}
          />
        )}

        {/* Image viewer panel — draggable & resizable */}
        {imageViewer && (
          <div
            className="fixed z-[200] rounded-xl border shadow-2xl flex flex-col overflow-hidden"
            style={{
              left: imageViewer.x,
              top: imageViewer.y,
              width: imageViewer.width,
              height: imageViewer.height + 36, // +36 for title bar
              backgroundColor: "var(--color-background)",
              borderColor: "var(--color-divider)",
            }}
          >
            {/* Title bar — draggable */}
            <div
              className="flex items-center gap-2 px-4 py-2 border-b cursor-move select-none shrink-0"
              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}
              onMouseDown={(e) => {
                e.preventDefault();
                imageDrag.current = { startX: e.clientX, startY: e.clientY, origX: imageViewer.x, origY: imageViewer.y };
                const onMove = (ev: MouseEvent) => {
                  if (!imageDrag.current) return;
                  setImageViewer((prev) => prev ? { ...prev, x: imageDrag.current!.origX + ev.clientX - imageDrag.current!.startX, y: imageDrag.current!.origY + ev.clientY - imageDrag.current!.startY } : null);
                };
                const onUp = () => { imageDrag.current = null; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            >
              <span className="text-xs font-semibold" style={{ color: "#4ecb71" }}>🎨</span>
              <span className="text-sm font-semibold flex-1 truncate" style={{ color: "var(--color-text)" }}>{imageViewer.title}</span>
              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{imageViewer.width}×{imageViewer.height}</span>
              <button onClick={() => setImageViewer((prev) => prev ? { ...prev, zoom: Math.max(0.1, prev.zoom - 0.25) } : null)} className="text-sm leading-none px-1.5 rounded hover:bg-black/10 font-bold" style={{ color: "var(--color-text-muted)" }} title="Zoom out">−</button>
              <span className="text-[10px] w-10 text-center" style={{ color: "var(--color-text)" }}>{Math.round(imageViewer.zoom * 100)}%</span>
              <button onClick={() => setImageViewer((prev) => prev ? { ...prev, zoom: Math.min(5, prev.zoom + 0.25) } : null)} className="text-sm leading-none px-1.5 rounded hover:bg-black/10 font-bold" style={{ color: "var(--color-text-muted)" }} title="Zoom in">+</button>
              <button onClick={() => setImageViewer((prev) => prev ? { ...prev, zoom: 1 } : null)} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/10" style={{ color: "var(--color-text-muted)" }} title="Reset zoom">1:1</button>
              <button onClick={() => setImageViewer(null)} className="text-lg leading-none px-1 rounded hover:bg-black/10" style={{ color: "var(--color-text-muted)" }}>&times;</button>
            </div>
            {/* Image — zoom follows cursor, drag to pan */}
            <div
              className="flex-1 overflow-hidden"
              style={{ backgroundColor: "#000", cursor: imageViewer.zoom > 1 ? "grab" : "default", position: "relative" }}
              ref={(el) => {
                if (!el) return;
                el.onwheel = (e) => {
                  e.preventDefault();
                  const rect = el.getBoundingClientRect();
                  const pctX = ((e.clientX - rect.left) / rect.width) * 100;
                  const pctY = ((e.clientY - rect.top) / rect.height) * 100;
                  const delta = e.deltaY > 0 ? -0.15 : 0.15;
                  setImageViewer((prev) => prev ? { ...prev, zoom: Math.min(5, Math.max(0.1, prev.zoom + delta)), originX: pctX, originY: pctY } : null);
                };
              }}
              onMouseDown={(e) => {
                if (imageViewer.zoom <= 1) return;
                e.preventDefault();
                const el = e.currentTarget;
                imagePan.current = { startX: e.clientX, startY: e.clientY, origScrollLeft: el.scrollLeft, origScrollTop: el.scrollTop };
                el.style.cursor = "grabbing";
                const onMove = (ev: MouseEvent) => {
                  if (!imagePan.current) return;
                  el.scrollLeft = imagePan.current.origScrollLeft - (ev.clientX - imagePan.current.startX);
                  el.scrollTop = imagePan.current.origScrollTop - (ev.clientY - imagePan.current.startY);
                };
                const onUp = () => {
                  imagePan.current = null;
                  el.style.cursor = "grab";
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            >
              <img
                src={imageViewer.url}
                alt={imageViewer.title}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  transform: `scale(${imageViewer.zoom})`,
                  transformOrigin: `${imageViewer.originX}% ${imageViewer.originY}%`,
                }}
                draggable={false}
              />
            </div>
            {/* Resize handle — bottom right */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              style={{ background: "linear-gradient(135deg, transparent 50%, var(--color-text-muted) 50%)", opacity: 0.4, borderRadius: "0 0 12px 0" }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                imageResize.current = { startX: e.clientX, startY: e.clientY, origW: imageViewer.width, origH: imageViewer.height };
                const onMove = (ev: MouseEvent) => {
                  if (!imageResize.current) return;
                  const w = Math.max(200, imageResize.current.origW + ev.clientX - imageResize.current.startX);
                  const h = Math.max(150, imageResize.current.origH + ev.clientY - imageResize.current.startY);
                  setImageViewer((prev) => prev ? { ...prev, width: w, height: h } : null);
                };
                const onUp = () => { imageResize.current = null; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            />
          </div>
        )}

        {/* DragOverlay — renders outside the table so no DOM issues */}
        <DragOverlay dropAnimation={null}>
          {dragActiveRowId && (() => {
            const cfg2 = TABLE_CONFIGS[subTab];
            if (!cfg2) return null;
            const allRows = data[subTab] || [];
            const dragRow = allRows.find((r) => String(r[cfg2.idKey]) === dragActiveRowId);
            const displayName = dragRow ? String(dragRow[cfg2.nameKey || ""] || `#${dragActiveRowId}`) : dragActiveRowId;
            return (
              <div
                className="px-3 py-2 rounded-md shadow-lg text-xs font-medium border"
                style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)", color: "var(--color-text)", maxWidth: 250 }}
              >
                ⠿ {displayName}
              </div>
            );
          })()}
        </DragOverlay>
        </DndContext>
      )}

      {/* ─── Pagination controls (hidden when grouping is active — groups show all rows) ─── */}
      {!flatSections && pageSize > 0 && totalPages > 1 && filteredRows.length > 0 && (
        <div className="flex items-center justify-between mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
          <span>
            Showing {((safePage - 1) * pageSize) + 1}–{Math.min(safePage * pageSize, totalRows)} of {totalRows}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-black/5 transition-colors"
              style={{ borderColor: "var(--color-divider)" }}
            >
              ◀ Prev
            </button>
            {(() => {
              // Show page numbers: first, last, and nearby pages
              const pages: (number | "...")[] = [];
              for (let p = 1; p <= totalPages; p++) {
                if (p === 1 || p === totalPages || (p >= safePage - 2 && p <= safePage + 2)) {
                  pages.push(p);
                } else if (pages[pages.length - 1] !== "...") {
                  pages.push("...");
                }
              }
              return pages.map((p, i) =>
                p === "..." ? (
                  <span key={`dots-${i}`} className="px-1">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p as number)}
                    className="px-2 py-1 rounded border transition-colors"
                    style={{
                      borderColor: p === safePage ? "var(--color-primary)" : "var(--color-divider)",
                      backgroundColor: p === safePage ? "var(--color-primary)" : "transparent",
                      color: p === safePage ? "var(--color-primary-text)" : "var(--color-text-muted)",
                    }}
                  >
                    {p}
                  </button>
                )
              );
            })()}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-black/5 transition-colors"
              style={{ borderColor: "var(--color-divider)" }}
            >
              Next ▶
            </button>
          </div>
        </div>
      )}
      </>}

      {/* Field creation is now handled inline in ExpandedFieldRows + picker banner */}

      {/* ═══════ MODAL ═══════ */}
      {modalOpen && modalRecord && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="rounded-xl border shadow-2xl w-[540px] max-w-[95vw] max-h-[80vh] flex flex-col" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
              <h4 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                {modalIsNew ? `Add ${cfg.label.replace(/s$/, "")}` : `Edit ${cfg.label.replace(/s$/, "")}`}
              </h4>
              <button onClick={closeModal} className="text-lg leading-none" style={{ color: "var(--color-text-muted)" }}>&times;</button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
              {cfg.columns.map((col) => {
                if (col.type === "ref-features" || col.type === "formula") return null; // virtual columns, skip in modal
                if (col.hideInModal) return null;
                if (col.type === "separator") {
                  return (
                    <div key={col.key} className="flex items-center gap-3 py-1">
                      <div className="flex-1 border-t" style={{ borderColor: "var(--color-divider)" }} />
                      <span className="text-[10px] whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>{col.label}</span>
                      <div className="flex-1 border-t" style={{ borderColor: "var(--color-divider)" }} />
                    </div>
                  );
                }
                if (col.type === "readonly") {
                  if (modalIsNew || !modalRecord[col.key]) return null;
                  return (
                    <div key={col.key}>
                      <label className="text-xs font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>{col.label}</label>
                      <div className="text-xs font-mono" style={{ color: "var(--color-text-muted)" }}>{String(modalRecord[col.key])}</div>
                    </div>
                  );
                }

                // Conditional visibility
                if (col.conditionalOn && !modalRecord[col.conditionalOn]) return null;

                return (
                  <div key={col.key}>
                    <label className="text-xs font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>
                      {col.label}{col.required && <span style={{ color: "#e05555" }}> *</span>}
                    </label>

                    {col.type === "text" && (
                      <input
                        type="text"
                        value={String(modalRecord[col.key] ?? "")}
                        onChange={(e) => setModalRecord((prev) => prev ? { ...prev, [col.key]: e.target.value } : null)}
                        className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-1"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                      />
                    )}

                    {col.type === "textarea" && (
                      <textarea
                        value={String(modalRecord[col.key] ?? "")}
                        onChange={(e) => setModalRecord((prev) => prev ? { ...prev, [col.key]: e.target.value } : null)}
                        className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-1 resize-y"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)", minHeight: 60 }}
                      />
                    )}

                    {col.type === "int" && (
                      <input
                        type="number"
                        value={modalRecord[col.key] != null ? String(modalRecord[col.key]) : ""}
                        onChange={(e) => setModalRecord((prev) => prev ? { ...prev, [col.key]: e.target.value ? parseInt(e.target.value) : null } : null)}
                        className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-1"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                      />
                    )}

                    {col.type === "boolean" && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!modalRecord[col.key]}
                          onChange={(e) => setModalRecord((prev) => prev ? { ...prev, [col.key]: e.target.checked } : null)}
                          className="w-4 h-4 rounded"
                          style={{ accentColor: "var(--color-primary)" }}
                        />
                        <span className="text-sm" style={{ color: "var(--color-text)" }}>Enabled</span>
                      </label>
                    )}

                    {col.type === "enum" && col.key === "recordOwnership" && (
                      <select
                        value={String(modalRecord[col.key] ?? "")}
                        onChange={(e) => setModalRecord((prev) => prev ? { ...prev, [col.key]: e.target.value || null } : null)}
                        className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-1 cursor-pointer"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                      >
                        <option value="">— Select —</option>
                        {OWNERSHIP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    )}

                    {col.type === "enum" && col.key !== "recordOwnership" && (
                      <select
                        value={String(modalRecord[col.key] ?? "")}
                        onChange={(e) => setModalRecord((prev) => prev ? { ...prev, [col.key]: e.target.value || null } : null)}
                        className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-1 cursor-pointer"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                      >
                        <option value="">— Select —</option>
                        {(col.options || []).map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    )}

                    {col.type === "fk" && (
                      <select
                        value={String(modalRecord[col.key] ?? "")}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value) : null;
                          setModalRecord((prev) => {
                            if (!prev) return null;
                            const updated = { ...prev, [col.key]: val };
                            // Clear cascade children
                            cfg.columns.forEach((c) => {
                              if (c.cascadeFrom === col.key) updated[c.key] = null;
                            });
                            return updated;
                          });
                        }}
                        className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-1 cursor-pointer"
                        style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                      >
                        <option value="">— Select —</option>
                        {getFKOptions(
                          col.fkTable!,
                          col.cascadeFrom ? col.cascadeKey : undefined,
                          col.cascadeFrom ? modalRecord[col.cascadeFrom] : undefined
                        ).map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    )}

                    {col.type === "multi-fk" && (
                      <MultiSelect
                        options={getFKOptions(col.fkTable!)}
                        selected={(Array.isArray(modalRecord[col.key]) ? modalRecord[col.key] : []) as number[]}
                        onChange={(ids) => setModalRecord((prev) => prev ? { ...prev, [col.key]: ids } : null)}
                      />
                    )}

                    {col.type === "tags" && (
                      <TagsInput
                        tags={(Array.isArray(modalRecord[col.key]) ? modalRecord[col.key] : []) as string[]}
                        onChange={(tags) => setModalRecord((prev) => prev ? { ...prev, [col.key]: tags } : null)}
                      />
                    )}

                    {col.type === "module-tags" && (
                      <ModuleTagsEditor
                        tags={(Array.isArray(modalRecord[col.key]) ? modalRecord[col.key] : []) as Array<{ name: string; tier: number }>}
                        onChange={(tags) => setModalRecord((prev) => prev ? { ...prev, [col.key]: tags } : null)}
                      />
                    )}

                    {col.type === "checklist" && (
                      <ChecklistEditor
                        items={(Array.isArray(modalRecord[col.key]) ? modalRecord[col.key] : []) as Array<{ item: string; checked: boolean }>}
                        onChange={(items) => setModalRecord((prev) => prev ? { ...prev, [col.key]: items } : null)}
                      />
                    )}

                    {col.type === "platforms" && (
                      <div className="flex flex-wrap gap-1.5">
                        {PLATFORM_OPTIONS.map((p) => {
                          const plats = (Array.isArray(modalRecord[col.key]) ? modalRecord[col.key] : ["Web App"]) as string[];
                          const active = plats.includes(p);
                          const isPermanent = p === "Web App";
                          const c = PLATFORM_COLORS[p];
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                if (isPermanent) return;
                                const next = active ? plats.filter((x) => x !== p) : [...plats, p];
                                setModalRecord((prev) => prev ? { ...prev, [col.key]: next } : null);
                              }}
                              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${isPermanent ? "cursor-default" : "cursor-pointer hover:opacity-80"}`}
                              style={{
                                backgroundColor: active ? c.bg : "transparent",
                                color: active ? c.text : "var(--color-text-muted)",
                                border: `1px solid ${active ? c.border : "var(--color-divider)"}`,
                                opacity: active ? 1 : 0.5,
                              }}
                            >
                              {p}{isPermanent && " ✓"}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {col.hint && <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>{col.hint}</p>}
                  </div>
                );
              })}

              {/* Ownership reference table — shown only in Data Tables modal */}
              {subTab === "data_tables" && (
                <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--color-divider)" }}>
                  <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--color-text-muted)" }}>Ownership Reference</p>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "var(--color-divider)" }}>
                        <th className="text-left py-1 pr-2 font-semibold" style={{ color: "var(--color-text-muted)", width: "100px" }}>Value</th>
                        <th className="text-left py-1 pr-2 font-semibold" style={{ color: "var(--color-text-muted)" }}>Meaning</th>
                        <th className="text-left py-1 font-semibold" style={{ color: "var(--color-text-muted)", width: "180px" }}>Example Tables</th>
                      </tr>
                    </thead>
                    <tbody>
                      {OWNERSHIP_OPTIONS.map((o) => (
                        <tr key={o.value} className="border-b" style={{ borderColor: "var(--color-divider)" }}>
                          <td className="py-1.5 pr-2"><Pill value={o.value} /></td>
                          <td className="py-1.5 pr-2" style={{ color: "var(--color-text)" }}>{o.label.split(" — ")[1]}</td>
                          <td className="py-1.5 font-mono" style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>{o.example}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-3 border-t" style={{ borderColor: "var(--color-divider)" }}>
              <div className="flex-1">
                <label className="text-xs font-medium block mb-1" style={{ color: "var(--color-text-muted)" }}>Reasoning <span style={{ opacity: 0.5 }}>(optional)</span></label>
                <input
                  type="text"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="Why this change? (auto-generated if blank)"
                  className="w-full px-3 py-1.5 text-sm rounded-md border focus:outline-none focus:ring-1"
                  style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleModalSave(); }}
                />
              </div>
              <div className="flex gap-2 pt-5">
                <button onClick={closeModal} className="px-3 py-1.5 text-xs rounded-md border" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>Cancel</button>
                <button onClick={handleModalSave} className="px-3 py-1.5 text-xs rounded-md font-medium" style={{ backgroundColor: "var(--color-primary)", color: "var(--color-primary-text)" }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════ DELETE CONFIRM ═══════ */}
      {deleteTarget && (() => {
        const deleteCfg = TABLE_CONFIGS[deleteTargetTab ?? subTab] ?? cfg;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-xl border shadow-2xl w-[400px] p-5" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Delete {deleteCfg.label.replace(/s$/, "")}?</h4>
            <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
              Are you sure you want to delete &ldquo;{deleteCfg.nameKey ? String(deleteTarget[deleteCfg.nameKey] ?? `#${deleteTarget[deleteCfg.idKey]}`) : `#${deleteTarget[deleteCfg.idKey]}`}&rdquo;?
            </p>
            <label className="text-xs font-medium block mb-1" style={{ color: "#f2b661" }}>Reasoning *</label>
            <input
              type="text"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="Why this deletion?"
              className="w-full px-3 py-1.5 text-sm rounded-md border mb-4 focus:outline-none focus:ring-1"
              style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
              onKeyDown={(e) => { if (e.key === "Enter") executeDelete(); }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteTarget(null); setDeleteTargetTab(null); }} className="px-3 py-1.5 text-xs rounded-md border" style={{ borderColor: "var(--color-divider)", color: "var(--color-text-muted)" }}>Cancel</button>
              <button onClick={executeDelete} className="px-3 py-1.5 text-xs rounded-md font-medium" style={{ backgroundColor: "#e05555", color: "#fff" }}>Delete</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ═══════ CREATE CODE CHANGE FROM ENTITY ═══════ */}
      {codeChangeEntity && (() => {
        const depType = codeChangeEntity.type;
        const depLabel = depType === "feature" ? "Feature" : depType === "module" ? "Module" : "Concept";
        const changeName = `Implement ${depLabel}: ${codeChangeEntity.name}`;
        const prompt = `/ap ${changeName}

## Understanding
${depLabel} "${codeChangeEntity.name}" needs implementation or changes.

## Implementation Plan
[Describe what needs to be done]

## Dependencies
- ${depLabel}: ${codeChangeEntity.name}

## Files
[List files that will be modified]`;

        const handleCreate = async () => {
          if (!codeChangeProject) return;
          try {
            await fetch("/api/schema-planner", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                table: "_splan_code_changes",
                data: {
                  projectId: codeChangeProject,
                  branch: codeChangeBranch,
                  changeName,
                  changeType: codeChangeType,
                  implementationPrompt: prompt,
                  dependencies: [{ type: depType, id: codeChangeEntity.id }],
                },
                reasoning: `Created from ${depLabel}: ${codeChangeEntity.name}`,
              }),
            });
            setCodeChangeCreated(true);
            navigator.clipboard.writeText(prompt).catch(() => {});
          } catch { /* ignore */ }
        };

        const handleCopy = () => {
          navigator.clipboard.writeText(prompt).then(() => {
            setCodeChangeCopied(true);
            setTimeout(() => setCodeChangeCopied(false), 2000);
          });
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={(e) => { if (e.target === e.currentTarget) setCodeChangeEntity(null); }}>
            <div className="rounded-lg shadow-xl overflow-hidden flex flex-col" style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-divider)", width: 620, maxHeight: "85vh" }}>
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
                <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  Create Code Change — {depLabel}: {codeChangeEntity.name}
                </span>
                <button onClick={() => setCodeChangeEntity(null)} className="text-xs px-2 py-1 rounded hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>x</button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {/* Project & Branch selection */}
                <div className="flex gap-3 mb-3">
                  <div className="flex-1">
                    <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--color-text-subtle)" }}>Project</label>
                    <select
                      value={codeChangeProject ?? ""}
                      onChange={(e) => setCodeChangeProject(Number(e.target.value))}
                      className="w-full px-2 py-1.5 text-xs rounded border"
                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                    >
                      {codeChangeProjects.length === 0 && <option value="">No projects — create one in Projects tab</option>}
                      {codeChangeProjects.map(p => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--color-text-subtle)" }}>Branch</label>
                    <select
                      value={codeChangeBranch}
                      onChange={(e) => setCodeChangeBranch(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs rounded border"
                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                    >
                      <option value="live">Live</option>
                      <option value="primary_dev">Primary Dev</option>
                      <option value="secondary_dev">Secondary Dev</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--color-text-subtle)" }}>Type</label>
                    <select
                      value={codeChangeType}
                      onChange={(e) => setCodeChangeType(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs rounded border"
                      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", color: "var(--color-text)" }}
                    >
                      <option value="Working Through">Working Through</option>
                      <option value="Prototype">Prototype</option>
                      <option value="Data Change">Data Change</option>
                    </select>
                  </div>
                </div>

                {/* Generated prompt preview */}
                <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--color-text-subtle)" }}>Generated Prompt (copy into Claude Code)</label>
                <pre
                  className="text-xs font-mono whitespace-pre-wrap rounded p-3 mb-3"
                  style={{ backgroundColor: "var(--color-background)", color: "var(--color-text-muted)", border: "1px solid var(--color-divider)", maxHeight: 250, overflowY: "auto" }}
                >
                  {prompt}
                </pre>

                {/* Dependency badge */}
                <div className="mb-3">
                  <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--color-text-subtle)" }}>Dependency (auto-linked)</label>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium" style={{
                    backgroundColor: depType === "feature" ? "rgba(168,85,247,0.15)" : depType === "module" ? "rgba(230,125,74,0.15)" : "rgba(242,182,97,0.15)",
                    color: depType === "feature" ? "#a855f7" : depType === "module" ? "#e67d4a" : "#f2b661",
                  }}>
                    {depLabel}: {codeChangeEntity.name}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: "var(--color-divider)" }}>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
                    style={{ backgroundColor: codeChangeCopied ? "rgba(78,203,113,0.2)" : "rgba(66,139,202,0.15)", color: codeChangeCopied ? "#4ecb71" : "#428bca" }}
                  >
                    {codeChangeCopied ? "Copied!" : "Copy Prompt"}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!codeChangeProject || codeChangeCreated}
                    className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
                    style={{ backgroundColor: codeChangeCreated ? "rgba(78,203,113,0.2)" : "rgba(78,203,113,0.15)", color: "#4ecb71", opacity: (!codeChangeProject || codeChangeCreated) ? 0.5 : 1 }}
                  >
                    {codeChangeCreated ? "Record Created" : "Create Record & Copy"}
                  </button>
                </div>
                <button onClick={() => setCodeChangeEntity(null)} className="px-3 py-1.5 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════ FEATURE IMPACT MODAL ═══════ */}
      {impactFeatureId != null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} onClick={(e) => { if (e.target === e.currentTarget) { setImpactFeatureId(null); setImpactData(null); } }}>
          <div className="rounded-xl border shadow-2xl w-[700px] max-w-[95vw] max-h-[80vh] flex flex-col" style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}>
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--color-divider)" }}>
              <h4 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                Feature Impact Analysis
              </h4>
              <button onClick={() => { setImpactFeatureId(null); setImpactData(null); }} className="text-lg leading-none" style={{ color: "var(--color-text-muted)" }}>&times;</button>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
              {impactLoading && <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Loading...</p>}
              {!impactLoading && impactData && (
                <>
                  <div>
                    <h5 className="text-xs font-semibold mb-1" style={{ color: "var(--color-text)" }}>
                      {String(impactData.feature?.featureName ?? "")}
                    </h5>
                    <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>{String(impactData.feature?.description ?? "No description")}</p>
                  </div>

                  {/* Data Tables */}
                  <div>
                    <h5 className="text-xs font-semibold mb-2" style={{ color: "var(--color-text)" }}>Linked Data Tables</h5>
                    {impactData.tables.length === 0 ? (
                      <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>No data tables linked to this feature.</p>
                    ) : (
                      <div className="space-y-2">
                        {impactData.tables.map((t) => (
                          <div key={t.tableId} className="p-2.5 rounded-lg border" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs font-medium" style={{ color: "var(--color-text)" }}>{t.tableName}</span>
                              {t.recordOwnership && <Pill value={t.recordOwnership} />}
                            </div>
                            {t.rules.length === 0 ? (
                              <p className="text-[10px] px-2 py-1 rounded" style={{ backgroundColor: "rgba(242,182,97,0.1)", color: "#f2b661" }}>
                                No access rules defined
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {t.rules.map((r, i) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: PILL_COLORS[String(r.accessLevel)]?.bg || "var(--color-surface)", color: PILL_COLORS[String(r.accessLevel)]?.text || "var(--color-text)", border: `1px solid ${PILL_COLORS[String(r.accessLevel)]?.border || "var(--color-divider)"}` }}>
                                    {[r.businessType, r.role, r.userType].filter(Boolean).join(" / ") || "All"} → {String(r.accessLevel)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Gaps */}
                  {impactData.gaps.length > 0 && (
                    <div className="p-3 rounded-lg" style={{ backgroundColor: "rgba(242,182,97,0.08)", border: "1px solid rgba(242,182,97,0.25)" }}>
                      <h5 className="text-xs font-semibold mb-1" style={{ color: "#f2b661" }}>Coverage Gaps</h5>
                      <p className="text-[11px] mb-1" style={{ color: "var(--color-text-muted)" }}>These tables have no access rules defined:</p>
                      <div className="flex flex-wrap gap-1">
                        {impactData.gaps.map((g) => (
                          <span key={g.tableId} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(242,182,97,0.15)", color: "#f2b661", border: "1px solid rgba(242,182,97,0.3)" }}>
                            {g.tableName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Review Status */}
                  <div className="pt-2 border-t" style={{ borderColor: "var(--color-divider)" }}>
                    <h5 className="text-xs font-semibold mb-2" style={{ color: "var(--color-text)" }}>Data Review</h5>
                    {impactData.review ? (
                      <div className="flex items-center gap-2">
                        <Pill value={String(impactData.review.status)} />
                        <span className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                          {impactData.review.reviewedBy ? `by ${impactData.review.reviewedBy}` : "Not yet reviewed"}
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={async () => {
                          await fetch("/api/schema-planner", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              table: "_splan_feature_data_reviews",
                              data: {
                                featureId: impactFeatureId,
                                status: "pending",
                                checklist: DEFAULT_CHECKLIST_ITEMS.map((item) => ({ item, checked: false })),
                              },
                              reasoning: "Auto-created from impact analysis",
                            }),
                          });
                          setImpactFeatureId((prev) => prev); // force re-fetch
                          // Reload data_reviews tab to pick up the new review
                          setLoadedTabs((prev) => { const n = new Set(prev); n.delete("data_reviews"); loadedTabsRef.current = n; return n; });
                          loadTabs(["data_reviews"], true);
                        }}
                        className="px-3 py-1.5 text-xs rounded-md font-medium"
                        style={{ backgroundColor: "var(--color-primary)", color: "var(--color-primary-text)" }}
                      >
                        Create Review
                      </button>
                    )}
                  </div>
                </>
              )}
              {!impactLoading && !impactData && (
                <p className="text-xs" style={{ color: "#e05555" }}>Failed to load impact data.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════ RULE BUILDER POPUP ═══════ */}
      {ruleBuilderOpen && (
        <RuleBuilderPopup
          moduleId={ruleBuilderOpen.moduleId}
          moduleName={ruleBuilderOpen.moduleName}
          relationship={ruleBuilderOpen.relationship}
          rules={moduleRules
            .filter((r) => r.entityType === "module" && r.entityId === ruleBuilderOpen.moduleId && r.relationship === ruleBuilderOpen.relationship)
            .map((r) => ({
              ruleId: r.ruleId as number,
              entityType: "module",
              entityId: ruleBuilderOpen.moduleId,
              relationship: ruleBuilderOpen.relationship,
              sourceTable: String(r.sourceTable ?? ""),
              sourceRefId: r.sourceRefId as number | null,
              sourceRefLabel: String(r.sourceRefLabel ?? ""),
              logic: String(r.logic ?? "AND"),
              conditions: (Array.isArray(r.conditions) ? r.conditions : []) as RuleCondition[],
              sortOrder: (r.sortOrder ?? 0) as number,
            }))}
          dataTables={(data.data_tables || []).map((t) => ({ tableId: t.tableId as number, tableName: String(t.tableName) }))}
          dataFields={(data.data_fields || []).map((f) => ({ fieldId: f.fieldId as number, fieldName: String(f.fieldName), dataTableId: f.dataTableId as number }))}
          onSave={async (created, updated, deleted) => {
            try {
              // Delete removed rules
              for (const id of deleted) {
                await fetch("/api/schema-planner", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ table: "_splan_entity_or_module_rules", id, reasoning: "Removed rule" }),
                });
              }
              // Update existing rules
              for (const r of updated) {
                await fetch("/api/schema-planner", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    table: "_splan_entity_or_module_rules",
                    id: r.ruleId,
                    data: {
                      sourceTable: r.sourceTable,
                      sourceRefId: r.sourceRefId,
                      sourceRefLabel: r.sourceRefLabel,
                      logic: r.logic,
                      conditions: r.conditions,
                      sortOrder: r.sortOrder,
                    },
                    reasoning: "Updated rule",
                  }),
                });
              }
              // Create new rules
              for (const r of created) {
                await fetch("/api/schema-planner", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    table: "_splan_entity_or_module_rules",
                    data: {
                      entityType: r.entityType,
                      entityId: r.entityId,
                      relationship: r.relationship,
                      sourceTable: r.sourceTable,
                      sourceRefId: r.sourceRefId,
                      sourceRefLabel: r.sourceRefLabel,
                      logic: r.logic,
                      conditions: r.conditions,
                      sortOrder: r.sortOrder,
                    },
                    reasoning: "Created rule",
                  }),
                });
              }
              // Reload rules
              await loadModuleRules();
              setRuleBuilderOpen(null);
            } catch (err) {
              console.error("Rule save error:", err);
              alert("Failed to save rules. Check console for details.");
            }
          }}
          onClose={() => setRuleBuilderOpen(null)}
        />
      )}

      {/* ═══ Image carousel modal ═══ */}
      {carouselState && (() => {
        const row = carouselState.row;
        const tabKey = carouselState.tabKey;
        const cfg = TABLE_CONFIGS[tabKey];
        const nameKey = cfg?.nameKey;
        const entityName = nameKey ? String(row[nameKey] || "Untitled") : "Untitled";
        const idKey = cfg?.idKey;
        const entityId = idKey ? (row[idKey] as number) : 0;
        return (
          <ImageCarouselModal
            images={(Array.isArray(row.images) ? row.images : []) as Array<{ id: string; url: string; title: string; createdAt: string }>}
            entityId={entityId}
            entityType={tabKey}
            entityName={entityName}
            onUpdate={(images) => {
              const updated = { ...row, images };
              setCarouselState({ row: updated, tabKey });
              applyLocalUpdate(tabKey, updated, "Updated images");
            }}
            onClose={() => setCarouselState(null)}
          />
        );
      })()}

      {/* ═══ Entity tests popup (features, concepts, modules) ═══ */}
      {testPopupState && (
        <FeatureTestsPopup
          entityType={testPopupState.entityType}
          entityId={testPopupState.row[testPopupState.idKey] as number}
          entityName={String(testPopupState.row[testPopupState.nameKey] || "Untitled")}
          entityUpdatedAt={String(testPopupState.row.updatedAt ?? "")}
          testsDismissedAt={(testPopupState.row.testsDismissedAt as string | null) ?? null}
          refLookup={{
            tables: (data.data_tables || []).map(t => ({ id: t.tableId as number, name: String(t.tableName ?? "") })),
            fields: (data.data_fields || []).map(f => ({ id: f.fieldId as number, name: String(f.fieldName ?? ""), tableId: f.dataTableId as number, tableName: String((data.data_tables || []).find(t => t.tableId === f.dataTableId)?.tableName ?? "") })),
            modules: (data.modules || []).map(m => ({ id: m.moduleId as number, name: String(m.moduleName ?? "") })),
            features: (data.features || []).map(f => ({ id: f.featureId as number, name: String(f.featureName ?? "") })),
            concepts: (data.concepts || []).map(c => ({ id: c.conceptId as number, name: String(c.conceptName ?? "") })),
          }}
          onClose={() => setTestPopupState(null)}
          onDismissStaleness={() => {
            const now = new Date().toISOString();
            const updated = { ...testPopupState.row, testsDismissedAt: now };
            setTestPopupState({ ...testPopupState, row: updated });
            applyLocalUpdate(testPopupState.tabKey, updated, "Dismissed test staleness");
          }}
          onTestCountChange={(count, latestUpdatedAt) => {
            const eid = testPopupState.row[testPopupState.idKey] as number;
            setEntityTestCounts((prev) => ({
              ...prev,
              [testPopupState.tabKey]: { ...(prev[testPopupState.tabKey] ?? {}), [eid]: { count, latestUpdatedAt } },
            }));
          }}
        />
      )}

      {/* ═══ Generalized fullscreen note overlay (any entity, any notes column) ═══ */}
      {fullscreenNote && (() => {
        const { row, tabKey, noteKey } = fullscreenNote;
        const tabCfg = TABLE_CONFIGS[tabKey];
        const entityType = tabCfg?.entityType || tabKey;
        const eid = tabCfg?.idKey ? (row[tabCfg.idKey] as number) : 0;
        const entityName = String((tabCfg?.nameKey ? row[tabCfg.nameKey] : row.name) || "Untitled");
        const noteColor = "#5bc0de";
        const cacheKey = noteCacheKey(entityType, eid, noteKey);
        const cached = entityNotesCache[cacheKey];

        // Initial values: prefer cache, fall back to legacy row fields (Concepts pre-migration).
        // Each _splan_entity_notes row stores the per-section collapsed/tables maps directly
        // (not nested by noteKey) — the row IS the single note.
        const initialContent = cached?.content ?? (noteKey === "notes" ? String(row.notes ?? "") : "");
        const initialFmt = (cached?.notesFmt ?? (noteKey === "notes" && Array.isArray(row.notesFmt) ? row.notesFmt : [])) as FmtRange[];
        const cachedCollapsed = cached?.collapsedSections as Record<string, { body: string; bodyFmt: FmtRange[] }> | undefined;
        const legacyCollapsed = ((row.collapsedSections as Record<string, Record<string, { body: string; bodyFmt: FmtRange[] }>> | null) ?? {})[noteKey];
        const initialCollapsed = cachedCollapsed && Object.keys(cachedCollapsed).length > 0 ? cachedCollapsed : legacyCollapsed;
        const cachedTables = cached?.embeddedTables as Record<string, import("./schema-planner/types").EmbeddedTable> | undefined;
        const legacyTables = ((row.embeddedTables as Record<string, Record<string, unknown>> | null) ?? {})[noteKey];
        const initialTables = cachedTables && Object.keys(cachedTables).length > 0 ? cachedTables : (legacyTables as Record<string, import("./schema-planner/types").EmbeddedTable> | undefined);

        const persist = async (
          content: string | null,
          fmt: unknown,
          collapsed: Record<string, unknown> | undefined,
          tables: Record<string, unknown> | undefined
        ) => {
          try {
            const saved = await saveEntityNote({
              entityType,
              entityId: eid,
              noteKey,
              content,
              notesFmt: fmt,
              collapsedSections: collapsed ?? {},
              embeddedTables: tables ?? {},
            });
            setEntityNotesCache((prev) => ({ ...prev, [cacheKey]: saved }));
          } catch (err) {
            console.error("Failed to save note:", err);
          }
        };

        return (
          <div
            className="fixed inset-0 z-50 flex flex-col"
            style={{ background: "var(--color-background)" }}
          >
            {/* Header bar */}
            <div
              className="flex items-center justify-between px-6 py-3 border-b shrink-0"
              style={{ borderColor: "var(--color-divider)", background: "var(--color-surface)" }}
            >
              <label className="font-semibold flex items-center gap-2 text-sm" style={{ color: "var(--color-text)" }}>
                <button
                  onClick={() => setFullscreenNote(null)}
                  className="inline-block w-3 h-3 rounded-full cursor-pointer transition-all hover:scale-125 hover:ring-2 hover:ring-offset-1"
                  style={{ backgroundColor: noteColor, ringColor: noteColor, ringOffsetColor: "var(--color-surface)" }}
                  title="Close"
                />
                {entityName} — {tabCfg?.columns.find((c) => c.key === noteKey)?.label || "Notes"}
                <span className="font-normal text-xs" style={{ opacity: 0.5 }}>— type ( to reference</span>
              </label>
              <button
                onClick={() => setFullscreenNote(null)}
                className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-white/10 transition-colors"
                style={{ color: "var(--color-text-muted)" }}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
            {/* Content area */}
            <div className="flex-1 overflow-auto p-6 fullscreen-note-content">
              <FeatureMentionField
                initial={initialContent}
                initialFmt={initialFmt}
                onCommit={(text, fmt, collapsed, tables) => {
                  void persist(
                    text || null,
                    fmt,
                    collapsed ?? (cached?.collapsedSections as Record<string, unknown> | undefined),
                    tables ?? (cached?.embeddedTables as Record<string, unknown> | undefined)
                  );
                }}
                tables={mentionTables}
                fields={mentionFields}
                tableNames={mentionTableNames}
                fieldDisplayNames={mentionFieldDisplayNames}
                images={(Array.isArray(row.images) ? row.images : []) as Array<{ id: string; url: string; title: string; createdAt: string }>}
                modules={mentionModules}
                features={mentionFeatures}
                concepts={mentionConcepts}
                research={mentionResearch}
                onRefNavigate={(type, name) => {
                  if (type === "table") {
                    const tbl = (data.data_tables || []).find((t) => String(t.tableName) === name);
                    if (tbl) setRefSummaryPopup({ type: "table", record: tbl as Record<string, unknown> });
                  } else if (type === "field") {
                    const parts = name.split(".");
                    const tblName = parts[0];
                    const fieldName = parts.slice(1).join(".");
                    const tbl = (data.data_tables || []).find((t) => String(t.tableName) === tblName);
                    if (tbl) setRefSummaryPopup({ type: "table", record: tbl as Record<string, unknown>, highlightField: fieldName });
                  } else if (type === "module") {
                    const mod = (data.modules || []).find((m) => String(m.moduleName) === name);
                    if (mod) setRefSummaryPopup({ type: "module", record: mod as Record<string, unknown> });
                  } else if (type === "feature") {
                    const feat = (data.features || []).find((f) => String(f.featureName) === name);
                    if (feat) setRefSummaryPopup({ type: "feature", record: feat as Record<string, unknown> });
                  } else if (type === "concept") {
                    const con = (data.concepts || []).find((c) => String(c.conceptName) === name);
                    if (con) setRefSummaryPopup({ type: "concept", record: con as Record<string, unknown> });
                  } else if (type === "research") {
                    const res = (data.research || []).find((r) => String(r.title) === name);
                    if (res) setRefSummaryPopup({ type: "research", record: res as Record<string, unknown> });
                  } else if (type === "image") {
                    const imgs = (Array.isArray(row.images) ? row.images : []) as Array<{ id: string; url: string; title: string }>;
                    const img = imgs.find((im) => im.title === name);
                    if (img?.url) setImageViewer({ url: img.url, title: img.title, x: 100, y: 100, width: 1200, height: 600, zoom: 1, originX: 50, originY: 50 });
                  }
                }}
                onCreateRef={() => {}}
                tableDetails={data.data_tables as Array<Record<string, unknown>>}
                placeholder="Notes... type ( to reference a table, field, or image"
                initialCollapsed={initialCollapsed}
                onCollapsedChange={(collapsed) => {
                  void persist(
                    cached?.content ?? initialContent,
                    cached?.notesFmt ?? initialFmt,
                    collapsed,
                    cached?.embeddedTables as Record<string, unknown> | undefined
                  );
                }}
                initialTables={initialTables}
                onTablesChange={(tbls) => {
                  void persist(
                    cached?.content ?? initialContent,
                    cached?.notesFmt ?? initialFmt,
                    cached?.collapsedSections as Record<string, unknown> | undefined,
                    tbls
                  );
                }}
                noteContext={{ feature: entityName, featureColor: noteColor, field: tabCfg?.columns.find((c) => c.key === noteKey)?.label || "Notes", fieldColor: "#4ecb71" }}
              />
              {/* ─── Images (concepts-only legacy gallery — uses concepts.images column) ─── */}
              {tabKey === "concepts" && (
                <div className="mt-4">
                  <FeatureImageGallery
                    images={(Array.isArray(row.images) ? row.images : []) as Array<{ id: string; url: string; title: string; createdAt: string }>}
                    featureId={eid}
                    entityType="concepts"
                    onUpdate={(images) => {
                      const updated = { ...row, images };
                      setFullscreenNote({ row: updated, tabKey, noteKey });
                      applyLocalUpdate("concepts", updated, "Updated images");
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── Persistent template undo bar ─── */}
      {templateUndoHistory.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] rounded-lg border shadow-xl"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)", minWidth: 320, maxWidth: 500 }}>
          <div className="flex items-center gap-3 px-4 py-2">
            <span className="text-[11px] flex-1 truncate" style={{ color: "var(--color-text)" }}>{templateUndoHistory[0].description}</span>
            <button
              onClick={() => executeUndo(templateUndoHistory[0])}
              className="text-[11px] font-semibold px-2 py-0.5 rounded transition-colors hover:bg-white/10 shrink-0"
              style={{ color: "#5bc0de", border: "1px solid rgba(91,192,222,0.3)" }}
            >Undo{templateUndoHistory.length > 1 ? ` (${templateUndoHistory.length})` : ""}</button>
            <button
              onClick={() => setUndoHistoryOpen((p) => !p)}
              className="text-[10px] px-1 rounded hover:bg-white/10 shrink-0"
              style={{ color: "var(--color-text-muted)" }}
              title="Show undo history"
            >{undoHistoryOpen ? "▼" : "▲"}</button>
            <button
              onClick={() => setTemplateUndoHistory([])}
              className="text-[10px] px-1 rounded hover:bg-black/10 shrink-0"
              style={{ color: "var(--color-text-muted)" }}
              title="Clear all undo history"
            >✕</button>
          </div>
          {undoHistoryOpen && (
            <div className="border-t px-2 py-1 max-h-[200px] overflow-y-auto" style={{ borderColor: "var(--color-divider)" }}>
              {templateUndoHistory.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 py-1 text-[10px]">
                  <span className="shrink-0" style={{ color: "var(--color-text-muted)" }}>{entry.timestamp}</span>
                  <span className="flex-1 truncate" style={{ color: "var(--color-text)" }}>{entry.description}</span>
                  <button
                    onClick={() => executeUndo(entry)}
                    className="text-[9px] px-1.5 py-0.5 rounded hover:bg-white/10 shrink-0"
                    style={{ color: "#5bc0de", border: "1px solid rgba(91,192,222,0.3)" }}
                  >Undo</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

