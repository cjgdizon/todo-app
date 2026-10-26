/** The largest file a person can attach. The storage bucket enforces the same limit server-side. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const MAX_FILE_NAME_LENGTH = 255;
const MAX_STORED_NAME_LENGTH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A name that is safe inside a storage path: letters, digits, dot, dash, underscore, and no `..`. */
function safeName(fileName: string): string {
  let name = fileName
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "");
  if (name.length > MAX_STORED_NAME_LENGTH) {
    const extension = /\.[A-Za-z0-9]{1,10}$/.exec(name)?.[0] ?? "";
    name = name.slice(0, MAX_STORED_NAME_LENGTH - extension.length) + extension;
  }
  return name === "" ? "file" : name;
}

/**
 * Where an attachment's file lives: `<task id>/<attachment id>-<safe name>`. The folder is the
 * task's id because the database checks it (and storage access follows it), so a name can never
 * move a file to another task's folder. The attachment id keeps two files of the same name apart.
 */
export function attachmentPath(taskId: string, attachmentId: string, fileName: string): string {
  if (!UUID.test(taskId) || !UUID.test(attachmentId)) throw new RangeError("ids must be UUIDs");
  return `${taskId}/${attachmentId}-${safeName(fileName)}`;
}

/** Why a file cannot be attached, in words for the person, or null when it can. */
export function validateAttachment(file: { name: string; size: number }): string | null {
  if (file.name.length < 1 || file.name.length > MAX_FILE_NAME_LENGTH) {
    return `The file name must be between 1 and ${MAX_FILE_NAME_LENGTH} characters.`;
  }
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_ATTACHMENT_BYTES) return "Files can be at most 10 MB.";
  return null;
}
