import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApiClient } from "../lib/chatgpt-api.js";
import { downloadFile, downloadSandboxFile } from "../lib/export-files.js";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { markdownToSafeHtml, escapeHtml } from "../lib/safe-markdown.js";
import { fixture, allFiles } from "./export-fixtures.mjs";

const privateMarker = "PRIVATE_DIAGNOSTIC_MARKER";
function transport(reply) {
  const calls = [];
  const origin = "https://synthetic.invalid";
  const client = createApiClient({ apiBase: origin + "/api", testOrigins: [origin], minIntervalMs: 0,
    sleep: async () => {}, fetch: async url => {
      calls.push(new URL(url).pathname);
      const [status, data] = reply(calls.length);
      return new Response(JSON.stringify(data), { status });
    } });
  return { calls, client };
}
const secretBody = { note: privateMarker, signed_url_for_debug: "https://example.invalid/" + privateMarker };
test("file reports classify only verified causes and do not repeat private diagnostics", async () => {
  for (const [status, data, reason] of [
    [200, { error_type: "unexpected", ...secretBody }, "missing-address"],
    [200, { error_message: "Not allowed to download files.", ...secretBody }, "access-denied"],
    [200, { error_code: "file_not_found", ...secretBody }, "not-found"],
    [200, { error_code: "not_found", error_message: "Access denied" }, "unknown"],
    [403, secretBody, "access-denied"], [401, secretBody, "authentication"],
    [404, secretBody, "not-found"], [500, secretBody, "server-error"], [400, secretBody, "unknown"],
  ]) {
    const f = fixture();
    try {
      const { client, calls } = transport(() => [status, data]);
      const events = [];
      const report = await f.run({ organizeFolders: true }, {
        downloadFile: (...args) => downloadFile(...args.slice(0, 3), msg => events.push(msg), ...args.slice(4), client),
      });
      assert.equal(report.succeeded, 1);
      assert.equal(report.failed, 0);
      assert.equal(report.failedFiles, 1);
      assert.equal(report.missingFiles[0].reason, reason);
      assert.equal(report.errors[0].message, report.missingFiles[0].error);
      const summary = readFileSync(join(f.root, "archive", "missing-files.md"), "utf8");
      assert.ok(summary.includes(report.missingFiles[0].error));
      const stored = allFiles(f.root).filter(p => p.includes("export-report-") || p.endsWith(".file-map.json"));
      assert.ok(stored.length >= 2);
      for (const output of [JSON.stringify(report), summary, ...events, ...stored.map(p => readFileSync(p, "utf8"))]) {
        assert.ok(!output.includes(privateMarker) && !output.includes("example.invalid"));
      }
      if (reason === "access-denied" || reason === "authentication") assert.equal(calls.length, 1);
    } finally { f.cleanup(); }
  }
});

test("scope fallback can succeed, conflicting failed routes cannot prove a cause", async () => {
  const { client } = transport(i => [[200, {}], [200, { download_url: "https://synthetic.invalid/bytes" }], [200, "ok"]][i-1]);
  const file = await downloadFile("file-a", "FAKE", "data.txt", null, null, "chat", null, client);
  assert.equal(file.buffer.toString(), '"ok"');
  const other = transport(i => i === 1 ? [500, {}] : [404, {}]);
  await assert.rejects(downloadFile("file-a", "FAKE", "data.txt", null, null, "chat", null, other.client), {reason:"unknown"});
});

test("sandbox diagnostics discard raw HTTP bodies and metadata, including binary failures", async () => {
  const ref = { sandboxPath: "sandbox:/mnt/data/test.csv", messageIds: ["msg"] };
  for (const [status, meta, reason] of [[404, secretBody, "not-found"], [500,secretBody,"server-error"], [200,secretBody,"missing-address"], [200,{error_message:"Not allowed to download files."},"access-denied"], [200,{ download_url:"https://synthetic.invalid/file" }, "not-found"]]) {
    const client = { pacedChatGptFetch: fn => fn(), debugFetch: async () => new Response(JSON.stringify(meta), {status}),
      apiFetchBinary: async () => { throw Object.assign(new Error(privateMarker), {httpStatus:404}); } };
    await assert.rejects(downloadSandboxFile(ref, "FAKE", "chat", null, null, client), error =>
      error.reason === reason && !error.message.includes(privateMarker));
  }
});

