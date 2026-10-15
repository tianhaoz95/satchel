// Satchel node admin UI. Plain modules, no build step: the node serves this folder as-is.
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const root = $("#root");

async function api(path, opts = {}) {
  const res = await fetch(`/admin/api${path}`, {
    method: opts.method ?? "GET",
    headers: opts.body ? { "content-type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/login") {
    renderLogin();
    throw new Error("signed out");
  }
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

const ago = (ms) => {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const daysLeft = (date) => Math.round((Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000);
const dayPill = (date) => {
  const d = daysLeft(date);
  const cls = d < 0 ? "bad" : d <= 60 ? "warn" : "ok";
  return `<span class="pill ${cls} days">${d < 0 ? `${-d} d overdue` : d === 0 ? "today" : `${d} d`}</span>`;
};
const PLATFORMS = { ios: "iPhone", android: "Android", watchos: "Apple Watch", wearos: "Wear OS" };
const ACTIONS = { reveal_field: "See a sensitive value", apply_plan: "Reorganize files", update_conventions: "Change VAULT.md", set_metadata: "Edit metadata" };
const LOGO = `<svg viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="26" height="20" rx="4" fill="var(--accent)"/><path d="M3 12h26" stroke="var(--surface)" stroke-width="2"/><rect x="11" y="4" width="10" height="6" rx="2" stroke="var(--accent)" stroke-width="2"/><circle cx="16" cy="19" r="3" fill="var(--surface)"/></svg>`;

// ------------------------------------------------------------------ login

// ------------------------------------------------------------------ passkeys (WebAuthn, no build step)

/** WebAuthn needs a hostname as relying party: IP addresses (127.0.0.1, LAN IPs) can't hold passkeys. */
const passkeyCapable = () => !!window.PublicKeyCredential && window.isSecureContext && !/^[\d.]+$|^\[/.test(location.hostname);

const b64u = {
  toBuf: (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)).buffer,
  fromBuf: (b) =>
    btoa(String.fromCharCode(...new Uint8Array(b)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, ""),
};

async function passkeyCreate(o) {
  const cred = await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: b64u.toBuf(o.challenge),
      user: { ...o.user, id: b64u.toBuf(o.user.id) },
      excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ ...c, id: b64u.toBuf(c.id) })),
    },
  });
  return {
    id: cred.id,
    rawId: b64u.fromBuf(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: b64u.fromBuf(cred.response.clientDataJSON),
      attestationObject: b64u.fromBuf(cred.response.attestationObject),
      transports: cred.response.getTransports?.() ?? [],
    },
  };
}

async function passkeyGet(o) {
  const cred = await navigator.credentials.get({
    publicKey: { ...o, challenge: b64u.toBuf(o.challenge), allowCredentials: (o.allowCredentials ?? []).map((c) => ({ ...c, id: b64u.toBuf(c.id) })) },
  });
  return {
    id: cred.id,
    rawId: b64u.fromBuf(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: b64u.fromBuf(cred.response.clientDataJSON),
      authenticatorData: b64u.fromBuf(cred.response.authenticatorData),
      signature: b64u.fromBuf(cred.response.signature),
      userHandle: cred.response.userHandle ? b64u.fromBuf(cred.response.userHandle) : undefined,
    },
  };
}

async function renderLogin(error = "") {
  const s = await fetch("/admin/api/session", { credentials: "same-origin" })
    .then((r) => r.json())
    .catch(() => ({}));
  const canPasskey = s.passkeys && passkeyCapable();
  root.innerHTML = `<main class="wrap"><form class="card narrow" id="login">
    <div class="brand" style="padding:0 0 12px">${LOGO} Satchel</div>
    <h1>Sign in to your node</h1>
    <p class="muted">${canPasskey ? "Use your passkey, or the owner password you set with <code>satchel init</code>." : "Use the owner password you set with <code>satchel init</code>."}</p>
    ${error ? `<p class="error">${esc(error)}</p>` : ""}
    ${canPasskey ? `<button type="button" class="primary" id="passkey" style="width:100%;justify-content:center">Sign in with a passkey</button><p class="muted" style="text-align:center;margin:14px 0 0">or</p>` : ""}
    <label>Owner password<input type="password" name="password" ${canPasskey ? "" : "autofocus"} required></label>
    <div class="row"><button class="${canPasskey ? "" : "primary"}">Sign in</button></div></form></main>`;
  if (canPasskey)
    $("#passkey").onclick = async () => {
      try {
        const { id, options } = await api("/login/passkey/options", { method: "POST", body: {} });
        await api("/login/passkey/verify", { method: "POST", body: { id, response: await passkeyGet(options) } });
        start();
      } catch (err) {
        renderLogin(err.name === "NotAllowedError" ? "Passkey sign-in was cancelled." : err.message);
      }
    };
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/login", { method: "POST", body: { password: e.target.password.value } });
      start();
    } catch (err) {
      renderLogin(err.message);
    }
  };
}

