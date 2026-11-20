// ─── ⭐⭐ (e91, the e88 in-session capture, 2026-11-20) — THE OWN DAILY ROWS SHORT OF THE CHART: DEPTH, NEVER A HOLE ──────
//
// ⚰️ CAPTURED (Fred RS "rs-rating-fred6724" on NYSE:RDDT 5m, REGULAR hours, production engine 88, 14:46Z, the runtime
// worker's own replies, run e87-live / persona rth): the chart's 18,749 rows began 2025-10-21 09:30 ET and spanned 273
// sessions (~69 bars a session: RDDT does not trade in every 5-minute slot); its own daily rows (`OWN~D`) were held from
// 2025-10-30, 267 rows, because their depth was counted at 78 bars a session (`heldDepthOf(20000, '5')`). For an above
// read the supply knew no first-held time, so every withheld bar was a "hole": the whole run REFUSED ("`this symbol's daily
// bars` has no bar on 1761053400, after its history began") and Fred RS's 5m pane stayed BLANK all session.
// THE RULING (coordinator, 2026-11-20), held here:
//   (a) a bar reading a session BEFORE the held own-daily (or SPX@D) rows' first session is DEPTH: the run starts at
//       `knownFrom`, the first bar every read of which is held. A row missing INSIDE the held sessions still refuses.
//   (b) the held daily rows are sized from the chart's own span of sessions (`sessionsSpanned`, on a rung), never bars/78.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runtimeRequestSupply } from './runtime/requestSupply'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from './ast/pineRuntimeClock.js'
import { OWN_DAILY_KEY, heldDepthOf, sessionsSpanned, heldSessionsRung, HELD_DAILY_DEPTH_CAP } from './otherSymbols'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'
import { ensureChartSources } from './useSecondarySources'
import { clearSecondaryBars, secondaryBarsUrl } from './secondaryBars'

const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED = 'SEED_FRED6725_RS_RATING:RSRATING@D'
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information',
  sector: 'Communication Services', securityType: 'Stock', firstTradeDate: '2024-03-21' })

