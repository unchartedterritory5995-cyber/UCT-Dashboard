// Follow-up to TERM-033 (#1033): a screen this browser could NOT save survives a RELOAD. #1033 kept the "unsaved" marker
// in memory only, so after a reload a failed save left the server's OLDER screen as the one that got refined. Here the
// marker lives in ONE exact localStorage key (`uct.agent.unsavedScreens.v1`, no prefix scan, capped at 20 chats), the
// member is ASKED before anything is refined, a "yes" saves this browser's copy again first, and a storage error fails
// closed (start fresh), never open (refine the older copy). A reload is simulated by emptying the module state
// (_resetScreenerCache + _forgetUnsavedScreens) while localStorage is kept. No model, no provider, invented data.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability } from './capabilities'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache, ensureLast } from './capabilities/screener'
import { noteConversation } from './agentClient'
import { _forgetUnsavedScreens, LAST_SCREEN_UNREAD } from './capabilities/scanRefine'

const KEY = 'uct.agent.unsavedScreens.v1'
registerBuiltins()
const CTX = { surface: 'charts' }
const META = { fields: [
  { key: 'pct_vs_ema20', label: '% vs 20 EMA', type: 'range', unit: '%' },
  { key: 'vol_ratio', label: 'Volume Ratio', type: 'range', unit: '' },
  { key: 'price', label: 'Price', type: 'range', unit: '$' },
  { key: 'sector', label: 'Sector', type: 'enum' },
] }
const OPTIONS = { options: { sector: { values: ['Technology', 'Energy'], total: 100, with_value: 100 } } }
const ROWS = [{ ticker: 'AAA', company: 'A', price: 12, chg_pct_1d: 1 }, { ticker: 'BBB', company: 'B', price: 40, chg_pct_1d: 2 }]
const OLD = { spec: { filters: [{ key: 'price', op: 'gte', min: 50 }], post: [], sort: null }, symbols: ['OLD'], total: 1, asOf: '2026-10-29', name: null, savedId: null }

let calls, state, putFails
beforeEach(() => {
  localStorage.removeItem(KEY)
  _resetScreenerCache(); _forgetUnsavedScreens(); noteConversation('ac_1')
  calls = []; state = { ac_1: OLD }; putFails = true             // the server holds the OLDER screen for ac_1
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([method, u, body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/screener/fields') return json(META)
    if (u === '/api/screener/fields?options=1') return json(OPTIONS)
    if (u === '/api/screener/scan') return json({ total: 2, rows: ROWS.slice(0, body.page_size), snapshot_date: '2026-10-30' })
    const m = /^\/api\/agent\/conversations\/([^/]+)\/state\/lastScreen$/.exec(u)
    if (m) {
      if (method === 'PUT') { if (putFails) return new Response('', { status: 503 }); state[m[1]] = body.value; return json({ key: 'lastScreen', value: body.value }) }
      return json({ key: 'lastScreen', value: state[m[1]] || null, updated_at: state[m[1]] ? 1 : null })
    }
    return json({})
  })
})
afterEach(() => { noteConversation(null); vi.restoreAllMocks(); localStorage.removeItem(KEY) })

const run = (args) => getCapability('screener.run').answer(null, { filters: [], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null, ...args }, null, CTX)
const F = (field, op, value, extra = {}) => ({ field, op, value, max: null, values: null, ...extra })
const TECH = [F('sector', 'in', null, { values: ['Technology'] })]
const scans = () => calls.filter(c => c[1] === '/api/screener/scan')
const flush = () => new Promise(r => setTimeout(r, 0))
const stored = () => JSON.parse(localStorage.getItem(KEY) || 'null')
const reload = () => { _resetScreenerCache(); _forgetUnsavedScreens(); noteConversation('ac_1') }
const NEW_FILTERS = [{ key: 'pct_vs_ema20', op: 'gt', min: 0 }]
const QUESTION = /^I didn't run it: This chat's newest screen \(1 condition\) wasn't saved to UCT, so UCT still holds an older one\. Say “refine it” to save this browser's copy again and narrow it, or run a new screen to start fresh\.$/

async function failedSaveThenReload() {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await run({ filters: [F('pct_vs_ema20', 'gt', 0)] })          // the NEWER screen; its save fails (503)
  await flush()
  reload()
}

