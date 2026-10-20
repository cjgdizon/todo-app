import { z } from 'zod'
import { MAX_TITLE_LENGTH } from './limits.js'

const TITLE_REQUIRED = 'Title is required'

const titleSchema = z
  .string({
    error: (issue) => (issue.input === undefined ? TITLE_REQUIRED : 'Title must be a string'),
  })
  .trim()
  .min(1, TITLE_REQUIRED)
  .max(MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters`)

export const createTaskSchema = z.object({ title: titleSchema }, { error: TITLE_REQUIRED })
