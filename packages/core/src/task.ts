import { z } from "zod";

export const PRIORITIES = [1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAX_TITLE_LENGTH = 500;

/** Input accepted when creating a task. Priority 1 is highest; 4 is the default (none). */
export const newTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(MAX_TITLE_LENGTH),
  notes: z.string().optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(4),
  dueAt: z.string().datetime().optional(),
});

export type NewTask = z.infer<typeof newTaskSchema>;
