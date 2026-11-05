import { FileFailure, safeFileFailure, combinedFailure, missingAddress } from "./file-failure.js";
import { existsSync, readFileSync, readdirSync, unlinkSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { timestampMs } from "./resume-state.js";
import { API_BASE, HEADERS, MIME_TO_EXT, RateLimitStopError, apiDebug, apiFetchBinary, apiDownloadTo, apiGet, debugFetch, pacedChatGptFetch } from "./chatgpt-api.js";

// ── Semaphore ────────────────────────────────────────────────────────

export class Semaphore {
  constructor(n) { this.n = n; this.queue = []; }
  acquire() {
    if (this.n > 0) { this.n--; return Promise.resolve(); }
    return new Promise((r) => this.queue.push(r));
  }
  release() {
    if (this.queue.length > 0) { this.queue.shift()(); } else { this.n++; }
  }
}

// ── File utilities ───────────────────────────────────────────────────

export function safeDate(ct) {
  if (!ct) return "";
  try {
    const d = typeof ct === "number" ? new Date(ct > 1e10 ? ct : ct * 1000) : new Date(ct);
    if (isNaN(d)) return "";
    return d.toISOString().slice(0, 10);
  } catch { return ""; }
}

export function sanitizeFilename(name, maxLen = 80) {
  let safe = name
    // Normalize line breaks and tabs as normal whitespace.
    .replace(/[\r\n\t]+/g, " ")
    // Remove the remaining ASCII control characters.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Replace characters forbidden in Windows filenames.
    .replace(/[<>:"/\\|?*]/g, "_")
    // Collapse repeated whitespace.
    .replace(/\s+/g, " ")
    // Windows forbids leading/trailing dots and spaces.
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, maxLen)
    // Truncation itself may leave a trailing dot or space.
    .replace(/[. ]+$/g, "");

  // Reserved Windows device names are invalid even with an extension.
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe)) {
    safe = `_${safe}`;
  }

  return safe || "untitled";
}

export function findConversationJsonById(dir, conversationId) {
  if (!existsSync(dir)) return null;

  const matches = readdirSync(dir)
    .filter((name) => name.endsWith(".json"));

  if (!matches.length) return null;

  let best = null;

  for (const name of matches) {
    const path = join(dir, name);

    try {
      const convo = JSON.parse(readFileSync(path, "utf8"));
      if ((convo.conversation_id || convo.id) !== conversationId) continue;
      const updatedMs = timestampMs(convo.update_time);

      if (!best || updatedMs > best.updatedMs) {
        best = {
          path,
          name,
          convo,
          updatedMs,
        };
      }
    } catch {
      // Ignore unreadable/corrupt candidates and keep looking.
    }
  }

  return best;
}

export function stripCitations(str) {
  return str.replace(/\u3010[^\u3011]*\u3011/g, "");
}

export function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function deduplicateFilename(name, usedNames) {
  const key = (value) => value.normalize("NFC").toLowerCase();
  if (!usedNames.has(key(name))) { usedNames.add(key(name)); return name; }
  const dot  = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot)    : "";
  let i = 1;
  while (usedNames.has(key(`${base}_${i}${ext}`))) i++;
  const deduped = `${base}_${i}${ext}`;
  usedNames.add(key(deduped));
  return deduped;
}

// ── File reference extraction ────────────────────────────────────────

export function extractFileReferences(convo) {
  const refs = [];
  const seen = new Set();
  const mapping = convo.mapping || {};

  for (const node of Object.values(mapping)) {
    const msg = node.message;
    if (!msg) continue;

    // The Markdown renderer only exposes user/assistant conversation content.
    // Do not download files attached only to internal tool/system messages.
    const role = msg.author?.role || "";
    if (role !== "user" && role !== "assistant") continue;

    // Prefer attachment metadata over image_asset_pointer because it normally
    // contains the original filename. Skip hidden connector extraction artifacts.
    if (msg.metadata?.attachments) {
      for (const att of msg.metadata.attachments) {
        if (!att.id || seen.has(att.id)) continue;
        if (att.source === "connector" && att.display_files_from_actions_ext === false) continue;

        seen.add(att.id);
        refs.push({
          fileId: att.id,
          filename: att.name || "attachment",
          type: "attachment",
        });
      }
    }

    if (msg.content?.parts) {
      for (const part of msg.content.parts) {
        if (part?.content_type === "image_asset_pointer" && part.asset_pointer) {
          const match = part.asset_pointer.match(/^(?:file-service|sediment):\/\/(.+)$/);
          if (match && !seen.has(match[1])) {
            seen.add(match[1]);
            refs.push({
              fileId: match[1],
              filename: part.metadata?.dalle?.prompt ? "dalle_image.png" : "image.png",
              type: "image",
            });
          }
        }
      }
    }

    if (msg.metadata?.citations) {
      for (const cit of msg.metadata.citations) {
        const fileId = cit.metadata?.file_id || cit.file_id;
        const title  = cit.metadata?.title    || cit.title   || "citation";
        if (fileId && !seen.has(fileId)) {
          seen.add(fileId);
          refs.push({ fileId, filename: title, type: "citation" });
        }
      }
    }
  }

  return refs;
}

