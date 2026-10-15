import type { Metadata, SecurityPolicy } from "./types.ts";

export function sensitiveKeys(meta: Metadata, policy: SecurityPolicy): Set<string> {
  const keys = new Set<string>(Array.isArray(meta.sensitive) ? meta.sensitive.map(String) : []);
  const patterns = policy.sensitivePatterns.map((p) => new RegExp(p, "i"));
  for (const key of Object.keys(meta)) {
    if (key === "sensitive") continue;
    if (patterns.some((re) => re.test(key))) keys.add(key);
  }
  return keys;
}

export function maskValue(value: unknown): string {
  const s = String(value ?? "");
  if (s.length <= 2) return "••••";
  const keep = Math.min(4, Math.floor(s.length / 3));
  return s.slice(0, keep) + "•".repeat(Math.max(4, s.length - keep));
}

/** Returns a copy of `meta` with sensitive values masked, plus the list of masked keys. */
export function maskMetadata(meta: Metadata, policy: SecurityPolicy): { meta: Metadata; masked: string[] } {
  const keys = sensitiveKeys(meta, policy);
  const out: Metadata = {};
  const masked: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (keys.has(k) && v != null && v !== "") {
      out[k] = maskValue(v);
      masked.push(k);
    } else {
      out[k] = v;
    }
  }
  return { meta: out, masked };
}

/**
 * Agents may add sensitivity markers but never remove them: merging new metadata keeps the
 * union of the old and new `sensitive` lists.
 */
export function mergeMetadata(existing: Metadata | null, patch: Metadata, replace: boolean): Metadata {
  const base: Metadata = replace ? {} : { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "sensitive") continue;
    if (v === null) delete base[k];
    else base[k] = v;
  }
  const sens = new Set<string>([...((existing?.sensitive as string[] | undefined) ?? []), ...((patch.sensitive as string[] | undefined) ?? [])]);
  if (sens.size) base.sensitive = [...sens].sort();
  return base;
}
