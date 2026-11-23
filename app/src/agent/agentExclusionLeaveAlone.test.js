// H-RDR-1 (follow-up, fails on master alone): the multi-chart EXCLUSION reader missed "leave <the chart> alone" and its class
// whenever the chart was named by a POSITION, a LINE, an ORDINAL, the CLICK or a pronoun — the negated-clause reader only ever
// read ticker objects, so "add RSI to every chart, but leave the top-left one alone" excluded nothing and a plan on that chart
// ran. Fixed in the shared reader (spatialCheck.negChartRefs → excludedCharts / spatialConstraints / withoutExclusions), which
// every chart-backed capability passes through. Class-generated (own phrasings, not AUDIT's held-out probes):
//   (1) RECOGNIZED → EXACT: cue × reference kind × clause position × change family × board: the reader places exactly the
//       chart(s) the words exclude, never UNPLACED (a recognized exclusion never degrades into a question).
//   (2) EVERY MUTATION FAMILY (enumerated from the registry, never a hand list): for each chart-backed, non-query capability,
//       a plan that honours the exclusion runs as planned (no clarify, nothing dropped); a plan that touches the excluded chart
//       never changes it (the gate drops exactly that op; the last net asks and never offers it).
//   (3) FAIL SAFE: a reference the cue governs that the board cannot place (no such place / order, the click with nothing
//       clicked, a pronoun, a relation from a named chart) is UNPLACED → the plan is asked; the gate guesses nothing.
//   (4) CONTROLS: no over-capture (values, settings, indicators, the rest; "keep X" / "leave X" without a tail alone).
// LOCAL (vitest, unit, the real registry and the fixture board; no model).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { chartRefOf } from './deixis'
import { excludedCharts, spatialConstraints, checkSpatialConstraints, withoutExcludedCharts, negChartRefs, UNPLACED } from './spatialCheck'

registerBuiltins()

// ── boards (unit form: ref, symbol, position, cell) ──
const POS2 = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const Q = ['SPY', 'QQQ', 'NVDA', 'AMD'].map((s, i) => ({ ref: `q${i}`, label: `Chart (q${i})`, symbol: s, position: POS2[i], cell: { x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10 } }))
const P9 = ['top-left', 'top-middle', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-middle', 'bottom-right']
const N9 = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'MSFT', 'META', 'AAPL', 'GOOG'].map((s, i) => ({ ref: `n${i}`, label: `Chart (n${i})`, symbol: s, position: P9[i], cell: { x: (i % 3) * 8, y: Math.floor(i / 3) * 10, w: 8, h: 10 } }))
const R3 = ['SPY', 'QQQ', 'NVDA'].map((s, i) => ({ ref: `r${i}`, label: `Chart (r${i})`, symbol: s, position: ['left', 'middle', 'right'][i], cell: { x: i * 8, y: 0, w: 8, h: 20 } }))
const read = (t, board, sel = null) => {
  const ex = new Set([...excludedCharts(t, board, sel), ...spatialConstraints(t, board, sel).excluded])
  return [...ex].map(x => (x === UNPLACED ? 'UNPLACED' : x)).sort()
}

