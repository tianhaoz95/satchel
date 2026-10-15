import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { Metadata } from "./types.ts";

const SUFFIX = ".satchel.yaml";

/** Sidecars live next to the file as a hidden `.<name>.satchel.yaml`, so they travel with it. */
export function sidecarPath(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}${SUFFIX}`);
}

export function isSidecar(name: string): boolean {
  return name.startsWith(".") && name.endsWith(SUFFIX);
}

export async function readSidecar(filePath: string): Promise<Metadata | null> {
  try {
    const raw = await readFile(sidecarPath(filePath), "utf8");
    const parsed = YAML.parse(raw);
    return parsed && typeof parsed === "object" ? (normalize(parsed) as Metadata) : null;
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeSidecar(filePath: string, meta: Metadata): Promise<void> {
  const body = YAML.stringify(normalize(meta), { lineWidth: 0 });
  const header = "# Satchel metadata. Plain YAML: edit it by hand if you like.\n";
  await writeFile(sidecarPath(filePath), header + body, "utf8");
}

export async function removeSidecar(filePath: string): Promise<void> {
  await rm(sidecarPath(filePath), { force: true });
}

/** YAML parses bare dates into Date objects; keep them as ISO date strings. */
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = normalize(v);
    return out;
  }
  return value;
}

/** Keys that look like dates (`*_on`, `*_date`, `*_by`) are indexed for date queries. */
export function dateFields(meta: Metadata): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value !== "string") continue;
    if (!/(_on|_date|_by)$/.test(key)) continue;
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(value)) continue;
    out.push({ key, value: value.length === 7 ? `${value}-01` : value });
  }
  return out;
}
