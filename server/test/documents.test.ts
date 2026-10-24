import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOp, emptySheet, emptyTextDoc, emptyNotebook, evaluateSheet, formatValue, type Document, type Op } from "@hacktx/shared";

/** Applies ops in order, then checks that applying all inverses (newest first) restores the start. */
function roundTrip(start: Document, ops: Op[]) {
  let doc = start;
  const inverses: Op[][] = [];
  for (const op of ops) {
    const r = applyOp(doc, op);
    doc = r.doc;
    inverses.push(r.inverse);
  }
  let back = doc;
  for (const inv of inverses.reverse()) for (const op of inv) back = applyOp(back, op).doc;
  assert.deepEqual(back, start, "inverses restore the original");
  return doc;
}

test("formulas: arithmetic, ranges, functions, errors and cycles", () => {
  const cells = (o: Record<string, string>) => ({ cells: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }])) });
  const v = evaluateSheet(
    cells({
      A1: "10", A2: "$1,200", A3: "15%", A4: "=SUM(A1:A3)", A5: "=AVERAGE(A1,A2)", A6: "=IF(A4>100,\"big\",\"small\")",
      B1: "=1/0", B2: "=B3", B3: "=B2", B4: "=ROUND(2/3, 2)", B5: "=SUMIF(A1:A3,\">5\")", B6: "=\"Total: \"&A1*2",
      C1: "=COUNTIF(A1:A3,\"<100\")", C2: "=MAX(A1:A3)-MIN(A1:A3)", C3: "=nope(1)", C4: "=2^3*-1", C5: "=50%*A1",
    }),
  );
  assert.equal(v.get("A4"), 1210.15);
  assert.equal(v.get("A5"), 605);
  assert.equal(v.get("A6"), "big");
  assert.equal(String(v.get("B1")), "#DIV/0!");
  assert.equal(String(v.get("B2")), "#REF!");
  assert.equal(v.get("B4"), 0.67);
  assert.equal(v.get("B5"), 1210);
  assert.equal(v.get("B6"), "Total: 20");
  assert.equal(v.get("C1"), 2);
  assert.equal(v.get("C2"), 1199.85);
  assert.equal(String(v.get("C3")), "#NAME?");
  assert.equal(v.get("C4"), -8);
  assert.equal(v.get("C5"), 5);
  assert.equal(formatValue(1234.5, { format: "currency" }), "$1,234.50");
  assert.equal(formatValue(0.125, { format: "percent" }), "12.5%");
});

test("sheet ops round-trip through their inverses", () => {
  const filled = applyOp(emptySheet("s"), {
    type: "set_cells",
    cells: { A1: "Name", B1: "Score", A2: "Bo", B2: "3", A3: "Al", B3: "9", A4: "Cy", B4: "5", D1: "keep" },
  }).doc;
  const end = roundTrip(filled, [
    { type: "set_cell_style", range: "A1:B1", style: { bold: true, fill: "#eee" } },
    { type: "sort_range", range: "A1:B4", byCol: "B", desc: true, header: true },
    { type: "insert_rows", at: 1, count: 2 },
    { type: "delete_cols", at: 2, count: 1 },
    { type: "set_col_width", col: "A", width: 200 },
    { type: "add_chart", id: "c1", chartType: "bar", range: "A1:B6" },
    { type: "set_cells", cells: { Z200: "far away", A1: null } },
    { type: "delete_rows", at: 0, count: 1 },
  ]);
  assert.ok(end.kind === "sheet");
  const sorted = applyOp(filled, { type: "sort_range", range: "A1:B4", byCol: "B", desc: true, header: true }).doc;
  assert.ok(sorted.kind === "sheet");
  assert.deepEqual(["A2", "A3", "A4"].map((a) => sorted.cells[a]?.v), ["Al", "Cy", "Bo"]);
});

test("document block ops round-trip", () => {
  roundTrip(emptyTextDoc("d"), [
    { type: "insert_block", id: "b1", blockType: "h1", text: "Plan" },
    { type: "insert_block", id: "b2", blockType: "p", text: "Intro" },
    { type: "insert_block", id: "b0", afterId: null, blockType: "callout", text: "Draft" },
    { type: "set_block", id: "b2", text: "**Better** intro", blockType: "quote", align: "center" },
    { type: "move_block", id: "b0", afterId: "b2" },
    { type: "delete_block", id: "b1" },
    { type: "set_title", title: "Q3 plan" },
  ]);
});

test("notes ops round-trip and new notes go to the top", () => {
  const end = roundTrip(emptyNotebook("n"), [
    { type: "add_note", id: "n1", title: "A", body: "- [ ] one" },
    { type: "add_note", id: "n2", title: "B", body: "", tags: ["x"] },
    { type: "set_note", id: "n1", pinned: true, color: "#fef3c7", body: "- [x] one" },
    { type: "delete_note", id: "n2" },
  ]);
  assert.ok(end.kind === "notes");
});

test("ops for another kind of file are rejected", () => {
  assert.throws(() => applyOp(emptyTextDoc("d"), { type: "set_cells", cells: { A1: "1" } }), /does not apply/);
});