// ── the class: cues (each a function of the reference), clause positions, change families ──
export const CUES = {
  'leave … alone': (o) => `leave ${o} alone`,
  'leave … as is': (o) => `leave ${o} as is`,
  'leave … as it is': (o) => `leave ${o} as it is`,
  'leave … untouched': (o) => `leave ${o} untouched`,
  'leave … unchanged': (o) => `leave ${o} unchanged`,
  'leave … be': (o) => `leave ${o} be`,
  'leave … out of it': (o) => `leave ${o} out of it`,
  'leave out …': (o) => `leave out ${o}`,
  "don't touch": (o) => `don't touch ${o}`,
  'dont change': (o) => `dont change ${o}`,
  'do not modify': (o) => `do not modify ${o}`,
  'never touch': (o) => `never touch ${o}`,
  "don't mess with": (o) => `don't mess with ${o}`,
  'keep … the same': (o) => `keep ${o} the same`,
  'keep … as it is': (o) => `keep ${o} as it is`,
  'keep … untouched': (o) => `keep ${o} untouched`,
  skip: (o) => `skip ${o}`,
  ignore: (o) => `ignore ${o}`,
  exclude: (o) => `exclude ${o}`,
  spare: (o) => `spare ${o}`,
  'hands off': (o) => `hands off ${o}`,
  'not … though': (o) => `not ${o} though`,
  without: (o) => `without ${o}`,
  '… stays as it is': (o) => `${o} stays as it is`,
  '… is fine as it is': (o) => `${o} is fine as it is`,
}
const PREPS = {
  except: (o) => `except ${o}`, 'except for': (o) => `except for ${o}`, 'apart from': (o) => `apart from ${o}`,
  'other than': (o) => `other than ${o}`, besides: (o) => `besides ${o}`, excluding: (o) => `excluding ${o}`, 'but not': (o) => `but not ${o}`,
}
const cap = (s) => s[0].toUpperCase() + s.slice(1)
export const JOIN = {
  ', but': (c, n) => `${c}, but ${n}`, 'but (no comma)': (c, n) => `${c} but ${n}`, comma: (c, n) => `${c}, ${n}`,
  semicolon: (c, n) => `${c}; ${n}`, 'em dash': (c, n) => `${c} — ${n}`, 'next sentence': (c, n) => `${cap(c)}. ${cap(n)}.`,
  'first sentence': (c, n) => `${cap(n)}. ${cap(c)}.`, 'and (before)': (c, n) => `${cap(n)} and ${c}`,
}
// one change per mutation family (add / remove / show / hide / style / timeframe / scale / type / profile …)
export const CHANGES = ['add RSI to every chart', 'remove the 50 SMA from all charts', 'show volume on every chart', 'hide the indicators on all of them',
  'make the EMA lines blue on every chart', 'set every chart to weekly', 'switch all charts to log scale', 'turn on volume profile on all charts',
  'change all the charts to candles']

// reference kinds → [phrase, the chart it names] on the 2×2 (q0 TL SPY · q1 TR QQQ / q2 BL NVDA · q3 BR AMD), q0 clicked
const REFS22 = [
  ['position', 'the top-left one', 'q0'], ['position', 'the top left chart', 'q0'], ['position', 'the upper-left chart', 'q0'],
  ['position', 'the bottom right one', 'q3'], ['position', 'the lower right chart', 'q3'],
  ['ordinal', 'the first chart', 'q0'], ['ordinal', 'the second chart', 'q1'], ['ordinal', 'the 3rd chart', 'q2'], ['ordinal', 'the last chart', 'q3'],
  ['ordinal', 'chart 2', 'q1'], ['ordinal', 'chart three', 'q2'], ['ordinal', 'the fourth one', 'q3'],
  ['click', 'this one', 'q0'], ['click', 'this chart', 'q0'], ['click', 'the selected chart', 'q0'], ['click', 'the one I clicked', 'q0'], ['click', 'my chart', 'q0'],
  ['symbol', 'the SPY chart', 'q0'], ['symbol', "SPY's chart", 'q0'], ['symbol', 'the NVDA one', 'q2'], ['symbol', 'my AMD chart', 'q3'],
]
const FAMILY = Object.entries(CUES).flatMap(([cue, f]) => REFS22.map(([kind, o, ref]) => [cue, kind, o, ref, f(o)]))
  .flatMap(([cue, kind, , ref, n], i) => {
    const joins = Object.entries(JOIN)
    const [jn, j] = joins[i % joins.length]                                       // every join, spread over the family
    return [[cue, kind, jn, ref, j(CHANGES[i % CHANGES.length], n)]]
  })

