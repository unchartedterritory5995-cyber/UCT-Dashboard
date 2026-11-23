// H-RDR-1 follow-up (fails on master ac9b18860b / 8b07ede2be): an EXCLUSION named RELATIVE TO ANOTHER CHART — "switch all of
// them to weekly except the one left of AAPL", "leave the chart below the NVDA one alone and set the rest to 1h", "everything
// but the one next to SPY". On master the "except X" resolver placed the ANCHOR (AAPL / AMD / MSFT …) as the exclusion, the
// named-relation reader made the excluded chart an ALLOWED target (the question offered it), the click-relation reader read
// "below SPY" as "below the clicked chart", and "… but the one next to SPY" excluded nothing — the chart the member excluded
// was changed. Fixed in the shared reader (spatialCheck.anchorRelExclusions → excludedCharts / spatialConstraints /
// everyExceptSet / withoutExclusions), which every chart-backed capability passes through. Class-generated:
//   (1) EXACT: relation × anchor kind (symbol, position, order) × cue × board, the expected chart computed on the grid's own
//       row / column arithmetic (independent of the reader): exactly that chart, never its anchor, never UNPLACED.
//   (2) FAIL SAFE: an anchor or relation the board cannot place exactly (nothing on that side, "next to" with two neighbours,
//       a ticker on two charts, a ticker / place the board lacks, an anchor word it cannot read) → UNPLACED (asked), and every
//       chart the phrase may mean is never offered.
//   (3) EARLIER TURN: "it" / "that one" with nothing clicked, "the one I just changed": the chart session memory says an
//       earlier turn changed (`subject`); none → asked. With a chart clicked, "it" stays the click (S6, as before).
//   (4) EVERY MUTATION FAMILY (registry-enumerated): a plan honouring the exclusion runs as planned; a plan touching the
//       excluded chart never changes it (dropped; the last net asks and never offers it).
//   (5) CONTROLS: an affirmative relation ("make the one left of AAPL weekly") excludes nothing.
// LOCAL (vitest, unit, the real registry and the fixture board; no model).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { chartRefOf } from './deixis'
import { excludedCharts, spatialConstraints, checkSpatialConstraints, withoutExcludedCharts, everyExceptSet, anchorRelSpans, withoutExclusions, UNPLACED } from './spatialCheck'

registerBuiltins()

// ── boards (unit form) built from a rows × cols grid; each chart knows its (r, c) for the independent oracle ──
const POS = {
  '1x3': [['left', 'middle', 'right']],
  '2x2': [['top-left', 'top-right'], ['bottom-left', 'bottom-right']],
  '3x3': [['top-left', 'top-middle', 'top-right'], ['middle-left', 'center', 'middle-right'], ['bottom-left', 'bottom-middle', 'bottom-right']],
  '2x3': [['top-left', 'top-middle', 'top-right'], ['bottom-left', 'bottom-middle', 'bottom-right']],
}
function grid(name, syms) {
  const rows = POS[name]
  const R = rows.length, C = rows[0].length
  const out = []
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = r * C + c
    out.push({ ref: `${name}-${i}`, label: `Chart (${name}-${i})`, symbol: syms[i], position: rows[r][c], r, c, cell: { x: c * 8, y: r * 10, w: 8, h: 10 } })
  }
  return out
}
const BOARDS = {
  '1x3': grid('1x3', ['SPY', 'AAPL', 'NVDA']),
  '2x2': grid('2x2', ['SPY', 'QQQ', 'NVDA', 'AMD']),
  '3x3': grid('3x3', ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'MSFT', 'META', 'AAPL', 'GOOG']),
  '2x3': grid('2x3', ['SPY', 'QQQ', 'NVDA', 'AAPL', 'AMD', 'MSFT']),
}
const read = (t, board, sel = null, subject = null) => {
  const ex = new Set([...excludedCharts(t, board, sel, { subject }), ...spatialConstraints(t, board, sel, { subject }).excluded])
  return [...ex].map(x => (x === UNPLACED ? 'UNPLACED' : x)).sort()
}
const unoffered = (t, board, sel = null, subject = null) => [...(excludedCharts(t, board, sel, { subject }).unoffered || [])].sort()

