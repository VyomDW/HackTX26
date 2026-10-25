import { defaultPlacement, type Box, type Deck, type Element, type Slide, type Style, type StylePatch } from "./deck";
import { retheme, themeOf, type DeckTheme } from "./themes";
import { layoutBoard, nodeDefaults, type Board, type BoardEdge, type BoardNode } from "./board";
import type { Document } from "./document";
import { evaluateSheet, isError, type Value } from "./formula";
import type { Notebook } from "./notes";
import type { Op } from "./ops";
import { addr, colIndex, colName, parseAddr, parseRange, type Cell, type CellStyle, type Sheet } from "./sheet";
import type { TextDoc } from "./textdoc";

export class OpError extends Error {}

export interface ApplyResult {
  doc: Document;
  /** Ops that revert this one, applied in order. */
  inverse: Op[];
}

const foreign = (op: Op, kind: string) => new OpError(`${op.type} does not apply to a ${kind}`);

/** Pure: returns the new document plus the inverse ops. Throws OpError when the op cannot apply. */
export function applyOp(doc: Document, op: Op): ApplyResult {
  if (op.type === "noop") return { doc, inverse: [{ type: "noop" }] };
  if (op.type === "set_title") return { doc: { ...doc, title: op.title }, inverse: [{ type: "set_title", title: doc.title }] };
  switch (doc.kind) {
    case "slides": {
      const r = applySlides(doc, op);
      return { doc: r.deck, inverse: r.inverse };
    }
    case "doc":
      return applyTextDoc(doc, op);
    case "sheet":
      return applySheet(doc, op);
    case "notes":
      return applyNotes(doc, op);
    case "board":
      return applyBoard(doc, op);
  }
}

const findSlide = (deck: Deck, slideId: string): Slide => {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) throw new OpError(`unknown slide ${slideId}`);
  return slide;
};

const findElement = (slide: Slide, elementId: string): Element => {
  const el = slide.elements.find((e) => e.id === elementId);
  if (!el) throw new OpError(`unknown element ${elementId}`);
  return el;
};

/** Box and style for a new element: explicit values win over the layout default. */
const place = (slide: Slide, theme: DeckTheme, elementId: string, kind: Element["kind"], box?: Box, style?: Style) => {
  const role = elementId.startsWith(`${slide.id}-`) ? elementId.slice(slide.id.length + 1) : elementId;
  const d = defaultPlacement(slide.layout, role, kind, slide.elements.length, theme);
  return { box: box ?? d.box, style: { ...d.style, ...style } };
};

/** Applies a style patch in place and returns the patch that restores the previous values. */
const patchStyle = (style: Style, patch: StylePatch): StylePatch => {
  const prev: Record<string, unknown> = {};
  const target = style as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    prev[key] = target[key] ?? null;
    if (value === null) delete target[key];
    else target[key] = value;
  }
  return prev as StylePatch;
};

const patchBox = (box: Box, patch: Partial<Box>): Partial<Box> => {
  const prev: Partial<Box> = {};
  for (const key of ["x", "y", "w", "h", "rotate"] as const) {
    if (patch[key] === undefined) continue;
    prev[key] = box[key] ?? 0;
    box[key] = patch[key];
  }
  return prev;
};