describe('(1) recognized → exact: the reader places exactly the excluded chart, never UNPLACED', () => {
  it('the family covers every cue × reference', () => {
    expect(FAMILY.length).toBe(Object.keys(CUES).length * REFS22.length)
  })
  it.each(FAMILY)('%s × %s × %s: → %s · "%s"', (_c, _k, _j, ref, t) => {
    expect(read(t, Q, 'q0')).toEqual([ref])
  })
  // the reported sentence, each join, each change family
  it.each(Object.entries(JOIN).flatMap(([jn, j]) => CHANGES.map(c => [jn, j(c, 'leave the SPY chart alone')])))('the reported form (%s): "%s"', (_j, t) => {
    expect(read(t, Q, null)).toEqual(['q0'])
  })
  it.each(Object.entries(PREPS).flatMap(([p, f]) => REFS22.filter(([k]) => k !== 'click' || p !== 'but not').map(([k, o, ref]) => [p, k, ref, `${CHANGES[(o.length) % CHANGES.length]} ${f(o)}`])))(
    'prepositional %s × %s → %s: "%s"', (_p, _k, ref, t) => {
      expect(read(t, Q, 'q0')).toEqual([ref])
    })
  it.each([
    // lines, sides and the middle on a 3×3 (n0..n8 in reading order), n4 clicked
    ['add RSI to every chart, but leave the top row alone', ['n0', 'n1', 'n2']],
    ['make all charts weekly; keep the bottom row the same', ['n6', 'n7', 'n8']],
    ['Skip the left column and switch every chart to log scale.', ['n0', 'n3', 'n6']],
    ['show volume on all of them — hands off the middle one', ['n4']],
    ['add RSI to every chart but leave the centre chart alone', ['n4']],
    ['hide the indicators on every chart. The top-right one stays as it is.', ['n2']],
    ['set every chart to weekly, but leave the bottom middle one alone', ['n7']],
    ['set every chart to weekly, ignore the charts on the left', ['n0', 'n3', 'n6']],
    ['add RSI to every chart but leave the fifth chart alone', ['n4']],
  ])('3×3: "%s" → %j', (t, refs) => {
    expect(read(t, N9, 'n4')).toEqual([...refs].sort())
  })
  it.each([
    // several references under one cue
    ['add RSI to every chart, but leave the top-left one and the bottom-right one alone', Q, ['q0', 'q3']],
    ["make all charts weekly; don't touch chart 1 or chart 4", Q, ['q0', 'q3']],
    ['Leave the first and the last chart alone and set every chart to weekly.', Q, ['q0', 'q3']],
    ['show volume on every chart but skip the left one and the right one', R3, ['r0', 'r2']],
    // a 1×3 row
    ['add RSI to every chart, but leave the middle one alone', R3, ['r1']],
    ['set every chart to weekly, leave the rightmost chart alone', R3, ['r2']],
  ])('lists and rows: "%s" → %j', (t, board, refs) => {
    expect(read(t, board, null)).toEqual([...refs].sort())
  })
  // a request run on into a picked choice's label (the gate reads the request beside its answer): the place words of the
  // label are never read as the exclusion's object — no chart the member did not exclude is ever excluded
  it.each([
    ['reset all cells to my chart; dont touch NVDA Top-left chart (SPY), Top-right chart (QQQ) and Bottom-right chart (AMD)'],
    ['reset every cell to my chart, hands off the NVDA chart Top-left chart (SPY), Top-right chart (QQQ) and Bottom-right chart (AMD)'],
  ])('run-on label: "%s" → never the labelled charts', (t) => {
    for (const r of ['q0', 'q1', 'q3']) expect(read(t, Q, null)).not.toContain(r)
  })
  it.each([
    // a pronoun / the click by the act, with a click (the click is the one meant)
    ['add RSI to every chart but leave it alone'], ['make all charts weekly, keep this one as it is'], ['set every chart to weekly, skip the one I selected'],
    ['Hands off mine and show volume on every chart.'], ['switch all charts to log scale, but this chart stays as it is'],
  ])('the click: "%s" → the clicked chart', (t) => {
    expect(read(t, Q, 'q1')).toEqual(['q1'])
  })
})

