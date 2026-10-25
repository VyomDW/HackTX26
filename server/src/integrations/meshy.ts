import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "../env";

const API = "https://api.meshy.ai/openapi/v2/text-to-3d";
const assetDir = path.resolve("data/meshy");

async function meshyFetch(url: string, init?: RequestInit) {
  if (!env.meshyApiKey) throw new Error("3D generation is not configured. Add MESHY_API_KEY to server/.env.");
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${env.meshyApiKey}`, ...(init?.headers ?? {}) } });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Meshy request failed (${response.status})${details ? `: ${details.slice(0, 300)}` : ""}`);
  }
  return response;
}

export type MeshyQuality = "medium" | "high";

export async function createMeshyTask(prompt: string, quality: MeshyQuality) {
  const settings = quality === "medium"
    ? { model_type: "smart-topology", ai_model: "meshy-t2.5", target_polycount: 10_000, topology: "triangle" }
    : { model_type: "standard", ai_model: "meshy-7.1", geometry_resolution: "2k", should_remesh: true, target_polycount: 50_000 };
  const response = await meshyFetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "preview", prompt, target_formats: ["glb"], ...settings }),
  });
  return await response.json() as { result: string };
}

export async function refineMeshyTask(previewTaskId: string, prompt: string) {
  const response = await meshyFetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "refine", preview_task_id: previewTaskId, texture_prompt: prompt, texture_resolution: "2k", enable_pbr: true, target_formats: ["glb"], auto_size: true }),
  });
  return await response.json() as { result: string };
}

export async function getMeshyTask(taskId: string) {
  const response = await meshyFetch(`${API}/${encodeURIComponent(taskId)}`);
  const task = await response.json() as { status: string; progress?: number; model_urls?: { glb?: string }; task_error?: { message?: string } };
  if (task.status === "SUCCEEDED" && task.model_urls?.glb) {
    mkdirSync(assetDir, { recursive: true });
    const filename = path.join(assetDir, `${taskId}.glb`);
    if (!existsSync(filename)) {
      const modelResponse = await fetch(task.model_urls.glb);
      if (!modelResponse.ok) throw new Error(`Could not download generated model (${modelResponse.status}).`);
      const bytes = Buffer.from(await modelResponse.arrayBuffer());
      if (bytes.length > 50 * 1024 * 1024) throw new Error("Generated model exceeds the 50 MB limit.");
      writeFileSync(filename, bytes);
    }
    return { status: task.status, progress: task.progress ?? 100, assetUrl: `/api/studio/meshy/assets/${encodeURIComponent(taskId)}.glb` };
  }
  return { status: task.status, progress: task.progress ?? 0, ...(task.task_error?.message ? { error: task.task_error.message } : {}) };
}

export function meshyAssetPath(taskId: string) {
  if (!/^[\w-]{1,100}$/.test(taskId)) return undefined;
  const filename = path.join(assetDir, `${taskId}.glb`);
  return existsSync(filename) ? filename : undefined;
}
