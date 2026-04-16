

import React, { useState, useEffect, useRef, useMemo } from "react";
import { TAG_TIER_COLORS } from "./constants";

interface ModuleTag {
  name: string;
  tier: number;
}

interface CatalogTag {
  tagId: number;
  tagName: string;
  tier: number;
}

interface ModuleTagsEditorProps {
  tags: ModuleTag[];
  onChange: (tags: ModuleTag[]) => void;
}

const MAX_TIER1 = 125;

export default function ModuleTagsEditor({ tags, onChange }: ModuleTagsEditorProps) {
  const [input, setInput] = useState("");
  const [selectedTier, setSelectedTier] = useState<1 | 2>(2);
  const [catalog, setCatalog] = useState<CatalogTag[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch tag catalog on mount
  useEffect(() => {
    fetch("/api/schema-planner?table=_splan_tag_catalog")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setCatalog(d);
        else if (d.rows) setCatalog(d.rows);
      })
      .catch(() => {});
  }, []);

  const tier1Count = useMemo(() => tags.filter((t) => t.tier === 1).length, [tags]);
  const tier1Full = tier1Count >= MAX_TIER1;

  // Fuzzy match: filter catalog tags that match input, excluding already-added tags
  const suggestions = useMemo(() => {
    const existing = new Set(tags.map((t) => t.name.toLowerCase()));
    const q = input.toLowerCase().trim();
    if (!q) return [];

    return catalog
      .filter((c) => !existing.has(c.tagName.toLowerCase()))
      .filter((c) => c.tagName.toLowerCase().includes(q))
      .sort((a, b) => {
        // Exact start match first
        const aStarts = a.tagName.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.tagName.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.tagName.localeCompare(b.tagName);
      })
      .slice(0, 10);
  }, [input, catalog, tags]);

  // Does input exactly match an existing catalog tag?
  const exactMatch = useMemo(() => {
    const q = input.trim().toLowerCase();
    return catalog.find((c) => c.tagName.toLowerCase() === q);
  }, [input, catalog]);

  // Can create new tag (input not empty, not duplicate)
  const canCreate = useMemo(() => {
    const q = input.trim();
    if (!q) return false;
    const existing = new Set(tags.map((t) => t.name.toLowerCase()));
    return !existing.has(q.toLowerCase());
  }, [input, tags]);

  const addTag = (name: string, tier: number) => {
    // Enforce tier 1 limit
    if (tier === 1 && tier1Full) {
      tier = 2; // Downgrade to tier 2 if tier 1 is full
    }
    const existing = new Set(tags.map((t) => t.name.toLowerCase()));
    if (existing.has(name.toLowerCase())) return;
    onChange([...tags, { name, tier }]);
    setInput("");
    setShowDropdown(false);
    setHighlightIdx(0);

    // Add to catalog if new
    if (!catalog.find((c) => c.tagName.toLowerCase() === name.toLowerCase())) {
      fetch("/api/schema-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "_splan_tag_catalog", data: { tagName: name, tier } }),
      })
        .then((r) => r.json())
        .then((created) => {
          if (created.tagId) setCatalog((prev) => [...prev, created]);
        })
        .catch(() => {});
    }
  };

  const removeTag = (name: string) => {
    onChange(tags.filter((t) => t.name !== name));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, suggestions.length - (canCreate && !exactMatch ? 0 : 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // If highlighting a suggestion
      if (showDropdown && suggestions.length > 0 && highlightIdx < suggestions.length) {
        const s = suggestions[highlightIdx];
        addTag(s.tagName, selectedTier);
      } else if (canCreate) {
        addTag(input.trim(), selectedTier);
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  // Sort displayed tags: tier 1 first, then tier 2, alphabetical within each
  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
    [tags]
  );

  return (
    <div className="space-y-3">
      {/* Tier toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Adding as:</span>
        <button
          type="button"
          onClick={() => setSelectedTier(1)}
          className="px-2.5 py-1 rounded text-xs font-medium transition-all"
          style={selectedTier === 1
            ? { backgroundColor: TAG_TIER_COLORS[1].bg, color: TAG_TIER_COLORS[1].text, border: `1px solid ${TAG_TIER_COLORS[1].border}` }
            : { backgroundColor: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-divider)" }
          }
        >
          ★ Tier 1 {tier1Full && <span style={{ opacity: 0.6 }}>(full)</span>}
        </button>
        <button
          type="button"
          onClick={() => setSelectedTier(2)}
          className="px-2.5 py-1 rounded text-xs font-medium transition-all"
          style={selectedTier === 2
            ? { backgroundColor: TAG_TIER_COLORS[2].bg, color: TAG_TIER_COLORS[2].text, border: `1px solid ${TAG_TIER_COLORS[2].border}` }
            : { backgroundColor: "transparent", color: "var(--color-text-muted)", border: "1px solid var(--color-divider)" }
          }
        >
          Tier 2
        </button>
        <span className="text-[10px] ml-auto" style={{ color: "var(--color-text-muted)" }}>
          T1: {tier1Count}/{MAX_TIER1} &middot; T2: {tags.filter((t) => t.tier === 2).length}
        </span>
      </div>

      {/* Combobox input */}
      <div className="relative">
        <div
          className="flex flex-wrap gap-1.5 items-center px-2 py-1.5 rounded-md border min-h-[36px] cursor-text"
          style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}
          onClick={() => inputRef.current?.focus()}
        >
          {sortedTags.map((t) => {
            const c = TAG_TIER_COLORS[t.tier] || TAG_TIER_COLORS[2];
            return (
              <span
                key={`${t.tier}-${t.name}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}
              >
                {t.tier === 1 && <span style={{ opacity: 0.6 }}>★</span>}
                {t.name}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeTag(t.name); }}
                  className="text-xs leading-none opacity-60 hover:opacity-100"
                >&times;</button>
              </span>
            );
          })}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setShowDropdown(true); setHighlightIdx(0); }}
            onFocus={() => { if (input.trim()) setShowDropdown(true); }}
            onBlur={() => { setTimeout(() => setShowDropdown(false), 200); }}
            onKeyDown={handleKeyDown}
            placeholder={tags.length === 0 ? "Type to search or create tags..." : "Add tag..."}
            className="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
            style={{ color: "var(--color-text)" }}
          />
        </div>

        {/* Dropdown suggestions */}
        {showDropdown && (suggestions.length > 0 || (canCreate && !exactMatch)) && (
          <div
            ref={dropdownRef}
            className="absolute z-50 w-full mt-1 rounded-md border shadow-lg py-1 max-h-[200px] overflow-y-auto"
            style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-divider)" }}
          >
            {suggestions.map((s, i) => {
              const sc = TAG_TIER_COLORS[s.tier] || TAG_TIER_COLORS[2];
              return (
                <div
                  key={s.tagId}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs"
                  style={{ backgroundColor: highlightIdx === i ? "var(--color-surface)" : "transparent" }}
                  onMouseDown={(e) => { e.preventDefault(); addTag(s.tagName, selectedTier); }}
                  onMouseEnter={() => setHighlightIdx(i)}
                >
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                    style={{ backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}
                  >
                    T{s.tier}
                  </span>
                  <span style={{ color: "var(--color-text)" }}>{s.tagName}</span>
                </div>
              );
            })}
            {/* Create new option */}
            {canCreate && !exactMatch && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs border-t"
                style={{
                  backgroundColor: highlightIdx === suggestions.length ? "var(--color-surface)" : "transparent",
                  borderColor: "var(--color-divider)",
                }}
                onMouseDown={(e) => { e.preventDefault(); addTag(input.trim(), selectedTier); }}
                onMouseEnter={() => setHighlightIdx(suggestions.length)}
              >
                <span style={{ color: "var(--color-text-muted)" }}>Create</span>
                <span className="font-medium" style={{ color: TAG_TIER_COLORS[selectedTier].text }}>
                  &ldquo;{input.trim()}&rdquo;
                </span>
                <span style={{ color: "var(--color-text-muted)" }}>as Tier {selectedTier}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
