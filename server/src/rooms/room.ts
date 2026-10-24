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
  type Turn,
  type UserOp,
} from "@hacktx/shared";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { callMuse, type ChatMessage } from "../integrations/muse";
import { lines } from "../ndjson";

/** Standing instructions sent to Muse Spark as a developer message on every turn. */
const SYSTEM_PROMPT = `You are a live co-editor for a slide deck. Users watch your edits appear one by one as you stream them.

OUTPUT FORMAT
Reply with editing operations only: exactly one JSON object per line, nothing else.
No prose, no markdown, no code fences, no arrays, no trailing commas. Each line must parse on its own.

CANVAS
Every slide is 1280 wide by 720 tall. Every element has a box {x,y,w,h,rotate} in these units (x,y = top-left corner; rotate in degrees)
and a style. Font sizes, stroke widths and corner radii use the same units. Later elements in a slide's list are drawn on top.

OPERATIONS
Structure:
{"type":"add_slide","id":"s3","layout":"bullets","afterId":"s2"}   layout: title | bullets | image-left | image-full | quote | blank. afterId optional (default: append).
{"type":"duplicate_slide","slideId":"s3","newId":"s4"}
{"type":"delete_slide","slideId":"s3"}
{"type":"reorder_slide","slideId":"s3","toIndex":0}
{"type":"set_slide","slideId":"s3","background":"#0f172a","notes":"speaker notes"}   either field optional; null clears it.
Content:
{"type":"set_text","slideId":"s3","elementId":"s3-title","text":"..."}   creates a text box if missing, otherwise replaces its text (also works on shapes). Optional "box" and "style" when creating.
{"type":"add_image","slideId":"s3","elementId":"s3-img","prompt":"short visual description"}   optional "box", "style".
{"type":"add_shape","slideId":"s3","elementId":"s3-badge","shape":"rounded","text":"New"}   shape: rect | rounded | ellipse | triangle | diamond | star | line | arrow. Optional "box", "style", "text".
{"type":"delete_element","slideId":"s3","elementId":"s3-body"}
Design:
{"type":"set_box","slideId":"s3","elementId":"s3-title","x":80,"y":40,"w":800,"h":120,"rotate":0}   move/resize/rotate; give only the fields that change.
{"type":"set_style","slideId":"s3","elementId":"s3-title","style":{"color":"#7c3aed","bold":true}}   give only the properties that change; null resets one.
{"type":"reorder_element","slideId":"s3","elementId":"s3-badge","toIndex":0}   0 = send to back.
View:
{"type":"focus","slideId":"s3","elementId":"s3-title"}   moves the user's view; elementId optional.

STYLE PROPERTIES
Text: fontFamily (Inter | Poppins | Montserrat | Playfair Display | Lora | Merriweather | Oswald | Roboto Mono), fontSize, color, bold, italic, underline, strike,
      align (left | center | right), valign (top | middle | bottom), lineHeight.
Box: fill (background color), stroke (border color), strokeWidth, radius, opacity (0 to 1). Images: fit (cover | contain).
Colors are hex strings like "#1e293b". Inside text, **double asterisks** make words bold and *single asterisks* make them italic.

ELEMENT IDS (always "<slideId>-<role>")
Layouts place these roles automatically, so you do not need box or style for them:
title layout:       -title, -subtitle
bullets layout:     -title, -body
image-left layout:  -title, -body, -img
image-full layout:  -title, -img
quote layout:       -quote, -attribution
Any other role (e.g. -badge, -chart, -note) is free-form: give it a box so it lands where you want.

RULES
1. You receive the current deck as JSON with every request. Reuse its slide and element ids when editing. Never invent ids for things that do not exist.
2. New slides need ids not already in the deck; continue the numbering (s1, s2, s3...).
3. Emit add_slide before any operation on that slide. Finish one slide before starting the next, and end each slide with a focus on it.
4. Body text: 3 to 5 bullets, each starting with "• ", separated by \\n, each under 12 words. Titles under 60 characters.
5. For a new presentation, build 4 to 6 slides, starting with a title slide. Rely on layout defaults; add design touches only when they help.
6. For an edit request, change only what was asked. Do not rebuild the deck. For "move", "bigger", "color", "font" style requests use set_box and set_style.
7. Keep everything inside the 1280x720 canvas, keep text readable (fontSize 18 or more) and keep enough contrast with the slide background.
8. Never emit add_citation or set_image_url; the server handles sources and image generation.
9. If the request is unclear, make a sensible choice rather than asking.`;

