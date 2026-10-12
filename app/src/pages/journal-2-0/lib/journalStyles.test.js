// Journal styles client (Notebook P1, Task 11). The server is built in parallel (Tasks 8-10), so
// every answer below is an INLINE fixture in the shapes the plan documents. When Task 8 merges and
// generates `__fixtures__/contract/journal-styles.*.json`, the three `*Fixture` consts below are
// replaced by imports of those files (same `.body` shape) -- nothing else in this file changes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./offline/settleNoteWrite', () => ({ settleNoteWrite: vi.fn(async () => 'rev') }))
vi.mock('./offline/notebookDb', () => ({
  openNotebookDb: vi.fn(async () => ({ close: vi.fn(), fake: true })),
  getMeta: vi.fn(async () => null),
  putMeta: vi.fn(async () => undefined),
  offlineStorageAvailable: vi.fn(() => true),
}))
import { settleNoteWrite } from './offline/settleNoteWrite'
import journalStylesSource from './journalStyles.js?raw'
import { openNotebookDb, getMeta, putMeta, offlineStorageAvailable } from './offline/notebookDb'
import { setCurrentAccountId } from './offline/currentAccount'
import {
  STYLES_URL, STYLES_CACHE_KEY, fetchJournalStyles, readCachedStyles, getJournalStyle, createJournalStyle,
  updateJournalStyle, deleteJournalStyle, restoreJournalStyle, setDefaultJournalStyle, previewJournalStyle,
  createKind, updateKind, deleteKind, getMappingOffer, applyMappingOffer, planStyleUpdate, applyStyleUpdate,
  defaultStyleFor, stylesOfKind,
} from './journalStyles'

// ── inline fixtures: the plan's documented shapes (Task 8 table, Task 6 style dict, Task 10 plan) ──
const KIND_IDS = ['trade_plan', 'daily_prep', 'weekend_prep', 'earnings', 'post_trade_review',
  'weekly_review', 'thesis', 'watchlist_note']
const style = (over) => ({
  id: 'x', name: 'X', kindId: 'thesis', builtin: true, isDefault: true, version: 1,
  outlineTemplateId: null, hasOutline: true, blocks: [], properties: {}, sourceGalleryId: null,
  sourceVersion: null, createdAt: null, updatedAt: null, deletedAt: null, ...over,
})
const listFixture = {
  body: {
    kinds: KIND_IDS.map((id, i) => ({ id, name: id, icon: 'note', builtin: true, sortOrder: i })),
    styles: [
      ...KIND_IDS.map((k) => style({ id: `builtin:${k}`, name: k, kindId: k })),
      style({ id: 's_mine', name: 'Mine', kindId: 'trade_plan', builtin: false, isDefault: false }),
    ],
    blockKinds: ['chart'],
  },
}
const applyFixture = {
  body: {
    note: { id: 'n1', updatedAt: '2026-10-11T12:00:00+00:00', styleId: 's_mine', styleVersion: 2, kindId: 'trade_plan' },
    plan: { styleId: 's_mine', styleName: 'Mine', fromVersion: 1, toVersion: 2, switching: false,
      insertsOutline: false, add: [{ block: 'chart', label: null }], skipped: [], upToDate: false },
  },
}
const mappingApply = {
  body: {
    notes: [{ id: 'a', updatedAt: '2026-10-11T12:00:01+00:00' }, { id: 'b', updatedAt: '2026-10-11T12:00:02+00:00' }],
    count: 2,
  },
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const refusal = (status, detail) => ({ ok: false, status, json: async () => (detail ? { detail } : {}) })
const lastCall = () => globalThis.fetch.mock.calls.at(-1)
const sent = () => { const [url, init] = lastCall(); return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, init } }

beforeEach(() => {
  globalThis.fetch = vi.fn()
  settleNoteWrite.mockClear()
  openNotebookDb.mockClear(); getMeta.mockClear(); putMeta.mockClear()
  getMeta.mockResolvedValue(null)
  offlineStorageAvailable.mockReturnValue(true)
  setCurrentAccountId(null)
})
afterEach(() => { vi.restoreAllMocks(); setCurrentAccountId(null) })

