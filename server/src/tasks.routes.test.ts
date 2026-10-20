import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { openDb, type Db } from './db.js'

describe('POST /api/tasks', () => {
  let db: Db
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    db = openDb(':memory:')
    app = createApp(db)
  })

  const countRows = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n

  it('creates a task and returns it with 201', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'Buy milk' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ title: 'Buy milk', completed: false })
    expect(res.body.id).toEqual(expect.any(Number))
  })

  it('persists the task in the database', async () => {
    await request(app).post('/api/tasks').send({ title: 'Buy milk' })

    expect(countRows()).toBe(1)
  })

  it('trims surrounding whitespace from the title', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '  Walk dog  ' })

    expect(res.status).toBe(201)
    expect(res.body.title).toBe('Walk dog')
  })

  it.each([
    ['missing', {}],
    ['empty', { title: '' }],
    ['blank', { title: '   ' }],
    ['not a string', { title: 42 }],
    ['over 200 characters', { title: 'x'.repeat(201) }],
  ])('rejects a %s title with 400 and stores nothing', async (_label, body) => {
    const res = await request(app).post('/api/tasks').send(body)

    expect(res.status).toBe(400)
    expect(res.body.error.message).toEqual(expect.any(String))
    expect(countRows()).toBe(0)
  })

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title":')

    expect(res.status).toBe(400)
  })

  it('returns timestamps as ISO-8601 UTC strings', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'Buy milk' })

    const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    expect(res.body.createdAt).toMatch(isoUtc)
    expect(res.body.updatedAt).toMatch(isoUtc)
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false)
  })

  it.each([
    ['missing', undefined, 'Title is required'],
    ['not a string', { title: 42 }, 'Title must be a string'],
    ['empty', { title: '' }, 'Title is required'],
    ['blank', { title: '   ' }, 'Title is required'],
    ['too long', { title: 'x'.repeat(201) }, 'Title must be at most 200 characters'],
  ])('gives a friendly message for a %s title', async (_label, body, message) => {
    const res = await request(app).post('/api/tasks').send(body)

    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe(message)
  })

  it('gives a friendly message when the body is empty', async () => {
    const res = await request(app).post('/api/tasks')

    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Title is required')
  })

  it('returns 415 for an unsupported content encoding instead of 500', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'x-unknown')
      .send('{"title":"Buy milk"}')

    expect(res.status).toBe(415)
    expect(res.body.error.message).toBe('Unsupported content encoding')
    expect(countRows()).toBe(0)
  })

  it('returns 400 instead of 500 when a compressed body is corrupt', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'br')
      .send('{"title":"Buy milk"}')

    expect(res.status).toBe(400)
    expect(countRows()).toBe(0)
  })

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope')

    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toEqual({ error: { message: 'Not found' } })
  })

  it('rejects an oversized body with 413', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'x'.repeat(20_000) })

    expect(res.status).toBe(413)
  })

  it('returns 500 without leaking details when the database fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.close()

    const res = await request(app).post('/api/tasks').send({ title: 'Buy milk' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: { message: 'Internal server error' } })
    expect(errorLog).toHaveBeenCalled()
    errorLog.mockRestore()
  })
})
