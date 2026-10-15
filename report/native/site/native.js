// Satchel native report: screenshot galleries and the signed-approval sequence animation.
const $ = (s) => document.querySelector(s);

const IOS = [
  ["ios-pair.png", "Pair", "Scan the node's QR or paste the link"],
  ["ios-approvals.png", "Approvals", "Waiting requests with a badge"],
  ["ios-approval-detail.png", "Approval detail", "Facts first; Approve with Face ID"],
  ["ios-approval-detail-dark.png", "Dark mode", "Same screen, dark appearance"],
  ["ios-inbox.png", "Inbox", "A value sent without the agent seeing it"],
  ["ios-upcoming.png", "Upcoming", "Dates in the next six months"],
  ["ios-capture.png", "Capture", "Scanner, photo or file to the vault Inbox"],
  ["ios-settings.png", "Settings", "Secure Enclave key, pin status, devices"],
];
const WATCH = [
  ["watch-approvals.png", "Approve", "Pending requests and the next date"],
  ["watch-approval-detail.png", "Detail", "Facts, then Approve or Deny; never values"],
];
function gallery(el, items) {
  el.innerHTML = items
    .map(
      ([f, t, d]) =>
        `<figure data-src="shots/${f}" data-cap="${t}: ${d}"><img src="shots/${f}" loading="lazy" alt="${t}"><figcaption><b>${t}</b><span class="muted">${d}</span></figcaption></figure>`,
    )
    .join("");
  for (const f of el.querySelectorAll("figure")) {
    f.onclick = () => {
      const lb = $("#lightbox");
      lb.querySelector("img").src = f.dataset.src;
      lb.querySelector("p").textContent = f.dataset.cap;
      lb.hidden = false;
    };
  }
}
gallery($("#ios"), IOS);
gallery($("#watch"), WATCH);
$("#lightbox").onclick = () => {
  $("#lightbox").hidden = true;
};

// ---------------------------------------------------------------- sequence diagram
const LANES = [
  ["Agent", "Claude, ChatGPT…"],
  ["Node", "your NAS / desktop"],
  ["Push gateway", "Cloudflare Worker"],
  ["Apple / Google", "APNs, FCM"],
  ["Phone", "Secure Enclave / Keystore"],
];
const X = LANES.map((_, i) => 100 + i * 195);
const STEPS = [
  [
    0,
    1,
    "reveal_field(passport_number)",
    "The agent asks for a sensitive value. The node doesn't return it; it records a pending approval and answers pending_approval.",
  ],
  [1, 2, "wake {ticket, kind}", "The node wakes your devices through the gateway with an opaque ticket. It never sees your APNs or FCM token."],
  [2, 3, "generic alert", "The gateway sends Apple or Google a generic “Something needs your approval”. No details leave your node."],
  [3, 4, "notification", "Your phone shows the notification. Tapping it opens Satchel."],
  [
    4,
    1,
    "GET approvals (pinned TLS)",
    "The app fetches the request from your node over a connection pinned to the node's own key, so a relay or a mis-issued certificate can't swap the details.",
  ],
  [
    4,
    4,
    "Face ID → sign",
    "You check the facts (agent, target, masked value). Approving unlocks the hardware key with Face ID or a fingerprint, and it signs node id, approval id, decision, action, target, detail hash and time.",
  ],
  [
    4,
    1,
    "decision + signature",
    "The node verifies the signature against the key it stored at pairing, checks the time window and that the request is still pending, then records who signed.",
  ],
  [0, 1, "check_approval", "The agent picks the value up once. The audit log records exactly which agent received it."],
];
const lh = $("#laneHeads");
lh.innerHTML = LANES.map(
  ([t, s], i) =>
    `<text x="${X[i]}" y="26" class="lane-label">${t}</text><text x="${X[i]}" y="42" class="lane-sub">${s}</text><line x1="${X[i]}" y1="52" x2="${X[i]}" y2="410" class="lane-line"/>`,
).join("");
const msgs = $("#msgs");
msgs.innerHTML = STEPS.map(([a, b, label], i) => {
  const y = 80 + i * 42;
  const self = a === b;
  // Self-steps (signing on the phone) loop to the left so their label stays inside the drawing.
  const d = self ? `M${X[a]} ${y} h-40 v18 h40` : `M${X[a]} ${y} L${X[b]} ${y}`;
  const tx = self ? X[a] - 48 : (X[a] + X[b]) / 2;
  return `<path id="m${i}" class="msg" d="${d}"/><text id="t${i}" x="${tx}" y="${self ? y + 13 : y - 7}" class="msg-text" text-anchor="${self ? "end" : "middle"}">${label}</text>`;
}).join("");

let step = 0;
let timer = null;
let anim = null;
function show(i) {
  step = (i + STEPS.length) % STEPS.length;
  STEPS.forEach((_, j) => {
    $(`#m${j}`).classList.toggle("on", j <= step);
    $(`#t${j}`).classList.toggle("on", j === step);
  });
  $("#stepCount").textContent = `Step ${step + 1} of ${STEPS.length}`;
  $("#stepText").textContent = STEPS[step][3];
  const path = $(`#m${step}`);
  const len = path.getTotalLength();
  const t0 = performance.now();
  cancelAnimationFrame(anim);
  const frame = (t) => {
    const k = Math.min(1, (t - t0) / 900);
    const p = path.getPointAtLength(k * len);
    $("#pkt").setAttribute("cx", p.x);
    $("#pkt").setAttribute("cy", p.y);
    if (k < 1) anim = requestAnimationFrame(frame);
  };
  anim = requestAnimationFrame(frame);
}
function stop() {
  clearInterval(timer);
  timer = null;
  $("#play").textContent = "Play";
}
$("#play").onclick = () => {
  if (timer) return stop();
  $("#play").textContent = "Pause";
  show(step);
  timer = setInterval(() => (step === STEPS.length - 1 ? stop() : show(step + 1)), 3000);
};
$("#next").onclick = () => {
  stop();
  show(step + 1);
};
$("#prev").onclick = () => {
  stop();
  show(step - 1);
};
show(0);
