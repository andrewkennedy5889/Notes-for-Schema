export interface ColDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "int" | "boolean" | "enum" | "fk" | "multi-fk" | "tags" | "module-tags" | "readonly" | "checklist" | "ref-features" | "ref-projects" | "platforms" | "separator" | "module-rules" | "note-fullscreen" | "notes" | "dependencies" | "image-carousel" | "test-count" | "formula";
  required?: boolean;
  options?: string[];
  fkTable?: string;
  fkId?: string;
  fkName?: string;
  hint?: string;
  tooltip?: string;
  hideInGrid?: boolean;
  hideInModal?: boolean;
  conditionalOn?: string;
  cascadeFrom?: string;
  cascadeKey?: string;
  badge?: "calc" | "ref";
  badgeTooltip?: string;
  formula?: string;
}

export interface TableConfig {
  label: string;
  apiTable: string;
  idKey: string;
  nameKey: string | null;
  entityType: string;
  readOnly?: boolean;
  columns: ColDef[];
}

export type GroupingOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "greaterThan"
  | "lessThan"
  | "between"
  | "isEmpty"
  | "isNotEmpty"
  | "regex"
  | "in"
  | "notIn"
  | "hasAny"
  | "hasAll";

export interface GroupingCondition {
  column: string;
  operator: GroupingOperator;
  value: string;
  value2?: string; // for "between"
}

export interface GroupingRule {
  groupName: string;
  logic: "AND" | "OR";
  conditions: GroupingCondition[]; // 1–7 conditions
  color?: string; // custom group color — defaults to org primary
  // Per-rule sub-grouping (depth cap: 2)
  subRules?: GroupingRule[];
  subUngroupedLabel?: string;
  subSort?: "asc" | "desc" | "count-asc" | "count-desc";
}

export interface AggregateConfig {
  column: string;
  function: "count" | "countDistinct" | "countNonEmpty" | "sum" | "min" | "max" | "list" | "contains" | "notContains";
  value?: string;   // for contains/notContains — the string to check
  label?: string;
}

export interface GroupingConfig {
  rules: GroupingRule[];
  ungroupedLabel: string;
  autoGroup?: { column: string };
  sortGroups?: "asc" | "desc" | "count-asc" | "count-desc";
  aggregate?: AggregateConfig[];
}

export interface FeatureRefInfo { featureName: string; moduleNames: string }

export interface ExtractedRef { type: "Table" | "Field" | "Image" | "Module" | "Feature" | "Concept" | "Research"; name: string; id: number | string; lines: number[]; source: string }

export interface EmbeddedTable {
  title: string;
  headers: string[];
  rows: string[][];
  colWidths?: number[];
  rowHeights?: number[];
  fitToContentCols?: boolean[];
  fitToContentRows?: boolean[];
}

export interface SortEntry { col: string; dir: "asc" | "desc" }

export interface FilterRule { col: string; op: "equals" | "not_equals" | "contains" | "not_contains" | "is_empty" | "not_empty"; value: string }

export interface ColDisplayConfig { lines?: number; wrap?: boolean; fontSize?: number; fontColor?: string; fontBold?: boolean; fontUnderline?: boolean }

export interface ColumnSeparator {
  id: string;
  color: string;       // hex color or "transparent"
  thickness: number;    // pixels (1-10)
}

export interface ViewPresetConfig {
  groupingConfig?: GroupingConfig | null;
  sortConfig?: { primary: SortEntry | null; secondary: SortEntry | null };
  colOrder?: string[];
  hiddenCols?: string[];              // col keys (without tab prefix) that are hidden
  colSeparators?: Record<string, ColumnSeparator>;
  colHeaderColor?: string;
  colHeaderBold?: boolean;
  colHeaderUnderline?: boolean;
  rowHeight?: number | null;          // null = default
  filterRules?: FilterRule[];
  colDisplayConfig?: Record<string, ColDisplayConfig>;
}

export interface RuleCondition {
  field: string;
  operator: string;
  value: string;
}

export interface RuleRecord {
  ruleId?: number;
  entityType: string;
  entityId: number;
  relationship: string;
  sourceTable: string;
  sourceRefId: number | null;
  sourceRefLabel: string;
  logic: string;
  conditions: RuleCondition[];
  sortOrder: number;
}
