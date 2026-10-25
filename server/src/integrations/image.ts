import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { env } from "../env";

/** Generated images are written here and served at /images/<file> (the client reaches it through /api). */
export const IMAGE_DIR = path.resolve(process.env.IMAGE_DIR || "data/images");

const client = env.museApiKey ? new OpenAI({ apiKey: env.museApiKey, baseURL: env.museBaseUrl, timeout: 90_000, maxRetries: 1 }) : undefined;

/** False without an API key (e.g. in tests), where pictures are left as placeholders. */
export const imagesEnabled = !!client;

/** Muse Image returns base64; saving it to disk keeps documents small and URLs stable. */
export async function generateImage(prompt: string): Promise<string> {
  if (!client) throw new Error("generateImage: MUSE_API_KEY is not set");
  const res = await client.images.generate({ model: "muse-image-1.0", prompt, n: 1 });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("generateImage: no image in response");
  const ext = (res as { output_format?: string }).output_format === "png" ? "png" : "webp";
  const file = `${randomUUID()}.${ext}`;
  await mkdir(IMAGE_DIR, { recursive: true });
  await writeFile(path.join(IMAGE_DIR, file), Buffer.from(b64, "base64"));
  return `/api/images/${file}`;
}
