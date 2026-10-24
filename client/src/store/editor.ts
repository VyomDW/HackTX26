import { create } from "zustand";
import type { ClientMessage, Element, UserOp } from "@hacktx/shared";
import { useDeck } from "./deck";

/** Local, per-tab editor state: what is selected and which slide is on stage. Never synced. */
interface EditorState {
  slideId?: string;
  /** Keep the stage on whatever slide the AI is editing. */
  follow: boolean;
  selectedId?: string;
  editingId?: string;
  presenting: boolean;
  send: (msg: ClientMessage) => void;
  setSlide: (slideId: string | undefined, follow?: boolean) => void;
  select: (id?: string) => void;
  edit: (id?: string) => void;
}

export const useEditor = create<EditorState>((set) => ({
  follow: true,
  presenting: false,
  send: () => {},
  setSlide: (slideId, follow = false) => set({ slideId, follow, selectedId: undefined, editingId: undefined }),
  select: (selectedId) => set((s) => ({ selectedId, editingId: s.editingId === selectedId ? s.editingId : undefined })),
  edit: (editingId) => set((s) => ({ editingId, selectedId: editingId ?? s.selectedId })),
}));

/** Applies edits locally for instant feedback and sends them to the server as one undo step. */
export function commit(...ops: UserOp[]) {
  if (!ops.length) return;
  const deck = useDeck.getState();
  for (const op of ops) deck.applyLocal(op);
  useEditor.getState().send({ type: "ops", ops });
}

/** The slide currently on stage, falling back to the first one. */
export function currentSlide() {
  const { deck } = useDeck.getState();
  const { slideId } = useEditor.getState();
  return deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];
}

export function selectedElement(): { slideId: string; element: Element } | undefined {
  const slide = currentSlide();
  const id = useEditor.getState().selectedId;
  const element = slide?.elements.find((e) => e.id === id);
  return slide && element ? { slideId: slide.id, element } : undefined;
}
