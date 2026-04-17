import { useMemo, useState } from "react";
import type { SyncDiff, SyncDiffEdit, SyncDiffTable } from "../../lib/api";

const MAX_CHANGE_COLS = 5;
const MAX_ROWS_PER_TABLE = 100;

function truncate(s: string, n = 40): string {
  if (s == null) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function shortId(id: string | number): string {
  const s = String(id);
  return s.length > 8 ? s.slice(-6) : s;
}

function ChangeCell({ field, local, remote, conflict }: { field: string; local: string; remote: string; conflict: boolean }) {
  return (
    <td
      className="align-top px-2 py-1.5 text-[11px]"
      style={{
        borderLeft: "1px solid var(--color-divider)",
        backgroundColor: conflict ? "rgba(224,85,85,0.08)" : "transparent",
        minWidth: 160,
      }}
    >
      <div
        className="text-[9px] uppercase tracking-wider mb-0.5"
        style={{ color: conflict ? "#e05555" : "var(--color-text-subtle)" }}
      >
        {field}{conflict && " ⚠"}
      </div>
      <div style={{ color: "#e05555" }}>
        <span style={{ color: "var(--color-text-subtle)" }}>L:</span> {truncate(local)}
      </div>
      <div style={{ color: "#4ecb71" }}>
        <span style={{ color: "var(--color-text-subtle)" }}>R:</span> {truncate(remote)}
      </div>
    </td>
  );
}

function EditsTable({ edits }: { edits: SyncDiffEdit[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const shown = edits.slice(0, MAX_ROWS_PER_TABLE);
  const hidden = edits.length - shown.length;

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-divider)", color: "var(--color-text-muted)" }}>
            <th className="text-left px-2 py-1 font-medium" style={{ width: 40 }}></th>
            <th className="text-left px-2 py-1 font-medium" style={{ minWidth: 140 }}>Name</th>
            <th className="text-left px-2 py-1 font-medium" style={{ minWidth: 70 }}>ID</th>
            {Array.from({ length: MAX_CHANGE_COLS }).map((_, i) => (
              <th key={i} className="text-left px-2 py-1 font-medium" style={{ borderLeft: "1px solid var(--color-divider)" }}>
                Change {i + 1}
              </th>
            ))}
          </tr>
        </thead>
          {shown.map(edit => {
            const visible = edit.changes.slice(0, MAX_CHANGE_COLS);
            const extra = edit.changes.length - visible.length;
            const key = String(edit.id);
            const isExpanded = expanded[key];
            return (
              <tbody key={key} style={{ display: "contents" }}>
                <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
                  <td className="px-2 py-1.5">
                    {edit.recordConflict && (
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold"
                        style={{ backgroundColor: "rgba(224,85,85,0.15)", color: "#e05555" }}
                        title="Both sides edited this record"
                      >
                        CONFLICT
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: "var(--color-text)" }}>{edit.name || <em style={{ color: "var(--color-text-subtle)" }}>(no name)</em>}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px]" style={{ color: "var(--color-text-subtle)" }}>{shortId(edit.id)}</td>
                  {visible.map((c, i) => {
                    if (i === MAX_CHANGE_COLS - 1 && extra > 0 && !isExpanded) {
                      return (
                        <td
                          key={i}
                          className="align-middle px-2 py-1.5 text-[11px] text-center"
                          style={{ borderLeft: "1px solid var(--color-divider)", minWidth: 120 }}
                        >
                          <button
                            onClick={() => setExpanded(e => ({ ...e, [key]: true }))}
                            className="underline"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            +{extra + 1} more
                          </button>
                        </td>
                      );
                    }
                    return (
                      <ChangeCell
                        key={i}
                        field={c.field}
                        local={c.local}
                        remote={c.remote}
                        conflict={c.fieldConflict}
                      />
                    );
                  })}
                  {Array.from({ length: Math.max(0, MAX_CHANGE_COLS - visible.length) }).map((_, i) => (
                    <td key={`pad-${i}`} style={{ borderLeft: "1px solid var(--color-divider)" }}></td>
                  ))}
                </tr>
                {isExpanded && edit.changes.length > MAX_CHANGE_COLS && (
                  <tr style={{ borderBottom: "1px solid var(--color-divider)" }}>
                    <td colSpan={3}></td>
                    <td colSpan={MAX_CHANGE_COLS} style={{ borderLeft: "1px solid var(--color-divider)" }}>
                      <div className="flex flex-wrap gap-2 px-2 py-1.5">
                        {edit.changes.slice(MAX_CHANGE_COLS).map((c, i) => (
                          <div
                            key={i}
                            className="text-[11px] rounded p-1.5"
                            style={{
                              minWidth: 160,
                              backgroundColor: c.fieldConflict ? "rgba(224,85,85,0.08)" : "rgba(255,255,255,0.02)",
                              border: "1px solid var(--color-divider)",
                            }}
                          >
                            <div
                              className="text-[9px] uppercase tracking-wider mb-0.5"
                              style={{ color: c.fieldConflict ? "#e05555" : "var(--color-text-subtle)" }}
                            >
                              {c.field}{c.fieldConflict && " ⚠"}
                            </div>
                            <div style={{ color: "#e05555" }}>L: {truncate(c.local)}</div>
                            <div style={{ color: "#4ecb71" }}>R: {truncate(c.remote)}</div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
      </table>
      {hidden > 0 && (
        <p className="text-[10px] mt-1 px-2" style={{ color: "var(--color-text-subtle)" }}>
          +{hidden} more edited record(s) not shown
        </p>
      )}
    </div>
  );
}

function SideList({ rows, kind }: { rows: { id: string | number; name: string; side: 'local' | 'remote' }[]; kind: 'added' | 'deleted' }) {
  const shown = rows.slice(0, MAX_ROWS_PER_TABLE);
  const hidden = rows.length - shown.length;

  const badgeColor = (side: 'local' | 'remote') => {
    if (kind === 'added') {
      return side === 'local' ? { bg: "rgba(78,203,113,0.15)", fg: "#4ecb71" } : { bg: "rgba(66,139,202,0.15)", fg: "#428bca" };
    }
    return { bg: "rgba(224,85,85,0.15)", fg: "#e05555" };
  };

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-divider)", color: "var(--color-text-muted)" }}>
            <th className="text-left px-2 py-1 font-medium" style={{ width: 110 }}>Status</th>
            <th className="text-left px-2 py-1 font-medium">Name</th>
            <th className="text-left px-2 py-1 font-medium" style={{ minWidth: 70 }}>ID</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(row => {
            const c = badgeColor(row.side);
            const label = kind === 'added'
              ? (row.side === 'local' ? 'NEW · LOCAL' : 'NEW · REMOTE')
              : (row.side === 'local' ? 'DELETED · LOCAL' : 'DELETED · REMOTE');
            return (
              <tr key={String(row.id)} style={{ borderBottom: "1px solid var(--color-divider)" }}>
                <td className="px-2 py-1.5">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold"
                    style={{ backgroundColor: c.bg, color: c.fg }}
                  >
                    {label}
                  </span>
                </td>
                <td className="px-2 py-1.5" style={{ color: "var(--color-text)" }}>{row.name || <em style={{ color: "var(--color-text-subtle)" }}>(no name)</em>}</td>
                <td className="px-2 py-1.5 font-mono text-[10px]" style={{ color: "var(--color-text-subtle)" }}>{shortId(row.id)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <p className="text-[10px] mt-1 px-2" style={{ color: "var(--color-text-subtle)" }}>
          +{hidden} more not shown
        </p>
      )}
    </div>
  );
}

function TableSection({ table }: { table: SyncDiffTable }) {
  const [open, setOpen] = useState(false);
  const total = table.edits.length + table.added.length + table.deleted.length;
  const conflictCount = table.edits.filter(e => e.recordConflict).length;

  return (
    <div className="mb-2 rounded" style={{ border: "1px solid var(--color-divider)" }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
        style={{ backgroundColor: open ? "rgba(255,255,255,0.02)" : "transparent" }}
      >
        <span style={{ color: "var(--color-text-muted)" }}>{open ? "▼" : "▶"}</span>
        <span className="font-medium" style={{ color: "var(--color-text)" }}>{table.label}</span>
        <span style={{ color: "var(--color-text-subtle)" }}>
          ({total} change{total === 1 ? "" : "s"}
          {conflictCount > 0 && <> · <span style={{ color: "#e05555" }}>{conflictCount} conflict{conflictCount === 1 ? "" : "s"}</span></>}
          {table.edits.length > 0 && <> · {table.edits.length} edited</>}
          {table.added.length > 0 && <> · {table.added.length} added</>}
          {table.deleted.length > 0 && <> · {table.deleted.length} deleted</>}
          )
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {table.edits.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-subtle)" }}>Edited</div>
              <EditsTable edits={table.edits} />
            </div>
          )}
          {table.added.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-subtle)" }}>Added</div>
              <SideList rows={table.added} kind="added" />
            </div>
          )}
          {table.deleted.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-subtle)" }}>Deleted</div>
              <SideList rows={table.deleted} kind="deleted" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SyncDiffViewer({ diff }: { diff: SyncDiff }) {
  const summary = useMemo(() => {
    const recordConflicts = diff.tables.reduce((n, t) => n + t.edits.filter(e => e.recordConflict).length, 0);
    const fieldConflicts = diff.tables.reduce(
      (n, t) => n + t.edits.reduce((m, e) => m + e.changes.filter(c => c.fieldConflict).length, 0),
      0
    );
    return { recordConflicts, fieldConflicts };
  }, [diff]);

  if (diff.error) {
    return <p className="text-xs" style={{ color: "#e05555" }}>Failed to load diff: {diff.error}</p>;
  }
  if (diff.tables.length === 0) {
    return <p className="text-xs" style={{ color: "var(--color-text-subtle)" }}>No differences detected.</p>;
  }

  return (
    <div className="mt-3">
      {(summary.recordConflicts > 0 || summary.fieldConflicts > 0) && (
        <div
          className="text-xs p-2 rounded mb-2"
          style={{ backgroundColor: "rgba(224,85,85,0.08)", border: "1px solid rgba(224,85,85,0.3)", color: "#e05555" }}
        >
          <strong>{summary.recordConflicts}</strong> record-level conflict(s) — both sides edited the same record.
          {summary.fieldConflicts > 0 && <> <strong>{summary.fieldConflicts}</strong> of those are field-level conflicts (highlighted red) — both sides changed the same field.</>}
        </div>
      )}
      <div className="text-[10px] flex items-center gap-3 mb-2" style={{ color: "var(--color-text-subtle)" }}>
        <span><span style={{ color: "#e05555" }}>L:</span> local value</span>
        <span><span style={{ color: "#4ecb71" }}>R:</span> remote value</span>
      </div>
      {diff.tables.map(t => <TableSection key={t.tableName} table={t} />)}
    </div>
  );
}
