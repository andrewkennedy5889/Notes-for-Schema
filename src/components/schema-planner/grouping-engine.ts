import type { GroupingCondition, GroupingRule, GroupingConfig, AggregateConfig } from "./types";

// ─── Operator metadata ────────────────────────────────────────────────────────

export const GROUPING_OPERATORS: { value: import("./types").GroupingOperator; label: string; needsValue: boolean; needsValue2: boolean }[] = [
  { value: "equals", label: "equals", needsValue: true, needsValue2: false },
  { value: "notEquals", label: "not equals", needsValue: true, needsValue2: false },
  { value: "contains", label: "contains", needsValue: true, needsValue2: false },
  { value: "notContains", label: "does not contain", needsValue: true, needsValue2: false },
  { value: "startsWith", label: "starts with", needsValue: true, needsValue2: false },
  { value: "endsWith", label: "ends with", needsValue: true, needsValue2: false },
  { value: "greaterThan", label: "greater than", needsValue: true, needsValue2: false },
  { value: "lessThan", label: "less than", needsValue: true, needsValue2: false },
  { value: "between", label: "between", needsValue: true, needsValue2: true },
  { value: "isEmpty", label: "is empty", needsValue: false, needsValue2: false },
  { value: "isNotEmpty", label: "is not empty", needsValue: false, needsValue2: false },
  { value: "regex", label: "matches regex", needsValue: true, needsValue2: false },
  { value: "in", label: "is one of", needsValue: true, needsValue2: false },
  { value: "notIn", label: "is not one of", needsValue: true, needsValue2: false },
  { value: "hasAny", label: "has any of", needsValue: true, needsValue2: false },
  { value: "hasAll", label: "has all of", needsValue: true, needsValue2: false },
];

// ─── Normalize legacy configs ─────────────────────────────────────────────────

interface LegacyGroupingRule {
  groupName: string;
  operator: string;
  value: string;
  value2?: string;
  color?: string;
}

interface LegacyGroupingConfig {
  column: string;
  rules: LegacyGroupingRule[];
  ungroupedLabel: string;
}

/** Convert old formats to new flat-rules config */
export function normalizeGroupingConfig(raw: unknown): GroupingConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // Already new flat-rules format (has top-level rules array, no layers)
  if (Array.isArray(obj.rules) && !("layers" in obj)) return raw as GroupingConfig;

  // Old multi-layer format: { layers: [{ rules, ungroupedLabel, ... }], ungroupedLabel }
  if (Array.isArray(obj.layers)) {
    const layers = obj.layers as Array<Record<string, unknown>>;
    const firstLayer = layers[0];
    if (!firstLayer) return null;
    const rawRules = (firstLayer.rules as GroupingRule[]) || [];
    // Sanitize: old rules may lack conditions array
    const sanitizedRules = rawRules.map((r) => ({
      ...r,
      conditions: r.conditions || [],
      logic: r.logic || "AND" as const,
    }));
    return {
      rules: sanitizedRules,
      ungroupedLabel: (firstLayer.ungroupedLabel as string) || (obj.ungroupedLabel as string) || "Other",
      autoGroup: firstLayer.autoGroup as { column: string } | undefined,
      sortGroups: firstLayer.sortGroups as GroupingConfig["sortGroups"],
      aggregate: firstLayer.aggregate as AggregateConfig[] | undefined,
    };
  }

  // Legacy single-column format: { column, rules: [{groupName, operator, value}], ungroupedLabel }
  if (typeof obj.column === "string" && Array.isArray(obj.rules)) {
    const legacy = obj as unknown as LegacyGroupingConfig;
    const rules: GroupingRule[] = legacy.rules.map((r) => ({
      groupName: r.groupName,
      logic: "AND" as const,
      conditions: [{ column: legacy.column, operator: r.operator as GroupingCondition["operator"], value: r.value, value2: r.value2 }],
      color: r.color,
    }));
    return {
      rules,
      ungroupedLabel: legacy.ungroupedLabel || "Other",
    };
  }

  return null;
}

// ─── Single condition evaluation ──────────────────────────────────────────────

