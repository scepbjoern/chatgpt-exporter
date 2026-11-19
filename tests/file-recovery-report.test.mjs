import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fixture, allFiles, conversation } from "./export-fixtures.mjs";
import { FileFailure, fileRecoveryCategory } from "../lib/file-failure.js";
import { downloadFile } from "../lib/export-files.js";
import { createApiClient, RateLimitStopError } from "../lib/chatgpt-api.js";
import { missingFilesDocuments } from "../lib/missing-files.js";
import { markdownToSafeHtml } from "../lib/safe-markdown.js";
import { regenerateMarkdown } from "../lib/markdown-regeneration.js";
import { spawnSync } from "node:child_process";

test("recovery backlog survives filtering and early stops, then clears after success", async () => {
  const f = fixture();
  try {
    const failure = new FileFailure("download-link");
    failure.attempts = [{ step: "retrieve file bytes", httpStatus: 401,
      hops: [{ host: "chatgpt.com", endpoint: "project-content", httpStatus: 401 }] }];
    f.state.fileError = failure;
    await f.run({ organizeFolders: true });
    const page = join(f.root, "archive", "missing-files.html");
    const filtered = await f.run({ organizeFolders: true, dateFrom: "2030-01-01" });
    assert.equal(filtered.failedFiles, 0);
    assert.equal(filtered.recoveryFiles.length, 1);
    assert.equal(filtered.recoveryFiles[0].checkedThisRun, false);
    assert.equal(fileRecoveryCategory(filtered.recoveryFiles[0]), "browser");
    assert.ok(readFileSync(page, "utf8").includes("Download in your browser (1)"));
    assert.match(readFileSync(page, "utf8"), /2030-01-01/);
    const stopped = await f.run({ organizeFolders: true }, {
      apiGet: async (path, ...args) => {
        if (path.startsWith("conversations?")) throw new RateLimitStopError(60);
        return f.deps.apiGet(path, ...args);
      },
    });
    assert.equal(stopped.rateLimited, true);
    assert.equal(stopped.recoveryFiles.length, 1);
    assert.match(readFileSync(page, "utf8"), /stopped early/);
    const controller = new AbortController();
    const cancelled = await f.run({ organizeFolders: true }, {
      signal: controller.signal,
      apiGet: async (path, ...args) => {
        if (path.startsWith("conversations?")) {
          controller.abort(new Error("Stopped"));
          throw controller.signal.reason;
        }
        return f.deps.apiGet(path, ...args);
      },
    });
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.recoveryFiles.length, 1);
    f.state.fileError = null;
    const recovered = await f.run({ organizeFolders: true });
    assert.equal(recovered.recoveryFiles.length, 0);
    assert.match(readFileSync(page, "utf8"), /No unresolved file references/);
  } finally { f.cleanup(); }
});

test("project failures survive a conversation-only run and manual downloads stay readable", async () => {
  const f = fixture();
  try {
    const chat = f.state.conversations[0];
    f.state.projects = [{ gizmoId: "g-p-project", name: "Project", gizmo: { display: { name: "Project" } },
      files: [{ id: "file-resource", name: "Resource.pdf" }],
      conversations: [{ id: chat.conversation_id, title: chat.title }] }];
    await f.run({ organizeFolders: true }, {
      downloadFile: async (id, ...args) => {
        if (id === "file-resource") throw new FileFailure("not-found");
        return f.deps.downloadFile(id, ...args);
      },
    });
    const manual = join(f.root, "archive", "manual-downloads", "Resource.pdf");
    assert.ok(existsSync(join(f.root, "archive", "manual-downloads")));
    writeFileSync(manual, "manually recovered bytes");
    const filtered = await f.run({ organizeFolders: true, projects: false });
    assert.equal(filtered.recoveryFiles.length, 1);
    assert.equal(filtered.recoveryFiles[0].projectName, "Project");
    assert.equal(readFileSync(manual, "utf8"), "manually recovered bytes");
    const recovered = await f.run({ organizeFolders: true });
    assert.equal(recovered.recoveryFiles.length, 0);
    assert.equal(readFileSync(manual, "utf8"), "manually recovered bytes");
    const html = readFileSync(join(f.root, "archive", "missing-files.html"), "utf8");
    assert.match(html, /manual-downloads/);
    assert.match(html, /replaces its managed/);
  } finally { f.cleanup(); }
});

