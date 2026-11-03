import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createApiClient, RateLimitStopError, allowedDownloadHost, isPublicAddress, redactSecrets, validateConversationInventory } from "../lib/chatgpt-api.js";

async function mockServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}
function localClient(origin, options = {}) {
  return createApiClient({ apiBase: `${origin}/backend-api`, publicBase: `${origin}/public-api`, testOrigins: [origin], fetch: globalThis.fetch, minIntervalMs: 0, ...options });
}

test("synthetic local API routes workspace and validates schema without exposing error bodies", async () => {
  const requests = [];
  const server = await mockServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.setHeader("Content-Type", "application/json");
    if (req.url.includes("broken")) { res.end('{"unknown":[]}'); return; }
    if (req.url.includes("error")) { res.statusCode = 403; res.end("FAKE_SECRET_RESPONSE"); return; }
    res.end(JSON.stringify({ items: [{ id: "synthetic-chat", title: "Title" }], total: 1 }));
  });
  try {
    const client = localClient(server.origin);
    client.setApiWorkspace("workspace-synthetic");
    const data = await client.apiGet("conversations?offset=0", "FAKE_TOKEN");
    assert.equal(data.items[0].id, "synthetic-chat");
    assert.equal(requests[0].headers.authorization, "Bearer FAKE_TOKEN");
    assert.equal(requests[0].headers["chatgpt-account-id"], "workspace-synthetic");
    await assert.rejects(client.apiGet("conversations?broken", "FAKE_TOKEN"), /missing items/);
    await assert.rejects(client.apiGet("error", "FAKE_TOKEN"), (error) => error.message === "HTTP 403");
    await assert.rejects(client.apiGet("../escape", "FAKE_TOKEN"), /Invalid API path/);
    assert.throws(() => client.setApiWorkspace("bad\r\nheader"), /Invalid workspace/);
  } finally { await server.close(); }
});

test("429 latches queued requests and cannot be reset while requests are pending", async () => {
  let hits = 0, entered;
  const requested = new Promise((resolve) => { entered = resolve; });
  const server = await mockServer((req, res) => {
    hits++; entered();
    setTimeout(() => { res.writeHead(429, { "Retry-After": "12" }); res.end("SECRET_429_BODY"); }, 30);
  });
  try {
    const client = localClient(server.origin);
    const notified = [];
    client.setRateLimitStopHandler((value) => notified.push(value));
    const first = client.apiGet("conversations", "FAKE_TOKEN");
    const second = client.apiGet("conversations", "FAKE_TOKEN");
    const results = Promise.allSettled([first, second]);
    await requested;
    assert.throws(() => client.resetRateLimiter(), /pending/);
    const settled = await results;
    assert.ok(settled.every((result) => result.status === "rejected" && result.reason instanceof RateLimitStopError));
    assert.equal(hits, 1);
    assert.equal(notified.length, 1);
    assert.deepEqual(client.getRateLimitState(), { stopped: true, retryAfter: "12" });
    client.resetRateLimiter();
    assert.equal(client.getRateLimitState().stopped, false);
  } finally { await server.close(); }
});

test("download streaming matches real bytes/hash and strips headers on cross-origin redirects", async () => {
  const bytes = Buffer.from("synthetic file bytes ä # %\n".repeat(1024));
  const received = [];
  const destinationServer = await mockServer((req, res) => {
    received.push(req.headers);
    res.setHeader("Content-Type", "application/octet-stream");
    for (let offset = 0; offset < bytes.length; offset += 200) res.write(bytes.subarray(offset, offset + 200));
    res.end();
  });
  const sourceServer = await mockServer((req, res) => {
    received.push(req.headers);
    res.writeHead(302, { Location: `${destinationServer.origin}/signed?secret=FAKE_SIGNED_SECRET` }); res.end();
  });
  const dir = await mkdtemp(join(tmpdir(), "exporter-network-"));
  try {
    const client = localClient(sourceServer.origin, { testOrigins: [sourceServer.origin, destinationServer.origin] });
    client.setApiWorkspace("workspace-synthetic");
    const path = join(dir, "saved.bin");
    const result = await client.apiDownloadTo(`${sourceServer.origin}/download`, "FAKE_TOKEN", path);
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(result.size, bytes.length);
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(received[0].authorization, "Bearer FAKE_TOKEN");
    assert.equal(received[1].authorization, undefined);
    assert.equal(received[1]["chatgpt-account-id"], undefined);
    assert.equal(received[1].referer, undefined);
    assert.deepEqual(await readdir(dir), ["saved.bin"]);
  } finally { await sourceServer.close(); await destinationServer.close(); await rm(dir, { recursive: true, force: true }); }
});

