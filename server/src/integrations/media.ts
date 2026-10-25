import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { env } from "../env";

/**
 * Media studio: music and video generated on Replicate, then converted with ffmpeg into the
 * formats people download (video: mp4 + mov; music: a waveform mp4, mp3 and the original).
 */

const run = promisify(execFile);
/** Bundled ffmpeg first, so hosts without it installed (Vercel, Render) can still convert. */
const FFMPEG = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string | null) || "ffmpeg";
export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || "data/media");
const JOBS_FILE = path.join(MEDIA_DIR, "jobs.json");
const API = "https://api.replicate.com/v1";

export type MediaKind = "music" | "video";
export interface MediaOptions {
  /** Video length in seconds. */
  duration?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}
export interface MediaFile {
  name: string;
  label: string;
}
export interface MediaJob {
  id: string;
  /** Account that made it; only they see it in the studio. */
  ownerId?: string;
  kind: MediaKind;
  prompt: string;
  options: MediaOptions;
  status: "starting" | "generating" | "converting" | "done" | "failed";
  createdAt: number;
  finishedAt?: number;
  /** Playable file for the in-page preview. */
  preview?: string;
  files: MediaFile[];
  error?: string;
}

export const mediaEnabled = () => !!env.replicateToken;

const jobs = new Map<string, MediaJob>();
const loaded = (async () => {
  try {
    for (const job of JSON.parse(await readFile(JOBS_FILE, "utf8")) as MediaJob[]) {
      // A job cut off by a restart can't resume its poll.
      if (job.status !== "done" && job.status !== "failed") Object.assign(job, { status: "failed", error: "Interrupted by a server restart" });
      jobs.set(job.id, job);
    }
  } catch {
    // First run: no history yet.
  }
})();

let saving = Promise.resolve();
const save = () => {
  saving = saving.then(async () => {
    await mkdir(MEDIA_DIR, { recursive: true });
    await writeFile(JOBS_FILE, JSON.stringify([...jobs.values()], null, 2));
  });
  return saving;
};

export async function listMedia(ownerId: string): Promise<MediaJob[]> {
  await loaded;
  return [...jobs.values()].filter((j) => j.ownerId === ownerId).sort((a, b) => b.createdAt - a.createdAt);
}

/** What each model is asked for; inputs a model doesn't declare would be rejected, so only send known ones. */
function inputFor(kind: MediaKind, prompt: string, o: MediaOptions): Record<string, unknown> {
  if (kind === "music") return { prompt };
  return { prompt, duration: o.duration ?? 5, aspect_ratio: o.aspectRatio ?? "16:9" };
}

