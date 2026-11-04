import { workPath } from "./archive-layout.js";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { atomicWrite } from "./archive-store.js";

export function entityKey(id) { return createHash("sha256").update(id).digest("hex").slice(0, 20); }

// Persist full identities behind compact case-insensitive path keys. A prefix
// collision extends the key; it never replaces another identity's allocation.
export function archiveKeys(root, digest = id => createHash("sha256").update(id).digest("hex")) {
  const path = workPath(root, "archive-keys.json");
  const saved = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { version: 1, entries: [] };
  if (saved.version !== 1 || !Array.isArray(saved.entries)) throw new Error("Invalid archive key registry");
  const byId = new Map(), byKey = new Map();
  for (const row of saved.entries) {
    if (typeof row.id !== "string" || !/^[a-z]+$/.test(row.kind) || !/^[a-f0-9]{20,64}$/.test(row.key) || !digest(row.id).startsWith(row.key)) throw new Error("Invalid archive identity allocation");
    const id = `${row.kind}:${row.id}`, key = `${row.kind}:${row.key}`;
    if (byId.has(id) || byKey.has(key)) throw new Error("Duplicate archive identity allocation");
    byId.set(id, row.key); byKey.set(key, row.id);
  }
  return (kind, id) => {
    if (byId.has(`${kind}:${id}`)) return byId.get(`${kind}:${id}`);
    const hash = digest(id);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid identity digest");
    for (let length = 20; length <= 64; length += 4) {
      const key = hash.slice(0, length);
      if (byKey.has(`${kind}:${key}`)) continue;
      saved.entries.push({ kind, id, key });
      atomicWrite(path, JSON.stringify(saved, null, 2));
      byId.set(`${kind}:${id}`, key); byKey.set(`${kind}:${key}`, id);
      return key;
    }
    throw new Error("Cannot allocate a unique archive identity key");
  };
}

export function portablePath(path) {
  // Also protects archives made on macOS for later use in Windows tools.
  if (resolve(path).length > 250) throw new Error("Archive path exceeds 250 characters; choose a shorter local output folder");
  return path;
}
