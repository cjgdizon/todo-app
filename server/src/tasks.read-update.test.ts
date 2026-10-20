import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { openDb, type Db } from './db.js'

let db: Db
let app: ReturnType<typeof createApp>

beforeEach(() => {
  db = openDb(':memory:')
  app = createApp(db)
})

const addTask = async (title: string) =>
  (await request(app).post('/api/tasks').send({ title })).body as { id: number }

describe('GET /api/tasks', () => {
  it('returns an empty list when there are no tasks', async () => {
    const res = await request(app).get('/api/tasks')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns all tasks in creation order', async () => {
    await addTask('First')
    await addTask('Second')

    const res = await request(app).get('/api/tasks')

    expect(res.status).toBe(200)
    expect(res.body.map((t: { title: string }) => t.title)).toEqual(['First', 'Second'])
    expect(res.body[0]).toMatchObject({ completed: false })
  })
})

describe('POST /api/tasks/:id/complete', () => {
  it('marks the task completed and returns it', async () => {
    const { id } = await addTask('Buy milk')

    const res = await request(app).post(`/api/tasks/${id}/complete`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id, title: 'Buy milk', completed: true })
  })

  it('persists the change', async () => {
    const { id } = await addTask('Buy milk')
    await request(app).post(`/api/tasks/${id}/complete`)

    const list = await request(app).get('/api/tasks')

    expect(list.body[0].completed).toBe(true)
  })

  it('is idempotent', async () => {
    const { id } = await addTask('Buy milk')
    await request(app).post(`/api/tasks/${id}/complete`)

    const res = await request(app).post(`/api/tasks/${id}/complete`)

    expect(res.status).toBe(200)
    expect(res.body.completed).toBe(true)
  })

  it('returns 404 for an unknown task', async () => {
    const res = await request(app).post('/api/tasks/999/complete')

    expect(res.status).toBe(404)
    expect(res.body.error.message).toEqual(expect.any(String))
  })

  it.each(['abc', '0', '-1', '1.5'])('rejects id %s with 400', async (id) => {
    const res = await request(app).post(`/api/tasks/${id}/complete`)

    expect(res.status).toBe(400)
    expect(res.body.error.message).toEqual(expect.any(String))
  })
})
