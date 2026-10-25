import { BrainCircuit, Database, DraftingCompass, FileText, LayoutDashboard, Network, NotebookPen, Presentation, Table2, Workflow, type LucideIcon } from "lucide-react";
import type { BoardTemplate, DocKind } from "@hacktx/shared";

/** How each kind of file presents itself in the UI. */
export const KINDS: Record<
  DocKind,
  { label: string; noun: string; icon: LucideIcon; color: string; tint: string; placeholder: string; suggestions: string[] }
> = {
  slides: {
    label: "Presentation",
    noun: "slides",
    icon: Presentation,
    color: "bg-amber-500",
    tint: "text-amber-600 bg-amber-50",
    placeholder: "Ask Muse to build or change slides…",
    suggestions: ["Make a pitch about sustainable coffee", "Explain how solar panels work in 4 slides", "Plan a team offsite agenda"],
  },
  doc: {
    label: "Document",
    noun: "document",
    icon: FileText,
    color: "bg-blue-600",
    tint: "text-blue-600 bg-blue-50",
    placeholder: "Ask Muse to write or edit the document…",
    suggestions: ["Write a one-page project proposal for a campus app", "Draft a cover letter for a software internship", "Write meeting minutes with action items"],
  },
  sheet: {
    label: "Spreadsheet",
    noun: "spreadsheet",
    icon: Table2,
    color: "bg-emerald-600",
    tint: "text-emerald-600 bg-emerald-50",
    placeholder: "Ask Muse to build, calculate or chart…",
    suggestions: ["Build a monthly student budget with a pie chart", "Track a 6-week workout plan with totals", "Compare 4 laptops on price and specs"],
  },
  notes: {
    label: "Notes",
    noun: "notes",
    icon: NotebookPen,
    color: "bg-yellow-500",
    tint: "text-yellow-700 bg-yellow-50",
    placeholder: "Ask Muse to take, organize or summarize notes…",
    suggestions: ["Plan my hackathon weekend with a packing checklist", "Turn these thoughts into organized notes", "Make study notes on the French Revolution"],
  },
  board: {
    label: "Board",
    noun: "board",
    icon: LayoutDashboard,
    color: "bg-pink-600",
    tint: "text-pink-600 bg-pink-50",
    placeholder: "Ask Muse to draw, connect or rearrange…",
    suggestions: ["Brainstorm features for a campus app", "Map out a weekly team retro", "Sketch user personas for a fitness app"],
  },
};

type Meta = { label: string; noun: string; icon: LucideIcon; color: string; tint: string; placeholder: string; suggestions: string[] };

/** Each board template presents itself like its own tool. */
export const BOARD_TEMPLATES: Record<BoardTemplate, Meta> = {
  whiteboard: { ...KINDS.board, label: "Whiteboard", noun: "whiteboard" },
  flowchart: {
    label: "Flowchart",
    noun: "flowchart",
    icon: Workflow,
    color: "bg-sky-600",
    tint: "text-sky-600 bg-sky-50",
    placeholder: "Ask Muse to chart a process…",
    suggestions: ["Flowchart of a user login flow with 2FA", "Order checkout process with payment failures", "CI/CD pipeline from commit to deploy"],
  },
  architecture: {
    label: "System design",
    noun: "system diagram",
    icon: Network,
    color: "bg-indigo-600",
    tint: "text-indigo-600 bg-indigo-50",
    placeholder: "Ask Muse to design a system…",
    suggestions: ["Architecture for a food delivery app", "Real-time chat system that scales to 1M users", "Serverless image processing pipeline"],
  },
  erd: {
    label: "DB schema",
    noun: "database schema",
    icon: Database,
    color: "bg-teal-600",
    tint: "text-teal-600 bg-teal-50",
    placeholder: "Ask Muse to model your data…",
    suggestions: ["Schema for a course registration system", "E-commerce store with orders and reviews", "Multi-tenant SaaS with teams and roles"],
  },
  mindmap: {
    label: "Mind map",
    noun: "mind map",
    icon: BrainCircuit,
    color: "bg-fuchsia-600",
    tint: "text-fuchsia-600 bg-fuchsia-50",
    placeholder: "Ask Muse to map out ideas…",
    suggestions: ["Mind map of hackathon ideas about sustainability", "Study map for an intro to machine learning", "Plan a product launch"],
  },
  blueprint: {
    label: "Blueprint",
    noun: "floor plan",
    icon: DraftingCompass,
    color: "bg-blue-700",
    tint: "text-blue-700 bg-blue-50",
    placeholder: "Ask Muse to draw or change the floor plan…",
    suggestions: ["Floor plan for a 2-bedroom, 1-bath apartment", "Small coffee shop with seating for 24", "Studio apartment with an open kitchen"],
  },
};

/** Everything you can start from the home screen. */
export interface Target extends Meta {
  key: string;
  kind: DocKind;
  template?: BoardTemplate;
  group: "office" | "dev";
}
export const TARGETS: Target[] = [
  ...(["slides", "doc", "sheet", "notes"] as const).map((kind) => ({ ...KINDS[kind], key: kind, kind, group: "office" as const })),
  ...(["whiteboard", "flowchart", "blueprint", "architecture", "erd", "mindmap"] as BoardTemplate[]).map((template) => ({ ...BOARD_TEMPLATES[template], key: template, kind: "board" as const, template, group: "dev" as const })),
];

/** Label, icon and suggestions for an open file, using the board template when there is one. */
export const metaOf = (kind: DocKind, template?: BoardTemplate): Meta => (kind === "board" && template ? BOARD_TEMPLATES[template] : KINDS[kind]);

export const newRoomId = () => `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const roomUrl = (id: string, kind?: DocKind, prompt?: string, template?: BoardTemplate) => {
  const p = new URLSearchParams({ room: id });
  if (kind) p.set("kind", kind);
  if (template) p.set("template", template);
  if (prompt) p.set("q", prompt);
  return `${location.pathname}?${p}`;
};
