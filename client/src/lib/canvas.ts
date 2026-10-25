import { createElement, Fragment, type ReactNode } from "react";
import { CANVAS_H, CANVAS_W, type Box, type Deck, type Slide } from "@hacktx/shared";

/** Canvas units to CSS: slides are container-query sized, so 1280 units is always 100cqw. */
export const u = (n: number) => `${(n / CANVAS_W) * 100}cqw`;

export const FONTS = ["Inter", "Poppins", "Montserrat", "Playfair Display", "Lora", "Merriweather", "Oswald", "Roboto Mono"];

export const FONT_SIZES = [12, 14, 18, 20, 24, 28, 32, 36, 44, 52, 60, 72, 96, 120];

export const SWATCHES = [
  "#000000", "#434343", "#666666", "#999999", "#cccccc", "#efefef", "#ffffff",
  "#0f172a", "#334155", "#64748b", "#e11d48", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#fde68a", "#bbf7d0",
  "#bfdbfe", "#ddd6fe", "#fbcfe8", "#fee2e2", "#7c2d12", "#14532d", "#1e3a8a",
];

export const shortId = () => Math.random().toString(36).slice(2, 6);

/** Next free "sN" slide id, matching the numbering the AI is told to continue. */
export function nextSlideId(deck: Deck) {
  const max = Math.max(0, ...deck.slides.map((s) => Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0)));
  return `s${max + 1}`;
}

export const newElementId = (slide: Slide, role: string) => `${slide.id}-${role}-${shortId()}`;

/** Renders **bold** and *italic* markers inside plain text. */
export function richText(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return createElement("strong", { key: i }, part.slice(2, -2));
      if (/^\*[^*]+\*$/.test(part)) return createElement("em", { key: i }, part.slice(1, -1));
      return part;
    }),
  );
}

export const toggleBullets = (text: string) => {
  const lines = text.split("\n");
  const on = lines.every((l) => !l.trim() || l.startsWith("• "));
  return lines.map((l) => (on ? l.replace(/^• /, "") : l.trim() ? `• ${l}` : l)).join("\n");
};

const MAX_UPLOAD_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_DATA_URL_CHARS = 8 * 1024 * 1024;

/** Reads and compresses images so the base64 payload stays comfortably below the WebSocket limit. */
export async function fileToDataUrl(file: File, maxDim = 1600): Promise<{ url: string; width: number; height: number }> {
  if (file.size > MAX_UPLOAD_SOURCE_BYTES) throw new Error("Image file is over the 100 MB upload limit.");
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("not an image"));
    el.src = original;
  });
  const { naturalWidth: w, naturalHeight: h } = img;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  // Small files and modest GIFs can keep their original encoding and animation.
  if ((scale === 1 && file.size < 1_500_000) || (file.type === "image/gif" && file.size <= 6_000_000)) {
    return { url: original, width: w, height: h };
  }

  let width = Math.max(1, Math.round(w * scale));
  let height = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser couldn't prepare this image.");

  for (let attempt = 0; attempt < 10; attempt++) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(img, 0, 0, width, height);

    // WebP is compact and retains transparent backgrounds. PNG is the fallback for
    // browsers without WebP canvas encoding; its dimensions shrink until it fits.
    const encoded = canvas.toDataURL("image/webp", Math.max(0.58, 0.88 - attempt * 0.045));
    const url = encoded.startsWith("data:image/webp,")
      ? encoded
      : canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.78);
    if (url.length <= MAX_UPLOAD_DATA_URL_CHARS) return { url, width, height };

    width = Math.max(1, Math.floor(width * 0.82));
    height = Math.max(1, Math.floor(height * 0.82));
  }
  throw new Error("This image couldn't be compressed enough to upload. Try a smaller image.");
}

/** Fits an image of the given size into the canvas, centred on a point. */
export function imageBox(width: number, height: number, center = { x: CANVAS_W / 2, y: CANVAS_H / 2 }): Box {
  const scale = Math.min(640 / width, 480 / height, 1);
  const w = Math.max(40, Math.round(width * scale));
  const h = Math.max(40, Math.round(height * scale));
  return { x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h };
}
