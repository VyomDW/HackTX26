# HackTX26

Live co-editing AI presentation tool: talk or type, and an AI collaborator edits the deck one operation at a time while everyone in the room watches.

## Layout

| Path | What lives there | Owner |
| --- | --- | --- |
| `shared/` | Zod deck types, operation schema, `applyOp` (with inverses for undo), WebSocket message types. The contract between client and server. | A + B |
| `server/` | Fastify + WebSocket rooms, NDJSON stream parsing, `callMuse()`, `transcribe()`, SerpApi text and image search | B, C |
| `client/` | React + Vite + Tailwind + shadcn/ui, Zustand deck store, slide renderer | A, C |

## Run locally

Requires Node 20+.

```bash
npm install
cp .env.example server/.env   # fill in MUSE_* and SERPAPI_KEY
npm run dev
```

- Client: http://localhost:5173 (add `?room=<name>` to join a specific room)
- Server: http://localhost:8787 (`/health`, WebSocket at `/ws`)

With no `MUSE_API_KEY`, `callMuse()` streams a mock slide so the whole pipeline runs offline.

Other scripts: `npm run typecheck`, `npm run build`.

Add shadcn components with `npx shadcn@latest add <component>` from `client/`.

## Open TODOs from the design doc

- B: real Muse Spark transport in `server/src/integrations/muse.ts`; system prompt in `Room.buildPrompt`
- C: SerpApi image search saves a real image thumbnail locally, updates the placeholder, and attaches its source as a slide footnote
- C: text and image search results are cached locally for reuse
- A: queue incoming ops with a delay, AI cursor, per-op undo UI
