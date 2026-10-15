import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { backend, type User } from "./data";
import Landing from "./pages/Landing";
import Docs from "./pages/Docs";
import Login from "./pages/Login";
import Portal from "./pages/Portal";

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" fill="none" width="22" height="22" aria-hidden>
      <rect x="3" y="7" width="26" height="20" rx="4" fill="var(--accent)" />
      <path d="M3 12h26" stroke="var(--bg)" strokeWidth="2" />
      <rect x="11" y="4" width="10" height="6" rx="2" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="16" cy="19" r="3" fill="var(--bg)" />
    </svg>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const loc = useLocation();
  useEffect(() => {
    backend.user().then(setUser);
    return backend.onAuth(setUser);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to top whenever the route changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  return (
    <>
      <header className="site-head">
        <div className="container head-row">
          <Link to="/" className="brand">
            <Logo /> Satchel
          </Link>
          <nav className="top-nav">
            <NavLink to="/docs">Docs</NavLink>
            <a href="https://github.com/tianhaoz95/satchel">GitHub</a>
            {user ? (
              <NavLink to="/portal" className="button small">
                Portal
              </NavLink>
            ) : (
              <NavLink to="/login" className="button small">
                Sign in
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:slug" element={<Docs />} />
        <Route path="/login" element={<Login user={user} />} />
        <Route path="/portal/*" element={<Portal user={user} />} />
        <Route
          path="*"
          element={
            <div className="container section">
              <h1>Not found</h1>
              <Link to="/">Go home</Link>
            </div>
          }
        />
      </Routes>
      <footer className="site-foot">
        <div className="container foot-row">
          <span className="muted">Satchel is open source (Apache-2.0). Your files never leave your folders.</span>
          <span className="foot-links">
            <Link to="/docs/security">Security</Link>
            <Link to="/docs/self-hosting">Self-host</Link>
            <a href="https://github.com/tianhaoz95/satchel">Source</a>
          </span>
        </div>
      </footer>
    </>
  );
}
