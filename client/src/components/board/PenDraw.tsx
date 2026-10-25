import { useEffect, useState, type CSSProperties } from "react";
import { PencilLine } from "lucide-react";
import { isBlueprintShape, type BoardNode, type NodeShape } from "@hacktx/shared";
import { useDoc } from "@/store/deck";

/**
 * How a freshly drawn item animates in:
 * outline traces the shape's border then fills, reveal wipes left to right like handwriting,
 * image hatches in top to bottom, and edge/stroke trace their own path.
 */
export type DrawKind = "outline" | "reveal" | "image" | "edge" | "stroke";
export interface Drawing {
  id: string;
  key: string;
  kind: DrawKind;
  ms: number;
}

const OUTLINED = new Set<NodeShape>(["rect", "rounded", "pill", "ellipse", "diamond", "parallelogram", "cylinder", "hexagon"]);
const MS: Record<DrawKind, number> = { outline: 750, reveal: 650, image: 1700, edge: 520, stroke: 900 };

/** Ops the pen drew; their violet change-flash is redundant, so the board skips it. */
export const penKeys = new Set<string>();

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Tracks what the AI is drawing right now, from the ops as they play back. Newest last. */
export function usePenDrawings(): Drawing[] {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsub = useDoc.subscribe((s, prev) => {
      // Playback appends one op at a time; a snapshot replaces history wholesale and shouldn't animate.
      if (s.history.length !== prev.history.length + 1 || reducedMotion()) return;
      const env = s.history[s.history.length - 1]!;
      if (env.actor !== "ai" || env.undoes) return;
      const op = env.op;
      let d: Omit<Drawing, "key" | "ms"> | undefined;
      if (op.type === "add_node") {
        const node = s.doc.kind === "board" ? s.doc.nodes.find((n) => n.id === op.id) : undefined;
        if (!node) return;
        // An image without a url is only a placeholder; it gets drawn when its picture lands.
        if (node.shape === "image") d = node.url ? { id: op.id, kind: "image" } : undefined;
        else d = { id: op.id, kind: OUTLINED.has(node.shape) && !isBlueprintShape(node.shape) ? "outline" : "reveal" };
      } else if (op.type === "set_node" && op.url) d = { id: op.id, kind: "image" };
      else if (op.type === "add_edge") d = { id: op.id, kind: "edge" };
      else if (op.type === "add_stroke") d = { id: op.stroke.id, kind: "stroke" };
      if (!d) return;
      const drawing = { ...d, key: env.opId, ms: MS[d.kind] };
      penKeys.add(drawing.key);
      setDrawings((all) => [...all.filter((x) => x.id !== drawing.id), drawing]);
      const t = setTimeout(() => {
        timers.delete(t);
        setDrawings((all) => all.filter((x) => x.key !== drawing.key));
      }, drawing.ms + 400);
      timers.add(t);
    });
    return () => {
      unsub();
      timers.forEach(clearTimeout);
    };
  }, []);
  return drawings;
}

/** Inline style that plays a draw animation once. */
export const drawStyle = (name: string, ms: number, delay = 0): CSSProperties => ({ animation: `${name} ${ms}ms ease-in-out ${delay}ms both` });

/** Path the pen tip follows around a node's border, in canvas units. */
export function perimeterPath(n: BoardNode): string {
  const { x, y, w, h } = n;
  if (n.shape === "ellipse") return `M ${x + w / 2} ${y} A ${w / 2} ${h / 2} 0 1 1 ${x + w / 2 - 0.1} ${y}`;
  if (n.shape === "diamond") return `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${y + h} L ${x} ${y + h / 2} Z`;
  return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
}

/** A scribble across a box: left to right for handwriting, or row by row downward for a sketch. */
export function scribblePath(n: BoardNode, downward: boolean): string {
  const { x, y, w, h } = n;
  const pts: string[] = [];
  if (downward) {
    const rows = Math.max(4, Math.min(9, Math.round(h / 40)));
    for (let i = 0; i <= rows; i++) {
      const yy = y + (h * i) / rows;
      pts.push(i % 2 ? `${x + w} ${yy}` : `${x} ${yy}`);
    }
  } else {
    const steps = Math.max(4, Math.min(16, Math.round(w / 24)));
    for (let i = 0; i <= steps; i++) pts.push(`${x + (w * i) / steps} ${y + h * (i % 2 ? 0.75 : 0.3)}`);
  }
  return `M ${pts.join(" L ")}`;
}

/** Nodepad's pen, gliding along the path it is drawing. Lives in canvas units; `zoom` keeps it a constant on-screen size. */
export function Pen({ path, ms, zoom }: { path: string; ms: number; zoom: number }) {
  const size = 30 / zoom;
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-50"
      style={{
        width: size,
        height: size,
        offsetPath: `path("${path}")`,
        offsetRotate: "0deg",
        // The pencil's tip is its bottom-left corner.
        offsetAnchor: "6% 94%",
        animation: `pen-move ${ms}ms ease-in-out both, pen-lift 300ms ease-out ${ms}ms both`,
      }}
    >
      <PencilLine className="size-full fill-white text-orange-600 drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)]" strokeWidth={2} />
    </div>
  );
}
