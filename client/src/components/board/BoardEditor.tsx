import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  RotateCw,
  ArrowRight,
  Copy,
  Download,
  Hand,
  Maximize,
  MousePointer2,
  PaintBucket,
  PenLine,
  Redo2,
  Shapes,
  Spline,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  FIXTURE_SIZES,
  isBlueprintShape,
  nodeDefaults,
  STICKY_COLORS,
  type Fixture,
  type Board,
  type BoardEdge,
  type BoardNode,
  type BoardTemplate,
  type Field,
  type NodeShape,
  type ServiceIcon,
  type UserOp,
} from "@hacktx/shared";
import { redoMine, undoMine } from "@/lib/actions";
import {
  arrowHead,
  boundsOf,
  center,
  DEFAULT_ROUTE,
  DEFAULT_SHAPE,
  edgePath,
  strokePath,
  TIDY_DIRECTION,
  toMermaid,
  toSql,
  type Box,
  type Pt,
} from "@/lib/board";
import { shortId, SWATCHES } from "@/lib/canvas";
import { download, safeName } from "@/lib/download";
import { cn } from "@/lib/utils";
import { isBusy, useDoc } from "@/store/deck";
import { commit } from "@/store/editor";
import { MenuItem, Sep, Tool } from "../DocEditor";
import { MusePointer } from "../SlideView";
import { Popover } from "../ui/popover";
import { Dimensions, PAPER, roomSchedule } from "./Blueprint";
import { BoardNodeView, SERVICE_ICONS } from "./BoardNodeView";
import { drawStyle, Pen, penKeys, perimeterPath, scribblePath, usePenDrawings } from "./PenDraw";

type ToolName = "select" | "hand" | "sticky" | "text" | "shape" | "connect" | "pen";
interface View {
  x: number;
  y: number;
  z: number;
}
interface Selection {
  nodes: string[];
  edge?: string;
  stroke?: string;
}

const FIXTURE_LABEL: Record<Fixture, string> = {
  bed: "Bed",
  sofa: "Sofa",
  table: "Dining table",
  desk: "Desk",
  chair: "Chair",
  toilet: "Toilet",
  tub: "Bathtub",
  shower: "Shower",
  sink: "Sink",
  stove: "Stove",
  fridge: "Fridge",
  counter: "Counter",
  plant: "Plant",
  car: "Car",
};

const SHAPE_PALETTE: Record<BoardTemplate, { shape: NodeShape; label: string; icon?: ServiceIcon; fixture?: Fixture }[]> = {
  blueprint: [
    { shape: "room", label: "Room" },
    { shape: "wall", label: "Wall" },
    { shape: "door", label: "Door" },
    { shape: "window", label: "Window" },
    { shape: "stairs", label: "Stairs" },
    { shape: "text", label: "Label" },
    ...(Object.keys(FIXTURE_SIZES) as Fixture[]).map((fixture) => ({ shape: "fixture" as const, label: FIXTURE_LABEL[fixture], fixture })),
  ],
  whiteboard: [
    { shape: "image", label: "AI drawing" },
    { shape: "sticky", label: "Sticky note" },
    { shape: "rect", label: "Rectangle" },
    { shape: "ellipse", label: "Ellipse" },
    { shape: "diamond", label: "Diamond" },
    { shape: "frame", label: "Frame" },
    { shape: "text", label: "Text" },
  ],
  flowchart: [
    { shape: "pill", label: "Start / end" },
    { shape: "rect", label: "Process" },
    { shape: "diamond", label: "Decision" },
    { shape: "parallelogram", label: "Input / output" },
    { shape: "cylinder", label: "Data store" },
    { shape: "hexagon", label: "Preparation" },
    { shape: "frame", label: "Swimlane" },
  ],
  architecture: [
    ...(Object.keys(SERVICE_ICONS) as ServiceIcon[]).map((icon) => ({ shape: "service" as const, label: SERVICE_ICONS[icon].label, icon })),
    { shape: "frame", label: "Boundary" },
  ],
  erd: [
    { shape: "table", label: "Table" },
    { shape: "frame", label: "Group" },
    { shape: "text", label: "Note" },
  ],
  mindmap: [
    { shape: "image", label: "AI drawing" },
    { shape: "rounded", label: "Topic" },
    { shape: "ellipse", label: "Idea" },
    { shape: "sticky", label: "Sticky" },
    { shape: "text", label: "Text" },
  ],
};

const SHAPE_LABEL: Record<NodeShape, string> = {
  sticky: "Sticky",
  rect: "Rectangle",
  rounded: "Rounded",
  pill: "Pill",
  ellipse: "Ellipse",
  diamond: "Diamond",
  parallelogram: "Parallelogram",
  cylinder: "Cylinder",
  hexagon: "Hexagon",
  text: "Text",
  frame: "Frame",
  table: "Table",
  service: "Service",
  image: "AI drawing",
  room: "Room",
  wall: "Wall",
  door: "Door",
  window: "Window",
  stairs: "Stairs",
  fixture: "Furniture",
};

const newId = (p: string) => `${p}-${shortId()}${shortId().slice(0, 2)}`;
const CLIP = "hacktx-board:";
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Parses "name type pk" lines into table columns. */
const parseFields = (text: string): Field[] =>
  text
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p[0])
    .map(([name, type = "text", key]) => ({ name: name!, type, ...(key === "pk" || key === "fk" ? { key } : {}) }) as Field);
const fieldsText = (fields: Field[] = []) => fields.map((f) => [f.name, f.type, f.key].filter(Boolean).join(" ")).join("\n");

