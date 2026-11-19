// ─── ⭐⭐ (Fred RS filled chart, item 1) — A CHART DEEPER THAN ITS REQUESTED SERIES IS CUT BEFORE IT IS BUILT OVER ──
//
// `runtimeColumns.js::computeRuntimeColumns` asks the supply where the chart becomes known (`knownFromBeforeBuild`:
// a bar-free build's requests, the supply over the chart) BEFORE the run builds over every bar, and starts the run
// there on a DEPTH refusal, as the e83 depth move (#1990) did after a whole-chart build. These rails hold:
//   * the probe reads the SAME requests a run builds (targets, entries, results), on every request script that builds;
//   * what is drawn is the same, bit for bit (columns, drawings, the depth record), probe on and off, on a chart
//     deeper than its SP:SPX, Fred RS's run half included;
//   * a refusal raised ONLY by bars before `knownFrom` (a column the front end refuses over them) is dropped: the run
//     is drawn from where our data begins (coordinator ruling 2026-11-19, NUMBER PENDING), and a refusal from bars
//     INSIDE the drawn span still fires;
//   * a hole AFTER the series began still refuses with the run's own sentence; a chart whose series all begin before
//     it is not probed at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import util from 'node:util'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, RUNTIME_KNOWN_FROM_KEY, runtimeIrOptions,
  knownFromBeforeBuild, __knownFromProbeOffForTests,
} from '../runtimeColumns.js'
import { RUNTIME_OBJECTS_KEY } from '../runtimeObjects.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { OWN_DAILY_KEY } from '../../otherSymbols.js'

// every build the run makes is counted (the front end itself, wrapped): the whole-chart build must not happen
vi.mock('../../ast/pineRuntimeFrontend.js', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, buildRuntimeIr: vi.fn(m.buildRuntimeIr) }
})
const REPO = path.resolve(process.cwd(), '..')
beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })
afterEach(() => { __knownFromProbeOffForTests(false); resetRuntimeSessions() })

