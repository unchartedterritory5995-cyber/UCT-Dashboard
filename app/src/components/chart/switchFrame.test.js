// ⭐⭐ buildFrame (imperative switch, stage 2): every array of the frame is the array the chart's memo holds.
//
//   • PREPARED (the neighbour-frames preparer ran for the row): the frame is all lookups. Each array IS the one
//     the preparer filed, which is the one the memo will be handed: identity, and not one recompute.
//   • COLD (nothing prepared): the same functions compute. Each array deep-equals what the memo's own function
//     returns for those bars (the functions StockChart's memos call with neighbour frames off), and the memo,
//     arriving afterwards, is handed the very arrays the frame was built from.
//
// The memo's expression for each array is spelled out below (`memoOf`), beside the line of StockChart.jsx it is.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const snaps = new Map()
const fakeStore = {
  registry: { has: (k) => snaps.has(k) },
  getBaseSnapshot: (k) => snaps.get(k) ?? null,
}
vi.mock('../../data/barStore/index', () => ({ getBarStore: () => fakeStore }))
vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))

const { buildFrame, NO_FRAME } = await import('./switchFrame')
const { prepareRow, deriveSession, deriveDisplay, deriveOhlcBase, deriveClose, deriveVol, deriveVolMa, deriveVolExtremes, deriveHvc, EMPTY_HVC } = await import('./useNeighborFrames')
const { sessionBarsOf, ohlcBaseOf, closeDataOf, volDataOf, volMaDataOf, computeHVC } = await import('./chartDerived')
const { toHeikinAshi } = await import('./indicators')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const { legacyBars } = await import('../../data/barStore/adapter')
const nf = await import('./neighborFrames')
const { toChartTime } = await import('./barTime')

const adjustTime = (t) => (typeof t === 'number' ? toChartTime(t) : t)
/** The chart's recipes, as StockChart builds `_nfRecipes` (one object per render; the same shape, the same sigs). */
const recipesFor = ({ tf = 'D', heikinAshi = false, hvcOn = true, volMaPeriod = 20, blankVolume = false } = {}) => {
  const intraday = /^\d+$/.test(tf)
  const at = nf.identitySig(adjustTime)
  const sessionP = { intradayLike: intraday, isIntraday: intraday, showExtended: false, tf }
  const closeP = { plain: true, mode: 'netchange', up: '#0f0', down: '#f00' }
  const volP = { blank: blankVolume, upC: '#1a1', downC: '#a11', netChange: true, dwm: !intraday, liveVol: NaN, bold: false }
  return {
    adjustTime,
    session: { p: sessionP, sig: nf.stableSig(sessionP) },
    heikinAshi, hvcOn,
    ohlc: { sunrise: false, sig: `plain|at${at}` },
    close: { p: closeP, sig: `${nf.stableSig(closeP)}|at${at}` },
    vol: { on: true, p: volP, sig: `${nf.stableSig(volP)}|at${at}` },
    volMa: { on: !blankVolume && volMaPeriod >= 2, period: volMaPeriod, sig: `p${nf.stableSig(volMaPeriod)}|at${at}` },
    plain: true,
  }
}
const daily = (n, k = 1) => Array.from({ length: n }, (_, i) => {
  const t = Math.floor(Date.UTC(2015, 0, 1) / 1000) + i * 86400
  const c = 50 * k + Math.sin(i / 9) * 5 * k
  return { t, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1e5 + ((i * 31 * k) % 999) }
})
/** 60-minute bars of Mon 2026-11-09 … Fri 2026-11-13 (EST): two pre-market bars, then the regular session. */
const hourly = (k = 1) => {
  const out = []
  let i = 0
  for (const day of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
    for (const hhmm of ['12:30', '13:30', '14:30', '15:30', '16:30', '17:30', '18:30', '19:30', '20:30']) {
      const c = 80 * k + Math.sin(i / 5) * 2 * k
      out.push({ t: Date.parse(`${day}T${hhmm}:00Z`) / 1000, o: c - 0.1, h: c + 0.5, l: c - 0.6, c, v: 5000 + ((i * 17 * k) % 400) })
      i++
    }
  }
  return out
}
const snapOf = (sym, tf, bars, extra = {}) => Object.freeze({
  key: chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false }),
  sym, tf, bars, developing: null, baseRev: 1, status: 'current', restSeen: true, ...extra,
})

