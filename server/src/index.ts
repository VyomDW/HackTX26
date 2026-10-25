import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClientMessage } from "@hacktx/shared";
import { env } from "./env";
import { getRoom, type Room } from "./rooms/room";
import { transcribe } from "./integrations/voice";

const app = Fastify({ logger: true });
const generatedImageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/generated");

await app.register(cors, { origin: env.clientOrigin });
// Uploaded images travel inline as data URLs (downscaled in the browser), so allow larger frames.
await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });

app.get("/health", async () => ({ ok: true }));

/** Locally saved, SerpApi-discovered image assets; filenames are restricted to cache-generated names. */
app.get<{ Params: { filename: string } }>("/generated/:filename", async (req, reply) => {
  if (!/^[a-f0-9]{64}\.(webp|png|jpg)$/.test(req.params.filename)) return reply.code(404).send({ error: "not found" });
  try {
    const image = await readFile(path.join(generatedImageDir, req.params.filename));
    const contentType = req.params.filename.endsWith(".png") ? "image/png" : req.params.filename.endsWith(".jpg") ? "image/jpeg" : "image/webp";
    return reply.type(contentType).header("Cache-Control", "public, max-age=31536000, immutable").send(image);
  } catch {
    return reply.code(404).send({ error: "not found" });
  }
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
        room = getRoom(msg.roomId);
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
