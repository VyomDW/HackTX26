import { z } from "zod";
import { Deck } from "./deck";
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

/** Browser -> server. */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), roomId: z.string(), userId: z.string(), name: z.string().optional() }),
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
  z.object({ type: z.literal("snapshot"), deck: Deck, history: z.array(OpEnvelope), turns: z.array(Turn).default([]) }),
  z.object({ type: z.literal("op"), envelope: OpEnvelope }),
  z.object({ type: z.literal("turn"), turn: Turn }),
  z.object({ type: z.literal("presence"), users: z.array(z.object({ userId: z.string(), name: z.string().optional() })) }),
  z.object({ type: z.literal("ai_status"), status: z.enum(["idle", "thinking", "streaming"]) }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
