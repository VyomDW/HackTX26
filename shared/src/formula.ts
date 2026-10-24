import { addr, parseAddr, parseRange, type CellStyle, type Sheet } from "./sheet";

/** A small spreadsheet formula engine: arithmetic, comparisons, &, cell refs, ranges and common functions. */

export type Scalar = number | string | boolean | null;
export class FormulaError {
  constructor(readonly code: string) {}
  toString() {
    return this.code;
  }
}
export type Value = Scalar | FormulaError;
type Arg = Value | Value[];

const err = (code: string) => new FormulaError(code);
export const isError = (v: unknown): v is FormulaError => v instanceof FormulaError;

/** Interprets typed input: numbers (with $ , %), TRUE/FALSE, otherwise text. */
export function literal(raw: string): Scalar {
  const t = raw.trim();
  if (t === "") return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  const m = /^(-)?\$?(-)?([\d,]*\.?\d+)(%)?$/.exec(t);
  if (m && !/,,/.test(m[3]!)) {
    const n = Number(m[3]!.replace(/,/g, "")) * (m[1] || m[2] ? -1 : 1);
    return m[4] ? n / 100 : n;
  }
  return raw;
}

// ---- Tokenizer ----

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string }
  | { t: "range"; v: string }
  | { t: "fn"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(rest))) {
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw err("#ERROR!");
      out.push({ t: "str", v: src.slice(i + 1, end) });
      i = end + 1;
    } else if ((m = /^\$?[A-Za-z]{1,3}\$?\d+:\$?[A-Za-z]{1,3}\$?\d+/.exec(rest))) {
      out.push({ t: "range", v: m[0].replace(/\$/g, "").toUpperCase() });
      i += m[0].length;
    } else if ((m = /^[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/.exec(rest))) {
      out.push({ t: "fn", v: m[0].toUpperCase() });
      i += m[0].length;
    } else if ((m = /^(TRUE|FALSE)\b/i.exec(rest))) {
      out.push({ t: "bool", v: m[0].toUpperCase() === "TRUE" });
      i += m[0].length;
    } else if ((m = /^\$?[A-Za-z]{1,3}\$?\d+/.exec(rest))) {
      out.push({ t: "ref", v: m[0].replace(/\$/g, "").toUpperCase() });
      i += m[0].length;
    } else if ((m = /^(<=|>=|<>|[-+*/^&=<>%])/.exec(rest))) {
      out.push({ t: "op", v: m[0] });
      i += m[0].length;
    } else if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ t: ch } as Tok);
      i++;
    } else if (ch === ";") {
      out.push({ t: "," });
      i++;
    } else throw err("#ERROR!");
  }
  return out;
}

// ---- Evaluator ----

const num = (v: Value): number | FormulaError => {
  if (isError(v)) return v;
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  const l = literal(v);
  return typeof l === "number" ? l : err("#VALUE!");
};
const str = (v: Value): string => (v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
const truthy = (v: Value) => (typeof v === "string" ? v !== "" : !!v);
const flat = (args: Arg[]): Value[] => args.flatMap((a) => (Array.isArray(a) ? a : [a]));
const nums = (args: Arg[]): number[] | FormulaError => {
  const out: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const v of a) {
        if (isError(v)) return v;
        if (typeof v === "number") out.push(v);
      }
    } else {
      const n = num(a);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
};

/** Criteria like ">10", "<>x", "apple" for SUMIF/COUNTIF. */
function matches(v: Value, criteria: Value): boolean {
  const c = str(criteria);
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(c)!;
  const op = m[1] ?? "=";
  const target = literal(m[2]!);
  const a = typeof target === "number" ? num(v) : str(v).toLowerCase();
  const b = typeof target === "number" ? target : str(target).toLowerCase();
  if (isError(a)) return false;
  switch (op) {
    case "<":
      return a < b;
    case ">":
      return a > b;
    case "<=":
      return a <= b;
    case ">=":
      return a >= b;
    case "<>":
      return a !== b;
    default:
      return a === b;
  }
}

