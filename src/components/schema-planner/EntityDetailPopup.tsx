import React, { useState, useEffect } from "react";
import { TABLE_CONFIGS, PILL_COLORS } from "./constants";

/** Maps entity type strings to their TABLE_CONFIGS key and API table */
const ENTITY_TAB_MAP: Record<string, { tabKey: string; apiTable: string; idKey: string; nameKey: string | null }> = {
  feature:    { tabKey: "features",    apiTable: "_splan_features",    idKey: "featureId",  nameKey: "featureName" },
  module:     { tabKey: "modules",     apiTable: "_splan_modules",     idKey: "moduleId",   nameKey: "moduleName" },
  concept:    { tabKey: "concepts",    apiTable: "_splan_concepts",    idKey: "conceptId",  nameKey: "conceptName" },
  data_table: { tabKey: "data_tables", apiTable: "_splan_data_tables", idKey: "tableId",    nameKey: "tableName" },
  data_field: { tabKey: "data_fields", apiTable: "_splan_data_fields", idKey: "fieldId",    nameKey: "fieldName" },
};

const TYPE_COLORS: Record<string, string> = {
  feature: "#e67d4a",
  module: "#5bc0de",
  concept: "#f2b661",
  data_table: "#a855f7",
  data_field: "#4ecb71",
};

interface Props {
  entityType: string;
  entityId: number;
  onClose: () => void;
}

function PillBadge({ value }: { value: string }) {
  const c = PILL_COLORS[value] || { bg: "rgba(108,123,255,0.12)", text: "#6c7bff", border: "rgba(108,123,255,0.3)" };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize"
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {String(value).replace(/_/g, " ")}
    </span>
  );
}

export default function EntityDetailPopup({ entityType, entityId, onClose }: Props) {
  const [entity, setEntity] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const config = ENTITY_TAB_MAP[entityType];
  const tableConfig = config ? TABLE_CONFIGS[config.tabKey] : null;
  const accentColor = TYPE_COLORS[entityType] || "#6c7bff";
  const typeLabel = entityType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  useEffect(() => {
    if (!config) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/schema-planner?table=${config.apiTable}`);
        if (res.ok) {
          const rows = await res.json();
          const arr = Array.isArray(rows) ? rows : rows.rows || [];
          const found = arr.find((r: Record<string, unknown>) => r[config.idKey] === entityId);
          setEntity(found || null);
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [entityType, entityId, config]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const entityName = entity && config?.nameKey ? String(entity[config.nameKey] ?? "Untitled") : `#${entityId}`;

  // Get visible columns from TABLE_CONFIGS
  const columns = tableConfig?.columns.filter(
    (col) => !col.hideInGrid && col.type !== "separator" && col.type !== "test-count"
  ) || [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border shadow-2xl w-[700px] max-h-[80vh] flex flex-col"
        style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0 rounded-t-xl"
          style={{ borderColor: "var(--color-divider)", background: "var(--color-surface)" }}
        >
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
            <span className="font-semibold text-sm" style={{ color: "var(--color-text)" }}>{entityName}</span>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium capitalize"
              style={{ backgroundColor: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}44` }}
            >
              {typeLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-text-muted)" }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>Loading...</div>
          ) : !entity ? (
            <div className="text-sm py-4" style={{ color: "var(--color-text-muted)" }}>
              {typeLabel} #{entityId} not found.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {columns.map((col) => {
                const value = entity[col.key];
                if (value == null || value === "" || value === "[]" || value === "{}") return null;
                return (
                  <div key={col.key} className={col.type === "textarea" ? "col-span-2" : ""}>
                    <label className="text-[10px] font-medium uppercase tracking-wider block mb-0.5" style={{ color: "var(--color-text-muted)" }}>
                      {col.label}
                    </label>
                    <div className="text-sm" style={{ color: "var(--color-text)" }}>
                      {renderValue(col, value)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Render a field value based on its column type */
function renderValue(col: { type: string; key: string; options?: string[] }, value: unknown): React.ReactNode {
  if (value == null || value === "") return <span style={{ color: "var(--color-text-muted)" }}>—</span>;

  switch (col.type) {
    case "enum":
      return <PillBadge value={String(value)} />;

    case "boolean":
      return (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
          style={value ? { backgroundColor: "rgba(78,203,113,0.15)", color: "#4ecb71" } : { backgroundColor: "rgba(102,102,128,0.15)", color: "#666680" }}>
          {value ? "Yes" : "No"}
        </span>
      );

    case "tags":
    case "module-tags": {
      const tags = Array.isArray(value) ? value : [];
      if (tags.length === 0) return null;
      return (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag: unknown, i: number) => {
            const t = typeof tag === "object" && tag !== null ? (tag as { name?: string }).name || String(tag) : String(tag);
            return <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(108,123,255,0.12)", color: "#6c7bff", border: "1px solid rgba(108,123,255,0.3)" }}>{t}</span>;
          })}
        </div>
      );
    }

    case "multi-fk": {
      const ids = Array.isArray(value) ? value : [];
      if (ids.length === 0) return null;
      return <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{ids.length} linked</span>;
    }

    case "platforms": {
      const plats = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1">
          {plats.map((p: unknown) => <PillBadge key={String(p)} value={String(p)} />)}
        </div>
      );
    }

    case "textarea":
      return (
        <div className="text-xs whitespace-pre-wrap leading-relaxed max-h-[120px] overflow-auto rounded p-2"
          style={{ backgroundColor: "var(--color-surface)" }}>
          {String(value).substring(0, 500)}{String(value).length > 500 ? "..." : ""}
        </div>
      );

    case "readonly":
      return <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{String(value)}</span>;

    case "image-carousel": {
      const imgs = Array.isArray(value) ? value : [];
      return <span className="text-xs" style={{ color: "#4ecb71" }}>{imgs.length} {imgs.length === 1 ? "image" : "images"}</span>;
    }

    default:
      return <span className="text-sm">{String(value)}</span>;
  }
}
