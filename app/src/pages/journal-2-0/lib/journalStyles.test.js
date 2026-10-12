// Journal styles client (Notebook P1, Task 11). Every server answer below is a GENERATED contract fixture
// (`__fixtures__/contract/*.json`, written by the server lane and kept current by
// tests/test_notebook_contract_fixtures.py), so these tests are pinned to the real shapes. Each `*Fixture` const
// keeps the old `{ body }` face so the tests read as before; a variation is a spread + override of a fixture
// object. What stays inline has no fixture: a 404 "gate off", a 5xx, the proxy statuses, and bodies the client
// must tolerate but the server never sends (a mapping answer with no `notes`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { contract, contractBody, contractResponse } from '../__fixtures__/contract'

vi.mock('./offline/settleNoteWrite', () => ({
  settleNoteWrite: vi.fn(async () => 'rev'),
  settleNoteWrites: vi.fn(async () => []),
}))
vi.mock('./offline/notebookDb', () => ({
  openNotebookDb: vi.fn(async () => ({ close: vi.fn(), fake: true })),
  getMeta: vi.fn(async () => null),
  putMeta: vi.fn(async () => undefined),
  offlineStorageAvailable: vi.fn(() => true),
}))
import { settleNoteWrite, settleNoteWrites } from './offline/settleNoteWrite'
import journalStylesSource from './journalStyles.js?raw'
import { openNotebookDb, getMeta, putMeta, offlineStorageAvailable } from './offline/notebookDb'
import { setCurrentAccountId } from './offline/currentAccount'
import {
  STYLES_URL, STYLES_CACHE_KEY, fetchJournalStyles, readCachedStyles, getJournalStyle, createJournalStyle,
  updateJournalStyle, deleteJournalStyle, restoreJournalStyle, setDefaultJournalStyle, previewJournalStyle,
  createKind, updateKind, deleteKind, getMappingOffer, applyMappingOffer, planStyleUpdate, applyStyleUpdate,
  defaultStyleFor, stylesOfKind,
} from './journalStyles'

// ── the server's answers, from the contract fixtures ──
// A real style row from the list, for the pure-function tests that need a payload of their own kinds.
const style = (over) => ({ ...contractBody('journal-styles.list').styles[0], ...over })
const listFixture = { body: contractBody('journal-styles.list') }
// ⚠️ This fixture's `note.updatedAt` equals its seed's (the generator freezes the clock): a test that checks the
// revision MOVED must override it explicitly, never read it from here. None below does.
const applyFixture = { body: contractBody('notes.apply-style-update') }
const planFixture = { body: contractBody('notes.style-update-plan') }
const mappingApply = { body: contractBody('note-kinds.mapping-offer.apply') }
// One body carrying every key the wire-shape tests' calls read, all from real answers (the wire tests ask what
// each call SENDS; what comes back is incidental).
const anyAnswer = { ...listFixture.body, ...applyFixture.body, ...mappingApply.body }
const TRADE_PLAN_IDS = listFixture.body.styles.filter((x) => x.kindId === 'trade_plan').map((x) => x.id)

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const refusal = (status, detail) => ({ ok: false, status, json: async () => (detail ? { detail } : {}) })
const lastCall = () => globalThis.fetch.mock.calls.at(-1)
const sent = () => { const [url, init] = lastCall(); return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, init } }

