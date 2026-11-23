// BARE whole-board quantifier + exclusion (follow-up to #2522 / #2532). "set all to weekly but leave AAPL alone" was PROPOSED for any
// AAPL, even a plain ticker ("I wasn't sure you meant …"): a bare "all" / "each" / "every one" / "the lot" / "the rest" carries no
// chart noun, so neither deixis.MANY_COUNT nor spatialCheck.EVERY_Q read it as "every chart", and the plan's charts stayed
// "unnamed". The excluded chart was never offered (safe), but the question was unnecessary. Fixed in spatialCheck.bareQuantifier
// (read by everyExceptSet) and deixis.screenUnnamedTargets (a plan on exactly the every-except set is identified). Class-generated:
//   (1) EXACT: board × quantifier × exclusion form × reference kind, where the exclusion places one chart: the set is every other
//       chart; a plan on exactly that set passes every gate (no ask, no proposal); a plan that also names the excluded chart has
//       exactly that op dropped, and any question never offers it.
//   (2) FAIL-SAFE: the exclusion cannot place one chart (a ticker on two charts, a ticker not on the board, "the one next to X"
//       with two neighbours, an unreadable phrase): no set; still proposed / asked as before; the candidates never offered.
//   (3) OTHER MEANINGS OF "ALL" (unchanged): "remove all indicators but leave RSI", "remove all but RSI", "hide all except
//       volume", "delete all drawings except the trendline", idioms ("at all", "after all", "all in all", "that's all"): no set
//       forms and the screen's verdict is exactly what it was.
//   (4) "THE REST" is read only with no click and no earlier-turn chart (it may be the rest of THAT chart): otherwise unchanged.
//   (5) EVERY CHART-BACKED MUTATION FAMILY (registry-enumerated) × the bare wordings: honoured exactly / never acted on.
// The expected chart comes from the grid's own (row, col) arithmetic, never from the reader. LOCAL (vitest, unit; no model).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { allCapabilityNames, getCapability, getTargetKind } from './capabilities'
import { chartRefOf, screenUnnamedTargets, screenDeicticOps } from './deixis'
import { excludedCharts, spatialConstraints, checkSpatialConstraints, withoutExcludedCharts, everyExceptSet, bareQuantifier, UNPLACED } from './spatialCheck'

registerBuiltins()

// ── boards: R × C lattices on the real fixture host (the host's own position words, symbols and link groups) ──
const SYMS6 = ['SPY', 'QQQ', 'NVDA', 'AMD', 'MSFT', 'META']
function boardOf(R, C, syms = SYMS6) {
  const s = () => ({ settings: mergeChartSettings(null) })
  const n = R * C, w = 24 / C
  const fb = makeBoard(Array.from({ length: n }, (_, i) => ({ id: `c${i}`, type: 'chart', x: (i % C) * w, y: Math.floor(i / C) * 10, w, h: 10, color: 'N', opts: s() })),
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`N:c${i}`, syms[i]])))
  let sel = null
  const host = { ...fb.host, charts: { ...fb.host.charts, selected: () => sel, canManageIndicators: () => true, canCreateIndicator: () => true } }
  const cells = Array.from({ length: n }, (_, i) => ({ ref: `c${i}`, r: Math.floor(i / C), c: i % C, symbol: syms[i] }))
  return { name: `${R}x${C}`, R, C, host, cells, select: (r) => { sel = r }, live: () => host.charts.list() }
}
const BOARDS = [boardOf(1, 3), boardOf(2, 2), boardOf(2, 3)]

