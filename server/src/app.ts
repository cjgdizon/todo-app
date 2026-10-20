import express, { type ErrorRequestHandler, type RequestHandler } from 'express'
import { STATUS_CODES } from 'node:http'
import type { Db } from './db.js'
import { createTasksRouter } from './tasks.routes.js'

const BODY_LIMIT = '10kb'

const CLIENT_ERROR_MESSAGES: Record<string, string> = {
  'entity.parse.failed': 'Malformed JSON body',
  'entity.too.large': 'Request body too large',
  'encoding.unsupported': 'Unsupported content encoding',
  'charset.unsupported': 'Unsupported charset',
}

function clientErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined
}

const handleNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { message: 'Not found' } })
}

const handleError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }

  const status = clientErrorStatus(err)
  if (status !== undefined) {
    const message = CLIENT_ERROR_MESSAGES[err.type] ?? STATUS_CODES[status] ?? 'Bad request'
    res.status(status).json({ error: { message } })
    return
  }

  console.error('Unhandled error', err)
  res.status(500).json({ error: { message: 'Internal server error' } })
}

export function createApp(db: Db): express.Express {
  const app = express()
  app.use(express.json({ limit: BODY_LIMIT }))
  app.use('/api/tasks', createTasksRouter(db))
  app.use(handleNotFound)
  app.use(handleError)
  return app
}
