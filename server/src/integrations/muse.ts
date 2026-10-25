import { readFile } from "node:fs/promises";
import OpenAI, { APIError } from "openai";
import { env } from "../env";

export interface ChatMessage {
  role: "developer" | "user" | "assistant";
  content: string;
}

/** Muse Spark speaks the OpenAI Chat Completions protocol, so the official SDK works with a custom baseURL. */
const client = env.museApiKey
  ? new OpenAI({ apiKey: env.museApiKey, baseURL: env.museBaseUrl, timeout: 60_000, maxRetries: 2 })
  : undefined;

/**
 * Single transport-agnostic entry point for Muse Spark.
 * Yields raw text chunks as they stream in; the caller handles NDJSON framing.
 */
export async function* callMuse(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  if (env.museFixture) {
    yield* replayFixture(env.museFixture, signal);
    return;
  }
  if (!client) {
    yield* mockStream(messages, signal);
    return;
  }

  const models = [...new Set([env.museModel, env.museFallbackModel].filter(Boolean))];
  let stream: AsyncIterable<{ choices: { delta?: { content?: string | null } }[] }> | undefined;
  let lastModelError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        stream = await client.chat.completions.create(
          {
            model,
            messages,
            stream: true,
            // Reasoning delays the first token; minimal keeps the live build feeling instant.
            reasoning_effort: "minimal",
          },
          { signal },
        );
        break;
      } catch (err) {
        // Meta sometimes omits the machine-readable error code, but 404 still means this model cannot serve the request.
        const modelUnavailable = err instanceof APIError && err.status === 404;
        if (!modelUnavailable || signal?.aborted) throw err;
        lastModelError = err;
        if (attempt === 0) {
          await waitForRetry(350, signal);
        }
      }
    }
    if (stream) break;
  }

  if (!stream) throw lastModelError ?? new Error("No Muse model is available");
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Streams a recorded response line by line, paced like the real model. */
async function* replayFixture(path: string, signal?: AbortSignal): AsyncGenerator<string> {
  const text = await readFile(path, "utf8");
  for (const line of text.split("\n")) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 150));
    yield line + "\n";
  }
}

/** Offline stand-in so the pipeline runs end to end before keys are wired. */
async function* mockStream(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  const id = `s${Date.now().toString(36).slice(-4)}`;
  const last = messages.at(-1)?.content ?? "";
  const title = /Request:\\s*([\\s\\S]*)$/.exec(last)?.[1]?.trim() || "Untitled";
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
