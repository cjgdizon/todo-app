import { DateTime } from "luxon";
import type { Priority } from "./task.ts";
import { zoned } from "./zoned.ts";

/**
 * Filter query language, e.g. `p1 & #work & due:this week`.
 *
 *   p1..p4                     priority
 *   #project   @label          project / label name (case-insensitive)
 *   due:today | tomorrow | overdue | none | this week | next week | next 7 days | YYYY-MM-DD
 *   no date                    same as due:none
 *   word   "exact phrase"      text in title or notes (case-insensitive)
 *   a & b   a b   a | b   !a   ( ... )     AND (explicit or implicit), OR, NOT, grouping
 *
 * `&` binds tighter than `|`. Dates are evaluated in the user's time zone with
 * weeks starting on Monday. All-day tasks are overdue only after their day ends.
 */

export class FilterParseError extends Error {
  readonly position: number;

  // No parameter property: plain Node (and Deno) type stripping only erases types.
  constructor(message: string, position: number) {
    super(message);
    this.name = "FilterParseError";
    this.position = position;
  }
}

export type DueRange =
  | { kind: "today" | "tomorrow" | "overdue" | "none" | "this-week" | "next-week" | "next-7-days" }
  | { kind: "date"; date: string };

export type FilterNode =
  | { type: "and" | "or"; left: FilterNode; right: FilterNode }
  | { type: "not"; node: FilterNode }
  | { type: "priority"; value: Priority }
  | { type: "project"; name: string }
  | { type: "label"; name: string }
  | { type: "due"; range: DueRange }
  | { type: "text"; text: string };

export interface FilterTask {
  title: string;
  notes: string | null;
  priority: Priority;
  projectName: string | null;
  labelNames: readonly string[];
  dueAt: Date | null;
  dueAllDay: boolean;
  completedAt: Date | null;
}

