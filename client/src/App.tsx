import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MicButton } from "@/components/MicButton";
import { SlideView } from "@/components/SlideView";
import { useRoomSocket } from "@/lib/socket";
import { useDeck } from "@/store/deck";

const roomId = new URLSearchParams(location.search).get("room") ?? "demo";

export default function App() {
  const userId = useMemo(() => `u-${Math.random().toString(36).slice(2, 8)}`, []);
  const send = useRoomSocket(roomId, userId);
  const { deck, history, users, aiStatus } = useDeck();
  const [text, setText] = useState("");

  const undone = new Set(history.map((h) => h.undoes).filter(Boolean));
  const lastAiOp = [...history]
    .reverse()
    .find((h) => h.actor === "ai" && !h.undoes && !undone.has(h.opId) && h.op.type !== "focus" && h.op.type !== "set_image_url");

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Room {roomId}</h1>
        <span className="text-sm text-muted-foreground">
          {users.length} online · AI {aiStatus}
        </span>
      </header>

      <main className="flex flex-1 flex-col gap-4">
        {deck.slides.length === 0 && (
          <p className="text-muted-foreground">No slides yet. Ask the AI for something.</p>
        )}
        {deck.slides.map((slide) => (
          <SlideView key={slide.id} slide={slide} />
        ))}
      </main>

      <form
        className="sticky bottom-4 flex gap-2 rounded-lg border bg-background p-2 shadow"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          send({ type: "prompt", text });
          setText("");
        }}
      >
        <input
          className="flex-1 bg-transparent px-2 outline-none"
          placeholder="Make a pitch about sustainable coffee…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <MicButton roomId={roomId} userId={userId} />
        <Button type="button" variant="outline" disabled={!lastAiOp} onClick={() => lastAiOp && send({ type: "undo", opId: lastAiOp.opId })}>
          Undo
        </Button>
        <Button type="submit">Send</Button>
      </form>
    </div>
  );
}
