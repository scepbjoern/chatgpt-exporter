import { conversationInventory, selectConversations } from "./export-inventory.js";
import { contentRoot, initializeLayout, workPath } from "./archive-layout.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, copyFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { conversationToMarkdown } from "./markdown.js";
import { classifyResumeState, timestampMs } from "./resume-state.js";
import { filterSelectedProjects, conversationMatchesProjectSelection } from "./project-selection.js";
import { extractSandboxReferences } from "./sandbox-files.js";
import { buildLocalConversationIndex, collectLocalConversations } from "./conversation-storage.js";
import { deduplicateFilename, downloadFile, downloadSandboxFile, extractFileReferences, sanitizeFilename, safeDate } from "./export-files.js";
import { conversationToHtml } from "./html-renderer.js";
import { projectToMarkdown, gptToMarkdown } from "./entity-markdown.js";
import { generateExportIndex } from "./export-index.js";
import { atomicWrite, inside, lockArchive, publishGeneration, recoverTransactions, sha256, writeArchiveManifest } from "./archive-store.js";
import * as network from "./chatgpt-api.js";
import { archiveKeys, entityKey, portablePath } from "./archive-names.js";
export { entityKey } from "./archive-names.js";

function validId(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(id); }
export function validateConversation(convo, id) {
  if (!convo || (convo.conversation_id || convo.id) !== id || !convo.mapping || typeof convo.mapping !== "object" || Array.isArray(convo.mapping)) throw new Error("Invalid conversation JSON or identity");
  if (convo.title !== undefined && typeof convo.title !== "string") throw new Error("Invalid conversation title");
  return convo;
}
export function projectFolder(project, key = entityKey(project.gizmoId)) { return `${sanitizeFilename(project.name, 12)}_${key}`; }
export function conversationName(item, key) { return `${safeDate(item.create_time) || "0000-00-00"} - ${Array.from(sanitizeFilename(item.title || "Untitled", 1024)).slice(0, 32).join("").replace(/[. ]+$/g, "")} - ${key}`; }
function mediaName(name) {
  const safe = sanitizeFilename(name, 255), extension = extname(safe);
  return extension.length <= 12 ? `${sanitizeFilename(basename(safe, extension), 50 - extension.length)}${extension}` : sanitizeFilename(safe, 50);
}
function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function fileManifest(dir) { try { return readJson(join(dir, ".file-map.json")); } catch { return { files: {} }; } }
function storedFile(dir, entry) {
  const name = typeof entry === "string" ? entry : entry?.name;
  if (typeof name !== "string" || basename(name) !== name || name.includes("\\")) return null;
  const path = join(dir, name);
  try {
    inside(dir, path);
    if (!statSync(path).isFile()) return null;
    if (typeof entry === "object" && (entry.size !== statSync(path).size || entry.sha256 !== sha256(path))) return null;
    return { path, name, size: statSync(path).size, sha256: sha256(path) };
  } catch { return null; }
}

