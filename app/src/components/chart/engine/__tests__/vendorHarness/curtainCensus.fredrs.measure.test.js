// app/src/components/chart/engine/__tests__/vendorHarness/curtainCensus.fredrs.measure.test.js
//
// (e102, coordinator 2026-11-27) THE CURTAIN CENSUS FOR FRED RS'S RUN HALF (its drawings) ON A 5m CHART, its own series.
// Fred RS is the flagship host document whose drawings come from its run half (`compute.runtimeObjects`, a listing
// document): on an intraday chart it is always off the listing, so the off-listing curtain decides its drawings. Our
// repo holds no intraday Fred capture with its SPX supply (those are licence-held), so the chart is built as
// `paneBudgetPerBar.test.js::fredRs` builds it (regular sessions, 04:00-19:55 ET, SPX's regular session, the daily rows,
// the rating seed), on a seeded random walk instead of a sine. Truth = the plain run half over every session; curtain =
// the member's run half over the newest `S` sessions. Graded: whether the curtain releases the drawings, and when it
// does, whether they are the truth's (`sameDrawings`, x moved by the cut).
// ⛔ OPT-IN (`RUNTIME_PERF_CENSUS=curtain`). Measure-only: it asserts that production releases nothing wrong.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CURTAIN_CENSUS_ON } from './curtainCensus'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns, resetRuntimeSessions, withMemberDoorClock, setOffListingCurtainEnabled } from '../../runtime/runtimeColumns'
import { runtimeWarmupOf, runtimeObjectsOf, runtimeObjectsWithheldOf } from '../../runtime/runtimeObjects'
import { sameDrawings } from '../../runtime/warmupDrawings'
import { OWN_DAILY_KEY } from '../../otherSymbols'

const REPO = path.resolve(process.cwd(), '..')
afterEach(() => { vi.unstubAllEnvs(); setOffListingCurtainEnabled(false); resetRuntimeSessions() })

