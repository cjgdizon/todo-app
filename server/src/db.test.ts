import { afterEach, describe, expect, it, vi } from 'vitest'

describe('openDb title limit', () => {
  afterEach(() => {
    vi.doUnmock('./limits.js')
    vi.resetModules()
  })

  it('takes the title length limit from the shared MAX_TITLE_LENGTH constant', async () => {
    vi.resetModules()
    vi.doMock('./limits.js', () => ({ MAX_TITLE_LENGTH: 300 }))
    const { openDb } = await import('./db.js')
    const db = openDb(':memory:')
    const insert = db.prepare('INSERT INTO tasks (title) VALUES (?)')

    expect(() => insert.run('x'.repeat(300))).not.toThrow()
    expect(() => insert.run('x'.repeat(301))).toThrow(/CHECK/)
    db.close()
  })
})
