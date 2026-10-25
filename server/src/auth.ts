import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

/**
 * Accounts and sign-in sessions, kept in one JSON file next to the saved rooms (data/auth.json).
 * Passwords are salted scrypt hashes. A session is a random bearer token the browser keeps and
 * sends as `Authorization: Bearer …` (and in the WebSocket join), so it works whether the client
 * is served by this server or from another origin.
 */
const FILE = path.resolve(process.env.AUTH_FILE || "data/auth.json");
const SESSION_DAYS = 30;

const User = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  salt: z.string(),
  hash: z.string(),
  createdAt: z.number(),
});
type User = z.infer<typeof User>;
const Session = z.object({ userId: z.string(), expiresAt: z.number() });
const Store = z.object({ users: z.array(User).default([]), sessions: z.record(z.string(), Session).default({}) });

export interface Account {
  id: string;
  username: string;
  name: string;
}

function load(): z.infer<typeof Store> {
  try {
    return Store.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn("[auth] could not read accounts, starting empty", err);
    return { users: [], sessions: {} };
  }
}

const store = load();

function save() {
  mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(store));
  renameSync(tmp, FILE);
}

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

function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  store.sessions[token] = { userId, expiresAt: Date.now() + SESSION_DAYS * 86_400_000 };
  save();
  return token;
}

/** Creates an account and signs it in. */
export function signUp(input: z.infer<typeof Credentials>) {
  if (store.users.some((u) => u.username === input.username)) return { error: "That username is taken." } as const;
  const salt = randomBytes(16).toString("hex");
  const user: User = {
    id: `acct-${randomUUID()}`,
    username: input.username,
    name: input.name || input.username,
    salt,
    hash: hashOf(input.password, salt),
    createdAt: Date.now(),
  };
  store.users.push(user);
  return { account: publicOf(user), token: startSession(user.id) } as const;
}

export function signIn(input: z.infer<typeof Credentials>) {
  const user = store.users.find((u) => u.username === input.username);
  const ok = user && timingSafeEqual(Buffer.from(hashOf(input.password, user.salt), "hex"), Buffer.from(user.hash, "hex"));
  if (!user || !ok) return { error: "Wrong username or password." } as const;
  return { account: publicOf(user), token: startSession(user.id) } as const;
}

export function signOut(token: string) {
  if (store.sessions[token]) {
    delete store.sessions[token];
    save();
  }
}

export function accountOf(token: string | undefined): Account | undefined {
  if (!token) return undefined;
  const session = store.sessions[token];
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    signOut(token);
    return undefined;
  }
  const user = store.users.find((u) => u.id === session.userId);
  return user && publicOf(user);
}

export function rename(userId: string, name: string) {
  const user = store.users.find((u) => u.id === userId);
  if (!user) return undefined;
  user.name = name;
  save();
  return publicOf(user);
}

export const tokenOf = (req: FastifyRequest) => req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

/** Route guard: the signed-in account, or a 401 already sent. */
export function requireAccount(req: FastifyRequest, reply: FastifyReply): Account | undefined {
  const account = accountOf(tokenOf(req));
  if (!account) void reply.code(401).send({ error: "Sign in to continue." });
  return account;
}
