import type { Db } from './db.js'

export interface Task {
  id: number
  title: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

interface TaskRow {
  id: number
  title: string
  completed: number
  created_at: string
  updated_at: string
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createTask(db: Db, title: string): Task {
  const { lastInsertRowid } = db.prepare('INSERT INTO tasks (title) VALUES (?)').run(title)
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(lastInsertRowid) as TaskRow
  return toTask(row)
}
