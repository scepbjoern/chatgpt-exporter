import { existsSync } from "node:fs";
import { join, relative } from "node:path";

// ── Project markdown converter ───────────────────────────────────────

export function projectToMarkdown(proj, summary = null) {
  const name         = proj.display?.name        || proj.name        || proj.title || "Untitled Project";
  const description  = proj.display?.description || proj.description || "";
  const instructions = proj.instructions || proj.system_prompt || "";
  const createdRaw   = proj.created_at;
  let created = "";
  if (createdRaw) {
    try {
      const d = typeof createdRaw === "number"
        ? new Date(createdRaw > 1e10 ? createdRaw : createdRaw * 1000)
        : new Date(createdRaw);
      created = isNaN(d) ? "" : d.toISOString().slice(0, 10);
    } catch { /* ignore */ }
  }
  let md = `# ${name}\n\n`;
  if (description)  md += `**Description:** ${description}\n\n`;
  if (created)      md += `**Created:** ${created}\n\n`;
  if (instructions) md += `## Instructions\n\n${instructions}\n\n`;
  if (summary) {
    const label = value => String(value).replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]/g, " ");
    const url = value => value.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
    md += `## Conversations\n\nReferenced: ${summary.conversations === null ? "unknown (inventory failed)" : summary.conversations.length}.\n\n`;
    let saved = 0;
    for (const chat of summary.conversations || []) {
      const record = summary.localChats.get(chat.id);
      const target = record && join(record.baseDir, "markdown", record.fname + ".md");
      const raw = record?.path;
      if (record) saved++;
      const localPath = target && existsSync(target) ? target : raw;
      md += localPath ? `- [${label(chat.title || chat.id)}](${url(relative(summary.dir, localPath))})\n` : `- ${label(chat.title || chat.id)} — not exported locally\n`;
    }
    md += `\nLocally saved conversations: ${saved}.\n\n## Resources\n\nReferenced: ${summary.resources.length}; available in this run: ${summary.resources.filter(r => r.available).length}.\n\n`;
    if (proj.display?.icon || proj.display?.icon_url) {
      md += "The project display icon is recorded as metadata. Separate image files are listed below only when included in the resource inventory.\n\n";
    }
    for (const file of summary.resources) md += file.available
      ? `- [${label(file.filename)}](${url("resources/" + file.localName)})\n`
      : `- ${file.retained ? `[${label(file.filename)}](${url("resources/" + file.localName)}) (previous local copy retained)` : label(file.filename)} — unavailable. ${file.error || "Cause unknown."}\n`;
  }
  return md;
}

// ── GPT markdown converter ────────────────────────────────────────────

export function gptToMarkdown(gizmo) {
  const display  = gizmo.display || {};
  const name     = display.name        || gizmo.name || "Untitled GPT";
  const desc     = display.description || "";
  const starters = display.prompt_starters || [];
  const tools    = gizmo.tools || [];
  const createdRaw = gizmo.created_at;
  let created = "";
  if (createdRaw) {
    try {
      const d = typeof createdRaw === "number"
        ? new Date(createdRaw > 1e10 ? createdRaw : createdRaw * 1000)
        : new Date(createdRaw);
      created = isNaN(d) ? "" : d.toISOString().slice(0, 10);
    } catch { /* ignore */ }
  }
  const visibility = gizmo.visibility || display.visibility || "";

  let md = `# ${name}\n\n`;
  if (desc)       md += `**Description:** ${desc}\n\n`;
  if (created)    md += `**Created:** ${created}\n\n`;
  if (visibility) md += `**Visibility:** ${visibility}\n\n`;

  if (gizmo.instructions) {
    md += `## Instructions\n\n${gizmo.instructions}\n\n`;
  }

  if (starters.length) {
    md += `## Conversation Starters\n\n`;
    for (const s of starters) md += `- ${s}\n`;
    md += "\n";
  }

  if (tools.length) {
    md += `## Tools\n\n`;
    for (const t of tools) md += `- ${t.type || t.name || JSON.stringify(t)}\n`;
    md += "\n";
  }

  return md;
}

