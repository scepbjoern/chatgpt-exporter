import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { fixture } from "./export-fixtures.mjs";

test("OS ZIP roundtrip retains manifest entries and verifier detects changed bytes", async () => {
  const f = fixture(); const destination = mkdtempSync(join(tmpdir(), "cge-oszip-"));
  try {
    await f.run();
    const zip = join(destination, "archive.zip"), extracted = join(destination, "extracted");
    let result;
    if (process.platform === "win32") {
      result = spawnSync("tar.exe", ["-a", "-c", "-f", zip, "-C", join(f.root, ".."), basename(f.root)], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      mkdirSync(extracted);
      result = spawnSync("tar.exe", ["-x", "-f", zip, "-C", extracted], { encoding: "utf8" });
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
    const verify = () => spawnSync(process.execPath, ["scripts/verify-archive.mjs", root], { encoding: "utf8" });
    assert.equal(verify().status, 0, verify().stderr);
    const manifest = JSON.parse(readFileSync(join(root, "archive-manifest.json")));
    assert.ok(manifest.files.some(file => file.path.endsWith("/.file-map.json")));
    const file = manifest.files.find(file => file.path.startsWith("json/"));
    writeFileSync(join(root, file.path), "changed bytes");
    assert.equal(verify().status, 1);
  } finally { f.cleanup(); rmSync(destination, { recursive: true, force: true }); }
});
