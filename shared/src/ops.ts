import { z } from "zod";
import { Box, Element, Layout, ShapeKind, Slide, Style, StylePatch } from "./deck";

/**
 * Operations the model may emit, one JSON object per line. Users send the same ops from the editor.
 * This is the contract between client and server: change it only after telling the other role.
 */
export const AddSlide = z.object({
  type: z.literal("add_slide"),
  id: z.string(),
  layout: Layout,
  afterId: z.string().optional(),
});
/** Creates the text element if missing (at its layout default unless box/style are given), otherwise replaces its text. */
export const SetText = z.object({
  type: z.literal("set_text"),
  slideId: z.string(),
  elementId: z.string(),
  text: z.string(),
  box: Box.optional(),
  style: Style.optional(),
});
/** Without a url the image is generated from the prompt; with one it is placed directly (uploads). */
export const AddImage = z.object({
  type: z.literal("add_image"),
  slideId: z.string(),
  elementId: z.string(),
  prompt: z.string(),
  url: z.string().optional(),
  box: Box.optional(),
  style: Style.optional(),
});
export const AddShape = z.object({
  type: z.literal("add_shape"),
  slideId: z.string(),
  elementId: z.string(),
  shape: ShapeKind,
  text: z.string().optional(),
  box: Box.optional(),
  style: Style.optional(),
});
export const SetImageUrl = z.object({
  type: z.literal("set_image_url"),
  slideId: z.string(),
  elementId: z.string(),
  url: z.string(),
});
/** Moves, resizes or rotates an element; omitted fields keep their current value. */
export const SetBox = z.object({
  type: z.literal("set_box"),
  slideId: z.string(),
  elementId: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().min(1).optional(),
  h: z.number().min(1).optional(),
  rotate: z.number().optional(),
});
export const SetStyle = z.object({
  type: z.literal("set_style"),
  slideId: z.string(),
  elementId: z.string(),
  style: StylePatch,
});
/** Changes stacking order: 0 is the back, the last index is the front. */
export const ReorderElement = z.object({
  type: z.literal("reorder_element"),
  slideId: z.string(),
  elementId: z.string(),
  toIndex: z.number().int().min(0),
});
export const SetSlide = z.object({
  type: z.literal("set_slide"),
  slideId: z.string(),
  background: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export const DuplicateSlide = z.object({
  type: z.literal("duplicate_slide"),
  slideId: z.string(),
  newId: z.string(),
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
  AddShape,
  SetImageUrl,
  SetBox,
  SetStyle,
  ReorderElement,
  SetSlide,
  DuplicateSlide,
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

/** What the editor may send directly: everything the model can do, plus pasting a whole element. */
export const UserOp = z.discriminatedUnion("type", [...ModelOp.options, InsertElement]);
export type UserOp = z.infer<typeof UserOp>;

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
  /** The prompt turn that produced this op, so a whole AI response can be undone at once. */
  turnId: z.string().optional(),
});
export type OpEnvelope = z.infer<typeof OpEnvelope>;
