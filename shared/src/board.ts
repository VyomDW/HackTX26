import { z } from "zod";

/**
 * An infinite canvas of nodes, connectors and pen strokes. One engine covers whiteboards, flowcharts,
 * architecture diagrams, database schemas and mind maps; the template only changes defaults and the palette.
 */
export const BoardTemplate = z.enum(["whiteboard", "flowchart", "architecture", "erd", "mindmap", "blueprint"]);
export type BoardTemplate = z.infer<typeof BoardTemplate>;

export const NodeShape = z.enum([
  "sticky",
  "rect",
  "rounded",
  "pill",
  "ellipse",
  "diamond",
  "parallelogram",
  "cylinder",
  "hexagon",
  "text",
  "frame",
  "table",
  "service",
  /** A picture: text is the description, url is filled in once Muse Image has drawn it. */
  "image",
  // Blueprint (floor plan) shapes.
  "room",
  "wall",
  "door",
  "window",
  "stairs",
  "fixture",
]);
export type NodeShape = z.infer<typeof NodeShape>;

/** Icons for architecture "service" nodes. */
export const ServiceIcon = z.enum([
  "client",
  "mobile",
  "user",
  "server",
  "database",
  "cache",
  "queue",
  "storage",
  "function",
  "gateway",
  "cloud",
  "api",
  "auth",
  "cdn",
  "ai",
]);
export type ServiceIcon = z.infer<typeof ServiceIcon>;

/** Furniture and fixtures for floor plans. */
export const Fixture = z.enum(["bed", "sofa", "table", "desk", "chair", "toilet", "tub", "shower", "sink", "stove", "fridge", "counter", "plant", "car"]);
export type Fixture = z.infer<typeof Fixture>;

/** Floor plans are drawn at a fixed scale: 20 canvas units = 1 foot (so the 20-unit grid is a 1 ft grid). */
export const UNITS_PER_FOOT = 20;

export const Field = z.object({
  name: z.string(),
  type: z.string(),
  key: z.enum(["pk", "fk"]).optional(),
});
export type Field = z.infer<typeof Field>;

export const BoardNode = z.object({
  id: z.string(),
  shape: NodeShape,
  x: z.number(),
  y: z.number(),
  w: z.number().min(10),
  h: z.number().min(10),
  text: z.string(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  textColor: z.string().optional(),
  fontSize: z.number().min(6).max(200).optional(),
  icon: ServiceIcon.optional(),
  /** Columns of a database table node. */
  fields: z.array(Field).optional(),
  fixture: Fixture.optional(),
  url: z.string().optional(),
  /** Degrees clockwise (doors, stairs, fixtures). */
  rotate: z.number().optional(),
});
export type BoardNode = z.infer<typeof BoardNode>;

export const EdgeRoute = z.enum(["straight", "elbow", "curve"]);
export const EdgeArrow = z.enum(["end", "both", "none"]);

export const BoardEdge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  route: EdgeRoute.optional(),
  arrow: EdgeArrow.optional(),
  dashed: z.boolean().optional(),
  color: z.string().optional(),
});
export type BoardEdge = z.infer<typeof BoardEdge>;

export const Stroke = z.object({
  id: z.string(),
  /** Flat [x0, y0, x1, y1, ...] in canvas units. */
  points: z.array(z.number()).max(4000),
  color: z.string(),
  width: z.number().min(0.5).max(60),
});
export type Stroke = z.infer<typeof Stroke>;

export const Board = z.object({
  kind: z.literal("board"),
  id: z.string(),
  title: z.string(),
  template: BoardTemplate.optional(),
  /** Painted back to front; frames always render behind other nodes. */
  nodes: z.array(BoardNode),
  edges: z.array(BoardEdge),
  strokes: z.array(Stroke),
});
export type Board = z.infer<typeof Board>;

export const emptyBoard = (id: string): Board => ({ kind: "board", id, title: "Untitled board", nodes: [], edges: [], strokes: [] });

// ---- Ops ----

