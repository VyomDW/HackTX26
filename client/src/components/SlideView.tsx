import { motion } from "framer-motion";
import type { Slide } from "@hacktx/shared";
import { cn } from "@/lib/utils";
import { useDeck } from "@/store/deck";

/** Fixed 1280x720 canvas, scaled by the parent. Elements get stable ids for animation and cursor targeting. */
export function SlideView({ slide }: { slide: Slide }) {
  const focus = useDeck((s) => s.focus);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="absolute inset-0 flex flex-col gap-4 p-[5%]">
        {slide.elements.map((el) => {
          const focused = focus?.slideId === slide.id && focus.elementId === el.id;
          return (
            <motion.div
              key={el.id}
              id={el.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("rounded-md transition-shadow", focused && "ring-2 ring-violet-500")}
            >
              {el.kind === "text" ? (
                <p className={cn("whitespace-pre-line", el.id.endsWith("-title") ? "text-3xl font-semibold" : "text-lg")}>
                  {el.text}
                </p>
              ) : el.url ? (
                <img src={el.url} alt={el.prompt} className="max-h-64 rounded-md object-cover" />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                  Generating: {el.prompt}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      {slide.citations.length > 0 && (
        <ol className="absolute bottom-2 left-[5%] text-xs text-muted-foreground">
          {slide.citations.map((c, i) => (
            <li key={c.id}>
              [{i + 1}] <a href={c.url} target="_blank" rel="noreferrer" className="underline">{c.source}</a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
