import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, conversation } from "./export-fixtures.mjs";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { sha256 } from "../lib/archive-store.js";

const row = (convo) => ({ id: convo.conversation_id, title: convo.title,
  create_time: convo.create_time, update_time: convo.update_time });
const empty = () => ({ items: [], total: 0, has_more: false });

function paginated(f, active, archived = [empty()]) {
  const requests = [], positions = { active: 0, archived: 0 };
  const apiGet = async (path) => {
    if (!path.startsWith("conversations?")) return f.deps.apiGet(path);
    const params = new URL(path, "https://synthetic.invalid/").searchParams;
    const scope = params.get("is_archived") === "true" ? "archived" : "active";
    const offset = Number(params.get("offset"));
    requests.push({ scope, offset });
    const pages = scope === "active" ? active : archived;
    const value = pages[positions[scope]++];
    assert.ok(value, `Unexpected ${scope} request at offset ${offset}`);
    if (value instanceof Error) throw value;
    return structuredClone(value);
  };
  return { requests, run: (options = {}) => f.run(options, { apiGet }) };
}

function storedIds(f) {
  return collectLocalConversations(f.root).map(record => record.conversationId).sort();
}

function durableReport(f, report) {
  return JSON.parse(readFileSync(join(f.root, "logs", `export-report-${report.runId}.json`), "utf8"));
}

test("a later page can omit optional total without a false inventory change", async () => {
  const f = fixture();
  try {
    f.state.conversations = [conversation("optional-a"), conversation("optional-b")];
    const p = paginated(f, [
      { items: [row(f.state.conversations[0])], total: 2, offset: 0, has_more: true },
      { items: [row(f.state.conversations[1])], offset: 1, has_more: false },
    ]);
    const report = await p.run();
    assert.equal(report.status, "complete-within-requested-scope");
    assert.equal(report.inventory.complete, true);
    assert.equal(report.inventory.scopes.active.missingTotalPages, 1);
    assert.equal(report.inventory.scopes.active.totalChanges, 0);
    assert.equal(report.succeeded, 2);
    assert.deepEqual(storedIds(f), ["optional-a", "optional-b"]);
    assert.equal(durableReport(f, report).inventory.complete, true);
  } finally { f.cleanup(); }
});

test("missing totals and short pages continue until a real terminal page", async () => {
  const f = fixture();
  try {
    f.state.conversations = [conversation("short-a"), conversation("short-b")];
    const p = paginated(f, [
      { items: [row(f.state.conversations[0])], offset: 0 },
      { items: [row(f.state.conversations[1])], offset: 1 },
      { items: [], offset: 2 },
    ]);
    const report = await p.run();
    assert.equal(report.status, "complete-within-requested-scope");
    assert.equal(report.inventory.scopes.active.terminal, "empty-page");
    assert.equal(report.inventory.scopes.active.firstTotal, null);
    assert.deepEqual(p.requests.filter(r => r.scope === "active").map(r => r.offset), [0, 1, 2]);
    assert.deepEqual(storedIds(f), ["short-a", "short-b"]);
  } finally { f.cleanup(); }
});

test("a growing advisory total with no has_more still exports all discovered conversations as partial", async () => {
  const f = fixture();
  try {
    f.state.conversations = [conversation("growing-a"), conversation("growing-b"), conversation("growing-c")];
    const p = paginated(f, [
      { items: [row(f.state.conversations[0])], total: 2, offset: 0 },
      { items: [row(f.state.conversations[1])], total: 3, offset: 1 },
      { items: [row(f.state.conversations[2])], total: 3, offset: 2 },
      { items: [], total: 3, offset: 3 },
    ]);
    const report = await p.run();
    assert.equal(report.status, "partial");
    assert.equal(report.inventory.complete, false);
    assert.deepEqual(report.inventory.scopes.active.warnings, ["total-drift"]);
    assert.equal(report.inventory.scopes.active.discovered, 3);
    assert.equal(report.succeeded, 3);
    assert.deepEqual(storedIds(f), ["growing-a", "growing-b", "growing-c"]);
    const disk = durableReport(f, report);
    assert.equal(disk.inventory.complete, false);
    assert.ok(disk.errors.some(error => error.category === "inventory-consistency" && error.id === "active"));
    const saved = JSON.parse(readFileSync(collectLocalConversations(f.root)[0].path, "utf8"));
    assert.equal(saved.mapping.answer.message.content.parts[0], "Assistant answer");
  } finally { f.cleanup(); }
});

