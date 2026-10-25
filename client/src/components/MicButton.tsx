import { useEffect } from "react";
import { Loader2, Mic, MicOff } from "lucide-react";
import { micSupported, usePushToTalk } from "@/hooks/usePushToTalk";
import { useMicLevel } from "@/hooks/useMicLevel";
import { useListen } from "@/hooks/useListen";
import { cn } from "@/lib/utils";
import { useEditor } from "@/store/editor";
import { useVoice } from "@/store/voice";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * Owns the one push-to-talk mic for this tab and publishes it to the voice store.
 * Mount once per room. Also makes holding Space talk, like the mockups' "Hold Space to talk".
 */
export function useVoiceBridge(roomId: string, userId: string) {
  const { state, error, transcript, analyser, start, stop } = usePushToTalk(roomId, userId);
  const level = useMicLevel(analyser, state === "recording");
  const listen = useListen(roomId, userId);

  useEffect(() => {
    useVoice.setState({ startListen: (withCall) => void listen.start(withCall), stopListen: listen.stop });
  }, [listen]);

  useEffect(() => {
    useVoice.setState({ supported: micSupported, state, error, transcript, start: () => void start(), stop: () => void stop() });
  }, [state, error, transcript, start, stop]);
  useEffect(() => useVoice.setState({ level }), [level]);

  useEffect(() => {
    if (!micSupported) return;
    let held = false;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target) || useEditor.getState().presenting) return;
      e.preventDefault();
      held = true;
      void start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held) return;
      e.preventDefault();
      held = false;
      void stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [start, stop]);
}

/** Hold to talk. The amber ring grows with your voice; typing stays available when the mic is unsupported or denied. */
export function MicButton({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const supported = useVoice((s) => s.supported);
  const state = useVoice((s) => s.state);
  const level = useVoice((s) => (s.state === "recording" ? s.level : 0));
  const { start, stop } = useVoice.getState();
  const recording = state === "recording";
  const dim = size === "lg" ? "size-20" : "size-12";

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Voice needs HTTPS and a browser with microphone support"
        className={cn("grid shrink-0 place-items-center rounded-full border border-line text-dim", dim, className)}
      >
        <MicOff className="size-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label="Hold to talk"
      title="Hold to talk (or hold Space)"
      className={cn(
        "relative grid shrink-0 touch-none select-none place-items-center rounded-full transition-colors [-webkit-touch-callout:none]",
        dim,
        recording || state === "uploading" ? "bg-orb text-orb-ink" : "border border-line text-ink hover:border-orb",
        className,
      )}
      style={{
        boxShadow: recording ? `0 0 0 ${4 + level * (size === "lg" ? 22 : 14)}px rgb(255 196 107 / ${0.14 + level * 0.3})` : undefined,
        transition: "box-shadow 80ms linear",
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => e.key === "Enter" && stop()}
    >
      {recording && (
        <>
          <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full border-2 border-orb [animation:orb-ring_1.5s_ease-out_infinite]" />
          <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full border-2 border-orb [animation:orb-ring_1.5s_ease-out_.75s_infinite]" />
        </>
      )}
      {state === "uploading" || state === "starting" ? (
        <Loader2 className={cn("animate-spin", size === "lg" ? "size-8" : "size-5")} />
      ) : (
        <Mic className={size === "lg" ? "size-8" : "size-5"} />
      )}
    </button>
  );
}

/** Level bars beside the mic: flat when idle, dancing with the input while recording. */
export function LevelBars({ count = 12, className }: { count?: number; className?: string }) {
  const level = useVoice((s) => (s.state === "recording" ? s.level : 0));
  return (
    <div aria-hidden className={cn("flex h-7 items-center gap-[3px]", className)}>
      {Array.from({ length: count }, (_, i) => {
        // A fixed per-bar shape so the bars read as a waveform rather than one block.
        const shape = 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + 0.6));
        return (
          <i
            key={i}
            className="w-[3px] rounded-full bg-orb transition-[height] duration-75"
            style={{ height: `${Math.max(14, Math.min(100, level * shape * 140))}%`, opacity: level ? 1 : 0.35 }}
          />
        );
      })}
    </div>
  );
}
