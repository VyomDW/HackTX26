import { useCallback, useState } from "react";

const NAME_KEY = "muse:name";
const USER_KEY = "muse:userId";
export const MAX_NAME = 32;

/** Storage can throw (private windows, blocked site data); identity then just lasts for this page load. */
function read(storage: () => Storage, key: string) {
  try {
    return storage().getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function write(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value);
  } catch {
    // ignore
  }
}

/**
 * The userId is per tab (sessionStorage) so two tabs are two people, but survives a reload so
 * undo stacks and "you" labels stick. The name is remembered across tabs as the default.
 */
export function useIdentity() {
  const [userId] = useState(() => {
    const saved = read(() => sessionStorage, USER_KEY);
    if (saved) return saved;
    const id = `u-${Math.random().toString(36).slice(2, 8)}`;
    write(() => sessionStorage, USER_KEY, id);
    return id;
  });
  const [name, setNameState] = useState(() => read(() => sessionStorage, NAME_KEY));

  const setName = useCallback((next: string) => {
    const clean = next.trim().slice(0, MAX_NAME);
    if (!clean) return;
    write(() => sessionStorage, NAME_KEY, clean);
    write(() => localStorage, NAME_KEY, clean);
    setNameState(clean);
  }, []);

  return { userId, name, setName, suggestedName: read(() => localStorage, NAME_KEY) ?? "" };
}

const COLORS = ["#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#2563eb", "#ca8a04", "#9333ea"];

/** A stable color per person, so the same user looks the same in the header and the transcript. */
export function colorOf(userId: string) {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length]!;
}

export function initialsOf(name?: string) {
  const parts = (name ?? "?").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase();
}
