// PHASE 2 — generalized phrasing (one shared normalizer over the existing capability phrases),
// clarification policy, multi-step reliability. docs/agent/PHASE2.md.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { fastParse, canon } from './fastPath'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()

const ONE = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'wl', type: 'watchlist', x: 12, y: 0, w: 6, h: 20, opts: {} }]
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }, { id: 's1', name: 'Swing', symbols: ['TSLA'] }]
const hostOf = (widgets = ONE) => makeBoard(widgets, { A: 'AAPL' }, { watchlists: LISTS }).host
const parse = (t, host = hostOf()) => {
  const f = fastParse(t, { host })
  if (!f) return 'MODEL'
  if (f.kind !== 'ops') return f.kind
  return f.ops.map(o => `${o.action}${JSON.stringify(o.args)}`).join(' + ')
}

describe('the normalizer rewrites wording variants, never meaning', () => {
  it.each([
    ['Switch this chart to five minutes.', 'switch the chart to 5 minute'],
    ['Make this a 5m chart', 'make this a 5 minute chart'],
    ['throw a 20-period exponential moving average on this chart', 'add a 20 ema'],
    ['Get rid of RSI', 'remove rsi'],
    ['Remove the RSI indicator.', 'remove the rsi'],
    ['take RSI off the chart', 'remove rsi'],
    ['screen for stocks over $10m in volume', 'screen for stocks over $10m in volume'],   // money is never a timeframe
  ])('%s → %s', (raw, out) => expect(canon(raw)).toBe(out))
})

describe('variants reach the SAME capability with the same arguments (no model call)', () => {
  it.each([
    ['Switch this chart to five minutes.', 'chart.setTimeframe{"timeframe":"5"}'],
    ['Now change that chart to 15 minutes', 'chart.setTimeframe{"timeframe":"15"}'],
    ['Make this a 5m chart', 'chart.setTimeframe{"timeframe":"5"}'],
    ['change my chart to 15 minutes', 'chart.setTimeframe{"timeframe":"15"}'],
    ['15m', 'chart.setTimeframe{"timeframe":"15"}'],
    ['switch to the hourly', 'chart.setTimeframe{"timeframe":"60"}'],
    ['Add RSI', 'indicator.add{"defId":"rsi","inputs":null}'],
    ['put the RSI indicator on my chart', 'indicator.add{"defId":"rsi","inputs":null}'],
    ['throw VWAP on this chart', 'indicator.add{"defId":"vwap","inputs":null}'],
    ['Get rid of RSI', 'indicator.remove{"instance":"rsi"}'],
    ['Remove the RSI indicator.', 'indicator.remove{"instance":"rsi"}'],
    ['take RSI off the chart', 'indicator.remove{"instance":"rsi"}'],
    ['Open my momentum watchlist', 'watchlist.open{"list":"m1"}'],
    ['pull up my Swing list', 'watchlist.open{"list":"s1"}'],
    ['add VWAP and RSI', 'indicator.add{"defId":"vwap","inputs":null} + indicator.add{"defId":"rsi","inputs":null}'],
    ['Add VWAP and RSI, then change my chart to five minutes', 'indicator.add{"defId":"vwap","inputs":null} + indicator.add{"defId":"rsi","inputs":null} + chart.setTimeframe{"timeframe":"5"}'],
  ])('%s', (t, want) => expect(parse(t)).toBe(want))
})

describe('NOT guessed: anything not obvious still goes to the model', () => {
  it.each([
    'add macd 8 21 5',                      // three lengths, none called `period` — the model maps them
    'remove it',                            // which?
    'open my trading layout',               // no such layout here → the model (or a question)
    'show me my strongest stocks',
    'delete my Swing watchlist',            // "delete" is never folded into "remove"
    'find stocks over $10m dollar volume',
  ])('%s', (t) => expect(parse(t)).toBe('MODEL'))
})

// ── multi-step through the real panel: indicator edits + a timeframe on ONE chart ──
import { vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mergeChartSettings } from '../components/chart/chartDefaults'
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