describe('an unsaved screen survives a reload (exact key uct.agent.unsavedScreens.v1)', () => {
  it('failed save, reload, "narrow that to tech": the older server copy is NOT refined, the member is asked, the entry is kept', async () => {
    await failedSaveThenReload()
    const a = await run({ mode: 'refine', filters: TECH })
    expect(a).toMatch(QUESTION)
    expect(scans().map(s => s[2].filters)).toEqual([NEW_FILTERS])   // one scan, the original; never price >= 50 + Technology
    expect(stored()?.ac_1?.screen?.spec?.filters).toEqual(NEW_FILTERS)   // this browser kept the newer screen
    expect(Object.keys(stored())).toEqual(['ac_1'])
  })

  it('"refine it" after the question: this browser\'s copy is saved again FIRST, then narrowed; the entry is removed by its exact id', async () => {
    await failedSaveThenReload()
    await run({ mode: 'refine', filters: TECH })                  // the question
    putFails = false
    const before = calls.length
    await run({ mode: 'refine', filters: TECH })                  // the member confirmed
    const after = calls.slice(before)
    const retry = after.findIndex(c => c[0] === 'PUT')
    const scan = after.findIndex(c => c[1] === '/api/screener/scan')
    expect(retry).toBeGreaterThanOrEqual(0)
    expect(retry).toBeLessThan(scan)                              // the save comes before the refined scan
    expect(after[retry][2].value.spec.filters).toEqual(NEW_FILTERS)
    expect(scans()[1][2].filters).toEqual([...NEW_FILTERS, { key: 'sector', op: 'in', values: ['Technology'] }])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('the retry fails too: nothing is refined, the member is told, the entry is kept', async () => {
    await failedSaveThenReload()
    await run({ mode: 'refine', filters: TECH })
    const a = await run({ mode: 'refine', filters: TECH })
    expect(a).toMatch(/^I didn't run it: I still couldn't save this chat's newest screen to UCT \(HTTP 503\)/)
    expect(scans()).toHaveLength(1)
    expect(stored()?.ac_1?.screen?.spec?.filters).toEqual(NEW_FILTERS)
  })

  it('starting fresh: a new screen saved after the reload removes this chat\'s entry only (another chat\'s stays)', async () => {
    noteConversation('ac_9'); await run({ filters: [F('vol_ratio', 'gte', 2)] }); await flush()     // ac_9 also unsaved
    noteConversation('ac_1')
    await failedSaveThenReload()
    expect(Object.keys(stored()).sort()).toEqual(['ac_1', 'ac_9'])
    putFails = false
    await run({ filters: [F('price', 'gte', 10)] }); await flush()
    expect(Object.keys(stored())).toEqual(['ac_9'])
  })

  it('capped at 20 chats: the oldest entries go first', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let t = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 1))
    for (let i = 0; i < 25; i++) { noteConversation(`ac_c${i}`); await run({ filters: [F('price', 'gte', i + 1)] }); await flush() }
    const ids = Object.keys(stored())
    expect(ids).toHaveLength(20)
    expect(ids.sort()).toEqual(Array.from({ length: 20 }, (_, i) => `ac_c${i + 5}`).sort())
  })

  it('touches ONLY the exact key: no other key is read, written or removed, and storage is never enumerated', async () => {
    localStorage.setItem('uct.agent.unsavedScreens', 'peer'); localStorage.setItem('uct.agent.unsavedScreens.v1.bak', 'peer')
    const used = []
    for (const m of ['getItem', 'setItem', 'removeItem']) {
      const orig = Storage.prototype[m]
      vi.spyOn(Storage.prototype, m).mockImplementation(function (k, ...rest) { used.push(k); return orig.call(this, k, ...rest) })
    }
    const keyAt = vi.spyOn(Storage.prototype, 'key')
    const clear = vi.spyOn(Storage.prototype, 'clear')
    await failedSaveThenReload()
    await run({ mode: 'refine', filters: TECH })
    putFails = false
    await run({ mode: 'refine', filters: TECH })
    expect(used.length).toBeGreaterThan(0)
    expect([...new Set(used.filter(k => String(k).startsWith('uct.agent.unsaved')))]).toEqual([KEY])
    expect(keyAt).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(localStorage.getItem('uct.agent.unsavedScreens')).toBe('peer')
    expect(localStorage.getItem('uct.agent.unsavedScreens.v1.bak')).toBe('peer')
    localStorage.removeItem('uct.agent.unsavedScreens'); localStorage.removeItem('uct.agent.unsavedScreens.v1.bak')
  })

  it('a storage ACCESS error after a reload fails closed: start fresh, the older server copy is never refined', async () => {
    await failedSaveThenReload()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    const a = await run({ mode: 'refine', filters: TECH })
    expect(a).toBe(`I didn't run it: ${LAST_SCREEN_UNREAD.replace(/\.$/, '')}.`)
    expect(scans()).toHaveLength(1)
  })

  it('a QUOTA error on the write is logged and never breaks the answer; in this session the refinement still starts fresh', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    const first = await run({ filters: [F('pct_vs_ema20', 'gt', 0)] })
    await flush()
    expect(typeof first === 'string' && first.startsWith("I didn't run it")).toBe(false)   // the screen answered
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[uct-agent\] screener: this browser could not keep the unsaved screen \(QuotaExceededError\)/))
    noteConversation('ac_2'); await ensureLast(); noteConversation('ac_1')
    expect(await run({ mode: 'refine', filters: TECH })).toBe(`I didn't run it: ${LAST_SCREEN_UNREAD.replace(/\.$/, '')}.`)
    expect(scans()).toHaveLength(1)
  })
})
