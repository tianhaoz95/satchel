// Satchel setup guide: fills commands from the values form, tracks progress, draws the value map.
const $ = (s, el = document) => el.querySelector(s);
const store = {
  get(k, d) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const DEFAULTS = { domain: "satchel.dev", repo: "tianhaoz95/satchel", ref: "YOUR-PROJECT-REF", pages: "satchel-web", ip: "RELAY_IPV4", sshUser: "deploy" };
let values = { ...DEFAULTS, ...store.get("satchel-setup-values", {}) };

// ---------------------------------------------------------------- generated blocks
function composeFile(v) {
  return `# /opt/satchel-relay/compose.yml
services:
  relay:
    image: ghcr.io/${v.repo.split("/")[0]}/satchel-relay:latest
    restart: unless-stopped
    ports: ["443:443", "7443:7443"]
    env_file: .env          # SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN
    environment:
      SATCHEL_RELAY_DOMAIN: ${v.domain}
      SATCHEL_RELAY_API_HOST: relay.${v.domain}
      SATCHEL_RELAY_TLS_CERT: /etc/letsencrypt/live/relay.${v.domain}/fullchain.pem
      SATCHEL_RELAY_TLS_KEY: /etc/letsencrypt/live/relay.${v.domain}/privkey.pem
      SUPABASE_URL: https://${v.ref}.supabase.co
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
    user: "0"               # read root-owned certbot keys; the process has no other privileges`;
}

function ghCommands(v) {
  const R = `--repo ${v.repo}`;
  return `# Variables: public identifiers, used at build time and by workflows
gh variable set RELAY_DOMAIN         ${R} --body "${v.domain}"
gh variable set RELAY_CONTROL        ${R} --body "relay.${v.domain}:7443"
gh variable set SUPABASE_PROJECT_REF ${R} --body "${v.ref}"
gh variable set SUPABASE_URL         ${R} --body "https://${v.ref}.supabase.co"
gh variable set SUPABASE_ANON_KEY    ${R}    # paste the publishable (anon) key when prompted

# Secrets: each command prompts for the value
gh secret set CLOUDFLARE_API_TOKEN   ${R}    # satchel-pages-deploy token (step 5a)
gh secret set CLOUDFLARE_ACCOUNT_ID  ${R}    # from the zone overview (step 1c)
gh secret set SUPABASE_ACCESS_TOKEN  ${R}    # account access token (step 2d)
gh secret set SUPABASE_DB_PASSWORD   ${R}    # database password (step 2a)
gh secret set RELAY_HOST             ${R} --body "${v.ip}"
gh secret set RELAY_USER             ${R} --body "${v.sshUser}"
gh secret set RELAY_SSH_KEY          ${R} < satchel-relay-deploy   # private key from step 6f`;
}

function render() {
  for (const el of document.querySelectorAll("[data-v]")) el.textContent = values[el.dataset.v] || DEFAULTS[el.dataset.v];
  $("#composeFile").textContent = composeFile(values);
  $("#ghCommands").textContent = ghCommands(values);
  drawMap();
}

const form = $("#valuesForm");
for (const input of form.querySelectorAll("input")) {
  if (values[input.name] !== DEFAULTS[input.name]) input.value = values[input.name];
  input.addEventListener("input", () => {
    values = { ...values, [input.name]: input.value.trim() || DEFAULTS[input.name] };
    store.set("satchel-setup-values", Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== DEFAULTS[k])));
    render();
  });
}

// ---------------------------------------------------------------- checklist + progress
const done = new Set(store.get("satchel-setup-done", []));
const items = [...document.querySelectorAll(".checks li[data-id]")];
for (const li of items) {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = done.has(li.dataset.id);
  box.setAttribute("aria-label", "Done");
  li.prepend(box);
  li.classList.toggle("done", box.checked);
  box.addEventListener("change", () => {
    if (box.checked) done.add(li.dataset.id);
    else done.delete(li.dataset.id);
    li.classList.toggle("done", box.checked);
    store.set("satchel-setup-done", [...done]);
    progress();
  });
}
function progress() {
  const n = items.filter((li) => done.has(li.dataset.id)).length;
  $("#progressText").textContent = `${n} / ${items.length} done`;
  $("#progressBar").style.width = `${(100 * n) / items.length}%`;
  for (const a of document.querySelectorAll("#toc a[data-step]")) {
    const lis = [...document.querySelectorAll(`#${a.dataset.step} .checks li[data-id]`)];
    a.classList.toggle("complete", lis.length > 0 && lis.every((li) => done.has(li.dataset.id)));
  }
}