export function evaluateCondition(cellValue: unknown, cond: GroupingCondition): boolean {
  const raw = cellValue == null ? "" : String(cellValue);
  const v = raw.toLowerCase();
  const rv = cond.value.toLowerCase();

  const numCell = Number(raw);
  const numRule = Number(cond.value);
  const bothNumeric = raw !== "" && !isNaN(numCell) && cond.value !== "" && !isNaN(numRule);

  switch (cond.operator) {
    case "equals":
      return bothNumeric ? numCell === numRule : v === rv;
    case "notEquals":
      return bothNumeric ? numCell !== numRule : v !== rv;
    case "contains":
      return v.includes(rv);
    case "notContains":
      return !v.includes(rv);
    case "startsWith":
      return v.startsWith(rv);
    case "endsWith":
      return v.endsWith(rv);
    case "greaterThan":
      return bothNumeric ? numCell > numRule : v > rv;
    case "lessThan":
      return bothNumeric ? numCell < numRule : v < rv;
    case "between": {
      const numRule2 = Number(cond.value2 ?? "");
      if (bothNumeric && cond.value2 !== "" && !isNaN(numRule2)) {
        const lo = Math.min(numRule, numRule2);
        const hi = Math.max(numRule, numRule2);
        return numCell >= lo && numCell <= hi;
      }
      return v >= rv && v <= (cond.value2 ?? "").toLowerCase();
    }
    case "isEmpty":
      return raw.trim() === "" || raw === "—" || raw === "null" || raw === "undefined";
    case "isNotEmpty":
      return raw.trim() !== "" && raw !== "—" && raw !== "null" && raw !== "undefined";
    case "regex":
      try { return new RegExp(cond.value, "i").test(raw); } catch { return false; }
    case "in": {
      const vals = cond.value.split(",").map((s) => s.trim().toLowerCase());
      return vals.includes(v);
    }
    case "notIn": {
      const vals = cond.value.split(",").map((s) => s.trim().toLowerCase());
      return !vals.includes(v);
    }
    case "hasAny": {
      const arr = parseJsonArray(cellValue);
      const targets = cond.value.split(",").map((s) => s.trim().toLowerCase());
      return arr.some((item) => targets.includes(String(item).toLowerCase()));
    }
    case "hasAll": {
      const arr = parseJsonArray(cellValue);
      const targets = cond.value.split(",").map((s) => s.trim().toLowerCase());
      return targets.every((t) => arr.some((item) => String(item).toLowerCase() === t));
    }
    default:
      return false;
  }
}

function parseJsonArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed; } catch { /* not json */ }
  }
  return [];
}

// ─── Compound rule evaluation (AND/OR across conditions) ──────────────────────

export function evaluateRule(row: Record<string, unknown>, rule: GroupingRule): boolean {
  if (!rule.conditions?.length) return false;
  if (rule.logic === "OR") {
    for (const cond of rule.conditions) {
      if (evaluateCondition(row[cond.column], cond)) return true;
    }
    return false;
  }
  // AND (default)
  for (const cond of rule.conditions) {
    if (!evaluateCondition(row[cond.column], cond)) return false;
  }
  return true;
}

// ─── Backward-compat shim for old single-condition evaluation ─────────────────

export function evaluateGroupingRule(cellValue: unknown, rule: { operator: string; value: string; value2?: string }): boolean {
  return evaluateCondition(cellValue, { column: "", operator: rule.operator as GroupingCondition["operator"], value: rule.value, value2: rule.value2 });
}

// ─── Single level evaluation ─────────────────────────────────────────────────

export interface GroupNode {
  name: string;
  rows: Record<string, unknown>[];
  children?: GroupNode[];
  color?: string;
  colorIndex: number;
  depth: number;
  rowCount: number; // total rows including nested children
  /** The rule that produced this group (for sub-rule recursion) */
  sourceRule?: GroupingRule;
}

interface EvalParams {
  rules: GroupingRule[];
  autoGroup?: { column: string };
  sortGroups?: "asc" | "desc" | "count-asc" | "count-desc";
}

