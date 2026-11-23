// ─── ⭐⭐ U-DAILY (e96, part B) — A DAILY EXPRESSION ABOVE AN INTRADAY CHART, ON THE RUNTIME LANE, BUILT DARK ───────────
//
// L12 PR 2 serves `request.security(syminfo.tickerid, "D", close)` above an intraday chart: a BARE open / high / low /
// close, on a row choice witnessed against TradingView (`rsIntradayDaily.test.js`). Part B reads an EXPRESSION there
// (`ta.sma(close, 3)`, `high[1]` with look-ahead on) on the same row choice, behind the capability
// `request-daily-expression`, which is NOT admitted until its captures grade MATCH (`dailyExpressionWitness.json`, queue
// row Q-DAILY-1; the probe is committed byte for byte as the rig pinned it). What is held here:
//   * CLOSED (as committed): the run refuses such a read BY NAME, with the capability's sentence; the bare read is
//     served exactly as before; nothing new is fetched;
//   * OPENED (a measurement only): the window-bounded set is served on the witnessed rows, the previous-day idiom reads
//     each session's own row, a bar whose window reaches before the held rows is DEPTH (`knownFrom`), and everything
//     outside the set is refused by name: a running value, a value of the script, a length that is not a literal,
//     look-ahead with no offset;
//   * the gate answers every row of `tests/fixtures/ast/daily_expression_admission_cases.json` as the registry's own
//     function does (`tests/test_daily_expression_admission_parity.py`).
// Every expected number is worked out by hand from the rows below (row r closes at 80 + r, its high 81 + r).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeReadsOwnDaily, __resetOwnDailyMemoForTests } from './runtime/runtimeColumns'
import { runtimeRequestSupply } from './runtime/requestSupply'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend'
import { lowerIrProgram } from './runtime/lowerIr'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'
import { OWN_DAILY_KEY, setRequestWitnessRows } from './otherSymbols'
import { clearSecondaryBars } from './secondaryBars'
import { SCRIPT_ENGINE_VERSION } from './scriptEngineVersion'
import {
  dailyExpressionAdmitted, dailyExpressionAdmissionReasons, setDailyExpressionAdmissionForMeasurement,
  DAILY_EXPRESSION_WITNESS, DAILY_EXPRESSION_CAPABILITY,
} from './dailyExpressionGate'

vi.setConfig({ testTimeout: 120000 })

const REPO = path.resolve(process.cwd(), '..')
const ET = (day, hh, mm) => {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000   // EST (UTC-5) in November
}
const FIVE = 300
const D1 = '2026-11-16'
const D2 = '2026-11-17'
const slab = (day, hh, mm, n) => Array.from({ length: n }, (_, k) => ET(day, hh, mm) + k * FIVE)
// the chart: two regular sessions of twelve 5 minute bars (09:30..10:25 New York), the newest bar closed
const DAY1 = slab(D1, 9, 30, 12)
const DAY2 = slab(D2, 9, 30, 12)
const ROWS = [...DAY1, ...DAY2].map((t, i) => ({ t, o: 50, h: 51, l: 49, c: 50 + i * 0.01, v: 1 }))
// THE DAILY ROWS: row r closes at 80 + r, its high one above (11-09 .. 11-13, then the chart's two sessions)
const DAYS = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', D1, D2]
const OWN_D = DAYS.map((t, r) => ({ t, o: 80 + r, h: 81 + r, l: 79 + r, c: 80 + r, v: 1 }))
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE', securityType: 'stock' }

const ctxOf = (own = OWN_D) => ({
  tf: '5', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL,
  secondary: new Map([[OWN_DAILY_KEY, { bars: own, status: 'available' }]]),
  exchangeOf: () => null,
})
const pine = (lines) => ['//@version=5', 'indicator("udaily-b", overlay = false)', ...lines].join('\n')
const runDef = (source) => ({
  id: 'u_udaily-b', compute: { kind: 'runtime', fn: 'runtime:u_udaily-b', rev: 1, source, objects: true, outputs: { x: 0 } },
  inputs: [], meta: { runtimeHistory: 'listing' },
})
const run = (lines, ctx = ctxOf()) => computeRuntimeColumns(runDef(pine(lines)), ROWS, ctx, { now: () => 0 })
/** The run's own request target and the supply's answer for it on these rows. */
const supplyOf = (lines, own = OWN_D, over = {}) => {
  const built = buildRuntimeIr(pine(lines), { bars: ROWS, inputs: {}, tf: '5', basePeriod: '5', symbol: SYMBOL })
  expect(built.ok, built.ok ? '' : built.refusal && built.refusal.message).toBe(true)
  const program = lowerIrProgram(built.ir)
  return { target: program.requests[0].target, sup: runtimeRequestSupply(program.requests, ROWS, { ...ctxOf(own), ...over }) }
}
const SMA3 = ['plot(request.security(syminfo.tickerid, "D", ta.sma(close, 3)))']
const PREV_HIGH = ['plot(request.security(syminfo.tickerid, "D", high[1], lookahead = barmerge.lookahead_on))']
const lastOfDay = (i) => i === DAY1.length - 1 || i === ROWS.length - 1
const near = (got, want, label) => expect(Math.abs(got - want), `${label}: ${got} against ${want}`).toBeLessThan(1e-9)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  __resetOwnDailyMemoForTests()
})
afterEach(() => {
  setDailyExpressionAdmissionForMeasurement(null)
  setRequestWitnessRows(null)
  resetRuntimeSessions()
  resetRuntimeLedgers()
  clearSecondaryBars()
  __resetOwnDailyMemoForTests()
  vi.unstubAllEnvs()
})

