import { create } from "zustand";
import { applyOp, emptyDeck, OpError, type Deck, type OpEnvelope } from "@hacktx/shared";

type AiStatus = "idle" | "thinking" | "streaming";

interface DeckState {
  deck: Deck;
  history: OpEnvelope[];
  users: { userId: string; name?: string }[];
  aiStatus: AiStatus;
  /** Where the AI cursor currently points. */
  focus?: { slideId: string; elementId?: string };
  reset: (deck: Deck, history: OpEnvelope[]) => void;
  receive: (envelope: OpEnvelope) => void;
  setUsers: (users: DeckState["users"]) => void;
  setAiStatus: (s: AiStatus) => void;
}

const focusOf = (env: OpEnvelope): DeckState["focus"] => {
  const op = env.op;
  if ("slideId" in op) return { slideId: op.slideId, elementId: "elementId" in op ? op.elementId : undefined };
  if (op.type === "add_slide") return { slideId: op.id };
  return undefined;
};

export const useDeck = create<DeckState>((set) => ({
  deck: emptyDeck("local"),
  history: [],
  users: [],
  aiStatus: "idle",
  reset: (deck, history) => set({ deck, history }),
  // TODO(A): queue incoming ops with a short delay so edits appear one at a time.
  receive: (envelope) =>
    set((s) => {
      try {
        const { deck } = applyOp(s.deck, envelope.op);
        return {
          deck,
          history: [...s.history, envelope],
          focus: envelope.actor === "ai" ? (focusOf(envelope) ?? s.focus) : s.focus,
        };
      } catch (err) {
        if (err instanceof OpError) console.warn("dropped op", envelope, err.message);
        return s;
      }
    }),
  setUsers: (users) => set({ users }),
  setAiStatus: (aiStatus) => set({ aiStatus }),
}));
