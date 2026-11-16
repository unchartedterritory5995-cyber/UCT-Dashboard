// ⛔ H14 HOTFIX · UNIQUE IDENTIFICATION (2026-11-14, AUDIT probes 47/48) — a change to an EXISTING object is licensed only when
// the words identify THAT object uniquely: its name / ticker, a deixis (on the sole / selected / conversation object), its
// position, the member's pick / click (with a replace word, for charts), a CLASS noun when that class has exactly ONE instance
// in scope, or (charts) a REPLACE word on the sole or selected chart. Otherwise asked (with the candidates) or refused — never
// a silent pick. "show / open / pull up X" alone never re-symbols.
//   PANEL  charts: identification form × chart count × verb class, the owner's D22 sentences and the controls
//   PURE   indicator / drawing / list (stateRailRefusal): identification form × instances in scope × verb class
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { stateRailRefusal } from './stateRail'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// ── PANEL · charts ────────────────────────────────────────────────────────────────────────────────────────────────────
const SYMS = ['SPY', 'QQQ', 'NVDA', 'TSLA']
const chart = (id, x, y, w, h) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() } })
const board = (n) => {
  const cells = n === 1 ? [chart('c0', 0, 0, 24, 20)] : n === 2 ? [chart('c0', 0, 0, 12, 20), chart('c1', 12, 0, 12, 20)]
    : [chart('c0', 0, 0, 12, 10), chart('c1', 12, 0, 12, 10), chart('c2', 0, 10, 12, 10), chart('c3', 12, 10, 12, 10)]
  return [cells, Object.fromEntries(cells.map((c, i) => [`N:${c.id}`, SYMS[i]]))]
}
const decorate = (s) => (s ? { ...s, label: `Chart (${s.symbol})` } : s)
// how the words identify the SPY chart (c0, top-left on 2 / 4 charts)
const FORMS = {
  name: { x: 'the SPY chart', select: false },
  deixis: { x: 'this chart', select: true },
  position: { x: (n) => (n === 4 ? 'the top left chart' : 'the left chart'), select: false },
  selection: { x: '', select: true },
  'class noun': { x: 'the chart', select: false },
  none: { x: '', select: false },
}
const VERBS = {
  replace: (x) => `switch ${x ? `${x} ` : ''}to AMD`,
  additive: (x) => `add AMD${x ? ` to ${x}` : ''}`,
  other: (x) => `show AMD${x ? ` on ${x}` : ''}`,
}
// the rule, stated once (the expectations are computed from it, never listed by hand)
function licensed(form, n, verb) {
  if (verb === 'additive') return false                                       // ADD never replaces (the existing chart rail)
  if (form === 'position' && n === 1) return null                             // no position on a one-chart board: not generated
  if (['name', 'position'].includes(form)) return true
  if (form === 'deixis') return true                                          // on the selected chart (or the sole one)
  if (form === 'class noun') return n === 1
  if (n === 1) return true                                                    // ⛔ D23: the sole chart, whatever the verb
  if (form === 'selection') return true                                       // the member's click identifies the chart
  return n === 1                                                              // ⛔ D23: the SOLE chart is identified by being the only one
}
const CHART_CASES = []
for (const form of Object.keys(FORMS)) for (const n of [1, 2, 4]) for (const verb of Object.keys(VERBS)) {
  const want = licensed(form, n, verb)
  if (want === null) continue
  const x = typeof FORMS[form].x === 'function' ? FORMS[form].x(n) : FORMS[form].x
  CHART_CASES.push([form, n, verb, VERBS[verb](x), want])
}
const symsOf = (m) => m.board.state.widgets.filter(w => w.type === 'chart').map(w => m.h.charts.read(w.id).symbol)

describe(`CHART · generated matrix (${CHART_CASES.length} cases): form × charts × verb — a plan re-symbolling the SPY chart`, () => {
  it.each(CHART_CASES)('%s · %i chart(s) · %s · "%s" → licensed %s', async (form, n, verb, said, want) => {
    const m = p.mount(...board(n), { decorate })
    if (FORMS[form].select) p.select('c0')
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts.find(c => c.symbol === 'SPY').ref, args: { symbol: 'AMD' } }]))
    const out = await m.say(said)
    if (p.proposals().length) await m.say('do it')
    const after = symsOf(m)
    if (want) expect(after[0], out).toBe('AMD')
    else {
      expect(after, out).toEqual(SYMS.slice(0, n))                          // never a silent re-symbol
      // refused, or ASKED which chart (this rail's choices, or an earlier screen's) — the candidates, nothing changed
      expect(out).toMatch(/I didn.t change anything|Which chart|you asked for more charts/)
    }
  }, 40000)
})

