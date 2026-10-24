import { defaultPlacement, type Box, type Deck, type Element, type Slide, type Style, type StylePatch } from "./deck";
import type { Op } from "./ops";

export class OpError extends Error {}

export interface ApplyResult {
  deck: Deck;
  /** Ops that revert this one, applied in order. */
  inverse: Op[];
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
const place = (slide: Slide, elementId: string, kind: Element["kind"], box?: Box, style?: Style) => {
  const role = elementId.startsWith(`${slide.id}-`) ? elementId.slice(slide.id.length + 1) : elementId;
  const d = defaultPlacement(slide.layout, role, kind, slide.elements.length);
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

/** Pure: returns a new deck plus the inverse ops. Throws OpError when the op cannot apply. */
export function applyOp(deck: Deck, op: Op): ApplyResult {
  const next: Deck = structuredClone(deck);

  switch (op.type) {
    case "add_slide": {
      if (next.slides.some((s) => s.id === op.id)) throw new OpError(`slide ${op.id} exists`);
      const afterIdx = op.afterId ? next.slides.findIndex((s) => s.id === op.afterId) : -1;
      const index = op.afterId && afterIdx >= 0 ? afterIdx + 1 : next.slides.length;
      next.slides.splice(index, 0, { id: op.id, layout: op.layout, elements: [], citations: [] });
      return { deck: next, inverse: [{ type: "delete_slide", slideId: op.id }] };
    }
    case "set_text": {
      const slide = findSlide(next, op.slideId);
      const existing = slide.elements.find((e) => e.id === op.elementId);
      if (!existing) {
        slide.elements.push({ id: op.elementId, kind: "text", text: op.text, ...place(slide, op.elementId, "text", op.box, op.style) });
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
        ...place(slide, op.elementId, "image", op.box, op.style),
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
        ...place(slide, op.elementId, "shape", op.box, op.style),
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
    case "noop":
      return { deck: next, inverse: [{ type: "noop" }] };
  }
}
