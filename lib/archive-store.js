import { closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

const REMOVAL_DELAYS_MS = [25, 50, 100, 200];
const TRANSIENT_REMOVAL_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function removalAction(action, path, options) {
  const sleep = options.sleepSync || (ms => Atomics.wait(sleepBuffer, 0, 0, ms));
  for (let attempt = 0; ; attempt++) {
    try { return action(); }
    catch (error) {
      if (error.code === "ENOENT") return;
      if (!TRANSIENT_REMOVAL_CODES.has(error.code) || attempt >= REMOVAL_DELAYS_MS.length) {
        const failure = new Error(`Cannot remove archive artifact ${path}: ${error.code || error.message}`);
        failure.code = error.code; failure.cause = error;
        throw failure;
      }
      sleep(REMOVAL_DELAYS_MS[attempt]);
    }
  }
}

function removeArtifact(path, options = {}) {
  if (!existsSync(path)) return;
  if (lstatSync(path).isSymbolicLink()) throw new Error(`Linked artifact removal is forbidden: ${path}`);
  // Resolve Windows 8.3 aliases before mutation and verify the observed result.
  const canonical = realpathSync.native(path);
  if (lstatSync(canonical).isDirectory()) {
    for (const name of readdirSync(canonical)) removeArtifact(join(canonical, name), options);
    removalAction(() => (options.rmdirSync || rmdirSync)(canonical), canonical, options);
  } else removalAction(() => (options.unlinkSync || unlinkSync)(canonical), canonical, options);
  if (existsSync(canonical)) throw new Error(`Artifact removal did not complete: ${canonical}`);
}

function artifactSignature(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Symbolic links are not archive artifacts");
  if (stat.isFile()) return `file:${stat.size}:${sha256(path)}`;
  if (!stat.isDirectory()) throw new Error("Unsupported archive artifact");
  const hash = createHash("sha256");
  for (const name of readdirSync(path).sort()) hash.update(JSON.stringify([name, artifactSignature(join(path, name))]));
  return `directory:${hash.digest("hex")}`;
}

function fileIdentity(path) {
  if (!existsSync(path)) return null;
  const stat = statSync(path, { bigint: true });
  return stat.ino ? `${stat.dev}:${stat.ino}` : null;
}

function foldedPath(path) {
  // Conservative when a volume cannot provide file IDs: keep an ambiguous old
  // source rather than deleting a differently cased alias of a live target.
  return resolve(path).normalize("NFC").toUpperCase().toLowerCase();
}

function restore(root, txDir, journal, options = {}) {
  for (const entry of [...journal.entries].reverse()) {
    const target = inside(root, join(root, entry.target));
    const backup = inside(root, join(txDir, entry.backup));
    if (!entry.started) continue;
    removeArtifact(target, options);
    if (entry.hadTarget) safeCopy(backup, target);
  }
}

function finish(root, txDir, journal, options = {}) {
  // Source removal only follows a durable committed journal; backups are retained.
  for (const sourceRel of journal.retire) {
    const source = inside(root, join(root, sourceRel));
    const savedRel = journal.retireBackups?.[sourceRel] || join("sources", sourceRel);
    const saved = inside(root, join(txDir, savedRel));
    if (!existsSync(source)) continue;
    // A previous process may have stopped midway through this directory copy.
    // Recopy idempotently before retiring the still-present source.
    safeCopy(source, saved);
    removeArtifact(source, options);
  }
  // Even identity-less aliases must not silently retire a new live artifact.
  const checks = journal.checks || journal.entries.map(entry => ({ target: entry.target }));
  for (const check of checks) {
    const target = inside(root, join(root, check.target));
    if (!existsSync(target)) throw new Error(`Published artifact is missing after retirement: ${check.target}`);
    if (check.signature && artifactSignature(target) !== check.signature) throw new Error(`Published artifact differs after retirement: ${check.target}`);
  }
  // new/ is a recovery source until commit and target validation. Afterwards it
  // only duplicates the live bytes; historical backups and retired sources stay.
  removeArtifact(inside(root, join(txDir, "new")), options);
  journal.state = "complete";
  atomicWrite(join(txDir, "journal.json"), JSON.stringify(journal, null, 2));
}

export function recoverTransactions(root, options = {}) {
  const dir = join(root, "superseded");
  if (!existsSync(dir)) return [];
  const recovered = [];
  for (const name of readdirSync(dir)) {
    const txDir = inside(root, join(dir, name));
    const path = join(txDir, "journal.json");
    if (!existsSync(path)) continue;
    const journal = JSON.parse(readFileSync(path, "utf8"));
    if (!["prepared", "applying", "committed", "complete", "rolled-back"].includes(journal.state) || !Array.isArray(journal.entries) || !Array.isArray(journal.retire)) throw new Error("Invalid transaction journal");
    if (journal.state === "complete") {
      // Older successful generations kept a redundant new/ tree. Only remove
      // it after validating the still-live committed targets, never backups.
      if (existsSync(join(txDir, "new"))) {
        const checks = journal.checks || journal.entries.map(entry => {
          const stage = inside(root, join(txDir, entry.stage || "new/missing"));
          return { target: entry.target, signature: existsSync(stage) ? artifactSignature(stage) : null };
        });
        const targetsSurvive = checks.every(check => {
          const target = inside(root, join(root, check.target));
          return existsSync(target) && Boolean(check.signature) && artifactSignature(target) === check.signature;
        });
        if (targetsSurvive) removeArtifact(inside(root, join(txDir, "new")), options);
      }
      continue;
    }
    if (journal.state === "rolled-back") continue;
    if (journal.state === "committed") {
      // A committed publication may have been interrupted after a target was
      // removed by an aliased retire path or another process. Recover missing
      // targets from new/ before finishing; never discard that recovery source.
      for (const entry of journal.entries) {
        const target = inside(root, join(root, entry.target));
        const stage = inside(root, join(txDir, entry.stage || "new/missing"));
        if (!existsSync(target) && existsSync(stage)) safeCopy(stage, target);
      }
      finish(root, txDir, journal, options);
    }
    else {
      restore(root, txDir, journal, options); journal.state = "rolled-back";
      atomicWrite(path, JSON.stringify(journal, null, 2));
    }
    recovered.push(name);
  }
  return recovered;
}

// Changed generations retain historical backups, not another live-byte copy.
// A crash is resolved on the next locked run; this is not multi-file atomicity.
// options contains programmatic test seams only; the UI/environment cannot set it.
export function publishGeneration(root, artifacts, retire = [], fault = () => {}, options = {}) {
  const identity = options.fileIdentity || fileIdentity;
  const candidates = artifacts.map(({ source, target }) => {
    inside(root, source); inside(root, target);
    return { source, target, signature: artifactSignature(source) };
  });
  const targets = new Set(candidates.map(a => resolve(a.target)));
  const targetIds = candidates.map(a => ({ path: a.target, identity: identity(a.target) }));
  const retirePaths = retire.filter(path => {
    inside(root, path);
    if (!existsSync(path) || targets.has(resolve(path))) return false;
    const sourceId = identity(path);
    return !targetIds.some(target => (sourceId && target.identity && sourceId === target.identity) ||
      ((!sourceId || !target.identity) && foldedPath(path) === foldedPath(target.path)));
  });
  const changed = candidates.filter(artifact => !existsSync(artifact.target) ||
    // Preserve the requested filename spelling for archives later moved to a
    // case-sensitive volume, even if this volume aliases the old spelling.
    basename(realpathSync.native(artifact.target)) !== basename(artifact.target) ||
    artifactSignature(artifact.target) !== artifact.signature);
  // No directory, journal or byte copy is created for an unchanged publication.
  if (!changed.length && !retirePaths.length) return null;
  const txDir = join(root, "superseded", randomUUID());
  inside(root, txDir);
  mkdirSync(txDir, { recursive: true });
  const journal = {
    state: "prepared", entries: [],
    retire: retirePaths.map(path => relative(root, path)),
    retireBackups: Object.fromEntries(retirePaths.map((path, index) => [relative(root, path), `sources/${index}`])),
    checks: candidates.map(artifact => ({ target: relative(root, artifact.target), signature: artifact.signature })),
  };
  for (let i = 0; i < changed.length; i++) {
    const { source, target } = changed[i];
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
      removeArtifact(target, options);
      safeCopy(join(txDir, entry.stage), target);
      fault(i, txDir);
    }
    journal.state = "committed";
    atomicWrite(journalPath, JSON.stringify(journal, null, 2));
  } catch (error) {
    restore(root, txDir, journal, options); journal.state = "rolled-back";
    atomicWrite(journalPath, JSON.stringify(journal, null, 2)); throw error;
  }
  finish(root, txDir, journal, options);
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
