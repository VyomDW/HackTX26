import { CANVAS_W, themeOf, type Block, type Deck, type Element, type Notebook, type ShapeKind, type TextDoc } from "@hacktx/shared";
import { listNumbers } from "./markdown";

/** Real Office files built in the browser. The libraries are loaded on first export so they stay out of the main bundle. */

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Shared helpers ----

let probe: CanvasRenderingContext2D | null = null;
/** Any CSS colour as "RRGGBB" (what both Office libraries want), or undefined when it can't be read. */
function hex(color: string | undefined): string | undefined {
  if (!color || color === "none" || color === "transparent") return undefined;
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return undefined;
  probe.fillStyle = "#000001";
  probe.fillStyle = color;
  const v = probe.fillStyle;
  if (v === "#000001" && color !== "#000001") return undefined;
  if (v.startsWith("#")) return v.slice(1).toUpperCase();
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(v);
  return m ? [m[1], m[2], m[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("").toUpperCase() : undefined;
}

/** A gradient can't be a slide fill in PowerPoint, so use the colour it settles on (its last stop). */
const solidOf = (background: string) => {
  const colors = background.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi);
  return hex(colors ? colors[colors.length - 1] : background);
};

/** Fetches an image and redraws it as a PNG, optionally cropped (cover) or letterboxed (contain) to a box's shape. */
async function rasterize(url: string, box?: { w: number; h: number; fit?: "cover" | "contain" }) {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const bitmap = await createImageBitmap(await res.blob());
    const iw = bitmap.width;
    const ih = bitmap.height;
    let sx = 0, sy = 0, sw = iw, sh = ih, w = iw, h = ih;
    if (box && box.fit !== "contain") {
      const r = box.w / box.h;
      if (iw / ih > r) (sw = ih * r), (sx = (iw - sw) / 2);
      else (sh = iw / r), (sy = (ih - sh) / 2);
      (w = sw), (h = sh);
    }
    const scale = Math.min(1, 2000 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    return { dataUrl, width: canvas.width, height: canvas.height };
  } catch {
    return undefined;
  }
}

type Run = { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; link?: string };
const INLINE = /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|\*[^*\n]+\*)/g;

/** The app's inline markdown (**bold**, *italic*, ~~strike~~, `code`, [links](url)) as styled runs. */
function runs(text: string, inherit: Omit<Run, "text"> = {}): Run[] {
  return text.split(INLINE).flatMap((part): Run[] => {
    if (!part) return [];
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return runs(part.slice(2, -2), { ...inherit, bold: true });
    if (part.length > 4 && part.startsWith("~~") && part.endsWith("~~")) return [{ ...inherit, text: part.slice(2, -2), strike: true }];
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return [{ ...inherit, text: part.slice(1, -1), code: true }];
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) return [{ ...inherit, text: link[1]!, link: link[2] }];
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return runs(part.slice(1, -1), { ...inherit, italic: true });
    return [{ ...inherit, text: part }];
  });
}

// ---- Slides -> .pptx ----

/** Slides are 1280 units wide and PowerPoint's 16:9 layout is 13.333in, so one unit is 1/96in, and a font unit is 0.75pt. */
const IN = 13.333 / CANVAS_W;
const PT = 0.75;

const SHAPES: Record<ShapeKind, string> = {
  rect: "rect",
  rounded: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  star: "star5",
  line: "line",
  arrow: "line",
};

export async function deckToPptx(deck: Deck): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.title;
  const theme = themeOf(deck.theme);

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    const bg = solidOf(s.background ?? theme.background);
    if (bg) slide.background = { color: bg };

    for (const el of s.elements) await addElement(slide, el);

    const sources = s.citations.map((c) => `${c.source}: ${c.url}`);
    const notes = [s.notes?.trim(), sources.length ? `Sources:\n${sources.join("\n")}` : ""].filter(Boolean).join("\n\n");
    if (notes) slide.addNotes(notes);
  }
  return (await pptx.write({ outputType: "blob" })) as Blob;
}

type PptxSlide = ReturnType<InstanceType<typeof import("pptxgenjs").default>["addSlide"]>;

