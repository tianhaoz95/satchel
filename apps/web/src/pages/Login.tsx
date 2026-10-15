import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { backend, type User } from "../data";

export default function Login({ user }: { user: User | null }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    if (user) void navigate("/portal", { replace: true });
  }, [user]);
  if (user) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await backend.signInWithEmail(email);
      if (!backend.demo) setSent(true);
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <main className="container section">
      <form className="card narrow" onSubmit={submit}>
        <p className="eyebrow">Satchel account</p>
        <h1>Sign in</h1>
        <p className="muted">An account gives you a relay address like <code>you.satchel.dev</code>. It stores your email and node names, never anything from your vault.</p>
        {backend.demo && <p className="note">Demo mode: Supabase isn't configured, so this portal keeps data in your browser only.</p>}
        {error && <p className="error">{error}</p>}
        {sent ? (
          <p className="note">Check your email for a sign-in link.</p>
        ) : (
          <>
            <label>
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <div className="row">
              <button className="primary">Email me a link</button>
              <button type="button" onClick={() => backend.signInWithGitHub().catch((e) => setError(e.message))}>Continue with GitHub</button>
            </div>
          </>
        )}
      </form>
    </main>
  );
}