test("has_more true wins over reaching an old total and exposes numeric drift", async () => {
  const f = fixture();
  try {
    f.state.conversations = [conversation("continue-a"), conversation("continue-b")];
    const p = paginated(f, [
      { items: [row(f.state.conversations[0])], total: 1, has_more: true },
      { items: [row(f.state.conversations[1])], total: 2, has_more: false },
    ]);
    const report = await p.run();
    assert.equal(report.status, "partial");
    assert.equal(report.inventory.scopes.active.terminal, "has-more-false");
    assert.equal(report.inventory.scopes.active.totalChanges, 1);
    assert.equal(report.succeeded, 2);
    assert.deepEqual(storedIds(f), ["continue-a", "continue-b"]);
  } finally { f.cleanup(); }
});

for (const terminal of ["empty", "explicit-false"]) test(`terminal ${terminal} with too few discovered rows exports those rows and reports incomplete coverage`, async () => {
  const f = fixture();
  try {
    const first = { items: [row(f.state.conversations[0])], total: 10, offset: 0 };
    const p = paginated(f, terminal === "empty" ? [first, { items: [], total: 10, offset: 1 }] : [{ ...first, has_more: false }]);
    const report = await p.run();
    assert.equal(report.status, "partial");
    assert.equal(report.inventory.complete, false);
    assert.deepEqual(report.inventory.scopes.active.warnings, ["total-count-mismatch"]);
    assert.equal(report.succeeded, 1);
    assert.equal(report.remaining, 0, "known queue can finish while unknown inventory coverage remains incomplete");
    assert.equal(storedIds(f).length, 1);
    assert.match(report.errors.find(error => error.category === "inventory-consistency").message, /coverage may be incomplete/);
  } finally { f.cleanup(); }
});

test("unchanged stale totals cannot terminate enumeration before additional rows", async () => {
  const f = fixture();
  try {
    f.state.conversations = [conversation("stale-a"), conversation("stale-b")];
    const p = paginated(f, [
      { items: [row(f.state.conversations[0])], total: 1 },
      { items: [row(f.state.conversations[1])], total: 1 },
      { items: [], total: 1 },
    ]);
    const report = await p.run();
    assert.equal(report.status, "partial");
    assert.equal(report.inventory.scopes.active.totalChanges, 0);
    assert.deepEqual(report.inventory.scopes.active.warnings, ["total-count-mismatch"]);
    assert.deepEqual(storedIds(f), ["stale-a", "stale-b"]);
  } finally { f.cleanup(); }
});

test("active and archived totals have separate consistency state", async () => {
  const f = fixture();
  try {
    f.state.conversations = [conversation("active-a"), conversation("active-b")];
    f.state.archived = [conversation("archived-a")];
    const p = paginated(f,
      [{ items: f.state.conversations.map(row), total: 2, has_more: false }],
      [{ items: f.state.archived.map(row), total: 1, has_more: false }]);
    const report = await p.run();
    assert.equal(report.status, "complete-within-requested-scope");
    assert.equal(report.inventory.complete, true);
    assert.equal(report.inventory.active, 2);
    assert.equal(report.inventory.archived, 1);
    const archived = collectLocalConversations(f.root).find(record => record.conversationId === "archived-a");
    assert.equal(archived.state, "archived");
  } finally { f.cleanup(); }
});

