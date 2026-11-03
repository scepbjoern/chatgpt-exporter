import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Execute the real interface script against a minimal DOM boundary. This checks
// data/credential flow and safe text writes, not browser CSP or rendering.
async function interfaceFixture(completion, earlyEvents = []) {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const elements = new Map();
  function element() {
    return {
      value: "", checked: true, disabled: false, style: {}, textContent: "", innerHTML: "",
      classList: { add() {}, remove() {}, toggle() {} },
      listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; },
      appendChild() {}, focus() {}, querySelector() { return element(); }, nextElementSibling: null,
    };
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element());
  const handlers = new Map();
  for (const match of html.matchAll(/data-handler-(\d+)/g)) handlers.set(match[1], element());
  const document = {
    getElementById: id => elements.get(id),
    querySelectorAll: () => [],
    querySelector: selector => handlers.get(selector.match(/data-handler-(\d+)/)[1]),
    createElement: element,
  };
  Object.defineProperty(elements.get("result"), "innerHTML", { set() { throw new Error("Untrusted result HTML must never be parsed"); } });
  let startPayload, startHeaders, streamHeaders;
  let sessionClearedAtSend = false;
  const fakeFetch = async (url, options) => {
    if (url === "/config") return Response.json({ defaultDir: "synthetic-archive", platform: "win32" });
    if (url === "/start-export") {
      startPayload = JSON.parse(options.body);
      startHeaders = options.headers;
      sessionClearedAtSend = elements.get("token-input").value === "";
      return Response.json({ exportId: "synthetic-job" });
    }
    if (url === "/progress/synthetic-job") {
      streamHeaders = options.headers;
      const wire = [...earlyEvents, { type: "done", data: completion }].map(event => `event: ${event.type}\ndata: ${JSON.stringify(typeof event.data === "string" ? event.data : JSON.stringify(event.data))}\n\n`).join("");
      return new Response(wire, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`Unexpected interface request: ${url}`);
  };
  const context = vm.createContext({
    document, navigator: { platform: "Win32" }, window: { fetch: fakeFetch },
    location: { hash: "#key=synthetic-launch-capability", pathname: "/" }, history: { replaceState() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    URLSearchParams, AbortController, TextDecoder, Uint8Array, Response, setTimeout, clearTimeout,
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const session = { accessToken: "FAKE-SECRET-NEVER-PERSIST", user: { id: "synthetic-user" } };
  elements.get("token-input").value = JSON.stringify(session);
  elements.get("workspace-id").value = "synthetic-workspace";
  elements.get("concurrency").value = "5";
  const button = html.match(/id="export-btn"[^>]*data-handler-(\d+)/)[1];
  handlers.get(button).listeners.click.call(elements.get("export-btn"), {});
  await new Promise(resolve => setTimeout(resolve, 20));
  return { elements, startPayload, startHeaders, streamHeaders, sessionClearedAtSend };
}

test("partial/429 completion is a warning, titles remain literal text and session textarea is cleared", async () => {
  const marker = '<img src=x onerror="synthetic-marker">';
  const f = await interfaceFixture({ total: 2, processed: 1, remaining: 1, failed: 1, failedTitles: [marker], rateLimited: true, rateLimitRetryAfter: "60", output: "synthetic-archive" });
  const result = f.elements.get("result");
  assert.equal(result.className, "result warning");
  assert.ok(result.textContent.includes(marker));
  assert.ok(result.textContent.includes("1 conversation(s) remain"));
  assert.ok(result.textContent.includes("Retry-After: 60"));
  assert.ok(!result.textContent.includes("No saved progress was lost"));
  assert.equal(f.sessionClearedAtSend, true);
  assert.equal(f.elements.get("token-input").value, "");
  assert.equal(f.startPayload.token, "FAKE-SECRET-NEVER-PERSIST");
  assert.deepEqual(f.startPayload.exportOptions.identity, { userId: "synthetic-user", workspaceId: "synthetic-workspace" });
  assert.equal(f.startPayload.createZip, undefined);
  assert.equal(f.startHeaders["X-CGE-Key"], "synthetic-launch-capability");
  assert.equal(f.streamHeaders["X-CGE-Key"], "synthetic-launch-capability");
});

test("non-conversation issues prevent a green completion even when conversation failures are zero", async () => {
  const f = await interfaceFixture({ total: 1, succeeded: 1, failed: 0, errors: [{ category: "project", message: "Synthetic project resource failure" }], output: "synthetic-archive" });
  assert.equal(f.elements.get("result").className, "result warning");
  assert.match(f.elements.get("result").textContent, /Synthetic project resource failure/);
});


test("early rate-limit/error events do not discard the final durable report", async () => {
  const f = await interfaceFixture({ total: 1, failed: 1, rateLimited: true, errors: [{ message: "Final persistent media issue" }], output: "synthetic-final-report-folder" }, [
    { type: "rate_limited", data: { message: "Early synthetic 429" } },
    { type: "error_msg", data: "Early synthetic failure" },
  ]);
  assert.match(f.elements.get("result").textContent, /Final persistent media issue/);
  assert.match(f.elements.get("result").textContent, /synthetic-final-report-folder/);
  assert.equal(f.elements.get("result").className, "result warning");
});

test("intentional absence of deletion inference does not mislabel an otherwise complete requested scope", async () => {
  const f = await interfaceFixture({ total: 1, processed: 1, remaining: 0, succeeded: 1, failed: 0, errors: [], status: "complete-within-requested-scope", deletionReconciliationComplete: false, output: "synthetic-archive" });
  assert.equal(f.elements.get("result").className, "result success");
  assert.match(f.elements.get("result").textContent, /absence from the inventory is not proof of deletion/);
});
