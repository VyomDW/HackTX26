import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Bold,
  CheckSquare,
  Code,
  Download,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  Minus,
  Redo2,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { Block, BlockType, TextDoc, UserOp } from "@hacktx/shared";
import { redoMine, undoMine } from "@/lib/actions";
import { fileToDataUrl, shortId } from "@/lib/canvas";
import { download, safeName } from "@/lib/download";
import { docToMarkdown, docToWordHtml, inline, listNumbers } from "@/lib/markdown";
import { useTypewriter } from "@/lib/typing";
import { cn } from "@/lib/utils";
import { isBusy, useDoc } from "@/store/deck";
import { commit } from "@/store/editor";
import { Popover } from "./ui/popover";

const TEXT_TYPES: { type: BlockType; label: string }[] = [
  { type: "p", label: "Normal text" },
  { type: "h1", label: "Heading 1" },
  { type: "h2", label: "Heading 2" },
  { type: "h3", label: "Heading 3" },
  { type: "bullet", label: "Bulleted list" },
  { type: "numbered", label: "Numbered list" },
  { type: "todo", label: "Checklist" },
  { type: "quote", label: "Quote" },
  { type: "code", label: "Code" },
  { type: "callout", label: "Callout" },
];
const LIST_TYPES: BlockType[] = ["bullet", "numbered", "todo"];
const hasText = (t: BlockType) => t !== "divider" && t !== "image";
const newBlockId = () => `b-${shortId()}`;

