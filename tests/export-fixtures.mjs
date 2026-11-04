import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExport } from "../lib/export-runner.js";
export const identity = { userId: "synthetic-user", workspaceId: "synthetic-workspace" };
export function conversation(id = "sameprefix-one", title = "Q&A Ä # %", time = 10) {
  return { conversation_id: id, title, create_time: 1, update_time: time, current_node: "answer", mapping: {
    root: { id: "root", parent: null, children: ["question"], message: null },
    question: { id: "question", parent: "root", children: ["answer"], message: { id: "question", author: { role: "user" }, content: { content_type: "text", parts: ["Question"] }, metadata: { attachments: [{ id: "file-one", name: "Report # %.txt" }] } } },
    answer: { id: "answer", parent: "question", children: [], message: { id: "answer", author: { role: "assistant" }, content: { content_type: "text", parts: ["Assistant answer"] }, metadata: {} } },
  } };
}
export function fixture({ shortRoot = false } = {}) {
  // Maximum-name success cases need a short archive destination on macOS too;
  // its per-user temporary directory alone can consume 80 path characters.
  const temp = shortRoot && process.platform === "darwin" ? "/tmp" : tmpdir();
  const root = realpathSync.native(mkdtempSync(join(temp, "cge-integration-")));
  const state = { conversations: [conversation()], archived: [], projects: [], fileError: null, calls: [], inventoryOverride: null, gpts: [] };
  const deps = {
    resetRateLimiter() {}, setApiWorkspace() {}, getRateLimitState() { return { stopped: false }; },
    fetchProjectsInventory: async () => state.projects,
    apiGetPublic: async () => ({ items: state.gpts }),
    apiGet: async (path) => {
      state.calls.push(path);
      if (path.startsWith("conversations?")) {
        if (state.inventoryOverride) return state.inventoryOverride;
        const rows = path.includes("is_archived=true") ? state.archived : state.conversations;
        const params = new URL(path, "https://synthetic.invalid/").searchParams;
        const offset = Number(params.get("offset") || 0), limit = Number(params.get("limit") || 100);
        return { total: rows.length, offset, items: rows.slice(offset, offset + limit).map(c => ({ id: c.conversation_id, title: c.title, create_time: c.create_time, update_time: c.update_time })) };
      }
      if (path.startsWith("gizmos/")) { const project = state.projects.find(p => path.includes(p.gizmoId)); return { items: project.conversations || [] }; }
      const id = path.split("/").pop();
      const c = [...state.conversations, ...state.archived].find(c => c.conversation_id === id);
      if (!c) throw new Error("HTTP 404"); return c;
    },
    downloadFile: async (_id, _token, _fallback, _debug, _project, _conversation, destination) => {
      if (state.fileError) throw state.fileError;
      writeFileSync(destination, "synthetic original bytes");
      return { filename: "Report # %.txt" };
    },
  };
  const run = async (options = {}, extra = {}) => { const report = await runExport("FAKE-TOKEN", root, 3, false, false, { identity, gpts: false, ...options }, () => {}, { ...deps, ...extra }); if(process.env.CI && report.status === "partial") console.log("SYNTHETIC_REPORT", JSON.stringify({errors:report.errors, output:report.output})); return report; };
  return { root, state, deps, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
export function allFiles(root) {
  const result = [];
  function walk(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else result.push(path); } }
  walk(root); return result;
}
