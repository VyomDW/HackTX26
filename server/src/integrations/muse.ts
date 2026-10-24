import { env } from "../env";

/**
 * Single transport-agnostic entry point for Muse Spark.
 * TODO(B): confirm whether Muse Spark has a TypeScript SDK or is REST only, then implement.
 * Yields raw text chunks as they stream in; the caller handles NDJSON framing.
 */
export async function* callMuse(prompt: string, signal?: AbortSignal): AsyncGenerator<string> {
  if (!env.museApiKey) {
    yield* mockStream(prompt, signal);
    return;
  }
  throw new Error("callMuse: real Muse Spark transport not implemented yet");
}

/** Offline stand-in so the pipeline runs end to end before keys are wired. */
async function* mockStream(prompt: string, signal?: AbortSignal): AsyncGenerator<string> {
  const id = `s${Date.now().toString(36).slice(-4)}`;
  const title = (JSON.parse(prompt) as { request?: string }).request ?? "Untitled";
  const lines = [
    { type: "add_slide", id, layout: "bullets" },
    { type: "set_text", slideId: id, elementId: `${id}-title`, text: title.slice(0, 60) },
    { type: "set_text", slideId: id, elementId: `${id}-body`, text: "• Mock bullet one\n• Mock bullet two" },
    { type: "focus", slideId: id, elementId: `${id}-title` },
  ];
  for (const line of lines) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 400));
    yield JSON.stringify(line) + "\n";
  }
}
