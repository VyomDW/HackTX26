import { z } from "zod";

export const Layout = z.enum(["title", "bullets", "image-left", "image-full", "quote"]);
export type Layout = z.infer<typeof Layout>;

export const TextElement = z.object({
  id: z.string(),
  kind: z.literal("text"),
  text: z.string(),
});

export const ImageElement = z.object({
  id: z.string(),
  kind: z.literal("image"),
  prompt: z.string(),
  /** Undefined while Muse Image is still generating. */
  url: z.string().optional(),
});

export const Element = z.discriminatedUnion("kind", [TextElement, ImageElement]);
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
  elements: z.array(Element),
  citations: z.array(Citation),
});
export type Slide = z.infer<typeof Slide>;

export const Deck = z.object({
  id: z.string(),
  slides: z.array(Slide),
});
export type Deck = z.infer<typeof Deck>;

export const emptyDeck = (id: string): Deck => ({ id, slides: [] });
