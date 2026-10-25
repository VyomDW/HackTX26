import { Studio, emptyStudio } from "./studio";
import { z } from "zod";
import { Board, emptyBoard } from "./board";
import { Deck, emptyDeck } from "./deck";
import { emptyNotebook, Notebook } from "./notes";
import { emptySheet, Sheet } from "./sheet";
import { emptyTextDoc, TextDoc } from "./textdoc";

/** Every file in the workspace is one of these; a room edits exactly one. */
export const DocKind = z.enum(["slides", "doc", "sheet", "notes", "board", "studio"]);
export type DocKind = z.infer<typeof DocKind>;

export const Document = z.discriminatedUnion("kind", [Deck, TextDoc, Sheet, Notebook, Board, Studio]);
export type Document = z.infer<typeof Document>;

export function emptyDocument(kind: DocKind, id: string): Document {
  switch (kind) {
    case "studio": return emptyStudio(id);
    case "slides":
      return emptyDeck(id);
    case "doc":
      return emptyTextDoc(id);
    case "sheet":
      return emptySheet(id);
    case "notes":
      return emptyNotebook(id);
    case "board":
      return emptyBoard(id);
  }
}
