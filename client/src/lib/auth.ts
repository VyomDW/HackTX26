import { create } from "zustand";

export const apiUrl = import.meta.env.VITE_API_URL || "/api";
const TOKEN_KEY = "nodepad:token";

export interface Account {
  id: string;
  username: string;
  name: string;
}

/** Storage can throw (private windows, blocked site data); the session then lasts for this page load. */
function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function writeToken(token?: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

interface AuthState {
  token?: string;
  account?: Account;
  /** "loading" while a remembered session is being checked. */
  status: "loading" | "ready";
}

export const useAuth = create<AuthState>(() => ({ token: readToken(), status: readToken() ? "loading" : "ready" }));

/** fetch against the server with the session attached; a 401 means the session ended, so sign out. */
export async function api(path: string, init: RequestInit = {}) {
  const { token } = useAuth.getState();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${apiUrl}${path}`, { ...init, headers });
  if (res.status === 401 && token && !path.startsWith("/auth/login")) forget();
  return res;
}

async function accountCall(path: string, body: unknown, method = "POST") {
  const res = await api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { account?: Account; token?: string; error?: string };
  if (!res.ok || !data.account) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

export async function signIn(mode: "login" | "signup", username: string, password: string, name?: string) {
  const { account, token } = await accountCall(`/auth/${mode}`, { username, password, name: name || undefined });
  writeToken(token);
  useAuth.setState({ token, account, status: "ready" });
}

export async function rename(name: string) {
  const { account } = await accountCall("/auth/me", { name }, "PATCH");
  useAuth.setState({ account });
}

/** Drops the session here without telling the server (it already rejected it). */
export function forget() {
  writeToken(undefined);
  useAuth.setState({ token: undefined, account: undefined, status: "ready" });
}

export async function signOut() {
  await api("/auth/logout", { method: "POST" }).catch(() => undefined);
  forget();
}

// Check a remembered session once at startup.
if (useAuth.getState().token)
  void api("/auth/me")
    .then(async (res) => {
      if (res.ok) useAuth.setState({ account: ((await res.json()) as { account: Account }).account, status: "ready" });
      else forget();
    })
    // offline or server down: keep the token and let the screens retry
    .catch(() => useAuth.setState({ status: "ready" }));
