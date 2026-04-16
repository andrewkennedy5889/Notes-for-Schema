

import React, { useState, useCallback, useRef, useEffect } from "react";
import type { EmbeddedTable } from "./types";

const DEFAULT_COL_WIDTH = 150;
const DEFAULT_ROW_HEIGHT = 28;
const HEADER_HEIGHT = 30;
const MIN_COL_WIDTH = 50;
const MIN_ROW_HEIGHT = 20;

/**
 * Inline editable table grid rendered over the textarea.
 * - Click a cell to edit, Tab/Enter to navigate
 * - Drag column borders to resize width
 * - Drag row borders to resize height
 * - Double-click column/row border to toggle fit-to-content
 * - Global row height control next to + Row / + Col
 * - Dimensions are persisted to EmbeddedTable
 */
export function InlineTableGrid({
  table,
  onChange,
  onCollapse,
  onDelete,
  onHeaderMouseDown,
}: {
  table: EmbeddedTable;
  onChange: (updated: EmbeddedTable) => void;
  onCollapse: () => void;
  onDelete: () => void;
  onHeaderMouseDown?: (e: React.MouseEvent) => void;
}) {
  const [editCell, setEditCell] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasDeletedRowSinceMount = useRef(false);
  const hasDeletedColSinceMount = useRef(false);
  const tableRef = useRef<HTMLTableElement>(null);

  // --- Tooltip state for hover popovers ---
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Global row height input ---
  const [globalHeightInput, setGlobalHeightInput] = useState("");
  const [showGlobalHeight, setShowGlobalHeight] = useState(false);

  // Column widths and row heights — initialized from persisted data, fallback to defaults
  const [colWidths, setColWidths] = useState<number[]>(() =>
    table.headers.map((_, i) => table.colWidths?.[i] ?? DEFAULT_COL_WIDTH)
  );
  const [rowHeights, setRowHeights] = useState<number[]>(() =>
    table.rows.map((_, i) => table.rowHeights?.[i] ?? DEFAULT_ROW_HEIGHT)
  );
  const [fitCols, setFitCols] = useState<boolean[]>(() =>
    table.headers.map((_, i) => table.fitToContentCols?.[i] ?? false)
  );
  const [fitRows, setFitRows] = useState<boolean[]>(() =>
    table.rows.map((_, i) => table.fitToContentRows?.[i] ?? false)
  );

  // Persist dimensions back to parent whenever they change
  const persistDimensions = useCallback((
    cw: number[], rh: number[], fc: boolean[], fr: boolean[]
  ) => {
    onChange({
      ...table,
      colWidths: cw,
      rowHeights: rh,
      fitToContentCols: fc,
      fitToContentRows: fr,
    });
  }, [table, onChange]);

  // Ref to track whether we should persist (avoids persisting on mount)
  const hasMounted = useRef(false);
  useEffect(() => { hasMounted.current = true; }, []);

  // Sync sizes when columns/rows are added/removed
  useEffect(() => {
    setColWidths((prev) => {
      if (prev.length === table.headers.length) return prev;
      const next = [...prev];
      while (next.length < table.headers.length) next.push(DEFAULT_COL_WIDTH);
      return next.slice(0, table.headers.length);
    });
    setFitCols((prev) => {
      if (prev.length === table.headers.length) return prev;
      const next = [...prev];
      while (next.length < table.headers.length) next.push(false);
      return next.slice(0, table.headers.length);
    });
  }, [table.headers.length]);

  // Sync row heights when parent changes them (e.g. global height set from panel header)
  useEffect(() => {
    if (table.rowHeights && table.rowHeights.length > 0) {
      setRowHeights(table.rowHeights.slice(0, table.rows.length));
    } else {
      setRowHeights((prev) => {
        if (prev.length === table.rows.length) return prev;
        const next = [...prev];
        while (next.length < table.rows.length) next.push(DEFAULT_ROW_HEIGHT);
        return next.slice(0, table.rows.length);
      });
    }
    setFitRows((prev) => {
      if (prev.length === table.rows.length) return prev;
      const next = [...prev];
      while (next.length < table.rows.length) next.push(false);
      return next.slice(0, table.rows.length);
    });
  }, [table.rows.length, table.rowHeights]);

  // --- Measure content for fit-to-content ---
  const measureColWidth = useCallback((colIdx: number): number => {
    // Approximate: 8px per character + 20px padding
    let maxLen = (table.headers[colIdx] || "").length;
    for (const row of table.rows) {
      maxLen = Math.max(maxLen, (row[colIdx] || "").length);
    }
    return Math.max(MIN_COL_WIDTH, maxLen * 8 + 24);
  }, [table]);

  const measureRowHeight = useCallback((rowIdx: number): number => {
    // Approximate: check longest cell text, estimate wrapping
    let maxLen = 0;
    const row = table.rows[rowIdx];
    if (!row) return DEFAULT_ROW_HEIGHT;
    for (let ci = 0; ci < row.length; ci++) {
      const cellLen = (row[ci] || "").length;
      const colW = colWidths[ci] || DEFAULT_COL_WIDTH;
      const charsPerLine = Math.max(1, Math.floor((colW - 16) / 8));
      const lines = Math.max(1, Math.ceil(cellLen / charsPerLine));
      maxLen = Math.max(maxLen, lines);
    }
    return Math.max(MIN_ROW_HEIGHT, maxLen * 22 + 8);
  }, [table, colWidths]);

  // --- Column resize drag ---
  const dragCol = useRef<{ idx: number; startX: number; startW: number } | null>(null);
  const handleColDragStart = useCallback((e: React.MouseEvent, colIdx: number) => {
    e.preventDefault();
    dragCol.current = { idx: colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    const onMove = (ev: MouseEvent) => {
      if (!dragCol.current) return;
      const delta = ev.clientX - dragCol.current.startX;
      const newW = Math.max(MIN_COL_WIDTH, dragCol.current.startW + delta);
      setColWidths((prev) => { const n = [...prev]; n[dragCol.current!.idx] = newW; return n; });
    };
    const onUp = () => {
      dragCol.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Persist after drag ends
      setColWidths((cw) => {
        setFitCols((fc) => {
          // Turn off fit-to-content for this column since user manually dragged
          const newFc = [...fc];
          // We don't know which col was dragged here, but the latest state is fine
          setRowHeights((rh) => {
            setFitRows((fr) => {
              persistDimensions(cw, rh, newFc, fr);
              return fr;
            });
            return rh;
          });
          return newFc;
        });
        return cw;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colWidths, persistDimensions]);

  // --- Row resize drag ---
  const dragRow = useRef<{ idx: number; startY: number; startH: number } | null>(null);
  const handleRowDragStart = useCallback((e: React.MouseEvent, rowIdx: number) => {
    e.preventDefault();
    dragRow.current = { idx: rowIdx, startY: e.clientY, startH: rowHeights[rowIdx] };
    const onMove = (ev: MouseEvent) => {
      if (!dragRow.current) return;
      const delta = ev.clientY - dragRow.current.startY;
      const newH = Math.max(MIN_ROW_HEIGHT, dragRow.current.startH + delta);
      setRowHeights((prev) => { const n = [...prev]; n[dragRow.current!.idx] = newH; return n; });
    };
    const onUp = () => {
      dragRow.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Persist after drag ends
      setRowHeights((rh) => {
        setFitRows((fr) => {
          setColWidths((cw) => {
            setFitCols((fc) => {
              persistDimensions(cw, rh, fc, fr);
              return fc;
            });
            return cw;
          });
          return fr;
        });
        return rh;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [rowHeights, persistDimensions]);

  // --- Double-click to toggle fit-to-content ---
  const handleColDoubleClick = useCallback((colIdx: number) => {
    setFitCols((prev) => {
      const next = [...prev];
      next[colIdx] = !next[colIdx];
      const newColWidths = [...colWidths];
      if (next[colIdx]) {
        newColWidths[colIdx] = measureColWidth(colIdx);
      }
      setColWidths(newColWidths);
      setRowHeights((rh) => {
        setFitRows((fr) => {
          persistDimensions(newColWidths, rh, next, fr);
          return fr;
        });
        return rh;
      });
      return next;
    });
  }, [colWidths, measureColWidth, persistDimensions]);

  const handleRowDoubleClick = useCallback((rowIdx: number) => {
    setFitRows((prev) => {
      const next = [...prev];
      next[rowIdx] = !next[rowIdx];
      const newRowHeights = [...rowHeights];
      if (next[rowIdx]) {
        newRowHeights[rowIdx] = measureRowHeight(rowIdx);
      }
      setRowHeights(newRowHeights);
      setColWidths((cw) => {
        setFitCols((fc) => {
          persistDimensions(cw, newRowHeights, fc, next);
          return fc;
        });
        return cw;
      });
      return next;
    });
  }, [rowHeights, measureRowHeight, persistDimensions]);

  // --- Tooltip helpers ---
  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    tooltipTimeout.current = setTimeout(() => {
      setTooltip({ x: e.clientX, y: e.clientY - 36, text });
    }, 500);
  }, []);

  const hideTooltip = useCallback(() => {
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    setTooltip(null);
  }, []);

  // --- Global row height ---
  const applyGlobalHeight = useCallback(() => {
    const h = parseInt(globalHeightInput, 10);
    if (!h || h < MIN_ROW_HEIGHT) return;
    const newRH = table.rows.map(() => h);
    const newFR = table.rows.map(() => false);
    setRowHeights(newRH);
    setFitRows(newFR);
    setShowGlobalHeight(false);
    setColWidths((cw) => {
      setFitCols((fc) => {
        persistDimensions(cw, newRH, fc, newFR);
        return fc;
      });
      return cw;
    });
  }, [globalHeightInput, table.rows, persistDimensions]);

  useEffect(() => {
    if (editCell && inputRef.current) inputRef.current.focus();
  }, [editCell]);

  const commitEdit = useCallback(() => {
    if (!editCell) return;
    const { row, col } = editCell;
    if (row === -1) {
      const newHeaders = [...table.headers];
      newHeaders[col] = editValue;
      onChange({ ...table, headers: newHeaders, colWidths, rowHeights, fitToContentCols: fitCols, fitToContentRows: fitRows });
    } else {
      const newRows = table.rows.map((r) => [...r]);
      newRows[row][col] = editValue;
      onChange({ ...table, rows: newRows, colWidths, rowHeights, fitToContentCols: fitCols, fitToContentRows: fitRows });
    }
    setEditCell(null);
  }, [editCell, editValue, table, onChange, colWidths, rowHeights, fitCols, fitRows]);

  const startEdit = useCallback((row: number, col: number) => {
    const val = row === -1 ? table.headers[col] : table.rows[row]?.[col] ?? "";
    setEditCell({ row, col });
    setEditValue(val);
  }, [table]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!editCell) return;
    if (e.key === "Tab") {
      e.preventDefault();
      commitEdit();
      const nextCol = e.shiftKey ? editCell.col - 1 : editCell.col + 1;
      if (nextCol >= 0 && nextCol < table.headers.length) {
        startEdit(editCell.row, nextCol);
      } else if (!e.shiftKey && editCell.row < table.rows.length - 1) {
        startEdit(editCell.row + 1, 0);
      } else if (e.shiftKey && editCell.row > -1) {
        startEdit(editCell.row - 1, table.headers.length - 1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
      if (editCell.row < table.rows.length - 1) {
        startEdit(editCell.row + 1, editCell.col);
      }
    } else if (e.key === "Escape") {
      setEditCell(null);
    }
  }, [editCell, commitEdit, startEdit, table]);

  const addRow = useCallback(() => {
    const newRow = new Array(table.headers.length).fill("");
    onChange({
      ...table,
      rows: [...table.rows, newRow],
      colWidths,
      rowHeights: [...rowHeights, DEFAULT_ROW_HEIGHT],
      fitToContentCols: fitCols,
      fitToContentRows: [...fitRows, false],
    });
  }, [table, onChange, colWidths, rowHeights, fitCols, fitRows]);

  const removeRow = useCallback((idx: number) => {
    if (!hasDeletedRowSinceMount.current) {
      if (!window.confirm("Are you sure you want to delete this row?")) return;
      hasDeletedRowSinceMount.current = true;
    }
    const newRH = rowHeights.filter((_, i) => i !== idx);
    const newFR = fitRows.filter((_, i) => i !== idx);
    setRowHeights(newRH);
    setFitRows(newFR);
    onChange({
      ...table,
      rows: table.rows.filter((_, i) => i !== idx),
      colWidths,
      rowHeights: newRH,
      fitToContentCols: fitCols,
      fitToContentRows: newFR,
    });
  }, [table, onChange, colWidths, rowHeights, fitCols, fitRows]);

  const addColumn = useCallback(() => {
    const newCW = [...colWidths, DEFAULT_COL_WIDTH];
    const newFC = [...fitCols, false];
    setColWidths(newCW);
    setFitCols(newFC);
    onChange({
      ...table,
      headers: [...table.headers, ""],
      rows: table.rows.map((r) => [...r, ""]),
      colWidths: newCW,
      rowHeights,
      fitToContentCols: newFC,
      fitToContentRows: fitRows,
    });
  }, [table, onChange, colWidths, rowHeights, fitCols, fitRows]);

  const removeColumn = useCallback((col: number) => {
    if (table.headers.length <= 1) return;
    if (!hasDeletedColSinceMount.current) {
      if (!window.confirm("Are you sure you want to delete this column?")) return;
      hasDeletedColSinceMount.current = true;
    }
    const newCW = colWidths.filter((_, i) => i !== col);
    const newFC = fitCols.filter((_, i) => i !== col);
    setColWidths(newCW);
    setFitCols(newFC);
    onChange({
      ...table,
      headers: table.headers.filter((_, i) => i !== col),
      rows: table.rows.map((r) => r.filter((_, i) => i !== col)),
      colWidths: newCW,
      rowHeights,
      fitToContentCols: newFC,
      fitToContentRows: fitRows,
    });
  }, [table, onChange, colWidths, rowHeights, fitCols, fitRows]);

  const renderCell = (value: string, row: number, col: number, height?: number) => {
    const isEditing = editCell?.row === row && editCell?.col === col;
    const isHeader = row === -1;
    if (isEditing) {
      return (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="w-full px-2 py-1 text-xs border-0 outline-none bg-transparent"
          style={{ color: "var(--color-text)", minWidth: 50, height: height || 28, fontWeight: isHeader ? 700 : 400, textDecoration: isHeader ? "underline" : "none", textAlign: isHeader ? "center" : undefined, fontSize: isHeader ? "0.85rem" : undefined }}
        />
      );
    }
    return (
      <div
        className="px-2 py-1 text-xs cursor-text overflow-hidden w-full"
        style={{ color: "var(--color-text)", height: height || 28, lineHeight: `${(height || 28) - 8}px`, fontWeight: isHeader ? 700 : 400, textDecoration: isHeader ? "underline" : "none", textUnderlineOffset: isHeader ? 3 : undefined, textAlign: isHeader ? "center" : undefined, fontSize: isHeader ? "0.85rem" : undefined }}
        onClick={() => startEdit(row, col)}
      >
        {value || <span style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>—</span>}
      </div>
    );
  };

  return (
    <div
      className="rounded border overflow-hidden"
      style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-background)", width: Math.max(600, colWidths.reduce((a, b) => a + b, 0)), maxWidth: "100%" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Grid */}
      <div className="overflow-hidden">
        <table ref={tableRef} className="text-xs" style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead
            style={{ cursor: onHeaderMouseDown ? "grab" : undefined, userSelect: onHeaderMouseDown ? "none" : undefined }}
            onMouseDown={(e) => {
              // Let resize handles and buttons handle their own events
              if ((e.target as HTMLElement).closest("button, input, [data-no-drag]")) return;
              // Don't hijack col-resize handles (the 4px divs)
              if ((e.target as HTMLElement).style.cursor === "col-resize") return;
              if (onHeaderMouseDown) onHeaderMouseDown(e);
            }}
          >
            <tr style={{ borderBottom: "2.5px solid var(--color-divider)" }}>
              {table.headers.map((h, ci) => (
                <th
                  key={ci}
                  className="text-center relative group"
                  style={{ backgroundColor: "var(--color-surface, #1a1a2e)", height: HEADER_HEIGHT, overflow: "hidden", position: "relative", borderRight: ci < table.headers.length - 1 ? "2.5px solid var(--color-divider)" : "none" }}
                >
                  <div className="flex items-center justify-center">
                    {renderCell(h, -1, ci, HEADER_HEIGHT)}
                    {fitCols[ci] && (
                      <span
                        className="absolute top-0.5 left-1 text-[8px]"
                        style={{ color: "#5bc0de", opacity: 0.7 }}
                        title="Fit to content (double-click border to toggle)"
                      >⤢</span>
                    )}
                    {table.headers.length > 1 && (
                      <button
                        onClick={() => removeColumn(ci)}
                        className="absolute top-0 right-4 text-[9px] px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: "#e05555" }}
                        title="Remove column"
                      >✕</button>
                    )}
                  </div>
                  {/* Column resize handle — double-click for fit-to-content */}
                  <div
                    onMouseDown={(e) => handleColDragStart(e, ci)}
                    onDoubleClick={() => handleColDoubleClick(ci)}
                    onMouseEnter={(e) => showTooltip(e, "Drag to resize · Double-click to fit content")}
                    onMouseLeave={hideTooltip}
                    style={{
                      position: "absolute", top: 0, right: 0, width: 4, height: "100%",
                      cursor: "col-resize", zIndex: 5,
                    }}
                    className="hover:bg-blue-400/40"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr
                key={ri}
                className="group/row relative"
                style={{
                  borderBottom: "1px solid var(--color-divider)",
                  backgroundColor: ri % 2 === 1 ? "rgba(255,255,255,0.02)" : "transparent",
                  height: rowHeights[ri] || DEFAULT_ROW_HEIGHT,
                }}
              >
                {row.map((cell, ci) => (
                  <td key={ci} style={{ borderRight: ci < row.length - 1 ? "1px solid var(--color-divider)" : "none", overflow: "hidden", position: "relative" }}>
                    {renderCell(cell, ri, ci, rowHeights[ri])}
                    {/* Fit-to-content indicator on first cell */}
                    {ci === 0 && fitRows[ri] && (
                      <span
                        className="absolute top-0.5 left-0.5 text-[8px]"
                        style={{ color: "#5bc0de", opacity: 0.7 }}
                        title="Fit to content (double-click border to toggle)"
                      >⤢</span>
                    )}
                    {/* Row resize handle on first cell — double-click for fit-to-content */}
                    {ci === 0 && (
                      <div
                        onMouseDown={(e) => handleRowDragStart(e, ri)}
                        onDoubleClick={() => handleRowDoubleClick(ri)}
                        onMouseEnter={(e) => showTooltip(e, "Drag to resize · Double-click to fit content")}
                        onMouseLeave={hideTooltip}
                        style={{
                          position: "absolute", bottom: 0, left: 0, width: "100%", height: 4,
                          cursor: "row-resize", zIndex: 5,
                        }}
                        className="hover:bg-blue-400/40"
                      />
                    )}
                  </td>
                ))}
                {/* Delete row button — overlaid on right edge */}
                <td style={{ width: 0, padding: 0, border: "none", position: "relative" }}>
                  <button
                    onClick={() => removeRow(ri)}
                    className="absolute text-[9px] px-1 opacity-0 group-hover/row:opacity-100 transition-opacity"
                    style={{ color: "#e05555", right: 2, top: "50%", transform: "translateY(-50%)" }}
                    title="Remove row"
                  >✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed px-2 py-1 rounded shadow-lg border text-[10px] pointer-events-none z-[9999]"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            backgroundColor: "var(--color-background)",
            borderColor: "var(--color-divider)",
            color: "var(--color-text)",
            transform: "translateX(-50%)",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
