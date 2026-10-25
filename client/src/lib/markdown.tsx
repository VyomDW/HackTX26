import { Fragment, type ReactNode } from "react";
import type { Block, TextDoc } from "@hacktx/shared";

/** Inline markdown used across docs, notes and slides: **bold**, *italic*, ~~strike~~, `code`, [text](url). */
const INLINE = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\*[^*\n]+\*)/g;

export function inline(text: string): ReactNode {
  const parts = text.split(INLINE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) return <s key={i}>{part.slice(2, -2)}</s>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-rose-600">
          {part.slice(1, -1)}
        </code>
      );
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-violet-600 underline underline-offset-2" onClick={(e) => e.stopPropagation()}>
          {link[1]}
        </a>
      );
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{inline(part.slice(1, -1))}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Block-level markdown for note bodies. Checklist lines call onToggle with their line index. */
export function MarkdownBody({ text, onToggle }: { text: string; onToggle?: (line: number) => void }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    if ((m = /^- \[( |x|X)\] (.*)$/.exec(line))) {
      const done = m[1] !== " ";
      out.push(
        <label key={i} className="flex cursor-pointer items-start gap-2 py-0.5" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={done} onChange={() => onToggle?.(i)} className="mt-1 size-4 accent-violet-600" />
          <span className={done ? "text-slate-400 line-through" : ""}>{inline(m[2]!)}</span>
        </label>,
      );
    } else if ((m = /^(#{1,3}) (.*)$/.exec(line))) {
      const size = ["text-xl font-bold mt-3", "text-lg font-semibold mt-2", "font-semibold mt-1"][m[1]!.length - 1];
      out.push(
        <div key={i} className={size}>
          {inline(m[2]!)}
        </div>,
      );
    } else if ((m = /^[-*] (.*)$/.exec(line))) {
      out.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1">
          <span className="text-slate-400">•</span>
          <span>{inline(m[1]!)}</span>
        </div>,
      );
    } else if ((m = /^(\d+)\. (.*)$/.exec(line))) {
      out.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1">
          <span className="tabular-nums text-slate-400">{m[1]}.</span>
          <span>{inline(m[2]!)}</span>
        </div>,
      );
    } else if (line.trim() === "") out.push(<div key={i} className="h-3" />);
    else
      out.push(
        <p key={i} className="py-0.5">
          {inline(line)}
        </p>,
      );
  });
  return <div className="leading-relaxed">{out}</div>;
}

/** Flips "- [ ]" and "- [x]" on one line of a note body. */
export const toggleChecklistLine = (text: string, line: number) =>
  text
    .split("\n")
    .map((l, i) => (i !== line ? l : l.startsWith("- [ ] ") ? `- [x] ${l.slice(6)}` : l.replace(/^- \[(x|X)\] /, "- [ ] ")))
    .join("\n");

// ---- Document export ----

const mdPrefix = (b: Block, n: number) => {
  const pad = "  ".repeat(b.indent ?? 0);
  switch (b.type) {
    case "h1":
      return "# ";
    case "h2":
      return "## ";
    case "h3":
      return "### ";
    case "bullet":
      return `${pad}- `;
    case "numbered":
      return `${pad}${n}. `;
    case "todo":
      return `${pad}- [${b.checked ? "x" : " "}] `;
    case "quote":
    case "callout":
      return "> ";
    default:
      return "";
  }
};

/** Running list numbers: consecutive numbered blocks at the same indent count up. */
export function listNumbers(blocks: Block[]): Map<string, number> {
  const out = new Map<string, number>();
  const counters: number[] = [];
  for (const b of blocks) {
    const level = b.indent ?? 0;
    if (b.type === "numbered") {
      counters.length = level + 1;
      counters[level] = (counters[level] ?? 0) + 1;
      out.set(b.id, counters[level]!);
    } else if (b.type !== "bullet" && b.type !== "todo") counters.length = 0;
  }
  return out;
}

export function docToMarkdown(doc: TextDoc): string {
  const nums = listNumbers(doc.blocks);
  const body = doc.blocks.map((b) => {
    if (b.type === "divider") return "---";
    if (b.type === "image") return `![${b.text}](${b.url ?? ""})`;
    if (b.type === "code") return "```\n" + b.text + "\n```";
    return mdPrefix(b, nums.get(b.id) ?? 1) + b.text;
  });
  return `# ${doc.title}\n\n${body.join("\n\n")}\n`;
}
