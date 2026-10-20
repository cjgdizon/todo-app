import { describe, expect, it } from "vitest";
import {
  ExchangeError,
  IMPORT_LIMITS,
  parseExport,
  parseTasksCsv,
  serializeExport,
  tasksToCsv,
  type ExchangeData,
  type ExchangeTask,
} from "./exchange.ts";

const task = (overrides: Partial<ExchangeTask> & { id: string; title: string }): ExchangeTask => ({
  parentId: null,
  projectId: null,
  sectionId: null,
  notes: null,
  priority: 4,
  dueAt: null,
  dueAllDay: false,
  dueTz: null,
  rrule: null,
  recurAfterCompletion: false,
  completedAt: null,
  labelIds: [],
  ...overrides,
});

const sample: ExchangeData = {
  projects: [{ id: "p1", name: "Home", color: "#3f7d6b", archived: false }],
  sections: [{ id: "s1", projectId: "p1", name: "Doing" }],
  labels: [{ id: "l1", name: "bills", color: null }],
  tasks: [
    task({
      id: "t1",
      title: "Pay rent",
      notes: "Bring cash, again",
      priority: 2,
      projectId: "p1",
      sectionId: "s1",
      dueAt: "2026-11-01T01:00:00.000Z",
      dueTz: "Asia/Manila",
      rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
      labelIds: ["l1"],
    }),
    task({ id: "t2", title: "Find receipt", parentId: "t1", projectId: "p1" }),
    task({
      id: "t3",
      title: "=SUM(A1)",
      dueAt: "2026-10-20T16:00:00.000Z",
      dueAllDay: true,
      dueTz: "Asia/Manila",
      completedAt: "2026-10-20T10:00:00.000Z",
    }),
  ],
};

