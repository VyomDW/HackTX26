import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export interface SourcedImage {
  url: string;
  title: string;
  sourceUrl: string;
}

interface ImageResult {
  title?: unknown;
  link?: unknown;
  source?: unknown;
  thumbnail?: unknown;
  original?: unknown;
  original_width?: unknown;
  original_height?: unknown;
  unsafe?: boolean;
}

interface ImageSearchResponse {
  error?: string;
  images_results?: ImageResult[];
}

interface ImageCacheEntry extends SourcedImage {
  filename: string;
}

const dataDir = IMAGE_DIR;
const cacheFile = path.resolve(IMAGE_DIR, "../sourced-image-cache.json");
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MIN_IMAGE_PIXELS = 1280 * 720;

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function isAllowedThumbnail(value: unknown): value is string {
  const url = httpUrl(value);
  if (!url) return false;
  const host = new URL(url).hostname.toLowerCase();
  return host === "serpapi.com" || host.endsWith(".serpapi.com") || host === "gstatic.com" || host.endsWith(".gstatic.com") || host === "googleusercontent.com" || host.endsWith(".googleusercontent.com");
}

function isSafeOriginal(value: unknown, sourcePage: string): value is string {
  const url = httpUrl(value);
  if (!url) return false;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIP(host)) return false;

  // Fetch originals from the source site, its subdomains, or well-known public image CDNs.
  // This avoids turning arbitrary image-search URLs into a server-side request proxy.
  const sourceHost = new URL(sourcePage).hostname.toLowerCase();
  const trustedImageHosts = [
    "wikimedia.org", "googleusercontent.com", "unsplash.com", "pexels.com", "cloudinary.com",
    "staticflickr.com", "flickr.com", "fbcdn.net", "twimg.com", "squarespace-cdn.com",
    "cdn.shopify.com", "cdn.sanity.io", "akamaized.net", "akamaihd.net", "images-amazon.com", "imgur.com",
  ];
  return host === sourceHost || host.endsWith(`.${sourceHost}`) || trustedImageHosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function downloadImage(url: string): Promise<{ bytes: Buffer; ext: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: "error" });
  if (!response.ok) throw new Error(`image returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  const extByType: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const ext = extByType[contentType];
  if (!ext) throw new Error(`unsupported image type ${contentType || "unknown"}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error("image exceeds the 20 MB limit");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("image is empty or exceeds the 20 MB limit");
  const dimensions = imageDimensions(bytes, ext);
  if (dimensions && (dimensions.width * dimensions.height < MIN_IMAGE_PIXELS || Math.min(dimensions.width, dimensions.height) < 600)) {
    throw new Error(`image is too small (${dimensions.width}×${dimensions.height}); needs at least 1280×720-class resolution`);
  }
  return { bytes, ext };
}

function imageDimensions(bytes: Buffer, ext: string): { width: number; height: number } | undefined {
  if (ext === "png" && bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (ext === "webp" && bytes.length >= 30 && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b1 = bytes[21] ?? 0, b2 = bytes[22] ?? 0, b3 = bytes[23] ?? 0, b4 = bytes[24] ?? 0;
      return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
    }
  }
  if (ext === "jpg" && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (startOfFrame.has(marker)) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      offset += segmentLength;
    }
  }
  return undefined;
}

function publicUrl(filename: string): string {
  return `/api/images/${filename}`;
}

const IDENTITY_STOP_WORDS = new Set([
  "a", "an", "and", "at", "background", "create", "football", "for", "from", "image", "in", "make", "of", "on", "photo", "pitch", "show", "stadium", "the", "to", "with",
]);

function normalizedWords(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** Keep results tied to named entities in the user's request, even when the AI image prompt is generic. */
function matchesRequestedIdentity(candidate: ImageResult, context: string): boolean {
  const haystack = `${String(candidate.title ?? "")} ${String(candidate.source ?? "")} ${String(candidate.link ?? "")}`.toLocaleLowerCase();
  const identityWords = new Set<string>();
  const acronymMatches = context.match(/\b[A-Z]{2,}\b/g) ?? [];
  const properNameMatches = context.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b/g) ?? [];
  for (const name of [...acronymMatches, ...properNameMatches]) {
    for (const word of normalizedWords(name)) {
      if (word.length > 2 && !IDENTITY_STOP_WORDS.has(word)) identityWords.add(word);
    }
  }

  // Expand common shorthand to names that image result titles and source pages tend to use.
  if (/\btamu\b|\baggies\b/i.test(context)) {
    for (const word of ["tamu", "texas", "aggie", "kyle", "field"]) identityWords.add(word);
  }

  // Only enforce identity when the request includes a distinctive proper name or acronym.
  if (!identityWords.size) return true;
  if (/\btamu\b|\baggies\b/i.test(context)) {
    return ["tamu", "texas", "aggie", "kyle", "field"].some((word) => normalizedWords(haystack).has(word));
  }
  return [...identityWords].some((word) => normalizedWords(haystack).has(word));
}

