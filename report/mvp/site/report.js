// Satchel MVP report: architecture hover, animated flow walkthrough, screenshot gallery.
const $ = (s, el = document) => el.querySelector(s);

// ---------------------------------------------------------------- architecture hover
const arch = $("#arch");
for (const box of arch.querySelectorAll(".box")) {
  const show = () => {
    $("#info").innerHTML = `<b>${box.querySelector(".t, .s").textContent}</b>: ${box.dataset.info.replace(/`([^`]+)`/g, "<code>$1</code>")}`;
  };
  box.addEventListener("mouseenter", show);
  box.addEventListener("click", show);
}

// ---------------------------------------------------------------- flows
const FLOWS = {
  "Agent asks what's expiring": [
    {
      n: ["n-agents"],
      text: "You ask your agent <b>“what do I need to renew soon?”</b> It calls <code>list_expiring</code> on <code>https://alex.satchel.dev/mcp</code>.",
    },
    {
      n: ["n-agents", "n-relay"],
      e: "e-agent-relay",
      text: "The TLS connection reaches the <b>relay</b>. It reads only the SNI hostname <code>alex.satchel.dev</code> from the ClientHello. The request itself is ciphertext.",
    },
    {
      n: ["n-relay", "n-node"],
      e: "e-relay-node",
      text: "The relay sends <code>open</code> on the node's outbound control connection. The node dials back a data stream and the relay <b>splices bytes</b>. TLS terminates on the node.",
    },
    { n: ["n-node"], text: "The node checks the bearer token (issued by its own OAuth server) against the connection's <b>roots and scopes</b>." },
    {
      n: ["n-node", "n-folders"],
      e: "e-node-folders",
      text: "A pure date query over the index of <code>expires_on</code> / <code>renew_by</code> from the sidecars. No policy in the server.",
    },
    {
      n: ["n-node", "n-relay", "n-agents"],
      e: "e-relay-node",
      rev: true,
      text: "Results go back through the same encrypted stream: titles, dates, <b>masked</b> identifiers. An audit row records what was disclosed (nothing sensitive here).",
    },
    { n: ["n-agents"], e: "e-agent-relay", rev: true, text: "The agent applies your <code>VAULT.md</code> habits (“passports: 6 months early”) and answers." },
  ],
  "Sensitive value with phone approval": [
    {
      n: ["n-agents", "n-relay", "n-node"],
      e: "e-agent-relay",
      text: "Filling the DS-82 form, the agent calls <code>reveal_field(passport_number)</code> with a reason.",
    },
    {
      n: ["n-node"],
      e: "e-relay-node",
      text: "The node doesn't return the value. It creates an <b>approval</b> and replies <code>pending_approval</code> with a <code>request_id</code>.",
    },
    {
      n: ["n-node", "n-phone"],
      e: "e-phone-node",
      rev: true,
      text: "A Web Push (no data in it) wakes your <b>phone</b>. The PWA loads the request from your node through your relay URL.",
    },
    { n: ["n-phone"], text: "You see <b>facts first</b>: agent, target field, masked preview. The agent's reason is labeled unverified. You tap Approve." },
    { n: ["n-phone", "n-node"], e: "e-phone-node", text: "The decision goes straight to your node. Nothing passes through the portal or Supabase." },
    {
      n: ["n-agents", "n-relay", "n-node"],
      e: "e-relay-node",
      rev: true,
      text: "The agent calls <code>check_approval</code> and gets the value <b>once</b>. The audit log records the disclosure.",
    },
    {
      n: ["n-node", "n-phone"],
      e: "e-phone-node",
      rev: true,
      text: "Alternative: <code>deliver_to_user</code> sends the value to your phone's Inbox and the model never sees it.",
    },
  ],
  "Going online": [
    { n: ["n-portal"], text: "In the <b>web app</b> you claim <code>alex.satchel.dev</code>. The node token is generated <b>in your browser</b>." },
    {
      n: ["n-portal", "n-supabase"],
      e: "e-portal-supabase",
      text: "Only the token's <b>SHA-256 hash</b> is stored in Supabase (RLS: you can rename or revoke; only the relay sets online status).",
    },
    {
      n: ["n-node", "n-relay"],
      e: "e-relay-node",
      rev: true,
      text: "<code>satchel connect</code> → the node dials the relay's control port (outbound, so it works behind NAT) and sends <code>hello</code> with the token.",
    },
    {
      n: ["n-relay", "n-supabase"],
      e: "e-relay-supabase",
      text: "The relay hashes the token, looks up the subdomain, marks the node online, and replies <code>ready</code>.",
    },
    {
      n: ["n-node", "n-relay", "n-dns"],
      e: "e-relay-dns",
      text: "The node creates its TLS key locally and asks the relay to publish the ACME <b>DNS-01</b> TXT record. Let's Encrypt issues a cert the relay can't use.",
    },
    { n: ["n-node"], text: "Online: <code>https://alex.satchel.dev/mcp</code>. Local agents keep using <code>127.0.0.1:7710</code> directly." },
  ],
  "Connecting a new agent (OAuth)": [
    {
      n: ["n-agents", "n-relay", "n-node"],
      e: "e-agent-relay",
      text: "You add the URL as a custom connector. Unauthenticated, the node answers <code>401</code> with <code>resource_metadata</code>.",
    },
    {
      n: ["n-agents", "n-node"],
      e: "e-relay-node",
      text: "The client discovers the authorization server (<b>embedded in your node</b>) and registers itself dynamically (RFC 7591).",
    },
    {
      n: ["n-node"],
      text: "Your browser opens the <b>consent page served by your node</b>: choose folders and permissions (read / write / organize / reveal), then enter the owner password.",
    },
    {
      n: ["n-node", "n-agents"],
      e: "e-relay-node",
      rev: true,
      text: "Code + PKCE exchange → a 1-hour access token and a 90-day refresh token, signed and stored (hashed) on the node only.",
    },
    {
      n: ["n-agents"],
      text: "The agent is connected. Revoke it any time under <b>Connections</b>; it keeps working with other agents because nothing is vendor-specific.",
    },
  ],
  "Filing a new document": [
    { n: ["n-phone"], text: "A new registration card arrives. You <b>photograph</b> it in the phone companion." },
    { n: ["n-phone", "n-node", "n-folders"], e: "e-phone-node", text: "The photo lands in <code>Inbox/</code> in your folder and is indexed." },
    {
      n: ["n-helpers", "n-node"],
      e: "e-helpers-node",
      text: "The desktop helper OCRs it with on-device <b>Apple Vision</b> (optionally a local model suggests type and dates).",
    },
    {
      n: ["n-local", "n-node"],
      e: "e-local-node",
      text: "On its weekly run, your agent calls <code>list_unprocessed</code>, reads the text, and <code>set_metadata</code> (journaled).",
    },
    {
      n: ["n-local", "n-node"],
      e: "e-local-node",
      text: "It proposes a move to <code>Vehicles/2019 Honda Civic/Registration/2026-10 Registration (exp 2027-10).jpg</code> per VAULT.md.",
    },
    {
      n: ["n-phone", "n-node"],
      e: "e-phone-node",
      text: "You approve the plan on your phone. The file and its sidecar move together; every move is in <code>.satchel/journal.jsonl</code> and can be undone.",
    },
  ],
};

const flowSvg = $("#flowSvg");
flowSvg.innerHTML = arch.innerHTML.replace(/id="(e-|n-|dot|arrow)/g, 'id="f-$1');
const fdot = $("#f-dot", flowSvg);
let flowName = Object.keys(FLOWS)[0];
let step = 0;
let timer = null;
let anim = null;

function renderTabs() {
  $("#flowTabs").innerHTML = Object.keys(FLOWS)
    .map((k) => `<button class="${k === flowName ? "on" : ""}">${k}</button>`)
    .join("");
  for (const b of $("#flowTabs").children) b.onclick = () => selectFlow(b.textContent);
}
function selectFlow(name) {
  flowName = name;
  step = 0;
  stop();
  renderTabs();
  $("#steps").innerHTML = FLOWS[name].map((s) => `<li>${s.text}</li>`).join("");
  [...$("#steps").children].forEach((li, i) => {
    li.onclick = () => {
      stop();
      show(i);
    };
  });
  show(0);
}
function show(i) {
  const steps = FLOWS[flowName];
  step = (i + steps.length) % steps.length;
  const s = steps[step];
  flowSvg.classList.add("dim");
  flowSvg.querySelectorAll(".active").forEach((el) => {
    el.classList.remove("active");
  });
  for (const n of s.n) flowSvg.querySelector(`#f-${n}`)?.classList.add("active");
  [...$("#steps").children].forEach((li, j) => {
    li.classList.toggle("on", j === step);
  });
  $("#stepCount").textContent = `${flowName} · step ${step + 1} of ${steps.length}`;
  $("#stepText").innerHTML = s.text;
  cancelAnimationFrame(anim);
  fdot.setAttribute("cx", -20);
  if (s.e) {
    const path = flowSvg.querySelector(`#f-${s.e}`);
    path.classList.add("active");
    const len = path.getTotalLength();
    const t0 = performance.now();
    const dur = 1100;
    const frame = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const p = path.getPointAtLength((s.rev ? 1 - e : e) * len);
      fdot.setAttribute("cx", p.x);
      fdot.setAttribute("cy", p.y);
      if (k < 1) anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
  }
}
function play() {
  if (timer) return stop();
  $("#play").textContent = "Pause";
  show(step);
  timer = setInterval(() => {
    if (step === FLOWS[flowName].length - 1) return stop();
    show(step + 1);
  }, 3200);
}
function stop() {
  clearInterval(timer);
  timer = null;
  $("#play").textContent = "Play";
}
$("#play").onclick = play;
$("#next").onclick = () => {
  stop();
  show(step + 1);
};
$("#prev").onclick = () => {
  stop();
  show(step - 1);
};
selectFlow(flowName);

// ---------------------------------------------------------------- screenshots
const SHOTS = {
  "Web app": [
    ["web-landing.png", "Landing page", "Hero with a real tool-call conversation; flat, no 3D."],
    ["web-landing-full.png", "Landing (full page)", "How it fits together, who sees what, CTA."],
    ["web-docs.png", "Docs", "Nine pages rendered from Markdown in the repo."],
    ["web-login.png", "Sign in", "GitHub only (Supabase Auth); demo mode without env."],
    ["web-portal.png", "Portal", "Claim a subdomain; the token is shown once, only its hash is stored."],
    ["web-landing-mobile.png", "Landing on a phone", "Responsive at 390 px."],
  ],
  "Node admin": [
    ["admin-overview.png", "Overview", "Coming-up dates, reachability, folders."],
    ["admin-overview-dark.png", "Overview (dark)", "Same tokens, dark scheme."],
    ["admin-records.png", "Records", "Search names, metadata and document text."],
    ["admin-record.png", "Record drawer", "Edit the YAML sidecar; sensitive fields hidden."],
    ["admin-approvals.png", "Approvals", "Reorganization plan and reveal request; reason labeled unverified."],
    ["admin-connections.png", "Connections", "OAuth URL, tokens with roots and scopes, revoke."],
    ["admin-journal.png", "Journal", "Every change, with undo."],
    ["admin-activity.png", "Activity", "Per-agent audit, including disclosed fields."],
    ["admin-conventions.png", "VAULT.md", "Policy as text that every agent reads."],
    ["admin-security.png", "Security", "Approval rules and masking patterns, out of agents' reach."],
    ["admin-phone.png", "Pair a phone", "QR code for the companion PWA."],
    ["admin-settings.png", "Settings", "Folders, inbox, relay, helpers."],
  ],
  Phone: [
    ["phone-approvals.png", "Approve", "Facts first, big buttons."],
    ["phone-inbox.png", "Inbox", "A value the agent sent without seeing it."],
    ["phone-upcoming.png", "Upcoming", "Next six months."],
    ["phone-capture.png", "Capture", "Camera to vault Inbox."],
    ["phone-pair.png", "Pairing", "One-time code from the desktop."],
  ],
  Desktop: [
    ["desktop-app.png", "Desktop app", "Electron window running a node in-process."],
    ["desktop-setup.png", "First-run setup", "Pick a folder and set the owner password."],
  ],
};
let shotTab = "Web app";
function renderShots() {
  $("#shotTabs").innerHTML = Object.keys(SHOTS)
    .map((k) => `<button class="${k === shotTab ? "on" : ""}">${k}</button>`)
    .join("");
  for (const b of $("#shotTabs").children) {
    b.onclick = () => {
      shotTab = b.textContent;
      renderShots();
    };
  }
  const g = $("#gallery");
  g.className = `gallery ${shotTab === "Phone" ? "phone" : ""}`;
  g.innerHTML = SHOTS[shotTab]
    .map(
      ([f, t, d]) =>
        `<figure data-src="shots/${f}" data-cap="${t}: ${d}"><img src="shots/${f}" loading="lazy" alt="${t}"><figcaption><b>${t}</b><span class="muted">${d}</span></figcaption></figure>`,
    )
    .join("");
  for (const f of g.querySelectorAll("figure")) {
    f.onclick = () => {
      const lb = $("#lightbox");
      lb.querySelector("img").src = f.dataset.src;
      lb.querySelector("p").textContent = f.dataset.cap;
      lb.hidden = false;
    };
  }
}
$("#lightbox").onclick = () => ($("#lightbox").hidden = true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("#lightbox").hidden = true;
});
renderShots();

