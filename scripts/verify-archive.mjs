import { readFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { sha256 } from "../lib/archive-store.js";
const root = resolve(process.argv[2] || "");
if (!process.argv[2]) { console.error("Usage: node scripts/verify-archive.mjs <archive-folder>"); process.exit(2); }
let failed = 0;
try {
  const manifest = JSON.parse(readFileSync(join(root, "archive-manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Invalid archive manifest");
  for (const file of manifest.files) {
    const path = resolve(root, file.path);
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Manifest path outside archive");
    if (!existsSync(path)) { console.error(`Missing: ${file.path}`); failed++; continue; }
    const realRel = relative(realpathSync(root), realpathSync(path));
    if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) throw new Error("Linked manifest path outside archive");
    if (!lstatSync(path).isFile() || lstatSync(path).size !== file.size || sha256(path) !== file.sha256) { console.error(`Mismatch: ${file.path}`); failed++; }
  }
  console.log(`${manifest.files.length} manifest entries checked; ${failed} mismatch(es). Last operation: ${manifest.report?.status || "unknown"}.`);
  console.log("Hashes check saved bytes against this manifest, not completeness against ChatGPT. Extra files are not checked.");
} catch (error) { console.error(error.message); process.exit(2); }
process.exitCode = failed ? 1 : 0;
