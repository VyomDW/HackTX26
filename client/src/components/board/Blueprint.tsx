import type { ReactNode } from "react";
import { UNITS_PER_FOOT, type Board, type BoardNode, type Fixture } from "@hacktx/shared";

/** Floor-plan drawing: white line art on blueprint blue, at 20 canvas units per foot. */

const INK = "#e8f1ff";
const FAINT = "rgba(232, 241, 255, 0.45)";

/** 250 units -> 12'-6" */
export function ftIn(units: number): string {
  const inches = Math.round((Math.abs(units) / UNITS_PER_FOOT) * 12);
  return `${Math.floor(inches / 12)}'-${inches % 12}"`;
}

export const areaSqFt = (n: Pick<BoardNode, "w" | "h">) => Math.round((n.w / UNITS_PER_FOOT) * (n.h / UNITS_PER_FOOT));

export const BLUEPRINT_BG = {
  backgroundColor: "#0d3563",
  minor: "rgba(255,255,255,0.07)",
  major: "rgba(255,255,255,0.16)",
};

/** Room schedule for engineers: name, dimensions and area of every room. */
export function roomSchedule(board: Board): string {
  const rooms = board.nodes.filter((n) => n.shape === "room");
  const total = rooms.reduce((s, r) => s + areaSqFt(r), 0);
  const rows = rooms.map((r) => `"${(r.text || "Room").replace(/"/g, '""')}",${ftIn(r.w)},${ftIn(r.h)},${areaSqFt(r)}`);
  return ["Room,Width,Length,Area (sq ft)", ...rows, `Total,,,${total}`].join("\n") + "\n";
}

function FixtureArt({ kind, w, h }: { kind: Fixture; w: number; h: number }): ReactNode {
  const s = { fill: "none", stroke: INK, strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" as const };
  switch (kind) {
    case "bed":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} rx={3} {...s} />
          <rect x={w * 0.1} y={h * 0.05} width={w * 0.36} height={h * 0.16} rx={4} {...s} />
          <rect x={w * 0.54} y={h * 0.05} width={w * 0.36} height={h * 0.16} rx={4} {...s} />
          <line x1={1} y1={h * 0.3} x2={w - 1} y2={h * 0.3} {...s} />
        </>
      );
    case "sofa":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} rx={6} {...s} />
          <line x1={w * 0.12} y1={h * 0.3} x2={w * 0.88} y2={h * 0.3} {...s} />
          <line x1={w * 0.12} y1={h * 0.3} x2={w * 0.12} y2={h - 1} {...s} />
          <line x1={w * 0.88} y1={h * 0.3} x2={w * 0.88} y2={h - 1} {...s} />
          <line x1={w / 2} y1={h * 0.3} x2={w / 2} y2={h - 1} {...s} />
        </>
      );
    case "table":
      return (
        <>
          <ellipse cx={w / 2} cy={h / 2} rx={w * 0.32} ry={h * 0.32} {...s} />
          {[0, 1, 2, 3].map((i) => {
            const a = (Math.PI / 2) * i;
            return <rect key={i} x={w / 2 + Math.cos(a) * w * 0.42 - 6} y={h / 2 + Math.sin(a) * h * 0.42 - 6} width={12} height={12} rx={2} {...s} />;
          })}
        </>
      );
    case "desk":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} {...s} />
          <rect x={w / 2 - 9} y={h - 1} width={18} height={14} rx={3} {...s} />
        </>
      );
    case "chair":
      return (
        <>
          <rect x={2} y={2} width={w - 4} height={h - 4} rx={4} {...s} />
          <line x1={2} y1={h * 0.28} x2={w - 2} y2={h * 0.28} {...s} />
        </>
      );
    case "toilet":
      return (
        <>
          <rect x={w * 0.1} y={1} width={w * 0.8} height={h * 0.28} rx={2} {...s} />
          <ellipse cx={w / 2} cy={h * 0.64} rx={w * 0.4} ry={h * 0.33} {...s} />
        </>
      );
    case "tub":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} rx={4} {...s} />
          <rect x={w * 0.14} y={h * 0.08} width={w * 0.72} height={h * 0.84} rx={Math.min(w, h) * 0.3} {...s} />
        </>
      );
    case "shower":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} {...s} />
          <line x1={1} y1={1} x2={w - 1} y2={h - 1} {...s} />
          <line x1={w - 1} y1={1} x2={1} y2={h - 1} {...s} />
          <circle cx={w / 2} cy={h / 2} r={3} {...s} />
        </>
      );
    case "sink":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} rx={3} {...s} />
          <ellipse cx={w / 2} cy={h * 0.55} rx={w * 0.32} ry={h * 0.3} {...s} />
        </>
      );
    case "stove":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} {...s} />
          {[
            [0.3, 0.3],
            [0.7, 0.3],
            [0.3, 0.7],
            [0.7, 0.7],
          ].map(([x, y], i) => (
            <circle key={i} cx={w * x!} cy={h * y!} r={Math.min(w, h) * 0.13} {...s} />
          ))}
        </>
      );
    case "fridge":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} {...s} />
          <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fill={INK} fontSize={11} fontFamily="JetBrains Mono, monospace">
            REF
          </text>
        </>
      );
    case "counter":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} {...s} />
          <line x1={1} y1={h * 0.15} x2={w - 1} y2={h * 0.15} stroke={FAINT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </>
      );
    case "plant":
      return (
        <>
          <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) * 0.45} {...s} />
          <path d={`M ${w / 2} ${h * 0.1} Q ${w * 0.75} ${h / 2} ${w / 2} ${h * 0.9} Q ${w * 0.25} ${h / 2} ${w / 2} ${h * 0.1}`} {...s} />
        </>
      );
    case "car":
      return (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} rx={w * 0.25} {...s} />
          <rect x={w * 0.14} y={h * 0.2} width={w * 0.72} height={h * 0.18} rx={6} {...s} />
          <rect x={w * 0.14} y={h * 0.66} width={w * 0.72} height={h * 0.12} rx={6} {...s} />
        </>
      );
  }
}