// ── a 5m extended-hours chart whose first sessions precede the SP:SPX 5m rows our store holds ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const weekdaysFrom = (from, to) => { const out = []; for (let d = from; d <= to; d = isoPlus(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) out.push(d); return out }
const SESS = weekdaysFrom('2026-11-02', '2026-11-17')
const barsOf = (days) => days.flatMap((d, k) => Array.from({ length: 192 }, (_, j) => {
  const c = 90 + k + Math.sin(j / 9)
  return { t: ET(d, 4, 0) + j * 300, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 }
}))
const CHART = barsOf(SESS)
const spxOf = (days, from) => days.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
  const c = 7300 + (k + from) * 5 + Math.cos(j / 7) * 3
  return { t: ET(d, 9, 30) + j * 300, o: c, h: c + 1, l: c - 1, c, v: 1 }
}))
// our store holds SPX's 5m bars from the SIXTH session on (Monday 2026-11-09): the chart reaches a week deeper
const DEPTH = 5
const SPX5_LATE = spxOf(SESS.slice(DEPTH), DEPTH)
const PREV = '2026-10-30'
const SPXD = [PREV, ...SESS].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 7290 + k * 5, v: 1 }))
const OWND = [PREV, ...SESS].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k, v: 1 }))
const HELD = 'SEED_FRED6725_RS_RATING:RSRATING@D'
const SEED = []
for (let d = '2026-10-13', k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) SEED.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88][k % 4], v: 0 })
const ctx5 = (over = {}) => ({
  tf: '5', newestBarIsForming: false, historyFromListing: false,
  symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
  secondary: new Map([['SPX', { bars: SPX5_LATE, status: 'available' }], ['SPX@D', { bars: SPXD, status: 'available' }],
    [OWN_DAILY_KEY, { bars: OWND, status: 'available' }], [HELD, { bars: SEED, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
  ...over,
})
const pine = (lines) => ['//@version=6', 'indicator("kfb", overlay = false)', ...lines].join('\n')
const runDef = (source, outputs) => ({ id: 'u_kfb', compute: { kind: 'runtime', fn: 'runtime:u_kfb', rev: 1, source, objects: true, outputs },
  inputs: [], meta: { runtimeHistory: 'listing' } })
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')

/** The same document over the same chart, the probe on and off: what each answers. */
function bothWays(def, rows, ctx) {
  const run = (off) => {
    __knownFromProbeOffForTests(off)
    resetRuntimeSessions(); resetRuntimeLedgers()
    try { return { cols: computeRuntimeColumns(def, rows, ctx, { now: () => 0 }) } } catch (e) { return { refused: `${e.guard}: ${e.message}` } }
  }
  const off = run(true)
  const on = run(false)
  __knownFromProbeOffForTests(false)
  return { off, on }
}
const sameDrawn = (a, b, at) => {
  expect(Object.keys(a), at).toEqual(Object.keys(b))
  for (const k of Object.keys(b)) {
    expect(a[k].length, at).toBe(b[k].length)
    const bad = []
    for (let i = 0; i < b[k].length; i += 1) if (!Object.is(a[k][i], b[k][i])) bad.push(i)
    expect(bad.length, `${at}: ${k} differs on ${bad.length} bars`).toBe(0)
  }
  expect(util.isDeepStrictEqual(a[RUNTIME_KNOWN_FROM_KEY], b[RUNTIME_KNOWN_FROM_KEY]), `${at}: the depth record`).toBe(true)
  const la = a[RUNTIME_OBJECTS_KEY]
  const lb = b[RUNTIME_OBJECTS_KEY]
  expect(JSON.stringify(la && la.live), `${at}: the drawings`).toBe(JSON.stringify(lb && lb.live))
}

describe('the probe reads the requests the run builds', () => {
  it('every request script that builds: a bar-free build lowers to the same requests as a build over the chart', () => {
    const sources = [RS,
      pine(['plot(request.security("SP:SPX", timeframe.period, close))']),
      pine(['plot(request.security("SP:SPX", timeframe.period, ta.sma(close, 3)))', 'plot(close)']),
      pine(['[a, b] = request.security("SP:SPX", timeframe.period, [high, low])', 'plot(a - b)'])]
    const caps = path.join(REPO, 'tests/fixtures/vendor/harness')
    for (const f of fs.readdirSync(caps).filter((x) => x.endsWith('.json')).sort()) {
      const raw = fs.readFileSync(path.join(caps, f), 'utf8')
      if (!/security\s*\(/.test(raw)) continue
      try { const j = JSON.parse(raw); if (j && j.source && typeof j.source.text === 'string') sources.push(j.source.text) } catch { /* not a capture */ }
    }
    let compared = 0
    for (const src of [...new Set(sources)]) {
      for (const [tf, rows] of [['5', CHART], ['D', OWND.map((b, i) => ({ ...b, o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i }))]]) {
        const ctx = { ...ctx5(), tf }
        const def = runDef(src, {})
        let full
        try { full = buildRuntimeIr(src, runtimeIrOptions(def, rows, ctx, { sessionKey: 'k' })) } catch { continue }
        if (!full.ok) continue
        const want = lowerIrProgram(full.ir).requests || []
        if (!want.length) continue
        const bare = buildRuntimeIr(src, runtimeIrOptions(def, [], ctx, { sessionKey: 'k' }))
        expect(bare.ok, bare.ok ? '' : bare.refusal.message).toBe(true)
        expect(lowerIrProgram(bare.ir).requests).toEqual(want)
        compared += 1
      }
    }
    expect(compared, 'never vacuous').toBeGreaterThanOrEqual(6)
  })
})

describe('what is drawn is the same, probe on and off', () => {
  it('a request run on a chart deeper than its SPX: columns, the depth record, bit for bit', () => {
    const def = runDef(pine(['x = request.security("SP:SPX", timeframe.period, close)', 'plot(x)', 'plot(ta.sma(close, 5))']), { x: 0, s: 1 })
    expect(knownFromBeforeBuild(def, CHART, ctx5())).toBeGreaterThan(0)
    const { off, on } = bothWays(def, CHART, ctx5())
    expect(off.refused).toBeUndefined()
    expect(on.refused).toBeUndefined()
    sameDrawn(on.cols, off.cols, 'deep chart')
    expect(on.cols[RUNTIME_KNOWN_FROM_KEY].knownFrom).toBe(DEPTH * 192)   // the sixth session's first bar (its pre-market reads the last close)
  })

  it('Fred RS\'s run half on that chart: columns and drawings, bit for bit', () => {
    const def = runDef(RS, { value: 0 })
    const { off, on } = bothWays(def, CHART, ctx5())
    expect(on.refused).toBe(off.refused)
    if (!off.refused) sameDrawn(on.cols, off.cols, 'Fred RS')
  })

  it('⛔ CONTROL: a chart whose requested series all begin before it is not probed (no cost, the same run)', () => {
    const def = runDef(pine(['plot(request.security("SP:SPX", timeframe.period, close))']), { x: 0 })
    const shallow = CHART.slice(DEPTH * 192)
    expect(knownFromBeforeBuild(def, shallow.slice(78), ctx5())).toBe(0)
    const { off, on } = bothWays(def, shallow.slice(78), ctx5())
    expect(on.refused).toBe(off.refused)
    if (!off.refused) sameDrawn(on.cols, off.cols, 'shallow chart')
  })
})

describe('a refusal from the drawn span still fires; a refusal the supply names is not a depth gap', () => {
  // regular-session 5m bars (`time("W")` is withheld outside the session, so the chart keeps to it), and a session
  // on a Saturday, where `time("W")` cannot be answered (`runtime:chart-clock`)
  const rth = (days) => days.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
    const c = 90 + k + Math.sin(j / 9)
    return { t: ET(d, 9, 30) + j * 300, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 }
  }))
  const saturday = (day) => rth([day])
  const RTH = rth(SESS)
  const W = pine(['x = request.security("SP:SPX", timeframe.period, close)', 'plot(x)', 'plot(time("W") > 0 ? 1 : 0)'])
  const def = runDef(W, { x: 0, w: 1 })
  it('a Saturday BEFORE where our data begins: refused before (the whole-chart build), drawn now from the depth', () => {
    // CONTROL: without the Saturday the chart is served both ways
    const plain = bothWays(def, RTH, ctx5())
    expect(plain.off.refused).toBeUndefined()
    const rows = [...saturday('2026-10-31'), ...RTH]
    const { off, on } = bothWays(def, rows, ctx5())
    expect(off.refused).toMatch(/^runtime:chart-clock/)
    expect(on.refused).toBeUndefined()
    const known = on.cols[RUNTIME_KNOWN_FROM_KEY].knownFrom
    expect(rows[known].t).toBe(ET(SESS[DEPTH], 9, 30))
    const drawnFrom = on.cols.w.findIndex((v) => !Number.isNaN(v))
    expect(drawnFrom, 'nothing is drawn before our data').toBeGreaterThanOrEqual(known)
    // and from there it is what a chart starting where our data begins draws (the Saturday is not read)
    resetRuntimeSessions()
    const fromDepth = computeRuntimeColumns(def, rows.slice(known), { ...ctx5() }, { now: () => 0 })
    for (const k of ['x', 'w']) for (let i = drawnFrom; i < rows.length; i += 1) expect(Object.is(on.cols[k][i], fromDepth[k][i - known]), `${k}[${i}]`).toBe(true)
  })
  it('⛔ a Saturday INSIDE the drawn span still refuses, by the same name, both ways', () => {
    const rows = [...RTH.filter((b) => b.t < ET('2026-11-16', 4, 0)), ...saturday('2026-11-14'), ...RTH.filter((b) => b.t >= ET('2026-11-16', 4, 0))]
    const { off, on } = bothWays(def, rows, ctx5())
    expect(off.refused).toMatch(/^runtime:chart-clock/)
    expect(on.refused).toBe(off.refused)
  })
  it('⛔ a hole AFTER the series began still refuses with the run\'s own sentence, both ways (no depth, no move)', () => {
    const holed = SPX5_LATE.filter((b) => !(b.t >= ET(SESS[6], 9, 30) && b.t < ET(SESS[6], 10, 0)))
    const ctx = ctx5({ secondary: new Map([['SPX', { bars: holed, status: 'available' }], ['SPX@D', { bars: SPXD, status: 'available' }]]) })
    const plain = runDef(pine(['plot(request.security("SP:SPX", timeframe.period, close))']), { x: 0 })
    const { off, on } = bothWays(plain, CHART, ctx)
    expect(off.refused).toMatch(/cannot be read on every bar/)
    expect(on.refused).toBe(off.refused)
  })
})

describe('on a deep chart the run never builds over every bar', () => {
  it('probe on: no build over the whole chart; ⛔ CONTROL probe off: the whole-chart build happens, as before', () => {
    const def = runDef(pine(['x = request.security("SP:SPX", timeframe.period, close)', 'plot(x)', 'plot(ta.sma(close, 5))']), { x: 0, s: 1 })
    const wholeBuilds = (off) => {
      __knownFromProbeOffForTests(off)
      resetRuntimeSessions(); resetRuntimeLedgers()
      buildRuntimeIr.mockClear()
      computeRuntimeColumns(def, CHART, ctx5(), { now: () => 0 })
      __knownFromProbeOffForTests(false)
      return buildRuntimeIr.mock.calls.filter(([, o]) => o && Array.isArray(o.bars) && o.bars.length === CHART.length).length
    }
    expect(wholeBuilds(false)).toBe(0)
    expect(wholeBuilds(true)).toBeGreaterThan(0)
  })
})