test("legacy conversation and generic success precede supplemental scope, denial stays terminal", async () => {
  for (const successAt of ["conversation", "generic"]) {
    const calls = [];
    const client = {
      apiGet: async route => {
        calls.push(route);
        if (route.includes("gizmo_id")) throw Object.assign(new Error("Denied"), { httpStatus: 403 });
        if (successAt === "generic" && route.includes("conversation_id")) return {};
        return { download_url: "https://synthetic.invalid/file" };
      },
      apiFetchBinary: async () => ({ buffer: Buffer.from("legacy bytes"), contentType: "text/plain" }),
    };
    const result = await downloadFile("file-a", "FAKE", "a.txt", null, "g-p-project", "chat", null, client);
    assert.equal(result.buffer.toString(), "legacy bytes");
    assert.equal(calls.some(route => route.includes("gizmo_id")), false);
    assert.equal(calls.length, successAt === "conversation" ? 1 : 2);
  }
  const calls = [];
  await assert.rejects(downloadFile("file-a", "FAKE", "a.txt", null, "g-p-project", "chat", null, {
    apiGet: async route => { calls.push(route); throw Object.assign(new Error("Denied"), { httpStatus: 403 }); },
  }), { reason: "access-denied" });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /conversation_id/);
});

test("HTTP 200 body refusal, server errors and unknown bodies cannot imply unavailability", async () => {
  for (const body of [{ error_message: "Not allowed to download files." }, { error_code: "internal_server_error" }, { error_type: "unrecognized" }]) {
    const origin = "https://synthetic.invalid";
    const client = createApiClient({ apiBase: origin + "/api", testOrigins: [origin], minIntervalMs: 0,
      fetch: async url => new URL(url).search ? new Response(null, { status: 404 }) : Response.json(body) });
    await assert.rejects(downloadFile("file-a", "FAKE", "a.txt", null, "g-p-project", "chat", null, client), error => {
      assert.equal(fileRecoveryCategory(error), "unknown");
      assert.ok(error.attempts.some(a => ["access-denied", "server-error", "unknown"].includes(a.reason)));
      return true;
    });
  }
});

test("the former diagnostic flag cannot inject a preview failure into an otherwise successful download", async () => {
  process.argv.push("--diagnose-project-attachments");
  const calls = [];
  try {
    const result = await downloadFile("file-a", "FAKE", "a.txt", null, "g-p-project", "chat", null, {
      apiGet: async route => {
        calls.push(route);
        if (route.includes("download_intent=false")) throw Object.assign(new Error("Denied preview"), { httpStatus: 403 });
        return { download_url: "https://synthetic.invalid/bytes" };
      },
      apiFetchBinary: async () => ({ buffer: Buffer.from("bytes"), contentType: "text/plain" }),
    });
    assert.equal(result.buffer.toString(), "bytes");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /conversation_id/);
  } finally { process.argv.pop(); }
});

test("filenames and titles remain literal in Markdown including URLs and backticks", () => {
  const tick = String.fromCharCode(96);
  const filename = "https://attacker.example/payload [a] " + tick + "b" + tick + " " + tick.repeat(2) + "c" + tick.repeat(2) + " <img src=x>.md";
  const docs = missingFilesDocuments([{ filename, projectName: "www.attacker.example", projectId: "g-p-project",
    conversationTitle: "https://attacker.example/chat", conversationId: "chat", reason: "unknown" }]);
  const rendered = markdownToSafeHtml(docs.markdown);
  assert.equal((rendered.match(/<a /g) || []).length, 1);
  assert.ok(rendered.includes('href="https://chatgpt.com/c/chat"'));
  assert.ok(rendered.includes("https://attacker.example/payload"));
  assert.ok(!rendered.includes("<img"));
  const empty = missingFilesDocuments([]);
  assert.match(empty.markdown, /0 unresolved file references/);
  assert.match(empty.markdown, /manual-downloads/);
});

test("damaged individual metadata does not prevent fresh indexes and reports incomplete recovery coverage", async () => {
  for (const [damaged, contents] of [
    ["map", "{ INVALID_PRIVATE_METADATA"], ["project", "{ INVALID_PRIVATE_METADATA"],
    ["map", '{"failed":[]}'], ["project", '{"resources":[null]}'],
    ["project", "null"], ["project", '{"resources":"broken"}'],
    ["map", '{"failed":{"file-one":{"attempts":"broken"}}}'],
  ]) {
    const f = fixture();
    try {
      const chat = f.state.conversations[0];
      f.state.projects = [{ gizmoId: "g-p-project", name: "Project", gizmo: { display: { name: "Project" } },
        files: [], conversations: [{ id: chat.conversation_id, title: chat.title }] }];
      await f.run({ organizeFolders: true });
      const path = allFiles(f.root).find(p => p.endsWith(damaged === "map" ? ".file-map.json" : "project-raw.json"));
      writeFileSync(path, contents);
      const added = conversation("second-chat", "Newly saved chat");
      added.create_time = 2_000_000_000;
      f.state.conversations.push(added);
      const result = await f.run({ organizeFolders: true, dateFrom: "2030-01-01", projects: false });
      assert.equal(result.succeeded, 1);
      assert.equal(result.errors.some(e => e.category === "index"), false);
      assert.ok(result.errors.some(e => e.category === "recovery-metadata"));
      assert.equal(result.recoveryCoverageComplete, false);
      for (const file of ["index.md", "index.html"]) {
        assert.match(readFileSync(join(f.root, "archive", file), "utf8"), /Newly saved chat/);
      }
      const page = readFileSync(join(f.root, "archive", "missing-files.html"), "utf8");
      assert.match(page, /coverage is incomplete/);
      assert.ok(!page.includes("No unresolved file references"));
      assert.ok(!JSON.stringify(result.errors).includes("INVALID_PRIVATE_METADATA"));
      const localOnly = await f.run({ organizeFolders: true, conversations: false, projects: false, gpts: true });
      assert.equal(localOnly.errors.some(e => e.category === "index"), false);
      assert.equal(localOnly.recoveryCoverageComplete, false);
    } finally { f.cleanup(); }
  }
});

