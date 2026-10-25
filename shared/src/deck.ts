import { z } from "zod";
import { ThemeId, THEMES, type DeckTheme } from "./themes";

/**
 * Every slide is a 1280x720 canvas. Boxes, font sizes, stroke widths and radii are all in these units,
 * and the client scales them to whatever width the slide is drawn at.
 */
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export const Layout = z.enum(["title", "bullets", "image-left", "image-full", "quote", "section", "stats", "columns", "timeline", "blank"]);
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
  kind: z.literal("slides"),
  id: z.string(),
  title: z.string(),
  /** Unset means the classic theme. */
  theme: ThemeId.optional(),
  slides: z.array(Slide),
});
export type Deck = z.infer<typeof Deck>;

export const emptyDeck = (id: string): Deck => ({ kind: "slides", id, title: "Untitled presentation", slides: [] });

/** Where an element lands, and how it looks, when it is created without an explicit box or style. */
export function defaultPlacement(
  layout: Layout,
  role: string,
  kind: Element["kind"],
  existing: number,
  theme: DeckTheme = THEMES.classic,
): { box: Box; style: Style } {
  const t = theme;
  const title = (fontSize: number, extra: Style = {}): Style => ({ fontFamily: t.titleFont, fontSize, bold: true, color: t.ink, ...extra });
  const body = (fontSize: number, extra: Style = {}): Style => ({ fontFamily: t.bodyFont, fontSize, color: t.body, lineHeight: 1.6, ...extra });
  const presets: Record<string, { box: Box; style: Style }> = {
    "title:title": { box: { x: 120, y: 230, w: 1040, h: 140 }, style: title(60, { align: "center", valign: "bottom" }) },
    "title:subtitle": { box: { x: 160, y: 390, w: 960, h: 80 }, style: body(28, { color: t.muted, align: "center", lineHeight: 1.3 }) },
    "title:img": { box: { x: 900, y: 500, w: 340, h: 190 }, style: { radius: 8, fit: "cover" } },
    "bullets:title": { box: { x: 80, y: 60, w: 1120, h: 100 }, style: title(44, { valign: "middle" }) },
    "bullets:body": { box: { x: 80, y: 190, w: 1120, h: 470 }, style: body(28) },
    "image-left:img": { box: { x: 60, y: 60, w: 560, h: 600 }, style: { radius: 16, fit: "cover" } },
    "image-left:title": { box: { x: 680, y: 90, w: 540, h: 140 }, style: title(40, { valign: "bottom" }) },
    "image-left:body": { box: { x: 680, y: 260, w: 540, h: 400 }, style: body(24) },
    "image-full:img": { box: { x: 0, y: 0, w: 1280, h: 720 }, style: { fit: "cover" } },
    "image-full:title": { box: { x: 60, y: 540, w: 1160, h: 130 }, style: title(52, { color: "#ffffff", valign: "bottom" }) },
    "quote:quote": { box: { x: 140, y: 160, w: 1000, h: 300 }, style: { fontFamily: t.quoteFont, fontSize: 44, italic: true, color: t.ink, align: "center", valign: "middle" } },
    "quote:attribution": { box: { x: 140, y: 480, w: 1000, h: 60 }, style: body(24, { color: t.muted, align: "center", lineHeight: 1.3 }) },
    // Section divider: a small accent kicker over a big statement.
    "section:kicker": { box: { x: 120, y: 220, w: 1040, h: 50 }, style: body(22, { color: t.accent, bold: true, lineHeight: 1.2 }) },
    "section:title": { box: { x: 120, y: 280, w: 1040, h: 180 }, style: title(72, { valign: "middle", lineHeight: 1.1 }) },
    "section:subtitle": { box: { x: 120, y: 470, w: 1040, h: 70 }, style: body(26, { color: t.muted, lineHeight: 1.3 }) },
    "stats:title": { box: { x: 80, y: 60, w: 1120, h: 100 }, style: title(44, { valign: "middle" }) },
    "columns:title": { box: { x: 80, y: 60, w: 1120, h: 100 }, style: title(44, { valign: "middle" }) },
    "columns:leftHead": { box: { x: 80, y: 190, w: 540, h: 60 }, style: title(30, { color: t.accent }) },
    "columns:left": { box: { x: 80, y: 260, w: 540, h: 400 }, style: body(24) },
    "columns:rightHead": { box: { x: 660, y: 190, w: 540, h: 60 }, style: title(30, { color: t.accent }) },
    "columns:right": { box: { x: 660, y: 260, w: 540, h: 400 }, style: body(24) },
    "timeline:title": { box: { x: 80, y: 60, w: 1120, h: 100 }, style: title(44, { valign: "middle" }) },
    "timeline:line": { box: { x: 80, y: 262, w: 1120, h: 6 }, style: { fill: t.accent, strokeWidth: 0, radius: 3 } },
  };
  // Stats: three big numbers with a label under each.
  for (let i = 1; i <= 3; i++) {
    const x = 80 + (i - 1) * 380;
    presets[`stats:stat${i}`] = { box: { x, y: 220, w: 340, h: 150 }, style: title(80, { color: t.accent, valign: "bottom", lineHeight: 1 }) };
    presets[`stats:label${i}`] = { box: { x, y: 390, w: 340, h: 200 }, style: body(24, { lineHeight: 1.4 }) };
  }
  // Timeline: four steps hanging off an accent line.
  for (let i = 1; i <= 4; i++) {
    const x = 80 + (i - 1) * 290;
    presets[`timeline:step${i}`] = { box: { x, y: 290, w: 260, h: 60 }, style: title(26, { color: t.accent }) };
    presets[`timeline:detail${i}`] = { box: { x, y: 356, w: 260, h: 280 }, style: body(20, { lineHeight: 1.5 }) };
  }
  const preset = presets[`${layout}:${role}`];
  if (preset) return { box: { ...preset.box }, style: { ...preset.style } };

  // Cascade loose elements so several new ones don't stack exactly on top of each other.
  const step = (existing % 6) * 24;
  if (kind === "image") return { box: { x: 390 + step, y: 160 + step, w: 500, h: 400 }, style: { radius: 8, fit: "cover" } };
  if (kind === "shape")
    return {
      box: { x: 540 + step, y: 260 + step, w: 200, h: 200 },
      style: { fill: t.accent, stroke: t.accent, strokeWidth: 0, fontFamily: t.bodyFont, fontSize: 24, color: t.accentInk, align: "center", valign: "middle" },
    };
  return { box: { x: 160 + step, y: 300 + step, w: 960, h: 120 }, style: { fontFamily: t.bodyFont, fontSize: 28, color: t.ink } };
}
