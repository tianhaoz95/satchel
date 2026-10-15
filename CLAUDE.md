# Satchel

Open-source, agent-neutral vault for personal records (IDs, vehicle papers, insurance, prescriptions). Files stay in the user's own folders; any MCP agent connects to a node the user runs. `AGENTS.md` is a symlink to this file.

## Layout

| Path | What |
|---|---|
| `packages/core` | Vault engine: sidecars, SQLite index (`node:sqlite`, FTS5), journal/undo, masking, tunnel wire protocol |
| `packages/node` | The node: MCP tools (`src/mcp.ts`), embedded OAuth 2.1 server (`src/auth.ts`), approvals, audit, admin API, phone API, tunnel client, ACME, CLI |
| `packages/node/ui` | Admin UI (`admin/`) and phone PWA (`app/`): plain ES modules, no build step |
| `packages/relay` | Multi-tenant TLS-passthrough relay (SNI routing), Supabase or file-based node registry, DNS-01 helper |
| `apps/web` | Landing, docs (`src/docs/*.md`), portal: Vite + React → Cloudflare Pages; Supabase auth; demo mode without env |
| `apps/desktop` | Electron app (esbuild-bundled ESM main), tray, notifications, `helpers/ocr.swift` (macOS Vision), local-model helper |
| `supabase/migrations` | Portal schema + RLS (only token hashes, never vault data) |
| `deploy/` | Dockerfiles + compose for NAS node and relay |
| `scripts/` | `demo-seed.ts` and `shoot-*.ts` (Playwright screenshots for the report) |
| `report/mvp` | MVP walkthrough site; `report/mvp/script/serve.sh` |

## Commands

```bash
pnpm install
pnpm typecheck                     # server packages (root tsconfig)
pnpm test                          # node:test, unit + e2e (agent → relay → node)
cd apps/web && npx tsc --noEmit -p . && npx vite build
pnpm --filter @satchel/desktop build
node scripts/demo-seed.ts          # demo vault in .satchel-dev (owner password: demo)
node packages/node/src/cli.ts serve --data .satchel-dev/data   # http://127.0.0.1:7710
```

Run `pnpm typecheck` and `pnpm test` before committing. The e2e test (`packages/node/test/e2e.test.ts`) is the contract for MCP tools, OAuth, approvals, scopes and the relay. Extend it when behavior changes.

## Code conventions

- Server packages run TypeScript **directly on Node 24 via type stripping**, with no build step. That means: import with explicit `.ts` extensions, use `import type` for types, and avoid enums, namespaces and constructor parameter properties (`erasableSyntaxOnly` is on).
- Comments explain *why* (security reasoning, protocol constraints), not what.
- UI styling is simple and flat: 1px borders, one accent color (`--accent`), system fonts, light and dark tokens, **no 3D effects** or heavy shadows. Node UIs share `packages/node/ui/shared/style.css`; the web app has its own matching tokens in `apps/web/src/styles.css`.

## Design rules (user-confirmed; don't regress)

1. **The node is dumb on purpose.** It stores facts, enforces permissions and journals changes. Naming, layout and reminder policy live in each root's `VAULT.md` (plain text agents read). Don't add reminder schedulers or "smart" policy to the server; agents schedule their own checks.
2. **Security policy never lives in the vault.** Masking patterns, approval rules and per-client scopes are in the node's `config.json` (data dir), which agents can't reach.
3. **The relay never sees plaintext.** It routes on SNI and splices bytes; TLS terminates on the node, and the node's key never leaves it. OAuth (consent, password check, token issuance) runs on the node, so the relay or portal can't mint access.
4. **Masking only tightens.** Agents can add `sensitive` keys, never remove them. Masked values stay out of the FTS index. `read_file` redacts known sensitive values.
5. **Prefer delivering over revealing.** `deliver_to_user` sends values to the owner's phone; `reveal_field` needs approval and can be picked up once.
6. **Everything on disk is plain and portable.** Hidden YAML sidecars (`.<file>.satchel.yaml`) move with their files; undo history is `.satchel/journal.jsonl` inside the vault. The SQLite index is a rebuildable cache.
7. **The portal stores only** email, subdomain, a SHA-256 hash of the node token, and online status.
8. **Local first.** NAS shares and cloud-synced folders are just local roots; native cloud APIs come later.

## Gotchas found while building

- pnpm 12 blocks dependency build scripts. New native or binary deps (electron, esbuild) must be added to `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>`).
- The desktop bundle is ESM with a `createRequire` banner (`apps/desktop/build.mjs`). Anything path-based must resolve lazily, as `uiDir()` in `packages/node/src/server.ts` does with `SATCHEL_UI_DIR`, because bundled modules initialize before `main.ts` sets env.
- React: effect callbacks must not return values. In current Chromium, `window.scrollTo` returns a Promise and crashed the app, so wrap effect bodies in braces. Avoid react-router's `<Navigate>`; use `useNavigate` inside an effect.
- MCP SDK auth routers are created per origin (localhost vs public host), so their built-in rate limiters are disabled and a shared limiter is used instead.
- Docker images, Let's Encrypt DNS-01, real Supabase/Cloudflare deploys and Web Push were never verified end to end. Treat them as untested.
- The `satchel.dev` domain is a placeholder. Deploy workflows skip until the Cloudflare/Supabase secrets and variables exist (see `report/mvp/site/index.html#cicd`).
