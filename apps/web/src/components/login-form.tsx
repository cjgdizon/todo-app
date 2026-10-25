"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "magic";

const TITLES: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create your account",
  magic: "Email me a sign-in link",
};

const MIN_PASSWORD_LENGTH = 8;

export function LoginForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (mode !== "magic" && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
      return;
    }

    setBusy(true);
    const redirectTo = `${window.location.origin}/auth/callback`;
    // An invite link sends people here first; they land back on it, not on the inbox.
    const landing = safeNext(new URLSearchParams(window.location.search).get("next")) ?? "/inbox";
    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError("That email and password don't match. Check them and try again.");
          return;
        }
        router.replace(landing);
      } else if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        if (data.session) router.replace(landing);
        else setNotice("Check your email to confirm your address, then sign in.");
      } else {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        });
        if (otpError) {
          setError(otpError.message);
          return;
        }
        setNotice("We sent a sign-in link. It may take a minute to arrive.");
      }
    } finally {
      setBusy(false);
    }
  }

  const field =
    "block w-full rounded-sm border border-border bg-surface-subtle px-3 py-2 text-base text-text";

  return (
    <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-4 py-12">
      <h1 className="text-[20px] leading-7 font-semibold">{TITLES[mode]}</h1>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </div>

        {mode !== "magic" && (
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-text-muted">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 font-medium text-on-accent disabled:opacity-60"
        >
          {TITLES[mode]}
        </button>
      </form>

      <div className="mt-6 flex flex-col items-start gap-1 text-sm">
        {mode !== "signin" && (
          <button type="button" onClick={() => switchMode("signin")} className="text-accent-strong underline">
            I already have an account
          </button>
        )}
        {mode !== "signup" && (
          <button type="button" onClick={() => switchMode("signup")} className="text-accent-strong underline">
            Create an account
          </button>
        )}
        {mode !== "magic" && (
          <button type="button" onClick={() => switchMode("magic")} className="text-accent-strong underline">
            Email me a sign-in link instead
          </button>
        )}
      </div>
    </main>
  );
}
