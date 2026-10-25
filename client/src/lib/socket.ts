import { useEffect, useRef, useCallback, useState } from "react";
import { ServerMessage, type ClientMessage, type DocKind } from "@hacktx/shared";
import { useDeck } from "@/store/deck";
import { useVoice } from "@/store/voice";

const wsUrl = import.meta.env.VITE_WS_URL || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

/** Joins the room and keeps the store in sync; reconnects with backoff if the server drops. */
export function useRoomSocket(roomId: string, userId: string, name?: string, kind?: DocKind) {
  const ref = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      ref.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "join", roomId, userId, name, kind } satisfies ClientMessage));
      };
      ws.onmessage = (ev) => {
        const parsed = ServerMessage.safeParse(JSON.parse(ev.data));
        if (!parsed.success) return;
        const msg = parsed.data;
        const store = useDeck.getState();
        if (msg.type === "snapshot") store.reset(msg.doc, msg.history, msg.turns);
        else if (msg.type === "op") store.receive(msg.envelope);
        else if (msg.type === "turn") store.addTurn(msg.turn);
        else if (msg.type === "presence") store.setUsers(msg.users);
        else if (msg.type === "ai_status") store.setAiStatus(msg.status);
        else if (msg.type === "error") store.setError(msg.message);
        else if (msg.type === "caption") useVoice.getState().addCaption(msg.caption);
      };
      ws.onclose = () => {
        setConnected(false);
        useDeck.getState().setAiStatus("idle");
        if (!closed) retry = setTimeout(connect, Math.min(500 * 2 ** attempt++, 8000));
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ref.current?.close();
    };
  }, [roomId, userId, name, kind]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = ref.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { send, connected };
}
