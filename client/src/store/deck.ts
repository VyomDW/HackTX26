import { create } from "zustand";
import { addr, applyOp, emptyDeck, OpError, parseRange, type Deck, type Document, type Op, type OpEnvelope, type Turn } from "@hacktx/shared";

type AiStatus = "idle" | "thinking" | "streaming";

/**
 * What an op touched: a slide element, a document block, a note, or spreadsheet cells.
 * elementId is the primary target (block id, note id, first cell); targets lists every cell for sheets.
 */
export interface Target {
  slideId?: string;
  elementId?: string;
  targets?: string[];
}

/** The target changed most recently; key changes on every op so repeated edits re-trigger effects. */
export interface Flash extends Target {
  key: string;
  /** How long the typewriter reveal should take, 0 for no typing. */
  typeMs: number;
}

interface DeckState {
  /** The file being edited (slides, document, spreadsheet or notebook). */
  doc: Document;
  /** False until the first snapshot arrives, so editors don't flash an empty default. */
  loaded: boolean;
  history: OpEnvelope[];
  turns: Turn[];
  users: { userId: string; name?: string }[];
  aiStatus: AiStatus;
  error?: { message: string; at: number };
  /** Where the AI cursor currently points. */
  focus?: Target;
  flash?: Flash;
  /** Ops received but not yet shown; drained one at a time so edits are visible as they happen. */
  pending: number;
  reset: (doc: Document, history: OpEnvelope[], turns: Turn[]) => void;
  receive: (envelope: OpEnvelope) => void;
  /**
   * Shows the user's own edit immediately. The server echo replays it later; every user op is
   * either idempotent or rejected harmlessly when replayed, so the two converge on server order.
   */
  applyLocal: (op: Op) => void;
  addTurn: (turn: Turn) => void;
  setUsers: (users: DeckState["users"]) => void;
  setAiStatus: (s: AiStatus) => void;
  setError: (message?: string) => void;
}

const cellsOf = (range: string): string[] => {
  const b = parseRange(range);
  if (!b) return [];
  const out: string[] = [];
  for (let r = b.r0; r <= b.r1 && out.length < 400; r++) for (let c = b.c0; c <= b.c1 && out.length < 400; c++) out.push(addr(r, c));
  return out;
};

const focusOf = (env: OpEnvelope): Target | undefined => {
  const op = env.op;
  if ("slideId" in op) return { slideId: op.slideId, elementId: "elementId" in op ? op.elementId : undefined };
  switch (op.type) {
    case "add_slide":
      return { slideId: op.id };
    case "insert_block":
    case "set_block":
    case "move_block":
    case "add_note":
    case "set_note":
    case "add_node":
    case "set_node":
    case "add_edge":
    case "set_edge":
      return { elementId: op.id };
    case "restore_block":
      return { elementId: op.block.id };
    case "set_cells": {
      const targets = Object.keys(op.cells).map((a) => a.toUpperCase());
      return { elementId: targets[0], targets };
    }
    case "set_cell_style":
    case "sort_range": {
      const targets = cellsOf(op.range);
      return { elementId: targets[0], targets };
    }
    default:
      return undefined;
  }
};

/** Text the AI is writing, which gets a typewriter reveal. */
const typedText = (op: Op): string | undefined => {
  if (op.type === "set_text" || op.type === "insert_block") return op.text;
  if (op.type === "set_block") return op.text;
  return undefined;
};

const typeMsOf = (env: OpEnvelope) => {
  const text = env.actor === "ai" && !env.undoes ? typedText(env.op) : undefined;
  return text ? Math.min(text.length * 12, 700) : 0;
};

/** Pause after an op before the next one plays; shrinks when a backlog builds so playback never lags far behind. */
const delayOf = (env: OpEnvelope, backlog: number) => {
  if (env.actor !== "ai" || env.undoes) return 40;
  const base = env.op.type === "focus" ? 120 : env.op.type === "set_cells" ? 260 : typeMsOf(env) + 220;
  return backlog > 12 ? base / 3 : backlog > 6 ? base / 1.5 : base;
};

const queue: OpEnvelope[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export const useDeck = create<DeckState>((set) => {
  const show = (envelope: OpEnvelope) =>
    set((s) => {
      try {
        const { doc } = applyOp(s.doc, envelope.op);
        const isAi = envelope.actor === "ai" && !envelope.undoes;
        const target = focusOf(envelope);
        return {
          doc,
          history: [...s.history, envelope],
          focus: isAi ? (target ?? s.focus) : s.focus,
          flash:
            target && envelope.op.type !== "focus" && !envelope.op.type.startsWith("delete")
              ? { ...target, key: envelope.opId, typeMs: typeMsOf(envelope) }
              : s.flash,
        };
      } catch (err) {
        // Echoes of our own optimistic edits land here routinely (e.g. an add that already exists locally).
        if (err instanceof OpError && envelope.actor === "ai") console.warn("dropped op", envelope, err.message);
        return { history: [...s.history, envelope] };
      }
    });

  const pump = () => {
    const next = queue.shift();
    if (!next) {
      timer = undefined;
      set({ pending: 0 });
      return;
    }
    show(next);
    set({ pending: queue.length });
    timer = setTimeout(pump, delayOf(next, queue.length));
  };

  return {
    doc: emptyDeck("local"),
    loaded: false,
    history: [],
    turns: [],
    users: [],
    aiStatus: "idle",
    pending: 0,
    reset: (doc, history, turns) => {
      queue.length = 0;
      clearTimeout(timer);
      timer = undefined;
      set({ doc, history, turns, loaded: true, pending: 0, focus: undefined, flash: undefined });
    },
    receive: (envelope) => {
      queue.push(envelope);
      set({ pending: queue.length });
      if (!timer) pump();
    },
    applyLocal: (op) =>
      set((s) => {
        try {
          return { doc: applyOp(s.doc, op).doc };
        } catch {
          return s;
        }
      }),
    addTurn: (turn) => set((s) => ({ turns: [...s.turns, turn] })),
    setUsers: (users) => set({ users }),
    setAiStatus: (aiStatus) => set({ aiStatus }),
    setError: (message) => set({ error: message ? { message, at: Date.now() } : undefined }),
  };
});

/** Ops each turn produced (excluding cursor moves) and whether they have all been undone. */
export function turnSummary(history: OpEnvelope[], turnId: string) {
  const undone = new Set(history.map((h) => h.undoes).filter(Boolean));
  const ops = history.filter((h) => h.turnId === turnId && h.op.type !== "focus");
  return { edits: ops.length, undone: ops.length > 0 && ops.every((h) => undone.has(h.opId)) };
}

export const isBusy = (s: Pick<DeckState, "aiStatus" | "pending">) => s.aiStatus !== "idle" || s.pending > 0;

/** The store holds any kind of file; this name reads better outside the slides editor. */
export const useDoc = useDeck;

const NO_DECK: Deck = emptyDeck("none");

/** The current file as a slide deck (a stable empty deck when it is another kind). */
export const selectDeck = (s: Pick<DeckState, "doc">): Deck => (s.doc.kind === "slides" ? s.doc : NO_DECK);
