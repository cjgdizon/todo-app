import { createApp } from './app.js'
import { openDb } from './db.js'

const DEFAULT_PORT = 3000

const db = openDb(process.env.DB_PATH ?? 'todo.db')
const port = Number(process.env.PORT) || DEFAULT_PORT

createApp(db).listen(port, () => {
  process.stdout.write(`todo server listening on http://localhost:${port}\n`)
})
