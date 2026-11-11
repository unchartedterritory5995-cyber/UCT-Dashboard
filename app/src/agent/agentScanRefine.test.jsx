// W1-C C-01 (builder-c): the LAST SCREEN as server-persisted refinement state (SC-2 §3). A screen run here is written
// to the conversation's state; after a "reload" (the screener cache emptied) a follow-up composes onto the server's
// copy; a sector replaces the universe slot, a sort replaces only the sort; a refinement adding a hidden UCT field is
// refused with the F-16 sentence + one public alternative; no last screen asks, never guesses. No model, no provider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCapability, buildContext } from './capabilities'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache, lastScreenNow, ensureLast } from './capabilities/screener'
import { noteConversation } from './agentClient'
import {
  composeRefine, refineRefusal, publicAlternative, hiddenKeys, RATINGS_REFUSAL, FLOW_REFUSAL, ALT_STRENGTH, ALT_SETUP, ALT_FLOW, NO_LAST_SCREEN, LAST_SCREEN_UNREAD,
} from './capabilities/scanRefine'

registerBuiltins()
const CTX = { surface: 'charts' }
const META = { fields: [
  { key: 'pct_vs_ema20', label: '% vs 20 EMA', type: 'range', unit: '%' },
  { key: 'vol_ratio', label: 'Volume Ratio', type: 'range', unit: '' },
  { key: 'price', label: 'Price', type: 'range', unit: '$' },
  { key: 'chg_pct_3m', label: 'Change 3M', type: 'range', unit: '%' },
  { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '' },
  { key: 'candle_score', label: 'Setup Score', type: 'range', unit: '' },
  { key: 'sector', label: 'Sector', type: 'enum' },
  { key: 'industry', label: 'Industry', type: 'enum' },
] }
const OPTIONS = { options: { sector: { values: ['Technology', 'Energy'], total: 100, with_value: 100 }, industry: { values: ['Software - Application', 'Semiconductors'], total: 100, with_value: 100 } } }
const ROWS = [{ ticker: 'AAA', company: 'A', price: 12, chg_pct_1d: 1 }, { ticker: 'BBB', company: 'B', price: 40, chg_pct_1d: 2 }]

let calls, state
beforeEach(() => {
  _resetScreenerCache(); noteConversation('ac_1')
  calls = []; state = {}                                     // the server's agent_conversation_state rows, by conversation
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
      if (method === 'PUT') { state[m[1]] = body.value; return json({ key: 'lastScreen', value: body.value }) }
      return json({ key: 'lastScreen', value: state[m[1]] || null, updated_at: state[m[1]] ? 1 : null })
    }
    return json({})
  })
})
afterEach(() => { noteConversation(null); vi.restoreAllMocks() })

const run = (args) => getCapability('screener.run').answer(null, { filters: [], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null, ...args }, null, CTX)
const F = (field, op, value, extra = {}) => ({ field, op, value, max: null, values: null, ...extra })
const scans = () => calls.filter(c => c[1] === '/api/screener/scan')
const puts = () => calls.filter(c => c[0] === 'PUT' && /\/state\/lastScreen$/.test(c[1]))
const gets = () => calls.filter(c => c[0] === 'GET' && /\/state\/lastScreen$/.test(c[1]))
const flush = () => new Promise(r => setTimeout(r, 0))

