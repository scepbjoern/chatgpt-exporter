// Shared collection-shape check for resume and recovery reporting.
// Individual entries are checked by their consumers before filesystem access.
export function validFileMap(value) {
  const object = item => item !== null && typeof item === "object" && !Array.isArray(item);
  return object(value) && object(value.files) &&
    (value.failed === undefined || object(value.failed));
}
