import { useEffect } from "react";
import { useDeck } from "@/store/deck";
import { currentSlide, useEditor } from "@/store/editor";
import * as act from "./actions";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Slides-style keyboard shortcuts and clipboard handling for the editor. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ed = useEditor.getState();
      if (ed.presenting || isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod && key === "z") return run(e.shiftKey ? act.redoMine : act.undoMine);
      if (mod && key === "y") return run(act.redoMine);
      if (mod && key === "d") return run(act.duplicateSelected);
      if (mod && key === "b") return run(() => act.toggleStyle("bold"));
      if (mod && key === "i") return run(() => act.toggleStyle("italic"));
      if (mod && key === "u") return run(() => act.toggleStyle("underline"));
      if (mod && e.key === "Enter") return run(() => useEditor.setState({ presenting: true }));
      if (mod) return;

      if (ed.selectedId) {
        const step = e.shiftKey ? 20 : 2;
        if (e.key === "Delete" || e.key === "Backspace") return run(act.deleteSelected);
        if (e.key === "ArrowLeft") return run(() => act.nudge(-step, 0));
        if (e.key === "ArrowRight") return run(() => act.nudge(step, 0));
        if (e.key === "ArrowUp") return run(() => act.nudge(0, -step));
        if (e.key === "ArrowDown") return run(() => act.nudge(0, step));
        if (e.key === "Escape") return run(() => ed.select(undefined));
        if (e.key === "Enter") return run(() => ed.edit(ed.selectedId));
        return;
      }

      // Nothing selected: arrows move between slides.
      const { slides } = useDeck.getState().deck;
      const i = slides.findIndex((s) => s.id === currentSlide()?.id);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") return run(() => slides[i + 1] && ed.setSlide(slides[i + 1]!.id));
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") return run(() => slides[i - 1] && ed.setSlide(slides[i - 1]!.id));
    };

    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData) return;
      if (act.copySelected(e.clipboardData)) e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData) return;
      if (act.copySelected(e.clipboardData)) {
        e.preventDefault();
        act.deleteSelected();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData) return;
      if (act.paste(e.clipboardData)) e.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
}
