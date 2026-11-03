import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fixture, allFiles, conversation } from "./export-fixtures.mjs";
import { entityKey } from "../lib/export-runner.js";
import { RateLimitStopError } from "../lib/chatgpt-api.js";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { sha256, publishGeneration, recoverTransactions, lockArchive } from "../lib/archive-store.js";
import { findConversationJsonById, deduplicateFilename } from "../lib/export-files.js";

for (const status of [404, 429]) test(`update plus ${status} preserves old bytes and exposes incomplete state`, async () => {
  const f = fixture(); try {
    assert.equal((await f.run()).status, "complete-within-requested-scope");
    const old = collectLocalConversations(f.root)[0], oldFile = join(old.baseDir, "files", old.fname, "Report # %.txt"), hash = sha256(oldFile);
    f.state.conversations[0] = conversation("sameprefix-one", "Renamed", 20);
    f.state.fileError = status === 429 ? new RateLimitStopError("60") : new Error("HTTP 404");
    const report = await f.run();
    assert.equal(report.status, "partial");
    assert.ok(report.errors.some(e => /media|rate-limit|conversation/.test(e.category)));
    assert.ok(allFiles(f.root).some(path => path.endsWith("Report # %.txt") && sha256(path) === hash));
    const local = collectLocalConversations(f.root)[0];
    assert.equal(sha256(join(local.baseDir, "files", local.fname, "Report # %.txt")), hash);
    assert.ok(existsSync(join(f.root, "archive-manifest.json")));
    if (status === 404) { f.state.fileError = null; const retry = await f.run(); assert.equal(retry.failedFiles, 0); }
  } finally { f.cleanup(); }
});

test("unchanged resume repairs missing derivations, corrupt media, missing manifest and previous failures", async () => {
  const f = fixture(); try {
    await f.run();
    const record = collectLocalConversations(f.root)[0], files = join(f.root, "files", record.fname);
    rmSync(join(f.root, "markdown", record.fname + ".md"));
    writeFileSync(join(f.root, "html", record.fname + ".html"), "old unsafe page");
    writeFileSync(join(files, "Report # %.txt"), "corrupted");
    f.state.calls = [];
    const report = await f.run();
    assert.equal(report.status, "complete-within-requested-scope");
    assert.equal(f.state.calls.some(path => path.startsWith("conversation/")), false);
    assert.match(readFileSync(join(f.root, "markdown", record.fname + ".md"), "utf8"), /Assistant answer/);
    assert.match(readFileSync(join(f.root, "html", record.fname + ".html"), "utf8"), /Assistant answer/);
    assert.equal(readFileSync(join(files, "Report # %.txt"), "utf8"), "synthetic original bytes");
    rmSync(join(files, ".file-map.json"));
    assert.equal((await f.run()).failedFiles, 0);
    const manifest = JSON.parse(readFileSync(join(files, ".file-map.json")));
    manifest.failed["file-one"] = { error: "prior failure" }; writeFileSync(join(files, ".file-map.json"), JSON.stringify(manifest));
    f.state.fileError = new Error("HTTP 404");
    assert.equal((await f.run()).status, "partial");
    assert.equal((await f.run()).status, "partial");
  } finally { f.cleanup(); }
});

test("account mismatch and invalid inventories preserve existing archive", async () => {
  const f = fixture(); try {
    await f.run(); const record = collectLocalConversations(f.root)[0], hash = sha256(record.path);
    const mismatch = await f.run({ identity: { userId: "other", workspaceId: "other" } });
    assert.equal(mismatch.status, "partial"); assert.equal(sha256(record.path), hash);
    f.state.inventoryOverride = { unexpected: [] };
    assert.equal((await f.run()).status, "partial"); assert.equal(sha256(record.path), hash);
    f.state.inventoryOverride = null; f.state.conversations = [];
    const missing = await f.run(); assert.equal(missing.movedToDeleted, 0); assert.equal(missing.status, "partial"); assert.equal(sha256(record.path), hash);
  } finally { f.cleanup(); }
});

test("failed publication rolls back all artifacts and preserves conflicting target", async () => {
  const f = fixture(); try {
    await f.run(); const old = collectLocalConversations(f.root)[0], hash = sha256(old.path);
    f.state.conversations[0] = conversation("sameprefix-one", "New title", 20);
    const report = await f.run({}, { publicationFault: (i) => { if (i === 1) throw new Error("synthetic write interruption"); } });
    assert.equal(report.status, "partial"); assert.equal(sha256(old.path), hash);
    const source = join(f.root, "new.txt"), target = join(f.root, "target.txt"); writeFileSync(source, "new"); writeFileSync(target, "precious conflict");
    assert.throws(() => publishGeneration(f.root, [{ source, target }], [], () => { throw new Error("fail"); }));
    assert.equal(readFileSync(target, "utf8"), "precious conflict");
    publishGeneration(f.root, [{ source, target }]);
    assert.equal(readFileSync(target, "utf8"), "new");
    assert.ok(allFiles(join(f.root, "superseded")).some(path => readFileSync(path, "utf8") === "precious conflict"));
  } finally { f.cleanup(); }
});

