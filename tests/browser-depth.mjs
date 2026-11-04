// Synthetic deep-path export -> native OS ZIP -> extraction -> file:// browser.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { contentRoot, workPath } from "../lib/archive-layout.js";
import { runExport } from "../lib/export-runner.js";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { conversation, fixture, identity } from "./export-fixtures.mjs";

const f = fixture();
// /tmp avoids the unusually deep macOS per-user temporary directory. The
// canonical path is still measured (macOS resolves it to /private/tmp).
const parent = realpathSync.native(mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "cge-depth-")));
const padding = 63 - parent.length - 1;
assert.ok(padding >= 1, "Temporary directory is too deep for the 63-character fixture; use a shorter TEMP path");
const archive = join(parent, "d".repeat(padding));
const title = "Maximum title Über # % " + "T".repeat(480);
const projectName = "Maximum project Über # % " + "P".repeat(480);
const attachmentName = "Über # % " + "x".repeat(37) + ".txt";
const attachmentBytes = "synthetic depth-check original bytes\n";
let browser;
try {
  assert.equal(archive.length, 63);
  assert.equal(attachmentName.length, 50);
  const convo = conversation("c".repeat(200), title);
  convo.mapping.question.message.metadata.attachments = [{ id: "file-" + "a".repeat(195), name: attachmentName }];
  f.state.conversations = [convo];
  f.state.projects = [{
    gizmoId: "g-" + "p".repeat(198), name: projectName, gizmo: { name: projectName }, files: [],
    conversations: [{ id: convo.conversation_id, title, create_time: convo.create_time, update_time: convo.update_time }],
  }];
  const report = await runExport("SYNTHETIC-TOKEN", archive, 1, false, false, { identity, gpts: false, organizeFolders: true }, () => {}, {
    ...f.deps,
    downloadFile: async (_id, _token, _fallback, _debug, _project, _conversation, destination) => {
      writeFileSync(destination, attachmentBytes);
      return { filename: attachmentName };
    },
  });
  assert.equal(report.status, "complete-within-requested-scope", JSON.stringify(report.errors));
  const manifest = JSON.parse(readFileSync(workPath(archive, "archive-manifest.json"), "utf8"));
  const media = manifest.files.filter(file => file.path.includes("/files/") && !file.path.endsWith("/.file-map.json"));
  assert.equal(media.length, 1);
  assert.ok(media.every(file => file.path.length <= 200));
  assert.ok(manifest.files.every(file => join(archive, file.path).length <= 250));
  const verify = root => spawnSync(process.execPath, ["scripts/verify-archive.mjs", root], { encoding: "utf8" });
  const originalVerified = verify(archive);
  assert.equal(originalVerified.status, 0, originalVerified.stderr);

  const zip = join(parent, "archive.zip"), extracted = join(parent, "extracted");
  let packed, unpacked;
  if (process.platform === "win32") {
    const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    packed = spawnSync(tar, ["-a", "-c", "-f", zip, "-C", parent, basename(archive)], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    mkdirSync(extracted);
    unpacked = spawnSync(tar, ["-x", "-f", zip, "-C", extracted], { encoding: "utf8" });
  } else if (process.platform === "darwin") {
    packed = spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", archive, zip], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    unpacked = spawnSync("/usr/bin/ditto", ["-x", "-k", zip, extracted], { encoding: "utf8" });
  } else throw new Error("The deep-path native ZIP check requires Windows or macOS");
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const restored = join(extracted, basename(archive));
  const restoredVerified = verify(restored);
  assert.equal(restoredVerified.status, 0, restoredVerified.stderr);
  assert.ok(manifest.files.every(file => join(restored, file.path).length <= 250));
  assert.equal(readFileSync(join(restored, media[0].path), "utf8"), attachmentBytes);

  browser = await chromium.launch();
  const context = await browser.newContext({ offline: true });
  const requests = [], errors = [];
  context.on("request", request => requests.push(request.url()));
  await context.route(/^https?:\/\//i, route => route.abort());
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(join(contentRoot(restored), "index.html")).href);
  await page.locator(".nav-proj-btn").click();
  await page.getByRole("link", { name: title, exact: true }).click();
  const frame = page.frameLocator("#frame");
  await frame.getByRole("heading", { name: title, exact: true }).waitFor();
  const attachment = frame.locator("a.attachment");
  assert.equal(await attachment.count(), 1);
  const record = collectLocalConversations(contentRoot(restored))[0];
  const linked = new URL(await attachment.getAttribute("href"), pathToFileURL(join(record.baseDir, "html", record.fname + ".html")));
  assert.equal(decodeURIComponent(linked.pathname).endsWith(attachmentName), true);
  const popupPromise = context.waitForEvent("page");
  await attachment.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("load");
  assert.equal(await popup.locator("body").innerText(), attachmentBytes);
  assert.deepEqual(requests.filter(url => !url.startsWith("file:") && url !== "about:blank"), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", platform: process.platform, browser: await browser.version(), sourceRootLength: archive.length,
    extractedRootLength: restored.length, relativeMediaLength: media[0].path.length,
    longestSourcePath: Math.max(...manifest.files.map(file => join(archive, file.path).length)),
    longestExtractedPath: Math.max(...manifest.files.map(file => join(restored, file.path).length)),
    checks: ["maximum source project/title and 200-character IDs", "50-character stored attachment", "native OS ZIP and extraction", "manifest verification before/after ZIP", "file index/project navigation", "actual attachment opened and bytes read", "no network"] }, null, 2));
  await context.close();
} finally {
  if (browser) await browser.close();
  f.cleanup();
  rmSync(parent, { recursive: true, force: true });
}
