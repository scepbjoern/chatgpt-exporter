// Synthetic loopback UI check. No ChatGPT connection and no real credentials.
import { join } from "node:path";
import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { createExporterServer } from "../server.js";

const marker = '<img src="https://example.invalid/automatic" onerror="window.ATTACK=true">';
let receivedToken = null, previewToken = null, exports = 0;
const { server, key } = createExporterServer({
  previewExport: async (token, options, send) => {
    previewToken = token;
    send("done", JSON.stringify({ operation: "preview", conversations: 7, projects: 2, gpts: 3, status: "complete-within-requested-scope" }));
  },
  runExport: async (token, output, concurrency, zip, keepAwake, options, send) => {
    receivedToken = token;
    if (++exports > 1) {
      send("done", JSON.stringify({ total: 9, processed: 9, succeeded: 9, failed: 0, projects: 3, gpts: 19, totalFiles: 14, failedFiles: 1, missingFiles: [{ filename: 'Missing.pdf', projectName: 'Synthetic project' }], errors: [{ category: 'project-resource', message: 'HTTP 404' }], status: 'partial', output })); return;
    }
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
  assert.equal(await page.locator("#export-btn").isDisabled(), true);
  assert.equal(await page.locator("#opt-conversations").isVisible(), true);
  await page.locator("[data-handler-14]").click();
  await page.locator("#fp-list").getByText(marker, { exact: false }).waitFor();
  assert.equal(await page.locator("#fp-list img").count(), 0);
  await page.locator("[data-handler-6]").click();
  await page.locator("#token-input").fill(JSON.stringify({ accessToken: "SYNTHETIC_TOKEN_ONLY", user: { id: "synthetic-user" } }));
  await page.locator("#workspace-id").fill("synthetic-workspace");
  assert.equal(await page.locator("#md-conversation-metadata").isChecked(), true);
  assert.equal(await page.locator("#md-timestamps").isChecked(), true);
  assert.equal(await page.locator("#md-model-name").isChecked(), true);
  assert.equal(await page.locator("#md-thought-process").isChecked(), true);
  assert.equal(await page.locator("#md-branch-mode").inputValue(), "all");
  await page.locator("#preview-btn").click();
  await page.locator("#preview-result").filter({ hasText: "7 conversations" }).waitFor();
  assert.equal(previewToken, "SYNTHETIC_TOKEN_ONLY");
  assert.notEqual(await page.locator("#token-input").inputValue(), "");
  assert.match(await page.locator("#progress-text").textContent(), /Preview completed/);
  assert.equal(await page.locator("#preview-result").getAttribute("class"), "preview-box");
  assert.ok(await page.locator("#preview-btn").evaluate(el => Boolean(el.compareDocumentPosition(document.getElementById('export-btn')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.locator("#token-input").fill(JSON.stringify({ accessToken: "SYNTHETIC_REFRESHED", user: { id: "synthetic-user" } }));
  assert.doesNotMatch(await page.locator("#preview-result").textContent(), /out of date/);
  await page.locator("#concurrency").selectOption("2");
  assert.doesNotMatch(await page.locator("#preview-result").textContent(), /out of date/);
  if (process.env.CGE_SCREENSHOT_DIR) { await page.locator('#preview-btn').scrollIntoViewIfNeeded(); await page.screenshot({path:join(process.env.CGE_SCREENSHOT_DIR,'review1-preview.png')}); }
  await page.locator("#opt-date-from").fill("2026-02-01");
  await page.locator("#opt-date-to").fill("2026-01-01");
  assert.equal(await page.locator("#export-btn").isDisabled(), true);
  assert.match(await page.locator("#preview-result").textContent(), /out of date/);
  await page.locator("#start-wrapper").hover();
  assert.match(await page.locator("#start-reasons").textContent(), /start date/);
  await page.locator("#opt-date-from").fill("");
  await page.locator("#opt-date-to").fill("");
  assert.equal(await page.locator("#export-btn").isEnabled(), true);
  await page.locator("#export-btn").click();
  await page.locator("#issue-result").filter({ hasText: marker }).waitFor();
  assert.equal(receivedToken, "SYNTHETIC_REFRESHED");
  assert.equal(await page.locator("#token-input").inputValue(), "");
  assert.equal(await page.locator("#result img").count(), 0);
  assert.ok((await page.locator("#issue-result").getAttribute("class")).includes("error"));
  await page.locator('#token-input').fill(JSON.stringify({ accessToken: 'SYNTHETIC_AGAIN', user: { id: 'synthetic-user' } }));
  await page.locator('#export-btn').click();
  await page.locator('#file-result').filter({ hasText: 'Missing.pdf' }).waitFor();
  assert.equal(await page.locator('#result').getAttribute('class'), 'result success');
  assert.equal(await page.locator('#file-result').getAttribute('class'), 'result warning');
  assert.equal(await page.locator('#issue-result').isVisible(), false);
  assert.match(await page.locator('#result').textContent(), /9 conversations/);
  if (process.env.CGE_SCREENSHOT_DIR) { await page.locator('#file-result').scrollIntoViewIfNeeded(); await page.mouse.move(0,0); await page.evaluate(() => document.activeElement?.blur()); await page.screenshot({path:join(process.env.CGE_SCREENSHOT_DIR,'review1-result.png')}); }
  assert.equal(await page.evaluate(() => window.ATTACK), undefined);
  assert.deepEqual(requests.filter(url => !url.startsWith(origin + "/")), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", engine, channel: channel || "bundled", browser: await browser.version(), platform: process.platform, checks: ["launch capability removed from URL", "authenticated config/progress", "CSP permits intended controls", "folder XSS marker inert", "completion XSS marker inert", "token field cleared", "partial result warning", "no external requests", "disabled start and reasons", "default Markdown options and branches", "preview retains session", "preview invalidates on selection change", "export after preview without repasting"] }, null, 2));
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
}
