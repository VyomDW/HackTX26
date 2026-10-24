import { create } from "zustand";
import { applyOp, emptyDeck, OpError, type Deck, type Op, type OpEnvelope, type Turn } from "@hacktx/shared";

type AiStatus = "idle" | "thinking" | "streaming";

/** The element that changed most recently; key changes on every op so repeated edits re-trigger effects. */
export interface Flash {
  slideId: string;
  elementId?: string;
  key: string;
  /** How long the typewriter reveal should take, 0 for no typing. */
  typeMs: number;
}

interface DeckState {
  deck: Deck;
  history: OpEnvelope[];
  turns: Turn[];
  users: { userId: string; name?: string }[];
  aiStatus: AiStatus;
  error?: { message: string; at: number };
  /** Where the AI cursor currently points. */
  focus?: { slideId: string; elementId?: string };
  flash?: Flash;
  /** Ops received but not yet shown; drained one at a time so edits are visible as they happen. */
  pending: number;
  reset: (deck: Deck, history: OpEnvelope[], turns: Turn[]) => void;
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

const focusOf = (env: OpEnvelope): DeckState["focus"] => {
  const op = env.op;
  if ("slideId" in op) return { slideId: op.slideId, elementId: "elementId" in op ? op.elementId : undefined };
  if (op.type === "add_slide") return { slideId: op.id };
  return undefined;
};

const typeMsOf = (env: OpEnvelope) =>
  env.op.type === "set_text" && env.actor === "ai" && !env.undoes ? Math.min(env.op.text.length * 12, 700) : 0;

/** Pause after an op before the next one plays; shrinks when a backlog builds so playback never lags far behind. */
const delayOf = (env: OpEnvelope, backlog: number) => {
  if (env.actor !== "ai" || env.undoes) return 40;
  const base = env.op.type === "focus" ? 120 : typeMsOf(env) + 220;
  return backlog > 12 ? base / 3 : backlog > 6 ? base / 1.5 : base;
};

const queue: OpEnvelope[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export const useDeck = create<DeckState>((set, get) => {
  const show = (envelope: OpEnvelope) =>
    set((s) => {
      try {
        const { deck } = applyOp(s.deck, envelope.op);
        const isAi = envelope.actor === "ai" && !envelope.undoes;
        const target = focusOf(envelope);
        return {
          deck,
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
    deck: emptyDeck("local"),
    history: [],
    turns: [],
    users: [],
    aiStatus: "idle",
    pending: 0,
    reset: (deck, history, turns) => {
      queue.length = 0;
      clearTimeout(timer);
      timer = undefined;
      set({ deck, history, turns, pending: 0, focus: undefined, flash: undefined });
    },
    receive: (envelope) => {
      queue.push(envelope);
      set({ pending: queue.length });
      if (!timer) pump();
    },
    applyLocal: (op) =>
      set((s) => {
        try {
          return { deck: applyOp(s.deck, op).deck };
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
