import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ClientMessage } from "@hacktx/shared";
import { env } from "./env";
import { getRoom, type Room } from "./rooms/room";

const app = Fastify({ logger: true });

await app.register(cors, { origin: env.clientOrigin });
// Uploaded images travel inline as data URLs (downscaled in the browser), so allow larger frames.
await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });

app.get("/health", async () => ({ ok: true }));

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
