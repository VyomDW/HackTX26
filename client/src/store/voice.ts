import { create } from "zustand";

export type TalkState = "idle" | "starting" | "recording" | "uploading";

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
}

export const useVoice = create<VoiceState>(() => ({
  supported: false,
  state: "idle",
  level: 0,
  start: () => {},
  stop: () => {},
}));
