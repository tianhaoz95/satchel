# Connecting agents

Satchel speaks MCP over Streamable HTTP at `/mcp`, protected by OAuth 2.1. The authorization server is embedded in your node.

## OAuth (cloud connectors)

1. Add `https://<you>.satchel.dev/mcp` as a custom connector.
2. The client discovers `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`, then registers itself dynamically (RFC 7591).
3. You land on the consent page on your node. Choose folders and permissions, then confirm with your owner password.
4. The client exchanges the code with PKCE. It gets a 1-hour access token and a 90-day refresh token.

Revoke access any time under **Connections**.

## Personal access tokens

For CLI agents and scripts. Create them under **Connections** or with `satchel token --label "Claude Code" --scopes read,write`.

## Permissions

| Scope | Allows |
|---|---|
| `read` | Search, read records and document text. Sensitive fields are masked and known sensitive values are redacted from text |
| `write` | Edit metadata sidecars |
| `organize` | Propose moves/renames and VAULT.md changes (you approve), undo journal entries |
| `reveal` | See sensitive fields without approval. Only for agents you fully trust, such as a local model |

Each connection is also limited to the folders (roots) you picked.

## Scheduling reminders

Satchel doesn't decide when to remind you; your agent does. Most agents can run scheduled tasks. A good weekly prompt:

> "Check Satchel: call vault_status and list_expiring, follow the reminder rules in VAULT.md, and tell me what needs attention."

`vault_status` reports when any agent last checked in, so a capable agent can notice when your reminders have gone quiet.
