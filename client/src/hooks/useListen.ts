import { useCallback, useEffect, useMemo, useRef } from "react";
import { downsample, encodeWav } from "@/lib/wav";
import { useVoice } from "@/store/voice";

const apiUrl = import.meta.env.VITE_API_URL || "/api";
const TARGET_RATE = 16000;
/** Silence this long ends an utterance. */
const HANGOVER_MS = 900;
const MIN_SPEECH_MS = 400;
/** Long monologues are cut so captions and edits keep up. */
const MAX_UTTERANCE_MS = 12_000;
const PREROLL_MS = 300;

const workletUrl = URL.createObjectURL(
  new Blob(
    [
      `registerProcessor("pcm-tap", class extends AudioWorkletProcessor {
        process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
      });`,
    ],
    { type: "application/javascript" },
  ),
);

export const callAudioSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

type Source = "mic" | "call";

/**
 * Splits a live audio source into utterances with a simple energy-based voice detector:
 * the threshold tracks the background noise, so it works for a quiet mic and a loud call alike.
 */
function segmenter(ctx: AudioContext, onUtterance: (samples: Float32Array) => void, paused: () => boolean) {
  const block = 128 / ctx.sampleRate;
  const prerollBlocks = Math.ceil(PREROLL_MS / 1000 / block);
  let noise = 0.005;
  let speech: Float32Array[] | null = null;
  let voiced = 0;
  let silent = 0;
  const preroll: Float32Array[] = [];

  const flush = () => {
    if (speech && voiced * block * 1000 >= MIN_SPEECH_MS) {
      const total = speech.reduce((n, c) => n + c.length, 0);
      const out = new Float32Array(total);
      let o = 0;
      for (const c of speech) out.set(c, o), (o += c.length);
      onUtterance(out);
    }
    speech = null;
    voiced = silent = 0;
  };

  return (data: Float32Array) => {
    if (paused()) {
      speech = null;
      return;
    }
    let sum = 0;
    for (const s of data) sum += s * s;
    const rms = Math.sqrt(sum / data.length);
    const loud = rms > Math.max(0.01, noise * 3);
    // Follow the noise floor quickly down and slowly up, so speech doesn't raise it.
    noise = rms < noise ? noise * 0.95 + rms * 0.05 : noise * 0.999 + rms * 0.001;

    if (!speech) {
      preroll.push(data);
      if (preroll.length > prerollBlocks) preroll.shift();
      if (!loud) return;
      speech = [...preroll];
      preroll.length = 0;
    }
    speech.push(data);
    if (loud) (voiced++, (silent = 0));
    else silent++;
    if (silent * block * 1000 >= HANGOVER_MS || speech.length * block * 1000 >= MAX_UTTERANCE_MS) flush();
  };
}

/**
 * Listen mode: an open mic, plus optionally the meeting audio from a screen share, so the app hears
 * everyone on a Zoom, Meet or Teams call. Every utterance is sent off; the server decides what is a request.
 */
export function useListen(roomId: string, userId: string) {
  const live = useRef<{ ctx: AudioContext; streams: MediaStream[] } | null>(null);

  const upload = useCallback(
    async (samples: Float32Array, rate: number, source: Source) => {
      const wav = encodeWav(downsample(samples, rate, TARGET_RATE), TARGET_RATE);
      const q = `userId=${encodeURIComponent(userId)}&mode=listen&source=${source}`;
      try {
        const res = await fetch(`${apiUrl}/rooms/${encodeURIComponent(roomId)}/voice?${q}`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: wav,
        });
        if (!res.ok) throw new Error(`upload failed (${res.status})`);
      } catch (err) {
        useVoice.setState({ listenError: err instanceof Error ? err.message : String(err) });
      }
    },
    [roomId, userId],
  );

  const stop = useCallback(() => {
    live.current?.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void live.current?.ctx.close();
    live.current = null;
    useVoice.setState({ listen: "off", listenLevel: 0 });
  }, []);

  const start = useCallback(
    async (withCall: boolean) => {
      if (live.current) stop();
      // Created before any await so it counts as started by the click.
      const ctx = new AudioContext();
      void ctx.resume();
      const streams: MediaStream[] = [];
      useVoice.setState({ listenError: undefined });
      try {
        await ctx.audioWorklet.addModule(workletUrl);
        if (withCall) {
          // The picker shows tabs, windows and screens; sharing the meeting tab (or the screen on Windows) with audio
          // carries every other participant's voice. Video is required by the API but never used.
          const display = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            // Chrome-only hints: offer system audio and default the tab-audio checkbox on.
            ...({ systemAudio: "include", windowAudio: "system" } as object),
          });
          streams.push(display);
          if (!display.getAudioTracks().length) {
            throw new Error(
              "That share has no sound. Share the meeting's browser tab with “Also share tab audio” on, or on Windows share your entire screen with system audio.",
            );
          }
          display.getVideoTracks()[0]?.addEventListener("ended", stop);
        }
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streams.push(mic);
      } catch (err) {
        streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        void ctx.close();
        const denied = err instanceof DOMException && err.name === "NotAllowedError";
        useVoice.setState({ listen: "off", listenError: denied ? "Sharing or microphone access was cancelled" : err instanceof Error ? err.message : String(err) });
        return;
      }

      // Push-to-talk already sends what you say while holding the button, so the open mic sits that out.
      const holding = () => useVoice.getState().state !== "idle";
      const attach = (stream: MediaStream, source: Source) => {
        const node = new AudioWorkletNode(ctx, "pcm-tap");
        const feed = segmenter(ctx, (s) => void upload(s, ctx.sampleRate, source), source === "mic" ? holding : () => false);
        let frame = 0;
        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          feed(e.data);
          // A cheap level for the button, about 20 times a second.
          if (source === "mic" && ++frame % 20 === 0) {
            let sum = 0;
            for (const s of e.data) sum += s * s;
            useVoice.setState({ listenLevel: Math.min(1, Math.sqrt(sum / e.data.length) * 6) });
          }
        };
        ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(node);
      };
      attach(streams.at(-1)!, "mic");
      if (withCall) attach(streams[0]!, "call");
      live.current = { ctx, streams };
      useVoice.setState({ listen: withCall ? "call" : "mic" });
    },
    [stop, upload],
  );

  useEffect(() => stop, [stop]);

  return useMemo(() => ({ start, stop }), [start, stop]);
}
