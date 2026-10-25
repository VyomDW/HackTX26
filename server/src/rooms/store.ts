import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Document, Turn } from "@hacktx/shared";
import { z } from "zod";
import type { Room } from "./room";

/**
 * Rooms are saved as one JSON file each so files survive restarts. Undo history is not saved:
 * it holds every uploaded image many times over, and losing undo across a restart is acceptable.
 */
const DIR = path.resolve(process.env.ROOM_DIR || "data/rooms");
const enabled = process.env.ROOM_STORE !== "off";

const Saved = z.object({
  id: z.string(),
  doc: Document,
  turns: z.array(Turn),
  conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
  updatedAt: z.number(),
  /** Account that created the file (missing on files saved before accounts existed). */
  ownerId: z.string().optional(),
  /** Accounts that have the file in their list: the owner and everyone who opened its invite link. */
  access: z.array(z.string()).default([]),
});

const fileOf = (id: string) => path.join(DIR, `${encodeURIComponent(id)}.json`);

export function loadRooms(make: (id: string, kind: Document["kind"]) => Room): Map<string, Room> {
  const rooms = new Map<string, Room>();
  if (!enabled) return rooms;
  mkdirSync(DIR, { recursive: true });
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    try {
      const saved = Saved.parse(JSON.parse(readFileSync(path.join(DIR, file), "utf8")));
      const room = make(saved.id, saved.doc.kind);
      Object.assign(room, { doc: saved.doc, turns: saved.turns, conversation: saved.conversation, updatedAt: saved.updatedAt, ownerId: saved.ownerId, access: new Set(saved.access) });
      rooms.set(saved.id, room);
    } catch (err) {
      console.warn(`[store] skipping unreadable ${file}`, err);
    }
  }
  return rooms;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced write: a burst of AI edits becomes one save. Writes go through a temp file so a crash can't truncate. */
export function scheduleSave(room: Room) {
  room.updatedAt = Date.now();
  if (!enabled || room.deleted) return;
  clearTimeout(timers.get(room.id));
  timers.set(
    room.id,
    setTimeout(() => {
      timers.delete(room.id);
      const data = { id: room.id, doc: room.doc, turns: room.turns, conversation: room.conversation, updatedAt: room.updatedAt, ownerId: room.ownerId, access: [...room.access] };
      try {
        mkdirSync(DIR, { recursive: true });
        const tmp = `${fileOf(room.id)}.tmp`;
        writeFileSync(tmp, JSON.stringify(data));
        renameSync(tmp, fileOf(room.id));
      } catch (err) {
        console.error(`[store] failed to save ${room.id}`, err);
      }
    }, 400),
  );
}

export function removeSaved(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (enabled) rmSync(fileOf(id), { force: true });
}
