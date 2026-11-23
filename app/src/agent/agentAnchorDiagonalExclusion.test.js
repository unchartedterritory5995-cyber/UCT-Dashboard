// Anchor-relative exclusions, the DIAGONAL family (follow-up to #2522; AUDIT held-out probe e15). "set all to weekly except the
// one diagonal from AAPL" — and "across from", "opposite", "catty-corner", "kitty-corner", "the corner opposite" — name the
// excluded chart relative to ANOTHER chart. None of these relations was in AR_REL: the request was asked, but the question OFFERED
// the excluded chart (master and #2522 alike). Fixed in spatialCheck (AR_DIAG_REL / AR_CORNER_RE → arDiagonal). Class-generated:
//   (1) EXACT: board × phrasing × anchor kind × cue, wherever the board places the chart uniquely (a 2×2's diagonal, a 2×3
//       corner's one diagonal, the corner opposite a corner, "across from" on a 1×2): exactly that chart; never the anchor;
//       never UNPLACED; a click elsewhere changes nothing.
//   (2) AMBIGUOUS: several fits (a 3×3 centre's four diagonals, a 3×3 corner's centre AND far corner, "across from" on a 2×2:
//       the row, the column or the diagonal) or none (one row): UNPLACED (asked) and the ask NEVER offers a candidate.
//   (3) EVERY MUTATION FAMILY (registry-enumerated) on the 2×2 fixture: honoured exactly / the excluded op dropped / never offered.
//   (4) EARLIER TURN + CONTROLS.
// The expected charts come from the grid's own (row, col) arithmetic below, never from the reader. LOCAL (vitest, unit; no model).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { chartRefOf } from './deixis'
import { excludedCharts, spatialConstraints, checkSpatialConstraints, withoutExcludedCharts, everyExceptSet, anchorRelSpans, withoutExclusions, UNPLACED } from './spatialCheck'

registerBuiltins()

// ── boards: R × C lattices; each chart knows its (r, c) for the oracle ──
const SYMS9 = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD', 'MSFT', 'META', 'AAPL', 'GOOG']
const VW = (R, r) => (R === 1 ? null : r === 0 ? 'top' : r === R - 1 ? 'bottom' : R === 3 ? 'middle' : null)
const HW = (C, c) => (C === 1 ? null : c === 0 ? 'left' : c === C - 1 ? 'right' : C === 3 ? 'middle' : null)
function placeWords(R, C, r, c) {
  const v = VW(R, r), h = HW(C, c)
  if (v === 'middle' && h === 'middle') return 'the centre chart'
  const w = [v, h].filter(Boolean)
  if (!w.length) return null
  return (r + c) % 2 ? `the ${w.join('-')} one` : `the ${w.join(' ')} chart`
}
function grid(R, C) {
  const name = `${R}x${C}`, out = []
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = r * C + c
    out.push({ ref: `${name}-${i}`, label: `Chart (${name}-${i})`, symbol: SYMS9[i], r, c, words: placeWords(R, C, r, c), cell: { x: c * 8, y: r * 10, w: 8, h: 10 } })
  }
  out.R = R; out.C = C
  return out
}
const BOARDS = Object.fromEntries([[1, 2], [2, 1], [1, 3], [2, 2], [2, 3], [3, 2], [3, 3]].map(([R, C]) => [`${R}x${C}`, grid(R, C)]))

