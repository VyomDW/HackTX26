import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useDeck } from "@/store/deck";
import { currentSlide, useEditor } from "@/store/editor";
import { SlideView } from "./SlideView";

/** Fullscreen slideshow: arrows, space or click to advance; Escape to leave. */
export function Present() {
  const slides = useDeck((s) => s.deck.slides);
  const [index, setIndex] = useState(() => Math.max(0, slides.findIndex((s) => s.id === currentSlide()?.id)));
  const ref = useRef<HTMLDivElement>(null);
  const exit = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    useEditor.setState({ presenting: false });
  };

  useEffect(() => {
    void ref.current?.requestFullscreen?.().catch(() => {});
    const onFs = () => !document.fullscreenElement && useEditor.setState({ presenting: false });
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"].includes(e.key)) setIndex((i) => Math.min(i + 1, slides.length - 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) setIndex((i) => Math.max(i - 1, 0));
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(slides.length - 1);
      else if (e.key === "Escape") exit();
      else return;
      e.preventDefault();
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey);
    };
  }, [slides.length]);

  const slide = slides[Math.min(index, slides.length - 1)];
  if (!slide) return null;

  return (
    <div ref={ref} className="fixed inset-0 z-[100] flex items-center justify-center bg-black" onClick={() => setIndex((i) => Math.min(i + 1, slides.length - 1))}>
      <div style={{ width: "min(100vw, calc(100vh * 16 / 9))" }}>
        <SlideView slide={slide} />
      </div>
      <div className="absolute bottom-4 right-4 flex items-center gap-3 text-sm text-white/50">
        <span className="tabular-nums">
          {index + 1} / {slides.length}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            exit();
          }}
          className="rounded-full p-1.5 hover:bg-white/10 hover:text-white"
          title="Exit (Esc)"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Every slide, one per page, shown only when printing (Export PDF uses the browser's Save as PDF). */
export function PrintDeck() {
  const slides = useDeck((s) => s.deck.slides);
  return (
    <div className="hidden print:block">
      {slides.map((slide) => (
        <div key={slide.id} className="print-page">
          <SlideView slide={slide} />
        </div>
      ))}
    </div>
  );
}
