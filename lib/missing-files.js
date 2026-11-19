import { escapeHtml } from "./safe-markdown.js";
import { fileRecoveryCategory } from "./file-failure.js";
import { existsSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inside } from "./archive-store.js";

export function collectRecoveryFiles(root, records, report) {
  const files = new Map();
  const key = file => JSON.stringify([file.conversationId || file.projectId || "", file.id || file.filename]);
  const add = file => files.set(key(file), file);
  const projects = new Map();
  const directory = inside(root, join(root, "projects"));
  if (existsSync(directory)) for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rawPath = inside(root, join(directory, entry.name, "project-raw.json"));
    if (!existsSync(rawPath)) continue;
    const project = JSON.parse(readFileSync(rawPath, "utf8"));
    projects.set(entry.name, project);
    for (const resource of project.resources || []) {
      if (resource.available !== false) continue;
      add({ id: resource.id, filename: resource.filename, projectId: project.gizmoId,
        projectName: project.name, reason: resource.reason || "unknown", attempts: resource.attempts,
        error: resource.error || "Resource has not been checked.", retained: Boolean(resource.retained), checkedThisRun: false });
    }
  }
  for (const record of records) {
    const path = inside(root, join(record.baseDir, "files", record.fname, ".file-map.json"));
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const project = projects.get(record.projectName);
    for (const [id, entry] of Object.entries(manifest.failed || {})) {
      const failure = entry || {};
      add({ id, filename: failure.filename || manifest.files?.[id]?.name || id, reason: failure.reason, error: failure.error,
        attempts: failure.attempts, retained: Boolean(failure.retained), conversationId: record.conversationId,
        conversationTitle: record.convo.title, projectId: record.convo.gizmo_id || manifest.projectId || project?.gizmoId,
        projectName: project?.name || manifest.projectName || record.projectName, checkedThisRun: false });
    }
  }
  // Include failed attempts which could not be published into the archive.
  for (const file of report.missingFiles || []) add({ ...file, checkedThisRun: true });
  mkdirSync(inside(root, join(root, "manual-downloads")), { recursive: true });
  return [...files.values()];
}

const categories = {
  browser: {
    title: "Download in your browser",
    text: "ChatGPT supplied an address, but the file content endpoint rejected the exporter's authentication (HTTP 401). Sign in to the same ChatGPT account and workspace. Open the linked chat or project, find the filename listed below and download the attachment there.",
  },
  unavailable: {
    title: "Possibly no longer available",
    text: "At least one ChatGPT lookup reported that the file was not found. Check the original chat or project. This result alone does not prove deletion.",
  },
  unknown: {
    title: "Other or unresolved download problems",
    text: "The recorded results do not establish a single cause. Check the original chat or project. A temporary server or connection problem may require retrying the export.",
  },
};

function sourceLinks(file) {
  const links = {};
  if (typeof file.conversationId === "string" && /^[A-Za-z0-9_-]+$/.test(file.conversationId)) {
    links.chat = "https://chatgpt.com/c/" + encodeURIComponent(file.conversationId);
  }
  if (typeof file.projectId === "string" && /^g-p-[A-Za-z0-9_-]+$/.test(file.projectId)) {
    links.project = "https://chatgpt.com/g/" + encodeURIComponent(file.projectId) + "/project";
  }
  return links;
}