/** Typing "# ", "- ", "1. ", "[] ", "> " or "```" at the start of a paragraph converts it, as in Docs and Notion. */
const SHORTCUTS: [RegExp, BlockType][] = [
  [/^### $/, "h3"],
  [/^## $/, "h2"],
  [/^# $/, "h1"],
  [/^[-*] $/, "bullet"],
  [/^1\. $/, "numbered"],
  [/^\[\] $/, "todo"],
  [/^> $/, "quote"],
  [/^```$/, "code"],
];

type Caret = number | "start" | "end";
interface BlockApi {
  wrap: (before: string, after?: string) => void;
}

/** Google Docs / Word style editor: a paper page of blocks, edited in place. */
export function DocEditor({ doc }: { doc: TextDoc }) {
  const [activeId, setActiveId] = useState<string>();
  const [focusReq, setFocusReq] = useState<{ id: string; caret: Caret; n: number }>();
  const apis = useRef(new Map<string, BlockApi>());
  const nums = useMemo(() => listNumbers(doc.blocks), [doc.blocks]);
  const active = doc.blocks.find((b) => b.id === activeId);

  const focusBlock = (id: string, caret: Caret) => setFocusReq({ id, caret, n: Date.now() });

  const addAtEnd = () => {
    const last = doc.blocks.at(-1);
    if (last && hasText(last.type) && last.text === "") return focusBlock(last.id, "end");
    const id = newBlockId();
    commit({ type: "insert_block", id, blockType: "p", text: "" });
    focusBlock(id, "start");
  };

  const setType = (type: BlockType) => {
    if (!active || !hasText(active.type)) return;
    commit({ type: "set_block", id: active.id, blockType: active.type === type ? "p" : type });
  };

  const insertAfterActive = (op: Omit<UserOp & { type: "insert_block" }, "afterId">) =>
    commit({ ...op, afterId: activeId ?? doc.blocks.at(-1)?.id ?? null });

  const words = useMemo(() => doc.blocks.reduce((n, b) => n + (b.text.match(/\S+/g)?.length ?? 0), 0), [doc.blocks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-2 [scrollbar-width:none] print:hidden">
        <Tool icon={Undo2} label="Undo (⌘Z)" onClick={undoMine} />
        <Tool icon={Redo2} label="Redo (⌘⇧Z)" onClick={redoMine} />
        <Sep />
        <select
          value={active && hasText(active.type) ? active.type : "p"}
          onChange={(e) => active && commit({ type: "set_block", id: active.id, blockType: e.target.value as BlockType })}
          onMouseDown={(e) => e.stopPropagation()}
          disabled={!active || !hasText(active.type)}
          className="h-8 w-36 rounded-md px-1 text-sm hover:bg-slate-100 disabled:opacity-50"
          title="Text style"
        >
          {TEXT_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <Sep />
        <Tool icon={Bold} label="Bold (⌘B)" onClick={() => activeId && apis.current.get(activeId)?.wrap("**")} />
        <Tool icon={Italic} label="Italic (⌘I)" onClick={() => activeId && apis.current.get(activeId)?.wrap("*")} />
        <Tool icon={Strikethrough} label="Strikethrough" onClick={() => activeId && apis.current.get(activeId)?.wrap("~~")} />
        <Tool icon={Code} label="Inline code (⌘E)" onClick={() => activeId && apis.current.get(activeId)?.wrap("`")} />
        <Tool icon={Link2} label="Link (⌘K)" onClick={() => activeId && apis.current.get(activeId)?.wrap("[", "](https://)")} />
        <Sep />
        {(
          [
            ["left", TextAlignStart],
            ["center", TextAlignCenter],
            ["right", TextAlignEnd],
          ] as const
        ).map(([align, icon]) => (
          <Tool
            key={align}
            icon={icon}
            label={`Align ${align}`}
            active={(active?.align ?? "left") === align && !!active}
            onClick={() => active && commit({ type: "set_block", id: active.id, align: align === "left" ? null : align })}
          />
        ))}
        <Sep />
        <Tool icon={List} label="Bulleted list" active={active?.type === "bullet"} onClick={() => setType("bullet")} />
        <Tool icon={ListOrdered} label="Numbered list" active={active?.type === "numbered"} onClick={() => setType("numbered")} />
        <Tool icon={CheckSquare} label="Checklist" active={active?.type === "todo"} onClick={() => setType("todo")} />
        <Tool icon={IndentDecrease} label="Decrease indent (⇧Tab)" onClick={() => active && commit({ type: "set_block", id: active.id, indent: Math.max(0, (active.indent ?? 0) - 1) })} />
        <Tool icon={IndentIncrease} label="Increase indent (Tab)" onClick={() => active && commit({ type: "set_block", id: active.id, indent: Math.min(4, (active.indent ?? 0) + 1) })} />
        <Sep />
        <Tool icon={Lightbulb} label="Callout" active={active?.type === "callout"} onClick={() => setType("callout")} />
        <Tool icon={Minus} label="Insert divider" onClick={() => insertAfterActive({ type: "insert_block", id: newBlockId(), blockType: "divider", text: "" })} />
        <ImageButton onImage={(url, name) => insertAfterActive({ type: "insert_block", id: newBlockId(), blockType: "image", text: name, url })} />
        <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          <span className="hidden text-xs tabular-nums text-slate-400 sm:inline">{words.toLocaleString()} words</span>
          <Popover trigger={() => <Tool icon={Download} label="Download" text="Export" />}>
            {(close) => (
              <div className="flex w-48 flex-col text-sm">
                <MenuItem
                  onClick={() => {
                    download(`${safeName(doc.title)}.doc`, docToWordHtml(doc), "application/msword");
                    close();
                  }}
                >
                  Word document (.doc)
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    download(`${safeName(doc.title)}.md`, docToMarkdown(doc), "text/markdown");
                    close();
                  }}
                >
                  Markdown (.md)
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    window.print();
                  }}
                >
                  PDF (print)
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 px-3 py-6 print:overflow-visible print:bg-white print:p-0 sm:px-6 sm:py-10">
        <div
          className="mx-auto min-h-[70vh] w-full max-w-[816px] rounded-sm bg-white px-6 py-10 shadow-[0_1px_3px_rgba(0,0,0,0.08),0_6px_20px_rgba(0,0,0,0.05)] print:max-w-none print:shadow-none sm:px-[72px] sm:py-16"
          onClick={(e) => e.target === e.currentTarget && addAtEnd()}
        >
          <TitleInput title={doc.title} />
          {doc.blocks.length === 0 && (
            <button onClick={addAtEnd} className="mt-2 w-full text-left text-[15px] text-slate-400">
              Start writing, or ask Muse to draft something…
            </button>
          )}
          {doc.blocks.map((block, i) => (
            <BlockRow
              key={block.id}
              block={block}
              number={nums.get(block.id)}
              prev={doc.blocks[i - 1]}
              next={doc.blocks[i + 1]}
              focusReq={focusReq?.id === block.id ? focusReq : undefined}
              onActive={(on) => setActiveId((cur) => (on ? block.id : cur === block.id ? undefined : cur))}
              focusBlock={focusBlock}
              register={(api) => (api ? apis.current.set(block.id, api) : apis.current.delete(block.id))}
            />
          ))}
          <div className="h-24 cursor-text print:hidden" onClick={addAtEnd} />
        </div>
      </div>
    </div>
  );
}

function TitleInput({ title }: { title: string }) {
  const [text, setText] = useState(title);
  useEffect(() => setText(title), [title]);
  const save = () => text.trim() && text !== title && commit({ type: "set_title", title: text.trim() });
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="Untitled document"
      className="mb-4 w-full bg-transparent text-[32px] font-bold leading-tight tracking-tight text-slate-900 outline-none placeholder:text-slate-300"
    />
  );
}

