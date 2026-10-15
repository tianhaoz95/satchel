# Self-hosting the relay

The relay is one small Node.js process. It's multi-tenant, so a family or a team can share one.

```bash
docker run -d --name satchel-relay --restart unless-stopped \
  -p 443:443 -p 7443:7443 \
  -e SATCHEL_RELAY_DOMAIN=vault.example.com \
  -e SATCHEL_RELAY_API_HOST=relay.vault.example.com \
  -e SATCHEL_RELAY_TLS_CERT=/certs/relay.pem -e SATCHEL_RELAY_TLS_KEY=/certs/relay.key \
  -v $PWD/certs:/certs -v $PWD/relay:/data -e SATCHEL_RELAY_NODES_FILE=/data/nodes.json \
  ghcr.io/tianhaoz95/satchel-relay:latest

docker exec satchel-relay satchel-relay add-node alex   # prints the node token
```

DNS: point `*.vault.example.com` and `relay.vault.example.com` at the server. The relay's own certificate (for the control port and API) is only for the relay hostname. Node certificates stay on the nodes.

| Variable | Meaning |
|---|---|
| `SATCHEL_RELAY_DOMAIN` | Nodes get `<sub>.<domain>` |
| `SATCHEL_RELAY_API_HOST` | The relay's own hostname |
| `SATCHEL_RELAY_PUBLIC_PORT` / `SATCHEL_RELAY_CONTROL_PORT` | Default 443 / 7443 |
| `SATCHEL_RELAY_NODES_FILE` | Token hashes → subdomains (self-hosted mode) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Use the portal's database instead (hosted mode) |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` | Enable the DNS-01 helper so nodes get real certificates |

## Cloudflare Tunnel and Tailscale

You can also expose the relay's ports through a tunnel. Be aware that Cloudflare Tunnel's HTTPS mode terminates TLS at Cloudflare. Use its TCP mode, or Tailscale Funnel (which keeps TLS on your device), to preserve end-to-end encryption.

## Local connections

The node always also listens on `127.0.0.1:7710`, so agents on the same machine connect directly without any relay.
