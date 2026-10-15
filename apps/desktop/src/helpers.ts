import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SatchelNode } from "@satchel/node";

const OCR_EXT = new Set([".png", ".jpg", ".jpeg", ".heic", ".tif", ".tiff", ".pdf"]);

/**
 * Helpers run next to the node and do the heavy lifting a NAS can't: OCR via the OS, and
 * metadata suggestions from a small local model. Their output is ordinary node data (text cache
 * and sidecar metadata), journaled like any agent's.
 */
export class Helpers {
  readonly node: SatchelNode;
  readonly ocrBin: string | null;
  private busy = false;
  private failed = new Set<string>();
  status = { ocr: 0, suggested: 0, last: null as string | null };

  constructor(node: SatchelNode, resourcesDir: string) {
    this.node = node;
    const candidates = [path.join(resourcesDir, "helpers", "satchel-ocr"), path.join(import.meta.dirname ?? ".", "..", "helpers", "bin", "satchel-ocr")];
    this.ocrBin = process.platform === "darwin" ? candidates.find((c) => existsSync(c)) ?? null : null;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { helpers } = this.node.config;
      const todo = this.node.vault.listUnprocessed(["*"], 25);
      for (const f of todo) {
        if (this.failed.has(f.vpath)) continue;
        if (!f.hasText && helpers.ocr && this.ocrBin && OCR_EXT.has(path.extname(f.name).toLowerCase())) {
          const text = await this.ocr(this.node.absPath(f.vpath)).catch(() => "");
          if (text.trim()) {
            await this.node.vault.putText(f.vpath, text);
            this.status.ocr++;
          } else this.failed.add(f.vpath);
        }
        const fresh = this.node.vault.get(f.vpath);
        if (fresh?.hasText && helpers.llm && !fresh.meta?.doc_type) {
          const meta = await this.suggest(f.vpath).catch(() => null);
          if (meta) {
            await this.node.vault.setMetadata(f.vpath, { ...meta, suggested_by: `local model (${helpers.llm.model})` }, { actor: "Satchel desktop helper" });
            this.status.suggested++;
          } else this.failed.add(f.vpath);
        }
      }
      this.status.last = new Date().toISOString();
    } finally {
      this.busy = false;
    }
  }

  private ocr(file: string): Promise<string> {
    return new Promise((resolve, reject) =>
      execFile(this.ocrBin!, [file], { timeout: 60_000, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(out))),
    );
  }

  /** Asks an Ollama-compatible endpoint for a few well-known keys, as JSON. */
  private async suggest(vpath: string): Promise<Record<string, unknown> | null> {
    const llm = this.node.config.helpers.llm!;
    const { text } = await this.node.vault.readText(vpath, 6000);
    if (!text) return null;
    const prompt = `You file personal records. Read the document and answer with JSON only:
{"doc_type": snake_case kind like drivers_license|passport|vehicle_registration|insurance_policy|eye_prescription|lease|warranty|receipt|other,
 "title": short human title, "subject": person, vehicle, pet or "Home", "issued_on": "YYYY-MM-DD" or null, "expires_on": "YYYY-MM-DD" or null}
File name: ${path.posix.basename(vpath)}
Document:
${text}`;
    const res = await fetch(`${llm.url.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: llm.model, prompt, format: "json", stream: false, options: { temperature: 0 } }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    const parsed = JSON.parse(body.response ?? "{}");
    const out: Record<string, unknown> = {};
    for (const k of ["doc_type", "title", "subject", "issued_on", "expires_on"]) {
      const v = parsed[k];
      if (typeof v !== "string" || !v.trim()) continue;
      if (k.endsWith("_on") && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
      out[k] = v.trim();
    }
    return out.doc_type ? out : null;
  }
}
