import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Link2, X } from "lucide-react";
import { Activity, AiAvatar } from "@/components/Activity";
import { Dock } from "@/components/Dock";
import { Present, PrintDeck } from "@/components/Present";
import { useVoiceBridge } from "@/components/MicButton";
import { NameDialog, PresenceStack } from "@/components/Presence";
import { NewSlideButton, SlideRail } from "@/components/SlideRail";
import { Stage } from "@/components/Stage";
import { StageOverlays } from "@/components/StageOverlays";
import { Toolbar } from "@/components/Toolbar";
import { useIdentity } from "@/lib/identity";
import { useShortcuts } from "@/lib/shortcuts";
import { useRoomSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { isBusy, useDeck } from "@/store/deck";
import { commit, useEditor, type View } from "@/store/editor";

// Three.js only downloads for people who actually get the 3D stage.
const Stage3D = lazy(() => import("@/components/three/Stage3D"));

const roomId = new URLSearchParams(location.search).get("room") ?? "demo";

const SUGGESTIONS = [
  "Make a pitch about sustainable coffee",
  "Explain how solar panels work in 4 slides",
  "Plan a team offsite agenda",
];

const hasWebGL = (() => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
})();

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

export default function App() {
  const { userId, name, setName, suggestedName } = useIdentity();
  // Nobody joins the room until they have a name, so the transcript and the AI prompt never show a raw id.
  if (!name)
    return (
      <div className="night stage-bg h-dvh">
        <NameDialog initial={suggestedName} onSave={setName} />
      </div>
    );
  return <Room userId={userId} name={name} onRename={setName} />;
}

