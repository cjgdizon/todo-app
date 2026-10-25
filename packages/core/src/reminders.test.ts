import { describe, expect, it } from "vitest";
import { buildReminderMessages, chunk, readPushTickets, taskIdFromPush, type DueReminder } from "./reminders.ts";

const reminder = (overrides: Partial<DueReminder> = {}): DueReminder => ({
  reminderId: "r1",
  userId: "u1",
  taskId: "t1",
  workspaceId: "w1",
  title: "Call the bank",
  dueAt: new Date("2030-03-15T02:30:00Z"),
  dueAllDay: false,
  timeZone: "Asia/Manila",
  tokens: ["ExponentPushToken[aaa]"],
  ...overrides,
});

describe("buildReminderMessages", () => {
  it("makes one message per device, worded in the person's own time zone", () => {
    const messages = buildReminderMessages([reminder({ tokens: ["ExponentPushToken[aaa]", "ExponentPushToken[bbb]"] })]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      to: "ExponentPushToken[aaa]",
      title: "Call the bank",
      body: "Due 2030-03-15 at 10:30",
      sound: "default",
      priority: "high",
      channelId: "reminders",
      data: { taskId: "t1", workspaceId: "w1" },
    });
    expect(messages[1]?.to).toBe("ExponentPushToken[bbb]");
  });

  it("words an all-day task without a time", () => {
    const [message] = buildReminderMessages([reminder({ dueAllDay: true, dueAt: new Date("2030-03-14T16:00:00Z") })]);
    expect(message?.body).toBe("Due 2030-03-15");
  });

  it("shortens a very long title and survives an unknown time zone", () => {
    const [message] = buildReminderMessages([reminder({ title: "x".repeat(300), timeZone: "Not/AZone" })]);
    expect(message?.title).toHaveLength(100);
    expect(message?.body).toBe("Due 2030-03-15 at 02:30");
  });

  it("skips people with no devices", () => {
    expect(buildReminderMessages([reminder({ tokens: [] })])).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits a list into batches of at most the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("refuses a size below one", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("readPushTickets", () => {
  const messages = buildReminderMessages([reminder({ tokens: ["ExponentPushToken[a]", "ExponentPushToken[b]", "ExponentPushToken[c]"] })]);

  it("counts delivered messages and collects devices that no longer exist", () => {
    const result = readPushTickets(messages, {
      data: [
        { status: "ok", id: "1" },
        { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
        { status: "error", message: "slow down", details: { error: "MessageRateExceeded" } },
      ],
    });
    expect(result).toEqual({ sent: 1, failed: 2, deadTokens: ["ExponentPushToken[b]"] });
  });

  it("treats a response it cannot read as all failed, without guessing about devices", () => {
    expect(readPushTickets(messages, { errors: [{ code: "BAD" }] })).toEqual({ sent: 0, failed: 3, deadTokens: [] });
    expect(readPushTickets(messages, null)).toEqual({ sent: 0, failed: 3, deadTokens: [] });
    expect(readPushTickets(messages, { data: [{ status: "ok", id: "1" }] })).toEqual({ sent: 0, failed: 3, deadTokens: [] });
  });
});

describe('taskIdFromPush', () => {
  it('reads the task a reminder notification is about', () => {
    const [message] = buildReminderMessages([reminder({ taskId: '6f1c1d0e-3b1f-4c55-9a53-0a6c7a1c2d3e' })]);
    expect(taskIdFromPush(message?.data)).toBe('6f1c1d0e-3b1f-4c55-9a53-0a6c7a1c2d3e');
  });

  it.each([undefined, null, 'x', {}, { taskId: 7 }, { taskId: '../../etc' }, { taskId: 'not-a-uuid' }])(
    'ignores a payload that is not a task id: %j',
    (data) => {
      expect(taskIdFromPush(data)).toBeNull();
    },
  );
});
