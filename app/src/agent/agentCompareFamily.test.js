// Compare family (Charts C1-034 … C1-041 + the Compare Rotation / Overlay view): the GENERAL readers
// (capabilities/comparePhrases.js) over class-GENERATED phrasings — verb × symbols × base × tail — through the real fast
// path (fastParse) on fixture boards. Each reading is one existing capability's args; execution is proved through the real
// panel in agentCompareFamily.panel.test.jsx. Near-misses that must NOT be read as an overlay are pinned here too.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { makeBoard } from './__fixtures__/board'
import { compareGroupOfWords, tickerWord } from './capabilities/comparePhrases'
import { canon } from './fastPath'
import { multiChartPlan } from './multiChart'

registerBuiltins()

const C = (sym, extra = {}) => ({ sym, enabled: true, color: '#60a5fa', scaleMode: 'new', ...extra })
/** charts: [{ id, sym, comps?, x?, tf? }] side by side; `selected` the clicked chart; `compare` adds the Compare panel source */
function board(charts, { selected = null, compare = false } = {}) {
  const ws = charts.map((c, i) => ({ id: c.id, type: 'chart', x: c.x ?? i * 12, y: c.y ?? 0, w: 12, h: 20, color: `G${i}`,
    opts: { tf: c.tf || 'D', settings: c.comps ? { comparisonSymbols: c.comps } : undefined } }))
  const b = makeBoard(ws, Object.fromEntries(charts.map((c, i) => [`G${i}`, c.sym])))
  b.host.charts = { ...b.host.charts, selected: () => selected }
  if (compare) b.host.compare = { read: () => ({ here: true, open: false, tab: null, hasChart: true }) }
  return b.host
}
const ONE = (comps = null, sym = 'NVDA') => board([{ id: 'c1', sym, comps }], { compare: true })
const TWO = (o = {}) => board([{ id: 'cl', sym: 'NVDA', comps: o.l || null }, { id: 'cr', sym: 'AAPL', comps: o.r || null }], { selected: o.selected || null, compare: true })
const read = (text, host) => fastParse(text, { host })
const only = (r) => (r?.kind === 'ops' && r.ops.length === 1 ? r.ops[0] : null)
const cases = (tpls, fill) => tpls.flatMap(t => fill.map(f => [t, f]))

describe('SYMBOLS — a word is a ticker only when the member marked it as one', () => {
  const h = ONE()
  it.each([
    ['QQQ', 'compare with QQQ', 'QQQ'], ['$amd', 'compare with $amd', 'AMD'], ['amd', 'compare with amd', 'AMD'],
    ['nvda', 'compare with nvda', 'NVDA'], ['IT', 'compare with IT', 'IT'],
  ])('%s → a ticker', (w, raw, want) => expect(tickerWord(w, raw, h)).toBe(want))
  it.each([
    ['rsi', 'overlay rsi'], ['RSI', 'overlay RSI on this'], ['vwap', 'overlay vwap'], ['it', 'compare with it'], ['ytd', 'compare with ytd'],
    ['supertrend', 'overlay supertrend'], ['others', 'compare it with others'],
  ])('%s → never a ticker', (w, raw) => expect(tickerWord(w, raw, h)).toBe(null))
})

