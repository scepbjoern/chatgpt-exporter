import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Legacy archives remain in place. A new layout is opt-in for API callers and
// enabled by the UI; never relocate recovery journals containing absolute paths.
export function organized(root) {
  const path = join(root, "archive-layout.json");
  if (!existsSync(path)) return false;
  if (lstatSync(path).isSymbolicLink()) throw new Error("Linked archive layout is forbidden");
  for (const name of ["archive", "_work"]) if (existsSync(join(root, name)) && lstatSync(join(root, name)).isSymbolicLink()) throw new Error("Linked archive folders are forbidden");
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (data.version !== 1 || data.archive !== "archive" || data.work !== "_work") throw new Error("Invalid archive layout");
  return true;
}
export function initializeLayout(root, enabled) {
  if (organized(root) || !enabled) return;
  if (readdirSync(root).some(name => ![".export-lock", ".export-lock.guard"].includes(name))) return;
  writeFileSync(join(root, "archive-layout.json"), JSON.stringify({ version: 1, archive: "archive", work: "_work" }), { flag: "wx" });
  mkdirSync(join(root, "archive"), { recursive: true });
  mkdirSync(join(root, "_work"), { recursive: true });
}
export const contentRoot = root => organized(root) ? join(root, "archive") : root;
export const workPath = (root, ...parts) => join(root, ...(organized(root) ? ["_work"] : []), ...parts);
