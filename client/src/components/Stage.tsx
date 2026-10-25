import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CANVAS_H, CANVAS_W, type Box, type Element, type Slide } from "@hacktx/shared";
import * as act from "@/lib/actions";
import { u } from "@/lib/canvas";
import { cn } from "@/lib/utils";
import { commit, useEditor } from "@/store/editor";
import { boxStyle, SlideView } from "./SlideView";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const SNAP = 6;

/** The editable slide: selection, drag with snap guides, resize, rotate and in-place text editing. */
export function Stage({ slide }: { slide: Slide }) {
  const ref = useRef<HTMLDivElement>(null);
  const selectedId = useEditor((s) => s.selectedId);
  const editingId = useEditor((s) => s.editingId);
  const { select, edit } = useEditor.getState();
  const [drag, setDrag] = useState<{ id: string; box: Box }>();
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

  const selected = slide.elements.find((e) => e.id === selectedId);
  const unitsPerPx = () => CANVAS_W / (ref.current?.getBoundingClientRect().width || CANVAS_W);

  /** Tracks a pointer gesture in canvas units until release. */
  const track = (e: ReactPointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onUp: (moved: boolean) => void) => {
    const start = { x: e.clientX, y: e.clientY };
    const k = unitsPerPx();
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      onMove((ev.clientX - start.x) * k, (ev.clientY - start.y) * k, ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onUp(moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startMove = (e: ReactPointerEvent, el: Element) => {
    if (e.button !== 0 || editingId === el.id) return;
    e.stopPropagation();
    const wasSelected = selectedId === el.id;
    select(el.id);
    const orig = el.box;
    let last = orig;
    track(
      e,
      (dx, dy, ev) => {
        const snapped = ev.altKey ? { x: orig.x + dx, y: orig.y + dy, gx: [], gy: [] } : snapMove(slide, el.id, { ...orig, x: orig.x + dx, y: orig.y + dy });
        last = { ...orig, x: Math.round(snapped.x), y: Math.round(snapped.y) };
        setGuides({ x: snapped.gx, y: snapped.gy });
        setDrag({ id: el.id, box: last });
      },
      (moved) => {
        setGuides({ x: [], y: [] });
        setDrag(undefined);
        if (moved) commit({ type: "set_box", slideId: slide.id, elementId: el.id, x: last.x, y: last.y });
        // A second click on a selected text box starts typing, as in Slides.
        else if (wasSelected && el.kind !== "image") edit(el.id);
      },
    );
  };

  const startResize = (e: ReactPointerEvent, el: Element, handle: Handle) => {
    e.stopPropagation();
    const orig = el.box;
    const rad = ((orig.rotate ?? 0) * Math.PI) / 180;
    let last = orig;
    track(
      e,
      (dx, dy, ev) => {
        // Work in the element's own (rotated) axes.
        const lx = dx * Math.cos(rad) + dy * Math.sin(rad);
        const ly = -dx * Math.sin(rad) + dy * Math.cos(rad);
        const corner = handle.length === 2;
        const keepRatio = corner && (ev.shiftKey || el.kind === "image");
        last = resizeBox(orig, handle, lx, ly, keepRatio);
        setDrag({ id: el.id, box: last });
      },
      (moved) => {
        setDrag(undefined);
        if (moved) commit({ type: "set_box", slideId: slide.id, elementId: el.id, x: last.x, y: last.y, w: last.w, h: last.h });
      },
    );
  };

  const startRotate = (e: ReactPointerEvent, el: Element) => {
    e.stopPropagation();
    const node = ref.current?.querySelector(`[data-el="${CSS.escape(el.id)}"]`);
    const r = node?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let angle = el.box.rotate ?? 0;
    track(
      e,
      (_dx, _dy, ev) => {
        angle = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
        angle = ev.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle);
        const nearest = Math.round(angle / 90) * 90;
        if (Math.abs(angle - nearest) < 4) angle = nearest;
        angle = ((angle % 360) + 360) % 360;
        setDrag({ id: el.id, box: { ...el.box, rotate: angle } });
      },
      (moved) => {
        setDrag(undefined);
        if (moved) commit({ type: "set_box", slideId: slide.id, elementId: el.id, rotate: angle });
      },
    );
  };

  const toCanvas = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * CANVAS_W, y: ((clientY - r.top) / r.height) * CANVAS_H };
  };

  const frameBox = selected && (drag?.id === selected.id ? drag.box : selected.box);

  return (
    <div
      ref={ref}
      className="ink-page taped relative w-full"
      onPointerDown={() => select(undefined)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void act.insertImages(e.dataTransfer.files, toCanvas(e.clientX, e.clientY));
      }}
    >
      <SlideView
        slide={slide}
        live
        overrides={drag ? { [drag.id]: drag.box } : undefined}
        elementProps={(el) => ({
          onPointerDown: (e) => startMove(e, el),
          onDoubleClick: () => el.kind !== "image" && edit(el.id),
          className: cn(
            editingId === el.id ? "cursor-text" : "cursor-move",
            selectedId !== el.id && "outline outline-1 -outline-offset-1 outline-transparent hover:outline-violet-300",
          ),
        })}
        renderText={(el) => (el.id === editingId && el.kind !== "image" ? <TextEditor slideId={slide.id} element={el} /> : undefined)}
        overlay={
          <div className="pointer-events-none absolute inset-0">
            {guides.x.map((x) => (
              <div key={`x${x}`} className="absolute top-0 h-full w-px bg-pink-500" style={{ left: u(x) }} />
            ))}
            {guides.y.map((y) => (
              <div key={`y${y}`} className="absolute left-0 h-px w-full bg-pink-500" style={{ top: u(y) }} />
            ))}
            {selected && frameBox && (
              <div className="absolute" style={boxStyle(frameBox)}>
                <div className={cn("absolute -inset-px border-2", editingId ? "border-violet-400/60" : "border-violet-500")} />
                {!editingId &&
                  HANDLES.map((h) => (
                    <div
                      key={h}
                      onPointerDown={(e) => startResize(e, selected, h)}
                      className="pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-violet-500 bg-white"
                      style={{ ...handlePos(h), cursor: `${h}-resize` }}
                    />
                  ))}
                {!editingId && (
                  <div
                    onPointerDown={(e) => startRotate(e, selected)}
                    title="Rotate (Shift snaps to 15°)"
                    className="pointer-events-auto absolute -top-7 left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full border-2 border-violet-500 bg-white"
                  />
                )}
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}

const handlePos = (h: Handle) => ({
  left: h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%",
  top: h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%",
});

function resizeBox(o: Box, h: Handle, dx: number, dy: number, keepRatio: boolean): Box {
  let { x, y, w, h: ht } = o;
  if (h.includes("e")) w = o.w + dx;
  if (h.includes("s")) ht = o.h + dy;
  if (h.includes("w")) w = o.w - dx;
  if (h.includes("n")) ht = o.h - dy;
  w = Math.max(10, w);
  ht = Math.max(10, ht);
  if (keepRatio) {
    const ratio = o.w / o.h;
    if (w / ht > ratio) ht = w / ratio;
    else w = ht * ratio;
  }
  if (h.includes("w")) x = o.x + o.w - w;
  if (h.includes("n")) y = o.y + o.h - ht;
  return { ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(ht) };
}

/** Snaps a moving box's edges and centre to the canvas and to other elements, returning guide lines to draw. */
function snapMove(slide: Slide, id: string, box: Box) {
  const others = slide.elements.filter((e) => e.id !== id && !e.box.rotate);
  const tx = [0, CANVAS_W / 2, CANVAS_W, ...others.flatMap((e) => [e.box.x, e.box.x + e.box.w / 2, e.box.x + e.box.w])];
  const ty = [0, CANVAS_H / 2, CANVAS_H, ...others.flatMap((e) => [e.box.y, e.box.y + e.box.h / 2, e.box.y + e.box.h])];
  const axis = (pos: number, size: number, targets: number[]) => {
    let best: { delta: number; line: number } | undefined;
    for (const edge of [0, size / 2, size]) {
      for (const t of targets) {
        const delta = t - (pos + edge);
        if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line: t };
      }
    }
    return best;
  };
  const sx = axis(box.x, box.w, tx);
  const sy = axis(box.y, box.h, ty);
  return { x: box.x + (sx?.delta ?? 0), y: box.y + (sy?.delta ?? 0), gx: sx ? [sx.line] : [], gy: sy ? [sy.line] : [] };
}

/** In-place text editing; commits when focus leaves or Escape is pressed. */
function TextEditor({ slideId, element }: { slideId: string; element: Element }) {
  const original = element.kind === "image" ? "" : (element.text ?? "");
  const [text, setText] = useState(original);
  const ref = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(original);
  latest.current = text;
  const done = useRef(false);

  const save = () => {
    if (done.current) return;
    done.current = true;
    if (latest.current !== original) commit({ type: "set_text", slideId, elementId: element.id, text: latest.current });
  };
  const finish = () => {
    save();
    if (useEditor.getState().editingId === element.id) useEditor.getState().edit(undefined);
  };

  useEffect(() => {
    done.current = false; // StrictMode runs this effect twice in dev, cleanup included.
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
    // Clicking straight onto another element unmounts this editor before blur fires.
    return save;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") finish();
        e.stopPropagation();
      }}
      className="h-full w-full resize-none overflow-hidden bg-transparent outline-none"
      style={{ font: "inherit", color: "inherit", textAlign: "inherit", lineHeight: "inherit", textDecoration: "inherit", letterSpacing: "inherit" }}
    />
  );
}
