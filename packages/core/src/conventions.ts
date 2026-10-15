/**
 * The starter VAULT.md written into a new root. It is plain text that every agent reads and the
 * owner (or an agent, with approval) can rewrite. All "policy" about naming and reminders lives
 * here, so a smarter agent can do more with it without any change to Satchel itself.
 *
 * Security policy (masking, scopes, approvals) deliberately does NOT live here.
 */
export const DEFAULT_CONVENTIONS = `# VAULT.md

Instructions for any AI agent working with this vault. The owner edits this file;
agents may propose changes with the \`propose_conventions\` tool.

## What this vault is for
Personal and household records: IDs, vehicle paperwork, insurance, medical prescriptions,
warranties, leases and anything else with a date that matters.

## Folder layout
Group by *subject* first, then by kind of record:

    People/<Name>/<Record kind>/
    Vehicles/<Year Make Model>/<Record kind>/
    Home/<Record kind>/
    Pets/<Name>/<Record kind>/

## File names
\`YYYY-MM <What it is> (exp YYYY-MM).<ext>\` – drop the \`(exp …)\` part if it never expires.
Example: \`2026-03 Registration (exp 2027-03).pdf\`. Keep older versions in an \`_archive/\`
folder next to the current one instead of deleting them.

## Metadata
Every file gets a sidecar. Use these keys when they apply, add any others you need:
\`doc_type\`, \`subject\`, \`title\`, \`issued_on\`, \`expires_on\`, \`renew_by\`, \`tags\`, \`notes\`.
Dates are \`YYYY-MM-DD\`. Put identifiers (license numbers, policy numbers) in their own keys;
Satchel masks them automatically.

## Reminders
When you check this vault on a schedule:
- Look \`90\` days ahead with \`list_expiring\`.
- Passports: start renewal 6 months before expiry (many countries require 6 months validity).
- Driver licenses and vehicle registration: remind 60 days before.
- Eye prescriptions: remind 30 days before; the owner usually books an exam.
- If \`vault_status\` says no agent has checked in for more than 14 days, mention it.

## Things to never do
- Never ask for unmasked identifiers unless the owner asked for that exact value.
- Prefer \`deliver_to_user\` over \`reveal_field\` when the owner just needs to read a number.
`;
