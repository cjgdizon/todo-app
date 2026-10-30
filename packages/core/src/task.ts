export const PRIORITIES = [1, 2, 3, 4] as const;
/** 1 is the highest priority; 4 is the default (none). */
export type Priority = (typeof PRIORITIES)[number];
