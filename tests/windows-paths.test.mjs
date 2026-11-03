import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture, identity } from "./export-fixtures.mjs";
import { runExport } from "../lib/export-runner.js";
import { collectLocalConversations } from "../lib/conversation-storage.js";

test("Windows short-path output alias resolves to one canonical archive across a state move", { skip: process.platform !== "win32" }, async () => {
  const f = fixture();
  try {
    // cmd is used only to read the OS short alias; all mutations stay in Node.
    const result = spawnSync("cmd.exe", ["/d", "/c", `for %I in ("${f.root}") do @echo %~sI`], { encoding: "utf8", windowsVerbatimArguments: true });
    assert.equal(result.status, 0, result.stderr);
    const alias = result.stdout.trim(); assert.ok(alias);
    const run = () => runExport("FAKE", alias, 1, false, false, { identity, gpts: false }, () => {}, f.deps);
    const first = await run(); assert.equal(first.output, realpathSync.native(f.root));
    f.state.archived = f.state.conversations; f.state.conversations = [];
    const second = await run(); assert.equal(second.status, "complete-within-requested-scope");
    const records = collectLocalConversations(f.root); assert.equal(records.length, 1); assert.equal(records[0].state, "archived");
    assert.equal(readFileSync(join(records[0].baseDir, "files", records[0].fname, "Report # %.txt"), "utf8"), "synthetic original bytes");
  } finally { f.cleanup(); }
});
