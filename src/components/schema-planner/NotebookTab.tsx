import React, { useState, useEffect, useRef, useCallback } from "react";

interface Note {
  id: number;
  title: string;
  content_html: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

const COLORS = ["#ffffff", "#f2b661", "#5bc0de", "#4ecb71", "#a855f7", "#e05555", "#e67d4a", "#428bca"];
const HIGHLIGHTS = ["transparent", "#f2b66140", "#5bc0de40", "#4ecb7140", "#a855f740", "#e0555540"];

export default function NotebookTab() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load notes
  const loadNotes = useCallback(async () => {
    const res = await fetch("/api/notebook");
    const data = await res.json();
    setNotes(data);
    if (data.length > 0 && activeId === null) setActiveId(data[0].id);
  }, [activeId]);

  useEffect(() => { loadNotes(); }, []);

  const activeNote = notes.find((n) => n.id === activeId);

  // Auto-save on content change (debounced 1s)
  const handleInput = useCallback(() => {
    if (!activeId || !editorRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      const html = editorRef.current?.innerHTML || "";
      await fetch(`/api/notebook/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content_html: html }),
      });
      setNotes((prev) => prev.map((n) => n.id === activeId ? { ...n, content_html: html, updated_at: new Date().toISOString() } : n));
      setSaving(false);
    }, 1000);
  }, [activeId]);

  // Update editor content when switching notes
  useEffect(() => {
    if (editorRef.current && activeNote) {
      editorRef.current.innerHTML = activeNote.content_html;
    }
  }, [activeId]);

  // Create new note
  const handleNew = async () => {
    const res = await fetch("/api/notebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    });
    const note = await res.json();
    setNotes((prev) => [note, ...prev]);
    setActiveId(note.id);
  };

  // Delete note
  const handleDelete = async (id: number) => {
    await fetch(`/api/notebook/${id}`, { method: "DELETE" });
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (activeId === id) {
      const remaining = notes.filter((n) => n.id !== id);
      setActiveId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Rename note
  const handleRename = async (id: number, title: string) => {
    await fetch(`/api/notebook/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, title } : n));
  };

