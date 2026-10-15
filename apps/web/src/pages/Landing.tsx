import { Link } from "react-router-dom";

const agents = ["Claude", "ChatGPT", "Gemini", "Claude Code", "Cursor", "Local models"];

export default function Landing() {
  return (
    <main>
      <section className="container hero">
        <div>
          <p className="eyebrow">Open source · MCP · Self-hostable</p>
          <h1>Your records, readable by any AI agent. Carried by you.</h1>
          <p className="lead">
            Driver license, car registration, eye prescription, passport, lease. Satchel keeps them organized in your own folders and lets whichever AI agent
            you use this year look them up, file new ones and remind you before anything expires.
          </p>
          <div className="row">
            <Link className="button primary" to="/docs/quick-start">
              Get started
            </Link>
            <Link className="button" to="/docs">
              Read the docs
            </Link>
          </div>
          <p className="muted small">Works with {agents.join(", ")}, and anything else that speaks MCP.</p>
        </div>
        <figure className="chat" aria-label="Example conversation">
          <div className="msg user">What do I need to renew soon?</div>
          <div className="tool">
            <span>satchel · list_expiring</span>
            <code>within_days: 90</code>
          </div>
          <div className="msg agent">
            <p>Three things in the next 90 days:</p>
            <ul>
              <li>
                <b>Civic registration</b>: 21 days. DMV renewal is online.
              </li>
              <li>
                <b>Eye prescription</b>: 38 days. Want me to find an exam slot?
              </li>
              <li>
                <b>Auto insurance</b>: 92 days.
              </li>
            </ul>
            <p>Your passport expires in 150 days. VAULT.md says to start 6 months early, so it's already time.</p>
          </div>
          <div className="msg user">Send me the plate number for the DMV form.</div>
          <div className="tool">
            <span>satchel · deliver_to_user</span>
            <code>plate_number → your phone</code>
          </div>
          <div className="msg agent">Sent to your phone. I didn't see the number.</div>
        </figure>
      </section>

      <section className="band">
        <div className="container section">
          <h2>Switch agents without starting over</h2>
          <div className="grid3">
            <div>
              <h3>Files stay in your folders</h3>
              <p>A local folder, a NAS share, or a folder synced by Google Drive, Dropbox or OneDrive. Satchel indexes them in place and never uploads them.</p>
            </div>
            <div>
              <h3>Everything is plain text</h3>
              <p>
                Metadata lives next to each file as a small YAML sidecar. Agent instructions live in <code>VAULT.md</code>. Every change is journaled and can be
                undone.
              </p>
            </div>
            <div>
              <h3>Any MCP agent, scoped</h3>
              <p>Connect agents with OAuth. Pick which folders each one sees and whether it can edit, reorganize or see sensitive numbers.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="container section">
        <h2>How it fits together</h2>
        <div className="flow">
          <div className="flow-box">
            <b>AI agents</b>
            <span>Claude, ChatGPT, Gemini…</span>
          </div>
          <div className="flow-arrow">
            MCP over HTTPS
            <br />
            <small>encrypted end to end</small>
          </div>
          <div className="flow-box">
            <b>Relay</b>
            <span>forwards encrypted bytes, routes by name</span>
          </div>
          <div className="flow-arrow">
            outbound tunnel
            <br />
            <small>no port forwarding</small>
          </div>
          <div className="flow-box accent">
            <b>Your node</b>
            <span>NAS, desktop or server. Holds keys, files, approvals</span>
          </div>
        </div>
        <p className="muted center">Your phone pairs with your node to approve requests and receive values agents send you.</p>
      </section>

      <section className="band">
        <div className="container section">
          <h2>Who sees what</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Party</th>
                <th>Can see</th>
                <th>Cannot see</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Your node</td>
                <td>Everything (it's yours)</td>
                <td>–</td>
              </tr>
              <tr>
                <td>The relay</td>
                <td>Your subdomain, connection times, byte counts</td>
                <td>Requests, responses, tokens, files</td>
              </tr>
              <tr>
                <td>This website</td>
                <td>Your email and a hash of your node token</td>
                <td>Anything in your vault</td>
              </tr>
              <tr>
                <td>An agent's model</td>
                <td>Answers it asked for, masked identifiers</td>
                <td>Sensitive values, unless you approve on your phone</td>
              </tr>
            </tbody>
          </table>
          <p>
            <Link to="/docs/security">Read the security model →</Link>
          </p>
        </div>
      </section>

      <section className="container section">
        <div className="grid3">
          <div>
            <h3>Approve from your phone</h3>
            <p>Agents ask before they see a passport number or move files. Your phone shows the facts first; the agent's reason is labeled unverified.</p>
          </div>
          <div>
            <h3>Snap a new document</h3>
            <p>Photograph the new registration card. It lands in your vault's Inbox, and your agent files and dates it next time it checks in.</p>
          </div>
          <div>
            <h3>Runs on your NAS</h3>
            <p>
              One Docker container on Synology, Unraid, TrueNAS or anything always-on. Or use the desktop app, which adds local OCR and an optional on-device
              model.
            </p>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="container section cta">
          <h2>Bring your own agent. Keep your own records.</h2>
          <div className="row center-row">
            <Link className="button primary" to="/login">
              Get a free relay address
            </Link>
            <Link className="button" to="/docs/self-hosting">
              Self-host everything
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