function applySlides(deck: Deck, op: Op): { deck: Deck; inverse: Op[] } {
  const next: Deck = structuredClone(deck);
  const theme = themeOf(next.theme);

  switch (op.type) {
    case "set_theme": {
      const prev = next.theme ?? "classic";
      retheme(next.slides, theme, themeOf(op.theme));
      // Classic is the default, so it is stored as no theme at all.
      if (op.theme === "classic") delete next.theme;
      else next.theme = op.theme;
      return { deck: next, inverse: [{ type: "set_theme", theme: prev }] };
    }
    case "add_slide": {
      if (next.slides.some((s) => s.id === op.id)) throw new OpError(`slide ${op.id} exists`);
      const afterIdx = op.afterId ? next.slides.findIndex((s) => s.id === op.afterId) : -1;
      const index = op.afterId && afterIdx >= 0 ? afterIdx + 1 : next.slides.length;
      const slide: Slide = { id: op.id, layout: op.layout, elements: [], citations: [] };
      // A timeline's steps hang off an accent line, so the slide comes with one.
      if (op.layout === "timeline") slide.elements.push({ id: `${op.id}-line`, kind: "shape", shape: "rect", ...place(slide, theme, `${op.id}-line`, "shape") });
      next.slides.splice(index, 0, slide);
      return { deck: next, inverse: [{ type: "delete_slide", slideId: op.id }] };
    }
    case "set_text": {
      const slide = findSlide(next, op.slideId);
      const existing = slide.elements.find((e) => e.id === op.elementId);
      if (!existing) {
        slide.elements.push({ id: op.elementId, kind: "text", text: op.text, ...place(slide, theme, op.elementId, "text", op.box, op.style) });
        return { deck: next, inverse: [{ type: "delete_element", slideId: op.slideId, elementId: op.elementId }] };
      }
      if (existing.kind === "image") throw new OpError(`${op.elementId} is an image`);
      const inverse: Op[] = [{ type: "set_text", slideId: op.slideId, elementId: op.elementId, text: existing.text ?? "" }];
      existing.text = op.text;
      if (op.box) inverse.push({ type: "set_box", slideId: op.slideId, elementId: op.elementId, ...patchBox(existing.box, op.box) });
      if (op.style) inverse.push({ type: "set_style", slideId: op.slideId, elementId: op.elementId, style: patchStyle(existing.style, op.style) });
      return { deck: next, inverse };
    }
    case "add_image": {
      const slide = findSlide(next, op.slideId);
      if (slide.elements.some((e) => e.id === op.elementId)) throw new OpError(`element ${op.elementId} exists`);
      slide.elements.push({
        id: op.elementId,
        kind: "image",
        prompt: op.prompt,
        ...(op.url ? { url: op.url } : {}),
        ...place(slide, theme, op.elementId, "image", op.box, op.style),
      });
      return { deck: next, inverse: [{ type: "delete_element", slideId: op.slideId, elementId: op.elementId }] };
    }
    case "add_shape": {
      const slide = findSlide(next, op.slideId);
      if (slide.elements.some((e) => e.id === op.elementId)) throw new OpError(`element ${op.elementId} exists`);
      slide.elements.push({
        id: op.elementId,
        kind: "shape",
        shape: op.shape,
        ...(op.text !== undefined ? { text: op.text } : {}),
        ...place(slide, theme, op.elementId, "shape", op.box, op.style),
      });
      return { deck: next, inverse: [{ type: "delete_element", slideId: op.slideId, elementId: op.elementId }] };
    }
    case "set_image_url": {
      const el = findSlide(next, op.slideId).elements.find((e) => e.id === op.elementId);
      if (!el || el.kind !== "image") throw new OpError(`unknown image ${op.elementId}`);
      el.url = op.url;
      // Image arrival is not user-undoable on its own; undoing add_image removes it.
      return { deck: next, inverse: [{ type: "noop" }] };
    }
    case "set_box": {
      const el = findElement(findSlide(next, op.slideId), op.elementId);
      const { type: _t, slideId, elementId, ...patch } = op;
      const prev = patchBox(el.box, patch);
      return { deck: next, inverse: [{ type: "set_box", slideId, elementId, ...prev }] };
    }
    case "set_style": {
      const el = findElement(findSlide(next, op.slideId), op.elementId);
      const prev = patchStyle(el.style, op.style);
      return { deck: next, inverse: [{ ...op, style: prev }] };
    }
    case "reorder_element": {
      const slide = findSlide(next, op.slideId);
      const from = slide.elements.findIndex((e) => e.id === op.elementId);
      if (from < 0) throw new OpError(`unknown element ${op.elementId}`);
      const [el] = slide.elements.splice(from, 1) as [Element];
      slide.elements.splice(Math.min(op.toIndex, slide.elements.length), 0, el);
      return { deck: next, inverse: [{ ...op, toIndex: from }] };
    }
    case "set_slide": {
      const slide = findSlide(next, op.slideId);
      const inverse: Op = { type: "set_slide", slideId: op.slideId };
      for (const key of ["background", "notes"] as const) {
        const value = op[key];
        if (value === undefined) continue;
        inverse[key] = slide[key] ?? null;
        if (value === null) delete slide[key];
        else slide[key] = value;
      }
      return { deck: next, inverse: [inverse] };
    }
    case "duplicate_slide": {
      const index = next.slides.findIndex((s) => s.id === op.slideId);
      if (index < 0) throw new OpError(`unknown slide ${op.slideId}`);
      if (next.slides.some((s) => s.id === op.newId)) throw new OpError(`slide ${op.newId} exists`);
      const copy = structuredClone(next.slides[index]!);
      copy.id = op.newId;
      // Keep the "<slideId>-<role>" convention so the copy can be edited by role too.
      for (const el of copy.elements) {
        if (el.id.startsWith(`${op.slideId}-`)) el.id = `${op.newId}-${el.id.slice(op.slideId.length + 1)}`;
      }
      for (const c of copy.citations) c.id = `${op.newId}-${c.id}`;
      next.slides.splice(index + 1, 0, copy);
      return { deck: next, inverse: [{ type: "delete_slide", slideId: op.newId }] };
    }
    case "add_citation": {
      const slide = findSlide(next, op.slideId);
      const id = op.id ?? `${op.slideId}-c${slide.citations.length + 1}`;
      slide.citations.push({ id, source: op.source, url: op.url });
      return { deck: next, inverse: [{ type: "remove_citation", slideId: op.slideId, citationId: id }] };
    }
    case "remove_citation": {
      const slide = findSlide(next, op.slideId);
      const idx = slide.citations.findIndex((c) => c.id === op.citationId);
      if (idx < 0) throw new OpError(`unknown citation ${op.citationId}`);
      const [c] = slide.citations.splice(idx, 1);
      return { deck: next, inverse: [{ type: "add_citation", slideId: op.slideId, ...c }] };
    }
    case "delete_element": {
      const slide = findSlide(next, op.slideId);
      const index = slide.elements.findIndex((e) => e.id === op.elementId);
      if (index < 0) throw new OpError(`unknown element ${op.elementId}`);
      const [element] = slide.elements.splice(index, 1) as [Element];
      return { deck: next, inverse: [{ type: "insert_element", slideId: op.slideId, element, index }] };
    }
    case "insert_element": {
      const slide = findSlide(next, op.slideId);
      if (slide.elements.some((e) => e.id === op.element.id)) throw new OpError(`element ${op.element.id} exists`);
      slide.elements.splice(op.index, 0, op.element);
      return { deck: next, inverse: [{ type: "delete_element", slideId: op.slideId, elementId: op.element.id }] };
    }
    case "delete_slide": {
      const index = next.slides.findIndex((s) => s.id === op.slideId);
      if (index < 0) throw new OpError(`unknown slide ${op.slideId}`);
      const [slide] = next.slides.splice(index, 1) as [Slide];
      return { deck: next, inverse: [{ type: "insert_slide", slide, index }] };
    }
    case "insert_slide": {
      if (next.slides.some((s) => s.id === op.slide.id)) throw new OpError(`slide ${op.slide.id} exists`);
      next.slides.splice(op.index, 0, op.slide);
      return { deck: next, inverse: [{ type: "delete_slide", slideId: op.slide.id }] };
    }
    case "reorder_slide": {
      const from = next.slides.findIndex((s) => s.id === op.slideId);
      if (from < 0) throw new OpError(`unknown slide ${op.slideId}`);
      const [slide] = next.slides.splice(from, 1) as [Slide];
      next.slides.splice(Math.min(op.toIndex, next.slides.length), 0, slide);
      return { deck: next, inverse: [{ type: "reorder_slide", slideId: op.slideId, toIndex: from }] };
    }
    case "focus":
      return { deck: next, inverse: [{ type: "noop" }] };
    default:
      throw foreign(op, "slide deck");
  }
}

