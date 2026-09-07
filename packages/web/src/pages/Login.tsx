import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client.js";

export function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await api.login(email, password);
      else await api.signup(email, password);
      onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? "Incorrect email or password."
            : err.status === 409
              ? "An account with that email already exists."
              : err.status === 400
                ? "Password must be at least 8 characters."
                : "Something went wrong. Please try again.",
        );
      } else {
        setError("Couldn't reach the server.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <h1>Smart Market Watchlist</h1>
      <p className="lede">A change engine, not a price table. See what actually moved since you last looked.</p>
      <form className="auth-form" onSubmit={submit} aria-describedby={error ? "auth-error" : undefined}>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
        {error && (
          <p id="auth-error" className="field-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
      <p className="auth-switch">
        {mode === "login" ? (
          <>
            No account yet?{" "}
            <button type="button" onClick={() => setMode("signup")}>
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button type="button" onClick={() => setMode("login")}>
              Log in
            </button>
          </>
        )}
      </p>
      <p className="auth-switch">
        Demo login: <code>demo@watchlist.local</code> / <code>demo12345</code>
      </p>
    </div>
  );
}
