import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("lean index handles 2000 conversations containing 128 MiB of raw messages in a 64 MiB heap", () => {
  const root = mkdtempSync(join(tmpdir(), "cge-scale-"));
  try {
    mkdirSync(join(root, "json"));
    const text = "x".repeat(65536);
    for (let i = 0; i < 2000; i++) writeFileSync(join(root, "json", `${i}.json`), JSON.stringify({ conversation_id: `synthetic-${i}`, title: `Title ${i}`, update_time: i + 1, mapping: { text } }));
    const child = spawnSync(process.execPath, ["--max-old-space-size=64", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { buildLocalConversationIndex } from './lib/conversation-storage.js';
      const index=buildLocalConversationIndex(process.argv[1],{lean:true});
      assert.equal(index.size,2000);
      assert.ok([...index.values()].every(record=>!record.convo.mapping));
      assert.ok(JSON.stringify([...index.values()]).length<2000000);
    `, root], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
