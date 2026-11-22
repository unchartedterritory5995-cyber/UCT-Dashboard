// The Agent's scanner composition (owner: agent-sc): the model composes primitives; there is no handler per sentence.
// A field against a field, `contains` on a token list, a weighted rank and a `logic` tree reach the engine as its own wire
// spec. A tree that is exactly a flat screen runs flat; any other tree is refused in a sentence while the server has
// groups off, and is never run looser. F-16 holds through every new shape. No model, no provider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCapability, buildContext, shapeError, registerContextProvider, CONTEXT_BUDGET_BYTES } from './capabilities'
import { registerBuiltins } from './builtins'
import { _resetScreenerCache, lastScreenNow, flattenLogic, fieldNotes, followUpShape, loadMeta, loadOptions, registerScreenMeasures, LOGIC_OFF } from './capabilities/screener'
import { turnStart, turnEnd, _resetTurns } from './trace'
import { noteConversation } from './agentClient'
import { decodeSpec } from '../pages/screener/shell/specUrl'
import { RATINGS_REFUSAL, FLOW_REFUSAL } from './capabilities/scanHidden'

registerBuiltins()
const CTX = { surface: 'charts' }
const CASES = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../api/services/uct_agent/scan/eval/composition_flatten_cases.json'), 'utf8'))
const RUN_RULE = 'Positive counts consecutive sessions above, negative consecutive sessions below. +1 is the session it crossed up, -1 the session it crossed down. Measured at the last completed session.'
const META = (logic) => ({
  ...(logic === undefined ? {} : { logic_enabled: logic }),
  live_fields: ['price', 'rsi14'],
  fields: [
    { key: 'price', label: 'Price', type: 'range', unit: '$' },
    { key: 'pt_target', label: 'Price Target', type: 'range', unit: '$' },
    { key: 'pe_fwd', label: 'Forward P/E', type: 'range', unit: '' },
    { key: 'rsi14', label: 'RSI (14)', type: 'range', unit: '' },
    { key: 'chg_pct_1d', label: 'Change Today', type: 'range', unit: '%' },
    { key: 'chg_pct_1w', label: 'Change 1W', type: 'range', unit: '%' },
    { key: 'chg_pct_3m', label: 'Change 3M', type: 'range', unit: '%' },
    { key: 'run_sma50_sma200', label: 'SMA50 vs SMA200 Run', type: 'range', unit: '', description: `The 50-day SMA against the 200-day SMA: +1 is a golden cross, -1 a death cross. ${RUN_RULE}` },
    { key: 'run_close_sma50', label: 'Sessions vs SMA50', type: 'range', unit: '', description: `The close against its 50-day SMA. ${RUN_RULE}` },
    { key: 'is_etf', label: 'ETF', type: 'bool', unit: '' },
    { key: 'sector', label: 'Sector', type: 'enum' },
    { key: 'industry', label: 'Industry', type: 'enum' },
    { key: 'candle_type', label: 'Candle Type', type: 'enum', category: 'single_candle' },
    { key: 'candle_trend', label: 'Prior Trend', type: 'enum', category: 'single_candle_trend' },
    { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '', description: 'a percentile of a proprietary return' },
    { key: 'dp_notional_1d', label: 'Dark Pool', type: 'range', unit: '$' },
  ],
})
const OPTIONS = { options: {
  sector: { values: ['Technology', 'Energy', 'Healthcare'], total: 100, with_value: 100 },
  industry: { values: ['Semiconductors'], total: 100, with_value: 100 },
  candle_type: { values: ['Hammer', 'Doji', 'Gravestone Doji'], wire: { Hammer: ',hammer,', Doji: ',doji,', 'Gravestone Doji': ',gravestone-doji,' }, token: true },
  candle_trend: { values: ['Uptrend', 'Downtrend'], wire: { Uptrend: 'up', Downtrend: 'down' } },
} }
const ROWS = [{ ticker: 'AAA', company: 'A', price: 12, chg_pct_1d: 1 }, { ticker: 'BBB', company: 'B', price: 40, chg_pct_1d: 2 }]

