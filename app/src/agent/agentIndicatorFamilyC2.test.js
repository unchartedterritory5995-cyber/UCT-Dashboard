// C2 family (Charts Part C2, Indicators): the instant path's GENERAL readers (capabilities/indicatorPhrases.js), tested as
// phrase CLASSES — every template × every subject × every value is generated and must route to ONE capability with the
// args the class says. Then the near-misses each class must NOT claim (a chart colour, a length that looks like hex, a
// show-on policy, an exclusion). No model, no board: what the words mean, before any chart is asked.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { fastParse, extractTarget } from './fastPath'
import { inputsOfDef } from './capabilities/indicatorEdits'
import { subjectOf, settingOf } from './capabilities/indicatorPhrases'
import { timeframeSetOf } from './deixis'

registerBuiltins()

const one = (text) => {
  const r = fastParse(text)
  return r?.kind === 'ops' && r.ops.length === 1 ? r.ops[0] : null
}
const cases = (templates, fill) => templates.flatMap(t => fill(t))

// ── SUBJECT: the indicator, from the catalog the member sees ──
const SUBJECTS = [
  ['rsi', 'rsi'], ['the rsi', 'rsi'], ['the relative strength index', 'rsi'], ['my macd', 'macd'],
  ['the 20 ema', '#20:ema'], ['the 50 sma', '#50:sma'], ['the 200-day sma', '#200:sma'], ['the 9', '#9'],
  ['the rs line', 'rsLine'], ['the stoch rsi', 'stochRsi'], ['the bollinger bands', 'bb'], ['the supertrend', 'superTrend'],
]
describe('subjectOf — the indicator a phrase names', () => {
  it.each(SUBJECTS)('%s → %s', (w, want) => expect(subjectOf(w)).toBe(want))
  it.each(['the chart', 'the candles', 'the moving average', 'my moving averages', 'volume', 'my momentum list', 'the left one', 'it'])('%s → nothing', (w) => expect(subjectOf(w)).toBeNull())
})

// ── C2-030 colour, C2-031 histogram up / down colours ──
const COLOR_TEMPLATES = ['make S C', 'turn S C', 'paint S C', 'color S C', 'change S color to C', 'set S colour to C', 'change the color of S to C', 'make S line C', 'set S to C']
const COLORS = ['green', 'red', 'dark blue', 'orange', '#ff8800']
describe('C2-030 colour: every template × subject × colour → indicatorStyle.set color', () => {
  // ("the 9 line" is as often a line DRAWN at 9 as the 9 average — a bare length before "line" is left alone, see below)
  const all = cases(COLOR_TEMPLATES, t => SUBJECTS.filter(([s]) => !(t.includes('S line') && /^the \d+$/.test(s)))
    .flatMap(([s, inst]) => COLORS.map(c => [t.replace('S', s).replace('C', c), inst, c])))
  it(`${all.length} generated phrasings`, () => {
    const miss = all.filter(([p, inst, c]) => {
      const o = one(p)
      return !(o && o.action === 'indicatorStyle.set' && o.args.instance === inst && o.args.property === 'color' && o.args.value === c && !o.args.output)
    })
    expect(miss.map(m => m[0])).toEqual([])
  })
  it('an output line of a multi-line indicator is carried as `output` ("the macd signal line")', () => {
    expect(one('make the macd signal line red')).toMatchObject({ action: 'indicatorStyle.set', args: { instance: 'macd', property: 'color', value: 'red', output: 'signal' } })
    expect(one('change the stoch rsi %d line colour to orange')?.args).toMatchObject({ instance: 'stochRsi', output: '%d' })
  })
})
const HIST = [
  ['make the macd up bars green', 'upColor', 'green'], ['set the macd histogram down color to red', 'downColor', 'red'],
  ['make the macd histogram green when rising', 'upColor', 'green'], ['make the macd bars red when falling', 'downColor', 'red'],
  ['change the macd rising bars to teal', 'upColor', 'teal'], ['make the macd negative bars orange', 'downColor', 'orange'],
  ['paint the macd histogram bars blue when it is growing', 'upColor', 'blue'], ['set the macd falling columns to dark blue', 'downColor', 'dark blue'],
]
describe('C2-031 histogram up / down colours', () => {
  it.each(HIST)('%s', (p, property, value) => expect(one(p)).toMatchObject({ action: 'indicatorStyle.set', args: { instance: 'macd', property, value } }))
})