// winter sessions only (EST, UTC-5): no daylight-saving edge inside the fixture
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const sessionsFrom = (from, count) => {
  const out = []
  for (let d = from; out.length < count; d = isoPlus(d, 1)) if (isTradingDay(d)) out.push(d)
  return out
}
// the 10 sessions right BEFORE the chart, contiguous with it (11-14 .. 11-28; Thanksgiving 11-27 is not one)
const PRIOR = sessionsFrom('2025-11-14', 10)
const SESS = sessionsFrom('2025-12-01', 30).filter((d) => d < '2026-01-15')
const slots = (day) => Array.from({ length: 78 }, (_, k) => ET(day, 9, 30) + k * 300)
const bar = (t, c) => ({ t, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 })
// ⚰️ the measured density: RDDT averages ~69 of the 78 regular 5m slots a session (9 of every 78 dropped, deterministically)
const CHART = SESS.flatMap((d) => slots(d).filter((_, k) => k % 9 !== 4)).map((t, i) => bar(t, 40 + i * 0.01 + Math.sin(i / 9)))
const SPX_5 = [...PRIOR, ...SESS].flatMap((d) => slots(d)).map((t, i) => bar(t, 6800 + Math.cos(i / 11) * 5))
const utcMid = (d) => Date.parse(`${d}T00:00:00Z`) / 1000
const SPX_D = [...PRIOR, ...SESS].map((d, k) => ({ t: utcMid(d), o: 1, h: 1, l: 1, c: 6800 + k, v: 1 }))
const ownRows = (days) => days.map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 40 + k * 0.5, v: 1 }))
const SEED_ROWS = []
for (let d = '2025-11-01', k = 0; d <= '2026-01-20'; d = isoPlus(d, 1), k += 1) {
  SEED_ROWS.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
}
const ctxOf = (own) => ({ tf: '5', newestBarIsForming: false, historyFromListing: false, symbol: RDDT,
  secondary: new Map([['SPX', { bars: SPX_5, status: 'available' }], ['SPX@D', { bars: SPX_D, status: 'available' }],
    [OWN_DAILY_KEY, { bars: own, status: 'available' }], [SEED, { bars: SEED_ROWS, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })

function supplyOn(rows, ctx) {
  const built = buildRuntimeIr(RS, { bars: rows, inputs: {}, objectsInRun: true, pane: true, plotColours: true,
    basePeriod: '5', tf: '5', symbol: RDDT, ...runtimeClockOpts(false, { tf: '5' }) })
  expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  const requests = built.ir.requests || []
  const own = requests.findIndex((r) => r && r.target && r.target.above === true && !r.target.ticker)
  expect(own, 'Fred RS reads its own symbol at D').toBeGreaterThanOrEqual(0)
  return { sup: runtimeRequestSupply(requests, rows, ctx), own }
}
/** the LAST chart bar of `day`: the first bar every read of which is held when the own rows begin on `day` */
const lastBarOf = (rows, day) => rows.reduce((k, b, i) => (b.t >= ET(day, 0, 0) && b.t < ET(isoPlus(day, 1), 0, 0) ? i : k), -1)
const HOLE = /has no bar on \d+, after its history began/
const DEPTH = /this chart's history reaches \d+, and the `this symbol's daily bars` bars we hold begin at (\d{4}-\d{2}-\d{2})/

describe('the fixture is the measured shape', () => {
  it('a regular-hours 5m chart at ~69 bars a session, its own daily rows beginning 7 sessions after its first', () => {
    expect(CHART.length / SESS.length).toBeCloseTo(69, 0)
    expect(SESS.length).toBeGreaterThan(20)
    expect(CHART[0].t).toBe(ET(SESS[0], 9, 30))
  })
})

describe('(a) the own daily rows short of the chart: DEPTH, the run starts where every read is held', () => {
  it('⚰️ THE CAPTURED SHAPE: never the hole sentence; knownFrom = the first held session\'s last bar', () => {
    const { sup } = supplyOn(CHART, ctxOf(ownRows(SESS.slice(7))))
    expect(sup.refusal, 'a depth gap answers where the run starts').not.toBeNull()
    expect(sup.refusal.message).not.toMatch(HOLE)
    expect(sup.refusal.message).toMatch(DEPTH)
    expect(sup.refusal.message.match(DEPTH)[1]).toBe(SESS[7])
    expect(sup.refusal.knownFrom).toBe(lastBarOf(CHART, SESS[7]))
  })
  it('⛔ CONTROL: a row missing INSIDE the held sessions still refuses as a hole, with no knownFrom', () => {
    const own = ownRows([...PRIOR, ...SESS].filter((d) => d !== SESS[15]))
    const { sup } = supplyOn(CHART, ctxOf(own))
    expect(sup.refusal).not.toBeNull()
    expect(sup.refusal.message).toMatch(HOLE)
    expect(sup.refusal.knownFrom).toBeUndefined()
  })
  it('⛔ CONTROL: own daily rows deep enough (from before the chart) are served exactly as before', () => {
    const { sup, own } = supplyOn(CHART, ctxOf(ownRows([...PRIOR, ...SESS])))
    expect(sup.refusal && sup.refusal.message).toBeFalsy()
    for (let i = 0; i < CHART.length; i += 1) expect(sup.supply[own].index[i], `bar ${CHART[i].t}`).toBeGreaterThanOrEqual(0)
  })
})

describe('(b) the held daily rows are sized from the chart\'s span of sessions, never bars / 78', () => {
  it('sessionsSpanned counts the exchange calendar between two bar times; 0 for anything that is not unix seconds', () => {
    expect(sessionsSpanned(CHART[0].t, CHART[CHART.length - 1].t)).toBe(SESS.length)
    expect(sessionsSpanned('2025-12-01', '2025-12-31')).toBe(0)
    expect(sessionsSpanned(null, CHART[0].t)).toBe(0)
    expect(sessionsSpanned(CHART[5].t, CHART[0].t)).toBe(0)
  })
  it('⚰️ the production numbers: 20,000 rows at 78 a session held 267 rows; the chart spanned 273 sessions, now covered', () => {
    expect(heldDepthOf(20000, '5')).toBe(267)                     // the old count, unchanged when no span is known
    const rung = heldSessionsRung(273)
    expect(rung).toBe(512)
    expect(heldDepthOf(20000, '5', rung)).toBeGreaterThanOrEqual(273 + 1)
  })
  it('the span only ever deepens the rows, never shortens them, and never past the cap', () => {
    expect(heldDepthOf(60000, '5', heldSessionsRung(10))).toBe(heldDepthOf(60000, '5'))
    expect(heldDepthOf(600, '5', heldSessionsRung(99999))).toBe(HELD_DAILY_DEPTH_CAP)
  })
  it('a daily / weekly chart is sized as before (the span is an intraday fact)', () => {
    expect(heldDepthOf(500, 'W', 512)).toBe(heldDepthOf(500, 'W'))
    expect(heldDepthOf(500, 'D', 512)).toBe(heldDepthOf(500, 'D'))
  })
  it('the ladder: a span is rounded UP to a rung (a filling chart refetches a few times), 0 stays 0', () => {
    expect(heldSessionsRung(0)).toBe(0)
    expect(heldSessionsRung(1)).toBe(64)
    expect(heldSessionsRung(64)).toBe(64)
    expect(heldSessionsRung(65)).toBe(128)
    expect(heldSessionsRung(1e9)).toBe(HELD_DAILY_DEPTH_CAP)
  })
})

describe("(b) the hook asks the held daily rows at the chart's span", () => {
  afterEach(() => clearSecondaryBars())
  const ask = (heldSessions) => {
    const asked = []
    const fetcher = (...a) => { asked.push(String(a[0])); return new Promise(() => {}) }
    ensureChartSources(['SPX@D', OWN_DAILY_KEY], '5', 20000, fetcher, 'RDDT', heldSessions)
    clearSecondaryBars()
    return asked
  }
  it("with the span (rung 512): SPX@D and this symbol's own daily rows are asked 522 deep", () => {
    const asked = ask(512)
    expect(asked).toContain(secondaryBarsUrl('SPX', 'D', 522))
    expect(asked).toContain(secondaryBarsUrl('RDDT', 'D', 522))
  })
  it('⛔ CONTROL: no span known (0): asked at the old count (267), exactly as before', () => {
    const asked = ask(0)
    expect(asked).toContain(secondaryBarsUrl('SPX', 'D', 267))
    expect(asked).toContain(secondaryBarsUrl('RDDT', 'D', 267))
  })
})