// ── the oracle: the neighbours of a chart on a side, on the grid's own row / column arithmetic ──
const at = (board, r, c) => board.find(x => x.r === r && x.c === c)
const ORACLE = {
  left: (b, a) => [at(b, a.r, a.c - 1)], right: (b, a) => [at(b, a.r, a.c + 1)],
  above: (b, a) => [at(b, a.r - 1, a.c)], below: (b, a) => [at(b, a.r + 1, a.c)],
  beside: (b, a) => [at(b, a.r, a.c - 1), at(b, a.r, a.c + 1)],
  adjacent: (b, a) => [at(b, a.r, a.c - 1), at(b, a.r, a.c + 1), at(b, a.r - 1, a.c), at(b, a.r + 1, a.c)],
}
// relation phrasings → [how it reads before the anchor, the oracle side]
const RELS = [
  ['left of', 'left'], ['to the left of', 'left'], ['on the left of', 'left'], ['directly left of', 'left'],
  ['right of', 'right'], ['to the right of', 'right'], ['immediately to the right of', 'right'],
  ['above', 'above'], ['over', 'above'], ['on top of', 'above'], ['right above', 'above'],
  ['below', 'below'], ['under', 'below'], ['underneath', 'below'], ['beneath', 'below'], ['directly below', 'below'],
  ['next to', 'beside'], ['beside', 'beside'], ['alongside', 'beside'], ['adjacent to', 'adjacent'],
]
// anchor kinds → the phrase that names chart `a` on `board` (null: this kind cannot name it unambiguously here)
const PLACE_WORDS = { 'top-left': 'the top-left one', 'top-right': 'the top right chart', 'bottom-left': 'the bottom-left chart', 'bottom-right': 'the lower right one',
  'top-middle': 'the top middle one', 'bottom-middle': 'the bottom middle chart', 'middle-left': 'the middle left one', 'middle-right': 'the middle-right chart', center: 'the centre chart',
  left: 'the left one', middle: 'the middle chart', right: 'the rightmost chart' }
const ANCHORS = {
  'symbol (bare)': (b, a) => a.symbol,
  'symbol (the X chart)': (b, a) => `the ${a.symbol} chart`,
  'symbol (the X one)': (b, a) => `the ${a.symbol} one`,
  "symbol (X's chart)": (b, a) => `${a.symbol}'s chart`,
  position: (b, a) => PLACE_WORDS[a.position],
  order: (b, a) => `chart ${b.indexOf(a) + 1}`,
}
const cap = (s) => s[0].toUpperCase() + s.slice(1)
// the exclusion's cue (o = the relative phrase) around a change on every chart
export const AR_CUES = {
  except: (o) => `switch all of them to weekly except ${o}`,
  'except for': (o) => `add RSI to every chart except for ${o}`,
  'apart from': (o) => `set all charts to 1h apart from ${o}`,
  'other than': (o) => `show volume on every chart other than ${o}`,
  excluding: (o) => `hide the indicators on all charts excluding ${o}`,
  besides: (o) => `make every chart log scale besides ${o}`,
  'everything but': (o) => `everything but ${o} to weekly`,
  '… but (quantifier)': (o) => `set everything to 1h but ${o}`,
  'leave … alone': (o) => `leave ${o} alone and set the rest to 1h`,
  ', but leave … alone': (o) => `add RSI to every chart, but leave ${o} alone`,
  'keep … as it is': (o) => `${cap('set every chart to weekly; keep')} ${o} as it is`,
  "don't touch": (o) => `set all charts to weekly, but don't touch ${o}`,
  skip: (o) => `make all charts weekly; skip ${o}`,
  'hands off': (o) => `show volume on every chart — hands off ${o}`,
  'not …': (o) => `add the 50 SMA to every chart, not ${o}`,
  "don't change … to weekly": (o) => `Set all charts to weekly. Don't change ${o} to weekly.`,
  'never add … to': (o) => `add RSI to all of them but never add RSI to ${o}`,
  '… stays as it is': (o) => `switch every chart to candles. ${cap(o)} stays as it is.`,
}
const HEADS = ['the one', 'the chart', 'the cell']

