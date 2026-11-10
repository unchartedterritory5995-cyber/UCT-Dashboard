import { describe, it, expect, vi } from 'vitest'
import { saveRecord, listOrphans, confirmRestored, holdOwnerLock, KEY_PREFIX, boardWindowName, widgetWindowName, hasDeskRecords, planDeskRepop } from './deskStore'

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

// Existing cases model the no-Web-Locks path; the lock-precondition cases below use real fakes.
const save = (uid, rec, o = {}) => saveRecord(uid, rec, { locks: null, ...o })

const board = (id, extra = {}) => ({ kind: 'board', id, widgets: [{ id: 'w1', type: 'chart' }], windowName: 'win-' + id, ...extra })

describe('window names for the desktop shell', () => {
  it('builds the names the shell parses', () => {
    expect(boardWindowName('pl-1731')).toBe('uct-board-pl-1731')
    expect(widgetWindowName('w-periodsort-17')).toBe('uct-widget-w-periodsort-17')
  })

  it.each([['a:colon'], ['spa ce'], ['x'.repeat(65)], ['']])('an id the shell would reject gives no name: %s', (id) => {
    expect(boardWindowName(id)).toBe('')
    expect(widgetWindowName(id)).toBe('')
  })
})

describe('deskStore', () => {
  it('stores a record under uct.desk.v1:<uid>:<id>', () => {
    const storage = makeStorage()
    expect(save('u1', board('b1'), { storage, tabId: 't1' })).toBe(true)
    expect(storage.getItem(`${KEY_PREFIX}u1:b1`)).not.toBeNull()
    expect(KEY_PREFIX).toBe('uct.desk.v1:')
  })

  it('a record belonging to user A is invisible to user B', async () => {
    const storage = makeStorage()
    save('A', board('b1'), { storage, tabId: 'dead' })
    const locks = makeLocks([])
    expect(await listOrphans('B', { storage, locks, tabId: 'me' })).toEqual([])
    expect((await listOrphans('A', { storage, locks, tabId: 'me' })).map((r) => r.id)).toEqual(['b1'])
  })

  it('lists a record whose owner lock is free, not one whose lock is held', async () => {
    const storage = makeStorage()
    save('A', board('free'), { storage, tabId: 'gone' })
    save('A', board('live'), { storage, tabId: 'alive' })
    const locks = makeLocks(['uct.desk.owner:A:alive'])
    const ids = (await listOrphans('A', { storage, locks, tabId: 'me' })).map((r) => r.id)
    expect(ids).toEqual(['free'])
  })

  it("does not treat this page's own records as orphans", async () => {
    const storage = makeStorage()
    save('A', board('mine'), { storage, tabId: 'me' })
    expect(await listOrphans('A', { storage, locks: makeLocks([]), tabId: 'me' })).toEqual([])
  })

  it('nothing is orphaned when navigator.locks is missing', async () => {
    const storage = makeStorage()
    save('A', board('b1'), { storage, tabId: 'gone' })
    expect(await listOrphans('A', { storage, locks: null, tabId: 'me' })).toEqual([])
  })

  it('a record whose owner lock cannot be determined is not an orphan', async () => {
    const storage = makeStorage()
    save('A', board('b1'), { storage, tabId: 'gone' })
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
    save('A', board('b1'), { storage, tabId: 'gone' })
    save('A', board('b2'), { storage, tabId: 'gone' })
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
    expect(save('A', board('b1'), { storage, tabId: 't' })).toBe(false)
  })

  it('records hold widget config only', () => {
    const storage = makeStorage()
    save('A', board('b1', { bars: [1, 2, 3], quotes: { SPY: 1 }, apiKey: 'x' }), { storage, tabId: 't' })
    const saved = JSON.parse(storage.getItem(`${KEY_PREFIX}A:b1`))
    expect(Object.keys(saved).sort()).toEqual(['id', 'kind', 'tabId', 'widgets', 'windowName'])
    const w = { kind: 'widget', id: 'k', widgetId: 'w9', windowName: 'n', bars: [1] }
    save('A', w, { storage, tabId: 't' })
    expect(Object.keys(JSON.parse(storage.getItem(`${KEY_PREFIX}A:k`))).sort())
      .toEqual(['id', 'kind', 'tabId', 'widgetId', 'windowName'])
  })

  it('rejects an unknown kind', () => {
    const storage = makeStorage()
    expect(save('A', { kind: 'other', id: 'z' }, { storage, tabId: 't' })).toBe(false)
    expect(storage._m.size).toBe(0)
  })

  it('refuses everything when uid is null', async () => {
    const storage = makeStorage({ [`${KEY_PREFIX}A:b1`]: JSON.stringify({ ...board('b1'), tabId: 'gone' }) })
    const locks = makeLocks([])
    expect(save(null, board('b2'), { storage, tabId: 't' })).toBe(false)
    expect(await listOrphans(null, { storage, locks, tabId: 'me' })).toEqual([])
    confirmRestored(undefined, 'b1', { storage })
    expect(storage.getItem(`${KEY_PREFIX}A:b1`)).not.toBeNull()
    const release = await holdOwnerLock(null, { locks, tabId: 't' })
    expect(locks.request).not.toHaveBeenCalled()
    expect(() => release()).not.toThrow()
  })

  describe('save needs the granted owner lock', () => {
    it('save before the lock is granted returns false and writes nothing', () => {
      const storage = makeStorage()
      const granted = new Set()
      expect(saveRecord('A', board('b1'), { storage, locks: makeLocks([]), granted, tabId: 't' })).toBe(false)
      expect(storage._m.size).toBe(0)
    })

    it('save after holdOwnerLock is granted succeeds, and fails again after release', async () => {
      const storage = makeStorage()
      const granted = new Set()
      const locks = makeLocks([])
      const release = await holdOwnerLock('A', { locks, granted, tabId: 't' })
      expect(saveRecord('A', board('b1'), { storage, locks, granted, tabId: 't' })).toBe(true)
      release()
      expect(saveRecord('A', board('b2'), { storage, locks, granted, tabId: 't' })).toBe(false)
    })

    it('save with locks unavailable succeeds', () => {
      const storage = makeStorage()
      expect(saveRecord('A', board('b1'), { storage, locks: null, granted: new Set(), tabId: 't' })).toBe(true)
    })

    it('a uid other than the granted one returns false', async () => {
      const storage = makeStorage()
      const granted = new Set()
      const locks = makeLocks([])
      await holdOwnerLock('A', { locks, granted, tabId: 't' })
      expect(saveRecord('B', board('b1'), { storage, locks, granted, tabId: 't' })).toBe(false)
      expect(storage._m.size).toBe(0)
    })
  })

  describe('default storage that throws', () => {
    const blockStorage = () => vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    it('saveRecord returns false instead of throwing', () => {
      const spy = blockStorage()
      try {
        expect(saveRecord('A', board('b1'), { locks: null })).toBe(false)
      } finally { spy.mockRestore() }
    })

    it('listOrphans resolves [] instead of rejecting', async () => {
      const spy = blockStorage()
      try {
        await expect(listOrphans('A', { locks: makeLocks([]) })).resolves.toEqual([])
      } finally { spy.mockRestore() }
    })

    it('confirmRestored does not throw', () => {
      const spy = blockStorage()
      try {
        expect(() => confirmRestored('A', 'b1')).not.toThrow()
      } finally { spy.mockRestore() }
    })

    it('uses the real localStorage by default', () => {
      localStorage.clear()
      expect(saveRecord('A', board('real'), { locks: null, tabId: 't' })).toBe(true)
      expect(localStorage.getItem(`${KEY_PREFIX}A:real`)).not.toBeNull()
      confirmRestored('A', 'real')
      expect(localStorage.getItem(`${KEY_PREFIX}A:real`)).toBeNull()
    })
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

describe('hasDeskRecords', () => {
  it('sees a record for this member only, without reading any record', () => {
    const storage = makeStorage({ [`${KEY_PREFIX}A:pl-1`]: 'not even json' })
    expect(hasDeskRecords('A', { storage })).toBe(true)
    expect(hasDeskRecords('B', { storage })).toBe(false)
  })

  it('answers no for no member and for a storage that throws', () => {
    expect(hasDeskRecords(null, { storage: makeStorage({ [`${KEY_PREFIX}A:x`]: '{}' }) })).toBe(false)
    expect(hasDeskRecords('A', { storage: { get length() { throw new Error('blocked') } } })).toBe(false)
  })
})

describe('planDeskRepop', () => {
  const board = (id, ...widgetIds) => ({ kind: 'board', id, widgets: widgetIds.map((w) => ({ id: w })) })
  const single = (widgetId) => ({ kind: 'widget', id: `pw-${widgetId}`, widgetId })

  it('re-pops boards and widgets, each with its own window', () => {
    const plan = planDeskRepop([board('pl-1', 'r1', 'r2'), single('a1')], ['a1', 'a2'])
    expect(plan.boards).toEqual([{ id: 'pl-1', widgets: [{ id: 'r1' }, { id: 'r2' }] }])
    expect(plan.widgetIds).toEqual(['a1'])
    expect(plan.drop).toEqual([])
  })

  it('a widget no longer in the layout is dropped', () => {
    const plan = planDeskRepop([single('gone')], ['a1'])
    expect(plan.widgetIds).toEqual([])
    expect(plan.drop).toEqual(['pw-gone'])
  })

  it('a board with nothing left to bring back is dropped, not opened empty', () => {
    const plan = planDeskRepop([board('pl-1'), board('pl-2', 'a1')], ['a1'])
    expect(plan.boards).toEqual([])
    expect(plan.drop).toEqual(['pl-1', 'pl-2'])
  })

  it('a widget already on the main board or another restored board is not duplicated', () => {
    const plan = planDeskRepop([board('pl-1', 'a1', 'r1'), board('pl-2', 'r1', 'r2')], ['a1'])
    expect(plan.boards).toEqual([
      { id: 'pl-1', widgets: [{ id: 'r1' }] },
      { id: 'pl-2', widgets: [{ id: 'r2' }] },
    ])
  })

  it('a widget on the main board re-pops singly, and the board holding only that widget is dropped', () => {
    const plan = planDeskRepop([board('pl-1', 'a1'), single('a1')], ['a1'])
    expect(plan.widgetIds).toEqual(['a1'])
    expect(plan.drop).toEqual(['pl-1'])
  })

  it('ignores a record it does not understand, without deleting it', () => {
    const plan = planDeskRepop([{ kind: 'mystery', id: 'm1' }, { kind: 'board', id: 'pl-9', widgets: 'nope' }], [])
    expect(plan).toEqual({ boards: [], widgetIds: [], drop: [] })
  })
})