// ── (2) every chart-backed mutation family, enumerated from the registry ──
function fixture() {
  const s = () => ({ settings: mergeChartSettings(null) })
  const b = makeBoard([0, 1, 2, 3].map(i => ({ id: `c${i}`, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: s() })),
    { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'AMD' })
  const base = b.host.charts
  const charts = { ...base, selected: () => null, canManageIndicators: () => true, canCreateIndicator: () => true }
  return { ...b.host, charts }
}
const HOST = fixture()
const IDS = ['c0', 'c1', 'c2', 'c3']
const FAMILIES = allCapabilityNames().map(name => {
  const c = getCapability(name)
  if (!c || c.query) return null
  const kind = getTargetKind(c.target)
  if (!kind) return null
  let list = []
  try { list = kind.list(HOST) || [] } catch { return null }
  const byChart = Object.fromEntries(IDS.map(id => [id, list.find(s => chartRefOf(kind, s) === id)]))
  return IDS.every(id => byChart[id]) ? { name, kind, byChart } : null
}).filter(Boolean)
const deps = { host: HOST, getCapability, getTargetKind }
const opsOn = (f, ids) => ids.map(id => ({ action: f.name, target: f.byChart[id].ref, args: {} }))
const planned = (f, ops) => ops.map(o => chartRefOf(f.kind, f.kind.list(HOST).find(s => s.ref === o.target))).sort()
// [words, the excluded chart]
const WORDS = [
  ['add it to every chart, but leave the top-left one alone', 'c0'],
  ['do it on all of them; skip the second chart', 'c1'],
  ['every chart please. Hands off the bottom left chart.', 'c2'],
  ['all charts, but keep chart four as it is', 'c3'],
  ['Leave the SPY chart alone and do it on every chart', 'c0'],
  ['do it on every chart except the top right one', 'c1'],
]

describe('(2) every mutation family the targeting layer serves (registry-enumerated)', () => {
  it('the registry yields the chart-backed families (add / remove / show / hide / style / timeframe / profile …)', () => {
    const names = FAMILIES.map(f => f.name)
    expect(names.length).toBeGreaterThanOrEqual(20)
    for (const n of ['indicator.add', 'chart.setTimeframe', 'volumeProfile.set']) expect(names).toContain(n)
  })
  const CASES = FAMILIES.flatMap(f => WORDS.map(([t, ex]) => [f.name, ex, t, f]))
  it.each(CASES)('%s, %s excluded — "%s": honoured exactly; never acted on', (_n, ex, t, f) => {
    const rest = IDS.filter(id => id !== ex)
    // a plan that honours the exclusion runs exactly as planned: no question, nothing dropped
    const good = opsOn(f, rest)
    expect(checkSpatialConstraints({ ...deps, ops: good, text: t })).toBeNull()
    const g1 = withoutExcludedCharts(good, [t], deps)
    expect(g1.dropped).toBe(0)
    expect(planned(f, g1.ops)).toEqual(rest)
    // a plan that touches it: the gate drops exactly that chart's op; the last net asks and never offers it
    const bad = opsOn(f, IDS)
    const g2 = withoutExcludedCharts(bad, [t], deps)
    expect(g2.dropped).toBe(1)
    expect(planned(f, g2.ops)).toEqual(rest)
    const ask = checkSpatialConstraints({ ...deps, ops: bad, text: t })
    expect(ask?.ask).toBeTruthy()
    expect(ask.violation.bad).toEqual([ex])
    expect(ask.ask.choices.map(c => chartRefOf(f.kind, f.kind.list(HOST).find(s => s.ref === c.ref)))).not.toContain(ex)
  })
})

