import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./export-fixtures.mjs";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { regenerateMarkdown } from "../lib/markdown-regeneration.js";
import { lockArchive } from "../lib/archive-store.js";

test("local regeneration replaces unsafe HTML, restores MD, reports media and preserves raw bytes", async () => {
  const f = fixture(); try {
    await f.run(); const record = collectLocalConversations(f.root)[0], raw = readFileSync(record.path);
    const html = join(record.baseDir, "html", record.fname + ".html"), md = join(record.baseDir, "markdown", record.fname + ".md");
    writeFileSync(html, '<script src="https://example.invalid/old"></script>'); unlinkSync(md); assert.equal(existsSync(md), false);
    const report = await regenerateMarkdown(f.root, {}, () => {});
    assert.equal(report.status, "complete-within-requested-scope");
    assert.match(readFileSync(html, "utf8"), /Assistant answer/); assert.ok(!readFileSync(html, "utf8").includes("https://example.invalid/old"));
    assert.ok(existsSync(md)); assert.deepEqual(readFileSync(record.path), raw);
    unlinkSync(join(record.baseDir, "files", record.fname, "Report # %.txt")); assert.equal(existsSync(join(record.baseDir, "files", record.fname, "Report # %.txt")), false);
    {const r=await regenerateMarkdown(f.root, {}, () => {});assert.equal(r.status, "partial", JSON.stringify({r,root:f.root,records:collectLocalConversations(f.root)}));}
    writeFileSync(record.path, '{"broken":');
    assert.equal((await regenerateMarkdown(f.root, {}, () => {})).status, "partial");
  } finally { f.cleanup(); }
});

test("local regeneration respects another archive writer and persists manifest errors", async () => {
  const f = fixture(); try {
    await f.run(); const release = lockArchive(f.root);
    assert.equal((await regenerateMarkdown(f.root, {}, () => {})).status, "partial"); release();
    unlinkSync(join(f.root, "archive-manifest.json")); mkdirSync(join(f.root, "archive-manifest.json"));
    const report = await regenerateMarkdown(f.root, {}, () => {});
    assert.equal(report.status, "partial");
    assert.equal(JSON.parse(readFileSync(join(f.root, "logs", `regeneration-report-${report.runId}.json`))).status, "partial");
  } finally { f.cleanup(); }
});