// the owner's live sentences (AUDIT probe 47). ⛔ D23 (owner 2026-11-15): on ONE chart they SWITCH it (TradingView convention,
// Undo available); on SEVERAL charts with none selected they are asked (each chart a button), nothing changing before the pick
const SHOW = ['show me AAPL', 'pull up MSFT', 'bring up AMD please', 'can I see TSLA', 'put NVDA up', 'let me look at AMD', 'aapl', 'go back to NVDA']
const CONTROLS = [['switch to AMD', 'AMD'], ['change this chart to AMD', 'AMD'], ['replace SPY with AMD', 'AMD'], ['show AMD instead', 'AMD']]
const tickerOf = (s) => (s.match(/\b[A-Z]{3,5}\b/g) || []).filter(t => t !== 'SPY').pop()
const tick = (s) => (s.match(/\b[A-Za-z]{3,5}\b/g) || []).map(t => t.toUpperCase()).filter(t => ['AAPL', 'MSFT', 'AMD', 'TSLA', 'NVDA'].includes(t)).pop()
describe('CHART · the owner\'s sentences (D23): one chart switches; several charts, none selected, are asked', () => {
  it.each(SHOW)('ONE chart · "%s" → the sole chart switches', async (said) => {
    const m = p.mount(...board(1), { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: tick(said) } }]))
    const out = await m.say(said)
    if (p.proposals().length) await m.say('do it')
    expect(symsOf(m), out).toEqual([tick(said)])
  }, 40000)
  it.each(SHOW)('TWO charts, none selected · "%s" → asked, nothing changed', async (said) => {
    const m = p.mount(...board(2), { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[1].ref, args: { symbol: tick(said) } }]))
    const out = await m.say(said)
    expect(symsOf(m), out).toEqual(['SPY', 'QQQ'])
    expect(out).toMatch(/Which chart|I didn.t change anything|You named/)
  }, 40000)
  // ⛔ AUDIT T2 4: "open AAPL and MSFT" on the sole chart — the final board holds BOTH, or nothing changes
  it.each([
    ['open AAPL and MSFT', ['AAPL', 'MSFT']], ['open AAPL, MSFT and AMD', ['AAPL', 'MSFT', 'AMD']], ['open AAPL then MSFT', ['AAPL', 'MSFT']],
  ])('ONE chart · "%s" · a plan re-symbolling the sole chart (ending on the last one) → refused, SPY kept', async (said, syms) => {
    const m = p.mount(...board(1), { decorate })
    p.st.envelopes.push(b => p.env('apply', syms.map(t => ({ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: t } }))))
    const out = await m.say(said)
    expect(symsOf(m), out).toEqual(['SPY'])
    expect(out).toMatch(/I didn.t change anything|You named|Which/)
  }, 40000)
  it.each(CONTROLS)('control "%s" → the chart becomes %s', async (said, to) => {
    const m = p.mount(...board(1), { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: to } }]))
    const out = await m.say(said)
    if (p.proposals().length) await m.say('do it')
    expect(symsOf(m), out).toEqual([to])
  }, 40000)
  it('two charts, "show AMD" + a STALE pick: the board changed since the ask → nothing applied, said', async () => {
    const m = p.mount(...board(2), { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts[1].ref, args: { symbol: 'AMD' } }]))
    const out = await m.say('please show AMD')
    if (/Which chart should change/.test(out)) {
      m.h.charts.setSymbol ? m.h.charts.setSymbol('c0', 'IWM') : (m.board.state.groupSyms['N:c0'] = 'IWM')
      await m.click('Chart (SPY)')
      expect(symsOf(m), p.transcript()).not.toContain('AMD')
      expect(p.transcript()).toMatch(/Your board changed since I asked/)
    }
  }, 40000)
  it('two charts, "show AMD": asked with the charts as choices; the pick re-symbols exactly that one', async () => {
    const m = p.mount(...board(2), { decorate })
    p.st.envelopes.push(b => p.env('apply', [{ action: 'chart.setSymbol', target: b.context.charts.find(c => c.symbol === 'QQQ').ref, args: { symbol: 'AMD' } }]))
    const out = await m.say('show AMD')
    expect(out).toMatch(/Which chart/)
    expect(symsOf(m)).toEqual(['SPY', 'QQQ'])
    await m.click('Chart (SPY)')
    expect(symsOf(m), p.transcript()).toEqual(['AMD', 'QQQ'])
  }, 40000)
})