function evaluateLevel(
  rows: Record<string, unknown>[],
  params: EvalParams,
  depth: number
): { groups: GroupNode[]; ungrouped: Record<string, unknown>[] } {
  // Auto-group mode: create groups from distinct column values
  if (params.autoGroup) {
    const col = params.autoGroup.column;
    const buckets = new Map<string, Record<string, unknown>[]>();
    const bucketOrder: string[] = [];
    const ungrouped: Record<string, unknown>[] = [];

    for (const row of rows) {
      const raw = row[col];
      // Handle JSON array columns — each item creates a group
      const arr = parseJsonArray(raw);
      if (arr.length > 0 && (Array.isArray(raw) || (typeof raw === "string" && raw.startsWith("[")))) {
        for (const item of arr) {
          const key = String(item);
          if (!buckets.has(key)) { buckets.set(key, []); bucketOrder.push(key); }
          buckets.get(key)!.push(row);
        }
      } else {
        const key = raw == null || String(raw).trim() === "" ? "" : String(raw);
        if (key === "") { ungrouped.push(row); continue; }
        if (!buckets.has(key)) { buckets.set(key, []); bucketOrder.push(key); }
        buckets.get(key)!.push(row);
      }
    }

    let ordered = bucketOrder;
    if (params.sortGroups) {
      ordered = sortGroupNames(ordered, buckets, params.sortGroups);
    }

    const groups: GroupNode[] = ordered.map((name, i) => ({
      name, rows: buckets.get(name)!, colorIndex: i, depth, rowCount: buckets.get(name)!.length,
    }));
    return { groups, ungrouped };
  }

  // Manual rules mode
  const buckets = new Map<string, Record<string, unknown>[]>();
  const ruleOrder: string[] = [];
  const ruleColorMap = new Map<string, string | undefined>();
  const ruleMap = new Map<string, GroupingRule>();

  for (const rule of params.rules) {
    if (!buckets.has(rule.groupName)) {
      buckets.set(rule.groupName, []);
      ruleOrder.push(rule.groupName);
      ruleColorMap.set(rule.groupName, rule.color);
      ruleMap.set(rule.groupName, rule);
    }
  }

  const ungrouped: Record<string, unknown>[] = [];

  for (const row of rows) {
    let matched = false;
    for (const rule of params.rules) {
      if (evaluateRule(row, rule)) {
        buckets.get(rule.groupName)!.push(row);
        matched = true;
        break; // first match wins
      }
    }
    if (!matched) ungrouped.push(row);
  }

  let ordered = ruleOrder;
  if (params.sortGroups) {
    ordered = sortGroupNames(ordered, buckets, params.sortGroups);
  }

  const groups: GroupNode[] = ordered
    .filter((name) => buckets.get(name)!.length > 0)
    .map((name, i) => ({
      name, rows: buckets.get(name)!, color: ruleColorMap.get(name), colorIndex: i, depth, rowCount: buckets.get(name)!.length,
      sourceRule: ruleMap.get(name),
    }));

  return { groups, ungrouped };
}

function sortGroupNames(names: string[], buckets: Map<string, Record<string, unknown>[]>, sort: string): string[] {
  const sorted = [...names];
  switch (sort) {
    case "asc": sorted.sort((a, b) => a.localeCompare(b)); break;
    case "desc": sorted.sort((a, b) => b.localeCompare(a)); break;
    case "count-asc": sorted.sort((a, b) => (buckets.get(a)?.length ?? 0) - (buckets.get(b)?.length ?? 0)); break;
    case "count-desc": sorted.sort((a, b) => (buckets.get(b)?.length ?? 0) - (buckets.get(a)?.length ?? 0)); break;
  }
  return sorted;
}

// ─── Per-rule recursive grouping ─────────────────────────────────────────────

const MAX_DEPTH = 2;

export function evaluateMultiLevelGrouping(
  rows: Record<string, unknown>[],
  config: GroupingConfig
): { groups: GroupNode[]; totalGroups: number } {
  if (!config.rules.length && !config.autoGroup) return { groups: [], totalGroups: 0 };

  const { groups, ungrouped } = evaluateLevel(rows, {
    rules: config.rules,
    autoGroup: config.autoGroup,
    sortGroups: config.sortGroups,
  }, 0);

  // Recurse into each group's subRules (if the source rule has them)
  for (const group of groups) {
    const rule = group.sourceRule;
    if (rule?.subRules?.length && group.rows.length > 0) {
      const subResult = evaluateLevel(group.rows, {
        rules: rule.subRules,
        sortGroups: rule.subSort,
      }, 1);

      const children = subResult.groups;
      if (subResult.ungrouped.length > 0) {
        children.push({
          name: rule.subUngroupedLabel || config.ungroupedLabel || "Other",
          rows: subResult.ungrouped,
          colorIndex: children.length,
          depth: 1,
          rowCount: subResult.ungrouped.length,
        });
      }
      if (children.length > 0) {
        group.children = children;
        group.rows = [];
        group.rowCount = children.reduce((sum, c) => sum + c.rowCount, 0);
      }
    }
  }

  // Add ungrouped bucket at top level
  if (ungrouped.length > 0) {
    groups.push({
      name: config.ungroupedLabel || "Other",
      rows: ungrouped,
      colorIndex: groups.length,
      depth: 0,
      rowCount: ungrouped.length,
    });
  }

  const countGroups = (nodes: GroupNode[]): number =>
    nodes.reduce((sum, n) => sum + 1 + (n.children ? countGroups(n.children) : 0), 0);

  return { groups, totalGroups: countGroups(groups) };
}

// ─── Legacy flat API (used by evaluateGrouping call sites) ────────────────────

