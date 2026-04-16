import React, { useState, useEffect, useCallback, useRef } from "react";

/**
 * Wraps a note section (label + FeatureMentionField) with fullscreen toggle.
 * Click the colored dot to enter fullscreen; Escape or X to exit.
 * Includes a smooth scale/fade animation.
 */
export function FullscreenNoteWrapper({
  children,
  label,
  platformColor,
  helperText = "— type ( to reference",
}: {
  children: React.ReactNode;
  label: string;
  platformColor: string;
  helperText?: string;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const open = useCallback(() => {
    setFullscreen(true);
    // Trigger enter animation on next frame
    requestAnimationFrame(() => setAnimating(true));
  }, []);

  const close = useCallback(() => {
    setAnimating(false);
    // Wait for exit animation before unmounting
    setTimeout(() => setFullscreen(false), 200);
  }, []);

  // Escape key handler
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fullscreen, close]);

  if (fullscreen) {
    return (
      <>
        {/* Placeholder to keep layout stable */}
        <div style={{ minHeight: 60 }}>
          <label className="font-semibold mb-1 flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: platformColor, opacity: 0.4 }} />
            {label}
            <span className="text-[10px] font-normal" style={{ color: platformColor, opacity: 0.7 }}>(fullscreen)</span>
          </label>
        </div>
        {/* Fullscreen overlay */}
        <div
          ref={wrapperRef}
          className="fixed inset-0 z-50 flex flex-col"
          style={{
            background: "var(--color-background)",
            opacity: animating ? 1 : 0,
            transform: animating ? "scale(1)" : "scale(0.97)",
            transition: "opacity 200ms ease, transform 200ms ease",
          }}
        >
          {/* Header bar */}
          <div
            className="flex items-center justify-between px-6 py-3 border-b shrink-0"
            style={{ borderColor: "var(--color-divider)", background: "var(--color-surface)" }}
          >
            <label className="font-semibold flex items-center gap-2 text-sm" style={{ color: "var(--color-text)" }}>
              <button
                onClick={close}
                className="inline-block w-3 h-3 rounded-full cursor-pointer transition-all hover:scale-125 hover:ring-2 hover:ring-offset-1"
                style={{ backgroundColor: platformColor, ringColor: platformColor, ringOffsetColor: "var(--color-surface)" }}
                title="Exit fullscreen"
              />
              {label}
              <span className="font-normal text-xs" style={{ opacity: 0.5 }}>{helperText}</span>
            </label>
            <button
              onClick={close}
              className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-white/10 transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title="Exit fullscreen (Esc)"
            >
              ✕
            </button>
          </div>
          {/* Content area — textarea fills remaining space */}
          <div className="flex-1 overflow-auto p-6 fullscreen-note-content">
            {children}
          </div>
        </div>
      </>
    );
  }

  // Normal (non-fullscreen) rendering
  return (
    <div>
      <label className="font-semibold mb-1 flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
        <button
          onClick={open}
          className="inline-block w-2 h-2 rounded-full cursor-pointer transition-all hover:scale-150 hover:ring-2 hover:ring-offset-1"
          style={{ backgroundColor: platformColor, ringColor: platformColor, ringOffsetColor: "var(--color-surface)" }}
          title="Open fullscreen"
        />
        {label}
        <span className="font-normal" style={{ opacity: 0.6 }}>{helperText}</span>
      </label>
      {children}
    </div>
  );
}