// the owner's indicator sentence (AUDIT probe 48): four moving averages, "the moving average" is a CLASS with 4 instances
describe('INDICATOR · "change the 20 ema to 50 and recolour the moving average red" never recolours a guessed average', () => {
  it('the SMA 50 (or any MA) is never silently recoloured; the request is asked / refused', async () => {
    const m = p.mount([[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }], { 'N:c': 'SPY' }][0], { 'N:c': 'SPY' })
    p.st.envelopes.push(b => p.env('apply', [
      { action: 'indicator.update', target: b.context.indicatorEdits[0].ref, args: { instance: 'ovl:1', inputs: [{ key: 'period', value: 50 }] } },
      { action: 'indicatorStyle.set', target: b.context.indicatorEdits[0].ref, args: { instance: 'ovl:2', property: 'color', value: 'red', output: null } },
    ]))
    const before = p.instancesOn(m.board, 'c').map(i => i.inputs?.color)
    const out = await m.say('change the 20 ema to 50 and recolour the moving average red')
    const after = p.instancesOn(m.board, 'c')
    expect(after.find(i => i.instanceId === 'ovl:2').inputs?.color, out).toBe(before[2])
    expect(out).toMatch(/I didn.t change anything|Which one do you mean/)
  }, 40000)
})

// ── PURE · indicator / drawing / list ─────────────────────────────────────────────────────────────────────────────────
const MAS = [{ instanceId: 'i0', defId: 'movingAverage', inputs: { period: 9, maType: 'ema' }, name: 'EMA 9' }, { instanceId: 'i1', defId: 'movingAverage', inputs: { period: 50, maType: 'sma' }, name: 'SMA 50' },
  { instanceId: 'i2', defId: 'movingAverage', inputs: { period: 20, maType: 'ema' }, name: 'EMA 20' }, { instanceId: 'i3', defId: 'movingAverage', inputs: { period: 200, maType: 'sma' }, name: 'SMA 200' }]
const DRAW = [{ id: 'd0', type: 'trendline', points: [] }, { id: 'd1', type: 'horizontal', points: [] }, { id: 'd2', type: 'fib', points: [] }, { id: 'd3', type: 'ray', points: [] }]
const KINDS = {
  indicator: {
    plan: (n, op) => ({ ok: true, plans: [{ kind: 'indicatorEdits', ref: 'ixe:c', before: { rows: MAS.slice(0, n), chartRef: 'c' }, patch: { change: { request: { op: op === 'remove' ? 'remove' : 'setColor', instanceId: 'i0' } } } }] }),
    words: { name: { modify: 'make the 9 ema red', remove: 'remove the 9 ema' }, 'class noun': { modify: 'make the moving average red', remove: 'remove the moving average' }, none: { modify: 'make it red', remove: 'remove it' } },
  },
  drawing: {
    plan: (n, op) => ({ ok: true, plans: [{ kind: 'drawing', ref: 'SPY', before: { symbol: 'SPY', drawings: DRAW.slice(0, n) }, patch: op === 'remove' ? { remove: [{ id: 'd0' }] } : { update: [{ id: 'd0', set: { color: '#ff0000' } }] } }] }),
    words: { name: { modify: 'make the trendline red', remove: 'delete the trendline' }, 'class noun': { modify: 'make the drawing red', remove: 'delete the drawing' }, none: { modify: 'make it red', remove: 'delete it' } },
  },
  list: {
    plan: (n, op) => ({ ok: true, plans: [{ kind: 'watchlist', ref: 'wl1', before: { name: 'Tech', items: [{ sym: 'AAPL' }, { sym: 'MSFT' }] }, patch: op === 'remove' ? { remove: [{ sym: 'AAPL' }] } : { rename: 'Leaders' } }] }),
    words: { name: { modify: 'rename Tech to Leaders', remove: 'remove AAPL from Tech' }, 'class noun': { modify: 'rename my list to Leaders', remove: 'remove AAPL from my list' }, none: { modify: 'rename it to Leaders', remove: 'remove AAPL from it' } },
    scope: (n) => ({ watchlists: n }),
  },
}
const PURE = []
for (const [kind, k] of Object.entries(KINDS)) for (const form of Object.keys(k.words)) for (const n of [1, 2, 4]) for (const op of ['modify', 'remove']) {
  // name → licensed; class noun → only with ONE in scope; none (no conversation subject) → never
  // (a list REMOVE names its item — the symbol — which identifies what is removed: licensed by the symbol in every form)
  const want = kind === 'list' && op === 'remove' ? true : form === 'name' ? true : form === 'class noun' ? n === 1 : false
  PURE.push([kind, form, n, op, k.words[form][op], want])
}
describe(`PURE · generated matrix (${PURE.length} cases): kind × form × instances in scope × verb`, () => {
  it.each(PURE)('%s · %s · %i in scope · %s · "%s" → licensed %s', (kind, form, n, op, words, want) => {
    const k = KINDS[kind]
    const r = stateRailRefusal(k.plan(n, op), { words, scope: k.scope ? k.scope(n) : null })
    if (want) expect(r, words).toBeNull()
    else expect(r, words).toMatch(/^I didn’t change anything/)
  })
})