describe("serializeExport and parseExport", () => {
  it("round-trips the data", () => {
    const text = serializeExport(sample, new Date("2026-10-21T00:00:00Z"));
    const parsed = parseExport(text);
    expect(parsed.data).toEqual(sample);
    expect(parsed.warnings).toEqual([]);
  });

  it("labels the file with its format, version and time", () => {
    const file = JSON.parse(serializeExport(sample, new Date("2026-10-21T00:00:00Z")));
    expect(file).toMatchObject({ format: "todo-export", version: 1, exportedAt: "2026-10-21T00:00:00.000Z" });
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseExport("not json")).toThrow(ExchangeError);
    expect(() => parseExport("not json")).toThrow(/JSON/);
  });

  it("rejects JSON that is not one of our exports", () => {
    expect(() => parseExport(JSON.stringify({ hello: "world" }))).toThrow(/export/i);
    expect(() => parseExport("[]")).toThrow(ExchangeError);
  });

  it("rejects a version it does not know", () => {
    const file = JSON.parse(serializeExport(sample, new Date()));
    file.version = 2;
    expect(() => parseExport(JSON.stringify(file))).toThrow(/version/i);
  });

  it("rejects a file with too many tasks", () => {
    const many = {
      format: "todo-export",
      version: 1,
      exportedAt: "2026-10-21T00:00:00.000Z",
      projects: [],
      sections: [],
      labels: [],
      tasks: Array.from({ length: IMPORT_LIMITS.tasks + 1 }, (_, i) => task({ id: `t${i}`, title: "x" })),
    };
    expect(() => parseExport(JSON.stringify(many))).toThrow(/too many/i);
  });

  it("skips an invalid task with a warning and keeps the rest", () => {
    const file = JSON.parse(serializeExport(sample, new Date()));
    file.tasks[1].priority = 9;
    file.tasks[2].title = "";
    const parsed = parseExport(JSON.stringify(file));
    expect(parsed.data.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(parsed.warnings).toHaveLength(2);
    expect(parsed.warnings.join(" ")).toMatch(/priority/i);
  });

  it("skips a task with an over-long title and an unreadable date", () => {
    const file = JSON.parse(serializeExport(sample, new Date()));
    file.tasks[0].title = "x".repeat(IMPORT_LIMITS.titleLength + 1);
    file.tasks[1].dueAt = "next tuesday";
    const parsed = parseExport(JSON.stringify(file));
    expect(parsed.data.tasks.map((t) => t.id)).toEqual(["t3"]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it("ignores unknown fields instead of keeping them", () => {
    const file = JSON.parse(serializeExport(sample, new Date()));
    file.tasks[0].evil = "<script>";
    file.extra = true;
    const parsed = parseExport(JSON.stringify(file));
    expect(parsed.data.tasks[0]).not.toHaveProperty("evil");
  });
});

describe("tasksToCsv", () => {
  const zone = "Asia/Manila";

  it("writes a header and one row per task, with local dates, names and guarded formulas", () => {
    const rows = tasksToCsv(sample, zone).trim().split("\r\n");
    expect(rows[0]).toBe(
      "id,parent_id,title,notes,priority,due,all_day,repeat,repeat_after_completion,completed_at,project,section,labels",
    );
    expect(rows[1]).toBe(
      't1,,Pay rent,"Bring cash, again",2,2026-11-01 09:00,false,FREQ=MONTHLY;BYMONTHDAY=1,false,,Home,Doing,bills',
    );
    expect(rows[2]).toBe("t2,t1,Find receipt,,4,,false,,false,,Home,,");
    expect(rows[3]).toBe("t3,,'=SUM(A1),,4,2026-10-21,true,,false,2026-10-20 18:00,,,");
  });
});

describe("parseTasksCsv", () => {
  const zone = "Asia/Manila";

  it("round-trips what tasksToCsv writes, including subtasks, labels and dates", () => {
    const { data, warnings } = parseTasksCsv(tasksToCsv(sample, zone), zone);
    expect(warnings).toEqual([]);

    const byId = new Map(data.tasks.map((t) => [t.id, t]));
    const rent = byId.get("t1");
    expect(rent).toMatchObject({
      title: "Pay rent",
      notes: "Bring cash, again",
      priority: 2,
      dueAt: "2026-11-01T01:00:00.000Z",
      dueAllDay: false,
      rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
    });
    expect(byId.get("t2")?.parentId).toBe("t1");
    expect(byId.get("t3")).toMatchObject({
      title: "=SUM(A1)",
      dueAllDay: true,
      dueAt: "2026-10-20T16:00:00.000Z",
      completedAt: "2026-10-20T10:00:00.000Z",
    });

    const projectName = (id: string | null) => data.projects.find((p) => p.id === id)?.name;
    const sectionName = (id: string | null) => data.sections.find((s) => s.id === id)?.name;
    const labelNames = (ids: string[]) => ids.map((id) => data.labels.find((l) => l.id === id)?.name);
    expect(projectName(rent?.projectId ?? null)).toBe("Home");
    expect(sectionName(rent?.sectionId ?? null)).toBe("Doing");
    expect(labelNames(rent?.labelIds ?? [])).toEqual(["bills"]);
    expect(data.projects).toHaveLength(1);
  });

  it("reads a hand-written file with only a title column", () => {
    const { data, warnings } = parseTasksCsv("Title\nBuy milk\nCall mom\n", zone);
    expect(warnings).toEqual([]);
    expect(data.tasks.map((t) => t.title)).toEqual(["Buy milk", "Call mom"]);
    expect(new Set(data.tasks.map((t) => t.id)).size).toBe(2);
  });

  it("accepts p1-p4 priorities and several date styles", () => {
    const csv = "title,priority,due\nA,p1,2026-11-05\nB,3,2026-11-05 15:30\nC,,2026-11-05T15:30:00Z\n";
    const { data, warnings } = parseTasksCsv(csv, zone);
    expect(warnings).toEqual([]);
    const [a, b, c] = data.tasks;
    expect(a).toMatchObject({ priority: 1, dueAllDay: true, dueAt: "2026-11-04T16:00:00.000Z" });
    expect(b).toMatchObject({ priority: 3, dueAllDay: false, dueAt: "2026-11-05T07:30:00.000Z" });
    expect(c).toMatchObject({ priority: 4, dueAllDay: false, dueAt: "2026-11-05T15:30:00.000Z" });
  });

  it("warns about a bad priority or date, keeps the task, and drops only the bad value", () => {
    const { data, warnings } = parseTasksCsv("title,priority,due\nA,urgent,someday\n", zone);
    expect(data.tasks[0]).toMatchObject({ title: "A", priority: 4, dueAt: null });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/row 2/i);
  });

  it("skips a row without a title", () => {
    const { data, warnings } = parseTasksCsv("title,notes\n,orphan notes\nReal,\n", zone);
    expect(data.tasks.map((t) => t.title)).toEqual(["Real"]);
    expect(warnings).toHaveLength(1);
  });

  it("matches column names regardless of case and ignores extra columns", () => {
    const { data } = parseTasksCsv("TITLE,Whatever,Notes\nA,zzz,some notes\n", zone);
    expect(data.tasks[0]).toMatchObject({ title: "A", notes: "some notes" });
  });

  it("warns when a parent_id does not exist and makes the task top-level", () => {
    const { data, warnings } = parseTasksCsv("id,parent_id,title\na,missing,A\n", zone);
    expect(data.tasks[0]?.parentId).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("requires a title column", () => {
    expect(() => parseTasksCsv("name,notes\nx,y\n", zone)).toThrow(/title/i);
  });

  it("rejects an empty file and one with too many rows", () => {
    expect(() => parseTasksCsv("", zone)).toThrow(ExchangeError);
    const rows = Array.from({ length: IMPORT_LIMITS.tasks + 1 }, (_, i) => `task ${i}`).join("\n");
    expect(() => parseTasksCsv(`title\n${rows}\n`, zone)).toThrow(/too many/i);
  });

  it("wraps a malformed CSV in an ExchangeError", () => {
    expect(() => parseTasksCsv('title\n"oops\n', zone)).toThrow(ExchangeError);
  });

  it("gives a repeated id a new one and says so", () => {
    const { data, warnings } = parseTasksCsv("id,title\nx,first\nx,second\n", zone);
    expect(data.tasks.map((t) => t.id)).toEqual(["x", "row-3"]);
    expect(warnings).toHaveLength(1);
  });

  it("skips a row whose title or notes are too long", () => {
    const longTitle = "t".repeat(IMPORT_LIMITS.titleLength + 1);
    const longNotes = "n".repeat(IMPORT_LIMITS.notesLength + 1);
    const { data, warnings } = parseTasksCsv(`title,notes\n${longTitle},\nok,${longNotes}\nfine,\n`, zone);
    expect(data.tasks.map((t) => t.title)).toEqual(["fine"]);
    expect(warnings).toHaveLength(2);
  });

  it("needs a project for a section, and otherwise creates both", () => {
    const { data, warnings } = parseTasksCsv("title,project,section\nA,,Orphan\nB,Home,Doing\nC,home,doing\n", zone);
    expect(warnings).toHaveLength(1);
    expect(data.projects.map((p) => p.name)).toEqual(["Home"]);
    expect(data.sections).toHaveLength(1);
    expect(data.tasks[0]?.sectionId).toBeNull();
    expect(data.tasks[1]?.sectionId).toBe(data.tasks[2]?.sectionId);
  });

  it("reads labels separated by semicolons, removes repeats and ignores a name that is too long", () => {
    const tooLong = "l".repeat(IMPORT_LIMITS.labelNameLength + 1);
    const { data, warnings } = parseTasksCsv(`title,labels\nA,"a; B ;a;;${tooLong}"\n`, zone);
    expect(data.labels.map((l) => l.name)).toEqual(["a", "B"]);
    expect(data.tasks[0]?.labelIds).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  it("ignores a project name that is too long", () => {
    const tooLong = "p".repeat(IMPORT_LIMITS.nameLength + 1);
    const { data, warnings } = parseTasksCsv(`title,project\nA,${tooLong}\n`, zone);
    expect(data.projects).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("reads repeat settings, completion times and ISO times with an offset", () => {
    const csv =
      "title,due,repeat,repeat_after_completion,completed_at\n" +
      "A,2026-11-05T15:30:00+08:00,FREQ=DAILY,yes,2026-10-20 18:00\n" +
      "B,2026-13-45,,,not a time\n";
    const { data, warnings } = parseTasksCsv(csv, zone);
    expect(data.tasks[0]).toMatchObject({
      dueAt: "2026-11-05T07:30:00.000Z",
      rrule: "FREQ=DAILY",
      recurAfterCompletion: true,
      completedAt: "2026-10-20T10:00:00.000Z",
    });
    expect(data.tasks[1]).toMatchObject({ dueAt: null, completedAt: null });
    expect(warnings).toHaveLength(2);
  });

  it("summarises a flood of warnings instead of listing them all", () => {
    const rows = Array.from({ length: 150 }, () => ",no title").join("\n");
    const { warnings } = parseTasksCsv(`title,notes\n${rows}\nreal,\n`, zone);
    expect(warnings).toHaveLength(101);
    expect(warnings[100]).toMatch(/and 50 more/);
  });
});

describe("parseExport: odd files", () => {
  const file = (body: Record<string, unknown>) =>
    JSON.stringify({ format: "todo-export", version: 1, exportedAt: "2026-10-21T00:00:00.000Z", ...body });

  it("treats a missing list as empty", () => {
    expect(parseExport(file({})).data).toEqual({ projects: [], sections: [], labels: [], tasks: [] });
  });

  it("rejects a list that is not a list", () => {
    expect(() => parseExport(file({ tasks: "nope" }))).toThrow(/not a list/);
  });

  it("skips invalid projects, sections and labels with a warning each", () => {
    const parsed = parseExport(
      file({
        projects: [{ id: "p", name: "" }, { id: "ok", name: "Fine" }],
        sections: [{ id: "s", projectId: "ok" }],
        labels: [{ id: "l", name: "x".repeat(IMPORT_LIMITS.labelNameLength + 1) }, 5],
      }),
    );
    expect(parsed.data.projects.map((p) => p.name)).toEqual(["Fine"]);
    expect(parsed.data.sections).toEqual([]);
    expect(parsed.data.labels).toEqual([]);
    expect(parsed.warnings).toHaveLength(4);
  });

  it("fills in defaults for fields a hand-written file leaves out", () => {
    const parsed = parseExport(file({ tasks: [{ id: "t", title: "Minimal" }] }));
    expect(parsed.data.tasks[0]).toEqual({
      id: "t",
      parentId: null,
      projectId: null,
      sectionId: null,
      title: "Minimal",
      notes: null,
      priority: 4,
      dueAt: null,
      dueAllDay: false,
      dueTz: null,
      rrule: null,
      recurAfterCompletion: false,
      completedAt: null,
      labelIds: [],
    });
  });
});
