import { escapeHtml } from "./safe-markdown.js";
import { fileRecoveryCategory } from "./file-failure.js";

const categories = {
  browser: {
    title: "Download in your browser",
    text: "ChatGPT supplied an address, but the file content endpoint rejected the exporter's authentication (HTTP 401). Sign in to the same ChatGPT account and workspace. Open the original chat, find the filename listed below and download the attachment there.",
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

export function missingFilesDocuments(files) {
  const e = escapeHtml;
  const markdownText = value => String(value).replace(/[\r\n]/g, " ")
    .replace(/[&<>]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character])
    .replace(/[\\`*_[\]#]/g, "\\$&");
  const link = (url, label) => `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${e(label)}</a>`;
  let html = "";
  let markdown = "# Files to check — latest export\n\n";
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
          html += `<li><strong>${e(filename)}</strong> ${origin ? " · " + origin : ""}<p>${e(note)}${file.retained ? " A previous local copy was retained." : ""}</p><p class="observation">${e(observation)}</p></li>`;
          const mdLabel = markdownText(filename);
          markdown += `- **${mdLabel}**${urls.chat ? " · [Open original chat](" + urls.chat + ")" : urls.project ? " · [Open original project](" + urls.project + ")" : ""}\n  ${note} ${observation}${file.retained ? " (previous local copy retained)" : ""}\n`;
        }
        html += "</ul>";
        markdown += "\n";
      }
    }
    html += "</section>";
  }
  return {
    markdown,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>Files to check</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#172033;background:#f7f9fc}section{padding:20px 28px;margin:24px 0;background:white;border-left:5px solid #b7791f;border-radius:8px}.browser{border-color:#2563eb}h2,h3,h4{line-height:1.3}li{margin-bottom:22px}li p{margin:6px 0}a{color:#174db3;overflow-wrap:anywhere}.observation{color:#576174;font-size:.9em}</style></head><body><h1>Files to check</h1><p>${files.length} failed references in the latest export. Sign in to the matching ChatGPT account and workspace before opening the links. Save recovered files into your archive. Review this list before archiving.</p>${html || "<p>No failed file references in this run.</p>"}</body></html>`,
  };
}
