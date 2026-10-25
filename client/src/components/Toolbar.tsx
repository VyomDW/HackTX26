import { useRef, type ReactNode } from "react";
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Baseline,
  Bold,
  BringToFront,
  ChevronDown,
  Circle,
  Copy,
  Diamond,
  FileDown,
  ImagePlus,
  Italic,
  Layers,
  List,
  Minus,
  MoveRight,
  PaintBucket,
  Palette,
  PenLine,
  Play,
  Plus,
  Redo2,
  SendToBack,
  Shapes,
  Slash,
  Square,
  Star,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Triangle,
  Type,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { THEMES, themeOf, type ShapeKind, type Style } from "@hacktx/shared";
import * as act from "@/lib/actions";
import { FONT_SIZES, FONTS, SWATCHES } from "@/lib/canvas";
import { cn } from "@/lib/utils";
import { useDeck, selectDeck } from "@/store/deck";
import { commit, useEditor } from "@/store/editor";
import { Popover } from "./ui/popover";

const SHAPES: { kind: ShapeKind; icon: LucideIcon; label: string }[] = [
  { kind: "rect", icon: Square, label: "Rectangle" },
  { kind: "rounded", icon: Square, label: "Rounded rectangle" },
  { kind: "ellipse", icon: Circle, label: "Ellipse" },
  { kind: "triangle", icon: Triangle, label: "Triangle" },
  { kind: "diamond", icon: Diamond, label: "Diamond" },
  { kind: "star", icon: Star, label: "Star" },
  { kind: "line", icon: Slash, label: "Line" },
  { kind: "arrow", icon: MoveRight, label: "Arrow" },
];