/** What each of StockChart's memos returns for these bars on the plain path, neighbour frames ON: the memo's own
 *  expression, in the memo's own order (StockChart.jsx: sessionBars, displayBars, ohlcData's base, closeData,
 *  hvcSet, volData, volMaData). */
const memoOf = (bars, r) => {
  const sessionBars = deriveSession(bars, { session: r.session })
  const displayBars = deriveDisplay(sessionBars, { heikinAshi: r.heikinAshi })
  return {
    sessionBars,
    displayBars,
    ohlcBase: deriveOhlcBase(displayBars, r),
    closeData: deriveClose(displayBars, r),
    hvcSet: deriveHvc(sessionBars, { hvcOn: r.hvcOn }),
    volData: deriveVol(sessionBars, deriveHvc(sessionBars, { hvcOn: r.hvcOn }), null, r),
    volMaData: r.volMa.on ? deriveVolMa(sessionBars, r) : [],
  }
}
/** …and with neighbour frames OFF: the plain functions the same memos call. */
const legacyMemoOf = (bars, r) => {
  const sessionBars = sessionBarsOf(bars, r.session.p)
  const displayBars = r.heikinAshi ? toHeikinAshi(sessionBars) : sessionBars
  const hvcSet = r.hvcOn && sessionBars.length > 20 ? computeHVC(sessionBars) : new Set()
  return {
    sessionBars,
    displayBars,
    ohlcBase: ohlcBaseOf(displayBars, r.ohlc.sunrise, r.adjustTime),
    closeData: closeDataOf(displayBars, r.close.p, r.adjustTime),
    hvcSet,
    volData: volDataOf(sessionBars, r.vol.p, hvcSet, null, r.adjustTime),
    volMaData: r.volMa.on ? volMaDataOf(sessionBars, r.volMa.period, r.adjustTime) : [],
  }
}
const ARRAYS = ['sessionBars', 'displayBars', 'ohlcBase', 'closeData', 'hvcSet', 'volData', 'volMaData']

const CASES = [
  { name: 'daily', tf: 'D', bars: () => daily(300), opts: {}, derivations: 6 },
  { name: 'daily, Heikin-Ashi', tf: 'D', bars: () => daily(300, 2), opts: { heikinAshi: true }, derivations: 7 },
  { name: '60-minute (regular session)', tf: '60', bars: () => hourly(), opts: {}, derivations: 6 },
]

beforeEach(() => {
  nf.__setNeighborFramesForTests(true)
  nf.__resetNeighborFramesStatsForTests()
  nf.__resetDerivedForTests()
  snaps.clear()
})
afterEach(() => nf.__setNeighborFramesForTests(null))
const drain = (g) => { for (const _ of g) { /* each idle piece */ } }
const hits = () => nf.neighborFramesStats().derivedHit

