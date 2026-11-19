import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./export-fixtures.mjs";
import { FileFailure, fileRecoveryCategory } from "../lib/file-failure.js";
import { downloadFile } from "../lib/export-files.js";
import { createApiClient, RateLimitStopError } from "../lib/chatgpt-api.js";
import { missingFilesDocuments } from "../lib/missing-files.js";
import { markdownToSafeHtml } from "../lib/safe-markdown.js";

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
