import type { Element, Layout, ShapeKind, StylePatch, UserOp } from "@hacktx/shared";
import { useDeck } from "@/store/deck";
import { commit, currentSlide, selectedElement, useEditor } from "@/store/editor";
import { fileToDataUrl, imageBox, newElementId, nextSlideId, toggleBullets } from "./canvas";

/** Editor commands shared by the toolbar, keyboard shortcuts and drag/drop. */

const CLIP_PREFIX = "hacktx-element:";

const LAYOUT_ROLES: Record<Layout, string[]> = {
  title: ["title", "subtitle"],
  bullets: ["title", "body"],
  "image-left": ["title", "body"],
  "image-full": ["title"],
  quote: ["quote", "attribution"],
  blank: [],
};

export function addSlide(layout: Layout) {
  const { deck } = useDeck.getState();
  const id = nextSlideId(deck);
  const afterId = currentSlide()?.id;
  // Empty placeholders, like "Click to add title" in Slides.
  const placeholders: UserOp[] = LAYOUT_ROLES[layout].map((role) => ({ type: "set_text", slideId: id, elementId: `${id}-${role}`, text: "" }));
  commit({ type: "add_slide", id, layout, afterId }, ...placeholders);
  useEditor.getState().setSlide(id);
}

export function duplicateSlide(slideId: string) {
  const newId = nextSlideId(useDeck.getState().deck);
  commit({ type: "duplicate_slide", slideId, newId });
  useEditor.getState().setSlide(newId);
}

export function deleteSlide(slideId: string) {
  const { slides } = useDeck.getState().deck;
  const i = slides.findIndex((s) => s.id === slideId);
  commit({ type: "delete_slide", slideId });
  const next = slides[i + 1] ?? slides[i - 1];
  useEditor.getState().setSlide(next?.id === slideId ? undefined : next?.id);
}

export function insertText() {
  const slide = currentSlide();
  if (!slide) return;
  const id = newElementId(slide, "text");
  commit({ type: "set_text", slideId: slide.id, elementId: id, text: "", box: { x: 340, y: 300, w: 600, h: 100 } });
  useEditor.getState().edit(id);
}

export function insertShape(shape: ShapeKind) {
  const slide = currentSlide();
  if (!slide) return;
  const id = newElementId(slide, shape);
  const box = shape === "line" || shape === "arrow" ? { x: 440, y: 340, w: 400, h: 40 } : undefined;
  commit({ type: "add_shape", slideId: slide.id, elementId: id, shape, box });
  useEditor.getState().select(id);
}

export async function insertImages(files: Iterable<File>, center?: { x: number; y: number }) {
  const slide = currentSlide();
  if (!slide) return;
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const { url, width, height } = await fileToDataUrl(file);
      const id = newElementId(slide, "img");
      commit({ type: "add_image", slideId: slide.id, elementId: id, prompt: file.name || "Uploaded image", url, box: imageBox(width, height, center) });
      useEditor.getState().select(id);
      center = center && { x: center.x + 30, y: center.y + 30 };
    } catch {
      useDeck.getState().setError(`Couldn't read ${file.name || "that image"}.`);
    }
  }
}

export function deleteSelected() {
  const sel = selectedElement();
  if (!sel) return;
  commit({ type: "delete_element", slideId: sel.slideId, elementId: sel.element.id });
  useEditor.getState().select(undefined);
}

function pasteElement(element: Element, offset = 24) {
  const slide = currentSlide();
  if (!slide) return;
  const role = element.kind === "image" ? "img" : element.kind === "shape" ? element.shape : "text";
  const copy: Element = { ...structuredClone(element), id: newElementId(slide, role) };
  copy.box = { ...copy.box, x: copy.box.x + offset, y: copy.box.y + offset };
  commit({ type: "insert_element", slideId: slide.id, element: copy, index: slide.elements.length });
  useEditor.getState().select(copy.id);
}

export function duplicateSelected() {
  const sel = selectedElement();
  if (sel) pasteElement(sel.element);
}

export function nudge(dx: number, dy: number) {
  const sel = selectedElement();
  if (!sel) return;
  const { box } = sel.element;
  commit({ type: "set_box", slideId: sel.slideId, elementId: sel.element.id, x: box.x + dx, y: box.y + dy });
}

export function setStyle(style: StylePatch) {
  const sel = selectedElement();
  if (sel) commit({ type: "set_style", slideId: sel.slideId, elementId: sel.element.id, style });
}

export function toggleStyle(key: "bold" | "italic" | "underline" | "strike") {
  const sel = selectedElement();
  if (sel) setStyle({ [key]: !sel.element.style[key] });
}

export function bumpFontSize(delta: number) {
  const sel = selectedElement();
  if (sel) setStyle({ fontSize: Math.max(6, Math.min(400, (sel.element.style.fontSize ?? 24) + delta)) });
}

export function bulletsSelected() {
  const sel = selectedElement();
  if (!sel || sel.element.kind === "image") return;
  commit({ type: "set_text", slideId: sel.slideId, elementId: sel.element.id, text: toggleBullets(sel.element.text ?? "") });
}

export function arrange(where: "front" | "back" | "forward" | "backward") {
  const sel = selectedElement();
  const slide = currentSlide();
  if (!sel || !slide) return;
  const from = slide.elements.findIndex((e) => e.id === sel.element.id);
  const last = slide.elements.length - 1;
  const toIndex = { front: last, back: 0, forward: Math.min(last, from + 1), backward: Math.max(0, from - 1) }[where];
  if (toIndex !== from) commit({ type: "reorder_element", slideId: slide.id, elementId: sel.element.id, toIndex });
}

/** Copy writes the element to the system clipboard so it can be pasted into another tab or room. */
export function copySelected(data: DataTransfer) {
  const sel = selectedElement();
  if (!sel) return false;
  data.setData("text/plain", CLIP_PREFIX + JSON.stringify(sel.element));
  return true;
}

export function paste(data: DataTransfer) {
  const files = [...data.files].filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    void insertImages(files);
    return true;
  }
  const text = data.getData("text/plain");
  if (text.startsWith(CLIP_PREFIX)) {
    try {
      pasteElement(JSON.parse(text.slice(CLIP_PREFIX.length)) as Element);
      return true;
    } catch {
      return false;
    }
  }
  const slide = currentSlide();
  if (!text.trim() || !slide) return false;
  const id = newElementId(slide, "text");
  commit({ type: "set_text", slideId: slide.id, elementId: id, text, box: { x: 240, y: 260, w: 800, h: 200 } });
  useEditor.getState().select(id);
  return true;
}

export const undoMine = () => useEditor.getState().send({ type: "undo_mine" });
export const redoMine = () => useEditor.getState().send({ type: "redo_mine" });