async function addElement(slide: PptxSlide, el: Element) {
  const st = el.style;
  const pos = { x: el.box.x * IN, y: el.box.y * IN, w: el.box.w * IN, h: el.box.h * IN, rotate: el.box.rotate };
  const transparency = st.opacity !== undefined ? Math.round((1 - st.opacity) * 100) : undefined;

  if (el.kind === "image") {
    const img = el.url && (await rasterize(el.url, { w: el.box.w, h: el.box.h, fit: st.fit }));
    if (!img) return;
    if (st.fit === "contain") {
      // Letterbox inside the box, keeping the picture's own shape.
      const scale = Math.min(pos.w / img.width, pos.h / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      slide.addImage({ data: img.dataUrl, x: pos.x + (pos.w - w) / 2, y: pos.y + (pos.h - h) / 2, w, h, rotate: pos.rotate, transparency });
    } else slide.addImage({ data: img.dataUrl, ...pos, transparency, rounding: false });
    return;
  }

  const fillColor = hex(st.fill);
  const strokeW = st.strokeWidth ?? 0;
  const line = strokeW && hex(st.stroke ?? "#0f172a") ? { color: hex(st.stroke ?? "#0f172a"), width: strokeW * PT } : undefined;

  if (el.kind === "shape" && (el.shape === "line" || el.shape === "arrow")) {
    // Drawn with the fill colour unless a border is set, as on the canvas.
    const color = (st.stroke && strokeW ? hex(st.stroke) : fillColor) ?? "0F172A";
    slide.addShape("line", {
      x: pos.x,
      y: pos.y + pos.h / 2,
      w: pos.w,
      h: 0,
      rotate: pos.rotate,
      line: { color, width: Math.max(strokeW, 6) * PT, endArrowType: el.shape === "arrow" ? "triangle" : undefined, transparency },
    });
    return;
  }

  const text = el.text ?? "";
  const shape = el.kind === "shape" ? SHAPES[el.shape] : "rect";
  const base = {
    fontFace: st.fontFamily,
    fontSize: (st.fontSize ?? 24) * PT,
    color: hex(st.color) ?? "0F172A",
    bold: st.bold,
    italic: st.italic,
    underline: st.underline ? { style: "sng" as const } : undefined,
    strike: st.strike ? ("sngStrike" as const) : undefined,
  };
  const lines = text.split("\n");
  const textRuns = lines.flatMap((l, i) => {
    const r = runs(l);
    const parts = (r.length ? r : [{ text: "" }]).map((run) => ({
      text: run.text,
      options: {
        ...base,
        ...(run.bold && { bold: true }),
        ...(run.italic && { italic: true }),
        ...(run.strike && { strike: "sngStrike" as const }),
        ...(run.code && { fontFace: "Consolas" }),
        ...(run.link && { hyperlink: { url: run.link } }),
      } as Record<string, unknown>,
    }));
    if (i < lines.length - 1) parts[parts.length - 1]!.options.breakLine = true;
    return parts;
  });

  const pad = (el.kind === "text" ? 4 : 16) * PT;
  const radius = st.radius ?? (shape === "roundRect" ? Math.min(el.box.w, el.box.h) * 0.18 : 0);
  slide.addText(textRuns as Parameters<PptxSlide["addText"]>[0], {
    ...pos,
    shape: (radius && shape === "rect" ? "roundRect" : shape) as never,
    rectRadius: radius ? Math.min(0.5, radius / Math.min(el.box.w, el.box.h)) : undefined,
    fill: fillColor ? { color: fillColor, transparency } : undefined,
    line,
    align: st.align ?? (el.kind === "shape" ? "center" : "left"),
    valign: st.valign ?? (el.kind === "shape" ? "middle" : "top"),
    lineSpacingMultiple: st.lineHeight ?? 1.25,
    margin: [pad, pad, pad, pad],
    fit: "none",
    wrap: true,
  });
}

// ---- Docs and notes -> .docx ----

/** Note bodies are line-based markdown; read them as document blocks so notes and docs share one writer. */
function noteBlocks(body: string): Block[] {
  const out: Block[] = [];
  let code: string[] | null = null;
  body.split("\n").forEach((line, i) => {
    const id = `l${i}`;
    if (line.startsWith("```")) {
      if (code) out.push({ id, type: "code", text: code.join("\n") }), (code = null);
      else code = [];
      return;
    }
    if (code) return void code.push(line);
    let m: RegExpExecArray | null;
    const indent = Math.min(4, Math.floor((/^ */.exec(line)?.[0].length ?? 0) / 2));
    const t = line.trimStart();
    if ((m = /^- \[( |x|X)\] (.*)$/.exec(t))) out.push({ id, type: "todo", text: m[2]!, checked: m[1] !== " ", indent });
    else if ((m = /^(#{1,3}) (.*)$/.exec(t))) out.push({ id, type: `h${m[1]!.length + 1 > 3 ? 3 : m[1]!.length + 1}` as Block["type"], text: m[2]! });
    else if ((m = /^[-*•] (.*)$/.exec(t))) out.push({ id, type: "bullet", text: m[1]!, indent });
    else if ((m = /^\d+\. (.*)$/.exec(t))) out.push({ id, type: "numbered", text: m[1]!, indent });
    else if ((m = /^> ?(.*)$/.exec(t))) out.push({ id, type: "quote", text: m[1]! });
    else if (/^(-{3,}|\*{3,})$/.test(t)) out.push({ id, type: "divider", text: "" });
    else if (t) out.push({ id, type: "p", text: line });
  });
  if (code) out.push({ id: "lend", type: "code", text: (code as string[]).join("\n") });
  return out;
}

export async function docToDocx(doc: TextDoc): Promise<Blob> {
  return writeDocx(doc.title, [{ blocks: doc.blocks }]);
}

export async function notebookToDocx(book: Notebook): Promise<Blob> {
  return writeDocx(
    book.title,
    book.notes.map((n) => ({ heading: n.title || "Untitled", tags: n.tags, blocks: noteBlocks(n.body) })),
  );
}

async function writeDocx(title: string, sections: { heading?: string; tags?: string[]; blocks: Block[] }[]): Promise<Blob> {
  const d = await import("docx");
  const { Paragraph, TextRun, ExternalHyperlink, HeadingLevel, ImageRun, AlignmentType, BorderStyle, ShadingType, LevelFormat } = d;

  const textRuns = (text: string, extra: { italics?: boolean; color?: string } = {}) =>
    runs(text).map((r) => {
      const run = new TextRun({
        text: r.text,
        bold: r.bold,
        italics: r.italic || extra.italics,
        strike: r.strike,
        font: r.code ? "Consolas" : undefined,
        color: r.link ? "6D28D9" : extra.color,
        underline: r.link ? {} : undefined,
        shading: r.code ? { type: ShadingType.CLEAR, fill: "F4F4F5", color: "auto" } : undefined,
      });
      return r.link ? new ExternalHyperlink({ link: r.link, children: [run] }) : run;
    });

  const align = (b: Block) =>
    b.align === "center" ? AlignmentType.CENTER : b.align === "right" ? AlignmentType.RIGHT : undefined;
  const HEADINGS = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 } as const;

  const children: InstanceType<typeof Paragraph>[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] })];
  // Each run of numbered items is its own list instance, so numbering restarts after other blocks, as in the editor.
  let listInstance = 0;

  for (const section of sections) {
    if (section.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: textRuns(section.heading) }));
    if (section.tags?.length)
      children.push(new Paragraph({ children: [new TextRun({ text: section.tags.map((t) => `#${t}`).join("  "), color: "64748B", size: 18 })] }));

    const nums = listNumbers(section.blocks);
    let prevNumbered = false;
    for (const b of section.blocks) {
      const level = b.indent ?? 0;
      if (b.type === "numbered" && (!prevNumbered || nums.get(b.id) === 1)) listInstance++;
      prevNumbered = b.type === "numbered" || (prevNumbered && (b.type === "bullet" || b.type === "todo"));
      switch (b.type) {
        case "h1":
        case "h2":
        case "h3":
          children.push(new Paragraph({ heading: HEADINGS[b.type], alignment: align(b), children: textRuns(b.text) }));
          break;
        case "bullet":
          children.push(new Paragraph({ bullet: { level }, alignment: align(b), children: textRuns(b.text) }));
          break;
        case "numbered":
          children.push(new Paragraph({ numbering: { reference: "numbered", level, instance: listInstance }, alignment: align(b), children: textRuns(b.text) }));
          break;
        case "todo":
          children.push(
            new Paragraph({
              indent: { left: 360 + level * 360, hanging: 360 },
              children: [new TextRun({ text: b.checked ? "☑\t" : "☐\t" }), ...textRuns(b.text, b.checked ? { color: "94A3B8" } : {})],
            }),
          );
          break;
        case "quote":
          children.push(
            new Paragraph({
              indent: { left: 360 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: "CBD5E1", space: 12 } },
              children: textRuns(b.text, { italics: true, color: "475569" }),
            }),
          );
          break;
        case "callout":
          children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: "F5F3FF", color: "auto" }, children: [new TextRun("💡 "), ...textRuns(b.text)] }));
          break;
        case "code":
          children.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, fill: "F4F4F5", color: "auto" },
              children: b.text.split("\n").map((l, i) => new TextRun({ text: l, font: "Consolas", size: 20, break: i ? 1 : undefined })),
            }),
          );
          break;
        case "divider":
          children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1", space: 1 } }, children: [] }));
          break;
        case "image": {
          const img = b.url ? await rasterize(b.url) : undefined;
          if (!img) break;
          // 6.5in of usable page width at 96px per inch.
          const scale = Math.min(1, 624 / img.width);
          const data = Uint8Array.from(atob(img.dataUrl.split(",")[1]!), (c) => c.charCodeAt(0));
          children.push(
            new Paragraph({
              alignment: align(b) ?? AlignmentType.CENTER,
              children: [new ImageRun({ type: "png", data, transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) }, altText: { name: b.text || "image", description: b.text, title: b.text } })],
            }),
          );
          break;
        }
        default:
          children.push(new Paragraph({ alignment: align(b), children: textRuns(b.text) }));
      }
    }
  }

  const doc = new d.Document({
    title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { after: 120, line: 300 } } } } },
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER][level]!,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
  return d.Packer.toBlob(doc);
}