function applyTextDoc(doc: TextDoc, op: Op): ApplyResult {
  const next: TextDoc = structuredClone(doc);
  const blocks = next.blocks;
  const indexOf = (id: string) => blocks.findIndex((b) => b.id === id);
  const prevId = (i: number) => (i > 0 ? blocks[i - 1]!.id : null);
  const insertAt = (afterId: string | null | undefined) => {
    if (afterId === undefined) return blocks.length;
    if (afterId === null) return 0;
    const i = indexOf(afterId);
    return i < 0 ? blocks.length : i + 1;
  };

  switch (op.type) {
    case "insert_block": {
      if (indexOf(op.id) >= 0) throw new OpError(`block ${op.id} exists`);
      const { type: _t, id, afterId, blockType, ...rest } = op;
      blocks.splice(insertAt(afterId), 0, { id, type: blockType, ...rest });
      return { doc: next, inverse: [{ type: "delete_block", id }] };
    }
    case "restore_block": {
      if (indexOf(op.block.id) >= 0) throw new OpError(`block ${op.block.id} exists`);
      blocks.splice(insertAt(op.afterId), 0, op.block);
      return { doc: next, inverse: [{ type: "delete_block", id: op.block.id }] };
    }
    case "set_block": {
      const b = blocks[indexOf(op.id)];
      if (!b) throw new OpError(`unknown block ${op.id}`);
      const inverse: Op & { type: "set_block" } = { type: "set_block", id: op.id };
      if (op.text !== undefined) [inverse.text, b.text] = [b.text, op.text];
      if (op.blockType !== undefined) [inverse.blockType, b.type] = [b.type, op.blockType];
      if (op.checked !== undefined) [inverse.checked, b.checked] = [b.checked ?? false, op.checked];
      if (op.indent !== undefined) [inverse.indent, b.indent] = [b.indent ?? 0, op.indent];
      if (op.align !== undefined) {
        inverse.align = b.align ?? null;
        if (op.align === null) delete b.align;
        else b.align = op.align;
      }
      if (op.url !== undefined) {
        inverse.url = b.url ?? null;
        if (op.url === null) delete b.url;
        else b.url = op.url;
      }
      return { doc: next, inverse: [inverse] };
    }
    case "delete_block": {
      const i = indexOf(op.id);
      if (i < 0) throw new OpError(`unknown block ${op.id}`);
      const afterId = prevId(i);
      const [block] = blocks.splice(i, 1);
      return { doc: next, inverse: [{ type: "restore_block", block: block!, afterId }] };
    }
    case "move_block": {
      const i = indexOf(op.id);
      if (i < 0) throw new OpError(`unknown block ${op.id}`);
      if (op.afterId === op.id) throw new OpError("cannot move a block after itself");
      const from = prevId(i);
      const [block] = blocks.splice(i, 1);
      blocks.splice(insertAt(op.afterId), 0, block!);
      return { doc: next, inverse: [{ type: "move_block", id: op.id, afterId: from }] };
    }
    default:
      throw foreign(op, "document");
  }
}

