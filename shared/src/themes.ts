import { z } from "zod";

/** Deck themes: fonts, colours and a decoration layer the client draws behind every slide. */
export const ThemeId = z.enum(["classic", "notebook", "midnight", "editorial", "brutalist", "terminal", "sunset", "blueprint", "pastel"]);
export type ThemeId = z.infer<typeof ThemeId>;

export interface DeckTheme {
  id: ThemeId;
  label: string;
  /** One line for the model, so it can match a theme to the topic. */
  vibe: string;
  /** Any CSS background; used when a slide has no background of its own. */
  background: string;
  ink: string;
  body: string;
  muted: string;
  accent: string;
  /** Text colour on an accent fill. */
  accentInk: string;
  titleFont: string;
  bodyFont: string;
  quoteFont: string;
}

export const THEMES: Record<ThemeId, DeckTheme> = {
  classic: {
    id: "classic",
    label: "Classic",
    vibe: "clean white, safe for anything",
    background: "#ffffff",
    ink: "#0f172a",
    body: "#334155",
    muted: "#64748b",
    accent: "#8b5cf6",
    accentInk: "#ffffff",
    titleFont: "Inter",
    bodyFont: "Inter",
    quoteFont: "Playfair Display",
  },
  notebook: {
    id: "notebook",
    label: "Notebook",
    vibe: "graph paper, tape and orange ink; hackathons, brainstorms, classes, scrappy pitches",
    background: "#fbfbf8",
    ink: "#1c1b18",
    body: "#3b3a35",
    muted: "#6b6a63",
    accent: "#ea580c",
    accentInk: "#ffffff",
    titleFont: "Space Grotesk",
    bodyFont: "Inter",
    quoteFont: "Caveat",
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    vibe: "deep navy with glowing orbs; tech, AI, space, product launches",
    background: "radial-gradient(120% 90% at 15% 0%, #1e1b4b 0%, #0b1020 58%)",
    ink: "#f8fafc",
    body: "#cbd5e1",
    muted: "#94a3b8",
    accent: "#38bdf8",
    accentInk: "#0b1020",
    titleFont: "Poppins",
    bodyFont: "Inter",
    quoteFont: "Playfair Display",
  },
  editorial: {
    id: "editorial",
    label: "Editorial",
    vibe: "cream paper, serif type, thin rules; history, literature, essays, research",
    background: "#f4efe6",
    ink: "#1a1a1a",
    body: "#3d3a35",
    muted: "#7a746b",
    accent: "#b91c1c",
    accentInk: "#ffffff",
    titleFont: "Playfair Display",
    bodyFont: "Lora",
    quoteFont: "Playfair Display",
  },
  brutalist: {
    id: "brutalist",
    label: "Brutalist",
    vibe: "thick black frame, loud orange, condensed type; bold opinions, startups, manifestos",
    background: "#f2f0e9",
    ink: "#0a0a0a",
    body: "#262626",
    muted: "#525252",
    accent: "#ff4d00",
    accentInk: "#0a0a0a",
    titleFont: "Oswald",
    bodyFont: "Inter",
    quoteFont: "Oswald",
  },
  terminal: {
    id: "terminal",
    label: "Terminal",
    vibe: "dark code editor window, monospace, green prompt; engineering, dev tools, APIs, security",
    background: "#0d1117",
    ink: "#e6edf3",
    body: "#b1bac4",
    muted: "#7d8590",
    accent: "#3fb950",
    accentInk: "#0d1117",
    titleFont: "JetBrains Mono",
    bodyFont: "Roboto Mono",
    quoteFont: "JetBrains Mono",
  },
  sunset: {
    id: "sunset",
    label: "Sunset",
    vibe: "plum-to-coral gradient with soft blobs; travel, food, music, culture, inspiration",
    background: "linear-gradient(135deg, #3b0a45 0%, #8a1c5c 52%, #e85d3f 100%)",
    ink: "#fff7ed",
    body: "#fde2d4",
    muted: "#f9b9a3",
    accent: "#ffd166",
    accentInk: "#3b0a45",
    titleFont: "Montserrat",
    bodyFont: "Inter",
    quoteFont: "Playfair Display",
  },
  blueprint: {
    id: "blueprint",
    label: "Blueprint",
    vibe: "blue drafting grid, yellow highlights; architecture, engineering, plans, how things work",
    background: "#1a4d8f",
    ink: "#f1f6ff",
    body: "#cfe0fb",
    muted: "#93b4e3",
    accent: "#facc15",
    accentInk: "#10294d",
    titleFont: "Space Grotesk",
    bodyFont: "Inter",
    quoteFont: "Space Grotesk",
  },
  pastel: {
    id: "pastel",
    label: "Pastel",
    vibe: "soft pink with confetti, friendly rounded type; events, education for kids, wellness, community",
    background: "#fdf4ff",
    ink: "#3b0764",
    body: "#581c87",
    muted: "#8b5ca8",
    accent: "#ec4899",
    accentInk: "#ffffff",
    titleFont: "Poppins",
    bodyFont: "Inter",
    quoteFont: "Lora",
  },
};

export const themeOf = (id?: ThemeId): DeckTheme => THEMES[id ?? "classic"];

interface Restylable {
  style: { color?: string; fill?: string; stroke?: string; fontFamily?: string; fontSize?: number; bold?: boolean };
}

/**
 * Moves elements from one theme's palette and fonts to another's. Only values that came from the old
 * theme change, so colours a user picked by hand stay put. Slides keep their own backgrounds.
 */
export function retheme(slides: { elements: Restylable[] }[], from: DeckTheme, to: DeckTheme) {
  const colors = new Map<string, string>([
    [from.ink, to.ink],
    [from.body, to.body],
    [from.muted, to.muted],
    [from.accent, to.accent],
    [from.accentInk, to.accentInk],
  ]);
  for (const slide of slides) {
    for (const { style } of slide.elements) {
      for (const key of ["color", "fill", "stroke"] as const) {
        const v = style[key]?.toLowerCase();
        if (v && colors.has(v)) style[key] = colors.get(v);
      }
      const f = style.fontFamily;
      if (!f) continue;
      // A theme can use one family for titles and body, so headline-ish text decides which side it is on.
      const headline = !!style.bold || (style.fontSize ?? 0) >= 40;
      if (f === from.quoteFont && f !== from.titleFont && f !== from.bodyFont) style.fontFamily = to.quoteFont;
      else if (f === from.titleFont && (f !== from.bodyFont || headline)) style.fontFamily = to.titleFont;
      else if (f === from.bodyFont) style.fontFamily = to.bodyFont;
    }
  }
}