test("unchecked saved project resources are excluded, actual failures or missing local copies remain", async () => {
  const f = fixture();
  try {
    f.state.projects = [{ gizmoId: "g-p-project", name: "Project", gizmo: { display: { name: "Project" } },
      files: [{ id: "file-a", name: "A.pdf" }, { id: "file-b", name: "B.pdf" }], conversations: [] }];
    await f.run({ organizeFolders: true });
    const stopped = await f.run({ organizeFolders: true }, {
      downloadFile: async () => { throw new RateLimitStopError(60); },
    });
    assert.equal(stopped.rateLimited, true);
    assert.equal(stopped.recoveryFiles.length, 0);
    f.state.projects[0].files = [{ id: "file-a", name: "A.pdf" }];
    const removed = await f.run({ organizeFolders: true });
    assert.equal(removed.recoveryFiles.length, 0);
    const failed = await f.run({ organizeFolders: true }, {
      downloadFile: async () => { throw new FileFailure("not-found"); },
    });
    assert.equal(failed.recoveryFiles.length, 1);
    assert.equal(failed.recoveryFiles[0].id, "file-a");
    assert.equal(failed.recoveryFiles[0].retained, true);
    const rawPath = allFiles(f.root).find(p => p.endsWith("project-raw.json"));
    const raw = JSON.parse(readFileSync(rawPath, "utf8"));
    const resource = raw.resources.find(r => r.id === "file-b");
    const resourcePath = allFiles(f.root).find(p => p.endsWith(resource.localName) && !p.includes("superseded"));
    unlinkSync(resourcePath);
    const filtered = await f.run({ organizeFolders: true, projects: false });
    assert.equal(filtered.recoveryFiles.length, 2);
    assert.equal(filtered.recoveryFiles.find(r => r.id === "file-b").retained, false);
  } finally { f.cleanup(); }
});

test("legacy and intermediate map context fields do not force attachment backups on unchanged resumes", async () => {
  for (const intermediate of [false, true]) {
    const f = fixture();
    try {
      const chat = f.state.conversations[0];
      f.state.projects = [{ gizmoId: "g-p-project", name: "Stable title old", gizmo: { display: { name: "Stable title old" } },
        files: [], conversations: [{ id: chat.conversation_id, title: chat.title }] }];
      await f.run({ organizeFolders: true });
      const mapPath = allFiles(f.root).find(p => p.endsWith(".file-map.json"));
      const map = JSON.parse(readFileSync(mapPath, "utf8"));
      assert.equal(Object.hasOwn(map, "projectId"), false);
      assert.equal(Object.hasOwn(map, "projectName"), false);
      if (intermediate) {
        map.projectId = "g-p-project";
        map.projectName = "Stable title old";
        writeFileSync(mapPath, JSON.stringify(map, null, 2));
      }
      const beforeMap = readFileSync(mapPath, "utf8");
      const attachmentName = map.files["file-one"].name;
      const backups = () => allFiles(f.root).filter(p => p.includes("superseded") && p.endsWith(attachmentName));
      const beforeBackups = backups().length;
      f.state.projects[0].name = "Stable title renamed";
      const result = await f.run({ organizeFolders: true });
      assert.equal(result.failed, 0);
      assert.equal(readFileSync(mapPath, "utf8"), beforeMap);
      assert.equal(backups().length, beforeBackups);
    } finally { f.cleanup(); }
  }
});

test("local regeneration refreshes integrity hashes after a tracked manual download changes", async () => {
  const f = fixture();
  try {
    await f.run({ organizeFolders: true });
    const manual = join(f.root, "archive", "manual-downloads", "Recovered.txt");
    writeFileSync(manual, "manual version one");
    await f.run({ organizeFolders: true });
    const verify = () => spawnSync(process.execPath, ["scripts/verify-archive.mjs", f.root], { encoding: "utf8" });
    assert.equal(verify().status, 0);
    writeFileSync(manual, "manual version two");
    assert.equal(verify().status, 1);
    await regenerateMarkdown(f.root, {}, () => {});
    assert.equal(readFileSync(manual, "utf8"), "manual version two");
    const result = verify();
    assert.equal(result.status, 0, result.stderr);
  } finally { f.cleanup(); }
});
