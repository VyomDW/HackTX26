import type { ReactNode } from "react";
import {
  Cloud,
  Database,
  Globe,
  HardDrive,
  Layers,
  Monitor,
  Network,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  SquareFunction,
  User,
  Waypoints,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { isBlueprintShape, type BoardNode, type ServiceIcon } from "@hacktx/shared";
import { inline } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { BlueprintNode } from "./Blueprint";
import { drawStyle } from "./PenDraw";

export const SERVICE_ICONS: Record<ServiceIcon, { icon: LucideIcon; label: string; tint: string }> = {
  client: { icon: Monitor, label: "Web client", tint: "#0ea5e9" },
  mobile: { icon: Smartphone, label: "Mobile app", tint: "#0ea5e9" },
  user: { icon: User, label: "User", tint: "#6366f1" },
  server: { icon: Server, label: "Server", tint: "#7c3aed" },
  database: { icon: Database, label: "Database", tint: "#16a34a" },
  cache: { icon: Zap, label: "Cache", tint: "#f59e0b" },
  queue: { icon: Layers, label: "Queue", tint: "#ea580c" },
  storage: { icon: HardDrive, label: "Storage", tint: "#0d9488" },
  function: { icon: SquareFunction, label: "Function", tint: "#db2777" },
  gateway: { icon: Network, label: "API gateway", tint: "#2563eb" },
  cloud: { icon: Cloud, label: "Cloud", tint: "#0284c7" },
  api: { icon: Globe, label: "External API", tint: "#475569" },
  auth: { icon: ShieldCheck, label: "Auth", tint: "#dc2626" },
  cdn: { icon: Waypoints, label: "CDN", tint: "#9333ea" },
  ai: { icon: Sparkles, label: "AI model", tint: "#c026d3" },
};

/** SVG outline for the geometric shapes, drawn behind the label. */
function Outline({ node, drawMs }: { node: BoardNode; drawMs?: number }) {
  const { w, h } = node;
  const fill = node.fill ?? "#ffffff";
  const stroke = node.stroke ?? "#334155";
  // While Muse draws it, the border traces itself in and the fill follows (non-scaling-stroke would break pathLength).
  const p = drawMs
    ? { fill, stroke, strokeWidth: 2, pathLength: 1, style: drawStyle("pen-outline", drawMs) }
    : { fill, stroke, strokeWidth: 2, vectorEffect: "non-scaling-stroke" as const };
  let shape: ReactNode;
  switch (node.shape) {
    case "ellipse":
      shape = <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1} ry={h / 2 - 1} {...p} />;
      break;
    case "diamond":
      shape = <polygon points={`${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`} {...p} />;
      break;
    case "parallelogram": {
      const k = Math.min(28, w / 5);
      shape = <polygon points={`${k},1 ${w - 1},1 ${w - k},${h - 1} 1,${h - 1}`} {...p} />;
      break;
    }
    case "hexagon": {
      const k = Math.min(30, w / 5);
      shape = <polygon points={`${k},1 ${w - k},1 ${w - 1},${h / 2} ${w - k},${h - 1} ${k},${h - 1} 1,${h / 2}`} {...p} />;
      break;
    }
    case "cylinder": {
      const ry = Math.min(16, h / 6);
      shape = (
        <>
          <path d={`M 1 ${ry} A ${w / 2 - 1} ${ry} 0 0 1 ${w - 1} ${ry} V ${h - ry} A ${w / 2 - 1} ${ry} 0 0 1 1 ${h - ry} Z`} {...p} />
          <path d={`M 1 ${ry} A ${w / 2 - 1} ${ry} 0 0 0 ${w - 1} ${ry}`} {...p} fill="none" />
        </>
      );
      break;
    }
    default: {
      const r = node.shape === "pill" ? h / 2 : node.shape === "rounded" ? Math.min(18, h / 3) : 4;
      shape = <rect x={1} y={1} width={w - 2} height={h - 2} rx={r} {...p} />;
    }
  }
  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h}>
      {shape}
    </svg>
  );
}

