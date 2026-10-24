import { z } from "zod";

/**
 * Every slide is a 1280x720 canvas. Boxes, font sizes, stroke widths and radii are all in these units,
 * and the client scales them to whatever width the slide is drawn at.
 */
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export const Layout = z.enum(["title", "bullets", "image-left", "image-full", "quote", "blank"]);
export type Layout = z.infer<typeof Layout>;

export const Box = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().min(1),
  h: z.number().min(1),
  /** Degrees clockwise. */
  rotate: z.number().optional(),
});
export type Box = z.infer<typeof Box>;

export const Align = z.enum(["left", "center", "right"]);
export const VAlign = z.enum(["top", "middle", "bottom"]);
export const Fit = z.enum(["cover", "contain"]);

export const Style = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().min(0).max(100).optional(),
  opacity: z.number().min(0).max(1).optional(),
  radius: z.number().min(0).optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().min(4).max(400).optional(),
  color: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  align: Align.optional(),
  valign: VAlign.optional(),
  lineHeight: z.number().min(0.5).max(4).optional(),
  fit: Fit.optional(),
});
export type Style = z.infer<typeof Style>;

/** A partial style change; null clears a property back to its default. */
export const StylePatch = z.object({
  fill: z.string().nullable().optional(),
  stroke: z.string().nullable().optional(),
  strokeWidth: z.number().min(0).max(100).nullable().optional(),
  opacity: z.number().min(0).max(1).nullable().optional(),
  radius: z.number().min(0).nullable().optional(),
  fontFamily: z.string().nullable().optional(),
  fontSize: z.number().min(4).max(400).nullable().optional(),
  color: z.string().nullable().optional(),
  bold: z.boolean().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  underline: z.boolean().nullable().optional(),
  strike: z.boolean().nullable().optional(),
  align: Align.nullable().optional(),
  valign: VAlign.nullable().optional(),
  lineHeight: z.number().min(0.5).max(4).nullable().optional(),
  fit: Fit.nullable().optional(),
});
export type StylePatch = z.infer<typeof StylePatch>;

export const ShapeKind = z.enum(["rect", "rounded", "ellipse", "triangle", "diamond", "star", "line", "arrow"]);
export type ShapeKind = z.infer<typeof ShapeKind>;

const base = { id: z.string(), box: Box, style: Style };

export const TextElement = z.object({ ...base, kind: z.literal("text"), text: z.string() });

export const ImageElement = z.object({
  ...base,
  kind: z.literal("image"),
  prompt: z.string(),
  /** Undefined while Muse Image is still generating. */
  url: z.string().optional(),
});

export const ShapeElement = z.object({ ...base, kind: z.literal("shape"), shape: ShapeKind, text: z.string().optional() });

export const Element = z.discriminatedUnion("kind", [TextElement, ImageElement, ShapeElement]);
export type Element = z.infer<typeof Element>;

export const Citation = z.object({
  id: z.string(),
  source: z.string(),
  url: z.string(),
});
export type Citation = z.infer<typeof Citation>;

export const Slide = z.object({
  id: z.string(),
  layout: Layout,
  /** Painted back to front: later elements sit on top. */
  elements: z.array(Element),
  citations: z.array(Citation),
  background: z.string().optional(),
  notes: z.string().optional(),
});
export type Slide = z.infer<typeof Slide>;

export const Deck = z.object({
  id: z.string(),
  slides: z.array(Slide),
});
export type Deck = z.infer<typeof Deck>;

export const emptyDeck = (id: string): Deck => ({ id, slides: [] });

const INK = "#0f172a";
const MUTED = "#64748b";
const BODY = "#334155";
const FONT = "Inter";

/** Where an element lands, and how it looks, when it is created without an explicit box or style. */
export function defaultPlacement(
  layout: Layout,
  role: string,
  kind: Element["kind"],
  existing: number,
): { box: Box; style: Style } {
  const key = `${layout}:${role}`;
  const presets: Record<string, { box: Box; style: Style }> = {
    "title:title": { box: { x: 120, y: 230, w: 1040, h: 140 }, style: { fontSize: 60, bold: true, align: "center", valign: "bottom" } },
    "title:subtitle": { box: { x: 160, y: 390, w: 960, h: 80 }, style: { fontSize: 28, color: MUTED, align: "center" } },
    "bullets:title": { box: { x: 80, y: 60, w: 1120, h: 100 }, style: { fontSize: 44, bold: true, valign: "middle" } },
    "bullets:body": { box: { x: 80, y: 190, w: 1120, h: 470 }, style: { fontSize: 28, color: BODY, lineHeight: 1.6 } },
    "image-left:img": { box: { x: 60, y: 60, w: 560, h: 600 }, style: { radius: 16, fit: "cover" } },
    "image-left:title": { box: { x: 680, y: 90, w: 540, h: 140 }, style: { fontSize: 40, bold: true, valign: "bottom" } },
    "image-left:body": { box: { x: 680, y: 260, w: 540, h: 400 }, style: { fontSize: 24, color: BODY, lineHeight: 1.6 } },
    "image-full:img": { box: { x: 0, y: 0, w: 1280, h: 720 }, style: { fit: "cover" } },
    "image-full:title": { box: { x: 60, y: 540, w: 1160, h: 130 }, style: { fontSize: 52, bold: true, color: "#ffffff", valign: "bottom" } },
    "quote:quote": {
      box: { x: 140, y: 160, w: 1000, h: 300 },
      style: { fontSize: 44, italic: true, fontFamily: "Playfair Display", align: "center", valign: "middle" },
    },
    "quote:attribution": { box: { x: 140, y: 480, w: 1000, h: 60 }, style: { fontSize: 24, color: MUTED, align: "center" } },
  };
  const preset = presets[key];
  if (preset) return { box: { ...preset.box }, style: { fontFamily: FONT, color: INK, ...preset.style } };

  // Cascade loose elements so several new ones don't stack exactly on top of each other.
  const step = (existing % 6) * 24;
  if (kind === "image") return { box: { x: 390 + step, y: 160 + step, w: 500, h: 400 }, style: { radius: 8, fit: "cover" } };
  if (kind === "shape")
    return {
      box: { x: 540 + step, y: 260 + step, w: 200, h: 200 },
      style: { fill: "#8b5cf6", stroke: "#6d28d9", strokeWidth: 0, fontFamily: FONT, fontSize: 24, color: "#ffffff", align: "center", valign: "middle" },
    };
  return { box: { x: 160 + step, y: 300 + step, w: 960, h: 120 }, style: { fontFamily: FONT, fontSize: 28, color: INK } };
}
