import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isBusy, selectDeck, turnSummary, useDeck } from "@/store/deck";
import { useEditor } from "@/store/editor";
import { AiAvatar } from "./Activity";
import { Avatar } from "./Presence";

/** Follow chip, who-just-asked bubble and the undo toast, layered over the stage. */
export function StageOverlays({ userId }: { userId: string }) {
  return (
    <>
      <CameraChip />
      <RequestBubble userId={userId} />
      <TurnToast />
    </>
  );
}

function CameraChip() {
  const slides = useDeck((s) => selectDeck(s).slides);
  const focus = useDeck((s) => s.focus);
  const busy = useDeck(isBusy);
  const { slideId, follow } = useEditor();
  const index = Math.max(0, slides.findIndex((s) => s.id === slideId));
  const focusIndex = slides.findIndex((s) => s.id === focus?.slideId);

  const text = !slides.length
    ? "Waiting for a request"
    : follow && busy && focusIndex >= 0
      ? `Following nodepad · slide ${focusIndex + 1}`
      : follow
        ? `Following nodepad · slide ${index + 1} of ${slides.length}`
        : `Slide ${index + 1} of ${slides.length} · Follow nodepad`;

  return (
    <button
      onClick={() => slides.length && useEditor.setState((s) => ({ follow: !s.follow }))}
      title={follow ? "Stop following nodepad" : "Keep the stage on whatever nodepad is editing"}
      className={cn(
        "absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[11px] backdrop-blur transition",
        follow ? "border-orb/40 bg-panel/90 text-orb" : "border-line bg-panel/90 text-dim hover:text-ink",
      )}
    >
      <Crosshair className="size-3" />
      {text}
    </button>
  );
}

function RequestBubble({ userId }: { userId: string }) {
  const turn = useDeck((s) => s.turns.at(-1));
  const busy = useDeck(isBusy);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Stays up while the AI works on it, then fades a few seconds after.
  const show = turn && (busy || now - turn.ts < 6000);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={turn.turnId}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className={cn(
            "pointer-events-none absolute left-3 top-12 z-20 grid max-w-[min(280px,60%)] gap-1 rounded-xl border-[1.5px] bg-panel px-3 py-2.5 shadow-[3px_3px_0_var(--ink)]",
            "border-[var(--ink)]",
          )}
        >
          <div className="flex items-center gap-1.5 text-[11px] text-dim">
            <Avatar userId={turn.userId} name={turn.name} className="size-5 text-[8px] ring-0" />
            {turn.userId === userId ? "You" : (turn.name ?? "Someone")}
          </div>
          <q className="text-[15px] font-semibold leading-snug">{turn.text}</q>
          {busy && (
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-orb">
              <AiAvatar className="size-3" /> nodepad is on it
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** When an AI response finishes, offers a one-tap undo of the whole thing. */
function TurnToast() {
  const busy = useDeck(isBusy);
  const turns = useDeck((s) => s.turns);
  const history = useDeck((s) => s.history);
  const send = useEditor((s) => s.send);
  const wasBusy = useRef(busy);
  const [shown, setShown] = useState<string>();

  useEffect(() => {
    const last = turns.at(-1);
    if (wasBusy.current && !busy && last) setShown(last.turnId);
    wasBusy.current = busy;
  }, [busy, turns]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(undefined), 7000);
    return () => clearTimeout(t);
  }, [shown]);

  const sum = shown ? turnSummary(history, shown) : undefined;
  const visible = shown && sum && sum.edits > 0 && !sum.undone;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={shown}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="ink-btn absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-xl bg-panel py-1.5 pl-4 pr-1.5 text-sm font-medium text-ink"
        >
          nodepad made {sum.edits} {sum.edits === 1 ? "edit" : "edits"}
          <button
            onClick={() => {
              send({ type: "undo_turn", turnId: shown });
              setShown(undefined);
            }}
            className="flex items-center gap-1 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[13px] text-[var(--page)]"
          >
            <Undo2 className="size-3.5" /> Undo
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