describe('U-DAILY B — CLOSED, as committed: refused by name, the bare read unchanged', () => {
  it('⛔ the capability is not admitted, and its row says why', () => {
    expect(dailyExpressionAdmitted()).toBe(false)
    expect(DAILY_EXPRESSION_WITNESS.capability).toBe(DAILY_EXPRESSION_CAPABILITY)
    expect(dailyExpressionAdmissionReasons(DAILY_EXPRESSION_WITNESS)).toContain('not marked admitted')
  })

  it('⛔ a daily expression is refused BY NAME, with the capability and its queue row; nothing is fetched for it', () => {
    expect(() => run(SMA3)).toThrow(/served once its capture witness grades MATCH \(capability `request-daily-expression`, queue row Q-DAILY-1\)/)
    expect(() => run(PREV_HIGH)).toThrow(/capability `request-daily-expression`/)
    expect(supplyOf(SMA3).target).toMatchObject({ own: true, unread: true, code: 'D' })
    expect(runtimeReadsOwnDaily(pine(SMA3), '5')).toBe(false)
  })

  it('⛔ CONTROL — the bare daily close is served exactly as L12 PR 2 serves it, its target unchanged', () => {
    const cols = run(['plot(request.security(syminfo.tickerid, "D", close))'])
    ROWS.forEach((_r, i) => {
      const want = i < DAY1.length ? (lastOfDay(i) ? 85 : 84) : (lastOfDay(i) ? 86 : 85)
      expect(cols.x[i], `bar ${i}`).toBe(want)
    })
    const { target } = supplyOf(['plot(request.security(syminfo.tickerid, "D", close))'])
    expect(target.above).toBe(true)
    expect('dailyReach' in target || 'lookaheadOn' in target, 'the bare read carries nothing new').toBe(false)
  })
})

