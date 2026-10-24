import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { colorOf, initialsOf, MAX_NAME } from "@/lib/identity";
import { cn } from "@/lib/utils";
import { useDeck } from "@/store/deck";

export function Avatar({ userId, name, className }: { userId: string; name?: string; className?: string }) {
  return (
    <span
      title={name}
      style={{ backgroundColor: colorOf(userId) }}
      className={cn("grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white ring-2 ring-white", className)}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Stacked avatars of everyone in the room; click for the full list and to rename yourself. */
export function PresenceStack({ userId, onRename }: { userId: string; onRename: () => void }) {
  const users = useDeck((s) => s.users);
  // One person can have several tabs open on the same id; show them once, with yourself first.
  const people = [...new Map(users.map((u) => [u.userId, u])).values()].sort((a, b) => Number(b.userId === userId) - Number(a.userId === userId));
  const shown = people.slice(0, 4);

  return (
    <Popover
      trigger={() => (
        <button className="flex items-center rounded-full p-0.5 hover:bg-slate-100" aria-label={`${people.length} in this room`}>
          <span className="flex -space-x-2">
            {shown.map((u) => (
              <Avatar key={u.userId} userId={u.userId} name={u.name} />
            ))}
          </span>
          {people.length > shown.length && <span className="pl-1.5 pr-1 text-xs font-medium text-slate-500">+{people.length - shown.length}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="w-56">
          <div className="px-2 pb-1.5 pt-1 text-xs font-medium text-slate-500">
            {people.length === 1 ? "Just you here" : `${people.length} people in this room`}
          </div>
          <ul className="space-y-0.5">
            {people.map((u) => (
              <li key={u.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                <Avatar userId={u.userId} name={u.name} className="size-6 ring-0" />
                <span className="min-w-0 flex-1 truncate">{u.name ?? "Guest"}</span>
                {u.userId === userId && (
                  <button
                    onClick={() => {
                      close();
                      onRename();
                    }}
                    className="text-xs text-violet-600 hover:underline"
                  >
                    Rename
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Popover>
  );
}

/** Asks for a display name before joining, and again when renaming. */
export function NameDialog({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => void; onCancel?: () => void }) {
  const [value, setValue] = useState(initial);
  const valid = value.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onKeyDown={(e) => e.key === "Escape" && onCancel?.()}>
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(value);
        }}
      >
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{onCancel ? "Change your name" : "What should we call you?"}</h2>
          <p className="text-sm text-slate-500">Everyone in the room sees this next to your requests.</p>
        </div>
        <input
          autoFocus
          value={value}
          maxLength={MAX_NAME}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your name"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
        />
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!valid} className="bg-violet-600 text-white hover:bg-violet-700">
            {onCancel ? "Save" : "Join room"}
          </Button>
        </div>
      </form>
    </div>
  );
}
