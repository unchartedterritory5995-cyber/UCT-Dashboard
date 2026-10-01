// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c41LowerTfServe.test.js
//
// ─── ⭐⭐ C41 — A TIMEFRAME BELOW THE CHART'S OWN, SERVED AND GRADED ─────────────
//
// C27 built the mechanism (`engine/lowerTf.js`) and served nothing: which intrabar
// TradingView answers, over which session, was documentation. The 2026-09-30
// evening captures settle both, and this file is the grade — TradingView's own
// answer to `vw-lower-tf.pine` on three charts, against OUR door fed TradingView's
// own intraday bars (committed captures only):
//
//   vw-lower-tf-spy-1d-2026-09-30    AMEX:SPY 1D, 4,800 bars — intraday supply
//                                    `vw-bool-cast-spy-60-2026-09-28` (60m, 2015 →)
//   vw-lower-tf-rddt-1d-2026-09-30   NYSE:RDDT 1D, 634 bars from the listing —
//                                    `vw-bar-counters-rddt-{15,5}-2026-09-30`
//   vw-lower-tf-spy-1w-2026-09-30    AMEX:SPY 1W, 1,758 bars
//
// Each served row of the probe is written as its own plot and run THROUGH THE
// MEMBER DOOR (`runOurSide`: translate → install → `computeFor` → the real binder),
// then compared with the vendor's column bar for bar. A bar our supply does not
// cover whole is WITHHELD (not a number) — never compared as a value, and never a
// number where TradingView reads `na`.
//
// And the target C27 named: ema-ribbon's 15m / 1H / 4H rows and its bias cells,
// on the graded capture itself.
//
// ⚠️ WHAT THIS PROVES AND WHAT IT DOES NOT. The RULE is proved on the VENDOR's
// intraday bars. In the product the bars come from OUR store (`/api/bars?tf=15`),
// which is not TradingView's: a live value is TradingView's only where the two
// agree for that symbol and day (`lowerTf.js` header).

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide, enterMemberDoor, HARNESS_DEF_ID, toProductBars } from './ourSide'
import { LOWER_TF_REFUSAL as R } from '../../lowerTf.js'
import { translatePine } from '../../ast/pine.js'
import * as registry from '../../nativeRegistry'
import { computeObjectColumns, objectReaderFor } from '../../objectColumns'
import { buildGraph } from '../../ast/graph.js'

const REPO = path.resolve(process.cwd(), '..')
const H = path.join(REPO, 'tests/fixtures/vendor/harness')
const load = (n) => JSON.parse(fs.readFileSync(path.join(H, n), 'utf8'))
const pine = (lines) => ['//@version=6', 'indicator("c41")', ...lines].join('\n')
const on = (cap, lines) => runOurSide({ ...cap, source: { ...cap.source, text: pine(lines) } })

// the objects-only pane door as production runs it (armed 2026-09-27)
beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })
// ⭐ …and the gate on serving itself (`lowerTfGate.js`, default OFF): this file is
// the grade of the SERVED read. The flag-off behaviour is the last block.
vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')
/** Run `fn` with the gate OFF (the default every build ships with), then put it back. */
const gateOff = (fn) => {
  vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '')
  try { return fn() } finally { vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1') }
}
// the first run builds the harness's capture index (every committed capture)
vi.setConfig({ testTimeout: 300000 })

const SPY_1D = load('vw-lower-tf-spy-1d-2026-09-30.json')
const SPY_1W = load('vw-lower-tf-spy-1w-2026-09-30.json')
const RDDT_1D = load('vw-lower-tf-rddt-1d-2026-09-30.json')

/** The vendor's column for the probe row whose title starts with `row`. */
function vendorRow(cap, row) {
  const p = cap.study.plots.find((x) => String(x.title).startsWith(row))
  const k = cap.plotValues.fields.indexOf(p.id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[k]]))
  return cap.bars.rows.map((b) => byTime.get(b[0]))
}

/** Compare our column with the vendor's: every bar we publish must be the
 *  vendor's number; a bar we withhold is counted, never compared. */