// ── C2-032 width, C2-033 line style, C2-034 plot style ──
const LINE_SUBJECTS = SUBJECTS.filter(([, i]) => ['rsi', '#20:ema', '#50:sma', 'macd', '#9'].includes(i))
describe('C2-032 / C2-033 / C2-034 the look', () => {
  const width = cases(['set S line width to N', 'change S thickness to N', 'make S Npx', 'set S width to N'], t => LINE_SUBJECTS.flatMap(([s, inst]) => [1, 2, 3].map(n => [t.replace('S', s).replace('N', n), inst, n])))
  it(`width: ${width.length} generated → lineWidth N`, () => {
    expect(width.filter(([p, inst, n]) => { const o = one(p); return !(o?.action === 'indicatorStyle.set' && o.args.instance === inst && o.args.property === 'lineWidth' && o.args.value === n) }).map(x => x[0])).toEqual([])
  })
  const rel = cases(['make S W', 'make S line W', 'make S a bit W'], t => LINE_SUBJECTS.flatMap(([s, inst]) => [['thicker', 'thicker'], ['bolder', 'thicker'], ['thinner', 'thinner']].map(([w, v]) => [t.replace('S', s).replace('W', w), inst, v])))
  it(`relative width: ${rel.length} generated → thicker / thinner`, () => {
    expect(rel.filter(([p, inst, v]) => { const o = one(p); return !(o?.action === 'indicatorStyle.set' && o.args.instance === inst && o.args.property === 'lineWidth' && o.args.value === v) }).map(x => x[0])).toEqual([])
  })
  const style = cases(['make S V', 'change S line style to V', 'switch S to a V line', 'set S style to V', 'make S V again'], t => LINE_SUBJECTS.flatMap(([s, inst]) => ['dashed', 'dotted', 'solid'].map(v => [t.replace('S', s).replace('V', v), inst, v])))
  it(`line style: ${style.length} generated → lineStyle`, () => {
    expect(style.filter(([p, inst, v]) => { const o = one(p); return !(o?.action === 'indicatorStyle.set' && o.args.instance === inst && o.args.property === 'lineStyle' && o.args.value === v) }).map(x => x[0])).toEqual([])
  })
  const plot = cases(['show S as a V', 'change S plot style to V', 'switch S to an V', 'display S as V'], t => LINE_SUBJECTS.flatMap(([s, inst]) => [['columns', 'columns'], ['histogram', 'histogram'], ['area', 'area'], ['line', 'line']].map(([w, v]) => [t.replace('S', s).replace('V', w), inst, v])))
  it(`plot style: ${plot.length} generated → plotStyle`, () => {
    expect(plot.filter(([p, inst, v]) => { const o = one(p); return !(o?.action === 'indicatorStyle.set' && o.args.instance === inst && o.args.property === 'plotStyle' && o.args.value === v) }).map(x => x[0])).toEqual([])
  })
})

