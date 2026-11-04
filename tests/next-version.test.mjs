import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fixture, conversation, identity, allFiles } from "./export-fixtures.mjs";
import { conversationName, runExport } from "../lib/export-runner.js";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { previewExport } from "../lib/export-preview.js";
import { createApiClient, retryAfterMilliseconds, RateLimitStopError } from "../lib/chatgpt-api.js";
import { regenerateMarkdown } from "../lib/markdown-regeneration.js";
import { sha256 } from "../lib/archive-store.js";

test("fixed date, 32-character title and key; Unicode survives the boundary", () => {
  const key = "abc123";
  assert.equal(conversationName({ title: "A".repeat(31) + "😀extra", create_time: 1767225600 }, key), `2026-01-01 - ${"A".repeat(31)}😀 - abc123`);
  assert.equal(conversationName({ title: "Short", create_time: 1 }, key), "1970-01-01 - Short - abc123");
});

test("organized Markdown-only export is readable, resumable, indexed and locally regenerable", async () => {
  const f = fixture(); try {
    const options = { organizeFolders: true, formats: { html: false, indexHtml: true } };
    const first = await f.run(options);
    assert.equal(first.status, "complete-within-requested-scope", JSON.stringify(first.errors));
    const root = join(f.root, "archive");
    assert.equal(existsSync(join(f.root, "_work", "archive-manifest.json")), true);
    const record = collectLocalConversations(root)[0];
    assert.match(record.fname, /^1970-01-01 - Q&A Ä # % - [a-f0-9]{20}$/);
    assert.equal(existsSync(join(root, "html")), false);
    assert.match(readFileSync(join(root, "index.md"), "utf8"), /Q&A Ä # %/);
    assert.match(readFileSync(join(root, "index.html"), "utf8"), /markdown\/1970/);
    assert.match(readFileSync(join(root, "index.html"), "utf8"), /id="date-from"/);
    const hash = sha256(record.path);
    f.state.calls.length = 0;
    const resumed = await f.run(options);
    assert.equal(resumed.skipped, 1);
    assert.equal(f.state.calls.some(p => p.startsWith("conversation/")), false);
    assert.equal(sha256(record.path), hash);
    const regenerated = await regenerateMarkdown(f.root, {}, () => {});
    assert.equal(regenerated.failed, 0, JSON.stringify(regenerated.errors));
    assert.equal(existsSync(join(root, "html", record.fname + ".html")), true);
    const manifest = JSON.parse(readFileSync(join(f.root, "_work", "archive-manifest.json")));
    for (const entry of manifest.files) assert.equal(sha256(join(f.root, entry.path)), entry.sha256);
  } finally { f.cleanup(); }
});

test("existing archives keep layout while legacy names migrate without another chat download", async () => {
  const f = fixture(); try {
    await f.run();
    const record = collectLocalConversations(f.root)[0];
    const old = "Legacy_01234567890123456789";
    for (const [dir, ext] of [["json", ".json"], ["markdown", ".md"], ["html", ".html"], ["files", ""]]) renameSync(join(f.root, dir, record.fname + ext), join(f.root, dir, old + ext));
    f.state.calls.length = 0;
    const report = await f.run({ organizeFolders: true });
    assert.equal(report.failed, 0, JSON.stringify(report.errors));
    assert.equal(existsSync(join(f.root, "archive-layout.json")), false);
    assert.equal(collectLocalConversations(f.root).length, 1);
    assert.equal(f.state.calls.some(p => p.startsWith("conversation/")), false);
    assert.match(readFileSync(join(f.root, "markdown", record.fname + ".md"), "utf8"), /files\/1970/);
  } finally { f.cleanup(); }
});

test("preview enumerates metadata with the same date filter and writes no archive", async () => {
  const f = fixture(); try {
    f.state.conversations.push({ ...conversation("later"), create_time: 1767225600 });
    const report = await previewExport("FAKE", { identity, dateFrom: "2026-01-01", conversations: true, projects: false, gpts: false }, () => {}, f.deps);
    assert.equal(report.conversations, 1);
    assert.equal(report.status, "complete-within-requested-scope");
    assert.deepEqual(readdirSync(f.root), []);
    assert.equal(f.state.calls.some(p => p.startsWith("conversation/")), false);
  } finally { f.cleanup(); }
});

test("project-only export preserves PDF extensions, lists chats/resources and counts missing files", async () => {
  const f = fixture(); try {
    f.state.projects = [{ gizmoId: "g-p-project", name: "Project", gizmo: { name: "Project" }, conversations: [{ id: "chat-a", title: "Not downloaded" }], files: [{ id: "file-good", name: "Long resource name with many words that exceeds thirty characters.pdf" }, { id: "file-bad", name: "Missing.pdf" }] }];
    const report = await f.run({ conversations: false }, { downloadFile: async (id, token, filename, debug, project, conversation, destination) => {
      if (id === "file-bad") throw new Error("HTTP 404");
      writeFileSync(destination, "%PDF-synthetic"); return { filename };
    } });
    assert.equal(report.projects, 1); assert.equal(report.totalFiles, 2); assert.equal(report.failedFiles, 1);
    assert.equal(report.missingFiles[0].projectName, "Project");
    const pdf = allFiles(f.root).find(p => p.includes("resources") && p.endsWith(".pdf")); assert.ok(pdf);
    const info = allFiles(f.root).find(p => p.endsWith("project-info.md") && !p.includes("superseded"));
    const md = readFileSync(info, "utf8");
    assert.match(md, /Not downloaded — not exported locally/); assert.match(md, /Missing.pdf — unavailable/);
    assert.match(md, /Referenced: 2; available in this run: 1/);
  } finally { f.cleanup(); }
});

function retryClient(statuses, extra = {}) {
  let time = Date.parse("2026-01-01T00:00:00Z"), calls = 0;
  const waits = [], events = [];
  const client = createApiClient({ apiBase: "https://synthetic.invalid/api", testOrigins: ["https://synthetic.invalid"], autoRetry: true, minIntervalMs: 1000,
    now: () => time, sleep: async ms => { waits.push(ms); time += ms; },
    fetch: async () => { const [status, retry] = statuses[Math.min(calls++, statuses.length - 1)]; return new Response(JSON.stringify({ ok: true }), { status, headers: retry ? { "retry-after": retry } : {} }); }, onWait: e => events.push(e), ...extra });
  return { client, waits, events, calls: () => calls, advance: ms => { time += ms; } };
}

test("rate-limit pauses grow across successful requests and retain the server minimum", async () => {
  const f = retryClient([[429], [200], [429], [200], [429], [200], [429], [200], [429], [200], [429, "1200"], [200]]);
  for (let i = 0; i < 6; i++) await f.client.apiGet(`example-${i}`, "FAKE");
  assert.deepEqual(f.events.filter(e => e.reason === "rate-limit").map(e => e.delayMs), [60000, 120000, 240000, 480000, 900000, 1200000]);
  assert.equal(f.calls(), 12);
});

test("backoff and spacing decay one step only after ten successes and five stable minutes", async () => {
  const statuses = [[429], [200], [429], [200]];
  for (let i = 0; i < 9; i++) statuses.push([200]);
  statuses.push([200], [200], [429], [200]);
  const f = retryClient(statuses);
  await f.client.apiGet("first", "FAKE"); await f.client.apiGet("second", "FAKE");
  f.advance(5 * 60_000);
  for (let i = 0; i < 8; i++) await f.client.apiGet(`stable-${i}`, "FAKE");
  // Nine successes, including the successful retry, still retain 2250 ms pacing.
  assert.equal(f.waits.at(-1), 2250);
  await f.client.apiGet("tenth", "FAKE");
  const before = f.waits.length;
  await f.client.apiGet("after-decay", "FAKE");
  // The prior successful request already scheduled one final 2250 ms interval.
  assert.equal(f.waits[before], 2250);
  await f.client.apiGet("after-decay-second", "FAKE");
  assert.equal(f.waits.at(-1), 1500, "spacing recovers one step, not all the way to the minimum");
  await f.client.apiGet("limited-again", "FAKE");
  assert.deepEqual(f.events.filter(e => e.reason === "rate-limit").map(e => e.delayMs), [60000, 120000, 120000]);
});

test("many quick successes do not decay pressure and a new run resets it", async () => {
  const statuses = [[429], [200], ...Array.from({ length: 12 }, () => [200]), [429], [200], [429], [200]];
  const f = retryClient(statuses);
  for (let i = 0; i < 14; i++) await f.client.apiGet(`quick-${i}`, "FAKE");
  assert.deepEqual(f.events.filter(e => e.reason === "rate-limit").map(e => e.delayMs), [60000, 120000]);
  f.client.resetRateLimiter();
  await f.client.apiGet("new-run", "FAKE");
  assert.deepEqual(f.events.filter(e => e.reason === "rate-limit").map(e => e.delayMs), [60000, 120000, 60000]);
});
test("429 respects a long HTTP-date Retry-After, resumes the same request and emits waits", async () => {
  const f = retryClient([[429, "Thu, 01 Jan 2026 00:10:00 GMT"], [200]]);
  assert.deepEqual(await f.client.apiGet("example", "FAKE"), { ok: true });
  assert.equal(f.calls(), 2); assert.ok(f.waits[0] >= 600000); assert.equal(f.events.at(-1).resumed, true);
  assert.equal(retryAfterMilliseconds("35", 0), 35000); assert.equal(retryAfterMilliseconds("invalid", 0), null);
});
test("5xx recovers with bounded retries; 404 is not retried", async () => {
  const f = retryClient([[500], [502], [200]]); await f.client.apiGet("example", "FAKE"); assert.equal(f.calls(), 3);
  const missing = retryClient([[404]]); await assert.rejects(missing.client.apiGet("example", "FAKE"), /404/); assert.equal(missing.calls(), 1);
  const limit = retryClient([[429]], { maxRateLimitRetries: 2 }); await assert.rejects(limit.client.apiGet("example", "FAKE"), RateLimitStopError); assert.equal(limit.calls(), 3);
});
test("cancellation interrupts a rate-limit wait without another request", async () => {
  const controller = new AbortController(); let calls = 0;
  const client = createApiClient({ apiBase: "https://synthetic.invalid/api", testOrigins: ["https://synthetic.invalid"], autoRetry: true, signal: controller.signal,
    fetch: async () => { calls++; return new Response("", { status: 429 }); }, onWait: () => controller.abort(new Error("Synthetic stop")) });
  await assert.rejects(client.apiGet("example", "FAKE"), /Synthetic stop/); assert.equal(calls, 1);
});
