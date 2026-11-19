import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApiClient, RateLimitStopError } from "../lib/chatgpt-api.js";
import { downloadFile, downloadSandboxFile } from "../lib/export-files.js";
import { collectLocalConversations } from "../lib/conversation-storage.js";
import { markdownToSafeHtml, escapeHtml } from "../lib/safe-markdown.js";
import { fixture, allFiles } from "./export-fixtures.mjs";
import { fileRecoveryCategory } from "../lib/file-failure.js";
import { missingFilesDocuments } from "../lib/missing-files.js";

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
test("project content failures link to the original chat and override later fallback classifications in recovery documents", async () => {
  const f = fixture();
  try {
    const chat = f.state.conversations[0];
    f.state.projects = [{ gizmoId: "g-p-example", name: "Project <unsafe>", conversations: [{ id: chat.conversation_id, title: chat.title }] }];
    const directUrl = "https://chatgpt.com/api/library/files/library-id/project-content?file_id=file-one&disposition=attachment";
    const client = createApiClient({ apiBase: "https://chatgpt.com/backend-api", testOrigins: ["https://chatgpt.com"], minIntervalMs: 0,
      fetch: async value => {
        const url = new URL(value);
        if (url.pathname.endsWith("/project-content")) return new Response(null, {status:401});
        if (url.search) return Response.json({download_url:directUrl});
        return new Response(null, {status:403});
      } });
    const report = await f.run({ projects: false, organizeFolders: true }, { downloadFile: (...args) => downloadFile(...args, client) });
    const failure = report.missingFiles[0];
    assert.equal(failure.reason, "access-denied");
    assert.equal(failure.recoveryCategory, "browser");
    assert.equal(failure.directUrl, undefined);
    const html = readFileSync(join(f.root, "archive", "missing-files.html"), "utf8");
    assert.ok(html.includes("Download in your browser (1)"));
    assert.ok(html.includes("Project &lt;unsafe&gt;"));
    assert.ok(html.includes("https://chatgpt.com/c/" + chat.conversation_id));
    assert.ok(!html.includes("/project-content?"));
    assert.ok(html.includes("Report # %.txt"));
    assert.ok(html.includes("find the filename listed below"));
    assert.ok(!html.includes("Access to this file was denied."));
    assert.ok(!html.includes("FAKE-TOKEN"));
    const empty = missingFilesDocuments([]);
    assert.ok(empty.html.includes("No failed file references"));
  } finally { f.cleanup(); }
});

test("recovery documents ignore legacy direct addresses and reject unsafe source identifiers", () => {
  for (const url of ["javascript:alert(1)", "https://chatgpt.com.evil.invalid/api/library/files/x/project-content",
    "https://x:secret@chatgpt.com/api/library/files/x/project-content",
    "https://chatgpt.com/api/library/files/x/project-content?token=PRIVATE",
    "https://example.blob.core.windows.net/file?sig=PRIVATE"]) {
    const documents = missingFilesDocuments([{filename:"<script>attack</script>",directUrl:url,conversationId:'"><script>attack</script>',projectId:"javascript:attack"}]);
    assert.ok(!documents.html.includes(url));
    assert.ok(!documents.html.includes("<script>attack</script>"));
    assert.ok(!documents.markdown.includes(url));
  }
  assert.equal(fileRecoveryCategory({reason:"not-found"}), "unavailable");
  assert.equal(fileRecoveryCategory({reason:"unknown",attempts:[
    {step:"request download address",httpStatus:200,outcome:"no download address"},
    {step:"request download address",httpStatus:404,outcome:"not-found"},
  ]}), "unavailable");
  assert.equal(fileRecoveryCategory({reason:"unknown",attempts:[{httpStatus:503},{httpStatus:404}]}), "unknown");
});
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
      assert.equal(report.missingFiles[0].attempts[0].httpStatus, status);
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

test("conversation-only export downloads a project chat attachment using its project context", async () => {
  const f = fixture();
  try {
    const chat = f.state.conversations[0];
    f.state.projects = [{ gizmoId: "g-p-example", name: "Project", conversations: [{ id: chat.conversation_id, title: chat.title }] }];
    const routes = [];
    const client = {
      async apiGet(route) {
        routes.push(route);
        return { download_url: "https://synthetic.invalid/test" };
      },
      async apiDownloadTo(url, token, destination) {
        writeFileSync(destination, "# Test attachment");
        return { contentType: "text/plain" };
      },
    };
    const report = await f.run({ projects: false, organizeFolders: true }, { downloadFile: (...args) => downloadFile(...args, client) });
    assert.deepEqual(routes, ["files/download/file-one?download_intent=true&gizmo_id=g-p-example"]);
    assert.equal(report.projects, 0);
    assert.equal(report.failedFiles, 0);
    assert.equal(report.totalFiles, 1);
    assert.ok(allFiles(f.root).some(path => path.endsWith(".txt") && readFileSync(path, "utf8") === "# Test attachment"));
  } finally { f.cleanup(); }
});

