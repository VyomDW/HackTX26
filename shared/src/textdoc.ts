import { z } from "zod";
import { Align } from "./deck";

/** A Word / Google Docs style document: an ordered list of blocks with inline **bold**, *italic*, `code` and [links](url). */
export const BlockType = z.enum(["h1", "h2", "h3", "p", "bullet", "numbered", "todo", "quote", "code", "callout", "divider", "image"]);
export type BlockType = z.infer<typeof BlockType>;

export const Block = z.object({
  id: z.string(),
  type: BlockType,
  text: z.string(),
  checked: z.boolean().optional(),
  align: Align.optional(),
  /** Nesting level for lists. */
  indent: z.number().int().min(0).max(4).optional(),
  /** Image source for image blocks. */
  url: z.string().optional(),
});
export type Block = z.infer<typeof Block>;

export const TextDoc = z.object({
  kind: z.literal("doc"),
  id: z.string(),
  title: z.string(),
  blocks: z.array(Block),
});
export type TextDoc = z.infer<typeof TextDoc>;

export const emptyTextDoc = (id: string): TextDoc => ({ kind: "doc", id, title: "Untitled document", blocks: [] });

/** afterId: null puts the block first, omitted appends it at the end. */
export const InsertBlock = z.object({
  type: z.literal("insert_block"),
  id: z.string(),
  afterId: z.string().nullable().optional(),
  blockType: BlockType,
  text: z.string(),
  checked: z.boolean().optional(),
  align: Align.optional(),
  indent: z.number().int().min(0).max(4).optional(),
  url: z.string().optional(),
});
export const SetBlock = z.object({
  type: z.literal("set_block"),
  id: z.string(),
  text: z.string().optional(),
  blockType: BlockType.optional(),
  checked: z.boolean().optional(),
  align: Align.nullable().optional(),
  indent: z.number().int().min(0).max(4).optional(),
  url: z.string().nullable().optional(),
});
export const DeleteBlock = z.object({ type: z.literal("delete_block"), id: z.string() });
export const MoveBlock = z.object({ type: z.literal("move_block"), id: z.string(), afterId: z.string().nullable() });
/** Server-only inverse of delete_block: puts the exact block back. */
export const RestoreBlock = z.object({ type: z.literal("restore_block"), block: Block, afterId: z.string().nullable() });

export const DOC_OPS = ["insert_block", "set_block", "delete_block", "move_block", "restore_block"] as const;