export function missingFilesDocuments(files, report = {}) {
  const e = escapeHtml;
  // Code spans preserve filenames and prevent GFM autolinks and injected markup.
  const markdownText = value => {
    const text = String(value).replace(/[\r\n]/g, " ");
    const longest = (text.match(/`+/g) || []).reduce((length, run) => Math.max(length, run.length), 0);
    const fence = "`".repeat(longest + 1);
    return fence + " " + text + " " + fence;
  };
  const link = (url, label) => `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${e(label)}</a>`;
  let html = "";
  const scope = `Last run processed ${(report.succeeded || 0) + (report.updated || 0) + (report.skipped || 0) + (report.failed || 0)} of ${report.total || 0} conversations.` +
    (report.settings?.dateFrom || report.settings?.dateTo ? ` Date filter (UTC) from ${report.settings.dateFrom || "any"} to ${report.settings.dateTo || "any"}.` : "") +
    (report.settings?.selectedProjectIds ? " Project selection was restricted." : "") +
    (report.cancelled || report.rateLimited ? " The last run stopped early." : "");
  const introduction = `${files.length} unresolved file references recorded in the local archive and latest run. The list includes earlier failures in chats or projects outside the latest selection. Coverage depends on which items have been exported and checked so far. ${scope} Sign in to the matching ChatGPT account and workspace before opening the links.`;
  const manual = "Save manually recovered files in manual-downloads/ beside this report. Create project and chat subfolders there as needed. Include this folder when archiving. The exporter replaces its managed files/, resources/ and html/ folders during later runs. Manual downloads are not automatically linked or marked as resolved.";
  let markdown = "# Files to check\n\n" + introduction + "\n\n" + manual + "\n\n";
  for (const [category, description] of Object.entries(categories)) {
    const selected = files.filter(f => fileRecoveryCategory(f) === category);
    if (!selected.length) continue;
    html += `<section class="${category}"><h2>${e(description.title)} (${selected.length})</h2><p>${e(description.text)}</p>`;
    markdown += `## ${description.title} (${selected.length})\n\n${description.text}\n\n`;
    const projects = new Map();
    for (const file of selected) {
      const key = file.projectId || "";
      if (!projects.has(key)) projects.set(key, []);
      projects.get(key).push(file);
    }
    for (const group of projects.values()) {
      const name = group[0].projectName || "Conversations outside projects";
      html += `<h3>${e(name)}</h3>`;
      markdown += `### ${markdownText(name)}\n\n`;
      const chats = new Map();
      for (const file of group) {
        const key = file.conversationId || "";
        if (!chats.has(key)) chats.set(key, []);
        chats.get(key).push(file);
      }
      for (const chatFiles of chats.values()) {
        const title = chatFiles[0].conversationTitle || "Project resources";
        html += `<h4>${e(title)}</h4><ul>`;
        markdown += `#### ${markdownText(title)}\n\n`;
        for (const file of chatFiles) {
          const urls = sourceLinks(file);
          const filename = String(file.filename || "Unnamed file");
          const origin = urls.chat ? link(urls.chat, "Open original chat") : urls.project ? link(urls.project, "Open original project") : "";
          const note = urls.chat ? "Find this filename in the original chat, open the attachment and choose Download."
            : urls.project ? "Find this filename in the original project's resources and download it there."
              : "Find this filename in ChatGPT and download it there. The original location could not be determined.";
          const observation = category === "browser" ? "The file content request returned HTTP 401. Later fallback errors do not change this observation." : file.error || "Cause unknown.";
          html += `<li><strong>${e(filename)}</strong> ${origin ? " · " + origin : ""}<p>${e(note)}${file.retained ? " A previous local copy was retained." : ""}</p><p class="observation">${e(observation)}</p>`;
          const mdLabel = markdownText(filename);
          const checked = file.checkedThisRun === false ? "Recorded earlier; not reported as a failed attempt in the latest run." : "";
          html += (checked ? `<p class="observation">${checked}</p>` : "") + "</li>";
          markdown += `- **${mdLabel}**${urls.chat ? " · [Open original chat](" + urls.chat + ")" : urls.project ? " · [Open original project](" + urls.project + ")" : ""}\n  ${note} ${markdownText(observation)}${file.retained ? " (previous local copy retained)" : ""} ${checked}\n`;
        }
        html += "</ul>";
        markdown += "\n";
      }
    }
    html += "</section>";
  }
  return {
    markdown,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>Files to check</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#172033;background:#f7f9fc}section{padding:20px 28px;margin:24px 0;background:white;border-left:5px solid #b7791f;border-radius:8px}.browser{border-color:#2563eb}h2,h3,h4{line-height:1.3}li{margin-bottom:22px}li p{margin:6px 0}a{color:#174db3;overflow-wrap:anywhere}.observation{color:#576174;font-size:.9em}</style></head><body><h1>Files to check</h1><p>${e(introduction)}</p><p>${e(manual)}</p>${html || "<p>No unresolved file references are recorded.</p>"}</body></html>`,
  };
}