// ── the oracle: plain (row, col) arithmetic → { fits: [refs], exact } ──
const isCorner = (b, x) => (x.r === 0 || x.r === b.R - 1) && (x.c === 0 || x.c === b.C - 1)
const ORACLE = {
  diag: (b, a) => { const f = b.filter(x => x !== a && Math.abs(x.r - a.r) === Math.abs(x.c - a.c)); return { fits: f, exact: f.length === 1 } },
  across: (b, a) => { const f = b.filter(x => x !== a && (x.r === a.r || x.c === a.c || Math.abs(x.r - a.r) === Math.abs(x.c - a.c))); return { fits: f, exact: f.length === 1 } },
  corner: (b, a) => {
    if (b.R >= 2 && b.C >= 2 && isCorner(b, a)) return { fits: b.filter(x => x.r === b.R - 1 - a.r && x.c === b.C - 1 - a.c), exact: true }
    return { fits: b.filter(x => x !== a && isCorner(b, x)), exact: false }
  },
}
// phrasings → [the excluded noun phrase around the anchor `{a}`, the oracle]
const PHRASES = [
  ['{h} diagonal from {a}', 'diag'], ['{h} diagonally from {a}', 'diag'], ['{h} diagonal to {a}', 'diag'],
  ['{h} diagonally across from {a}', 'diag'], ['{h} diagonally opposite {a}', 'diag'], ['{h} that is diagonal from {a}', 'diag'],
  ['{h} catty-corner from {a}', 'diag'], ['{h} catty corner to {a}', 'diag'], ['{h} catty-cornered from {a}', 'diag'],
  ['{h} kitty-corner from {a}', 'diag'], ['{h} kitty corner to {a}', 'diag'], ['{h} cater-corner from {a}', 'diag'],
  ['{h} across from {a}', 'across'], ['{h} directly across from {a}', 'across'], ['{h} opposite {a}', 'across'], ['{h} opposite to {a}', 'across'],
  ['the corner opposite {a}', 'corner'], ['the one in the opposite corner from {a}', 'corner'], ['the chart in the far corner from {a}', 'corner'],
  ['the corner diagonally across from {a}', 'corner'], ['the opposite corner to {a}', 'corner'], ['the cell in the corner opposite {a}', 'corner'],
]
const HEADS = ['the one', 'the chart', 'the cell']
const ANCHORS = {
  'symbol (bare)': (b, a) => a.symbol,
  'symbol (the X chart)': (b, a) => `the ${a.symbol} chart`,
  "symbol (X's chart)": (b, a) => `${a.symbol}'s chart`,
  position: (b, a) => a.words,
  order: (b, a) => `chart ${b.indexOf(a) + 1}`,
}
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const CUES = {
  except: (o) => `set all to weekly except ${o}`,                               // the e15 shape
  'except for': (o) => `add RSI to every chart except for ${o}`,
  'apart from': (o) => `set all charts to 1h apart from ${o}`,
  'other than': (o) => `show volume on every chart other than ${o}`,
  excluding: (o) => `hide the indicators on all charts excluding ${o}`,
  besides: (o) => `make every chart log scale besides ${o}`,
  'everything but': (o) => `everything but ${o} to weekly`,
  '… but (quantifier)': (o) => `set everything to 1h but ${o}`,
  'leave … alone': (o) => `leave ${o} alone and set the rest to 1h`,
  ', but leave … alone': (o) => `add RSI to every chart, but leave ${o} alone`,
  'keep … as it is': (o) => `set every chart to weekly; keep ${o} as it is`,
  "don't touch": (o) => `set all charts to weekly, but don't touch ${o}`,
  skip: (o) => `make all charts weekly; skip ${o}`,
  'hands off': (o) => `show volume on every chart — hands off ${o}`,
  'not …': (o) => `add the 50 SMA to every chart, not ${o}`,
  '… stays as it is': (o) => `switch every chart to candles. ${cap(o)} stays as it is.`,
}
const read = (t, board, sel = null, subject = null) => {
  const ex = new Set([...excludedCharts(t, board, sel, { subject }), ...spatialConstraints(t, board, sel, { subject }).excluded])
  return [...ex].map(x => (x === UNPLACED ? 'UNPLACED' : x)).sort()
}
const unoffered = (t, board, sel = null) => [...(excludedCharts(t, board, sel).unoffered || [])].sort()
function hostOf(board) {
  return { charts: { list: () => board.map(({ ref, label, symbol, cell }) => ({ ref, label, symbol, cell })), selected: () => null } }
}
const askOn = (t, board, sel = null) => checkSpatialConstraints({ host: hostOf(board), getCapability, getTargetKind, sel, ops: board.map(c => ({ action: 'chart.setTimeframe', target: c.ref, args: { timeframe: 'W' } })), text: t })