describe('C1-034 add symbols (chart.compare) — generated', () => {
  const LISTS = [
    ['QQQ', ['QQQ']], ['MSFT and QQQ', ['MSFT', 'QQQ']], ['MSFT, QQQ and SPY', ['MSFT', 'QQQ', 'SPY']], ['MSFT, QQQ, and SPY', ['MSFT', 'QQQ', 'SPY']],
    ['SPY & QQQ', ['SPY', 'QQQ']], ['$amd', ['AMD']], ['amd', ['AMD']], ['spy and qqq', ['SPY', 'QQQ']],
  ]
  const SELF_TPL = [
    'compare with {L}', 'compare it with {L}', 'compare this to {L}', 'compare this chart against {L}', 'compare it vs {L}', 'compare versus {L}',
    'compare relative to {L}', 'compare w/ {L}', 'overlay {L}', 'overlay {L} on this chart', 'overlay {L} on it', 'superimpose {L}', 'overlay {L} as comparisons',
    'add {L} as a comparison', 'add {L} to the comparisons', 'put {L} in compare', 'add {L} as comparison symbols', 'add a {L} comparison', 'add {L} overlays',
    'add a comparison with {L}', 'set up a comparison against {L}', 'please compare with {L}', 'can you compare it with {L}', "let's compare with {L}",
    'compare with {L} too', 'throw {L} on as a comparison', 'plot {L} as an overlay',
  ]
  it.each(cases(SELF_TPL, LISTS))('"%s" × %j', (tpl, [l, want]) => {
    const text = tpl.replace('{L}', l)
    const op = only(read(text, ONE()))
    expect(op, text).toBeTruthy()
    expect(op.action).toBe('chart.compare')
    expect(op.args).toEqual({ add: want, remove: [], clear: false })
  })
  it('generated count', () => expect(SELF_TPL.length * LISTS.length).toBeGreaterThan(200))

  // ⛔ the BASE (the chart compared against) and the symbols added are never confused
  const BASE_TPL = ['compare {B} with {L}', 'compare {B} to {L}', 'compare {B} against {L}', 'compare {B} vs {L}', 'overlay {L} on {B}', 'plot {L} against {B}', 'chart {L} against {B}']
  const BASES = [['NVDA', 'cl'], ['AAPL', 'cr'], ['nvda', 'cl'], ['aapl', 'cr']]
  it.each(cases(BASE_TPL, BASES))('"%s" × base %j → that chart, the other symbols added', (tpl, [b, ref]) => {
    for (const [l, want] of [['QQQ', ['QQQ']], ['MSFT and SPY', ['MSFT', 'SPY']]]) {
      const text = tpl.replace('{B}', b).replace('{L}', l)
      const op = only(read(text, TWO()))
      expect(op, text).toBeTruthy()
      expect(op).toMatchObject({ action: 'chart.compare', target: ref, args: { add: want, remove: [], clear: false } })
    }
  })
  it('a symbol shown on ANOTHER chart is still the one added, never the target', () => {
    expect(only(read('compare AAPL with NVDA', TWO()))).toMatchObject({ target: 'cr', args: { add: ['NVDA'] } })
    expect(only(read('compare NVDA with AAPL', TWO()))).toMatchObject({ target: 'cl', args: { add: ['AAPL'] } })
  })
  // ⛔ PL decision 11-23 (AUDIT T2 F2): "put / stack / set X against Y" may be a placement or a layout — no target is read from
  // "against" with those verbs (the model's); only a typed plotting verb, or "compare X against Y", names the Y / X chart
  it.each(['put QQQ against AMD', 'stack QQQ against AMD', 'set QQQ against AMD', 'put QQQ vs AAPL', 'stick QQQ against AMD'])('F2: "%s" → no compare reading', (text) => {
    const r = read(text, TWO())
    expect((r?.ops || []).some(o => o.action === 'chart.compare'), text).toBe(false)
  })
  it('F2: "compare AAPL against QQQ" keeps the AAPL chart; "plot QQQ against AAPL" the AAPL chart', () => {
    expect(only(read('compare AAPL against QQQ', TWO()))).toMatchObject({ target: 'cr', args: { add: ['QQQ'] } })
    expect(only(read('plot QQQ against AAPL', TWO()))).toMatchObject({ target: 'cr', args: { add: ['QQQ'] } })
  })
  it('a base no chart shows, or "compare X with X", is not read (the model decides)', () => {
    expect(read('compare TSLA with QQQ', TWO())).toBe(null)
    expect(read('compare NVDA with NVDA', TWO())).toBe(null)
  })
  it('two charts on the base symbol: the clicked one, else not read here', () => {
    const two = (selected) => board([{ id: 'a', sym: 'NVDA' }, { id: 'b', sym: 'NVDA' }], { selected })
    expect(read('compare NVDA with QQQ', two(null))).toBe(null)
    expect(only(read('compare NVDA with QQQ', two('b')))).toMatchObject({ target: 'b' })
  })
})