// ------------------------------------------------------------------ shell

const PAGES = [
  ["overview", "Overview"],
  ["records", "Records"],
  ["approvals", "Approvals"],
  ["connections", "Connections"],
  ["journal", "Journal"],
  ["activity", "Activity"],
  ["conventions", "VAULT.md"],
  ["security", "Security"],
  ["phone", "Phone"],
  ["settings", "Settings"],
];
let state = { pending: 0, name: "" };

function shell(active, title, actions, body) {
  root.innerHTML = `<div class="shell">
    <aside class="side"><div class="brand">${LOGO} Satchel</div>
      <nav class="nav">${PAGES.map(([id, label]) => `<a href="#${id}" class="${id === active ? "active" : ""}">${label}${id === "approvals" && state.pending ? `<span class="count">${state.pending}</span>` : ""}</a>`).join("")}</nav>
      <div class="foot">${esc(state.name)}<br><a href="#" id="logout">Sign out</a></div></aside>
    <section class="main"><div class="head"><div><p class="eyebrow">${esc(state.name)}</p><h1>${title}</h1></div><div class="row" style="margin:0">${actions ?? ""}</div></div>${body}</section></div>`;
  $("#logout").onclick = async (e) => {
    e.preventDefault();
    await api("/logout", { method: "POST" });
    renderLogin();
  };
}

async function route() {
  const page = (location.hash.slice(1) || "overview").split("?")[0];
  try {
    const ov = await api("/overview");
    state = { pending: ov.pending, name: ov.name };
    const fn = { overview, records, approvals, connections, journal, activity, conventions, security, phone, settings }[page] ?? overview;
    await fn(ov);
  } catch (err) {
    if (err.message !== "signed out") console.error(err);
  }
}

// ------------------------------------------------------------------ pages

async function overview(ov) {
  const t = ov.tunnel;
  const tunnel =
    t.state === "online"
      ? `<span class="dot on"></span>Online`
      : t.state === "off"
        ? `<span class="dot"></span>Local only`
        : `<span class="dot err"></span>${esc(t.state)}${t.error ? `: ${esc(t.error)}` : ""}`;
  shell(
    "overview",
    "Overview",
    `<button id="rescan">Rescan</button>`,
    `<div class="grid g4">
      <div class="stat"><b>${ov.stats.files}</b><span>files indexed</span></div>
      <div class="stat"><b>${ov.stats.files - ov.stats.with_metadata}</b><span>need metadata</span></div>
      <div class="stat"><b>${ov.connections}</b><span>connected agents</span></div>
      <div class="stat"><b>${ov.pending}</b><span>waiting for approval</span></div>
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h3 style="margin-top:0">Coming up</h3>
        ${ov.upcoming.length ? `<div class="list">${ov.upcoming.map((u) => `<div><div><b>${esc(u.title)}</b><div class="muted" style="font-size:.85rem">${esc(u.subject ?? "")} · ${esc(u.key.replace("_", " "))} ${esc(u.date)}</div></div>${dayPill(u.date)}</div>`).join("")}</div>` : `<p class="muted">No dated records yet. Ask an agent to process your files, or add <code>expires_on</code> in Records.</p>`}
      </div>
      <div class="card"><h3 style="margin-top:0">Reachability</h3>
        <div class="list">
          <div><span>Relay tunnel</span><span>${tunnel}</span></div>
          <div><span>Public MCP URL</span><code>${ov.public_url ? `${esc(ov.public_url)}/mcp` : "not connected"}</code></div>
          <div><span>Local MCP URL</span><code>${esc(ov.local_url)}/mcp</code></div>
          <div><span>Last agent activity</span><span>${ago(ov.last_agent_activity)}</span></div>
          <div><span>Paired phones</span><span>${ov.devices}</span></div>
        </div>
        <h3>Folders</h3><div class="list">${ov.roots.map((r) => `<div><b>${esc(r.name)}</b><span class="path">${esc(r.path)}</span></div>`).join("")}</div>
      </div>
    </div>`,
  );
  $("#rescan").onclick = async () => {
    await api("/rescan", { method: "POST" });
    toast("Index refreshed");
    route();
  };
}

