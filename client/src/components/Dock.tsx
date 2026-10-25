import { useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { isBusy, useDeck } from "@/store/deck";
import { useVoice } from "@/store/voice";
import { ListenButton } from "./ListenButton";
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
  const listen = useVoice((s) => s.listen);
  const listenError = useVoice((s) => s.listenError);
  const caption = useVoice((s) => s.captions.at(-1));
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim() || disabled) return;
    onPrompt(text.trim());
    setText("");
  };

  const talking = voice !== "idle";
  const [label, heard] = ((): [string, string] => {
    if (voice === "recording") return ["Listening", "Release to send"];
    if (talking) return ["Transcribing", "One moment…"];
    if (listenError) return ["Listen problem", listenError];
    if (listen !== "off") {
      const what = caption?.acted ? "Muse is on it" : listen === "call" ? "Hearing the call" : "Listening to the room";
      return [what, caption ? `${caption.speaker}: “${caption.text}”` : "Talk normally; Muse acts when you ask for a change"];
    }
    // Someone else's open mic: show what it heard, so nobody is listened to without seeing it.
    if (caption && Date.now() - caption.ts < 15_000) return [caption.acted ? "Muse is on it" : "Heard in the room", `${caption.speaker}: “${caption.text}”`];
    if (error) return ["Mic problem", error];
    if (transcript) return ["Heard", `“${transcript}”`];
    return [supported ? "Hold Space to talk" : "Type a request", busy ? "Talk or type to interrupt Muse" : "Ask Muse to build or change this"];
  })();
  const live = voice === "recording" || listen !== "off";
  const failed = listenError ?? error;

  return (
    <div className={cn("flex items-center gap-3 border-t border-line bg-page px-4 py-3 lg:gap-4 lg:px-6", className)}>
      <MicButton />
      <ListenButton />
      <LevelBars className="hidden sm:flex" />
      <div className="hidden min-w-0 flex-1 md:grid">
        <small className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
          <span className={cn("size-[7px] rounded-full", live ? "bg-live" : "bg-dim")} />
          {label}
        </small>
        <span title={heard} className={cn("truncate text-[15px] font-medium", !transcript && !caption && voice === "idle" && "text-dim", failed && !talking && "text-live", caption?.acted && listen !== "off" && !talking && "text-orb")}>{heard}</span>
      </div>
      <form
        className="ink-btn flex h-12 min-w-0 flex-1 items-center gap-1 rounded-xl bg-panel pl-4 pr-1.5 focus-within:shadow-[3px_3px_0_var(--orb)] md:max-w-md"
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
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-orb text-orb-ink disabled:opacity-30"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
    </div>
  );
}