function grade(ours, vendor, { relTol = 0, from = 0 } = {}) {
  const out = { compared: 0, withheld: 0, wrong: [], numberWhereVendorNa: 0 }
  for (let i = from; i < vendor.length; i++) {
    const o = ours[i]
    const v = vendor[i]
    if (!Number.isFinite(o)) { out.withheld += 1; continue }
    if (v === null || v === undefined) { out.numberWhereVendorNa += 1; continue }
    out.compared += 1
    if (Math.abs(o - v) > relTol * Math.max(1, Math.abs(v))) out.wrong.push({ i, ours: o, vendor: v })
  }
  return out
}

/** The served rows of `vw-lower-tf.pine`, one plot each, in the probe's spelling. */
const SERVED_ROWS = [
  'plot(request.security(syminfo.tickerid, "60", close), "L02")',
  'plot(request.security(syminfo.tickerid, "60", time) / 1000.0, "L03")',
  'plot(request.security(syminfo.tickerid, "60", ta.ema(close, 9)), "L04")',
  'plot(request.security(syminfo.tickerid, "15", close), "L05")',
  'plot(request.security(syminfo.tickerid, "5", close), "L06")',
  'plot(request.security(syminfo.tickerid, "240", time) / 1000.0, "L15")',
  'plot(request.security(syminfo.tickerid, "240", close), "L16")',
]
const columnOf = (run, title) => Array.from(run.plots.find((p) => p.title === title).column)
const firstIndexOn = (cap, iso) => toProductBars(cap).findIndex((b) => String(b.t) >= iso)

