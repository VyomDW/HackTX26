import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  applyOp,
  emptyDeck,
  ModelOp,
  OpError,
  type Deck,
  type Op,
  type OpEnvelope,
  type ServerMessage,
} from "@hacktx/shared";
import { callMuse } from "../integrations/muse";
import { lines } from "../ndjson";

interface Member {
  socket: WebSocket;
  userId: string;
  name?: string;
}

interface Applied {
  envelope: OpEnvelope;
  inverse: Op[];
}

export class Room {
  deck: Deck;
  members = new Set<Member>();
  history: Applied[] = [];
  conversation: { role: "user" | "assistant"; text: string }[] = [];
  private inflight?: AbortController;

  constructor(readonly id: string) {
    this.deck = emptyDeck(id);
  }

  join(member: Member) {
    this.members.add(member);
    this.send(member.socket, { type: "snapshot", deck: this.deck, history: this.history.map((h) => h.envelope) });
    this.broadcastPresence();
  }

  leave(member: Member) {
    this.members.delete(member);
    this.broadcastPresence();
  }

  /** Applies one op to the authoritative deck and broadcasts it. Returns false if it was rejected. */
  apply(op: Op, actor: string, undoes?: string): boolean {
    try {
      const { deck, inverse } = applyOp(this.deck, op);
      this.deck = deck;
      const envelope: OpEnvelope = { opId: randomUUID(), actor, ts: Date.now(), op, undoes };
      this.history.push({ envelope, inverse });
      this.broadcast({ type: "op", envelope });
      return true;
    } catch (err) {
      if (err instanceof OpError) {
        console.warn(`[room ${this.id}] dropped op`, op, err.message);
        return false;
      }
      throw err;
    }
  }

  undo(opId: string, actor: string) {
    const entry = this.history.find((h) => h.envelope.opId === opId);
    if (!entry) return;
    for (const op of entry.inverse) this.apply(op, actor, opId);
  }

  /** Requests whose stream hasn't finished yet; an interrupted one is folded into the next prompt. */
  private pending: { speaker: string; text: string }[] = [];

  /**
   * New input cancels any in-flight stream (interruption) and re-prompts with every unfinished request,
   * so when two people talk at once both requests still get done.
   */
  async prompt(text: string, userId: string) {
    this.inflight?.abort();
    const controller = new AbortController();
    this.inflight = controller;
    const speaker = [...this.members].find((m) => m.userId === userId)?.name ?? userId;
    this.pending.push({ speaker, text });
    this.conversation.push({ role: "user", text: `${speaker}: ${text}` });
    const requests = [...this.pending];
    this.broadcast({ type: "ai_status", status: "thinking" });

    try {
      for await (const line of lines(callMuse(this.buildPrompt(requests), controller.signal))) {
        if (controller.signal.aborted) return;
        this.broadcast({ type: "ai_status", status: "streaming" });
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          console.warn(`[room ${this.id}] malformed line`, line);
          continue;
        }
        const op = ModelOp.safeParse(parsed);
        if (!op.success) {
          console.warn(`[room ${this.id}] invalid op`, line);
          continue;
        }
        this.apply(op.data, "ai");
      }
    } finally {
      // Done or failed; either way don't replay these. Aborted ones stay for the prompt that interrupted them.
      if (!controller.signal.aborted) this.pending = this.pending.filter((r) => !requests.includes(r));
      if (this.inflight === controller) {
        this.inflight = undefined;
        this.broadcast({ type: "ai_status", status: "idle" });
      }
    }
  }

  // TODO(B): system instructions + op schema + trimmed conversation; deck JSON every turn.
  private buildPrompt(requests: { speaker: string; text: string }[]) {
    const request = requests.length === 1 ? requests[0].text : requests.map((r) => `${r.speaker}: ${r.text}`).join("\n");
    return JSON.stringify({ deck: this.deck, conversation: this.conversation.slice(-10), request });
  }

  private broadcast(msg: ServerMessage) {
    for (const m of this.members) this.send(m.socket, msg);
  }

  private broadcastPresence() {
    this.broadcast({
      type: "presence",
      users: [...this.members].map(({ userId, name }) => ({ userId, name })),
    });
  }

  private send(socket: WebSocket, msg: ServerMessage) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }
}

const rooms = new Map<string, Room>();

export const getRoom = (id: string) => {
  let room = rooms.get(id);
  if (!room) rooms.set(id, (room = new Room(id)));
  return room;
};