let calls
beforeEach(() => {
  calls = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url) => {
    calls.push(String(url))
    return new Response(JSON.stringify(url === '/api/agent/record' ? { conversationId: 'c' } : { conversations: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => { vi.restoreAllMocks() })

/** One chart whose settings round-trip through a stored copy (the chart's own persist path). */
function chartHost({ manage = true, charts = [{ ref: 'c1', label: 'Chart (AAPL)', position: null }] } = {}) {
  const store = Object.fromEntries(charts.map(c => [c.ref, { cs: JSON.parse(JSON.stringify(mergeChartSettings(null))), tf: 'D', symbol: 'AAPL' }]))
  const read = (c) => ({ ...c, symbol: store[c.ref].symbol, tf: store[c.ref].tf, cs: mergeChartSettings(JSON.stringify(store[c.ref].cs)), stored: store[c.ref].cs, linkedCount: 0 })
  return {
    store,
    charts: {
      list: () => charts.map(read),
      read: (ref) => { const c = charts.find(x => x.ref === ref); return c ? read(c) : null },
      commit: (ref, patch) => {
        if ('settings' in patch) store[ref].cs = JSON.parse(JSON.stringify(patch.settings))
        if ('tf' in patch) store[ref].tf = patch.tf
        if (patch.symbol) store[ref].symbol = patch.symbol
        return true
      },
      canManageIndicators: () => manage,
    },
    persist: async () => ({ ok: true }),
    otherWidgets: () => [],
  }
}
const defIds = (h, ref = 'c1') => (mergeChartSettings(JSON.stringify(h.store[ref].cs)).indicatorInstances || []).filter(i => !i.deleted).map(i => i.defId)

async function say(t) {
  const box = screen.getByLabelText('Message UCT Agent')
  await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 })
  fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' })
}
const turns = () => calls.filter(c => c === '/api/agent/turn').length

// Waits here allow 6 s: each step is a real save + read-back, slower when the whole suite runs in
// parallel (the deploy gate). A passing run still returns as soon as the condition holds.
describe('MULTI-STEP on one chart, no model call', { timeout: 30000 }, () => {
  it('"Add VWAP and RSI, then change my chart to five minutes": all three land, each indicator its own receipt + Undo; no approval needed (one chart, reversible)', async () => {
    const h = chartHost()
    render(<AgentPanel host={h} onClose={() => {}} />)
    await say('Add VWAP and RSI, then change my chart to five minutes')
    await waitFor(() => expect(defIds(h)).toEqual(expect.arrayContaining(['vwap', 'rsi'])), { timeout: 6000 })
    expect(h.store.c1.tf).toBe('5')
    expect(turns()).toBe(0)
    expect(screen.queryByTestId('agent-proposal')).toBeNull()
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(3), { timeout: 6000 })   // timeframe, VWAP, RSI
    const text = screen.getAllByTestId('agent-receipt').map(r => r.textContent).join(' | ')
    expect(text).toMatch(/VWAP/); expect(text).toMatch(/RSI|Relative Strength/); expect(text).toMatch(/5-minute|5m|5 min/i)
    // typed undo takes back the NEWEST step only (RSI), never the earlier ones
    await say('undo')
    await waitFor(() => expect(defIds(h)).not.toContain('rsi'), { timeout: 6000 })
    expect(defIds(h)).toContain('vwap')
  })
  it('"get rid of RSI" is a PROPOSAL (removal can disconnect other indicators) — approval preserved', async () => {
    const h = chartHost()
    render(<AgentPanel host={h} onClose={() => {}} />)
    await say('add RSI')
    await waitFor(() => expect(defIds(h)).toContain('rsi'), { timeout: 6000 })
    // the add is DONE only at its receipt (the store is written before the save is confirmed)
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(1), { timeout: 6000 })
    await say('get rid of RSI')
    try {
      await screen.findByTestId('agent-proposal', {}, { timeout: 6000 })
    } catch (e) {                                   // a rare failure in the gate is readable, not guessed
      console.log('[agentPhase2 diagnostic] transcript:', screen.getByTestId('agent-transcript').textContent.split('heavy lifting.')[1])
      throw e
    }
    expect(defIds(h)).toContain('rsi')
    await say('do it')
    await waitFor(() => expect(defIds(h)).not.toContain('rsi'), { timeout: 6000 })
    expect(turns()).toBe(0)
  })
  it('two charts: "add RSI" asks WHICH chart (a necessary question, named as a chart) — never guesses', async () => {
    const h = chartHost({ charts: [{ ref: 'c1', label: 'Left chart (AAPL)', position: 'left' }, { ref: 'c2', label: 'Right chart (AAPL)', position: 'right' }] })
    render(<AgentPanel host={h} onClose={() => {}} />)
    await say('add RSI')
    const q = await screen.findByTestId('agent-question')
    expect(q.textContent).toMatch(/Which chart\?/)
    expect(defIds(h, 'c1')).not.toContain('rsi'); expect(defIds(h, 'c2')).not.toContain('rsi')
    await say('add RSI to the left chart')
    await waitFor(() => expect(defIds(h, 'c1')).toContain('rsi'), { timeout: 6000 })
    expect(defIds(h, 'c2')).not.toContain('rsi')
  })
})

