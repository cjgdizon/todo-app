import { describe, expect, it } from "vitest";
import { describeActivity } from "./activity-text.ts";
import type { Activity } from "./models.ts";

const entry = (overrides: Partial<Activity>): Activity => ({
  id: 1,
  action: "task_created",
  actorId: "ana",
  actorName: "Ana",
  taskId: "t1",
  title: "Pay rent",
  assigneeId: null,
  mentionedId: null,
  createdAt: new Date("2026-10-26T10:00:00Z"),
  ...overrides,
});

const names = new Map([
  ["ana", "Ana"],
  ["ben", "Ben"],
]);
const context = { me: "ben", names };

describe("describeActivity", () => {
  it.each([
    ["task_created", "Ana added “Pay rent”"],
    ["task_completed", "Ana completed “Pay rent”"],
    ["task_reopened", "Ana reopened “Pay rent”"],
    ["task_deleted", "Ana deleted “Pay rent”"],
    ["task_unassigned", "Ana unassigned “Pay rent”"],
    ["comment_added", "Ana commented on “Pay rent”"],
    ["member_joined", "Ana joined the workspace"],
  ])("words %s", (action, text) => {
    expect(describeActivity(entry({ action }), context)).toBe(text);
  });

  it("says who a task was assigned to, and 'you' for the reader", () => {
    expect(describeActivity(entry({ action: "task_assigned", assigneeId: "ana" }), context)).toBe(
      "Ana assigned “Pay rent” to Ana",
    );
    expect(describeActivity(entry({ action: "task_assigned", assigneeId: "ben" }), context)).toBe(
      "Ana assigned “Pay rent” to you",
    );
    expect(describeActivity(entry({ action: "task_assigned", assigneeId: "gone" }), context)).toBe(
      "Ana assigned “Pay rent” to a former member",
    );
  });

  it("says who was mentioned, and 'you' for the reader", () => {
    expect(describeActivity(entry({ action: "mentioned", mentionedId: "ben" }), context)).toBe("Ana mentioned you in “Pay rent”");
    expect(describeActivity(entry({ action: "mentioned", mentionedId: "ana" }), context)).toBe("Ana mentioned Ana in “Pay rent”");
    expect(describeActivity(entry({ action: "mentioned", mentionedId: null }), context)).toBe("Ana mentioned a former member in “Pay rent”");
  });

  it("says 'You' for the reader's own actions", () => {
    expect(describeActivity(entry({ actorId: "ben", actorName: "Ben" }), context)).toBe("You added “Pay rent”");
  });

  it("falls back to the stored name, then to 'Someone'", () => {
    expect(describeActivity(entry({ actorId: "gone", actorName: "Cy" }), context)).toBe("Cy added “Pay rent”");
    expect(describeActivity(entry({ actorId: null, actorName: null }), context)).toBe("Someone added “Pay rent”");
  });

  it("copes with a missing title and an unknown action", () => {
    expect(describeActivity(entry({ title: null }), context)).toBe("Ana added a task");
    expect(describeActivity(entry({ action: "something_new" }), context)).toBe("Ana made a change");
  });
});
