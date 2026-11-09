import { describe, it, expect, vi } from 'vitest'
import { saveRecord, listOrphans, confirmRestored, holdOwnerLock, KEY_PREFIX } from './deskStore'

function makeStorage(initial = {}, { failSet = false } = {}) {
  const m = new Map(Object.entries(initial))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failSet) throw new Error('QuotaExceededError'); m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    _m: m,
  }
}

/** held: names of locks currently held by some live page. */
function makeLocks(held = []) {
  return {
    query: vi.fn(async () => ({ held: held.map((name) => ({ name })), pending: [] })),
    request: vi.fn((name, cb) => {
      held.push(name)
      return Promise.resolve(cb({ name }))
    }),
  }
}

const board = (id, extra = {}) => ({ kind: 'board', id, widgets: [{ id: 'w1', type: 'chart' }], windowName: 'win-' + id, ...extra })

describe('deskStore', () => {
  it('stores a record under uct.desk.v1:<uid>:<id>', () => {
    const storage = makeStorage()
    expect(saveRecord('u1', board('b1'), { storage, tabId: 't1' })).toBe(true)
    expect(storage.getItem(`${KEY_PREFIX}u1:b1`)).not.toBeNull()
    expect(KEY_PREFIX).toBe('uct.desk.v1:')
  })

  it('a record belonging to user A is invisible to user B', async () => {
    const storage = makeStorage()
    saveRecord('A', board('b1'), { storage, tabId: 'dead' })
    const locks = makeLocks([])
    expect(await listOrphans('B', { storage, locks, tabId: 'me' })).toEqual([])
    expect((await listOrphans('A', { storage, locks, tabId: 'me' })).map((r) => r.id)).toEqual(['b1'])
  })

  it('lists a record whose owner lock is free, not one whose lock is held', async () => {
    const storage = makeStorage()
    saveRecord('A', board('free'), { storage, tabId: 'gone' })
    saveRecord('A', board('live'), { storage, tabId: 'alive' })
    const locks = makeLocks(['uct.desk.owner:A:alive'])
    const ids = (await listOrphans('A', { storage, locks, tabId: 'me' })).map((r) => r.id)
    expect(ids).toEqual(['free'])
  })

  it("does not treat this page's own records as orphans", async () => {
    const storage = makeStorage()
    saveRecord('A', board('mine'), { storage, tabId: 'me' })
    expect(await listOrphans('A', { storage, locks: makeLocks([]), tabId: 'me' })).toEqual([])
  })

  it('nothing is orphaned when navigator.locks is missing', async () => {
    const storage = makeStorage()
    saveRecord('A', board('b1'), { storage, tabId: 'gone' })
    expect(await listOrphans('A', { storage, locks: null, tabId: 'me' })).toEqual([])
  })

  it('a record whose owner lock cannot be determined is not an orphan', async () => {
    const storage = makeStorage()
    saveRecord('A', board('b1'), { storage, tabId: 'gone' })
    const locks = { query: vi.fn(async () => { throw new Error('boom') }) }
    expect(await listOrphans('A', { storage, locks, tabId: 'me' })).toEqual([])
  })

  it('a record with no owner tab is not an orphan', async () => {
    const storage = makeStorage({
      [`${KEY_PREFIX}A:x`]: JSON.stringify({ kind: 'board', id: 'x', widgets: [], windowName: 'w' }),
    })
    expect(await listOrphans('A', { storage, locks: makeLocks([]), tabId: 'me' })).toEqual([])
  })

  it('listOrphans is read-only; only confirmRestored deletes', async () => {
    const storage = makeStorage()
    saveRecord('A', board('b1'), { storage, tabId: 'gone' })
    saveRecord('A', board('b2'), { storage, tabId: 'gone' })
    const before = [...storage._m.entries()]
    await listOrphans('A', { storage, locks: makeLocks([]), tabId: 'me' })
    expect([...storage._m.entries()]).toEqual(before)
    confirmRestored('A', 'b1', { storage })
    expect(storage.getItem(`${KEY_PREFIX}A:b1`)).toBeNull()
    expect(storage.getItem(`${KEY_PREFIX}A:b2`)).not.toBeNull()
  })

  it('corrupt JSON returns [] and removes nothing', async () => {
    const storage = makeStorage({ [`${KEY_PREFIX}A:bad`]: '{not json' })
    expect(await listOrphans('A', { storage, locks: makeLocks([]), tabId: 'me' })).toEqual([])
    expect(storage.getItem(`${KEY_PREFIX}A:bad`)).toBe('{not json')
  })

  it('a storage write failure returns false and does not throw', () => {
    const storage = makeStorage({}, { failSet: true })
    expect(saveRecord('A', board('b1'), { storage, tabId: 't' })).toBe(false)
  })

  it('records hold widget config only', () => {
    const storage = makeStorage()
    saveRecord('A', board('b1', { bars: [1, 2, 3], quotes: { SPY: 1 }, apiKey: 'x' }), { storage, tabId: 't' })
    const saved = JSON.parse(storage.getItem(`${KEY_PREFIX}A:b1`))
    expect(Object.keys(saved).sort()).toEqual(['id', 'kind', 'tabId', 'widgets', 'windowName'])
    const w = { kind: 'widget', id: 'k', widgetId: 'w9', windowName: 'n', bars: [1] }
    saveRecord('A', w, { storage, tabId: 't' })
    expect(Object.keys(JSON.parse(storage.getItem(`${KEY_PREFIX}A:k`))).sort())
      .toEqual(['id', 'kind', 'tabId', 'widgetId', 'windowName'])
  })

  it('rejects an unknown kind', () => {
    const storage = makeStorage()
    expect(saveRecord('A', { kind: 'other', id: 'z' }, { storage, tabId: 't' })).toBe(false)
    expect(storage._m.size).toBe(0)
  })

  it('refuses everything when uid is null', async () => {
    const storage = makeStorage({ [`${KEY_PREFIX}A:b1`]: JSON.stringify({ ...board('b1'), tabId: 'gone' }) })
    const locks = makeLocks([])
    expect(saveRecord(null, board('b2'), { storage, tabId: 't' })).toBe(false)
    expect(await listOrphans(null, { storage, locks, tabId: 'me' })).toEqual([])
    confirmRestored(undefined, 'b1', { storage })
    expect(storage.getItem(`${KEY_PREFIX}A:b1`)).not.toBeNull()
    const release = await holdOwnerLock(null, { locks, tabId: 't' })
    expect(locks.request).not.toHaveBeenCalled()
    expect(() => release()).not.toThrow()
  })

  describe('holdOwnerLock', () => {
    it('takes uct.desk.owner:<uid>:<tabId> and keeps it until released', async () => {
      let granted = null
      let freed = false
      const locks = {
        request: vi.fn((name, cb) => {
          granted = name
          return Promise.resolve(cb({ name })).then(() => { freed = true })
        }),
      }
      const release = await holdOwnerLock('A', { locks, tabId: 'tab9' })
      expect(granted).toBe('uct.desk.owner:A:tab9')
      await Promise.resolve()
      expect(freed).toBe(false)
      release()
      await new Promise((r) => setTimeout(r, 0))
      expect(freed).toBe(true)
    })

    it('resolves a no-op release when locks are unavailable', async () => {
      const release = await holdOwnerLock('A', { locks: null, tabId: 't' })
      expect(() => release()).not.toThrow()
    })

    it('resolves a no-op release when the request rejects', async () => {
      const locks = { request: vi.fn(() => Promise.reject(new Error('denied'))) }
      const release = await holdOwnerLock('A', { locks, tabId: 't' })
      expect(() => release()).not.toThrow()
    })
  })
})
