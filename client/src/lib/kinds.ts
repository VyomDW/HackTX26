import { FileText, NotebookPen, Presentation, Table2, type LucideIcon } from "lucide-react";
import type { DocKind } from "@hacktx/shared";

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
};

export const newRoomId = () => `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const roomUrl = (id: string, kind?: DocKind, prompt?: string) => {
  const p = new URLSearchParams({ room: id });
  if (kind) p.set("kind", kind);
  if (prompt) p.set("q", prompt);
  return `${location.pathname}?${p}`;
};