// ── PURE · the chart rail's own reading (identifiesChart): what reaches it when no earlier screen asks first ──
import { identifiesChart } from './chartRail'
const hostOf = (n, selected = null) => {
  const pos = n === 1 ? [null] : n === 2 ? ['left', 'right'] : ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  const list = SYMS.slice(0, n).map((s, i) => ({ ref: `c${i}`, symbol: s, position: pos[i], label: `Chart (${s})` }))
  return { charts: { list: () => list, read: (r) => list.find(c => c.ref === r), selected: () => selected } }
}
describe('PURE · identifiesChart — the rule on the SPY chart (c0) for every form × count × verb', () => {
  it.each(CHART_CASES)('%s · %i chart(s) · %s · "%s" → licensed %s', (form, n, verb, said, want) => {
    if (verb === 'additive') return                              // (the ADDITIVE rule refuses before identification is read)
    const host = hostOf(n, FORMS[form].select ? 'c0' : null)
    const e = { type: 'symbol', ref: 'c0', symbol: 'SPY', to: 'AMD', position: host.charts.list()[0].position }
    const got = identifiesChart(said, e, host, { selected: FORMS[form].select ? 'c0' : null, sole: n === 1 })
    expect(!!got, `${said} → ${got}`).toBe(want)
  })
})

// ── D23 · the SCOPE of "sole" (AUDIT T2 1/2/5): every chart the action could touch, only charts ──
import { chartsInScope } from './chartRail'
describe('D23 · sole = exactly one chart in scope (hidden chart tabs and widget tabs count; other widgets never)', () => {
  const host = (widgets, listed) => ({ layout: () => ({ widgets }), charts: { list: () => listed, read: (r) => listed.find(c => c.ref === r), selected: () => null } })
  const one = [{ ref: 'c0', symbol: 'SPY', position: null }]
  const e = { type: 'symbol', ref: 'c0', symbol: 'SPY', to: 'AMD', position: null }
  it('one chart + a watchlist widget → sole (the show verb switches it)', () => {
    const h = host([{ id: 'c0', type: 'chart', opts: {} }, { id: 'w', type: 'watchlist', opts: {} }], one)
    expect(chartsInScope(h).count).toBe(1)
    expect(identifiesChart('show AMD', e, h, { sole: chartsInScope(h).count === 1 })).toBe('sole')
  })
  it('one VISIBLE chart + a chart in a hidden widget tab → NOT sole (asked)', () => {
    const h = host([{ id: 'c0', type: 'chart', opts: {} }, { id: 'n', type: 'news', opts: {}, wtabs: [{ id: 't1', type: 'chart' }] }], one)
    expect(chartsInScope(h).count).toBeGreaterThan(1)
    expect(identifiesChart('show AMD', e, h, { sole: chartsInScope(h).count === 1 })).toBeNull()
  })
  it('one chart widget with a CHART TAB on another link colour → NOT sole; a timeframe tab on its own colour → still sole', () => {
    expect(chartsInScope(host([{ id: 'c0', type: 'chart', color: 'A', opts: { chartTabs: [{ id: 'x1', color: 'B' }] } }], one)).count).toBeGreaterThan(1)
    expect(chartsInScope(host([{ id: 'c0', type: 'chart', color: 'A', opts: { chartTabs: [{ id: 'x1', color: 'A' }] } }], one)).count).toBe(1)
  })
})

// ── D23 · a STALE pick (AUDIT T2 6): bound to the chart's ref AND the ticker it showed when asked ──
import { chartPickStale } from './chartRail'
describe('D23 · a pick from the rail\'s chart choices is stale when its chart is gone or shows another ticker', () => {
  const host = (list) => ({ charts: { read: (r) => list.find(c => c.ref === r) || null } })
  it.each([
    ['same chart, same ticker', [{ ref: 'c0', symbol: 'SPY' }], { chartRef: 'c0', fp: 'SPY' }, false],
    ['the chart now shows another ticker', [{ ref: 'c0', symbol: 'IWM' }], { chartRef: 'c0', fp: 'SPY' }, true],
    ['the chart is gone', [{ ref: 'c1', symbol: 'SPY' }], { chartRef: 'c0', fp: 'SPY' }, true],
    ['not a chart pick', [], { id: 'ind:c0:i1' }, false],
  ])('%s → stale %s', (_n, list, pick, want) => { expect(chartPickStale(pick, host(list))).toBe(want) })
})