describe('C1-036 remove symbols / C1-038 clear (chart.compare) — generated', () => {
  const comps = [C('QQQ'), C('SPY'), C('MSFT')]
  const REMOVE_TPL = [
    'remove the {L} comparison', 'remove the {L} comparisons', 'drop the {L} overlay', 'delete the {L} comparison', 'kill the {L} comparison',
    'take {L} off the comparison', 'remove {L} from the comparisons', 'remove {L} from compare', 'get rid of the {L} comparison', 'ditch the {L} overlay',
    'stop comparing with {L}', 'stop comparing it to {L}', "don't compare with {L} anymore", 'uncompare {L}', 'remove the comparison with {L}',
    'remove the {L} line', 'please remove the {L} comparison', 'can you remove the {L} comparison',
  ]
  const LISTS = [['QQQ', ['QQQ']], ['QQQ and SPY', ['QQQ', 'SPY']], ['qqq', ['QQQ']], ['SPY, QQQ and MSFT', ['SPY', 'QQQ', 'MSFT']]]
  it.each(cases(REMOVE_TPL, LISTS))('"%s" × %j', (tpl, [l, want]) => {
    const text = tpl.replace('{L}', l)
    const op = only(read(text, ONE(comps)))
    expect(op, text).toBeTruthy()
    expect(op).toMatchObject({ action: 'chart.compare', target: 'c1', args: { add: [], remove: want, clear: false } })
  })
  const CLEAR = [
    'clear all comparisons', 'clear all the comparisons', 'remove all comparisons', 'remove every comparison', 'remove all of the comparisons', 'clear the comparisons',
    'delete my comparisons', 'get rid of the comparisons', 'wipe out the comparisons', 'clear compare', 'reset the compare list', 'stop comparing', 'stop comparing it',
    'no more comparisons', 'uncompare everything', 'clear the comparison symbols', 'remove all the compared symbols', 'remove everything from compare',
    'clear the overlays', 'please clear all comparisons',
  ]
  it.each(CLEAR)('"%s" → clear', (text) => {
    expect(only(read(text, ONE(comps)))).toMatchObject({ action: 'chart.compare', target: 'c1', args: { add: [], remove: [], clear: true } })
  })
  it('"remove the QQQ line" is read only when a chart compares QQQ (a line is also a drawing)', () => {
    expect(read('remove the QQQ line', ONE())).toBe(null)
  })
  it('the chart that compares it is the target — never a clicked chart that does not', () => {
    expect(only(read('remove the QQQ comparison', TWO({ r: [C('QQQ')] })))).toMatchObject({ target: 'cr' })
    expect(only(read('clear all comparisons', TWO({ r: [C('QQQ')] })))).toMatchObject({ target: 'cr' })
    // clicked on the left (no QQQ): the reader names no chart, the panel uses the click and the check answers honestly
    expect(only(read('remove the QQQ comparison', TWO({ r: [C('QQQ')], selected: 'cl' }))).target ?? null).toBe(null)
    // both compare QQQ: no chart named here (the panel's click / "which chart?")
    expect(only(read('remove the QQQ comparison', TWO({ l: [C('QQQ')], r: [C('QQQ')] }))).target ?? null).toBe(null)
  })
  it('"all the comparisons" is the comparisons\' quantifier, never "all charts"', () => {
    const r = read('clear all the comparisons', TWO({ l: [C('QQQ')], r: [C('SPY')] }))
    expect(r.target).toBe(null)
    expect(r.ops).toHaveLength(1)
  })
})

