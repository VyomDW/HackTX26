import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

/**
 * Accounts and sign-in sessions.
 *
 * Sessions are self-verifying: the token carries the account (id, username, name) and an expiry, signed with
 * SESSION_SECRET. Any server instance can check it without shared state, so a restart, a redeploy or a request
 * landing on a different serverless container no longer signs anyone out.
 *
 * Accounts (username + salted scrypt hash) live in Upstash Redis when it is configured (Vercel's KV integration
 * sets KV_REST_API_URL / KV_REST_API_TOKEN), so they survive containers too; otherwise in data/auth.json.
 */
const FILE = path.resolve(process.env.AUTH_FILE || "data/auth.json");
const SESSION_DAYS = 30;

/**
 * Signs session tokens. Set SESSION_SECRET in production; without it a stable secret is derived from the
 * server's API key so every instance of one deployment agrees, and a random one is the last resort (dev only).
 */
const SECRET =
  process.env.SESSION_SECRET ||
  (process.env.MUSE_API_KEY || process.env.MODEL_API_KEY
    ? createHash("sha256").update(`nodepad-session:${process.env.MUSE_API_KEY || process.env.MODEL_API_KEY}`).digest("hex")
    : randomBytes(32).toString("hex"));
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") console.warn("[auth] SESSION_SECRET is not set; deriving one from the API key");

const User = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  salt: z.string(),
  hash: z.string(),
  createdAt: z.number(),
});
type User = z.infer<typeof User>;
const Store = z.object({ users: z.array(User).default([]) }).passthrough();

export interface Account {
  id: string;
  username: string;
  name: string;
}

// ---- Account storage: Upstash Redis when configured, else a JSON file ----

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useKv = !!(KV_URL && KV_TOKEN);
console.log(`[auth] accounts stored in ${useKv ? "Upstash Redis" : FILE}`);

async function kv(...command: string[]): Promise<unknown> {
  const res = await fetch(KV_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || body.error) throw new Error(`Redis ${res.status}: ${body.error ?? res.statusText}`);
  return body.result;
}
const userKey = (username: string) => `nodepad:user:${username}`;

function loadFile(): z.infer<typeof Store> {
  try {
    return Store.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[auth] could not read accounts, starting empty", err);
    return { users: [] };
  }
}
const file = useKv ? { users: [] } : loadFile();
function saveFile() {
  mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify({ users: file.users }));
  renameSync(tmp, FILE);
}

async function findUser(username: string): Promise<User | undefined> {
  if (!useKv) return file.users.find((u) => u.username === username);
  const raw = await kv("GET", userKey(username));
  return typeof raw === "string" ? User.parse(JSON.parse(raw)) : undefined;
}
/** Stores a new user; false if the username is already taken (atomic in Redis). */
async function addUser(user: User): Promise<boolean> {
  if (!useKv) {
    if (file.users.some((u) => u.username === user.username)) return false;
    file.users.push(user);
    saveFile();
    return true;
  }
  return (await kv("SET", userKey(user.username), JSON.stringify(user), "NX")) === "OK";
}
async function saveUser(user: User) {
  if (useKv) await kv("SET", userKey(user.username), JSON.stringify(user));
  else saveFile();
}

// ---- Sessions: signed, self-contained tokens ----

const Payload = z.object({ id: z.string(), username: z.string(), name: z.string(), exp: z.number() });
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("base64url");

function startSession(account: Account) {
  const body = Buffer.from(JSON.stringify({ ...account, exp: Date.now() + SESSION_DAYS * 86_400_000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Tokens signed out on this instance; a best-effort list, since a signed token can't be recalled everywhere. */
const revoked = new Set<string>();

const hashOf = (password: string, salt: string) => scryptSync(password, salt, 64).toString("hex");
const publicOf = (u: User): Account => ({ id: u.id, username: u.username, name: u.name });

export const Credentials = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,32}$/, "Usernames are 3 to 32 letters, numbers, dots, dashes or underscores."),
  password: z.string().min(6, "Passwords need at least 6 characters.").max(200),
  name: z.string().trim().max(32).optional(),
});

/** Creates an account and signs it in. */
export async function signUp(input: z.infer<typeof Credentials>) {
  const salt = randomBytes(16).toString("hex");
  const user: User = {
    id: `acct-${randomUUID()}`,
    username: input.username,
    name: input.name || input.username,
    salt,
    hash: hashOf(input.password, salt),
    createdAt: Date.now(),
  };
  if (!(await addUser(user))) return { error: "That username is taken." } as const;
  return { account: publicOf(user), token: startSession(publicOf(user)) } as const;
}

export async function signIn(input: z.infer<typeof Credentials>) {
  const user = await findUser(input.username);
  const ok = user && timingSafeEqual(Buffer.from(hashOf(input.password, user.salt), "hex"), Buffer.from(user.hash, "hex"));
  if (!user || !ok) return { error: "Wrong username or password." } as const;
  return { account: publicOf(user), token: startSession(publicOf(user)) } as const;
}

export function signOut(token: string) {
  revoked.add(token);
}

export function accountOf(token: string | undefined): Account | undefined {
  if (!token || revoked.has(token)) return undefined;
  const [body, mac] = token.split(".");
  if (!body || !mac) return undefined;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  let payload;
  try {
    payload = Payload.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  } catch {
    return undefined;
  }
  if (!payload.success || payload.data.exp < Date.now()) return undefined;
  const { id, username, name } = payload.data;
  return { id, username, name };
}

/** Renames the account and returns a fresh token carrying the new name. */
export async function rename(account: Account, name: string) {
  const user = await findUser(account.username);
  if (user) {
    user.name = name;
    await saveUser(user);
  }
  const next = { ...account, name };
  return { account: next, token: startSession(next) };
}

export const tokenOf = (req: FastifyRequest) => req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

/** Route guard: the signed-in account, or a 401 already sent. */
export function requireAccount(req: FastifyRequest, reply: FastifyReply): Account | undefined {
  const account = accountOf(tokenOf(req));
  if (!account) void reply.code(401).send({ error: "Sign in to continue." });
  return account;
}