const NodeFields = {
  shape: NodeShape.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().min(10).optional(),
  h: z.number().min(10).optional(),
  text: z.string().optional(),
  fill: z.string().nullable().optional(),
  stroke: z.string().nullable().optional(),
  textColor: z.string().nullable().optional(),
  fontSize: z.number().min(6).max(200).nullable().optional(),
  icon: ServiceIcon.nullable().optional(),
  fields: z.array(Field).optional(),
  fixture: Fixture.nullable().optional(),
  url: z.string().nullable().optional(),
  rotate: z.number().nullable().optional(),
};

/** Omitted position or size falls back to defaults for the shape (placed right of the existing nodes). */
export const AddNode = z.object({ type: z.literal("add_node"), id: z.string(), ...NodeFields, shape: NodeShape });
export const SetNode = z.object({ type: z.literal("set_node"), id: z.string(), ...NodeFields });
export const DeleteNode = z.object({ type: z.literal("delete_node"), id: z.string() });
export const AddEdge = z.object({
  type: z.literal("add_edge"),
  id: z.string(),
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  route: EdgeRoute.optional(),
  arrow: EdgeArrow.optional(),
  dashed: z.boolean().optional(),
  color: z.string().optional(),
});
export const SetEdge = z.object({
  type: z.literal("set_edge"),
  id: z.string(),
  label: z.string().nullable().optional(),
  route: EdgeRoute.nullable().optional(),
  arrow: EdgeArrow.nullable().optional(),
  dashed: z.boolean().optional(),
  color: z.string().nullable().optional(),
});
export const DeleteEdge = z.object({ type: z.literal("delete_edge"), id: z.string() });
export const AddStroke = z.object({ type: z.literal("add_stroke"), stroke: Stroke });
export const DeleteStroke = z.object({ type: z.literal("delete_stroke"), id: z.string() });
/** Arranges nodes automatically: layered top-to-bottom or left-to-right, or radial for mind maps. */
export const AutoLayout = z.object({ type: z.literal("auto_layout"), direction: z.enum(["TB", "LR", "radial"]), nodeIds: z.array(z.string()).optional() });
export const SetBoard = z.object({ type: z.literal("set_board"), template: BoardTemplate.nullable().optional() });
/** Server-only inverses. */
export const RestoreNode = z.object({ type: z.literal("restore_node"), node: BoardNode, index: z.number().int().min(0), edges: z.array(BoardEdge) });
export const RestoreEdge = z.object({ type: z.literal("restore_edge"), edge: BoardEdge, index: z.number().int().min(0) });
export const SetPositions = z.object({ type: z.literal("set_positions"), positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })) });

// ---- Defaults ----

export const STICKY_COLORS = ["#fef08a", "#fbcfe8", "#bfdbfe", "#bbf7d0", "#fed7aa", "#ddd6fe"];

const SIZES: Record<NodeShape, [number, number]> = {
  sticky: [200, 200],
  rect: [180, 90],
  rounded: [180, 90],
  pill: [180, 64],
  ellipse: [160, 100],
  diamond: [190, 120],
  parallelogram: [200, 90],
  cylinder: [140, 120],
  hexagon: [190, 100],
  text: [260, 60],
  frame: [560, 380],
  table: [240, 0],
  service: [170, 110],
  room: [240, 200],
  wall: [200, 8],
  door: [60, 60],
  window: [60, 8],
  stairs: [80, 200],
  fixture: [60, 60],
  image: [280, 280],
};

/** Real-world sizes (in canvas units at 20 per foot) for furniture. */
export const FIXTURE_SIZES: Record<Fixture, [number, number]> = {
  bed: [100, 134],
  sofa: [140, 60],
  table: [80, 80],
  desk: [100, 50],
  chair: [36, 36],
  toilet: [32, 50],
  tub: [50, 100],
  shower: [64, 64],
  sink: [40, 32],
  stove: [50, 50],
  fridge: [56, 56],
  counter: [200, 40],
  plant: [30, 30],
  car: [120, 300],
};

