

import React, { useState, useCallback, useRef, useEffect } from "react";
import type { EmbeddedTable } from "./types";

/**
 * Parse markdown table text into structured data.
 * Handles: | Header | Header |
 *          | ---    | ---    |
 *          | cell   | cell   |
 * Strips duplicate separator rows (common when copying from Claude chat).
 */
function parseMarkdownTable(text: string): { headers: string[]; rows: string[][] } | null {
  let normalized = text
    .replace(/│/g, "|")
    .replace(/[─═]/g, "-")
    .replace(/[┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬╒╓╘╙╞╡╤╧╪╥╨╫]/g, "|");

  const lines = normalized.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const tableLines = lines.filter((l) => l.includes("|"));
  if (tableLines.length < 2) return null;

  const parseLine = (line: string): string[] => {
    const cells = line.split("|").map((c) => c.trim());
    if (cells[0] === "") cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    return cells;
  };

  const isSeparator = (line: string): boolean => {
    const stripped = line.replace(/[\s|:\-]/g, "");
    return stripped.length === 0 && line.includes("-");
  };

  const dataLines = tableLines.filter((l) => !isSeparator(l));
  if (dataLines.length < 1) return null;

  const headers = parseLine(dataLines[0]);
  if (headers.length === 0) return null;
  const rows = dataLines.slice(1).map(parseLine);

  const colCount = headers.length;
  const normalizedRows = rows.map((row) => {
    while (row.length < colCount) row.push("");
    return row.slice(0, colCount);
  });

  return { headers, rows: normalizedRows };
}

interface ExistingTableInfo {
  id: string;
  title: string;
  cols: number;
  rows: number;
  headers?: string[];
  data?: string[][];
  referencedIn?: { module?: string; moduleColor?: string; feature?: string; featureColor?: string; field?: string; fieldColor?: string };
}

