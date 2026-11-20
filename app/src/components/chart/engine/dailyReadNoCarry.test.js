// ─── ⭐⭐ A DAILY READ ABOVE AN INTRADAY CHART NEVER CARRIES AN OLDER ROW FORWARD (coordinator, 2026-11-19) ───────────
//
// `requestSupply.js::aboveChartRead` serves a look-ahead-off `request.security(…, 'D', …)` above an intraday chart: each
// chart bar reads ONE daily row — the previous session's (a bar before its session's daily bar has closed), or its own
// session's (the chart's last bar of the day for the own symbol; a bar from the close for SP:SPX). The question raised
// by the tail-lag unit (#2076): when the row that bar should read is MISSING from the rows we hold, does the bar read an
// OLDER row instead? That is a silently carried value, which the ruling forbids: TradingView reads the row it reads,
// and an unknown read is withheld by name, never guessed.
// Rails, both reads (the chart's OWN symbol, `OWN_DAILY_KEY`; ANOTHER symbol, SP:SPX), on a 60m chart:
//   1. CONTROL: every row held — every bar reads exactly its expected row, nothing withheld;
//   2. a row missing INSIDE the history — no bar reads a row older than the one it should; the run refuses by name;
//   3. the newest session's own row missing (own read, the newest bar) — the newest bar is withheld, never yesterday's.
import { describe, it, expect } from 'vitest'
import { runtimeRequestSupply } from './runtime/requestSupply'
import { buildRuntimeIr } from './ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from './ast/pineRuntimeClock.js'
import { OWN_DAILY_KEY } from './otherSymbols'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'

const SRC = `//@version=6
indicator("daily read, no carry")
o = request.security(syminfo.tickerid, "D", close)
s = request.security("SP:SPX", "D", close)
plot(o)
plot(s)
`
const SYM = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' })
// every session of this fixture is under EST (UTC-5): 2026-11-02 .. 2026-11-20 (Veterans Day is a trading day)
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const sessionsFrom = (from, count) => {
  const out = []
  for (let d = from; out.length < count; d = isoPlus(d, 1)) if (isTradingDay(d)) out.push(d)
  return out
}
const ALL = sessionsFrom('2026-10-26', 20)            // the daily rows' sessions: five before the chart begins
const SESS = ALL.slice(5)                             // the chart's sessions
const bar = (t, c) => ({ t, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 })
// the chart: 60m bars 04:00..19:00 ET of every session (the store's extended-hours 60m shape)
const CHART = SESS.flatMap((d) => Array.from({ length: 16 }, (_, k) => ET(d, 4 + k, 0))).map((t, i) => bar(t, 40 + i * 0.01))
const OWN_D = ALL.map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 100 + k, v: 1 }))
const SPX_D = ALL.map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 5000 + k, v: 1 }))
const SPX_60 = ALL.flatMap((d, k) => Array.from({ length: 7 }, (_, j) => bar(ET(d, 9, 30) + j * 3600, 5000 + k)))

