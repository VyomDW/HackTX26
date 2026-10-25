import { useState } from "react";
import { Loader2 } from "lucide-react";
import { signIn } from "@/lib/auth";
import { MAX_NAME } from "@/lib/identity";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";

/** Sign in or create an account: a taped sheet of paper on the graph-paper desk. */
export function SignIn({ invited }: { invited?: boolean }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const signup = mode === "signup";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signIn(mode, username, password, signup ? name.trim() : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border-[1.5px] border-[var(--ink)] bg-white px-3 py-2 text-sm outline-none focus:shadow-[2px_2px_0_var(--orb)]";

  return (
    <div className="ink">
      <div className="stage-bg grid min-h-dvh place-items-center p-4 font-ui text-ink">
        <form onSubmit={submit} className="ink-page taped w-full max-w-sm space-y-5 rounded-xl px-6 pb-6 pt-8">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="text-[19px] font-bold">nodepad</span>
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold">{signup ? "Make your nodepad" : "Welcome back"}</h1>
            <p className="text-sm text-dim">
              {invited
                ? "Sign in to open the file you were invited to. It'll show up in your files too."
                : signup
                  ? "Your files and recent work, kept under one account."
                  : "Sign in to get back to your files."}
            </p>
          </div>

          <div className="grid grid-cols-2 rounded-lg border-[1.5px] border-[var(--ink)] p-0.5 text-sm font-semibold">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(undefined);
                }}
                className={cn("rounded-md py-1.5", mode === m ? "bg-[var(--ink)] text-[var(--page)]" : "text-dim hover:text-ink")}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <label className="block space-y-1 text-sm font-medium">
              <span>Username</span>
              <input
                autoFocus
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={field}
              />
            </label>
            {signup && (
              <label className="block space-y-1 text-sm font-medium">
                <span>
                  Display name <span className="font-normal text-dim">(what others see)</span>
                </span>
                <input
                  value={name}
                  maxLength={MAX_NAME}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                  placeholder={username || "Your name"}
                  className={field}
                />
              </label>
            )}
            <label className="block space-y-1 text-sm font-medium">
              <span>Password</span>
              <input
                required
                type="password"
                minLength={signup ? 6 : undefined}
                autoComplete={signup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
            </label>
          </div>

          {error && <p className="hand text-lg leading-tight text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="ink-btn flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--orb)] py-2.5 text-sm font-bold text-white disabled:opacity-70"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {signup ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