// ── the quantifiers (bare: what the fix reads; with a noun / "everything" / "all of them": the control already read) ──
const QUANTS = {
  all: { bare: true, says: ['set all to weekly', 'make all weekly', 'switch all to 1h', 'add RSI to all'] },
  each: { bare: true, says: ['set each to weekly', 'make each log scale', 'add RSI to each'] },
  'every one': { bare: true, says: ['set every one to weekly', 'put RSI on every one'] },
  'the lot': { bare: true, says: ['set the lot to weekly', 'add RSI to the lot'] },
  'the rest': { bare: true, rest: true, says: ['set the rest to weekly', 'add RSI to the rest'] },
  everything: { bare: false, says: ['set everything to weekly', 'make everything 1h'] },
  'all of them': { bare: false, says: ['set all of them to weekly', 'add RSI to all of them'] },
}
// ── the exclusion forms (X = the reference) ──
const FORMS = {
  'but leave X alone': (x) => ` but leave ${x} alone`,
  'except X': (x) => ` except ${x}`,
  'not X': (x) => `, not ${x}`,
  'apart from X': (x) => ` apart from ${x}`,
  'skip X': (x) => `, skip ${x}`,
  'keep X as is': (x) => `, keep ${x} as is`,
}
// ── the reference kinds: how X names the excluded cell (null = this kind cannot name it uniquely) ──
const vw = (b, r) => (b.R === 1 ? null : r === 0 ? 'top' : 'bottom')
const hw = (b, c) => (c === 0 ? 'left' : c === b.C - 1 ? 'right' : null)
const REFS = {
  ticker: (b, x) => x.symbol,
  'the T chart': (b, x) => `the ${x.symbol} chart`,
  "T's chart": (b, x) => `${x.symbol}'s chart`,
  'chart N': (b, x) => `chart ${b.cells.indexOf(x) + 1}`,
  position: (b, x) => { const h = hw(b, x.c), v = vw(b, x.r); if (!h) return null; return v ? `the ${v}-${h} one` : `the ${h} one` },
  'anchor-relative': (b, x) => { const left = b.cells.find(y => y.r === x.r && y.c === x.c - 1); return left && x.c === b.C - 1 ? `the one right of ${left.symbol}` : null },
}

const opsOn = (refs) => refs.map(r => ({ action: 'chart.setTimeframe', target: r, args: { timeframe: 'W' } }))
const deps = (b) => ({ host: b.host, getCapability, getTargetKind })
// the two target screens in useAgent's order: the deictic screen (a phrase that points at a chart), then the unnamed-target screen
const unnamed = (b, ops, text, subject = null) => {
  const d = screenDeicticOps({ ...deps(b), ops, text, subject })
  if (d && (d.ask || d.refuse || d.aim)) return d
  return screenUnnamedTargets({ ...deps(b), ops, text, subject })
}
// every chart of `refs` is named in the words by its own symbol (a plan on them is identified whatever the quantifier)
const symNamed = (b, t, refs) => refs.every(r => new RegExp(String.raw`\b${b.cells.find(c => c.ref === r).symbol}\b`).test(t))
const excl = (b, t) => { const s = new Set([...excludedCharts(t, b.live(), null), ...spatialConstraints(t, b.live(), null).excluded]); return [...s].map(x => (x === UNPLACED ? 'UNPLACED' : x)).sort() }

const EXACT = []
for (const b of BOARDS) {
  for (const x of b.cells) {
    for (const [kn, ref] of Object.entries(REFS)) {
      const xs = ref(b, x)
      if (!xs) continue
      for (const [fn, form] of Object.entries(FORMS)) {
        for (const [qn, q] of Object.entries(QUANTS)) {
          const say = q.says[(EXACT.length + b.cells.indexOf(x)) % q.says.length]
          EXACT.push([b.name, qn, fn, kn, `${say}${form(xs)}`, b, x.ref, q])
        }
      }
    }
  }
}