test("binary 401 diagnostics classify direct and redirected responses without recording private URLs", async () => {
  const origin = "https://chatgpt.com";
  const storage = "https://private-container.blob.core.windows.net";
  for (const redirected of [false, true]) {
    const client = createApiClient({ apiBase: origin + "/backend-api", testOrigins: [origin, storage], minIntervalMs: 0,
      fetch: async value => {
        const url = new URL(value);
        if (url.searchParams.has("gizmo_id")) return Response.json({ download_url: origin + "/api/library/files/PRIVATE/project-content?secret=PRIVATE" });
        if (url.pathname.endsWith("/project-content") && redirected) return Response.redirect(storage + "/PRIVATE?secret=PRIVATE", 302);
        return new Response(null, { status: url.pathname.startsWith("/backend-api/") ? 403 : 401 });
      } });
    await assert.rejects(downloadFile("file-a", "FAKE", "test.md", null, "project", "chat", null, client), error => {
      const bytes = error.attempts.find(attempt => attempt.step === "retrieve file bytes");
      const expected = [{ host: "chatgpt.com", endpoint: "project-content", httpStatus: redirected ? 302 : 401 }];
      if (redirected) expected.push({ host: "Azure Blob Storage", endpoint: "file host", httpStatus: 401 });
      assert.deepEqual(bytes.hops, expected);
      assert.equal(bytes.httpStatus, 401);
      assert.ok(!JSON.stringify(error.attempts).includes("PRIVATE"));
      return true;
    });
  }
});

test("scope fallback can succeed, conflicting failed routes cannot prove a cause", async () => {
  const { client } = transport(i => [[200, {}], [200, { download_url: "https://synthetic.invalid/bytes" }], [200, "ok"]][i-1]);
  const file = await downloadFile("file-a", "FAKE", "data.txt", null, null, "chat", null, client);
  assert.equal(file.buffer.toString(), '"ok"');
  const other = transport(i => i === 1 ? [500, {}] : [404, {}]);
  await assert.rejects(downloadFile("file-a", "FAKE", "data.txt", null, null, "chat", null, other.client), {reason:"unknown"});
});

test("preview diagnostics discard the preview address and report the download decision", async () => {
  const { client, calls } = transport(i => i === 1
    ? [200, { download_url: "https://synthetic.invalid/preview-only" }]
    : [200, { error_message: "Not allowed to download files." }]);
  await assert.rejects(downloadFile("file-a", "FAKE", "test.md", null, "project", "chat", null, client, true), error => {
    assert.equal(error.reason, "access-denied");
    assert.deepEqual(error.attempts.map(a => [a.route, a.httpStatus, a.outcome]), [
      ["project-chat preview download_intent=false", 200, "address received"],
      ["project-chat download_intent=true", 200, "no download address"],
    ]);
    return true;
  });
  assert.deepEqual(calls, ["/api/files/download/file-a", "/api/files/download/file-a"]);
  const denied = transport(() => [403, {}]);
  await assert.rejects(downloadFile("file-a", "FAKE", "test.md", null, "project", "chat", null, denied.client, true), { reason: "access-denied" });
  assert.equal(denied.calls.length, 1);
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

test("binary refusal retries another address; metadata denial remains terminal", async () => {
  const address = { download_url: "https://synthetic.invalid/asset" };
  for (const status of [401, 403]) {
    const available = transport(i => [[200,address],[status,secretBody],[200,address],[200,"bytes"]][i-1]);
    const file = await downloadFile("file-a","FAKE","data.txt",null,null,"chat",null,available.client);
    assert.equal(file.buffer.toString(), '"bytes"');
    assert.equal(available.calls.length,4);
    const rejected = transport(i => i % 2 ? [200,address] : [status,secretBody]);
    await assert.rejects(downloadFile("file-a","FAKE","data.txt",null,null,"chat",null,rejected.client), {reason:"download-link"});
    const denied = transport(i => [[200,address],[status,secretBody],[403,secretBody]][i-1]);
    await assert.rejects(downloadFile("file-a","FAKE","data.txt",null,null,"chat",null,denied.client), {reason:"access-denied"});
    assert.equal(denied.calls.length,3);
  }
});

test("project maps and links survive a rate limit and a subsequent failed download", async () => {
  const f=fixture(); try {
    const project = {gizmoId:"g-p-pilot", name:"Project", gizmo:{name:"Project"},
      conversations:[], files:[{id:"file-A",name:"A.png"},{id:"file-B",name:"B.png"}]};
    const run = downloadFile => {
      f.state.projects=[structuredClone(project)];
      return f.run({conversations:false,organizeFolders:true},{downloadFile});
    };
    const first=await run(async (_id,_token,filename,_debug,_project,_chat,destination) => {
      writeFileSync(destination,filename); return {filename};
    });
    assert.equal(first.projects,1);
    const projectFiles=allFiles(join(f.root,"archive","projects"));
    const raw=projectFiles.find(p=>p.endsWith("project-raw.json"));
    const expected=JSON.parse(readFileSync(raw)).resources.map(r=>r.localName);
    const interrupted=await run(async()=>{throw new RateLimitStopError("60");});
    assert.equal(interrupted.rateLimited,true);
    const saved=JSON.parse(readFileSync(raw)).resources;
    assert.deepEqual(saved.map(r=>r.localName),expected);
    assert.ok(saved.every(r=>r.retained && r.checked===false));
    const retry=await run(async()=>{throw Object.assign(new Error(privateMarker),{httpStatus:500});});
    assert.equal(retry.failedFiles,2);
    assert.ok(retry.missingFiles.every(m=>m.retained));
    const html=readFileSync(projectFiles.find(p=>p.endsWith("project-info.html")),"utf8");
    for(const name of expected) {
      assert.ok(html.includes('href="resources/'+name+'"'));
      assert.equal(readFileSync(projectFiles.find(p=>p.endsWith(name)),"utf8"),name[0]+".png");
    }
  } finally { f.cleanup(); }
});