describe('persisted per conversation', () => {
  it('a screen run here is written to the conversation state (spec + result ids), fire-and-forget', async () => {
    await run({ filters: [F('pct_vs_ema20', 'gt', 0), F('vol_ratio', 'gte', 2)] })
    await flush()
    expect(puts()).toHaveLength(1)
    expect(puts()[0][1]).toBe('/api/agent/conversations/ac_1/state/lastScreen')
    expect(puts()[0][2].value).toEqual({ spec: { filters: [{ key: 'pct_vs_ema20', op: 'gt', min: 0 }, { key: 'vol_ratio', op: 'gte', min: 2 }], post: [], sort: null },
      symbols: ['AAA', 'BBB'], total: 2, asOf: '2026-10-30', name: null, savedId: null })
  })
  it('after a reload, a refinement composes onto the SERVER copy of the last screen (one GET), and is persisted again', async () => {
    await run({ filters: [F('pct_vs_ema20', 'gt', 0), F('vol_ratio', 'gte', 2)] })
    await flush()
    _resetScreenerCache()                                      // the reload: nothing in memory
    expect(lastScreenNow()).toBeNull()
    await run({ mode: 'refine', filters: [F('price', 'gte', 10)] })
    expect(gets()).toHaveLength(1)
    expect(scans()[1][2].filters).toEqual([{ key: 'pct_vs_ema20', op: 'gt', min: 0 }, { key: 'vol_ratio', op: 'gte', min: 2 }, { key: 'price', op: 'gte', min: 10 }])
    await flush()
    expect(state.ac_1.spec.filters).toHaveLength(3)
    // the model's context now shows the restored screen as lastScreen
    const { context } = buildContext({}, { ...CTX, message: 'sort them by three-month performance' })
    expect(context.screener[0].lastScreen).toMatchObject({ ref: 'lastScreen', matches: 2 })
    expect(context.screener[0].lastScreen.filters).toEqual(['% vs 20 EMA > 0%', 'Volume Ratio ≥ 2', 'Price ≥ $10'])
  })
  it('"now only technology" replaces the universe slot; "sort by three-month change" replaces only the sort', async () => {
    await run({ filters: [F('pct_vs_ema20', 'gt', 0), F('sector', 'in', null, { values: ['Energy'] })] })
    await run({ mode: 'refine', filters: [F('sector', 'in', null, { values: ['Technology'] })] })
    expect(scans()[1][2].filters).toEqual([{ key: 'pct_vs_ema20', op: 'gt', min: 0 }, { key: 'sector', op: 'in', values: ['Technology'] }])
    await run({ mode: 'refine', filters: [F('industry', 'in', null, { values: ['Semiconductors'] })] })
    expect(scans()[2][2].filters).toEqual([{ key: 'pct_vs_ema20', op: 'gt', min: 0 }, { key: 'industry', op: 'in', values: ['Semiconductors'] }])
    await run({ mode: 'refine', filters: [], sort_field: 'chg_pct_3m', sort_dir: 'desc' })
    expect(scans()[3][2]).toMatchObject({ filters: scans()[2][2].filters, sort: { key: 'chg_pct_3m', dir: 'desc' } })
  })
  it('a chat switch: the other conversation\'s screen is restored; a brand-new chat has none and asks', async () => {
    state.ac_2 = { spec: { filters: [{ key: 'price', op: 'gte', min: 50 }], post: [], sort: null }, symbols: ['ZZZ'], total: 1, asOf: '2026-10-30', name: null, savedId: null }
    await run({ filters: [F('pct_vs_ema20', 'gt', 0)] })
    noteConversation('ac_2')
    await run({ mode: 'refine', filters: [F('vol_ratio', 'gte', 2)] })
    expect(scans()[1][2].filters).toEqual([{ key: 'price', op: 'gte', min: 50 }, { key: 'vol_ratio', op: 'gte', min: 2 }])
    noteConversation(null)                                     // "New chat"
    expect(await run({ mode: 'refine', filters: [F('vol_ratio', 'gte', 2)] })).toBe(`I didn't run it: ${NO_LAST_SCREEN.replace(/\.$/, '')}.`)
    expect(scans()).toHaveLength(2)
  })
  it('a screen run before the chat had an id is adopted by the chat on its first id, and persisted then', async () => {
    noteConversation(null)
    await run({ filters: [F('pct_vs_ema20', 'gt', 0)] })
    await flush()
    expect(puts()).toHaveLength(0)
    noteConversation('ac_9')
    expect(await ensureLast()).toMatchObject({ spec: { filters: [{ key: 'pct_vs_ema20', op: 'gt', min: 0 }] } })
    await flush()
    expect(puts().map(p => p[1])).toEqual(['/api/agent/conversations/ac_9/state/lastScreen'])
  })
  // TERM-033 (AUDIT bar, 2026-11-10): the state write and read ended in `.catch(() => null)` and ignored a failed
  // result, so an UNREADABLE last screen read exactly like NO last screen ("Which screen should I narrow?"), and a
  // failed write was dropped without a word. Both are now logged, and the refinement says it is starting fresh.
  it('the server unreachable: the answer is unaffected; the failed write and read are logged; the refinement says it is starting fresh', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const real = globalThis.fetch
    globalThis.fetch = vi.fn(async (u, i) => (/\/state\/lastScreen$/.test(String(u)) ? new Response('', { status: 500 }) : real(u, i)))
    const a = await run({ filters: [F('pct_vs_ema20', 'gt', 0)] })
    expect(a.text).toMatch(/^2 stocks match/)
    await flush()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[uct-agent\] screener: this chat's last screen was not saved \(/))
    _resetScreenerCache()
    expect(await run({ mode: 'refine', filters: [F('price', 'gte', 10)] })).toBe(`I didn't run it: ${LAST_SCREEN_UNREAD.replace(/\.$/, '')}.`)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[uct-agent\] screener: this chat's last screen could not be read back \(/))
    expect(scans()).toHaveLength(1)                            // nothing was narrowed from a guess
  })
  it('a FAILED write is not silently lost: switching away and back does not refine the OLDER server copy, it starts fresh', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    state.ac_1 = { spec: { filters: [{ key: 'price', op: 'gte', min: 50 }], post: [], sort: null }, symbols: ['OLD'], total: 1, asOf: '2026-10-29', name: null, savedId: null }
    const real = globalThis.fetch
    globalThis.fetch = vi.fn(async (u, i) => ((i?.method === 'PUT' && /\/state\/lastScreen$/.test(String(u))) ? new Response('', { status: 503 }) : real(u, i)))
    await run({ filters: [F('pct_vs_ema20', 'gt', 0)] })      // the newer screen; its write fails
    await flush()
    noteConversation('ac_2'); await ensureLast()
    noteConversation('ac_1')
    expect(await run({ mode: 'refine', filters: [F('vol_ratio', 'gte', 2)] })).toBe(`I didn't run it: ${LAST_SCREEN_UNREAD.replace(/\.$/, '')}.`)
    expect(scans().map(s => s[2].filters)).toEqual([[{ key: 'pct_vs_ema20', op: 'gt', min: 0 }]])   // never the OLD price ≥ 50 screen
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[uct-agent\] screener: this chat's last screen was not saved \(HTTP 503/))
  })
  it('a read that succeeds with NO stored screen is still the plain question (empty is not unavailable)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await run({ mode: 'refine', filters: [F('price', 'gte', 10)] })).toBe(`I didn't run it: ${NO_LAST_SCREEN.replace(/\.$/, '')}.`)
    expect(gets()).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('F-16 on a refinement: the owner\'s sentence + ONE public alternative, never a formula', () => {
  it('adding a hidden field to the last screen is refused before any scan; the alternative is a public field', async () => {
    await run({ filters: [F('pct_vs_ema20', 'gt', 0)] })
    const a = await run({ mode: 'refine', filters: [F('rs_rank', 'gte', 80)] })
    expect(a).toBe(`I didn't run it: ${RATINGS_REFUSAL}. A public alternative: 3-month price change (chg_pct_3m).`)
    expect(await run({ mode: 'refine', filters: [], sort_field: 'rs_rank', sort_dir: 'desc' })).toMatch(/A public alternative: 3-month price change \(chg_pct_3m\)/)
    expect(await run({ mode: 'refine', filters: [F('candle_score', 'gte', 50)] })).toMatch(/A public alternative: distance from the 52-week high \(dist_52w_high_pct\)/)
    expect(scans()).toHaveLength(1)
    expect(lastScreenNow().spec.filters).toEqual([{ key: 'pct_vs_ema20', op: 'gt', min: 0 }])      // the last screen is untouched
  })
  it('pure: refineRefusal / publicAlternative for the whole hidden set (scanHidden.js); the wording never names a weight or formula', () => {
    expect(refineRefusal(['price', 'chg_pct_3m'])).toBeNull()
    expect(refineRefusal(['dp_notional_1d'])).toBe(`${FLOW_REFUSAL}. A public alternative: ${ALT_FLOW.label} (${ALT_FLOW.key}).`)
    expect(publicAlternative('pattern_expectancy_r')).toEqual(ALT_SETUP)
    expect(publicAlternative('uct_composite')).toEqual(ALT_STRENGTH)
    for (const k of hiddenKeys()) {
      const s = refineRefusal([k])
      expect(s).toBeTruthy()
      for (const w of ['0.40', '0.20', '25/18', 'weight', 'formula', 'percentile', 'sum of']) expect(s).not.toContain(w)
      expect(s.match(/\(/g)).toHaveLength(1)
      expect(hiddenKeys().has(publicAlternative(k).key)).toBe(false)
    }
  })
  it('composeRefine: add / narrow replace by key, universe replaces the slot, sort replaces only the sort (the server mirror has the same rules)', () => {
    const last = { filters: [{ key: 'pct_vs_ema20', op: 'gt', min: 0 }, { key: 'sector', op: 'in', values: ['Energy'] }], post: [{ key: 'dollar_volume_1d', op: 'gte', min: 1e7 }], sort: { key: 'price', dir: 'asc' } }
    expect(composeRefine(last, { wire: [{ key: 'price', op: 'gte', min: 10 }] }).spec).toEqual({ filters: [...last.filters, { key: 'price', op: 'gte', min: 10 }], post: last.post, sort: last.sort })
    expect(composeRefine(last, { wire: [{ key: 'industry', op: 'in', values: ['Semiconductors'] }] }).spec.filters).toEqual([{ key: 'pct_vs_ema20', op: 'gt', min: 0 }, { key: 'industry', op: 'in', values: ['Semiconductors'] }])
    expect(composeRefine(last, { sort: { key: 'chg_pct_3m', dir: 'desc' } }).spec).toEqual({ ...last, sort: { key: 'chg_pct_3m', dir: 'desc' } })
    expect(composeRefine(last, { post: [{ key: 'dollar_volume_1d', op: 'gte', min: 2e7 }] }).spec.post).toEqual([{ key: 'dollar_volume_1d', op: 'gte', min: 2e7 }])
    expect(composeRefine(last, { wire: [{ key: 'rs_rank', op: 'gte', min: 80 }] }).error).toMatch(/A public alternative/)
  })
})