describe('C41 — AMEX:SPY 1D: the probe\'s served rows against TradingView\'s own answers', () => {
  let run
  beforeAll(() => { run = on(SPY_1D, SERVED_ROWS) }, 300000)

  it('the door serves them from committed captures of SPY\'s own intraday bars, and says which', () => {
    expect(run.ok).toBe(true)
    expect(run.notes).toContain('lower timeframe 60: served')
    expect(run.notes).toContain('lower timeframe 240: served')
    expect(run.notes.some((n) => /^lower timeframe 60: built from the committed 60-minute capture\(s\) .*vw-bool-cast-spy-60-2026-09-28\.json/.test(n))).toBe(true)
    // ⛔ `ticker.modify` / look-ahead / the array form are not in this script: each
    // refuses the whole probe by name (below), so the served rows are run alone
  })

  it('⭐ (i) L02 — `request.security(own, "60", close)` is the day\'s LAST regular-session 60m close', () => {
    const ours = columnOf(run, 'L02')
    const g = grade(ours, vendorRow(SPY_1D, 'L02'))
    expect(g.wrong).toEqual([])
    expect(g.numberWhereVendorNa).toBe(0)
    // every session the committed 60m capture (2015 →) holds whole: 2,950 of its 2,951
    // days — the one held short is 2017-11-24, a half-day TradingView's session does
    // not apply (5 of 7 buckets), withheld
    expect(g.compared).toBe(2950)
    // and it is NOT the chart's own close: the daily bar is not the intraday aggregate
    const bars = toProductBars(SPY_1D)
    const differs = ours.filter((v, i) => Number.isFinite(v) && v !== bars[i].c).length
    expect(differs).toBeGreaterThan(2500)
    // ⛔ every bar before the supply (2007 → 2014), and every session it holds short, is
    // WITHHELD — TradingView has a number there (its 60m history is deeper than ours)
    expect(g.withheld).toBe(4800 - 2950)
    expect(ours.slice(0, 1800).every((v) => Number.isNaN(v))).toBe(true)
    // ⭐ the real binder drew a point on exactly the bars that are known
    const drawn = (run.plots.find((p) => p.title === 'L02').colors || []).filter((c) => typeof c === 'string').length
    expect(drawn).toBe(g.compared)
  })

  it('⭐ (ii) L03 — its `time` is that bar\'s open: 15:30 ET, 12:30 on a 13:00 half-day — the REGULAR session', () => {
    const ours = columnOf(run, 'L03')
    const g = grade(ours, vendorRow(SPY_1D, 'L03'))
    expect(g.wrong).toEqual([])
    expect(g.compared).toBe(2950)
    const minutes = new Map()
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
    for (const t of ours) {
      if (!Number.isFinite(t)) continue
      const k = fmt.format(new Date(t * 1000))
      minutes.set(k, (minutes.get(k) || 0) + 1)
    }
    // never 19:00 (an extended session's last bar), never the clock hour
    expect([...minutes.keys()].sort()).toEqual(['12:30', '15:30'])
    expect(minutes.get('12:30')).toBeGreaterThan(5)
  })

  it('⭐ L04 — the child runs on the intraday series: Pine\'s EMA(9) over the 60m closes, at the day\'s last bar', () => {
    const ours = columnOf(run, 'L04')
    // TradingView's own 60m series starts in 2007; the committed supply in 2015. An EMA
    // carries its start, so the first sessions of OUR series are a different (converging)
    // number: graded from 2016-06-01, ~2,500 intrabars in
    const from = firstIndexOn(SPY_1D, '2016-06-01')
    const g = grade(ours, vendorRow(SPY_1D, 'L04'), { relTol: 1e-9, from })
    expect(g.wrong).toEqual([])
    expect(g.compared).toBeGreaterThan(2500)
    // control: it is not a DAILY EMA(9) read through
    const daily = columnOf(on(SPY_1D, ['plot(ta.ema(close, 9), "D")']), 'D')
    const same = ours.filter((v, i) => i >= from && Number.isFinite(v) && Math.abs(v - daily[i]) < 1e-9).length
    expect(same).toBe(0)
  })

  it('⭐ L15 / L16 — `"240"` buckets at 09:30 and 13:30; the read is the day\'s last 240m bar', () => {
    const t = grade(columnOf(run, 'L15'), vendorRow(SPY_1D, 'L15'))
    const c = grade(columnOf(run, 'L16'), vendorRow(SPY_1D, 'L16'))
    expect(t.wrong).toEqual([])
    expect(c.wrong).toEqual([])
    expect(t.compared).toBe(2950)
    expect(c.compared).toBe(2950)
  })

  it('⛔ L05 / L06 — where the committed captures hold no 15m / 5m history, the read is WITHHELD', () => {
    // SPY's only committed sub-hour capture is two sessions of 5m bars (2026-09-24/25):
    // the one complete session grades; everything else is unknown, never a number
    for (const row of ['L05', 'L06']) {
      const g = grade(columnOf(run, row), vendorRow(SPY_1D, row))
      expect(g.wrong, row).toEqual([])
      expect(g.numberWhereVendorNa, row).toBe(0)
      expect(g.compared, row).toBe(1)
      expect(g.withheld, row).toBe(4799)
    }
    // ⛔ and where TradingView itself reads `na` (before ITS intraday depth: 15m from
    // 2011-06-06, 5m from 2021-08-16) we never publish a number
    const na15 = vendorRow(SPY_1D, 'L05').filter((v) => v === null).length
    expect(na15).toBe(4800 - 3853)
  })
})