// every (board, anchor chart, relation, anchor kind) whose oracle gives EXACTLY one chart, each spread over a cue and a head
const EXACT = []
const AMBIG = []
for (const [bn, b] of Object.entries(BOARDS)) {
  for (const a of b) {
    for (const [rw, side] of RELS) {
      const hits = ORACLE[side](b, a).filter(Boolean)
      for (const [kn, f] of Object.entries(ANCHORS)) {
        const anchor = f(b, a)
        if (!anchor) continue
        const i = EXACT.length + AMBIG.length
        const cues = Object.entries(AR_CUES)
        const [cn, cue] = cues[i % cues.length]
        const phrase = `${HEADS[i % HEADS.length]} ${rw} ${anchor}`
        const row = [bn, kn, rw, cn, cue(phrase), b, a.ref, hits.map(h => h.ref)]
        if (hits.length === 1) EXACT.push(row)
        else AMBIG.push(row)
      }
    }
  }
}

describe('(1) exact: the chart the relation lands on is excluded — never its anchor, never UNPLACED', () => {
  it('the class is large and covers every relation × anchor kind × cue × board', () => {
    expect(EXACT.length).toBeGreaterThan(500)
    for (const [rw] of RELS) expect(EXACT.some(r => r[2] === rw)).toBe(true)
    for (const k of Object.keys(ANCHORS)) expect(EXACT.some(r => r[1] === k)).toBe(true)
    for (const c of Object.keys(AR_CUES)) expect(EXACT.some(r => r[3] === c)).toBe(true)
    for (const bn of Object.keys(BOARDS)) expect(EXACT.some(r => r[0] === bn)).toBe(true)
  })
  it.each(EXACT)('%s · %s · %s · %s: "%s"', (_b, _k, _r, _c, t, board, anchor, hits) => {
    expect(read(t, board, null)).toEqual(hits)
    expect(read(t, board, null)).not.toContain(anchor)
  })
  // the reported sentences
  it.each([
    ['switch all of them to weekly except the one left of AAPL', '3x3', ['3x3-6']],
    ['leave the chart below the NVDA one alone and set the rest to 1h', '3x3', ['3x3-5']],
    ['everything but the one next to SPY', '3x3', ['3x3-1']],
    ['set every chart to weekly except the one above AMD', '3x3', ['3x3-1']],
    ['set every chart to weekly except the chart under the top-right one', '3x3', ['3x3-5']],
    ['set all charts to weekly except the one to AAPL\'s left', '3x3', ['3x3-6']],
    ['set all charts to weekly except the one on the right of chart 1', '3x3', ['3x3-1']],
    ['set every chart to weekly, but the one directly beneath the centre chart stays as it is', '3x3', ['3x3-7']],
    ['set every chart to weekly except the charts to the left of GOOG', '3x3', ['3x3-6', '3x3-7']],
  ])('"%s" (%s) → %j', (t, bn, refs) => {
    expect(read(t, BOARDS[bn], null)).toEqual(refs)
  })
  // with a chart CLICKED elsewhere the named anchor still decides (master read "below SPY" as below the click)
  it.each([
    ['set all charts to weekly; skip the one below SPY', '3x3-4', ['3x3-3']],
    ["Set all charts to weekly. Don't change the one above AAPL to weekly.", '3x3-4', ['3x3-4']],
    ['set all charts to weekly apart from the one over MSFT', '3x3-4', ['3x3-2']],
    ['add RSI to every chart except the one left of AAPL', '3x3-0', ['3x3-6']],
  ])('clicked elsewhere: "%s" (clicked %s) → %j', (t, sel, refs) => {
    expect(read(t, BOARDS['3x3'], sel)).toEqual(refs)
  })
  it('the every-except SET is every chart less the excluded one (the anchor stays in it)', () => {
    const b = BOARDS['3x3']
    const ev = everyExceptSet('switch all of them to weekly except the one left of AAPL', b, null)
    expect(ev.refs).toEqual(b.map(c => c.ref).filter(r => r !== '3x3-6'))
    expect(ev.refs).toContain('3x3-7')                                              // AAPL, the anchor, is changed
  })
  it('the relative phrase is no place the request aims at (withoutExclusions blanks it)', () => {
    expect(withoutExclusions('switch all of them to weekly except the one left of AAPL')).not.toMatch(/AAPL|left/)
    expect(withoutExclusions('leave the chart below the NVDA one alone and set the rest to 1h')).not.toMatch(/NVDA|below/)
  })
})