/** One floor-plan element. Rotation (doors, stairs, fixtures) turns the drawing about its centre. */
export function BlueprintNode({ node, editor }: { node: BoardNode; editor?: ReactNode }) {
  const { w, h } = node;
  const s = { fill: "none", stroke: INK, strokeWidth: 2, vectorEffect: "non-scaling-stroke" as const };
  const label = { fontSize: node.fontSize ?? 15, color: node.textColor ?? INK };

  if (node.shape === "room") {
    return (
      <div className="absolute inset-0" style={{ border: `6px solid ${INK}`, background: node.fill ?? "rgba(232,241,255,0.04)" }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center font-mono leading-tight" style={label}>
          <div className="font-bold uppercase tracking-wide">{editor ?? (node.text || "Room")}</div>
          <div className="mt-1 text-[0.75em] opacity-75">
            {ftIn(w)} × {ftIn(h)}
          </div>
          <div className="text-[0.7em] opacity-60">{areaSqFt(node)} sq ft</div>
        </div>
      </div>
    );
  }

  if (node.shape === "wall") return <div className="absolute inset-0" style={{ background: INK }} />;

  let art: ReactNode;
  if (node.shape === "door") {
    // Opening along the bottom edge, hinge at bottom-left, leaf standing up the left edge, swing arc to the right.
    art = (
      <>
        <rect x={0} y={h - 6} width={w} height={6} fill="#0d3563" />
        <line x1={2} y1={h} x2={2} y2={0} {...s} />
        <path d={`M 2 0 A ${w - 2} ${h} 0 0 1 ${w} ${h}`} fill="none" stroke={FAINT} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </>
    );
  } else if (node.shape === "window") {
    art = (
      <>
        <rect x={0} y={0} width={w} height={h} fill="#0d3563" stroke={INK} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {w >= h ? <line x1={0} y1={h / 2} x2={w} y2={h / 2} {...s} strokeWidth={1} /> : <line x1={w / 2} y1={0} x2={w / 2} y2={h} {...s} strokeWidth={1} />}
      </>
    );
  } else if (node.shape === "stairs") {
    const vertical = h >= w;
    const len = vertical ? h : w;
    const treads = Math.max(2, Math.floor(len / 17));
    art = (
      <>
        <rect x={1} y={1} width={w - 2} height={h - 2} {...s} />
        {Array.from({ length: treads - 1 }, (_, i) => {
          const p = ((i + 1) * len) / treads;
          return vertical ? <line key={i} x1={1} y1={p} x2={w - 1} y2={p} {...s} strokeWidth={1} /> : <line key={i} x1={p} y1={1} x2={p} y2={h - 1} {...s} strokeWidth={1} />;
        })}
        {vertical ? (
          <path d={`M ${w / 2} ${h - 8} V 10 M ${w / 2 - 6} 18 L ${w / 2} 10 L ${w / 2 + 6} 18`} {...s} strokeWidth={1.5} />
        ) : (
          <path d={`M 8 ${h / 2} H ${w - 10} M ${w - 18} ${h / 2 - 6} L ${w - 10} ${h / 2} L ${w - 18} ${h / 2 + 6}`} {...s} strokeWidth={1.5} />
        )}
      </>
    );
  } else if (node.shape === "fixture") {
    art = <FixtureArt kind={node.fixture ?? "table"} w={w} h={h} />;
  }

  return (
    <div className="absolute inset-0" style={{ transform: node.rotate ? `rotate(${node.rotate}deg)` : undefined }}>
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h}>
        {art}
      </svg>
      {(editor || node.text) && (
        <div className="absolute inset-x-0 -bottom-5 text-center font-mono text-[11px]" style={{ color: node.textColor ?? INK }}>
          {editor ?? node.text}
        </div>
      )}
    </div>
  );
}

/** Dimension strings drawn outside the selected element, like on a drawing. */
export function Dimensions({ node, zoom }: { node: BoardNode; zoom: number }) {
  const off = 18 / zoom;
  const fs = 12 / zoom;
  const tick = 5 / zoom;
  const sw = 1 / zoom;
  const { x, y, w, h } = node;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
      <g stroke="#ffd28a" strokeWidth={sw} fill="#ffd28a" fontFamily="JetBrains Mono, monospace" fontSize={fs}>
        <line x1={x} y1={y - off} x2={x + w} y2={y - off} />
        <line x1={x} y1={y - off - tick} x2={x} y2={y - off + tick} />
        <line x1={x + w} y1={y - off - tick} x2={x + w} y2={y - off + tick} />
        <text x={x + w / 2} y={y - off - 4 / zoom} textAnchor="middle" stroke="none">
          {ftIn(w)}
        </text>
        <line x1={x - off} y1={y} x2={x - off} y2={y + h} />
        <line x1={x - off - tick} y1={y} x2={x - off + tick} y2={y} />
        <line x1={x - off - tick} y1={y + h} x2={x - off + tick} y2={y + h} />
        <text x={x - off - 4 / zoom} y={y + h / 2} textAnchor="middle" stroke="none" transform={`rotate(-90 ${x - off - 4 / zoom} ${y + h / 2})`}>
          {ftIn(h)}
        </text>
      </g>
    </svg>
  );
}
