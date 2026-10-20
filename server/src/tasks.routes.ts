import { Router } from 'express'
import type { Db } from './db.js'
import { createTask } from './tasks.repo.js'
import { createTaskSchema } from './tasks.schema.js'

export function createTasksRouter(db: Db): Router {
  const router = Router()

  router.post('/', (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: { message: parsed.error.issues[0]?.message ?? 'Invalid request' } })
      return
    }

    res.status(201).json(createTask(db, parsed.data.title))
  })

  return router
}
