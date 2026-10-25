import { cn } from "@/lib/utils";

/** The nodepad mark: a lowercase n drawn as one stroke, its two feet ending in nodes. */
export function Logo({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--ink)] text-[var(--page)] shadow-[2px_2px_0_var(--orb)]", className)}>
      <svg viewBox="0 0 32 32" className="size-full">
        <path d="M10 23V15a6 6 0 0 1 12 0v8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="10" cy="23" r="2.8" fill="currentColor" />
        <circle cx="22" cy="23" r="2.8" fill="var(--orb)" />
      </svg>
    </span>
  );
}
