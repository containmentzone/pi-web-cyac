import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ThreadMeta {
  archived?: boolean;
}

/** Small JSON file for UI-only thread state. pi's session files stay the source of truth for content. */
export class Sidecar {
  private data: Record<string, ThreadMeta> = {};

  constructor(private readonly file: string) {
    try {
      this.data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      this.data = {};
    }
  }

  get(id: string): ThreadMeta {
    return this.data[id] ?? {};
  }

  set(id: string, patch: ThreadMeta): void {
    this.data[id] = { ...this.data[id], ...patch };
    this.save();
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`[pi-web] could not write ${this.file}:`, err);
    }
  }
}
