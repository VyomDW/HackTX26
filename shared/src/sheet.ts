import { z } from "zod";

/** An Excel / Google Sheets style grid. Cells are keyed by A1 address and hold raw input; "=..." is a formula. */
export const NumberFormat = z.enum(["auto", "number", "currency", "percent", "text"]);

export const CellStyle = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  color: z.string().optional(),
  fill: z.string().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  format: NumberFormat.optional(),
  decimals: z.number().int().min(0).max(10).optional(),
});
export type CellStyle = z.infer<typeof CellStyle>;

export const CellStylePatch = z.object({
  bold: z.boolean().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  color: z.string().nullable().optional(),
  fill: z.string().nullable().optional(),
  align: z.enum(["left", "center", "right"]).nullable().optional(),
  format: NumberFormat.nullable().optional(),
  decimals: z.number().int().min(0).max(10).nullable().optional(),
});
export type CellStylePatch = z.infer<typeof CellStylePatch>;

export const Cell = z.object({ v: z.string(), s: CellStyle.optional() });
export type Cell = z.infer<typeof Cell>;

export const ChartType = z.enum(["bar", "line", "pie"]);

export const Chart = z.object({
  id: z.string(),
  chartType: ChartType,
  /** First column is labels, each further column a series; first row is headers. */
  range: z.string(),
  title: z.string().optional(),
});
export type Chart = z.infer<typeof Chart>;

export const Sheet = z.object({
  kind: z.literal("sheet"),
  id: z.string(),
  title: z.string(),
  rows: z.number().int().min(1),
  cols: z.number().int().min(1),
  cells: z.record(z.string(), Cell),
  colWidths: z.record(z.string(), z.number()),
  frozenRows: z.number().int().min(0).optional(),
  charts: z.array(Chart),
});
export type Sheet = z.infer<typeof Sheet>;

export const emptySheet = (id: string): Sheet => ({
  kind: "sheet",
  id,
  title: "Untitled spreadsheet",
  rows: 100,
  cols: 26,
  cells: {},
  colWidths: {},
  frozenRows: 1,
  charts: [],
});

/** Sets raw values; null clears a cell's value (its formatting stays). */
/** Cell input is always text; models often send 452.42 or true unquoted, so those are taken as their text form. */
const CellInput = z.union([z.string(), z.number().transform(String), z.boolean().transform((b) => (b ? "TRUE" : "FALSE"))]);
export const SetCells = z.object({ type: z.literal("set_cells"), cells: z.record(z.string(), CellInput.nullable()) });
export const SetCellStyle = z.object({ type: z.literal("set_cell_style"), range: z.string(), style: CellStylePatch });
export const InsertRows = z.object({ type: z.literal("insert_rows"), at: z.number().int().min(0), count: z.number().int().min(1).max(500) });
export const DeleteRows = z.object({ type: z.literal("delete_rows"), at: z.number().int().min(0), count: z.number().int().min(1).max(500) });
export const InsertCols = z.object({ type: z.literal("insert_cols"), at: z.number().int().min(0), count: z.number().int().min(1).max(100) });
export const DeleteCols = z.object({ type: z.literal("delete_cols"), at: z.number().int().min(0), count: z.number().int().min(1).max(100) });
export const SetColWidth = z.object({ type: z.literal("set_col_width"), col: z.string(), width: z.number().min(20).max(1000) });
export const SortRange = z.object({
  type: z.literal("sort_range"),
  range: z.string(),
  byCol: z.string(),
  desc: z.boolean().optional(),
  /** Keep the first row of the range in place. */
  header: z.boolean().optional(),
});
export const AddChart = z.object({ type: z.literal("add_chart"), id: z.string(), chartType: ChartType, range: z.string(), title: z.string().optional() });
export const DeleteChart = z.object({ type: z.literal("delete_chart"), id: z.string() });
export const SetFrozen = z.object({ type: z.literal("set_frozen"), rows: z.number().int().min(0).max(10) });
/** Server-only inverses. */
export const RestoreCells = z.object({ type: z.literal("restore_cells"), cells: z.record(z.string(), Cell.nullable()) });
export const RestoreChart = z.object({ type: z.literal("restore_chart"), chart: Chart, index: z.number().int().min(0) });
export const SetGrid = z.object({ type: z.literal("set_grid"), rows: z.number().int().min(1), cols: z.number().int().min(1) });

export const SHEET_OPS = [
  "set_cells",
  "set_cell_style",
  "insert_rows",
  "delete_rows",
  "insert_cols",
  "delete_cols",
  "set_col_width",
  "sort_range",
  "add_chart",
  "delete_chart",
  "set_frozen",
  "restore_cells",
  "restore_chart",
  "set_grid",
] as const;

// ---- Addresses ----

export const colName = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export const colIndex = (name: string): number => [...name.toUpperCase()].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export const addr = (row: number, col: number) => `${colName(col)}${row + 1}`;

export function parseAddr(a: string): { row: number; col: number } | undefined {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a.trim());
  if (!m) return undefined;
  return { row: Number(m[2]) - 1, col: colIndex(m[1]!) };
}

/** "A1:C3" (or a single "B2") as inclusive bounds. */
export function parseRange(r: string): { r0: number; c0: number; r1: number; c1: number } | undefined {
  const [a, b = a] = r.split(":");
  const p = parseAddr(a ?? "");
  const q = parseAddr(b ?? "");
  if (!p || !q) return undefined;
  return { r0: Math.min(p.row, q.row), c0: Math.min(p.col, q.col), r1: Math.max(p.row, q.row), c1: Math.max(p.col, q.col) };
}
