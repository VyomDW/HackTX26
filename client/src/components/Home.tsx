import { useEffect, useState } from "react";
import { ArrowUp, Clock, Trash2, Users } from "lucide-react";
import type { DocKind } from "@hacktx/shared";
import { KINDS, newRoomId, roomUrl } from "@/lib/kinds";
import { cn } from "@/lib/utils";

interface FileInfo {
  id: string;
  kind: DocKind;
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
  const [kind, setKind] = useState<DocKind>("slides");
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

  const open = (k: DocKind, q?: string) => location.assign(roomUrl(newRoomId(), k, q));
  const shown = (files ?? []).filter((f) => filter === "all" || f.kind === filter);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-4 sm:px-8">
        <div className="grid size-7 place-items-center rounded-lg bg-violet-600 text-sm font-bold text-white">M</div>
        <span className="font-semibold">Muse Office</span>
        <span className="ml-2 hidden text-sm text-slate-400 sm:inline">Docs, sheets, slides and notes you co-edit with AI</span>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <section className="rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 p-5 text-white shadow-lg sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">What do you want to make?</h1>
          <p className="mt-1 text-sm text-violet-100">Describe it and Muse builds it live. Anyone you invite can edit alongside.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {(Object.keys(KINDS) as DocKind[]).map((k) => {
              const K = KINDS[k];
              return (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition",
                    kind === k ? "bg-white text-violet-700" : "bg-white/15 text-white hover:bg-white/25",
                  )}
                >
                  <K.icon className="size-4" /> {K.label}
                </button>
              );
            })}
          </div>
          <form
            className="mt-3 flex items-center gap-2 rounded-xl bg-white p-2 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) open(kind, prompt.trim());
            }}
          >
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={KINDS[kind].suggestions[0]}
              className="min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            <button type="submit" disabled={!prompt.trim()} className="grid size-9 place-items-center rounded-lg bg-violet-600 text-white disabled:opacity-40">
              <ArrowUp className="size-4" />
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {KINDS[kind].suggestions.map((s) => (
              <button key={s} onClick={() => open(kind, s)} className="rounded-full bg-white/10 px-3 py-1 text-xs text-violet-50 hover:bg-white/20">
                {s}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Start blank</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(KINDS) as DocKind[]).map((k) => {
              const K = KINDS[k];
              return (
                <button key={k} onClick={() => open(k)} className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-violet-300 hover:shadow-md">
                  <div className={cn("grid size-10 place-items-center rounded-lg text-white", K.color)}>
                    <K.icon className="size-5" />
                  </div>
                  <div className="mt-3 font-semibold">{K.label}</div>
                  <div className="text-xs text-slate-500">Blank {K.noun}</div>
                </button>
              );
            })}
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
                  className={cn("rounded-full px-2.5 py-1", filter === k ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-200")}
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
              const K = KINDS[f.kind];
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
                        className="rounded-md bg-red-600 px-2 py-1 font-medium text-white"
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