const EXACT = [], AMBIG = []
for (const [bn, b] of Object.entries(BOARDS)) {
  for (const a of b) {
    for (const [pw, kind] of PHRASES) {
      const o = ORACLE[kind](b, a)
      for (const [kn, f] of Object.entries(ANCHORS)) {
        const anchor = f(b, a)
        if (!anchor) continue
        const i = EXACT.length + AMBIG.length
        const cues = Object.entries(CUES)
        const [cn, cue] = cues[i % cues.length]
        const phrase = pw.replace('{h}', HEADS[i % HEADS.length]).replace('{a}', anchor)
        const row = [bn, kind, kn, cn, cue(phrase), b, a.ref, o.fits.map(x => x.ref).sort()]
        if (o.exact && o.fits.length === 1) EXACT.push(row)
        else AMBIG.push(row)
      }
    }
  }
}

describe('(1) exact: where the board places the chart uniquely, exactly that chart is excluded — never its anchor', () => {
  it('the class covers every phrasing, anchor kind, cue and board', () => {
    expect(EXACT.length).toBeGreaterThan(400)
    for (const [pw, kind] of PHRASES) expect(EXACT.some(r => r[1] === kind), pw).toBe(true)
    for (const k of Object.keys(ANCHORS)) expect(EXACT.some(r => r[2] === k)).toBe(true)
    for (const c of Object.keys(CUES)) expect(EXACT.some(r => r[3] === c)).toBe(true)
    for (const bn of ['1x2', '2x1', '2x2', '2x3', '3x2', '3x3']) expect(EXACT.some(r => r[0] === bn), bn).toBe(true)
  })
  it.each(EXACT)('%s · %s · %s · %s: "%s"', (_b, _k, _a, _c, t, board, anchor, hits) => {
    expect(read(t, board, null)).toEqual(hits)
    expect(hits).not.toContain(anchor)
    // a chart clicked elsewhere never re-anchors it
    const other = board.find(c => c.ref !== anchor && !hits.includes(c.ref))
    if (other) expect(read(t, board, other.ref)).toEqual(hits)
  })
  it.each([
    ['set all to weekly except the one diagonal from AAPL', '2x2', 'TSLA', ['2x2-0']],            // e15 (AAPL is bottom-right here)
    ['set every chart to weekly except the corner opposite SPY', '3x3', null, ['3x3-8']],
    ['set every chart to weekly except the one in the opposite corner from GOOG', '3x3', null, ['3x3-0']],
    ['leave the chart kitty corner from QQQ alone and make the rest weekly', '2x2', null, ['2x2-2']],
    ['set all charts to weekly except the one diagonal from SPY', '2x3', null, ['2x3-4']],         // a 2×3 corner has one diagonal
    ['set all charts to weekly except the ones diagonal from AMD', '3x3', null, ['3x3-0', '3x3-2', '3x3-6', '3x3-8']], // plural: all
    ['set all charts to weekly except the one across from SPY', '1x2', null, ['1x2-1']],
  ])('"%s" (%s, AAPL→%s) → %j', (t, bn, swap, refs) => {
    const b = swap ? BOARDS[bn].map(c => (c.symbol === swap ? { ...c, symbol: 'AAPL' } : c)) : BOARDS[bn]
    expect(read(t, b, null)).toEqual(refs)
  })
  it('the every-except SET is every chart less the diagonal one (the anchor stays in it); the phrase is blanked for other readers', () => {
    const b = BOARDS['2x2']
    expect(everyExceptSet('set every chart to weekly except the one diagonal from SPY', b, null).refs).toEqual(['2x2-0', '2x2-1', '2x2-2'])
    expect(withoutExclusions('set all to weekly except the one diagonal from AAPL')).not.toMatch(/AAPL|diagonal/)
    expect(withoutExclusions('set all to weekly except the corner opposite SPY')).not.toMatch(/SPY|corner|opposite/)
  })
})

