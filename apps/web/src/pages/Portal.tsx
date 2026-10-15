import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { backend, newNodeToken, RELAY_CONTROL, RELAY_DOMAIN, SUBDOMAIN_RE, type NodeRow, type User } from "../data";

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="small" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Setup({ node, token }: { node: NodeRow; token: string }) {
  const cmd = `satchel connect --relay ${RELAY_CONTROL} --token ${token}`;
  const docker = `docker run -d --name satchel --restart unless-stopped \\\n  -v /path/to/Records:/vault -v satchel-data:/data \\\n  -e SATCHEL_PASSWORD='choose-a-password' \\\n  -e SATCHEL_RELAY=${RELAY_CONTROL} -e SATCHEL_RELAY_TOKEN=${token} \\\n  ghcr.io/tianhaoz95/satchel-node:latest`;
  return (
    <div className="card setup">
      <h3>Connect {node.name}</h3>
      <p>
        <b>Copy this token now.</b> Only its hash is stored, so it can't be shown again.
      </p>
      <div className="snippet">
        <code>{token}</code>
        <Copy text={token} />
      </div>
      <p className="muted">On a machine that already runs a node:</p>
      <div className="snippet">
        <code>{cmd}</code>
        <Copy text={cmd} />
      </div>
      <p className="muted">Or start a new node on your NAS:</p>
      <div className="snippet">
        <pre>{docker}</pre>
        <Copy text={docker} />
      </div>
      <p className="muted">
        Then add{" "}
        <code>
          https://{node.subdomain}.{RELAY_DOMAIN}/mcp
        </code>{" "}
        as a custom connector in your AI agent.
      </p>
    </div>
  );
}

export default function Portal({ user }: { user: User | null }) {
  const [nodes, setNodes] = useState<NodeRow[] | null>(null);
  const [name, setName] = useState("");
  const [sub, setSub] = useState("");
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<{ node: NodeRow; token: string } | null>(null);
  const [checked, setChecked] = useState(false);

  const navigate = useNavigate();
  useEffect(() => {
    backend.user().then(() => setChecked(true));
  }, []);
  useEffect(() => {
    if (checked && !user) void navigate("/login", { replace: true });
  }, [checked, user, navigate]);
  const load = useCallback(
    () =>
      backend
        .listNodes()
        .then(setNodes)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    if (user) {
      load();
      const t = setInterval(load, 20_000);
      return () => clearInterval(t);
    }
  }, [user, load]);

  if (!user) return null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const s = sub.trim().toLowerCase();
    if (!SUBDOMAIN_RE.test(s)) return setError("Use 3–32 lowercase letters, digits or dashes.");
    try {
      const { token, hash } = await newNodeToken();
      const node = await backend.createNode(name.trim() || s, s, hash);
      setFresh({ node, token });
      setName("");
      setSub("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };
  const rotate = async (n: NodeRow) => {
    if (!confirm(`Issue a new token for ${n.name}? The old one stops working.`)) return;
    const { token, hash } = await newNodeToken();
    await backend.rotateToken(n.id, hash);
    setFresh({ node: n, token });
  };
  const revoke = async (n: NodeRow) => {
    if (!confirm(`Revoke ${n.subdomain}.${RELAY_DOMAIN}? The node goes offline for remote agents (local access keeps working).`)) return;
    await backend.revokeNode(n.id);
    load();
  };
  const active = (nodes ?? []).filter((n) => !n.revoked_at);

  return (
    <main className="container section portal">
      <div className="portal-head">
        <div>
          <p className="eyebrow">Signed in as {user.login ? `@${user.login}` : user.email}</p>
          <h1>Your nodes</h1>
        </div>
        <button type="button" onClick={() => backend.signOut()}>
          Sign out
        </button>
      </div>
      {backend.demo && <p className="note">Demo mode: Supabase isn't configured. Nodes are stored in this browser only and won't reach a real relay.</p>}
      {error && <p className="error">{error}</p>}
      {fresh && <Setup node={fresh.node} token={fresh.token} />}
      {nodes && active.length > 0 && (
        <div className="table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Address</th>
                <th>Status</th>
                <th>Last seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((n) => (
                <tr key={n.id}>
                  <td>
                    <b>{n.name}</b>
                    {n.reported_name && <div className="muted small">{n.reported_name}</div>}
                  </td>
                  <td>
                    <code>
                      https://{n.subdomain}.{RELAY_DOMAIN}/mcp
                    </code>
                  </td>
                  <td>{n.online ? <span className="pill ok">online</span> : <span className="pill">offline</span>}</td>
                  <td>{ago(n.last_seen_at)}</td>
                  <td className="actions">
                    <button type="button" className="small" onClick={() => rotate(n)}>
                      New token
                    </button>
                    <button type="button" className="small danger" onClick={() => revoke(n)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid2">
        <form className="card" onSubmit={create}>
          <h3>Add a node</h3>
          <p className="muted">Each node gets its own address and token. Most people need one: the NAS or the computer that holds their records.</p>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home NAS" />
          </label>
          <label>
            Address
            <span className="suffix-input">
              <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="alex" required />
              <span>.{RELAY_DOMAIN}</span>
            </span>
          </label>
          <button type="submit" className="primary">
            Create node
          </button>
        </form>
        <div className="card">
          <h3>What this account holds</h3>
          <ul className="plain">
            <li>Your GitHub login (username and email)</li>
            <li>Node names and addresses</li>
            <li>A SHA-256 hash of each node token</li>
            <li>Online status reported by the relay</li>
          </ul>
          <p className="muted">
            Your files, metadata, agent connections and approvals live on your node only. The relay forwards encrypted traffic it cannot read.
          </p>
          <button type="button" className="small danger" onClick={() => confirm("Delete your account and all node addresses?") && backend.deleteAccount()}>
            Delete account
          </button>
        </div>
      </div>
    </main>
  );
}
