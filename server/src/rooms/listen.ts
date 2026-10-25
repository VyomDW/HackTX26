import { randomUUID } from "node:crypto";
import type { Caption, ServerMessage } from "@hacktx/shared";
import { callMuse } from "../integrations/muse";
import type { Room } from "./room";

/** Lines heard within this window are judged together, so a request split across a pause stays whole. */
const SETTLE_MS = 1200;
/** How much conversation the filter sees. */
const KEEP_MS = 3 * 60_000;
/** Speakers on a call are often picked up by several open mics; the copy heard first wins. */
const ECHO_MS = 5000;

const WAKE = /^\s*(?:hey|ok(?:ay)?|hi)?[\s,]*(?:muse|news|mews|muze)\b[\s,.:!-]*/i;

const FILTER_PROMPT = `You listen in on people talking while they edit a shared document together with an AI editor called Muse.
Decide whether the NEW lines contain a request Muse should carry out on the document now.

Act on: instructions or clear agreements to change the document ("make slide two shorter", "let's add a chart of prices",
"yeah, do what Sam said", "can we make the title bigger"), even if not addressed to Muse.
Ignore: small talk, thinking out loud without a decision, questions to each other, opinions with no change agreed,
anything about lunch, schedules or the call itself, and requests already handled (lines marked [done]).

Reply with one JSON object and nothing else:
{"act": false}
or
{"act": true, "request": "<one self-contained instruction for Muse, resolving words like 'that' or 'what Sam said' from context>"}`;

interface Heard extends Caption {
  userId: string;
  norm: string;
  judged: boolean;
}

const normalize = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Share of words two lines have in common; above ~0.7 they are the same sentence heard twice. */
function overlap(a: string, b: string) {
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.max(A.size, B.size, 1);
}

/**
 * Listen mode for one room: open mics send every utterance here, and only real requests reach the editor.
 * People talking at once just add lines; the room's prompt merging already handles overlapping requests.
 */
class Listener {
  private heard: Heard[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private judging = false;

  constructor(private room: Room) {}

  hear(lines: string[], userId: string, speaker: string) {
    const now = Date.now();
    this.heard = this.heard.filter((h) => now - h.ts < KEEP_MS);
    for (const text of lines) {
      const norm = normalize(text);
      if (norm.split(" ").length < 2 && !WAKE.test(text)) continue;
      // The same words from another mic a moment later is the call audio leaking into a second mic.
      if (this.heard.some((h) => now - h.ts < ECHO_MS && h.userId !== userId && overlap(h.norm, norm) > 0.7)) continue;
      const line: Heard = { id: randomUUID(), speaker, text, ts: now, acted: false, userId, norm, judged: false };
      this.heard.push(line);
      this.send(line);

      const direct = text.replace(WAKE, "").trim();
      if (WAKE.test(text) && direct) {
        line.judged = true;
        this.act([line], direct);
      }
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.judge(), SETTLE_MS);
  }

  private async judge() {
    const fresh = this.heard.filter((h) => !h.judged);
    if (!fresh.length) return;
    if (this.judging) {
      this.timer = setTimeout(() => void this.judge(), SETTLE_MS);
      return;
    }
    this.judging = true;
    for (const h of fresh) h.judged = true;
    try {
      const transcript = this.heard
        .slice(-25)
        .map((h) => `${fresh.includes(h) ? "NEW " : h.acted ? "[done] " : ""}${h.speaker}: ${h.text}`)
        .join("\n");
      let reply = "";
      for await (const chunk of callMuse([
        { role: "developer", content: FILTER_PROMPT },
        { role: "user", content: transcript },
      ]))
        reply += chunk;
      const decision = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? "{}") as { act?: boolean; request?: string };
      if (decision.act && decision.request?.trim()) this.act(fresh, decision.request.trim());
    } catch (err) {
      // Without the filter we can't tell chatter from requests, so stay quiet rather than edit on everything.
      console.warn(`[room ${this.room.id}] listen filter failed`, err);
    } finally {
      this.judging = false;
    }
  }

  private act(lines: Heard[], request: string) {
    const by = lines.at(-1)!;
    for (const l of lines) {
      l.acted = true;
      this.send(l);
    }
    // Call audio is filed under its sharer's id plus ":call" so the echo check can tell it from their mic.
    void this.room.prompt(request, by.userId.replace(/:call$/, ""), by.speaker);
  }

  private send({ id, speaker, text, ts, acted }: Heard) {
    const msg: ServerMessage = { type: "caption", caption: { id, speaker, text, ts, acted } };
    const data = JSON.stringify(msg);
    for (const m of this.room.members) if (m.socket.readyState === m.socket.OPEN) m.socket.send(data);
  }
}

const listeners = new WeakMap<Room, Listener>();

export function listenerFor(room: Room) {
  let l = listeners.get(room);
  if (!l) listeners.set(room, (l = new Listener(room)));
  return l;
}
