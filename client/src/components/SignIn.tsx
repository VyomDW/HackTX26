import { useState } from "react";
import { Loader2 } from "lucide-react";
import { resendCode, signIn, signUp, verifyEmail } from "@/lib/auth";
import { MAX_NAME } from "@/lib/identity";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";

/** Sign in or create an account: a taped sheet of paper on the graph-paper desk. */
export function SignIn({ invited }: { invited?: boolean }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  /** Set once sign-up has emailed a code; the sheet then asks for it. */
  const [verifying, setVerifying] = useState<string>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const signup = mode === "signup";

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
    setBusy(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (verifying) await verifyEmail(verifying, code);
      else if (signup) {
        setVerifying(await signUp({ username, email, password, name: name.trim() || undefined }));
        setCode("");
      } else await signIn(username, password);
    });
  };

  const resend = () =>
    void run(async () => {
      await resendCode(verifying!);
      setNotice("Sent a new code.");
    });

  const field = "w-full rounded-lg border-[1.5px] border-[var(--ink)] bg-white px-3 py-2 text-sm outline-none focus:shadow-[2px_2px_0_var(--orb)]";

  return (
    <div className="ink">
      <div className="stage-bg grid min-h-dvh place-items-center p-4 font-ui text-ink">
        <form onSubmit={submit} className="ink-page taped w-full max-w-sm space-y-5 rounded-xl px-6 pb-6 pt-8">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="text-[19px] font-bold">nodepad</span>
          </div>

          {verifying ? (
            <>
              <div className="space-y-1">
                <h1 className="text-xl font-bold">Check your email</h1>
                <p className="text-sm text-dim">
                  We sent a 6-digit code to <span className="font-semibold text-ink">{verifying}</span>. Enter it to finish making your account.
                </p>
              </div>
              <label className="block space-y-1 text-sm font-medium">
                <span>Verification code</span>
                <input
                  autoFocus
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className={cn(field, "text-center font-mono text-xl tracking-[0.4em]")}
                />
              </label>
            </>
          ) : (
            <>
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
                  <span>{signup ? "Username" : "Username or email"}</span>
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
                  <>
                    <label className="block space-y-1 text-sm font-medium">
                      <span>Email</span>
                      <input
                        required
                        type="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={field}
                      />
                    </label>
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
                  </>
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
            </>
          )}

          {error && <p className="hand text-lg leading-tight text-red-700">{error}</p>}
          {notice && <p className="text-sm text-dim">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="ink-btn flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--orb)] py-2.5 text-sm font-bold text-white disabled:opacity-70"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {verifying ? "Verify email" : signup ? "Create account" : "Sign in"}
          </button>

          {verifying && (
            <div className="flex justify-between text-sm">
              <button type="button" disabled={busy} onClick={resend} className="font-semibold text-dim hover:text-ink">
                Send a new code
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setVerifying(undefined);
                  setError(undefined);
                  setNotice(undefined);
                }}
                className="text-dim hover:text-ink"
              >
                Use a different email
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