describe.each(CASES)('buildFrame: $name', ({ tf, bars, opts, derivations }) => {
  const R = recipesFor({ tf, ...opts })
  const view = { sym: 'BBB', tf, showExtended: false }

  it('the fixture is a real one (the session filter and the HVC set have something to do)', () => {
    const s = snapOf('BBB', tf, bars())
    const f = buildFrame(s, view, R)
    expect(f.ok).toBe(true)
    expect(f.sessionBars.length).toBeGreaterThan(20)
    if (tf === '60') expect(f.sessionBars.length).toBeLessThan(f.bars.length)   // the pre-market bars were dropped
    expect(f.ohlcBase.length).toBe(f.displayBars.length)
    expect(f.volData.length).toBe(f.sessionBars.length)
    expect(f.volMaData.length).toBeGreaterThan(0)
  })

  it('PREPARED: every array is the one the preparer filed (identity), and nothing is computed again', () => {
    const s = snapOf('BBB', tf, bars())
    snaps.set(s.key, s)
    const binder = { prepare: function* () { yield } }
    drain(prepareRow('BBB', 0, { recipes: () => R, view: () => ({ tf, showExtended: false }), engineRef: { current: { binder } } }))
    expect(nf.neighborFramesStats().barsPrepared).toBe(1)
    const before = hits()
    const f = buildFrame(s, view, R)
    expect(f.ok).toBe(true)
    // one lookup per derivation, each a hit: session, (heikinAshi), ohlcBase, close, hvc, vol, volMa
    expect(hits() - before).toBe(derivations)
    // …and they are the arrays the chart's memos are handed
    const memo = memoOf(legacyBars(s), R)
    for (const k of ARRAYS) expect(f[k], k).toBe(memo[k])
    expect(f.filteredBars).toBe(f.sessionBars)
    expect(f.sessionAppliedBars).toBe(f.sessionBars)
    expect(f.bars).toBe(legacyBars(s))
  })

  it('COLD: every array deep-equals what the memo\'s own function returns, and the memo then holds the same arrays', () => {
    const s = snapOf('BBB', tf, bars())
    const before = hits()
    const f = buildFrame(s, view, R)
    expect(f.ok).toBe(true)
    // nothing was prepared, so no lookup can hit: every array here was computed
    expect(hits() - before).toBe(0)
    // the memo's own functions, over an equal but separate copy of the bars (nothing of it is filed)
    const want = legacyMemoOf(legacyBars(snapOf('BBB', tf, bars())), R)
    for (const k of ARRAYS) {
      if (k === 'hvcSet') expect([...f.hvcSet].sort(), k).toEqual([...want.hvcSet].sort())
      else expect(f[k], k).toEqual(want[k])
    }
    // the render of that symbol, arriving after the switch painted it: the memos find what the frame filed
    const memo = memoOf(legacyBars(s), R)
    for (const k of ARRAYS) expect(memo[k], k).toBe(f[k])
  })
})

describe('buildFrame: the fields beside the arrays', () => {
  const R = recipesFor({ tf: 'D' })
  it('carries whose frame it is, and whether the newest bar is forming', () => {
    const rows = daily(60)
    const s = snapOf('BBB', 'D', rows, { newestForming: { t: rows[rows.length - 1].t, forming: true } })
    const f = buildFrame(s, { sym: 'BBB', tf: 'D' }, R)
    expect([f.sym, f.tf, f.newestBarIsForming]).toEqual(['BBB', 'D', true])
  })
  it('no HVC marking: the one shared empty set; no volume average: an empty array', () => {
    const s = snapOf('BBB', 'D', daily(60))
    const f = buildFrame(s, { sym: 'BBB', tf: 'D' }, recipesFor({ tf: 'D', hvcOn: false, volMaPeriod: 0 }))
    expect(f.hvcSet).toBe(EMPTY_HVC)
    expect(f.volMaData).toEqual([])
  })
})

