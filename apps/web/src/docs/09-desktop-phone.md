# Desktop, phone and watch

## Desktop app

The desktop app runs a full node in-process and adds:

- **Menu bar / tray** status, with notifications when an approval is waiting
- **OCR helper.** On macOS it uses the built-in Vision framework, so images and scanned PDFs become searchable without any cloud service
- **Local model helper (optional).** Point it at an Ollama-compatible endpoint; it suggests `doc_type`, `title` and dates for new files and writes them as metadata
- **Helper for a remote node.** Connect it to your NAS node and it processes files there

## Phone and watch apps

Native apps for **iPhone, Apple Watch, Android and Wear OS** are the second factor for your vault.

- **Pairing:** in the admin UI open **Phone → Show pairing code** and scan it with the app. The phone creates a P-256 key in its Secure Enclave or Android Keystore, which never leaves the chip, and proves to your node that it holds it. The QR code also carries the pin of your node's TLS key, so the app only ever talks to your node.
- **Why not just sign in with GitHub?** GitHub proves who you are to the portal. Pairing proves this device belongs to this node, and on purpose the portal can't vouch for that. Otherwise a stolen GitHub account could add a "phone" and approve reveals.
- **Approvals:** reveals, reorganizations and VAULT.md changes need a decision signed by a paired device after Face ID or a fingerprint. Once a phone is paired, the admin page and the web companion can only deny them. You can change this under **Security**.
- **Watches** enroll through your phone: the watch makes its own key and the phone countersigns it. Watches approve and deny but never show delivered values.
- **Inbox:** values agents send with `deliver_to_user`, shown after biometrics and deleted after 24 hours.
- **Capture:** the document scanner, a photo or a file, or "Share to Satchel" from other apps, straight into your vault's Inbox folder.
- **Notifications** carry no content. The Satchel push gateway only learns that a device should wake up, then the app fetches details from your node.

The protocol is specified in `spec/companion/protocol.md` in the repository.

### Web companion

Without the app, the node also serves a small web companion at `/app/` (pair it with the link under the QR code). It can show approvals, your inbox and upcoming dates, and it can deny requests, but it can't approve high-risk ones.
