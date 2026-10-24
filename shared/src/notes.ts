import { z } from "zod";

/** A notes app (Apple Notes / Keep style): markdown notes with checklists, tags, colors and pinning. */
export const Note = z.object({
  id: z.string(),
  title: z.string(),
  /** Markdown; "- [ ] item" lines are checklists. */
  body: z.string(),
  pinned: z.boolean().optional(),
  color: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type Note = z.infer<typeof Note>;

export const Notebook = z.object({
  kind: z.literal("notes"),
  id: z.string(),
  title: z.string(),
  /** Newest first. */
  notes: z.array(Note),
});
export type Notebook = z.infer<typeof Notebook>;

export const emptyNotebook = (id: string): Notebook => ({ kind: "notes", id, title: "Untitled notebook", notes: [] });

export const AddNote = z.object({
  type: z.literal("add_note"),
  id: z.string(),
  title: z.string(),
  body: z.string(),
  pinned: z.boolean().optional(),
  color: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export const SetNote = z.object({
  type: z.literal("set_note"),
  id: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  pinned: z.boolean().optional(),
  color: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
export const DeleteNote = z.object({ type: z.literal("delete_note"), id: z.string() });
/** Server-only inverse of delete_note. */
export const RestoreNote = z.object({ type: z.literal("restore_note"), note: Note, index: z.number().int().min(0) });

export const NOTE_OPS = ["add_note", "set_note", "delete_note", "restore_note"] as const;