function Room({ userId, name, onRename }: { userId: string; name: string; onRename: (name: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  const { send, connected } = useRoomSocket(roomId, userId, name);
  const deck = useDeck((s) => s.deck);
  const focus = useDeck((s) => s.focus);
  const { slideId, follow, presenting, view, selectedId } = useEditor();
  const desktop = useMedia("(min-width: 1024px)");
  useShortcuts();
  useVoiceBridge(roomId, userId);

  useEffect(() => useEditor.setState({ send }), [send]);
  useEffect(() => {
    if (!hasWebGL && useEditor.getState().view === "3d") useEditor.getState().setView("2d", "no-webgl");
  }, []);

  // Follow mode keeps the stage on whatever slide the AI is touching.
  useEffect(() => {
    if (follow && focus?.slideId && focus.slideId !== useEditor.getState().slideId) useEditor.getState().setSlide(focus.slideId, true);
  }, [follow, focus?.slideId]);

  const current = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];
  const currentIndex = current ? deck.slides.indexOf(current) : -1;
  const flat = view === "2d";

  const prompt = (text: string) => {
    send({ type: "prompt", text });
    useEditor.setState({ follow: true });
  };

  return (
    <>
      <div className="night flex h-dvh flex-col bg-page font-ui text-ink print:hidden">
        <Header userId={userId} connected={connected} onRename={() => setRenaming(true)} />
        {flat && <Toolbar />}

        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[auto_minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)_auto]">
          {flat && (
            <div className="order-2 flex min-h-0 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1">
              <SlideRail />
            </div>
          )}

          <main className="stage-bg relative order-1 flex min-h-[44dvh] min-w-0 flex-1 flex-col overflow-hidden lg:order-none lg:col-start-2 lg:row-start-1 lg:min-h-0">
            {flat ? (
              current ? (
                <>
                  <StageArea>
                    <Stage slide={current} />
                  </StageArea>
                  <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 text-sm text-dim lg:px-8">
                    <span className="tabular-nums">
                      Slide {currentIndex + 1} of {deck.slides.length}
                    </span>
                    <div className="lg:hidden">
                      <NewSlideButton />
                    </div>
                  </div>
                  <Notes key={current.id} slideId={current.id} notes={current.notes ?? ""} />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center p-4">
                  <EmptyState onPick={prompt} />
                </div>
              )
            ) : (
              <>
                <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-sm text-dim">Setting up the 3D stage…</div>}>
                  <Stage3D className="absolute inset-0" />
                </Suspense>
                {!current && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
                    <div className="pointer-events-auto">
                      <EmptyState onPick={prompt} />
                    </div>
                  </div>
                )}
              </>
            )}
            <StageOverlays userId={userId} />
            {/* On the 3D stage the formatting toolbar floats in only while something is selected, so the stage never jumps. */}
            {!flat && selectedId && (
              <div className="absolute inset-x-0 top-0 z-30 shadow-lg">
                <Toolbar />
              </div>
            )}
          </main>

          <Activity
            userId={userId}
            compact={!desktop}
            className="order-3 max-h-[34dvh] shrink-0 border-t border-line lg:order-none lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:max-h-none lg:border-l lg:border-t-0"
          />

          <Dock
            onPrompt={prompt}
            onStop={() => send({ type: "stop" })}
            disabled={!connected}
            className="order-4 shrink-0 pb-[max(12px,env(safe-area-inset-bottom))] lg:order-none lg:col-start-2 lg:row-start-2"
          />
        </div>
        <ErrorToast />
      </div>
      {renaming && (
        <div className="night">
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
      {presenting && <Present />}
      <PrintDeck />
    </>
  );
}

/** Sizes the stage to the largest 16:9 box that fits the available space. */
function StageArea({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry!.contentRect;
      setWidth(Math.max(200, Math.min(w, (h * 16) / 9)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="flex min-h-[220px] flex-1 items-center justify-center p-4 lg:p-8"
      onPointerDown={(e) => e.target === e.currentTarget && useEditor.getState().select(undefined)}
    >
      <div style={{ width }}>{children}</div>
    </div>
  );
}

function Notes({ slideId, notes }: { slideId: string; notes: string }) {
  const [text, setText] = useState(notes);
  useEffect(() => setText(notes), [notes]);
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== notes && commit({ type: "set_slide", slideId, notes: text || null })}
      placeholder="Click to add speaker notes"
      rows={2}
      className="mx-4 mb-3 shrink-0 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-violet-400 lg:mx-8"
    />
  );
}

function Header({ userId, connected, onRename }: { userId: string; connected: boolean; onRename: () => void }) {
  const aiStatus = useDeck((s) => s.aiStatus);
  const busy = useDeck(isBusy);
  const count = useDeck((s) => s.deck.slides.length);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const [copied, setCopied] = useState(false);

  const label = !connected ? "Reconnecting…" : aiStatus === "thinking" ? "Thinking…" : busy ? "Editing…" : "Ready";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/5 bg-[#090b1a]/80 px-3 lg:gap-4 lg:px-4">
      <div className="flex min-w-0 items-center gap-2 font-display text-[17px] font-bold">
        <span className="orb-core size-3.5 shrink-0 rounded-full" />
        Muse
      </div>
      <div className="hidden min-w-0 border-l border-line pl-3 leading-tight sm:grid">
        <b className="truncate text-sm font-semibold">Room {roomId}</b>
        <span className="text-[11px] text-dim">{count === 1 ? "1 slide" : `${count} slides`}</span>
      </div>
      <div
        className={cn(
          "hidden items-center gap-2 rounded-full px-3 py-1 text-xs font-medium md:flex",
          !connected ? "bg-amber-500/15 text-amber-300" : busy ? "bg-orb/15 text-orb" : "bg-white/5 text-dim",
        )}
      >
        <span className={cn("size-2 rounded-full", !connected ? "bg-amber-400" : busy ? "animate-pulse bg-orb" : "bg-emerald-400")} />
        {label}
      </div>
      <div className="flex-1" />
      <div className="flex items-center">
        <PresenceStack userId={userId} onRename={onRename} />
        <AiAvatar className="-ml-2 ring-2 ring-[#0a0d1e]" />
      </div>
      <span className="hidden rounded-md border border-line px-2 py-1 font-mono text-[11px] text-dim lg:inline">
        Room <b className="font-semibold text-ink">{roomId}</b>
      </span>
      <div role="group" aria-label="View" className="flex overflow-hidden rounded-lg border border-line text-xs">
        {(["3d", "2d"] as View[]).map((v) => (
          <button
            key={v}
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn("px-3 py-1.5 uppercase", view === v ? "bg-orb/15 font-bold text-orb" : "text-dim hover:text-ink")}
          >
            {v}
          </button>
        ))}
      </div>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${roomId}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex items-center gap-1.5 rounded-lg bg-orb px-2.5 py-1.5 text-xs font-bold text-orb-ink sm:px-3"
      >
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
        <span className="hidden sm:inline">{copied ? "Copied" : "Invite"}</span>
      </button>
    </header>
  );
}

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 text-center">
      <h2 className="font-display text-3xl font-bold tracking-tight">What are we presenting?</h2>
      <p className="text-sm text-slate-500">Ask Muse for a deck and watch it build live. Everyone in this room sees the same slides.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm transition hover:border-violet-400 hover:text-violet-700">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ErrorToast() {
  const error = useDeck((s) => s.error);
  const setError = useDeck((s) => s.setError);

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
