import { useState } from "react";
import { supabase } from "../supabaseClient";
import "./LoginPage.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function handleMagicLink(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMessage("Check your email — a login link has been sent.");
    }
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    });
  }

  async function handleGitHub() {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-logo">Work<span>Trace</span></h1>
        <p className="login-subtitle">Sign in to access your personal workspace.</p>

        <div className="oauth-buttons">
          <button className="oauth-btn google" onClick={handleGoogle}>
            Continue with Google
          </button>
          <button className="oauth-btn github" onClick={handleGitHub}>
            Continue with GitHub
          </button>
        </div>

        <div className="divider"><span>or</span></div>

        <form onSubmit={handleMagicLink} className="magic-form">
          <input
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="magic-input"
          />
          <button type="submit" disabled={loading} className="magic-btn">
            {loading ? "Sending…" : "Send magic link"}
          </button>
        </form>

        {message && <p className="login-msg success">{message}</p>}
        {error   && <p className="login-msg error">{error}</p>}
      </div>
    </div>
  );
}