const PROMPTS_PER_MINUTE = 20;

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
  deck: Deck;
  members = new Set<Member>();
  history: Applied[] = [];
  conversation: { role: "user" | "assistant"; text: string }[] = [];
  turns: Turn[] = [];
  private inflight?: { controller: AbortController; turnId: string };
  private recentPrompts: number[] = [];
  /** Per-user undo/redo of editor changes; each entry is a group of opIds reverted together. */
  private stacks = new Map<string, { undo: string[][]; redo: string[][] }>();

  constructor(readonly id: string) {
    this.deck = emptyDeck(id);
  }

  join(member: Member) {
    this.members.add(member);
    this.sendSnapshot(member);
    this.broadcastPresence();
  }

  private sendSnapshot(member: Member) {
    this.send(member.socket, {
      type: "snapshot",
      deck: this.deck,
      history: this.history.map((h) => h.envelope),
      turns: this.turns,
    });
  }

  leave(member: Member) {
    this.members.delete(member);
    this.broadcastPresence();
  }

  /** Applies one op to the authoritative deck and broadcasts it. Returns the new opId, or undefined if it was rejected. */
  apply(op: Op, actor: string, meta: { undoes?: string; turnId?: string } = {}): string | undefined {
    try {
      const { deck, inverse } = applyOp(this.deck, op);
      this.deck = deck;
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
    const ids = ops.map((op) => this.apply(op, member.userId));
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
    this.broadcast({ type: "turn", turn });
    this.pending.push({ speaker, text });
    const requests = [...this.pending];
    const messages = this.buildMessages(requests);
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
        const op = ModelOp.safeParse(parsed);
        if (!op.success) {
          console.warn(`[room ${this.id}] invalid op`, line);
          continue;
        }
        // A dropped add_slide would otherwise sink every later edit to that slide, so recreate it on demand.
        const missing = this.missingSlide(op.data);
        if (missing && this.apply(missing, "ai", meta)) applied.push(JSON.stringify(missing));
        if (this.apply(op.data, "ai", meta)) {
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

  /** An add_slide for a content op that targets a slide which does not exist yet. */
  private missingSlide(op: ModelOp): ModelOp | undefined {
    if (op.type !== "set_text" && op.type !== "add_image" && op.type !== "add_shape") return;
    if (this.deck.slides.some((s) => s.id === op.slideId)) return;
    const layout = op.type === "add_image" ? "image-left" : op.elementId.endsWith("-quote") ? "quote" : "bullets";
    return { type: "add_slide", id: op.slideId, layout };
  }

  /** Built before the new turn is recorded, so history holds only earlier turns. */
  private buildMessages(requests: { speaker: string; text: string }[]): ChatMessage[] {
    const request = requests.length === 1 ? requests[0]!.text : requests.map((r) => `${r.speaker}: ${r.text}`).join("\n");
    // Uploaded images are inlined as data URLs; they would swamp the prompt and the model can't use them anyway.
    const deck = JSON.stringify(this.deck, (key, value) =>
      key === "url" && typeof value === "string" && value.startsWith("data:") ? "(uploaded image)" : value,
    );
    return [
      { role: "developer", content: SYSTEM_PROMPT },
      ...this.conversation.slice(-10).map(({ role, text }) => ({ role, content: text })),
      { role: "user", content: `Current deck:\n${deck}\n\nRequest: ${request}` },
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

const rooms = new Map<string, Room>();

export const getRoom = (id: string) => {
  let room = rooms.get(id);
  if (!room) rooms.set(id, (room = new Room(id)));
  return room;
};