const BLUEPRINT_SHAPES = new Set<NodeShape>(["room", "wall", "door", "window", "stairs", "fixture"]);
export const isBlueprintShape = (s: NodeShape) => BLUEPRINT_SHAPES.has(s);

/** Size and colors a node gets when created without them. */
export function nodeDefaults(shape: NodeShape, fields?: Field[], fixture?: Fixture): Pick<BoardNode, "w" | "h"> & Partial<BoardNode> {
  const [w, h] = shape === "fixture" ? FIXTURE_SIZES[fixture ?? "table"] : SIZES[shape];
  const height = shape === "table" ? 44 + Math.max(1, fields?.length ?? 1) * 30 : h;
  switch (shape) {
    case "sticky":
      return { w, h: height, fill: STICKY_COLORS[0], fontSize: 20 };
    case "text":
      return { w, h: height, fontSize: 24 };
    case "frame":
      return { w, h: height, fill: "#f1f5f9", stroke: "#94a3b8", fontSize: 16 };
    case "pill":
      return { w, h: height, fill: "#dcfce7", stroke: "#16a34a" };
    case "diamond":
      return { w, h: height, fill: "#fef3c7", stroke: "#d97706" };
    case "parallelogram":
      return { w, h: height, fill: "#e0f2fe", stroke: "#0284c7" };
    case "cylinder":
      return { w, h: height, fill: "#ede9fe", stroke: "#7c3aed" };
    case "table":
      return { w, h: height, fill: "#ffffff", stroke: "#334155" };
    case "service":
      return { w, h: height, fill: "#ffffff", stroke: "#cbd5e1" };
    case "room":
      return { w, h: height, fontSize: 15 };
    case "wall":
    case "door":
    case "window":
    case "stairs":
      return { w, h: height };
    case "fixture":
      return { w, h: height, fixture: fixture ?? "table" };
    case "image":
      return { w, h: height };
    default:
      return { w, h: height, fill: "#ffffff", stroke: "#334155" };
  }
}

// ---- Auto layout ----

const GAP = { TB: [70, 90], LR: [110, 50] } as const;

