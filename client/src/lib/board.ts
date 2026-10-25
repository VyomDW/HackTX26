import type { Board, BoardEdge, BoardNode, BoardTemplate, NodeShape } from "@hacktx/shared";

/** Geometry for connectors and the developer exports (Mermaid, SQL) for boards. */

export interface Pt {
  x: number;
  y: number;
}
export type Box = { x: number; y: number; w: number; h: number };

export const center = (n: Box): Pt => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** Where a line from the node's centre toward `to` leaves the node's outline. */
export function anchor(n: Box & { shape?: NodeShape }, to: Pt): Pt {
  const c = center(n);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (!dx && !dy) return c;
  const rx = n.w / 2;
  const ry = n.h / 2;
  let t: number;
  if (n.shape === "ellipse") t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
  else if (n.shape === "diamond") t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  else t = Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export interface EdgePath {
  d: string;
  /** Point and direction of the final segment, for the arrowhead. */
  end: Pt;
  endDir: Pt;
  start: Pt;
  startDir: Pt;
  label: Pt;
}

export function edgePath(a: BoardNode | Box, b: BoardNode | Box, route: BoardEdge["route"] = "straight"): EdgePath {
  const ca = center(a);
  const cb = center(b);
  if (route === "elbow") {
    const vertical = Math.abs(cb.y - ca.y) > Math.abs(cb.x - ca.x);
    if (vertical) {
      const down = cb.y > ca.y;
      const s = { x: ca.x, y: down ? a.y + a.h : a.y };
      const e = { x: cb.x, y: down ? b.y : b.y + b.h };
      const my = (s.y + e.y) / 2;
      return {
        d: `M ${s.x} ${s.y} V ${my} H ${e.x} V ${e.y}`,
        start: s,
        startDir: { x: 0, y: down ? -1 : 1 },
        end: e,
        endDir: { x: 0, y: down ? 1 : -1 },
        label: { x: (s.x + e.x) / 2, y: my },
      };
    }
    const right = cb.x > ca.x;
    const s = { x: right ? a.x + a.w : a.x, y: ca.y };
    const e = { x: right ? b.x : b.x + b.w, y: cb.y };
    const mx = (s.x + e.x) / 2;
    return {
      d: `M ${s.x} ${s.y} H ${mx} V ${e.y} H ${e.x}`,
      start: s,
      startDir: { x: right ? -1 : 1, y: 0 },
      end: e,
      endDir: { x: right ? 1 : -1, y: 0 },
      label: { x: mx, y: (s.y + e.y) / 2 },
    };
  }
  const s = anchor(a, cb);
  const e = anchor(b, ca);
  const len = Math.hypot(e.x - s.x, e.y - s.y) || 1;
  if (route === "curve") {
    const horizontal = Math.abs(e.x - s.x) > Math.abs(e.y - s.y);
    const k = Math.min(len * 0.4, 160);
    const c1 = horizontal ? { x: s.x + Math.sign(e.x - s.x) * k, y: s.y } : { x: s.x, y: s.y + Math.sign(e.y - s.y) * k };
    const c2 = horizontal ? { x: e.x - Math.sign(e.x - s.x) * k, y: e.y } : { x: e.x, y: e.y - Math.sign(e.y - s.y) * k };
    const dir = (p: Pt, q: Pt) => {
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
    };
    return {
      d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${e.x} ${e.y}`,
      start: s,
      startDir: dir(c1, s),
      end: e,
      endDir: dir(c2, e),
      label: { x: (s.x + 3 * c1.x + 3 * c2.x + e.x) / 8, y: (s.y + 3 * c1.y + 3 * c2.y + e.y) / 8 },
    };
  }
  const u = { x: (e.x - s.x) / len, y: (e.y - s.y) / len };
  return { d: `M ${s.x} ${s.y} L ${e.x} ${e.y}`, start: s, startDir: { x: -u.x, y: -u.y }, end: e, endDir: u, label: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 } };
}

export const arrowHead = (tip: Pt, dir: Pt, size = 11) => {
  const bx = tip.x - dir.x * size;
  const by = tip.y - dir.y * size;
  const px = -dir.y * size * 0.55;
  const py = dir.x * size * 0.55;
  return `${tip.x},${tip.y} ${bx + px},${by + py} ${bx - px},${by - py}`;
};

/** Smooth SVG path through freehand points (quadratic curves through midpoints). */
export function strokePath(points: number[]): string {
  if (points.length < 4) return points.length === 2 ? `M ${points[0]} ${points[1]} l 0.1 0` : "";
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i]! + points[i + 2]!) / 2;
    const my = (points[i + 1]! + points[i + 3]!) / 2;
    d += ` Q ${points[i]} ${points[i + 1]} ${mx} ${my}`;
  }
  return `${d} L ${points.at(-2)} ${points.at(-1)}`;
}

export function boundsOf(board: Board): Box | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of board.nodes) xs.push(n.x, n.x + n.w), ys.push(n.y, n.y + n.h);
  for (const s of board.strokes)
    for (let i = 0; i < s.points.length; i += 2) {
      xs.push(s.points[i]!);
      ys.push(s.points[i + 1]!);
    }
  if (!xs.length) return undefined;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The shape a double-click on empty canvas creates, by template. */
export const DEFAULT_SHAPE: Record<BoardTemplate, NodeShape> = {
  whiteboard: "sticky",
  flowchart: "rect",
  architecture: "service",
  erd: "table",
  mindmap: "rounded",
  blueprint: "room",
};

export const DEFAULT_ROUTE: Record<BoardTemplate, Pick<BoardEdge, "route" | "arrow">> = {
  whiteboard: { route: "curve" },
  flowchart: { route: "elbow" },
  architecture: { route: "straight" },
  erd: { route: "elbow", arrow: "none" },
  mindmap: { route: "curve", arrow: "none" },
  blueprint: { route: "straight" },
};

export const TIDY_DIRECTION: Record<BoardTemplate, "TB" | "LR" | "radial"> = {
  whiteboard: "LR",
  flowchart: "TB",
  architecture: "LR",
  erd: "LR",
  mindmap: "radial",
  blueprint: "LR",
};

// ---- Exports ----

const mermaidLabel = (s: string) => `"${(s || " ").replace(/"/g, "#quot;").replace(/\n/g, "<br/>")}"`;
const mermaidId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_");

/** Mermaid flowchart source, which renders in GitHub, Notion and most docs tools. */
export function toMermaid(board: Board): string {
  const shape = (n: BoardNode) => {
    const l = mermaidLabel(n.text);
    switch (n.shape) {
      case "pill":
        return `([${l}])`;
      case "rounded":
        return `(${l})`;
      case "diamond":
        return `{${l}}`;
      case "cylinder":
        return `[(${l})]`;
      case "parallelogram":
        return `[/${l}/]`;
      case "ellipse":
        return `((${l}))`;
      case "hexagon":
        return `{{${l}}}`;
      default:
        return `[${l}]`;
    }
  };
  const dir = board.template === "architecture" || board.template === "erd" ? "LR" : "TD";
  const lines = [`flowchart ${dir}`];
  for (const n of board.nodes) if (n.shape !== "frame" && n.shape !== "text") lines.push(`  ${mermaidId(n.id)}${shape(n)}`);
  for (const e of board.edges) {
    const arrow = e.arrow === "none" ? (e.dashed ? "-.-" : "---") : e.dashed ? "-.->" : "-->";
    lines.push(`  ${mermaidId(e.from)} ${arrow}${e.label ? `|${mermaidLabel(e.label)}|` : ""} ${mermaidId(e.to)}`);
  }
  return lines.join("\n") + "\n";
}

const sqlName = (s: string) => s.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "").toLowerCase() || "table";

/** CREATE TABLE statements for every table node, with foreign keys inferred from connectors. */
export function toSql(board: Board): string {
  const tables = board.nodes.filter((n) => n.shape === "table");
  const byId = new Map(tables.map((t) => [t.id, t]));
  const out: string[] = [];
  for (const t of tables) {
    const name = sqlName(t.text);
    const fields = t.fields ?? [];
    const cols = fields.map((f) => `  ${sqlName(f.name)} ${f.type.toUpperCase() || "TEXT"}${f.key === "pk" ? " PRIMARY KEY" : ""}`);
    const targets = board.edges.flatMap((e) => (e.from === t.id ? [byId.get(e.to)] : e.to === t.id ? [byId.get(e.from)] : [])).filter((x): x is BoardNode => !!x && x.id !== t.id);
    for (const f of fields.filter((f) => f.key === "fk")) {
      const base = sqlName(f.name).replace(/_?id$/, "");
      const target = targets.find((x) => sqlName(x.text).replace(/s$/, "") === base.replace(/s$/, "")) ?? targets.find((x) => sqlName(x.text).startsWith(base));
      if (!target) continue;
      const pk = target.fields?.find((x) => x.key === "pk")?.name ?? "id";
      cols.push(`  FOREIGN KEY (${sqlName(f.name)}) REFERENCES ${sqlName(target.text)}(${sqlName(pk)})`);
    }
    out.push(`CREATE TABLE ${name} (\n${cols.join(",\n")}\n);`);
  }
  return out.join("\n\n") + "\n";
}