// ── C2-036 / C2-037 where it draws ──
describe('C2-036 / C2-037 placement — own pane, price, volume, another indicator\'s pane', () => {
  const PLACES = [
    ['put S in its own pane', 'pane'], ['move S to a separate pane', 'pane'], ['move S into a new pane', 'pane'], ['separate S', 'pane'],
    ['put S back on the price pane', 'price'], ['move S onto the price chart', 'price'], ['overlay S on the price', 'price'], ['put S on the volume pane', 'volume'],
  ]
  const all = cases(PLACES, ([t, place]) => LINE_SUBJECTS.map(([s, inst]) => [t.replace('S', s), inst, place]))
  it(`${all.length} generated`, () => {
    expect(all.filter(([p, inst, place]) => { const o = one(p); return !(o?.action === 'indicatorStyle.placeIn' && o.args.instance === inst && o.args.place === place) }).map(x => x[0])).toEqual([])
  })
  const INTO = ['put A in the B pane', 'move A into the B pane', 'overlay A on B', 'merge A into the B pane', 'put A on top of B', 'combine A with B']
  const pairs = [['the 20 ema', '#20:ema', 'rsi', 'rsi'], ['the 9', '#9', 'macd', 'macd'], ['the rsi', 'rsi', 'the stoch rsi', 'stochRsi']]
  const into = cases(INTO, t => pairs.map(([a, ia, b, ib]) => [t.replace('A', a).replace('B', b), ia, ib]))
  it(`into another indicator's pane: ${into.length} generated`, () => {
    expect(into.filter(([p, ia, ib]) => { const o = one(p); return !(o?.action === 'indicatorStyle.placeIn' && o.args.instance === ia && o.args.place === ib) }).map(x => x[0])).toEqual([])
  })
})

// ── C2-038 pane order, C2-039 pane height ──
const PANES = [['rsi', 'rsi'], ['the macd', 'macd'], ['the rs line', 'rsLine'], ['volume', 'volume']]
describe('C2-038 pane order', () => {
  const T = [['move P to the top', 'top', null], ['move the P pane to the bottom', 'bottom', null], ['make the P pane the top pane', 'top', null], ['make P the last pane', 'bottom', null],
    ['move P up one', 'up', null], ['move the P pane down', 'down', null], ['move P below price', 'below', 'price'], ['put the P pane above the price pane', 'above', 'price']]
  const all = cases(T, ([t, to, rel]) => PANES.map(([p, key]) => [t.replace('P', p), key, to, rel]))
  it(`${all.length} generated`, () => {
    expect(all.filter(([p, key, to, rel]) => { const o = one(p); return !(o?.action === 'pane.move' && o.args.pane === key && o.args.to === to && o.args.relativeTo === rel) }).map(x => x[0])).toEqual([])
  })
})
describe('C2-039 pane height', () => {
  const T = [['make the P pane 30%', 30], ['resize the P pane to 25 percent', 25], ['set the P pane height to 40%', 40], ['make the P pane a bit bigger', 'bigger'],
    ['make the P panel shorter', 'smaller'], ['shrink the P pane', 'smaller'], ['expand the P pane', 'bigger'], ['reset the P pane size', 'auto'], ['make the P pane automatic again', 'auto']]
  // (the Volume pane's height is a chart setting — volume.paneHeightPct — never pane.resize; see the near-misses)
  const all = cases(T, ([t, size]) => PANES.filter(([, k]) => k !== 'volume').map(([p, key]) => [t.replace('P', p), key, size]))
  it(`${all.length} generated`, () => {
    expect(all.filter(([p, key, size]) => { const o = one(p); return !(o?.action === 'pane.resize' && o.args.pane === key && o.args.size === size) }).map(x => x[0])).toEqual([])
  })
})

// ── C2-042 duplicate on the chart ──
describe('C2-042 duplicate', () => {
  const all = cases(['duplicate S', 'clone S', 'make a copy of S', 'add another copy of S', 'create a duplicate of S'], t => SUBJECTS.map(([s, inst]) => [t.replace('S', s), inst]))
  it(`${all.length} generated → indicatorCopy.duplicate`, () => {
    expect(all.filter(([p, inst]) => { const o = one(p); return !(o?.action === 'indicatorCopy.duplicate' && o.args.instance === inst) }).map(x => x[0])).toEqual([])
  })
})

// ── C2-024 / C2-025 / C2-026 a named setting — generated from each indicator's OWN declared inputs ──
const lcLabel = (i) => String(i.label || '').toLowerCase().replace(/\s*\([^)]*\)/g, '').trim()
const valueOf = (i) => (i.type === 'int' ? Math.min(Number.isFinite(i.max) ? i.max : 999, Number(i.default ?? 1) + 1)
  : i.type === 'float' ? Math.round((Number(i.default ?? 1) + 0.5) * 10) / 10 : null)
