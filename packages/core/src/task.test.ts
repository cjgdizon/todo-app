import { describe, expect, it } from "vitest";
import { newTaskSchema } from "./task";

describe("newTaskSchema", () => {
  it("trims the title and defaults priority to 4 (lowest)", () => {
    const task = newTaskSchema.parse({ title: "  Buy milk  " });
    expect(task.title).toBe("Buy milk");
    expect(task.priority).toBe(4);
  });

  it("rejects an empty or whitespace-only title", () => {
    expect(newTaskSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(newTaskSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a title over 500 characters", () => {
    expect(newTaskSchema.safeParse({ title: "x".repeat(501) }).success).toBe(false);
  });

  it("accepts priorities 1-4 only", () => {
    expect(newTaskSchema.safeParse({ title: "a", priority: 1 }).success).toBe(true);
    expect(newTaskSchema.safeParse({ title: "a", priority: 5 }).success).toBe(false);
    expect(newTaskSchema.safeParse({ title: "a", priority: 0 }).success).toBe(false);
  });

  it("accepts an ISO due date and rejects a non-date string", () => {
    expect(newTaskSchema.safeParse({ title: "a", dueAt: "2026-11-01T09:00:00Z" }).success).toBe(
      true,
    );
    expect(newTaskSchema.safeParse({ title: "a", dueAt: "tomorrow" }).success).toBe(false);
  });
});
