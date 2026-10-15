# Satchel

**Your records, readable by any AI agent. Carried by you.**

Satchel is an open-source vault for personal records (IDs, vehicle papers, insurance, prescriptions, leases). Files stay in your own folders: a local folder, a NAS share, or a cloud-synced folder. Any MCP-capable agent (Claude, ChatGPT, Gemini, Claude Code, local models) can search them, file new ones and remind you before anything expires. Switch agents whenever you like; nothing is locked in.

```
AI agents ──MCP/HTTPS──▶ Relay (SNI passthrough) ──tunnel──▶ Your node ──▶ Your folders
                                                               ▲
                                              Phone companion ─┘  (approvals, inbox, capture)
```

## Repository

| Path | What |
|---|---|
| `packages/core` | Vault engine: sidecars, index (SQLite FTS5), journal/undo, masking, tunnel protocol |
| `packages/node` | The node: MCP server (17 tools), embedded OAuth 2.1 server, approvals, audit, admin UI, phone PWA, tunnel client, ACME |
| `packages/relay` | Multi-tenant TLS-passthrough relay with Supabase or file-based node registry and a DNS-01 helper |
| `apps/web` | Landing page, docs and portal (Vite + React → Cloudflare Pages, Supabase auth) |
| `apps/desktop` | Electron app: runs a node, tray, notifications, macOS Vision OCR, local-model helper |
| `supabase/` | Portal schema and RLS |
| `deploy/` | Dockerfiles and compose files for NAS and relay |
| `.github/workflows` | CI, Cloudflare Pages deploy, Supabase migrations, multi-arch images, desktop releases, relay deploy |
| `report/mvp` | MVP walkthrough site (`report/mvp/script/serve.sh`) |

## Develop

Requires Node.js 24+ (TypeScript runs natively, no build step for the server packages) and pnpm.

```bash
pnpm install
pnpm test                       # unit + end-to-end (agent → relay → node, OAuth, approvals)
node scripts/demo-seed.ts       # demo vault in .satchel-dev (password: demo)
node packages/node/src/cli.ts serve --data .satchel-dev/data   # http://127.0.0.1:7710
pnpm dev:web                    # http://localhost:5180 (demo mode without Supabase env)
pnpm --filter @satchel/desktop start
```

Docs: `apps/web/src/docs/` (rendered at `/docs`).

## License

Apache-2.0
