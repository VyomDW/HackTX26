import { z } from "zod";
import { Deck } from "./deck";
import { OpEnvelope } from "./ops";

/** Browser -> server. */
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), roomId: z.string(), userId: z.string(), name: z.string().optional() }),
  z.object({ type: z.literal("prompt"), text: z.string().min(1) }),
  z.object({ type: z.literal("undo"), opId: z.string() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Server -> browser. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), deck: Deck, history: z.array(OpEnvelope) }),
  z.object({ type: z.literal("op"), envelope: OpEnvelope }),
  z.object({ type: z.literal("presence"), users: z.array(z.object({ userId: z.string(), name: z.string().optional() })) }),
  z.object({ type: z.literal("ai_status"), status: z.enum(["idle", "thinking", "streaming"]) }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
