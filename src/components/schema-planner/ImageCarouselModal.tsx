import React, { useState, useCallback, useEffect, useRef } from "react";
import { uploadImage as apiUploadImage } from "@/lib/api";

interface CarouselImage {
  id: string;
  url: string;
  title: string;
  createdAt: string;
}

export function ImageCarouselModal({
  images,
  entityId,
  entityType,
  entityName,
  onUpdate,
  onClose,
}: {
  images: CarouselImage[];
  entityId: number;
  entityType: string;
  entityName: string;
  onUpdate: (images: CarouselImage[]) => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState({ x: 50, y: 50 }); // percentage
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  const idx = images.length > 0 ? Math.min(current, images.length - 1) : 0;

  // Reset zoom when switching images
  useEffect(() => {
    setZoom(1);
    setOrigin({ x: 50, y: 50 });
  }, [idx]);

  // Keyboard: Escape, arrows
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (zoom > 1) { setZoom(1); setOrigin({ x: 50, y: 50 }); }
        else onClose();
      }
      if (e.key === "ArrowLeft" && images.length > 1) setCurrent((c) => (c - 1 + images.length) % images.length);
      if (e.key === "ArrowRight" && images.length > 1) setCurrent((c) => (c + 1) % images.length);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, images.length, zoom]);

  // Double-click to zoom at point
  const handleImageDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = imgContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    if (zoom === 1) {
      setOrigin({ x, y });
      setZoom(2.5);
    } else {
      setZoom(1);
      setOrigin({ x: 50, y: 50 });
    }
  }, [zoom]);

  // Scroll wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!imgContainerRef.current) return;
    e.preventDefault();
    const rect = imgContainerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setZoom((prev) => {
      const next = prev + (e.deltaY < 0 ? 0.3 : -0.3);
      const clamped = Math.max(1, Math.min(5, next));
      if (clamped === 1) setOrigin({ x: 50, y: 50 });
      else setOrigin({ x, y });
      return clamped;
    });
  }, []);

  const upload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const { url } = await apiUploadImage(entityId, file, entityType);
      const newImg: CarouselImage = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url,
        title: file.name.replace(/\.[^.]+$/, "") || "Untitled",
        createdAt: new Date().toISOString(),
      };
      const updated = [...images, newImg];
      onUpdate(updated);
      setCurrent(updated.length - 1);
    } catch (err) {
      console.error("Image upload error:", err);
      alert("Image upload failed");
    } finally {
      setUploading(false);
    }
  }, [entityId, entityType, images, onUpdate]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) upload(file);
        return;
      }
    }
  }, [upload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  }, [upload]);

  const deleteImage = useCallback((index: number) => {
    const updated = images.filter((_, i) => i !== index);
    onUpdate(updated);
    if (current >= updated.length) setCurrent(Math.max(0, updated.length - 1));
  }, [images, current, onUpdate]);

  const renameImage = useCallback((index: number, title: string) => {
    const updated = images.map((img, i) => i === index ? { ...img, title } : img);
    onUpdate(updated);
    setEditingTitle(null);
  }, [images, onUpdate]);

  const img = images[idx];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={() => { if (zoom > 1) { setZoom(1); setOrigin({ x: 50, y: 50 }); } else onClose(); }}
      onPaste={handlePaste}
    >
      <div
        className="flex flex-col rounded-lg overflow-hidden"
        style={{
          width: 1350,
          maxWidth: "95vw",
          maxHeight: "92vh",
          background: "var(--color-surface)",
          border: "1px solid var(--color-divider)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-3"
          style={{ borderColor: "var(--color-divider)" }}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-sm font-semibold shrink-0" style={{ color: "var(--color-text)" }}>
              {entityName} — Images
              {images.length > 0 && (
                <span className="font-normal ml-2" style={{ color: "var(--color-text-muted)" }}>
                  {idx + 1} of {images.length}
                </span>
              )}
            </span>
            {img && (
              editingTitle === idx ? (
                <input
                  type="text"
                  autoFocus
                  defaultValue={img.title}
                  className="text-sm font-bold px-3 py-1 rounded border-2 min-w-0 flex-1"
                  style={{
                    background: "var(--color-background)",
                    color: "var(--color-text)",
                    borderColor: "#5bc0de",
                    maxWidth: 350,
                    outline: "none",
                    boxShadow: "0 0 0 2px rgba(91,192,222,0.25)",
                  }}
                  onBlur={(e) => renameImage(idx, e.target.value || "Untitled")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") renameImage(idx, (e.target as HTMLInputElement).value || "Untitled");
                    if (e.key === "Escape") setEditingTitle(null);
                  }}
                />
              ) : (
                <span
                  className="text-sm font-bold truncate cursor-pointer rounded px-3 py-1 transition-colors hover:bg-white/5"
                  style={{
                    color: "#5bc0de",
                    border: "1px solid var(--color-divider)",
                    maxWidth: 350,
                  }}
                  onClick={() => setEditingTitle(idx)}
                  title="Click to rename"
                >
                  {img.title}
                </span>
              )
            )}
            {/* Zoom indicator */}
            {zoom > 1 && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ color: "var(--color-text-muted)", background: "var(--color-background)" }}>
                {Math.round(zoom * 100)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {img && (
              <button
                className="text-xs px-2 py-1 rounded hover:bg-red-500/20 transition-colors"
                style={{ color: "#e05555" }}
                onClick={() => {
                  if (confirm(`Delete "${img.title}"?`)) deleteImage(idx);
                }}
              >
                Delete
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-white/10 transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Carousel area */}
        <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden" style={{ minHeight: 525 }}>
          {images.length > 0 && img ? (
            <>
              {/* Image container with zoom */}
              <div
                ref={imgContainerRef}
                className="flex-1 flex items-center justify-center w-full overflow-hidden"
                style={{ cursor: zoom > 1 ? "zoom-out" : "zoom-in", padding: zoom > 1 ? 0 : 16 }}
                onDoubleClick={handleImageDoubleClick}
                onWheel={handleWheel}
              >
                <img
                  src={img.url}
                  alt={img.title}
                  className="max-w-full max-h-full object-contain rounded select-none"
                  draggable={false}
                  style={{
                    maxHeight: zoom > 1 ? "none" : "calc(92vh - 280px)",
                    transform: `scale(${zoom})`,
                    transformOrigin: `${origin.x}% ${origin.y}%`,
                    transition: "transform 0.25s ease, transform-origin 0.25s ease",
                  }}
                />
              </div>

              {/* Left arrow */}
              {images.length > 1 && zoom === 1 && (
                <button
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all hover:scale-110"
                  style={{ background: "rgba(0,0,0,0.5)", color: "#fff" }}
                  onClick={() => setCurrent((c) => (c - 1 + images.length) % images.length)}
                  title="Previous (←)"
                >
                  ‹
                </button>
              )}

              {/* Right arrow */}
              {images.length > 1 && zoom === 1 && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all hover:scale-110"
                  style={{ background: "rgba(0,0,0,0.5)", color: "#fff" }}
                  onClick={() => setCurrent((c) => (c + 1) % images.length)}
                  title="Next (→)"
                >
                  ›
                </button>
              )}

              {/* Dot indicators */}
              {images.length > 1 && zoom === 1 && (
                <div className="flex items-center gap-1.5 pb-3">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      className="rounded-full transition-all"
                      style={{
                        width: i === idx ? 10 : 7,
                        height: i === idx ? 10 : 7,
                        background: i === idx ? "#5bc0de" : "var(--color-text-muted)",
                        opacity: i === idx ? 1 : 0.4,
                      }}
                      onClick={() => setCurrent(i)}
                      title={images[i].title}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12" style={{ color: "var(--color-text-muted)" }}>
              <span className="text-3xl mb-2">🖼</span>
              <span className="text-sm">No images yet</span>
            </div>
          )}
        </div>

        {/* Upload zone */}
        {zoom === 1 && (
          <div
            ref={dropRef}
            className="mx-4 mb-4 border-2 border-dashed rounded-lg flex items-center justify-center py-3 transition-colors cursor-pointer"
            style={{
              borderColor: "var(--color-divider)",
              color: "var(--color-text-muted)",
            }}
            onDragOver={(e) => { e.preventDefault(); if (dropRef.current) dropRef.current.style.borderColor = "#5bc0de"; }}
            onDragLeave={() => { if (dropRef.current) dropRef.current.style.borderColor = ""; }}
            onDrop={(e) => { handleDrop(e); if (dropRef.current) dropRef.current.style.borderColor = ""; }}
            onDoubleClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
            />
            <span className="text-xs">
              {uploading ? "Uploading..." : "Paste or drop an image · double-click to browse files"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImageCarouselModal;
