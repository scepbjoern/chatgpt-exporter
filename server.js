#!/usr/bin/env node
import { previewExport } from "./lib/export-preview.js";
/** Local loopback UI. The launch capability is never served in the HTML. */
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runExport } from "./lib/export-runner.js";
import { regenerateMarkdown } from "./lib/markdown-regeneration.js";
import { RateLimitStopError, fetchProjectsInventory, resetRateLimiter, setApiDebugLogger, setApiWorkspace, redactSecrets } from "./lib/chatgpt-api.js";

const root = dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";
const PORT = 8523;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 128;

// Debugging intentionally omits request/response bodies, URLs and proxy values.
function dbg(message) {
  if (!process.argv.includes("--debug")) return;
  appendFileSync(join(root, "debug.log"), `[${new Date().toISOString()}] API diagnostic event\n`, { mode: 0o600 });
}
setApiDebugLogger(dbg);

function json(res, code, value) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

function validKey(given, expected) {
  return typeof given === "string" && /^[a-f0-9]{64}$/.test(given) &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Dependency injection is used only by synthetic local integration tests. */
export function createExporterServer(dependencies = {}) {
  const previewFn = dependencies.previewExport || previewExport;
  const exportFn = dependencies.runExport || runExport;
  const regenerateFn = dependencies.regenerateMarkdown || regenerateMarkdown;
  const projectsFn = dependencies.fetchProjectsInventory || fetchProjectsInventory;
  const key = randomBytes(32).toString("hex");
  const jobs = new Map();
  let busy = false;
  let boundPort = PORT;

  const server = createServer(async (req, res) => {
    const origin = `http://${HOST}:${boundPort}`;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    const host = req.headers.host;
    if (host !== `${HOST}:${boundPort}`) return json(res, 403, { error: "Invalid local host" });
    if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: "Invalid origin" });
    let url;
    try { url = new URL(req.url, origin); } catch { return json(res, 400, { error: "Invalid URL" }); }
    if (url.searchParams.has("key") || url.searchParams.has("token")) return json(res, 400, { error: "Credentials must not be sent in URLs" });
    if (req.method === "GET" && url.pathname === "/") {
      try {
        const html = readFileSync(join(root, "public", "index.html"), "utf8").replace(/\r\n?/g, "\n");
        const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`);
        res.setHeader("Content-Security-Policy", `default-src 'none'; script-src ${scripts.join(" ")}; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        json(res, 500, { error: "Could not read the application interface" });
      }
      return;
    }
    if (!validKey(req.headers["x-cge-key"], key)) return json(res, 403, { error: "Open the complete launch URL from the terminal" });
    if (req.method === "POST" && req.headers.origin !== origin) return json(res, 403, { error: "Missing local origin" });
    if (req.method === "POST" && !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) return json(res, 415, { error: "Use application/json" });
    try {
      if (req.method === "GET" && url.pathname === "/config") return json(res, 200, { defaultDir: join(homedir(), "Desktop", "chatgpt-export"), platform: process.platform });
      if (req.method === "GET" && url.pathname === "/debug-log") {
        const enabled = process.argv.includes("--debug");
        return json(res, 200, { enabled, content: enabled && existsSync(join(root, "debug.log")) ? readFileSync(join(root, "debug.log"), "utf8") : "" });
      }
      if (req.method === "GET" && url.pathname === "/list-dir") {
        const requested = url.searchParams.get("path") || homedir();
        const path = resolve(requested);
        const dirs = readdirSync(path, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith(".")).map(e => ({ name: e.name, path: join(path, e.name) })).sort((a, b) => a.name.localeCompare(b.name));
        return json(res, 200, { path, parent: dirname(path), dirs, drives: [] });
      }
      if (req.method === "GET" && url.pathname.startsWith("/progress/")) {
        const job = jobs.get(url.pathname.slice("/progress/".length));
        if (!job) return json(res, 404, { error: "Unknown or expired job" });
        if (job.connected) return json(res, 409, { error: "Progress already connected" });
        job.connected = true;
        res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
        res.flushHeaders();
        job.response = res;
        for (const event of job.events) res.write(event);
        job.events = [];
        if (job.done) res.end();
        req.on("close", () => { job.response = null; job.connected = false; });
        return;
      }
      if (req.method !== "POST") return json(res, 404, { error: "Not found" });
      const body = await readJson(req);
      if (url.pathname === "/cancel-job") {
        const job = jobs.get(body.exportId);
        if (!job || job.done) return json(res, 404, { error: "No running job" });
        job.controller.abort(new Error("Stopped by user. Existing files are preserved."));
        return json(res, 200, { ok: true });
      }
      if (busy) return json(res, 409, { error: "Another export or local operation is running" });
      if (url.pathname === "/create-dir") {
        if (typeof body.path !== "string" || !body.path.trim()) return json(res, 400, { error: "No folder path provided" });
        mkdirSync(resolve(body.path), { recursive: true });
        return json(res, 200, { ok: true, path: resolve(body.path) });
      }
      if (url.pathname === "/list-projects") {
        if (typeof body.token !== "string" || !body.token) return json(res, 400, { error: "No token provided" });
        if (typeof body.workspaceId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(body.workspaceId)) return json(res, 400, { error: "Explicit workspace ID is required" });
        busy = true;
        let projects;
        try {
          resetRateLimiter();
          setApiWorkspace(body.workspaceId);
          projects = await projectsFn(body.token);
        } finally { busy = false; try { resetRateLimiter(); } finally { setApiWorkspace(null); } }
        return json(res, 200, { projects: projects.map(p => ({ id: p.gizmoId, name: p.name })) });
      }
      if (!["/start-export", "/preview-export", "/regenerate-markdown"].includes(url.pathname)) return json(res, 404, { error: "Not found" });
      const isPreview = url.pathname === "/preview-export";
      const isExport = url.pathname === "/start-export" || isPreview;
      if (isExport && (typeof body.token !== "string" || !body.token)) return json(res, 400, { error: "No token provided" });
      const options = body.exportOptions || {};
      if (isExport && (!options.identity || typeof options.identity.userId !== "string" || !options.identity.userId.trim() || typeof options.identity.workspaceId !== "string" || !options.identity.workspaceId.trim())) {
        return json(res, 400, { error: "Session user ID and explicit workspace ID are required" });
      }
      if (isExport) {
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(options.identity.userId) || !/^[A-Za-z0-9_-]{1,200}$/.test(options.identity.workspaceId)) return json(res, 400, { error: "Invalid user/workspace ID" });
        if ([options.conversations, options.projects, options.gpts].every(value => value === false)) return json(res, 400, { error: "Select at least one export category" });
        for (const name of ["dateFrom", "dateTo"]) if (options[name] && (!/^\d{4}-\d{2}-\d{2}$/.test(options[name]) || !Number.isFinite(Date.parse(options[name])) || new Date(options[name]).toISOString().slice(0, 10) !== options[name])) return json(res, 400, { error: "Invalid date range" });
        if (options.dateFrom && options.dateTo && options.dateFrom > options.dateTo) return json(res, 400, { error: "Start date is after end date" });
        if (options.selectedProjectIds != null && (!Array.isArray(options.selectedProjectIds) || options.selectedProjectIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)))) return json(res, 400, { error: "Invalid project selection" });
      }
      const outputDir = resolve(body.outputDir || join(homedir(), "Desktop", "chatgpt-export"));
      const exportId = randomUUID();
      const job = { controller: new AbortController(), events: [], done: false, connected: false, response: null, terminalEmitted: false, error: null };
      // Retain only a bounded number of completed job summaries in memory.
      for (const [id, old] of jobs) if (old.done && jobs.size >= 8) jobs.delete(id);
      jobs.set(exportId, job);
      busy = true;
      const sendEvent = (type, data) => {
        if (!/^[a-z_]+$/.test(type)) return;
        if (type === "done") job.terminalEmitted = true;
        if (type === "error_msg") job.error = redactSecrets(String(data));
        let payload = String(data);
        if (type === "progress") {
          try {
            const progress = JSON.parse(payload);
            if (typeof progress.title === "string") progress.title = progress.title.slice(0, 1000);
            if (typeof progress.stats === "string") progress.stats = progress.stats.slice(0, 2000);
            payload = JSON.stringify(progress);
          } catch { return; }
        } else if (type === "status" || type === "error_msg") payload = payload.slice(0, 8192);
        const event = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
        if (job.response) job.response.write(event);
        else {
          if (type === "progress") job.events = job.events.filter(event => !event.startsWith("event: progress\n"));
          if (job.events.length >= MAX_EVENTS) job.events.shift();
          job.events.push(event);
        }
      };
      const invoke = () => isPreview ? previewFn(body.token, options, sendEvent, { signal: job.controller.signal }) : isExport
        ? exportFn(body.token, outputDir, 1, false, body.keepAwake ?? false, options, sendEvent, { signal: job.controller.signal })
        : regenerateFn(outputDir, body.markdownOptions || {}, sendEvent);
      Promise.resolve().then(invoke).catch(error => sendEvent("error_msg", redactSecrets(error.message))).finally(() => {
        if (!job.terminalEmitted) sendEvent("done", JSON.stringify({ total: 0, succeeded: 0, failed: 1, status: "partial", errors: [{ message: job.error || "Operation ended without a completion report" }], output: outputDir }));
        body.token = null;
        job.done = true;
        busy = false;
        if (job.response) job.response.end();
        const expiry = setTimeout(() => { if (job.done) jobs.delete(exportId); }, 15 * 60 * 1000);
        expiry.unref();
      });
      return json(res, 200, { exportId });
    } catch (error) {
      const rateLimited = error instanceof RateLimitStopError;
      json(res, rateLimited ? 429 : error.status || 400, { error: rateLimited ? "ChatGPT rate limit reached" : error.message, ...(rateLimited ? { rateLimited: true, retryAfter: error.retryAfter || null } : {}) });
    }
  });
  server.on("listening", () => { boundPort = server.address().port; });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server, key };
}

export function startServer({ port = PORT, openBrowser = true } = {}) {
  const { server, key } = createExporterServer();
  server.on("error", error => { console.error(`Could not start local exporter: ${error.code || "server error"}`); process.exitCode = 1; });
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${server.address().port}/#key=${key}`;
    console.log(`\nChatGPT Exporter running at ${url}\nKeep this launch URL private. Press Ctrl+C to stop.\n`);
    if (openBrowser) {
      const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
      try { spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch {}
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) startServer();
