import { z } from "zod";
import { parseCsv, toCsv } from "./csv.ts";
import { instantToLocal, localToInstant } from "./zoned.ts";

/**
 * The file formats for moving tasks in and out: a versioned JSON file that round-trips
 * everything, and a CSV with a documented set of columns. Files are untrusted input: every
 * field is checked against the same limits as the database, and an invalid item is skipped
 * with a warning instead of failing the whole file.
 */

export const IMPORT_LIMITS = {
  tasks: 10_000,
  projects: 500,
  sections: 2_000,
  labels: 500,
  titleLength: 500,
  notesLength: 50_000,
  nameLength: 100,
  labelNameLength: 50,
} as const;

const MAX_WARNINGS = 100;

export const EXPORT_FORMAT = "todo-export";
export const EXPORT_VERSION = 1;

export interface ExchangeProject {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
}
export interface ExchangeSection {
  id: string;
  projectId: string;
  name: string;
}
export interface ExchangeLabel {
  id: string;
  name: string;
  color: string | null;
}
export interface ExchangeTask {
  id: string;
  parentId: string | null;
  projectId: string | null;
  sectionId: string | null;
  title: string;
  notes: string | null;
  priority: 1 | 2 | 3 | 4;
  /** ISO 8601 instant. */
  dueAt: string | null;
  dueAllDay: boolean;
  dueTz: string | null;
  rrule: string | null;
  recurAfterCompletion: boolean;
  completedAt: string | null;
  labelIds: string[];
}
/** Everything in a file, in display order. Ids only link things within the file. */
export interface ExchangeData {
  projects: ExchangeProject[];
  sections: ExchangeSection[];
  labels: ExchangeLabel[];
  tasks: ExchangeTask[];
}

export interface ParseResult {
  data: ExchangeData;
  /** Things that were skipped or changed, each saying which item and why. */
  warnings: string[];
}

/** A file that cannot be imported at all (as opposed to an item that is skipped). */
export class ExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeError";
  }
}

/** Keeps the first warnings and summarises the rest, so a huge bad file cannot flood the screen. */
export const capWarnings = (warnings: string[]): string[] =>
  warnings.length <= MAX_WARNINGS
    ? warnings
    : [...warnings.slice(0, MAX_WARNINGS), `…and ${warnings.length - MAX_WARNINGS} more`];

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

const id = z.string().min(1).max(100);
const instant = z
  .string()
  .refine((text) => /^\d{4}-\d{2}-\d{2}T/.test(text) && !Number.isNaN(Date.parse(text)), "must be an ISO 8601 date and time");
const orNull = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((value) => value ?? null);

const projectSchema = z.object({
  id,
  name: z.string().trim().min(1).max(IMPORT_LIMITS.nameLength),
  color: orNull(z.string().max(32)),
  archived: z.boolean().default(false),
});
const sectionSchema = z.object({
  id,
  projectId: id,
  name: z.string().trim().min(1).max(IMPORT_LIMITS.nameLength),
});
const labelSchema = z.object({
  id,
  name: z.string().trim().min(1).max(IMPORT_LIMITS.labelNameLength),
  color: orNull(z.string().max(32)),
});
const taskSchema = z.object({
  id,
  parentId: orNull(id),
  projectId: orNull(id),
  sectionId: orNull(id),
  title: z.string().trim().min(1).max(IMPORT_LIMITS.titleLength),
  notes: orNull(z.string().max(IMPORT_LIMITS.notesLength)),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(4),
  dueAt: orNull(instant),
  dueAllDay: z.boolean().default(false),
  dueTz: orNull(z.string().max(64)),
  rrule: orNull(z.string().max(500)),
  recurAfterCompletion: z.boolean().default(false),
  completedAt: orNull(instant),
  labelIds: z.array(id).max(100).default([]),
});

/** The data as a JSON file others can read back with `parseExport`. */
export function serializeExport(data: ExchangeData, exportedAt: Date): string {
  return JSON.stringify(
    { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: exportedAt.toISOString(), ...data },
    null,
    2,
  );
}

/** Items of one kind: valid ones are kept, invalid ones become warnings. */
function parseItems<T>(
  kind: string,
  items: unknown,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  limit: number,
  warnings: string[],
): T[] {
  if (items === undefined) return [];
  if (!Array.isArray(items)) throw new ExchangeError(`The file's ${kind} list is not a list`);
  if (items.length > limit) {
    throw new ExchangeError(`The file has too many ${kind} (${items.length}); the limit is ${limit}`);
  }
  const kept: T[] = [];
  items.forEach((item, index) => {
    const result = schema.safeParse(item);
    if (result.success) {
      kept.push(result.data);
      return;
    }
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    const title = typeof (item as { title?: unknown })?.title === "string" ? ` "${(item as { title: string }).title.slice(0, 40)}"` : "";
    warnings.push(`Skipped ${kind.replace(/s$/, "")} ${index + 1}${title}: ${where}${issue?.message ?? "invalid"}`);
  });
  return kept;
}