// The former createZip argument is retained only for source-call compatibility.
// No ZIP or archive-wide byte collection is performed.
export async function runExport(token, outputDir, concurrency, _createZip, keepAwake, exportOptions = {}, sendEvent = () => {}, dependencies = {}) {
  const api = { ...network, ...dependencies };
  const fetchFile = dependencies.downloadFile || downloadFile;
  const fetchSandbox = dependencies.downloadSandboxFile || downloadSandboxFile;
  let root = resolve(outputDir.startsWith("~") ? join(homedir(), outputDir.slice(1)) : outputDir);
  const runId = randomUUID();
  const report = { version: 1, runId, startedAt: new Date().toISOString(), status: "running", errors: [], limitations: ["Workspace binding is declared from the supplied session and explicit workspace ID; real workspace routing requires a separate inventory comparison.", "Shared projects and GPT Knowledge files are outside scope.", "Sandbox paths represent the latest available version, not all historical versions.", "No automatic deletion inference is performed; missing remote items remain in their previous location.", "Active original attachments are preserved as bytes; open them only in a suitable trusted application."], total: 0, succeeded: 0, updated: 0, skipped: 0, failed: 0, failedTitles: [], totalFiles: 0, failedFiles: 0, failedFileDetails: [], projects: 0, gpts: 0, archived: 0, movedToArchived: 0, movedToDeleted: 0, restoredFromArchived: 0, restoredFromDeleted: 0, deletionReconciliationComplete: false, output: root };
  let unlock, bound = false, recovered = false, awake;
  let archive = root;
  const formats = { markdown: true, html: true, indexHtml: true, ...exportOptions.formats };
  report.settings = { conversations: exportOptions.conversations !== false, projects: exportOptions.projects !== false, gpts: exportOptions.gpts !== false, dateFrom: exportOptions.dateFrom || null, dateTo: exportOptions.dateTo || null, selectedProjectIds: exportOptions.selectedProjectIds || null, formats, markdown: exportOptions.markdown || {}, dateBasis: "conversation creation; UTC" };
  report.missingFiles = [];
  const projects = [];
  const renderHtml = dependencies.conversationToHtml || conversationToHtml;
  const renderMarkdown = dependencies.conversationToMarkdown || conversationToMarkdown;
  const stopAwake = () => { if (awake) { try { awake.kill(); } catch {} } };
  const onInterrupt = () => { stopAwake(); process.exit(130); };
  const onTerminate = () => { stopAwake(); process.exit(143); };
  const issue = (category, id, error) => {
    const message = api.redactSecrets(String(error?.message || error));
    report.errors.push({ category, id, message });
    sendEvent("status", `${category}: ${message}`);
  };
  const emit = (type, data) => { try { sendEvent(type, typeof data === "string" ? data : JSON.stringify(data)); } catch {} };
  let stageRoot = workPath(root, ".staging", runId);
  try {
    const identity = exportOptions.identity;
    if (!identity || !validId(identity.userId) || !validId(identity.workspaceId)) throw new Error("Session user ID and explicit workspace ID are required");
    unlock = lockArchive(root);
    root = realpathSync.native(root); stageRoot = workPath(root, ".staging", runId); report.output = root;
    initializeLayout(root, exportOptions.organizeFolders === true);
    archive = contentRoot(root);
    stageRoot = workPath(root, ".staging", runId);
    report.archive = archive;
    const bindingPath = workPath(root, "archive-identity.json");
    if (existsSync(bindingPath)) {
      const saved = readJson(bindingPath);
      if (saved.userId !== identity.userId || saved.workspaceId !== identity.workspaceId) throw new Error("Archive belongs to another user or workspace; use a separate empty folder");
    } else {
      if (collectLocalConversations(archive).length || ["json", "projects", "archived", "deleted", "gpts"].some(name => existsSync(join(archive, name)))) throw new Error("Existing unbound archive: use a new empty output folder; regenerate old HTML locally instead");
      atomicWrite(bindingPath, JSON.stringify({ ...identity, binding: "declared", realWorkspaceRoutingVerified: false }, null, 2));
    }
    bound = true;
    atomicWrite(workPath(root, "archive-operation.json"), JSON.stringify({ runId, status: "running" }, null, 2));
    api.resetRateLimiter(); api.setApiWorkspace(identity.workspaceId);
    api.configureRetry?.({ enabled: true, signal: dependencies.signal, minIntervalMs: exportOptions.paceMs || 1000, onWait: data => emit("retry_wait", data) });
    report.recoveredTransactions = recoverTransactions(root);
    recovered = true;
    inside(root, stageRoot); mkdirSync(stageRoot, { recursive: true });
    if (keepAwake) {
      try {
        if (process.platform === "darwin") awake = spawn("caffeinate", ["-dims"], { stdio: "ignore" });
        else if (process.platform === "win32") awake = spawn("powershell", ["-NoProfile", "-Command", "$t=Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint s);' -Name KA -PassThru; while($true){$t::SetThreadExecutionState(0x80000003);Start-Sleep 59}"], { stdio: "ignore", windowsHide: true });
        if (awake) {
          awake.on("error", error => issue("keep-awake", "", error));
          process.once("SIGINT", onInterrupt); process.once("SIGTERM", onTerminate);
        }
      } catch (error) { issue("keep-awake", "", error); }
    }
    const keyFor = archiveKeys(root, dependencies.identityDigest);
    const local = buildLocalConversationIndex(archive, { lean: true, onError: (path, e) => issue("local-json", path, e) });
    if (exportOptions.projects !== false || exportOptions.conversations !== false) {
      try {
        emit("status", "Reading project list…");
        projects.push(...await api.fetchProjectsInventory(token));
        for (const project of projects) {
          if (!validId(project.gizmoId)) throw new Error("Invalid project ID");
          project.folderName = projectFolder(project, keyFor("project", project.gizmoId));
        }
      } catch (error) { issue("project-inventory", "", error); if (dependencies.signal?.aborted || error instanceof network.RateLimitStopError) throw error; }
    }
    const projectByConversation = new Map();
    const projectRows = [];
    if (exportOptions.conversations !== false || exportOptions.projects !== false) for (const project of projects) {
      try {
        let cursor = null;
        const cursors = new Set(), ids = new Set();
        for (let page = 0; ; page++) {
          if (page > 10000) throw new Error("Project pagination limit");
          emit("status", `Reading project conversations: ${projects.indexOf(project) + 1} of ${projects.length}, page ${page + 1}…`);
          const data = await api.apiGet(`gizmos/${project.gizmoId}/conversations?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, token);
          api.validateConversationInventory(data);
          for (const row of data.items) {
            if (ids.has(row.id) || projectByConversation.has(row.id)) throw new Error("Duplicate project conversation inventory ID");
            ids.add(row.id); projectByConversation.set(row.id, project); projectRows.push({ ...row, projectId: project.gizmoId, projectName: project.name, isArchived: row.is_archived === true });
          }
          const next = data.cursor ?? data.next_cursor ?? null;
          if (!next) break;
          if (typeof next !== "string" || !data.items.length || cursors.has(next)) throw new Error("Invalid project conversation cursor");
          cursors.add(next); cursor = next;
        }
      } catch (error) { issue("project-conversations", project.gizmoId, error); if (dependencies.signal?.aborted || error instanceof network.RateLimitStopError) throw error; }
    }
    if (exportOptions.conversations !== false && report.errors.some(e => ["project-inventory", "project-conversations"].includes(e.category))) throw new Error("Conversation export blocked because project scope is incomplete");
    for (const project of projects) project.conversations = report.errors.some(e => e.category === "project-conversations" && e.id === project.gizmoId) ? null : projectRows.filter(row => row.projectId === project.gizmoId);
    const selectedProjects = exportOptions.projects === false ? [] : filterSelectedProjects(projects, exportOptions.selectedProjectIds);
    for (const project of selectedProjects) {
      emit("status", `Saving project ${selectedProjects.indexOf(project) + 1} of ${selectedProjects.length}: ${project.name || "Project"}…`);
      try {
        const dir = portablePath(join(archive, "projects", project.folderName));
        inside(root, dir);
        let previousResources = [];
        try { previousResources = readJson(join(dir, "project-raw.json")).resources || []; } catch {}
        const metadataStage = join(stageRoot, `project-${randomUUID()}`);
        atomicWrite(join(metadataStage, "info.md"), projectToMarkdown(project.gizmo));
        atomicWrite(join(metadataStage, "raw.json"), JSON.stringify(project, null, 2));
        publishGeneration(root, [{ source: join(metadataStage, "info.md"), target: join(dir, "project-info.md") }, { source: join(metadataStage, "raw.json"), target: join(dir, "project-raw.json") }]);
        const used = new Set();
        project.resources = [];
        for (const file of project.files || []) {
          dependencies.signal?.throwIfAborted();
          emit("status", `Downloading project resource: ${file.name || file.filename || "File"}…`);
          report.totalFiles++;
          const id = file.file_id || file.id;
          if (!validId(id)) { report.failedFiles++; issue("project-resource", project.gizmoId, "Invalid file ID"); continue; }
          try {
            const stage = join(stageRoot, `resource-${randomUUID()}`);
            const result = await fetchFile(id.startsWith("file") ? id : `file-${id}`, token, file.name || file.filename || id, null, project.gizmoId, null, stage);
            if (result.buffer) atomicWrite(stage, result.buffer);
            const safeName = sanitizeFilename(result.filename || file.name || file.filename || id, Number.MAX_SAFE_INTEGER);
            const ext = extname(safeName);
            const name = deduplicateFilename(`${sanitizeFilename(basename(safeName, ext), 30)}_${keyFor("resource", id)}${ext.length <= 12 ? ext : ""}`, used);
            publishGeneration(root, [{ source: stage, target: portablePath(join(dir, "resources", name)) }]);
            project.resources.push({ id, filename: file.name || file.filename || result.filename || id, localName: name, available: true });
          } catch (error) {
            dependencies.signal?.throwIfAborted();
            if (dependencies.signal?.aborted || error instanceof network.RateLimitStopError) throw error;
            report.failedFiles++;
            const retained = previousResources.find(r => r.id === id && typeof r.localName === "string" && basename(r.localName) === r.localName && existsSync(inside(root, join(dir, "resources", r.localName))));
            const failure = { retained: Boolean(retained), id, filename: file.name || file.filename || id, projectId: project.gizmoId, projectName: project.name, error: api.redactSecrets(error.message) };
            report.missingFiles.push(failure); report.failedFileDetails.push(`${failure.filename}: ${failure.error}`);
            project.resources.push({ id, filename: failure.filename, available: false, ...(retained ? { localName: retained.localName, retained: true } : {}) });
            issue("project-resource", id, error);
          }
        }
        report.projects++;
      } catch (error) { issue("project", project.gizmoId, error); if (dependencies.signal?.aborted || error instanceof network.RateLimitStopError) throw error; }
    }
    if (exportOptions.gpts !== false) {
      try {
        let cursor = null;
        const cursors = new Set();
        for (let page = 0; ; page++) {
          if (page > 10000) throw new Error("GPT pagination limit");
          emit("status", `Reading GPT metadata: page ${page + 1}; ${report.gpts} saved so far…`);
          const data = await api.apiGetPublic(`gizmos/discovery/mine?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, token);
          const items = data.list?.items ?? data.items;
          if (!Array.isArray(items)) throw new Error("Invalid GPT inventory schema");
          for (const item of items) {
            const gpt = item.resource?.gizmo || item.gizmo || item;
            if (!validId(gpt.id)) throw new Error("Invalid GPT ID");
            const name = `${sanitizeFilename(gpt.display?.name || gpt.name || "GPT", 12)}_${keyFor("gpt", gpt.id)}`;
            const raw = join(stageRoot, `${randomUUID()}.json`), md = raw + ".md";
            atomicWrite(raw, JSON.stringify(gpt, null, 2)); atomicWrite(md, gptToMarkdown(gpt));
            publishGeneration(root, [{ source: raw, target: portablePath(join(archive, "gpts", `${name}.json`)) }, { source: md, target: portablePath(join(archive, "gpts", `${name}.md`)) }]);
            report.gpts++;
          }
          const next = data.list?.cursor ?? data.cursor ?? data.next_cursor ?? null;
          if (!next) break;
          if (typeof next !== "string" || !items.length || cursors.has(next)) throw new Error("Invalid GPT cursor");
          cursors.add(next); cursor = next;
        }
      } catch (error) { issue("gpt", "", error); if (dependencies.signal?.aborted || error instanceof network.RateLimitStopError) throw error; }
    }
    let inventory = new Map();
    if (exportOptions.conversations !== false) {
      const discovered = await conversationInventory(api, token, projects, projectByConversation, projectRows, issue, report, text => emit("status", text));
      inventory = discovered.inventory; report.inventory = discovered.details; report.archived = report.inventory.archived;
      const missingLocal = [...local.keys()].filter(id => !inventory.has(id));
      if (missingLocal.length) issue("inventory-absence", "", `${missingLocal.length} local conversation(s) absent remotely; preserved without deletion inference`);
      const queue = selectConversations(inventory, exportOptions);
      report.total = queue.length;
      // Sequential publication bounds memory to one raw conversation and one
      // download. API pacing already serializes requests; concurrency is ignored.
      const alreadyPresent = queue.filter(item => local.has(item.id)).length;
      emit("resume_summary", { total: queue.length, alreadyPresent, newItems: queue.length - alreadyPresent });
      for (const item of queue) {
        dependencies.signal?.throwIfAborted();
        emit("current", { title: item.title || item.id, phase: local.has(item.id) ? "Checking local conversation and missing files" : "Downloading conversation" });
        let capturedRaw = null;
        try {
          const existing = local.get(item.id);
          const project = projectByConversation.get(item.id);
          const base = item.isArchived ? join(archive, "archived") : project ? join(archive, "projects", project.folderName) : archive;
          const fname = conversationName(item, keyFor("conversation", item.id));
          const targetJson = portablePath(join(base, "json", fname + ".json"));
          portablePath(join(base, "files", fname, "x".repeat(60)));
          const state = classifyResumeState(existing, item, targetJson);
          let convo;
          if (existing && !state.isUpdate) {
            try { convo = validateConversation(readJson(existing.path), item.id); }
            catch (error) { issue("local-json", item.id, error); }
          }
          if (!convo) convo = validateConversation(await api.apiGet(`conversation/${encodeURIComponent(item.id)}`, token), item.id);
          capturedRaw = convo;
          const stage = join(stageRoot, randomUUID()); mkdirSync(stage, { recursive: true });
          const files = join(stage, "files"); mkdirSync(files);
          const oldDir = existing ? join(existing.baseDir, "files", existing.fname) : null;
          const oldManifest = oldDir ? fileManifest(oldDir) : { files: {} };
          const refs = [...extractFileReferences(convo), ...extractSandboxReferences(convo)];
          const map = {}, manifest = { version: 3, files: {}, failed: {} }, used = new Set();
          for (const ref of refs) {
            report.totalFiles++;
            const old = oldDir ? storedFile(oldDir, oldManifest.files?.[ref.fileId]) : null;
            let result, retainedError = null, temp = join(stage, "download-" + randomUUID());
            const oldEntry = oldManifest.files?.[ref.fileId];
            if (old && !state.isUpdate && oldManifest.version === 3 && !oldManifest.failed?.[ref.fileId]) {
              result = { filename: old.name }; copyFileSync(old.path, temp);
            } else {
              try {
                result = ref.type === "sandbox" ? await fetchSandbox(ref, token, item.id, project?.gizmoId || null, temp) : await fetchFile(ref.fileId, token, ref.filename, null, null, item.id, temp);
                if (result.buffer) atomicWrite(temp, result.buffer);
                if (!existsSync(temp)) throw new Error("Download produced no file");
              } catch (error) {
                dependencies.signal?.throwIfAborted();
                if (dependencies.signal?.aborted || error instanceof network.RateLimitStopError) throw error;
                retainedError = api.redactSecrets(error.message);
                manifest.failed[ref.fileId] = { filename: ref.filename, error: retainedError, retained: Boolean(old) };
                report.failedFiles++; report.failedFileDetails.push(`${ref.filename}: ${retainedError}`); report.missingFiles.push({ filename: ref.filename, id: ref.fileId, conversationId: item.id, conversationTitle: item.title || item.id, projectId: project?.gizmoId || null, projectName: project?.name || null, retained: Boolean(old), error: retainedError }); issue("media", ref.fileId, error);
                if (!old) continue;
                result = { filename: old.name }; copyFileSync(old.path, temp);
              }
            }
            const name = deduplicateFilename(mediaName(result.filename || ref.filename), used);
            portablePath(join(base, "files", fname, name));
            const destination = join(files, name); renameSync(temp, destination);
            manifest.files[ref.fileId] = { name, size: statSync(destination).size, sha256: sha256(destination), status: retainedError ? "retained-after-error" : "available" };
            map[ref.fileId] = `../files/${fname}/${name}`;
          }
          atomicWrite(join(files, ".file-map.json"), JSON.stringify(manifest, null, 2));
          atomicWrite(join(stage, "raw.json"), JSON.stringify(convo, null, 2));
          const artifacts = [{ source: files, target: join(base, "files", fname) }];
          const retire = existing ? [join(existing.baseDir, "files", existing.fname), existing.path] : [];
          const viewSnapshots = new Map();
          for (const [kind, ext, render] of [["markdown", ".md", () => renderMarkdown(convo, map, exportOptions.markdown)], ["html", ".html", () => renderHtml(convo, map, [], fname)]]) {
            const oldPath = existing ? join(existing.baseDir, kind, existing.fname + ext) : null;
            const target = portablePath(join(base, kind, fname + ext));
            try {
              if (formats[kind]) {
                const path = join(stage, "derived" + ext);
                let content = render();
                if (kind === "markdown" && oldPath && existsSync(oldPath) && !state.isUpdate && !state.pathChanged) {
                  const previous = readFileSync(oldPath, "utf8");
                  const withoutExportTime = text => text.replace(/^\*\*Exported:\*\*[^\n]*\n/m, "");
                  if (withoutExportTime(previous) === withoutExportTime(content)) content = previous;
                }
                atomicWrite(path, content);
                artifacts.push({ source: path, target });
                if (oldPath) retire.push(oldPath);
              } else if (oldPath && existsSync(oldPath)) {
                // Disabled views keep their content. If current media changes,
                // rebase only local links to a retained media snapshot.
                let content = readFileSync(oldPath, "utf8");
                const originalContent = content;
                if (oldPath !== target) retire.push(oldPath);
                  // A disabled view may already be a snapshot from an earlier
                  // title. Carry the local file directories it actually links.
                  for (const match of originalContent.matchAll(/\.\.\/files\/([^/\r\n<>"]+)\//g)) {
                    let linkedName = match[1];
                    try { linkedName = decodeURIComponent(linkedName); } catch { /* legacy unencoded percent */ }
                    linkedName = linkedName.replace(/&amp;/g, "&");
                    if (basename(linkedName) !== linkedName || linkedName.includes("\\") || [".", ".."].includes(linkedName)) continue;
                    const oldFiles = inside(root, join(existing.baseDir, "files", linkedName));
                    if (!existsSync(oldFiles)) continue;
                    let carriedFiles = portablePath(join(base, "files", linkedName));
                    if (carriedFiles === join(base, "files", fname) &&
                        (!existsSync(join(oldFiles, ".file-map.json")) || sha256(join(oldFiles, ".file-map.json")) !== sha256(join(files, ".file-map.json")))) {
                      if (!viewSnapshots.has(oldFiles)) viewSnapshots.set(oldFiles, `view-${randomUUID()}`);
                      const snapshotName = viewSnapshots.get(oldFiles);
                      carriedFiles = portablePath(join(base, "files", snapshotName));
                      content = content.replaceAll(`../files/${match[1]}/`, `../files/${snapshotName}/`);
                    }
                    if (carriedFiles !== join(base, "files", fname)) artifacts.push({ source: oldFiles, target: carriedFiles });
                    const retiring = retire.indexOf(oldFiles);
                    if (carriedFiles === oldFiles && retiring >= 0) retire.splice(retiring, 1);
                  }
                let source = oldPath;
                if (content !== originalContent) { source = join(stage, "preserved" + ext); atomicWrite(source, content); }
                artifacts.push({ source, target });
              }
            } catch (error) { issue(kind, item.id, error); }
          }
          artifacts.push({ source: join(stage, "raw.json"), target: targetJson });
          publishGeneration(root, [...new Map(artifacts.map(a => [a.target, a])).values()], [...new Set(retire)], dependencies.publicationFault);
          if (!existing) report.succeeded++; else if (state.isUpdate) report.updated++; else report.skipped++;
          if (existing && existing.baseDir !== base) {
            if (item.isArchived) report.movedToArchived++;
            if (existing.state === "archived") report.restoredFromArchived++;
            if (existing.state === "deleted") report.restoredFromDeleted++;
          }
        } catch (error) {
          // A renderer/download/publication failure must not discard newly read
          // valid raw data. This retained copy is not a completed generation or
          // a resume key; the run remains partial and retries on the next run.
          if (capturedRaw) {
            try {
              const path = inside(root, workPath(root, "superseded", `unpublished-${runId}`, `${keyFor("conversation", item.id)}.json`));
              atomicWrite(path, JSON.stringify(capturedRaw, null, 2));
              report.retainedUnpublishedRaw ||= [];
              report.retainedUnpublishedRaw.push(path);
            } catch (storageError) { issue("raw-retention", item.id, storageError); }
          }
          report.failed++; report.failedTitles.push(item.title || item.id); issue("conversation", item.id, error);
          if (dependencies.signal?.aborted || error instanceof network.RateLimitStopError) throw error;
        }
        emit("progress", { current: report.succeeded + report.updated + report.skipped + report.failed, total: report.total, saved: alreadyPresent + report.succeeded, title: item.title || item.id });
      }
    }
  } catch (error) {
    report.cancelled = dependencies.signal?.aborted === true;
    report.rateLimited = error instanceof network.RateLimitStopError || api.getRateLimitState().stopped;
    report.rateLimitRetryAfter = error.retryAfter || api.getRateLimitState().retryAfter;
    issue(report.rateLimited ? "rate-limit" : "export", "", error);
    emit(report.rateLimited ? "rate_limited" : "error_msg", report.rateLimited ? { message: error.message, retryAfter: report.rateLimitRetryAfter } : `Export failed: ${api.redactSecrets(error.message)}`);
  } finally {
    if (recovered && formats.html) {
      // Also replace legacy unsafe HTML for existing/unselected local records.
      for (const record of collectLocalConversations(archive, { lean: true, onError: (path, e) => issue("local-json", path, e) })) {
        try {
          const convo = validateConversation(readJson(record.path), record.conversationId);
          const dir = join(record.baseDir, "files", record.fname), manifest = fileManifest(dir), map = {};
          for (const [id, entry] of Object.entries(manifest.files || {})) { const stored = storedFile(dir, entry); if (stored) map[id] = `../files/${record.fname}/${stored.name}`; }
          const path = join(stageRoot, `refresh-${randomUUID()}.html`);
          atomicWrite(path, renderHtml(convo, map, [], record.fname));
          publishGeneration(root, [{ source: path, target: portablePath(join(record.baseDir, "html", record.fname + ".html")) }]);
        } catch (error) { issue("html", record.conversationId, error); }
      }
    }
    if (recovered) {
      const localChats = buildLocalConversationIndex(archive, { lean: true });
      for (const project of projects.filter(project => Array.isArray(project.resources))) {
        try {
          const dir = join(archive, "projects", project.folderName);
          const summary = { conversations: project.conversations, resources: project.resources, localChats, dir };
          const md = join(stageRoot, `project-summary-${randomUUID()}.md`);
          const raw = md + ".json";
          atomicWrite(md, projectToMarkdown(project.gizmo, summary));
          atomicWrite(raw, JSON.stringify(project, null, 2));
          publishGeneration(root, [{ source: md, target: join(dir, "project-info.md") }, { source: raw, target: join(dir, "project-raw.json") }]);
        } catch (error) { issue("project-summary", project.gizmoId, error); }
      }
      try { (dependencies.generateExportIndex || generateExportIndex)(archive, projects, { html: formats.indexHtml, report }); }
      catch (error) { issue("index", "", error); }
    }
    api.configureRetry?.({ enabled: false, signal: undefined, onWait: undefined });
    stopAwake(); process.removeListener("SIGINT", onInterrupt); process.removeListener("SIGTERM", onTerminate);
    report.processed = report.succeeded + report.updated + report.skipped + report.failed;
    report.remaining = Math.max(0, report.total - report.processed);
    report.completedAt = new Date().toISOString();
    report.status = report.errors.length || report.remaining ? "partial" : "complete-within-requested-scope";
    if (bound) {
      try {
        const path = workPath(root, "logs", `export-report-${runId}.json`);
        atomicWrite(path, JSON.stringify(report, null, 2));
        atomicWrite(workPath(root, "archive-operation.json"), JSON.stringify({ runId, status: report.status }, null, 2));
        if (existsSync(stageRoot)) rmSync(inside(root, stageRoot), { recursive: true, force: true });
        await writeArchiveManifest(root, report);
      } catch (error) {
        issue("manifest", "", error); report.status = "partial";
        try {
          atomicWrite(workPath(root, "logs", `export-report-${runId}.json`), JSON.stringify(report, null, 2));
          atomicWrite(workPath(root, "archive-operation.json"), JSON.stringify({ runId, status: "partial-manifest-failure" }, null, 2));
        } catch { /* UI still receives the failure if storage is unavailable. */ }
      }
    }
    if (unlock) unlock();
    emit("done", report);
  }
  return report;
}