describe('C41 — NYSE:RDDT 1D: the same rows on ema-ribbon\'s own symbol, from its 15m and 5m bars', () => {
  let run
  beforeAll(() => { run = on(RDDT_1D, SERVED_ROWS) }, 300000)

  it('60 and 240 are BUILT from the 15-minute bars (as the product builds them), and graded', () => {
    for (const code of ['15', '60', '240']) {
      expect(run.notes.some((n) => n.startsWith(`lower timeframe ${code}: built from the committed 15-minute capture(s) vw-bar-counters-rddt-15-2026-09-30.json`)), code).toBe(true)
      expect(run.notes).toContain(`lower timeframe ${code}: served`)
    }
    for (const row of ['L02', 'L03', 'L05', 'L15', 'L16']) {
      const g = grade(columnOf(run, row), vendorRow(RDDT_1D, row))
      expect(g.wrong, row).toEqual([])
      expect(g.numberWhereVendorNa, row).toBe(0)
      // every session but the listing day (trading began 13:15: its first buckets
      // do not exist, so that session is not whole in the supply — withheld)
      expect(g.compared, row).toBe(633)
      expect(g.withheld, row).toBe(1)
    }
  })

  it('L04 — the EMA over the 60m closes, once our series (one bucket shorter at the listing) has converged', () => {
    const from = firstIndexOn(RDDT_1D, '2024-06-03')
    const g = grade(columnOf(run, 'L04'), vendorRow(RDDT_1D, 'L04'), { relTol: 1e-9, from })
    expect(g.wrong).toEqual([])
    expect(g.compared).toBeGreaterThan(550)
  })

  it('L06 — `"5"`: graded on the sessions the 5m capture holds (2025-09-22 →), withheld before', () => {
    const g = grade(columnOf(run, 'L06'), vendorRow(RDDT_1D, 'L06'))
    expect(g.wrong).toEqual([])
    expect(g.compared).toBe(258)
    expect(g.withheld).toBe(634 - 258)
  })

  it('⭐ the OBJECT lane reads it too: a last-bar label prints the last 60m close', () => {
    const labelled = on(RDDT_1D, [
      'x = request.security(syminfo.tickerid, "60", close)',
      'if barstate.islast',
      '    label.new(bar_index, high, str.tostring(x))',
    ])
    const v = vendorRow(RDDT_1D, 'L02')
    expect(labelled.objects.counts.labels).toBe(1)
    expect(labelled.objects.texts.labels).toEqual([String(v[v.length - 1])])
  })
})

describe('C41 — AMEX:SPY 1W: the week\'s last intrabar', () => {
  it('⭐ L02 / L03 on a weekly chart are the WEEK\'s last 60m close and its open time', () => {
    const run = on(SPY_1W, SERVED_ROWS.slice(0, 2))
    expect(run.notes).toContain('lower timeframe 60: served')
    for (const row of ['L02', 'L03']) {
      const g = grade(columnOf(run, row), vendorRow(SPY_1W, row))
      expect(g.wrong, row).toEqual([])
      expect(g.numberWhereVendorNa, row).toBe(0)
      // every week whose every session is whole in the committed 60m capture
      expect(g.compared, row).toBeGreaterThan(590)
    }
  })
})

describe('C41 — ema-ribbon (NYSE:RDDT 1D, the graded capture): rows 6–8 and the bias cells', () => {
  const CAP = load('ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json')
  const vendorCells = CAP.objects.records.tableCells
  const at = (row, col) => vendorCells.find((c) => c.row === row && c.col === col).t
  const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())

  it('⭐ the 15m / 1H / 4H rows and the bias row are TradingView\'s, text for text', () => {
    const ours = runOurSide(CAP)
    for (const code of ['15', '60', '240']) expect(ours.notes).toContain(`lower timeframe ${code}: served`)
    const mine = count(ours.objects.texts.tableCells)
    const theirs = count(vendorCells.map((c) => c.t))
    // the vendor's own cells this lane was to move (read off the capture, not typed)
    const moved = [
      at(6, 1), at(6, 2), at(6, 3),   // 15m: trend, spread, grade
      at(7, 1), at(7, 2), at(7, 3),   // 1H
      at(8, 1), at(8, 2), at(8, 3),   // 4H
      at(10, 1), at(10, 2),           // bias label, confluence count
    ]
    expect(moved).toEqual(['▼ BEARISH', '2.63%', 'STRONG', '▼ BEARISH', '3.8%', 'STRONG',
      '▼ BEARISH', '3.88%', 'STRONG', '▼▼  STRONG BEAR', '0B  5S  /  5'])
    for (const text of new Set(moved)) expect(mine.get(text), text).toBe(theirs.get(text))
    // ⚰️ this read 47: the strength bar (a `for` loop in a helper) was not ours. Wave 10
    // carries C40's loop ops, so with the lower rows served every cell is drawn: 48 of 48.
    expect(ours.objects.counts.tableCells).toBe(48)
    const onlyVendor = [...theirs].filter(([k, n]) => (mine.get(k) || 0) < n).map(([k]) => k)
    const onlyOurs = [...mine].filter(([k, n]) => (theirs.get(k) || 0) < n).map(([k]) => k)
    // …text for text: nothing TradingView draws is missing, nothing of ours is extra
    expect(onlyVendor).toEqual([])
    expect(onlyOurs).toEqual([])
  })

  it('⛔ control — the same script with NO intraday capture of its symbol: those cells are WITHHELD, never drawn wrong', () => {
    // the capture's symbol renamed to one no committed capture holds
    const orphan = { ...CAP, symbol: { ...CAP.symbol, name: 'ZZZZ', full_name: 'NYSE:ZZZZ', pro_name: 'NYSE:ZZZZ' } }
    const ours = runOurSide(orphan)
    expect(ours.notes.some((n) => n.startsWith('lower timeframe 15: no committed capture of ZZZZ'))).toBe(true)
    expect(ours.notes.some((n) => n.startsWith(`lower timeframe 60: refused (${R.NO_BARS})`))).toBe(true)
    const texts = ours.objects.texts.tableCells
    for (const text of ['2.63%', '3.8%', '3.88%', '▼▼  STRONG BEAR', '0B  5S  /  5']) expect(texts).not.toContain(text)
    expect(texts.some((t) => /NaN/.test(t))).toBe(false)
    // nine MTF cells and the two bias cells are held back: 48 − 11 (36 before wave 10's
    // C40 drew the strength bar)
    expect(ours.objects.counts.tableCells).toBe(37)
  })
})