const invalidCases = [
  ["unknown schema", () => ({ unexpected: [] })],
  ["wrong offset", () => ({ items: [], offset: 0 })],
  ["duplicate across pages", (a) => ({ items: [row(a)], offset: 1 })],
  ["invalid total type", () => ({ items: [], total: "2", offset: 1 })],
  ["empty page advertises continuation", () => ({ items: [], has_more: true, offset: 1 })],
  ["request failure", () => new Error("synthetic request failure")],
];
for (const [name, secondPage] of invalidCases) test(`${name} still blocks the conversation queue and preserves existing raw bytes`, async () => {
  const f = fixture();
  try {
    await f.run();
    const existing = collectLocalConversations(f.root)[0], oldHash = sha256(existing.path);
    const discovered = conversation("new-before-bad-page");
    f.state.conversations.push(discovered);
    const p = paginated(f, [
      { items: [row(discovered)], total: 2, offset: 0, has_more: true },
      secondPage(discovered),
    ]);
    const report = await p.run();
    assert.equal(report.status, "partial");
    assert.equal(report.inventory.complete, false);
    assert.equal(report.total, 0);
    assert.equal(report.succeeded, 0);
    assert.equal(sha256(existing.path), oldHash);
    assert.deepEqual(storedIds(f), ["sameprefix-one"]);
    assert.equal(report.inventory.scopes.active.terminal, "invalid-or-failed-page");
    assert.equal(report.inventory.scopes.active.diagnostics.at(-1).requestedOffset, 1);
    assert.ok(report.errors.some(error => error.category === "export" && /active inventory page 2 at offset 1/.test(error.message)));
  } finally { f.cleanup(); }
});

test("duplicate within a page and active/archived overlap remain invalid", async () => {
  for (const acrossScopes of [false, true]) {
    const f = fixture();
    try {
      const only = row(f.state.conversations[0]);
      const p = acrossScopes ? paginated(f, [{ items: [only], has_more: false }], [{ items: [only], has_more: false }])
        : paginated(f, [{ items: [only, only], has_more: false }]);
      const report = await p.run();
      assert.equal(report.status, "partial");
      assert.equal(report.inventory.complete, false);
      assert.equal(report.succeeded, 0);
      assert.deepEqual(storedIds(f), []);
    } finally { f.cleanup(); }
  }
});

test("page diagnostics are bounded numeric summaries without conversation IDs or titles", async () => {
  const f = fixture();
  try {
    f.state.conversations = Array.from({ length: 21 }, (_, index) => conversation(`PRIVATE_ID_MARKER_${index}`, `PRIVATE_TITLE_MARKER_${index}`));
    const pages = f.state.conversations.map((convo, offset) => ({ items: [row(convo)], total: 21, offset }));
    pages.push({ items: [], total: 21, offset: 21 });
    const p = paginated(f, pages);
    const report = await p.run({ dateFrom: "2030-01-01" });
    assert.equal(report.inventory.complete, true);
    const scope = durableReport(f, report).inventory.scopes.active;
    assert.equal(scope.pageCount, 22);
    assert.equal(scope.diagnostics.length, 20);
    assert.equal(scope.omittedDiagnostics, 2);
    assert.equal(scope.diagnostics[0].requestedOffset, 2);
    assert.equal(scope.diagnostics.at(-1).requestedOffset, 21);
    const text = JSON.stringify(report.inventory);
    assert.ok(!text.includes("PRIVATE_ID_MARKER"));
    assert.ok(!text.includes("PRIVATE_TITLE_MARKER"));
    assert.ok(!text.includes("FAKE-TOKEN"));
    assert.deepEqual(Object.keys(scope.diagnostics[0]).sort(), ["hasMore", "itemCount", "page", "received", "requestedOffset", "returnedOffset", "total"].sort());
  } finally { f.cleanup(); }
});
