

import React from "react";
import { PILL_COLORS } from "./constants";

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

function AccessMatrixView({
  matrixData,
  matrixLoading,
  bizFilter,
  tierFilter,
  swimFilter,
  onBizFilter,
  onTierFilter,
  onSwimFilter,
  onNavigateToRule,
}: {
  matrixData: { tables: Array<{ tableId: number; tableName: string; recordOwnership: string | null; tableStatus: string; rules: Array<Record<string, unknown>> }>; dimensions: { businessTypes: string[]; roles: string[]; userTypes: string[]; tiers: number[]; swimlanes: string[] } } | null;
  matrixLoading: boolean;
  bizFilter: string;
  tierFilter: string;
  swimFilter: string;
  onBizFilter: (v: string) => void;
  onTierFilter: (v: string) => void;
  onSwimFilter: (v: string) => void;
  onNavigateToRule: (tableId: number) => void;
}) {
  if (matrixLoading) {
    return <div className="text-center py-12"><p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Loading matrix...</p></div>;
  }
  if (!matrixData) {
    return <div className="text-center py-12"><p className="text-sm" style={{ color: "#e05555" }}>Failed to load matrix data.</p></div>;
  }

  const { tables, dimensions } = matrixData;
  const roles = dimensions.roles;

  // Determine which business types to show
  const bizTypes = bizFilter === "all" ? dimensions.businessTypes : [bizFilter];

  // Filter tables that have at least one rule, or show all
  const sortedTables = [...tables].sort((a, b) => a.tableName.localeCompare(b.tableName));

  // Group tables by ownership
  const groups: Record<string, typeof tables> = {};
  for (const t of sortedTables) {
    const ownership = t.recordOwnership || "unset";
    if (!groups[ownership]) groups[ownership] = [];
    groups[ownership].push(t);
  }

  // Find matching access level for a table given a business type and role
  function getAccessLevel(rules: Array<Record<string, unknown>>, bizType: string, role: string): string {
    // Find most specific rule
    for (const r of rules) {
      const matchBiz = !r.businessType || r.businessType === bizType;
      const matchRole = !r.role || r.role === role;
      const matchTier = tierFilter === "all" || (!r.tierMin && !r.tierMax) ||
        ((r.tierMin == null || Number(r.tierMin) <= Number(tierFilter)) && (r.tierMax == null || Number(r.tierMax) >= Number(tierFilter)));
      const matchSwim = swimFilter === "all" || !r.swimlane || r.swimlane === swimFilter;
      if (matchBiz && matchRole && matchTier && matchSwim) return String(r.accessLevel);
    }
    return "—";
  }

  function getTooltip(rules: Array<Record<string, unknown>>, bizType: string, role: string): string {
    for (const r of rules) {
      const matchBiz = !r.businessType || r.businessType === bizType;
      const matchRole = !r.role || r.role === role;
      if (matchBiz && matchRole) {
        const parts = [];
        if (r.scopeNotes) parts.push(`Scope: ${r.scopeNotes}`);
        if (r.ownershipNotes) parts.push(`Ownership: ${r.ownershipNotes}`);
        if (r.tierMin || r.tierMax) parts.push(`Tiers: ${r.tierMin || 1}-${r.tierMax || 7}`);
        if (r.swimlane) parts.push(`Swimlane: ${r.swimlane}`);
        if (r.userType) parts.push(`User type: ${r.userType}`);
        return parts.join("\n") || String(r.accessLevel);
      }
    }
    return "No rule defined";
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Access Matrix</h3>
        <select value={bizFilter} onChange={(e) => onBizFilter(e.target.value)} className="px-2 py-1 text-[11px] rounded-md border" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}>
          <option value="all">All Business Types</option>
          {dimensions.businessTypes.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
        </select>
        <select value={tierFilter} onChange={(e) => onTierFilter(e.target.value)} className="px-2 py-1 text-[11px] rounded-md border" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}>
          <option value="all">All Tiers</option>
          {dimensions.tiers.map((t) => <option key={t} value={String(t)}>Tier {t}</option>)}
        </select>
        <select value={swimFilter} onChange={(e) => onSwimFilter(e.target.value)} className="px-2 py-1 text-[11px] rounded-md border" style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}>
          <option value="all">All Swimlanes</option>
          {dimensions.swimlanes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Matrix grid */}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--color-divider)" }}>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--color-divider)" }}>
              <th className="text-left py-2 px-3 font-semibold sticky left-0 z-10" style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-surface)", minWidth: 180 }}>Table</th>
              <th className="py-2 px-2 font-semibold" style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-surface)", minWidth: 70 }}>Ownership</th>
              {bizTypes.map((bt) => (
                <th key={bt} colSpan={roles.length} className="text-center py-1 px-1 font-semibold border-l" style={{ color: "var(--color-text)", backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)" }}>
                  {bt}
                </th>
              ))}
            </tr>
            <tr className="border-b" style={{ borderColor: "var(--color-divider)" }}>
              <th style={{ backgroundColor: "var(--color-surface)" }} />
              <th style={{ backgroundColor: "var(--color-surface)" }} />
              {bizTypes.map((bt) =>
                roles.map((r) => (
                  <th key={`${bt}-${r}`} className="py-1 px-1.5 font-medium text-center border-l" style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-surface)", borderColor: "var(--color-divider)", fontSize: "10px" }}>
                    {r}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {Object.entries(groups).map(([ownership, groupTables]) => (
              <React.Fragment key={ownership}>
                {groupTables.map((t) => (
                  <tr key={t.tableId} className="border-b transition-colors hover:bg-black/5 cursor-pointer" style={{ borderColor: "var(--color-divider)" }} onClick={() => onNavigateToRule(t.tableId)}>
                    <td className="py-1.5 px-3 font-medium sticky left-0" style={{ color: "var(--color-text)", backgroundColor: "var(--color-background)" }}>
                      {t.tableName}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {t.recordOwnership && <Pill value={t.recordOwnership} />}
                    </td>
                    {bizTypes.map((bt) =>
                      roles.map((r) => {
                        const level = getAccessLevel(t.rules, bt, r);
                        const tip = getTooltip(t.rules, bt, r);
                        const c = PILL_COLORS[level];
                        return (
                          <td key={`${bt}-${r}`} className="py-1.5 px-1.5 text-center border-l" style={{ borderColor: "var(--color-divider)" }} title={tip}>
                            {level === "—" ? (
                              <span style={{ color: "var(--color-text-muted)" }}>—</span>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: c?.bg, color: c?.text, border: `1px solid ${c?.border}` }}>
                                {level}
                              </span>
                            )}
                          </td>
                        );
                      })
                    )}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {sortedTables.length === 0 && (
        <div className="text-center py-12" style={{ color: "var(--color-text-muted)" }}>
          <p className="text-sm">No data tables in the schema planner yet.</p>
        </div>
      )}
    </div>
  );
}

export default AccessMatrixView;
