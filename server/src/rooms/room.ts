import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  applyOp,
  emptyDocument,
  MODEL_OPS,
  OpError,
  type DocKind,
  type Document,
  type ModelOp,
  type Op,
  type OpEnvelope,
  type ServerMessage,
  type Turn,
  type UserOp,
} from "@hacktx/shared";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { findSourcedImage, generateImage, imagesEnabled, sourcedImagesEnabled } from "../integrations/image";
import { search, type SearchResult } from "../integrations/search";
import { callMuse, type ChatMessage } from "../integrations/muse";
import { lines } from "../ndjson";
import { loadRooms, scheduleSave } from "./store";
import { describeDocument, SYSTEM_PROMPTS } from "./prompts";

const PROMPTS_PER_MINUTE = 20;
const MAX_PARALLEL_IMAGES = 4;

const NOUN: Record<DocKind, string> = { slides: "deck", doc: "document", sheet: "spreadsheet", notes: "notebook", board: "board" };

/** Turns SDK failures into something worth showing a user. */
function errorMessage(err: unknown): string {
  // Connection errors subclass APIError, so check the most specific first.
  if (err instanceof APIConnectionTimeoutError) return "The AI took too long to respond. Try again.";
  if (err instanceof APIConnectionError) return "Couldn't reach the AI service. Check the connection and try again.";
  if (err instanceof APIError) {
    if (err.status === 429) return "The AI is rate limited right now. Wait a few seconds and try again.";
    if (err.status === 401 || err.status === 403) return "The AI key was rejected. Check MUSE_API_KEY on the server.";
  }
  return "The AI couldn't finish that request. Try again.";
}

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
  doc: Document;
  members = new Set<Member>();
  history: Applied[] = [];
  conversation: { role: "user" | "assistant"; text: string }[] = [];
  turns: Turn[] = [];
  updatedAt = Date.now();
  private inflight?: { controller: AbortController; turnId: string };
  /** True while an AI response is streaming. */
  get busy() {
    return !!this.inflight;
  }
  private recentPrompts: number[] = [];
  /** Per-user undo/redo of editor changes; each entry is a group of opIds reverted together. */
  private stacks = new Map<string, { undo: string[][]; redo: string[][] }>();

  constructor(
    readonly id: string,
    kind: DocKind,
  ) {
    this.doc = emptyDocument(kind, id);
  }

  get kind(): DocKind {
    return this.doc.kind;
  }

  join(member: Member) {
    this.members.add(member);
    this.sendSnapshot(member);
    this.broadcastPresence();
  }

  private sendSnapshot(member: Member) {
    this.send(member.socket, {
      type: "snapshot",
      doc: this.doc,
      history: this.history.map((h) => h.envelope),
      turns: this.turns,
    });
  }

  leave(member: Member) {
    this.members.delete(member);
    this.broadcastPresence();
  }

  /** Applies one op to the authoritative document and broadcasts it. Returns the new opId, or undefined if it was rejected. */
  apply(op: Op, actor: string, meta: { undoes?: string; turnId?: string } = {}): string | undefined {
    try {
      const { doc, inverse } = applyOp(this.doc, op);
      this.doc = doc;
      scheduleSave(this);
      const envelope: OpEnvelope = { opId: randomUUID(), actor, ts: Date.now(), op, ...meta };
      this.history.push({ envelope, inverse });
      this.broadcast({ type: "op", envelope });
      return envelope.opId;
    } catch (err) {
      if (err instanceof OpError) {
        console.warn(`[room ${this.id}] dropped op`, op, err.message);
        return undefined;
      }
      throw err;
    }
  }

  /** Reverts one op. Returns the opIds of the reverting ops, which can themselves be undone (that is redo). */
  undo(opId: string, actor: string): string[] {
    const entry = this.history.find((h) => h.envelope.opId === opId);
    if (!entry || this.history.some((h) => h.envelope.undoes === opId)) return [];
    return entry.inverse.flatMap((op) => this.apply(op, actor, { undoes: opId }) ?? []);
  }

  /**
   * Direct edits from someone's editor, which form one step on that person's undo stack.
   * The editor already applied them locally, so a rejection means it drifted: resend the true state.
   */
  userOps(ops: UserOp[], member: Member) {
    const ids = ops.map((op) => {
      const id = this.apply(op, member.userId);
      if (id) this.illustrate(op, {});
      return id;
    });
    if (ids.some((id) => !id)) this.sendSnapshot(member);
    const applied = ids.filter((id): id is string => !!id);
    if (!applied.length) return;
    const stack = this.stackOf(member.userId);
    stack.undo.push(applied);
    stack.redo = [];
  }

  undoMine(userId: string) {
    const stack = this.stackOf(userId);
    const group = stack.undo.pop();
    if (!group) return;
    const created = [...group].reverse().flatMap((id) => this.undo(id, userId));
    if (created.length) stack.redo.push(created);
  }

  redoMine(userId: string) {
    const stack = this.stackOf(userId);
    const group = stack.redo.pop();
    if (!group) return;
    const created = [...group].reverse().flatMap((id) => this.undo(id, userId));
    if (created.length) stack.undo.push(created);
  }

  private stackOf(userId: string) {
    let stack = this.stacks.get(userId);
    if (!stack) this.stacks.set(userId, (stack = { undo: [], redo: [] }));
    return stack;
  }

  /** Reverts a whole AI response, newest op first, stopping it first if it is still streaming. */
  undoTurn(turnId: string, actor: string) {
    if (this.inflight?.turnId === turnId) this.stop();
    const entries = this.history.filter((h) => h.envelope.turnId === turnId && h.envelope.op.type !== "focus");
    for (const entry of entries.reverse()) this.undo(entry.envelope.opId, actor);
  }

  /** Cancels the response on purpose, so its unfinished requests are dropped rather than carried into the next prompt. */
  stop() {
    this.pending = [];
    this.inflight?.controller.abort();
  }

  /** Requests whose stream hasn't finished yet; an interrupted one is folded into the next prompt. */
  private pending: { speaker: string; text: string }[] = [];

  /**
   * New input cancels any in-flight stream (interruption) and re-prompts with every unfinished request,
   * so when two people talk at once both requests still get done.
   */
  async prompt(text: string, userId: string, name?: string) {
    const now = Date.now();
    this.recentPrompts = this.recentPrompts.filter((t) => now - t < 60_000);
    if (this.recentPrompts.length >= PROMPTS_PER_MINUTE) {
      this.broadcast({ type: "error", message: "Too many requests in this room. Wait a moment and try again." });
      return;
    }
    this.recentPrompts.push(now);

    this.inflight?.controller.abort();
    const controller = new AbortController();
    const speaker = name ?? [...this.members].find((m) => m.userId === userId)?.name ?? "Guest";
    const turn: Turn = { turnId: randomUUID(), userId, name: speaker, text, ts: now };
    this.inflight = { controller, turnId: turn.turnId };
    this.turns.push(turn);
    scheduleSave(this);
    this.broadcast({ type: "turn", turn });
    this.pending.push({ speaker, text });
    const requests = [...this.pending];
    let sources: SearchResult[] = [];
    if (this.kind === "slides") {
      try {
        sources = await search(requests.map((r) => r.text).join("\n"));
      } catch (err) {
        console.warn("[room " + this.id + "] search unavailable", err instanceof Error ? err.message : err);
      }
    }
    if (controller.signal.aborted) {
      if (this.inflight?.controller === controller) {
        this.inflight = undefined;
        this.broadcast({ type: "ai_status", status: "idle" });
      }
      return;
    }
    const messages = this.buildMessages(requests, sources);
    // Applied lines are remembered as the AI's reply, which also shows it its own format on later turns.
    // The reply slot is reserved now and filled as ops land, so an interrupting prompt still sees it in order.
    const reply = { role: "assistant" as const, text: "(no changes)" };
    const applied: string[] = [];
    this.conversation.push({ role: "user", text: `${speaker}: ${text}` }, reply);
    this.broadcast({ type: "ai_status", status: "thinking" });
    const meta = { turnId: turn.turnId };

    try {
      for await (const line of lines(callMuse(messages, controller.signal))) {
        if (controller.signal.aborted) return;
        if (!applied.length) this.broadcast({ type: "ai_status", status: "streaming" });
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          console.warn(`[room ${this.id}] malformed line`, line);
          continue;
        }
        const op = MODEL_OPS[this.kind].safeParse(parsed);
        if (!op.success) {
          console.warn(`[room ${this.id}] invalid op`, line);
          continue;
        }
        if (op.data.type === "add_citation") {
          const citation = op.data;
          const match = sources.find((source) => source.url === citation.url && source.title === citation.source);
          if (!match) {
            console.warn("[room " + this.id + "] dropped citation not found in SerpApi results", citation);
            continue;
          }
        }
        if (this.doc.kind === "slides" && op.data.type === "add_image" && !op.data.url) {
          const imageOp = op.data;
          const slide = this.doc.slides.find((s) => s.id === imageOp.slideId);
          if (slide?.layout === "title") imageOp.box = { x: 900, y: 500, w: 340, h: 190 };
          const existing = slide?.elements.find((element) => element.id === imageOp.elementId);
          if (existing?.kind === "image") {
            this.apply({ type: "delete_element", slideId: imageOp.slideId, elementId: imageOp.elementId }, "ai", meta);
            for (const citation of [...(slide?.citations ?? [])]) {
              this.apply({ type: "remove_citation", slideId: imageOp.slideId, citationId: citation.id }, "ai", meta);
            }
          }
        }
        // A dropped add_slide would otherwise sink every later edit to that slide, so recreate it on demand.
        const missing = this.missingSlide(op.data);
        if (missing && this.apply(missing, "ai", meta)) applied.push(JSON.stringify(missing));
        if (this.apply(op.data, "ai", meta)) {
          this.illustrate(op.data, meta, requests.map((r) => r.text).join("\n"));
          applied.push(line);
          reply.text = applied.join("\n");
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error(`[room ${this.id}] muse call failed`, err);
        this.broadcast({ type: "error", message: errorMessage(err) });
      }
    } finally {
      // Done or failed; either way don't replay these. Aborted ones stay for the prompt that interrupted them.
      if (!controller.signal.aborted) this.pending = this.pending.filter((r) => !requests.includes(r));
      if (this.inflight?.controller === controller) {
        this.inflight = undefined;
        this.broadcast({ type: "ai_status", status: "idle" });
      }
    }
  }

  private drawing = 0;
  /** Board image nodes with a generation in flight, so a burst of edits doesn't draw the same picture twice. */
  private pendingImages = new Set<string>();

  /**
   * The model asks for pictures by description (a board image node, a slide add_image); Muse Image draws them
   * in the background while the rest of the response keeps streaming, then the URL lands as a normal op.
   */
  private illustrate(op: Op, meta: { turnId?: string }, context = "") {
    const board = this.doc.kind === "board" ? this.doc : undefined;
    let prompt: string | undefined;
    let finish: ((url: string) => Op) | undefined;
    // Board pictures: any image node that has a description but no drawing yet (new, redescribed, or "redraw").
    const nodeId = op.type === "add_node" || op.type === "set_node" ? op.id : undefined;
    const node = nodeId ? board?.nodes.find((n) => n.id === nodeId) : undefined;
    const boardImage = !!node && node.shape === "image" && !node.url && !!node.text.trim() && !this.pendingImages.has(node.id);
    if (boardImage && node) {
      // Diagrams get whiteboard-style line art so drawings sit naturally among sticky notes and shapes.
      prompt =
        board?.template === "blueprint"
          ? node.text
          : `${node.text}. Hand-drawn whiteboard sketch: clean black marker line art with a few flat accent colours, plain white background, no text.`;
      const id = node.id;
      finish = (url) => {
        this.pendingImages.delete(id);
        return { type: "set_node", id, url };
      };
    } else if (op.type === "add_image" && !op.url) {
      prompt = `${op.prompt}. High quality editorial illustration for a presentation slide, no text.`;
      finish = (url) => ({ type: "set_image_url", slideId: op.slideId, elementId: op.elementId, url });
    }
    const sourcedSlideImageOp = this.doc.kind === "slides" && op.type === "add_image" && !op.url && sourcedImagesEnabled() ? op : undefined;
    const sourcedSlideImage = !!sourcedSlideImageOp;
    if (!prompt || !finish || (!imagesEnabled && !sourcedSlideImage)) return;
    // Over the limit, wait for a slot rather than dropping the picture (it would show "drawing…" forever).
    if (this.drawing >= MAX_PARALLEL_IMAGES) {
      setTimeout(() => this.illustrate(op, meta), 1500);
      return;
    }
    if (boardImage && node) this.pendingImages.add(node.id);
    this.drawing++;
    const work = sourcedSlideImage
      ? findSourcedImage(sourcedSlideImageOp!.prompt, context).then((image) => {
          this.apply(finish(image.url), "ai", meta);
          this.apply({ type: "add_citation", slideId: sourcedSlideImageOp!.slideId, source: image.title, url: image.sourceUrl }, "ai", meta);
        })
      : generateImage(prompt).then((url) => this.apply(finish(url), "ai", meta));
    work
      .catch((err) => {
        if (nodeId) this.pendingImages.delete(nodeId);
        console.error("[room " + this.id + "] image lookup/generation failed", err);
        const message = sourcedSlideImage
          ? "Couldn't find a downloadable, high-resolution image match. The placeholder remains on the slide."
          : "nodepad couldn't draw one of the images. Try asking again.";
        this.broadcast({ type: "error", message });
      })
      .finally(() => this.drawing--);
  }

  /** An add_slide for a content op that targets a slide which does not exist yet. */
  private missingSlide(op: ModelOp): ModelOp | undefined {
    if (this.doc.kind !== "slides") return;
    if (op.type !== "set_text" && op.type !== "add_image" && op.type !== "add_shape") return;
    if (this.doc.slides.some((s) => s.id === op.slideId)) return;
    const layout = op.type === "add_image" ? "image-left" : op.elementId.endsWith("-quote") ? "quote" : "bullets";
    return { type: "add_slide", id: op.slideId, layout };
  }

  /** Built before the new turn is recorded, so history holds only earlier turns. */
  private buildMessages(requests: { speaker: string; text: string }[], sources: SearchResult[] = []): ChatMessage[] {
    const request = requests.length === 1 ? requests[0]!.text : requests.map((r) => `${r.speaker}: ${r.text}`).join("\n");
    const sourceContext = this.kind === "slides" ? "SEARCH SOURCES (cite only exact title and URL pairs from this list):\n" + JSON.stringify(sources) + "\n\n" : "";
    return [
      { role: "developer", content: SYSTEM_PROMPTS[this.kind] },
      ...this.conversation.slice(-10).map(({ role, text }) => ({ role, content: text })),
      { role: "user", content: `Current ${NOUN[this.kind]}:\n${describeDocument(this.doc)}\n\n${sourceContext}Request: ${request}` },
    ];
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

const rooms = loadRooms((id, kind) => new Room(id, kind));

/** Gets a room, creating it as the given kind (default slides) if it doesn't exist yet. */
export const getRoom = (id: string, kind: DocKind = "slides") => {
  let room = rooms.get(id);
  if (!room) {
    rooms.set(id, (room = new Room(id, kind)));
    scheduleSave(room);
  }
  return room;
};

export const listRooms = () => [...rooms.values()];

export const deleteRoom = (id: string) => rooms.delete(id);