// ---------------------------------------------------------------- table of contents
const steps = [...document.querySelectorAll("section.step")];
$("#toc").innerHTML =
  `<a href="#values">Your values</a><a href="#map">Value map</a>` +
  steps.map((s, i) => `<a href="#${s.id}" data-step="${s.id}"><span class="dotnum">${i + 1}</span>${s.dataset.title}</a>`).join("") +
  `<a href="#done">Good to know</a>`;
const spy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of document.querySelectorAll("#toc a")) a.classList.toggle("active", a.getAttribute("href") === `#${e.target.id}`);
    }
  },
  { rootMargin: "-30% 0px -60% 0px" },
);
for (const s of document.querySelectorAll("main section[id]")) spy.observe(s);

// ---------------------------------------------------------------- copy buttons
for (const pre of document.querySelectorAll("pre.cmd")) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "copy-btn";
  b.textContent = "Copy";
  b.addEventListener("click", async () => {
    await navigator.clipboard.writeText(pre.textContent.replace(/Copy(ied)?$/, "").trimEnd());
    b.textContent = "Copied";
    setTimeout(() => {
      b.textContent = "Copy";
    }, 1400);
  });
  pre.append(b);
}
for (const code of document.querySelectorAll("code.copy")) {
  code.title = "Click to copy";
  code.addEventListener("click", async () => {
    await navigator.clipboard.writeText(code.textContent);
    code.classList.add("flash");
    setTimeout(() => code.classList.remove("flash"), 600);
  });
}

// ---------------------------------------------------------------- value map
const SOURCES = [
  { id: "cf", label: "Cloudflare", sub: "account · zone · 2 tokens" },
  { id: "sb", label: "Supabase", sub: "URL · keys · DB password · token" },
  { id: "gh", label: "GitHub OAuth app", sub: "client ID · client secret (only login)" },
  { id: "vps", label: "Relay VPS", sub: "IP · SSH key · relay cert" },
];
const DESTS = [
  { id: "ghv", label: "GitHub variables", sub: "public: web build, workflows" },
  { id: "ghs", label: "GitHub secrets", sub: "CI deploys only" },
  { id: "sba", label: "Supabase Auth", sub: "provider + URL config" },
  { id: "relay", label: "Relay .env", sub: "/opt/satchel-relay" },
  { id: "dns", label: "Cloudflare DNS", sub: "relay + wildcard, DNS only" },
];
const ROWS = [
  ["Domain", "public", "Registrar → Cloudflare zone", "cf", ["ghv", "sba", "dns"], "RELAY_DOMAIN, Site URL, DNS records"],
  ["Cloudflare account ID", "public", "Zone overview", "cf", ["ghs"], "secret CLOUDFLARE_ACCOUNT_ID"],
  ["Pages deploy token", "secret", "API Tokens (Pages · Edit)", "cf", ["ghs"], "secret CLOUDFLARE_API_TOKEN"],
  ["Zone ID", "public", "Zone overview", "cf", ["relay"], "relay CLOUDFLARE_ZONE_ID"],
  ["DNS edit token", "secret", "API Tokens (Zone DNS · Edit)", "cf", ["relay"], "relay CLOUDFLARE_API_TOKEN, certbot"],
  ["Supabase URL + ref", "public", "Project settings", "sb", ["ghv", "relay"], "SUPABASE_URL, SUPABASE_PROJECT_REF"],
  ["Publishable (anon) key", "public", "API keys", "sb", ["ghv"], "SUPABASE_ANON_KEY (web build)"],
  ["Secret (service_role) key", "secret", "API keys", "sb", ["relay"], "relay SUPABASE_SERVICE_ROLE_KEY only"],
  ["Database password", "secret", "Set at project creation", "sb", ["ghs"], "secret SUPABASE_DB_PASSWORD"],
  ["Access token", "secret", "Account → Access Tokens", "sb", ["ghs"], "secret SUPABASE_ACCESS_TOKEN"],
  ["OAuth client ID", "public", "GitHub OAuth app", "gh", ["sba"], "Supabase → Providers → GitHub"],
  ["OAuth client secret", "secret", "GitHub OAuth app", "gh", ["sba"], "Supabase → Providers → GitHub only"],
  ["Server IP", "public", "VPS provider", "vps", ["dns", "ghs"], "A records, RELAY_HOST"],
  ["Deploy SSH key", "secret", "ssh-keygen", "vps", ["ghs"], "secret RELAY_SSH_KEY (+ authorized_keys)"],
  ["APNs key (.p8)", "secret", "Apple Developer → Keys", "apple", [], "push gateway APNS_PRIVATE_KEY (+ key id, team id)"],
  ["FCM service account", "secret", "Firebase → Service accounts", "firebase", [], "push gateway FCM_SERVICE_ACCOUNT"],
  ["Firebase app config", "public", "Firebase → Project settings", "firebase", [], "Gradle properties satchel.firebase.*"],
  ["Ticket key", "secret", "openssl rand -base64 32", "gateway", [], "push gateway TICKET_KEY only"],
];

