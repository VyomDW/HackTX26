import { z } from "zod";
import { Element, Layout, Slide } from "./deck";

/**
 * Operations the model may emit, one JSON object per line.
 * This is the contract between client and server: change it only after telling the other role.
 */
export const AddSlide = z.object({
  type: z.literal("add_slide"),
  id: z.string(),
  layout: Layout,
  afterId: z.string().optional(),
});
export const SetText = z.object({
  type: z.literal("set_text"),
  slideId: z.string(),
  elementId: z.string(),
  text: z.string(),
});
export const AddImage = z.object({
  type: z.literal("add_image"),
  slideId: z.string(),
  elementId: z.string(),
  prompt: z.string(),
});
export const SetImageUrl = z.object({
  type: z.literal("set_image_url"),
  slideId: z.string(),
  elementId: z.string(),
  url: z.string(),
});
export const AddCitation = z.object({
  type: z.literal("add_citation"),
  slideId: z.string(),
  source: z.string(),
  url: z.string(),
  id: z.string().optional(),
});
export const DeleteElement = z.object({
  type: z.literal("delete_element"),
  slideId: z.string(),
  elementId: z.string(),
});
export const DeleteSlide = z.object({
  type: z.literal("delete_slide"),
  slideId: z.string(),
});
export const ReorderSlide = z.object({
  type: z.literal("reorder_slide"),
  slideId: z.string(),
  toIndex: z.number().int().min(0),
});
export const Focus = z.object({
  type: z.literal("focus"),
  slideId: z.string(),
  elementId: z.string().optional(),
});

/** What Muse Spark is allowed to emit. */
export const ModelOp = z.discriminatedUnion("type", [
  AddSlide,
  SetText,
  AddImage,
  SetImageUrl,
  AddCitation,
  DeleteElement,
  DeleteSlide,
  ReorderSlide,
  Focus,
]);
export type ModelOp = z.infer<typeof ModelOp>;

/** Server-only ops, produced as inverses so that undo is just another operation. */
export const InsertSlide = z.object({
  type: z.literal("insert_slide"),
  slide: Slide,
  index: z.number().int().min(0),
});
export const InsertElement = z.object({
  type: z.literal("insert_element"),
  slideId: z.string(),
  element: Element,
  index: z.number().int().min(0),
});
export const RemoveCitation = z.object({
  type: z.literal("remove_citation"),
  slideId: z.string(),
  citationId: z.string(),
});
export const Noop = z.object({ type: z.literal("noop") });

export const Op = z.discriminatedUnion("type", [
  ...ModelOp.options,
  InsertSlide,
  InsertElement,
  RemoveCitation,
  Noop,
]);
export type Op = z.infer<typeof Op>;

export const Actor = z.union([z.literal("ai"), z.string()]);

export const OpEnvelope = z.object({
  opId: z.string(),
  actor: Actor,
  ts: z.number(),
  op: Op,
  /** Set when this envelope undoes an earlier one. */
  undoes: z.string().optional(),
});
export type OpEnvelope = z.infer<typeof OpEnvelope>;
