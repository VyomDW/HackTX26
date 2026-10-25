import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ClientMessage } from "@hacktx/shared";
import { env } from "./env";
import { deleteRoom, getRoom, listRooms, type Room } from "./rooms/room";
import { removeSaved } from "./rooms/store";
import { transcribe } from "./integrations/voice";
import { IMAGE_DIR } from "./integrations/image";
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
  if (!/^[0-9a-f-]{36}\.(webp|png)$/.test(file)) return reply.code(404).send();
  const full = path.join(IMAGE_DIR, file);
  if (!existsSync(full)) return reply.code(404).send();
  reply.header("cache-control", "public, max-age=31536000, immutable");
  return reply.type(file.endsWith(".png") ? "image/png" : "image/webp").send(createReadStream(full));
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

/** Push-to-talk: one WAV clip in, transcript out. The transcript takes the same path as a typed prompt. */
app.post<{ Params: { roomId: string }; Querystring: { userId?: string } }>("/rooms/:roomId/voice", async (req, reply) => {
  const userId = req.query.userId;
  if (!userId || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return reply.code(400).send({ error: "expected audio body and userId" });
  }
  try {
    const text = await transcribe(req.body, req.headers["content-type"] ?? "audio/wav");
    if (text) void getRoom(req.params.roomId).prompt(text, userId);
    return { text };
  } catch (err) {
    req.log.error(err);
    return reply.code(502).send({ error: "transcription failed" });
  }
});

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
