import { readFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { sha256 } from "../lib/archive-store.js";
const root = resolve(process.argv[2] || "");
if (!process.argv[2]) { console.error("Usage: node scripts/verify-archive.mjs <archive-folder>"); process.exit(2); }
let failed = 0;
const finalStatuses = new Set(["complete-within-requested-scope", "partial"]);

function operationSnapshot() {
  if (existsSync(join(root, ".export-lock"))) throw new Error("Archive operation is incomplete or still locked; finish recovery before verification.");
  const markerPath = join(root, "archive-operation.json");
  if (!existsSync(markerPath)) throw new Error("Archive operation is incomplete: the operation marker is missing.");
  const bytes = readFileSync(markerPath, "utf8");
  let marker;
  try { marker = JSON.parse(bytes); } catch { throw new Error("Archive operation is incomplete: the operation marker is invalid JSON."); }
  if (!marker || typeof marker.runId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(marker.runId) || !finalStatuses.has(marker.status)) {
    throw new Error("Archive operation is incomplete: the current marker has no valid final run status.");
  }
  return { marker, bytes };
}

try {
  const manifest = JSON.parse(readFileSync(join(root, "archive-manifest.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Invalid archive manifest");
  let current;
  try {
    current = operationSnapshot();
    if (current.marker.runId !== manifest.report?.runId) throw new Error("Archive operation is incomplete: the current run ID does not match the saved manifest; the manifest is stale.");
    if (current.marker.status !== manifest.report?.status) throw new Error("Archive operation is incomplete: the current final status does not match the saved manifest; the manifest is stale.");
  } catch (error) { console.error(error.message); process.exit(1); }
  for (const file of manifest.files) {
    const path = resolve(root, file.path);
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Manifest path outside archive");
    if (!existsSync(path)) { console.error(`Missing: ${file.path}`); failed++; continue; }
    const realRel = relative(realpathSync(root), realpathSync(path));
    if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) throw new Error("Linked manifest path outside archive");
    if (!lstatSync(path).isFile() || lstatSync(path).size !== file.size || sha256(path) !== file.sha256) { console.error(`Mismatch: ${file.path}`); failed++; }
  }
  try {
    if (operationSnapshot().bytes !== current.bytes) throw new Error("Archive operation changed during verification; retry when the archive is idle.");
  } catch (error) { console.error(error.message); process.exit(1); }
  console.log(`${manifest.files.length} manifest entries checked; ${failed} mismatch(es). Current recorded operation: ${current.marker.status} (run ${current.marker.runId}).`);
  if (current.marker.status === "partial") console.log("The operation ended with partial results. Passing hashes do not resolve the missing data or errors in its report.");
  console.log("Hashes check saved bytes against this manifest, not completeness against ChatGPT. Extra files are not checked.");
} catch (error) { console.error(error.message); process.exit(2); }
process.exitCode = failed ? 1 : 0;
