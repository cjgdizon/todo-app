import { describe, expect, it } from "vitest";
import { attachmentPath, MAX_ATTACHMENT_BYTES, validateAttachment } from "./attachments.ts";

const task = "6f1c1d0e-3b1f-4c55-9a53-0a6c7a1c2d3e";
const id = "0b9f2a62-6a53-4d3c-8e6a-5b1f4c2d9e10";

describe("attachmentPath", () => {
  it("puts the file in its task's folder, named after its own id", () => {
    expect(attachmentPath(task, id, "report.pdf")).toBe(`${task}/${id}-report.pdf`);
  });

  it("keeps only safe characters so a name can never change the folder", () => {
    const path = attachmentPath(task, id, "../../etc/passwd");
    expect(path.startsWith(`${task}/`)).toBe(true);
    expect(path.slice(task.length + 1)).not.toMatch(/[\\/]/);
    expect(path).not.toContain("..");
    expect(attachmentPath(task, id, "my résumé (final).docx")).toBe(`${task}/${id}-my_r_sum___final_.docx`);
  });

  it("copes with empty and very long names", () => {
    expect(attachmentPath(task, id, "")).toBe(`${task}/${id}-file`);
    expect(attachmentPath(task, id, "...")).toBe(`${task}/${id}-file`);
    const long = attachmentPath(task, id, `${"a".repeat(500)}.txt`);
    expect(long.length).toBeLessThanOrEqual(task.length + 1 + id.length + 1 + 100);
    expect(long.endsWith(".txt")).toBe(true);
  });

  it("refuses ids that are not uuids", () => {
    expect(() => attachmentPath("../x", id, "a.txt")).toThrow();
    expect(() => attachmentPath(task, "nope", "a.txt")).toThrow();
  });
});

describe("validateAttachment", () => {
  it("accepts an ordinary file", () => {
    expect(validateAttachment({ name: "a.pdf", size: 1024 })).toBeNull();
    expect(validateAttachment({ name: "a.pdf", size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });

  it("explains why a file is refused", () => {
    expect(validateAttachment({ name: "a.pdf", size: MAX_ATTACHMENT_BYTES + 1 })).toMatch(/10 MB/);
    expect(validateAttachment({ name: "empty.txt", size: 0 })).toMatch(/empty/);
    expect(validateAttachment({ name: "", size: 10 })).toMatch(/name/);
    expect(validateAttachment({ name: "x".repeat(256), size: 10 })).toMatch(/name/);
  });
});
