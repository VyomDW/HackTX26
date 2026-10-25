import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, LayoutGrid, Link2, Loader2, X } from "lucide-react";
import { BoardTemplate, DocKind } from "@hacktx/shared";
import { Activity, AiAvatar } from "@/components/Activity";
import { Logo } from "@/components/Logo";
import { BoardEditor } from "@/components/board/BoardEditor";
import { DocEditor } from "@/components/DocEditor";
import { Dock } from "@/components/Dock";
import { Home } from "@/components/Home";
import { MediaStudio } from "@/components/MediaStudio";
import { useVoiceBridge } from "@/components/MicButton";
import { NotesEditor } from "@/components/NotesEditor";
import { NameDialog, PresenceStack } from "@/components/Presence";
import { Present, PrintDeck } from "@/components/Present";
import { SheetEditor } from "@/components/SheetEditor";
import { StudioEditor } from "@/components/StudioEditor";
import { SlidesEditor } from "@/components/SlidesEditor";
import { useIdentity } from "@/lib/identity";
import { metaOf } from "@/lib/kinds";
import { useRoomSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { isBusy, useDoc } from "@/store/deck";
import { commit, useEditor } from "@/store/editor";

const params = new URLSearchParams(location.search);
const roomId = params.get("room");

export default function App() {
  const { userId, name, setName, suggestedName } = useIdentity();
  if (params.has("media")) return <MediaStudio initialTab={params.get("media") === "video" ? "video" : "music"} />;
  if (!roomId) return <Home />;
  // Nobody joins a file until they have a name, so the transcript and the AI prompt never show a raw id.
  if (!name)
    return (
      <div className="ink stage-bg h-dvh">
        <NameDialog initial={suggestedName} onSave={setName} />
      </div>
    );
  return (
    <Workspace
      roomId={roomId}
      kind={DocKind.safeParse(params.get("kind")).data}
      initialPrompt={params.get("q") ?? undefined}
      template={BoardTemplate.safeParse(params.get("template")).data}
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
  template,
  userId,
  name,
  onRename,
}: {
  roomId: string;
  kind?: DocKind;
  initialPrompt?: string;
  template?: BoardTemplate;
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
  const desktop = useMedia("(min-width: 1024px)");
  useVoiceBridge(roomId, userId);

  useEffect(() => useEditor.setState({ send }), [send]);
  useEffect(() => {
    if (loaded) document.title = `${doc.title} · nodepad`;
  }, [loaded, doc.title]);

  // A new board takes the template picked on the home screen (before any first request, so nodepad knows it).
  const setTemplate = useRef(false);
  useEffect(() => {
    if (!loaded || !connected || setTemplate.current) return;
    setTemplate.current = true;
    if (doc.kind === "board" && !doc.template && template) commit({ type: "set_board", template });
  }, [loaded, connected, doc, template]);

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
      <div className={cn("ink flex h-dvh flex-col bg-page font-ui text-ink", doc.kind === "slides" ? "print:hidden" : "print:block print:h-auto")}>
        <Header roomId={roomId} userId={userId} connected={connected} onRename={() => setRenaming(true)} />
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)_auto]">
          <div className="order-1 flex min-h-[44dvh] min-w-0 flex-1 flex-col lg:order-none lg:col-start-1 lg:row-start-1 lg:min-h-0">
            {!loaded ? (
              <div className="stage-bg flex flex-1 items-center justify-center text-dim">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : doc.kind === "slides" ? (
              <SlidesEditor userId={userId} onPrompt={prompt} />
            ) : doc.kind === "doc" ? (
              <DocEditor doc={doc} />
            ) : doc.kind === "sheet" ? (
              <SheetEditor sheet={doc} />
            ) : doc.kind === "studio" ? (
              <StudioEditor scene={doc} onPrompt={prompt} />
            ) : doc.kind === "board" ? (
              <BoardEditor board={doc} />
            ) : (
              <NotesEditor book={doc} />
            )}
          </div>
          <Activity
            userId={userId}
            compact={!desktop}
            suggestions={loaded && doc.kind !== "slides" ? metaOf(doc.kind, doc.kind === "board" ? doc.template : undefined).suggestions : undefined}
            onPick={(t) => connected && prompt(t)}
            className="order-2 max-h-[34dvh] shrink-0 border-t border-line print:hidden lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-none lg:border-l lg:border-t-0"
          />
          <Dock
            onPrompt={prompt}
            onStop={() => send({ type: "stop" })}
            disabled={!connected}
            placeholder={metaOf(doc.kind, doc.kind === "board" ? doc.template : undefined).placeholder}
            className="order-3 shrink-0 pb-[max(12px,env(safe-area-inset-bottom))] print:hidden lg:order-none lg:col-start-1 lg:row-start-2"
          />
        </div>
        <ErrorToast />
      </div>
      {renaming && (
        <div className="ink">
          <NameDialog
            initial={name}
            onCancel={() => setRenaming(false)}
            onSave={(next) => {
              setRenaming(false);
              onRename(next);
            }}
          />
        </div>
      )}
      {doc.kind === "slides" && presenting && <Present />}
      {doc.kind === "slides" && <PrintDeck />}
    </>
  );
}

