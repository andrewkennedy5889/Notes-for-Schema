

import React from "react";
import { REF_REGEX } from "./text-utils";
import { getRefColors, getRefIcons } from "../../pages/SchemaPlanner";

/** Parse text containing (t:ID), (f:ID), (m:ID), (fe:ID), (c:ID), (r:ID) tokens into rich React nodes */
export function RichRefText({
  text,
  resolveTable,
  resolveField,
  fieldTableId,
  resolveModule,
  resolveFeature,
  resolveConcept,
  resolveResearch,
  onRefClick,
}: {
  text: string;
  resolveTable: (id: number) => string | null;
  resolveField: (id: number) => string | null;
  fieldTableId: (id: number) => number | null;
  resolveModule?: (id: number) => string | null;
  resolveFeature?: (id: number) => string | null;
  resolveConcept?: (id: number) => string | null;
  resolveResearch?: (id: number) => string | null;
  onRefClick?: (type: "module" | "feature" | "table" | "concept" | "research", name: string) => void;
}) {
  if (!text) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;

  const rc = getRefColors();
  const ri = getRefIcons();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(REF_REGEX.source, "g");

  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));

    if (m[1]) {
      // Table ref: (t:ID:fallback?)
      const id = Number(m[1]);
      const fallback = m[2] || null;
      const name = resolveTable(id);
      parts.push(
        name ? (
          <span key={`t${id}-${m.index}`} className="font-medium cursor-pointer hover:brightness-125" style={{ color: rc.table }} title={`Table: ${name}`} onClick={(e) => { e.stopPropagation(); onRefClick?.("table", name); }}>({ri.table ? `${ri.table} ` : ""}{name})</span>
        ) : (
          <span key={`t${id}-${m.index}`} className="font-medium" style={{ color: "#e05555", textDecoration: "line-through" }} title={`Deleted table #${id}`}>
            ({fallback || "deleted"})
          </span>
        )
      );
    } else if (m[3]) {
      // Field ref: (f:ID:fallback?)
      const id = Number(m[3]);
      const fallback = m[4] || null;
      const fieldName = resolveField(id);
      const tblId = fieldTableId(id);
      const tblName = tblId ? resolveTable(tblId) : null;
      const display = fieldName ? (tblName ? `${tblName}.${fieldName}` : fieldName) : null;
      parts.push(
        display ? (
          <span key={`f${id}-${m.index}`} className="font-medium" style={{ color: rc.field }} title={`Field #${id}`}>({display})</span>
        ) : (
          <span key={`f${id}-${m.index}`} className="font-medium" style={{ color: "#e05555", textDecoration: "line-through" }} title={`Deleted field #${id}`}>
            ({fallback || "deleted"})
          </span>
        )
      );
    } else if (m[7]) {
      // Module ref: (m:ID:fallback?)
      const id = Number(m[7]);
      const fallback = m[8] || null;
      const name = resolveModule?.(id) ?? null;
      parts.push(
        name ? (
          <span
            key={`m${id}-${m.index}`}
            className="font-medium cursor-pointer hover:brightness-125"
            style={{ color: rc.module }}
            title={`Module: ${name}`}
            onClick={(e) => { e.stopPropagation(); onRefClick?.("module", name); }}
          >({ri.module ? `${ri.module} ` : ""}{name})</span>
        ) : (
          <span key={`m${id}-${m.index}`} className="font-medium" style={{ color: "#e05555", textDecoration: "line-through" }} title={`Deleted module #${id}`}>
            ({fallback || "deleted"})
          </span>
        )
      );
    } else if (m[9]) {
      // Feature ref: (fe:ID:fallback?)
      const id = Number(m[9]);
      const fallback = m[10] || null;
      const name = resolveFeature?.(id) ?? null;
      parts.push(
        name ? (
          <span
            key={`fe${id}-${m.index}`}
            className="font-medium cursor-pointer hover:brightness-125"
            style={{ color: rc.feature }}
            title={`Feature: ${name}`}
            onClick={(e) => { e.stopPropagation(); onRefClick?.("feature", name); }}
          >({ri.feature ? `${ri.feature} ` : ""}{name})</span>
        ) : (
          <span key={`fe${id}-${m.index}`} className="font-medium" style={{ color: "#e05555", textDecoration: "line-through" }} title={`Deleted feature #${id}`}>
            ({fallback || "deleted"})
          </span>
        )
      );
    } else if (m[11]) {
      // Concept ref: (c:ID:fallback?)
      const id = Number(m[11]);
      const fallback = m[12] || null;
      const name = resolveConcept?.(id) ?? null;
      parts.push(
        name ? (
          <span
            key={`c${id}-${m.index}`}
            className="font-medium cursor-pointer hover:brightness-125"
            style={{ color: rc.concept }}
            title={`Concept: ${name}`}
            onClick={(e) => { e.stopPropagation(); onRefClick?.("concept", name); }}
          >({ri.concept ? `${ri.concept} ` : ""}{name})</span>
        ) : (
          <span key={`c${id}-${m.index}`} className="font-medium" style={{ color: "#e05555", textDecoration: "line-through" }} title={`Deleted concept #${id}`}>
            ({fallback || "deleted"})
          </span>
        )
      );
    } else if (m[13]) {
      // Research ref: (r:ID:fallback?)
      const id = Number(m[13]);
      const fallback = m[14] || null;
      const name = resolveResearch?.(id) ?? null;
      parts.push(
        name ? (
          <span
            key={`r${id}-${m.index}`}
            className="font-medium cursor-pointer hover:brightness-125"
            style={{ color: rc.research || "#5bc0de" }}
            title={`Research: ${name}`}
            onClick={(e) => { e.stopPropagation(); onRefClick?.("research", name); }}
          >({ri.research ? `${ri.research} ` : "🔬 "}{name})</span>
        ) : (
          <span key={`r${id}-${m.index}`} className="font-medium" style={{ color: "#e05555", textDecoration: "line-through" }} title={`Deleted research #${id}`}>
            ({fallback || "deleted"})
          </span>
        )
      );
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