// ── MILESTONE 3: act on clear intent with defaults; ask only when a decision is genuinely missing ──
import { getCapability } from './capabilities'
import * as screenerMod from './capabilities/screener'

const withLayouts = (names, widgets = ONE, lists = LISTS) => makeBoard(widgets, { A: 'AAPL' }, {
  watchlists: lists,
  layouts: { entries: names.map((name, i) => ({ id: i + 1, name })), boards: {}, active: null },
}).host

describe('clarification policy, by category (deterministic path)', () => {
  it('CLEAR: "add RSI" on the only chart — the default RSI, no question', () => {
    expect(parse('add RSI')).toBe('indicator.add{"defId":"rsi","inputs":null}')
  })
  it('DEFAULT: "show me my watchlist" = the list a widget shows; with ONE list and no widget, that list', () => {
    const shown = hostOf([...ONE.slice(0, 1), { id: 'wl', type: 'watchlist', x: 12, y: 0, w: 6, h: 20, opts: { watchKey: 'user:s1' } }])
    expect(parse('show me my watchlist', shown)).toMatch(/^watchlist\.show/)
    expect(fastParse('show me my watchlist', { host: shown }).ops[0].target).toBe('s1')
    const single = makeBoard([ONE[0]], { A: 'AAPL' }, { watchlists: [LISTS[0]] }).host
    expect(fastParse('show me my watchlist', { host: single }).ops[0].target).toBe('m1')
  })
  it('AMBIGUITY: two lists and no widget showing one — "my watchlist" is not guessed', () => {
    expect(parse('show me my watchlist', hostOf([ONE[0]]))).toBe('MODEL')
  })
  it('DEFAULT: "switch to my trading layout" = the ONE layout named with those words', () => {
    const h = withLayouts(['Main Trading', 'Swing Setups'])
    expect(parse('switch to my trading layout', h)).toBe('layout.open{"layout":"1"}')
  })
  it('AMBIGUITY: two layouts match "trading" — the words are handed on, and the Agent ASKS which (never guesses)', () => {
    const h = withLayouts(['Main Trading', 'Day Trading'])
    expect(parse('switch to my trading layout', h)).toBe('layout.open{"layout":"trading layout"}')
    const r = getCapability('layout.open').resolveArgs({ layout: 'trading layout' }, h)
    expect(r.ask.choices.map(c => c.label)).toEqual(['Main Trading', 'Day Trading'])
  })
  it('SAFETY: a bare word opens a layout only by its EXACT name ("open NVDA" never opens a layout)', () => {
    const h = withLayouts(['NVDA Earnings'])
    expect(parse('open NVDA', h)).not.toMatch(/^layout\.open/)
    expect(parse('open NVDA Earnings', h)).toBe('layout.open{"layout":"1"}')
  })
  it('SETTINGS (Phase 2.5): "put a 20 EMA on my chart" is added AS a 20 EMA — never a default moving average', () => {
    expect(parse('Put a 20 EMA on my chart')).toBe('indicator.add{"defId":"movingAverage","inputs":[{"key":"period","value":20},{"key":"maType","value":"ema"}]}')
  })
  it('UNSAFE: "delete" is never read as "remove" (a list delete is permanent and always a proposal)', () => {
    expect(parse('delete my Swing watchlist')).toBe('MODEL')
    expect(getCapability('watchlist.delete').risk).toBe('confirm')
  })
  it('APPROVAL: removals stay proposals even on the instant path', () => {
    expect(getCapability('indicator.remove').risk).toBe('confirm')
  })
})

describe('"my strongest stocks": WITHIN the member\'s own list, through the Screener\'s own My Lists universe', () => {
  it('within → the engine\'s list filter (wl:<id>), named in the answer', async () => {
    const calls = []
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null
      calls.push([String(url), body])
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url === '/api/screener/fields') return json({ fields: [{ key: 'rs_rank', label: 'RS Rank', type: 'range', unit: '' }] })
      if (url === '/api/screener/scan') return json({ total: 1, rows: [{ ticker: 'NVDA', rs_rank: 97 }], snapshot_date: '2026-10-10' })
      return json({})
    })
    screenerMod._resetScreenerCache()
    const a = await getCapability('screener.run').answer(null, { filters: [], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: null, within: 'm1' }, hostOf())
    const scan = calls.find(c => c[0] === '/api/screener/scan')[1]
    expect(scan.filters).toEqual([{ key: 'list', op: 'in', value: 'wl:m1' }])
    expect(scan.sort).toEqual({ key: 'rs_rank', dir: 'desc' })
    expect(a.text).toContain('In “Momentum”')
    expect(await getCapability('screener.run').answer(null, { filters: [], sort_field: 'rs_rank', sort_dir: 'desc', mode: 'new', show: null, as: null, within: 'zz' }, hostOf()))
      .toMatch(/isn't one of your watchlists/)
  })
})