describe('(1) exact: a bare quantifier less an exclusion that places one chart names every other chart', () => {
  it('the class covers every quantifier, exclusion form, reference kind and board', () => {
    expect(EXACT.length).toBeGreaterThan(1000)
    for (const k of [Object.keys(QUANTS), Object.keys(FORMS), Object.keys(REFS)].flat()) expect(EXACT.some(r => r.slice(1, 4).includes(k)), k).toBe(true)
    for (const b of BOARDS) expect(EXACT.some(r => r[0] === b.name)).toBe(true)
  })
  it.each(EXACT)('%s · %s · %s · %s: "%s"', (_b, _q, _f, _k, t, b, ex, q) => {
    const all = b.cells.map(c => c.ref)
    const rest = all.filter(r => r !== ex)
    expect(excl(b, t)).toEqual([ex])
    if (q.bare) expect(everyExceptSet(t, b.live(), null, { rest: !!q.rest })?.refs).toEqual(rest)
    // HONOURED EXACTLY: the plan on every other chart is identified (no proposal, no question)
    expect(unnamed(b, opsOn(rest), t), t).toBeNull()
    expect(checkSpatialConstraints({ ...deps(b), ops: opsOn(rest), text: t })).toBeNull()
    expect(withoutExcludedCharts(opsOn(rest), [t], deps(b)).dropped).toBe(0)
    // NEVER ACTED ON: a plan that also names the excluded chart loses exactly that op; any question never offers it
    const g = withoutExcludedCharts(opsOn(all), [t], deps(b))
    expect(g.dropped).toBe(1)
    expect(g.ops.map(o => o.target)).toEqual(rest)
    const ask = checkSpatialConstraints({ ...deps(b), ops: opsOn(all), text: t })
    expect(ask?.ask).toBeTruthy()
    expect(ask.ask.choices.map(c => c.ref)).not.toContain(ex)
    // a plan on only PART of the set is not identified by the words (screened as before) — unless the words name each of its
    // charts anyway ("the one right of QQQ": a plan on QQQ alone is QQQ by symbol)
    const part = rest.slice(1)
    if (q.bare && part.length && !symNamed(b, t, part)) expect(unnamed(b, opsOn(part), t)).not.toBeNull()
  })
  it('the reported sentence: "set all to weekly but leave X alone" for a plain ticker runs on the other charts', () => {
    const b = BOARDS[1]
    for (const x of b.cells) {
      const t = `set all to weekly but leave ${x.symbol} alone`
      const rest = b.cells.map(c => c.ref).filter(r => r !== x.ref)
      expect(unnamed(b, opsOn(rest), t)).toBeNull()
      expect(everyExceptSet(t, b.live(), null)).toEqual({ refs: rest, excluded: [x.ref] })
    }
  })
  it('a bare quantifier with a diagonal / anchor-relative exclusion (#2522 / #2532 readers) is identified too', () => {
    const b = BOARDS[1]                                                          // SPY QQQ / NVDA AMD
    expect(unnamed(b, opsOn(['c0', 'c1', 'c2']), 'make all weekly except the one diagonal from SPY')).toBeNull()
    expect(unnamed(b, opsOn(['c0', 'c2', 'c3']), 'set all to weekly, but leave the chart catty-corner to NVDA alone')).toBeNull()
    expect(unnamed(b, opsOn(['c0', 'c1', 'c3']), 'set each to 1h except the one below SPY')).toBeNull()
  })
  it('with a chart clicked, a bare "all" still covers it (an unscoped quantifier covers the click): the set is every chart less X', () => {
    const b = boardOf(2, 2)
    b.select('c1')
    expect(unnamed(b, opsOn(['c0', 'c1', 'c2']), 'set all to weekly but leave AMD alone')).toBeNull()
    expect(unnamed(b, opsOn(['c0', 'c2']), 'set all to weekly but leave AMD alone')).not.toBeNull()
  })
})

describe('(2) fail-safe: an exclusion that does not place one chart forms no set; still screened; candidates never offered', () => {
  const DUP = boardOf(2, 2, ['SPY', 'QQQ', 'NVDA', 'SPY'])                       // SPY on two charts
  const ROW = boardOf(1, 3, ['SPY', 'QQQ', 'NVDA'])
  const CASES = []
  for (const [qn, q] of Object.entries(QUANTS)) {
    if (!q.bare) continue
    for (const [fn, form] of Object.entries(FORMS)) {
      CASES.push([qn, fn, 'two SPY charts', `${q.says[0]}${form('SPY')}`, DUP, ['c0', 'c3']])
      CASES.push([qn, fn, 'two neighbours', `${q.says[0]}${form('the one next to QQQ')}`, ROW, ['c0', 'c2']])
    }
    CASES.push([qn, 'but leave X alone', 'not on the board (possessive)', `${q.says[0]} but leave Apple's chart alone`, BOARDS[1], []])
    CASES.push([qn, 'except X', 'unreadable', `${q.says[0]} except the one next to the big chart`, BOARDS[1], []])
  }
  it.each(CASES)('%s · %s · %s: "%s"', (_q, _f, _k, t, b, never) => {
    const all = b.cells.map(c => c.ref)
    expect(everyExceptSet(t, b.live(), null, { rest: true })).toBeNull()
    // some gate stops it: a target screen (proposed / asked) or the spatial constraint check (asked) — as before the fix
    const stopped = (ops) => unnamed(b, ops, t) || checkSpatialConstraints({ ...deps(b), ops, text: t })?.ask || null
    for (const subset of [all, all.filter(r => !never.includes(r))]) {
      if (!subset.length || symNamed(b, t, subset)) continue
      expect(stopped(opsOn(subset)), t).not.toBeNull()
    }
    const ask = checkSpatialConstraints({ ...deps(b), ops: opsOn(all), text: t })
    if (never.length) {
      expect(ask?.ask, t).toBeTruthy()
      for (const r of never) expect(ask.ask.choices.map(c => c.ref)).not.toContain(r)
    }
  })
  it('a ticker the board does not show excludes nothing: a bare "all" still forms no set (proposed as before)', () => {
    const b = BOARDS[1]
    const t = 'set all to weekly but leave TSLA alone'
    expect(everyExceptSet(t, b.live(), null)).toBeNull()
    expect(unnamed(b, opsOn(['c0', 'c1', 'c2', 'c3']), t)?.propose).toBe(true)
  })
})

