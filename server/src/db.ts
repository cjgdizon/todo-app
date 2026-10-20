import Database from 'better-sqlite3'
import { MAX_TITLE_LENGTH } from './limits.js'

export type Db = Database.Database

const ISO_UTC_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND ${MAX_TITLE_LENGTH}),
    completed  INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (${ISO_UTC_NOW}),
    updated_at TEXT NOT NULL DEFAULT (${ISO_UTC_NOW})
  )
`

export function openDb(path: string): Db {
  const db = new Database(path)
  db.exec(SCHEMA)
  return db
}
