import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const API_BASE = "https://chatgpt.com/backend-api";
export const API_BASE_PUB = "https://chatgpt.com/public-api";
export const PAGE_SIZE = 100;
export const DELAY = 100;
export const DEVICE_ID = randomUUID();
export const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Encoding": "identity",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://chatgpt.com/",
  Origin: "https://chatgpt.com",
  "Oai-Device-Id": DEVICE_ID,
  "Oai-Language": "en-US",
};
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Debug information is local archive data, but must never include bearer tokens,
// proxy credentials or signed query strings, including nested API metadata.
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|authorization|cookie|secret|password/i.test(key) ? "[redacted]" : redactSecrets(item)]));
  if (typeof value !== "string") return value;
  return value
    .replace(/Bearer\s+[^\s",}]+/gi, "Bearer [redacted]")
    .replace(/("(?:access_?token|authorization|cookie|secret|password)"\s*:\s*")[^"]*/gi, "$1[redacted]")
    .replace(/https?:\/\/[^\s"<>]+/gi, (raw) => {
      try { const url = new URL(raw); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.href; } catch { return "[URL redacted]"; }
    });
}
let debugLogger = () => {};
export function setApiDebugLogger(logger) { debugLogger = typeof logger === "function" ? logger : () => {}; }
export function apiDebug(msg, data) { debugLogger(redactSecrets(msg), redactSecrets(data)); }

export class RateLimitStopError extends Error {
  constructor(retryAfter = null) {
    const safeRetry = retryAfter && /^(?:\d{1,8}|[A-Za-z]{3}, [\d A-Za-z:]+ GMT)$/.test(retryAfter) ? retryAfter : null;
    super(`ChatGPT rate limit reached.${safeRetry ? ` Retry-After: ${safeRetry}.` : ""} Export paused. Rerun later to retry outstanding items.`);
    this.name = "RateLimitStopError";
    this.retryAfter = safeRetry;
  }
}

export function isPublicAddress(address) {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Only globally routed IPv6 unicast. This also excludes IPv4-mapped,
  // loopback, link-local, unique-local and unspecified addresses.
  if (isIP(ip) !== 6) return false;
  const canonical = new URL(`https://[${ip}]/`).hostname;
  return /^\[[23][0-9a-f]{3}:/.test(canonical) && !/^\[(?:2002:|2001:(?:db8:|0:|:))/.test(canonical);
}

// Resolve, validate, then pin the chosen public address for this connection.
// TLS still verifies the original hostname; a second DNS resolution cannot
// redirect the request to a private address after validation.
function pinnedFetch(value, options, addresses) {
  const url = new URL(value);
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const request = httpsRequest(url, {
      method: options.method || "GET",
      headers: Object.fromEntries(new Headers(options.headers)),
      signal: options.signal,
      lookup: (hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [{ address: address.address, family: address.family || isIP(address.address) }]);
        else callback(null, address.address, address.family || isIP(address.address));
      },
    }, (incoming) => {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      const noBody = [204, 205, 304].includes(incoming.statusCode);
      resolve(new Response(noBody ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers }));
      if (noBody) incoming.resume();
    });
    request.on("error", reject);
    request.end();
  });
}