/** Reads a JSON export. Throws `ExchangeError` if it is not a usable file. */
export function parseExport(text: string): ParseResult {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new ExchangeError("That file is not valid JSON");
  }
  if (typeof file !== "object" || file === null || Array.isArray(file) || (file as { format?: unknown }).format !== EXPORT_FORMAT) {
    throw new ExchangeError("That file is not a Todo export");
  }
  const body = file as Record<string, unknown>;
  if (body.version !== EXPORT_VERSION) {
    throw new ExchangeError(`This export has version ${String(body.version)}, which this app cannot read`);
  }

  const warnings: string[] = [];
  const data: ExchangeData = {
    projects: parseItems("projects", body.projects, projectSchema, IMPORT_LIMITS.projects, warnings),
    sections: parseItems("sections", body.sections, sectionSchema, IMPORT_LIMITS.sections, warnings),
    labels: parseItems("labels", body.labels, labelSchema, IMPORT_LIMITS.labels, warnings),
    tasks: parseItems("tasks", body.tasks, taskSchema, IMPORT_LIMITS.tasks, warnings),
  };
  return { data, warnings: capWarnings(warnings) };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  "id",
  "parent_id",
  "title",
  "notes",
  "priority",
  "due",
  "all_day",
  "repeat",
  "repeat_after_completion",
  "completed_at",
  "project",
  "section",
  "labels",
] as const;

const localText = (iso: string, allDay: boolean, timeZone: string): string => {
  const { date, time } = instantToLocal(new Date(iso), timeZone);
  return allDay ? date : `${date} ${time}`;
};

/** The tasks as a CSV, with dates in `timeZone` and project, section and label names in place of ids. */
export function tasksToCsv(data: ExchangeData, timeZone: string): string {
  const projectName = new Map(data.projects.map((p) => [p.id, p.name]));
  const sectionName = new Map(data.sections.map((s) => [s.id, s.name]));
  const labelName = new Map(data.labels.map((l) => [l.id, l.name]));

  const rows: string[][] = [[...CSV_COLUMNS]];
  for (const task of data.tasks) {
    rows.push([
      task.id,
      task.parentId ?? "",
      task.title,
      task.notes ?? "",
      String(task.priority),
      task.dueAt ? localText(task.dueAt, task.dueAllDay, timeZone) : "",
      String(task.dueAllDay),
      task.rrule ?? "",
      String(task.recurAfterCompletion),
      task.completedAt ? localText(task.completedAt, false, timeZone) : "",
      task.projectId ? (projectName.get(task.projectId) ?? "") : "",
      task.sectionId ? (sectionName.get(task.sectionId) ?? "") : "",
      task.labelIds.map((labelId) => labelName.get(labelId) ?? "").filter(Boolean).join("; "),
    ]);
  }
  return toCsv(rows);
}

/** A date (all day), a local date and time, or a full ISO instant. Null if it is none of those. */
function parseWhen(text: string, timeZone: string): { instant: Date; allDay: boolean } | null {
  const value = text.trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (dateOnly?.[1]) {
    const at = localToInstant(dateOnly[1], null, timeZone);
    return at ? { instant: at, allDay: true } : null;
  }
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(value);
  if (local?.[1] && local[2]) {
    const at = localToInstant(local[1], local[2], timeZone);
    return at ? { instant: at, allDay: false } : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : { instant: new Date(time), allDay: false };
  }
  return null;
}

const isTrue = (text: string) => /^(true|yes|y|1)$/i.test(text.trim());

/**
 * Reads a CSV with a `title` column (required) and any of: id, parent_id, notes, priority
 * (1-4 or p1-p4), due, repeat, repeat_after_completion, completed_at, project, section and
 * labels (separated by semicolons). Column names are matched without regard to case; other
 * columns are ignored. Dates without a zone are read in `timeZone`.
 */
