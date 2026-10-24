import { useEffect, useRef, useCallback } from "react";
import { ServerMessage, type ClientMessage } from "@hacktx/shared";
import { useDeck } from "@/store/deck";

const wsUrl = import.meta.env.VITE_WS_URL || `ws://${location.hostname}:8787/ws`;

export function useRoomSocket(roomId: string, userId: string) {
  const ref = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    ref.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", roomId, userId } satisfies ClientMessage));
    ws.onmessage = (ev) => {
      const parsed = ServerMessage.safeParse(JSON.parse(ev.data));
      if (!parsed.success) return;
      const msg = parsed.data;
      const store = useDeck.getState();
      if (msg.type === "snapshot") store.reset(msg.deck, msg.history);
      else if (msg.type === "op") store.receive(msg.envelope);
      else if (msg.type === "presence") store.setUsers(msg.users);
      else if (msg.type === "ai_status") store.setAiStatus(msg.status);
      else if (msg.type === "error") console.error(msg.message);
    };
    return () => ws.close();
  }, [roomId, userId]);

  return useCallback((msg: ClientMessage) => {
    const ws = ref.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);
}
