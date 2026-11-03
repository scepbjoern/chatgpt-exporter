import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fixture, allFiles, conversation } from "./export-fixtures.mjs";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { RateLimitStopError } from "../lib/chatgpt-api.js";
import { archiveKeys } from "../lib/archive-names.js";

function checkNavigation(root) {
  const index = readFileSync(join(root, "index.html"), "utf8");
  const links = [...index.matchAll(/href="([^"#]+\.html)"/g)].map(m => decodeURIComponent(m[1]));
  assert.ok(links.length);
  for (const link of links) assert.ok(existsSync(join(root, link)), `Missing index destination: ${link}`);
}

test("unchanged reruns do not grow superseded artifact storage", async () => {
  const f = fixture(); try {
    await f.run();
    const bytes = () => allFiles(join(f.root, "superseded")).reduce((n, p) => n + statSync(p).size, 0);
    const first = bytes();
    for (let i = 0; i < 3; i++) { assert.equal((await f.run()).skipped, 1); assert.equal(bytes(), first); }
  } finally { f.cleanup(); }
});

test("disabled views survive reruns, title changes and archived moves with working media links", async () => {
  const f = fixture(); try {
    await f.run();
    let record = collectLocalConversations(f.root)[0];
    const originalHtml = readFileSync(join(record.baseDir, "html", record.fname + ".html"), "utf8");
    const originalMd = readFileSync(join(record.baseDir, "markdown", record.fname + ".md"), "utf8");
    for (const options of [{ formats: { html: false } }, { formats: { markdown: false } }]) {
      assert.equal((await f.run(options)).status, "complete-within-requested-scope"); checkNavigation(f.root);
      assert.equal(readFileSync(join(record.baseDir, "html", record.fname + ".html"), "utf8"), originalHtml);
      assert.equal(readFileSync(join(record.baseDir, "markdown", record.fname + ".md"), "utf8"), originalMd);
    }
    f.state.conversations = [conversation("sameprefix-one", "Renamed", 20)];
    assert.equal((await f.run({ formats: { html: false, markdown: false } })).status, "complete-within-requested-scope");
    assert.equal(collectLocalConversations(f.root).length, 1, "old raw identity is retired after rename with both views disabled");
    f.state.archived = f.state.conversations; f.state.conversations = [];
    assert.equal((await f.run({ formats: { html: false, markdown: false } })).status, "complete-within-requested-scope");
    record = collectLocalConversations(f.root)[0]; assert.equal(record.state, "archived"); checkNavigation(f.root);
    const html = join(record.baseDir, "html", record.fname + ".html");
    assert.equal(readFileSync(html, "utf8"), originalHtml);
    for (const [, link] of originalHtml.matchAll(/href="(\.\.\/files\/[^\"]+)"/g)) {
      const path = join(dirname(html), decodeURIComponent(link));
      assert.equal(readFileSync(path, "utf8"), "synthetic original bytes");
    }
  } finally { f.cleanup(); }
});

test("a rate limit still indexes conversations published earlier in that run", async () => {
  const f = fixture(); try {
    f.state.conversations.push(conversation("second", "Second"), conversation("third", "Third"));
    const report = await f.run({}, { apiGet: async path => {
      if (path === "conversation/third") throw new RateLimitStopError("60");
      return f.deps.apiGet(path);
    } });
    assert.equal(report.rateLimited, true); assert.equal(report.status, "partial");
    const records = collectLocalConversations(f.root); assert.equal(records.length, 2);
    checkNavigation(f.root);
    const index = readFileSync(join(f.root, "index.html"), "utf8");
    for (const r of records) assert.ok(index.includes(encodeURIComponent(r.fname + ".html")));
  } finally { f.cleanup(); }
});

test("disabled views keep old media when the same live media filename receives new bytes", async () => {
  const f = fixture(); try {
    await f.run(); f.state.conversations[0].update_time = 30;
    const report = await f.run({ formats: { html: false, markdown: false } }, { downloadFile: async (...args) => {
      writeFileSync(args.at(-1), "new media bytes"); return { filename: "Report # %.txt" };
    } });
    assert.equal(report.status, "complete-within-requested-scope");
    const record = collectLocalConversations(f.root)[0];
    assert.equal(readFileSync(join(record.baseDir, "files", record.fname, "Report # %.txt"), "utf8"), "new media bytes");
    const html = join(record.baseDir, "html", record.fname + ".html");
    const content = readFileSync(html, "utf8");
    const link = content.match(/href="(\.\.\/files\/[^\"]+)"/)[1];
    assert.equal(readFileSync(join(dirname(html), decodeURIComponent(link)), "utf8"), "synthetic original bytes");
    assert.match(content, /files\/view-/); checkNavigation(f.root);
    const md = readFileSync(join(record.baseDir, "markdown", record.fname + ".md"), "utf8");
    assert.match(md, /files\/view-/);
  } finally { f.cleanup(); }
});

test("invalid dates do not prevent raw or readable view publication", async () => {
  const f = fixture(); try {
    f.state.conversations[0].create_time = "invalid-date";
    const report = await f.run(); assert.equal(report.status, "complete-within-requested-scope");
    const r = collectLocalConversations(f.root)[0]; assert.ok(r); checkNavigation(f.root);
    assert.match(readFileSync(join(r.baseDir, "html", r.fname + ".html"), "utf8"), /Assistant answer/);
  } finally { f.cleanup(); }
});

test("compact keys persist full IDs and extend collisions without replacing earlier allocations", () => {
  const f = fixture(); try {
    const digest = id => "a".repeat(20) + (id === "first" ? "b" : "c").repeat(44);
    const allocate = archiveKeys(f.root, digest);
    const first = allocate("conversation", "first"), second = allocate("conversation", "second");
    assert.equal(first.length, 20); assert.equal(second.length, 24); assert.notEqual(first, second);
    const resumed = archiveKeys(f.root, digest);
    assert.equal(resumed("conversation", "first"), first); assert.equal(resumed("conversation", "second"), second);
  } finally { f.cleanup(); }
});

test("maximum input names produce compact paths and distinct raw identities", async () => {
  const f = fixture(); try {
    f.state.conversations = [conversation("first", "T".repeat(100)), conversation("second", "T".repeat(100))];
    f.state.projects = [{ gizmoId: "project", name: "P".repeat(100), gizmo: { name: "P".repeat(100) }, files: [], conversations: f.state.conversations.map(c => ({ id: c.conversation_id, title: c.title })) }];
    const digest = id => "a".repeat(20) + (id === "first" ? "b" : "c").repeat(44);
    const report = await f.run({}, { identityDigest: digest, downloadFile: async (...args) => {
      writeFileSync(args.at(-1), "bytes"); return { filename: "A".repeat(200) + ".txt" };
    } });
    assert.equal(report.status, "complete-within-requested-scope");
    const records = collectLocalConversations(f.root); assert.equal(records.length, 2);
    assert.notEqual(records[0].fname, records[1].fname);
    for (const path of allFiles(join(f.root, "projects"))) assert.ok(relative(f.root, path).length <= 200, path);
    checkNavigation(f.root);
  } finally { f.cleanup(); }
});