$("#valueTable").innerHTML = ROWS.map(
  ([name, kind, from, src, , to]) =>
    `<tr data-src="${src}"><td><b>${name}</b></td><td><span class="key ${kind}">${kind}</span></td><td>${from}</td><td>${to}</td></tr>`,
).join("");

function drawMap() {
  const box = (x, y, d, cls) =>
    `<g class="node ${cls}" data-id="${d.id}"><rect x="${x}" y="${y}" width="220" height="58" rx="8"/><text x="${x + 110}" y="${y + 25}" class="t">${d.label}</text><text x="${x + 110}" y="${y + 44}" class="s">${d.sub}</text></g>`;
  const sy = (i) => 50 + i * 92;
  const dy = (i) => 44 + i * 76;
  $("#sources").innerHTML = SOURCES.map((s, i) => box(20, sy(i), s, "src")).join("");
  $("#dests").innerHTML = DESTS.map((d, i) => box(700, dy(i), d, "dst")).join("");
  const pairs = new Map();
  for (const [, kind, , src, dests] of ROWS) {
    for (const d of dests) {
      const key = `${src}>${d}`;
      const prev = pairs.get(key);
      pairs.set(key, prev === "secret" || kind === "secret" ? "secret" : "public");
    }
  }
  let links = "";
  for (const [key, kind] of pairs) {
    const [s, d] = key.split(">");
    const y1 = sy(SOURCES.findIndex((x) => x.id === s)) + 29;
    const y2 = dy(DESTS.findIndex((x) => x.id === d)) + 29;
    links += `<path class="link ${kind}" data-src="${s}" data-dst="${d}" d="M240 ${y1} C 470 ${y1}, 470 ${y2}, 700 ${y2}"/>`;
  }
  $("#links").innerHTML = links;
  for (const g of document.querySelectorAll("#flow .node")) {
    g.addEventListener("mouseenter", () => highlight(g.dataset.id));
    g.addEventListener("mouseleave", () => highlight(null));
  }
}
function highlight(id) {
  const svg = $("#flow");
  svg.classList.toggle("focus", !!id);
  for (const p of svg.querySelectorAll(".link")) p.classList.toggle("on", !!id && (p.dataset.src === id || p.dataset.dst === id));
  for (const n of svg.querySelectorAll(".node")) {
    const linked = [...svg.querySelectorAll(".link.on")].some((p) => p.dataset.src === n.dataset.id || p.dataset.dst === n.dataset.id);
    n.classList.toggle("on", !!id && (n.dataset.id === id || linked));
  }
  for (const tr of document.querySelectorAll("#valueTable tr")) tr.classList.toggle("on", !!id && tr.dataset.src === id);
}

render();
progress();