describe('C1-039 / C1-041 display (chartSetup.compareDisplay) — generated', () => {
  const comps = [C('QQQ'), C('SPY')]
  const SAME = ['put {T} on the same scale', 'move {T} to the same % scale', 'set {T} to the main price scale', 'put {T} on the chart\'s scale', 'switch {T} to the shared scale',
    'make {T} share the price scale', 'let {T} use the same scale', 'show {T} on the same scale as the chart']
  const NEW = ['put {T} on its own scale', 'move {T} to their own scale', 'put {T} on a new price scale', 'set {T} to a separate scale', 'show {T} on an independent scale',
    'show {T} as percent', 'show {T} in percentage terms', 'display {T} as a % change']
  const TARGETS = [['QQQ', ['QQQ']], ['the QQQ comparison', ['QQQ']], ['QQQ and SPY', ['QQQ', 'SPY']], ['the comparisons', []], ['all the comparisons', []], ['the overlays', []], ['the compared symbols', []]]
  it.each(cases([...SAME.map(t => [t, 'same']), ...NEW.map(t => [t, 'new'])], TARGETS))('%j × %j', ([tpl, scale], [t, want]) => {
    const text = tpl.replace('{T}', t)
    const op = only(read(text, ONE(comps)))
    expect(op, text).toBeTruthy()
    expect(op).toMatchObject({ action: 'chartSetup.compareDisplay', target: 'c1', args: { symbols: want, scale, visible: null, groupOnly: null } })
  })
  const EYE = [['hide the {L} comparison', false], ['hide the {L} overlay', false], ['turn off the {L} comparison line', false], ['show the {L} comparison again', true],
    ['unhide the {L} overlay', true], ['bring back the {L} comparison', true], ['restore the {L} comparisons', true]]
  it.each(cases(EYE, [['QQQ', ['QQQ']], ['QQQ and SPY', ['QQQ', 'SPY']]]))('%j × %j', ([tpl, visible], [l, want]) => {
    const text = tpl.replace('{L}', l)
    expect(only(read(text, ONE(comps)))).toMatchObject({ action: 'chartSetup.compareDisplay', args: { symbols: want, visible, scale: null, groupOnly: null } })
  })
  it.each([['hide the comparisons', false], ['hide all the comparisons', false], ['show the comparisons again', true]])('"%s" → every comparison', (text, visible) => {
    expect(only(read(text, ONE(comps)))).toMatchObject({ action: 'chartSetup.compareDisplay', args: { symbols: [], visible } })
  })
  const ON = ['group only', 'turn on group only', 'enable group only mode', 'switch to group only', 'hide the base symbol', 'hide the main ticker', 'hide the chart\'s own symbol',
    'hide the underlying stock', 'show only the comparisons', 'show just the compared symbols']
  const OFF = ['turn off group only', 'group only off', 'exit group only', 'show the base symbol again', 'bring back the main ticker', 'unhide the underlying price', 'restore the primary symbol']
  it.each([...ON.map(t => [t, true]), ...OFF.map(t => [t, false])])('"%s" → Group only %s', (text, on) => {
    expect(only(read(text, ONE(comps)))).toMatchObject({ action: 'chartSetup.compareDisplay', target: 'c1', args: { symbols: [], groupOnly: on, scale: null, visible: null } })
  })
  it('nothing compared: "show QQQ comparison" / "group only" are not read here (they may mean add)', () => {
    for (const t of ['show the QQQ comparison', 'hide the QQQ comparison', 'group only', 'put QQQ on the same scale']) expect(read(t, ONE()), t).toBe(null)
  })
  it('a bare ticker ("hide QQQ") is never the overlay\'s eye', () => {
    expect(only(read('hide QQQ', ONE(comps)))?.action).not.toBe('chartSetup.compareDisplay')
  })
})

describe('"show it as percent" (chart.setScale percent)', () => {
  it.each(['show it as percent', 'show this in percent', 'display the chart as a percentage', 'switch to percent', 'set it to percent', 'put it on percent',
    'show prices as percent change', 'view it in percentage terms', 'percent mode', 'change to percentage', 'show it in % terms'])('"%s"', (text) => {
    expect(only(read(text, ONE()))).toMatchObject({ action: 'chart.setScale', args: { scale: 'percent' } })
  })
})