describe('(2) ambiguous: several fits or none → asked, and the question never offers a candidate', () => {
  it('the class holds several-fit and no-fit cases for every relation kind', () => {
    expect(AMBIG.length).toBeGreaterThan(400)
    for (const k of ['diag', 'across', 'corner']) {
      expect(AMBIG.some(r => r[1] === k && r[7].length >= 2), k).toBe(true)
    }
    expect(AMBIG.some(r => r[1] === 'diag' && r[7].length === 0)).toBe(true)               // one row: no diagonal
    expect(AMBIG.some(r => r[0] === '2x2' && r[1] === 'across')).toBe(true)                  // row, column or diagonal?
  })
  it.each(AMBIG)('%s · %s · %s · %s: "%s" → asked; no candidate offered', (_b, _k, _a, _c, t, board, anchor, fits) => {
    expect(read(t, board, null)).toContain('UNPLACED')
    const un = unoffered(t, board, null)
    for (const h of fits) expect(un).toContain(h)
    const ask = askOn(t, board)
    expect(ask?.ask, t).toBeTruthy()
    const offered = ask.ask.choices.map(c => c.ref)
    for (const h of fits) expect(offered).not.toContain(h)
  })
  // the anchor on two charts: every chart either anchor's diagonal could be is never offered
  const DUP = BOARDS['2x2'].map(c => (c.ref === '2x2-3' ? { ...c, symbol: 'SPY' } : c))   // SPY top-left AND bottom-right
  it.each(Object.entries(CUES).map(([cn, f]) => [cn, f('the one diagonal from SPY')]))('two SPY charts · %s: "%s"', (_c, t) => {
    expect(read(t, DUP, null)).toContain('UNPLACED')
    const ask = askOn(t, DUP)
    expect(ask?.ask).toBeTruthy()
    for (const r of ['2x2-0', '2x2-3']) expect(ask.ask.choices.map(c => c.ref)).not.toContain(r)
  })
  it.each([
    ['set every chart to weekly except the one diagonal from MSFT', BOARDS['2x2']],           // no MSFT here
    ['set every chart to weekly except the one diagonal from the big chart', BOARDS['2x2']], // unreadable anchor
    ['set every chart to weekly except the corner opposite the top middle one', BOARDS['2x3']], // not a corner: BL or BR?
    ['set every chart to weekly except the corner opposite the left one', BOARDS['1x3']],     // one row: no opposite corner
  ])('"%s" → UNPLACED', (t, board) => {
    expect(read(t, board, null)).toContain('UNPLACED')
    expect(everyExceptSet(t, board, null)).toBeNull()
  })
  it('an irregular board (one tall chart beside two) is asked; no off-axis chart is offered', () => {
    const b = [
      { ref: 'big', label: 'Chart (big)', symbol: 'SPY', cell: { x: 0, y: 0, w: 8, h: 20 } },
      { ref: 'tr', label: 'Chart (tr)', symbol: 'QQQ', cell: { x: 8, y: 0, w: 8, h: 10 } },
      { ref: 'br', label: 'Chart (br)', symbol: 'AAPL', cell: { x: 8, y: 10, w: 8, h: 10 } },
    ]
    const t = 'set all to weekly except the one diagonal from QQQ'
    expect(read(t, b, null)).toContain('UNPLACED')
    const ask = askOn(t, b)
    expect(ask?.ask).toBeTruthy()
  })
})

