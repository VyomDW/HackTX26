import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Crosshair } from "lucide-react";
import { KINDS } from "@/lib/kinds";
import { useShortcuts } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { selectDeck, useDeck } from "@/store/deck";
import { commit, useEditor } from "@/store/editor";
import { NewSlideButton, SlideRail } from "./SlideRail";
import { Stage } from "./Stage";
import { Toolbar } from "./Toolbar";

/** The presentation editor: toolbar, slide rail, stage and speaker notes. */
export function SlidesEditor({ onPrompt }: { onPrompt: (text: string) => void }) {
  const deck = useDeck(selectDeck);
  const focus = useDeck((s) => s.focus);
  const { slideId, follow } = useEditor();
  useShortcuts();

  // Follow mode keeps the stage on whatever slide the AI is touching.
  useEffect(() => {
    if (follow && focus?.slideId && focus.slideId !== useEditor.getState().slideId) useEditor.getState().setSlide(focus.slideId, true);
  }, [follow, focus?.slideId]);

  const current = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];
  const currentIndex = current ? deck.slides.indexOf(current) : -1;

  return (
    <>
      <Toolbar />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <SlideRail />
        <main className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-none">
          {current ? (
            <>
              <StageArea>
                <Stage slide={current} />
              </StageArea>
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 text-sm text-slate-500 lg:px-8">
                <span className="tabular-nums">
                  Slide {currentIndex + 1} of {deck.slides.length}
                </span>
                <div className="flex items-center gap-2">
                  <div className="lg:hidden">
                    <NewSlideButton />
                  </div>
                  <button
                    onClick={() => useEditor.setState((s) => ({ follow: !s.follow }))}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
                      follow ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-200",
                    )}
                  >
                    <Crosshair className="size-3.5" />
                    {follow ? "Following Muse" : "Follow Muse"}
                  </button>
                </div>
              </div>
              <SpeakerNotes key={current.id} slideId={current.id} notes={current.notes ?? ""} />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4">
              <EmptyDeck onPick={onPrompt} />
            </div>
          )}
        </main>
      </div>
    </>
  );
}

/** Sizes the stage to the largest 16:9 box that fits the available space. */
function StageArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry!.contentRect;
      setWidth(Math.max(200, Math.min(w, (h * 16) / 9)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="flex min-h-[220px] flex-1 items-center justify-center p-4 lg:p-8"
      onPointerDown={(e) => e.target === e.currentTarget && useEditor.getState().select(undefined)}
    >
      <div style={{ width }}>{children}</div>
    </div>
  );
}

function SpeakerNotes({ slideId, notes }: { slideId: string; notes: string }) {
  const [text, setText] = useState(notes);
  useEffect(() => setText(notes), [notes]);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== notes && commit({ type: "set_slide", slideId, notes: text || null })}
      placeholder="Click to add speaker notes"
      rows={2}
      className="mx-4 mb-3 shrink-0 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-violet-400 lg:mx-8"
    />
  );
}

function EmptyDeck({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-bold tracking-tight">What are we presenting?</h2>
      <p className="text-sm text-slate-500">Ask Muse for a deck and watch it build live, or add a slide from the rail.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {KINDS.slides.suggestions.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm transition hover:border-violet-400 hover:text-violet-700">
            {s}
          </button>
        ))}
      </div>
      <NewSlideButton />
    </div>
  );
}
