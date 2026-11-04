import * as network from "./chatgpt-api.js";
import { conversationInventory, selectConversations } from "./export-inventory.js";
import { filterSelectedProjects } from "./project-selection.js";

// Read-only metadata enumeration. No archive lock, key allocation or full-chat
// fetch. The export enumerates again because the account may change meanwhile.
export async function previewExport(token, options, sendEvent = () => {}, dependencies = {}) {
  const api = { ...network, ...dependencies };
  const report = { operation: "preview", conversations: 0, projects: 0, gpts: 0, errors: [], snapshotAt: new Date().toISOString() };
  const issue = (category, id, error) => report.errors.push({ category, id, message: api.redactSecrets(String(error?.message || error)) });
  const status = text => sendEvent("status", text);
  try {
    api.resetRateLimiter(); api.setApiWorkspace(options.identity.workspaceId);
    api.configureRetry?.({ enabled: true, signal: dependencies.signal, onWait: data => sendEvent("retry_wait", JSON.stringify(data)) });
    status("Reading project list…");
    const projects = options.projects !== false || options.conversations !== false ? await api.fetchProjectsInventory(token) : [];
    report.projects = options.projects === false ? 0 : filterSelectedProjects(projects, options.selectedProjectIds).length;
    const byConversation = new Map(), rows = [];
    if (options.conversations !== false) {
      for (const project of projects) {
        let cursor = null;
        const seen = new Set();
        for (let page = 0; ; page++) {
          if (page >= 10000) throw new Error("Project pagination limit");
          status(`Reading project conversations: ${projects.indexOf(project) + 1} of ${projects.length}, page ${page + 1}…`);
          const data = await api.apiGet(`gizmos/${project.gizmoId}/conversations?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, token);
          api.validateConversationInventory(data);
          for (const row of data.items) {
            if (byConversation.has(row.id)) throw new Error("Duplicate project conversation ID");
            byConversation.set(row.id, project);
            rows.push({ ...row, projectId: project.gizmoId, isArchived: row.is_archived === true });
          }
          const next = data.cursor ?? data.next_cursor ?? null;
          if (!next) break;
          if (typeof next !== "string" || !data.items.length || seen.has(next)) throw new Error("Invalid project cursor");
          seen.add(next); cursor = next;
        }
      }
      const discovered = await conversationInventory(api, token, projects, byConversation, rows, issue, {}, status);
      status("Counting conversations matching your selection…");
      report.conversations = selectConversations(discovered.inventory, options).length;
      report.inventory = discovered.details;
    }
    if (options.gpts !== false) {
      let cursor = null;
      const seen = new Set(), ids = new Set();
      for (let page = 0; ; page++) {
        if (page >= 10000) throw new Error("GPT pagination limit");
        status(`Reading GPT metadata: page ${page + 1}; ${ids.size} found so far…`);
        const data = await api.apiGetPublic(`gizmos/discovery/mine?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, token);
        const items = data.list?.items ?? data.items;
        if (!Array.isArray(items)) throw new Error("Invalid GPT inventory");
        for (const item of items) {
          const id = (item.resource?.gizmo || item.gizmo || item).id;
          if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || ids.has(id)) throw new Error("Invalid or duplicate GPT ID");
          ids.add(id);
        }
        const next = data.list?.cursor ?? data.cursor ?? data.next_cursor ?? null;
        if (!next) break;
        if (typeof next !== "string" || !items.length || seen.has(next)) throw new Error("Invalid GPT cursor");
        seen.add(next); cursor = next;
      }
      report.gpts = ids.size;
    }
  } catch (error) { issue("preview", "", error); }
  finally { api.configureRetry?.({ enabled: false, signal: undefined, onWait: undefined }); }
  report.status = report.errors.length ? "partial" : "complete-within-requested-scope";
  sendEvent("done", JSON.stringify(report));
  return report;
}