describe('C2-024 / C2-025 / C2-026 named settings, from the catalog\'s own labels', () => {
  const DEFS = [['macd', 'macd'], ['bb', 'the bollinger bands'], ['stoch', 'the stochastic oscillator'], ['keltner', 'the keltner channels'], ['superTrend', 'the supertrend'],
    ['stochRsi', 'the stoch rsi'], ['sar', 'the parabolic sar'], ['ichimoku', 'the ichimoku cloud'], ['squeeze', 'the squeeze'], ['tsi', 'the tsi']]
  const numeric = DEFS.flatMap(([defId, words]) => inputsOfDef(defId).filter(i => (i.type === 'int' || i.type === 'float') && settingOf(defId, lcLabel(i))?.key === i.key)
    .flatMap(i => ['set W L to V', 'change W L to V', 'set the L of W to V', 'change the L on W to V'].map(t => [t.replace('W', words).replace('L', lcLabel(i)).replace('V', valueOf(i)), defId, i.key, valueOf(i)])))
  it(`numeric: ${numeric.length} generated from the declared labels`, () => {
    expect(numeric.length).toBeGreaterThan(60)
    expect(numeric.filter(([p, defId, key, v]) => { const o = one(p); return !(o?.action === 'indicator.update' && o.args.instance === defId && o.args.inputs.length === 1 && o.args.inputs[0].key === key && o.args.inputs[0].value === v) }).map(x => x[0])).toEqual([])
  })
  const bools = inputsOfDef('rsLine').filter(i => i.type === 'bool')
  const sw = bools.flatMap(i => [['turn off the L on the rs line', false], ['turn on the L for the rs line', true], ['enable the L on the uct relative strength', true], ['disable L on the rs line', false], ['hide the L on the rs line', false], ['show the L on the rs line', true]]
    .map(([t, v]) => [t.replace('L', lcLabel(i)), i.key, v]))
  it(`switches: ${sw.length} generated (every RS Line on/off setting) → indicator.update bool`, () => {
    expect(bools.length).toBeGreaterThan(8)
    expect(sw.filter(([p, key, v]) => { const o = one(p); return !(o?.action === 'indicator.update' && o.args.instance === 'rsLine' && o.args.inputs[0].key === key && o.args.inputs[0].value === v) }).map(x => x[0])).toEqual([])
  })
  it('a select setting takes one of its own options ("benchmark to qqq" → QQQ); a value it does not offer is not read', () => {
    expect(one('set the rs line benchmark to qqq')).toMatchObject({ action: 'indicator.update', args: { instance: 'rsLine', inputs: [{ key: 'benchmark', value: 'QQQ' }] } })
    expect(one('set the rs line benchmark to zzz')).toBeNull()
  })
  it('synonyms the labels share: "standard deviation" is the Std Dev, "mult" the multiplier', () => {
    expect(one('set the bollinger bands standard deviation to 2.5')?.args).toEqual({ instance: 'bb', inputs: [{ key: 'stdDev', value: 2.5 }] })
    expect(one('change the keltner channels mult to 1.5')?.args).toEqual({ instance: 'keltner', inputs: [{ key: 'multiplier', value: 1.5 }] })
  })
})

