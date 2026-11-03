import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Path outside archive");
  let p = resolve(path);
  while (!existsSync(p)) p = dirname(p);
  const realRel = relative(realpathSync(root), realpathSync(p));
  if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) throw new Error("Linked path outside archive");
  return resolve(path);
}

export function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.partial-${randomUUID()}`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
  }
  finally { if (existsSync(temp)) rmSync(temp); }
}

// One archive writer, including recovery. A dead process's lock may be reclaimed.
export function lockArchive(root) {
  mkdirSync(root, { recursive: true });
  root = realpathSync.native(root);
  const path = join(root, ".export-lock");
  const guard = `${path}.guard`;
  let guardOwned = false;
  try {
    // Serialize stale-lock inspection and replacement. Without this guard, two
    // reclaimers can each remove the other's newly acquired live lock.
    const guardFd = openSync(guard, "wx", 0o600);
    guardOwned = true;
    try { writeFileSync(guardFd, JSON.stringify({ pid: process.pid })); } finally { closeSync(guardFd); }
    if (existsSync(path)) {
      const pid = JSON.parse(readFileSync(path, "utf8")).pid;
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid archive lock; inspect it manually");
      try { process.kill(pid, 0); throw new Error("Archive is already in use"); }
      catch (e) { if (e.code !== "ESRCH") throw e; }
      rmSync(path);
    }
    const fd = openSync(path, "wx");
    writeFileSync(fd, JSON.stringify({ pid: process.pid })); closeSync(fd);
    return () => rmSync(path, { force: true });
  } catch (e) { throw new Error(`Cannot lock archive: ${e.message}`); }
  finally { if (guardOwned) rmSync(guard, { force: true }); }
}

function safeCopy(source, target) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error("Symbolic links are not archive artifacts");
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("Linked artifact destination");
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const ent of readdirSync(source)) safeCopy(join(source, ent), join(target, ent));
  } else if (stat.isFile()) { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); }
  else throw new Error("Unsupported archive artifact");
}

function removeArtifact(path) {
  if (!existsSync(path)) return;
  // Resolve Windows 8.3 aliases before mutation and verify the observed result.
  const canonical = realpathSync.native(path);
  if (lstatSync(canonical).isDirectory()) {
    for (const name of readdirSync(canonical)) removeArtifact(join(canonical, name));
    rmdirSync(canonical);
  } else unlinkSync(canonical);
  if (existsSync(canonical)) throw new Error("Artifact removal did not complete");
}

function restore(root, txDir, journal) {
  for (const entry of [...journal.entries].reverse()) {
    const target = inside(root, join(root, entry.target));
    const backup = inside(root, join(txDir, entry.backup));
    if (!entry.started) continue;
    removeArtifact(target);
    if (entry.hadTarget) safeCopy(backup, target);
  }
}

function finish(root, txDir, journal) {
  // Source removal only follows a durable committed journal; backups are retained.
  for (const sourceRel of journal.retire) {
    const source = inside(root, join(root, sourceRel));
    const saved = inside(root, join(txDir, "sources", sourceRel));
    if (!existsSync(source)) continue;
    // A previous process may have stopped midway through this directory copy.
    // Recopy idempotently before retiring the still-present source.
    safeCopy(source, saved);
    removeArtifact(source);
  }
  journal.state = "complete";
  atomicWrite(join(txDir, "journal.json"), JSON.stringify(journal, null, 2));
}

export function recoverTransactions(root) {
  const dir = join(root, "superseded");
  if (!existsSync(dir)) return [];
  const recovered = [];
  for (const name of readdirSync(dir)) {
    const txDir = inside(root, join(dir, name));
    const path = join(txDir, "journal.json");
    if (!existsSync(path)) continue;
    const journal = JSON.parse(readFileSync(path, "utf8"));
    if (!["prepared", "applying", "committed", "complete", "rolled-back"].includes(journal.state) || !Array.isArray(journal.entries) || !Array.isArray(journal.retire)) throw new Error("Invalid transaction journal");
    if (journal.state === "complete" || journal.state === "rolled-back") continue;
    if (journal.state === "committed") finish(root, txDir, journal);
    else {
      restore(root, txDir, journal); journal.state = "rolled-back";
      atomicWrite(path, JSON.stringify(journal, null, 2));
    }
    recovered.push(name);
  }
  return recovered;
}

// Prepared generations and all replaced bytes remain under superseded/. A crash
// is resolved on the next locked run; this is recovery, not multi-file atomicity.
export function publishGeneration(root, artifacts, retire = [], fault = () => {}) {
  const txDir = join(root, "superseded", randomUUID());
  inside(root, txDir);
  mkdirSync(txDir, { recursive: true });
  const targets = new Set(artifacts.map(a => resolve(a.target)));
  const fileIdentity = (path) => {
    if (!existsSync(path)) return null;
    const stat = statSync(path, { bigint: true });
    return stat.ino ? `${stat.dev}:${stat.ino}` : null;
  };
  // Case-only path changes may alias on NTFS/APFS. Never retire the newly
  // published target through a differently cased name for the same artifact.
  const targetIdentities = new Set(artifacts.map(a => fileIdentity(a.target)).filter(Boolean));
  const journal = { state: "prepared", entries: [], retire: retire.filter(p => !targets.has(resolve(p)) && !(fileIdentity(p) && targetIdentities.has(fileIdentity(p)))).map(p => relative(root, inside(root, p))) };
  for (let i = 0; i < artifacts.length; i++) {
    const { source, target } = artifacts[i];
    inside(root, source); inside(root, target);
    const entry = { target: relative(root, target), backup: `backups/${i}`, stage: `new/${i}`, hadTarget: existsSync(target), started: false };
    safeCopy(source, join(txDir, entry.stage));
    if (entry.hadTarget) safeCopy(target, join(txDir, entry.backup));
    journal.entries.push(entry);
  }
  const journalPath = join(txDir, "journal.json");
  atomicWrite(journalPath, JSON.stringify(journal, null, 2));
  try {
    for (let i = 0; i < journal.entries.length; i++) {
      const entry = journal.entries[i];
      journal.state = "applying"; entry.started = true;
      atomicWrite(journalPath, JSON.stringify(journal, null, 2));
      const target = inside(root, join(root, entry.target));
      mkdirSync(dirname(target), { recursive: true });
      removeArtifact(target);
      safeCopy(join(txDir, entry.stage), target);
      fault(i, txDir);
    }
    journal.state = "committed";
    atomicWrite(journalPath, JSON.stringify(journal, null, 2));
  } catch (e) {
    restore(root, txDir, journal); journal.state = "rolled-back";
    atomicWrite(journalPath, JSON.stringify(journal, null, 2)); throw e;
  }
  finish(root, txDir, journal);
  return txDir;
}

export function artifactPaths(base, fname) {
  return [["files", ""], ["markdown", ".md"], ["html", ".html"], ["json", ".json"]].map(([folder, ext]) => join(base, folder, fname + ext));
}

export function sha256(path) {
  const hash = createHash("sha256"), block = Buffer.allocUnsafe(1024 * 1024), fd = openSync(path, "r");
  try { let count; while ((count = readSync(fd, block, 0, block.length, null))) hash.update(block.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest("hex");
}

export function writeArchiveManifest(root, report) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = inside(root, join(dir, entry.name));
      if (path === join(root, "archive-manifest.json") || path === join(root, ".export-lock")) continue;
      if (entry.isSymbolicLink()) throw new Error("Archive contains a symbolic link");
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push({ path: relative(root, path).split(sep).join("/"), size: lstatSync(path).size, sha256: sha256(path) });
    }
  };
  walk(root);
  atomicWrite(join(root, "archive-manifest.json"), JSON.stringify({ version: 1, report, files }, null, 2));
  return files;
}
