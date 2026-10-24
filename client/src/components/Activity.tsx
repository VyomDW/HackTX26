import { useMemo, useState } from "react";
import { ChevronDown, Undo2 } from "lucide-react";
import type { Deck, OpEnvelope, Turn } from "@hacktx/shared";
import { cn } from "@/lib/utils";
import { isBusy, turnSummary, useDeck } from "@/store/deck";
import { useEditor } from "@/store/editor";
import { Avatar } from "./Presence";

/** Ops that are bookkeeping rather than an edit someone would want to see or undo on its own. */
const HIDDEN = new Set(["focus", "noop", "set_image_url"]);

type Item = { kind: "turn"; ts: number; turn: Turn } | { kind: "op"; ts: number; env: OpEnvelope };

export function AiAvatar({ className }: { className?: string }) {
  return <span aria-label="Muse" className={cn("orb-core inline-block size-7 shrink-0 rounded-full", className)} />;
}

const clip = (t: string, n = 48) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** Plain-language summary of one op, e.g. "wrote the title on slide 2". */
export function describe(env: OpEnvelope, deck: Deck): string {
  const op = env.op;
  const slideNo = (id: string) => {
    const i = deck.slides.findIndex((s) => s.id === id);
    return i >= 0 ? `slide ${i + 1}` : "a removed slide";
  };
  const role = (slideId: string, elementId: string) => {
    const r = elementId.startsWith(`${slideId}-`) ? elementId.slice(slideId.length + 1) : elementId;
    return r.replace(/[-_]+/g, " ");
  };
  switch (op.type) {
    case "add_slide":
      return `added ${slideNo(op.id)}`;
    case "set_text":
      return op.text ? `wrote the ${role(op.slideId, op.elementId)} on ${slideNo(op.slideId)}: “${clip(op.text)}”` : `cleared the ${role(op.slideId, op.elementId)}`;
    case "add_image":
      return `added an image of ${clip(op.prompt, 40)}`;
    case "add_shape":
      return `added a ${op.shape} to ${slideNo(op.slideId)}`;
    case "set_box":
      return `moved the ${role(op.slideId, op.elementId)} on ${slideNo(op.slideId)}`;
    case "set_style":
      return `restyled the ${role(op.slideId, op.elementId)} on ${slideNo(op.slideId)}`;
    case "reorder_element":
      return `changed layering on ${slideNo(op.slideId)}`;
    case "set_slide":
      return op.notes !== undefined ? `updated notes on ${slideNo(op.slideId)}` : `changed the background of ${slideNo(op.slideId)}`;
    case "duplicate_slide":
      return `duplicated ${slideNo(op.slideId)}`;
    case "add_citation":
      return `cited ${clip(op.source, 40)}`;
    case "remove_citation":
      return `removed a citation`;
    case "delete_element":
      return `deleted the ${role(op.slideId, op.elementId)} on ${slideNo(op.slideId)}`;
    case "delete_slide":
      return `deleted a slide`;
    case "insert_element":
      return `pasted onto ${slideNo(op.slideId)}`;
    case "insert_slide":
      return `restored a slide`;
    case "reorder_slide":
      return `moved a slide to position ${op.toIndex + 1}`;
    default:
      return "made an edit";
  }
}

const ago = (ts: number, now: number) => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 3 ? "now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