async function replicate(pathname: string, init?: RequestInit, attempt = 0): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.replicateToken}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Low-credit accounts may only start one prediction at a time, so a second request waits its turn.
  if (res.status === 429 && attempt < 8) {
    const wait = Number(/resets in ~(\d+)s/.exec(String(body.detail ?? ""))?.[1] ?? 10);
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
    return replicate(pathname, init, attempt + 1);
  }
  if (res.status === 402) throw new Error("Your Replicate account is out of credit. Add some at replicate.com/account/billing, wait a minute, then try again.");
  if (res.status === 401) throw new Error("Replicate rejected the API token. Check REPLICATE_API_TOKEN in server/.env.");
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${String(body.detail ?? body.error ?? res.statusText)}`);
  return body;
}

export async function startMedia(ownerId: string, kind: MediaKind, prompt: string, options: MediaOptions): Promise<MediaJob> {
  await loaded;
  const job: MediaJob = { id: randomUUID(), ownerId, kind, prompt, options, status: "starting", createdAt: Date.now(), files: [] };
  jobs.set(job.id, job);
  void save();
  void generate(job).catch(async (err) => {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.finishedAt = Date.now();
    console.error(`[media ${job.id}] failed`, job.error);
    await save();
  });
  return job;
}

async function generate(job: MediaJob) {
  const model = job.kind === "music" ? env.replicateMusicModel : env.replicateVideoModel;
  let pred = await replicate(`/models/${model}/predictions`, { method: "POST", body: JSON.stringify({ input: inputFor(job.kind, job.prompt, job.options) }) });
  job.status = "generating";
  void save();
  // Video can take a few minutes; give up after ten.
  const deadline = Date.now() + 10 * 60_000;
  while (pred.status !== "succeeded") {
    if (pred.status === "failed" || pred.status === "canceled") throw new Error(String(pred.error ?? `generation ${pred.status}`));
    if (Date.now() > deadline) throw new Error("generation timed out");
    await new Promise((r) => setTimeout(r, 2500));
    pred = await replicate(`/predictions/${String(pred.id)}`);
  }
  const output = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (typeof output !== "string") throw new Error("Replicate returned no file");

  job.status = "converting";
  void save();
  const dir = path.join(MEDIA_DIR, job.id);
  await mkdir(dir, { recursive: true });
  const ext = (new URL(output).pathname.match(/\.(\w+)$/)?.[1] ?? (job.kind === "music" ? "wav" : "mp4")).toLowerCase();
  const source = path.join(dir, `original.${ext}`);
  const res = await fetch(output);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  await writeFile(source, Buffer.from(await res.arrayBuffer()));

  const ff = (...args: string[]) => run(FFMPEG, ["-y", "-loglevel", "error", ...args], { maxBuffer: 1 << 24 });
  try {
    await convert(job, dir, source, ext, ff);
  } catch (err) {
    // The generation already succeeded (and was paid for), so hand over Replicate's original file rather than fail.
    console.warn(`[media ${job.id}] conversion failed, serving the original`, err instanceof Error ? err.message : err);
    job.preview = `original.${ext}`;
    job.files = [{ name: `original.${ext}`, label: ext.toUpperCase() }];
  }
  job.status = "done";
  job.finishedAt = Date.now();
  await save();
}

async function convert(job: MediaJob, dir: string, source: string, ext: string, ff: (...args: string[]) => Promise<unknown>) {
  if (job.kind === "video") {
    // Re-encode to H.264/AAC so the mp4 and mov play everywhere, QuickTime and phones included.
    await ff("-i", source, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", path.join(dir, "video.mp4"));
    await ff("-i", path.join(dir, "video.mp4"), "-c", "copy", path.join(dir, "video.mov"));
    job.preview = "video.mp4";
    job.files = [
      { name: "video.mp4", label: "MP4" },
      { name: "video.mov", label: "MOV" },
    ];
  } else {
    // Music as a video file too: an ink waveform on paper, so it can be dropped into slides or shared like a clip.
    await ff(
      "-i", source,
      "-filter_complex", "[0:a]showwaves=s=1280x720:mode=cline:colors=0x1c1b18:rate=30,format=rgba[w];color=c=0xfbfbf8:s=1280x720:r=30[bg];[bg][w]overlay=shortest=1,format=yuv420p[v]",
      "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
      path.join(dir, "music.mp4"),
    );
    await ff("-i", path.join(dir, "music.mp4"), "-c", "copy", path.join(dir, "music.mov"));
    await ff("-i", source, "-c:a", "libmp3lame", "-q:a", "2", path.join(dir, "music.mp3"));
    job.preview = "music.mp3";
    job.files = [
      { name: "music.mp4", label: "MP4" },
      { name: "music.mov", label: "MOV" },
      { name: "music.mp3", label: "MP3" },
      { name: `original.${ext}`, label: ext.toUpperCase() },
    ];
  }
}

/** Deletes a finished or failed generation and its files. Returns false if there is nothing to remove yet. */
export async function removeMedia(id: string, ownerId: string): Promise<boolean> {
  await loaded;
  const job = jobs.get(id);
  if (job?.ownerId !== ownerId) return false;
  // A running job would write its files after removal, so only settled ones can go.
  if (!job || (job.status !== "done" && job.status !== "failed")) return false;
  jobs.delete(id);
  await rm(path.join(MEDIA_DIR, id), { recursive: true, force: true });
  await save();
  return true;
}

/** A file's path on disk, or undefined if the job or name is not one we made. */
export async function mediaFile(id: string, name: string): Promise<string | undefined> {
  await loaded;
  const job = jobs.get(id);
  if (!job || !job.files.some((f) => f.name === name)) return undefined;
  return path.join(MEDIA_DIR, id, name);
}