test("oversized streaming downloads clean temporary files and preserve prior destination bytes", async () => {
  const server = await mockServer((req, res) => { res.write("123456789"); res.end("0123456789"); });
  const dir = await mkdtemp(join(tmpdir(), "exporter-limit-"));
  try {
    const client = localClient(server.origin, { downloadLimit: 10 });
    const oldBytes = Buffer.from("previously saved bytes");
    await writeFile(join(dir, "file.bin"), oldBytes);
    await assert.rejects(client.apiDownloadTo(`${server.origin}/file`, "FAKE", join(dir, "file.bin")), /size limit/);
    assert.deepEqual(await readFile(join(dir, "file.bin")), oldBytes);
    assert.deepEqual(await readdir(dir), ["file.bin"]);
    const jsonClient = localClient(server.origin, { jsonLimit: 10 });
    await assert.rejects(jsonClient.apiGet("body", "FAKE"), /oversized/);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test("redirect policy denies local HTTP, credentials, ports, untrusted hosts and private DNS", async () => {
  let requests = 0;
  const client = createApiClient({ minIntervalMs: 0, fetch: async () => { requests++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/internal" } }); }, lookup: async () => [{ address: "93.184.216.34", family: 4 }] });
  await assert.rejects(client.apiFetchBinary("https://files.oaiusercontent.com/file", "FAKE"), /HTTPS/);
  assert.equal(requests, 1);
  for (const url of ["http://chatgpt.com/file", "https://user:password@chatgpt.com/file", "https://chatgpt.com:444/file", "https://evil.invalid/file", "https://127.0.0.1/file"]) await assert.rejects(client.apiFetchBinary(url, "FAKE"));
  assert.equal(requests, 1);
  const privateDns = createApiClient({ lookup: async () => [{ address: "10.1.2.3", family: 4 }], fetch: async () => { throw new Error("must never request"); } });
  await assert.rejects(privateDns.apiFetchBinary("https://files.oaiusercontent.com/file", "FAKE"), /Private/);
  const mixedDns = createApiClient({ lookup: async () => [{ address: "93.184.216.34" }, { address: "::1" }], fetch: async () => { throw new Error("must never request"); } });
  await assert.rejects(mixedDns.apiGet("conversations", "FAKE"), /Private/);
  assert.ok(!allowedDownloadHost("chatgpt.com.evil.invalid"));
  assert.ok(!allowedDownloadHost("evilchatgpt.com"));
  assert.ok(!allowedDownloadHost("attacker.chatgpt.com"));
  for (const ip of ["127.0.0.1", "10.1.1.1", "172.16.0.1", "192.168.0.1", "169.254.1.1", "100.64.1.1", "::1", "::ffff:127.0.0.1", "fc00::1"]) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("only exact ChatGPT origin gets bearer; external signed links get no browser/device headers", async () => {
  const received = [];
  const client = createApiClient({ minIntervalMs: 0, lookup: async () => [{ address: "93.184.216.34" }], fetch: async (url, options) => { received.push({ url, headers: options.headers }); return new Response("hello"); } });
  await client.apiFetchBinary("https://chatgpt.com/file", "FAKE_TOKEN");
  await client.apiFetchBinary("https://files.oaiusercontent.com/file?sig=FAKE_SIGNED", "FAKE_TOKEN");
  assert.equal(received[0].headers.get("authorization"), "Bearer FAKE_TOKEN");
  assert.equal(received[1].headers.get("authorization"), null);
  assert.equal(received[1].headers.get("oai-device-id"), null);
  assert.equal(received[1].headers.get("origin"), null);
});

test("project pagination rejects malformed pages, repeated cursors and duplicate IDs", async () => {
  let payloads = [], offset = 0;
  const server = await mockServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(payloads[offset++])); });
  try {
    const run = async (pages) => { payloads = pages; offset = 0; return localClient(server.origin).fetchProjectsInventory("FAKE"); };
    assert.deepEqual(await run([{ list: { items: [{ gizmo: { id: "g-p-a", name: "A" } }], cursor: "next" } }, { list: { items: [{ gizmo: { id: "g-p-b", name: "B" } }], cursor: null } }]), [
      { gizmoId: "g-p-a", name: "A", gizmo: { id: "g-p-a", name: "A" }, files: [] },
      { gizmoId: "g-p-b", name: "B", gizmo: { id: "g-p-b", name: "B" }, files: [] },
    ]);
    await assert.rejects(run([{ unknown: [] }]), /missing items/);
    await assert.rejects(run([{ items: [{}] }]), /ID/);
    await assert.rejects(run([{ items: [], cursor: "next" }]), /Empty project/);
    await assert.rejects(run([{ items: [{ id: "g-p-a" }], cursor: "next" }, { items: [{ id: "g-p-b" }], cursor: "next" }]), /cursor/);
    await assert.rejects(run([{ items: [{ id: "g-p-a" }], cursor: "next" }, { items: [{ id: "g-p-a" }] }]), /Repeated project/);
  } finally { await server.close(); }
});

test("conversation schema rejects duplicate IDs, unexpected arrays, totals and offsets", () => {
  for (const value of [{}, [], { items: [{ id: "same" }, { id: "same" }] }, { items: [{ id: "../escape" }] }, { items: [{ id: "a" }], total: 0 }, { items: [], offset: -1 }]) assert.throws(() => validateConversationInventory(value));
});

test("logs redact nested tokens, signed URLs and proxy credentials", () => {
  const value = redactSecrets({ accessToken: "FAKE_TOKEN", nested: ["Bearer FAKE_BEARER", 'meta {"download_url":"https://host.test/file?sig=FAKE_SIGNATURE"}', "proxy https://name:FAKE_PASSWORD@proxy.test:443/path?key=FAKE_QUERY"] });
  const text = JSON.stringify(value);
  for (const secret of ["FAKE_TOKEN", "FAKE_BEARER", "FAKE_SIGNATURE", "FAKE_PASSWORD", "FAKE_QUERY"]) assert.ok(!text.includes(secret), secret);
  assert.ok(text.includes("host.test/file"));
});

test("timeouts bound request headers, body consumption and DNS resolution", async () => {
  const server = await mockServer((req, res) => {
    if (req.url.includes("body")) { res.writeHead(200, { "Content-Type": "application/json" }); res.write('{"items":['); }
  });
  try {
    const client = localClient(server.origin, { timeoutMs: 30 });
    await assert.rejects(client.apiGet("headers", "FAKE"), /timed out/);
    await assert.rejects(client.apiGet("body", "FAKE"), /Invalid or oversized/);
    const dns = createApiClient({ timeoutMs: 30, lookup: () => new Promise(() => {}), fetch: async () => { throw new Error("must not request"); } });
    await assert.rejects(dns.apiGet("conversations", "FAKE"), /DNS lookup timed out/);
  } finally { await server.close(); }
});

test("redirect loop is bounded and each destination is revalidated", async () => {
  let calls = 0;
  const client = createApiClient({ minIntervalMs: 0, lookup: async () => [{ address: "93.184.216.34" }], fetch: async () => { calls++; return new Response(null, { status: 307, headers: { Location: "https://files.oaiusercontent.com/again" } }); } });
  await assert.rejects(client.apiFetchBinary("https://files.oaiusercontent.com/start", "FAKE"), /Too many/);
  assert.equal(calls, 6);
  const invalid = createApiClient({ minIntervalMs: 0, lookup: async (host) => [{ address: host === "files.oaiusercontent.com" ? "93.184.216.34" : "127.0.0.1" }], fetch: async () => new Response(null, { status: 302, headers: { Location: "https://private.oaiusercontent.com/secret" } }) });
  await assert.rejects(invalid.apiFetchBinary("https://files.oaiusercontent.com/start", "FAKE"), /Private/);
});

test("declared sizes are checked before reading and compressed errors still latch 429", async () => {
  let reads = 0;
  const client = createApiClient({ minIntervalMs: 0, downloadLimit: 5, lookup: async () => [{ address: "93.184.216.34" }], fetch: async () => new Response(new ReadableStream({ pull(controller) { reads++; controller.enqueue(Buffer.from("123456")); controller.close(); } }), { headers: { "Content-Length": "100" } }) });
  await assert.rejects(client.apiFetchBinary("https://files.oaiusercontent.com/file", "FAKE"), /size limit/);
  assert.ok(reads <= 1, "stream can prefill one chunk but must not be consumed into a file");
  const limited = createApiClient({ minIntervalMs: 0, lookup: async () => [{ address: "93.184.216.34" }], fetch: async () => new Response("compressed error marker", { status: 429, headers: { "Content-Encoding": "gzip", "Retry-After": "1" } }) });
  await assert.rejects(limited.apiGet("conversations", "FAKE"), RateLimitStopError);
  assert.equal(limited.getRateLimitState().stopped, true);
});

test("test origins cannot silently relax the production transport", async () => {
  const client = createApiClient({ apiBase: "http://127.0.0.1:1/backend-api", testOrigins: ["http://127.0.0.1:1"], minIntervalMs: 0 });
  await assert.rejects(client.apiGet("conversations", "FAKE"), /explicit injected transport/);
});


test("N3 steady streamed downloads outlive the legacy phase timeout and preserve bytes/hash", async () => {
  const expected = Buffer.concat(Array.from({ length: 20 }, (_, index) => Buffer.alloc(10, index)));
  const server = await mockServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    let index = 0;
    const interval = setInterval(() => {
      res.write(expected.subarray(index * 10, ++index * 10));
      if (index === 20) { clearInterval(interval); res.end(); }
    }, 50);
    res.on("close", () => clearInterval(interval));
  });
  const dir = await mkdtemp(join(tmpdir(), "exporter-steady-"));
  try {
    // This is the review reproduction: 1 s of progress with timeoutMs=300 ms.
    const client = localClient(server.origin, { timeoutMs: 300, totalTimeoutMs: 3000 });
    const result = await client.apiDownloadTo(`${server.origin}/file`, "FAKE", join(dir, "file.bin"));
    assert.deepEqual(await readFile(join(dir, "file.bin")), expected);
    assert.equal(result.size, 200);
    assert.equal(result.sha256, createHash("sha256").update(expected).digest("hex"));
    assert.deepEqual(await readdir(dir), ["file.bin"]);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test("N3 idle body aborts the connection, removes partial output and preserves old bytes", async () => {
  let closed;
  const disconnected = new Promise((resolve) => { closed = resolve; });
  const server = await mockServer((req, res) => {
    res.writeHead(200); res.write("first bytes");
    res.on("close", closed);
  });
  const dir = await mkdtemp(join(tmpdir(), "exporter-idle-"));
  try {
    const destination = join(dir, "file.bin");
    const old = Buffer.from("previously archived bytes");
    await writeFile(destination, old);
    const client = localClient(server.origin, { headersTimeoutMs: 500, bodyIdleTimeoutMs: 100, totalTimeoutMs: 3000 });
    await assert.rejects(client.apiDownloadTo(`${server.origin}/file`, "FAKE", destination), /body idle timeout/);
    let closeTimer;
    try {
      await Promise.race([disconnected, new Promise((resolve, reject) => { closeTimer = setTimeout(() => reject(new Error("idle timeout did not close transport")), 1000); })]);
    } finally { clearTimeout(closeTimer); }
    assert.deepEqual(await readFile(destination), old);
    assert.deepEqual(await readdir(dir), ["file.bin"]);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test("N3 an overall cap still bounds continuously progressing bodies", async () => {
  const server = await mockServer((req, res) => {
    res.writeHead(200); res.write("first");
    const interval = setInterval(() => res.write("progress"), 20);
    res.on("close", () => clearInterval(interval));
  });
  try {
    const client = localClient(server.origin, { headersTimeoutMs: 500, bodyIdleTimeoutMs: 150, totalTimeoutMs: 250 });
    await assert.rejects(client.apiFetchBinary(`${server.origin}/file`, "FAKE"), /Overall response deadline/);
  } finally { await server.close(); }
});

test("N3 header/DNS budget spans redirects and does not reset at each hop", async () => {
  let requests = 0, lastSignal;
  const client = createApiClient({
    headersTimeoutMs: 300, bodyIdleTimeoutMs: 500, totalTimeoutMs: 2000,
    lookup: async () => { await delay(25); return [{ address: "93.184.216.34" }]; },
    fetch: async (url, options) => {
      requests++; lastSignal = options.signal; await delay(150);
      return new Response(null, { status: 302, headers: { Location: "https://files.oaiusercontent.com/next" } });
    },
  });
  await assert.rejects(client.apiFetchBinary("https://files.oaiusercontent.com/start", "FAKE"), /headers timed out|DNS lookup timed out/);
  assert.equal(requests, 2);
  assert.equal(lastSignal.aborted, true);
});

test("N3 completion and cancellation clear phase timers and external abort listeners", async () => {
  let lastSignal;
  const client = createApiClient({
    headersTimeoutMs: 80, bodyIdleTimeoutMs: 80, totalTimeoutMs: 100,
    lookup: async () => [{ address: "93.184.216.34" }],
    fetch: async (url, options) => { lastSignal = options.signal; return new Response("complete"); },
  });
  assert.equal((await client.apiFetchBinary("https://files.oaiusercontent.com/file", "FAKE")).buffer.toString(), "complete");
  await delay(130);
  assert.equal(lastSignal.aborted, false, "a completed request must not be aborted later by an uncleared timer");
  const external = new AbortController();
  const response = await client.debugFetch("https://chatgpt.com/backend-api/body", { signal: external.signal });
  await response.text();
  external.abort(new Error("after completion"));
  assert.equal(lastSignal.aborted, false, "external abort listener must be removed on completion");
  const pending = await client.debugFetch("https://chatgpt.com/backend-api/body");
  await pending.body.cancel();
  assert.equal(lastSignal.aborted, true, "cancelling the body must abort its transport");
});


test("N3 pinned request adapter receives checked DNS and a signal lasting through the body", async () => {
  const requests = [];
  const client = createApiClient({
    headersTimeoutMs: 300, bodyIdleTimeoutMs: 300, totalTimeoutMs: 3000, minIntervalMs: 0,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    // In-memory request adapter exercises pinnedFetch's native stream boundary.
    // It does not establish real TLS/certificate or remote provider behavior.
    httpsRequest: (url, options, onResponse) => {
      options.lookup("chatgpt.com", { all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
      });
      const request = new EventEmitter();
      const record = { signal: options.signal, aborted: false };
      requests.push(record);
      request.end = () => {
        const incoming = new PassThrough();
        incoming.statusCode = 200; incoming.rawHeaders = [];
        onResponse(incoming); incoming.write("start");
        let interval;
        const aborted = () => { record.aborted = true; incoming.destroy(options.signal.reason); request.emit("error", options.signal.reason); };
        options.signal.addEventListener("abort", aborted, { once: true });
        if (url.pathname === "/progress") {
          let count = 0;
          interval = setInterval(() => {
            incoming.write("progress");
            if (++count === 12) { clearInterval(interval); incoming.end(); }
          }, 40);
        }
        incoming.on("close", () => { clearInterval(interval); options.signal.removeEventListener("abort", aborted); });
      };
      return request;
    },
  });
  const result = await client.apiFetchBinary("https://chatgpt.com/progress", "FAKE_NATIVE_TOKEN");
  assert.equal(result.buffer.toString(), "start" + "progress".repeat(12));
  assert.equal(requests[0].signal.aborted, false);
  await assert.rejects(client.apiFetchBinary("https://chatgpt.com/stall", "FAKE_NATIVE_TOKEN"), /body idle timeout/);
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(requests[1].aborted, true, "the request transport must receive the body-timeout abort");
});
