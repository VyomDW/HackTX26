import { useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { isBusy, useDeck } from "@/store/deck";
import { useVoice } from "@/store/voice";
import { LevelBars, MicButton } from "./MicButton";

/** Push-to-talk, what was heard, and a typed fallback, pinned under the stage. */
export function Dock({
  onPrompt,
  onStop,
  disabled,
  placeholder = "Or type an edit…",
  className,
}: {
  onPrompt: (t: string) => void;
  onStop: () => void;
  disabled: boolean;
  placeholder?: string;
  className?: string;
}) {
  const busy = useDeck(isBusy);
  const voice = useVoice((s) => s.state);
  const transcript = useVoice((s) => s.transcript);
  const error = useVoice((s) => s.error);
  const supported = useVoice((s) => s.supported);
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim() || disabled) return;
    onPrompt(text.trim());
    setText("");
  };

  const label =
    voice === "recording" ? "Listening" : voice === "uploading" ? "Transcribing" : error ? "Mic problem" : transcript ? "Heard" : supported ? "Hold Space to talk" : "Type a request";
  const heard =
    voice === "recording" ? "Release to send" : voice === "uploading" ? "One moment…" : error ? error : transcript ? `“${transcript}”` : busy ? "Talk or type to interrupt Muse" : "Ask Muse to build or change this";

  return (
    <div className={cn("flex items-center gap-3 border-t border-white/5 bg-gradient-to-t from-[#090b1a]/95 to-[#090b1a]/60 px-4 py-3 lg:gap-4 lg:px-6", className)}>
      <MicButton />
      <LevelBars className="hidden sm:flex" />
      <div className="hidden min-w-0 flex-1 md:grid">
        <small className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
          <span className={cn("size-[7px] rounded-full", voice === "recording" ? "bg-live" : "bg-dim")} />
          {label}
        </small>
        <span className={cn("truncate text-[15px] font-medium", !transcript && voice === "idle" && "text-dim", error && "text-live")}>{heard}</span>
      </div>
      <form
        className="flex h-12 min-w-0 flex-1 items-center gap-1 rounded-full border border-line bg-white/[0.03] pl-4 pr-1.5 focus-within:border-orb md:max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder={busy ? "Interrupt with a new request…" : placeholder}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-dim"
        />
        {busy && !disabled && (
          <button type="button" onClick={onStop} title="Stop Muse" className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink hover:border-live hover:text-live">
            <Square className="size-3.5 fill-current" />
          </button>
        )}
        <button
          type="submit"
          disabled={!text.trim() || disabled}
          title="Send (Enter)"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-orb text-orb-ink disabled:opacity-30"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
    </div>
  );
}