describe('C41 — what stays refused, by name', () => {
  const HOST = { strict: true }
  const refusal = (line, opts = HOST) => translatePine(pine([line]), opts).refusal

  it('⛔ look-ahead, an explicit session, another symbol, the array form, an unwitnessed code', () => {
    expect(refusal('plot(request.security(syminfo.tickerid, "60", close, lookahead = barmerge.lookahead_on))').message)
      .toContain(R.LOOKAHEAD)
    expect(refusal('plot(request.security(ticker.modify(syminfo.tickerid, session.extended), "60", close))').message)
      .toContain(R.SESSION)
    expect(refusal('plot(request.security(ticker.new(syminfo.prefix, syminfo.ticker, session.regular), "60", close))').message)
      .toContain(R.SESSION)
    expect(refusal('plot(request.security("AMEX:SPY", "60", close))').message).toContain(R.OTHER_SYMBOL)
    expect(refusal('plot(request.security_lower_tf(syminfo.tickerid, "60", close))').message)
      .toContain(R.INTRABAR_ARRAY)
    expect(refusal('plot(request.security(syminfo.tickerid, "30", close))').message).toContain(R.UNWITNESSED)
    expect(refusal('plot(request.security(syminfo.tickerid, "1", close))').message).toContain(R.UNWITNESSED)
  })

  it('⛔ an expression the intraday series cannot answer the way TradingView\'s does', () => {
    expect(refusal('plot(request.security(syminfo.tickerid, "60", bar_index))').message).toContain(R.EXPRESSION)
    expect(refusal('plot(request.security(syminfo.tickerid, "60", ta.cum(volume)))').message).toContain(R.EXPRESSION)
    expect(refusal('plot(request.security(syminfo.tickerid, "60", request.security(syminfo.tickerid, "W", close)))').message)
      .toContain(R.EXPRESSION)
    // control: a windowed function is served
    expect(translatePine(pine(['plot(request.security(syminfo.tickerid, "60", ta.sma(close, 20)))']), HOST).ok).toBe(true)
  })

  it('⛔ an intraday chart, and a screen', () => {
    expect(refusal('plot(request.security(syminfo.tickerid, "15", close))', { strict: true, basePeriod: '60' }).message)
      .toContain(R.INTRADAY_CHART)
    expect(refusal('plot(request.security(syminfo.tickerid, "60", close))', {}).message).toContain(R.SCREEN)
  })

  it('⛔ the whole probe is still refused at the door — its look-ahead row names why', () => {
    let door
    try { door = enterMemberDoor(SPY_1D.source.text) } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
    expect(door.def).toBe(null)
    expect(door.refusal).toContain(R.LOOKAHEAD)
  })

  it('⛔ a chart whose symbol has no intraday bars in hand: not computable, named, an object withheld', () => {
    const aapl = load('syminfo-roster-aapl-1d-2026-09-30.json')
    const run = on(aapl, [
      'x = request.security(syminfo.tickerid, "60", close)',
      'plot(x, "x")',
      'plot(nz(x), "nz")',
      'if barstate.islast',
      '    label.new(bar_index, high, str.tostring(x))',
    ])
    expect(run.notes.some((n) => n.startsWith('lower timeframe 60: no committed capture of AAPL'))).toBe(true)
    expect(run.notes.some((n) => n.startsWith(`lower timeframe 60: refused (${R.NO_BARS})`))).toBe(true)
    expect(columnOf(run, 'x').every((v) => Number.isNaN(v))).toBe(true)
    // ⛔ `nz` never turns the unknown read into 0
    expect(columnOf(run, 'nz').every((v) => Number.isNaN(v))).toBe(true)
    expect(run.objects.counts.labels).toBe(0)
    expect(run.objects.texts.labels).not.toContain('NaN')
  })

  it('⛔ a MONTHLY chart is not witnessed: refused at the bind, the column withheld', () => {
    const monthly = { ...SPY_1D, timeframe: '1M' }
    const run = on(monthly, ['plot(request.security(syminfo.tickerid, "60", close), "x")'])
    expect(run.notes.some((n) => n.startsWith(`lower timeframe 60: refused (${R.UNWITNESSED})`))).toBe(true)
    expect(columnOf(run, 'x').every((v) => Number.isNaN(v))).toBe(true)
  })
})

