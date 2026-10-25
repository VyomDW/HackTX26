import { useEffect, useRef, useState } from "react";
import { Ear, Mic, ScreenShare } from "lucide-react";
import { callAudioSupported } from "@/hooks/useListen";
import { cn } from "@/lib/utils";
import { useVoice } from "@/store/voice";

/**
 * Turns on Listen mode: an open mic, or the mic plus the meeting's audio from a screen share,
 * so nodepad hears everyone on a Zoom, Meet or Teams call and acts only on real requests.
 */
export function ListenButton({ className }: { className?: string }) {
  const listen = useVoice((s) => s.listen);
  const level = useVoice((s) => s.listenLevel);
  const supported = useVoice((s) => s.supported);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  if (!supported) return null;
  const on = listen !== "off";
  const pick = (withCall: boolean) => {
    setOpen(false);
    useVoice.getState().startListen(withCall);
  };

  return (
    <div ref={ref} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-pressed={on}
        title={on ? "Stop listening" : "Listen to the conversation"}
        onClick={() => (on ? useVoice.getState().stopListen() : setOpen((o) => !o))}
        className={cn(
          "grid size-12 place-items-center rounded-full transition-colors",
          on ? "bg-live/90 text-white" : "border border-line text-ink hover:border-orb",
        )}
        style={{ boxShadow: on ? `0 0 0 ${3 + level * 10}px rgb(255 90 90 / ${0.12 + level * 0.25})` : undefined, transition: "box-shadow 80ms linear" }}
      >
        <Ear className="size-5" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border-[1.5px] border-[var(--ink)] bg-panel p-1 text-left shadow-[4px_4px_0_var(--ink)]">
          <MenuItem icon={<Mic className="size-4" />} title="Listen with my mic" detail="Everyone in the room can talk; nodepad acts only on requests." onClick={() => pick(false)} />
          {callAudioSupported && (
            <MenuItem
              icon={<ScreenShare className="size-4" />}
              title="Hear the whole call"
              detail="Share your Zoom, Meet or Teams tab or screen with audio on. Uses only the meeting audio; hold Space to add your own voice."
              onClick={() => pick(true)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-100">
      <span className="mt-0.5 text-orb">{icon}</span>
      <span className="grid gap-0.5">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-dim">{detail}</span>
      </span>
    </button>
  );
}