/** One board node, drawn in canvas units (the parent applies pan and zoom). */
/** `drawMs` is set while Muse is drawing an outlined shape, so its border traces in. */
export function BoardNodeView({ node, editor, highlighted, dark, drawMs }: { node: BoardNode; editor?: ReactNode; highlighted?: boolean; dark?: boolean; drawMs?: number }) {
  if (isBlueprintShape(node.shape)) return <BlueprintNode node={node} editor={editor} />;
  const fs = node.fontSize ?? (node.shape === "text" ? 24 : 16);
  const text = editor ?? (node.text ? inline(node.text) : null);
  // On a blueprint, free text defaults to white so it reads on the blue.
  const textStyle = { fontSize: fs, color: node.textColor ?? (dark && (node.shape === "text" || node.shape === "frame") ? "#e8f1ff" : "#0f172a") };

  if (node.shape === "image") {
    return (
      <div className="absolute inset-0">
        {node.url ? (
          // #muse-ink (defined by the board) turns the sketch's white paper transparent, so it looks drawn on the board.
          <img src={node.url} alt={node.text} draggable={false} className="h-full w-full object-contain" style={{ filter: "url(#muse-ink)" }} />
        ) : (
          // Inline colors: the canvas is always light paper, so the night theme's palette remap must not reach this.
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center"
            style={{ background: "#f5f3ffb3", borderColor: "#c4b5fd" }}
          >
            <Sparkles className="size-6 animate-pulse" style={{ color: "#8b5cf6" }} />
            <div className="text-[13px] font-semibold" style={{ color: "#6d28d9" }}>
              {node.text ? "Muse is drawing…" : "Describe a picture"}
            </div>
            <div className="line-clamp-3 w-full text-xs" style={{ color: "#64748b" }}>
              {editor ?? node.text}
            </div>
          </div>
        )}
        {node.url && editor && <div className="absolute inset-x-0 bottom-0 rounded bg-white/90 p-1 text-xs">{editor}</div>}
      </div>
    );
  }

  if (node.shape === "frame") {
    return (
      <div className="absolute inset-0 rounded-xl border-2 border-dashed" style={{ background: `${node.fill ?? "#f1f5f9"}cc`, borderColor: node.stroke ?? "#94a3b8" }}>
        <div className="absolute left-3 top-2 font-semibold" style={{ fontSize: fs, color: node.textColor ?? "#475569" }}>
          {editor ?? (node.text || "Frame")}
        </div>
      </div>
    );
  }

  if (node.shape === "table") {
    return (
      <div className="absolute inset-0 overflow-hidden rounded-lg border-2 bg-white shadow-sm" style={{ borderColor: node.stroke ?? "#334155", background: node.fill ?? "#fff" }}>
        <div className="flex h-11 items-center px-3 font-bold text-white" style={{ background: node.stroke ?? "#334155", fontSize: 15 }}>
          {editor ?? (node.text || "table")}
        </div>
        {(node.fields ?? []).map((f, i) => (
          <div key={i} className="flex h-[30px] items-center gap-2 border-t border-slate-200 px-3 font-mono text-[12.5px]">
            <span className={cn("w-6 text-[10px] font-bold", f.key === "pk" ? "text-amber-600" : f.key === "fk" ? "text-sky-600" : "text-transparent")}>
              {f.key?.toUpperCase() ?? "··"}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-800">{f.name}</span>
            <span className="text-slate-400">{f.type}</span>
          </div>
        ))}
        {!node.fields?.length && <div className="px-3 py-1.5 text-xs text-slate-400">Double-click to add columns</div>}
      </div>
    );
  }

  if (node.shape === "service") {
    const meta = SERVICE_ICONS[node.icon ?? "server"];
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 bg-white px-2 text-center shadow-sm"
        style={{ borderColor: node.stroke ?? "#cbd5e1", background: node.fill ?? "#fff" }}
      >
        <div className="grid size-10 place-items-center rounded-lg" style={{ background: `${meta.tint}1f`, color: meta.tint }}>
          <meta.icon className="size-5" />
        </div>
        <div className="w-full font-semibold leading-tight" style={{ ...textStyle, fontSize: node.fontSize ?? 14 }}>
          {text}
        </div>
      </div>
    );
  }

  if (node.shape === "sticky") {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden p-4 text-center leading-snug shadow-[0_6px_14px_rgba(0,0,0,0.12)]"
        style={{ background: node.fill ?? "#fef08a", ...textStyle, borderRadius: 4 }}
      >
        <div className="w-full whitespace-pre-wrap break-words">{text}</div>
      </div>
    );
  }

  if (node.shape === "text") {
    return (
      <div className="absolute inset-0 flex items-center whitespace-pre-wrap break-words font-semibold leading-tight" style={textStyle}>
        <div className="w-full">{text}</div>
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0", highlighted && "drop-shadow-[0_0_10px_rgba(167,139,250,0.9)]")}>
      <Outline node={node} drawMs={drawMs} />
      <div
        className="absolute inset-0 flex items-center justify-center whitespace-pre-wrap break-words px-4 text-center font-medium leading-tight"
        style={drawMs ? { ...textStyle, ...drawStyle("pen-wipe-x", drawMs * 0.4, drawMs * 0.6) } : textStyle}
      >
        <div className="w-full">{text}</div>
      </div>
    </div>
  );
}