  // Formatting commands
  const execCmd = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    handleInput();
  };

  // Paste Conversation — format Claude conversation with alternating colors
  const handlePasteConversation = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;

      // Split on common patterns: "Human:", "Assistant:", "User:", "Claude:"
      const lines = text.split(/\n/);
      let html = "";
      let currentSpeaker: "human" | "assistant" | null = null;
      let buffer: string[] = [];

      const flushBuffer = () => {
        if (buffer.length === 0) return;
        const content = buffer.join("<br>");
        if (currentSpeaker === "human") {
          html += `<div style="background:#428bca20;border-left:3px solid #428bca;padding:8px 12px;margin:4px 0;border-radius:4px"><strong style="color:#428bca">You</strong><br>${content}</div>`;
        } else if (currentSpeaker === "assistant") {
          html += `<div style="background:#a855f720;border-left:3px solid #a855f7;padding:8px 12px;margin:4px 0;border-radius:4px"><strong style="color:#a855f7">Claude</strong><br>${content}</div>`;
        } else {
          html += `<div style="padding:4px 0">${content}</div>`;
        }
        buffer = [];
      };

      for (const line of lines) {
        const humanMatch = line.match(/^(Human|User|Me|H):\s*(.*)/i);
        const assistantMatch = line.match(/^(Assistant|Claude|AI|A):\s*(.*)/i);

        if (humanMatch) {
          flushBuffer();
          currentSpeaker = "human";
          if (humanMatch[2].trim()) buffer.push(humanMatch[2]);
        } else if (assistantMatch) {
          flushBuffer();
          currentSpeaker = "assistant";
          if (assistantMatch[2].trim()) buffer.push(assistantMatch[2]);
        } else {
          buffer.push(line || "<br>");
        }
      }
      flushBuffer();

      // If no speaker patterns found, just paste as plain formatted text
      if (!html.includes("You") && !html.includes("Claude")) {
        html = `<div style="background:#428bca20;border-left:3px solid #428bca;padding:8px 12px;margin:4px 0;border-radius:4px">${text.replace(/\n/g, "<br>")}</div>`;
      }

      document.execCommand("insertHTML", false, html);
      handleInput();
    } catch {
      // Fallback: just paste from clipboard normally
      document.execCommand("paste");
    }
  };

  return (
    <div className="flex h-full gap-0" style={{ minHeight: "calc(100vh - 2rem)" }}>
      {/* Note list sidebar */}
      <div
        className="shrink-0 border-r overflow-y-auto flex flex-col"
        style={{ width: 220, borderColor: "var(--color-divider)", background: "var(--color-surface)" }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--color-divider)" }}>
          <span className="text-sm font-bold" style={{ color: "var(--color-text)" }}>Notes</span>
          <button
            onClick={handleNew}
            className="w-6 h-6 rounded flex items-center justify-center text-sm hover:bg-white/10 transition-colors"
            style={{ color: "var(--color-text-muted)" }}
            title="New note"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => setActiveId(note.id)}
              className="group px-3 py-2 cursor-pointer border-b transition-colors"
              style={{
                borderColor: "var(--color-divider)",
                backgroundColor: activeId === note.id ? "rgba(66,139,202,0.15)" : "transparent",
                borderLeft: activeId === note.id ? "2px solid var(--color-primary)" : "2px solid transparent",
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-medium truncate flex-1"
                  style={{ color: activeId === note.id ? "var(--color-primary)" : "var(--color-text)" }}
                >
                  {note.pinned ? "📌 " : ""}{note.title}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(note.id); }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 text-[10px] rounded hover:bg-white/10 transition-all shrink-0"
                  style={{ color: "var(--color-text-subtle)" }}
                  title="Delete"
                >
                  x
                </button>
              </div>
              <span className="text-[10px] block mt-0.5" style={{ color: "var(--color-text-subtle)" }}>
                {new Date(note.updated_at).toLocaleDateString()}
              </span>
            </div>
          ))}
          {notes.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-xs" style={{ color: "var(--color-text-subtle)" }}>No notes yet</p>
              <button
                onClick={handleNew}
                className="mt-2 px-3 py-1 text-xs rounded transition-colors"
                style={{ backgroundColor: "rgba(66,139,202,0.15)", color: "#428bca" }}
              >
                Create first note
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeNote ? (
          <>
            {/* Title */}
            <div className="px-4 py-2 border-b flex items-center gap-2" style={{ borderColor: "var(--color-divider)" }}>
              <input
                type="text"
                value={activeNote.title}
                onChange={(e) => handleRename(activeNote.id, e.target.value)}
                className="flex-1 text-sm font-bold bg-transparent border-none outline-none"
                style={{ color: "var(--color-text)" }}
                placeholder="Note title..."
              />
              {saving && (
                <span className="text-[10px] shrink-0" style={{ color: "var(--color-text-subtle)" }}>Saving...</span>
              )}
            </div>

            {/* Toolbar */}
            <div
              className="px-3 py-1.5 border-b flex items-center gap-1 flex-wrap"
              style={{ borderColor: "var(--color-divider)", background: "var(--color-surface)" }}
            >
              <button onClick={() => execCmd("bold")} className="px-2 py-1 text-xs font-bold rounded hover:bg-white/10" style={{ color: "var(--color-text)" }} title="Bold">B</button>
              <button onClick={() => execCmd("italic")} className="px-2 py-1 text-xs italic rounded hover:bg-white/10" style={{ color: "var(--color-text)" }} title="Italic">I</button>
              <button onClick={() => execCmd("underline")} className="px-2 py-1 text-xs underline rounded hover:bg-white/10" style={{ color: "var(--color-text)" }} title="Underline">U</button>
              <button onClick={() => execCmd("strikeThrough")} className="px-2 py-1 text-xs line-through rounded hover:bg-white/10" style={{ color: "var(--color-text)" }} title="Strikethrough">S</button>

              <span className="w-px h-4 mx-1" style={{ background: "var(--color-divider)" }} />

              {/* Text color */}
              <span className="text-[10px] mr-1" style={{ color: "var(--color-text-subtle)" }}>Color:</span>
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => execCmd("foreColor", c)}
                  className="w-4 h-4 rounded-full border hover:scale-125 transition-transform"
                  style={{ backgroundColor: c, borderColor: "var(--color-divider)" }}
                  title={c}
                />
              ))}

              <span className="w-px h-4 mx-1" style={{ background: "var(--color-divider)" }} />

              {/* Highlight */}
              <span className="text-[10px] mr-1" style={{ color: "var(--color-text-subtle)" }}>Highlight:</span>
              {HIGHLIGHTS.map((c, i) => (
                <button
                  key={c}
                  onClick={() => execCmd("hiliteColor", c)}
                  className="w-4 h-4 rounded border hover:scale-125 transition-transform"
                  style={{ backgroundColor: c || "transparent", borderColor: "var(--color-divider)" }}
                  title={i === 0 ? "None" : c}
                />
              ))}

              <span className="w-px h-4 mx-1" style={{ background: "var(--color-divider)" }} />

              <button onClick={() => execCmd("insertUnorderedList")} className="px-2 py-1 text-xs rounded hover:bg-white/10" style={{ color: "var(--color-text)" }} title="Bullet list">List</button>
              <button onClick={() => execCmd("removeFormat")} className="px-2 py-1 text-[10px] rounded hover:bg-white/10" style={{ color: "var(--color-text-muted)" }} title="Clear formatting">Clear</button>

              <span className="w-px h-4 mx-1" style={{ background: "var(--color-divider)" }} />

              <button
                onClick={handlePasteConversation}
                className="px-2 py-1 text-[10px] rounded hover:bg-white/10 transition-colors"
                style={{ backgroundColor: "rgba(168,85,247,0.15)", color: "#a855f7" }}
                title="Paste a Claude conversation from clipboard and auto-format it"
              >
                Paste Conversation
              </button>
            </div>

            {/* Content editable */}
            <div
              ref={editorRef}
              contentEditable
              onInput={handleInput}
              className="flex-1 px-4 py-3 overflow-y-auto outline-none text-sm leading-relaxed"
              style={{ color: "var(--color-text)", minHeight: 300 }}
              suppressContentEditableWarning
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm mb-3" style={{ color: "var(--color-text-muted)" }}>No note selected</p>
              <button
                onClick={handleNew}
                className="px-4 py-2 text-xs rounded font-medium transition-colors"
                style={{ backgroundColor: "rgba(66,139,202,0.15)", color: "#428bca" }}
              >
                Create a note
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
