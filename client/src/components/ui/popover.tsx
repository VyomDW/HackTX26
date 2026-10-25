import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Minimal click-to-open popover that closes on outside click or Escape.
 * Rendered in a portal with fixed positioning so scrolling toolbars don't clip it.
 */
export function Popover({
  trigger,
  children,
}: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const width = panel.current?.offsetWidth ?? 0;
    const height = panel.current?.offsetHeight ?? 0;
    // Open upward when a trigger near the bottom of the screen would push the panel off it.
    const top = r.bottom + 4 + height > window.innerHeight - 8 && r.top - 4 - height >= 8 ? r.top - 4 - height : r.bottom + 4;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <div ref={anchor} className="shrink-0">
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="fixed z-50 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </div>
  );
}