function Header({ roomId, userId, connected, onRename }: { roomId: string; userId: string; connected: boolean; onRename: () => void }) {
  const aiStatus = useDoc((s) => s.aiStatus);
  const doc = useDoc((s) => s.doc);
  const loaded = useDoc((s) => s.loaded);
  const busy = useDoc(isBusy);
  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState(doc.title);
  useEffect(() => setTitle(doc.title), [doc.title]);
  const K = metaOf(doc.kind, doc.kind === "board" ? doc.template : undefined);

  const label = !connected ? "Reconnecting…" : aiStatus === "thinking" ? "Thinking…" : busy ? "Editing…" : "Ready";

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 bg-page px-3 print:hidden sm:gap-3 lg:px-4">
      <a href={location.pathname} title="All files" className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 font-display text-[17px] font-bold hover:bg-slate-100">
        <Logo />
        <span className="max-sm:hidden">nodepad</span>
        <LayoutGrid className="size-3.5 text-dim" />
      </a>
      <div className="flex min-w-0 items-center gap-2 border-l border-line pl-2 sm:pl-3">
        {loaded && (
          <div className={cn("grid size-6 shrink-0 place-items-center rounded-md text-white", K.color)} title={K.label}>
            <K.icon className="size-3.5" />
          </div>
        )}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== doc.title && commit({ type: "set_title", title: title.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          disabled={!loaded}
          style={{ width: `${Math.max(title.length, 8) + 2}ch` }}
          className="min-w-0 max-w-[34vw] truncate rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold outline-none hover:bg-slate-100 focus:bg-slate-100 sm:max-w-md"
          aria-label="File name"
        />
      </div>
      <div
        className={cn(
          "hidden shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-medium md:flex",
          !connected ? "bg-amber-100 text-amber-800" : busy ? "bg-orb/10 text-orb" : "bg-slate-100 text-dim",
        )}
      >
        <span className={cn("size-2 rounded-full", !connected ? "bg-amber-400" : busy ? "animate-pulse bg-orb" : "bg-emerald-400")} />
        {label}
      </div>
      <div className="flex-1" />
      <div className="flex shrink-0 items-center">
        <PresenceStack userId={userId} onRename={onRename} />
        <AiAvatar className="-ml-2 ring-2 ring-[var(--page)]" />
      </div>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="ink-btn flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--ink)] px-2.5 py-1.5 text-xs font-bold text-[var(--page)] sm:px-3"
      >
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
        <span className="hidden sm:inline">{copied ? "Copied" : "Invite"}</span>
      </button>
    </header>
  );
}

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
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
