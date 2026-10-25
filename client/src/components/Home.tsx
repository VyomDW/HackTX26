import { useEffect, useState } from "react";
import { ArrowUp, Clapperboard, Clock, Music, Trash2, Users } from "lucide-react";
import type { BoardTemplate, DocKind } from "@hacktx/shared";
import { KINDS, metaOf, newRoomId, roomUrl, TARGETS, type Target } from "@/lib/kinds";
import { cn } from "@/lib/utils";

interface FileInfo {
  id: string;
  kind: DocKind;
  template?: BoardTemplate;
  title: string;
  updatedAt: number;
  online: number;
}

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

/** Workspace home: start any kind of file (optionally with a first request for Muse) and reopen recent ones. */
export function Home() {
  const [files, setFiles] = useState<FileInfo[]>();
  const [targetKey, setTargetKey] = useState("slides");
  const target = TARGETS.find((t) => t.key === targetKey)!;
  const [prompt, setPrompt] = useState("");
  const [confirm, setConfirm] = useState<string>();
  const [filter, setFilter] = useState<DocKind | "all">("all");

  const load = () =>
    fetch("/api/docs")
      .then((r) => r.json())
      .then(setFiles)
      .catch(() => setFiles([]));
  useEffect(() => {
    void load();
    document.title = "Muse Office";
  }, []);

  const open = (t: Target, q?: string) => location.assign(roomUrl(newRoomId(), t.kind, q, t.template));
  const shown = (files ?? []).filter((f) => filter === "all" || f.kind === filter);

  return (
    <div className="night stage-bg min-h-dvh font-ui text-ink">
      <header className="flex h-14 items-center gap-2 border-b border-white/5 bg-[#090b1a]/80 px-4 sm:px-8">
        <span className="orb-core size-3.5 rounded-full" />
        <span className="font-display text-[17px] font-bold">Muse Office</span>
        <span className="ml-2 hidden text-sm text-slate-400 sm:inline">Docs, sheets, slides and notes you co-edit with AI</span>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <section className="relative overflow-hidden rounded-2xl border border-line bg-panel/80 p-5 shadow-[0_40px_80px_-30px_rgba(0,0,0,.7)] sm:p-8">
          <span aria-hidden className="orb-core pointer-events-none absolute -right-6 -top-6 size-32 rounded-full opacity-60 blur-sm [animation:orb-pulse_3s_ease-in-out_infinite]" />
          <h1 className="relative font-display text-3xl font-bold tracking-tight sm:text-5xl">What do you want to make?</h1>
          <p className="relative mt-2 max-w-xl text-[15px] text-dim">Describe it and Muse builds it live. Anyone you invite can edit alongside.</p>
          <div className="relative mt-5 flex flex-wrap gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTargetKey(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition",
                  targetKey === t.key ? "bg-orb/15 text-orb ring-1 ring-orb/40" : "bg-white/5 text-ink hover:bg-white/10",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex items-center gap-2 rounded-full border border-line bg-white/[0.03] p-1.5 pl-3 focus-within:border-orb"
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) open(target, prompt.trim());
            }}
          >
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={target.suggestions[0]}
              className="min-w-0 flex-1 bg-transparent px-2 text-[15px] text-ink outline-none placeholder:text-dim"
            />
            <button type="submit" disabled={!prompt.trim()} className="grid size-9 place-items-center rounded-full bg-orb text-orb-ink disabled:opacity-30">
              <ArrowUp className="size-4" />
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {target.suggestions.map((s) => (
              <button key={s} onClick={() => open(target, s)} className="rounded-full border border-line px-3 py-1 text-xs text-dim hover:border-orb hover:text-orb">
                {s}
              </button>
            ))}
          </div>
        </section>

        {(
          [
            ["office", "Start blank"],
            ["dev", "Dev & design tools"],
          ] as const
        ).map(([group, heading]) => (
          <section key={group} className="mt-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">{heading}</h2>
            <div className={cn("mt-3 grid grid-cols-2 gap-3", group === "office" ? "sm:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-6")}>
              {TARGETS.filter((t) => t.group === group).map((t) => (
                <button key={t.key} onClick={() => open(t)} className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-md">
                  <div className={cn("grid size-10 place-items-center rounded-lg text-white", t.color)}>
                    <t.icon className="size-5" />
                  </div>
                  <div className="mt-3 font-semibold">{t.label}</div>
                  <div className="text-xs text-slate-500">Blank {t.noun}</div>
                </button>
              ))}
            </div>
          </section>
        ))}

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Media studio</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["music", "Music", "Describe a song", Music, "bg-rose-500"],
                ["video", "Video", "Describe a clip", Clapperboard, "bg-sky-600"],
              ] as const
            ).map(([tab, label, hint, Icon, color]) => (
              <a key={tab} href={`?media=${tab}`} className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-md">
                <div className={cn("grid size-10 place-items-center rounded-lg text-white", color)}>
                  <Icon className="size-5" />
                </div>
                <div className="mt-3 font-semibold">{label}</div>
                <div className="text-xs text-slate-500">{hint}</div>
              </a>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Recent files</h2>
            <div className="flex gap-1 text-xs">
              {(["all", ...Object.keys(KINDS)] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k as DocKind | "all")}
                  className={cn("rounded-full px-2.5 py-1", filter === k ? "bg-orb/15 text-orb" : "text-dim hover:bg-white/5")}
                >
                  {k === "all" ? "All" : KINDS[k as DocKind].label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {files === undefined && <div className="p-6 text-sm text-slate-400">Loading…</div>}
            {files && shown.length === 0 && <div className="p-6 text-sm text-slate-400">Nothing here yet. Start something above.</div>}
            {shown.map((f) => {
              const K = metaOf(f.kind, f.template);
              return (
                <div key={f.id} className="group flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50">
                  <div className={cn("grid size-8 shrink-0 place-items-center rounded-md", K.tint)}>
                    <K.icon className="size-4" />
                  </div>
                  <a href={roomUrl(f.id)} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.title}</div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{K.label}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {ago(f.updatedAt)}
                      </span>
                      {f.online > 0 && (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <Users className="size-3" /> {f.online} editing
                        </span>
                      )}
                    </div>
                  </a>
                  {confirm === f.id ? (
                    <div className="flex items-center gap-1 text-xs">
                      <button
                        onClick={async () => {
                          await fetch(`/api/docs/${encodeURIComponent(f.id)}`, { method: "DELETE" });
                          setConfirm(undefined);
                          void load();
                        }}
                        className="rounded-md bg-live px-2 py-1 font-medium text-page"
                      >
                        Delete
                      </button>
                      <button onClick={() => setConfirm(undefined)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-200">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirm(f.id)} title="Delete" className="rounded-md p-1.5 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 max-sm:opacity-100">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
