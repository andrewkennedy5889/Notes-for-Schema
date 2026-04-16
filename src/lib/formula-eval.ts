/**
 * Safe formula evaluator for calculated columns.
 *
 * Supported syntax:
 *   {fieldName}              — substitutes the row's camelCase field value
 *   IF(cond, then, else)     — conditional: cond supports ==, !=, EMPTY, NOT_EMPTY
 *   CONCAT(a, b, …)          — joins values into a single string
 *   UPPER(x) / LOWER(x)     — case conversion
 *   COALESCE(a, b, …)        — first non-empty value
 *   LEN(x)                   — string length
 *   SUM(a, b, …)             — numeric addition
 *   ROUND(x, digits)         — round to N decimal places
 *
 * Returns the evaluated string, or "#ERR" on failure.
 */

type Row = Record<string, unknown>;

const MAX_DEPTH = 8;

/** Resolve a token: if it's a {field} reference, look it up; otherwise treat as literal */
function resolveToken(token: string, row: Row): string {
  const trimmed = token.trim();
  // Field reference: {fieldName}
  const fieldMatch = trimmed.match(/^\{([^}]+)\}$/);
  if (fieldMatch) {
    const val = row[fieldMatch[1]];
    if (val == null) return "";
    if (Array.isArray(val)) return val.join(", ");
    return String(val);
  }
  // Quoted string literal: "text" or 'text'
  const quotedMatch = trimmed.match(/^["'](.*)["']$/);
  if (quotedMatch) return quotedMatch[1];
  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  // Bare word — treat as literal string
  return trimmed;
}

/** Split arguments at top-level commas (respecting parentheses and quotes) */
function splitArgs(argsStr: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") { depth++; current += ch; continue; }
    if (ch === ")") { depth--; current += ch; continue; }
    if (ch === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || args.length > 0) args.push(current);
  return args;
}

/** Evaluate a single expression (may be a function call, field ref, or literal) */
function evalExpr(expr: string, row: Row, depth: number): string {
  if (depth > MAX_DEPTH) return "#ERR";
  const trimmed = expr.trim();
  if (!trimmed) return "";

  // Check for function call: NAME(args...)
  const funcMatch = trimmed.match(/^([A-Z_]+)\s*\(([\s\S]*)\)$/);
  if (funcMatch) {
    const funcName = funcMatch[1];
    const rawArgs = splitArgs(funcMatch[2]);

    switch (funcName) {
      case "IF": {
        if (rawArgs.length < 2) return "#ERR";
        const condition = rawArgs[0].trim();
        const thenVal = rawArgs[1];
        const elseVal = rawArgs.length > 2 ? rawArgs[2] : "";

        const condResult = evalCondition(condition, row, depth + 1);
        return evalExpr(condResult ? thenVal : elseVal, row, depth + 1);
      }

      case "CONCAT": {
        return rawArgs.map((a) => evalExpr(a, row, depth + 1)).join("");
      }

      case "UPPER": {
        if (rawArgs.length < 1) return "#ERR";
        return evalExpr(rawArgs[0], row, depth + 1).toUpperCase();
      }

      case "LOWER": {
        if (rawArgs.length < 1) return "#ERR";
        return evalExpr(rawArgs[0], row, depth + 1).toLowerCase();
      }

      case "COALESCE": {
        for (const a of rawArgs) {
          const val = evalExpr(a, row, depth + 1);
          if (val !== "") return val;
        }
        return "";
      }

      case "LEN": {
        if (rawArgs.length < 1) return "#ERR";
        return String(evalExpr(rawArgs[0], row, depth + 1).length);
      }

      case "SUM": {
        let total = 0;
        for (const a of rawArgs) {
          const val = parseFloat(evalExpr(a, row, depth + 1));
          if (isNaN(val)) return "#ERR";
          total += val;
        }
        return String(total);
      }

      case "ROUND": {
        if (rawArgs.length < 1) return "#ERR";
        const num = parseFloat(evalExpr(rawArgs[0], row, depth + 1));
        if (isNaN(num)) return "#ERR";
        const digits = rawArgs.length > 1 ? parseInt(evalExpr(rawArgs[1], row, depth + 1), 10) : 0;
        if (isNaN(digits)) return "#ERR";
        return num.toFixed(digits);
      }

      default:
        return "#ERR";
    }
  }

  // Not a function call — resolve as token (field ref or literal)
  return resolveToken(trimmed, row);
}

/** Evaluate a condition string for IF(): supports ==, !=, EMPTY, NOT_EMPTY */
function evalCondition(cond: string, row: Row, depth: number): boolean {
  const trimmed = cond.trim();

  // EMPTY({field}) / NOT_EMPTY({field})
  const emptyMatch = trimmed.match(/^(NOT_EMPTY|EMPTY)\s*\(\s*(.+?)\s*\)$/);
  if (emptyMatch) {
    const val = evalExpr(emptyMatch[2], row, depth);
    return emptyMatch[1] === "EMPTY" ? val === "" : val !== "";
  }

  // != check (must come before == to avoid partial match)
  const neqIdx = trimmed.indexOf("!=");
  if (neqIdx > 0) {
    const left = evalExpr(trimmed.slice(0, neqIdx), row, depth);
    const right = evalExpr(trimmed.slice(neqIdx + 2), row, depth);
    return left !== right;
  }

  // == check
  const eqIdx = trimmed.indexOf("==");
  if (eqIdx > 0) {
    const left = evalExpr(trimmed.slice(0, eqIdx), row, depth);
    const right = evalExpr(trimmed.slice(eqIdx + 2), row, depth);
    return left === right;
  }

  // > < >= <=
  const cmpMatch = trimmed.match(/^(.+?)\s*(>=|<=|>|<)\s*(.+)$/);
  if (cmpMatch) {
    const left = parseFloat(evalExpr(cmpMatch[1], row, depth));
    const right = parseFloat(evalExpr(cmpMatch[3], row, depth));
    if (isNaN(left) || isNaN(right)) return false;
    switch (cmpMatch[2]) {
      case ">": return left > right;
      case "<": return left < right;
      case ">=": return left >= right;
      case "<=": return left <= right;
    }
  }

  // Bare truthy check
  const val = evalExpr(trimmed, row, depth);
  return val !== "" && val !== "0" && val !== "false";
}

/**
 * Evaluate a formula expression against a row.
 *
 * The formula can contain {fieldName} references (camelCase keys from the row)
 * and function calls like IF(...), CONCAT(...), etc.
 *
 * For simple templates without function calls, all {field} refs are substituted inline.
 */
export function evaluateFormula(formula: string, row: Row): string {
  try {
    // Check if the entire formula is a single function call
    const trimmed = formula.trim();
    if (/^[A-Z_]+\s*\(/.test(trimmed)) {
      return evalExpr(trimmed, row, 0);
    }

    // Otherwise, treat as template: substitute all {field} refs inline
    return trimmed.replace(/\{([^}]+)\}/g, (_match, field: string) => {
      const val = row[field];
      if (val == null) return "";
      if (Array.isArray(val)) return val.join(", ");
      return String(val);
    });
  } catch {
    return "#ERR";
  }
}