const TYPE_CLASS: Record<BlockType, string> = {
  h1: "text-[26px] font-bold leading-tight mt-6 mb-1",
  h2: "text-[21px] font-semibold leading-snug mt-5 mb-1",
  h3: "text-[17px] font-semibold mt-4",
  p: "text-[15px] leading-7",
  bullet: "text-[15px] leading-7",
  numbered: "text-[15px] leading-7",
  todo: "text-[15px] leading-7",
  quote: "text-[15px] leading-7 italic text-slate-600",
  code: "font-mono text-[13px] leading-6 whitespace-pre text-slate-800",
  callout: "text-[15px] leading-7",
  divider: "",
  image: "",
};

function BlockRow({
  block,
  number,
  prev,
  next,
  focusReq,
  onActive,
  focusBlock,
  register,
}: {
  block: Block;
  number?: number;
  prev?: Block;
  next?: Block;
  focusReq?: { caret: Caret; n: number };
  onActive: (on: boolean) => void;
  focusBlock: (id: string, caret: Caret) => void;
  register: (api: BlockApi | undefined) => void;
}) {
  // A block created by Enter mounts already editing, so the very next keystroke lands in it.
  const [editing, setEditing] = useState(() => !!focusReq && hasText(block.type));
  const [draft, setDraft] = useState(block.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(draft);
  latest.current = draft;
  const flash = useDoc((s) => (s.flash?.elementId === block.id && !s.flash.slideId ? s.flash : undefined));
  const aiHere = useDoc((s) => s.focus?.elementId === block.id && isBusy(s));
  const rowRef = useRef<HTMLDivElement>(null);

  // Remote edits show up whenever this block isn't being typed in.
  useEffect(() => {
    if (!editing) setDraft(block.text);
  }, [block.text, editing]);

  useEffect(() => {
    if (aiHere) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [aiHere, flash?.key]);

  const save = (text = latest.current) => {
    clearTimeout(timer.current);
    if (text !== block.text) commit({ type: "set_block", id: block.id, text });
  };

  // Focus requests (Enter, Backspace merge, arrow keys) switch to editing; the caret is placed once the textarea exists.
  const pendingCaret = useRef<Caret | undefined>(undefined);
  // Each request is honoured once; otherwise a later re-render (e.g. a server echo changing the type) would steal focus back.
  const handled = useRef<number>(undefined);
  useLayoutEffect(() => {
    if (!focusReq || handled.current === focusReq.n) return;
    handled.current = focusReq.n;
    if (!hasText(block.type)) {
      rowRef.current?.focus();
      return;
    }
    pendingCaret.current = focusReq.caret;
    setEditing(true);
  }, [focusReq, block.type]);
  useLayoutEffect(() => {
    const el = ref.current;
    const caret = pendingCaret.current;
    if (!editing || !el || caret === undefined) return;
    pendingCaret.current = undefined;
    el.focus();
    const pos = caret === "start" ? 0 : caret === "end" ? el.value.length : caret;
    el.setSelectionRange(pos, pos);
  }, [editing, focusReq]);

  /** Selection to restore after wrapping text in ** or *, applied in the same frame as the new value. */
  const pendingSelection = useRef<[number, number] | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
    if (pendingSelection.current) {
      el.focus();
      el.setSelectionRange(...pendingSelection.current);
      pendingSelection.current = undefined;
    }
  }, [draft, editing]);

  const wrap = (before: string, after = before) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const text = value.slice(0, a) + before + value.slice(a, b) + after + value.slice(b);
    pendingSelection.current = [a + before.length, b + before.length];
    setDraft(text);
    save(text);
  };

  useEffect(() => {
    register({ wrap });
    return () => register(undefined);
  });

  const change = (text: string) => {
    if (block.type === "p") {
      for (const [re, type] of SHORTCUTS) {
        if (re.test(text)) {
          setDraft("");
          clearTimeout(timer.current);
          commit({ type: "set_block", id: block.id, blockType: type, text: "" });
          return;
        }
      }
    }
    setDraft(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), 700);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b } = el;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && ["b", "i", "e", "k"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === "b") wrap("**");
      else if (k === "i") wrap("*");
      else if (k === "e") wrap("`");
      else wrap("[", "](https://)");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && block.type !== "code") {
      e.preventDefault();
      const isList = LIST_TYPES.includes(block.type);
      if (isList && draft === "") {
        commit({ type: "set_block", id: block.id, blockType: "p", indent: 0 });
        return;
      }
      clearTimeout(timer.current);
      const before = draft.slice(0, a);
      const after = draft.slice(b);
      const id = newBlockId();
      setDraft(before);
      commit(
        { type: "set_block", id: block.id, text: before },
        {
          type: "insert_block",
          id,
          afterId: block.id,
          blockType: isList ? block.type : "p",
          text: after,
          ...(isList && block.indent ? { indent: block.indent } : {}),
        },
      );
      focusBlock(id, "start");
      return;
    }
    if (e.key === "Backspace" && a === 0 && b === 0) {
      if (block.type !== "p") {
        e.preventDefault();
        commit({ type: "set_block", id: block.id, blockType: "p", indent: 0 });
        return;
      }
      if (prev) {
        e.preventDefault();
        clearTimeout(timer.current);
        if (!hasText(prev.type)) {
          commit({ type: "delete_block", id: prev.id });
          return;
        }
        commit({ type: "set_block", id: prev.id, text: prev.text + draft }, { type: "delete_block", id: block.id });
        focusBlock(prev.id, prev.text.length);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const indent = Math.max(0, Math.min(4, (block.indent ?? 0) + (e.shiftKey ? -1 : 1)));
      if (indent !== (block.indent ?? 0)) commit({ type: "set_block", id: block.id, indent });
      return;
    }
    if (e.key === "ArrowUp" && a === 0 && prev) {
      e.preventDefault();
      focusBlock(prev.id, "end");
    } else if (e.key === "ArrowDown" && b === draft.length && next) {
      e.preventDefault();
      focusBlock(next.id, "start");
    }
  };

  const shown = useTypewriter(block.text, editing || !flash?.typeMs ? undefined : flash.key, flash?.typeMs ?? 0);

  const indent = (block.indent ?? 0) * 24;
  let marker: ReactNode = null;
  if (block.type === "bullet") marker = <span className="w-5 shrink-0 select-none text-slate-500">{["•", "◦", "▪"][(block.indent ?? 0) % 3]}</span>;
  if (block.type === "numbered") marker = <span className="w-6 shrink-0 select-none tabular-nums text-slate-500">{number}.</span>;
  if (block.type === "todo")
    marker = (
      <input
        type="checkbox"
        checked={!!block.checked}
        onChange={() => commit({ type: "set_block", id: block.id, checked: !block.checked })}
        className="mr-2 mt-[7px] size-4 shrink-0 accent-violet-600"
      />
    );
  if (block.type === "callout") marker = <Lightbulb className="mr-2 mt-1.5 size-4 shrink-0 text-violet-500" />;

  if (!hasText(block.type)) {
    return (
      <div
        ref={rowRef}
        tabIndex={0}
        onFocus={() => onActive(true)}
        onBlur={() => onActive(false)}
        onKeyDown={(e) => {
          if (e.key === "Backspace" || e.key === "Delete") {
            e.preventDefault();
            commit({ type: "delete_block", id: block.id });
            if (prev) focusBlock(prev.id, "end");
          } else if (e.key === "Enter") {
            e.preventDefault();
            const id = newBlockId();
            commit({ type: "insert_block", id, afterId: block.id, blockType: "p", text: "" });
            focusBlock(id, "start");
          }
        }}
        className="group relative my-3 rounded outline-none ring-violet-400 focus:ring-2"
      >
        {block.type === "divider" ? (
          <hr className="my-5 border-slate-300" />
        ) : block.url ? (
          <img src={block.url} alt={block.text} className="mx-auto max-h-[480px] max-w-full rounded" style={{ textAlign: block.align }} />
        ) : (
          <div className="rounded bg-slate-100 p-6 text-center text-sm text-slate-500">Image: {block.text}</div>
        )}
      </div>
    );
  }

  const text = editing ? draft : block.text;
  return (
    <div
      ref={rowRef}
      className={cn(
        "group relative flex rounded-sm transition-colors",
        block.type === "quote" && "my-2 border-l-[3px] border-slate-300 pl-4",
        block.type === "code" && "my-2 rounded-md bg-slate-50 px-4 py-3 ring-1 ring-slate-200",
        block.type === "callout" && "my-2 rounded-lg bg-violet-50 px-4 py-2.5",
        flash && !editing && "bg-violet-100/60",
      )}
      style={{ paddingLeft: block.type === "quote" ? undefined : indent || undefined, textAlign: block.align }}
    >
      {marker}
      <div className={cn("min-w-0 flex-1", TYPE_CLASS[block.type], block.type === "todo" && block.checked && "text-slate-400 line-through")}>
        {editing ? (
          <textarea
            ref={ref}
            value={draft}
            rows={1}
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => onActive(true)}
            onBlur={() => {
              save();
              setEditing(false);
              onActive(false);
            }}
            placeholder={block.type === "p" ? "Type, or use # - 1. [] > for styles" : TEXT_TYPES.find((t) => t.type === block.type)?.label}
            className="block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-slate-300"
            style={{ font: "inherit", lineHeight: "inherit", textAlign: "inherit", color: "inherit", textDecoration: "inherit" }}
          />
        ) : (
          <div
            className="min-h-[1.75em] cursor-text whitespace-pre-wrap break-words"
            onClick={() => focusBlock(block.id, "end")}
            onMouseDown={(e) => {
              // Clicking a link shouldn't enter edit mode.
              if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
            }}
          >
            {text ? (
              block.type === "code" ? (
                text.slice(0, shown)
              ) : (
                inline(text.slice(0, shown))
              )
            ) : (
              <span className="text-slate-300">{block.type === "p" ? "" : TEXT_TYPES.find((t) => t.type === block.type)?.label}</span>
            )}
            {shown < text.length && <span className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.15em] animate-pulse bg-violet-500" />}
          </div>
        )}
      </div>
      {aiHere && (
        <span className="pointer-events-none absolute -right-2 top-1 translate-x-full rounded-md bg-violet-600 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow max-sm:hidden">
          Muse
        </span>
      )}
    </div>
  );
}

function ImageButton({ onImage }: { onImage: (url: string, name: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Tool icon={ImagePlus} label="Insert image" onClick={() => ref.current?.click()} />
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const { url } = await fileToDataUrl(file, 1400);
          onImage(url, file.name);
        }}
      />
    </>
  );
}

export function Tool({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  text,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  text?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Keep focus (and the text selection) in the editor while clicking toolbar buttons.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm text-slate-700 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40",
        active && "bg-violet-100 text-violet-700 hover:bg-violet-100",
      )}
    >
      <Icon className="size-4" />
      {text && <span className="text-xs">{text}</span>}
    </button>
  );
}

export const Sep = () => <div className="mx-1 h-5 w-px shrink-0 bg-slate-200" />;

export function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-md px-2 py-1.5 text-left hover:bg-slate-100">
      {children}
    </button>
  );
}
