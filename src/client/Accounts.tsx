import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { UserStatus } from "../shared/types";
import { errorMessage, request, type ProvidersResponse } from "./api";
import { authClient, signOutAndReload } from "./auth";
import { ErrorView, Loading } from "./ui";

export function Login() {
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => request<ProvidersResponse>("/api/providers"),
    staleTime: 5 * 60_000,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  async function signInProvider(id: string) {
    setError(null);
    setBusy(id);
    try {
      const result = await authClient.signIn.social({ provider: id, callbackURL: "/" });
      if (result.error) setError(result.error.message || "Could not sign in.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy("password");
    try {
      const result = setup
        ? await authClient.signUp.email({
            email: email.trim(),
            password,
            name: name.trim() || email.trim().split("@")[0],
          })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(result.error.message || "Could not sign in.");
        return;
      }
      window.location.assign("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const passwordEnabled = providers.data?.password ?? false;
  const providerList = providers.data?.providers ?? [];

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">AniManga</div>
        <p className="auth-sub">Sign in to browse your library.</p>

        {providers.isPending && <Loading />}
        {providers.isError && <ErrorView error={providers.error} onRetry={() => providers.refetch()} />}

        {providers.isSuccess && (
          <>
            {providerList.length > 0 && (
              <div className="stack">
                {providerList.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={busy !== null}
                    onClick={() => signInProvider(provider.id)}
                  >
                    {busy === provider.id ? "Redirecting…" : `Continue with ${provider.label}`}
                  </button>
                ))}
              </div>
            )}

            {providerList.length > 0 && passwordEnabled && <div className="divider">or</div>}

            {passwordEnabled && (
              <form className="stack" onSubmit={submitPassword}>
                {setup && (
                  <label className="field">
                    <span>Name</span>
                    <input
                      className="input"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your name"
                    />
                  </label>
                )}
                <label className="field">
                  <span>Email</span>
                  <input
                    className="input"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete={setup ? "new-password" : "current-password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                  />
                </label>
                <button type="submit" className="btn btn-primary btn-block" disabled={busy !== null}>
                  {busy === "password" ? "Please wait…" : setup ? "Create account" : "Sign in"}
                </button>
              </form>
            )}

            {passwordEnabled && (
              <p className="auth-switch">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setSetup((value) => !value);
                    setError(null);
                  }}
                >
                  {setup ? "Already have an account? Sign in" : "First time? Create an account"}
                </button>
              </p>
            )}

            {setup && (
              <p className="muted auth-note">The first account becomes the administrator. Later accounts wait for approval.</p>
            )}

            {!passwordEnabled && providerList.length === 0 && (
              <p className="muted">No sign-in methods are configured for this server.</p>
            )}
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function Pending({
  email,
  status,
  reason,
}: {
  email?: string | null;
  status: UserStatus;
  reason?: string;
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">AniManga</div>
        <h1>{status === "blocked" ? "Access blocked" : "Waiting for approval"}</h1>

        {!email && reason ? (
          <p className="form-error" role="alert">
            {reason}
          </p>
        ) : status === "pending" ? (
          <p>
            {email ? (
              <>
                Your account is waiting for admin approval. Ask the admin to add <strong>{email}</strong> in Admin →
                Users.
              </>
            ) : (
              "Your account is waiting for admin approval."
            )}
          </p>
        ) : (
          <p>
            Your account{email ? ` (${email})` : ""} has been blocked by the administrator.
          </p>
        )}

        <button type="button" className="btn btn-primary" onClick={signOutAndReload}>
          Sign out
        </button>
      </div>
    </div>
  );
}