async function records() {
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const q = params.get("q") ?? "";
  const filter = params.get("f") ?? "all";
  const rows = await api(`/files?q=${encodeURIComponent(q)}${filter === "todo" ? "&has_metadata=false" : filter === "done" ? "&has_metadata=true" : ""}`);
  shell(
    "records",
    "Records",
    "",
    `<div class="toolbar"><input type="search" id="q" placeholder="Search names, metadata and document text" value="${esc(q)}">
      <select id="f" style="width:auto;margin:0"><option value="all">All files</option><option value="todo" ${filter === "todo" ? "selected" : ""}>Needs metadata</option><option value="done" ${filter === "done" ? "selected" : ""}>Has metadata</option></select></div>
    ${
      rows.length
        ? `<div class="tablewrap"><table><thead><tr><th>Record</th><th>Type</th><th>Subject</th><th>Expires</th></tr></thead><tbody>
      ${rows
        .map(
          (r) => `<tr class="click" data-path="${esc(r.path)}"><td><b>${esc(r.metadata?.title ?? r.name)}</b><div class="path">${esc(r.path)}</div></td>
        <td>${r.metadata?.doc_type ? `<span class="pill">${esc(r.metadata.doc_type)}</span>` : `<span class="pill warn">needs metadata</span>`}</td>
        <td>${esc(r.metadata?.subject ?? "")}</td><td>${r.metadata?.expires_on ? `${esc(r.metadata.expires_on)} ${dayPill(r.metadata.expires_on)}` : ""}</td></tr>`,
        )
        .join("")}</tbody></table></div>`
        : `<div class="empty">No files match.</div>`
    }`,
  );
  const go = () => (location.hash = `records?q=${encodeURIComponent($("#q").value)}&f=${$("#f").value}`);
  $("#q").onkeydown = (e) => e.key === "Enter" && go();
  $("#f").onchange = go;
  for (const tr of root.querySelectorAll("tr.click")) tr.onclick = () => openRecord(tr.dataset.path);
}

async function openRecord(path) {
  const r = await api(`/file?path=${encodeURIComponent(path)}`);
  const meta = r.metadata ?? {};
  const keys = Object.keys(meta).filter((k) => k !== "sensitive");
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const d = document.createElement("div");
  d.className = "drawer";
  const row = (k = "", v = "") => {
    const sens = r.sensitive.includes(k);
    return `<div class="kv"><input value="${esc(k)}" placeholder="key"><input value="${esc(Array.isArray(v) ? v.join(", ") : v)}" placeholder="value" ${sens ? 'type="password"' : ""}><button class="danger" title="Remove" data-rm>×</button></div>`;
  };
  d.innerHTML = `<p class="eyebrow">Record</p><h2 style="margin-top:4px">${esc(meta.title ?? r.name)}</h2><div class="path">${esc(r.path)}</div>
    <div class="row"><a class="button" href="/admin/api/file/raw?path=${encodeURIComponent(r.path)}" target="_blank">Open file</a><button id="close">Close</button></div>
    <h3>Metadata</h3><p class="muted" style="font-size:.85rem">Stored next to the file as plain YAML. Sensitive fields (${esc(r.sensitive.join(", ") || "none")}) are masked for agents.</p>
    <div id="kvs">${keys.map((k) => row(k, meta[k])).join("")}${keys.length ? "" : row("doc_type") + row("title") + row("subject") + row("expires_on")}</div>
    <div class="row"><button id="add">Add field</button><button class="primary" id="save">Save</button></div>
    <h3>Extracted text</h3>${r.text ? `<pre class="snippet" style="max-height:320px;overflow:auto">${esc(r.text)}</pre>` : `<p class="muted">No text yet. The desktop helper can OCR images and scans.</p>`}`;
  document.body.append(scrim, d);
  const close = () => {
    d.remove();
    scrim.remove();
  };
  scrim.onclick = close;
  $("#close", d).onclick = close;
  $("#add", d).onclick = () => $("#kvs", d).insertAdjacentHTML("beforeend", row());
  d.addEventListener("click", (e) => e.target.matches("[data-rm]") && e.target.parentElement.remove());
  $("#save", d).onclick = async () => {
    const fields = {};
    for (const kv of d.querySelectorAll(".kv")) {
      const [k, v] = kv.querySelectorAll("input");
      if (!k.value.trim()) continue;
      fields[k.value.trim()] =
        k.value.trim() === "tags"
          ? v.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : v.value;
    }
    for (const k of keys) if (!(k in fields)) fields[k] = null;
    await api("/file/meta", { method: "PUT", body: { path: r.path, fields } });
    toast("Saved");
    close();
    route();
  };
}