const ctxOf = ({ own = OWN_D, spx = SPX_D } = {}) => ({ tf: '60', newestBarIsForming: false, historyFromListing: false,
  symbol: { ...SYM },
  secondary: new Map([['SPX', { bars: SPX_60, status: 'available' }], ['SPX@D', { bars: spx, status: 'available' }],
    [OWN_DAILY_KEY, { bars: own, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) })

function supplyOn(rows, ctx) {
  const built = buildRuntimeIr(SRC, { bars: rows, inputs: {}, pane: true, basePeriod: '60', tf: '60', symbol: SYM,
    ...runtimeClockOpts(false, { tf: '60' }) })
  expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  const requests = built.ir.requests || []
  const own = requests.findIndex((r) => r && r.target && r.target.above === true && !r.target.ticker)
  const other = requests.findIndex((r) => r && r.target && r.target.above === true && r.target.ticker)
  expect(own, 'the own daily read').toBeGreaterThanOrEqual(0)
  expect(other, 'the SP:SPX daily read').toBeGreaterThanOrEqual(0)
  return { sup: runtimeRequestSupply(requests, rows, ctx), own, other }
}
// what each chart bar of day `d` reads, by the rules the module states
const etDay = (t) => new Date((t - 5 * 3600) * 1000).toISOString().slice(0, 10)
const prevSession = (d) => ALL[ALL.indexOf(d) - 1]
const dayRowT = (row) => (typeof row.t === 'number' ? new Date(row.t * 1000).toISOString().slice(0, 10) : row.t)

describe('1. CONTROL: every row held, every bar reads exactly its expected row', () => {
  const { sup, own, other } = supplyOn(CHART, ctxOf())
  it('nothing is refused', () => expect(sup.refusal).toBeNull())
  it('the own read: the previous session on every bar but the day\'s last, which reads its own day', () => {
    const s = sup.supply[own]
    CHART.forEach((b, i) => {
      const d = etDay(b.t)
      const last = i === CHART.length - 1 || etDay(CHART[i + 1].t) !== d
      expect(dayRowT(s.runBars[s.index[i]]), `bar ${i} ${d}`).toBe(last ? d : prevSession(d))
    })
  })
  it('the SP:SPX read: the previous session before the 16:00 close, the session\'s own from it', () => {
    const s = sup.supply[other]
    CHART.forEach((b, i) => {
      const d = etDay(b.t)
      expect(dayRowT(s.runBars[s.index[i]]), `bar ${i} ${d}`).toBe(b.t >= ET(d, 16, 0) ? d : prevSession(d))
    })
  })
})

describe('2. a row missing INSIDE the history: no bar reads an older row; the run refuses by name', () => {
  const HOLE = SESS[6]
  it('the OWN symbol\'s daily row missing', () => {
    const { sup, own } = supplyOn(CHART, ctxOf({ own: OWN_D.filter((r) => r.t !== HOLE) }))
    const s = sup.supply && sup.supply[own]
    if (s) {
      CHART.forEach((b, i) => {
        const j = s.index[i]
        if (j < 0) return
        const d = etDay(b.t)
        const last = i === CHART.length - 1 || etDay(CHART[i + 1].t) !== d
        expect(dayRowT(s.runBars[j]), `bar ${i} ${d}: an older row carried forward`).toBe(last ? d : prevSession(d))
      })
    }
    expect(sup.refusal, 'a missing row inside the history is not known').not.toBeNull()
    expect(sup.refusal.message).toMatch(/has no bar on/)
  })
  it('SP:SPX\'s daily row missing', () => {
    const holeT = Date.parse(`${HOLE}T00:00:00Z`) / 1000
    const { sup, other } = supplyOn(CHART, ctxOf({ spx: SPX_D.filter((r) => r.t !== holeT) }))
    const s = sup.supply && sup.supply[other]
    if (s) {
      CHART.forEach((b, i) => {
        const j = s.index[i]
        if (j < 0) return
        const d = etDay(b.t)
        expect(dayRowT(s.runBars[j]), `bar ${i} ${d}: an older row carried forward`)
          .toBe(b.t >= ET(d, 16, 0) ? d : prevSession(d))
      })
    }
    expect(sup.refusal, 'a missing row inside the history is not known').not.toBeNull()
    expect(sup.refusal.message).toMatch(/has no bar on/)
  })
})

describe('3. the newest session\'s own row missing: the newest bar is withheld, never read off yesterday', () => {
  it('the own read on the newest bar', () => {
    const newest = SESS[SESS.length - 1]
    const { sup, own } = supplyOn(CHART, ctxOf({ own: OWN_D.filter((r) => r.t !== newest) }))
    expect(sup.refusal).toBeNull()
    expect(sup.newestWithheld, 'the newest bar reads its own session, which is not held').toBe(true)
    expect(sup.newestWithheldSites).toContain(own)
  })
})
