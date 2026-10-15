# VAULT.md

Every root has a `VAULT.md`. It is plain text that every agent reads before working in your vault. It holds the policy that would otherwise be hard-coded:

- folder layout and file naming
- which metadata keys to use
- reminder habits ("passports: start 6 months early")
- things agents should never do

Because it's text, a smarter agent simply does more with it, and it moves with your files when you switch agents. Agents can propose edits with `propose_conventions`; you approve them like any other change.

## What does NOT go in VAULT.md

Security policy: masking rules, approval requirements and per-agent permissions. Those live in the node's private config, outside your folders, under **Security** in the app. An agent that has been prompt-injected could rewrite VAULT.md. It can never relax its own restrictions.

## Default layout

```
People/<Name>/<Record kind>/
Vehicles/<Year Make Model>/<Record kind>/
Home/<Record kind>/
Pets/<Name>/<Record kind>/
```

File names: `YYYY-MM <What it is> (exp YYYY-MM).<ext>`, for example `2026-03 Registration (exp 2027-03).pdf`. Older versions go to `_archive/` next to the current one.