/** Positions for the given nodes, computed only from the board, so server and clients agree. */
export function layoutBoard(board: Board, direction: "TB" | "LR" | "radial", ids?: string[]): Record<string, { x: number; y: number }> {
  // Floor-plan pieces have real positions; auto layout never moves them.
  const pick = new Set(
    (ids?.length ? board.nodes.filter((n) => ids.includes(n.id)) : board.nodes.filter((n) => n.shape !== "frame" && n.shape !== "text"))
      .filter((n) => !BLUEPRINT_SHAPES.has(n.shape))
      .map((n) => n.id),
  );
  const nodes = board.nodes.filter((n) => pick.has(n.id));
  if (!nodes.length) return {};
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = board.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const n of nodes) {
    out.set(n.id, []);
    inc.set(n.id, []);
  }
  for (const e of edges) {
    out.get(e.from)!.push(e.to);
    inc.get(e.to)!.push(e.from);
  }
  const origin = { x: Math.min(...nodes.map((n) => n.x)), y: Math.min(...nodes.map((n) => n.y)) };
  const result: Record<string, { x: number; y: number }> = {};

  if (direction === "radial") {
    // Root: the most connected node. Children share their parent's wedge in proportion to their leaf counts.
    const degree = (id: string) => out.get(id)!.length + inc.get(id)!.length;
    const root = [...nodes].sort((a, b) => degree(b.id) - degree(a.id))[0]!;
    const children = new Map<string, string[]>();
    const seen = new Set([root.id]);
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift()!;
      const kids = [...out.get(id)!, ...inc.get(id)!].filter((k) => !seen.has(k));
      kids.forEach((k) => seen.add(k));
      children.set(id, kids);
      queue.push(...kids);
    }
    const leaves = (id: string): number => {
      const k = children.get(id) ?? [];
      return k.length ? k.reduce((n, c) => n + leaves(c), 0) : 1;
    };
    const ring = 280;
    const cx = origin.x + 600;
    const cy = origin.y + 450;
    const place = (id: string, depth: number, a0: number, a1: number) => {
      const n = byId.get(id)!;
      const mid = (a0 + a1) / 2;
      const r = depth * ring;
      result[id] = { x: Math.round(cx + Math.cos(mid) * r - n.w / 2), y: Math.round(cy + Math.sin(mid) * r - n.h / 2) };
      const kids = children.get(id) ?? [];
      const total = kids.reduce((s, k) => s + leaves(k), 0);
      let a = a0;
      for (const k of kids) {
        const span = ((a1 - a0) * leaves(k)) / total;
        place(k, depth + 1, a, a + span);
        a += span;
      }
    };
    place(root.id, 0, -Math.PI / 2, Math.PI * 1.5);
    // Nodes not connected to the root go in a row underneath.
    let x = origin.x;
    for (const n of nodes) {
      if (result[n.id]) continue;
      result[n.id] = { x, y: cy + ring * 3 };
      x += n.w + 60;
    }
    return result;
  }

  // Layered: drop back edges found by a forward DFS from the sources (so a loop back to the start doesn't
  // push the start to the bottom), rank by longest path, then order each layer by its parents' positions.
  const back = new Set<BoardEdge>();
  const state = new Map<string, 1 | 2>();
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const e of edges) {
      if (e.from !== id) continue;
      if (state.get(e.to) === 1) back.add(e);
      else if (!state.has(e.to)) dfs(e.to);
    }
    state.set(id, 2);
  };
  for (const n of [...nodes].sort((a, b) => inc.get(a.id)!.length - inc.get(b.id)!.length)) if (!state.has(n.id)) dfs(n.id);
  for (const e of back) inc.set(e.to, inc.get(e.to)!.filter((p) => p !== e.from));

  const rank = new Map<string, number>();
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    rank.set(id, 0);
    const r = Math.max(0, ...inc.get(id)!.map((p) => rankOf(p) + 1));
    rank.set(id, r);
    return r;
  };
  nodes.forEach((n) => rankOf(n.id));
  const layers: string[][] = [];
  for (const n of nodes) (layers[rank.get(n.id)!] ??= []).push(n.id);
  const order = new Map<string, number>();
  layers.forEach((layer, li) => {
    if (li > 0) {
      const bary = (id: string) => {
        const ps = inc.get(id)!.filter((p) => order.has(p));
        return ps.length ? ps.reduce((s, p) => s + order.get(p)!, 0) / ps.length : Number.MAX_SAFE_INTEGER;
      };
      layer.sort((a, b) => bary(a) - bary(b));
    }
    layer.forEach((id, i) => order.set(id, i));
  });

  const [gapMain, gapCross] = direction === "TB" ? [GAP.TB[1], GAP.TB[0]] : [GAP.LR[0], GAP.LR[1]];
  const main = (n: BoardNode) => (direction === "TB" ? n.h : n.w);
  const cross = (n: BoardNode) => (direction === "TB" ? n.w : n.h);
  const widest = Math.max(...layers.map((l) => l.reduce((s, id) => s + cross(byId.get(id)!) + gapCross, -gapCross)));
  let at = 0;
  for (const layer of layers) {
    const size = Math.max(...layer.map((id) => main(byId.get(id)!)));
    const span = layer.reduce((s, id) => s + cross(byId.get(id)!) + gapCross, -gapCross);
    let c = (widest - span) / 2;
    for (const id of layer) {
      const n = byId.get(id)!;
      const offsetMain = at + (size - main(n)) / 2;
      result[id] = direction === "TB" ? { x: Math.round(origin.x + c), y: Math.round(origin.y + offsetMain) } : { x: Math.round(origin.x + offsetMain), y: Math.round(origin.y + c) };
      c += cross(n) + gapCross;
    }
    at += size + gapMain;
  }
  return result;
}

export const BOARD_OPS = [
  "add_node",
  "set_node",
  "delete_node",
  "add_edge",
  "set_edge",
  "delete_edge",
  "add_stroke",
  "delete_stroke",
  "auto_layout",
  "set_board",
  "restore_node",
  "restore_edge",
  "set_positions",
] as const;
