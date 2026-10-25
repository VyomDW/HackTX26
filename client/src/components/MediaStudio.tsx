import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Download, Loader2, Music, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";

type Tab = "music" | "video";

interface MediaJob {
  id: string;
  kind: Tab;
  prompt: string;
  options: { duration?: number; aspectRatio?: string };
  status: "starting" | "generating" | "converting" | "done" | "failed";
  createdAt: number;
  finishedAt?: number;
  preview?: string;
  files: { name: string; label: string }[];
  error?: string;
}

const SUGGESTIONS: Record<Tab, string[]> = {
  music: [
    "Upbeat lo-fi hip hop with warm piano and vinyl crackle, for studying",
    "Epic orchestral trailer music with big drums and rising strings",
    "Chill synthwave with a driving bassline, late-night city drive",
  ],
  video: [
    "A paper airplane gliding over a desk covered in pencil sketches, soft morning light",
    "Drone shot over a neon city at night in the rain, cinematic",
    "A golden retriever puppy running through autumn leaves in slow motion",
  ],
};

const STATUS: Record<MediaJob["status"], string> = {
  starting: "Starting…",
  generating: "Generating…",
  converting: "Making your files…",
  done: "Ready",
  failed: "Failed",
};

const secs = (from: number, to = Date.now()) => `${Math.max(0, Math.round((to - from) / 1000))}s`;
const fileUrl = (job: MediaJob, name: string, download = false) => `/api/media/${job.id}/${name}${download ? "?download=1" : ""}`;

