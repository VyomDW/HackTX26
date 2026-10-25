import { useEffect, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { themeOf, type Box, type Element, type ShapeKind, type Slide, type Style } from "@hacktx/shared";
import { richText, u } from "@/lib/canvas";
import { cn } from "@/lib/utils";
import { selectDeck, useDeck } from "@/store/deck";
import { useEditor } from "@/store/editor";
import { ThemeDecor } from "./ThemeDecor";

export interface SlideViewProps {
  slide: Slide;
  /** Stage gets the live effects (typing, highlight, AI cursor) and placeholders for empty boxes. */
  live?: boolean;
  /** Temporary boxes while an element is being dragged or resized. */
  overrides?: Record<string, Box>;
  /** Replaces an element's text with custom content, used for in-place editing. */
  renderText?: (el: Element) => ReactNode | undefined;
  elementProps?: (el: Element) => HTMLAttributes<HTMLDivElement>;
  /** Drawn above the slide without clipping, for selection handles. */
  overlay?: ReactNode;
  className?: string;
}

/**
 * A 1280x720 canvas drawn with container query units, so the same component renders
 * the stage, thumbnails, presenter view and print pages at any width.
 */
export function SlideView({ slide, live = false, overrides, renderText, elementProps, overlay, className }: SlideViewProps) {
  const theme = themeOf(useDeck((s) => selectDeck(s).theme));
  return (
    <div className={cn("@container relative aspect-video w-full select-none", className)}>
      <div className="absolute inset-0 overflow-hidden" style={{ background: slide.background ?? theme.background }}>
        {/* A slide with its own background opts out of the theme's decorations too. */}
        {!slide.background && <ThemeDecor theme={theme} />}
        {slide.elements.map((el) => (
          <ElementView
            key={el.id}
            slideId={slide.id}
            element={el}
            box={overrides?.[el.id] ?? el.box}
            live={live}
            custom={renderText?.(el)}
            {...elementProps?.(el)}
          />
        ))}
        {slide.citations.length > 0 && (
          <ol className="absolute" style={{ left: u(60), bottom: u(16), fontSize: u(13), color: theme.muted }}>
            {slide.citations.map((c, i) => (
              <li key={c.id}>
                [{i + 1}]{" "}
                <a href={c.url} target="_blank" rel="noreferrer" className="underline">
                  {c.source}
                </a>
              </li>
            ))}
          </ol>
        )}
      </div>
      {live && <AiCursor slide={slide} />}
      {overlay}
    </div>
  );
}

export const boxStyle = (box: Box): CSSProperties => ({
  left: u(box.x),
  top: u(box.y),
  width: u(box.w),
  height: u(box.h),
  transform: box.rotate ? `rotate(${box.rotate}deg)` : undefined,
});

export const textStyle = (s: Style): CSSProperties => ({
  fontFamily: s.fontFamily ? `"${s.fontFamily}", ui-sans-serif, system-ui` : undefined,
  fontSize: u(s.fontSize ?? 24),
  color: s.color ?? "#0f172a",
  fontWeight: s.bold ? 700 : 400,
  fontStyle: s.italic ? "italic" : undefined,
  textDecoration: [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") || undefined,
  textAlign: s.align ?? "left",
  lineHeight: s.lineHeight ?? 1.25,
  justifyContent: s.valign === "middle" ? "center" : s.valign === "bottom" ? "flex-end" : "flex-start",
});

type ElementViewProps = {
  slideId: string;
  element: Element;
  box: Box;
  live: boolean;
  custom?: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

function ElementView({ slideId, element, box, live, custom, className, style, ...rest }: ElementViewProps) {
  const flash = useDeck((s) => (live && s.flash?.slideId === slideId && s.flash.elementId === element.id ? s.flash : undefined));
  const st = element.style;
  const isText = element.kind === "text";

  return (
    <motion.div
      data-el={element.id}
      initial={live ? { opacity: 0, scale: 0.98 } : false}
      animate={{ opacity: st.opacity ?? 1, scale: 1 }}
      className={cn("absolute", className)}
      // Rotation goes through framer's own transform so it composes with the entrance scale.
      style={{ ...boxStyle(box), transform: undefined, rotate: box.rotate ?? 0, ...style }}
      {...(rest as object)}
    >
      <AnimatePresence>
        {flash && (
          <motion.span
            key={flash.key}
            className="pointer-events-none absolute z-10 rounded-[0.4cqw] bg-[#fde047]/30 ring-[0.25cqw] ring-[#ea580c]/80"
            style={{ inset: u(-8) }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.4, delay: flash.typeMs / 1000, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      {element.kind === "shape" && <ShapeSvg shape={element.shape} w={box.w} h={box.h} style={st} />}

      {element.kind === "image" && (
        <div
          className="h-full w-full overflow-hidden"
          style={{ borderRadius: u(st.radius ?? 0), border: st.strokeWidth ? `${u(st.strokeWidth)} solid ${st.stroke ?? "#0f172a"}` : undefined }}
        >
          {element.url ? (
            <img src={element.url} alt={element.prompt} draggable={false} className="h-full w-full" style={{ objectFit: st.fit ?? "cover" }} />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-[1cqw] bg-gradient-to-br from-violet-100 via-slate-100 to-amber-50 p-[2cqw] text-center">
              <span className="text-[1.3cqw] font-semibold uppercase tracking-wider text-violet-500">Image</span>
              <span className="text-[1.5cqw] text-slate-500">{element.prompt}</span>
            </div>
          )}
        </div>
      )}

      {element.kind !== "image" && (
        <div
          className="relative flex h-full w-full flex-col whitespace-pre-wrap break-words"
          style={{
            ...textStyle(st),
            padding: u(isText ? 4 : 16),
            ...(isText
              ? {
                  background: st.fill,
                  borderRadius: u(st.radius ?? 0),
                  border: st.strokeWidth ? `${u(st.strokeWidth)} solid ${st.stroke ?? "#0f172a"}` : undefined,
                }
              : {}),
          }}
        >
          {custom ?? <TextBody text={element.text ?? ""} live={live} flashKey={flash?.typeMs ? flash.key : undefined} ms={flash?.typeMs ?? 0} placeholder={isText} />}
        </div>
      )}
    </motion.div>
  );
}

/** Reveals text character by character whenever flashKey changes; otherwise shows it whole. */
function TextBody({ text, live, flashKey, ms, placeholder }: { text: string; live: boolean; flashKey?: string; ms: number; placeholder: boolean }) {
  const [shown, setShown] = useState(flashKey ? 0 : text.length);

  useEffect(() => {
    if (!flashKey || ms <= 0) {
      setShown(text.length);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const n = Math.ceil(((now - start) / ms) * text.length);
      setShown(Math.min(n, text.length));
      if (n < text.length) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [flashKey, text, ms]);

  if (!text && live && placeholder) return <span className="text-slate-300">Click to add text</span>;
  return (
    <div>
      {richText(text.slice(0, shown))}
      {shown < text.length && <span className="ml-[0.2cqw] inline-block h-[1em] w-[0.25cqw] translate-y-[0.15em] animate-pulse bg-[#ea580c]" />}
    </div>
  );
}

function ShapeSvg({ shape, w, h, style }: { shape: ShapeKind; w: number; h: number; style: Style }) {
  const fill = style.fill ?? "#8b5cf6";
  const sw = style.strokeWidth ?? 0;
  const stroke = sw ? (style.stroke ?? "#0f172a") : "none";
  const common = { fill, stroke, strokeWidth: sw, strokeLinejoin: "round" as const };
  const i = sw / 2;
  let node: ReactNode;
  switch (shape) {
    case "rect":
      node = <rect x={i} y={i} width={w - sw} height={h - sw} {...common} />;
      break;
    case "rounded": {
      const r = style.radius ?? Math.min(w, h) * 0.18;
      node = <rect x={i} y={i} width={w - sw} height={h - sw} rx={r} {...common} />;
      break;
    }
    case "ellipse":
      node = <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - i} ry={h / 2 - i} {...common} />;
      break;
    case "triangle":
      node = <polygon points={`${w / 2},${i} ${w - i},${h - i} ${i},${h - i}`} {...common} />;
      break;
    case "diamond":
      node = <polygon points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`} {...common} />;
      break;
    case "star": {
      const pts = Array.from({ length: 10 }, (_, k) => {
        const a = (Math.PI / 5) * k - Math.PI / 2;
        const r = k % 2 ? 0.4 : 1;
        return `${w / 2 + Math.cos(a) * r * (w / 2 - i)},${h / 2 + Math.sin(a) * r * (h / 2 - i) + h * 0.04}`;
      });
      node = <polygon points={pts.join(" ")} {...common} />;
      break;
    }
    case "line":
    case "arrow": {
      // Lines are drawn with the fill color so a fresh one is visible without setting a border.
      const lw = Math.max(sw, 6);
      const color = style.stroke && sw ? style.stroke : fill;
      const head = Math.min(h, lw * 4, w / 3);
      node = (
        <>
          <line x1={0} y1={h / 2} x2={shape === "arrow" ? w - head : w} y2={h / 2} stroke={color} strokeWidth={lw} strokeLinecap="round" />
          {shape === "arrow" && <polygon points={`${w},${h / 2} ${w - head},${h / 2 - head / 1.6} ${w - head},${h / 2 + head / 1.6}`} fill={color} />}
        </>
      );
      break;
    }
  }
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {node}
    </svg>
  );
}

/** The AI's pointer: a labelled cursor that glides to whatever it is editing. */
function AiCursor({ slide }: { slide: Slide }) {
  const focus = useDeck((s) => s.focus);
  const busy = useDeck((s) => s.aiStatus !== "idle" || s.pending > 0);
  if (focus?.slideId !== slide.id) return null;
  const box = slide.elements.find((e) => e.id === focus.elementId)?.box;
  const x = box ? Math.min(box.x + box.w, 1200) : 1100;
  const y = box ? box.y + Math.min(box.h, 60) / 2 : 70;

  return (
    <motion.div
      className="pointer-events-none absolute left-0 top-0 z-20"
      initial={false}
      animate={{ left: u(x), top: u(y), opacity: busy ? 1 : 0.4 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <MusePointer />
    </motion.div>
  );
}

/** nodepad's cursor: a pen nib with its name signed beside it; the nib's tip sits at the top-left corner. */
export function MusePointer() {
  return (
    <span className="flex items-start whitespace-nowrap">
      <svg width="24" height="24" viewBox="0 0 24 24" className="rotate-90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]" aria-hidden>
        <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" fill="white" stroke="#ea580c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="hand mt-4 text-[20px] font-bold leading-none text-[#ea580c]">nodepad</span>
    </span>
  );
}
