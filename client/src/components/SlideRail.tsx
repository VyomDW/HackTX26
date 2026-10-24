import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { Layout } from "@hacktx/shared";
import * as act from "@/lib/actions";
import { cn } from "@/lib/utils";
import { isBusy, useDeck } from "@/store/deck";
import { commit, useEditor } from "@/store/editor";
import { SlideView } from "./SlideView";
import { Popover } from "./ui/popover";

const LAYOUTS: { layout: Layout; label: string }[] = [
  { layout: "title", label: "Title slide" },
  { layout: "bullets", label: "Title and body" },
  { layout: "image-left", label: "Image and text" },
  { layout: "image-full", label: "Full image" },
  { layout: "quote", label: "Quote" },
  { layout: "blank", label: "Blank" },
];

/** Slide thumbnails: click to open, drag to reorder, hover for duplicate/delete. */
export function SlideRail() {
  const deck = useDeck((s) => s.deck);
  const focus = useDeck((s) => s.focus);
  const busy = useDeck(isBusy);
  const slideId = useEditor((s) => s.slideId);
  const current = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];
  const [dragging, setDragging] = useState<string>();
  const [dropAt, setDropAt] = useState<number>();

  return (
    <nav className="order-2 flex shrink-0 flex-col border-slate-200 bg-white lg:order-none lg:w-52 lg:border-r">
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 lg:flex-col lg:overflow-y-auto lg:p-4">
        {deck.slides.map((slide, i) => (
          <div
            key={slide.id}
            draggable
            onDragStart={(e) => {
              setDragging(slide.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const after = window.matchMedia("(min-width: 1024px)").matches ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
              setDropAt(after ? i + 1 : i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && dropAt !== undefined) {
                const from = deck.slides.findIndex((s) => s.id === dragging);
                const toIndex = dropAt > from ? dropAt - 1 : dropAt;
                if (toIndex !== from) commit({ type: "reorder_slide", slideId: dragging, toIndex });
              }
              setDragging(undefined);
              setDropAt(undefined);
            }}
            onDragEnd={() => {
              setDragging(undefined);
              setDropAt(undefined);
            }}
            className={cn("group relative flex w-36 shrink-0 gap-2 lg:w-full", dragging === slide.id && "opacity-40")}
          >
            {dropAt === i && <DropLine />}
            <span className="w-4 pt-1 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
            <button
              onClick={() => useEditor.getState().setSlide(slide.id)}
              className={cn(
                "relative flex-1 overflow-hidden rounded-md ring-2 transition",
                slide.id === current?.id ? "ring-violet-500" : "ring-slate-200 group-hover:ring-slate-300",
              )}
            >
              <SlideView slide={slide} className="pointer-events-none" />
              {focus?.slideId === slide.id && busy && (
                <span className="absolute right-1 top-1 size-2.5 animate-pulse rounded-full bg-violet-500 ring-2 ring-white" />
              )}
            </button>
            <div className="absolute bottom-1 right-1 hidden gap-0.5 group-hover:flex">
              <RailButton label="Duplicate slide" onClick={() => act.duplicateSlide(slide.id)}>
                <Copy className="size-3" />
              </RailButton>
              <RailButton label="Delete slide" onClick={() => act.deleteSlide(slide.id)}>
                <Trash2 className="size-3" />
              </RailButton>
            </div>
            {dropAt === i + 1 && i === deck.slides.length - 1 && <DropLine after />}
          </div>
        ))}
      </div>
      <div className="hidden border-t border-slate-200 p-3 lg:block">
        <NewSlideButton />
      </div>
    </nav>
  );
}

export function NewSlideButton() {
  return (
    <Popover
      trigger={() => (
        <button className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 py-2 text-sm text-slate-600 hover:border-violet-400 hover:text-violet-700">
          <Plus className="size-4" /> New slide
        </button>
      )}
    >
      {(close) => (
        <div className="flex w-44 flex-col text-sm">
          {LAYOUTS.map((l) => (
            <button
              key={l.layout}
              onClick={() => {
                act.addSlide(l.layout);
                close();
              }}
              className="rounded-md px-2 py-1.5 text-left hover:bg-slate-100"
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function RailButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid size-6 place-items-center rounded bg-white/90 text-slate-600 shadow ring-1 ring-black/10 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

const DropLine = ({ after }: { after?: boolean }) => (
  <div className={cn("absolute left-6 right-0 h-0.5 rounded bg-violet-500 max-lg:hidden", after ? "-bottom-2" : "-top-2")} />
);
