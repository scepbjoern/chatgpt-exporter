import assert from "node:assert/strict";
import test from "node:test";
import { request as httpRequest } from "node:http";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExporterServer } from "../server.js";

async function fixture(dependencies = {}) {
  const app = createExporterServer(dependencies);
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const request = (path, options = {}) => fetch(origin + path, {
    ...options,
    headers: { "X-CGE-Key": app.key, Origin: origin, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const close = () => new Promise(resolve => { app.server.closeAllConnections(); app.server.close(resolve); });
  return { ...app, origin, request, close };
}
const identity = { userId: "synthetic-user", workspaceId: "synthetic-workspace" };
const exportBody = { token: "FAKE-ONLY-NOT-A-REAL-TOKEN", exportOptions: { identity }, keepAwake: false };

test("launch capability is not disclosed in served HTML; every API including progress requires it", async () => {
  const f = await fixture();
  try {
    const home = await fetch(f.origin);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.ok(!html.includes(f.key));
    assert.match(home.headers.get("content-security-policy"), /script-src 'sha256-/);
    assert.ok(!home.headers.get("content-security-policy").includes("script-src 'unsafe-inline'"));
    assert.equal(home.headers.get("referrer-policy"), "no-referrer");
    for (const path of ["/config", "/list-dir", "/debug-log", "/progress/fake-id"]) {
      assert.equal((await fetch(f.origin + path)).status, 403, path);
    }
    assert.equal((await f.request("/config")).status, 200);
    assert.equal((await f.request("/config", { headers: { "X-CGE-Key": "é".repeat(64) } })).status, 403);
    assert.equal((await f.request("/config?token=synthetic")).status, 400);
  } finally { await f.close(); }
});

test("cross-origin, forged Host, missing origin, non-JSON, malformed and oversized writes create nothing", async () => {
  const f = await fixture();
  const root = mkdtempSync(join(tmpdir(), "cge-server-"));
  const target = join(root, "must-not-exist");
  const body = JSON.stringify({ path: target });
  try {
    assert.equal((await f.request("/create-dir", { method: "POST", body, headers: { Origin: "http://attacker.invalid" } })).status, 403);
    const forgedHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(f.origin + "/create-dir", { method: "POST", headers: { Host: "attacker.invalid", Origin: f.origin, "X-CGE-Key": f.key, "Content-Type": "application/json" } }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject); request.end(body);
    });
    assert.equal(forgedHostStatus, 403);
    assert.equal((await fetch(f.origin + "/create-dir", { method: "POST", body, headers: { "X-CGE-Key": f.key, "Content-Type": "application/json" } })).status, 403);
    assert.equal((await f.request("/create-dir", { method: "POST", body, headers: { "Content-Type": "text/plain" } })).status, 415);
    assert.equal((await f.request("/create-dir", { method: "POST", body: "{" })).status, 400);
    assert.equal((await f.request("/create-dir", { method: "POST", body: JSON.stringify({ path: "x".repeat(1024 * 1024) }) })).status, 413);
    assert.equal(existsSync(target), false);
    assert.equal((await f.request("/create-dir", { method: "POST", body })).status, 200);
    assert.equal(existsSync(target), true);
  } finally { await f.close(); rmSync(root, { recursive: true, force: true }); }
});

test("one operation locks export, picker, regeneration and writes; authenticated progress preserves data", async () => {
  let release;
  let captured;
  const pending = new Promise(resolve => { release = resolve; });
  const marker = '<img src=x onerror="synthetic-marker">\nline two';
  const f = await fixture({
    runExport: async (...args) => {
      captured = args;
      args[6]("status", marker);
      await pending;
      args[6]("done", JSON.stringify({ total: 1, failed: 1, failedTitles: [marker], output: args[1] }));
    },
    fetchProjectsInventory: async () => { throw new Error("picker must not run during export"); },
    regenerateMarkdown: async () => { throw new Error("regeneration must not run during export"); },
  });
  try {
    const started = await f.request("/start-export", { method: "POST", body: JSON.stringify(exportBody) });
    assert.equal(started.status, 200);
    const { exportId } = await started.json();
    assert.match(exportId, /^[a-f0-9-]{36}$/);
    for (const path of ["/start-export", "/list-projects", "/regenerate-markdown", "/create-dir"]) {
      assert.equal((await f.request(path, { method: "POST", body: JSON.stringify(exportBody) })).status, 409);
    }
    assert.equal((await fetch(f.origin + "/progress/" + exportId)).status, 403);
    const progress = await f.request("/progress/" + exportId);
    release();
    const frames = (await progress.text()).trim().split("\n\n").map(frame => ({
      type: frame.match(/^event: (.*)$/m)[1], data: JSON.parse(frame.match(/^data: (.*)$/m)[1]),
    }));
    assert.equal(frames[0].data, marker);
    assert.equal(JSON.parse(frames.at(-1).data).failedTitles[0], marker);
    assert.equal(captured[0], exportBody.token);
    assert.equal(captured[3], false, "internal ZIP is disabled regardless of client input");
    assert.deepEqual(captured[5].identity, identity);
  } finally { release(); await f.close(); }
});

test("identity must be explicit before export starts and picker reports HTTP 429", async () => {
  const { RateLimitStopError } = await import("../lib/chatgpt-api.js");
  let exports = 0;
  const f = await fixture({ runExport: async () => exports++, fetchProjectsInventory: async () => { throw new RateLimitStopError("60"); } });
  try {
    const missing = await f.request("/start-export", { method: "POST", body: JSON.stringify({ token: "fake" }) });
    assert.equal(missing.status, 400);
    assert.equal(exports, 0);
    const picker = await f.request("/list-projects", { method: "POST", body: JSON.stringify({ token: "fake", workspaceId: identity.workspaceId }) });
    assert.equal(picker.status, 429);
    assert.equal((await picker.json()).retryAfter, "60");
  } finally { await f.close(); }
});