// ── near-misses each class must NOT claim ──
describe('what the C2 readers leave alone', () => {
  it('a length that reads as three hex digits stays a length ("change the 20 to 200")', () => {
    expect(one('change the 20 to 200')).toMatchObject({ action: 'indicator.update', args: { instance: '#20', inputs: [{ key: 'period', value: 200 }] } })
    expect(one('set the rsi to 7')).toMatchObject({ action: 'indicator.update' })
    expect(one('move the 20 to 50')).not.toMatchObject({ action: 'indicatorStyle.placeIn' })
  })
  it.each(['change the 200 line to red', 'set the 150 line colour to dark blue'])('a price-level line is a drawing, not an average: %s', (p) => {
    expect(one(p)?.action).not.toBe('indicatorStyle.set')
  })
  it.each(['make the chart green', 'make the candles red', 'paint the background black', 'set the chart to dark blue'])('not an indicator colour: %s', (p) => {
    expect(one(p)?.action).not.toBe('indicatorStyle.set')
  })
  it.each(['copy the rsi', 'move rsi to the left chart', 'hide volume', 'show rsi', 'turn off the signal line on the macd', 'set bb multiplier to 3'])('not claimed by the C2 readers: %s', (p) => {
    const o = one(p)
    expect(['indicatorCopy.duplicate', 'indicatorStyle.placeIn', 'indicator.hide', 'indicator.show', 'indicator.update'].includes(o?.action)).toBe(false)
  })
  it.each([
    ['make the volume pane 30 percent', 'pane.resize'], ['put the 9 above the 20', 'pane.move'], ['put the top 3 in Momentum', 'indicatorStyle.placeIn'],
    ['recolour the moving average red', 'indicatorStyle.set'],
  ])('left to its own reader: %s (not %s)', (p, action) => expect(one(p)?.action).not.toBe(action))
  it('"show rsi" with no board to read is never guessed (it may as well mean add it)', () => expect(fastParse('show rsi')).toBeNull())
})

// ── multi-chart: a chart SET named by its timeframe ──
describe('multi-chart — "all the daily charts" is a set the member named', () => {
  const charts = [{ ref: 'a', tf: 'D', label: 'A' }, { ref: 'b', tf: 'D', label: 'B' }, { ref: 'c', tf: 'W', label: 'C' }, { ref: 'd', tf: '5', label: 'D5' }]
  const host = { charts: { list: () => charts } }
  const SETS = [['all the daily charts', ['a', 'b']], ['the daily charts', ['a', 'b']], ['every daily chart', ['a', 'b']], ['each of my daily charts', ['a', 'b']],
    ['my weekly charts', ['c']], ['the 5 minute charts', ['d']], ['all the monthly charts', []]]
  it.each(SETS)('%s → %j', (w, refs) => expect(timeframeSetOf(`add rsi to ${w}`, charts)?.refs).toEqual(refs))
  it.each(['only show rsi on the daily charts', 'add rsi to every chart except the weekly ones', 'put rsi on all charts but the daily charts', 'add rsi to the daily chart'])('not a timeframe set: %s', (p) => {
    expect(timeframeSetOf(p, charts)).toBeNull()
  })
  const VERBS = [['add rsi to S', 'indicator.add'], ['put the 20 ema on S', 'indicator.add'], ['make the 9 green on S', 'indicatorStyle.set'], ['remove rsi from S', 'indicator.remove'],
    ['calculate the rsi on weekly on S', 'indicatorStyle.setCalcTimeframe'], ['put rsi in its own pane on S', 'indicatorStyle.placeIn']]
  const all = cases(VERBS, ([t, action]) => ['all the daily charts', 'every daily chart', 'the daily charts'].map(w => [t.replace('S', w), action]))
  it(`${all.length} generated: the clause still reads, and the target is exactly the daily set (never the board)`, () => {
    const miss = all.filter(([p, action]) => {
      const r = fastParse(p, { host })
      return !(r?.kind === 'ops' && r.ops[0].action === action && JSON.stringify(r.target) === JSON.stringify({ all: true, refs: ['a', 'b'], line: true }))
    })
    expect(miss.map(m => m[0])).toEqual([])
  })
  it('one chart on that timeframe → that chart; none → asked (nothing runs)', () => {
    expect(extractTarget('add rsi to my weekly charts', host).target).toEqual({ chart: 'c', word: 'weekly' })
    expect(extractTarget('add rsi to all the monthly charts', host).target.ask.text).toMatch(/None of the charts here is on monthly/)
  })
  it('"from all charts" / "across every chart" are the board, as "on all charts" is', () => {
    for (const p of ['remove rsi from all charts', 'hide the rsi across all charts', 'add rsi across every chart']) expect(extractTarget(p, host).target).toEqual({ all: true })
  })
})