// ---------------------------------------------------------------- tools
const TOOLS = [
  ["vault_status", "read", "Roots, counts, unprocessed files, last agent activity, today's date"],
  ["get_conventions", "read", "VAULT.md: naming, layout, reminder habits"],
  ["browse", "read", "Folders with file counts"],
  ["search", "read", "Full-text over names, metadata and document text, with filters"],
  ["list_expiring", "read", "Pure date window over expires_on / renew_by"],
  ["query_dates", "read", "Any *_on / *_date / *_by key"],
  ["get_record", "read", "Metadata (masked) and file info"],
  ["read_file", "read", "Extracted / OCR text with known sensitive values redacted"],
  ["list_unprocessed", "read", "Files without a doc_type yet"],
  ["set_metadata", "write", "Merge into the YAML sidecar; sensitive keys can only grow"],
  ["propose_reorganization", "organize", "Batch of moves → owner approves → journaled"],
  ["propose_conventions", "organize", "New VAULT.md → owner approves"],
  ["undo", "organize", "Reverse a journal entry (hash-checked)"],
  ["list_journal", "read", "Recent changes"],
  ["reveal_field", "read", "Ask to see one value → phone approval → pick up once"],
  ["deliver_to_user", "read", "Send a value to the owner's phone; the model never sees it"],
  ["check_approval", "read", "Poll an approval and get its outcome"],
];
$("#toolRows").innerHTML = TOOLS.map(([n, s, d]) => `<tr><td><code>${n}</code></td><td><span class="scope ${s}">${s}</span></td><td>${d}</td></tr>`).join("");

// ---------------------------------------------------------------- CI/CD pipeline animation
const stages = [...document.querySelectorAll("#pipeline .stage")];
let lit = 0;
const pipeObserver = new IntersectionObserver((entries) => {
  if (!entries[0].isIntersecting || lit) return;
  const tick = () => {
    stages.forEach((s, i) => {
      s.classList.toggle("lit", i <= lit);
    });
    lit = (lit + 1) % (stages.length + 2);
    setTimeout(tick, lit === 0 ? 1400 : 700);
  };
  lit = 0;
  tick();
});
pipeObserver.observe($("#pipeline"));

// ---------------------------------------------------------------- tests
fetch("test-results.txt")
  .then((r) => r.text())
  .then(
    (t) => ($("#tests").textContent = t.trim()),
    () => ($("#tests").textContent = "Run `pnpm test` to see results."),
  );