describe('(3) other meanings of "all" keep their reading', () => {
  const b = BOARDS[1]
  const all = ['c0', 'c1', 'c2', 'c3']
  const NOT_CHARTS = [
    'remove all indicators but leave RSI', 'remove all but RSI', 'remove all but the RSI one', 'hide all except volume',
    'delete all drawings except the trendline', 'delete all drawings except the one on AMD', 'turn off all except the EMA',
    'show all except the 200', 'remove all the lines but keep the one on SPY', 'hide each except the 50 SMA',
    'clear the lot except the alerts', 'remove every one of the indicators except MACD', 'remove all studies apart from VWAP',
    'hide all of the moving averages but not the 200', 'remove each indicator except RSI', 'delete all alerts, keep the price one as is',
  ]
  it.each(NOT_CHARTS)('"%s": no chart set; the screen verdict is unchanged', (t) => {
    expect(everyExceptSet(t, b.live(), null, { rest: true })).toBeNull()
    expect(excl(b, t)).toEqual(excl(b, t.replace(/\b(?:all|each|every one|the lot)\b/i, 'zq')))
    for (const ops of [opsOn(all), opsOn(['c0', 'c1', 'c2']), opsOn(['c0', 'c1'])]) {
      // the verdict with the quantifier replaced by a neutral word is the verdict with it: the quantifier adds nothing here
      expect(unnamed(b, ops, t)).toEqual(unnamed(b, ops, t.replace(/\b(?:all|each|every one|the lot)\b/i, 'zq')))
    }
  })
  it.each([
    ['at all'], ['after all'], ['above all'], ['all in all'], ["that's all"], ['all set'], ['all good'], ['all done'], ['once and for all'],
    ['all indicators'], ['all the lines'], ['each other'], ['every one of the drawings'], ['all-time high'], ['the lot of them'], ['not all'],
  ])('"%s" is no bare chart quantifier', (w) => {
    expect(bareQuantifier(`${w} weekly`)).toBeNull()
    expect(bareQuantifier(`${w}.`)).toBeNull()
  })
  it.each([
    ["don't change AMD at all, set QQQ to weekly"], ['after all, set QQQ to weekly but leave AMD alone'],
    ["that's all, leave AMD alone"], ['set QQQ to weekly, not at all AMD'],
  ])('idiom "%s": no set', (t) => {
    expect(everyExceptSet(t, b.live(), null)).toBeNull()
  })
  it.each([
    ['set all to weekly'], ['set each to weekly'], ['set the lot to weekly'],
  ])('no exclusion: "%s" forms no set (a bare "all" alone is screened as before)', (t) => {
    expect(everyExceptSet(t, b.live(), null, { rest: true })).toBeNull()
    expect(unnamed(b, opsOn(all), t)?.propose).toBe(true)
  })
})

