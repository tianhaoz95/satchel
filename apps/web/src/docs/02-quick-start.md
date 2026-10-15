# Quick start

## 1. Run a node

**Docker (NAS or server):**

```bash
docker run -d --name satchel --restart unless-stopped \
  -v /volume1/Records:/vault \
  -v satchel-data:/data \
  -e SATCHEL_PASSWORD='choose-a-password' \
  -p 127.0.0.1:7710:7710 \
  ghcr.io/tianhaoz95/satchel-node:latest
```

**From source (Node.js 24+):**

```bash
git clone https://github.com/tianhaoz95/satchel && cd satchel && pnpm install
node packages/node/src/cli.ts init --root home=~/Records --name "My Mac"
node packages/node/src/cli.ts serve
```

Open `http://127.0.0.1:7710` and sign in with the owner password.

## 2. Connect a local agent

Create a token under **Connections**, then for Claude Code:

```bash
claude mcp add --transport http satchel http://127.0.0.1:7710/mcp \
  --header "Authorization: Bearer satchel_pat_…"
```

For clients that launch a command (stdio):

```json
{ "mcpServers": { "satchel": { "command": "satchel", "args": ["stdio", "--token", "satchel_pat_…"] } } }
```

## 3. Go online (optional)

Cloud agents such as claude.ai or ChatGPT need a public HTTPS URL. [Create a node](/portal) in the portal to get a subdomain and a node token, then:

```bash
satchel connect --relay tunnel.satchel.dev:7443 --token satchel_node_…
satchel serve
```

Your node is now at `https://<you>.satchel.dev/mcp`. Add that URL as a custom connector in your agent. You'll see Satchel's consent page, served by **your** node, where you pick folders and permissions.

## 4. Ask your agent

> "Read my Satchel conventions, go through the files that have no metadata, fill them in, and propose a cleaner folder layout."

> "What expires in the next 90 days?"

Approve the reorganization plan in the app or on your phone. Every move can be undone from **Journal**.
