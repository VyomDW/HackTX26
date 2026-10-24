import { useCallback, useEffect, useRef, useState } from "react";
import { downsample, encodeWav } from "@/lib/wav";

const apiUrl = import.meta.env.VITE_API_URL || "/api";
const TARGET_RATE = 16000;
const MIN_CLIP_MS = 300;
/** Audio kept from just before the press so the first syllable isn't clipped. */
const PREROLL_MS = 250;

// Inline so there's no extra file to serve; copies each 128-frame block to the main thread.
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

export const micSupported =
  typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && "AudioWorkletNode" in window;

type State = "idle" | "starting" | "recording" | "uploading";

interface Mic {
  ctx: AudioContext;
  stream: MediaStream;
  analyser: AnalyserNode;
  node: AudioWorkletNode;
}

export function usePushToTalk(roomId: string, userId: string) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string>();
  const [transcript, setTranscript] = useState<string>();
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const mic = useRef<Mic | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const preroll = useRef<Float32Array[]>([]);
  const recording = useRef(false);
  const wantStop = useRef(false);

  // The mic stays open after the first press so later presses start instantly.
  const ensureMic = useCallback(async () => {
    if (mic.current) return mic.current;
    // Created and resumed before any await: Safari and Chrome only allow it inside the press gesture,
    // and the permission prompt on first use can outlast the gesture.
    const ctx = new AudioContext();
    void ctx.resume();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      await ctx.audioWorklet.addModule(workletUrl);
    } catch (err) {
      void ctx.close();
      throw err;
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const node = new AudioWorkletNode(ctx, "pcm-tap");
    const prerollBlocks = Math.ceil(((PREROLL_MS / 1000) * ctx.sampleRate) / 128);
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (recording.current) chunks.current.push(e.data);
      else {
        preroll.current.push(e.data);
        if (preroll.current.length > prerollBlocks) preroll.current.shift();
      }
    };
    source.connect(analyser);
    source.connect(node);
    mic.current = { ctx, stream, analyser, node };
    setAnalyser(analyser);
    return mic.current;
  }, []);

  useEffect(
    () => () => {
      mic.current?.stream.getTracks().forEach((t) => t.stop());
      void mic.current?.ctx.close();
    },
    [],
  );

  const stop = useCallback(async () => {
    if (!recording.current) {
      // Released while the permission prompt or AudioContext was still starting.
      wantStop.current = true;
      return;
    }
    recording.current = false;
    const m = mic.current!;
    const total = chunks.current.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let o = 0;
    for (const c of chunks.current) samples.set(c, o), (o += c.length);
    chunks.current = [];

    if ((total / m.ctx.sampleRate) * 1000 < MIN_CLIP_MS + PREROLL_MS) {
      setState("idle");
      return;
    }
    setState("uploading");
    try {
      const wav = encodeWav(downsample(samples, m.ctx.sampleRate, TARGET_RATE), TARGET_RATE);
      const res = await fetch(`${apiUrl}/rooms/${encodeURIComponent(roomId)}/voice?userId=${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav,
      });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { text } = (await res.json()) as { text: string };
      setTranscript(text || "(didn't catch that)");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setState("idle");
    }
  }, [roomId, userId]);

  const start = useCallback(async () => {
    if (!micSupported || recording.current) return;
    setError(undefined);
    wantStop.current = false;
    setState("starting");
    try {
      const m = await ensureMic();
      // iOS suspends contexts not resumed inside a gesture.
      if (m.ctx.state !== "running") await m.ctx.resume();
      chunks.current = [...preroll.current];
      recording.current = true;
      setState("recording");
      if (wantStop.current) void stop();
    } catch (err) {
      setState("idle");
      setError(err instanceof DOMException && err.name === "NotAllowedError" ? "Microphone access was denied" : String(err));
    }
  }, [ensureMic, stop]);

  return { state, error, transcript, analyser, start, stop };
}