describe('C1-035 / C1-037 / C1-040 groups (chartSetup.compareGroup)', () => {
  const g = [C('NVDA', { group: 'AI Chips' }), C('AMD', { group: 'AI Chips' }), C('MU', { group: 'Semiconductors' })]
  const R = ['remove the {G}', 'remove the {G} comparison', 'drop the {G} overlay', 'delete my {G}', 'remove the {G} from the comparisons', 'stop comparing with the {G}']
  const S = [['put the {G} on the same scale', 'same'], ['move the {G} to its own scale', 'new'], ['set the {G} comparison to the main price scale', 'same'], ['put the {G} on a separate scale', 'new']]
  const NAMES = [['AI Chips group', 'ai chips'], ['ai chips theme', 'ai chips'], ['semiconductors industry', 'semiconductors'], ['semis group', 'semis']]
  it.each(cases(R, NAMES))('"%s" × %j → remove', (tpl, [n, name]) => {
    const text = tpl.replace('{G}', n)
    const op = only(read(text, ONE(g, 'QQQ')))
    expect(op, text).toBeTruthy()
    expect(op).toMatchObject({ action: 'chartSetup.compareGroup', target: 'c1', args: { action: 'remove', group: name, groupType: 'any', scale: null } })
  })
  it.each(cases(S, NAMES))('%j × %j → scale', ([tpl, scale], [n, name]) => {
    const op = only(read(tpl.replace('{G}', n), ONE(g, 'QQQ')))
    expect(op).toMatchObject({ action: 'chartSetup.compareGroup', target: 'c1', args: { action: 'scale', group: name, scale } })
  })
  it('no chart compares that group: not read (the words may mean something else)', () => {
    expect(read('remove the tech sector', ONE(g, 'QQQ'))).toBe(null)
    expect(read('remove the ai chips group', ONE([C('QQQ')], 'QQQ'))).toBe(null)
  })
  // ADD is read by the reader (unit) but left to the model by the capability until the owner decides BASELINE:compare.group.aiChips
  const ADD = ['compare against the {G}', 'compare it with the {G}', 'overlay the {G}', 'add the {G} as a comparison', 'add the {G} to the comparisons', 'compare NVDA with the {G}']
  it.each(cases(ADD, [['AI Chips theme', 'ai chips', 'theme'], ['semis group', 'semis', 'any'], ['technology sector', 'technology', 'sector'], ['Semiconductors industry', 'semiconductors', 'industry']]))('reader: "%s" × %j → add', (tpl, [n, name, type]) => {
    const text = tpl.replace('{G}', n)
    const host = ONE()
    const r = compareGroupOfWords({ raw: text, lower: canon(text), host, typed: text })
    expect(r, text).toMatchObject({ action: 'add', group: name, groupType: type, scale: null })
    expect(read(text, host)).toBe(null)                                            // the model's, for now (see compareGroup.js)
  })
  it('"compare NVDA against its sector" names no group: not read', () => {
    expect(compareGroupOfWords({ raw: 'compare NVDA against its sector', lower: 'compare nvda against its sector', host: ONE(), typed: 'x' })).toBe(null)
  })
})

describe('Compare Rotation / Overlay view (compare.openView)', () => {
  const v = (tab, extra = {}) => ({ action: 'compare.openView', args: { tab, symbol: null, groupType: null, group: null, ...extra } })
  it.each([
    ['open the rotation map', v('rotation')], ['show me the rrg', v('rotation')], ['bring up the relative rotation graph', v('rotation')], ['pull up the rotation chart', v('rotation')],
    ['open the rotation map for NVDA', v('rotation', { symbol: 'NVDA' })], ["show NVDA's sector on the rotation map", v('rotation', { symbol: 'NVDA', groupType: 'sector' })],
    ["open the rrg for amd's industry", v('rotation', { symbol: 'AMD', groupType: 'industry' })], ['show the nvda industry on the rotation map', v('rotation', { symbol: 'NVDA', groupType: 'industry' })],
    ['show the semiconductors industry on the rotation map', v('rotation', { group: 'semiconductors', groupType: 'industry' })],
    ['open the rotation map for the AI Chips theme', v('rotation', { group: 'ai chips', groupType: 'theme' })],
    ['go to the overlay tab', v('overlay')], ['switch to the rotation tab', v('rotation')], ['switch the compare panel to overlay', v('overlay')],
    ['open compare symbols', v('overlay')], ['bring up the compare panel', v('overlay')], ['open the comparison tool', v('overlay')],
  ])('"%s"', (text, want) => expect(only(read(text, ONE()))).toMatchObject(want))
  it('not on a page without the Compare panel; never the RS indicator\'s Rotation view', () => {
    const noPanel = board([{ id: 'c1', sym: 'NVDA' }])
    expect(only(read('open the rotation map', noPanel))?.action).not.toBe('compare.openView')
    expect(only(read('show the rs rotation view', ONE()))?.action).not.toBe('compare.openView')
  })
})

