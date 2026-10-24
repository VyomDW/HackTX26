import { useEffect, useState } from "react";

/** Live input level from 0 to 1 (RMS, scaled so normal speech reaches ~0.5–1). */
export function useMicLevel(analyser: AnalyserNode | null, active = true): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!analyser || !active) {
      setLevel(0);
      return;
    }
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const s of buf) sum += s * s;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  return level;
}
