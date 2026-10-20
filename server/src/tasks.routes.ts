import { Router } from 'express'
import type { Db } from './db.js'
import { completeTask, createTask, listTasks } from './tasks.repo.js'
import { createTaskSchema, taskIdSchema } from './tasks.schema.js'

export function createTasksRouter(db: Db): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listTasks(db))
  })

  router.post('/:id/complete', (req, res) => {
    const id = taskIdSchema.safeParse(req.params.id)
    if (!id.success) {
      res.status(400).json({ error: { message: id.error.issues[0]?.message ?? 'Invalid task id' } })
      return
    }

    const task = completeTask(db, id.data)
    if (!task) {
      res.status(404).json({ error: { message: 'Task not found' } })
      return
    }

    res.json(task)
  })

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