describe('(2) fail safe: an anchor-relative exclusion the board cannot place exactly is asked, its candidates never offered', () => {
  it('the ambiguous class (nothing on that side, two neighbours) is generated from the same product', () => {
    expect(AMBIG.length).toBeGreaterThan(200)
    expect(AMBIG.some(r => r[7].length === 2)).toBe(true)                               // "next to" with two neighbours
    expect(AMBIG.some(r => r[7].length === 0)).toBe(true)                               // nothing there
  })
  it.each(AMBIG)('%s · %s · %s · %s: "%s" → UNPLACED', (_b, _k, _r, _c, t, board, _a, hits) => {
    expect(read(t, board, null)).toContain('UNPLACED')
    for (const h of hits) expect(unoffered(t, board, null)).toContain(h)
  })
  // two AAPL charts: the anchor is ambiguous — asked; every chart either AAPL's neighbour could be is never offered
  const DUP = grid('3x3', ['SPY', 'AAPL', 'NVDA', 'TSLA', 'AMD', 'MSFT', 'META', 'AAPL', 'GOOG'])
  it.each(Object.entries(AR_CUES).map(([cn, f]) => [cn, f('the one below AAPL')]))('two AAPL charts · %s: "%s"', (_c, t) => {
    expect(read(t, DUP, null)).toContain('UNPLACED')
    expect(unoffered(t, DUP, null)).toContain('3x3-4')                                  // below the top AAPL
    const ask = checkSpatialConstraints({ ...deps, host: hostOf(DUP), ops: DUP.map(c => ({ action: 'chart.setTimeframe', target: c.ref, args: { timeframe: 'W' } })), text: t })
    expect(ask?.ask).toBeTruthy()
    expect(ask.ask.choices.map(c => c.ref)).not.toContain('3x3-4')
  })
  it.each([
    ['set every chart to weekly except the one left of TSLA', BOARDS['2x2']],            // no TSLA on the board
    ['set every chart to weekly except the one below the middle one', BOARDS['2x2']],    // a 2×2 has no middle
    ['set every chart to weekly except the one next to the big chart', BOARDS['2x2']],   // an anchor word the board cannot read
    ['set every chart to weekly except the one right of chart 7', BOARDS['2x2']],        // four charts
    ['set every chart to weekly except the one left of the left one', BOARDS['2x2']],    // two left charts
  ])('"%s" → UNPLACED', (t, board) => {
    expect(read(t, board, null)).toContain('UNPLACED')
    expect(everyExceptSet(t, board, null)).toBeNull()
  })
})

describe('(3) earlier turn: "it" / "that one" / "the one I just changed" — the chart the last change was on', () => {
  const b = BOARDS['3x3']
  it.each([
    ['set all charts to weekly except the one next to it', '3x3-0', ['3x3-1']],
    ['add RSI to every chart, but leave the one below that one alone', '3x3-4', ['3x3-7']],
    ['set every chart to 1h apart from the chart to the left of the one I just changed', '3x3-8', ['3x3-7']],
    ["don't touch the one above it and make the rest weekly", '3x3-7', ['3x3-4']],
  ])('"%s" (subject %s) → %j', (t, subject, refs) => {
    expect(read(t, b, null, subject)).toEqual(refs)
    expect(read(t, b, null, null)).toContain('UNPLACED')                                // no earlier chart: asked
  })
  it('a click outranks memory for "it" (S6); "the one I just changed" names the earlier chart even with a click', () => {
    expect(read('set all charts to weekly except the one left of it', b, '3x3-5', '3x3-1')).toEqual(['3x3-4'])
    expect(read('set all charts to weekly except the one left of the one I just changed', b, '3x3-5', '3x3-1')).toEqual(['3x3-0'])
  })
  it('an earlier chart with nothing on that side, or with two neighbours, is asked', () => {
    expect(read('set all charts to weekly except the one left of it', b, null, '3x3-0')).toContain('UNPLACED')
    expect(read('set all charts to weekly except the one next to it', b, null, '3x3-4')).toContain('UNPLACED')
  })
})

