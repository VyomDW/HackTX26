import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, Crosshair, Link2, Square, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Present, PrintDeck } from "@/components/Present";
import { MicButton } from "@/components/MicButton";
import { Avatar, NameDialog, PresenceStack } from "@/components/Presence";
import { NewSlideButton, SlideRail } from "@/components/SlideRail";
import { Stage } from "@/components/Stage";
import { Toolbar } from "@/components/Toolbar";
import { useIdentity } from "@/lib/identity";
import { useShortcuts } from "@/lib/shortcuts";
import { useRoomSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { isBusy, turnSummary, useDeck } from "@/store/deck";
import { commit, useEditor } from "@/store/editor";

const roomId = new URLSearchParams(location.search).get("room") ?? "demo";

const SUGGESTIONS = [
  "Make a pitch about sustainable coffee",
  "Explain how solar panels work in 4 slides",
  "Plan a team offsite agenda",
];

export default function App() {
  const { userId, name, setName, suggestedName } = useIdentity();
  // Nobody joins the room until they have a name, so the transcript and the AI prompt never show a raw id.
  if (!name) return <NameDialog initial={suggestedName} onSave={setName} />;
  return <Room userId={userId} name={name} onRename={setName} />;
}

function Room({ userId, name, onRename }: { userId: string; name: string; onRename: (name: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  const { send, connected } = useRoomSocket(roomId, userId, name);
  const deck = useDeck((s) => s.deck);
  const focus = useDeck((s) => s.focus);
  const { slideId, follow, presenting } = useEditor();
  useShortcuts();

  useEffect(() => useEditor.setState({ send }), [send]);

  // Follow mode keeps the stage on whatever slide the AI is touching.
  useEffect(() => {
    if (follow && focus?.slideId && focus.slideId !== useEditor.getState().slideId) useEditor.getState().setSlide(focus.slideId, true);
  }, [follow, focus?.slideId]);

  const current = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];
  const currentIndex = current ? deck.slides.indexOf(current) : -1;

  const prompt = (text: string) => {
    send({ type: "prompt", text });
    useEditor.setState({ follow: true });
  };

  return (
    <>
      <div className="flex h-dvh flex-col bg-slate-100 text-slate-900 print:hidden">
        <Header userId={userId} connected={connected} onStop={() => send({ type: "stop" })} onRename={() => setRenaming(true)} />
        <Toolbar />

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <SlideRail />

          <main className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-none">
            {current ? (
              <>
                <StageArea>
                  <Stage slide={current} />
                </StageArea>
                <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 text-sm text-slate-500 lg:px-8">
                  <span className="tabular-nums">
                    Slide {currentIndex + 1} of {deck.slides.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="lg:hidden">
                      <NewSlideButton />
                    </div>
                    <button
                      onClick={() => useEditor.setState((s) => ({ follow: !s.follow }))}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
                        follow ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-200",
                      )}
                    >
                      <Crosshair className="size-3.5" />
                      {follow ? "Following Muse" : "Follow Muse"}
                    </button>
                  </div>
                </div>
                <Notes key={current.id} slideId={current.id} notes={current.notes ?? ""} />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-4">
                <EmptyState onPick={prompt} />
              </div>
            )}
          </main>

          <Transcript userId={userId} onPrompt={prompt} onUndo={(turnId) => send({ type: "undo_turn", turnId })} disabled={!connected} />
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

function Header({ userId, connected, onStop, onRename }: { userId: string; connected: boolean; onStop: () => void; onRename: () => void }) {
  const aiStatus = useDeck((s) => s.aiStatus);
  const busy = useDeck(isBusy);
  const [copied, setCopied] = useState(false);

  const label = !connected ? "Reconnecting…" : aiStatus === "thinking" ? "Thinking…" : busy ? "Editing…" : "Ready";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-7 place-items-center rounded-lg bg-violet-600 text-sm font-bold text-white">M</div>
        <span className="truncate font-semibold">Room {roomId}</span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
            !connected ? "bg-amber-100 text-amber-800" : busy ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600",
          )}
        >
          <span className={cn("size-2 rounded-full", !connected ? "bg-amber-500" : busy ? "animate-pulse bg-violet-500" : "bg-emerald-500")} />
          {label}
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
            void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${roomId}`);
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
  userId,
  onPrompt,
  onUndo,
  disabled,
}: {
  userId: string;
  onPrompt: (t: string) => void;
  onUndo: (turnId: string) => void;
  disabled: boolean;
}) {
  const turns = useDeck((s) => s.turns);
  const history = useDeck((s) => s.history);
  const busy = useDeck(isBusy);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, history.length]);

  const submit = () => {
    if (!text.trim() || disabled) return;
    onPrompt(text.trim());
    setText("");
  };

  return (
    <aside className="order-3 flex max-h-[45dvh] shrink-0 flex-col border-t border-slate-200 bg-white lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && <p className="text-sm text-slate-400">Your requests and Muse's edits show up here.</p>}
        {turns.map((turn, i) => {
          const { edits, undone } = turnSummary(history, turn.turnId);
          const working = busy && i === turns.length - 1;
          return (
            <div key={turn.turnId} className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Avatar userId={turn.userId} name={turn.name} className="size-4 text-[8px] ring-0" />
                {turn.userId === userId ? "You" : (turn.name ?? "Someone")}
              </div>
              <div className={cn("rounded-2xl rounded-tl-sm bg-slate-100 px-3 py-2 text-sm", undone && "text-slate-400 line-through")}>
                {turn.text}
              </div>
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
            placeholder={busy ? "Interrupt with a new request…" : "Ask Muse to build or change slides…"}
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

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 text-center">
      <h2 className="text-2xl font-bold tracking-tight">What are we presenting?</h2>
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
