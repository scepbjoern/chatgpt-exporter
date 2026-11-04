import test from "node:test";
import assert from "node:assert/strict";
import { presentationText, citationLookup } from "../lib/presentation-text.js";
import { conversationToHtml } from "../lib/html-renderer.js";
import { conversationToMarkdown } from "../lib/markdown.js";
import { conversation, fixture } from "./export-fixtures.mjs";
import { previewExport } from "../lib/export-preview.js";

test("presentation widgets retain readable text and links; code examples remain literal", () => {
  const code = '```html\n<box gap={3}>literal code</box>\n```';
  const input = '<box gap={3}><row><icon name="code"/><text>**Heading**</text>\n    Useful description\n    <Link url="https://example.invalid/doc" title="Read more"/></row></box>\n' + code;
  const result = presentationText(input);
  assert.match(result, /\*\*Heading\*\*/);
  assert.match(result, /\nUseful description/);
  assert.match(result, /\[Read more\]\(https:\/\/example.invalid\/doc\)/);
  assert.ok(result.includes(code));
  assert.doesNotMatch(result.replace(code, ''), /<box|<row|<icon|<text|<Link/);
  assert.equal(presentationText('Example `<box>literal</box>`'), 'Example `<box>literal</box>`');
});

test("archived forms display options without evaluating source or activating handlers", () => {
  const text = '{@body const [type,setType] = DIL.useState("planned")}\n<box><form onSubmit={() => GenUI.issueNewTurn("reply > " + type)}><text>Which meeting?</text><radio-group value={type}><radio value="planned">Planned</radio><radio value="instant">Instant</radio></radio-group><button submit>Continue</button></form></box>';
  const c = conversation(); c.mapping.answer.message.content.parts = [text];
  const html = conversationToHtml(c), md = conversationToMarkdown(c);
  for (const rendered of [html, md]) {
    assert.match(rendered, /Which meeting\?/); assert.match(rendered, /Planned/); assert.match(rendered, /Instant/);
    assert.match(rendered, /Archived form/); assert.match(rendered, /original action unavailable offline/);
    assert.doesNotMatch(rendered, /DIL|GenUI|onSubmit|<form|<button/);
  }
});

test("citations use exact saved metadata; unknown or conflicting IDs remain explicit", () => {
  const c = conversation();
  c.mapping.answer.message.metadata.search_result_groups = [{ entries: [{ ref_id: { turn_index: 12, ref_type: "view", ref_index: 0 }, title: "Reference", url: "https://example.invalid/reference" }] }];
  const refs = citationLookup(c);
  assert.match(presentationText('<Cite refs={["turn12view0"]}/>', refs), /\[Reference\]\(https:\/\/example.invalid\/reference\)/);
  assert.match(presentationText(String.raw`<Cite refs={[\"turn12view0\"]}/>`, refs), /\[Reference\]/);
  assert.match(presentationText('<Cite ref="turn12view0"/>', refs), /\[Reference\]/);
  assert.match(presentationText('<Cite refs={["unknown"]}/>', refs), /source details unavailable/);
  c.mapping.question.message.metadata.citations = [{ ref_id: "turn12view0", url: "https://example.invalid/conflict" }];
  assert.equal(citationLookup(c).get("turn12view0"), null);
});

test("original links, static branches and unknown markup remain safe", () => {
  const c = conversation(); c.mapping.question.children = ["answer", "alternative"];
  c.mapping.answer.children = ["followup"];
  c.mapping.followup = { parent: "answer", children: [], message: { author: { role: "user" }, content: { parts: ["Follow first branch"] } } };
  c.mapping.alternative = { parent: "question", children: [], message: { author: { role: "assistant" }, content: { content_type: "text", parts: ['Alternative answer <script>evil()</script><Link url="javascript:evil()" title="bad"/>'] } } };
  const html = conversationToHtml(c);
  assert.doesNotMatch(html, /<nav class="sidebar"/);
  assert.match(html, /https:\/\/chatgpt.com\/c\/sameprefix-one/);
  assert.match(html, /Variant 1 of 2/); assert.match(html, /Variant 2 of 2/);
  assert.ok(html.indexOf('Follow first branch') < html.indexOf('Variant 2 of 2'));
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test("preview emits inventory phases before completion without archive writes", async () => {
  const f = fixture(); try {
    const events = [];
    const report = await previewExport('FAKE', { identity: { userId: 'test', workspaceId: 'test' }, gpts: false }, (type, data) => events.push({ type, data }), f.deps);
    assert.equal(report.conversations, 1);
    assert.ok(events.some(e => e.type === 'status' && /active conversations: page 1/.test(e.data)));
    assert.ok(events.some(e => e.type === 'status' && /archived conversations/.test(e.data)));
    assert.equal(events.at(-1).type, 'done');
  } finally { f.cleanup(); }
});