const FUNCTIONS: Record<string, (args: Arg[]) => Value> = {
  SUM: (a) => {
    const n = nums(a);
    return isError(n) ? n : n.reduce((x, y) => x + y, 0);
  },
  AVERAGE: (a) => {
    const n = nums(a);
    return isError(n) ? n : n.length ? n.reduce((x, y) => x + y, 0) / n.length : err("#DIV/0!");
  },
  MIN: (a) => {
    const n = nums(a);
    return isError(n) ? n : n.length ? Math.min(...n) : 0;
  },
  MAX: (a) => {
    const n = nums(a);
    return isError(n) ? n : n.length ? Math.max(...n) : 0;
  },
  MEDIAN: (a) => {
    const n = nums(a);
    if (isError(n)) return n;
    if (!n.length) return err("#NUM!");
    const s = [...n].sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  },
  PRODUCT: (a) => {
    const n = nums(a);
    return isError(n) ? n : n.reduce((x, y) => x * y, 1);
  },
  COUNT: (a) => flat(a).filter((v) => typeof v === "number").length,
  COUNTA: (a) => flat(a).filter((v) => v !== null && v !== "").length,
  ROUND: ([x, d]) => {
    const n = num(x as Value);
    const p = num((d as Value) ?? 0);
    if (isError(n)) return n;
    if (isError(p)) return p;
    const f = 10 ** p;
    return Math.round(n * f) / f;
  },
  ABS: ([x]) => {
    const n = num(x as Value);
    return isError(n) ? n : Math.abs(n);
  },
  SQRT: ([x]) => {
    const n = num(x as Value);
    return isError(n) ? n : n < 0 ? err("#NUM!") : Math.sqrt(n);
  },
  POWER: ([x, y]) => {
    const a = num(x as Value);
    const b = num(y as Value);
    return isError(a) ? a : isError(b) ? b : a ** b;
  },
  INT: ([x]) => {
    const n = num(x as Value);
    return isError(n) ? n : Math.floor(n);
  },
  MOD: ([x, y]) => {
    const a = num(x as Value);
    const b = num(y as Value);
    return isError(a) ? a : isError(b) ? b : b === 0 ? err("#DIV/0!") : ((a % b) + b) % b;
  },
  PI: () => Math.PI,
  IF: ([c, a, b]) => (isError(c as Value) ? (c as Value) : truthy(c as Value) ? ((a as Value) ?? true) : ((b as Value) ?? false)),
  IFERROR: ([v, alt]) => (isError(v as Value) ? ((alt as Value) ?? "") : (v as Value)),
  AND: (a) => flat(a).every(truthy),
  OR: (a) => flat(a).some(truthy),
  NOT: ([v]) => !truthy(v as Value),
  CONCAT: (a) => flat(a).map(str).join(""),
  CONCATENATE: (a) => flat(a).map(str).join(""),
  LEN: ([v]) => str(v as Value).length,
  UPPER: ([v]) => str(v as Value).toUpperCase(),
  LOWER: ([v]) => str(v as Value).toLowerCase(),
  SUMIF: ([range, criteria, sumRange]) => {
    const r = Array.isArray(range) ? range : [range as Value];
    const s = Array.isArray(sumRange) ? sumRange : r;
    let total = 0;
    r.forEach((v, i) => {
      if (matches(v, criteria as Value)) {
        const n = num(s[i] ?? null);
        if (!isError(n)) total += n;
      }
    });
    return total;
  },
  COUNTIF: ([range, criteria]) => (Array.isArray(range) ? range : [range as Value]).filter((v) => matches(v, criteria as Value)).length,
};
FUNCTIONS.AVG = FUNCTIONS.AVERAGE!;

export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS);