async function approvals() {
  const list = await api("/approvals");
  const pending = list.filter((a) => a.status === "pending");
  const done = list.filter((a) => a.status !== "pending").slice(0, 20);
  const card = (a) => `<div class="approval">
    <div class="row" style="margin:0;justify-content:space-between"><b>${esc(ACTIONS[a.action] ?? a.action)}</b>${a.status === "pending" ? `<span class="pill warn">waiting</span>` : `<span class="pill ${a.status === "approved" || a.status === "used" ? "ok" : "bad"}">${esc(a.status)}</span>`}</div>
    <dl class="facts"><dt>Agent</dt><dd>${esc(a.client_name)}</dd><dt>Target</dt><dd><code>${esc(a.target)}</code></dd><dt>Requested</dt><dd>${ago(a.created_at)}</dd>
    ${a.detail.preview ? `<dt>Value</dt><dd><code>${esc(a.detail.preview)}</code> (shown to the agent only if you approve)</dd>` : ""}</dl>
    ${a.detail.moves ? `<div class="moves">${a.detail.moves.map((m) => `<div>${esc(m.from)}<br><span class="to">→ ${esc(m.to)}</span></div>`).join("")}</div>` : ""}
    ${a.detail.text ? `<details><summary>Proposed VAULT.md</summary><pre class="snippet">${esc(a.detail.text)}</pre></details>` : ""}
    ${a.detail.fields ? `<pre class="snippet">${esc(JSON.stringify(a.detail.fields, null, 2))}</pre>` : ""}
    ${a.reason ? `<div class="reason"><span class="eyebrow">Agent's stated reason (unverified)</span><br>${esc(a.reason)}</div>` : ""}
    ${a.result?.error ? `<p class="error">${esc(a.result.error)}</p>` : ""}
    ${
      a.status !== "pending"
        ? `${a.decided_by ? `<p class="muted" style="margin:6px 0 0;font-size:.88rem">Decided by ${esc(a.decided_by)}${a.decision_signature ? " · hardware-signed" : ""}</p>` : ""}`
        : a.requires_signature
          ? `<div class="row"><span class="pill ok">Approve on your phone</span><span class="muted" style="font-size:.88rem">High-risk: needs a decision signed by a paired device.</span><button data-no="${a.id}">Deny</button></div>`
          : `<div class="row"><button class="primary" data-ok="${a.id}">Approve</button><button data-no="${a.id}">Deny</button></div>`
    }</div>`;
  shell(
    "approvals",
    "Approvals",
    "",
    `<p class="muted">Agents ask here (and on your phone) before they see a sensitive value, move files, or change VAULT.md. Check the facts; the agent's reason may be wrong.</p>
    ${pending.length ? pending.map(card).join("") : `<div class="empty">Nothing waiting.</div>`}
    ${done.length ? `<h2>Recent decisions</h2>${done.map(card).join("")}` : ""}`,
  );
  for (const b of root.querySelectorAll("[data-ok],[data-no]"))
    b.onclick = async () => {
      const approve = !!b.dataset.ok;
      try {
        await api(`/approvals/${b.dataset.ok ?? b.dataset.no}`, { method: "POST", body: { decision: approve ? "approved" : "denied" } });
        toast(approve ? "Approved" : "Denied");
      } catch (err) {
        toast(err.message);
      }
      route();
    };
}

async function connections(ov) {
  const conns = await api("/connections");
  const url = ov.public_url ? `${ov.public_url}/mcp` : `${ov.local_url}/mcp`;
  shell(
    "connections",
    "Connections",
    "",
    `<div class="grid g2"><div class="card"><h3 style="margin-top:0">Connect an agent with OAuth</h3>
      <p class="muted">Add this URL as a custom connector (Claude, ChatGPT and other MCP clients). You'll see a consent page where you pick folders and permissions.</p>
      <div class="snippet">${esc(url)}</div></div>
      <div class="card"><h3 style="margin-top:0">Or create an access token</h3>
      <form id="tok"><label>Name<input type="text" name="label" placeholder="Claude Code on laptop" required></label>
      <fieldset><legend>Folders</legend>${ov.roots.map((r) => `<label class="check"><input type="checkbox" name="roots" value="${esc(r.name)}" checked> ${esc(r.name)}</label>`).join("")}</fieldset>
      <fieldset><legend>Permissions</legend><label class="check"><input type="checkbox" checked disabled> read</label>
      ${["write", "organize", "reveal"].map((s) => `<label class="check"><input type="checkbox" name="scopes" value="${s}" ${s === "write" ? "checked" : ""}> ${s}${s === "reveal" ? ' <span class="muted">(unmasked, no approval)</span>' : ""}</label>`).join("")}</fieldset>
      <button class="primary">Create token</button></form><div id="newtok"></div></div></div>
    <h2>Connected</h2>
    ${
      conns.length
        ? `<div class="tablewrap"><table><thead><tr><th>Agent</th><th>Kind</th><th>Folders</th><th>Permissions</th><th>Last used</th><th></th></tr></thead><tbody>
    ${conns
      .map(
        (
          c,
        ) => `<tr><td><b>${esc(c.name)}</b></td><td>${c.kind === "oauth" ? "OAuth" : "Token"}</td><td>${esc(c.grant.roots.join(", "))}</td><td>${c.grant.scopes.map((s) => `<span class="pill ${s === "reveal" ? "warn" : ""}">${esc(s)}</span>`).join(" ")}</td><td>${ago(c.last_used_at)}</td>
      <td><button class="danger" data-revoke="${esc(c.kind === "token" ? `pat:${c.hash}` : c.client_id)}">Revoke</button></td></tr>`,
      )
      .join("")}</tbody></table></div>`
        : `<div class="empty">No agents connected yet.</div>`
    }`,
  );
  $("#tok").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await api("/tokens", { method: "POST", body: { label: f.get("label"), roots: f.getAll("roots"), scopes: f.getAll("scopes") } });
    $("#newtok").innerHTML = `<p><b>Copy it now</b>, it won't be shown again.</p><div class="snippet">${esc(res.token)}</div>
      <p class="muted" style="font-size:.85rem">Claude Code:</p><div class="snippet">claude mcp add --transport http satchel ${esc(url)} --header "Authorization: Bearer ${esc(res.token)}"</div>`;
  };
  for (const b of root.querySelectorAll("[data-revoke]"))
    b.onclick = async () => {
      if (!confirm("Revoke this connection? The agent loses access immediately.")) return;
      await api(`/connections/${encodeURIComponent(b.dataset.revoke)}`, { method: "DELETE" });
      route();
    };
}

async function journal() {
  const rows = await api("/journal");
  const describe = (e) =>
    e.kind === "move"
      ? `<div class="path">${esc(e.from)}</div><div class="path" style="color:var(--accent)">→ ${esc(e.to)}</div>`
      : e.kind === "metadata"
        ? `Metadata of <span class="path">${esc(e.to)}</span>`
        : e.kind === "conventions"
          ? "VAULT.md updated"
          : `Undo of ${esc(e.undoes?.slice(0, 8))}`;
  shell(
    "journal",
    "Journal",
    "",
    `<p class="muted">Every change Satchel makes is appended to <code>.satchel/journal.jsonl</code> inside your folder, so the history travels with your files.</p>
    ${
      rows.length
        ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Change</th><th>By</th><th></th></tr></thead><tbody>
    ${rows
      .map(
        (e) => `<tr><td style="white-space:nowrap">${esc(new Date(e.at).toLocaleString())}</td><td>${describe(e)}</td><td>${esc(e.actor)}</td>
      <td>${e.kind !== "undo" ? (e.undone ? `<span class="pill">undone</span>` : `<button data-undo="${e.id}">Undo</button>`) : ""}</td></tr>`,
      )
      .join("")}</tbody></table></div>`
        : `<div class="empty">No changes yet.</div>`
    }`,
  );
  for (const b of root.querySelectorAll("[data-undo]"))
    b.onclick = async () => {
      try {
        await api(`/journal/${b.dataset.undo}/undo`, { method: "POST" });
        toast("Undone");
      } catch (err) {
        toast(err.message);
      }
      route();
    };
}

