

import React, { useState, useEffect, useMemo, useRef } from "react";

function SearchableTablePicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ tableId: number; tableName: string }>;
  onChange: (tableName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return options.filter((t) => t.tableName.toLowerCase().includes(q));
  }, [options, query]);

  // Reset selected index when filtered list changes
  useEffect(() => { setSelectedIdx(0); }, [filtered.length]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const select = (tableName: string) => {
    onChange(tableName);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : value || ""}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onKeyDown={(e) => {
          if (!open || filtered.length === 0) {
            if (e.key === "ArrowDown") { setOpen(true); e.preventDefault(); }
            return;
          }
          if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); select(filtered[selectedIdx].tableName); }
          else if (e.key === "Escape") { setOpen(false); setQuery(""); }
        }}
        placeholder="Search tables..."
        className="w-full px-2 py-1.5 text-xs rounded border focus:outline-none focus:ring-1"
        style={{ borderColor: open ? "var(--color-primary)" : "var(--color-divider)", backgroundColor: "var(--color-background)", color: "var(--color-text)" }}
      />
      {value && !open && (
        <button
          onClick={() => { onChange(""); inputRef.current?.focus(); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs leading-none"
          style={{ color: "var(--color-text-muted)" }}
        >
          ✕
        </button>
      )}
      {open && (
        <div
          className="absolute z-50 w-full mt-0.5 max-h-48 overflow-y-auto rounded-md border shadow-lg"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}
        >
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-[10px]" style={{ color: "var(--color-text-muted)" }}>No tables found</div>
          ) : (
            filtered.map((t, i) => (
              <button
                key={t.tableId}
                type="button"
                onClick={() => select(t.tableName)}
                onMouseEnter={() => setSelectedIdx(i)}
                className="w-full text-left px-2 py-1.5 text-xs"
                style={{
                  backgroundColor: i === selectedIdx ? "var(--color-surface)" : "transparent",
                  color: "var(--color-text)",
                }}
              >
                {t.tableName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default SearchableTablePicker;