const DOWNLOAD_SUFFIXES = [".oaiusercontent.com", ".openai.com", ".blob.core.windows.net"];
export function allowedDownloadHost(host) {
  return host === "chatgpt.com" || host === "oaiusercontent.com" || host === "openai.com" || DOWNLOAD_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
function strictObject(value, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${description}: expected object`);
  return value;
}
export function validateConversationInventory(data) {
  strictObject(data, "conversation inventory");
  if (!Array.isArray(data.items)) throw new Error("Invalid conversation inventory: missing items array");
  const ids = new Set();
  for (const item of data.items) {
    if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(item.id) || ids.has(item.id)) throw new Error("Invalid conversation inventory: missing or duplicate ID");
    ids.add(item.id);
    if (item.title !== undefined && typeof item.title !== "string") throw new Error("Invalid conversation inventory title");
  }
  if (data.total !== undefined && (!Number.isSafeInteger(data.total) || data.total < data.items.length)) throw new Error("Invalid conversation inventory total");
  if (data.offset !== undefined && (!Number.isSafeInteger(data.offset) || data.offset < 0)) throw new Error("Invalid conversation inventory offset");
  if (data.has_more !== undefined && typeof data.has_more !== "boolean") throw new Error("Invalid conversation inventory has_more");
  return data;
}

// Test seams are programmatic only: the UI and environment cannot relax network
// policy. A separate client lets synthetic local HTTP tests avoid real accounts.
export function createApiClient(config = {}) {
  const fetchImpl = config.fetch || null;
  const validatedAddresses = new Map();
  const lookupImpl = config.lookup || lookup;
  const testOrigins = new Set(config.testOrigins || []);
  const apiBase = config.apiBase || API_BASE;
  const publicBase = config.publicBase || API_BASE_PUB;
  const apiOrigin = new URL(apiBase).origin;
  const timeoutMs = config.timeoutMs ?? 60_000;
  const jsonLimit = config.jsonLimit ?? 32 * 1024 * 1024;
  const downloadLimit = config.downloadLimit ?? 256 * 1024 * 1024;
  const minInterval = config.minIntervalMs ?? 1000;
  let workspaceId = null;
  let nextAt = 0;
  let requestChain = Promise.resolve();
  let stopped = false;
  let retryAfter = null;
  let onStop = null;
  let pending = 0;

  function setWorkspace(value) {
    if (value !== null && value !== undefined && (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value))) throw new Error("Invalid workspace identifier");
    workspaceId = value || null;
  }
  function reset() {
    if (pending) throw new Error("Cannot reset rate limiter while requests are pending");
    nextAt = 0; requestChain = Promise.resolve(); stopped = false; retryAfter = null; onStop = null;
  }
  async function paced(fn) {
    pending++;
    const run = requestChain.then(async () => {
      if (stopped) throw new RateLimitStopError(retryAfter);
      const delay = Math.max(0, nextAt - Date.now());
      if (delay) await sleep(delay);
      if (stopped) throw new RateLimitStopError(retryAfter);
      nextAt = Date.now() + minInterval;
      const response = await fn();
      if (response.status === 429) {
        stopped = true;
        const error = new RateLimitStopError(response.headers.get("retry-after"));
        retryAfter = error.retryAfter;
        await response.body?.cancel().catch(() => {});
        apiDebug("429 rate limited; remaining requests stopped", { retryAfter });
        if (onStop) { try { onStop(error.message); } catch {} }
        throw error;
      }
      return response;
    });
    requestChain = run.catch(() => {});
    try { return await run; } finally { pending--; }
  }
  async function validateUrl(value, binary, signal) {
    const url = new URL(value, `${apiOrigin}/`);
    if (url.username || url.password) throw new Error("Download URL credentials are forbidden");
    if (testOrigins.has(url.origin)) {
      if (!fetchImpl) throw new Error("Test origins require an explicit injected transport");
      return url;
    }
    if (url.protocol !== "https:" || (url.port && url.port !== "443")) throw new Error("Only HTTPS on port 443 is allowed");
    if (binary ? !allowedDownloadHost(url.hostname) : url.origin !== "https://chatgpt.com") throw new Error("Network host is not permitted");
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(literal) ? [{ address: literal }] : await new Promise((resolve, reject) => {
      const aborted = () => reject(new Error("DNS lookup timed out"));
      if (signal.aborted) return aborted();
      signal.addEventListener("abort", aborted, { once: true });
      Promise.resolve().then(() => lookupImpl(literal, { all: true, verbatim: true })).then(resolve, () => reject(new Error("DNS lookup failed"))).finally(() => signal.removeEventListener("abort", aborted));
    });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Private or non-routable network destination is forbidden");
    validatedAddresses.set(url.hostname, addresses);
    return url;
  }
  async function request(value, options = {}, binary = false) {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let url = await validateUrl(value, binary, signal);
    const originalHeaders = new Headers(options.headers || {});
    const bearer = originalHeaders.get("authorization");
    for (let hop = 0; hop <= 5; hop++) {
      const trusted = url.origin === "https://chatgpt.com" || (testOrigins.has(url.origin) && url.origin === apiOrigin);
      const headers = trusted ? new Headers(originalHeaders) : new Headers({ Accept: binary ? "*/*" : "application/json", "Accept-Encoding": "identity" });
      headers.delete("authorization"); headers.delete("chatgpt-account-id");
      if (trusted) {
        if (bearer) headers.set("Authorization", bearer);
        if (workspaceId) headers.set("ChatGPT-Account-Id", workspaceId);
      }
      apiDebug(`FETCH → ${url.href}`);
      let response;
      try { response = await (fetchImpl || pinnedFetch)(url.href, { ...options, headers, signal, redirect: "manual" }, validatedAddresses.get(url.hostname)); }
      catch { throw new Error("Network request failed or timed out"); }
      apiDebug(`FETCH ← ${url.href}`, `HTTP ${response.status}`);
      if (response.status === 429) return response;
      if (response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity") {
        await response.body?.cancel().catch(() => {});
        throw new Error("Unexpected compressed response");
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) throw new Error("Redirect has no Location header");
        if (hop === 5) throw new Error("Too many download redirects");
        url = await validateUrl(new URL(location, url).href, binary, signal);
        continue;
      }
      const maxBytes = binary ? downloadLimit : jsonLimit;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) { await response.body?.cancel().catch(() => {}); throw new Error("Response exceeds size limit"); }
      if (!response.body) return response;
      let size = 0;
      const bounded = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          size += chunk.byteLength;
          if (size > maxBytes) throw new Error("Response exceeds size limit");
          controller.enqueue(chunk);
        },
      }));
      return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    throw new Error("Too many redirects");
  }
  async function get(path, token, isPublic = false) {
    if (typeof path !== "string" || path.startsWith("/") || path.includes("://") || path.split("?")[0].split("/").includes("..")) throw new Error("Invalid API path");
    const response = await paced(() => request(`${isPublic ? publicBase : apiBase}/${path}`, { headers: { ...HEADERS, Authorization: `Bearer ${token}` } }));
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`HTTP ${response.status}`); }
    let data;
    try { data = await response.json(); } catch { throw new Error("Invalid or oversized API JSON response"); }
    strictObject(data, "API response");
    if (/^conversations(?:\?|$)/.test(path) || /^gizmos\/[^/]+\/conversations(?:\?|$)/.test(path)) validateConversationInventory(data);
    return data;
  }
  async function binaryResponse(url, token) {
    const trusted = new URL(url, `${apiOrigin}/`).origin === apiOrigin;
    const perform = () => request(url, { headers: { ...HEADERS, Accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, true);
    const response = trusted ? await paced(perform) : await perform();
    if (response.status === 429) { await response.body?.cancel().catch(() => {}); throw new RateLimitStopError(response.headers.get("retry-after")); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`HTTP ${response.status}`); }
    return response;
  }
  async function binary(url, token) {
    const response = await binaryResponse(url, token);
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "" };
  }
  async function downloadTo(url, token, destination) {
    const response = await binaryResponse(url, token);
    if (!response.body) throw new Error("Download response has no body");
    const temporary = `${destination}.partial-${randomUUID()}`;
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; hash.update(chunk); callback(null, chunk); } });
    try {
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      await rename(temporary, destination);
      return { size, sha256: hash.digest("hex"), contentType: response.headers.get("content-type") || "" };
    } catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
  }
  async function projects(token, onFound = null) {
    const result = [], seenIds = new Set(), seenCursors = new Set();
    let cursor = null;
    for (let page = 0; page < 10000; page++) {
      const qs = `owned_only=true&conversations_per_gizmo=0&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const data = await get(`gizmos/snorlax/sidebar?${qs}`, token);
      const list = data.list === undefined ? data : strictObject(data.list, "project list");
      if (!Array.isArray(list.items)) throw new Error("Invalid project inventory: missing items array");
      for (const item of list.items) {
        strictObject(item, "project inventory item");
        const wrapper = item.resource?.gizmo || item.gizmo || item;
        strictObject(wrapper, "project wrapper");
        const gizmo = wrapper.gizmo || wrapper;
        if (typeof gizmo.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(gizmo.id)) throw new Error("Invalid project inventory ID");
        if (seenIds.has(gizmo.id)) throw new Error("Repeated project ID across inventory pages");
        seenIds.add(gizmo.id);
        if (!gizmo.id.startsWith("g-p-")) continue;
        const files = wrapper.files === undefined ? [] : wrapper.files;
        if (!Array.isArray(files)) throw new Error("Invalid project files inventory");
        for (const file of files) if (!file || typeof (file.file_id || file.id) !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(file.file_id || file.id)) throw new Error("Invalid project file ID");
        const name = gizmo.display?.name || gizmo.name || gizmo.id;
        if (typeof name !== "string") throw new Error("Invalid project name");
        const project = { gizmoId: gizmo.id, name, gizmo, files };
        result.push(project); if (onFound) onFound(project);
      }
      const next = list.cursor ?? data.cursor ?? null;
      if (next !== null && (typeof next !== "string" || !next || seenCursors.has(next))) throw new Error("Invalid or repeated project inventory cursor");
      if (!next) return result;
      if (!list.items.length) throw new Error("Empty project page with continuation cursor");
      seenCursors.add(next); cursor = next;
    }
    throw new Error("Project inventory pagination limit exceeded");
  }
  return {
    apiGet: get,
    apiGetPublic: (path, token) => get(path, token, true),
    apiFetchBinary: binary,
    apiDownloadTo: downloadTo,
    debugFetch: (url, options) => request(url, options),
    fetchProjectsInventory: projects,
    pacedChatGptFetch: paced,
    resetRateLimiter: reset,
    getRateLimitState: () => ({ stopped, retryAfter }),
    setRateLimitStopHandler: (handler) => { onStop = typeof handler === "function" ? handler : null; },
    setApiWorkspace: setWorkspace,
  };
}
const defaultClient = createApiClient();
export const apiGet = (...args) => defaultClient.apiGet(...args);
export const apiGetPublic = (...args) => defaultClient.apiGetPublic(...args);
export const apiFetchBinary = (...args) => defaultClient.apiFetchBinary(...args);
export const apiDownloadTo = (...args) => defaultClient.apiDownloadTo(...args);
export const downloadFileTo = apiDownloadTo;
export const debugFetch = (...args) => defaultClient.debugFetch(...args);
export const fetchProjectsInventory = (...args) => defaultClient.fetchProjectsInventory(...args);
export const pacedChatGptFetch = (...args) => defaultClient.pacedChatGptFetch(...args);
export const resetRateLimiter = (...args) => defaultClient.resetRateLimiter(...args);
export const getRateLimitState = (...args) => defaultClient.getRateLimitState(...args);
export const setRateLimitStopHandler = (...args) => defaultClient.setRateLimitStopHandler(...args);
export const setApiWorkspace = (...args) => defaultClient.setApiWorkspace(...args);

export const MIME_TO_EXT = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
  "application/pdf": ".pdf", "text/plain": ".txt", "text/html": ".html", "text/csv": ".csv", "application/json": ".json", "application/zip": ".zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};