async function activity() {
  const rows = await api("/audit");
  shell(
    "activity",
    "Activity",
    "",
    `<p class="muted">Everything agents asked for, and which sensitive values each one actually received.</p>
    ${
      rows.length
        ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Agent</th><th>Tool</th><th>Arguments</th><th>Disclosed</th></tr></thead><tbody>
    ${rows
      .map(
        (
          r,
        ) => `<tr><td style="white-space:nowrap">${esc(new Date(r.at).toLocaleString())}</td><td>${esc(r.client_name)}</td><td><code>${esc(r.tool)}</code>${r.outcome === "error" ? ' <span class="pill bad">error</span>' : ""}</td>
      <td class="path">${esc(JSON.stringify(r.args))}</td><td>${r.revealed.length ? r.revealed.map((x) => `<span class="pill warn">${esc(x.split("#")[1])}</span>`).join(" ") : '<span class="muted">nothing</span>'}</td></tr>`,
      )
      .join("")}</tbody></table></div>`
        : `<div class="empty">No agent activity yet.</div>`
    }`,
  );
}

async function conventions(ov) {
  const rootName = new URLSearchParams(location.hash.split("?")[1] ?? "").get("root") ?? ov.roots[0]?.name;
  const { text } = await api(`/conventions?root=${encodeURIComponent(rootName)}`);
  shell(
    "conventions",
    "VAULT.md",
    `<button class="primary" id="save">Save</button>`,
    `<p class="muted">Plain-text instructions every agent reads: folder layout, file names, metadata keys and reminder habits. Agents can propose edits; you approve them. Security rules live in <a href="#security">Security</a>, not here.</p>
    ${ov.roots.length > 1 ? `<div class="toolbar">${ov.roots.map((r) => `<a class="button ${r.name === rootName ? "primary" : ""}" href="#conventions?root=${esc(r.name)}">${esc(r.name)}</a>`).join("")}</div>` : ""}
    <textarea id="text" style="min-height:60vh">${esc(text)}</textarea>`,
  );
  $("#save").onclick = async () => {
    await api("/conventions", { method: "PUT", body: { root: rootName, text: $("#text").value } });
    toast("Saved to VAULT.md");
  };
}

async function security() {
  const { policy, defaults } = await api("/policy");
  const passkeys = await api("/passkeys");
  const devSig = policy.approvals.deviceSignature ?? "when_paired";
  const sel = (k) =>
    `<select name="${k}" style="width:auto;margin:0"><option value="always" ${policy.approvals[k] === "always" ? "selected" : ""}>Ask me</option><option value="never" ${policy.approvals[k] === "never" ? "selected" : ""}>Allow</option></select>`;
  shell(
    "security",
    "Security",
    `<button class="primary" id="save">Save</button>`,
    `<p class="muted">These rules live in the node's private config, outside your folders, so no agent can change them.</p>
    <div class="grid g2"><div class="card"><h3 style="margin-top:0">Approvals</h3><div class="list" id="appr">
      <div><span>Reveal a sensitive value</span>${sel("reveal")}</div>
      <div><span>Move or rename files</span>${sel("organize")}</div>
      <div><span>Change VAULT.md</span>${sel("conventions")}</div>
      <div><span>Edit metadata</span>${sel("metadata")}</div></div>
      <h3>Who can approve high-risk requests</h3>
      <p class="muted" style="font-size:.88rem">Reveals, reorganizations and VAULT.md changes. A paired Satchel phone or watch signs its decisions with a hardware key after biometrics.</p>
      <select id="devsig" style="margin:0">
        <option value="when_paired" ${devSig === "when_paired" ? "selected" : ""}>Only a paired phone or watch, once one is paired (recommended)</option>
        <option value="always" ${devSig === "always" ? "selected" : ""}>Only a paired phone or watch, always</option>
        <option value="never" ${devSig === "never" ? "selected" : ""}>Also this admin page and the web companion</option>
      </select></div>
    <div class="card"><h3 style="margin-top:0">Always-masked fields</h3><p class="muted" style="font-size:.88rem">Field names matching any pattern (regular expressions, case-insensitive) are masked for agents and kept out of the search index. Agents can mark more fields sensitive, never fewer.</p>
      <textarea id="pats" style="min-height:200px">${esc(policy.sensitivePatterns.join("\n"))}</textarea>
      <button id="reset" style="margin-top:8px">Reset to defaults</button></div>
    <div class="card"><h3 style="margin-top:0">Passkeys</h3><p class="muted" style="font-size:.88rem">Sign in to this page with Touch ID, Face ID, Windows Hello or a security key instead of the password. ${passkeyCapable() ? "" : `<b>Open this page by name (https://… or <a href="${location.protocol}//localhost:${location.port}${location.pathname}#security">localhost</a>) to use passkeys.</b>`}</p>
      ${passkeys.length ? `<div class="list">${passkeys.map((p) => `<div><div><b>${esc(p.name)}</b><div class="muted" style="font-size:.85rem">added ${ago(p.created_at)} · last used ${ago(p.last_used)}</div></div><button class="danger" data-pk="${esc(p.id)}">Remove</button></div>`).join("")}</div>` : `<p class="muted">No passkeys yet.</p>`}
      <div class="row"><input type="text" id="pkname" placeholder="This Mac" style="max-width:220px;margin:0"><button id="addpk" ${passkeyCapable() ? "" : "disabled"}>Add a passkey</button></div></div></div>`,
  );
  $("#reset").onclick = () => ($("#pats").value = defaults.sensitivePatterns.join("\n"));
  $("#save").onclick = async () => {
    const approvalsSet = {};
    for (const s of root.querySelectorAll("#appr select")) approvalsSet[s.name] = s.value;
    approvalsSet.deviceSignature = $("#devsig").value;
    try {
      await api("/policy", {
        method: "PUT",
        body: {
          policy: {
            sensitivePatterns: $("#pats")
              .value.split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            approvals: approvalsSet,
          },
        },
      });
      toast("Saved");
    } catch (err) {
      toast(err.message);
    }
  };
  $("#addpk").onclick = async () => {
    try {
      const { id, options } = await api("/passkeys/register/options", { method: "POST", body: {} });
      await api("/passkeys/register/verify", { method: "POST", body: { id, name: $("#pkname").value || "Passkey", response: await passkeyCreate(options) } });
      toast("Passkey added");
      route();
    } catch (err) {
      toast(err.name === "NotAllowedError" ? "Cancelled" : err.message);
    }
  };
  for (const b of root.querySelectorAll("[data-pk]"))
    b.onclick = async () => {
      if (!confirm("Remove this passkey?")) return;
      await api(`/passkeys/${encodeURIComponent(b.dataset.pk)}`, { method: "DELETE" });
      route();
    };
}

async function phone(ov) {
  const devices = await api("/devices");
  const deliveries = await api("/deliveries");
  shell(
    "phone",
    "Phone",
    "",
    `<div class="grid g2"><div class="card"><h3 style="margin-top:0">Pair a phone</h3>
      <p class="muted">Install the Satchel app on iPhone or Android and scan this code. The phone creates a hardware key that signs your approvals after Face ID or a fingerprint. It talks to this node directly${ov.public_url ? " through your relay URL, pinned to this node's own key" : " on your network"}. Watches enroll through the phone.</p>
      <button class="primary" id="pair">Show pairing code</button><div id="pairing" style="margin-top:12px"></div></div>
    <div class="card"><h3 style="margin-top:0">Paired devices</h3>
      ${devices.length ? `<div class="list">${devices.map((d) => `<div><div><b>${esc(d.name)}</b> ${d.signing ? `<span class="pill ok">${esc(PLATFORMS[d.platform] ?? d.platform)}${d.kind === "watch" ? " watch" : ""}</span>` : `<span class="pill">web companion</span>`}<div class="muted" style="font-size:.85rem">${d.signing ? `${d.hardware ? "hardware key" : "software key"} · <code>${esc(d.key_fingerprint)}</code> · ` : ""}last seen ${ago(d.last_seen)}</div></div><button class="danger" data-rm="${d.id}">Remove</button></div>`).join("")}</div>` : `<p class="muted">None yet.</p>`}
      <h3>Sent to you</h3>${deliveries.length ? `<div class="list">${deliveries.map((d) => `<div><span>${esc(d.title)} <span class="muted">from ${esc(d.client_name)}</span></span><span class="muted">${ago(d.at)}</span></div>`).join("")}</div>` : `<p class="muted">Nothing. Values agents send you appear on your phone and are deleted after 24 hours.</p>`}</div></div>`,
  );
  $("#pair").onclick = async () => {
    const p = await api("/pair", { method: "POST" });
    $("#pairing").innerHTML = `${p.address.warnings.map((w) => `<p class="error" style="font-size:.88rem">${esc(w)}</p>`).join("")}
      <p style="font-size:.9rem">${p.address.scope === "relay" ? `Works anywhere: <code>${esc(p.address.url)}</code>` : `<b>Home network only:</b> the phone will reach <code>${esc(p.address.url)}</code> while it's on the same Wi-Fi. Connect a relay to use it anywhere.`}</p>
      <div class="qr">${p.qr}</div><p>Code <b style="font-family:var(--mono);letter-spacing:.1em">${esc(p.code)}</b> · valid 10 minutes ${p.link.includes("pin=") ? '· <span class="pill ok">pinned</span>' : '· <span class="pill warn">local, not pinned</span>'}</p>
      <div class="snippet">${esc(p.link)}</div><p class="muted" style="font-size:.85rem">No app? The <a href="${esc(p.pwa)}">web companion</a> can view and deny, but can't approve high-risk requests.</p>`;
  };
  for (const b of root.querySelectorAll("[data-rm]"))
    b.onclick = async () => {
      await api(`/devices/${b.dataset.rm}`, { method: "DELETE" });
      route();
    };
}