/** Media studio: describe a song or a clip, Replicate makes it, and it comes back as downloadable files. */
export function MediaStudio({ initialTab, initialPrompt }: { initialTab: Tab; initialPrompt?: string }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = (await fetch("/api/media").then((res) => res.json())) as { enabled: boolean; jobs: MediaJob[] };
      setEnabled(r.enabled);
      setJobs(r.jobs);
    } catch {
      setError("Can't reach the server.");
    }
  }, []);

  useEffect(() => {
    document.title = "Media studio · nodepad";
    void load();
  }, [load]);

  // A request typed on the home screen starts generating right away, then is dropped from the URL.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialPrompt || sentInitial.current) return;
    sentInitial.current = true;
    history.replaceState(null, "", `?media=${tab}`);
    setPrompt(initialPrompt);
    void generate(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while anything is still cooking, and tick the elapsed-time counters.
  const pending = jobs.some((j) => j.status !== "done" && j.status !== "failed");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      void load();
      tick((n) => n + 1);
    }, 2500);
    return () => clearInterval(t);
  }, [pending, load]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setPrompt("");
    setError(undefined);
    history.replaceState(null, "", `?media=${next}`);
  };

  const generate = async (text = prompt) => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(undefined);
    try {
      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: tab, prompt: text.trim(), duration, aspectRatio }),
      });
      const body = (await res.json()) as MediaJob & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setJobs((all) => [body, ...all]);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const remove = async (job: MediaJob) => {
    setJobs((all) => all.filter((j) => j.id !== job.id));
    const res = await fetch(`/api/media/${job.id}`, { method: "DELETE" }).catch(() => undefined);
    if (!res?.ok) void load();
  };

  const shown = jobs.filter((j) => j.kind === tab);

  return (
    <div className="ink min-h-dvh bg-page font-ui text-ink">
      <header className="flex h-14 items-center gap-3 px-4 sm:px-8">
        <a href={location.pathname} title="All files" className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[17px] font-bold hover:bg-slate-100">
          <Logo />
          nodepad
        </a>
        <span className="border-l border-line pl-3 font-semibold">Media studio</span>
      </header>

      <main className="desk min-h-[calc(100dvh-3.5rem)] border-t-[1.5px] border-[var(--ink)] px-4 pb-16 pt-8 sm:px-8">
        <div className="mx-auto max-w-3xl">
          {/* Index tabs */}
          <div role="tablist" aria-label="Media type" className="flex gap-2">
            {(
              [
                ["music", "Music", Music],
                ["video", "Video", Clapperboard],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => switchTab(key)}
                className={cn(
                  "flex items-center gap-2 rounded-t-xl border-[1.5px] border-b-0 border-[var(--ink)] px-5 py-2.5 text-[15px] font-semibold transition",
                  tab === key ? "bg-[#fde047] shadow-[3px_0_0_var(--ink)]" : "translate-y-1 bg-panel text-slate-600 hover:text-ink",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>

          {/* Composer */}
          <section className="ink-page rounded-b-xl rounded-tr-xl p-5 sm:p-7">
            <label htmlFor="media-prompt" className="text-sm font-semibold">
              {tab === "music" ? "Describe the music" : "Describe the video"}
            </label>
            <textarea
              id="media-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void generate();
              }}
              rows={3}
              maxLength={1000}
              placeholder={SUGGESTIONS[tab][0]}
              className="mt-2 w-full resize-none rounded-lg border-[1.5px] border-line bg-white p-3 text-[16px] leading-relaxed outline-none placeholder:text-slate-400 focus:border-[var(--ink)]"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {SUGGESTIONS[tab].map((s) => (
                <button key={s} onClick={() => setPrompt(s)} className="rounded-full border border-line px-3 py-1 text-xs text-slate-600 hover:border-[var(--ink)] hover:text-ink">
                  {s.length > 48 ? `${s.slice(0, 46)}…` : s}
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-4">
              {tab === "video" && (
                <>
                  <Choice label="Length" value={duration} options={[[5, "5 sec"], [10, "10 sec"]]} onChange={setDuration} />
                  <Choice label="Shape" value={aspectRatio} options={[["16:9", "Wide"], ["9:16", "Tall"], ["1:1", "Square"]]} onChange={setAspectRatio} />
                </>
              )}
              <p className="hand mr-auto text-[19px] leading-tight text-slate-500">
                {tab === "music" ? "about 30 seconds of instrumental music" : "takes a minute or two to film"}
              </p>
              <button
                onClick={() => void generate()}
                disabled={!prompt.trim() || sending || !enabled}
                className="ink-btn flex h-11 items-center gap-2 rounded-xl bg-orb px-5 text-[15px] font-semibold text-white disabled:opacity-40"
              >
                {sending && <Loader2 className="size-4 animate-spin" />}
                Generate {tab === "music" ? "music" : "video"}
              </button>
            </div>

            {!enabled && (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
                <TriangleAlert className="size-4 shrink-0" /> Add <code className="font-mono">REPLICATE_API_TOKEN</code> to <code className="font-mono">server/.env</code> and restart the server to start generating.
              </p>
            )}
            {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          </section>

          {/* Results */}
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wider text-slate-500">Your {tab === "music" ? "tracks" : "clips"}</h2>
          {shown.length === 0 && <p className="hand mt-2 text-[22px] text-slate-500">nothing yet. describe something above</p>}
          <ul className="mt-3 grid gap-5">
            {shown.map((job) => (
              <li key={job.id} className="ink-page rounded-xl p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <p className="min-w-0 flex-1 text-[15px] font-medium leading-snug">{job.prompt}</p>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                      job.status === "done" ? "bg-emerald-100 text-emerald-800" : job.status === "failed" ? "bg-red-100 text-red-800" : "bg-orb/10 text-orb",
                    )}
                  >
                    {job.status !== "done" && job.status !== "failed" && <Loader2 className="size-3 animate-spin" />}
                    {STATUS[job.status]}
                    {job.status !== "failed" && <span className="font-normal opacity-70">{secs(job.createdAt, job.finishedAt)}</span>}
                  </span>
                  {(job.status === "done" || job.status === "failed") && (
                    <button
                      onClick={() => void remove(job)}
                      title="Remove"
                      aria-label="Remove"
                      className="-mr-1 -mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-red-700"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                {job.kind === "video" && (
                  <p className="mt-1 text-xs text-slate-500">
                    {job.options.duration ?? 5} sec · {job.options.aspectRatio ?? "16:9"}
                  </p>
                )}

                {job.status === "done" && job.preview && (
                  <div className="mt-3">
                    {job.kind === "video" ? (
                      <video src={fileUrl(job, job.preview)} controls playsInline className="max-h-[420px] w-full rounded-lg border-[1.5px] border-[var(--ink)] bg-black" />
                    ) : (
                      <audio src={fileUrl(job, job.preview)} controls className="w-full" />
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {job.files.map((f) => (
                        <a key={f.name} href={fileUrl(job, f.name, true)} download className="ink-btn flex items-center gap-1.5 rounded-lg bg-panel px-3 py-1.5 text-sm font-semibold">
                          <Download className="size-3.5" /> {f.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {job.status !== "done" && job.status !== "failed" && (
                  <p className="hand mt-2 text-[20px] text-orb">{job.kind === "music" ? "nodepad is composing…" : "nodepad is filming…"}</p>
                )}
                {job.status === "failed" && (
                  <p className="mt-2 text-sm text-red-700">
                    {job.error}{" "}
                    <button onClick={() => void generate(job.prompt)} className="font-semibold underline">
                      Try again
                    </button>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div role="radiogroup" aria-label={label} className="mt-1 flex overflow-hidden rounded-lg border-[1.5px] border-[var(--ink)]">
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn("px-3 py-1.5 text-sm font-medium", value === v ? "bg-[var(--ink)] text-[var(--page)]" : "bg-white hover:bg-slate-100")}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
