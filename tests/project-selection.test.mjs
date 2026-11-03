import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { filterSelectedProjects, normalizeSelectedProjectIds, conversationMatchesProjectSelection } from "../lib/project-selection.js";
import { fixture, conversation } from "./export-fixtures.mjs";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { projectFolder } from "../lib/export-runner.js";

test("project filtering preserves default/all/none and root conversation semantics", () => {
  const projects = [{ gizmoId: "g-p-a" }, { gizmoId: "g-p-b" }];
  assert.equal(normalizeSelectedProjectIds(undefined), null);
  assert.equal(normalizeSelectedProjectIds(null), null);
  assert.equal(normalizeSelectedProjectIds([]).size, 0);
  assert.deepEqual(filterSelectedProjects(projects, null), projects);
  assert.deepEqual(filterSelectedProjects(projects, ["g-p-b"]), [projects[1]]);
  assert.deepEqual(filterSelectedProjects(projects, []), []);
  assert.equal(conversationMatchesProjectSelection({ id: "root" }, new Set()), true);
  assert.equal(conversationMatchesProjectSelection({ projectId: "g-p-a" }, ["g-p-a"]), true);
  assert.equal(conversationMatchesProjectSelection({ projectId: "g-p-a" }, ["g-p-b"]), false);
});

test("selection inventories every project but exports selected metadata and conversations only", async () => {
  const f = fixture(); try {
    const a = conversation("project-a", "Alpha"), b = conversation("project-b", "Beta");
    const p1 = { gizmoId: "g-p-one", name: "Same Name", gizmo: { name: "Same Name" }, files: [], conversations: [{ id: a.conversation_id, title: a.title, create_time: 1, update_time: 10 }] };
    const p2 = { ...p1, gizmoId: "g-p-two", conversations: [{ id: b.conversation_id, title: b.title, create_time: 1, update_time: 10 }] };
    f.state.projects = [p1, p2]; f.state.conversations.push(a, b);
    const report = await f.run({ selectedProjectIds: ["g-p-two"] });
    assert.equal(report.projects, 1);
    assert.ok(f.state.calls.some(p => p.startsWith("gizmos/g-p-one/")));
    assert.ok(f.state.calls.some(p => p.startsWith("gizmos/g-p-two/")));
    assert.equal(collectLocalConversations(f.root).length, 2);
    assert.equal(existsSync(join(f.root, "projects", projectFolder(p1), "project-info.md")), false);
    assert.equal(existsSync(join(f.root, "projects", projectFolder(p2), "project-info.md")), true);
    assert.notEqual(projectFolder(p1).toLowerCase(), projectFolder(p2).toLowerCase());
    await f.run(); assert.equal(collectLocalConversations(f.root).length, 3);
    await f.run({ selectedProjectIds: [] }); assert.equal(collectLocalConversations(f.root).length, 3);
  } finally { f.cleanup(); }
});

test("incomplete project mapping blocks conversation publication and preserves selected scope", async () => {
  const f = fixture(); try {
    const c = conversation("project-private", "Private");
    f.state.projects = [{ gizmoId: "g-p-private", name: "Private", gizmo: { name: "Private" }, files: [], conversations: [{ id: c.conversation_id, title: c.title, create_time: 1, update_time: 10 }] }];
    f.state.conversations = [c]; await f.run();
    const before = collectLocalConversations(f.root)[0];
    const original = f.deps.apiGet;
    const report = await f.run({ selectedProjectIds: [] }, { apiGet: async path => { if (path.startsWith("gizmos/")) throw new Error("synthetic incomplete project"); return original(path); } });
    assert.equal(report.status, "partial"); assert.equal(report.total, 0);
    assert.equal(collectLocalConversations(f.root)[0].path, before.path);
  } finally { f.cleanup(); }
});
