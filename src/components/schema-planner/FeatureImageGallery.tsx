

import React, { useState, useCallback } from "react";
import { uploadImage as apiUploadImage } from "@/lib/api";

interface FeatureImage { id: string; url: string; title: string; createdAt: string }

function FeatureImageGallery({
  images,
  featureId,
  entityType,
  onUpdate,
}: {
  images: FeatureImage[];
  featureId: number;
  entityType?: string;
  onUpdate: (images: FeatureImage[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const { url } = await apiUploadImage(featureId, file, entityType);
      const newImg: FeatureImage = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url,
        title: file.name.replace(/\.[^.]+$/, "") || "Untitled",
        createdAt: new Date().toISOString(),
      };
      onUpdate([...images, newImg]);
    } catch (err) {
      console.error("Image upload error:", err);
      alert("Image upload failed");
    } finally {
      setUploading(false);
    }
  }, [featureId, images, onUpdate]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadImage(file);
        return;
      }
    }
  }, [uploadImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.[0]?.type.startsWith("image/")) uploadImage(files[0]);
  }, [uploadImage]);

  const updateTitle = useCallback((id: string, title: string) => {
    onUpdate(images.map((img) => img.id === id ? { ...img, title } : img));
  }, [images, onUpdate]);

  const removeImage = useCallback((id: string) => {
    onUpdate(images.filter((img) => img.id !== id));
  }, [images, onUpdate]);

  return (
    <div>
      <label className="font-semibold block mb-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
        Images {images.length > 0 && <span className="font-mono ml-1 px-1 rounded" style={{ backgroundColor: "var(--color-divider)", fontSize: "10px" }}>{images.length}</span>}
      </label>

      {/* Thumbnail gallery */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-2">
          {images.map((img) => (
            <div key={img.id} className="group relative" style={{ width: 120 }}>
              <div
                className="w-full h-20 rounded-md border overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)" }}
                onClick={() => setLightboxUrl(img.url)}
              >
                <img src={img.url} alt={img.title} className="w-full h-full object-cover" />
              </div>
              <input
                type="text"
                value={img.title}
                onChange={(e) => updateTitle(img.id, e.target.value)}
                className="w-full mt-1 px-1 py-0.5 text-[10px] rounded border focus:outline-none focus:ring-1 truncate"
                style={{ borderColor: "var(--color-divider)", backgroundColor: "var(--color-surface)", color: "var(--color-text)" }}
                placeholder="Image title..."
              />
              <button
                onClick={() => removeImage(img.id)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ backgroundColor: "#e05555", color: "#fff" }}
                title="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Paste / drop zone */}
      <div
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        tabIndex={0}
        className="rounded-md border-2 border-dashed px-4 py-3 text-center cursor-pointer transition-colors focus:outline-none focus:ring-1"
        style={{
          borderColor: dragOver ? "var(--color-primary)" : "var(--color-divider)",
          backgroundColor: dragOver ? "rgba(var(--color-primary-rgb, 100,100,100), 0.05)" : "transparent",
          color: "var(--color-text-muted)",
        }}
        onClick={(e) => {
          // Single click → focus for paste
          (e.currentTarget as HTMLElement).focus();
        }}
        onDoubleClick={() => {
          // Double click → open file picker
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.onchange = () => { if (input.files?.[0]) uploadImage(input.files[0]); };
          input.click();
        }}
      >
        {uploading ? (
          <span className="text-xs">Uploading...</span>
        ) : (
          <span className="text-xs">Paste or drop an image · double-click to browse files</span>
        )}
      </div>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-white text-lg"
            style={{ backgroundColor: "rgba(255,255,255,0.2)" }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default FeatureImageGallery;
