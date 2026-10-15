# Security model

## Who can see what

| Party | Sees |
|---|---|
| **Your node** | Everything. It's your hardware |
| **The relay (satchel.dev or yours)** | Your subdomain (from the TLS SNI field), connection times and byte counts. Not requests, not responses, not tokens |
| **The portal / Supabase** | Your email, subdomain, a SHA-256 hash of your node token, online status |
| **An agent's model provider** | Only what the agent reads: answers to queries, masked metadata, redacted text, and values you explicitly approve |
| **Push services (Apple/Google)** | That a notification happened. Web Push payloads are encrypted to your device and never contain values |

## TLS passthrough

The relay routes connections by the SNI hostname and splices bytes. TLS terminates **on your node**, which holds the certificate's private key. With the hosted relay, the node gets a Let's Encrypt certificate through a DNS-01 challenge: the relay publishes the TXT record, the private key never leaves your node. The remaining trust in the relay operator is that it controls DNS for `satchel.dev`. Certificate Transparency logs make any certificate it issued for your name publicly visible.

## OAuth on your node

The consent page, the owner password check and token signing all run on the node. The relay can't mint access to your vault.

## Minimizing what models see

- **Answer-shaped tools.** `list_expiring` returns titles and dates, not scans.
- **Masking.** Fields matching sensitive patterns (`*_number`, `account`, `passport_number`…) or listed in `sensitive` are masked. Agents can add sensitive keys, never remove them.
- **Redaction.** Known sensitive values are removed from `read_file` text. This is best effort: a value nobody has recorded yet can still appear.
- **Deliver, don't reveal.** `deliver_to_user` sends a value to your phone; the agent only learns it was delivered.
- **Approvals on your phone** show facts first (agent, target, value preview). The agent's reason is labeled unverified.
- **Audit log.** For each agent, Satchel records exactly which sensitive values it received.

## Known limits

- Prompt injection from document text is mitigated, not solved. Keep `reveal` off for cloud agents.
- A model provider retains what its agent saw according to its own policy. Use no-training / zero-retention settings where offered.