let calls, state, logicFlag, scanStatus, rankReceipt
beforeEach(() => {
  _resetScreenerCache(); noteConversation('ac_c')
  calls = []; state = {}; logicFlag = false; scanStatus = null; rankReceipt = null
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([method, u, body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/screener/fields') return json(META(logicFlag))
    if (u === '/api/screener/fields?options=1') return json(OPTIONS)
    if (u === '/api/screener/scan') {
      if (scanStatus) return json({ detail: scanStatus }, 400)
      return json({ total: 2, rows: ROWS.slice(0, body.page_size), snapshot_date: '2026-10-30', ...(rankReceipt ? { rank: rankReceipt } : {}) })
    }
    const m = /^\/api\/agent\/conversations\/([^/]+)\/state\/lastScreen$/.exec(u)
    if (m) {
      if (method === 'PUT') { state[m[1]] = body.value; return json({ key: 'lastScreen', value: body.value }) }
      return json({ key: 'lastScreen', value: state[m[1]] || null, updated_at: state[m[1]] ? 1 : null })
    }
    return json({})
  })
})
afterEach(() => { noteConversation(null); vi.restoreAllMocks() })

const cap = () => getCapability('screener.run')
const ARGS = { filters: [], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null, logic: null, rank: null }
const run = (args) => cap().answer(null, { ...ARGS, ...args }, null, CTX)
const F = (field, op, value, extra = {}) => ({ field, op, value, max: null, values: null, ...extra })
const L = (field, op, words) => ({ field, op, value: null, max: null, values: words })
const scans = () => calls.filter(c => c[1] === '/api/screener/scan')
const body = () => { const s = scans(); return s[s.length - 1]?.[2] }
const flush = () => new Promise(r => setTimeout(r, 0))
const text = (a) => (typeof a === 'string' ? a : a.text)
const OR = JSON.stringify({ any: [F('rsi14', 'lte', 30), F('rsi14', 'gte', 70)] })
const contextOf = async (message = 'find stocks') => {
  await loadMeta(); await loadOptions()
  const { context } = buildContext(null, { surface: 'charts', message })
  return context.screener[0]
}

describe('what the model is told about a field', () => {
  it('🔴 a field’s catalog description reaches the model, so a signed run of 1 reads as a fresh cross', async () => {
    const s = await contextOf()
    expect(s.fieldNotes.run_sma50_sma200).toContain('+1 is a golden cross')
    expect(JSON.stringify(s)).toContain('+1 is the session it crossed up')
  })
  it('a sentence two fields share is written once and every definition reads back whole', () => {
    const fields = META(false).fields.filter(f => f.key.startsWith('run_'))
    const { notes, key } = fieldNotes(fields)
    expect(Object.keys(key).length).toBe(3)
    expect(JSON.stringify({ notes, key }).length).toBeLessThan(fields.reduce((a, f) => a + f.description.length, 0))
    for (const f of fields) expect(notes[f.key].replace(/\[(\w+)\]/g, (_, id) => key[id])).toBe(f.description)
  })
  it('no description: no notes', () => { expect(fieldNotes([{ key: 'a' }])).toBeNull() })
  it('⛔ a hidden field’s definition never reaches the context', async () => {
    const s = await contextOf()
    expect(JSON.stringify(s)).not.toContain('proprietary return')
    expect(s.fieldNotes.rs_rank).toBeUndefined()
  })
  it('over the context budget the notes go first, and the section says so', async () => {
    await loadMeta(); await loadOptions()
    const off = registerContextProvider({ key: 'zz_big', build: () => 'x'.repeat(CONTEXT_BUDGET_BYTES) })
    const { context } = buildContext(null, { surface: 'charts', message: 'find stocks' })
    off()
    const s = context.screener[0]
    expect(s.fieldNotes).toBeUndefined()
    expect(s.fieldNotesKey).toBeUndefined()
    expect(s.fieldNotesDetail).toMatch(/omitted/)
    expect(s.fields).toContain('price:Price')
    expect(s.compose).toBeTruthy()
  })
  it('with groups off, the model is told so in the same breath as how to write one', async () => {
    expect((await contextOf()).compose).toMatch(/logic is OFF/)
    _resetScreenerCache(); logicFlag = true
    expect((await contextOf()).compose).not.toMatch(/logic is OFF/)
  })
  it('the composition rules cost nothing on a turn that is no screen', async () => {
    const s = await contextOf('hello there')
    expect(s.compose).toBeUndefined()
    expect(s.fieldNotes).toBeUndefined()
  })
})