export function parseTasksCsv(text: string, timeZone: string): ParseResult {
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    throw new ExchangeError(error instanceof Error ? error.message : "That file is not a valid CSV");
  }
  const header = rows[0];
  if (!header) throw new ExchangeError("That CSV is empty");
  if (rows.length - 1 > IMPORT_LIMITS.tasks) {
    throw new ExchangeError(`The CSV has too many rows (${rows.length - 1}); the limit is ${IMPORT_LIMITS.tasks}`);
  }

  const index = new Map(header.map((name, position) => [name.trim().toLowerCase(), position]));
  if (!index.has("title")) throw new ExchangeError("The CSV needs a title column");
  const cell = (row: readonly string[], name: string): string => {
    const position = index.get(name);
    return position === undefined ? "" : (row[position] ?? "");
  };

  const warnings: string[] = [];
  const projects = new Map<string, ExchangeProject>();
  const sections = new Map<string, ExchangeSection>();
  const labels = new Map<string, ExchangeLabel>();
  const tasks: ExchangeTask[] = [];
  const usedIds = new Set<string>();

  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    const warn = (message: string) => warnings.push(`Row ${rowNumber}: ${message}`);

    const title = cell(row, "title").trim();
    if (title === "") return warn("skipped, it has no title");
    if (title.length > IMPORT_LIMITS.titleLength) return warn(`skipped, the title is longer than ${IMPORT_LIMITS.titleLength} characters`);
    const notes = cell(row, "notes");
    if (notes.length > IMPORT_LIMITS.notesLength) return warn(`skipped, the notes are longer than ${IMPORT_LIMITS.notesLength} characters`);

    let taskId = cell(row, "id").trim() || `row-${rowNumber}`;
    if (usedIds.has(taskId)) {
      warn(`the id "${taskId}" is used twice; this row gets a new one`);
      taskId = `row-${rowNumber}`;
    }
    usedIds.add(taskId);

    const priorityText = cell(row, "priority").trim();
    const priorityMatch = /^p?([1-4])$/i.exec(priorityText);
    if (priorityText !== "" && !priorityMatch) warn(`priority "${priorityText}" is not 1 to 4, so it was set to 4`);
    const priority = (priorityMatch ? Number(priorityMatch[1]) : 4) as ExchangeTask["priority"];

    const dueText = cell(row, "due").trim();
    const due = dueText === "" ? null : parseWhen(dueText, timeZone);
    if (dueText !== "" && !due) warn(`the date "${dueText}" is not YYYY-MM-DD, YYYY-MM-DD HH:mm or an ISO time, so it was left out`);

    const doneText = cell(row, "completed_at").trim();
    const done = doneText === "" ? null : parseWhen(doneText, timeZone);
    if (doneText !== "" && !done) warn(`completed_at "${doneText}" could not be read, so the task stays open`);

    const nameOf = (value: string, limit: number, what: string): string => {
      const name = value.trim();
      if (name.length > limit) {
        warn(`the ${what} name is longer than ${limit} characters, so it was left out`);
        return "";
      }
      return name;
    };

    let projectId: string | null = null;
    const projectText = nameOf(cell(row, "project"), IMPORT_LIMITS.nameLength, "project");
    if (projectText) {
      const key = projectText.toLowerCase();
      if (!projects.has(key)) projects.set(key, { id: `project:${key}`, name: projectText, color: null, archived: false });
      projectId = `project:${key}`;
    }

    let sectionId: string | null = null;
    const sectionText = nameOf(cell(row, "section"), IMPORT_LIMITS.nameLength, "section");
    if (sectionText && !projectId) {
      warn("a section needs a project, so it was left out");
    } else if (sectionText && projectId) {
      const key = `${projectId}/${sectionText.toLowerCase()}`;
      if (!sections.has(key)) sections.set(key, { id: `section:${key}`, projectId, name: sectionText });
      sectionId = `section:${key}`;
    }

    const labelIds: string[] = [];
    for (const part of cell(row, "labels").split(";")) {
      const name = nameOf(part, IMPORT_LIMITS.labelNameLength, "label");
      if (!name) continue;
      const key = name.toLowerCase();
      if (!labels.has(key)) labels.set(key, { id: `label:${key}`, name, color: null });
      if (!labelIds.includes(`label:${key}`)) labelIds.push(`label:${key}`);
    }

    tasks.push({
      id: taskId,
      parentId: cell(row, "parent_id").trim() || null,
      projectId,
      sectionId,
      title,
      notes: notes === "" ? null : notes,
      priority,
      dueAt: due ? due.instant.toISOString() : null,
      dueAllDay: due?.allDay ?? false,
      dueTz: due ? timeZone : null,
      rrule: cell(row, "repeat").trim() || null,
      recurAfterCompletion: isTrue(cell(row, "repeat_after_completion")),
      completedAt: done ? done.instant.toISOString() : null,
      labelIds,
    });
  });

  if (projects.size > IMPORT_LIMITS.projects) throw new ExchangeError(`The CSV has too many projects (${projects.size})`);
  if (sections.size > IMPORT_LIMITS.sections) throw new ExchangeError(`The CSV has too many sections (${sections.size})`);
  if (labels.size > IMPORT_LIMITS.labels) throw new ExchangeError(`The CSV has too many labels (${labels.size})`);

  // A parent that is not in the file leaves the task at the top level.
  const known = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    if (task.parentId !== null && !known.has(task.parentId)) {
      warnings.push(`Task "${task.title}": parent_id "${task.parentId}" is not in the file, so it is a top-level task`);
      task.parentId = null;
    }
  }

  return {
    data: { projects: [...projects.values()], sections: [...sections.values()], labels: [...labels.values()], tasks },
    warnings: capWarnings(warnings),
  };
}
