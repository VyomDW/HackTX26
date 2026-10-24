import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, LayoutGrid, Link2, Loader2, Square, Undo2, X } from "lucide-react";
import { DocKind } from "@hacktx/shared";
import { Button } from "@/components/ui/button";
import { DocEditor } from "@/components/DocEditor";
import { Home } from "@/components/Home";
import { MicButton } from "@/components/MicButton";
import { NotesEditor } from "@/components/NotesEditor";
import { Avatar, NameDialog, PresenceStack } from "@/components/Presence";
import { Present, PrintDeck } from "@/components/Present";
import { SheetEditor } from "@/components/SheetEditor";
import { SlidesEditor } from "@/components/SlidesEditor";
import { useIdentity } from "@/lib/identity";
import { KINDS } from "@/lib/kinds";
import { useRoomSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { isBusy, turnSummary, useDoc } from "@/store/deck";
import { commit, useEditor } from "@/store/editor";

const params = new URLSearchParams(location.search);
const roomId = params.get("room");

export default function App() {
  const { userId, name, setName, suggestedName } = useIdentity();
  if (!roomId) return <Home />;
  // Nobody joins a file until they have a name, so the transcript and the AI prompt never show a raw id.
  if (!name) return <NameDialog initial={suggestedName} onSave={setName} />;
  return (
    <Workspace
      roomId={roomId}
      kind={DocKind.safeParse(params.get("kind")).data}
      initialPrompt={params.get("q") ?? undefined}
      userId={userId}
      name={name}
      onRename={setName}
    />
  );
}

/** One open file: shared header and AI panel around the editor for its kind. */
function Workspace({
  roomId,
  kind,
  initialPrompt,
  userId,
  name,
  onRename,
}: {
  roomId: string;
  kind?: DocKind;
  initialPrompt?: string;
  userId: string;
  name: string;
  onRename: (name: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const { send, connected } = useRoomSocket(roomId, userId, name, kind);
  const doc = useDoc((s) => s.doc);
  const loaded = useDoc((s) => s.loaded);
  const presenting = useEditor((s) => s.presenting);
  const sentInitial = useRef(false);

  useEffect(() => useEditor.setState({ send }), [send]);
  useEffect(() => {
    if (loaded) document.title = `${doc.title} · Muse Office`;
  }, [loaded, doc.title]);

  // A request typed on the home screen is sent once the new file is open, then dropped from the URL.
  useEffect(() => {
    if (!loaded || !connected || !initialPrompt || sentInitial.current) return;
    sentInitial.current = true;
    send({ type: "prompt", text: initialPrompt });
    history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(roomId)}`);
  }, [loaded, connected, initialPrompt, roomId, send]);

  const prompt = (text: string) => {
    send({ type: "prompt", text });
    useEditor.setState({ follow: true });
  };

  return (
    <>
      <div className={cn("flex h-dvh flex-col bg-slate-100 text-slate-900", doc.kind === "slides" ? "print:hidden" : "print:block print:h-auto")}>
        <Header roomId={roomId} userId={userId} connected={connected} onStop={() => send({ type: "stop" })} onRename={() => setRenaming(true)} />
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!loaded ? (
              <div className="flex flex-1 items-center justify-center text-slate-400">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : doc.kind === "slides" ? (
              <SlidesEditor onPrompt={prompt} />
            ) : doc.kind === "doc" ? (
              <DocEditor doc={doc} />
            ) : doc.kind === "sheet" ? (
              <SheetEditor sheet={doc} />
            ) : (
              <NotesEditor book={doc} />
            )}
          </div>
          <Transcript roomId={roomId} userId={userId} onPrompt={prompt} onUndo={(turnId) => send({ type: "undo_turn", turnId })} disabled={!connected} />
        </div>
        <ErrorToast />
      </div>
      {renaming && (
        <NameDialog
          initial={name}
          onCancel={() => setRenaming(false)}
          onSave={(next) => {
            setRenaming(false);
            onRename(next);
          }}
        />
      )}
      {doc.kind === "slides" && presenting && <Present />}
      {doc.kind === "slides" && <PrintDeck />}
    </>
  );
}

function Header({
  roomId,
  userId,
  connected,
  onStop,
  onRename,
}: {
  roomId: string;
  userId: string;
  connected: boolean;
  onStop: () => void;
  onRename: () => void;
}) {
  const aiStatus = useDoc((s) => s.aiStatus);
  const doc = useDoc((s) => s.doc);
  const loaded = useDoc((s) => s.loaded);
  const busy = useDoc(isBusy);
  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.title]);
  const K = KINDS[doc.kind];

  const label = !connected ? "Reconnecting…" : aiStatus === "thinking" ? "Thinking…" : busy ? "Editing…" : "Ready";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 sm:px-4 print:hidden">
      <div className="flex min-w-0 items-center gap-2">
        <a href={location.pathname} title="All files" className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
          <LayoutGrid className="size-4" />
        </a>
        {loaded && (
          <div className={cn("grid size-7 shrink-0 place-items-center rounded-md text-white", K.color)} title={K.label}>
            <K.icon className="size-4" />
          </div>
        )}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== doc.title && commit({ type: "set_title", title: title.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          disabled={!loaded}
          style={{ width: `${Math.max(title.length, 8) + 2}ch` }}
          className="min-w-0 max-w-[40vw] truncate rounded-md bg-transparent px-1.5 py-1 font-semibold outline-none hover:bg-slate-100 focus:bg-slate-100 sm:max-w-md"
          aria-label="File name"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
            !connected ? "bg-amber-100 text-amber-800" : busy ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600",
          )}
        >
          <span className={cn("size-2 rounded-full", !connected ? "bg-amber-500" : busy ? "animate-pulse bg-violet-500" : "bg-emerald-500")} />
          <span className="max-sm:hidden">{label}</span>
        </div>
        {busy && connected && (
          <Button size="sm" variant="outline" onClick={onStop} className="gap-1.5">
            <Square className="size-3 fill-current" /> Stop
          </Button>
        )}
        <PresenceStack userId={userId} onRename={onRename} />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Invite"}</span>
        </Button>
      </div>
    </header>
  );
}

function Transcript({
  roomId,
  userId,
  onPrompt,
  onUndo,
  disabled,
}: {
  roomId: string;
  userId: string;
  onPrompt: (t: string) => void;
  onUndo: (turnId: string) => void;
  disabled: boolean;
}) {
  const turns = useDoc((s) => s.turns);
  const history = useDoc((s) => s.history);
  const kind = useDoc((s) => s.doc.kind);
  const busy = useDoc(isBusy);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const K = KINDS[kind];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, history.length]);

  const submit = () => {
    if (!text.trim() || disabled) return;
    onPrompt(text.trim());
    setText("");
  };

  return (
    <aside className="order-3 flex max-h-[42dvh] shrink-0 flex-col border-t border-slate-200 bg-white print:hidden lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Ask Muse to work on this {K.noun}. Everyone here sees the edits live.</p>
            {K.suggestions.map((s) => (
              <button
                key={s}
                onClick={() => !disabled && onPrompt(s)}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => {
          const { edits, undone } = turnSummary(history, turn.turnId);
          const working = busy && i === turns.length - 1;
          return (
            <div key={turn.turnId} className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Avatar userId={turn.userId} name={turn.name} className="size-4 text-[8px] ring-0" />
                {turn.userId === userId ? "You" : (turn.name ?? "Someone")}
              </div>
              <div className={cn("rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-sm", undone && "text-slate-400 line-through")}>{turn.text}</div>
              <div className="flex items-center justify-between pl-1 text-xs">
                <span className={cn("flex items-center gap-1.5", working ? "text-violet-600" : "text-slate-500")}>
                  {working && <span className="size-1.5 animate-pulse rounded-full bg-violet-500" />}
                  {undone ? "Undone" : working ? `Muse is editing · ${edits} edits` : edits ? `Muse made ${edits} edits` : "No changes"}
                </span>
                {edits > 0 && !undone && (
                  <button onClick={() => onUndo(turn.turnId)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                    <Undo2 className="size-3" /> Undo
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <form
        className="border-t border-slate-200 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
          <textarea
            rows={2}
            maxLength={2000}
            className="flex-1 resize-none bg-transparent px-1 text-sm outline-none placeholder:text-slate-400"
            placeholder={busy ? "Interrupt with a new request…" : K.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <MicButton roomId={roomId} userId={userId} />
          <Button type="submit" size="icon" disabled={!text.trim() || disabled} className="size-8 shrink-0 rounded-lg bg-violet-600 hover:bg-violet-700">
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </form>
    </aside>
  );
}

function ErrorToast() {
  const error = useDoc((s) => s.error);
  const setError = useDoc((s) => s.setError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(undefined), 6000);
    return () => clearTimeout(t);
  }, [error, setError]);

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          key={error.at}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          {error.message}
          <button onClick={() => setError(undefined)} className="text-slate-400 hover:text-white">
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