// ─── ⭐⭐ a read Pine never makes, and a read we could not make ──────────────────
//
// Found by the full chart suite on the first C41 tip (`c10SecurityObjects`):
//
//   1. artemis-oscillator-pro guards each MTF row with a validity that is FALSE on
//      every bar of a daily chart (`timeframe.in_seconds("15") >= chartSec`).
//      Before C41 its 15-minute request REFUSED and C10's rescue took the live arm;
//      once the request resolved to an `ltf` tree the dead arm stayed in the tree,
//      and the structural mask withheld cells TradingView draws (`— n/a`,
//      `◮ MIXED`) — and the chart fetched 15-minute bars nothing reads.
//   2. With the validity made per-bar, the header's condition grew past the node
//      budget, FAILED, read `NaN`, and a `NaN` condition drew the text's last arm
//      (`◮ MIXED`) off a lower-timeframe read nobody made.
describe('C41 — a dead arm that reads below the chart, and a tree that could not be computed', () => {
  const HOST = { strict: true }
  const holdsLtf = (t) => JSON.stringify(t.objects || null).includes('"ltf"')
  const script = (validity, value) => pine([
    validity,
    'o = request.security(syminfo.tickerid, "15", close)',
    value,
    'plot(close)',
    'if barstate.islast',
    '    label.new(bar_index, high, str.tostring(d))',
  ])
  const DEAD = 'v = timeframe.in_seconds("15") >= timeframe.in_seconds()'
  const PER_BAR = 'v = timeframe.in_seconds("15") >= timeframe.in_seconds() or close < 0'
  // the TERNARY's dead arm, and the right side of an `or` the left has decided
  const TERNARY = 'd = v ? o : 7'
  const OR = 'd = (not v or na(o)) ? 7 : 8'

  for (const [name, value] of [['ternary', TERNARY], ['or', OR]]) {
    it(`⭐ ${name}: a test false on every bar answers with its live arm — no \`ltf\` in a tree, nothing stamped to fetch`, () => {
      const t = translatePine(script(DEAD, value), HOST)
      expect(t.ok).toBe(true)
      expect(holdsLtf(t)).toBe(false)
      expect(t.lowerTf).toBeUndefined()
    })

    it(`⛔ control — ${name}: the same script with a PER-BAR validity keeps the read, and stamps its code`, () => {
      const t = translatePine(script(PER_BAR, value), HOST)
      expect(t.ok).toBe(true)
      expect(holdsLtf(t)).toBe(true)
      expect(t.lowerTf).toEqual(['15'])
    })
  }

  it('⭐ through the member door, on a chart with NO intraday bars in hand: the dead read withholds nothing', () => {
    const aapl = load('syminfo-roster-aapl-1d-2026-09-30.json')
    const run = on(aapl, [DEAD, 'o = request.security(syminfo.tickerid, "15", close)', TERNARY,
      'plot(close, "c")', 'if barstate.islast', '    label.new(bar_index, high, str.tostring(d))'])
    expect(run.notes.some((n) => n.startsWith('lower timeframe'))).toBe(false)
    expect(run.objects.counts.labels).toBe(1)
    expect(run.objects.texts.labels).toContain('7')
    // ⛔ control: the per-bar validity on the same chart is withheld, never drawn
    const live = on(aapl, [PER_BAR, 'o = request.security(syminfo.tickerid, "15", close)', TERNARY,
      'plot(close, "c")', 'if barstate.islast', '    label.new(bar_index, high, str.tostring(d))'])
    expect(live.notes.some((n) => n.startsWith('lower timeframe 15'))).toBe(true)
    expect(live.objects.counts.labels).toBe(0)
  })

  // ── a tree that reads below the chart and FAILED is unknown, not `na` ──────
  const bars = toProductBars(SPY_1D).slice(-40)
  const LTF_TREE = { type: 'call', name: 'na', args: [{ type: 'ltf', value: '60', args: [{ type: 'series', name: 'close' }] }] }
  const PLAIN_TREE = { type: 'call', name: 'na', args: [{ type: 'op', name: '+', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }] }] }
  const everyBar = (reader, node) => bars.map((_, i) => reader.readUnknown(node, i))

  it('⭐ graph form: an `ltf` tree over the node budget has no column — and is UNKNOWN on every bar', () => {
    const graph = buildGraph({ a: LTF_TREE })
    const node = graph.outputRoots.a
    const program = { ops: [{ props: { y: { v: 'graph', node } } }] }
    const r = computeObjectColumns(graph, program, bars, { tf: 'D', inputs: {}, budget: { maxNodes: 1 } })
    expect(r.failed).toEqual([node])
    expect(r.refusals[0].guard).toBe('budget:nodes')
    expect(Number.isNaN(r.readNode(node, bars.length - 1))).toBe(true)
    expect(everyBar(r, node).every((u) => u === true)).toBe(true)
    // ⛔ control: a failed tree that reads NO lower timeframe reads as it always has
    const g2 = buildGraph({ a: PLAIN_TREE })
    const r2 = computeObjectColumns(g2, { ops: [{ props: { y: { v: 'graph', node: g2.outputRoots.a } } }] }, bars,
      { tf: 'D', inputs: {}, budget: { maxNodes: 1 } })
    expect(r2.failed).toEqual([g2.outputRoots.a])
    expect(everyBar(r2, g2.outputRoots.a).some((u) => u === true)).toBe(false)
  })

  it('⭐ trees form (a document under the byte budget): the same', () => {
    const def = (tree) => ({ inputs: [], compute: { budget: { maxNodes: 1 } },
      objects: { ops: [{ props: { y: { v: 'graph', node: 0 } } }], trees: [tree] } })
    const r = objectReaderFor(def(LTF_TREE), bars, { tf: 'D' })
    expect(r.form).toBe('trees')
    expect(r.failed).toEqual([0])
    expect(r.refusals[0].guard).toBe('budget:nodes')
    expect(everyBar(r, 0).every((u) => u === true)).toBe(true)
    const r2 = objectReaderFor(def(PLAIN_TREE), bars, { tf: 'D' })
    expect(r2.failed).toEqual([0])
    expect(everyBar(r2, 0).some((u) => u === true)).toBe(false)
  })
})