// ── MILESTONE 6: Agent ⇄ Screener consistency ──
import { decodeSpec } from '../pages/screener/shell/specUrl'

describe('Agent and Screener mean the same screen', () => {
  const mockEngine = () => {
    const calls = []
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null
      calls.push([String(url), body])
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url === '/api/screener/fields') return json({ fields: [{ key: 'price', label: 'Price', type: 'range', unit: '$', category: 'descriptive' }, { key: 'industry', label: 'Industry', type: 'enum', category: 'descriptive' }] })
      if (url === '/api/screener/fields?options=1') return json({ options: { industry: { values: ['Banks - Regional', 'Software - Application', 'Software - Infrastructure'], with_value: 3, total: 3 } } })
      if (url === '/api/screener/scan') return json({ total: 2, rows: [{ ticker: 'AAA' }, { ticker: 'BBB' }], snapshot_date: '2026-10-10' })
      if (url === '/api/agent/session-stats') return json({ session: '2026-10-09', rows: { AAA: { close: 12, volume: 2e6, dollar_volume: 2.4e7 }, BBB: { close: 9, volume: 1e6, dollar_volume: 9e6 } }, missing: [] })
      return json({})
    })
    return calls
  }
  it('criteria the Screener holds (industry + price): its "Open in Screener" link carries EXACTLY the filters the Agent ran', async () => {
    const calls = mockEngine()
    screenerMod._resetScreenerCache()
    const a = await getCapability('screener.run').answer(null, { filters: [
      { field: 'industry', op: 'in', value: null, max: null, values: ['software'] }, { field: 'price', op: 'gt', value: 10, max: null, values: null }],
    sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null }, hostOf())
    const ran = calls.find(c => c[0] === '/api/screener/scan')[1].filters
    const linked = decodeSpec(new URLSearchParams(a.link.href.split('?')[1]).get('s')).filters
    expect(Object.fromEntries(ran.map(({ key, ...rest }) => [key, rest]))).toEqual(linked)
    expect(a.link.label).toBe('Open in Screener')
  })
  it('a latest-session condition the Screener cannot hold yet is SAID on the link, and never saved into a broader screen', async () => {
    mockEngine()
    screenerMod._resetScreenerCache()
    const a = await getCapability('screener.run').answer(null, { filters: [
      { field: 'price', op: 'gt', value: 10, max: null, values: null }, { field: 'dollar_volume_1d', op: 'gt', value: 1e7, max: null, values: null }],
    sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null }, hostOf())
    expect(a.text).toMatch(/^1 stock matches/)                                   // only AAA traded > $10M at > $10
    expect(a.link.label).toMatch(/^Open in Screener \(without .*Dollar Volume \(latest session\)/)
    const why = getCapability('screener.saveAs').check({ loaded: true, last: screenerMod.lastScreenNow().spec, mine: [], starters: [] }, { name: 'X' })
    expect(why).toMatch(/can’t hold yet — saving it would drop that condition/)
  })
})

describe('a request for SPECIFIC indicator settings is never faked with a default indicator', () => {
  // ⭐ Phase 2.5 (agentMutations add with `inputs`): the instant path now ADDS these with exactly the
  // requested settings — still never a default one in their place. agentIndicatorsInputs.test.jsx
  // drives them through the real interface (validation, read-back, receipt, Undo).
  it.each([
    ['Put a 20 EMA on my chart', '{"defId":"movingAverage","inputs":[{"key":"period","value":20},{"key":"maType","value":"ema"}]}'],
    ['add a 50 sma', '{"defId":"movingAverage","inputs":[{"key":"period","value":50},{"key":"maType","value":"sma"}]}'],
    ['add RSI 7', '{"defId":"rsi","inputs":[{"key":"period","value":7}]}'],
    ['throw a 20-period exponential moving average on this chart', '{"defId":"movingAverage","inputs":[{"key":"period","value":20},{"key":"maType","value":"ema"}]}'],
    ['add the 200 day moving average', '{"defId":"movingAverage","inputs":[{"key":"period","value":200},{"key":"maType","value":"sma"}]}'],   // Gate C: owner MA default
  ])('instant path adds "%s" with exactly those settings', (t, args) => expect(parse(t)).toBe(`indicator.add${args}`))
  it('the model is told: every requested setting goes in inputs; never a default one in its place', () => {
    const h = getCapability('indicator.add').hints
    expect(h).toMatch(/Every number or type the member named goes in inputs/)
    expect(h).toMatch(/never drop one or add a default instead/)
  })
})