export interface FilterContext {
  now: Date;
  timeZone: string;
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type Token =
  | { type: "lparen" | "rparen" | "and" | "or" | "not"; pos: number }
  | { type: "term"; node: FilterNode; pos: number };

const WORD_END = /[\s()&|!"]/;
const DUE_VALUE =
  /^(this week|next week|next 7 days|today|tomorrow|overdue|none|\d{4}-\d{2}-\d{2})(?=$|[\s()&|!"])/i;
const DUE_KINDS: Record<string, DueRange> = {
  today: { kind: "today" },
  tomorrow: { kind: "tomorrow" },
  overdue: { kind: "overdue" },
  none: { kind: "none" },
  "this week": { kind: "this-week" },
  "next week": { kind: "next-week" },
  "next 7 days": { kind: "next-7-days" },
};

function readWord(input: string, from: number): string {
  let end = from;
  while (end < input.length && !WORD_END.test(input.charAt(end))) end++;
  return input.slice(from, end);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === "(") {
      tokens.push({ type: "lparen", pos: i++ });
    } else if (ch === ")") {
      tokens.push({ type: "rparen", pos: i++ });
    } else if (ch === "&") {
      tokens.push({ type: "and", pos: i++ });
    } else if (ch === "|") {
      tokens.push({ type: "or", pos: i++ });
    } else if (ch === "!") {
      tokens.push({ type: "not", pos: i++ });
    } else if (ch === '"') {
      const close = input.indexOf('"', i + 1);
      if (close === -1) throw new FilterParseError("Unterminated quote", i);
      const text = input.slice(i + 1, close);
      if (!text.trim()) throw new FilterParseError("Empty quoted text", i);
      tokens.push({ type: "term", node: { type: "text", text }, pos: i });
      i = close + 1;
    } else {
      const start = i;
      const word = readWord(input, i);
      const lower = word.toLowerCase();

      if (lower.startsWith("due:")) {
        const rest = input.slice(i + 4);
        const m = DUE_VALUE.exec(rest);
        if (!m?.[1]) {
          const bad = readWord(input, i + 4);
          throw new FilterParseError(`Unknown due value "${bad}"`, i + 4);
        }
        const value = m[1].toLowerCase();
        let range: DueRange;
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          if (!DateTime.fromISO(value).isValid) {
            throw new FilterParseError(`Invalid date "${value}"`, i + 4);
          }
          range = { kind: "date", date: value };
        } else {
          range = DUE_KINDS[value] as DueRange;
        }
        tokens.push({ type: "term", node: { type: "due", range }, pos: start });
        i += 4 + m[1].length;
      } else if (lower === "no" && /^\s+date(?=$|[\s()&|!"])/i.test(input.slice(i + word.length))) {
        const m = /^\s+date/i.exec(input.slice(i + word.length));
        tokens.push({ type: "term", node: { type: "due", range: { kind: "none" } }, pos: start });
        i += word.length + (m?.[0].length ?? 0);
      } else if (/^p[1-4]$/i.test(word)) {
        const value = Number(word.slice(1)) as Priority;
        tokens.push({ type: "term", node: { type: "priority", value }, pos: start });
        i += word.length;
      } else if (word.startsWith("#") || word.startsWith("@")) {
        const name = word.slice(1);
        if (!name) throw new FilterParseError(`Expected a name after "${word}"`, start);
        const node: FilterNode =
          word[0] === "#" ? { type: "project", name } : { type: "label", name };
        tokens.push({ type: "term", node, pos: start });
        i += word.length;
      } else {
        tokens.push({ type: "term", node: { type: "text", text: word }, pos: start });
        i += word.length;
      }
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent): or > and (explicit or implicit) > not > atom
// ---------------------------------------------------------------------------

/** Matches the length cap on `saved_filters.query` in the database. */
export const MAX_FILTER_LENGTH = 500;
/** Deepest nesting of parentheses and negations, so hostile input cannot overflow the stack. */
export const MAX_FILTER_DEPTH = 50;

export function parseFilter(query: string): FilterNode {
  if (query.length > MAX_FILTER_LENGTH) {
    throw new FilterParseError(`Filter is too long (at most ${MAX_FILTER_LENGTH} characters)`, MAX_FILTER_LENGTH);
  }
  const tokens = tokenize(query);
  if (tokens.length === 0) throw new FilterParseError("Filter is empty", 0);

  let index = 0;
  let depth = 0;
  const descend = (pos: number) => {
    depth++;
    if (depth > MAX_FILTER_DEPTH) throw new FilterParseError("Filter is nested too deeply", pos);
  };
  const peek = (): Token | undefined => tokens[index];
  const endPos = query.length;

  function parseOr(): FilterNode {
    let left = parseAnd();
    while (peek()?.type === "or") {
      index++;
      left = { type: "or", left, right: parseAnd() };
    }
    return left;
  }

  function startsTerm(token: Token | undefined): boolean {
    return token?.type === "term" || token?.type === "not" || token?.type === "lparen";
  }

  function parseAnd(): FilterNode {
    let left = parseNot();
    for (;;) {
      const next = peek();
      if (next?.type === "and") {
        index++;
        left = { type: "and", left, right: parseNot() };
      } else if (startsTerm(next)) {
        left = { type: "and", left, right: parseNot() };
      } else {
        return left;
      }
    }
  }

  function parseNot(): FilterNode {
    const token = peek();
    if (token?.type === "not") {
      descend(token.pos);
      index++;
      const node: FilterNode = { type: "not", node: parseNot() };
      depth--;
      return node;
    }
    return parseAtom();
  }

  function parseAtom(): FilterNode {
    const token = peek();
    if (!token) throw new FilterParseError("Unexpected end of filter", endPos);
    if (token.type === "term") {
      index++;
      return token.node;
    }
    if (token.type === "lparen") {
      descend(token.pos);
      index++;
      const inner = parseOr();
      const close = peek();
      if (close?.type !== "rparen") {
        throw new FilterParseError('Missing closing ")"', close?.pos ?? endPos);
      }
      index++;
      depth--;
      return inner;
    }
    throw new FilterParseError("Unexpected operator", token.pos);
  }

  const node = parseOr();
  const leftover = peek();
  if (leftover) throw new FilterParseError("Unexpected token", leftover.pos);
  return node;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function matchesDue(range: DueRange, task: FilterTask, now: DateTime, zone: string): boolean {
  if (range.kind === "none") return task.dueAt === null;
  if (task.dueAt === null) return false;

  const due = zoned(task.dueAt, zone);
  switch (range.kind) {
    case "today":
      return due.hasSame(now, "day");
    case "tomorrow":
      return due.hasSame(now.plus({ days: 1 }), "day");
    case "overdue": {
      if (task.completedAt !== null) return false;
      const end = task.dueAllDay ? due.endOf("day") : due;
      return end < now;
    }
    case "this-week": {
      const start = now.startOf("week");
      return due >= start && due < start.plus({ weeks: 1 });
    }
    case "next-week": {
      const start = now.startOf("week").plus({ weeks: 1 });
      return due >= start && due < start.plus({ weeks: 1 });
    }
    case "next-7-days": {
      const start = now.startOf("day");
      return due >= start && due < start.plus({ days: 7 });
    }
    case "date":
      return due.toISODate() === range.date;
  }
}

export function matchesFilter(node: FilterNode, task: FilterTask, ctx: FilterContext): boolean {
  const now = zoned(ctx.now, ctx.timeZone);
  const text = `${task.title}\n${task.notes ?? ""}`.toLowerCase();

  const visit = (n: FilterNode): boolean => {
    switch (n.type) {
      case "and":
        return visit(n.left) && visit(n.right);
      case "or":
        return visit(n.left) || visit(n.right);
      case "not":
        return !visit(n.node);
      case "priority":
        return task.priority === n.value;
      case "project":
        return task.projectName?.toLowerCase() === n.name.toLowerCase();
      case "label":
        return task.labelNames.some((l) => l.toLowerCase() === n.name.toLowerCase());
      case "due":
        return matchesDue(n.range, task, now, ctx.timeZone);
      case "text":
        return text.includes(n.text.toLowerCase());
    }
  };
  return visit(node);
}