// ─── ⛔⛔ THE GATE: OFF IS THE DEFAULT, AND OFF IS THE BEHAVIOUR BEFORE C41 ───────
//
// The rule above is witnessed; OUR intraday bars are not measured against
// TradingView's (`lowerTfGate.js`, `storeIntradayAgreement.test.js`). So off, the
// read is refused BY NAME where it used to be refused, and nothing downstream of
// that — a node, a stamp, a fetch, a supply — exists.
describe('C41 — `VITE_PINE_LOWER_TF_ENABLED` off: refused by name, nothing served', () => {
  const HOST = { strict: true }
  const READ = 'plot(request.security(syminfo.tickerid, "60", close))'

  it('⛔ every code that is served with the gate on is `lower-tf:store-unmeasured` with it off', () => {
    for (const code of ['5', '15', '60', '240']) {
      const line = `plot(request.security(syminfo.tickerid, "${code}", close))`
      expect(translatePine(pine([line]), HOST).ok).toBe(true)
      const t = gateOff(() => translatePine(pine([line]), HOST))
      expect(t.ok).toBe(false)
      expect(t.refusal.message).toContain(R.STORE_UNMEASURED)
      expect(t.refusal.message).toContain('have not been measured against TradingView')
      expect(t.lowerTf).toBeUndefined()
      expect(JSON.stringify(t.outputs)).not.toContain('"ltf"')
    }
  })

  it('⛔ unset, empty, "0" and "true" are all OFF; only "1" serves', () => {
    for (const v of [undefined, '', '0', 'true']) {
      if (v === undefined) vi.unstubAllEnvs(); else vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', v)
      try {
        expect(translatePine(pine([READ]), HOST).ok, `value ${String(v)}`).toBe(false)
      } finally {
        vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
        vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')
      }
    }
    expect(translatePine(pine([READ]), HOST).ok).toBe(true)
  })

  it('⛔ every OTHER refusal keeps its own name with the gate off (it is asked last)', () => {
    gateOff(() => {
      const refusal = (line, opts = HOST) => translatePine(pine([line]), opts).refusal.message
      expect(refusal('plot(request.security(syminfo.tickerid, "60", close, lookahead = barmerge.lookahead_on))')).toContain(R.LOOKAHEAD)
      expect(refusal('plot(request.security_lower_tf(syminfo.tickerid, "60", close))')).toContain(R.INTRABAR_ARRAY)
      expect(refusal('plot(request.security("AMEX:SPY", "60", close))')).toContain(R.OTHER_SYMBOL)
      expect(refusal('plot(request.security(syminfo.tickerid, "30", close))')).toContain(R.UNWITNESSED)
      expect(refusal('plot(request.security(syminfo.tickerid, "15", close))', { strict: true, basePeriod: '60' }))
        .toContain(R.INTRADAY_CHART)
      expect(refusal(READ, {})).toContain(R.SCREEN)
      // a HIGHER timeframe is not this gate's business
      expect(translatePine(pine(['plot(request.security(syminfo.tickerid, "W", close))']), HOST).ok).toBe(true)
    })
  })

  it('⛔ through the member door: ema-ribbon draws what it drew before C41 — its lower rows withheld', () => {
    const cap = load('ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json')
    const off = gateOff(() => runOurSide(cap))
    // 37 of TradingView's 48 — wave 10's own count for this capture (36 on wave 9)
    expect(off.objects.counts.tableCells).toBe(37)
    expect(off.notes.some((n) => n.startsWith('lower timeframe'))).toBe(false)
    for (const text of ['2.63%', '3.8%', '3.88%', '▼▼  STRONG BEAR']) expect(off.objects.texts.tableCells).not.toContain(text)
  })

  it('⛔ a document stamped while the gate was on is neither fetched for nor supplied once it is off', async () => {
    const { lowerTfWindowsOf, resolveLowerTf } = await import('../../lowerTf.js')
    const def = { meta: { lowerTf: ['15', '60'] } }
    const bars = toProductBars(load('vw-bar-counters-rddt-15-2026-09-30.json'))
    const have = new Map([['15', { bars, status: 'ready' }]])
    expect(lowerTfWindowsOf(def, 'D', 600).length).toBe(1)
    expect(resolveLowerTf(def, { tf: 'D', lowerTf: have }).served).toEqual(['15', '60'])
    gateOff(() => {
      expect(lowerTfWindowsOf(def, 'D', 600)).toEqual([])
      const r = resolveLowerTf(def, { tf: 'D', lowerTf: have })
      expect(r.served).toEqual([])
      expect(r.supply).toEqual({})
      expect(r.refused.map((x) => x.refusal)).toEqual([R.STORE_UNMEASURED, R.STORE_UNMEASURED])
    })
  })
})