describe('(4) "the rest" is read only with no click and no earlier-turn chart', () => {
  it('no click, no subject: the rest less X is the set', () => {
    const b = boardOf(2, 2)
    expect(unnamed(b, opsOn(['c0', 'c1', 'c2']), 'set the rest to weekly but leave AMD alone')).toBeNull()
  })
  it('an earlier-turn chart: "the rest" may be the rest of it — unchanged (proposed)', () => {
    const b = boardOf(2, 2)
    expect(unnamed(b, opsOn(['c0', 'c1', 'c2']), 'set the rest to weekly but leave AMD alone', 'c0')).not.toBeNull()
  })
  it('a click: unchanged', () => {
    const b = boardOf(2, 2)
    b.select('c0')
    expect(everyExceptSet('set the rest to weekly but leave AMD alone', b.live(), 'c0')).toBeNull()
  })
  it('the bare "all" with an earlier-turn chart is still every chart (only "the rest" depends on it)', () => {
    const b = boardOf(2, 2)
    expect(unnamed(b, opsOn(['c0', 'c1', 'c2']), 'set all to weekly but leave AMD alone', 'c0')).toBeNull()
  })
})

// ── (5) every chart-backed mutation family on the 2×2 (SPY QQQ / NVDA AMD) ──
const FB = BOARDS[1]
const IDS = ['c0', 'c1', 'c2', 'c3']
const FAMILIES = allCapabilityNames().map(name => {
  const c = getCapability(name)
  if (!c || c.query) return null
  const kind = getTargetKind(c.target)
  if (!kind) return null
  let list = []
  try { list = kind.list(FB.host) || [] } catch { return null }
  const byChart = Object.fromEntries(IDS.map(id => [id, list.find(s => chartRefOf(kind, s) === id)]))
  return IDS.every(id => byChart[id]) ? { name, kind, byChart } : null
}).filter(Boolean)
const famOps = (f, ids) => ids.map(id => ({ action: f.name, target: f.byChart[id].ref, args: {} }))
const toChart = (f, ref) => chartRefOf(f.kind, f.kind.list(FB.host).find(s => s.ref === ref))
const WORDS = [
  ['do it on all but leave AMD alone', 'c3'],
  ['do it on each, except the top-left one', 'c0'],
  ['do it on the lot apart from chart 2', 'c1'],
  ['do it on every one, skip NVDA', 'c2'],
  ['do it on all, keep the QQQ chart as is', 'c1'],
  ['do it on the rest, not the bottom-right one', 'c3'],
]
describe('(5) every mutation family the targeting layer serves (registry-enumerated)', () => {
  it('the registry yields the chart-backed families', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(20)
    for (const n of ['indicator.add', 'chart.setTimeframe']) expect(FAMILIES.map(f => f.name)).toContain(n)
  })
  it.each(FAMILIES.flatMap(f => WORDS.map(([t, ex]) => [f.name, ex, t, f])))('%s, %s excluded — "%s": honoured exactly; never acted on', (_n, ex, t, f) => {
    const rest = IDS.filter(id => id !== ex)
    const d = deps(FB)
    expect(screenDeicticOps({ ...d, ops: famOps(f, rest), text: t })).toBeNull()
    expect(screenUnnamedTargets({ ...d, ops: famOps(f, rest), text: t })).toBeNull()
    expect(checkSpatialConstraints({ ...d, ops: famOps(f, rest), text: t })).toBeNull()
    const g = withoutExcludedCharts(famOps(f, IDS), [t], d)
    expect(g.dropped).toBe(1)
    expect(g.ops.map(o => toChart(f, o.target)).sort()).toEqual(rest)
    const ask = checkSpatialConstraints({ ...d, ops: famOps(f, IDS), text: t })
    expect(ask?.ask).toBeTruthy()
    expect(ask.ask.choices.map(c => toChart(f, c.ref))).not.toContain(ex)
  })
  it.each(FAMILIES.map(f => [f.name, f]))('%s — ambiguous "do it on all but leave SPY alone" with SPY on two charts: still screened', (_n, f) => {
    const b = boardOf(2, 2, ['SPY', 'QQQ', 'NVDA', 'SPY'])
    const list = f.kind.list(b.host) || []
    const ops = ['c1', 'c2'].map(id => ({ action: f.name, target: list.find(s => chartRefOf(f.kind, s) === id)?.ref, args: {} }))
    if (ops.some(o => !o.target)) return
    expect(unnamed(b, ops, 'do it on all but leave SPY alone')).not.toBeNull()
  })
})
