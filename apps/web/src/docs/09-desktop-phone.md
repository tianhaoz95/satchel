# Desktop and phone

## Desktop app

The desktop app runs a full node in-process and adds:

- **Menu bar / tray** status, with notifications when an approval is waiting
- **OCR helper.** On macOS it uses the built-in Vision framework, so images and scanned PDFs become searchable without any cloud service
- **Local model helper (optional).** Point it at an Ollama-compatible endpoint; it suggests `doc_type`, `title` and dates for new files and writes them as metadata
- **Helper for a remote node.** Connect it to your NAS node and it processes files there

## Phone companion

The companion is an installable web app served **by your node** at `/app/`, reached through your relay URL. Nothing passes through the portal.

1. In the app, open **Phone → Show pairing code**.
2. Scan the QR code with your phone and tap **Pair**.
3. Add to Home Screen and turn on notifications.

Tabs:

- **Approve.** Reveal requests, reorganization plans and VAULT.md changes
- **Inbox.** Values agents sent you with `deliver_to_user`, auto-deleted after 24 hours
- **Upcoming.** What expires in the next six months
- **Capture.** Photograph a new document straight into your vault's Inbox folder for an agent to file
