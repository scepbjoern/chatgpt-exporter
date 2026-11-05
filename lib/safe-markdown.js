import { createHash } from "node:crypto";
import { Marked } from "./vendor/marked.esm.js";

export const HTML_RENDERER_VERSION = 2;

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// File maps contain filesystem paths, not URL strings. Encode once per segment.
export function encodeLocalPath(value) {
  const path = String(value);
  if (!path || /[\u0000-\u001f\u007f\\]/.test(path) || /^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(path)) return "";
  return path.split("/").map((s) => encodeURIComponent(s)).join("/");
}

function decodedPath(value) {
  try { return decodeURIComponent(value); } catch { return ""; }
}

function localPath(value) {
  const path = decodedPath(value);
  if (!path || /[\u0000-\u001f\u007f\\]/.test(path) || /^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(path)) return "";
  return path;
}

function linkTarget(value, localFiles) {
  const href = String(value || "").trim();
  if (/[\u0000-\u001f\u007f\\]/.test(href) || href.startsWith("//")) return "";
  try {
    const url = new URL(href);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) return url.href;
    return "";
  } catch {
    if (/^#[a-z0-9_.:-]+$/i.test(href)) return href;
    const path = localPath(href);
    return path && localFiles.has(path) ? encodeLocalPath(path) : "";
  }
}

// Preserve TeX as readable source before Markdown interprets backslashes and emphasis.
// Marked handles fenced/inline code itself. Only paired math delimiters are recognized.
const mathSource = [
  {
    name: "displayMath", level: "block",
    start(src) { return src.search(/^ {0,3}(?:\\\[|\$\$)[ \t]*$/m); },
    tokenizer(src) {
      const match = /^ {0,3}(\\\[|\$\$)[ \t]*\n/.exec(src);
      if (!match) return;
      const closing = match[1] === "$$" ? /^ {0,3}\$\$[ \t]*(?=\n|$)/m : /^ {0,3}\\\][ \t]*(?=\n|$)/m;
      const end = closing.exec(src.slice(match[0].length));
      if (!end) return;
      const text = src.slice(0, match[0].length + end.index + end[0].length);
      return { type: "displayMath", raw: text + (src[text.length] === "\n" ? "\n" : ""), text };
    },
    renderer(token) { return `<pre class="math-source"><code>${escapeHtml(token.text)}</code></pre>\n`; },
  },
  {
    name: "inlineMath", level: "inline",
    start(src) { return src.search(/\\[([]|\$/); },
    tokenizer(src) {
      const match = /^(?:\\\([^\n]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]+?\$\$|\$(?![\s$])(?:\\.|[^$\n\\])+?(?<!\s)\$(?![\d$]))/.exec(src);
      if (match) return { type: "inlineMath", raw: match[0], text: match[0] };
    },
    renderer(token) { return `<code class="math-source">${escapeHtml(token.text)}</code>`; },
  },
];

export function markdownToSafeHtml(markdown, filePaths = []) {
  const localFiles = new Set(filePaths.map(String));
  const renderer = {
    html({ text }) { return escapeHtml(text); },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const target = linkTarget(href, localFiles);
      if (!target) return `${label} <span class="unavailable">[link unavailable]</span>`;
      const caption = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(target)}"${caption} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image({ href, text }) {
      const path = localPath(String(href || ""));
      // SVG/HTML original files remain downloadable, never active inline media.
      if (path && localFiles.has(path) && /\.(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(path)) {
        return `<img src="${escapeHtml(encodeLocalPath(path))}" alt="${escapeHtml(text)}" loading="lazy">`;
      }
      return `<span class="unavailable">[Image not embedded: ${escapeHtml(text || href || "unavailable")}]</span>`;
    },
  };
  const marked = new Marked({ renderer, breaks: true, gfm: true, async: false });
  marked.use({ extensions: mathSource });
  return marked.parse(String(markdown || ""));
}

export function contentSecurityPolicy(script = "", frames = false) {
  const scriptRule = script ? `'sha256-${createHash("sha256").update(script).digest("base64")}'` : "'none'";
  return `default-src 'none'; script-src ${scriptRule}; style-src 'unsafe-inline'; img-src 'self' file:; ${frames ? "frame-src 'self' file:; " : ""}base-uri 'none'; form-action 'none'; object-src 'none'`;
}

export function markdownDocumentToHtml(markdown, title = "Project info", filePaths = []) {
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy())}"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;line-height:1.65;max-width:850px;margin:32px auto;padding:0 24px;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f4f4f4;padding:16px}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}</style></head><body>${markdownToSafeHtml(markdown, filePaths)}</body></html>`;
}