describe('the manifest stays inside the server’s limits', () => {
  it('hints, shape and the whole capability fit, so nothing is cut or dropped', () => {
    const c = cap()
    expect(c.hints.length).toBeLessThanOrEqual(1000)                 // turn.py MAX_HINTS: past it the text is cut
    expect(c.shape.length).toBeLessThanOrEqual(600)                  // turn.py MAX_SHAPE
    expect(JSON.stringify({ name: c.name, summary: c.summary, hints: c.hints, args: c.args, shape: c.shape }).length).toBeLessThan(6000) // MAX_CAP_BYTES: past it the action is dropped
  })
  it('arguments from before composition (fast paths, stored plans) stay valid', () => {
    const { logic: _l, rank: _r, ...old } = ARGS
    expect(shapeError('screener.run', { ...old, filters: [F('price', 'gt', 1)] }, { surface: 'charts' })).toBeNull()
    expect(shapeError('screener.run', { ...ARGS, logic: OR }, { surface: 'charts' })).toBeNull()
    expect(shapeError('screener.run', { ...ARGS, logic: { any: [] } }, { surface: 'charts' })).toMatch(/wrong kind/)
    expect(shapeError('screener.run', { ...ARGS, rank: '[]' }, { surface: 'charts' })).toBeNull()
  })
})

describe('the wire contract (composition_flatten_cases.json, run through the real validator by pytest)', () => {
  for (const c of CASES.wire) {
    it(c.why, async () => {
      logicFlag = true
      await run(c.args)
      const b = body()
      expect(b.filters).toEqual(c.spec.filters)
      expect(b.logic ?? null).toEqual(c.spec.logic ?? null)
      expect(b.rank ?? null).toEqual(c.spec.rank ?? null)
    })
  }
})

describe('flattening: only what is exactly flat', () => {
  for (const c of CASES.flatten) it(c.why, () => { expect(flattenLogic(c.tree)).toEqual(c.flat) })
})

