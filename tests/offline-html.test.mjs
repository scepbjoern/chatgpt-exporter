import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conversationToHtml } from "../lib/html-renderer.js";
import { generateExportIndex, extractHtmlTitle } from "../lib/export-index.js";
import { markdownToSafeHtml } from "../lib/safe-markdown.js";

const attacks = `<img src="https://example.invalid/leak" onerror="window.ATTACK=true">\n<svg onload="window.ATTACK=true"></svg>\n[x](javascript:alert%281%29)\n![remote](https://example.invalid/image.png)\n[bad](data:text/html,attack)\n[relative](../../outside.html)\n![svg](../files/active.svg)`;

export function syntheticConversation() {
  return {
    conversation_id: "synthetic-offline", title: "Überblick Q&A — 100% #1", create_time: 1700000000,
    mapping: {
      user: { parent: null, children: ["assistant"], message: { author: { role: "user" }, content: { content_type: "text", parts: ["Synthetic user"] }, metadata: { attachments: [{ id: "missing", name: "missing.txt" }, { id: "active", name: "active.svg" }] } } },
      assistant: { parent: "user", children: ["tool"], message: { author: { role: "assistant" }, content: { content_type: "text", parts: [`**Assistant readable**\n\n${attacks}\n\n![Local](../files/Über%20%23%25.png)\n[Original](../files/Über%20%23%25.png)`] } } },
      tool: { parent: "assistant", children: ["user"], message: { author: { role: "tool" }, content: { content_type: "execution_output", parts: ["Tool readable\n" + attacks] } } },
    },
  };
}

test("Markdown is pre-rendered with inert raw HTML and a restrictive URL policy", () => {
  const html = markdownToSafeHtml(attacks + '\n\n[external](https://example.invalid/explicit)\n\n```html\n<img onerror=attack>\n```');
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;svg"));
  assert.ok(!/<(?:img|svg|script)\b/.test(html));
  assert.ok(!/href="(?:javascript:|data:|\.\.\/\.\.\/outside)/.test(html));
  assert.ok(html.includes('href="https://example.invalid/explicit"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes("&lt;img onerror=attack&gt;"));
  for (const href of ["javascript:alert(1)", "jav&#x61;script:alert(1)", "javascript&#58;alert(1)", "javascript%3aalert(1)", "data:text/html,attack", "//example.invalid/a", "file:///secret"]) {
    assert.ok(!markdownToSafeHtml(`[x](<${href}>)`).includes("href="), href);
  }
});

test("Known local raster media and links preserve special characters; SVG is never embedded", () => {
  const paths = ["../files/Über #%.png", "../files/active.svg"];
  const html = markdownToSafeHtml('![Local](../files/Über%20%23%25.png)\n[Local](../files/Über%20%23%25.png)\n![active](../files/active.svg)', paths);
  assert.ok(html.includes('src="../files/%C3%9Cber%20%23%25.png"'));
  assert.ok(html.includes('href="../files/%C3%9Cber%20%23%25.png"'));
  assert.ok(!html.includes('src="../files/active.svg"'));
  for (const href of ["//example.invalid/p.png", "file:///secret.png", "https://example.invalid/p.png", "../unmapped.png"]) {
    assert.ok(!markdownToSafeHtml(`![x](${href})`, paths).includes("<img"));
  }
});

test("Assistant and tool text exist without JavaScript, cycles terminate, and originals are labelled", () => {
  const html = conversationToHtml(syntheticConversation(), { local: "../files/Über #%.png", active: "../files/active.svg" });
  assert.ok(html.includes("<strong>Assistant readable</strong>"));
  assert.ok(html.includes("Tool readable"));
  assert.ok(html.includes("missing.txt [unavailable]"));
  assert.ok(html.includes("original file; may contain active content"));
  assert.ok(!html.includes("data-md="));
  assert.ok(!/<script[^>]+src=|<link\b|<img[^>]+src="https?:/.test(html));
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("script-src &#39;none&#39;"));
  assert.ok(html.includes("default-src &#39;none&#39;"));
});

test("Index renders project info offline and decodes a long title exactly once", () => {
  const dir = mkdtempSync(join(tmpdir(), "exporter-html-"));
  try {
    for (const subdir of ["html", "projects/Project_stable/html", "projects/Project_stable/resources"]) mkdirSync(join(dir, subdir), { recursive: true });
    const convo = syntheticConversation();
    convo.title = "Ü".repeat(300) + " Q&A &#39;";
    writeFileSync(join(dir, "html/chat #%.html"), conversationToHtml(convo));
    writeFileSync(join(dir, "projects/Project_stable/project-info.md"), "# Project\n\n**Instructions**\n\n" + attacks);
    writeFileSync(join(dir, "projects/Project_stable/resources/original #%.html"), "synthetic original");
    generateExportIndex(dir, [{ name: "Project Q&A", folderName: "Project_stable" }]);
    const index = readFileSync(join(dir, "index.html"), "utf8");
    const info = readFileSync(join(dir, "projects/Project_stable/project-info.html"), "utf8");
    assert.equal(extractHtmlTitle(join(dir, "html/chat #%.html")), convo.title);
    assert.ok(index.includes("Q&amp;A &amp;#39;"));
    assert.ok(index.includes('href="html/chat%20%23%25.html"'));
    assert.ok(index.includes("project-info.html"));
    assert.ok(!index.includes("fetch("));
    assert.ok(!index.includes("onclick="));
    assert.ok(index.includes('sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"'));
    const script = index.match(/<script>([\s\S]*?)<\/script>/)[1];
    assert.ok(index.includes(`sha256-${createHash("sha256").update(script).digest("base64")}`));
    assert.ok(info.includes("<strong>Instructions</strong>"));
    assert.ok(!/<(?:img|svg)\b/.test(info));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Index excludes unsafe legacy pages and renderer markers quoted outside actual head metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "exporter-legacy-html-"));
  try {
    const quotedMarker = 'name="exporter-html-version" content="2"';
    for (const group of ["html", "archived/html", "deleted/html", "projects/Legacy/html"]) {
      mkdirSync(join(dir, group), { recursive: true });
      const legacy = `<script src="https://example.invalid/legacy.js"></script>`;
      writeFileSync(join(dir, group, "legacy.html"), `<!DOCTYPE html><html><head><title>Unsafe legacy</title></head><body>${legacy}</body></html>`);
      writeFileSync(join(dir, group, "body-marker.html"), `<!DOCTYPE html><html><head><title>Quoted marker</title></head><body><pre>${quotedMarker}</pre>${legacy}</body></html>`);
      writeFileSync(join(dir, group, "comment-marker.html"), `<!DOCTYPE html><html><head><!-- <meta ${quotedMarker}> --><title>Comment marker</title></head><body>${legacy}</body></html>`);
      writeFileSync(join(dir, group, "script-marker.html"), `<!DOCTYPE html><html><head><script>const marker='<meta ${quotedMarker}>';</script><title>Script marker</title></head><body>${legacy}</body></html>`);
      writeFileSync(join(dir, group, "current.html"), conversationToHtml(syntheticConversation()));
    }
    generateExportIndex(dir, []);
    const index = readFileSync(join(dir, "index.html"), "utf8");
    for (const omitted of ["legacy.html", "body-marker.html", "comment-marker.html", "script-marker.html"]) assert.ok(!index.includes(omitted), omitted);
    for (const group of ["html", "archived/html", "deleted/html", "projects/Legacy/html"]) assert.ok(index.includes(`href="${group}/current.html"`), group);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
