import { z } from "zod";
import { DocKind, Document } from "./document";
import { OpEnvelope, UserOp } from "./ops";

/** One user request to the AI, shown in the shared transcript. */
export const Turn = z.object({
  turnId: z.string(),
  userId: z.string(),
  name: z.string().optional(),
  text: z.string(),
  ts: z.number(),
});
export type Turn = z.infer<typeof Turn>;

/** One line heard in Listen mode, from someone's own mic or from the call audio they share. */
export const Caption = z.object({
  id: z.string(),
  speaker: z.string(),
  text: z.string(),
  ts: z.number(),
  acted: z.boolean().default(false),
});
export type Caption = z.infer<typeof Caption>;

/** Browser -> server. */
export const ClientMessage = z.discriminatedUnion("type", [
  /** kind is only used when the room does not exist yet. */
  z.object({ type: z.literal("join"), roomId: z.string(), userId: z.string(), name: z.string().optional(), kind: DocKind.optional() }),
  z.object({ type: z.literal("prompt"), text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("undo"), opId: z.string() }),
  /** Reverts every op from one AI response. */
  z.object({ type: z.literal("undo_turn"), turnId: z.string() }),
  /** Cancels the in-flight AI response. */
  z.object({ type: z.literal("stop") }),
  /** Direct edits from the editor (drag, restyle, typing, upload...); one message is one undo step. */
  z.object({ type: z.literal("ops"), ops: z.array(UserOp).min(1).max(50) }),
  /** Undo or redo the sender's own most recent editor change. */
  z.object({ type: z.literal("undo_mine") }),
  z.object({ type: z.literal("redo_mine") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Server -> browser. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), doc: Document, history: z.array(OpEnvelope), turns: z.array(Turn).default([]) }),
  z.object({ type: z.literal("op"), envelope: OpEnvelope }),
  z.object({ type: z.literal("turn"), turn: Turn }),
  z.object({ type: z.literal("presence"), users: z.array(z.object({ userId: z.string(), name: z.string().optional() })) }),
  z.object({ type: z.literal("ai_status"), status: z.enum(["idle", "thinking", "streaming"]) }),
  z.object({ type: z.literal("error"), message: z.string() }),
  /** Something heard by someone's open mic (Listen mode). Sent again with acted: true if Muse acted on it. */
  z.object({ type: z.literal("caption"), caption: Caption }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
