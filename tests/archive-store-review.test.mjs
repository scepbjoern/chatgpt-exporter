import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { publishGeneration, recoverTransactions, sha256 } from "../lib/archive-store.js";
import { fixture, allFiles } from "./export-fixtures.mjs";

function temporary() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "cge-store-review-")));
  const write = (name, data) => { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); return path; };
  return { root, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const read = path => readFileSync(path, "utf8");
const journal = dir => JSON.parse(read(join(dir, "journal.json")));

test("equal files and recursive directory trees create no transaction or retained duplicate", () => {
  const f = temporary(); try {
    const source = f.write("stage/raw.json", '{"id":"synthetic"}'), target = f.write("json/raw.json", '{"id":"synthetic"}');
    f.write("stage/files/nested/a.txt", "bytes"); f.write("files/nested/a.txt", "bytes");
    const transaction = publishGeneration(f.root, [{ source, target }, { source: join(f.root, "stage/files"), target: join(f.root, "files") }], [target, join(f.root, "files")]);
    assert.equal(transaction, null);
    assert.equal(existsSync(join(f.root, "superseded")), false);
    assert.equal(read(target), '{"id":"synthetic"}');
    // Equal byte lengths alone do not establish equality.
    writeFileSync(source, '{"id":"different"}');
    assert.ok(publishGeneration(f.root, [{ source, target }]));
    assert.equal(read(target), '{"id":"different"}');
  } finally { f.cleanup(); }
});

test("changed publication retains one historical backup and removes committed new bytes", () => {
  const f = temporary(); try {
    const source = f.write("stage/file.txt", "new bytes"), target = f.write("file.txt", "old bytes");
    const dir = publishGeneration(f.root, [{ source, target }]);
    assert.equal(read(target), "new bytes");
    assert.equal(read(join(dir, "backups/0")), "old bytes");
    assert.equal(existsSync(join(dir, "new")), false);
    assert.equal(journal(dir).state, "complete");
    const before = allFiles(join(f.root, "superseded"));
    assert.equal(publishGeneration(f.root, [{ source, target }]), null);
    assert.deepEqual(allFiles(join(f.root, "superseded")), before);
  } finally { f.cleanup(); }
});

test("recursive equality detects a removed filename and preserves the previous directory", () => {
  const f = temporary(); try {
    f.write("stage/files/one.txt", "same"); f.write("files/one.txt", "same"); f.write("files/two.txt", "unique prior bytes");
    const dir = publishGeneration(f.root, [{ source: join(f.root, "stage/files"), target: join(f.root, "files") }]);
    assert.deepEqual(readdirSync(join(f.root, "files")), ["one.txt"]);
    assert.equal(read(join(dir, "backups/0/two.txt")), "unique prior bytes");
    assert.equal(existsSync(join(dir, "new")), false);
  } finally { f.cleanup(); }
});

test("three unchanged export reruns do not grow superseded bytes or transactions", async () => {
  const f = fixture(); try {
    await f.run();
    const retained = () => allFiles(join(f.root, "superseded")).map(path => ({ path, size: statSync(path).size, hash: sha256(path) }));
    const baseline = retained();
    for (let i = 0; i < 3; i++) {
      const report = await f.run();
      assert.equal(report.status, "complete-within-requested-scope");
      assert.equal(report.skipped, 1);
      assert.deepEqual(retained(), baseline);
    }
  } finally { f.cleanup(); }
});

test("identity-less case-only paths cannot retire the newly published target", () => {
  const f = temporary(); try {
    const old = f.write("views/Café.txt", "previous"), source = f.write("stage/current.txt", "current"), target = join(f.root, "views/CAFÉ.txt");
    const dir = publishGeneration(f.root, [{ source, target }], [old], undefined, { fileIdentity: () => null });
    assert.equal(read(target), "current");
    assert.deepEqual(journal(dir).retire, []);
    assert.equal(journal(dir).state, "complete");
    assert.equal(existsSync(join(dir, "new")), false);
  } finally { f.cleanup(); }
});

test("target loss after apply is reported and committed recovery restores it before cleanup", () => {
  const f = temporary(); try {
    const source = f.write("stage/current.txt", "current"), target = join(f.root, "current.txt");
    let dir;
    assert.throws(() => publishGeneration(f.root, [{ source, target }], [], (_index, tx) => { dir = tx; unlinkSync(target); }), /Published artifact is missing after retirement/);
    assert.equal(journal(dir).state, "committed");
    assert.equal(read(join(dir, "new/0")), "current");
    assert.equal(recoverTransactions(f.root).length, 1);
    assert.equal(read(target), "current");
    assert.equal(journal(dir).state, "complete");
    assert.equal(existsSync(join(dir, "new")), false);
  } finally { f.cleanup(); }
});

for (const code of ["EBUSY", "EPERM"]) test(`a transient ${code} unlink is retried and publication preserves the backup`, () => {
  const f = temporary(); try {
    const source = f.write("stage/current.txt", "current"), target = f.write("current.txt", "previous");
    let failed = false;
    const waits = [];
    const dir = publishGeneration(f.root, [{ source, target }], [], undefined, {
      unlinkSync(path) { if (path === target && !failed) { failed = true; throw Object.assign(new Error("synthetic lock"), { code }); } unlinkSync(path); },
      sleepSync(ms) { waits.push(ms); },
    });
    assert.equal(failed, true);
    assert.deepEqual(waits, [25]);
    assert.equal(read(target), "current");
    assert.equal(read(join(dir, "backups/0")), "previous");
  } finally { f.cleanup(); }
});

test("transient ENOTEMPTY removal is bounded and retried without changing target bytes", () => {
  const f = temporary(); try {
    f.write("stage/files/current.txt", "current"); f.write("files/previous.txt", "previous");
    const target = join(f.root, "files"), waits = [];
    let failed = false;
    const dir = publishGeneration(f.root, [{ source: join(f.root, "stage/files"), target }], [], undefined, {
      rmdirSync(path) { if (path === target && !failed) { failed = true; throw Object.assign(new Error("synthetic directory lock"), { code: "ENOTEMPTY" }); } rmdirSync(path); },
      sleepSync(ms) { waits.push(ms); },
    });
    assert.deepEqual(waits, [25]);
    assert.equal(read(join(target, "current.txt")), "current");
    assert.equal(read(join(dir, "backups/0/previous.txt")), "previous");
  } finally { f.cleanup(); }
});

test("persistent unlink failure stops after bounded retries and remains recoverable", () => {
  const f = temporary(); try {
    const source = f.write("stage/current.txt", "current"), target = f.write("current.txt", "previous"), waits = [];
    let attempts = 0;
    assert.throws(() => publishGeneration(f.root, [{ source, target }], [], undefined, {
      unlinkSync(path) { if (path === target) { attempts++; throw Object.assign(new Error("synthetic persistent lock"), { code: "EBUSY" }); } unlinkSync(path); },
      sleepSync(ms) { waits.push(ms); },
    }), error => error.code === "EBUSY" && error.message.includes(target));
    assert.equal(attempts, 10, "five attempts during apply, then five during rollback");
    assert.deepEqual(waits, [25, 50, 100, 200, 25, 50, 100, 200]);
    assert.equal(read(target), "previous");
    assert.equal(recoverTransactions(f.root).length, 1);
    assert.equal(read(target), "previous");
  } finally { f.cleanup(); }
});

test("retired source paths use compact backups while legacy journals still recover", () => {
  const f = temporary(); try {
    const source = f.write("stage/current.txt", "current"), target = join(f.root, "current.txt"), old = f.write("old/deep/path/prior.txt", "previous");
    const dir = publishGeneration(f.root, [{ source, target }], [old]);
    const data = journal(dir), retired = data.retire[0];
    assert.equal(data.retireBackups[retired], "sources/0");
    assert.equal(read(join(dir, "sources/0")), "previous");
    assert.equal(existsSync(old), false);
    const legacy = join(f.root, "superseded/legacy");
    f.write("superseded/legacy/sources/old/deep/legacy.txt", "partial");
    f.write("old/deep/legacy.txt", "legacy previous");
    f.write("superseded/legacy/journal.json", JSON.stringify({ state: "committed", entries: [], retire: ["old/deep/legacy.txt"] }));
    recoverTransactions(f.root);
    assert.equal(read(join(legacy, "sources/old/deep/legacy.txt")), "legacy previous");
    assert.equal(existsSync(join(f.root, "old/deep/legacy.txt")), false);
  } finally { f.cleanup(); }
});

test("legacy completed new trees are removed only if their bytes still survive in the live target", () => {
  const f = temporary(); try {
    f.write("same.txt", "current"); f.write("changed.txt", "manual change");
    for (const [name, target] of [["same", "same.txt"], ["changed", "changed.txt"]]) {
      f.write(`superseded/${name}/new/0`, "current");
      f.write(`superseded/${name}/backups/0`, "historical");
      f.write(`superseded/${name}/journal.json`, JSON.stringify({ state: "complete", entries: [{ target, stage: "new/0" }], retire: [] }));
    }
    assert.deepEqual(recoverTransactions(f.root), []);
    assert.equal(existsSync(join(f.root, "superseded/same/new")), false);
    assert.equal(read(join(f.root, "superseded/same/backups/0")), "historical");
    assert.equal(read(join(f.root, "superseded/changed/new/0")), "current");
    assert.equal(read(join(f.root, "changed.txt")), "manual change");
  } finally { f.cleanup(); }
});


test("equal-byte case-only renames preserve the requested filename spelling", () => {
  const f = temporary(); try {
    const old = f.write("views/lower.txt", "same bytes"), source = f.write("stage/current.txt", "same bytes"), target = join(f.root, "views/LOWER.txt");
    publishGeneration(f.root, [{ source, target }], [old], undefined, { fileIdentity: () => null });
    assert.equal(read(target), "same bytes");
    assert.ok(readdirSync(join(f.root, "views")).includes("LOWER.txt"));
  } finally { f.cleanup(); }
});


test("cleanup refuses a linked new tree entry and preserves the live bytes it references", () => {
  const f = temporary(); try {
    const live = f.write("live/unique.txt", "must survive");
    f.write("superseded/legacy/new/0", "same"); f.write("current.txt", "same");
    f.write("superseded/legacy/journal.json", JSON.stringify({ state: "complete", entries: [{ target: "current.txt", stage: "new/0" }], retire: [] }));
    symlinkSync(join(f.root, "live"), join(f.root, "superseded/legacy/new/linked"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => recoverTransactions(f.root), /Linked artifact removal is forbidden/);
    assert.equal(read(live), "must survive");
  } finally { f.cleanup(); }
});
