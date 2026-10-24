import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowDownAZ,
  ArrowUpZA,
  ChartColumn,
  Baseline,
  Bold,
  DollarSign,
  Download,
  Italic,
  PaintBucket,
  Percent,
  Plus,
  Redo2,
  Snowflake,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  addr,
  colName,
  evaluateSheet,
  formatValue,
  parseRange,
  type CellStylePatch,
  type Chart,
  type Sheet,
  type Value,
} from "@hacktx/shared";
import { redoMine, undoMine } from "@/lib/actions";
import { SWATCHES } from "@/lib/canvas";
import { download, safeName } from "@/lib/download";
import { cn } from "@/lib/utils";
import { isBusy, useDoc } from "@/store/deck";
import { commit } from "@/store/editor";
import { MenuItem, Sep, Tool } from "./DocEditor";
import { Popover } from "./ui/popover";

const ROW_H = 28;
const HEADER_W = 46;
const DEFAULT_W = 100;

interface Pos {
  r: number;
  c: number;
}
const rangeOf = (a: Pos, b: Pos) => ({ r0: Math.min(a.r, b.r), c0: Math.min(a.c, b.c), r1: Math.max(a.r, b.r), c1: Math.max(a.c, b.c) });
const rangeName = (b: { r0: number; c0: number; r1: number; c1: number }) =>
  b.r0 === b.r1 && b.c0 === b.c1 ? addr(b.r0, b.c0) : `${addr(b.r0, b.c0)}:${addr(b.r1, b.c1)}`;

