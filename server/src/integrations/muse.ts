import { readFile } from "node:fs/promises";
import OpenAI, { APIError } from "openai";
import { env } from "../env";

export interface ChatMessage {
  role: "developer" | "user" | "assistant";
  content: string;
}

/** Muse Spark speaks the OpenAI Responses protocol, so the official SDK works with a custom baseURL. */
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

  const models = [...new Set([env.museModel, ...env.museFallbackModels].filter(Boolean))];
  let stream: AsyncIterable<{ type: string; delta?: string }> | undefined;
  let lastModelError: unknown;

  // During an outage Meta's models flicker on and off minute to minute, so if every one is down
  // right now, wait a moment and go round the whole chain again before giving up.
  for (let round = 0; round < 3 && !stream; round++) {
    if (round > 0) {
      console.warn(`Every Muse model was unavailable; retrying the chain (round ${round + 1})`);
      await waitForRetry(800 * round, signal);
    }
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const instructions = messages
            .filter((message) => message.role === "developer")
            .map((message) => message.content)
            .join("\n\n");
          const input = messages
            .filter((message) => message.role !== "developer")
            .map((message) => ({ role: message.role, content: message.content }));

          stream = await client.responses.create(
            {
              model,
              ...(instructions ? { instructions } : {}),
              input,
              stream: true,
            },
            { signal },
          );
          break;
        } catch (err) {
          // Meta sometimes omits the machine-readable error code, but 404 still means this model cannot serve the request.
          const modelUnavailable = err instanceof APIError && err.status === 404;
          if (!modelUnavailable || signal?.aborted) throw err;
          lastModelError = err;
          console.warn(`Muse model unavailable: ${model} (attempt ${attempt + 1})`);
          if (attempt === 0) {
            await waitForRetry(350, signal);
          }
        }
      }
      if (stream) break;
    }
  }

  if (!stream) throw lastModelError ?? new Error("No Muse model is available");
  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta) yield event.delta;
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

/**
 * What this server can actually reach on the Muse API: which key it uses (as a fingerprint, never the key),
 * which models the API lists for that key from here, and a one-token test call to each configured model.
 * Explains "works locally, fails when deployed" without anyone needing the logs.
 */
export async function diagnoseMuse() {
  const { createHash } = await import("node:crypto");
  const key = env.museApiKey;
  const report: Record<string, unknown> = {
    baseUrl: env.museBaseUrl,
    keySource: process.env.MUSE_API_KEY
      ? "MUSE_API_KEY"
      : process.env.MODEL_API_KEY
        ? "MODEL_API_KEY"
        : "none",
    keyFingerprint: key
      ? createHash("sha256").update(key).digest("hex").slice(0, 10)
      : null,
    keyLength: key.length,
    keyHasWhitespace: key !== key.trim(),
  };
  if (!key) return { ...report, verdict: "No API key is set on this server." };
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const listed = await fetch(`${env.museBaseUrl}/models`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
    .then(async (r) => ({
      status: r.status,
      ids:
        (
          (await r.json().catch(() => ({}))) as { data?: { id: string }[] }
        ).data?.map((m) => m.id) ?? [],
    }))
    .catch((err: Error) => ({
      status: 0,
      ids: [] as string[],
      error: err.message,
    }));
  report.modelsListed = listed;
  const tests: Record<string, string> = {};
  for (const model of [
    ...new Set([env.museModel, ...env.museFallbackModels].filter(Boolean)),
  ]) {
    tests[model] = await fetch(`${env.museBaseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: "Reply with ok.",
        max_output_tokens: 1,
      }),
      signal: AbortSignal.timeout(20_000),
    })
      .then(async (r) =>
        r.ok
          ? "ok"
          : `${r.status} ${((await r.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? ""}`.trim(),
      )
      .catch((err: Error) => `unreachable: ${err.message}`);
  }
  report.modelTests = tests;
  const working = Object.entries(tests).find(([, v]) => v === "ok")?.[0];
  report.verdict = working
    ? `Working: ${working} answers from this server.`
    : listed.status === 401 || listed.status === 403
      ? "The API rejected this key."
      : listed.ids.length === 0
        ? "The key is accepted but the API lists no models for it from here: a different key/account, or access blocked for this server's location."
        : "The API lists models for this key, but none of the configured ones answer. Check MUSE_MODEL / MUSE_FALLBACK_MODELS against modelsListed.";
  return report;
}