// ── (3) every chart-backed mutation family on the 2×2 fixture (SPY QQQ / NVDA AMD) ──
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
const toChart = (f, ref) => chartRefOf(f.kind, f.kind.list(HOST).find(s => s.ref === ref))
const WORDS = [
  ['do it on every chart except the one diagonal from SPY', 'c3'],
  ['all of them, but leave the chart catty-corner to QQQ alone', 'c2'],
  ['every chart but the corner opposite AMD', 'c0'],
  ['do it on all charts; skip the one kitty-corner from the bottom-left one', 'c1'],
  ["do it on every chart, but don't touch the one diagonally opposite chart 3", 'c1'],
]
const AMBIG_WORDS = [
  ['do it on every chart except the one across from SPY', ['c1', 'c2', 'c3']],
  ['do it on all of them apart from the one opposite NVDA', ['c0', 'c1', 'c3']],
]
describe('(3) every mutation family the targeting layer serves (registry-enumerated)', () => {
  it('the registry yields the chart-backed families', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(20)
    for (const n of ['indicator.add', 'chart.setTimeframe']) expect(FAMILIES.map(f => f.name)).toContain(n)
  })
  it.each(FAMILIES.flatMap(f => WORDS.map(([t, ex]) => [f.name, ex, t, f])))('%s, %s excluded — "%s": honoured exactly; never acted on', (_n, ex, t, f) => {
    const rest = IDS.filter(id => id !== ex)
    const good = opsOn(f, rest)
    expect(checkSpatialConstraints({ ...deps, ops: good, text: t })).toBeNull()
    const g1 = withoutExcludedCharts(good, [t], deps)
    expect(g1.dropped).toBe(0)
    expect(planned(f, g1.ops)).toEqual(rest)
    const g2 = withoutExcludedCharts(opsOn(f, IDS), [t], deps)
    expect(g2.dropped).toBe(1)
    expect(planned(f, g2.ops)).toEqual(rest)
    const ask = checkSpatialConstraints({ ...deps, ops: opsOn(f, IDS), text: t })
    expect(ask?.ask).toBeTruthy()
    expect(ask.ask.choices.map(c => toChart(f, c.ref))).not.toContain(ex)
  })
  it.each(FAMILIES.flatMap(f => AMBIG_WORDS.map(([t, never]) => [f.name, t, never, f])))('%s — "%s": asked, never offering %j', (_n, t, never, f) => {
    const ask = checkSpatialConstraints({ ...deps, ops: opsOn(f, IDS), text: t })
    expect(ask?.ask).toBeTruthy()
    for (const id of never) expect(ask.ask.choices.map(c => toChart(f, c.ref))).not.toContain(id)
  })
})

describe('(4) earlier turn and controls', () => {
  const b = BOARDS['2x2']
  it('"the one diagonal from it" with nothing clicked: the earlier turn\'s chart; none → asked', () => {
    expect(read('set all charts to weekly except the one diagonal from it', b, null, '2x2-1')).toEqual(['2x2-2'])
    expect(read('set all charts to weekly except the one diagonal from it', b, null, null)).toContain('UNPLACED')
    expect(read('set all charts to weekly except the one catty-corner from the one I just changed', b, '2x2-0', '2x2-1')).toEqual(['2x2-2'])
  })
  it('anchored on the click it stays the click-relation readers\' (unchanged): the click\'s diagonal is excluded', () => {
    expect(read('set all charts to weekly except the one diagonally opposite this one', b, '2x2-0')).toContain('2x2-3')
  })
  it.each([
    ['make the one diagonal from AAPL weekly'], ['add RSI to the chart across from SPY'], ['switch the corner opposite NVDA to 1h'],
    ["don't forget to set the one kitty-corner from SPY to weekly"], ['draw a line from the opposite corner'],
  ])('"%s" → no anchor-relative exclusion', (t) => {
    expect(anchorRelSpans(t)).toEqual([])
    expect(read(t, BOARDS['3x3'], null)).not.toContain('UNPLACED')
  })
})
