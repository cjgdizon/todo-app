import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Edge Functions (Deno) and plain Node scripts import this package without a
 * bundler. Dependencies that only expose their named exports through a bundler's
 * "module" field (rrule did) break there, so run the real thing in a fresh Node
 * process and make sure the whole package loads and the rrule-backed code works.
 */
describe("plain Node ESM compatibility", () => {
  it("loads the whole package without a bundler and runs the rrule-backed code", () => {
    const entry = pathToFileURL(fileURLToPath(new URL("./index.ts", import.meta.url))).href;
    const script = `
      const core = await import(${JSON.stringify(entry)});
      const next = core.nextDue({
        rrule: "FREQ=DAILY",
        dueAt: new Date("2026-10-20T01:00:00Z"),
        completedAt: new Date("2026-10-20T01:00:00Z"),
        timeZone: "Asia/Manila",
        afterCompletion: false,
      });
      const parsed = core.parseQuickAdd("Water plants every 3 days", {
        now: new Date("2026-10-20T10:00:00Z"),
        timeZone: "Asia/Manila",
      });
      const filter = core.parseFilter("p1 & #work");
      console.log(JSON.stringify({ next: next.toISOString(), rrule: parsed.rrule, filter: filter.type }));
    `;
    const out = execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(JSON.parse(out)).toEqual({
      next: "2026-10-21T01:00:00.000Z",
      rrule: "FREQ=DAILY;INTERVAL=3",
      filter: "and",
    });
  });
});