/** Miro / FigJam style canvas: whiteboards, flowcharts, architecture diagrams, ER diagrams and mind maps. */
export function BoardEditor({ board }: { board: Board }) {
  const template = board.template ?? "whiteboard";
  const blueprint = template === "blueprint";
  /** Blueprints snap to 6 inches (10 units at 20 per foot). */
  const snap = (v: number) => (blueprint ? Math.round(v / 10) * 10 : Math.round(v));
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 80, y: 80, z: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [animate, setAnimate] = useState(false);
  const [tool, setTool] = useState<ToolName>("select");
  const [stamp, setStamp] = useState<{ shape: NodeShape; icon?: ServiceIcon; fixture?: Fixture }>({ shape: DEFAULT_SHAPE[template] });
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]!);
  const [penColor, setPenColor] = useState("#0f172a");
  const [sel, setSel] = useState<Selection>({ nodes: [] });
  const [editing, setEditing] = useState<{ kind: "node" | "edge" | "fields"; id: string }>();
  const [moving, setMoving] = useState<Record<string, Box>>();
  const [ghost, setGhost] = useState<{ from: string; to: Pt }>();
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt }>();
  const [drawing, setDrawing] = useState<number[]>();
  const [hover, setHover] = useState<string>();
  const [panning, setPanning] = useState(false);
  const flash = useDoc((s) => (s.flash && !s.flash.slideId && !s.flash.targets ? s.flash : undefined));
  const aiTarget = useDoc((s) => (isBusy(s) && s.focus?.elementId && !s.focus.slideId && !s.focus.targets ? s.focus.elementId : undefined));
  const drawings = usePenDrawings();
  const drawingOf = useMemo(() => new Map(drawings.map((d) => [d.id, d])), [drawings]);

  const boxOf = useCallback((n: BoardNode): BoardNode => (moving?.[n.id] ? { ...n, ...moving[n.id] } : n), [moving]);
  const nodes = useMemo(() => board.nodes.map(boxOf), [board.nodes, boxOf]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selected = sel.nodes.map((id) => byId.get(id)).filter((n): n is BoardNode => !!n);
  const single = selected.length === 1 ? selected[0] : undefined;
  const selEdge = board.edges.find((e) => e.id === sel.edge);

  const toWorld = (cx: number, cy: number): Pt => {
    const r = ref.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  };

  const fit = useCallback((smooth = false) => {
    const el = ref.current;
    const b = boundsOf(board);
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (!b) return setView({ x: vw / 2 - 300, y: vh / 2 - 200, z: 1 });
    const z = Math.max(0.15, Math.min(1.2, (vw - 120) / Math.max(b.w, 1), (vh - 120) / Math.max(b.h, 1)));
    setAnimate(smooth);
    setView({ x: (vw - b.w * z) / 2 - b.x * z, y: (vh - b.h * z) / 2 - b.y * z, z });
  }, [board]);

  // Fit once the board first renders.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fit();
  }, [fit]);

  // While the AI builds, keep whatever it just touched in view by refitting when it lands off-screen.
  useEffect(() => {
    if (!aiTarget || !ref.current) return;
    const n = board.nodes.find((x) => x.id === aiTarget);
    if (!n) return;
    const v = viewRef.current;
    const sx = n.x * v.z + v.x;
    const sy = n.y * v.z + v.y;
    const { clientWidth: vw, clientHeight: vh } = ref.current;
    if (sx < 20 || sy < 20 || sx + n.w * v.z > vw - 20 || sy + n.h * v.z > vh - 20) fit(true);
  }, [aiTarget, flash?.key, board.nodes, fit]);

  // Wheel: pinch / ctrl-scroll zooms around the pointer, plain scroll pans (native listener so it can preventDefault).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setAnimate(false);
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const z = Math.max(0.1, Math.min(4, v.z * Math.exp(-e.deltaY * 0.01)));
        setView({ z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z });
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f: number) => {
    const el = ref.current!;
    const v = viewRef.current;
    const z = Math.max(0.1, Math.min(4, v.z * f));
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    setAnimate(true);
    setView({ z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z });
  };

  /** Follows one pointer gesture until release. */
  const track = (e: ReactPointerEvent, onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent, moved: boolean) => void) => {
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      moved = true;
      onMove(ev);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onUp(ev, moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const makeNode = (shape: NodeShape, at: Pt, extra: Partial<BoardNode> = {}): { id: string; op: UserOp } => {
    const fields = shape === "table" ? (extra.fields ?? [{ name: "id", type: "uuid", key: "pk" as const }]) : undefined;
    const fixture = shape === "fixture" ? (extra.fixture ?? stamp.fixture ?? "table") : undefined;
    const d = nodeDefaults(shape, fields, fixture);
    const id = newId("n");
    const op: UserOp = {
      type: "add_node",
      id,
      shape,
      x: snap(at.x - d.w / 2),
      y: snap(at.y - d.h / 2),
      text: shape === "table" ? "table_name" : shape === "frame" ? "Frame" : shape === "room" ? "Room" : "",
      ...(fixture ? { fixture } : {}),
      ...(shape === "sticky" ? { fill: stickyColor } : {}),
      ...(shape === "service" ? { icon: stamp.icon ?? "server", text: SERVICE_ICONS[stamp.icon ?? "server"].label } : {}),
      ...(fields ? { fields } : {}),
      ...extra,
    } as UserOp;
    return { id, op };
  };

  const createAt = (shape: NodeShape, at: Pt, extra?: Partial<BoardNode>) => {
    const { id, op } = makeNode(shape, at, extra);
    commit(op);
    setSel({ nodes: [id] });
    if (!["service", "table", "wall", "door", "window", "stairs", "fixture"].includes(shape)) setEditing({ kind: "node", id });
    setTool("select");
    return id;
  };

  const nodeAtPoint = (cx: number, cy: number) => (document.elementFromPoint(cx, cy) as HTMLElement | null)?.closest<HTMLElement>("[data-node]")?.dataset.node;

  const startConnect = (e: ReactPointerEvent, from: string) => {
    e.stopPropagation();
    track(
      e,
      (ev) => setGhost({ from, to: toWorld(ev.clientX, ev.clientY) }),
      (ev, moved) => {
        setGhost(undefined);
        if (!moved) return;
        const target = nodeAtPoint(ev.clientX, ev.clientY);
        const edge = { ...DEFAULT_ROUTE[template] };
        if (target && target !== from) {
          const id = newId("e");
          commit({ type: "add_edge", id, from, to: target, ...edge });
          setSel({ nodes: [], edge: id });
          return;
        }
        if (target) return;
        // Dropping on empty canvas creates a connected node there, like Miro.
        const src = byId.get(from);
        const shape = src && src.shape !== "frame" && src.shape !== "text" ? (src.shape === "pill" ? "rect" : src.shape) : DEFAULT_SHAPE[template];
        const { id, op } = makeNode(shape, toWorld(ev.clientX, ev.clientY), src?.shape === "service" ? { icon: src.icon ?? "server", text: "" } : {});
        commit(op, { type: "add_edge", id: newId("e"), from, to: id, ...edge });
        setSel({ nodes: [id] });
        if (shape !== "table") setEditing({ kind: "node", id });
      },
    );
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-ui]")) return;
    const el = e.target as HTMLElement;
    const nodeId = el.closest<HTMLElement>("[data-node]")?.dataset.node;
    const edgeId = el.closest<HTMLElement>("[data-edge]")?.dataset.edge;
    const strokeId = el.closest<HTMLElement>("[data-stroke]")?.dataset.stroke;
    const at = toWorld(e.clientX, e.clientY);

    // Pan: hand tool or middle button. (Space is reserved for push-to-talk.)
    if (tool === "hand" || e.button === 1) {
      const v0 = viewRef.current;
      setAnimate(false);
      setPanning(true);
      track(
        e,
        (ev) => setView({ ...v0, x: v0.x + ev.clientX - e.clientX, y: v0.y + ev.clientY - e.clientY }),
        () => setPanning(false),
      );
      return;
    }
    if (e.button !== 0) return;

    if (tool === "pen") {
      const pts = [Math.round(at.x), Math.round(at.y)];
      setDrawing(pts);
      track(
        e,
        (ev) => {
          const p = toWorld(ev.clientX, ev.clientY);
          if (pts.length < 3998) pts.push(Math.round(p.x), Math.round(p.y));
          setDrawing([...pts]);
        },
        () => {
          setDrawing(undefined);
          commit({ type: "add_stroke", stroke: { id: newId("s"), points: pts, color: penColor, width: 3 } } as UserOp);
        },
      );
      return;
    }

    if (nodeId && editing?.id === nodeId) return;

    if (nodeId) {
      if (tool === "connect") return startConnect(e, nodeId);
      if (tool !== "select") return;
      let ids = sel.nodes;
      if (e.shiftKey) ids = ids.includes(nodeId) ? ids.filter((x) => x !== nodeId) : [...ids, nodeId];
      else if (!ids.includes(nodeId)) ids = [nodeId];
      setSel({ nodes: ids });
      setEditing(undefined);
      // Dragging a frame carries the nodes sitting inside it.
      const carry = new Set(ids);
      for (const id of ids) {
        const f = byId.get(id);
        if (f?.shape !== "frame") continue;
        for (const n of board.nodes) {
          const c = center(n);
          if (n.id !== f.id && c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h) carry.add(n.id);
        }
      }
      const orig = new Map(board.nodes.filter((n) => carry.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
      let last: Record<string, Box> = {};
      track(
        e,
        (ev) => {
          const v = viewRef.current;
          const dx = (ev.clientX - e.clientX) / v.z;
          const dy = (ev.clientY - e.clientY) / v.z;
          last = Object.fromEntries([...orig].map(([id, b]) => [id, { ...b, x: snap(b.x + dx), y: snap(b.y + dy) }]));
          setMoving(last);
        },
        (_ev, moved) => {
          setMoving(undefined);
          if (moved) commit(...Object.entries(last).map(([id, b]) => ({ type: "set_node", id, x: b.x, y: b.y }) as UserOp));
        },
      );
      return;
    }

    if (edgeId && tool === "select") {
      setSel({ nodes: [], edge: edgeId });
      setEditing(undefined);
      return;
    }
    if (strokeId && tool === "select") {
      setSel({ nodes: [], stroke: strokeId });
      return;
    }

    // Empty canvas.
    setEditing(undefined);
    if (tool === "sticky") return void createAt("sticky", at);
    if (tool === "text") return void createAt("text", at);
    if (tool === "shape")
      return void createAt(stamp.shape, at, stamp.icon ? { icon: stamp.icon, text: SERVICE_ICONS[stamp.icon].label } : stamp.fixture ? { fixture: stamp.fixture } : {});
    if (tool !== "select") return;
    if (!e.shiftKey) setSel({ nodes: [] });
    const base = e.shiftKey ? sel.nodes : [];
    track(
      e,
      (ev) => setMarquee({ a: at, b: toWorld(ev.clientX, ev.clientY) }),
      (ev, moved) => {
        setMarquee(undefined);
        if (!moved) return;
        const b = toWorld(ev.clientX, ev.clientY);
        const x0 = Math.min(at.x, b.x);
        const x1 = Math.max(at.x, b.x);
        const y0 = Math.min(at.y, b.y);
        const y1 = Math.max(at.y, b.y);
        const hit = board.nodes.filter((n) => n.x >= x0 && n.y >= y0 && n.x + n.w <= x1 && n.y + n.h <= y1).map((n) => n.id);
        setSel({ nodes: [...new Set([...base, ...hit])] });
      },
    );
  };

  const startResize = (e: ReactPointerEvent, n: BoardNode) => {
    e.stopPropagation();
    const o = { x: n.x, y: n.y, w: n.w, h: n.h };
    let last = o;
    track(
      e,
      (ev) => {
        const v = viewRef.current;
        const min = blueprint ? 8 : 30;
        let w = Math.max(min, o.w + (ev.clientX - e.clientX) / v.z);
        let h = Math.max(min, o.h + (ev.clientY - e.clientY) / v.z);
        if (ev.shiftKey) {
          const k = Math.max(w / o.w, h / o.h);
          w = o.w * k;
          h = o.h * k;
        }
        last = { ...o, w: Math.max(blueprint ? 8 : 10, snap(w)), h: Math.max(blueprint ? 8 : 10, snap(h)) };
        setMoving({ [n.id]: last });
      },
      (_ev, moved) => {
        setMoving(undefined);
        if (moved) commit({ type: "set_node", id: n.id, w: last.w, h: last.h });
      },
    );
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-ui]")) return;
    const el = e.target as HTMLElement;
    const nodeId = el.closest<HTMLElement>("[data-node]")?.dataset.node;
    const edgeId = el.closest<HTMLElement>("[data-edge]")?.dataset.edge;
    if (nodeId) {
      const n = byId.get(nodeId);
      const inFields = n?.shape === "table" && toWorld(e.clientX, e.clientY).y > n.y + 44;
      setSel({ nodes: [nodeId] });
      setEditing({ kind: inFields ? "fields" : "node", id: nodeId });
    } else if (edgeId) {
      setSel({ nodes: [], edge: edgeId });
      setEditing({ kind: "edge", id: edgeId });
    } else if (tool === "select") createAt(DEFAULT_SHAPE[template], toWorld(e.clientX, e.clientY));
  };

  const deleteSelection = () => {
    if (sel.edge) commit({ type: "delete_edge", id: sel.edge });
    else if (sel.stroke) commit({ type: "delete_stroke", id: sel.stroke } as UserOp);
    else if (sel.nodes.length) commit(...sel.nodes.map((id) => ({ type: "delete_node", id }) as UserOp));
    setSel({ nodes: [] });
  };

  /** Copies nodes (and the connectors between them) with fresh ids, offset so the copy is visible. */
  const pasteNodes = (src: BoardNode[], edges: BoardEdge[], offset = 40) => {
    const ids = new Map(src.map((n) => [n.id, newId("n")]));
    const ops: UserOp[] = src.map((n) => {
      const { id: _id, ...rest } = n;
      return { type: "add_node", id: ids.get(n.id)!, ...rest, x: n.x + offset, y: n.y + offset } as UserOp;
    });
    for (const e of edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) continue;
      const { id: _id, ...rest } = e;
      ops.push({ type: "add_edge", ...rest, id: newId("e"), from: ids.get(e.from)!, to: ids.get(e.to)! } as UserOp);
    }
    if (!ops.length) return;
    commit(...ops);
    setSel({ nodes: [...ids.values()] });
  };

  // Keyboard shortcuts and clipboard, active while this editor is mounted.
  const state = useRef({ sel, selected, board, editing });
  state.current = { sel, selected, board, editing };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.type !== "keydown" || isTyping(e.target)) return;
      const { sel, selected, board } = state.current;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (mod && k === "z") return run(e.shiftKey ? redoMine : undoMine);
      if (mod && k === "y") return run(redoMine);
      if (mod && k === "a") return run(() => setSel({ nodes: board.nodes.map((n) => n.id) }));
      if (mod && k === "d") return run(() => pasteNodes(selected, board.edges));
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") return run(deleteSelection);
      if (e.key === "Escape") return run(() => (setSel({ nodes: [] }), setTool("select")));
      if (e.key === "Enter" && selected.length === 1) return run(() => setEditing({ kind: "node", id: selected[0]!.id }));
      const step = e.shiftKey ? 20 : 2;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key] && sel.nodes.length)
        return run(() => commit(...selected.map((n) => ({ type: "set_node", id: n.id, x: n.x + arrows[e.key]![0], y: n.y + arrows[e.key]![1] }) as UserOp)));
      const tools: Record<string, ToolName> = { v: "select", h: "hand", s: "sticky", t: "text", r: "shape", c: "connect", p: "pen" };
      if (tools[k]) return run(() => setTool(tools[k]!));
    };
    const onCopy = (e: ClipboardEvent) => {
      const { selected, board } = state.current;
      if (isTyping(e.target) || !selected.length || !e.clipboardData) return;
      const ids = new Set(selected.map((n) => n.id));
      e.clipboardData.setData("text/plain", CLIP + JSON.stringify({ nodes: selected, edges: board.edges.filter((x) => ids.has(x.from) && ids.has(x.to)) }));
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData) return;
      const text = e.clipboardData.getData("text/plain");
      e.preventDefault();
      if (text.startsWith(CLIP)) {
        try {
          const data = JSON.parse(text.slice(CLIP.length)) as { nodes: BoardNode[]; edges: BoardEdge[] };
          pasteNodes(data.nodes, data.edges);
        } catch {
          // ignore malformed clipboard
        }
      } else if (text.trim()) {
        const el = ref.current!;
        const v = viewRef.current;
        createAt("sticky", { x: (el.clientWidth / 2 - v.x) / v.z, y: (el.clientHeight / 2 - v.y) / v.z }, { text: text.slice(0, 500) });
        setEditing(undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  });

  const patchSelected = (fields: Partial<Record<keyof BoardNode, unknown>>) => commit(...selected.map((n) => ({ type: "set_node", id: n.id, ...fields }) as UserOp));
  const frames = nodes.filter((n) => n.shape === "frame");
  const others = nodes.filter((n) => n.shape !== "frame");
  const cursor = panning ? "grabbing" : tool === "hand" ? "grab" : tool === "pen" ? "crosshair" : tool === "select" ? "default" : "copy";

  const nodeEl = (n: BoardNode) => (
    <div
      key={n.id}
      data-node={n.id}
      className={cn("absolute", tool === "select" && editing?.id !== n.id && "cursor-move", tool === "connect" && "cursor-crosshair")}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
      onPointerEnter={() => setHover(n.id)}
      onPointerLeave={() => setHover((h) => (h === n.id ? undefined : h))}
    >
      {(() => {
        const d = drawingOf.get(n.id);
        const view = (
          <BoardNodeView
            node={n}
            highlighted={flash?.elementId === n.id}
            drawMs={d?.kind === "outline" ? d.ms : undefined}
            editor={editing?.kind === "node" && editing.id === n.id ? <TextEditor node={n} onDone={() => setEditing(undefined)} /> : undefined}
          />
        );
        // Everything without an outline to trace gets wiped in behind the pen instead.
        if (d?.kind !== "reveal" && d?.kind !== "image") return view;
        return (
          <div key={`draw:${d.key}`} className="absolute inset-0" style={drawStyle(d.kind === "image" ? "pen-wipe-y" : "pen-wipe-x", d.ms)}>
            {view}
          </div>
        );
      })()}
      {flash?.elementId === n.id && !penKeys.has(flash.key) && <span key={flash.key} className="cell-flash pointer-events-none absolute -inset-2 rounded-xl" />}
      {aiTarget === n.id && (
        <span className="pointer-events-none absolute left-full top-1/2 z-10 ml-1 whitespace-nowrap" style={{ transform: `scale(${1 / view.z})`, transformOrigin: "top left" }}>
          <MusePointer />
        </span>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="ink-bar flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]">
        <Tool icon={Undo2} label="Undo (⌘Z)" onClick={undoMine} />
        <Tool icon={Redo2} label="Redo (⌘⇧Z)" onClick={redoMine} />
        <Sep />
        <Tool icon={MousePointer2} label="Select (V)" active={tool === "select"} onClick={() => setTool("select")} />
        <Tool icon={Hand} label="Pan (H), or scroll" active={tool === "hand"} onClick={() => setTool("hand")} />
        <Tool icon={StickyNote} label="Sticky note (S)" active={tool === "sticky"} onClick={() => setTool("sticky")} />
        <Tool icon={Type} label="Text (T)" active={tool === "text"} onClick={() => setTool("text")} />
        <Popover trigger={() => <Tool icon={Shapes} label="Shape (R)" text={stamp.fixture ? FIXTURE_LABEL[stamp.fixture] : SHAPE_LABEL[stamp.shape]} active={tool === "shape"} />}>
          {(close) => (
            <div className="grid w-64 grid-cols-2 gap-1 text-sm">
              {SHAPE_PALETTE[template].map((s) => (
                <button
                  key={s.label}
                  onClick={() => {
                    setStamp({ shape: s.shape, icon: s.icon, fixture: s.fixture });
                    setTool("shape");
                    close();
                  }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100"
                >
                  {s.fixture ? <span className="size-3 shrink-0 rounded-full border-2 border-current opacity-60" /> : s.icon ? (() => {
                    const I = SERVICE_ICONS[s.icon].icon;
                    return <I className="size-4 shrink-0" style={{ color: SERVICE_ICONS[s.icon].tint }} />;
                  })() : <span className="size-3 shrink-0 rounded-sm border-2 border-current opacity-60" />}
                  <span className="truncate">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </Popover>
        <Tool icon={Spline} label="Connector (C): drag from one node to another" active={tool === "connect"} onClick={() => setTool("connect")} />
        <Tool icon={PenLine} label="Pen (P)" active={tool === "pen"} onClick={() => setTool("pen")} />
        {tool === "pen" && (
          <div className="flex items-center gap-1 pl-1">
            {["#0f172a", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#9333ea"].map((c) => (
              <button key={c} onClick={() => setPenColor(c)} className={cn("size-5 rounded-full ring-1 ring-black/10", penColor === c && "ring-2 ring-violet-500")} style={{ background: c }} />
            ))}
          </div>
        )}
        {tool === "sticky" && (
          <div className="flex items-center gap-1 pl-1">
            {STICKY_COLORS.map((c) => (
              <button key={c} onClick={() => setStickyColor(c)} className={cn("size-5 rounded ring-1 ring-black/10", stickyColor === c && "ring-2 ring-violet-500")} style={{ background: c }} />
            ))}
          </div>
        )}

        {selected.length > 0 && (
          <>
            <Sep />
            <ColorPop
              icon={PaintBucket}
              label="Fill"
              colors={single?.shape === "sticky" ? STICKY_COLORS : SWATCHES}
              value={single?.fill}
              onPick={(fill) => patchSelected({ fill })}
            />
            <ColorPop icon={Type} label="Text color" colors={SWATCHES} value={single?.textColor} onPick={(textColor) => patchSelected({ textColor })} />
            <ColorPop icon={Spline} label="Border" colors={SWATCHES} value={single?.stroke} onPick={(stroke) => patchSelected({ stroke })} />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => patchSelected({ fontSize: Math.max(8, (single?.fontSize ?? 16) - 2) })}
              className="h-8 shrink-0 rounded-md px-1.5 text-xs hover:bg-slate-100"
              title="Smaller text"
            >
              A−
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => patchSelected({ fontSize: Math.min(120, (single?.fontSize ?? 16) + 2) })}
              className="h-8 shrink-0 rounded-md px-1.5 text-sm hover:bg-slate-100"
              title="Larger text"
            >
              A+
            </button>
            {single && (isBlueprintShape(single.shape) || single.shape === "text") && blueprint && (
              <Tool
                icon={RotateCw}
                label="Rotate 90°"
                onClick={() =>
                  // Walls, windows and rooms are axis-aligned boxes, so rotating swaps their sides; drawings turn about their centre.
                  ["wall", "window", "room"].includes(single.shape)
                    ? commit({ type: "set_node", id: single.id, w: single.h, h: single.w })
                    : commit({ type: "set_node", id: single.id, rotate: ((single.rotate ?? 0) + 90) % 360 })
                }
              />
            )}
            {single?.shape === "fixture" && (
              <select
                value={single.fixture ?? "table"}
                onChange={(e) => {
                  const fixture = e.target.value as Fixture;
                  const [w, h] = FIXTURE_SIZES[fixture];
                  commit({ type: "set_node", id: single.id, fixture, w, h });
                }}
                className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
                title="Furniture"
              >
                {(Object.keys(FIXTURE_SIZES) as Fixture[]).map((f) => (
                  <option key={f} value={f}>
                    {FIXTURE_LABEL[f]}
                  </option>
                ))}
              </select>
            )}
            {single && !isBlueprintShape(single.shape) && !["service", "table", "frame", "image"].includes(single.shape) && (
              <select
                value={single.shape}
                onChange={(e) => commit({ type: "set_node", id: single.id, shape: e.target.value as NodeShape })}
                className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
                title="Shape"
              >
                {(["sticky", "rect", "rounded", "pill", "ellipse", "diamond", "parallelogram", "cylinder", "hexagon", "text"] as NodeShape[]).map((s) => (
                  <option key={s} value={s}>
                    {SHAPE_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
            {single?.shape === "service" && (
              <select
                value={single.icon ?? "server"}
                onChange={(e) => commit({ type: "set_node", id: single.id, icon: e.target.value as ServiceIcon })}
                className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
                title="Component type"
              >
                {(Object.keys(SERVICE_ICONS) as ServiceIcon[]).map((i) => (
                  <option key={i} value={i}>
                    {SERVICE_ICONS[i].label}
                  </option>
                ))}
              </select>
            )}
            {single?.shape === "image" && (
              <>
                <button onClick={() => setEditing({ kind: "node", id: single.id })} className="h-8 shrink-0 rounded-md px-2 text-xs hover:bg-slate-100">
                  Describe
                </button>
                <Tool icon={WandSparkles} label="Redraw with Nodepad" text="Redraw" onClick={() => commit({ type: "set_node", id: single.id, url: null })} />
              </>
            )}
            {single?.shape === "table" && (
              <button onClick={() => setEditing({ kind: "fields", id: single.id })} className="h-8 shrink-0 rounded-md px-2 text-xs hover:bg-slate-100">
                Edit columns
              </button>
            )}
            <Tool icon={Copy} label="Duplicate (⌘D)" onClick={() => pasteNodes(selected, board.edges)} />
            <Tool icon={Trash2} label="Delete" onClick={deleteSelection} />
          </>
        )}

        {selEdge && (
          <>
            <Sep />
            <select
              value={selEdge.route ?? "straight"}
              onChange={(e) => commit({ type: "set_edge", id: selEdge.id, route: e.target.value as BoardEdge["route"] })}
              className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
              title="Line style"
            >
              <option value="straight">Straight</option>
              <option value="elbow">Elbow</option>
              <option value="curve">Curved</option>
            </select>
            <select
              value={selEdge.arrow ?? "end"}
              onChange={(e) => commit({ type: "set_edge", id: selEdge.id, arrow: e.target.value as BoardEdge["arrow"] })}
              className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
              title="Arrows"
            >
              <option value="end">→ Arrow</option>
              <option value="both">↔ Both ends</option>
              <option value="none">— No arrow</option>
            </select>
            <Tool icon={ArrowRight} label="Dashed" text="Dashed" active={selEdge.dashed} onClick={() => commit({ type: "set_edge", id: selEdge.id, dashed: !selEdge.dashed })} />
            <ColorPop icon={Spline} label="Line color" colors={SWATCHES} value={selEdge.color} onPick={(color) => commit({ type: "set_edge", id: selEdge.id, color })} />
            <button onClick={() => setEditing({ kind: "edge", id: selEdge.id })} className="h-8 shrink-0 rounded-md px-2 text-xs hover:bg-slate-100">
              Label
            </button>
            <Tool icon={Trash2} label="Delete connector" onClick={deleteSelection} />
          </>
        )}
        {sel.stroke && (
          <>
            <Sep />
            <Tool icon={Trash2} label="Delete drawing" onClick={deleteSelection} />
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">
          {!blueprint && <Tool
            icon={WandSparkles}
            label="Tidy up: arrange automatically"
            text="Tidy up"
            onClick={() => {
              commit({ type: "auto_layout", direction: TIDY_DIRECTION[template], ...(sel.nodes.length > 1 ? { nodeIds: sel.nodes } : {}) });
              setTimeout(() => fit(true), 60);
            }}
          />}
          <Popover trigger={() => <Tool icon={Download} label="Export" text="Export" />}>
            {(close) => (
              <div className="flex w-52 flex-col text-sm">
                {blueprint && (
                  <MenuItem
                    onClick={() => {
                      download(`${safeName(board.title)} - room schedule.csv`, roomSchedule(board), "text/csv");
                      close();
                    }}
                  >
                    Room schedule (.csv)
                  </MenuItem>
                )}
                {!blueprint && <MenuItem
                  onClick={() => {
                    void navigator.clipboard?.writeText(toMermaid(board));
                    close();
                  }}
                >
                  Copy as Mermaid
                </MenuItem>}
                {!blueprint && <MenuItem
                  onClick={() => {
                    download(`${safeName(board.title)}.mmd`, toMermaid(board), "text/plain");
                    close();
                  }}
                >
                  Mermaid file (.mmd)
                </MenuItem>}
                {board.nodes.some((n) => n.shape === "table") && (
                  <MenuItem
                    onClick={() => {
                      download(`${safeName(board.title)}.sql`, toSql(board), "application/sql");
                      close();
                    }}
                  >
                    SQL schema (.sql)
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    download(`${safeName(board.title)}.json`, JSON.stringify(board, null, 2), "application/json");
                    close();
                  }}
                >
                  JSON
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        className="paper relative min-h-0 flex-1 touch-none select-none overflow-hidden"
        style={{
          // Graph paper on every board; blueprints use a 1 ft minor and 5 ft major grid so squares read as feet.
          cursor,
          backgroundColor: PAPER.backgroundColor,
          backgroundImage: [
            ...(blueprint ? [`linear-gradient(${PAPER.major} 1px, transparent 1px)`, `linear-gradient(90deg, ${PAPER.major} 1px, transparent 1px)`] : []),
            `linear-gradient(${blueprint ? PAPER.minor : PAPER.major} 1px, transparent 1px)`,
            `linear-gradient(90deg, ${blueprint ? PAPER.minor : PAPER.major} 1px, transparent 1px)`,
          ].join(","),
          backgroundSize: (blueprint ? [100, 100, 20, 20] : [32, 32]).map((u) => `${u * view.z}px ${u * view.z}px`).join(", "),
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div
          className={cn("absolute left-0 top-0 origin-top-left", animate && "transition-transform duration-500 ease-out")}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
          onTransitionEnd={() => setAnimate(false)}
        >
          {frames.map(nodeEl)}

          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {board.edges.map((e) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const p = edgePath(a, b, e.route);
              const color = e.color ?? "#475569";
              const on = sel.edge === e.id;
              const d = drawingOf.get(e.id);
              // A dashed line can't trace with a dash offset, so it fades in under the pen instead.
              const trace = d ? (e.dashed ? drawStyle("pen-fade", d.ms) : drawStyle("pen-trace", d.ms)) : undefined;
              const tip = d ? drawStyle("pen-fade", 150, d.ms - 100) : undefined;
              return (
                <g key={d ? `${e.id}:${d.key}` : e.id} data-edge={e.id} className="pointer-events-auto cursor-pointer">
                  <path d={p.d} fill="none" stroke="transparent" strokeWidth={16} />
                  <path
                    d={p.d}
                    fill="none"
                    stroke={on ? "#7c3aed" : color}
                    strokeWidth={on ? 3 : 2}
                    strokeDasharray={e.dashed ? "7 6" : undefined}
                    pathLength={d && !e.dashed ? 1 : undefined}
                    style={trace}
                  />
                  {(e.arrow ?? "end") !== "none" && <polygon points={arrowHead(p.end, p.endDir)} fill={on ? "#7c3aed" : color} style={tip} />}
                  {e.arrow === "both" && <polygon points={arrowHead(p.start, p.startDir)} fill={on ? "#7c3aed" : color} style={d ? drawStyle("pen-fade", 150) : undefined} />}
                </g>
              );
            })}
            {board.strokes.map((s) => (
              <g key={s.id} data-stroke={s.id} className="pointer-events-auto cursor-pointer">
                <path d={strokePath(s.points)} fill="none" stroke="transparent" strokeWidth={s.width + 12} strokeLinecap="round" />
                <path
                  d={strokePath(s.points)}
                  pathLength={drawingOf.has(s.id) ? 1 : undefined}
                  style={drawingOf.has(s.id) ? drawStyle("pen-trace", drawingOf.get(s.id)!.ms) : undefined}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={sel.stroke === s.id ? "drop-shadow-[0_0_4px_rgba(124,58,237,0.9)]" : undefined}
                />
              </g>
            ))}
            {drawing && <path d={strokePath(drawing)} fill="none" stroke={penColor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
            {ghost &&
              (() => {
                const a = byId.get(ghost.from);
                if (!a) return null;
                const p = edgePath(a, { x: ghost.to.x, y: ghost.to.y, w: 1, h: 1 }, "straight");
                return (
                  <>
                    <path d={p.d} fill="none" stroke="#7c3aed" strokeWidth={2} strokeDasharray="6 5" />
                    <polygon points={arrowHead(p.end, p.endDir)} fill="#7c3aed" />
                  </>
                );
              })()}
          </svg>

          {others.map(nodeEl)}

          {/* Edge labels sit above nodes so they stay readable. */}
          {board.edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b || (!e.label && !(editing?.kind === "edge" && editing.id === e.id))) return null;
            const p = edgePath(a, b, e.route);
            return (
              <div
                key={e.id}
                data-edge={e.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer whitespace-nowrap rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[13px] font-medium text-slate-700 shadow-sm"
                style={{ left: p.label.x, top: p.label.y, ...(drawingOf.has(e.id) ? drawStyle("pen-fade", 250, drawingOf.get(e.id)!.ms) : {}) }}
              >
                {editing?.kind === "edge" && editing.id === e.id ? <EdgeLabelEditor edge={e} onDone={() => setEditing(undefined)} /> : e.label}
              </div>
            );
          })}

          {/* Turns a sketch's white paper transparent (alpha from darkness), since blend modes can't see through the transformed canvas. */}
          <svg className="absolute size-0">
            <filter id="muse-ink" colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1.6 -1.6 -1.6 4.8 0" />
            </filter>
          </svg>

          {/* Nodepad's pen follows whatever it drew last. */}
          {(() => {
            const d = drawings[drawings.length - 1];
            if (!d) return null;
            let path: string | undefined;
            if (d.kind === "edge") {
              const e = board.edges.find((x) => x.id === d.id);
              const a = e && byId.get(e.from);
              const b = e && byId.get(e.to);
              if (e && a && b) path = edgePath(a, b, e.route).d;
            } else if (d.kind === "stroke") {
              const s = board.strokes.find((x) => x.id === d.id);
              if (s) path = strokePath(s.points);
            } else {
              const n = byId.get(d.id);
              if (n) path = d.kind === "outline" ? perimeterPath(n) : scribblePath(n, d.kind === "image");
            }
            return path ? <Pen key={d.key} path={path} ms={d.ms} zoom={view.z} /> : null;
          })()}

          {/* Selection outlines, resize handle and connection handles. */}
          {selected.map((n) => (
            <div key={n.id} className="pointer-events-none absolute rounded-md ring-2 ring-violet-500" style={{ left: n.x - 4, top: n.y - 4, width: n.w + 8, height: n.h + 8 }}>
              {single && editing?.id !== n.id && (
                <span
                  data-ui
                  onPointerDown={(e) => startResize(e, n)}
                  className="pointer-events-auto absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border-2 border-violet-500 bg-white"
                  style={{ transform: `scale(${1 / view.z})` }}
                />
              )}
            </div>
          ))}
          {tool === "select" &&
            !moving &&
            !editing &&
            [hover, ...(single ? [single.id] : [])].filter((id, i, a): id is string => !!id && a.indexOf(id) === i).map((id) => {
              const n = byId.get(id);
              if (!n || n.shape === "frame" || n.shape === "text" || isBlueprintShape(n.shape)) return null;
              return (["n", "e", "s", "w"] as const).map((side) => {
                const p = { n: { x: n.x + n.w / 2, y: n.y - 14 }, e: { x: n.x + n.w + 14, y: n.y + n.h / 2 }, s: { x: n.x + n.w / 2, y: n.y + n.h + 14 }, w: { x: n.x - 14, y: n.y + n.h / 2 } }[side];
                return (
                  <span
                    key={id + side}
                    data-ui
                    title="Drag to connect"
                    onPointerEnter={() => setHover(id)}
                    onPointerDown={(e) => startConnect(e, id)}
                    className="absolute grid size-4 -translate-x-1/2 -translate-y-1/2 cursor-crosshair place-items-center rounded-full bg-violet-500 text-[10px] font-bold leading-none text-white opacity-80 shadow hover:opacity-100"
                    style={{ left: p.x, top: p.y, transform: `translate(-50%, -50%) scale(${1 / view.z})` }}
                  >
                    +
                  </span>
                );
              });
            })}
          {blueprint && single && isBlueprintShape(single.shape) && <Dimensions node={single} zoom={view.z} />}
          {marquee && (
            <div
              className="pointer-events-none absolute border border-violet-500 bg-violet-500/10"
              style={{ left: Math.min(marquee.a.x, marquee.b.x), top: Math.min(marquee.a.y, marquee.b.y), width: Math.abs(marquee.b.x - marquee.a.x), height: Math.abs(marquee.b.y - marquee.a.y) }}
            />
          )}
          {editing?.kind === "fields" && byId.get(editing.id) && <FieldsEditor node={byId.get(editing.id)!} onDone={() => setEditing(undefined)} />}
        </div>

        {board.nodes.length === 0 && board.strokes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center text-slate-400">
              <div className="text-lg font-semibold text-slate-500">
                Empty {template === "erd" ? "schema" : template === "blueprint" ? "floor plan" : template === "architecture" ? "system diagram" : template}
              </div>
              <div className="mt-1 text-sm">Double-click to add a {SHAPE_LABEL[DEFAULT_SHAPE[template]].toLowerCase()}, or ask Nodepad to build it.</div>
            </div>
          </div>
        )}

        <div data-ui className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 text-slate-600 shadow-sm">
          <button onClick={() => zoomBy(1 / 1.2)} className="grid size-7 place-items-center rounded hover:bg-slate-100" title="Zoom out">
            <ZoomOut className="size-4" />
          </button>
          <button onClick={() => (setAnimate(true), setView((v) => ({ ...v, z: 1 })))} className="w-12 text-xs tabular-nums hover:text-slate-900" title="Reset zoom">
            {Math.round(view.z * 100)}%
          </button>
          <button onClick={() => zoomBy(1.2)} className="grid size-7 place-items-center rounded hover:bg-slate-100" title="Zoom in">
            <ZoomIn className="size-4" />
          </button>
          <button onClick={() => fit(true)} className="grid size-7 place-items-center rounded hover:bg-slate-100" title="Fit to content">
            <Maximize className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TextEditor({ node, onDone }: { node: BoardNode; onDone: () => void }) {
  const [text, setText] = useState(node.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [text]);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    if (text !== node.text) commit({ type: "set_node", id: node.id, text });
    onDone();
  };
  return (
    <textarea
      ref={ref}
      value={text}
      rows={1}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) finish();
      }}
      className="block w-full resize-none overflow-hidden bg-transparent text-center outline-none"
      style={{ font: "inherit", color: "inherit", lineHeight: "inherit", textAlign: node.shape === "text" || node.shape === "frame" || node.shape === "table" ? "left" : "center" }}
    />
  );
}

function EdgeLabelEditor({ edge, onDone }: { edge: BoardEdge; onDone: () => void }) {
  const [text, setText] = useState(edge.label ?? "");
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    if (text !== (edge.label ?? "")) commit({ type: "set_edge", id: edge.id, label: text || null });
    onDone();
  };
  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") finish();
      }}
      size={Math.max(4, text.length + 1)}
      className="bg-transparent text-center outline-none"
    />
  );
}

function FieldsEditor({ node, onDone }: { node: BoardNode; onDone: () => void }) {
  const [text, setText] = useState(fieldsText(node.fields));
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    const fields = parseFields(text);
    commit({ type: "set_node", id: node.id, fields, h: 44 + Math.max(1, fields.length) * 30 });
    onDone();
  };
  return (
    <div data-ui className="absolute z-10 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-lg" style={{ left: node.x + node.w + 16, top: node.y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-1 text-xs font-medium text-slate-500">One column per line: name type [pk|fk]</div>
      <textarea
        autoFocus
        value={text}
        rows={Math.max(4, text.split("\n").length + 1)}
        onChange={(e) => setText(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) finish();
        }}
        className="w-full resize-none rounded border border-slate-200 p-2 font-mono text-xs outline-none focus:border-violet-400"
        placeholder={"id uuid pk\nemail text\nteam_id uuid fk"}
      />
    </div>
  );
}

function ColorPop({ icon, label, colors, value, onPick }: { icon: typeof Type; label: string; colors: string[]; value?: string; onPick: (c: string | null) => void }) {
  const Icon = icon;
  return (
    <Popover
      trigger={() => (
        <button onMouseDown={(e) => e.preventDefault()} title={label} className="relative flex h-8 shrink-0 items-center rounded-md px-1.5 hover:bg-slate-100">
          <Icon className="size-4" />
          <span className="absolute inset-x-1.5 bottom-1 h-[3px] rounded-full ring-1 ring-black/10" style={{ background: value ?? "transparent" }} />
        </button>
      )}
    >
      {(close) => (
        <div className="w-56 space-y-2">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="grid grid-cols-7 gap-1">
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => {
                  onPick(c);
                  close();
                }}
                className={cn("size-6 rounded-md ring-1 ring-black/10 transition hover:scale-110", value === c && "ring-2 ring-violet-500")}
                style={{ background: c }}
              />
            ))}
          </div>
          <button
            onClick={() => {
              onPick(null);
              close();
            }}
            className="w-full rounded-md px-1.5 py-1 text-left text-xs hover:bg-slate-100"
          >
            Reset
          </button>
        </div>
      )}
    </Popover>
  );
}