// ── (3) fail safe: what the board cannot place is UNPLACED (asked), never acted on everywhere, never guessed ──
// The UNRESOLVED rule (spatialCheck.excludedCharts, "UNRESOLVED — the exact rule"): a reference a negation cue governs is
// UNRESOLVED when the phrase resolver places no chart for it — a place or order the board does not have, the click with nothing
// clicked, a pronoun with no click, a relation from a named chart, a chart named by a word that is no place / order / ticker.
const UNRESOLVED = [
  ['add RSI to every chart, but leave the middle one alone', Q, null],               // a 2×2 has no middle
  ['make all charts weekly; skip the sixth chart', Q, null],                         // four charts
  ['set every chart to weekly, but leave this one alone', Q, null],                  // nothing clicked
  ['show volume on every chart but leave it alone', Q, null],                        // a pronoun, nothing clicked
  ['Leave that one alone and add RSI to every chart.', Q, null],                     // a pronoun follow-up the board cannot place
  ['add RSI to every chart, but leave the one next to the middle one alone', Q, null],     // a relation from a named chart the board lacks
  ["switch all charts to log scale; don't touch the one beside TSLA", Q, null],             // (no TSLA chart)
  ['add RSI to every chart, but leave the one above the top-left one alone', Q, null],      // nothing on that side
  ['add RSI to every chart, leave the other chart alone', Q, null],
  ['set every chart to weekly, but keep the big chart the same', Q, null],
  ['add RSI to every chart but leave the middle row alone', Q, null],                 // two rows
  ['Set every chart to weekly. Not the middle one.', Q, null],                         // a bare "not" on a place the board lacks
]
describe('(3) fail safe: an exclusion the board cannot place is asked (UNPLACED), never acted on', () => {
  // (H-RDR-1 follow-up, agentAnchorRelativeExclusion) a relation from a NAMED chart the board places EXACTLY is that chart, never
  // asked and never its anchor (these two were UNPLACED before; the unplaceable relations above stay asked)
  it.each([
    ['add RSI to every chart, but leave the one next to the top-left one alone', ['q1']],
    ["switch all charts to log scale; don't touch the one beside NVDA", ['q3']],
  ])('anchor-relative, placed exactly: "%s" → %j', (t, refs) => {
    expect(read(t, Q, null)).toEqual(refs)
  })
  it.each(UNRESOLVED)('"%s" → UNPLACED; the plan on every chart is asked; the gate guesses nothing', (t, board, sel) => {
    expect(read(t, board, sel)).toContain('UNPLACED')
    const f = FAMILIES.find(x => x.name === 'indicator.add')
    const ask = checkSpatialConstraints({ ...deps, ops: opsOn(f, IDS), text: t })
    expect(ask?.ask).toBeTruthy()
  })
  it('the reader names each unresolved reference it read (the PR text: what "unresolved" means)', () => {
    expect(negChartRefs('add RSI to every chart, but leave the middle one alone', Q).map(r => r.phrase)).toEqual(['the middle one'])
    expect(negChartRefs('Leave that one alone and add RSI to every chart.', Q).map(r => r.phrase)).toEqual(['that one'])
  })
})

// ── (4) controls: no over-capture (the words exclude no chart) ──
describe('(4) controls: no exclusion is read', () => {
  it.each([
    ['add MACD to every chart but leave the RSI alone'], ['keep the RSI as it is and add MACD to every chart'], ["don't touch the axis"],
    ['skip to the next bar'], ['leave it on weekly'], ['make NVDA weekly and leave it there'], ['make it weekly, not the chart I meant'],
    ['make everything weekly, not daily'], ['leave the rest as they are'], ['skip the intro and set every chart to weekly'],
    ['keep the top one on daily'], ['leave the top one on'], ['ignore that and make all charts weekly'], ['add the 50 SMA to every chart, not the 200'],
    ['keep the same colours and make every chart weekly'], ['set every chart to weekly, leave the colours as they are'],
  ])('"%s" → nothing', (t) => {
    expect(read(t, Q, null)).toEqual([])
  })
})
