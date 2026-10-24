import { Loader2, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { micSupported, usePushToTalk } from "@/hooks/usePushToTalk";
import { useMicLevel } from "@/hooks/useMicLevel";
import { cn } from "@/lib/utils";

/** Hold to talk. Typing stays available as the fallback when the mic is unsupported or denied. */
export function MicButton({ roomId, userId }: { roomId: string; userId: string }) {
  const { state, error, transcript, analyser, start, stop } = usePushToTalk(roomId, userId);
  const level = useMicLevel(analyser, state === "recording");
  const recording = state === "recording";

  if (!micSupported) {
    return (
      <Button type="button" variant="outline" size="icon" disabled title="Voice needs HTTPS and a browser with microphone support">
        <MicOff />
      </Button>
    );
  }

  return (
    <div className="relative">
      {(recording || state === "uploading" || error || transcript) && (
        <p
          className={cn(
            "absolute bottom-full right-0 mb-3 w-max max-w-[70vw] rounded-md border bg-background px-2 py-1 text-xs shadow",
            error && "text-red-600",
          )}
        >
          {recording ? "Listening…" : state === "uploading" ? "Transcribing…" : error ? error : `Heard: “${transcript}”`}
        </p>
      )}
      <Button
        type="button"
        variant={recording ? "default" : "outline"}
        size="icon"
        aria-label="Hold to talk"
        title="Hold to talk"
        className="relative touch-none select-none [-webkit-touch-callout:none]"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          void start();
        }}
        onPointerUp={() => void stop()}
        onPointerCancel={() => void stop()}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            void start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") void stop();
        }}
      >
        {/* Level meter: a ring that grows with input volume while recording. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md transition-[box-shadow] duration-75"
          style={{ boxShadow: recording ? `0 0 0 ${2 + level * 10}px rgb(239 68 68 / ${0.25 + level * 0.5})` : undefined }}
        />
        {state === "uploading" || state === "starting" ? <Loader2 className="animate-spin" /> : <Mic />}
      </Button>
    </div>
  );
}