export function evaluateGrouping(
  rows: Record<string, unknown>[],
  config: GroupingConfig
): { groups: Array<{ name: string; rows: Record<string, unknown>[]; colorIndex: number; color?: string }>; totalGroups: number } {
  const result = evaluateMultiLevelGrouping(rows, config);
  // Flatten for backward compat — top-level only, no nesting
  return {
    groups: result.groups.map((g) => ({ name: g.name, rows: g.rows, colorIndex: g.colorIndex, color: g.color })),
    totalGroups: result.totalGroups,
  };
}

// ─── Aggregate evaluation ─────────────────────────────────────────────────────

export function evaluateAggregate(rows: Record<string, unknown>[], agg: AggregateConfig): string {
  const vals = rows.map((r) => r[agg.column]);
  switch (agg.function) {
    case "count": return String(vals.length);
    case "countDistinct": return String(new Set(vals.map((v) => String(v ?? ""))).size);
    case "countNonEmpty": return String(vals.filter((v) => v != null && String(v).trim() !== "").length);
    case "sum": return String(vals.reduce((s, v) => s + (Number(v) || 0), 0));
    case "min": { const nums = vals.map(Number).filter((n) => !isNaN(n)); return nums.length ? String(Math.min(...nums)) : "—"; }
    case "max": { const nums = vals.map(Number).filter((n) => !isNaN(n)); return nums.length ? String(Math.max(...nums)) : "—"; }
    case "list": return [...new Set(vals.map((v) => String(v ?? "")))].filter(Boolean).join(", ");
    case "contains": return vals.some((v) => String(v ?? "").toLowerCase().includes((agg.value ?? "").toLowerCase())) ? "Yes" : "No";
    case "notContains": return vals.every((v) => !String(v ?? "").toLowerCase().includes((agg.value ?? "").toLowerCase())) ? "Yes" : "No";
    default: return "—";
  }
}

// ─── Flatten nested groups for rendering ──────────────────────────────────────

export interface FlatGroupSection {
  type: "header" | "rows";
  depth: number;
  name: string;
  groupKey: string;  // hierarchical key for collapse state e.g. "tab:Layer1/Layer2"
  parentKey: string;  // parent group key (empty for top-level)
  rows: Record<string, unknown>[];
  color?: string;
  colorIndex: number;
  rowCount: number;
  aggregate?: { label: string; value: string }[];
  layerIndex: number;
}

export function flattenGroupNodes(
  groups: GroupNode[],
  subTab: string,
  parentKey: string = "",
  config?: GroupingConfig
): FlatGroupSection[] {
  const result: FlatGroupSection[] = [];
  for (const group of groups) {
    const groupKey = parentKey ? `${parentKey}/${group.name}` : `${subTab}:${group.name}`;

    // Compute aggregates — top-level groups use config.aggregate
    const aggs = (group.depth === 0 && config?.aggregate)
      ? config.aggregate.map((a) => {
          const allRows = group.children ? collectAllRows(group) : group.rows;
          return { label: a.label || `${a.function}(${a.column})`, value: evaluateAggregate(allRows, a) };
        })
      : undefined;

    result.push({
      type: "header",
      depth: group.depth,
      name: group.name,
      groupKey,
      parentKey,
      rows: group.rows,
      color: group.color,
      colorIndex: group.colorIndex,
      rowCount: group.rowCount,
      aggregate: aggs,
      layerIndex: group.depth,
    });

    if (group.children) {
      result.push(...flattenGroupNodes(group.children, subTab, groupKey, config));
    } else {
      // Leaf group — rows section
      result.push({
        type: "rows",
        depth: group.depth,
        name: group.name,
        groupKey,
        parentKey,
        rows: group.rows,
        color: group.color,
        colorIndex: group.colorIndex,
        rowCount: group.rowCount,
        layerIndex: group.depth,
      });
    }
  }
  return result;
}

function collectAllRows(node: GroupNode): Record<string, unknown>[] {
  if (!node.children) return node.rows;
  return node.children.flatMap(collectAllRows);
}

// ─── Derive a cell value from a rule (for DnD / add-to-group) ─────────────────

export function deriveValueFromRule(rule: GroupingRule, currentValue: unknown): { column: string; value: string } | null {
  if (rule.conditions.length === 0) return null;
  const first = rule.conditions[0];
  let value: string;
  switch (first.operator) {
    case "equals": case "contains": case "startsWith": case "endsWith":
    case "greaterThan": case "lessThan": case "between": case "regex":
    case "notEquals": case "notContains":
      value = first.value; break;
    case "in": case "notIn": case "hasAny": case "hasAll":
      value = first.value.split(",")[0]?.trim() ?? first.value; break;
    case "isEmpty":
      value = ""; break;
    case "isNotEmpty":
      value = currentValue != null && String(currentValue).trim() !== "" ? String(currentValue) : "value"; break;
    default:
      value = first.value;
  }
  return { column: first.column, value };
}
