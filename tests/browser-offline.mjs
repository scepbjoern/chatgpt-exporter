// Synthetic file:// integration check. Run separately after installing Playwright Chromium.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { chromium, firefox, webkit } from "playwright";
import { conversationToHtml } from "../lib/html-renderer.js";
import { generateExportIndex } from "../lib/export-index.js";

const archive = mkdtempSync(join(tmpdir(), "exporter offline Über #%-"));
const engine = process.env.CGE_BROWSER_ENGINE || "chromium";
const channel = process.env.CGE_BROWSER_CHANNEL;
assert.ok(["chromium", "firefox", "webkit"].includes(engine), "Unknown CGE_BROWSER_ENGINE");
const browser = await ({ chromium, firefox, webkit })[engine].launch(channel ? { channel } : {});
try {
  for (const subdir of ["json", "html", "files", "gpts", "archived/html", "deleted/html", "projects/Project_stable/html", "projects/Project_stable/resources"]) {
    mkdirSync(join(archive, subdir), { recursive: true });
  }
  const title = "Überblick Q&A — 100% #1";
  const attack = '<img src="https://example.invalid/automatic" onerror="window.ATTACK=true"><svg onload="window.ATTACK=true"></svg>';
  const mathInline = String.raw`\(x_{1}=\frac{1}{2}\)`;
  const mathBlock = String.raw`\[
a &< b \\
c &= d
\]`;
  const convo = {
    title, conversation_id: "synthetic-browser", create_time: 1700000000,
    mapping: {
      user: { parent: null, children: ["assistant"], message: { author: { role: "user" }, content: { content_type: "text", parts: ["Synthetic user"] } } },
      assistant: { parent: "user", children: ["tool"], message: { author: { role: "assistant" }, content: { content_type: "text", parts: [`**Assistant readable**\n\n${attack}\n\n[x](javascript:alert%281%29)\n\n![remote](https://example.invalid/image.png)\n\n![Local](../files/Über%20%23%25.png)\n\n[Explicit external](https://example.invalid/click)`] } } },
      tool: { parent: "assistant", children: [], message: { author: { role: "tool" }, content: { content_type: "execution_output", parts: ["Tool readable\n" + attack] } } },
    },
  };
  convo.mapping.assistant.message.content.parts.push("\n\n" + mathInline + "\n\n" + mathBlock);
  const pngChunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  writeFileSync(join(archive, "files/Über #%.png"), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))), pngChunk("IEND", Buffer.alloc(0)),
  ]));
  writeFileSync(join(archive, "html/chat #%.html"), conversationToHtml(convo, { local: "../files/Über #%.png" }));
  writeFileSync(join(archive, "html/second.html"), conversationToHtml({ ...convo, title: "Other title" }));
  writeFileSync(join(archive, "json/chat #%.json"), JSON.stringify(convo));
  writeFileSync(join(archive, "json/second.json"), JSON.stringify({ ...convo, conversation_id: "second", title: "Other title", create_time: 1735689600 }));
  writeFileSync(join(archive, "archived/html/archived.html"), conversationToHtml({ ...convo, title: "Archived fixture" }));
  writeFileSync(join(archive, "deleted/html/deleted.html"), conversationToHtml({ ...convo, title: "Deleted fixture" }));
  writeFileSync(join(archive, "projects/Project_stable/project-info.md"), "# Project\n\n**Instructions readable**\n\n" + attack);
  convo.mapping.tool.children = ["variant1", "variant2"];
  for (const [id, text] of [["variant1", '<box><text>Readable widget</text><Link url="https://example.invalid/source" title="Saved source"/></box>'], ["variant2", 'Second branch response']]) convo.mapping[id] = { parent: "tool", children: [], message: { author: { role: "assistant" }, content: { content_type: "text", parts: [text] } } };
  writeFileSync(join(archive, "html/chat #%.html"), conversationToHtml(convo, { local: "../files/Über #%.png" }));
  writeFileSync(join(archive, "gpts", "fixture.md"), "# Synthetic GPT\n\nDescription");
  writeFileSync(join(archive, "projects/Project_stable/html/example.html"), conversationToHtml({ ...convo, title: "Project-only title" }));
  generateExportIndex(archive, [{ name: "Project Q&A", folderName: "Project_stable" }]);

  // Playwright WebKit's offline emulation rejects even a trivial file: page.
  // Block HTTP(S) routes there instead; every attempted non-file request fails this test.
  const context = await browser.newContext({ offline: engine !== "webkit" });
  await context.route(/^https?:\/\//i, route => route.abort());
  const requests = [];
  const errors = [];
  const browserErrors = [];
  context.on("request", (request) => requests.push(request.url()));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.goto(pathToFileURL(join(archive, "index.html")).href);
  const groups = page.locator(".sidebar-scroll > details");
  assert.deepEqual(await groups.locator("summary").allTextContents(), ["GPTs (metadata)", "Projects", "Conversations"]);
  assert.equal(await page.locator(".sidebar-scroll > details[open]").count(), 0);
  const gpt = page.locator("#gpt-group");
  assert.equal(await gpt.getAttribute('open'), null);
  await gpt.locator('summary').click();
  assert.equal(await gpt.locator('a').isVisible(), true);
  await gpt.locator('summary').click();
  const search = page.locator("#search");
  await search.fill("Synthetic GPT");
  assert.equal(await gpt.locator("a").isVisible(), true);
  await search.fill("Archived fixture");
  assert.equal(await page.getByRole("link", {name: "Archived fixture", exact: true}).isVisible(), true);
  await search.fill("project-only title");
  assert.equal(await page.getByRole("link", {name: "Project-only title", exact: true}).isVisible(), true);
  await search.fill("impossible missing title");
  assert.equal(await page.locator("#no-results").isVisible(), true);
  await search.fill("");
  assert.equal(await page.locator(".sidebar-scroll > details[open]").count(), 0);
  await page.locator("#projects-group > summary").click();
  await gpt.locator("summary").click();
  assert.equal(await page.locator(".sidebar-scroll > details[open]").count(), 2);
  await gpt.locator("summary").click();
  await page.locator("#date-from").fill("2024-01-01");
  assert.equal(await page.getByRole("link", { name: title, exact: true }).isVisible(), false);
  assert.equal(await page.getByRole("link", { name: "Other title", exact: true }).isVisible(), true);
  await page.locator("#date-from").fill("");
  assert.equal(await page.locator("#projects-group").getAttribute("open"), "");
  assert.equal(await page.locator("#conversations-group").getAttribute("open"), null);
  await page.locator("#sort").selectOption("oldest");
  assert.equal(await page.locator("#conversations-group .nav-row").first().getAttribute("data-title"), title);
  await page.locator("#sort").selectOption("title");
  assert.equal(await page.locator("#conversations-group .nav-row").first().getAttribute("data-title"), "Other title");
  await page.getByRole("textbox", { name: "Search conversation titles" }).fill("Q&A");
  assert.equal(await page.getByRole("link", { name: "Other title", exact: true }).isVisible(), false);
  const selected = page.getByRole("link", { name: title, exact: true });
  assert.equal(await selected.isVisible(), true);
  await selected.click();
  let frame = page.frameLocator("#frame");
  await frame.getByText("Assistant readable", { exact: true }).waitFor();
  assert.equal(await frame.locator("code.math-source").textContent(), mathInline);
  assert.equal(await frame.locator("pre.math-source code").textContent(), mathBlock);
  assert.equal(await frame.locator('nav.sidebar').count(), 0);
  assert.equal(await frame.getByRole('link', { name: 'Open original in ChatGPT' }).getAttribute('href'), 'https://chatgpt.com/c/synthetic-browser');
  await frame.getByText('Readable widget', { exact: true }).waitFor();
  assert.equal(await frame.locator('.branch').count(), 2);
  await frame.getByText('Variant 2 of 2 — separate continuation', { exact: true }).click();
  assert.equal(await frame.getByText('Second branch response', { exact: true }).isVisible(), false);
  await frame.getByText('Variant 2 of 2 — separate continuation', { exact: true }).click();
  if (process.env.CGE_SCREENSHOT_DIR) { await frame.getByText('Variant 1 of 2 — separate continuation', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({path:join(process.env.CGE_SCREENSHOT_DIR,'review1-branches.png')}); }
  await frame.getByText("Output", { exact: true }).click();
  await frame.getByText("Tool readable", { exact: false }).waitFor();
  assert.equal(await frame.locator("body").evaluate(() => window.ATTACK), undefined);
  assert.equal(await frame.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(await frame.locator('img[src^="http"]').count(), 0);
  const localImage = frame.getByAltText("Local");
  await localImage.scrollIntoViewIfNeeded();
  await localImage.evaluate((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  }));
  assert.equal(await localImage.evaluate((image) => image.complete && image.naturalWidth > 0), true, JSON.stringify(browserErrors));
  assert.equal(await frame.getByRole("link", { name: "Explicit external" }).getAttribute("target"), "_blank");

  await page.reload();
  await page.frameLocator("#frame").getByText("Assistant readable", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Search conversation titles" }).fill("");
  assert.equal(await page.locator("#conversations-group").getAttribute("open"), "");
  await page.locator("#projects-group > summary").click();
  await page.getByRole("button", { name: /Project Q&A/ }).click();
  await page.getByRole("link", { name: /Project info/ }).click();
  await page.frameLocator("#frame").getByText("Instructions readable", { exact: true }).waitFor();
  for (const name of ["Archived fixture", "Deleted fixture"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await page.frameLocator("#frame").getByRole("heading", { name, exact: true }).waitFor();
  }
  await page.locator("#search").fill("Synthetic GPT");
  await page.evaluate(() => { location.hash = encodeURIComponent("archived/html/archived.html"); });
  await page.frameLocator("#frame").getByRole("heading", {name: "Archived fixture", exact: true}).waitFor();
  assert.equal(await page.locator("#search").inputValue(), "");
  assert.equal(await page.getByRole("link", {name: "Archived fixture", exact: true}).isVisible(), true);
  assert.deepEqual(requests.filter((url) => !url.startsWith("file:") && url !== "about:blank"), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", engine, channel: channel || "bundled", browser: await browser.version(), platform: process.platform, networkIsolation: engine === "webkit" ? "HTTP(S) blocked; WebKit offline emulation also rejects file pages" : "offline emulation and HTTP(S) blocked", checks: ["file URL with special characters", "offline assistant/tool content", "inert attack markers", "no automatic network requests", "local raster image", "title search", "creation-date filter and date/title sorting", "hash reload", "project info", "archived/deleted navigation"] }, null, 2));
  await context.close();
} finally {
  await browser.close();
  rmSync(archive, { recursive: true, force: true });
}
