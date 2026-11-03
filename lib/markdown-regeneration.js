import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { conversationToMarkdown } from "./markdown.js";
import { conversationToHtml } from "./html-renderer.js";
import { generateExportIndex } from "./export-index.js";
import { buildLocalFileMap, collectMarkdownRegenerationTargets } from "./local-export.js";
import { collectLocalConversations } from "./conversation-storage.js";
import { atomicWrite, inside, lockArchive, publishGeneration, recoverTransactions, writeArchiveManifest } from "./archive-store.js";
import { validateConversation } from "./export-runner.js";
import { extractFileReferences } from "./export-files.js";
import { extractSandboxReferences } from "./sandbox-files.js";

export async function regenerateMarkdown(outputDir, markdownOptions, sendEvent) {
  let root = resolve(outputDir.startsWith("~") ? join(homedir(), outputDir.slice(1)) : outputDir);
  const runId = randomUUID();
  const report = { runId, operation: "local-view-regeneration", total: 0, succeeded: 0, failed: 0, failedTitles: [], errors: [], output: root };
  let unlock;
  let stage = join(root, ".staging", runId);
  const issue = (path, error) => { report.errors.push({ category: "local-regeneration", id: path, message: String(error.message) }); };
  try {
    unlock = lockArchive(root);
    root = realpathSync.native(root); stage = join(root, ".staging", runId); report.output = root;
    atomicWrite(join(root, "archive-operation.json"), JSON.stringify({ runId, status: "running" }, null, 2));
    recoverTransactions(root); inside(root, stage);
    collectLocalConversations(root, { lean: true, onError: issue });
    const targets = collectMarkdownRegenerationTargets(root); report.total = targets.length;
    for (const target of targets) {
      try {
        inside(root, target.jsonPath);
        const convo = JSON.parse(readFileSync(target.jsonPath, "utf8"));
        validateConversation(convo, convo.conversation_id || convo.id);
        const map = buildLocalFileMap(target.filesDir, target.fname);
        for (const ref of [...extractFileReferences(convo), ...extractSandboxReferences(convo)]) {
          if (!map[ref.fileId]) issue(target.jsonPath, new Error(`Local media unavailable: ${ref.fileId}; regeneration does not download files`));
        }
        const md = join(stage, "derived.md"), html = join(stage, "derived.html");
        atomicWrite(md, conversationToMarkdown(convo, map, markdownOptions));
        atomicWrite(html, conversationToHtml(convo, map, [], target.fname));
        publishGeneration(root, [{ source: md, target: target.mdPath }, { source: html, target: join(dirname(target.mdDir), "html", target.fname + ".html") }]);
        report.succeeded++;
      } catch (error) { report.failed++; report.failedTitles.push(target.fname); issue(target.jsonPath, error); }
      sendEvent("progress", JSON.stringify({ current: report.succeeded + report.failed, total: report.total, title: target.fname }));
      await new Promise(resolve => setImmediate(resolve));
    }
    try { generateExportIndex(root, []); } catch (error) { issue("index.html", error); }
  } catch (error) { issue("archive", error); }
  finally {
    report.status = report.errors.length ? "partial" : "complete-within-requested-scope";
    if (unlock) {
      try {
        if (existsSync(stage)) rmSync(inside(root, stage), { recursive: true, force: true });
        atomicWrite(join(root, "logs", `regeneration-report-${runId}.json`), JSON.stringify(report, null, 2));
        atomicWrite(join(root, "archive-operation.json"), JSON.stringify({ runId, status: report.status }, null, 2));
        writeArchiveManifest(root, report);
      } catch (error) {
        issue("manifest", error); report.status = "partial";
        try {
          atomicWrite(join(root, "logs", `regeneration-report-${runId}.json`), JSON.stringify(report, null, 2));
          atomicWrite(join(root, "archive-operation.json"), JSON.stringify({ runId, status: "partial-manifest-failure" }, null, 2));
        } catch { /* UI remains the fallback if storage is unavailable. */ }
      }
      unlock();
    }
    sendEvent("done", JSON.stringify(report));
  }
  return report;
}
