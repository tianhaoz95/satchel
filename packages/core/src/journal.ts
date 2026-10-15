import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { JournalEntry } from "./types.ts";

/**
 * Append-only journal stored inside each root at `.satchel/journal.jsonl`, so undo history
 * travels with the data and survives replacing the app or the machine.
 */
export class Journal {
  readonly file: string;

  constructor(rootPath: string) {
    this.file = path.join(rootPath, ".satchel", "journal.jsonl");
  }

  async append(entry: Omit<JournalEntry, "id" | "at">): Promise<JournalEntry> {
    const full: JournalEntry = { id: randomUUID(), at: new Date().toISOString(), ...entry };
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(full) + "\n", "utf8");
    return full;
  }

  async list(): Promise<JournalEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err: any) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    const out: JournalEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // A torn final line (crash mid-write) is skipped rather than failing the whole journal.
      }
    }
    return out;
  }

  async undone(): Promise<Set<string>> {
    const set = new Set<string>();
    for (const e of await this.list()) if (e.kind === "undo" && e.undoes) set.add(e.undoes);
    return set;
  }
}
