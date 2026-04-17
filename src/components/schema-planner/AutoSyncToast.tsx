import React, { useEffect, useState } from "react";

export interface AutoSyncToastProps {
  message: string;
  // Bumped each time a new toast should appear; same key = no replay
  toastKey: number;
  durationMs?: number;
}

export default function AutoSyncToast({ message, toastKey, durationMs = 5000 }: AutoSyncToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(t);
  }, [toastKey, message, durationMs]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 100,
        padding: "10px 14px",
        borderRadius: 6,
        backgroundColor: "rgba(78,203,113,0.18)",
        border: "1px solid rgba(78,203,113,0.45)",
        color: "#4ecb71",
        fontSize: 12,
        fontWeight: 500,
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-8px)",
        transition: "opacity 200ms ease, transform 200ms ease",
        pointerEvents: "none",
        maxWidth: 360,
      }}
    >
      {message}
    </div>
  );
}
