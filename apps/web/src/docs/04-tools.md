# MCP tools

| Tool | Scope | Description |
|---|---|---|
| `vault_status` | read | Roots, counts, files without metadata, last agent activity, today's date |
| `get_conventions` | read | VAULT.md for each visible root. Agents should read this first |
| `browse` | read | Folders with file counts |
| `search` | read | Full-text search over names, metadata and document text, with filters |
| `list_expiring` | read | Records whose `expires_on` / `renew_by` falls in a window. A pure date query |
| `query_dates` | read | Date-range query over any `*_on`, `*_date`, `*_by` key |
| `get_record` | read | Metadata and file info for one file (masked) |
| `read_file` | read | Extracted text (text files, PDFs, helper OCR), redacted |
| `list_unprocessed` | read | Files without a `doc_type` yet |
| `set_metadata` | write | Merge fields into a sidecar. `sensitive` can only grow |
| `propose_reorganization` | organize | A batch of moves; you approve the plan; journaled |
| `propose_conventions` | organize | New VAULT.md text; you approve |
| `undo` | organize | Reverse a journal entry (refuses if the file changed since) |
| `list_journal` | read | Recent changes |
| `reveal_field` | read | Ask to see one sensitive value; needs your approval |
| `deliver_to_user` | read | Send a value to your phone; the agent never sees it |
| `check_approval` | read | Poll an approval; returns the outcome |

## Approvals are asynchronous

Tools that need you return immediately:

```json
{ "status": "pending_approval", "request_id": "…", "message": "The owner must approve this…" }
```

The agent tells you, you tap **Approve** on your phone, and the agent calls `check_approval`. A revealed value can be picked up once.

## Sidecar format

`Scans/registration.pdf` gets `Scans/.registration.pdf.satchel.yaml`:

```yaml
# Satchel metadata. Plain YAML: edit it by hand if you like.
doc_type: vehicle_registration
subject: 2019 Honda Civic
title: Civic registration
expires_on: 2027-03-31
plate_number: 8ABC123
sensitive: [vin_number]
```
