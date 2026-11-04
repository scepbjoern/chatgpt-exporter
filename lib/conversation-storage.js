import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, join } from "node:path";
import { artifactPaths, publishGeneration } from "./archive-store.js";

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return value > 1e10 ? value : value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function statePriority(state) {
  if (state === "active" || state === "project") return 3;
  if (state === "archived") return 2;
  if (state === "deleted") return 1;
  return 0;
}

function addJsonDir(records, baseDir, state, projectName = null, options = {}) {
  const jsonDir = join(baseDir, "json");
  if (!existsSync(jsonDir)) return;

  let entries = [];
  try {
    entries = readdirSync(jsonDir, { withFileTypes: true });
  } catch (error) {
    options.onError?.(jsonDir, error);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;

    const path = join(jsonDir, entry.name);
    try {
      const convo = JSON.parse(readFileSync(path, "utf8"));
      const conversationId = convo.conversation_id || convo.id;
      if (typeof conversationId !== "string" || !conversationId) throw new Error("Missing conversation ID");

      records.push({
        conversationId,
        path,
        name: entry.name,
        fname: basename(entry.name, ".json"),
        baseDir,
        state,
        projectName,
        convo: options.lean ? { title: convo.title, create_time: convo.create_time, update_time: convo.update_time } : convo,
        updatedMs: timestampMs(convo.update_time),
      });
    } catch (error) {
      options.onError?.(path, error);
      // Ignore corrupt/unreadable JSON. It is safer not to move a file whose
      // identity cannot be established from its own contents.
    }
  }
}

export function collectLocalConversations(rootDir, options = {}) {
  const records = [];

  addJsonDir(records, rootDir, "active", null, options);
  addJsonDir(records, join(rootDir, "archived"), "archived", null, options);
  addJsonDir(records, join(rootDir, "deleted"), "deleted", null, options);

  const projectsDir = join(rootDir, "projects");
  if (existsSync(projectsDir)) {
    try {
      for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        addJsonDir(records, join(projectsDir, entry.name), "project", entry.name, options);
      }
    } catch (error) {
      options.onError?.(projectsDir, error);
      // Root/archived/deleted records are still useful if Projects is unreadable.
    }
  }

  return records;
}

export function buildLocalConversationIndex(rootDir, options = {}) {
  const index = new Map();

  for (const record of collectLocalConversations(rootDir, options)) {
    const current = index.get(record.conversationId);
    if (
      !current ||
      record.updatedMs > current.updatedMs ||
      (record.updatedMs === current.updatedMs && statePriority(record.state) > statePriority(current.state))
    ) {
      index.set(record.conversationId, record);
    }
  }

  return index;
}

export function moveConversationArtifacts(record, targetBaseDir, targetFname = record.fname) {
  if (!record?.baseDir || !record?.fname || !targetBaseDir || !targetFname) {
    throw new Error("Invalid conversation move");
  }

  const sourceBaseDir = record.baseDir;
  const sourceFname = record.fname;

  if (sourceBaseDir === targetBaseDir && sourceFname === targetFname) return false;

  let root = sourceBaseDir;
  if (record.state === "project") root = join(sourceBaseDir, "..", "..");
  else if (record.state === "archived" || record.state === "deleted") root = join(sourceBaseDir, "..");
  const sources = artifactPaths(sourceBaseDir, sourceFname);
  const targets = artifactPaths(targetBaseDir, targetFname);
  publishGeneration(root, sources.map((source, i) => ({ source, target: targets[i] })).filter(a => existsSync(a.source)), sources);

  return true;
}
