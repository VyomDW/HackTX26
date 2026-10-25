import { useEffect, useRef } from "react";
import type { BoardTemplate, DocKind } from "@hacktx/shared";
import { newRoomId, roomUrl, TARGETS } from "@/lib/kinds";
import { mountNodeCloud } from "@/lib/nodeCloud";
import "./nodeCloud.css";

interface FileInfo {
  id: string;
  kind: DocKind;
  template?: BoardTemplate;
  title: string;
  updatedAt: number;
  online: number;
}

/** Workspace home: every tool as a node in a 3D cloud; click one for its recent files, or describe something new. */
export function Home() {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Muse Office";
    let dispose: (() => void) | undefined;
    let cancelled = false;
    fetch("/api/docs")
      .then((r) => r.json() as Promise<FileInfo[]>)
      .catch(() => [] as FileInfo[])
      .then((files) => {
        if (cancelled || !stage.current) return;
        dispose = mountNodeCloud(stage.current, {
          files: files.map((f) => ({ id: f.id, tool: f.kind === "board" ? (f.template ?? "whiteboard") : f.kind, title: f.title, updatedAt: f.updatedAt, online: f.online })),
          openFile: (id) => location.assign(roomUrl(id)),
          newFile: (tool, prompt) => {
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
        <span className="grid size-7 place-items-center rounded-lg bg-[var(--ink)] text-[15px] font-bold text-[var(--page)] shadow-[2px_2px_0_var(--orb)]">M</span>
        <span className="text-[17px] font-bold">Muse Office</span>
        <span className="ml-2 hidden truncate text-sm text-dim sm:inline">Docs, sheets, slides and notes you co-edit with AI</span>
      </header>
      <div ref={stage} className="stage" />
    </div>
  );
}