const MAX_RANGE_CELLS = 20_000;
const DEFAULT_COL_WIDTH = 100;

function applySheet(sheet: Sheet, op: Op): ApplyResult {
  const next: Sheet = structuredClone(sheet);
  const cells = next.cells;
  /** Cell contents before this op touched them; becomes the restore_cells inverse. */
  const before: Record<string, Cell | null> = {};
  const remember = (a: string) => {
    if (!(a in before)) before[a] = cells[a] ? structuredClone(cells[a]!) : null;
  };
  const grid = { rows: sheet.rows, cols: sheet.cols };
  const grow = (row: number, col: number) => {
    next.rows = Math.max(next.rows, row + 1);
    next.cols = Math.max(next.cols, col + 1);
  };
  const restoreInverse = (): Op[] => {
    const inv: Op[] = [{ type: "restore_cells", cells: before }];
    if (next.rows !== grid.rows || next.cols !== grid.cols) inv.push({ type: "set_grid", ...grid });
    return inv;
  };
  const bounds = (range: string) => {
    const b = parseRange(range);
    if (!b) throw new OpError(`bad range ${range}`);
    if ((b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) > MAX_RANGE_CELLS) throw new OpError(`range ${range} is too large`);
    return b;
  };
  const writeCell = (a: string, cell: Cell | null) => {
    if (!cell || (cell.v === "" && !cell.s)) delete cells[a];
    else cells[a] = cell;
  };
  /** Moves every cell through a coordinate mapping; null drops the cell. */
  const remap = (fn: (row: number, col: number) => { row: number; col: number } | null) => {
    const moved: Record<string, Cell> = {};
    for (const [a, cell] of Object.entries(cells)) {
      const p = parseAddr(a)!;
      const to = fn(p.row, p.col);
      if (to) moved[addr(to.row, to.col)] = cell;
    }
    next.cells = moved;
  };

  switch (op.type) {
    case "set_cells": {
      for (const [raw, v] of Object.entries(op.cells)) {
        const a = raw.toUpperCase();
        const p = parseAddr(a);
        if (!p) throw new OpError(`bad cell ${raw}`);
        remember(a);
        grow(p.row, p.col);
        const cur = cells[a];
        writeCell(a, { ...(cur?.s ? { s: cur.s } : {}), v: v ?? "" });
      }
      return { doc: next, inverse: restoreInverse() };
    }
    case "restore_cells": {
      for (const [a, cell] of Object.entries(op.cells)) {
        remember(a);
        writeCell(a, cell ? structuredClone(cell) : null);
      }
      return { doc: next, inverse: [{ type: "restore_cells", cells: before }] };
    }
    case "set_cell_style": {
      const b = bounds(op.range);
      grow(b.r1, b.c1);
      for (let r = b.r0; r <= b.r1; r++) {
        for (let c = b.c0; c <= b.c1; c++) {
          const a = addr(r, c);
          remember(a);
          const cell: Cell = structuredClone(cells[a] ?? { v: "" });
          const style: Record<string, unknown> = { ...cell.s };
          for (const [k, v] of Object.entries(op.style)) {
            if (v === undefined) continue;
            if (v === null) delete style[k];
            else style[k] = v;
          }
          if (Object.keys(style).length) cell.s = style as CellStyle;
          else delete cell.s;
          writeCell(a, cell);
        }
      }
      return { doc: next, inverse: restoreInverse() };
    }
    case "insert_rows":
      remap((row, col) => ({ row: row >= op.at ? row + op.count : row, col }));
      next.rows += op.count;
      return { doc: next, inverse: [{ type: "delete_rows", at: op.at, count: op.count }] };
    case "delete_rows": {
      const end = op.at + op.count;
      for (const a of Object.keys(cells)) {
        const p = parseAddr(a)!;
        if (p.row >= op.at && p.row < end) remember(a);
      }
      remap((row, col) => (row < op.at ? { row, col } : row < end ? null : { row: row - op.count, col }));
      next.rows = Math.max(1, next.rows - op.count);
      return { doc: next, inverse: [{ type: "insert_rows", at: op.at, count: op.count }, { type: "restore_cells", cells: before }] };
    }
    case "insert_cols": {
      remap((row, col) => ({ row, col: col >= op.at ? col + op.count : col }));
      next.cols += op.count;
      const widths: Record<string, number> = {};
      for (const [c, w] of Object.entries(next.colWidths)) {
        const i = colIndex(c);
        widths[colName(i >= op.at ? i + op.count : i)] = w;
      }
      next.colWidths = widths;
      return { doc: next, inverse: [{ type: "delete_cols", at: op.at, count: op.count }] };
    }
    case "delete_cols": {
      const end = op.at + op.count;
      for (const a of Object.keys(cells)) {
        const p = parseAddr(a)!;
        if (p.col >= op.at && p.col < end) remember(a);
      }
      remap((row, col) => (col < op.at ? { row, col } : col < end ? null : { row, col: col - op.count }));
      next.cols = Math.max(1, next.cols - op.count);
      const widths: Record<string, number> = {};
      const lost: Op[] = [];
      for (const [c, w] of Object.entries(next.colWidths)) {
        const i = colIndex(c);
        if (i < op.at) widths[c] = w;
        else if (i >= end) widths[colName(i - op.count)] = w;
        else lost.push({ type: "set_col_width", col: c, width: w });
      }
      next.colWidths = widths;
      return { doc: next, inverse: [{ type: "insert_cols", at: op.at, count: op.count }, { type: "restore_cells", cells: before }, ...lost] };
    }
    case "set_col_width": {
      const col = op.col.toUpperCase();
      const prev = next.colWidths[col] ?? DEFAULT_COL_WIDTH;
      // The default width is stored as absence, so undoing a resize leaves the sheet exactly as it was.
      if (op.width === DEFAULT_COL_WIDTH) delete next.colWidths[col];
      else next.colWidths[col] = op.width;
      return { doc: next, inverse: [{ type: "set_col_width", col, width: prev }] };
    }
    case "sort_range": {
      const b = bounds(op.range);
      const key = colIndex(op.byCol.toUpperCase());
      if (key < b.c0 || key > b.c1) throw new OpError(`column ${op.byCol} is outside ${op.range}`);
      const values = evaluateSheet(sheet);
      const start = op.header ? b.r0 + 1 : b.r0;
      const rows: { cells: (Cell | undefined)[]; key: Value | undefined }[] = [];
      for (let r = start; r <= b.r1; r++) {
        const row: (Cell | undefined)[] = [];
        for (let c = b.c0; c <= b.c1; c++) {
          remember(addr(r, c));
          row.push(cells[addr(r, c)]);
        }
        rows.push({ cells: row, key: values.get(addr(r, key)) });
      }
      const rank = (v: Value | undefined) => (v === undefined || v === null || v === "" ? 2 : typeof v === "number" ? 0 : 1);
      rows.sort((x, y) => {
        const d = rank(x.key) - rank(y.key);
        if (d || rank(x.key) === 2) return d;
        const cmp =
          typeof x.key === "number" && typeof y.key === "number"
            ? x.key - y.key
            : String(isError(x.key) ? x.key.code : x.key).localeCompare(String(isError(y.key) ? y.key.code : y.key), undefined, { numeric: true });
        return op.desc ? -cmp : cmp;
      });
      rows.forEach((row, i) => row.cells.forEach((cell, j) => writeCell(addr(start + i, b.c0 + j), cell ?? null)));
      return { doc: next, inverse: [{ type: "restore_cells", cells: before }] };
    }
    case "add_chart": {
      if (next.charts.some((c) => c.id === op.id)) throw new OpError(`chart ${op.id} exists`);
      if (!parseRange(op.range)) throw new OpError(`bad range ${op.range}`);
      const { type: _t, ...chart } = op;
      next.charts.push(chart);
      return { doc: next, inverse: [{ type: "delete_chart", id: op.id }] };
    }
    case "delete_chart": {
      const index = next.charts.findIndex((c) => c.id === op.id);
      if (index < 0) throw new OpError(`unknown chart ${op.id}`);
      const [chart] = next.charts.splice(index, 1);
      return { doc: next, inverse: [{ type: "restore_chart", chart: chart!, index }] };
    }
    case "restore_chart":
      next.charts.splice(Math.min(op.index, next.charts.length), 0, op.chart);
      return { doc: next, inverse: [{ type: "delete_chart", id: op.chart.id }] };
    case "set_frozen":
      next.frozenRows = op.rows;
      return { doc: next, inverse: [{ type: "set_frozen", rows: sheet.frozenRows ?? 0 }] };
    case "set_grid":
      next.rows = op.rows;
      next.cols = op.cols;
      return { doc: next, inverse: [{ type: "set_grid", ...grid }] };
    default:
      throw foreign(op, "spreadsheet");
  }
}