beforeEach(() => {
  globalThis.fetch = vi.fn()
  settleNoteWrite.mockClear(); settleNoteWrites.mockClear()
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
    expect(data.kinds.length).toBe(listFixture.body.kinds.length)
    expect(defaultStyleFor(data, 'thesis').id).toBe('builtin:thesis')
    expect(stylesOfKind(data, 'trade_plan').some((s) => !s.builtin)).toBe(true)
  })

  it('lands the update-layout write before returning', async () => {
    setCurrentAccountId('acct-1')
    globalThis.fetch.mockResolvedValue(ok(applyFixture.body))
    const out = await applyStyleUpdate('n1', { baseUpdatedAt: 'x' })
    expect(settleNoteWrite).toHaveBeenCalledWith(applyFixture.body.note.id, applyFixture.body.note, 'acct-1')
    expect(out.note.styleVersion).toBe(applyFixture.body.note.styleVersion)
  })

  it('lands every note the mapping offer changed', async () => {
    setCurrentAccountId('acct-1')
    globalThis.fetch.mockResolvedValue(ok(mappingApply.body))
    await applyMappingOffer([])
    // the batch idiom: every returned {id, updatedAt}, for the account that asked
    expect(settleNoteWrites).toHaveBeenCalledTimes(1)
    expect(settleNoteWrites).toHaveBeenCalledWith(mappingApply.body.notes, 'acct-1')
  })

  it('a refusal carries the server sentence and status', async () => {
    const bad = contract('journal-styles.create.bad-kind')
    globalThis.fetch.mockResolvedValue(contractResponse('journal-styles.create.bad-kind'))
    await expect(createJournalStyle({ name: 'x' })).rejects.toMatchObject({ status: bad._contract.status, message: bad.body.detail })
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
    ['planStyleUpdate', () => planStyleUpdate('n 1', { styleId: 's 1' }), 'GET', '/api/j2/notes/n%201/style-update-plan?styleId=s%201',
      undefined],
    ['applyStyleUpdate', () => applyStyleUpdate('n1', { styleId: 's_1', baseUpdatedAt: 'T0' }), 'POST',
      '/api/j2/notes/n1/apply-style-update', { styleId: 's_1', baseUpdatedAt: 'T0' }],
  ]
  it.each(cases)('%s', async (_name, run, method, url, body) => {
    globalThis.fetch.mockResolvedValue(ok(anyAnswer))
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

  it('an unset styleId is left off the wire, never sent as null (write and plan alike)', async () => {
    globalThis.fetch.mockResolvedValue(ok(applyFixture.body))
    await applyStyleUpdate('n1', { baseUpdatedAt: 'T0' })
    expect(sent().body).toEqual({ baseUpdatedAt: 'T0' })
    await planStyleUpdate('n1')
    expect(sent()).toMatchObject({ url: '/api/j2/notes/n1/style-update-plan', method: 'GET' })
  })

  it('the plan is a GET on its own route: it can never be mistaken for the write', async () => {
    globalThis.fetch.mockResolvedValue(ok(planFixture.body))
    await planStyleUpdate('n1', { styleId: planFixture.body.plan.styleId })
    const { url, method, init } = sent()
    expect(method).toBe('GET')
    expect(url).not.toMatch(/apply-style-update/)
    expect(init.body).toBeUndefined()
  })

  it('only the two calls that move a note settle; nothing else does', async () => {
    globalThis.fetch.mockResolvedValue(ok(anyAnswer))
    for (const [name, run] of cases) {
      if (name === 'applyStyleUpdate' || name === 'applyMappingOffer') continue
      await run()
    }
    await fetchJournalStyles()
    expect(settleNoteWrite).not.toHaveBeenCalled()
    expect(settleNoteWrites).not.toHaveBeenCalled()
  })
})

describe('a call that moves a revision is landed, and only when it moved one', () => {
  it('the plan is a read: it settles nothing', async () => {
    globalThis.fetch.mockResolvedValue(ok(planFixture.body))
    const out = await planStyleUpdate('n1', { styleId: planFixture.body.plan.styleId })
    expect(out.plan.toVersion).toBe(planFixture.body.plan.toVersion)
    expect(settleNoteWrite).not.toHaveBeenCalled()
    expect(settleNoteWrites).not.toHaveBeenCalled()
  })

  it('a stale base (409) moved nothing: it throws the server sentence and settles nothing', async () => {
    const stale = contract('notes.apply-style-update.stale')
    globalThis.fetch.mockResolvedValue(contractResponse('notes.apply-style-update.stale'))
    await expect(applyStyleUpdate('n1', { baseUpdatedAt: 'old' })).rejects.toMatchObject({
      status: stale._contract.status, message: stale.body.detail,
    })
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })

  it('the settle is awaited BEFORE the call returns (the next fetch must see the landed revision)', async () => {
    const order = []
    // a macrotask, so only a real `await` on the settle can order 'settled' before 'returned'
    settleNoteWrite.mockImplementationOnce(async () => { await new Promise((r) => setTimeout(r, 5)); order.push('settled'); return 'rev' })
    globalThis.fetch.mockResolvedValue(ok(applyFixture.body))
    await applyStyleUpdate('n1', { baseUpdatedAt: 'T0' }).then(() => order.push('returned'))
    expect(order).toEqual(['settled', 'returned'])
  })

  it('the mapping-offer batch settle is awaited before it returns, and returns the server body', async () => {
    const order = []
    settleNoteWrites.mockImplementationOnce(async () => { await new Promise((r) => setTimeout(r, 5)); order.push('settled'); return [] })
    globalThis.fetch.mockResolvedValue(ok(mappingApply.body))
    const out = await applyMappingOffer(['skip']).then((o) => { order.push('returned'); return o })
    expect(order).toEqual(['settled', 'returned'])
    expect(out.count).toBe(mappingApply.body.count)
  })

  it('the settles use the account that ASKED, even if it changes while the request is out', async () => {
    setCurrentAccountId('acct-A')
    let release
    globalThis.fetch.mockReturnValue(new Promise((r) => { release = () => r(ok(applyFixture.body)) }))
    const pending = applyStyleUpdate('n1', { baseUpdatedAt: 'T0' })
    setCurrentAccountId('acct-B')
    release()
    await pending
    expect(settleNoteWrite).toHaveBeenCalledWith(applyFixture.body.note.id, applyFixture.body.note, 'acct-A')
    globalThis.fetch.mockReturnValue(new Promise((r) => { release = () => r(ok(mappingApply.body)) }))
    const second = applyMappingOffer([])
    setCurrentAccountId('acct-C')
    release()
    await second
    expect(settleNoteWrites).toHaveBeenLastCalledWith(mappingApply.body.notes, 'acct-B')
  })

  it('a mapping offer that changed nothing settles nothing and does not throw', async () => {
    const nothing = { ...mappingApply.body, notes: [], count: 0 }               // the real answer's keys, nothing moved
    globalThis.fetch.mockResolvedValue(ok(nothing))
    await expect(applyMappingOffer()).resolves.toEqual(nothing)
    expect(sent().body).toEqual({ excludeNoteIds: [] })
    globalThis.fetch.mockResolvedValue(ok({ count: 0 }))                         // tolerated: an answer with no `notes` key at all
    await expect(applyMappingOffer([])).resolves.toEqual({ count: 0 })
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })
})

describe('the update-layout write is a compare-and-set, never a blind write', () => {
  it.each([[undefined], [null], ['']])('refuses to send without a base revision (%s), before any request', async (base) => {
    await expect(applyStyleUpdate('n1', { baseUpdatedAt: base })).rejects.toThrow(/baseUpdatedAt/)
    await expect(applyStyleUpdate('n1')).rejects.toThrow(/baseUpdatedAt/)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(settleNoteWrite).not.toHaveBeenCalled()
  })

  it('with a base it is sent as the compare-and-set value', async () => {
    globalThis.fetch.mockResolvedValue(ok(applyFixture.body))
    await applyStyleUpdate('n1', { baseUpdatedAt: '2026-10-11T11:00:00+00:00' })
    expect(sent().body).toEqual({ baseUpdatedAt: '2026-10-11T11:00:00+00:00' })
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

  it('network down AFTER the account changed: the first account cached list is not served to the second', async () => {
    setCurrentAccountId('acct-A')
    const readCache = vi.fn(async () => listFixture.body)
    const boom = new TypeError('Failed to fetch')
    let fail
    globalThis.fetch.mockReturnValue(new Promise((_r, reject) => { fail = () => reject(boom) }))
    const pending = fetchJournalStyles({ readCache })
    setCurrentAccountId('acct-B')
    fail()
    await expect(pending).rejects.toBe(boom)
    expect(readCache).not.toHaveBeenCalled()
  })

  it('network down and nothing cached: the original network error, not a made-up empty list', async () => {
    const boom = new TypeError('Failed to fetch')
    globalThis.fetch.mockRejectedValue(boom)
    await expect(fetchJournalStyles({ readCache: async () => null })).rejects.toBe(boom)
  })

  it('the server ANSWERED with a refusal: the cache is not used (402 free plan, 404 gate off, 400, 500)', async () => {
    const readCache = vi.fn(async () => listFixture.body)
    const answered = ['journal-styles.list.free-plan', 'journal-styles.create.bad-kind'].map((n) => contract(n))
    for (const [status, detail] of [...answered.map((c) => [c._contract.status, c.body.detail]), [404, 'Not found'], [500, 'boom']]) {
      globalThis.fetch.mockResolvedValue(refusal(status, detail))
      await expect(fetchJournalStyles({ readCache })).rejects.toMatchObject({ status, message: detail })
    }
    expect(readCache).not.toHaveBeenCalled()
  })

  it('a deploy swap (502/503/504 from the proxy, 520-524 from Cloudflare) is "the server is not there": the cache serves', async () => {
    for (const status of [502, 503, 504, 520, 521, 522, 523, 524]) {
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
    const ids = stylesOfKind(data, 'trade_plan').map((s) => s.id)
    expect(ids).toEqual(TRADE_PLAN_IDS)
    expect(ids).toHaveLength(3)                                  // the built-in, then the member's two own, with generated ids
    expect(ids[0]).toBe('builtin:trade_plan')
  })
})

describe('the module stays out of the first-open path', () => {
  it('imports the settle helper, never useDurableNote (which takes a Web Lock on import)', () => {
    const code = journalStylesSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code).toMatch(/from '\.\/offline\/settleNoteWrite'/)
    expect(code).not.toMatch(/useDurableNote/)
  })
})
