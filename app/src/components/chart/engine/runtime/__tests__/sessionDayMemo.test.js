// ─── ⭐ PERF (Fred RS filled chart) — A CHART BAR'S ET SESSION DAY IS FORMATTED ONCE ─────────────────────────────────
//
// `requestSupply.js::aboveChartRead` reads each chart bar's ET session day for every daily read above an intraday
// chart; Fred RS's run half has three, and the warm-up curtain runs it twice over the same bar objects. The day is kept
// per bar object with the `t` it came from (`sessionDaysOf`). These rails hold: the supply is the same, bit for bit,
// memo on and off, for A's rows and B's; a supply reads each bar's day once across its three reads and the curtain's
// second run reads none again; a bar whose `t` changed is computed again.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, warmupShiftFor } from '../runtimeColumns.js'
import { runtimeRequestSupply, sessionDaysOf, __sessionDayMemoOffForTests } from '../requestSupply.js'
import * as OTHER from '../../otherSymbols.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition.js'

// every ET-day the supply formats is counted (the formatter itself, wrapped)
vi.mock('../../otherSymbols.js', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, etSessionDayOf: vi.fn(m.etSessionDayOf) }
})
const REPO = path.resolve(process.cwd(), '..')
beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers(); OTHER.etSessionDayOf.mockClear() })
afterEach(() => { __sessionDayMemoOffForTests(false) })

// ── a 5m extended-hours chart (04:00-19:55 ET) over ten trading sessions, SP:SPX held for each ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const SESS = []
for (let d = '2026-11-02'; d <= '2026-11-13'; d = isoPlus(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) SESS.push(d)
const chartOf = () => SESS.flatMap((d, k) => Array.from({ length: 192 }, (_, j) => {
  const c = 90 + k * 0.05 + Math.sin((k * 192 + j) / 9)
  return { t: ET(d, 4, 0) + j * 300, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 + j }
}))
const SPX = SESS.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
  const c = 7300 + k * 5 + Math.cos(j / 7) * 3
  return { t: ET(d, 9, 30) + j * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }
}))
const PREV = '2026-10-30'
const SPXD = [PREV, ...SESS].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 7290 + k * 5, v: 1 }))
const OWND = [PREV, ...SESS].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k * 0.1, v: 1 }))
const SEED = []
for (let d = '2026-10-13', k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) SEED.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
const ctx = { tf: '5', newestBarIsForming: false, historyFromListing: false, curtained: true,
  symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
  secondary: new Map([['SPX', { bars: SPX, status: 'available' }], ['SPX@D', { bars: SPXD, status: 'available' }],
    [OTHER.OWN_DAILY_KEY, { bars: OWND, status: 'available' }], ['SEED_FRED6725_RS_RATING:RSRATING@D', { bars: SEED, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) }

/** Fred RS's run half: its lowered requests (the run's own, through `onProgram`). */
function fredRequests() {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1'); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
  const ro = memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_sdm' }).definition.compute.runtimeObjects
  const half = { id: 'u_sdm_half', compute: { kind: 'runtime', fn: 'runtime:u_sdm_half', source: ro.source, objects: true, outputs: ro.outputs }, meta: { runtimeHistory: 'listing' } }
  let program = null
  computeRuntimeColumns(half, chartOf(), { ...ctx, curtained: undefined }, { now: () => 0, onProgram: (p) => { if (!program) program = p } })
  const above = program.requests.filter((r) => r.target && r.target.above === true)
  expect(above.length, 'three daily reads above the chart').toBe(3)
  return program.requests
}
const plain = (s) => JSON.stringify(s.supply.map((x) => ({ runBars: x.runBars, index: Array.from(x.index) })))
  + JSON.stringify({ refusal: s.refusal, pending: s.pending, newest: s.newestWithheld, codes: s.codes })

describe('a chart bar\'s ET session day is formatted once', () => {
  it("Fred RS's supply is the same, bit for bit, memo on and off, over A's rows and B's", () => {
    const requests = fredRequests()
    const rows = chartOf()
    const shift = warmupShiftFor(rows.length)
    for (const [name, rr] of [['A', rows], ['B', rows.slice(shift)]]) {
      __sessionDayMemoOffForTests(true)
      const off = runtimeRequestSupply(requests, rr, ctx)
      __sessionDayMemoOffForTests(false)
      const on = runtimeRequestSupply(requests, rr, ctx)
      expect(off.refusal, name).toBe(null)
      expect(plain(on), name).toBe(plain(off))
    }
  })
  it("one supply formats each bar once across its daily reads; the curtain's second run formats none (⛔ CONTROL: memo off, once a read)", () => {
    const requests = fredRequests()
    const rows = chartOf()
    const shift = warmupShiftFor(rows.length)
    __sessionDayMemoOffForTests(true)
    OTHER.etSessionDayOf.mockClear()
    runtimeRequestSupply(requests, chartOf(), ctx)
    const reads = OTHER.etSessionDayOf.mock.calls.length / rows.length
    expect(reads, 'the daily reads that format a day (own symbol, SPX)').toBe(2)
    __sessionDayMemoOffForTests(false)
    OTHER.etSessionDayOf.mockClear()
    runtimeRequestSupply(requests, rows, ctx)
    expect(OTHER.etSessionDayOf.mock.calls.length).toBe(rows.length)
    OTHER.etSessionDayOf.mockClear()
    runtimeRequestSupply(requests, rows.slice(shift), ctx)
    expect(OTHER.etSessionDayOf.mock.calls.length).toBe(0)
  })
  it('⛔ a bar whose t changed after its day was kept is formatted again (and one with no numeric t has none)', () => {
    const rows = chartOf()
    const first = sessionDaysOf(rows)
    expect(first[0]).toBe('2026-11-02')
    rows[0].t += 86400
    rows[1] = { ...rows[1], t: String(rows[1].t) }
    const again = sessionDaysOf(rows)
    expect(again[0]).toBe('2026-11-03')
    expect(again[0]).toBe(OTHER.etSessionDayOf(rows[0].t))
    expect(again[1]).toBe(null)
    expect(again.slice(2)).toEqual(first.slice(2))
  })
})
