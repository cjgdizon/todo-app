import { useMemo, useSyncExternalStore } from "react";

/**
 * A focus session (Pomodoro) is an ordinary running timer plus the time it should end, remembered
 * in this browser. Nothing else about it is stored: the tracked time is the timer's own entry.
 */

const KEY = "todo-focus";
export const FOCUS_MS = 25 * 60 * 1000;

export interface Focus {
  /** The time entry (timer) the session belongs to. */
  entryId: string;
  /** When it should end, in epoch milliseconds. */
  endsAt: number;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // storage can be blocked (private windows); focus sessions then just do not start
  }
}

function parseFocus(raw: string | null): Focus | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { entryId, endsAt } = value as Record<string, unknown>;
    return typeof entryId === "string" && typeof endsAt === "number" ? { entryId, endsAt } : null;
  } catch {
    return null;
  }
}

export const readFocus = (): Focus | null => parseFocus(readRaw());

export function startFocus(entryId: string, now: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ entryId, endsAt: now + FOCUS_MS } satisfies Focus));
  } catch {
    // Not saved: the timer still runs, just without a countdown.
  }
  notify();
}

export function clearFocus(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to clear.
  }
  notify();
}

export function subscribeFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Milliseconds left (negative once over) if `focus` belongs to the running timer, else null. */
export function focusRemaining(focus: Focus | null, runningEntryId: string | undefined, now: number): number | null {
  if (!focus || focus.entryId !== runningEntryId) return null;
  return focus.endsAt - now;
}

export function useFocus(): Focus | null {
  const raw = useSyncExternalStore(subscribeFocus, readRaw, () => null);
  return useMemo(() => parseFocus(raw), [raw]);
}
