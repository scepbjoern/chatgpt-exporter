import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, conversation } from "./export-fixtures.mjs";
import { collectLocalConversations } from "../lib/conversation-storage.js";

test("active to archived move preserves bytes, derivations and root navigation", async () => {
  const f = fixture(); try {
    await f.run(); const initial = collectLocalConversations(f.root)[0];
    f.state.archived = f.state.conversations; f.state.conversations = [];
    const report = await f.run(); assert.equal(report.movedToArchived, 1);
    const moved = collectLocalConversations(f.root)[0]; assert.equal(moved.state, "archived");
    assert.equal(existsSync(initial.path), false);
    assert.match(readFileSync(join(moved.baseDir, "markdown", moved.fname + ".md"), "utf8"), /Assistant answer/);
    assert.equal(readFileSync(join(moved.baseDir, "files", moved.fname, "Report # %.txt"), "utf8"), "synthetic original bytes");
    assert.match(readFileSync(join(f.root, "index.html"), "utf8"), /Archived/);
    f.state.archived = [];
    assert.equal((await f.run()).movedToDeleted, 0);
    assert.equal(collectLocalConversations(f.root)[0].state, "archived");
  } finally { f.cleanup(); }
});
