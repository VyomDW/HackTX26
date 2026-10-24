import { env } from "../env";

/**
 * Sends one push-to-talk clip to Muse Voice Transcribe and returns the transcript.
 * The API only accepts mono 16-bit PCM WAV at 16 or 24 kHz; the client encodes that before upload.
 */
export async function transcribe(audio: Buffer, mimeType: string): Promise<string> {
  if (!env.museVoiceApiKey) return "Make a pitch about sustainable coffee";

  const form = new FormData();
  form.append(
    "request",
    new Blob(
      [JSON.stringify({ mode: "PUSH_TO_TALK", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", languageBias: ["English"] })],
      { type: "application/json" },
    ),
  );
  form.append("audio", new Blob([new Uint8Array(audio)], { type: mimeType }), "clip.wav");

  const res = await fetch(env.museVoiceUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.museVoiceApiKey}`, Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`transcribe: ${res.status} ${await res.text()}`);
  const { transcript } = (await res.json()) as { transcript?: string };
  return transcript?.trim() ?? "";
}