describe('buildFrame: what it will not build, each by name (the caller takes the React path)', () => {
  const R = recipesFor({ tf: 'D' })
  const view = { sym: 'BBB', tf: 'D' }
  const good = () => snapOf('BBB', 'D', daily(60))
  it.each([
    ['no recipes (neighbour frames off)', () => buildFrame(good(), view, null), NO_FRAME.RECIPES],
    ['recipes still being filled (no volume recipe yet)', () => buildFrame(good(), view, { ...R, vol: null }), NO_FRAME.RECIPES],
    ['off the plain path', () => buildFrame(good(), view, { ...R, plain: false }), NO_FRAME.NOT_PLAIN],
    ['no snapshot', () => buildFrame(null, view, R), NO_FRAME.SNAPSHOT],
    ['a provisional snapshot', () => buildFrame(snapOf('BBB', 'D', daily(60), { status: 'provisional' }), view, R), NO_FRAME.STATUS],
    ['an unavailable symbol', () => buildFrame(snapOf('BBB', 'D', [], { status: 'unavailable' }), view, R), NO_FRAME.STATUS],
    ['no bars', () => buildFrame(snapOf('BBB', 'D', []), view, R), NO_FRAME.EMPTY],
  ])('%s', (_name, run, why) => {
    const before = hits()
    expect(run()).toEqual({ ok: false, why })
    expect(hits() - before).toBe(0)
  })
  it('a chart that marks its volume extremes (every /charts pane) IS built: the highest-volume bar is marked, by the chart\'s own rule', () => {
    // (the browser A/B's next refusal after `session-tags`: the pane passes `markVolumeExtremes`, and the
    // builder refused every such chart as `volume`)
    const rows = daily(60)
    rows[41] = { ...rows[41], v: 9e9 }
    const marked = { ...R, vol: { ...R.vol, on: false } }
    const f = buildFrame(snapOf('BBB', 'D', rows), view, marked)
    expect(f.ok).toBe(true)
    const vx = deriveVolExtremes(f.sessionBars, null, null)
    expect([...vx.goldTimes]).toEqual([f.sessionBars[41].t])
    // the very array the chart's own memo is handed for these bars and these marks (one derivation, one answer)
    expect(f.volData).toBe(deriveVol(f.sessionBars, f.hvcSet, vx, marked))
    // ...and it is not the unmarked one: bar 41 differs, and only bar 41
    const plain = deriveVol(f.sessionBars, f.hvcSet, null, marked)
    const diff = f.volData.map((d, i) => (JSON.stringify(d) === JSON.stringify(plain[i]) ? -1 : i)).filter((i) => i >= 0)
    expect(diff).toEqual([41])
  })
  it('a refusal derives nothing (it files no array for a frame it did not build)', () => {
    const s = snapOf('BBB', 'D', daily(60))
    buildFrame(s, view, { ...R, plain: false })
    expect(nf.hasDerived(legacyBars(s), 'session', R.session.sig)).toBe(false)
  })
})

describe('switchFrame.js: pure, and in the chart chunk', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  /** Source with its comments removed (a name inside one is not code). */
  const noComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
  /** …and with the contents of its strings removed too: what is left is code. */
  const codeOf = (src) => noComments(src)
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""')
  // the module names are strings, so the imports are read before the strings go
  const importsOf = (src) => [...noComments(src).matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort()
  const SRC = readFileSync(join(HERE, 'switchFrame.js'), 'utf8')

  it('imports the adapter, the status names and the shared derive functions, and nothing else', () => {
    expect(importsOf(SRC)).toEqual(['../../data/barStore/adapter', '../../data/barStore/types', './useNeighborFrames'])
  })
  it('never reaches the store, a chart, a timer or the clock', () => {
    const code = codeOf(SRC)
    for (const word of ['getBarStore', 'Date.now', 'setTimeout', 'requestAnimationFrame', 'fetch(', 'localStorage', 'window.']) expect(code.includes(word), word).toBe(false)
  })
  it('self-check: the same word inside a comment or a string is not a match, and in code it is', () => {
    expect(codeOf("const s = 'getBarStore'\nconst t = \"Date.now\"\n")).not.toMatch(/getBarStore|Date\.now/)
    expect(importsOf("// import x from './nope'\n/* import y from './nor-this' */\nimport z from './yes'\n")).toEqual(['./yes'])
    expect(codeOf("// getBarStore()\nconst a = 1 /* Date.now */\n").includes('getBarStore')).toBe(false)
    expect(codeOf('const u = "http://x"\ngetBarStore()\n').includes('getBarStore')).toBe(true)
  })
})