// ── (4) every chart-backed mutation family, enumerated from the registry, on the 2×2 fixture (SPY QQQ / NVDA AMD) ──
function hostOf(board) {
  return { charts: { list: () => board.map(({ ref, label, symbol, position, cell }) => ({ ref, label, symbol, position, cell })), selected: () => null } }
}
function fixture() {
  const s = () => ({ settings: mergeChartSettings(null) })
  const fb = makeBoard([0, 1, 2, 3].map(i => ({ id: `c${i}`, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: s() })),
    { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'AMD' })
  const charts = { ...fb.host.charts, selected: () => null, canManageIndicators: () => true, canCreateIndicator: () => true }
  return { ...fb.host, charts }
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
// [words, the excluded chart] — each anchored on ANOTHER chart
const WORDS = [
  ['do it on every chart except the one left of QQQ', 'c0'],
  ['all of them, but leave the chart below the SPY one alone', 'c2'],
  ['every chart but the one next to AMD', 'c2'],
  ['do it on all charts; skip the one above the bottom-right one', 'c1'],
  ["do it on every chart, but don't touch the one to NVDA's right", 'c3'],
  ['do it on all of them apart from the chart under chart 2', 'c3'],
]
describe('(4) every mutation family the targeting layer serves (registry-enumerated)', () => {
  it('the registry yields the chart-backed families', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(20)
    for (const n of ['indicator.add', 'chart.setTimeframe', 'volumeProfile.set']) expect(FAMILIES.map(f => f.name)).toContain(n)
  })
  it.each(FAMILIES.flatMap(f => WORDS.map(([t, ex]) => [f.name, ex, t, f])))('%s, %s excluded — "%s": honoured exactly; never acted on', (_n, ex, t, f) => {
    const rest = IDS.filter(id => id !== ex)
    const good = opsOn(f, rest)
    expect(checkSpatialConstraints({ ...deps, ops: good, text: t })).toBeNull()
    const g1 = withoutExcludedCharts(good, [t], deps)
    expect(g1.dropped).toBe(0)
    expect(planned(f, g1.ops)).toEqual(rest)
    const bad = opsOn(f, IDS)
    const g2 = withoutExcludedCharts(bad, [t], deps)
    expect(g2.dropped).toBe(1)
    expect(planned(f, g2.ops)).toEqual(rest)
    const ask = checkSpatialConstraints({ ...deps, ops: bad, text: t })
    expect(ask?.ask).toBeTruthy()
    expect(ask.violation.bad).toEqual([ex])
    expect(ask.ask.choices.map(c => chartRefOf(f.kind, f.kind.list(HOST).find(s => s.ref === c.ref)))).not.toContain(ex)
  })
  it.each(FAMILIES.map(f => [f.name, f]))('%s: the earlier turn\'s chart as the anchor (subject c0, "except the one next to it") spares c1', (_n, f) => {
    const t = 'do it on every chart except the one next to it'
    const g = withoutExcludedCharts(opsOn(f, IDS), [t], { ...deps, subject: 'c0' })
    expect(planned(f, g.ops)).toEqual(['c0', 'c2', 'c3'])
    expect(checkSpatialConstraints({ ...deps, subject: 'c0', ops: opsOn(f, ['c0', 'c2', 'c3']), text: t })).toBeNull()
    // no earlier chart, nothing clicked: asked, nothing guessed
    expect(checkSpatialConstraints({ ...deps, ops: opsOn(f, IDS), text: t })?.ask).toBeTruthy()
  })
})

describe('(5) controls: an affirmative relation, or no chart head, excludes nothing', () => {
  it.each([
    ['make the one left of AAPL weekly'], ['add RSI to the chart below NVDA'], ['switch the one next to SPY to 1h'],
    ["don't forget to set the one next to SPY to weekly"], ['set the chart above AMD to log scale and leave the rest'],
    ['move the one left of AAPL to the right'], ['set every chart to weekly, the one below NVDA too'],
  ])('"%s" → no anchor-relative exclusion', (t) => {
    expect(anchorRelSpans(t)).toEqual([])
    expect(read(t, BOARDS['3x3'], null)).not.toContain('UNPLACED')
  })
})
