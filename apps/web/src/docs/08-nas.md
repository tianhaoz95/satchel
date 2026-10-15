# NAS install

A NAS is the ideal home for a node: always on, usually on a UPS, already holding your documents. The node image is multi-arch (x86-64 and ARM64).

## Synology DSM (Container Manager)

1. **Container Manager → Project → Create**, path `/docker/satchel`.
2. Paste `docker-compose.yml` from the repository (`deploy/docker-compose.yml`) and set the vault folder, e.g. `/volume1/Records:/vault`.
3. Set `SATCHEL_PASSWORD`, start, then open `http://<nas>:7710`.

Synology's `@eaDir` thumbnail folders and `#recycle` are ignored automatically.

## Unraid

Install the **Satchel** template from Community Applications (or add `ghcr.io/tianhaoz95/satchel-node`), map `/vault` to a share and `/data` to `appdata/satchel`.

## TrueNAS SCALE, QNAP, Umbrel, CasaOS

Use the same compose file through the platform's custom-app / compose installer.

## Heavy lifting

NAS CPUs are often small. The desktop app can act as a **helper** for a NAS node: it OCRs scans and runs a small local model, then writes text and suggested metadata back to the NAS node. The node itself never needs a GPU.