describe('U-DAILY B — OPENED for a measurement: the served set on the witnessed rows', () => {
  beforeEach(() => setDailyExpressionAdmissionForMeasurement(true))

  it('⭐ a 3 day average: each bar reads the session before (its last bar its own), as the bare read does', () => {
    // row r's 3 day average is 80 + r - 1: day 1's bars read row 4 (83), its last bar row 5 (84); day 2 rows 5 / 6
    const cols = run(SMA3)
    ROWS.forEach((_r, i) => near(cols.x[i], i < DAY1.length ? (lastOfDay(i) ? 84 : 83) : (lastOfDay(i) ? 85 : 84), `bar ${i}`))
    expect(supplyOf(SMA3).target).toMatchObject({ above: true, dailyReach: 2 })
    expect(runtimeReadsOwnDaily(pine(SMA3), '5')).toBe(true)
  })

  it('⭐ the previous-day idiom (`high[1]`, look-ahead on): every bar reads its own session\'s row, whose [1] is the day before', () => {
    // row r's high[1] is 81 + (r - 1) = 80 + r: day 1 (row 5) 85 on every bar, day 2 (row 6) 86
    const cols = run(PREV_HIGH)
    ROWS.forEach((_r, i) => expect(cols.x[i], `bar ${i}`).toBe(i < DAY1.length ? 85 : 86))
    expect(supplyOf(PREV_HIGH).target).toMatchObject({ above: true, dailyReach: 1, lookaheadOn: true })
  })

  it('⭐ a highest of 2 reads one row back, a change of 1 one row back', () => {
    const hi = run(['plot(request.security(syminfo.tickerid, "D", ta.highest(high, 2)))'])
    expect(hi.x[0]).toBe(85)             // row 4's two highs: 84, 85
    const ch = run(['plot(request.security(syminfo.tickerid, "D", ta.change(close)))'])
    expect(ch.x[0]).toBe(1)              // row 4 against row 3
    expect(supplyOf(['plot(request.security(syminfo.tickerid, "D", ta.change(close, 2) + close[3]))']).target.dailyReach).toBe(3)
  })

  it('⛔ a bar whose window reaches before the held rows is DEPTH (`knownFrom`), never a short window', () => {
    // rows from 11-12 (row 0) to 11-17 (row 3): day 1's bars read row 1, whose 3 day window needs a row before 11-12
    const { sup } = supplyOf(SMA3, OWN_D.slice(3))
    expect(sup.refusal && sup.refusal.message).not.toMatch(/after its history began/)
    expect(sup.refusal && sup.refusal.knownFrom, 'day 1\'s last bar (row 2) is the first whose window is held').toBe(11)
    const cols = run(SMA3, ctxOf(OWN_D.slice(3)))
    for (let i = 0; i < 11; i += 1) expect(Number.isNaN(cols.x[i]), `bar ${i} is unknown`).toBe(true)
    near(cols.x[11], 84, 'bar 11 (rows 0..2: 83, 84, 85)')
    near(cols.x[23], 85, 'bar 23 (rows 1..3)')
    // the previous-day idiom: rows from 11-16, so day 1 has no day before it held
    const prev = supplyOf(PREV_HIGH, OWN_D.slice(5)).sup
    expect(prev.refusal && prev.refusal.knownFrom).toBe(12)
  })

  it('⭐ on rows that start at the symbol\'s FIRST TRADE a short window is TradingView\'s `na`, not depth', () => {
    const listedSymbol = { symbol: { ...SYMBOL, firstTradeDate: OWN_D[3].t } }
    expect(supplyOf(SMA3, OWN_D.slice(3), listedSymbol).sup.refusal, 'no earlier day exists: nothing is withheld').toBe(null)
    const listed = { ...ctxOf(OWN_D.slice(3)), ...listedSymbol }
    const cols = run(SMA3, listed)
    for (let i = 0; i < 11; i += 1) expect(Number.isNaN(cols.x[i]), `bar ${i} is na by history`).toBe(true)
    near(cols.x[11], 84, 'bar 11')
  })

  it('⛔ outside the served set, each refused BY NAME', () => {
    expect(() => run(['plot(request.security(syminfo.tickerid, "D", ta.ema(close, 3)))'])).toThrow(/`ta\.ema`, a running value/)
    expect(() => run(['len = input.int(3)', 'plot(request.security(syminfo.tickerid, "D", ta.sma(close, len)))']))
      .toThrow(/`ta\.sma`'s length is not a whole-number literal/)
    expect(() => run(['plot(request.security(syminfo.tickerid, "D", ta.sma(volume, 3) / ta.atr(14)))'])).toThrow(/`ta\.atr`, a running value/)
    expect(() => run(['plot(request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on))']))
      .toThrow(/reads the day the bar is inside/)
    expect(() => run(['plot(request.security(syminfo.tickerid, "D", close[1] - close, lookahead = barmerge.lookahead_on))']))
      .toThrow(/reads the day the bar is inside/)
    // another symbol's expression is not this capability's: no target is minted for it
    expect(() => run(['plot(request.security("NASDAQ:QQQ", "D", ta.sma(close, 3)))'])).toThrow()
  })

  it('⛔ an answer given with the capability open is never reused once it closes (the run, the build, the question)', () => {
    near(run(SMA3).x[0], 83, 'bar 0, the capability open')
    expect(runtimeReadsOwnDaily(pine(SMA3), '5')).toBe(true)
    setDailyExpressionAdmissionForMeasurement(false)
    // the same source, rows and chart: a kept session, a kept build or a kept answer would serve it again
    expect(() => run(SMA3)).toThrow(/request-daily-expression/)
    expect(runtimeReadsOwnDaily(pine(SMA3), '5')).toBe(false)
  })

  it('⛔ CONTROL — on a daily chart nothing changes: no daily rows are asked for', () => {
    expect(runtimeReadsOwnDaily(pine(SMA3), 'D')).toBe(false)
  })
})

describe('U-DAILY B — the gate answers every registry row as the server\'s function does', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/ast/daily_expression_admission_cases.json'), 'utf8'))
  const withEngine = (row) => JSON.parse(JSON.stringify(row).replaceAll('"CURRENT"', String(SCRIPT_ENGINE_VERSION)))
  it('every case, as written (the same rows `tests/test_daily_expression_admission_parity.py` holds the server to)', () => {
    expect(doc.capability).toBe(DAILY_EXPRESSION_CAPABILITY)
    expect(new Set(doc.cases.map((c) => c.admitted))).toEqual(new Set([true, false]))
    for (const c of doc.cases) {
      const reasons = dailyExpressionAdmissionReasons(withEngine(c.row))
      expect(reasons.length === 0, `${c.name}: ${reasons.join('; ')}`).toBe(c.admitted)
    }
  })

  it('the committed probe is the rig\'s, byte for byte (its sha is the row\'s pin)', () => {
    const bytes = fs.readFileSync(path.join(REPO, DAILY_EXPRESSION_WITNESS.probe))
    expect(bytes.includes(13), 'LF line endings only').toBe(false)
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(DAILY_EXPRESSION_WITNESS.probeSha256)
    expect(DAILY_EXPRESSION_WITNESS.probeSha256).toBe('2cb53948cc329196f03eba247ee76a930d1f0a384da18f9def447e34c9ae173a')
  })
})
