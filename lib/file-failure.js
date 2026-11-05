// Only fixed categories leave the download boundary. Provider text is never displayed.
const descriptions = {
  "missing-address": "No download address supplied; cause unknown.",
  "access-denied": "Access to this file was denied.",
  "download-link": "The download host refused this link; the reason is unknown.",
  "authentication": "Authentication required for this file.",
  "not-found": "File not found when requested.",
  "server-error": "Server error during download; the failure may be temporary.",
  "unknown": "Download failed; cause unknown.",
};

export class FileFailure extends Error {
  constructor(reason) {
    const category = Object.hasOwn(descriptions, reason) ? reason : "unknown";
    super(descriptions[category]);
    this.reason = category;
  }
}

function fromStatus(status) {
  if (status === 401) return "authentication";
  if (status === 403) return "access-denied";
  if (status === 404 || status === 410) return "not-found";
  if (status >= 500 && status <= 599) return "server-error";
  return "unknown";
}

export function safeFileFailure(error) {
  if (error instanceof FileFailure) return new FileFailure(error.reason);
  return new FileFailure(fromStatus(error?.httpStatus));
}

export function missingAddress(meta) {
  const reasons = new Set();
  for (const value of [meta?.error_code, meta?.error_type, meta?.error_message]) {
    if (typeof value !== "string") continue;
    const key = value.trim().toLowerCase().replace(/[._ -]+/g, " ").trim();
    if (["forbidden", "access denied", "permission denied", "not allowed to download files"].includes(key)) reasons.add("access-denied");
    if (["not found", "file not found", "library file not found", "resource not found"].includes(key)) reasons.add("not-found");
    if (["internal server error", "server error"].includes(key)) reasons.add("server-error");
  }
  if (reasons.size > 1) return new FileFailure("unknown");
  return new FileFailure([...reasons][0] || "missing-address");
}

// Fallback endpoints can disagree. A missing address is an observation, not a diagnosis.
export function combinedFailure(failures) {
  const reasons = new Set(failures.map(f => f.reason));
  return new FileFailure(reasons.size === 1 ? [...reasons][0] : "unknown");
}
