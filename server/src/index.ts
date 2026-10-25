import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ClientMessage } from "@hacktx/shared";
import { env } from "./env";
import { deleteRoom, getRoom, listRooms, type Room } from "./rooms/room";
import { removeSaved } from "./rooms/store";
import { transcribe, transcribeTurns } from "./integrations/voice";
import { listenerFor } from "./rooms/listen";
import { IMAGE_DIR } from "./integrations/image";
import { listMedia, mediaEnabled, mediaFile, removeMedia, startMedia, type MediaKind, type MediaOptions } from "./integrations/media";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";

const app = Fastify({ logger: true });

await app.register(cors, { origin: env.clientOrigin });
// Uploaded images travel inline as data URLs (downscaled in the browser), so allow larger frames.
await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });

app.get("/health", async () => ({ ok: true }));

/** AI-generated images, by the random file name generateImage chose (nothing else in the folder is reachable). */
app.get<{ Params: { file: string } }>("/images/:file", async (req, reply) => {
  const { file } = req.params;
  if (!/^[0-9a-f-]{36}\.(webp|png|jpg)$/.test(file)) return reply.code(404).send();
  const full = path.join(IMAGE_DIR, file);
  if (!existsSync(full)) return reply.code(404).send();
  reply.header("cache-control", "public, max-age=31536000, immutable");
  return reply.type(file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") ? "image/jpeg" : "image/webp").send(createReadStream(full));
});

/** Media studio: every music and video generation, newest first, and whether a Replicate key is set. */
app.get("/media", async () => ({ enabled: mediaEnabled(), jobs: await listMedia() }));

app.post<{ Body: { kind?: string; prompt?: string; duration?: number; aspectRatio?: string } }>("/media", async (req, reply) => {
  const { kind, prompt, duration, aspectRatio } = req.body ?? {};
  if (!mediaEnabled()) return reply.code(503).send({ error: "Add REPLICATE_API_TOKEN to server/.env to generate media." });
  if (kind !== "music" && kind !== "video") return reply.code(400).send({ error: "kind must be music or video" });
  const text = prompt?.trim();
  if (!text || text.length > 1000) return reply.code(400).send({ error: "Describe what to make (up to 1000 characters)." });
  const options: MediaOptions = {
    duration: duration === 10 ? 10 : 5,
    aspectRatio: aspectRatio === "9:16" || aspectRatio === "1:1" ? aspectRatio : "16:9",
  };
  return startMedia(kind as MediaKind, text, options);
});

app.delete<{ Params: { id: string } }>("/media/:id", async (req, reply) =>
  (await removeMedia(req.params.id)) ? { ok: true } : reply.code(404).send({ error: "Nothing to remove (it may still be generating)." }),
);

const MEDIA_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg" };

/** One generated file; ?download=1 saves it instead of playing it. Only names the job itself lists are served. */
app.get<{ Params: { id: string; name: string }; Querystring: { download?: string } }>("/media/:id/:name", async (req, reply) => {
  const full = await mediaFile(req.params.id, req.params.name);
  if (!full || !existsSync(full)) return reply.code(404).send();
  const ext = path.extname(full).slice(1);
  if (req.query.download) reply.header("content-disposition", `attachment; filename="muse-${req.params.name}"`);
  return reply.type(MEDIA_TYPES[ext] ?? "application/octet-stream").send(createReadStream(full));
});

/** The workspace file list for the home screen, most recently edited first. */
app.get("/docs", async () =>
  listRooms()
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      template: r.doc.kind === "board" ? r.doc.template : undefined,
      title: r.doc.title,
      updatedAt: r.updatedAt,
      online: r.members.size,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt),
);

app.delete<{ Params: { id: string } }>("/docs/:id", async (req) => {
  deleteRoom(req.params.id);
  removeSaved(req.params.id);
  return { ok: true };
});

app.addContentTypeParser(/^audio\//, { parseAs: "buffer", bodyLimit: 32 * 1024 * 1024 }, (_req, body, done) => done(null, body));

/**
 * One WAV clip in, transcript out.
 * Push-to-talk (default): the transcript takes the same path as a typed prompt.
 * Listen mode (?mode=listen): an open-mic utterance, which only edits if it holds a real request.
 * `source=call` is the meeting audio someone shares, which may hold several voices.
 */
app.post<{ Params: { roomId: string }; Querystring: { userId?: string; mode?: string; source?: string } }>(
  "/rooms/:roomId/voice",
  async (req, reply) => {
    const { userId, mode, source } = req.query;
    if (!userId || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(400).send({ error: "expected audio body and userId" });
    }
    const mime = req.headers["content-type"] ?? "audio/wav";
    try {
      const room = getRoom(req.params.roomId);
      if (mode === "listen") {
        const fromCall = source === "call";
        const lines = await transcribeTurns(req.body, mime, fromCall);
        const name = [...room.members].find((m) => m.userId === userId)?.name ?? "Guest";
        if (lines.length) listenerFor(room).hear(lines, fromCall ? `${userId}:call` : userId, fromCall ? "On the call" : name);
        return { text: lines.join(" ") };
      }
      const text = await transcribe(req.body, mime);
      if (text) void room.prompt(text, userId);
      return { text };
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: "transcription failed" });
    }
  },
);

app.register(async (scope) => {
  scope.get("/ws", { websocket: true }, (socket) => {
    let room: Room | undefined;
    let member: Parameters<Room["join"]>[0] | undefined;

    socket.on("message", (raw) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = ClientMessage.safeParse(data);
      if (!parsed.success) {
        socket.send(JSON.stringify({ type: "error", message: "invalid message" }));
        return;
      }
      const msg = parsed.data;
      if (msg.type === "join") {
        if (room && member) room.leave(member);
        room = getRoom(msg.roomId, msg.kind);
        member = { socket, userId: msg.userId, name: msg.name };
        room.join(member);
        return;
      }
      if (!room || !member) return;
      if (msg.type === "prompt") void room.prompt(msg.text, member.userId, member.name);
      if (msg.type === "undo") room.undo(msg.opId, member.userId);
      if (msg.type === "undo_turn") room.undoTurn(msg.turnId, member.userId);
      if (msg.type === "stop") room.stop();
      if (msg.type === "ops") room.userOps(msg.ops, member);
      if (msg.type === "undo_mine") room.undoMine(member.userId);
      if (msg.type === "redo_mine") room.redoMine(member.userId);
    });

    socket.on("close", () => {
      if (room && member) room.leave(member);
    });
  });
});

await app.listen({ port: env.port, host: "0.0.0.0" });
