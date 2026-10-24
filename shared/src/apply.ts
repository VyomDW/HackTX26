import type { Deck, Element, Slide } from "./deck";
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
      if (existing && existing.kind !== "text") throw new OpError(`${op.elementId} is not text`);
      if (existing) {
        const prev = existing.text;
        existing.text = op.text;
        return { deck: next, inverse: [{ ...op, text: prev }] };
      }
      slide.elements.push({ id: op.elementId, kind: "text", text: op.text });
      return { deck: next, inverse: [{ type: "delete_element", slideId: op.slideId, elementId: op.elementId }] };
    }
    case "add_image": {
      const slide = findSlide(next, op.slideId);
      if (slide.elements.some((e) => e.id === op.elementId)) throw new OpError(`element ${op.elementId} exists`);
      slide.elements.push({ id: op.elementId, kind: "image", prompt: op.prompt });
      return { deck: next, inverse: [{ type: "delete_element", slideId: op.slideId, elementId: op.elementId }] };
    }
    case "set_image_url": {
      const el = findSlide(next, op.slideId).elements.find((e) => e.id === op.elementId);
      if (!el || el.kind !== "image") throw new OpError(`unknown image ${op.elementId}`);
      el.url = op.url;
      // Image arrival is not user-undoable on its own; undoing add_image removes it.
      return { deck: next, inverse: [{ type: "noop" }] };
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
