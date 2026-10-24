import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}.ndjson`, import.meta.url));

/** Points callMuse at a recorded response, so tests never hit the network. */
async function roomWith(name: string) {
  const { env } = await import("../src/env");
  env.museFixture = fixture(name);
  const { Room } = await import("../src/rooms/room");
  const room = new Room(`test-${name}-${Math.random()}`);
  const sent: any[] = [];
  room.join({ userId: "u1", socket: { OPEN: 1, readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) } as any });
  return { room, sent };
}

test("a clean recorded response builds the whole deck", async () => {
  const { room } = await roomWith("coffee");
  await room.prompt("Make a pitch about sustainable coffee", "u1");
  assert.deepEqual(room.deck.slides.map((s) => s.id), ["s1", "s2", "s3", "s4", "s5"]);
  assert.equal(room.deck.slides[1]!.elements.length, 2);
});

test("bad lines are skipped and a dropped add_slide is recovered", async () => {
  const { room, sent } = await roomWith("coffee-malformed");
  await room.prompt("Make a pitch about sustainable coffee", "u1");
  assert.deepEqual(room.deck.slides.map((s) => s.id), ["s1", "s2", "s3", "s4", "s5"]);
  const s2 = room.deck.slides[1]!;
  assert.deepEqual(s2.elements.map((e) => e.id), ["s2-title", "s2-body"]);
  assert.ok(!sent.some((m) => m.type === "error"), "no error shown to users");
});

test("undoing a turn reverts every op from that response", async () => {
  const { room } = await roomWith("coffee");
  await room.prompt("Make a pitch about sustainable coffee", "u1");
  room.undoTurn(room.turns[0]!.turnId, "u1");
  assert.equal(room.deck.slides.length, 0);
});

test("a second prompt cancels the first mid-stream", async () => {
  const { room } = await roomWith("coffee");
  const first = room.prompt("first", "u1");
  await new Promise((r) => setTimeout(r, 500));
  const second = room.prompt("second", "u1");
  await Promise.all([first, second]);
  const [t1, t2] = room.turns;
  const fromFirst = room.history.filter((h) => h.envelope.turnId === t1!.turnId).length;
  assert.ok(fromFirst > 0 && fromFirst < 10, `first turn stopped early (${fromFirst} ops)`);
  assert.ok(room.history.some((h) => h.envelope.turnId === t2!.turnId));
});

test("stop cancels the response and returns to idle", async () => {
  const { room, sent } = await roomWith("coffee");
  const p = room.prompt("go", "u1");
  await new Promise((r) => setTimeout(r, 500));
  room.stop();
  await p;
  assert.ok(room.deck.slides.length < 5);
  assert.equal(sent.filter((m) => m.type === "ai_status").at(-1).status, "idle");
});

const member = (room: any, userId = "u1") => [...room.members].find((m: any) => m.userId === userId);

test("editor ops are one undo step each, and redo restores them", async () => {
  const { room } = await roomWith("coffee");
  const m = member(room);
  room.userOps(
    [
      { type: "add_slide", id: "s1", layout: "blank" },
      { type: "add_shape", slideId: "s1", elementId: "s1-star", shape: "star" },
    ],
    m,
  );
  room.userOps([{ type: "set_box", slideId: "s1", elementId: "s1-star", x: 10, y: 20, rotate: 45 }], m);
  room.userOps([{ type: "set_style", slideId: "s1", elementId: "s1-star", style: { fill: "#ff0000", strokeWidth: 4 } }], m);
  const star = () => room.deck.slides[0]?.elements[0];
  assert.deepEqual([star().box.x, star().box.rotate, star().style.fill], [10, 45, "#ff0000"]);

  room.undoMine("u1");
  assert.equal(star().style.fill, "#8b5cf6", "style reverted to default");
  room.undoMine("u1");
  assert.deepEqual([star().box.x, star().box.rotate], [540, 0]);
  room.redoMine("u1");
  room.redoMine("u1");
  assert.deepEqual([star().box.x, star().style.fill], [10, "#ff0000"]);
  room.undoMine("u1");
  room.undoMine("u1");
  room.undoMine("u1");
  assert.equal(room.deck.slides.length, 0, "first step removed slide and shape together");
});

test("duplicate_slide renames element ids and reorder_element changes stacking", async () => {
  const { room } = await roomWith("coffee");
  const m = member(room);
  room.userOps(
    [
      { type: "add_slide", id: "s1", layout: "bullets" },
      { type: "set_text", slideId: "s1", elementId: "s1-title", text: "Hi" },
      { type: "add_shape", slideId: "s1", elementId: "s1-bg", shape: "rect" },
      { type: "reorder_element", slideId: "s1", elementId: "s1-bg", toIndex: 0 },
      { type: "duplicate_slide", slideId: "s1", newId: "s2" },
    ],
    m,
  );
  assert.deepEqual(room.deck.slides[1].elements.map((e: any) => e.id), ["s2-bg", "s2-title"]);
  assert.equal(room.deck.slides[1].elements[1].style.fontSize, 44, "layout default style applied");
});

test("uploaded images are hidden from the model prompt", async () => {
  const { room } = await roomWith("coffee");
  room.userOps(
    [
      { type: "add_slide", id: "s1", layout: "blank" },
      { type: "add_image", slideId: "s1", elementId: "s1-img", prompt: "cat.png", url: "data:image/png;base64," + "A".repeat(5000) },
    ],
    member(room),
  );
  const prompt = (room as any).buildMessages("hi", "u1").at(-1).content as string;
  assert.ok(prompt.includes("(uploaded image)") && !prompt.includes("AAAA"));
});