describe('journal styles client', () => {
  it('reads the list in the server contract shape', async () => {
    globalThis.fetch.mockResolvedValue(ok(listFixture.body))
    const data = await fetchJournalStyles()
    expect(data.kinds.length).toBe(8)
    expect(defaultStyleFor(data, 'thesis').id).toBe('builtin:thesis')
    expect(stylesOfKind(data, 'trade_plan').some((s) => !s.builtin)).toBe(true)
  })

  it('lands the update-layout write before returning', async () => {
    globalThis.fetch.mockResolvedValue(ok(applyFixture.body))
    const out = await applyStyleUpdate('n1', { baseUpdatedAt: 'x' })
    expect(settleNoteWrite).toHaveBeenCalledWith(applyFixture.body.note.id, applyFixture.body.note)
    expect(out.note.styleVersion).toBe(applyFixture.body.note.styleVersion)
  })

  it('lands every note the mapping offer changed', async () => {
    globalThis.fetch.mockResolvedValue(ok(mappingApply.body))
    await applyMappingOffer([])
    expect(settleNoteWrite).toHaveBeenCalledTimes(mappingApply.body.notes.length)
  })

  it('a refusal carries the server sentence and status', async () => {
    globalThis.fetch.mockResolvedValue(refusal(400, 'Choose a kind of note for this style.'))
    await expect(createJournalStyle({ name: 'x' })).rejects.toMatchObject({ status: 400, message: 'Choose a kind of note for this style.' })
  })

  it('falls back to the cached copy when the network is down', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const cached = { ...listFixture.body, fromCache: true }
    const data = await fetchJournalStyles({ readCache: async () => listFixture.body })
    expect(data).toEqual(cached)
  })
})

describe('what each call asks the server (the wire, not the call site)', () => {
  const cases = [
    ['getJournalStyle', () => getJournalStyle('builtin:thesis'), 'GET', `${STYLES_URL}/builtin%3Athesis`, undefined],
    ['createJournalStyle', () => createJournalStyle({ name: 'N', kindId: 'thesis' }), 'POST', STYLES_URL, { name: 'N', kindId: 'thesis' }],
    ['updateJournalStyle', () => updateJournalStyle('s_1', { name: 'R' }), 'PUT', `${STYLES_URL}/s_1`, { name: 'R' }],
    ['deleteJournalStyle', () => deleteJournalStyle('s_1'), 'DELETE', `${STYLES_URL}/s_1`, undefined],
    ['restoreJournalStyle', () => restoreJournalStyle('s_1'), 'POST', `${STYLES_URL}/s_1/restore`, undefined],
    ['setDefaultJournalStyle', () => setDefaultJournalStyle('s_1'), 'POST', `${STYLES_URL}/s_1/default`, undefined],
    ['previewJournalStyle', () => previewJournalStyle({ styleId: 'builtin:thesis', ticker: 'nvda' }), 'POST', `${STYLES_URL}/preview`,
      { styleId: 'builtin:thesis', ticker: 'nvda' }],
    ['createKind', () => createKind({ name: 'Swing', icon: 'bolt' }), 'POST', '/api/j2/note-kinds', { name: 'Swing', icon: 'bolt' }],
    ['updateKind', () => updateKind('k_1', { name: 'S2' }), 'PUT', '/api/j2/note-kinds/k_1', { name: 'S2' }],
    ['deleteKind', () => deleteKind('k_1'), 'DELETE', '/api/j2/note-kinds/k_1', undefined],
    ['getMappingOffer', () => getMappingOffer(), 'GET', '/api/j2/note-kinds/mapping-offer', undefined],
    ['applyMappingOffer', () => applyMappingOffer(['n9']), 'POST', '/api/j2/note-kinds/mapping-offer', { excludeNoteIds: ['n9'] }],
    ['planStyleUpdate', () => planStyleUpdate('n 1', { styleId: 's_1' }), 'POST', '/api/j2/notes/n%201/apply-style-update',
      { dryRun: true, styleId: 's_1' }],
    ['applyStyleUpdate', () => applyStyleUpdate('n1', { styleId: 's_1', baseUpdatedAt: 'T0' }), 'POST',
      '/api/j2/notes/n1/apply-style-update', { styleId: 's_1', baseUpdatedAt: 'T0' }],
  ]
  it.each(cases)('%s', async (_name, run, method, url, body) => {
    globalThis.fetch.mockResolvedValue(ok({ notes: [], note: { id: 'n1', updatedAt: 'u' } }))
    await run()
    const call = sent()
    expect(call.url).toBe(url)
    expect(call.method).toBe(method)
    expect(call.body).toEqual(body)
    expect(call.init.credentials).toBe('include')
    if (body !== undefined) expect(call.init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('the list read is a plain GET on STYLES_URL', async () => {
    globalThis.fetch.mockResolvedValue(ok(listFixture.body))
    await fetchJournalStyles()
    expect(sent()).toMatchObject({ url: '/api/j2/journal-styles', method: 'GET' })
  })

  it('an unset styleId / baseUpdatedAt is left off the wire, never sent as null', async () => {
    globalThis.fetch.mockResolvedValue(ok(applyFixture.body))
    await applyStyleUpdate('n1', {})
    expect(sent().body).toEqual({})
    await planStyleUpdate('n1')
    expect(sent().body).toEqual({ dryRun: true })
  })

  it('only the two calls that move a note settle; nothing else does', async () => {
    globalThis.fetch.mockResolvedValue(ok({ notes: [], note: { id: 'n1', updatedAt: 'u' }, kinds: [], styles: [] }))
    for (const [name, run] of cases) {
      if (name === 'applyStyleUpdate' || name === 'applyMappingOffer') continue
      await run()
    }
    await fetchJournalStyles()
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })
})

describe('a call that moves a revision is landed, and only when it moved one', () => {
  it('the dry-run plan writes nothing, so it settles nothing', async () => {
    globalThis.fetch.mockResolvedValue(ok({ plan: applyFixture.body.plan }))
    const out = await planStyleUpdate('n1', { styleId: 's_mine' })
    expect(out.plan.toVersion).toBe(2)
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })

  it('a stale base (409) moved nothing: it throws the server sentence and settles nothing', async () => {
    globalThis.fetch.mockResolvedValue(refusal(409, 'This note changed since you opened it. Nothing was added.'))
    await expect(applyStyleUpdate('n1', { baseUpdatedAt: 'old' })).rejects.toMatchObject({
      status: 409, message: 'This note changed since you opened it. Nothing was added.',
    })
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })

  it('the settle is awaited BEFORE the call returns (the next fetch must see the landed revision)', async () => {
    const order = []
    // a macrotask, so only a real `await` on the settle can order 'settled' before 'returned'
    settleNoteWrite.mockImplementationOnce(async () => { await new Promise((r) => setTimeout(r, 5)); order.push('settled'); return 'rev' })
    globalThis.fetch.mockResolvedValue(ok(applyFixture.body))
    await applyStyleUpdate('n1', {}).then(() => order.push('returned'))
    expect(order).toEqual(['settled', 'returned'])
  })

  it('the mapping offer lands each note in order, one after the other, with the note it returned', async () => {
    const inFlight = { n: 0, max: 0 }
    settleNoteWrite.mockImplementation(async () => {
      inFlight.n += 1; inFlight.max = Math.max(inFlight.max, inFlight.n)
      await Promise.resolve(); await Promise.resolve()
      inFlight.n -= 1
      return 'rev'
    })
    globalThis.fetch.mockResolvedValue(ok(mappingApply.body))
    const out = await applyMappingOffer(['skip'])
    expect(settleNoteWrite.mock.calls).toEqual(mappingApply.body.notes.map((n) => [n.id, n]))
    expect(inFlight.max).toBe(1)
    expect(out.count).toBe(2)
  })

  it('a mapping offer that changed nothing settles nothing and does not throw', async () => {
    globalThis.fetch.mockResolvedValue(ok({ notes: [], count: 0 }))
    await expect(applyMappingOffer()).resolves.toEqual({ notes: [], count: 0 })
    expect(sent().body).toEqual({ excludeNoteIds: [] })
    globalThis.fetch.mockResolvedValue(ok({ count: 0 }))
    await expect(applyMappingOffer([])).resolves.toEqual({ count: 0 })
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })
})

describe('refusals', () => {
  it('a refusal with no JSON body still carries its status as the message', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new SyntaxError('bad json') } })
    await expect(deleteJournalStyle('s_1')).rejects.toMatchObject({ status: 500, message: '500' })
  })

  it('a network failure is not a refusal: it has no status', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(createKind({ name: 'x' })).rejects.toSatisfy((e) => e.status === undefined && e instanceof TypeError)
  })
})

