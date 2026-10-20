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

export const taskIdSchema = z.coerce
  .number({ error: 'Task id must be a positive integer' })
  .int('Task id must be a positive integer')
  .positive('Task id must be a positive integer')

export const createTaskSchema = z.object({ title: titleSchema }, { error: TITLE_REQUIRED })