async function settings() {
  const s = await api("/settings");
  shell(
    "settings",
    "Settings",
    `<button class="primary" id="save">Save</button>`,
    `<div class="grid g2"><div class="card"><h3 style="margin-top:0">Node</h3>
      <label>Name<input type="text" id="name" value="${esc(s.name)}"></label>
      <label>Inbox for phone captures<input type="text" id="inbox" value="${esc(s.inbox ?? "")}" placeholder="${esc(`${s.roots[0]?.name ?? "home"}/Inbox`)}"></label>
      <h3>Folders</h3><p class="muted" style="font-size:.88rem">Local folders, mounted NAS shares, or folders synced by the Google Drive / Dropbox / OneDrive apps all work.</p>
      <div id="roots">${s.roots.map((r) => `<div class="kv" style="grid-template-columns:120px 1fr 28px"><input value="${esc(r.name)}"><input value="${esc(r.path)}"><button class="danger" data-rm>×</button></div>`).join("")}</div>
      <button id="addroot">Add folder</button></div>
    <div class="card"><h3 style="margin-top:0">Relay</h3>
      ${s.relay ? `<div class="list"><div><span>Control</span><code>${esc(s.relay.control)}</code></div><div><span>Public host</span><code>${esc(s.publicHost ?? "pending")}</code></div></div>` : `<p class="muted">Not connected. Get a node token from your Satchel account (or your own relay), then run<br><code>satchel connect --relay HOST:7443 --token …</code></p>`}
      <h3>Home network</h3>
      <p class="muted" style="font-size:.88rem">Without a relay, phones reach this node only on your home network, over plain HTTP. With a relay they work anywhere, encrypted and pinned.</p>
      <label class="check"><input type="checkbox" id="reachable" ${s.home_network.reachable ? "checked" : ""}> Reachable on my home network <span class="muted">(otherwise only this computer can connect)</span></label>
      ${s.home_network.restart_required ? `<p class="pill warn" style="display:inline-block">Restart Satchel to apply</p>` : ""}
      <label>Home network address <span class="muted">(optional)</span><input type="text" id="lanurl" value="${esc(s.home_network.lan_url ?? "")}" placeholder="${esc(s.home_network.suggestions[0] ?? "http://nas.local:7710")}"></label>
      <p class="muted" style="font-size:.85rem">Used in pairing codes when there's no relay. Leave empty to detect it${s.home_network.suggestions.length ? ` (detected: ${s.home_network.suggestions.map((u) => `<code>${esc(u)}</code>`).join(", ")})` : ""}. Set it when Satchel runs in Docker. Android phones need a <code>.local</code> name.</p>
      <h3>Helpers</h3><p class="muted" style="font-size:.88rem">The desktop app can OCR scans and run a small local model to suggest metadata. Nothing leaves this machine.</p>
      <label class="check"><input type="checkbox" id="ocr" ${s.helpers.ocr ? "checked" : ""}> OCR images and scanned PDFs</label>
      <label>Local model endpoint (Ollama compatible)<input type="text" id="llm" value="${esc(s.helpers.llm?.url ?? "")}" placeholder="http://127.0.0.1:11434"></label>
      <label>Model<input type="text" id="model" value="${esc(s.helpers.llm?.model ?? "")}" placeholder="qwen3:1.7b"></label></div></div>`,
  );
  $("#roots").onclick = (e) => e.target.matches("[data-rm]") && e.target.parentElement.remove();
  $("#addroot").onclick = () =>
    $("#roots").insertAdjacentHTML(
      "beforeend",
      `<div class="kv" style="grid-template-columns:120px 1fr 28px"><input placeholder="name"><input placeholder="/path/to/folder"><button class="danger" data-rm>×</button></div>`,
    );
  $("#save").onclick = async () => {
    const roots = [...root.querySelectorAll("#roots .kv")]
      .map((kv) => {
        const [n, p] = kv.querySelectorAll("input");
        return { name: n.value.trim(), path: p.value.trim() };
      })
      .filter((r) => r.name && r.path);
    const llm = $("#llm").value.trim() ? { url: $("#llm").value.trim(), model: $("#model").value.trim() || "qwen3:1.7b" } : null;
    try {
      const res = await api("/settings", {
        method: "PUT",
        body: {
          name: $("#name").value,
          inbox: $("#inbox").value.trim() || null,
          roots,
          helpers: { ocr: $("#ocr").checked, llm },
          reachable: $("#reachable").checked,
          lan_url: $("#lanurl").value.trim(),
        },
      });
      toast(res.restart_required ? "Saved. Restart Satchel to apply the network change." : "Saved");
      route();
    } catch (err) {
      toast(err.message);
    }
  };
}

// ------------------------------------------------------------------ boot

async function start() {
  const token = new URLSearchParams(location.search).get("login");
  if (token) {
    await api("/login", { method: "POST", body: { token } }).catch(() => {});
    history.replaceState(null, "", location.pathname + location.hash);
  }
  const s = await api("/session");
  if (!s.authenticated) return renderLogin();
  window.onhashchange = route;
  await route();
  const ev = new EventSource("/admin/api/events");
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    if (document.querySelector(".drawer")) return;
    timer = setTimeout(route, 300);
  };
  for (const name of ["approval", "audit", "index", "devices", "delivery"]) ev.addEventListener(name, refresh);
}
start();