function applyNotes(book: Notebook, op: Op): ApplyResult {
  const next: Notebook = structuredClone(book);
  const indexOf = (id: string) => next.notes.findIndex((n) => n.id === id);

  switch (op.type) {
    case "add_note": {
      if (indexOf(op.id) >= 0) throw new OpError(`note ${op.id} exists`);
      const { type: _t, ...note } = op;
      next.notes.unshift(note);
      return { doc: next, inverse: [{ type: "delete_note", id: op.id }] };
    }
    case "set_note": {
      const n = next.notes[indexOf(op.id)];
      if (!n) throw new OpError(`unknown note ${op.id}`);
      const inverse: Op & { type: "set_note" } = { type: "set_note", id: op.id };
      if (op.title !== undefined) [inverse.title, n.title] = [n.title, op.title];
      if (op.body !== undefined) [inverse.body, n.body] = [n.body, op.body];
      if (op.pinned !== undefined) [inverse.pinned, n.pinned] = [n.pinned ?? false, op.pinned];
      if (op.tags !== undefined) [inverse.tags, n.tags] = [n.tags ?? [], op.tags];
      if (op.color !== undefined) {
        inverse.color = n.color ?? null;
        if (op.color === null) delete n.color;
        else n.color = op.color;
      }
      return { doc: next, inverse: [inverse] };
    }
    case "delete_note": {
      const index = indexOf(op.id);
      if (index < 0) throw new OpError(`unknown note ${op.id}`);
      const [note] = next.notes.splice(index, 1);
      return { doc: next, inverse: [{ type: "restore_note", note: note!, index }] };
    }
    case "restore_note":
      if (indexOf(op.note.id) >= 0) throw new OpError(`note ${op.note.id} exists`);
      next.notes.splice(Math.min(op.index, next.notes.length), 0, op.note);
      return { doc: next, inverse: [{ type: "delete_note", id: op.note.id }] };
    default:
      throw foreign(op, "notebook");
  }
}

