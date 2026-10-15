# Introduction

Satchel is an open-source vault for personal records: driver licenses, passports, vehicle registration, insurance, prescriptions, leases, warranties. Any AI agent can read and maintain these records through the [Model Context Protocol](https://modelcontextprotocol.io).

Agents come and go quickly. If your records live inside one AI vendor's memory, switching agents means starting over, and that vendor holds your data. Satchel turns this around:

- **Your files stay where they are.** A local folder, a NAS share, or a folder synced by Google Drive, Dropbox or OneDrive. Satchel never copies them anywhere.
- **Everything is plain files.** Metadata sits next to each file as a small YAML sidecar. Agent instructions live in `VAULT.md`. The change history is `.satchel/journal.jsonl`. If Satchel disappears, your folder still makes sense to a person.
- **Any MCP agent can connect,** including Claude, ChatGPT, Gemini, Claude Code and local models. You decide per agent which folders it sees and what it may do.
- **The node is dumb on purpose.** Satchel stores facts, enforces permissions and keeps the journal. Interpretation (what to name things, when to remind you) is up to the agent and your `VAULT.md`. Smarter agents do more without any change to Satchel.

## The pieces

| Piece | What it does | Runs on |
|---|---|---|
| **Node** | Indexes your folders, serves MCP, runs the OAuth server, holds approvals and the audit log | Your NAS (Docker), desktop app, or any always-on machine |
| **Desktop app** | Runs a node, adds OCR and an optional local model, notifications | macOS, Windows, Linux |
| **Phone companion** | Approvals, values sent to you by agents, document capture | Installable web app served by your node |
| **Relay** | Gives your node a public HTTPS address without port forwarding. It forwards encrypted bytes only | satchel.dev (hosted) or your own server |
| **Portal** | Account, subdomain and node tokens for the hosted relay | satchel.dev |

Next: [Quick start](/docs/quick-start).
