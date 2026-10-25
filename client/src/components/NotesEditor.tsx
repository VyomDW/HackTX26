import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckSquare, Download, Eye, Pencil, Pin, Plus, Redo2, Search, Tag, Trash2, Undo2 } from "lucide-react";
import type { Note, Notebook } from "@hacktx/shared";
import { redoMine, undoMine } from "@/lib/actions";
import { shortId } from "@/lib/canvas";
import { download, safeName } from "@/lib/download";
import { MarkdownBody, toggleChecklistLine } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { isBusy, useDoc } from "@/store/deck";
import { commit } from "@/store/editor";
import { Sep, Tool } from "./DocEditor";

const COLORS = ["#fef3c7", "#dcfce7", "#dbeafe", "#fce7f3", "#ede9fe", "#ffedd5", "#f1f5f9"];

const snippet = (body: string) =>
  body
    .replace(/^- \[( |x|X)\] /gm, "")
    .replace(/[#*`>\-[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

/** Apple Notes / Keep style notebook: searchable list on the left, the open note on the right. */
export function NotesEditor({ book }: { book: Notebook }) {
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string>();
  const [mobileOpen, setMobileOpen] = useState(false);
  const aiNote = useDoc((s) => (isBusy(s) && s.focus?.elementId && !s.focus.slideId && !s.focus.targets ? s.focus.elementId : undefined));

  // Follow the AI to whichever note it is writing.
  useEffect(() => {
    if (aiNote && book.notes.some((n) => n.id === aiNote)) setSelected(aiNote);
  }, [aiNote, book.notes]);

  const tags = useMemo(() => [...new Set(book.notes.flatMap((n) => n.tags ?? []))].sort(), [book.notes]);
  const q = query.trim().toLowerCase();
  const visible = book.notes.filter(
    (n) => (!tag || n.tags?.includes(tag)) && (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || n.tags?.some((t) => t.toLowerCase().includes(q))),
  );
  const pinned = visible.filter((n) => n.pinned);
  const others = visible.filter((n) => !n.pinned);
  const current = book.notes.find((n) => n.id === selected) ?? (mobileOpen ? undefined : (book.notes.find((n) => n.pinned) ?? book.notes[0]));

  const newNote = () => {
    const id = `n-${shortId()}`;
    commit({ type: "add_note", id, title: "", body: "", ...(tag ? { tags: [tag] } : {}) });
    setSelected(id);
    setMobileOpen(true);
  };

  const exportAll = () =>
    download(
      `${safeName(book.title)}.md`,
      `# ${book.title}\n\n` + book.notes.map((n) => `## ${n.title || "Untitled"}\n${n.tags?.length ? `Tags: ${n.tags.join(", ")}\n` : ""}\n${n.body}`).join("\n\n---\n\n"),
      "text/markdown",
    );

  const item = (n: Note) => (
    <button
      key={n.id}
      onClick={() => {
        setSelected(n.id);
        setMobileOpen(true);
      }}
      className={cn(
        "relative w-full rounded-lg px-3 py-2.5 text-left transition",
        n.id === current?.id ? "bg-violet-100 ring-1 ring-violet-300" : "hover:bg-slate-100",
        aiNote === n.id && "ring-2 ring-fuchsia-400",
      )}
    >
      <div className="flex items-center gap-2">
        {n.color && <span className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: n.color }} />}
        <span className="truncate text-sm font-semibold text-slate-800">{n.title || "Untitled"}</span>
        {n.pinned && <Pin className="ml-auto size-3 shrink-0 fill-current text-slate-400" />}
      </div>
      <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{snippet(n.body) || "No text"}</div>
      {!!n.tags?.length && (
        <div className="mt-1 flex flex-wrap gap-1">
          {n.tags.map((t) => (
            <span key={t} className="rounded bg-slate-200/70 px-1.5 text-[10px] text-slate-600">
              #{t}
            </span>
          ))}
        </div>
      )}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <aside className={cn("flex w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-72", mobileOpen && "max-md:hidden")}>
        <div className="flex items-center gap-2 border-b border-slate-200 p-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-1.5">
            <Search className="size-4 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <button onClick={newNote} title="New note" className="grid size-8 place-items-center rounded-lg bg-violet-600 text-white hover:bg-violet-700">
            <Plus className="size-4" />
          </button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 py-2">
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => setTag((cur) => (cur === t ? undefined : t))}
                className={cn("rounded-full px-2 py-0.5 text-xs", tag === t ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {book.notes.length === 0 && <p className="p-3 text-sm text-slate-400">No notes yet. Create one, or ask Muse to take notes for you.</p>}
          {pinned.length > 0 && <div className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pinned</div>}
          {pinned.map(item)}
          {pinned.length > 0 && others.length > 0 && <div className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Notes</div>}
          {others.map(item)}
          {book.notes.length > 0 && visible.length === 0 && <p className="p-3 text-sm text-slate-400">No notes match.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-400">
          <span>{book.notes.length} notes</span>
          <button onClick={exportAll} className="flex items-center gap-1 hover:text-slate-700">
            <Download className="size-3.5" /> Export
          </button>
        </div>
      </aside>

      <div className={cn("flex min-w-0 flex-1 flex-col", !mobileOpen && "max-md:hidden")}>
        {current ? (
          <NoteView key={current.id} note={current} onBack={() => setMobileOpen(false)} onDeleted={() => setSelected(undefined)} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Select or create a note</div>
        )}
      </div>
    </div>
  );
}

function NoteView({ note, onBack, onDeleted }: { note: Note; onBack: () => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tagsText, setTagsText] = useState((note.tags ?? []).join(", "));
  const [preview, setPreview] = useState(note.body.length > 0);
  const [focused, setFocused] = useState<"title" | "body" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const flash = useDoc((s) => (s.flash?.elementId === note.id ? s.flash : undefined));

  // Remote edits land whenever that field isn't being typed in.
  useEffect(() => {
    if (focused !== "title") setTitle(note.title);
  }, [note.title, focused]);
  useEffect(() => {
    if (focused !== "body") setBody(note.body);
  }, [note.body, focused]);
  useEffect(() => setTagsText((note.tags ?? []).join(", ")), [note.tags]);
  useEffect(() => {
    if (!note.title && !note.body) setPreview(false);
  }, [note.id]);

  /** Caret to restore after a programmatic edit; applied before the next keystroke can land. */
  const pendingCaret = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 240)}px`;
    if (pendingCaret.current !== undefined) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = undefined;
    }
  }, [body, preview]);

  const save = (patch: { title?: string; body?: string }) => {
    clearTimeout(timer.current);
    const changed = (patch.title !== undefined && patch.title !== note.title) || (patch.body !== undefined && patch.body !== note.body);
    if (changed) commit({ type: "set_note", id: note.id, ...patch });
  };
  const later = (patch: { title?: string; body?: string }) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(patch), 600);
  };

  return (
    <>
      <div className="ink-bar flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]">
        <button onClick={onBack} className="mr-1 grid size-8 place-items-center rounded-md hover:bg-slate-100 md:hidden" title="All notes">
          <ArrowLeft className="size-4" />
        </button>
        <Tool icon={Undo2} label="Undo" onClick={undoMine} />
        <Tool icon={Redo2} label="Redo" onClick={redoMine} />
        <Sep />
        <Tool icon={Pin} label={note.pinned ? "Unpin" : "Pin to top"} active={note.pinned} onClick={() => commit({ type: "set_note", id: note.id, pinned: !note.pinned })} />
        <div className="mx-1 flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              title="Note color"
              onClick={() => commit({ type: "set_note", id: note.id, color: note.color === c ? null : c })}
              className={cn("size-5 rounded-full ring-1 ring-black/10 transition hover:scale-110", note.color === c && "ring-2 ring-violet-500")}
              style={{ background: c }}
            />
          ))}
        </div>
        <Sep />
        <Tool
          icon={CheckSquare}
          label="Add checklist item"
          onClick={() => {
            const next = body + (body && !body.endsWith("\n") ? "\n" : "") + "- [ ] ";
            setBody(next);
            save({ body: next });
            setPreview(false);
            pendingCaret.current = next.length;
          }}
        />
        <Tool icon={preview ? Pencil : Eye} label={preview ? "Edit" : "Preview"} text={preview ? "Edit" : "Preview"} onClick={() => setPreview((p) => !p)} />
        <div className="ml-auto flex items-center gap-1 pl-2">
          <Tool
            icon={Trash2}
            label="Delete note"
            onClick={() => {
              commit({ type: "delete_note", id: note.id });
              onDeleted();
            }}
          />
        </div>
      </div>

      {/* A coloured note is a sheet of paper, so it keeps light-theme text on its pastel; an uncoloured one follows the app theme. */}
      <div className={cn("min-h-0 flex-1 overflow-y-auto", note.color && "paper")} style={{ background: note.color ?? "var(--color-white)" }}>
        <div className={cn("mx-auto max-w-3xl px-6 py-8 transition-colors sm:px-10", flash && "animate-pulse")}>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              later({ title: e.target.value });
            }}
            onFocus={() => setFocused("title")}
            onBlur={() => {
              save({ title });
              setFocused(null);
            }}
            placeholder="Title"
            className="w-full bg-transparent text-2xl font-bold text-slate-900 outline-none placeholder:text-slate-300"
          />
          <div className="mt-2 flex items-center gap-1.5 text-sm text-slate-500">
            <Tag className="size-3.5" />
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              onBlur={() => {
                const tags = [...new Set(tagsText.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean))];
                if (tags.join(",") !== (note.tags ?? []).join(",")) commit({ type: "set_note", id: note.id, tags });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              placeholder="Add tags, separated by commas"
              className="w-full bg-transparent outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="mt-5 text-[15px] text-slate-800">
            {preview ? (
              <div className="min-h-60 cursor-text" onDoubleClick={() => setPreview(false)}>
                {body ? (
                  <MarkdownBody
                    text={body}
                    onToggle={(line) => {
                      const next = toggleChecklistLine(body, line);
                      setBody(next);
                      save({ body: next });
                    }}
                  />
                ) : (
                  <span className="text-slate-400">Empty note. Double-click to write.</span>
                )}
              </div>
            ) : (
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  later({ body: e.target.value });
                }}
                onFocus={() => setFocused("body")}
                onBlur={() => {
                  save({ body });
                  setFocused(null);
                }}
                onKeyDown={(e) => {
                  // Continue checklists and bullets on Enter.
                  if (e.key !== "Enter" || e.shiftKey) return;
                  const el = e.currentTarget;
                  const start = body.lastIndexOf("\n", el.selectionStart - 1) + 1;
                  const line = body.slice(start, el.selectionStart);
                  const m = /^(- \[[ xX]\] |[-*] |(\d+)\. )/.exec(line);
                  if (!m) return;
                  e.preventDefault();
                  if (line === m[0]) {
                    const next = body.slice(0, start) + body.slice(el.selectionStart);
                    pendingCaret.current = start;
                    setBody(next);
                    later({ body: next });
                    return;
                  }
                  const prefix = m[2] ? `${Number(m[2]) + 1}. ` : m[0].startsWith("- [") ? "- [ ] " : m[0];
                  const pos = el.selectionStart;
                  const next = body.slice(0, pos) + "\n" + prefix + body.slice(el.selectionEnd);
                  pendingCaret.current = pos + 1 + prefix.length;
                  setBody(next);
                  later({ body: next });
                }}
                placeholder={"Start typing…\n\nMarkdown works: # heading, - bullet, - [ ] checklist, **bold**"}
                className="w-full resize-none overflow-hidden bg-transparent leading-relaxed outline-none placeholder:text-slate-400"
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
