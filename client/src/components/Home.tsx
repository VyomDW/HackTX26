import { useEffect, useRef } from "react";
import type { BoardTemplate, DocKind } from "@hacktx/shared";
import { LogOut } from "lucide-react";
import { api, signOut, useAuth } from "@/lib/auth";
import { newRoomId, roomUrl, TARGETS } from "@/lib/kinds";
import { mountNodeCloud } from "@/lib/nodeCloud";
import { Logo } from "./Logo";
import "./nodeCloud.css";

interface FileInfo {
  id: string;
  kind: DocKind;
  template?: BoardTemplate;
  title: string;
  updatedAt: number;
  online: number;
  mine: boolean;
}

/** Workspace home: every tool as a node in a 3D cloud; click one for its recent files, or describe something new. */
export function Home() {
  const stage = useRef<HTMLDivElement>(null);
  const account = useAuth((s) => s.account);

  useEffect(() => {
    document.title = "nodepad";
    let dispose: (() => void) | undefined;
    let cancelled = false;
    api("/docs")
      .then((r) => (r.ok ? (r.json() as Promise<FileInfo[]>) : []))
      .catch(() => [] as FileInfo[])
      .then((files) => {
        if (cancelled || !stage.current) return;
        dispose = mountNodeCloud(stage.current, {
          files: files.map((f) => ({ id: f.id, tool: f.kind === "board" ? (f.template ?? "whiteboard") : f.kind, title: f.title, updatedAt: f.updatedAt, online: f.online, mine: f.mine })),
          openFile: (id) => location.assign(roomUrl(id)),
          deleteFile: (id) =>
            api(`/docs/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
              if (!r.ok) throw new Error(`delete failed: ${r.status}`);
            }),
          newFile: (tool, prompt) => {
            // music and video are made in the media studio, not as shared files
            if (tool === "music" || tool === "video") {
              const p = new URLSearchParams({ media: tool });
              if (prompt) p.set("q", prompt);
              return location.assign(`${location.pathname}?${p}`);
            }
            const t = TARGETS.find((x) => x.key === tool) ?? TARGETS[0];
            location.assign(roomUrl(newRoomId(), t.kind, prompt, t.template));
          },
        });
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return (
    <div className="ink nh flex h-dvh flex-col overflow-hidden bg-page text-ink">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4 sm:px-6">
        <Logo />
        <span className="text-[17px] font-bold">nodepad</span>
        <span className="ml-2 hidden truncate text-sm text-dim sm:inline">Docs, slides, boards, 3D scenes and media you make with AI</span>
        <div className="flex-1" />
        {account && (
          <>
            <span className="truncate text-sm text-dim max-sm:hidden">
              {account.name} <span className="opacity-70">@{account.username}</span>
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-dim hover:bg-slate-100 hover:text-ink"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </>
        )}
      </header>
      <div ref={stage} className="stage" />
    </div>
  );
}