describe('a logic tree', () => {
  it('🔴 groups off, and it has no exact flat form: refused in a sentence, nothing runs', async () => {
    const a = await run({ logic: OR })
    expect(text(a)).toContain(LOGIC_OFF)
    expect(text(a)).toMatch(/^I didn't run it/)
    expect(scans()).toHaveLength(0)
    expect(lastScreenNow()).toBeNull()
  })
  it('⛔ groups off: the conditions around the tree do not run on their own either', async () => {
    await run({ filters: [F('price', 'gt', 20)], logic: OR })
    expect(scans()).toHaveLength(0)
  })
  it('groups off, exactly flat: it runs as a flat screen', async () => {
    const a = await run({ logic: JSON.stringify({ any: [L('sector', 'in', ['energy']), L('sector', 'in', ['technology'])] }) })
    expect(body().logic).toBeUndefined()
    expect(body().filters).toEqual([{ key: 'sector', op: 'in', values: ['Energy', 'Technology'] }])
    expect(text(a)).toContain('Sector: Energy, Technology')
  })
  it('groups off, "none of" a sector: runs as not_in', async () => {
    await run({ logic: JSON.stringify({ none: [L('sector', 'in', ['energy'])] }) })
    expect(body().filters).toEqual([{ key: 'sector', op: 'not_in', values: ['Energy'] }])
  })
  it('groups off, "none of" a number is not exact (a blank passes it): refused, never `lte`', async () => {
    expect(text(await run({ logic: JSON.stringify({ none: [F('price', 'gt', 10)] }) }))).toContain(LOGIC_OFF)
    expect(scans()).toHaveLength(0)
  })
  it('groups on: the tree goes to the engine and is said in the answer', async () => {
    logicFlag = true
    const a = await run({ filters: [F('price', 'gt', 20)], logic: OR })
    expect(body().logic).toEqual({ any: [{ key: 'rsi14', op: 'lte', max: 30 }, { key: 'rsi14', op: 'gte', min: 70 }] })
    expect(text(a)).toContain('any of (RSI (14) ≤ 30 or RSI (14) ≥ 70)')
  })
  it('an older server (no flag reported): tried, and the engine’s own refusal is the answer', async () => {
    logicFlag = undefined
    scanStatus = 'Grouped criteria (any of / none of) are not switched on yet, so this screen was not run.'
    const a = await run({ logic: OR })
    expect(scans()).toHaveLength(1)
    expect(text(a)).toBe("I didn't run it: Grouped criteria (any of / none of) are not switched on yet, so this screen was not run.")
  })
  it('a list field inside a tree is matched to its real values, a sector word to the sector', async () => {
    logicFlag = true
    await run({ logic: JSON.stringify({ any: [L('industry', 'in', ['tech']), F('rsi14', 'lt', 30)] }) })
    expect(body().logic.any[0]).toEqual({ key: 'sector', op: 'in', values: ['Technology'] })
  })
  it.each([
    ['not JSON', '{any:'],
    ['two group keys', JSON.stringify({ any: [F('price', 'gt', 1)], all: [F('price', 'gt', 1)] })],
    ['an empty group', JSON.stringify({ any: [] })],
    ['too deep', JSON.stringify({ all: [{ all: [{ all: [{ all: [{ all: [F('price', 'gt', 1)] }] }] }] }] })],
    ['an unknown field', JSON.stringify({ any: [F('nope', 'gt', 1), F('price', 'gt', 1)] })],
  ])('refused, not guessed: %s', async (_w, logic) => {
    logicFlag = true
    expect(text(await run({ logic }))).toMatch(/^I didn't run it/)
    expect(scans()).toHaveLength(0)
  })
  it('too many leaves is refused here', async () => {
    logicFlag = true
    const many = JSON.stringify({ any: Array.from({ length: 26 }, (_, i) => F('price', 'gt', i)) })
    expect(text(await run({ logic: many }))).toContain('at most 25')
  })
  it('the Open link carries the tree, so it never opens a broader screen', async () => {
    logicFlag = true
    const a = await run({ logic: OR })
    expect(decodeSpec(new URLSearchParams(a.link.href.split('?')[1]).get('s')).logic).toEqual(body().logic)
  })
})

describe('field against field', () => {
  it('reads as words', async () => {
    const a = await run({ filters: [{ field: 'pt_target', op: 'gt_col', other: 'price' }] })
    expect(text(a)).toContain('Price Target > Price')
    expect(body().columns).toEqual(expect.arrayContaining(['pt_target', 'price']))
  })
  it.each([
    ['an unknown other', { field: 'price', op: 'gt_col', other: 'nope' }, /no field/],
    ['no other', { field: 'price', op: 'gt_col' }, /no field/],
    ['a list other', { field: 'price', op: 'gt_col', other: 'sector' }, /number field/],
    ['a yes/no left side', { field: 'is_etf', op: 'gt_col', other: 'price' }, /compared/],
  ])('refused: %s', async (_w, f, re) => {
    expect(text(await run({ filters: [f] }))).toMatch(re)
    expect(scans()).toHaveLength(0)
  })
})

describe('⛔ two clocks in one comparison', () => {
  const CLOCKS = /mixes two clocks while the market is open/
  it('a live field against a nightly one is said, either way round', async () => {
    expect(text(await run({ filters: [{ field: 'pt_target', op: 'gt_col', other: 'price' }] }))).toMatch(/Price updates with the live price during the session and Price Target does not/)
    expect(text(await run({ filters: [{ field: 'price', op: 'gt_col', other: 'pt_target' }] }))).toMatch(/Price updates with the live price during the session and Price Target does not/)
  })
  it('two live fields, or two nightly ones, read one clock: nothing to say', async () => {
    expect(text(await run({ filters: [{ field: 'price', op: 'gt_col', other: 'rsi14' }] }))).not.toMatch(CLOCKS)
    expect(text(await run({ filters: [{ field: 'chg_pct_1w', op: 'gt_col', other: 'chg_pct_3m' }] }))).not.toMatch(CLOCKS)
  })
  it('inside a group too', async () => {
    logicFlag = true
    const a = await run({ logic: JSON.stringify({ any: [{ field: 'price', op: 'gt_col', other: 'pt_target' }, F('chg_pct_1w', 'gt', 5)] }) })
    expect(text(a)).toMatch(CLOCKS)
  })
})

describe('contains on Candle Type', () => {
  it('🔴 `in` with the member’s word sends the wrapped token (the engine tests tokens: tests/test_uct_agent_scan_compose.py)', async () => {
    await run({ filters: [L('candle_type', 'in', ['hammer'])] })
    expect(body().filters).toEqual([{ key: 'candle_type', op: 'in', values: [',hammer,'] }])
  })
  it('an exact word is that pattern, never its longer relatives', async () => {
    await run({ filters: [L('candle_type', 'contains', ['doji'])] })
    expect(body().filters).toEqual([{ key: 'candle_type', op: 'contains', value: ',doji,' }])
  })
  it('contains requires every word', async () => {
    await run({ filters: [L('candle_type', 'contains', ['hammer', 'doji'])] })
    expect(body().filters).toEqual([{ key: 'candle_type', op: 'contains', value: ',hammer,' }, { key: 'candle_type', op: 'contains', value: ',doji,' }])
  })
  it('the answer says the pattern’s name, not its token', async () => {
    const a = await run({ filters: [L('candle_type', 'contains', ['hammer'])] })
    expect(text(a)).toContain('Candle Type: Hammer')
    expect(text(a)).not.toContain(',hammer,')
  })
  it('an unknown pattern is refused with the real names', async () => {
    expect(text(await run({ filters: [L('candle_type', 'contains', ['unicorn'])] }))).toContain('no Candle Type matching “unicorn”')
    expect(scans()).toHaveLength(0)
  })
  it('a preset list field takes the label or the stored word, and sends what the engine stores', async () => {
    await run({ filters: [L('candle_trend', 'in', ['uptrend'])] })
    expect(body().filters).toEqual([{ key: 'candle_trend', op: 'in', values: ['up'] }])
    await run({ filters: [L('candle_trend', 'in', ['down'])] })
    expect(body().filters).toEqual([{ key: 'candle_trend', op: 'in', values: ['down'] }])
  })
  it('contains on a one-value field: one word is that value, several are refused', async () => {
    await run({ filters: [L('sector', 'contains', ['energy'])] })
    expect(body().filters).toEqual([{ key: 'sector', op: 'in', values: ['Energy'] }])
    expect(text(await run({ filters: [L('sector', 'contains', ['energy', 'technology'])] }))).toMatch(/holds one value/)
  })
  it('none of a pattern runs flat', async () => {
    await run({ logic: JSON.stringify({ none: [L('candle_type', 'contains', ['doji'])] }) })
    expect(body().filters).toEqual([{ key: 'candle_type', op: 'not_in', values: [',doji,'] }])
  })
})

describe('rank', () => {
  const R = [{ field: 'chg_pct_3m', weight: 70, lower_better: false }, { field: 'pe_fwd', weight: 30, lower_better: true }]
  it('sends the engine’s rank and says the weighting, never the default order', async () => {
    const a = await run({ filters: [F('price', 'gt', 5)], rank: R })
    expect(body().rank).toEqual({ criteria: [{ key: 'chg_pct_3m', weight: 70 }, { key: 'pe_fwd', weight: 30, ascending: true }] })
    expect(text(a)).toContain('by your weighted rank (Change 3M 70%, Forward P/E 30% (lower is better))')
    expect(text(a)).not.toContain('market cap')
  })
  it('⛔ rows the rank had to drop are said with a count', async () => {
    rankReceipt = { excluded_incomplete: 7 }
    expect(text(await run({ rank: R }))).toContain('7 more matched but are missing a ranked value')
  })
  it('a rank and a sort together are asked about, never one silently dropped', async () => {
    expect(text(await run({ rank: R, sort_field: 'price', sort_dir: 'asc' }))).toMatch(/which one/)
    expect(scans()).toHaveLength(0)
  })
  it.each([
    ['a list field', [{ field: 'sector', weight: 1, lower_better: false }], /number field/],
    ['an unknown field', [{ field: 'nope', weight: 1, lower_better: false }], /no field/],
    ['a repeat', [R[0], R[0]], /twice/],
    ['a zero weight', [{ field: 'price', weight: 0, lower_better: false }], /positive/],
    ['too many', Array.from({ length: 9 }, () => R[0]), /at most 8/],
  ])('refused: %s', async (_w, rank, re) => {
    expect(text(await run({ rank }))).toMatch(re)
    expect(scans()).toHaveLength(0)
  })
  it('the Open link carries the rank', async () => {
    const a = await run({ rank: R })
    expect(decodeSpec(new URLSearchParams(a.link.href.split('?')[1]).get('s')).rank).toEqual(body().rank)
  })
})

describe('⛔ F-16: no new way in', () => {
  const HID = [['rs_rank', RATINGS_REFUSAL], ['dp_notional_1d', FLOW_REFUSAL]]
  const SHAPES = {
    'a filter': (k) => ({ filters: [F(k, 'gte', 1)] }),
    'other in a filter': (k) => ({ filters: [{ field: 'price', op: 'gt_col', other: k }] }),
    'a compared left side': (k) => ({ filters: [{ field: k, op: 'gt_col', other: 'price' }] }),
    'a logic leaf': (k) => ({ logic: JSON.stringify({ any: [F(k, 'gte', 1), F('price', 'gt', 1)] }) }),
    'a deep leaf': (k) => ({ logic: JSON.stringify({ none: [{ not: { any: [F(k, 'gte', 1)] } }] }) }),
    'other in a leaf': (k) => ({ logic: JSON.stringify({ any: [{ field: 'price', op: 'gt_col', other: k }] }) }),
    'a leaf by key': (k) => ({ logic: JSON.stringify({ any: [{ key: k, op: 'gte', min: 1 }] }) }),
    'a rank measure': (k) => ({ rank: [{ field: k, weight: 1, lower_better: false }] }),
    'the second rank measure': (k) => ({ rank: [{ field: 'price', weight: 1, lower_better: false }, { field: k, weight: 1, lower_better: false }] }),
  }
  for (const [name, make] of Object.entries(SHAPES)) {
    it.each(HID)(`${name}: %s refused with the sentence and a public alternative, nothing runs`, async (k, sentence) => {
      logicFlag = true
      const a = text(await run(make(k)))
      expect(a).toContain(sentence)
      expect(a).toContain('A public alternative:')
      expect(scans()).toHaveLength(0)
    })
  }
  it('a refinement through a new shape is refused the same way', async () => {
    logicFlag = true
    await run({ filters: [F('price', 'gt', 1)] })
    const n = scans().length
    expect(text(await run({ mode: 'refine', logic: JSON.stringify({ any: [F('rs_rank', 'gte', 90), F('price', 'gt', 9)] }) }))).toContain(RATINGS_REFUSAL)
    expect(text(await run({ mode: 'refine', rank: [{ field: 'rs_rank', weight: 1, lower_better: false }] }))).toContain(RATINGS_REFUSAL)
    expect(scans()).toHaveLength(n)
  })
})

describe('refinements compose with the new shapes', () => {
  const TECH = { mode: 'refine', filters: [L('sector', 'in', ['technology'])] }
  const FLOOR = { mode: 'refine', filters: [F('price', 'gte', 10)] }
  it('🔴 "now only tech" on a grouped screen keeps the group', async () => {
    logicFlag = true
    await run({ filters: [F('price', 'gt', 20)], logic: OR })
    const tree = body().logic
    await run(TECH)
    expect(body().logic).toEqual(tree)
    expect(body().filters).toEqual(expect.arrayContaining([{ key: 'sector', op: 'in', values: ['Technology'] }, { key: 'price', op: 'gt', min: 20 }]))
  })
  it('🔴 "drop anything under $10" on a grouped screen narrows, and the group stays', async () => {
    logicFlag = true
    await run({ logic: OR })
    await run(FLOOR)
    expect(body().filters).toEqual([{ key: 'price', op: 'gte', min: 10 }])
    expect(body().logic.any).toHaveLength(2)
  })
  it('keeps a comparison and a contains', async () => {
    await run({ filters: [{ field: 'pt_target', op: 'gt_col', other: 'price' }, L('candle_type', 'contains', ['hammer'])] })
    await run(FLOOR)
    expect(body().filters).toEqual([{ key: 'pt_target', op: 'gt_col', other: 'price' }, { key: 'candle_type', op: 'contains', value: ',hammer,' }, { key: 'price', op: 'gte', min: 10 }])
  })
  it('keeps a rank, and "sort them by price" replaces it: one order at a time', async () => {
    await run({ rank: [{ field: 'chg_pct_3m', weight: 1, lower_better: false }] })
    await run(TECH)
    expect(body().rank).toEqual({ criteria: [{ key: 'chg_pct_3m', weight: 1 }] })
    await run({ mode: 'refine', sort_field: 'price', sort_dir: 'asc' })
    expect(body().rank).toBeUndefined()
    expect(body().sort).toEqual({ key: 'price', dir: 'asc' })
  })
  it('a rank on a refinement replaces the sort', async () => {
    await run({ filters: [F('price', 'gt', 1)], sort_field: 'price', sort_dir: 'desc' })
    await run({ mode: 'refine', rank: [{ field: 'chg_pct_3m', weight: 1, lower_better: false }] })
    expect(body().rank).toBeTruthy()
    expect(lastScreenNow().spec.sort).toBeNull()
  })
  it('a new group on a refinement is ANDed on, never swapped in', async () => {
    logicFlag = true
    await run({ logic: OR })
    const first = body().logic
    await run({ mode: 'refine', logic: JSON.stringify({ any: [F('chg_pct_1d', 'gte', 5), F('chg_pct_1w', 'gte', 15)] }) })
    expect(body().logic.all[0]).toEqual(first)
  })
  it('a sector over a group that names a sector still applies the group, and says so', async () => {
    logicFlag = true
    await run({ logic: JSON.stringify({ any: [L('sector', 'in', ['technology']), F('rsi14', 'lt', 30)] }) })
    expect(text(await run({ mode: 'refine', filters: [L('sector', 'in', ['energy'])] }))).toContain('Your earlier group still applies')
  })
  it('🔴 after a reload the group and the rank come back, so a refinement never runs looser', async () => {
    logicFlag = true
    await run({ logic: OR, rank: [{ field: 'chg_pct_3m', weight: 1, lower_better: false }] })
    await flush()
    const tree = body().logic
    _resetScreenerCache()                                     // the reload: nothing in memory
    await run(FLOOR)
    expect(body().logic).toEqual(tree)
    expect(body().rank).toEqual({ criteria: [{ key: 'chg_pct_3m', weight: 1 }] })
  })
  it('groups switched off since: a refinement of a stored group is refused, not run without it', async () => {
    logicFlag = true
    await run({ logic: OR })
    await flush()
    _resetScreenerCache(); logicFlag = false
    const n = scans().length
    expect(text(await run(FLOOR))).toContain(LOGIC_OFF)
    expect(scans()).toHaveLength(n)
  })
  it('screener.state says the group and the rank', async () => {
    logicFlag = true
    await run({ logic: OR, rank: [{ field: 'chg_pct_3m', weight: 1, lower_better: false }] })
    const a = getCapability('screener.state').answer()
    expect(a).toContain('any of (')
    expect(a).toContain('a weighted rank (Change 3M 100%)')
  })
  it('the model sees the last screen’s group', async () => {
    logicFlag = true
    await run({ logic: OR })
    expect((await contextOf()).lastScreen.filters.join(' ')).toContain('any of (')
  })
})

describe('⛔ one clock: latest-session measures', () => {
  let un
  beforeEach(() => { un = registerScreenMeasures({ id: 'sess', label: 'session data', measures: [{ key: 'close_s', label: 'Close (latest session)', unit: '$', supersedes: 'price', type: 'range' }], resolve: async () => ({ asOf: '2026-10-30', values: {} }) }) })
  afterEach(() => un())
  it('a measure cannot go inside a group', async () => {
    logicFlag = true
    expect(text(await run({ logic: JSON.stringify({ any: [F('close_s', 'gt', 1), F('price', 'gt', 1)] }) }))).toMatch(/can't go inside/)
  })
  it('a measure cannot be compared', async () => {
    expect(text(await run({ filters: [{ field: 'pt_target', op: 'gt_col', other: 'close_s' }] }))).toMatch(/can't be compared/)
  })
  it('a measure cannot be ranked', async () => {
    expect(text(await run({ rank: [{ field: 'close_s', weight: 1, lower_better: false }] }))).toMatch(/can't be ranked/)
  })
  it('a field the measure supersedes cannot sit in a comparison or group beside it: two days in one screen', async () => {
    logicFlag = true
    const a = await run({ filters: [F('close_s', 'gt', 1), { field: 'price', op: 'gt_col', other: 'pt_target' }] })
    expect(text(a)).toMatch(/read different days/)
    const b = await run({ filters: [F('close_s', 'gt', 1)], logic: JSON.stringify({ any: [F('price', 'gt', 1), F('rsi14', 'lt', 30)] }) })
    expect(text(b)).toMatch(/read different days/)
    expect(scans()).toHaveLength(0)
  })
})

describe('⛔ a new screen starts clean; only a follow-up builds on the last one (AUDIT live, 2026-11-05)', () => {
  const FULL = 'find stocks up 20% this month near 52-week highs'
  const UP = [F('chg_pct_1m', 'gte', 20), F('dist_52w_high_pct', 'gte', -5)]
  /** One member turn: the words reach the context, then the model's args run. */
  const turn = async (text, args) => {
    turnStart('send')
    try { await loadMeta(); await loadOptions(); buildContext(null, { surface: 'charts', message: text }); return await run(args) } finally { turnEnd() }
  }
  beforeEach(async () => {
    _resetTurns(); logicFlag = true
    await run({ filters: [L('sector', 'in', ['technology']), L('industry', 'in', ['semiconductors']), F('price', 'gt', 5)] })
  })
  const KEYS = () => body().filters.map(f => f.key)
  it('🔴 a full new request the model marked refine does not inherit the sector or the industry', async () => {
    const n = scans().length
    const a = await turn(FULL, { mode: 'refine', filters: [F('chg_pct_3m', 'gte', 20), F('rsi14', 'gte', 50)] })
    expect(scans()).toHaveLength(n + 1)
    expect(KEYS()).toEqual(['chg_pct_3m', 'rsi14'])
    expect(text(a)).toContain('nothing from your last one carried over')
  })
  it.each([
    ['only tech', [L('sector', 'in', ['energy'])]],
    ['drop under $10', [F('price', 'gte', 10)]],
    ['no stocks under $10', [F('price', 'gte', 10)]],
    ['now only the ones above $20', [F('price', 'gt', 20)]],
    ['semis', [L('sector', 'in', ['energy'])]],
    ['stocks above $20', [F('price', 'gt', 20)]],
    ['of those, only stocks over $20 with rsi above 50', [F('price', 'gt', 20), F('rsi14', 'gt', 50)]],
    ['from the results, rsi over 50 and above $20', [F('price', 'gt', 20), F('rsi14', 'gt', 50)]],
  ])('one condition, or a word pointing back, stays a refinement: %s', async (said, filters) => {
    await turn(said, { mode: 'refine', filters })
    expect(KEYS()).toEqual(expect.arrayContaining(['price']))
    expect(body().filters.length).toBeGreaterThan(filters.length - (filters[0].field === 'price' ? 0 : 1))
  })
  it('⛔ reference words are the only word class: two conditions with none start clean, whatever the opener', async () => {
    await turn('only tech above $10', { mode: 'refine', filters: [L('sector', 'in', ['energy']), F('rsi14', 'gt', 10)] })
    expect(KEYS()).toEqual(['sector', 'rsi14'])
  })
  it('the model writing the last screen’s industry back into a new screen is asked about', async () => {
    const n = scans().length
    const a = await turn(FULL, { mode: 'new', filters: [L('industry', 'in', ['semiconductors']), F('rsi14', 'gt', 50)] })
    expect(a).toMatch(/^Should I narrow/)
    expect(scans()).toHaveLength(n)
  })
  it('the member naming that industry again is simply a new screen', async () => {
    await turn('find semiconductor stocks with rsi above 50', { mode: 'new', filters: [L('industry', 'in', ['semiconductors']), F('rsi14', 'gt', 50)] })
    expect(KEYS()).toEqual(['industry', 'rsi14'])
  })
  it('mode new with fresh conditions is untouched', async () => {
    await turn(FULL, { mode: 'new', filters: [F('chg_pct_3m', 'gte', 20)] })
    expect(KEYS()).toEqual(['chg_pct_3m'])
  })
  it('a tree: a full new screen starts clean, and its leaves count as its conditions', async () => {
    logicFlag = true
    await turn('find stocks up 5% today or up 15% on the week', { mode: 'refine', logic: JSON.stringify({ any: [F('chg_pct_1d', 'gte', 5), F('chg_pct_1w', 'gte', 15)] }) })
    expect(body().filters).toEqual([])
    expect(body().logic.any).toHaveLength(2)
  })
  it('a tree: a new screen after a grouped one does not keep the group', async () => {
    logicFlag = true
    await run({ logic: OR })
    await turn(FULL, { mode: 'refine', filters: [F('chg_pct_3m', 'gte', 20), F('price', 'gt', 5)] })
    expect(body().logic).toBeUndefined()
  })
  it('a tree: a refinement keeps the group', async () => {
    logicFlag = true
    await run({ logic: OR })
    await turn('only tech', { mode: 'refine', filters: [L('sector', 'in', ['technology'])] })
    expect(body().logic.any).toHaveLength(2)
  })
  it('a rank alone re-orders the last screen: it adds no stocks of its own to decide about', async () => {
    await turn('rank them by 3 month change', { mode: 'refine', rank: [{ field: 'chg_pct_3m', weight: 1, lower_better: false }] })
    expect(KEYS()).toContain('industry')
  })
  it('the rule is structure plus reference words', () => {
    expect(followUpShape('highest rsi stocks', 0)).toBe('refine')
    expect(followUpShape('stocks above $20', 1)).toBe('refine')
    expect(followUpShape('up 5% with rsi over 50', 2)).toBe('new')
    expect(followUpShape('those up 5% with rsi over 50', 2)).toBe('refine')
  })
  it('⛔ another turn’s words never decide this one', async () => {
    turnStart('send'); buildContext(null, { surface: 'charts', message: FULL }); turnEnd()
    await run({ mode: 'refine', filters: [F('price', 'gte', 10), F('rsi14', 'gt', 50)] })   // a panel action, no turn
    expect(KEYS()).toContain('industry')
  })
  it('the model is told the rule', async () => {
    expect((await contextOf()).compose).toMatch(/is new, even right after a screen/)
  })
})

describe('Open link', () => {
  it('two filters on one field: the link says what it leaves out', async () => {
    const a = await run({ logic: JSON.stringify({ all: [F('rsi14', 'gte', 30), F('rsi14', 'lte', 70)] }) })
    expect(body().filters).toHaveLength(2)
    expect(a.link.label).toBe('Open in Screener (without RSI (14))')
  })
})