/** Everything that happened in the room, newest first, with an Undo on each edit. */
export function Activity({ userId, compact = false, className }: { userId: string; compact?: boolean; className?: string }) {
  const deck = useDeck((s) => s.deck);
  const history = useDeck((s) => s.history);
  const turns = useDeck((s) => s.turns);
  const users = useDeck((s) => s.users);
  const busy = useDeck(isBusy);
  const send = useEditor((s) => s.send);
  const [streamOpen, setStreamOpen] = useState(false);

  const { items, undone, names, edits } = useMemo(() => {
    const undone = new Set(history.map((h) => h.undoes).filter(Boolean) as string[]);
    const names = new Map<string, string>();
    for (const t of turns) if (t.name) names.set(t.userId, t.name);
    for (const u of users) if (u.name) names.set(u.userId, u.name);
    const ops = history.filter((h) => !h.undoes && !HIDDEN.has(h.op.type));
    const items: Item[] = [
      ...turns.map((turn) => ({ kind: "turn" as const, ts: turn.ts, turn })),
      ...ops.map((env) => ({ kind: "op" as const, ts: env.ts, env })),
    ].sort((a, b) => b.ts - a.ts);
    return { items: items.slice(0, compact ? 3 : 80), undone, names, edits: ops.length };
  }, [history, turns, users, compact]);

  const now = Date.now();
  const nameOf = (id: string) => (id === userId ? "You" : (names.get(id) ?? "Someone"));
  const stream = history.filter((h) => h.actor === "ai" && !h.undoes && h.op.type !== "noop").slice(-14);

  return (
    <aside className={cn("flex min-h-0 flex-col bg-[#0d0f20]/90", className)}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <h4 className="flex items-baseline justify-between font-display text-[15px] font-bold">
          Activity <span className="font-ui text-[11px] font-normal text-dim">{edits === 1 ? "1 edit" : `${edits} edits`}</span>
        </h4>
        {items.length === 0 && <p className="text-sm text-dim">Requests and every edit show up here, each with its own Undo.</p>}
        <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 [scrollbar-width:thin]">
          {items.map((item, i) => {
            const live = i === 0 && busy;
            if (item.kind === "turn") {
              const { turn } = item;
              const sum = turnSummary(history, turn.turnId);
              return (
                <li key={`t-${turn.turnId}`} className={cn("grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[9px] border border-transparent p-2 text-[12.5px]", i > 4 && "opacity-60")}>
                  <Avatar userId={turn.userId} name={turn.name} className="size-[22px] text-[9px] ring-0" />
                  <div className="min-w-0">
                    <p className={cn("break-words", sum.undone && "text-dim line-through")}>
                      <b>{nameOf(turn.userId)}</b> “{turn.text}”
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-dim">
                      <span className="rounded-[5px] bg-you/15 px-1.5 py-px font-mono text-[9.5px] text-you">Request</span>
                      {ago(turn.ts, now)}
                      {sum.edits > 0 && ` · ${sum.edits} edits`}
                    </div>
                  </div>
                  {sum.edits > 0 && !sum.undone ? (
                    <UndoButton label="Undo all" onClick={() => send({ type: "undo_turn", turnId: turn.turnId })} />
                  ) : (
                    <span />
                  )}
                </li>
              );
            }
            const { env } = item;
            const ai = env.actor === "ai";
            const isUndone = undone.has(env.opId);
            return (
              <li
                key={env.opId}
                className={cn(
                  "grid grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[9px] border p-2 text-[12.5px]",
                  live && ai ? "border-orb/35 bg-orb/[0.06]" : "border-transparent",
                  i > 4 && "opacity-60",
                )}
              >
                {ai ? <AiAvatar className="size-[22px]" /> : <Avatar userId={env.actor} name={names.get(env.actor)} className="size-[22px] text-[9px] ring-0" />}
                <div className="min-w-0">
                  <p className={cn("break-words", isUndone && "text-dim line-through")}>
                    <b>{ai ? "Muse" : nameOf(env.actor)}</b> {describe(env, deck)}
                    {live && ai && (
                      <span className="ml-1 inline-flex gap-0.5 align-middle">
                        {[0, 0.2, 0.4].map((d) => (
                          <i key={d} className="size-[5px] rounded-full bg-orb [animation:dot-blink_1.2s_infinite]" style={{ animationDelay: `${d}s` }} />
                        ))}
                      </span>
                    )}
                  </p>
                  <div className="mt-0.5 text-[10.5px] text-dim">{isUndone ? "undone" : ago(env.ts, now)}</div>
                </div>
                {isUndone ? (
                  <span className="rounded-md border border-dashed border-line px-1.5 py-0.5 text-[10.5px] text-dim">Undone</span>
                ) : (
                  <UndoButton hot={live && ai} onClick={() => send({ type: "undo", opId: env.opId })} />
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {!compact && (
        <section className="hidden shrink-0 border-t border-line bg-[#080a17] lg:block">
          <button
            onClick={() => setStreamOpen((o) => !o)}
            className="flex w-full items-baseline justify-between px-4 py-2.5 font-display text-[13px] font-bold hover:text-orb"
          >
            Model stream
            <span className="flex items-center gap-1 font-ui text-[11px] font-normal text-dim">
              one operation per line <ChevronDown className={cn("size-3 transition", streamOpen && "rotate-180")} />
            </span>
          </button>
          {streamOpen && (
            <pre className="flex h-36 flex-col justify-end overflow-hidden whitespace-pre-wrap break-all px-4 pb-3 font-mono text-[10.5px] leading-relaxed text-[#7f86a8]">
              {stream.length === 0 && <span>Waiting for Muse…</span>}
              {stream.map((h, i) => (
                <span key={h.opId} className={cn("block", i === stream.length - 1 && "text-ink")}>
                  {clip(JSON.stringify(h.op), 120)}
                </span>
              ))}
            </pre>
          )}
        </section>
      )}
    </aside>
  );
}

function UndoButton({ onClick, hot, label = "Undo" }: { onClick: () => void; hot?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10.5px] transition hover:border-orb hover:text-orb",
        hot ? "border-orb text-orb" : "border-line text-ink",
      )}
    >
      <Undo2 className="size-3" />
      {label}
    </button>
  );
}
