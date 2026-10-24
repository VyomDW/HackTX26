import { useEffect, useState } from "react";

/** Number of characters to show while the AI "types" text; restarts whenever key changes. */
export function useTypewriter(text: string, key: string | undefined, ms: number): number {
  const [shown, setShown] = useState(key ? 0 : text.length);

  useEffect(() => {
    if (!key || ms <= 0) {
      setShown(text.length);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const n = Math.ceil(((now - start) / ms) * text.length);
      setShown(Math.min(n, text.length));
      if (n < text.length) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, text, ms]);

  return shown;
}
