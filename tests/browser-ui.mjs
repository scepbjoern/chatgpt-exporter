// Synthetic loopback UI check. No ChatGPT connection and no real credentials.
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { createExporterServer } from "../server.js";

const marker = '<img src="https://example.invalid/automatic" onerror="window.ATTACK=true">';
let receivedToken = null;
const { server, key } = createExporterServer({
  runExport: async (token, output, concurrency, zip, keepAwake, options, send) => {
    receivedToken = token;
    send("done", JSON.stringify({ total: 1, processed: 1, succeeded: 0, updated: 0, skipped: 0, failed: 1, failedTitles: [marker], status: "partial", output }));
  },
});
const engine = process.env.CGE_BROWSER_ENGINE || "chromium";
const channel = process.env.CGE_BROWSER_CHANNEL;
assert.ok(["chromium", "firefox", "webkit"].includes(engine), "Unknown CGE_BROWSER_ENGINE");
const browser = await ({ chromium, firefox, webkit })[engine].launch(channel ? { channel } : {});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  context.on("request", request => requests.push(request.url()));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(`${origin}/list-dir?*`, route => route.fulfill({ json: { path: "synthetic-folder", parent: null, dirs: [{ name: marker, path: "synthetic-child" }], drives: [] } }));
  await page.goto(`${origin}/#key=${key}`);
  try {
    await page.waitForFunction(() => document.getElementById("output-dir").value.length > 0, null, { timeout: 5000 });
  } catch (error) { throw new Error(`UI did not initialize: ${JSON.stringify({ errors, requests })}`, { cause: error }); }
  assert.equal(new URL(page.url()).hash, "");
  await page.locator("[data-handler-15]").click();
  assert.equal(await page.locator("#opt-conversations").isVisible(), true);
  await page.locator("[data-handler-14]").click();
  await page.locator("#fp-list").getByText(marker, { exact: false }).waitFor();
  assert.equal(await page.locator("#fp-list img").count(), 0);
  await page.locator("[data-handler-6]").click();
  await page.locator("#token-input").fill(JSON.stringify({ accessToken: "SYNTHETIC_TOKEN_ONLY", user: { id: "synthetic-user" } }));
  await page.locator("#workspace-id").fill("synthetic-workspace");
  await page.locator("#export-btn").click();
  await page.locator("#result").filter({ hasText: marker }).waitFor();
  assert.equal(receivedToken, "SYNTHETIC_TOKEN_ONLY");
  assert.equal(await page.locator("#token-input").inputValue(), "");
  assert.equal(await page.locator("#result img").count(), 0);
  assert.ok((await page.locator("#result").getAttribute("class")).includes("warning"));
  assert.equal(await page.evaluate(() => window.ATTACK), undefined);
  assert.deepEqual(requests.filter(url => !url.startsWith(origin + "/")), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", engine, channel: channel || "bundled", browser: await browser.version(), platform: process.platform, checks: ["launch capability removed from URL", "authenticated config/progress", "CSP permits intended controls", "folder XSS marker inert", "completion XSS marker inert", "token field cleared", "partial result warning", "no external requests"] }, null, 2));
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
}
