import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface CacheEntry {
  savedAt: number;
  results: SearchResult[];
}

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
const cacheFile = path.join(dataDir, "serpapi-cache.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function plainText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** SerpApi Google search with a 24-hour disk cache. Server-side only. */
export async function search(query: string): Promise<SearchResult[]> {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("search: query is empty");

  let cache: Record<string, CacheEntry> = {};
  try {
    cache = JSON.parse(await readFile(cacheFile, "utf8")) as Record<string, CacheEntry>;
  } catch {
    // Cache file is created after the first successful query.
  }
  const key = normalized.toLocaleLowerCase();
  const hit = cache[key];
  if (hit && Date.now() - hit.savedAt < CACHE_TTL_MS) return hit.results;
  if (!env.serpApiKey) {
    if (hit) return hit.results;
    throw new Error("search: SERPAPI_KEY is not set");
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", normalized);
  url.searchParams.set("api_key", env.serpApiKey);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (hit) return hit.results;
    if (controller.signal.aborted) throw new Error("search: SerpApi timed out after 12 seconds");
    throw new Error(`search: request failed (${err instanceof Error ? err.message : String(err)})`);
  } finally {
    clearTimeout(timeout);
  }

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    organic_results?: { title?: unknown; link?: unknown; snippet?: unknown }[];
  };
  if (!response.ok || data.error) {
    if (hit) return hit.results;
    throw new Error(`search: SerpApi returned ${response.status}: ${data.error ?? response.statusText}`);
  }

  const results = (data.organic_results ?? [])
    .map((r) => ({ title: plainText(r.title), url: httpUrl(r.link), snippet: plainText(r.snippet) }))
    .filter((r) => r.title && r.url)
    .slice(0, 5);

  await mkdir(dataDir, { recursive: true });
  cache[key] = { savedAt: Date.now(), results };
  await writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return results;
}
