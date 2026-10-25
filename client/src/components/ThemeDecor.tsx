import type { DeckTheme } from "@hacktx/shared";
import { u } from "@/lib/canvas";

/** The theme's decoration layer: drawn behind a slide's elements, in canvas units, never selectable. */
export function ThemeDecor({ theme }: { theme: DeckTheme }) {
  const a = theme.accent;
  switch (theme.id) {
    case "notebook":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "linear-gradient(#e9e7de 1px, transparent 1px), linear-gradient(90deg, #e9e7de 1px, transparent 1px)",
              backgroundSize: `${u(32)} ${u(32)}`,
            }}
          />
          <div className="absolute inset-y-0" style={{ left: u(52), width: u(2), background: "#f2c4b0" }} />
          <div className="absolute" style={{ left: u(560), top: u(-12), width: u(160), height: u(40), background: "rgb(234 88 12 / 0.28)", transform: "rotate(-3deg)" }} />
        </div>
      );
    case "midnight":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute rounded-full" style={{ right: u(-160), top: u(-200), width: u(620), height: u(620), background: `radial-gradient(circle, ${a}55 0%, transparent 65%)` }} />
          <div className="absolute rounded-full" style={{ left: u(-220), bottom: u(-260), width: u(640), height: u(640), background: "radial-gradient(circle, #8b5cf640 0%, transparent 65%)" }} />
          <div className="absolute rounded-full" style={{ right: u(180), bottom: u(90), width: u(6), height: u(6), background: "#fff", boxShadow: `0 0 ${u(12)} ${u(4)} ${a}` }} />
        </div>
      );
    case "editorial":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute" style={{ left: u(60), right: u(60), top: u(36), height: u(3), background: theme.ink }} />
          <div className="absolute" style={{ left: u(60), right: u(60), top: u(43), height: u(1), background: theme.ink }} />
          <div className="absolute" style={{ left: u(60), right: u(60), bottom: u(36), height: u(1), background: theme.muted }} />
        </div>
      );
    case "brutalist":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute" style={{ right: u(-40), bottom: u(-40), width: u(260), height: u(160), background: a, transform: "rotate(-8deg)" }} />
          <div className="absolute" style={{ inset: u(18), border: `${u(12)} solid ${theme.ink}` }} />
        </div>
      );
    case "terminal":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0"
            style={{ backgroundImage: "repeating-linear-gradient(0deg, rgb(255 255 255 / 0.025) 0 1px, transparent 1px 4px)" }}
          />
          <div className="absolute inset-x-0 top-0 flex items-center" style={{ height: u(38), gap: u(9), paddingLeft: u(18), background: "#161b22", borderBottom: "1px solid #30363d" }}>
            {["#ff5f56", "#ffbd2e", "#27c93f"].map((c) => (
              <span key={c} className="rounded-full" style={{ width: u(13), height: u(13), background: c }} />
            ))}
            <span style={{ marginLeft: u(16), fontFamily: "JetBrains Mono, monospace", fontSize: u(14), color: theme.muted }}>~/deck — zsh</span>
          </div>
          <span className="absolute" style={{ left: u(40), bottom: u(22), fontFamily: "JetBrains Mono, monospace", fontSize: u(16), color: a }}>
            $ ▍
          </span>
        </div>
      );
    case "sunset":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute rounded-full" style={{ right: u(-120), top: u(-140), width: u(460), height: u(460), background: `${a}33` }} />
          <div className="absolute rounded-full" style={{ right: u(90), top: u(170), width: u(150), height: u(150), background: `${a}26` }} />
          <div className="absolute rounded-full" style={{ left: u(-160), bottom: u(-220), width: u(520), height: u(520), background: "rgb(255 255 255 / 0.07)" }} />
        </div>
      );
    case "blueprint":
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: [
                "linear-gradient(rgb(255 255 255 / 0.16) 1px, transparent 1px)",
                "linear-gradient(90deg, rgb(255 255 255 / 0.16) 1px, transparent 1px)",
                "linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px)",
                "linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)",
              ].join(","),
              backgroundSize: `${u(160)} ${u(160)}, ${u(160)} ${u(160)}, ${u(32)} ${u(32)}, ${u(32)} ${u(32)}`,
            }}
          />
          <div className="absolute" style={{ inset: u(24), border: `${u(2)} solid rgb(255 255 255 / 0.5)` }} />
          <div
            className="absolute flex items-center"
            style={{ right: u(24), bottom: u(24), width: u(230), height: u(44), paddingLeft: u(12), borderLeft: `${u(2)} solid rgb(255 255 255 / 0.5)`, borderTop: `${u(2)} solid rgb(255 255 255 / 0.5)`, fontFamily: "Roboto Mono, monospace", fontSize: u(13), color: theme.muted }}
          >
            SHEET 01 · SCALE 1:1
          </div>
        </div>
      );
    case "pastel": {
      const dots: [number, number, number, string][] = [
        [90, 80, 16, "#f9a8d4"], [1180, 110, 22, "#c4b5fd"], [1120, 600, 14, "#fcd34d"], [160, 640, 20, "#93c5fd"],
        [640, 50, 10, "#86efac"], [1220, 360, 12, "#f9a8d4"], [40, 360, 12, "#fcd34d"],
      ];
      return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {dots.map(([x, y, r, c]) => (
            <span key={`${x}-${y}`} className="absolute rounded-full" style={{ left: u(x), top: u(y), width: u(r), height: u(r), background: c }} />
          ))}
          <svg className="absolute" style={{ left: u(1020), top: u(40), width: u(140), height: u(50) }} viewBox="0 0 140 50">
            <path d="M5 25 q 15 -20 30 0 t 30 0 t 30 0 t 30 0" fill="none" stroke={a} strokeWidth="5" strokeLinecap="round" />
          </svg>
        </div>
      );
    }
    default:
      return null;
  }
}
