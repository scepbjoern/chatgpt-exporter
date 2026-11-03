import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { fixture } from "./export-fixtures.mjs";

const verify = (root) => spawnSync(process.execPath, ["scripts/verify-archive.mjs", root], { encoding: "utf8" });

test("OS ZIP roundtrip retains manifest entries and verifier detects changed bytes", async () => {
  const f = fixture(); const destination = mkdtempSync(join(tmpdir(), "cge-oszip-"));
  try {
    await f.run();
    const zip = join(destination, "archive.zip"), extracted = join(destination, "extracted");
    let result;
    if (process.platform === "win32") {
      // Git Bash may put GNU tar ahead of Windows bsdtar; drive-letter paths
      // must be handled by the same native OS tool regardless of the shell.
      const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
      result = spawnSync(tar, ["-a", "-c", "-f", zip, "-C", join(f.root, ".."), basename(f.root)], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      mkdirSync(extracted);
      result = spawnSync(tar, ["-x", "-f", zip, "-C", extracted], { encoding: "utf8" });
    } else if (process.platform === "darwin") {
      result = spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", f.root, zip], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      result = spawnSync("/usr/bin/ditto", ["-x", "-k", zip, extracted], { encoding: "utf8" });
    } else {
      // CI targets Windows/macOS. Other platforms still exercise verification.
      result = { status: 0 };
    }
    assert.equal(result.status, 0, result.stderr);
    const root = ["win32", "darwin"].includes(process.platform) ? join(extracted, basename(f.root)) : f.root;
    const initial = verify(root);
    assert.equal(initial.status, 0, initial.stderr);
    const manifest = JSON.parse(readFileSync(join(root, "archive-manifest.json")));
    assert.ok(manifest.files.some(file => file.path.endsWith("/.file-map.json")));
    const file = manifest.files.find(file => file.path.startsWith("json/"));
    writeFileSync(join(root, file.path), "changed bytes");
    assert.equal(verify(root).status, 1);
  } finally { f.cleanup(); rmSync(destination, { recursive: true, force: true }); }
});

test("verification rejects stale run identity, incomplete status and missing or invalid markers explicitly", async () => {
  const f = fixture();
  try {
    await f.run();
    const path = join(f.root, "archive-operation.json");
    const original = readFileSync(path, "utf8"), marker = JSON.parse(original);
    const cases = [
      [{ ...marker, runId: "another-run" }, /run ID does not match.*stale/],
      [{ ...marker, status: "partial" }, /final status does not match.*stale/],
      [{ ...marker, status: "running" }, /incomplete.*no valid final run status/],
      [{ ...marker, status: "partial-manifest-failure" }, /incomplete.*no valid final run status/],
    ];
    for (const [changed, message] of cases) {
      writeFileSync(path, JSON.stringify(changed));
      const result = verify(f.root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, message);
      assert.ok(!result.stdout.includes("Current recorded operation:"));
    }
    writeFileSync(path, "{broken");
    assert.match(verify(f.root).stderr, /incomplete.*invalid JSON/);
    rmSync(path);
    assert.match(verify(f.root).stderr, /incomplete.*marker is missing/);
    writeFileSync(path, original);
    assert.equal(verify(f.root).status, 0);
  } finally { f.cleanup(); }
});

test("a matching completed partial run verifies bytes while clearly retaining partial-result limits", async () => {
  const f = fixture();
  try {
    f.state.fileError = new Error("synthetic unavailable media");
    assert.equal((await f.run()).status, "partial");
    const result = verify(f.root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Current recorded operation: partial/);
    assert.match(result.stdout, /Passing hashes do not resolve the missing data/);
  } finally { f.cleanup(); }
});

for (const operation of ["export", "regeneration"]) {
  test(`a process crash during ${operation} cannot print the preceding run's completed status`, async () => {
    const f = fixture();
    try {
      const previous = await f.run();
      const script = operation === "export" ? `
        import { fixture, conversation, identity } from './tests/export-fixtures.mjs';
        import { runExport } from './lib/export-runner.js';
        const f = fixture();
        f.state.conversations = [conversation('new-after-crash', 'Crash fixture', 20)];
        await runExport('FAKE', process.argv[1], 1, false, false, {identity,gpts:false}, ()=>{}, {...f.deps, publicationFault(){f.cleanup();process.exit(73);}});
      ` : `
        import { regenerateMarkdown } from './lib/markdown-regeneration.js';
        await regenerateMarkdown(process.argv[1], {}, type => {if(type === 'progress') process.exit(73);});
      `;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, f.root], { encoding: "utf8" });
      assert.equal(child.status, 73, child.stderr);
      const marker = JSON.parse(readFileSync(join(f.root, "archive-operation.json"), "utf8"));
      assert.equal(marker.status, "running");
      assert.notEqual(marker.runId, previous.runId);
      const locked = verify(f.root);
      assert.equal(locked.status, 1, locked.stderr);
      assert.match(locked.stderr, /incomplete or still locked/);
      // Prove the marker itself is authoritative even after a dead lock is removed.
      rmSync(join(f.root, ".export-lock"));
      const interrupted = verify(f.root);
      assert.equal(interrupted.status, 1, interrupted.stderr);
      assert.match(interrupted.stderr, /operation is incomplete/);
      assert.ok(!interrupted.stdout.includes("complete-within-requested-scope"));
    } finally { f.cleanup(); }
  });
}
