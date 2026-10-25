import { create } from "zustand";
import type { Caption } from "@hacktx/shared";

export type TalkState = "idle" | "starting" | "recording" | "uploading";
export type ListenMode = "off" | "mic" | "call";

/**
 * The local push-to-talk mic, shared so the dock, the Space shortcut and the 3D particles
 * all see the same state. `level` updates every frame while recording; read it with
 * getState() inside animation loops instead of subscribing.
 */
interface VoiceState {
  supported: boolean;
  state: TalkState;
  level: number;
  transcript?: string;
  error?: string;
  start: () => void;
  stop: () => void;
  /** Listen mode: an open mic, and with "call" also the meeting audio from a screen share. */
  listen: ListenMode;
  listenLevel: number;
  listenError?: string;
  startListen: (withCall: boolean) => void;
  stopListen: () => void;
  /** What open mics in the room heard recently, newest last. */
  captions: Caption[];
  addCaption: (c: Caption) => void;
}

export const useVoice = create<VoiceState>((set) => ({
  supported: false,
  state: "idle",
  level: 0,
  start: () => {},
  stop: () => {},
  listen: "off",
  listenLevel: 0,
  startListen: () => {},
  stopListen: () => {},
  captions: [],
  addCaption: (c) =>
    set((s) => {
      const i = s.captions.findIndex((x) => x.id === c.id);
      const captions = i >= 0 ? s.captions.map((x, j) => (j === i ? c : x)) : [...s.captions, c];
      return { captions: captions.slice(-20) };
    }),
}));