async function readCache(): Promise<Record<string, ImageCacheEntry>> {
  try {
    return JSON.parse(await readFile(cacheFile, "utf8")) as Record<string, ImageCacheEntry>;
  } catch {
    return {};
  }
}

/** Finds a verifiable web image via SerpApi, preferring the site's full-resolution original, and returns source attribution. */
export async function findSourcedImage(query: string, context = ""): Promise<SourcedImage> {
  const cleanQuery = `${query} ${context}`.trim().replace(/\s+/g, " ");
  if (!cleanQuery) throw new Error("image search: query is empty");
  if (!env.serpApiKey) throw new Error("image search: SERPAPI_KEY is not set");

  const cache = await readCache();
  const cacheKey = `high-resolution-v3:${cleanQuery.toLocaleLowerCase()}`;
  const cached = cache[cacheKey];
  if (cached) {
    try {
      await readFile(path.join(dataDir, cached.filename));
      return { url: publicUrl(cached.filename), title: cached.title, sourceUrl: cached.sourceUrl };
    } catch {
      // Re-fetch if the saved image was removed.
    }
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("api_key", env.serpApiKey);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("imgsz", "2mp");

  let data: ImageSearchResponse | undefined;
  let requestFailure = "unknown network error";
  // SerpApi can occasionally stall before returning image results. Retry one transient
  // network/timeout failure; keep the timeout active while the response body is read too.
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const parsed = (await response.json()) as ImageSearchResponse;
      if (!response.ok || parsed.error) {
        throw new Error(`image search: SerpApi returned ${response.status}: ${parsed.error ?? response.statusText}`);
      }
      data = parsed;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("image search: SerpApi returned")) throw err;
      requestFailure = controller.signal.aborted
        ? "image search: SerpApi timed out after 20 seconds"
        : `image search: request failed (${err instanceof Error ? err.message : String(err)})`;
      if (attempt === 1) throw new Error(requestFailure);
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!data) throw new Error(requestFailure);

  const candidates = (data.images_results ?? []).filter((item) =>
    !item.unsafe && httpUrl(item.link) && (isSafeOriginal(item.original, httpUrl(item.link)) || isAllowedThumbnail(item.thumbnail)) && matchesRequestedIdentity(item, context),
  ).sort((a, b) => {
    const pixels = (item: ImageResult) => {
      const width = Number(item.original_width), height = Number(item.original_height);
      return Number.isFinite(width * height) && width > 0 && height > 0 ? width * height : 0;
    };
    return pixels(b) - pixels(a);
  });
  if (!candidates.length) {
    throw new Error(`image search: no usable image result matched the requested subject among ${data.images_results?.length ?? 0} results`);
  }

  let lastFailure = "unknown image response";
  // Google can include a few small or expired variants near the top even with its 2 MP filter.
  // Try a wider set, ordered by SerpApi's reported original dimensions.
  for (const candidate of candidates.slice(0, 24)) {
    try {
      const sourceUrl = httpUrl(candidate.link);
      let downloaded: { bytes: Buffer; ext: string } | undefined;
      if (isSafeOriginal(candidate.original, sourceUrl)) {
        try {
          downloaded = await downloadImage(httpUrl(candidate.original));
        } catch (err) {
          lastFailure = `original image unavailable (${err instanceof Error ? err.message : String(err)})`;
        }
      }
      if (!downloaded && isAllowedThumbnail(candidate.thumbnail)) {
        downloaded = await downloadImage(httpUrl(candidate.thumbnail));
      }
      if (!downloaded) throw new Error(lastFailure);

      const title = typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : typeof candidate.source === "string" ? candidate.source.trim() : "Image source";
      const filename = `${randomUUID()}.${downloaded.ext}`;
      await mkdir(dataDir, { recursive: true });
      await writeFile(path.join(dataDir, filename), downloaded.bytes);
      const result: SourcedImage = { url: publicUrl(filename), title, sourceUrl };
      cache[cacheKey] = { ...result, filename };
      await writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
      return result;
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`image search: SerpApi returned images, but originals and thumbnails could not be saved (${lastFailure})`);
}
