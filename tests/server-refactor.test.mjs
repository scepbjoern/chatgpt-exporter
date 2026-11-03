import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

test("importing the server has no listening or browser-launch side effect", async () => {
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", "import { createExporterServer } from './server.js'; const {server}=createExporterServer(); if(server.listening) throw new Error('unexpected listener'); console.log('import completed');"], { cwd: fileURLToPath(new URL("..", import.meta.url)), timeout: 5000 });
  assert.equal(result.stdout.trim(), "import completed");
  assert.equal(result.stderr, "");
});