/** Bounds of every non-empty cell, for "sort the table" and "chart the data" when nothing is selected. */
function usedRange(sheet: Sheet) {
  let r1 = -1;
  let c1 = -1;
  for (const [a, cell] of Object.entries(sheet.cells)) {
    if (!cell.v) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(a);
    if (!m) continue;
    r1 = Math.max(r1, Number(m[2]) - 1);
    c1 = Math.max(c1, [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1);
  }
  return r1 < 0 ? undefined : { r0: 0, c0: 0, r1, c1 };
}

/** Google Sheets / Excel style editor: formula bar, grid with selection, formatting and charts. */
export function SheetEditor({ sheet }: { sheet: Sheet }) {
  const values = useMemo(() => evaluateSheet(sheet), [sheet]);
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [head, setHead] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ value: string; bar: boolean }>();
  const [widthPreview, setWidthPreview] = useState<{ col: string; w: number }>();
  const gridRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const flash = useDoc((s) => (s.flash?.targets ? s.flash : undefined));
  const aiCell = useDoc((s) => (isBusy(s) && s.focus?.targets ? s.focus.elementId : undefined));

  const sel = rangeOf(anchor, head);
  const active = addr(head.r, head.c);
  const raw = sheet.cells[active]?.v ?? "";
  const style = sheet.cells[active]?.s ?? {};
  const widthOf = (c: number) => {
    const col = colName(c);
    return widthPreview?.col === col ? widthPreview.w : (sheet.colWidths[col] ?? DEFAULT_W);
  };
  const flashSet = useMemo(() => new Set(flash?.targets ?? []), [flash]);

  useEffect(() => {
    if (!aiCell) return;
    gridRef.current?.querySelector(`[data-cell="${aiCell}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [aiCell]);

  const clamp = (p: Pos): Pos => ({ r: Math.max(0, Math.min(sheet.rows - 1, p.r)), c: Math.max(0, Math.min(sheet.cols - 1, p.c)) });
  const moveTo = (p: Pos, extend = false) => {
    const q = clamp(p);
    setHead(q);
    if (!extend) setAnchor(q);
    requestAnimationFrame(() => gridRef.current?.querySelector(`[data-cell="${addr(q.r, q.c)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };

  const commitEdit = (value: string, then?: Pos) => {
    if (value !== raw) commit({ type: "set_cells", cells: { [active]: value === "" ? null : value } });
    setEditing(undefined);
    if (then) moveTo(then);
    gridRef.current?.focus();
  };

  const styleSel = (patch: CellStylePatch) => commit({ type: "set_cell_style", range: rangeName(sel), style: patch });
  const clearSel = () => {
    const cells: Record<string, null> = {};
    for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) if (sheet.cells[addr(r, c)]?.v) cells[addr(r, c)] = null;
    if (Object.keys(cells).length) commit({ type: "set_cells", cells });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k as "ArrowUp"];
    if (step) {
      e.preventDefault();
      const far = mod ? 1000 : 1;
      moveTo({ r: head.r + step[0]! * far, c: head.c + step[1]! * far }, e.shiftKey);
    } else if (k === "Enter" || k === "F2") {
      e.preventDefault();
      setEditing({ value: raw, bar: false });
    } else if (k === "Tab") {
      e.preventDefault();
      moveTo({ r: head.r, c: head.c + (e.shiftKey ? -1 : 1) });
    } else if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      clearSel();
    } else if (mod && k.toLowerCase() === "z") {
      e.preventDefault();
      (e.shiftKey ? redoMine : undoMine)();
    } else if (mod && k.toLowerCase() === "y") {
      e.preventDefault();
      redoMine();
    } else if (mod && k.toLowerCase() === "b") {
      e.preventDefault();
      styleSel({ bold: !style.bold });
    } else if (mod && k.toLowerCase() === "i") {
      e.preventDefault();
      styleSel({ italic: !style.italic });
    } else if (mod && k.toLowerCase() === "a") {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setHead({ r: sheet.rows - 1, c: sheet.cols - 1 });
    } else if (k.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      setEditing({ value: k, bar: false });
    }
  };

  /** Copy writes raw inputs as tab-separated text, which pastes cleanly into Sheets, Excel or another tab. */
  const onCopy = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    const rows: string[] = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const row: string[] = [];
      for (let c = sel.c0; c <= sel.c1; c++) row.push(sheet.cells[addr(r, c)]?.v ?? "");
      rows.push(row.join("\t"));
    }
    e.clipboardData.setData("text/plain", rows.join("\n"));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\r/g, "").replace(/\n$/, "");
    if (!text) return;
    const cells: Record<string, string | null> = {};
    text.split("\n").forEach((line, i) =>
      line.split("\t").forEach((v, j) => {
        cells[addr(head.r + i, head.c + j)] = v === "" ? null : v;
      }),
    );
    commit({ type: "set_cells", cells });
  };

  const sortBy = (desc: boolean) => {
    const multiRow = sel.r1 > sel.r0;
    const used = usedRange(sheet);
    const range = multiRow ? sel : used && { ...used, r0: (sheet.frozenRows ?? 0) > 0 ? 1 : 0 };
    if (!range || range.r1 <= range.r0) return;
    commit({ type: "sort_range", range: rangeName(range), byCol: colName(head.c), desc });
  };

  const addChart = (chartType: Chart["chartType"]) => {
    const range = sel.r1 > sel.r0 || sel.c1 > sel.c0 ? sel : usedRange(sheet);
    if (!range) return;
    commit({ type: "add_chart", id: `c-${Math.random().toString(36).slice(2, 6)}`, chartType, range: rangeName(range) });
  };

  const exportCsv = () => {
    const used = usedRange(sheet);
    if (!used) return;
    const lines: string[] = [];
    for (let r = 0; r <= used.r1; r++) {
      const row: string[] = [];
      for (let c = 0; c <= used.c1; c++) {
        const a = addr(r, c);
        const v = formatValue(values.get(a), { ...sheet.cells[a]?.s, format: sheet.cells[a]?.s?.format === "text" ? "text" : "auto" });
        row.push(/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      }
      lines.push(row.join(","));
    }
    download(`${safeName(sheet.title)}.csv`, lines.join("\n"), "text/csv");
  };

  const startResize = (e: ReactMouseEvent, c: number) => {
    e.preventDefault();
    e.stopPropagation();
    const col = colName(c);
    const x0 = e.clientX;
    const w0 = widthOf(c);
    let w = w0;
    const move = (ev: MouseEvent) => {
      w = Math.max(30, Math.round(w0 + ev.clientX - x0));
      setWidthPreview({ col, w });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setWidthPreview(undefined);
      if (w !== w0) commit({ type: "set_col_width", col, width: w });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const frozen = sheet.frozenRows ?? 0;
  const cols = Array.from({ length: sheet.cols }, (_, c) => c);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-white px-2 [scrollbar-width:none]">
        <Tool icon={Undo2} label="Undo (⌘Z)" onClick={undoMine} />
        <Tool icon={Redo2} label="Redo (⌘⇧Z)" onClick={redoMine} />
        <Sep />
        <Tool icon={DollarSign} label="Currency" active={style.format === "currency"} onClick={() => styleSel({ format: style.format === "currency" ? null : "currency" })} />
        <Tool icon={Percent} label="Percent" active={style.format === "percent"} onClick={() => styleSel({ format: style.format === "percent" ? null : "percent" })} />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => styleSel({ format: style.format === "number" ? null : "number" })}
          className={cn("h-8 shrink-0 rounded-md px-1.5 text-xs font-medium hover:bg-slate-100", style.format === "number" && "bg-violet-100 text-violet-700")}
          title="Number (1,234.00)"
        >
          123
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => styleSel({ decimals: Math.max(0, (style.decimals ?? 2) - 1) })}
          className="h-8 shrink-0 rounded-md px-1.5 text-xs hover:bg-slate-100"
          title="Fewer decimals"
        >
          .0←
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => styleSel({ decimals: Math.min(10, (style.decimals ?? 0) + 1) })}
          className="h-8 shrink-0 rounded-md px-1.5 text-xs hover:bg-slate-100"
          title="More decimals"
        >
          .00→
        </button>
        <Sep />
        <Tool icon={Bold} label="Bold (⌘B)" active={style.bold} onClick={() => styleSel({ bold: !style.bold })} />
        <Tool icon={Italic} label="Italic (⌘I)" active={style.italic} onClick={() => styleSel({ italic: !style.italic })} />
        <Swatch icon={Baseline} label="Text color" value={style.color} onPick={(color) => styleSel({ color })} />
        <Swatch icon={PaintBucket} label="Fill color" value={style.fill} onPick={(fill) => styleSel({ fill })} />
        <Tool icon={TextAlignStart} label="Align left" active={style.align === "left"} onClick={() => styleSel({ align: "left" })} />
        <Tool icon={TextAlignCenter} label="Align center" active={style.align === "center"} onClick={() => styleSel({ align: "center" })} />
        <Tool icon={TextAlignEnd} label="Align right" active={style.align === "right"} onClick={() => styleSel({ align: "right" })} />
        <Sep />
        <Popover trigger={() => <Tool icon={Plus} label="Insert or delete rows and columns" text="Rows & cols" />}>
          {(close) => (
            <div className="flex w-52 flex-col text-sm">
              {(
                [
                  ["Row above", () => commit({ type: "insert_rows", at: sel.r0, count: sel.r1 - sel.r0 + 1 })],
                  ["Row below", () => commit({ type: "insert_rows", at: sel.r1 + 1, count: sel.r1 - sel.r0 + 1 })],
                  ["Column left", () => commit({ type: "insert_cols", at: sel.c0, count: sel.c1 - sel.c0 + 1 })],
                  ["Column right", () => commit({ type: "insert_cols", at: sel.c1 + 1, count: sel.c1 - sel.c0 + 1 })],
                  ["Delete row(s)", () => commit({ type: "delete_rows", at: sel.r0, count: sel.r1 - sel.r0 + 1 })],
                  ["Delete column(s)", () => commit({ type: "delete_cols", at: sel.c0, count: sel.c1 - sel.c0 + 1 })],
                ] as const
              ).map(([label, fn]) => (
                <MenuItem
                  key={label}
                  onClick={() => {
                    fn();
                    close();
                  }}
                >
                  {label}
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>
        <Tool icon={ArrowDownAZ} label={`Sort A→Z by column ${colName(head.c)}`} onClick={() => sortBy(false)} />
        <Tool icon={ArrowUpZA} label={`Sort Z→A by column ${colName(head.c)}`} onClick={() => sortBy(true)} />
        <Tool icon={Snowflake} label={frozen ? "Unfreeze header row" : "Freeze header row"} active={frozen > 0} onClick={() => commit({ type: "set_frozen", rows: frozen ? 0 : 1 })} />
        <Popover trigger={() => <Tool icon={ChartColumn} label="Insert chart from selection" text="Chart" />}>
          {(close) => (
            <div className="flex w-40 flex-col text-sm">
              {(["bar", "line", "pie"] as const).map((t) => (
                <MenuItem
                  key={t}
                  onClick={() => {
                    addChart(t);
                    close();
                  }}
                >
                  {t[0]!.toUpperCase() + t.slice(1)} chart
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>
        <div className="ml-auto pl-2">
          <Tool icon={Download} label="Download CSV" text="CSV" onClick={exportCsv} />
        </div>
      </div>

      {/* Formula bar */}
      <div className="flex h-9 shrink-0 items-center border-b border-slate-200 bg-white text-sm">
        <div className="w-20 shrink-0 border-r border-slate-200 px-2 text-center font-mono text-xs text-slate-600">{rangeName(sel)}</div>
        <span className="px-2 font-serif italic text-slate-400">fx</span>
        <input
          value={editing ? editing.value : raw}
          onFocus={() => !editing && setEditing({ value: raw, bar: true })}
          onChange={(e) => setEditing({ value: e.target.value, bar: true })}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit(editing?.value ?? raw, { r: head.r + 1, c: head.c });
            if (e.key === "Escape") {
              setEditing(undefined);
              gridRef.current?.focus();
            }
          }}
          onBlur={() => editing?.bar && commitEdit(editing.value)}
          className="h-full flex-1 bg-transparent font-mono text-[13px] outline-none"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onCopy={onCopy}
          onCut={(e) => {
            onCopy(e);
            if (!editing) clearSel();
          }}
          onPaste={onPaste}
          onMouseUp={() => (dragging.current = false)}
          className="relative min-w-0 flex-1 overflow-auto bg-white outline-none"
        >
          <table className="border-separate border-spacing-0 text-[13px]" style={{ tableLayout: "fixed", width: HEADER_W + cols.reduce((n, c) => n + widthOf(c), 0) }}>
            <colgroup>
              <col style={{ width: HEADER_W }} />
              {cols.map((c) => (
                <col key={c} style={{ width: widthOf(c) }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ height: ROW_H }}>
                <th className="sticky left-0 top-0 z-30 border-b border-r border-slate-300 bg-slate-100" />
                {cols.map((c) => (
                  <th
                    key={c}
                    onMouseDown={() => {
                      setAnchor({ r: 0, c });
                      setHead({ r: sheet.rows - 1, c });
                    }}
                    className={cn(
                      "sticky top-0 z-20 select-none border-b border-r border-slate-300 bg-slate-100 font-medium text-slate-500",
                      c >= sel.c0 && c <= sel.c1 && "bg-violet-100 text-violet-700",
                    )}
                  >
                    {colName(c)}
                    <span onMouseDown={(e) => startResize(e, c)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-violet-400" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: sheet.rows }, (_, r) => (
                <tr key={r} style={{ height: ROW_H }}>
                  <th
                    onMouseDown={() => {
                      setAnchor({ r, c: 0 });
                      setHead({ r, c: sheet.cols - 1 });
                    }}
                    className={cn(
                      "sticky left-0 z-10 select-none border-b border-r border-slate-300 bg-slate-100 text-xs font-normal text-slate-500",
                      r < frozen && "border-b-slate-400",
                      r >= sel.r0 && r <= sel.r1 && "bg-violet-100 text-violet-700",
                    )}
                  >
                    {r + 1}
                  </th>
                  {cols.map((c) => {
                    const a = addr(r, c);
                    const cell = sheet.cells[a];
                    const v = values.get(a);
                    const inSel = r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
                    const isActive = r === head.r && c === head.c;
                    const s = cell?.s;
                    const align = s?.align ?? (typeof v === "number" ? "right" : typeof v === "boolean" ? "center" : "left");
                    return (
                      <td
                        key={c}
                        data-cell={a}
                        onMouseDown={(e) => {
                          if (editing && !isActive) commitEdit(editing.value);
                          dragging.current = true;
                          if (e.shiftKey) setHead({ r, c });
                          else {
                            setAnchor({ r, c });
                            setHead({ r, c });
                          }
                        }}
                        onMouseEnter={() => dragging.current && setHead({ r, c })}
                        onDoubleClick={() => setEditing({ value: cell?.v ?? "", bar: false })}
                        className={cn(
                          "relative overflow-hidden whitespace-nowrap border-b border-r border-slate-200 px-1.5",
                          r < frozen && "sticky z-[5] border-b-slate-400",
                          inSel && !isActive && "bg-violet-50",
                          isError(v) && "text-red-600",
                        )}
                        style={{
                          top: r < frozen ? ROW_H * (r + 1) : undefined,
                          background: inSel && !isActive ? undefined : (s?.fill ?? (r < frozen ? "white" : undefined)),
                          color: isError(v) ? undefined : s?.color,
                          fontWeight: s?.bold ? 700 : undefined,
                          fontStyle: s?.italic ? "italic" : undefined,
                          textAlign: align,
                        }}
                      >
                        {flashSet.has(a) && <span key={flash!.key} className="cell-flash pointer-events-none absolute inset-0" />}
                        {isActive && editing && !editing.bar ? (
                          <CellInput
                            value={editing.value}
                            onChange={(value) => setEditing({ value, bar: false })}
                            onCommit={(value, dr, dc) => commitEdit(value, { r: r + dr, c: c + dc })}
                            onCancel={() => {
                              setEditing(undefined);
                              gridRef.current?.focus();
                            }}
                          />
                        ) : (
                          <span className="relative">{formatValue(v, s)}</span>
                        )}
                        {isActive && <span className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-violet-600" />}
                        {aiCell === a && (
                          <span className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-fuchsia-500">
                            <span className="absolute -top-px right-0 rounded-bl bg-fuchsia-500 px-1 text-[10px] font-semibold leading-4 text-white">Muse</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sheet.charts.length > 0 && (
          <aside className="hidden w-80 shrink-0 space-y-3 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3 md:block">
            {sheet.charts.map((chart) => (
              <ChartCard key={chart.id} chart={chart} sheet={sheet} values={values} />
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

const isError = (v: Value | undefined) => typeof v === "object" && v !== null;

function CellInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string, dr: number, dc: number) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const finish = (dr: number, dc: number) => {
    done.current = true;
    onCommit(ref.current?.value ?? value, dr, dc);
  };
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.shiftKey ? -1 : 1, 0);
        else if (e.key === "Tab") {
          e.preventDefault();
          finish(0, e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => !done.current && finish(0, 0)}
      className="absolute inset-0 z-10 w-full bg-white px-1.5 font-mono text-[13px] shadow-[0_0_0_2px_#7c3aed] outline-none"
    />
  );
}

function Swatch({ icon, label, value, onPick }: { icon: typeof Bold; label: string; value?: string; onPick: (c: string | null) => void }) {
  const Icon = icon;
  return (
    <Popover
      trigger={() => (
        <button onMouseDown={(e) => e.preventDefault()} title={label} className="relative flex h-8 shrink-0 items-center rounded-md px-1.5 hover:bg-slate-100">
          <Icon className="size-4" />
          <span className="absolute inset-x-1.5 bottom-1 h-[3px] rounded-full ring-1 ring-black/10" style={{ background: value ?? "transparent" }} />
        </button>
      )}
    >
      {(close) => (
        <div className="w-56 space-y-2">
          <div className="grid grid-cols-7 gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  close();
                }}
                className="size-6 rounded-md ring-1 ring-black/10 transition hover:scale-110"
                style={{ background: c }}
              />
            ))}
          </div>
          <button
            onClick={() => {
              onPick(null);
              close();
            }}
            className="w-full rounded-md px-1.5 py-1 text-left text-xs hover:bg-slate-100"
          >
            Reset
          </button>
        </div>
      )}
    </Popover>
  );
}

const PALETTE = ["#7c3aed", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#ec4899", "#64748b", "#14b8a6"];

/** Bar, line or pie chart over a range: first column labels, first row series names. */
function ChartCard({ chart, sheet, values }: { chart: Chart; sheet: Sheet; values: Map<string, Value> }) {
  const b = parseRange(chart.range);
  const data = useMemo(() => {
    if (!b) return undefined;
    const series = [];
    for (let c = b.c0 + 1; c <= b.c1; c++) series.push({ name: formatValue(values.get(addr(b.r0, c))) || colName(c), values: [] as number[] });
    const labels: string[] = [];
    for (let r = b.r0 + 1; r <= b.r1; r++) {
      const label = formatValue(values.get(addr(r, b.c0)), sheet.cells[addr(r, b.c0)]?.s);
      if (!label) continue;
      labels.push(label);
      series.forEach((s, i) => {
        const v = values.get(addr(r, b.c0 + 1 + i));
        s.values.push(typeof v === "number" ? v : 0);
      });
    }
    return { labels, series };
  }, [b?.r0, b?.r1, b?.c0, b?.c1, values, sheet.cells]);

  const W = 296;
  const H = 190;
  const pad = { l: 36, r: 8, t: 10, b: 34 };
  let body: React.ReactNode = <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-slate-400 text-xs">No numeric data</text>;

  if (data && data.labels.length && data.series.length) {
    const all = data.series.flatMap((s) => s.values);
    const max = Math.max(0, ...all);
    const min = Math.min(0, ...all);
    const span = max - min || 1;
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const y = (v: number) => pad.t + ih - ((v - min) / span) * ih;
    const ticks = [min, min + span / 2, max];
    const short = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : `${Math.round(n * 10) / 10}`);

    if (chart.chartType === "pie") {
      const vals = data.series[0]!.values.map((v) => Math.max(0, v));
      const total = vals.reduce((a, v) => a + v, 0) || 1;
      let angle = -Math.PI / 2;
      const cx = 88;
      const cy = H / 2;
      const rad = 76;
      body = (
        <>
          {vals.map((v, i) => {
            const a0 = angle;
            const a1 = (angle += (v / total) * Math.PI * 2);
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const d =
              vals.length === 1
                ? `M ${cx - rad} ${cy} a ${rad} ${rad} 0 1 0 ${rad * 2} 0 a ${rad} ${rad} 0 1 0 ${-rad * 2} 0`
                : `M ${cx} ${cy} L ${cx + rad * Math.cos(a0)} ${cy + rad * Math.sin(a0)} A ${rad} ${rad} 0 ${large} 1 ${cx + rad * Math.cos(a1)} ${cy + rad * Math.sin(a1)} Z`;
            return <path key={i} d={d} fill={PALETTE[i % PALETTE.length]} stroke="white" strokeWidth={1.5} />;
          })}
          {data.labels.slice(0, 8).map((l, i) => (
            <g key={l + i} transform={`translate(182 ${18 + i * 20})`}>
              <rect width={10} height={10} rx={2} fill={PALETTE[i % PALETTE.length]} />
              <text x={15} y={9} className="fill-slate-600 text-[10px]">
                {l.length > 12 ? `${l.slice(0, 11)}…` : l} {Math.round((vals[i]! / total) * 100)}%
              </text>
            </g>
          ))}
        </>
      );
    } else {
      const n = data.labels.length;
      const band = iw / n;
      body = (
        <>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-slate-200" />
              <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">
                {short(t)}
              </text>
            </g>
          ))}
          {chart.chartType === "bar"
            ? data.series.map((s, si) =>
                s.values.map((v, i) => {
                  const bw = (band * 0.7) / data.series.length;
                  const x = pad.l + i * band + band * 0.15 + si * bw;
                  return <rect key={`${si}-${i}`} x={x} y={Math.min(y(v), y(0))} width={Math.max(1, bw - 1)} height={Math.abs(y(v) - y(0))} rx={2} fill={PALETTE[si % PALETTE.length]} />;
                }),
              )
            : data.series.map((s, si) => (
                <polyline
                  key={si}
                  fill="none"
                  stroke={PALETTE[si % PALETTE.length]}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  points={s.values.map((v, i) => `${pad.l + i * band + band / 2},${y(v)}`).join(" ")}
                />
              ))}
          {data.labels.map((l, i) =>
            n <= 12 || i % Math.ceil(n / 12) === 0 ? (
              <text key={i} x={pad.l + i * band + band / 2} y={H - pad.b + 13} textAnchor="middle" className="fill-slate-500 text-[9px]">
                {l.length > 8 ? `${l.slice(0, 7)}…` : l}
              </text>
            ) : null,
          )}
          {data.series.length > 1 &&
            data.series.slice(0, 4).map((s, i) => (
              <g key={s.name} transform={`translate(${pad.l + i * 66} ${H - 10})`}>
                <rect width={8} height={8} rx={2} fill={PALETTE[i % PALETTE.length]} />
                <text x={11} y={8} className="fill-slate-600 text-[9px]">
                  {s.name.slice(0, 9)}
                </text>
              </g>
            ))}
        </>
      );
    }
  }

  return (
    <div className="group relative rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="mb-1 flex items-center justify-between">
        <div className="truncate text-sm font-semibold text-slate-700">{chart.title || chart.range}</div>
        <button
          onClick={() => commit({ type: "delete_chart", id: chart.id })}
          className="rounded p-1 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
          title="Delete chart"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {body}
      </svg>
    </div>
  );
}

