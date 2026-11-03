import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fixture } from "./export-fixtures.mjs";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { sha256 } from "../lib/archive-store.js";

test("actual process exit between published artifacts is recovered on the next run", async () => {
  const f = fixture(); try {
    await f.run(); const record = collectLocalConversations(f.root)[0], before = sha256(record.path);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { fixture, conversation, identity } from './tests/export-fixtures.mjs';
      import { runExport } from './lib/export-runner.js';
      const f = fixture();
      f.state.conversations = [conversation('sameprefix-one', 'Q&A Ä # %', 20)];
      await runExport('FAKE', process.argv[1], 1, false, false, {identity,gpts:false}, ()=>{}, {...f.deps, publicationFault(i){if(i===1) process.exit(73);}});
    `, f.root], { encoding: "utf8" });
    assert.equal(child.status, 73, child.stderr);
    const report = await f.run(); assert.equal(report.recoveredTransactions.length, 1);
    assert.equal(sha256(record.path), before);
    assert.match(readFileSync(record.path, "utf8"), /sameprefix-one/);
  } finally { f.cleanup(); }
});

test("two stale-lock reclaimers cannot both hold the archive lock", async () => {
  const { spawn } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const f = fixture(), children = [];
  try {
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    writeFileSync(join(f.root, ".export-lock"), JSON.stringify({ pid: dead.pid }));
    const script = `import {lockArchive} from './lib/archive-store.js';try{const release=lockArchive(process.argv[1]);console.log('acquired');process.stdin.once('data',()=>{release();process.exit(0)});}catch{console.log('denied');process.exit(2)}`;
    const launch = () => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, f.root], { stdio: ["pipe", "pipe", "pipe"] }); children.push(child);
      const ready = new Promise((resolve, reject) => { child.stdout.once("data", data => resolve(String(data).trim())); child.once("error", reject); });
      const exited = new Promise(resolve => child.once("exit", resolve));
      return { child, ready, exited };
    };
    const a = launch(), b = launch();
    const results = await Promise.all([a.ready, b.ready]);
    assert.deepEqual([...results].sort(), ["acquired", "denied"]);
    for (const [index, job] of [a, b].entries()) if (results[index] === "acquired") job.child.stdin.end("release");
    assert.deepEqual((await Promise.all([a.exited, b.exited])).sort(), [0, 2]);
  } finally { for (const child of children) if (child.exitCode === null) child.kill(); f.cleanup(); }
});
