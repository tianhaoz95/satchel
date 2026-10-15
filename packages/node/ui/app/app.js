// Satchel companion: a PWA served by the owner's node. It pairs once with a code, then holds a
// device token. Approvals and delivered values go phone <-> node only.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const root = $("#root");
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  del: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};
const ACTIONS = { reveal_field: "See a sensitive value", apply_plan: "Reorganize files", update_conventions: "Change VAULT.md", set_metadata: "Edit metadata" };
const ICON = {
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="4"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
};
const LOGO = `<svg viewBox="0 0 32 32" fill="none"><rect x="3" y="7" width="26" height="20" rx="4" fill="var(--accent)"/><path d="M3 12h26" stroke="var(--surface)" stroke-width="2"/><rect x="11" y="4" width="10" height="6" rx="2" stroke="var(--accent)" stroke-width="2"/><circle cx="16" cy="19" r="3" fill="var(--surface)"/></svg>`;

async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  const token = store.get("satchel_device");
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.json) headers["content-type"] = "application/json";
  const res = await fetch(`/app/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.json ? JSON.stringify(opts.json) : opts.body,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    store.del("satchel_device");
    renderPair();
    throw new Error("not paired");
  }
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

const ago = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const daysLeft = (d) => Math.round((Date.parse(d) - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000);

function renderPair(error = "") {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("pair") ?? "";
  root.innerHTML = `<div class="top">${LOGO}<b>Satchel</b></div><div class="screen"><form class="card" id="pair">
    <h1>Pair this phone</h1><p class="muted">Open <b>Phone</b> in the Satchel app on your computer and enter the code shown there.</p>
    ${error ? `<p class="error">${esc(error)}</p>` : ""}
    <label>Pairing code<input type="text" name="code" value="${esc(fromHash)}" autocapitalize="characters" required style="font-family:var(--mono);letter-spacing:.1em"></label>
    <label>Name for this device<input type="text" name="name" value="${esc(/iPhone/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android phone" : "Phone")}"></label>
    <button class="primary">Pair</button></form></div>`;
  $("#pair").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api("/pair", { method: "POST", json: { code: e.target.code.value.trim(), name: e.target.name.value } });
      store.set("satchel_device", res.token);
      location.hash = "approvals";
      boot();
    } catch (err) {
      renderPair(err.message);
    }
  };
}

function frame(tab, body, pendingCount = 0) {
  const tabs = [
    ["approvals", "Approve", ICON.check],
    ["inbox", "Inbox", ICON.inbox],
    ["upcoming", "Upcoming", ICON.cal],
    ["capture", "Capture", ICON.cam],
  ];
  root.innerHTML = `<div class="top">${LOGO}<b>Satchel</b><span class="muted" style="font-size:.85rem">${esc(state.node)}</span></div>
    <div class="screen">${body}</div>
    <nav class="tabs">${tabs.map(([id, label, icon]) => `<a href="#${id}" class="${id === tab ? "active" : ""}">${icon}${id === "approvals" && pendingCount ? `<span class="badge">${pendingCount}</span>` : ""}${label}</a>`).join("")}</nav>`;
}

const state = { node: "" };

async function approvals() {
  const list = await api("/approvals");
  const pending = list.filter((a) => a.status === "pending");
  const recent = list.filter((a) => a.status !== "pending").slice(0, 8);
  const card = (a) => `<div class="approval"><div class="row" style="margin:0;justify-content:space-between"><b>${esc(ACTIONS[a.action] ?? a.action)}</b>
    ${a.status === "pending" ? '<span class="pill warn">waiting</span>' : `<span class="pill ${["approved", "used"].includes(a.status) ? "ok" : "bad"}">${esc(a.status)}</span>`}</div>
    <dl class="facts"><dt>Agent</dt><dd>${esc(a.client_name)}</dd><dt>Target</dt><dd><code>${esc(a.target)}</code></dd><dt>When</dt><dd>${ago(a.created_at)}</dd></dl>
    ${
      a.detail.moves
        ? `<div class="moves">${a.detail.moves
            .slice(0, 20)
            .map((m) => `<div>${esc(m.from)}<br><span class="to">→ ${esc(m.to)}</span></div>`)
            .join("")}${a.detail.moves.length > 20 ? `<div>…and ${a.detail.moves.length - 20} more</div>` : ""}</div>`
        : ""
    }
    ${a.reason ? `<div class="reason"><span class="eyebrow">Agent's stated reason (unverified)</span><br>${esc(a.reason)}</div>` : ""}
    ${
      a.status !== "pending"
        ? ""
        : a.requires_signature
          ? `<p class="muted" style="font-size:.88rem">High-risk: approve it in the Satchel app on your phone or watch, where the decision is signed after Face ID or a fingerprint.</p><div class="row"><button data-no="${a.id}">Deny</button></div>`
          : `<div class="row" style="display:grid;grid-template-columns:1fr 1fr"><button class="primary" data-ok="${a.id}">Approve</button><button data-no="${a.id}">Deny</button></div>`
    }</div>`;
  frame(
    "approvals",
    `<h1>Approvals</h1>${pending.length ? pending.map(card).join("") : '<div class="empty">Nothing needs you right now.</div>'}
    ${recent.length ? `<h2>Recent</h2>${recent.map(card).join("")}` : ""}${pushPrompt()}`,
    pending.length,
  );
  for (const b of root.querySelectorAll("[data-ok],[data-no]"))
    b.onclick = async () => {
      b.disabled = true;
      try {
        await api(`/approvals/${b.dataset.ok ?? b.dataset.no}`, { method: "POST", json: { decision: b.dataset.ok ? "approved" : "denied" } });
      } catch (err) {
        alert(err.message);
      }
      approvals();
    };
  wirePush();
}

async function inbox() {
  const list = await api("/deliveries");
  frame(
    "inbox",
    `<h1>Inbox</h1><p class="muted">Values agents sent you without seeing them. They're deleted after 24 hours.</p>
    ${
      list.length
        ? list
            .map(
              (
                d,
              ) => `<div class="card" style="margin-bottom:10px"><b>${esc(d.title)}</b><div class="muted" style="font-size:.85rem">from ${esc(d.client_name)} · ${ago(d.at)}</div>
      ${d.note ? `<p>${esc(d.note)}</p>` : ""}<div class="secret" data-secret="${esc(d.value)}">••••••••</div>
      <div class="row" style="margin-top:4px"><button data-show>Show</button><button data-copy="${esc(d.value)}">Copy</button></div></div>`,
            )
            .join("")
        : '<div class="empty">Nothing here.</div>'
    }`,
  );
  for (const b of root.querySelectorAll("[data-show]"))
    b.onclick = () => {
      const s = b.closest(".card").querySelector(".secret");
      const shown = s.textContent !== "••••••••";
      s.textContent = shown ? "••••••••" : s.dataset.secret;
      b.textContent = shown ? "Show" : "Hide";
    };
  for (const b of root.querySelectorAll("[data-copy]"))
    b.onclick = async () => {
      await navigator.clipboard.writeText(b.dataset.copy).catch(() => {});
      b.textContent = "Copied";
    };
  for (const d of list) if (!d.seen) api(`/deliveries/${d.id}/seen`, { method: "POST" }).catch(() => {});
}

async function upcoming() {
  const list = await api("/upcoming");
  frame(
    "upcoming",
    `<h1>Upcoming</h1>${
      list.length
        ? `<div class="card list">${list
            .map((u) => {
              const d = daysLeft(u.date);
              return `<div><div><b>${esc(u.title)}</b><div class="muted" style="font-size:.85rem">${esc(u.subject ?? "")} · ${esc(u.date)}</div></div><span class="pill ${d < 0 ? "bad" : d <= 60 ? "warn" : "ok"}">${d < 0 ? `${-d} d late` : `${d} d`}</span></div>`;
            })
            .join("")}</div>`
        : '<div class="empty">No dates in the next six months.</div>'
    }`,
  );
}

function capture(msg = "") {
  frame(
    "capture",
    `<h1>Capture</h1><p class="muted">Photograph a new document. It goes straight to your vault's Inbox folder, where your agent can file it.</p>
    <label class="capture" for="file">${ICON.cam}<b>Take a photo or choose a file</b><span class="muted">Images or PDF, up to 25 MB</span></label>
    <input type="file" id="file" accept="image/*,application/pdf" capture="environment" hidden>
    <label>Note for your agent (optional)<input type="text" id="note" placeholder="New registration for the Civic"></label>
    ${msg}`,
  );
  $("#file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const res = await api("/capture", {
        method: "POST",
        body: f,
        headers: { "x-filename": f.name, "x-note": $("#note").value, "content-type": f.type || "application/octet-stream" },
      });
      capture(`<p class="pill ok" style="margin-top:12px">Saved to ${esc(res.path)}</p>`);
    } catch (err) {
      capture(`<p class="error">${esc(err.message)}</p>`);
    }
  };
}

function pushPrompt() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "";
  if (typeof Notification !== "undefined" && Notification.permission === "granted") return "";
  return `<div class="card" style="margin-top:14px"><b>Get notified</b><p class="muted">Allow notifications so approvals reach you right away. Notifications never contain your data.</p><button id="push">Turn on notifications</button></div>`;
}

function wirePush() {
  const b = $("#push");
  if (!b) return;
  b.onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" });
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
      const { publicKey } = await api("/vapid");
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api("/push", { method: "POST", json: { subscription: sub.toJSON() } });
      b.closest(".card").remove();
    } catch (err) {
      b.textContent = `Couldn't enable: ${err.message}`;
    }
  };
}

async function route() {
  const tab = location.hash.slice(1).split("=")[0] || "approvals";
  try {
    await ({ approvals, inbox, upcoming, capture }[tab] ?? approvals)();
  } catch (err) {
    if (err.message !== "not paired") console.error(err);
  }
}

async function boot() {
  if (new URLSearchParams(location.hash.slice(1)).get("pair") && !store.get("satchel_device")) return renderPair();
  try {
    const me = await api("/me");
    state.node = me.node;
  } catch {
    return;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {});
  window.onhashchange = route;
  route();
  setInterval(() => document.visibilityState === "visible" && location.hash.match(/^#?(approvals)?$/) && route(), 15000);
}
if (!store.get("satchel_device")) {
  // A signed-in desktop admin session also works (the desktop app reuses these screens).
  fetch("/app/api/me", { credentials: "same-origin" }).then(
    (r) => (r.ok ? boot() : renderPair()),
    () => renderPair(),
  );
} else boot();
