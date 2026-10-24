"use client";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";

type AuthMode = "signIn" | "signUp";

export function SignInPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(mode === "signUp" ? "Creating account…" : "Signing in…");
    try {
      const client = getSupabaseBrowserClient();

      if (mode === "signUp") {
        const result = await client.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (result.error) {
          setMessage(result.error.message);
          return;
        }
        if (result.data.session) {
          const next = searchParams.get("next") ?? "/";
          router.push(next);
          router.refresh();
        } else {
          setMessage("Account created! Check your email inbox to confirm your account, then sign in.");
        }
      } else {
        const result = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (result.error) {
          setMessage(result.error.message);
          return;
        }
        const next = searchParams.get("next") ?? "/";
        router.push(next);
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication request failed.");
    }
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setMessage("");
  };

  return (
    <form className="form-stack" onSubmit={submit}>
      <div className="segmented auth-tabs" role="tablist" aria-label="Account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signIn"}
          className={`seg-btn${mode === "signIn" ? " is-active" : ""}`}
          onClick={() => switchMode("signIn")}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signUp"}
          className={`seg-btn${mode === "signUp" ? " is-active" : ""}`}
          onClick={() => switchMode("signUp")}
        >
          Create account
        </button>
      </div>

      {mode === "signUp" && (
        <label className="field">
          Full name
          <input
            className="input"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Sarah Jenkins"
          />
        </label>
      )}

      <label className="field">
        Email
        <input
          className="input"
          required
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="teacher@school.edu"
        />
      </label>

      <label className="field">
        Password
        <input
          className="input"
          required
          type="password"
          minLength={6}
          autoComplete={mode === "signUp" ? "new-password" : "current-password"}
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="At least 6 characters"
        />
      </label>

      <button className="btn btn-primary btn-block" type="submit">
        {mode === "signUp" ? "Create account" : "Sign in"}
      </button>

      {message && <p className="notice" aria-live="polite" role="status">{message}</p>}

      <p className="link-row">
        {mode === "signIn" ? "New here?" : "Already have an account?"}{" "}
        <button type="button" className="text-button" onClick={() => switchMode(mode === "signIn" ? "signUp" : "signIn")}>
          {mode === "signIn" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </form>
  );
}