function applyBoard(board: Board, op: Op): ApplyResult {
  const next: Board = structuredClone(board);
  const nodeAt = (id: string) => next.nodes.findIndex((n) => n.id === id);
  const edgeAt = (id: string) => next.edges.findIndex((e) => e.id === id);
  /** Applies optional/nullable fields onto an object, returning the previous values (null where absent). */
  const patch = (target: Record<string, unknown>, fields: Record<string, unknown>) => {
    const prev: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      prev[k] = target[k] ?? null;
      if (v === null) delete target[k];
      else target[k] = v;
    }
    return prev;
  };

  switch (op.type) {
    case "add_node": {
      if (nodeAt(op.id) >= 0) throw new OpError(`node ${op.id} exists`);
      const { type: _t, id, shape: requested, ...fields } = op;
      // Furniture is always a fixture node, and on a floor plan a "table" means furniture, not a database table.
      let shape = fields.fixture ? "fixture" : requested;
      if (board.template === "blueprint" && shape === "table") {
        shape = "fixture";
        fields.fixture = "table";
        delete fields.fields;
      }
      const d = nodeDefaults(shape, fields.fields, fields.fixture ?? undefined);
      // Without a position, new nodes line up to the right of what is already there.
      const right = next.nodes.length ? Math.max(...next.nodes.map((n) => n.x + n.w)) + 60 : 0;
      const top = next.nodes.length ? Math.min(...next.nodes.map((n) => n.y)) : 0;
      const node: BoardNode = { id, shape, x: right, y: top, text: "", ...d };
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) (node as Record<string, unknown>)[k] = v;
      next.nodes.push(node);
      return { doc: next, inverse: [{ type: "delete_node", id }] };
    }
    case "set_node": {
      const node = next.nodes[nodeAt(op.id)];
      if (!node) throw new OpError(`unknown node ${op.id}`);
      const { type: _t, id, ...fields } = op;
      const prev = patch(node as Record<string, unknown>, fields);
      // Required fields can't be cleared, so their "previous null" never happens; drop nulls for them.
      for (const k of ["shape", "x", "y", "w", "h", "text", "fields"]) if (prev[k] === null) delete prev[k];
      if (prev.rotate === null) prev.rotate = 0;
      return { doc: next, inverse: [{ type: "set_node", id, ...prev }] };
    }
    case "delete_node": {
      const index = nodeAt(op.id);
      if (index < 0) throw new OpError(`unknown node ${op.id}`);
      const [node] = next.nodes.splice(index, 1);
      const edges = next.edges.filter((e) => e.from === op.id || e.to === op.id);
      next.edges = next.edges.filter((e) => e.from !== op.id && e.to !== op.id);
      return { doc: next, inverse: [{ type: "restore_node", node: node!, index, edges }] };
    }
    case "restore_node": {
      if (nodeAt(op.node.id) >= 0) throw new OpError(`node ${op.node.id} exists`);
      next.nodes.splice(Math.min(op.index, next.nodes.length), 0, op.node);
      for (const e of op.edges) if (edgeAt(e.id) < 0) next.edges.push(e);
      return { doc: next, inverse: [{ type: "delete_node", id: op.node.id }] };
    }
    case "add_edge": {
      if (edgeAt(op.id) >= 0) throw new OpError(`edge ${op.id} exists`);
      if (nodeAt(op.from) < 0 || nodeAt(op.to) < 0) throw new OpError(`edge ${op.id} connects unknown nodes`);
      const { type: _t, ...edge } = op;
      next.edges.push(edge as BoardEdge);
      return { doc: next, inverse: [{ type: "delete_edge", id: op.id }] };
    }
    case "set_edge": {
      const edge = next.edges[edgeAt(op.id)];
      if (!edge) throw new OpError(`unknown edge ${op.id}`);
      const { type: _t, id, ...fields } = op;
      const prev = patch(edge as Record<string, unknown>, fields);
      if (prev.dashed === null) prev.dashed = false;
      return { doc: next, inverse: [{ type: "set_edge", id, ...prev }] };
    }
    case "delete_edge": {
      const index = edgeAt(op.id);
      if (index < 0) throw new OpError(`unknown edge ${op.id}`);
      const [edge] = next.edges.splice(index, 1);
      return { doc: next, inverse: [{ type: "restore_edge", edge: edge!, index }] };
    }
    case "restore_edge":
      if (edgeAt(op.edge.id) >= 0) throw new OpError(`edge ${op.edge.id} exists`);
      next.edges.splice(Math.min(op.index, next.edges.length), 0, op.edge);
      return { doc: next, inverse: [{ type: "delete_edge", id: op.edge.id }] };
    case "add_stroke":
      if (next.strokes.some((s) => s.id === op.stroke.id)) throw new OpError(`stroke ${op.stroke.id} exists`);
      next.strokes.push(op.stroke);
      return { doc: next, inverse: [{ type: "delete_stroke", id: op.stroke.id }] };
    case "delete_stroke": {
      const index = next.strokes.findIndex((s) => s.id === op.id);
      if (index < 0) throw new OpError(`unknown stroke ${op.id}`);
      const [stroke] = next.strokes.splice(index, 1);
      return { doc: next, inverse: [{ type: "add_stroke", stroke: stroke! }] };
    }
    case "auto_layout":
    case "set_positions": {
      const positions = op.type === "auto_layout" ? layoutBoard(board, op.direction, op.nodeIds) : op.positions;
      const prev: Record<string, { x: number; y: number }> = {};
      for (const [id, p] of Object.entries(positions)) {
        const node = next.nodes[nodeAt(id)];
        if (!node) continue;
        prev[id] = { x: node.x, y: node.y };
        node.x = p.x;
        node.y = p.y;
      }
      return { doc: next, inverse: [{ type: "set_positions", positions: prev }] };
    }
    case "set_board": {
      const prev = next.template ?? null;
      if (op.template === null) delete next.template;
      else if (op.template !== undefined) next.template = op.template;
      return { doc: next, inverse: [{ type: "set_board", template: prev }] };
    }
    default:
      throw foreign(op, "board");
  }
}