function address(meta) {
  return meta?.download_url || meta?.url || meta?.file_url || meta?.presigned_url || meta?.signed_url;
}

function withExtension(name, contentType) {
  const ext = MIME_TO_EXT[(contentType || "").split(";")[0].trim()];
  return !name.includes(".") && ext ? name + ext : name;
}

async function fetchFileBytes(client, url, token, destination) {
  try {
    return await (destination ? client.apiDownloadTo(url, token, destination) : client.apiFetchBinary(url, token));
  } catch (error) {
    // The metadata service can deny access to the file. A binary host can only refuse its link.
    if (error.httpStatus === 401 || error.httpStatus === 403) throw new FileFailure("download-link");
    throw error;
  }
}

export async function downloadFile(fileId, token, fallbackName, debugLog, gizmoId, conversationId, destination = null, client = { apiGet, apiDownloadTo, apiFetchBinary }) {
  const id = encodeURIComponent(fileId);
  const routes = [];
  if (gizmoId) routes.push(`files/${id}/download?gizmo_id=${encodeURIComponent(gizmoId)}`);
  if (conversationId) routes.push(`files/download/${id}?conversation_id=${encodeURIComponent(conversationId)}&inline=false`);
  const generic = `files/download/${id}`;
  routes.push(generic, `files/${id}`);
  const failures = [];
  for (const route of routes) {
    try {
      const meta = await client.apiGet(route, token);
      const url = address(meta);
      if (!url) {
        const failure = missingAddress(meta);
        if (failure.reason === "access-denied") throw failure;
        failures.push(failure);
        continue;
      }
      const result = await fetchFileBytes(client, url, token, destination);
      return { filename: withExtension(meta.file_name || meta.name || fallbackName || fileId, result.contentType), buffer: result.buffer };
    } catch (error) {
      if (error instanceof RateLimitStopError || error.name === "AbortError") throw error;
      const failure = safeFileFailure(error);
      if (debugLog) debugLog(failure.message);
      if (["access-denied", "authentication"].includes(failure.reason)) throw failure;
      failures.push(failure);
      // As before, the final metadata lookup is for an absent address on the generic route.
      if (route === generic && failure.reason !== "download-link") break;
    }
  }
  throw combinedFailure(failures);
}

export async function downloadSandboxFile(ref, token, conversationId, projectId = null, destination = null, client = { pacedChatGptFetch, debugFetch, apiDownloadTo, apiFetchBinary }) {
  if (!conversationId) throw new Error("Missing conversation id for sandbox file");
  if (!ref?.sandboxPath) throw new Error("Missing sandbox path");

  const messageIds = Array.isArray(ref.messageIds)
    ? [...ref.messageIds].reverse()
    : [];

  if (!messageIds.length) throw new Error("Missing message id for sandbox file");

  const failures = [];

  for (const messageId of messageIds) {
    const params = new URLSearchParams({
      message_id: messageId,
      sandbox_path: ref.sandboxPath.replace(/^sandbox:/i, ""),
      download_intent: "true",
    });

    const url =
      `${API_BASE}/conversation/${encodeURIComponent(conversationId)}` +
      `/interpreter/download?${params.toString()}`;

    const headers = {
      ...HEADERS,
      Authorization: `Bearer ${token}`,
    };

    if (projectId) {
      headers["chatgpt-project-id"] = projectId;
    }

    try {
      const resp = await client.pacedChatGptFetch(() => client.debugFetch(url, { headers }));

      if (!resp.ok) {
        await resp.body?.cancel().catch(() => {});
        throw safeFileFailure({ httpStatus: resp.status });
      }

      const meta = await resp.json();
      const downloadUrl = address(meta);
      if (!downloadUrl) throw missingAddress(meta);

      const { buffer, contentType } = await fetchFileBytes(client, downloadUrl, token, destination);
      const name = meta.file_name || meta.name || ref.filename || "generated_file";
      return { filename: withExtension(name, contentType), buffer };
    } catch (e) {
      if (e instanceof RateLimitStopError || e.name === "AbortError") throw e;
      const failure = safeFileFailure(e);
      apiDebug("Sandbox download failed", failure.message);
      if (["access-denied", "authentication"].includes(failure.reason)) throw failure;
      failures.push(failure);
    }
  }
  throw combinedFailure(failures);
}