export function TablePasteModal({
  onInsert,
  onClose,
  existingTables,
  onUpdateTable,
}: {
  onInsert: (table: EmbeddedTable) => void;
  onClose: () => void;
  existingTables?: ExistingTableInfo[];
  onUpdateTable?: (id: string, headers: string[], rows: string[][]) => void;
}) {
  const [rawText, setRawText] = useState("");
  const [title, setTitle] = useState("");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [error, setError] = useState("");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  // Inline editing state for existing table preview
  const [editHeaders, setEditHeaders] = useState<string[] | null>(null);
  const [editRows, setEditRows] = useState<string[][] | null>(null);
  const [editCell, setEditCell] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [hasEdits, setHasEdits] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const handleParse = useCallback(() => {
    const result = parseMarkdownTable(rawText);
    if (!result) {
      setError("Could not parse a table. Paste markdown table text with | delimiters.");
      setParsed(null);
      return;
    }
    setError("");
    setParsed(result);
    if (!title) setTitle(`${result.headers.length}×${result.rows.length + 1} table`);
  }, [rawText, title]);

  const handleInsert = useCallback(() => {
    if (!parsed) return;
    onInsert({
      title: title || "Untitled Table",
      headers: parsed.headers,
      rows: parsed.rows,
    });
  }, [parsed, title, onInsert]);

  const selectedTable = existingTables?.find((t) => t.id === selectedTableId);
  const hasExisting = existingTables && existingTables.length > 0;
  const isExpanded = !!selectedTableId;

  // Initialize edit state when selecting a table
  useEffect(() => {
    if (selectedTable?.headers && selectedTable?.data) {
      setEditHeaders([...selectedTable.headers]);
      setEditRows(selectedTable.data.map((r) => [...r]));
      setHasEdits(false);
      setEditCell(null);
    } else {
      setEditHeaders(null);
      setEditRows(null);
      setHasEdits(false);
    }
  }, [selectedTableId]);

  // Focus edit input
  useEffect(() => {
    if (editCell && editInputRef.current) editInputRef.current.focus();
  }, [editCell]);

  const commitCellEdit = useCallback(() => {
    if (!editCell || !editHeaders || !editRows) return;
    const { row, col } = editCell;
    if (row === -1) {
      const newH = [...editHeaders];
      newH[col] = editValue;
      setEditHeaders(newH);
    } else {
      const newR = editRows.map((r) => [...r]);
      newR[row][col] = editValue;
      setEditRows(newR);
    }
    setHasEdits(true);
    setEditCell(null);
  }, [editCell, editValue, editHeaders, editRows]);

  const startCellEdit = useCallback((row: number, col: number) => {
    if (!editHeaders || !editRows) return;
    const val = row === -1 ? editHeaders[col] : editRows[row]?.[col] ?? "";
    setEditCell({ row, col });
    setEditValue(val);
  }, [editHeaders, editRows]);

  const handleSaveEdits = useCallback(() => {
    if (!selectedTableId || !editHeaders || !editRows || !onUpdateTable) return;
    onUpdateTable(selectedTableId, editHeaders, editRows);
    setHasEdits(false);
  }, [selectedTableId, editHeaders, editRows, onUpdateTable]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg border shadow-2xl overflow-hidden flex flex-col transition-all duration-200"
        style={{
          backgroundColor: "var(--color-background)",
          borderColor: "var(--color-divider)",
          // Full-screen when a table is selected, normal otherwise
          width: isExpanded ? "95vw" : hasExisting ? 950 : 700,
          height: isExpanded ? "92vh" : undefined,
          maxHeight: isExpanded ? "92vh" : "80vh",
        }}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: "var(--color-divider)" }}>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Insert Table</span>
            {selectedTable && (
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                — Viewing: <span style={{ color: "#5bc0de" }}>{selectedTable.title}</span> ({selectedTable.cols}×{selectedTable.rows})
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-sm px-2 py-1 rounded hover:bg-black/10 dark:hover:bg-white/10" style={{ color: "var(--color-text-muted)" }}>✕</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left panel — existing tables list + preview (70% when expanded) */}
          {hasExisting && (
            <div
              className="border-r overflow-hidden flex flex-col flex-shrink-0 transition-all duration-200"
              style={{
                borderColor: "var(--color-divider)",
                width: isExpanded ? "70%" : 240,
              }}
            >
              {/* Table list */}
              <div
                className="overflow-y-auto p-3 flex flex-col gap-1 flex-shrink-0"
                style={{ maxHeight: isExpanded ? 160 : undefined }}
              >
                <div className="text-[11px] font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>Existing Tables</div>
                {existingTables!.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTableId((prev) => prev === t.id ? null : t.id)}
                    className="w-full text-left px-2.5 py-2 rounded text-[11px] transition-colors"
                    style={{
                      backgroundColor: selectedTableId === t.id ? "rgba(91,192,222,0.15)" : "rgba(136,153,166,0.08)",
                      color: "var(--color-text)",
                      border: selectedTableId === t.id ? "1px solid rgba(91,192,222,0.4)" : "1px solid transparent",
                    }}
                    title={t.referencedIn ? `This table is referenced within the "${t.referencedIn.feature || "—"}" feature's "${t.referencedIn.field || "—"}".${t.referencedIn.module ? ` That feature appears in the "${t.referencedIn.module}" module.` : ""}` : undefined}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">📊 {t.title}</span>
                      <span style={{ color: "var(--color-text-muted)", fontSize: 10 }}>{t.cols}×{t.rows} · {t.id}</span>
                    </div>
                    {t.referencedIn && (
                      <div className="mt-1 flex items-center gap-1 flex-wrap text-[10px]">
                        {t.referencedIn.module && (
                          <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${t.referencedIn.moduleColor || "#428bca"}18`, color: t.referencedIn.moduleColor || "#428bca" }}>
                            {t.referencedIn.module}
                          </span>
                        )}
                        {t.referencedIn.module && t.referencedIn.feature && <span style={{ color: "var(--color-text-muted)" }}>→</span>}
                        {t.referencedIn.feature && (
                          <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${t.referencedIn.featureColor || "#5bc0de"}18`, color: t.referencedIn.featureColor || "#5bc0de" }}>
                            {t.referencedIn.feature}
                          </span>
                        )}
                        {t.referencedIn.feature && t.referencedIn.field && <span style={{ color: "var(--color-text-muted)" }}>→</span>}
                        {t.referencedIn.field && (
                          <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: `${t.referencedIn.fieldColor || "#4ecb71"}18`, color: t.referencedIn.fieldColor || "#4ecb71" }}>
                            {t.referencedIn.field}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* Full table preview — takes remaining space when expanded */}
              {selectedTable && editHeaders && editRows && (
                <div className="flex-1 overflow-hidden flex flex-col border-t" style={{ borderColor: "var(--color-divider)" }}>
                  <div className="px-3 py-2 flex items-center justify-between flex-shrink-0" style={{ backgroundColor: "rgba(91,192,222,0.04)" }}>
                    <span className="text-[11px] font-semibold" style={{ color: "#5bc0de" }}>
                      {selectedTable.title}
                      <span className="font-normal ml-2" style={{ color: "var(--color-text-muted)" }}>
                        {editHeaders.length} columns · {editRows.length} rows
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      {hasEdits && onUpdateTable && (
                        <button
                          onClick={handleSaveEdits}
                          className="text-[11px] px-3 py-1 rounded font-semibold"
                          style={{ backgroundColor: "#f2b661", color: "#1a1a2e" }}
                        >Save Changes</button>
                      )}
                      <button
                        onClick={() => setSelectedTableId(null)}
                        className="text-[10px] px-2 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                        style={{ color: "var(--color-text-muted)" }}
                      >Close preview</button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="text-xs" style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                      <thead className="sticky top-0" style={{ zIndex: 1 }}>
                        <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
                          {editHeaders.map((h, i) => (
                            <th
                              key={i}
                              className="text-center px-3 py-2 font-bold cursor-text"
                              style={{ color: "#5bc0de", backgroundColor: "rgba(91,192,222,0.08)", borderRight: i < editHeaders.length - 1 ? "1px solid var(--color-divider)" : "none", textDecoration: "underline", textUnderlineOffset: 3 }}
                              onClick={() => startCellEdit(-1, i)}
                            >
                              {editCell?.row === -1 && editCell?.col === i ? (
                                <input
                                  ref={editInputRef}
                                  type="text"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={commitCellEdit}
                                  onKeyDown={(e) => { if (e.key === "Enter") commitCellEdit(); if (e.key === "Escape") setEditCell(null); }}
                                  className="w-full bg-transparent border-0 outline-none text-center text-xs font-bold"
                                  style={{ color: "#5bc0de" }}
                                />
                              ) : (h || <span style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>—</span>)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {editRows.map((row, ri) => (
                          <tr
                            key={ri}
                            style={{
                              borderBottom: "1px solid var(--color-divider)",
                              backgroundColor: ri % 2 === 1 ? "rgba(255,255,255,0.02)" : "transparent",
                            }}
                          >
                            {row.map((cell, ci) => (
                              <td
                                key={ci}
                                className="px-3 py-1.5 cursor-text"
                                style={{ color: "var(--color-text)", borderRight: ci < row.length - 1 ? "1px solid var(--color-divider)" : "none" }}
                                onClick={() => startCellEdit(ri, ci)}
                              >
                                {editCell?.row === ri && editCell?.col === ci ? (
                                  <input
                                    ref={editInputRef}
                                    type="text"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onBlur={commitCellEdit}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") { commitCellEdit(); if (ri < editRows.length - 1) startCellEdit(ri + 1, ci); }
                                      if (e.key === "Tab") { e.preventDefault(); commitCellEdit(); const nc = e.shiftKey ? ci - 1 : ci + 1; if (nc >= 0 && nc < editHeaders!.length) startCellEdit(ri, nc); }
                                      if (e.key === "Escape") setEditCell(null);
                                    }}
                                    className="w-full bg-transparent border-0 outline-none text-xs"
                                    style={{ color: "var(--color-text)" }}
                                  />
                                ) : (cell || <span style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>—</span>)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Right panel — insert new table (30% when expanded) */}
          <div className="p-4 space-y-3 overflow-y-auto flex-1">
            {/* Title */}
            <div>
              <label className="text-[11px] block mb-1" style={{ color: "var(--color-text-muted)" }}>Table title</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
                style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                placeholder="e.g. API Surface, Field Mapping..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Paste area */}
            <div>
              <label className="text-[11px] block mb-1" style={{ color: "var(--color-text-muted)" }}>
                Paste markdown table below
              </label>
              <textarea
                className="w-full px-2 py-2 text-xs rounded border focus:outline-none focus:ring-1 font-mono resize-y"
                style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                rows={8}
                placeholder={"| Endpoint | Methods | Purpose |\n| --- | --- | --- |\n| /api/users | GET, POST | User management |"}
                value={rawText}
                onChange={(e) => { setRawText(e.target.value); setParsed(null); setError(""); }}
                autoFocus
              />
            </div>

            {!parsed && (
              <button
                onClick={handleParse}
                disabled={!rawText.trim()}
                className="px-4 py-1.5 text-xs rounded font-medium"
                style={{
                  backgroundColor: rawText.trim() ? "var(--color-primary)" : "var(--color-divider)",
                  color: rawText.trim() ? "var(--color-primary-text)" : "var(--color-text-muted)",
                }}
              >
                Parse Table
              </button>
            )}

            {error && <div className="text-xs px-2 py-1.5 rounded" style={{ backgroundColor: "rgba(224,85,85,0.12)", color: "#e05555" }}>{error}</div>}

            {/* Preview */}
            {parsed && (
              <div className="space-y-2">
                <div className="text-[11px] font-medium" style={{ color: "var(--color-text-muted)" }}>
                  Preview — {parsed.headers.length} columns, {parsed.rows.length} rows
                </div>
                <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--color-divider)" }}>
                  <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
                        {parsed.headers.map((h, i) => (
                          <th key={i} className="text-center px-3 py-2 font-bold" style={{ color: "#5bc0de", backgroundColor: "rgba(91,192,222,0.06)", textDecoration: "underline", textUnderlineOffset: 3, borderRight: i < parsed.headers.length - 1 ? "1px solid var(--color-divider)" : "none" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.map((row, ri) => (
                        <tr key={ri} style={{ borderBottom: "1px solid var(--color-divider)" }}>
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-3 py-1.5" style={{ color: "var(--color-text)", borderRight: ci < row.length - 1 ? "1px solid var(--color-divider)" : "none" }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {parsed && (
          <div className="px-4 py-3 border-t flex justify-end gap-2 flex-shrink-0" style={{ borderColor: "var(--color-divider)" }}>
            <button onClick={onClose} className="px-3 py-1.5 text-xs rounded" style={{ color: "var(--color-text-muted)" }}>Cancel</button>
            <button
              onClick={handleInsert}
              className="px-4 py-1.5 text-xs rounded font-medium"
              style={{ backgroundColor: "var(--color-primary)", color: "var(--color-primary-text)" }}
            >
              Insert Table
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