describe('the offline cache (the offline DB\'s existing meta store)', () => {
  it('uses the versioned key and never bumps the offline DB version', () => {
    expect(STYLES_CACHE_KEY).toBe('journal-styles:v1')
    expect(STYLES_URL).toBe('/api/j2/journal-styles')
  })

  it('a good read is cached under the signed-in account, without the fromCache marker', async () => {
    setCurrentAccountId('acct-1')
    globalThis.fetch.mockResolvedValue(ok(listFixture.body))
    await fetchJournalStyles()
    await vi.waitFor(() => expect(putMeta).toHaveBeenCalledTimes(1))
    expect(openNotebookDb).toHaveBeenCalledWith('acct-1')
    expect(putMeta.mock.calls[0][1]).toBe(STYLES_CACHE_KEY)
    expect(putMeta.mock.calls[0][2]).toEqual(listFixture.body)
    expect(putMeta.mock.calls[0][2].fromCache).toBeUndefined()
  })

  it('the cache belongs to the account that ASKED, even if the account changes while the request is out', async () => {
    setCurrentAccountId('acct-A')
    let release
    globalThis.fetch.mockReturnValue(new Promise((r) => { release = () => r(ok(listFixture.body)) }))
    const pending = fetchJournalStyles()
    setCurrentAccountId('acct-B')
    release()
    await pending
    await vi.waitFor(() => expect(putMeta).toHaveBeenCalledTimes(1))
    expect(openNotebookDb.mock.calls.map((c) => c[0])).toEqual(['acct-A'])
  })

  it('no account, offline switched off, or no storage: nothing is opened and nothing breaks', async () => {
    globalThis.fetch.mockResolvedValue(ok(listFixture.body))
    await expect(fetchJournalStyles()).resolves.toEqual(listFixture.body)       // no account
    setCurrentAccountId('acct-1')
    offlineStorageAvailable.mockReturnValue(false)
    await expect(fetchJournalStyles()).resolves.toEqual(listFixture.body)       // no storage
    offlineStorageAvailable.mockReturnValue(true)
    localStorage.setItem('uct.j2.offline.enabled', '0')                         // the member's own opt-out
    try { await expect(fetchJournalStyles()).resolves.toEqual(listFixture.body) } finally { localStorage.removeItem('uct.j2.offline.enabled') }
    await new Promise((r) => setTimeout(r, 0))
    expect(openNotebookDb).not.toHaveBeenCalled()
  })

  it('a cache write that fails never fails the read', async () => {
    setCurrentAccountId('acct-1')
    putMeta.mockRejectedValue(new Error('quota'))
    globalThis.fetch.mockResolvedValue(ok(listFixture.body))
    await expect(fetchJournalStyles()).resolves.toEqual(listFixture.body)
  })

  it('the default cache reader reads the same key for the signed-in account and closes the connection', async () => {
    setCurrentAccountId('acct-1')
    getMeta.mockResolvedValue(listFixture.body)
    const close = vi.fn()
    openNotebookDb.mockResolvedValueOnce({ close })
    await expect(readCachedStyles()).resolves.toEqual(listFixture.body)
    expect(getMeta).toHaveBeenCalledWith(expect.anything(), STYLES_CACHE_KEY)
    expect(close).toHaveBeenCalled()
  })

  it('network down + default reader: serves the cached copy marked fromCache', async () => {
    setCurrentAccountId('acct-1')
    getMeta.mockResolvedValue(listFixture.body)
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const data = await fetchJournalStyles()
    expect(data.fromCache).toBe(true)
    expect(data.styles).toEqual(listFixture.body.styles)
  })

  it('network down and nothing cached: the original network error, not a made-up empty list', async () => {
    const boom = new TypeError('Failed to fetch')
    globalThis.fetch.mockRejectedValue(boom)
    await expect(fetchJournalStyles({ readCache: async () => null })).rejects.toBe(boom)
  })

  it('the server ANSWERED with a refusal: the cache is not used (402 free plan, 404 gate off, 400, 500)', async () => {
    const readCache = vi.fn(async () => listFixture.body)
    for (const [status, detail] of [[402, 'Journal styles require a paid plan'], [404, 'Not found'], [400, 'no'], [500, 'boom']]) {
      globalThis.fetch.mockResolvedValue(refusal(status, detail))
      await expect(fetchJournalStyles({ readCache })).rejects.toMatchObject({ status, message: detail })
    }
    expect(readCache).not.toHaveBeenCalled()
  })

  it('a deploy swap (502/503/504 from the proxy) is "the server is not there": the cache serves', async () => {
    for (const status of [502, 503, 504]) {
      globalThis.fetch.mockResolvedValue(refusal(status))
      const data = await fetchJournalStyles({ readCache: async () => listFixture.body })
      expect(data).toEqual({ ...listFixture.body, fromCache: true })
    }
  })
})

describe('reading the list', () => {
  it('defaultStyleFor / stylesOfKind tolerate an empty or missing payload', () => {
    expect(defaultStyleFor(null, 'thesis')).toBeNull()
    expect(defaultStyleFor({}, 'thesis')).toBeNull()
    expect(stylesOfKind(undefined, 'thesis')).toEqual([])
  })

  it('a kind with styles but no default has no default (a member kind with none at all too)', () => {
    const payload = { styles: [style({ id: 'a', kindId: 'k_1', isDefault: false })] }
    expect(defaultStyleFor(payload, 'k_1')).toBeNull()
    expect(defaultStyleFor(payload, 'k_2')).toBeNull()
  })

  it('stylesOfKind keeps the server order', () => {
    const data = listFixture.body
    expect(stylesOfKind(data, 'trade_plan').map((s) => s.id)).toEqual(['builtin:trade_plan', 's_mine'])
  })
})

describe('the module stays out of the first-open path', () => {
  it('imports the settle helper, never useDurableNote (which takes a Web Lock on import)', () => {
    const code = journalStylesSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code).toMatch(/from '\.\/offline\/settleNoteWrite'/)
    expect(code).not.toMatch(/useDurableNote/)
  })
})
