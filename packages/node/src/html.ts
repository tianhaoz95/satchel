export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Shared flat styling for every page the node serves (consent, admin, companion). */
export const BASE_CSS = `
:root{--bg:#fafaf9;--surface:#fff;--ink:#1c1917;--muted:#78716c;--line:#e7e5e4;--accent:#1f6f50;--accent-ink:#fff;--soft:#f0f7f3;--warn:#a15c07;--warn-soft:#fdf6e9;--danger:#b42318;--danger-soft:#fdf0ef;--radius:8px;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--surface:#1c1b1a;--ink:#f2f1ef;--muted:#a19d98;--line:#2e2c2a;--accent:#4fb487;--accent-ink:#0c1a13;--soft:#18271f;--warn:#e3a33b;--warn-soft:#2a2214;--danger:#f2776b;--danger-soft:#2c1715}}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}code,pre{font-family:var(--mono);font-size:.9em}
h1{font-size:1.5rem;line-height:1.25;margin:.2rem 0 .6rem;letter-spacing:-.01em}h2{font-size:1.1rem;margin:1.6rem 0 .6rem}h3{font-size:1rem;margin:1rem 0 .4rem}
.muted{color:var(--muted)}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:.72rem;color:var(--muted);margin:0}
.wrap{max-width:1040px;margin:0 auto;padding:24px 16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.narrow{max-width:520px;margin:48px auto}
fieldset{border:1px solid var(--line);border-radius:var(--radius);margin:14px 0;padding:10px 14px}legend{font-weight:600;font-size:.85rem;padding:0 4px}
label{display:block;margin:10px 0;font-weight:500}
label.check{display:flex;gap:8px;align-items:baseline;font-weight:400;margin:6px 0}
input[type=text],input[type=password],input[type=search],input[type=date],select,textarea{display:block;width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit}
textarea{font-family:var(--mono);font-size:13px;min-height:220px}
button,.button{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-weight:500;cursor:pointer;text-decoration:none}
button:hover,.button:hover{border-color:var(--muted)}
button.primary,.button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
button.danger{color:var(--danger)}
button:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
.error{background:var(--danger-soft);color:var(--danger);padding:8px 12px;border-radius:6px}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:.78rem;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.pill.ok{background:var(--soft);border-color:transparent;color:var(--accent)}.pill.warn{background:var(--warn-soft);border-color:transparent;color:var(--warn)}.pill.bad{background:var(--danger-soft);border-color:transparent;color:var(--danger)}
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}
`;

export function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${BASE_CSS}</style>${extraHead}</head><body><main class="wrap">${body}</main></body></html>`;
}