test("recovery rolls back a process interruption from durable journal", () => {
  const f = fixture(); try {
    const dir = join(f.root, "superseded", "crash"); mkdirSync(join(dir, "backups"), { recursive: true });
    writeFileSync(join(dir, "backups", "0"), "old"); writeFileSync(join(f.root, "target.txt"), "partial new");
    writeFileSync(join(dir, "journal.json"), JSON.stringify({ state: "applying", entries: [{ target: "target.txt", backup: "backups/0", started: true, hadTarget: true }], retire: [] }));
    assert.equal(recoverTransactions(f.root).length, 1); assert.equal(readFileSync(join(f.root, "target.txt"), "utf8"), "old");
    assert.equal(recoverTransactions(f.root).length, 0);
    const release = lockArchive(f.root); assert.throws(() => lockArchive(f.root), /already in use/); release();
  } finally { f.cleanup(); }
});

test("full identities separate prefix collisions and case-insensitive names", async () => {
  const f = fixture(); try {
    f.state.conversations.push(conversation("sameprefix-two", "Q&A Ä # %"));
    assert.equal((await f.run()).succeeded, 2);
    const records = collectLocalConversations(f.root); assert.equal(records.length, 2);
    assert.equal(findConversationJsonById(join(f.root, "json"), "samepref-unrelated"), null);
    assert.equal(findConversationJsonById(join(f.root, "json"), "sameprefix-two").convo.conversation_id, "sameprefix-two");
    const names = new Set(); assert.equal(deduplicateFilename("A.txt", names), "A.txt"); assert.equal(deduplicateFilename("a.txt", names), "a_1.txt");
  } finally { f.cleanup(); }
});

test("corrupt JSON is reported and remote raw copy can be repaired", async () => {
  const f = fixture(); try {
    await f.run(); const record = collectLocalConversations(f.root)[0]; writeFileSync(record.path, "{broken");
    const report = await f.run(); assert.ok(report.errors.some(e => e.category === "local-json"));
    assert.equal(JSON.parse(readFileSync(record.path)).conversation_id, "sameprefix-one");
  } finally { f.cleanup(); }
});

test("GPT raw metadata updates and index errors appear in durable report", async () => {
  const f = fixture(); try {
    f.state.gpts = [{ id: "g-synthetic", name: "Helper", description: "old" }];
    assert.equal((await f.run({ gpts: true })).gpts, 1);
    f.state.gpts[0].description = "new";
    const report = await f.run({ gpts: true }, { generateExportIndex() { throw new Error("synthetic index failure"); } });
    assert.equal(report.status, "partial"); assert.ok(report.errors.some(e => e.category === "index"));
    assert.match(readFileSync(join(f.root, "gpts", `Helper_${entityKey("g-synthetic")}.json`), "utf8"), /new/);
    const disk = JSON.parse(readFileSync(join(f.root, "logs", `export-report-${report.runId}.json`))); assert.equal(disk.errors.at(-1).category, "index");
    const manifest = JSON.parse(readFileSync(join(f.root, "archive-manifest.json"))); assert.ok(manifest.files.some(f => f.path === "index.html"));
  } finally { f.cleanup(); }
});

test("committed recovery completes a partially copied retired directory before removing source", () => {
  const f = fixture(); try {
    const dir = join(f.root, "superseded", "retirement-crash");
    const source = join(f.root, "old-files"); mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "first.txt"), "one"); writeFileSync(join(source, "second.txt"), "two");
    mkdirSync(join(dir, "sources", "old-files"), { recursive: true });
    writeFileSync(join(dir, "sources", "old-files", "first.txt"), "partial");
    writeFileSync(join(dir, "journal.json"), JSON.stringify({ state: "committed", entries: [], retire: ["old-files"] }));
    recoverTransactions(f.root);
    assert.equal(existsSync(source), false);
    assert.equal(readFileSync(join(dir, "sources", "old-files", "first.txt"), "utf8"), "one");
    assert.equal(readFileSync(join(dir, "sources", "old-files", "second.txt"), "utf8"), "two");
  } finally { f.cleanup(); }
});

test("case-only title updates never retire the newly published artifacts", async () => {
  const f = fixture(); try {
    f.state.conversations = [conversation("case-id", "hello", 10)]; await f.run();
    f.state.conversations = [conversation("case-id", "Hello", 20)];
    const report = await f.run(); assert.equal(report.updated, 1); assert.equal(report.status, "complete-within-requested-scope");
    const records = collectLocalConversations(f.root); assert.equal(records.length, 1); assert.equal(records[0].convo.title, "Hello");
    assert.equal(readFileSync(join(records[0].baseDir, "files", records[0].fname, "Report # %.txt"), "utf8"), "synthetic original bytes");
  } finally { f.cleanup(); }
});

test("manifest write failure remains partial in the durable report", async () => {
  const f = fixture(); try {
    await f.run(); rmSync(join(f.root, "archive-manifest.json")); mkdirSync(join(f.root, "archive-manifest.json"));
    const report = await f.run(); assert.equal(report.status, "partial");
    const disk = JSON.parse(readFileSync(join(f.root, "logs", `export-report-${report.runId}.json`)));
    assert.equal(disk.status, "partial"); assert.ok(disk.errors.some(e => e.category === "manifest"));
  } finally { f.cleanup(); }
});
