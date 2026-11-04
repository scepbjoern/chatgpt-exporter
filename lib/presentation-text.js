// Convert known presentation widgets into static Markdown. Never evaluate source
// expressions or insert provider HTML. The ordinary safe renderer remains final.
const label = value => String(value).replace(/[\\`*_[\]<>]/g, "\\$&");
function webUrl(value) {
  try {
    const u = new URL(value);
    if (u.searchParams.get("utm_source") === "chatgpt.com") u.searchParams.delete("utm_source");
    return ["https:", "http:"].includes(u.protocol) ? u.href.replace(/[()<>"\s]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()) : "";
  } catch { return ""; }
}
export function citationLookup(conversation) {
  const result = new Map();
  const stack = Object.values(conversation.mapping || {}).map(n => n.message?.metadata).filter(Boolean);
  const seen = new Set();
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const ref = item.ref_id;
    const id = typeof ref === "string" ? ref : ref && Number.isInteger(ref.turn_index) && Number.isInteger(ref.ref_index) && /^[a-z]+$/i.test(ref.ref_type) ? `turn${ref.turn_index}${ref.ref_type}${ref.ref_index}` : null;
    const url = webUrl(item.url);
    if (id && url) {
      // Conflicting metadata must not silently assign a citation to a wrong URL.
      if (result.has(id) && result.get(id)?.url !== url) result.set(id, null);
      else if (!result.has(id)) result.set(id, { url, title: item.title || new URL(url).hostname });
    }
    stack.push(...Object.values(item).filter(v => v && typeof v === "object"));
  }
  return result;
}

// Scan balanced attribute expressions, including => and quoted >. No eval.
function endOf(source, start, expression = false) {
  let braces = expression ? 1 : 0, quote = "", escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") braces++;
    else if (c === "}") { braces--; if (expression && braces === 0) return i; }
    else if (c === ">" && braces === 0 && !expression) return i;
  }
  return -1;
}

export function presentationText(value, citations = new Map()) {
  const source = String(value || "");
  // Code fences and inline code are intentionally literal, including widget examples.
  const protectedCode = [];
  let marker = "CGE_LITERAL_"; while (source.includes(marker)) marker += "X";
  let text = source.replace(/(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\2[^\n]*$)|(`+)[^`\n]*?\3/gm, code => {
    const key = `${marker}${protectedCode.length}_END`; protectedCode.push(code); return key;
  });
  const hasWidgets = /<(?:box|row|text|form|radio-group|radio|button|divider|icon)\b/.test(text);
  let out = "";
  const known = new Set(["box", "row", "text", "form", "radio-group", "radio", "button", "divider", "icon", "Link", "Cite"]);
  for (let i = 0; i < text.length;) {
    if (hasWidgets && text.startsWith("{@body", i)) {
      const end = endOf(text, i + 1, true);
      if (end >= 0) { i = end + 1; continue; }
    }
    const m = text.slice(i).match(/^<(\/?)([A-Za-z][\w-]*)\b/);
    if (!m || !known.has(m[2])) { out += text[i++]; continue; }
    const citationTag = m[2] === "Cite" && text.slice(i).match(/^<Cite\s+refs\s*=\s*\{\[[^<>\n]*\]\}\s*\/>/);
    const end = citationTag ? i + citationTag[0].length - 1 : endOf(text, i + m[0].length);
    if (end < 0) { out += text[i++]; continue; }
    const tag = text.slice(i, end + 1), closing = Boolean(m[1]), name = m[2];
    const attr = key => tag.match(new RegExp(`\\b${key}\\s*=\\s*"([^"\\n]*)"`))?.[1] ?? tag.match(new RegExp(`\\b${key}\\s*=\\s*'([^'\\n]*)'`))?.[1] ?? "";
    if (name === "Link" && !closing) {
      const url = webUrl(attr("url"));
      out += url ? `[${label(attr("title") || url)}](${url})` : `${label(attr("title") || "Link")} [link unavailable]`;
    } else if (name === "Cite" && !closing) {
      let refs = []; try {
        const value = tag.match(/\brefs\s*=\s*\{(\[[\s\S]*?\])\}/)?.[1] || "[]";
        // Some saved widgets escape the JSON quote delimiters once more.
        refs = attr("ref") ? [attr("ref")] : JSON.parse(value.replace(/\\"/g, '"'));
      } catch {}
      const links = Array.isArray(refs) ? refs.map(id => citations.get(id)).filter(Boolean) : [];
      const unique = [...new Map(links.map(s => [s.url, s])).values()];
      out += unique.length ? ` (${unique.map(s => `[${label(s.title)}](${s.url})`).join(", ")}${links.length < refs.length ? "; some source details unavailable" : ""})` : " [source details unavailable]";
    } else if (name === "divider") out += "\n\n---\n\n";
    else if (name === "form") out += closing ? "\n\n" : "\n\n*Archived form — options below are read-only.*\n\n";
    else if (name === "radio") out += closing ? "\n" : "\n- ";
    else if (name === "button") out += closing ? " (original action unavailable offline)\n\n" : "\n\n";
    else if (["box", "row", "text", "radio-group"].includes(name)) out += "\n\n";
    i = end + 1;
  }
  if (hasWidgets) out = out.replace(/^[ \t]+/gm, "").replace(/\n{3,}/g, "\n\n");
  return out.replace(new RegExp(`${marker}(\\d+)_END`, "g"), (_, n) => protectedCode[Number(n)]);
}