function rng(seed) {   // mulberry32: the same walk on every machine
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function fredChart(count, seed) {
  const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + (day < '2026-11-01' && day >= '2026-03-08' ? 4 : 5), mm) / 1000 }
  const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
  const HOL = new Set(['2026-09-07', '2026-07-03', '2026-06-19', '2026-05-25', '2026-04-03'])
  const sessions = []
  for (let d = '2026-11-13'; sessions.length < count; d = isoPlus(d, -1)) {
    if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) && !HOL.has(d)) sessions.unshift(d)
  }
  const r = rng(seed)
  let px = 90
  let sp = 7000
  const chart = []
  const spx = []
  const ownd = []
  const spxd = []
  sessions.forEach((d, k) => {
    for (let j = 0; j < 192; j += 1) {
      const o = px
      px = Math.max(1, px * (1 + (r() - 0.5) * 0.006))
      chart.push({ t: ET(d, 4, 0) + j * 300, o, h: Math.max(o, px) * (1 + r() * 0.002), l: Math.min(o, px) * (1 - r() * 0.002), c: px, v: 1000 + Math.floor(r() * 5000) })
    }
    for (let j = 0; j < 78; j += 1) {
      const o = sp
      sp = sp * (1 + (r() - 0.5) * 0.002)
      spx.push({ t: ET(d, 9, 30) + j * 300, o, h: Math.max(o, sp) + 1, l: Math.min(o, sp) - 1, c: sp, v: 1 })
    }
    ownd.push({ t: d, o: 1, h: 1, l: 1, c: px, v: 1 })
    spxd.push({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: sp, v: 1 })
  })
  let prev = isoPlus(sessions[0], -1)
  while ([0, 6].includes(new Date(`${prev}T12:00:00Z`).getUTCDay()) || HOL.has(prev)) prev = isoPlus(prev, -1)
  ownd.unshift({ t: prev, o: 1, h: 1, l: 1, c: 89, v: 1 })
  spxd.unshift({ t: Date.parse(`${prev}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 6990, v: 1 })
  const seedRows = []
  for (let d = isoPlus(sessions[0], -20), k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) {
    seedRows.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88, 12.98, 5, 2][Math.floor(k / 5) % 7], v: 0 })
  }
  const ctx = { tf: '5', newestBarIsForming: false, historyFromListing: false,
    symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
    secondary: new Map([['SPX', { bars: spx, status: 'available' }], ['SPX@D', { bars: spxd, status: 'available' }],
      [OWN_DAILY_KEY, { bars: ownd, status: 'available' }], ['SEED_FRED6725_RS_RATING:RSRATING@D', { bars: seedRows, status: 'available' }]]),
    exchangeOf: (t) => (t === 'SPX' ? 'SP' : null) }
  return { chart, ctx }
}

describe.skipIf(!CURTAIN_CENSUS_ON)("Fred RS's run half on 5m: the curtain's drawings against a run from an earlier start (opt-in)", () => {
  it('Fred RS run half, 5m', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1'); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
    const built = memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_fred' })
    expect(built.ok, built.reason).toBe(true)
    const ro = built.definition.compute.runtimeObjects
    expect(ro && typeof ro.source === 'string', 'Fred RS carries a run half').toBe(true)
    const half = { id: 'u_fred~run', compute: { kind: 'runtime', fn: 'runtime:u_fred~run', source: ro.source, objects: true, outputs: ro.outputs },
      meta: { runtimeHistory: 'listing' } }
    const plain = { ...half, meta: {} }
    const rows = []
    const limits = { ARRAY_OPERATIONS: 1e9 }
    for (const seed of [7, 11, 23]) {
      const TOTAL = 60
      const { chart, ctx } = fredChart(TOTAL, seed)
      resetRuntimeSessions()
      let truth
      try {
        truth = withMemberDoorClock(() => computeRuntimeColumns(plain, chart, ctx, { limits }))
      } catch (err) { rows.push({ seed, truth: `refused ${err.guard || err.message}` }); continue }
      const tObjs = runtimeObjectsOf(truth)
      for (const S of [40, 20]) {
        const K = chart.length - S * 192
        const row = { seed, sessions: S, bars: S * 192, truthDrawings: tObjs ? tObjs.live.length : null }
        for (const curtainOn of [true, false]) {
          setOffListingCurtainEnabled(curtainOn)
          resetRuntimeSessions()
          const mode = curtainOn ? 'curtainOn' : 'production'
          try {
            const got = withMemberDoorClock(() => computeRuntimeColumns(half, chart.slice(K), ctx, { limits }))
            const w = runtimeWarmupOf(got)
            const gObjs = runtimeObjectsOf(got)
            const withheld = runtimeObjectsWithheldOf(got)
            if (gObjs && w && w.drawings === 'same-from-two-starts') {
              const v = tObjs ? sameDrawings(tObjs.live, gObjs.live, K) : { same: false, why: 'the truth kept no drawings' }
              row[mode] = v.same ? `released, EXACT (${gObjs.live.length} drawings)` : `released, WRONG: ${v.why}`
            } else if (gObjs) {
              row[mode] = `drawn without a curtain verdict (${gObjs.live.length})`
            } else {
              row[mode] = `withheld (${withheld ? withheld.guard : 'no drawings'})`
            }
          } catch (err) {
            row[mode] = `refused (${err.guard || String(err.message).slice(0, 80)})`
          }
          setOffListingCurtainEnabled(false)
        }
        rows.push(row)
      }
    }
    // eslint-disable-next-line no-console
    console.log(`curtain census [fred-rs run half, 5m]: ${JSON.stringify(rows, null, 1)}`)
    const out = path.join(REPO, 'remote-out', 'curtain-census')
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'fredrs-run-half-5m.json'), JSON.stringify(rows, null, 1))
    // production releases nothing wrong
    for (const r of rows) if (r.production) expect(r.production, JSON.stringify(r)).not.toMatch(/WRONG/)
    expect(rows.some((r) => r.curtainOn)).toBe(true)   // non-vacuity: the curtain was measured
  }, 2400000)
})