test("repeated project refresh saves metadata and membership, retries missing files and retains previous bytes", async () => {
  const f = fixture();
  try {
    const chat = f.state.conversations[0];
    f.state.projects = [{gizmoId:"g-p-example", name:"Project", gizmo:{ display:{name:"Project",icon:"metadata-only"} },
      files:[{id:"file-resource",name:"Project image.png"}], conversations:[{id:chat.conversation_id,title:chat.title,create_time:1,update_time:10}]}];
    let attempt = 0;
    const download = async (id, ...args) => {
      if (id !== "file-resource") return f.deps.downloadFile(id,...args);
      attempt++;
      if (attempt === 2) throw Object.assign(new Error(privateMarker), {httpStatus:503});
      writeFileSync(args.at(-1), "synthetic image " + attempt);
      return {filename:"Project image.png"};
    };
    const options = {organizeFolders:true};
    const first = await f.run(options,{downloadFile:download});
    assert.equal(first.projects,1); assert.equal(first.succeeded,1);
    f.state.calls.length = 0;
    f.state.projects[0].gizmo.instructions = "Revised on second run";
    const second = await f.run(options,{downloadFile:download});
    assert.equal(second.projects,1); assert.equal(second.skipped,1); assert.equal(second.failed,0);
    assert.equal(second.failedFiles,1);
    assert.equal(second.missingFiles[0].retained,true);
    assert.equal(second.missingFiles[0].reason,"server-error");
    assert.equal(f.state.calls.some(p=>p.startsWith("conversation/")),false);
    const files = allFiles(join(f.root,"archive","projects"));
    const info = readFileSync(files.find(p=>p.endsWith("project-info.md")),"utf8");
    assert.match(info,/Revised on second run/); assert.match(info,/Locally saved conversations: 1/);
    assert.match(info,/previous local copy retained/); assert.match(info,/icon is recorded as metadata/);
    assert.equal(JSON.parse(readFileSync(files.find(p=>p.endsWith("project-raw.json")))).gizmo.display.icon,"metadata-only");
    const png = files.filter(p=>p.endsWith(".png")); assert.equal(png.length,1);
    assert.equal(readFileSync(png[0],"utf8"),"synthetic image 1");
    const third = await f.run(options,{downloadFile:download});
    assert.equal(third.failedFiles,0); assert.equal(attempt,3); assert.equal(readFileSync(png[0],"utf8"),"synthetic image 3");
  } finally { f.cleanup(); }
});

test("raw JSON, Markdown and offline HTML preserve inline and multiline TeX literally", async () => {
  const f=fixture(); try {
    const inline = String.raw`\(a_{i}=\frac{1}{2}\)`;
    const display = String.raw`\[
\begin{aligned}
a &< b \\
c &= d
\end{aligned}
\]`;
    const text = "Before " + inline + " and after.\n\n" + display;
    f.state.conversations[0].mapping.answer.message.content.parts=[text];
    const r=await f.run(); assert.equal(r.failed,0);
    const record=collectLocalConversations(f.root)[0];
    assert.equal(JSON.parse(readFileSync(record.path)).mapping.answer.message.content.parts[0],text);
    assert.ok(readFileSync(join(record.baseDir,"markdown",record.fname+".md"),"utf8").includes(text));
    const html=readFileSync(join(record.baseDir,"html",record.fname+".html"),"utf8");
    assert.ok(html.includes(escapeHtml(inline))); assert.ok(html.includes(escapeHtml(display)));
    assert.match(markdownToSafeHtml("**bold** and $x_1+x_2$"), /<strong>bold<\/strong> and <code class="math-source">\$x_1\+x_2\$<\/code>/);
    assert.ok(!markdownToSafeHtml("Costs $5 and $10.").includes("math-source"));
    assert.ok(!markdownToSafeHtml("`\\(x\\)`").includes("math-source"));
    assert.ok(!markdownToSafeHtml("$<img src=x>$").includes("<img"));
  } finally { f.cleanup(); }
});