/** Evaluates every non-empty cell of a sheet, resolving references lazily and flagging cycles. */
export function evaluateSheet(sheet: Pick<Sheet, "cells">): Map<string, Value> {
  const cache = new Map<string, Value>();
  const visiting = new Set<string>();

  const cellValue = (a: string): Value => {
    if (cache.has(a)) return cache.get(a)!;
    const raw = sheet.cells[a]?.v ?? "";
    if (!raw.startsWith("=")) {
      const v = literal(raw);
      cache.set(a, v);
      return v;
    }
    if (visiting.has(a)) return err("#REF!");
    visiting.add(a);
    let v: Value;
    try {
      v = evalFormula(raw.slice(1));
    } catch (e) {
      v = isError(e) ? e : err("#ERROR!");
    }
    visiting.delete(a);
    if (typeof v === "number" && !Number.isFinite(v)) v = err("#NUM!");
    cache.set(a, v);
    return v;
  };

  const rangeValues = (r: string): Value[] => {
    const b = parseRange(r);
    if (!b) throw err("#REF!");
    const out: Value[] = [];
    for (let row = b.r0; row <= b.r1; row++) for (let col = b.c0; col <= b.c1; col++) out.push(cellValue(addr(row, col)));
    return out;
  };

  function evalFormula(src: string): Value {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v: string) => {
      const t = toks[p];
      return t?.t === "op" && t.v === v;
    };

    const binary = (next: () => Value, ops: string[], fn: (op: string, a: Value, b: Value) => Value) => (): Value => {
      let left = next();
      while (ops.some(isOp)) {
        const op = (toks[p++] as { v: string }).v;
        left = fn(op, left, next());
      }
      return left;
    };
    const arith = (op: string, a: Value, b: Value): Value => {
      const x = num(a);
      const y = num(b);
      if (isError(x)) return x;
      if (isError(y)) return y;
      if (op === "+") return x + y;
      if (op === "-") return x - y;
      if (op === "*") return x * y;
      if (op === "/") return y === 0 ? err("#DIV/0!") : x / y;
      return x ** y;
    };

    const primary = (): Value | Value[] => {
      const t = toks[p++];
      if (!t) throw err("#ERROR!");
      if (t.t === "num" || t.t === "str" || t.t === "bool") return t.v;
      if (t.t === "ref") {
        if (!parseAddr(t.v)) throw err("#REF!");
        return cellValue(t.v);
      }
      if (t.t === "range") return rangeValues(t.v);
      if (t.t === "(") {
        const v = comparison();
        if (peek()?.t !== ")") throw err("#ERROR!");
        p++;
        return v;
      }
      if (t.t === "fn") {
        const fn = FUNCTIONS[t.v];
        p++; // (
        const args: Arg[] = [];
        if (peek()?.t !== ")") {
          for (;;) {
            args.push(argument());
            if (peek()?.t === ",") p++;
            else break;
          }
        }
        if (peek()?.t !== ")") throw err("#ERROR!");
        p++;
        if (!fn) return err("#NAME?");
        return fn(args);
      }
      throw err("#ERROR!");
    };
    /** Function arguments may be whole ranges; everywhere else a range collapses to its first value. */
    const argument = (): Arg => {
      const t = peek();
      const n = toks[p + 1];
      if (t?.t === "range" && (n === undefined || n.t === "," || n.t === ")")) {
        p++;
        return rangeValues(t.v);
      }
      return comparison();
    };
    const scalar = (v: Value | Value[]): Value => (Array.isArray(v) ? (v[0] ?? null) : v);
    const postfix = (): Value => {
      let v = scalar(primary());
      while (isOp("%")) {
        p++;
        const n = num(v);
        v = isError(n) ? n : n / 100;
      }
      return v;
    };
    const unary = (): Value => {
      if (isOp("-")) {
        p++;
        const n = num(unary());
        return isError(n) ? n : -n;
      }
      if (isOp("+")) {
        p++;
        return unary();
      }
      return postfix();
    };
    const power = binary(unary, ["^"], arith);
    const mult = binary(power, ["*", "/"], arith);
    const add = binary(mult, ["+", "-"], arith);
    const concat = binary(add, ["&"], (_op, a, b) => (isError(a) ? a : isError(b) ? b : str(a) + str(b)));
    const comparison: () => Value = binary(concat, ["=", "<>", "<", ">", "<=", ">="], (op, a, b) => {
      if (isError(a)) return a;
      if (isError(b)) return b;
      const both = typeof a === "number" && typeof b === "number";
      const x = both ? a : str(a).toLowerCase();
      const y = both ? b : str(b).toLowerCase();
      return { "=": x === y, "<>": x !== y, "<": x < y, ">": x > y, "<=": x <= y, ">=": x >= y }[op]!;
    });

    const v = comparison();
    if (p < toks.length) throw err("#ERROR!");
    return v;
  }

  for (const a of Object.keys(sheet.cells)) cellValue(a);
  return cache;
}

/** Display text for a computed value under a cell's number format. */
export function formatValue(v: Value | undefined, style?: CellStyle): string {
  if (v === undefined || v === null) return "";
  if (isError(v)) return v.code;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  const d = style?.decimals;
  switch (style?.format) {
    case "currency":
      return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
    case "percent":
      return `${(v * 100).toLocaleString("en-US", { minimumFractionDigits: d ?? 0, maximumFractionDigits: d ?? 1 })}%`;
    case "number":
      return v.toLocaleString("en-US", { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
    case "text":
      return String(v);
    default:
      if (d !== undefined) return v.toFixed(d);
      return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  }
}