describe('near-misses — never read as a chart overlay', () => {
  it.each([
    'compare NVDA and AMD', 'nvda vs amd fundamentals', 'compare NVDA earnings to AMD', 'compare NVDA valuation with AMD', 'how does NVDA compare with AMD',
    'compare NVDA with AMD on revenue', 'show NVDA and AMD side by side', 'put NVDA next to AMD', 'compare breadth with last week', 'overlay rsi', 'overlay the 9 on the macd',
    'overlay vwap', 'compare it to the others', 'what is QQQ compared to SPY', 'remove QQQ', 'compare with supertrend',
  ])('"%s"', (text) => {
    const r = read(text, ONE([C('QQQ')]))
    for (const o of (r?.ops || [])) expect(['chart.compare', 'chartSetup.compareDisplay'], `${text} → ${JSON.stringify(o)}`).not.toContain(o.action)
  })
})

describe('"put NVDA vs AMD side by side" — two charts (multiChart, read before the fast path), never an overlay', () => {
  it.each(['put NVDA vs AMD side by side', 'show NVDA and AMD side by side', 'NVDA vs AMD side by side'])('"%s"', (text) => {
    const host = TWO()
    const r = multiChartPlan(text, { host })
    expect(r?.kind, text).toBeTruthy()
    const ops = r.kind === 'steps' ? r.steps.flatMap(st => st.ops) : (r.ops || [])
    expect(ops.some(o => o.action === 'chart.compare')).toBe(false)
    expect(read(text, host)?.ops?.some(o => o.action === 'chart.compare') ?? false).toBe(false)
  })
})

describe('multi-chart forms — the chart words are lifted and the panel\'s own target rules decide', () => {
  const four = () => board([{ id: 'c0', sym: 'SPY', x: 0, y: 0 }, { id: 'c1', sym: 'QQQ', x: 12, y: 0 }, { id: 'c2', sym: 'NVDA', x: 0, y: 10, comps: [C('SMH')] }, { id: 'c3', sym: 'TSLA', x: 12, y: 10 }], { compare: true })
  it('"overlay SPY on the NVDA chart" → the qualifier, never a chart the reader picked', () => {
    const r = read('overlay SPY on the NVDA chart', TWO())
    expect(r.target).toEqual({ qualifier: 'NVDA' })
    expect(r.ops[0]).toEqual({ action: 'chart.compare', args: { add: ['SPY'], remove: [], clear: false } })
  })
  it('"compare with QQQ on all charts" → every chart (one change, one Undo)', () => {
    const r = read('compare with QQQ on all charts', four())
    expect(r.target).toMatchObject({ all: true })
    expect(r.ops).toEqual([{ action: 'chart.compare', args: { add: ['QQQ'], remove: [], clear: false } }])
  })
  it('"remove the SMH comparison from the bottom left chart" → the position, the reader names no chart itself', () => {
    const r = read('remove the SMH comparison from the bottom left chart', four())
    expect(r.target).toEqual({ position: 'bottom-left' })
    expect(r.ops[0].target ?? null).toBe(null)
    expect(r.ops[0].args).toEqual({ add: [], remove: ['SMH'], clear: false })
  })
  it('"clear all comparisons on the second chart" → the ordinal', () => {
    const r = read('clear all comparisons on the second chart', four())
    expect(r.target).toMatchObject({ chart: 'c1' })
    expect(r.ops[0]).toMatchObject({ action: 'chart.compare', args: { clear: true } })
  })
  it('"put the comparisons on the same scale on the daily charts" → the timeframe set', () => {
    const b = board([{ id: 'a', sym: 'SPY', comps: [C('QQQ')] }, { id: 'b', sym: 'NVDA', comps: [C('QQQ')] }, { id: 'c', sym: 'TSLA', tf: 'W', comps: [C('QQQ')] }])
    const r = read('put the comparisons on the same scale on the daily charts', b)
    expect(r.target).toMatchObject({ all: true, refs: ['a', 'b'] })
    expect(r.ops[0]).toMatchObject({ action: 'chartSetup.compareDisplay', args: { scale: 'same', symbols: [] } })
  })
  it('a base ticker AND a different chart named: two targets — not read', () => {
    expect(read('compare AAPL with QQQ on the left chart', TWO())).toBe(null)
  })
})