/** Google Slides-style toolbar: insert tools always, formatting for the selection, slide settings otherwise. */
export function Toolbar() {
  const deck = useDeck(selectDeck);
  const slideId = useEditor((s) => s.slideId);
  const selectedId = useEditor((s) => s.selectedId);
  const fileRef = useRef<HTMLInputElement>(null);

  const slide = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];
  const el = slide?.elements.find((e) => e.id === selectedId);
  const st: Style = el?.style ?? {};
  const hasText = el && el.kind !== "image";

  return (
    <div className="ink-bar flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto px-2 [scrollbar-width:none]">
      <Tool icon={Undo2} label="Undo (⌘Z)" onClick={act.undoMine} />
      <Tool icon={Redo2} label="Redo (⌘⇧Z)" onClick={act.redoMine} />
      <Sep />
      <Tool icon={Type} label="Text box" onClick={act.insertText} disabled={!slide} />
      <Tool icon={ImagePlus} label="Insert image" onClick={() => fileRef.current?.click()} disabled={!slide} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void act.insertImages(e.target.files);
          e.target.value = "";
        }}
      />
      <Popover trigger={() => <Tool icon={Shapes} label="Shape" caret disabled={!slide} />}>
        {(close) => (
          <div className="grid w-44 grid-cols-4 gap-1">
            {SHAPES.map((s) => (
              <button
                key={s.kind}
                title={s.label}
                onClick={() => {
                  act.insertShape(s.kind);
                  close();
                }}
                className="grid size-9 place-items-center rounded-md hover:bg-slate-100"
              >
                <s.icon className="size-4" />
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Sep />

      {el && hasText && (
        <>
          <select
            value={st.fontFamily ?? "Inter"}
            onChange={(e) => act.setStyle({ fontFamily: e.target.value })}
            className="h-8 w-32 rounded-md px-1 text-sm hover:bg-slate-100"
            style={{ fontFamily: st.fontFamily }}
            title="Font"
          >
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
          <Sep />
          <Tool icon={Minus} label="Decrease font size" onClick={() => act.bumpFontSize(-2)} />
          <select
            value={st.fontSize ?? 24}
            onChange={(e) => act.setStyle({ fontSize: Number(e.target.value) })}
            className="h-8 w-14 rounded-md border border-slate-200 text-center text-sm"
            title="Font size"
          >
            {[...new Set([...FONT_SIZES, st.fontSize ?? 24])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Tool icon={Plus} label="Increase font size" onClick={() => act.bumpFontSize(2)} />
          <Sep />
          <Tool icon={Bold} label="Bold (⌘B)" active={st.bold} onClick={() => act.toggleStyle("bold")} />
          <Tool icon={Italic} label="Italic (⌘I)" active={st.italic} onClick={() => act.toggleStyle("italic")} />
          <Tool icon={Underline} label="Underline (⌘U)" active={st.underline} onClick={() => act.toggleStyle("underline")} />
          <Tool icon={Strikethrough} label="Strikethrough" active={st.strike} onClick={() => act.toggleStyle("strike")} />
          <ColorTool icon={Baseline} label="Text color" value={st.color} onPick={(color) => act.setStyle({ color })} />
          <Sep />
          <Tool icon={TextAlignStart} label="Align left" active={(st.align ?? "left") === "left"} onClick={() => act.setStyle({ align: "left" })} />
          <Tool icon={TextAlignCenter} label="Align center" active={st.align === "center"} onClick={() => act.setStyle({ align: "center" })} />
          <Tool icon={TextAlignEnd} label="Align right" active={st.align === "right"} onClick={() => act.setStyle({ align: "right" })} />
          <Tool icon={AlignVerticalJustifyStart} label="Top" active={(st.valign ?? "top") === "top"} onClick={() => act.setStyle({ valign: "top" })} />
          <Tool icon={AlignVerticalJustifyCenter} label="Middle" active={st.valign === "middle"} onClick={() => act.setStyle({ valign: "middle" })} />
          <Tool icon={AlignVerticalJustifyEnd} label="Bottom" active={st.valign === "bottom"} onClick={() => act.setStyle({ valign: "bottom" })} />
          <Tool icon={List} label="Bulleted list" onClick={act.bulletsSelected} />
          <select
            value={st.lineHeight ?? 1.25}
            onChange={(e) => act.setStyle({ lineHeight: Number(e.target.value) })}
            className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
            title="Line spacing"
          >
            {[...new Set([1, 1.15, 1.25, 1.5, 1.6, 2, st.lineHeight ?? 1.25])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
          <Sep />
        </>
      )}

      {el && (
        <>
          {el.kind !== "image" && (
            <ColorTool icon={PaintBucket} label="Fill color" value={st.fill} allowNone onPick={(fill) => act.setStyle({ fill })} />
          )}
          <ColorTool icon={PenLine} label="Border color" value={st.stroke} onPick={(stroke) => act.setStyle({ stroke, strokeWidth: st.strokeWidth || 2 })} />
          <select
            value={st.strokeWidth ?? 0}
            onChange={(e) => act.setStyle({ strokeWidth: Number(e.target.value) })}
            className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
            title="Border weight"
          >
            {[0, 1, 2, 4, 6, 8, 12].map((n) => (
              <option key={n} value={n}>
                {n ? `${n}px` : "No border"}
              </option>
            ))}
          </select>
          {el.kind !== "text" || st.fill ? (
            <select
              value={st.radius ?? (el.kind === "shape" ? "" : 0)}
              onChange={(e) => act.setStyle({ radius: e.target.value === "" ? null : Number(e.target.value) })}
              className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
              title="Corner radius"
            >
              {el.kind === "shape" && <option value="">Auto corners</option>}
              {[0, 8, 16, 24, 48, 999].map((n) => (
                <option key={n} value={n}>
                  {n === 999 ? "Pill" : n ? `Radius ${n}` : "Square corners"}
                </option>
              ))}
            </select>
          ) : null}
          {el.kind === "image" && (
            <select
              value={st.fit ?? "cover"}
              onChange={(e) => act.setStyle({ fit: e.target.value as "cover" | "contain" })}
              className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
              title="Image fit"
            >
              <option value="cover">Fill box (crop)</option>
              <option value="contain">Fit inside</option>
            </select>
          )}
          <select
            value={st.opacity ?? 1}
            onChange={(e) => act.setStyle({ opacity: Number(e.target.value) })}
            className="h-8 rounded-md px-1 text-xs hover:bg-slate-100"
            title="Transparency"
          >
            {[1, 0.85, 0.7, 0.5, 0.3, 0.15].map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100)}% opaque
              </option>
            ))}
          </select>
          <Sep />
          <Popover trigger={() => <Tool icon={Layers} label="Arrange" caret />}>
            {(close) => (
              <div className="flex w-44 flex-col text-sm">
                {(
                  [
                    ["front", "Bring to front", BringToFront],
                    ["forward", "Bring forward", BringToFront],
                    ["backward", "Send backward", SendToBack],
                    ["back", "Send to back", SendToBack],
                  ] as const
                ).map(([where, label, Icon]) => (
                  <button
                    key={where}
                    onClick={() => {
                      act.arrange(where);
                      close();
                    }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100"
                  >
                    <Icon className="size-4 text-slate-500" /> {label}
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <Tool icon={Copy} label="Duplicate (⌘D)" onClick={act.duplicateSelected} />
          <Tool icon={Trash2} label="Delete (⌫)" onClick={act.deleteSelected} />
        </>
      )}

      {!el && slide && (
        <>
          <ThemePicker />
          <ColorTool
            icon={PaintBucket}
            label="Slide background"
            text="Background"
            value={slide.background}
            allowNone
            onPick={(background) => commit({ type: "set_slide", slideId: slide.id, background })}
          />
          <span className="ml-2 hidden text-xs text-slate-400 md:inline">Double-click text to edit · drag to move · drop images onto the slide</span>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        <Tool icon={FileDown} label="Export PDF" text="PDF" onClick={() => window.print()} disabled={!slide} />
        <button
          onClick={() => useEditor.setState({ presenting: true })}
          disabled={!slide}
          className="flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
        >
          <Play className="size-3.5 fill-current" /> Present
        </button>
      </div>
    </div>
  );
}

function Tool({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  caret,
  text,
  swatch,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  caret?: boolean;
  text?: string;
  swatch?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-sm text-slate-700 transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40",
        active && "bg-violet-100 text-violet-700 hover:bg-violet-100",
      )}
    >
      <Icon className="size-4" />
      {text && <span className="text-xs">{text}</span>}
      {caret && <ChevronDown className="size-3 text-slate-400" />}
      {swatch !== undefined && (
        <span className="absolute inset-x-1.5 bottom-1 h-[3px] rounded-full ring-1 ring-black/10" style={{ background: swatch || "transparent" }} />
      )}
    </button>
  );
}

function ColorTool({
  icon,
  label,
  value,
  onPick,
  allowNone,
  text,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  onPick: (color: string | null) => void;
  allowNone?: boolean;
  text?: string;
}) {
  return (
    <Popover trigger={() => <Tool icon={icon} label={label} text={text} swatch={value ?? ""} />}>
      {(close) => (
        <div className="w-56 space-y-2">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="grid grid-cols-7 gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                title={c}
                onClick={() => {
                  onPick(c);
                  close();
                }}
                className={cn("size-6 rounded-md ring-1 ring-black/10 transition hover:scale-110", value === c && "ring-2 ring-violet-500")}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-slate-100 pt-2 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-slate-100">
              <input type="color" value={value?.startsWith("#") && value.length === 7 ? value : "#7c3aed"} onChange={(e) => onPick(e.target.value)} className="size-5 cursor-pointer" />
              Custom
            </label>
            {allowNone && (
              <button
                onClick={() => {
                  onPick(null);
                  close();
                }}
                className="rounded-md px-1.5 py-1 hover:bg-slate-100"
              >
                None
              </button>
            )}
          </div>
        </div>
      )}
    </Popover>
  );
}

const Sep = (): ReactNode => <div className="mx-1 h-5 w-px shrink-0 bg-slate-200" />;

/** Deck themes as little slide swatches: background, title font in the ink colour and an accent bar. */
function ThemePicker() {
  const current = themeOf(useDeck((s) => selectDeck(s).theme));
  return (
    <Popover trigger={() => <Tool icon={Palette} label="Theme" text={current.label} caret />}>
      {(close) => (
        <div className="grid w-[372px] grid-cols-3 gap-2">
          {Object.values(THEMES).map((t) => (
            <button
              key={t.id}
              title={t.vibe}
              onClick={() => {
                if (t.id !== current.id) commit({ type: "set_theme", theme: t.id });
                close();
              }}
              className={cn("rounded-lg p-1 text-left text-xs hover:bg-slate-100", t.id === current.id && "ring-2 ring-violet-500")}
            >
              <span className="relative block aspect-video overflow-hidden rounded-md ring-1 ring-black/10" style={{ background: t.background }}>
                <span className="absolute left-2 top-2 text-[15px] font-bold leading-none" style={{ fontFamily: t.titleFont, color: t.ink }}>
                  Aa
                </span>
                <span className="absolute bottom-2 left-2 h-1.5 w-8 rounded-full" style={{ background: t.accent }} />
                <span className="absolute bottom-2 left-12 h-1.5 w-5 rounded-full opacity-60" style={{ background: t.body }} />
              </span>
              <span className="mt-1 block px-0.5 font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
