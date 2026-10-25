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
  let stream: AsyncIterable<{ choices: { delta?: { content?: string | null } }[] }> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      stream = await client.chat.completions.create(
        {
          model: env.museModel,
          messages,
          stream: true,
          // Reasoning delays the first token; minimal keeps the live build feeling instant.
          reasoning_effort: "minimal",
        },
        { signal },
      );
      break;
    } catch (err) {
      const transientModelMiss = err instanceof APIError && err.status === 404 && err.code === "model_not_found";
      if (!transientModelMiss || attempt === 2 || signal?.aborted) throw err;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 500 * 2 ** attempt);
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
  }
  if (!stream) return;
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
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
  const title = /Request:\s*([\s\S]*)$/.exec(last)?.[1]?.trim() || "Untitled";
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
