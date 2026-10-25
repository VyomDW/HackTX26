import { env } from "../env";

type Mode = "PUSH_TO_TALK" | "DIARIZATION";

interface TranscribeResult {
  transcript?: string;
  turns?: { transcript: string; speaker: string }[];
}

/**
 * Sends one clip to Muse Voice Transcribe.
 * The API only accepts mono 16-bit PCM WAV at 16 or 24 kHz; the client encodes that before upload.
 */
async function request(audio: Buffer, mimeType: string, mode: Mode): Promise<TranscribeResult> {
  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify({ mode, model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", languageBias: ["English"] })], {
      type: "application/json",
    }),
  );
  form.append("audio", new Blob([new Uint8Array(audio)], { type: mimeType }), "clip.wav");

  const res = await fetch(env.museVoiceUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.museVoiceApiKey}`, Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`transcribe: ${res.status} ${await res.text()}`);
  return (await res.json()) as TranscribeResult;
}

/** One push-to-talk clip in, one transcript out. */
export async function transcribe(audio: Buffer, mimeType: string): Promise<string> {
  if (!env.museVoiceApiKey) return "Make a pitch about sustainable coffee";
  const { transcript } = await request(audio, mimeType, "PUSH_TO_TALK");
  return transcript?.trim() ?? "";
}

/**
 * Call audio can hold several voices in one clip, so it is split into one line per speaker turn.
 * Muse's speaker labels restart with every clip, so they are not returned.
 */
export async function transcribeTurns(audio: Buffer, mimeType: string, diarize: boolean): Promise<string[]> {
  if (!env.museVoiceApiKey) return ["Hey Muse, add a slide about coffee prices"];
  const { transcript, turns } = await request(audio, mimeType, diarize ? "DIARIZATION" : "PUSH_TO_TALK");
  const lines = diarize && turns?.length ? turns.map((t) => t.transcript) : [transcript ?? ""];
  return lines.map((l) => l.trim()).filter(Boolean);
}
