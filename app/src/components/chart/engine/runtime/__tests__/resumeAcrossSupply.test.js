// ─── ⭐⭐ (Fred RS filled chart, item 3) — A RUN THAT READS REQUESTS RESUMES ACROSS A NEW SUPPLY ───────────────────
//
// `runtimeColumns.js` resumes a run that reads requested bars from its session's checkpoint when every requested
// value bars [0, cp] read is the same in the new supply (`supplyAgreesTo`) and every request region is causal
// (`vm.js::requestRegionCausal`); the VM then re-runs the checkpointed run's sub-runs over the new supply before bar
// cp + 1, with the cumulative charges restored exactly. These rails hold:
//   * over a chart's life (a tick, a new bar, a requested bar corrected AFTER the checkpoint) the run RESUMES, and
//     what it draws, and every cumulative count, are a full run's, bit for bit; a peak is never lower;
//   * a requested bar corrected BEFORE the checkpoint, and an alignment moved before it, are NOT resumed;
//   * the same over the off-listing curtain (Fred RS's run half: A and B both resume);
//   * a resumed run stops exactly where a full run stops, at every ceiling around the sub-run (VM level), and one
//     that throws is run again in full (product level);
//   * the causal allowlist refuses a chart column, a nested request and a call into either; `CUMULATIVE_LIMITS` is
//     every limit the runtime charges by adding.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf,
  __resumeAcrossSupplyOffForTests,
} from '../runtimeColumns.js'
import { RUNTIME_OBJECTS_KEY } from '../runtimeObjects.js'
import { CUMULATIVE_LIMITS, requestRegionCausal } from '../vm.js'
import * as VM from '../vm.js'
import { OP } from '../program.js'
import { DEFAULT_LIMITS, RuntimeLimitError } from '../limits.js'
import { OWN_DAILY_KEY } from '../../otherSymbols.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition.js'

// every TOP-LEVEL execute the product makes is seen (a sub-run is `vm.js`'s own call and is not): the VM-level rail
// replays the product's own program and context; the abandon rail makes a resumed run throw once
const seen = []
let failResumed = false
vi.mock('../vm.js', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    execute: vi.fn((program, ctx, limits, opts) => {
      if (failResumed && opts && opts.resume && (opts.resume.requests || []).length) {
        failResumed = false
        throw new RuntimeLimitError('ARRAY_OPERATIONS', 1, 2)
      }
      const res = m.execute(program, ctx, limits, opts)
      seen.push({ program, ctx, limits, opts, res })
      return res
    }),
  }
})
const REPO = path.resolve(process.cwd(), '..')
beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers(); seen.length = 0; failResumed = false })
afterEach(() => { __resumeAcrossSupplyOffForTests(false); resetRuntimeSessions() })

// ── a regular-session 5m chart whose SP:SPX 5m bars our store holds for every session ──
const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
const isoPlus = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10)
const weekdays = (from, to) => { const out = []; for (let d = from; d <= to; d = isoPlus(d, 1)) if (![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) out.push(d); return out }
const SESS = weekdays('2026-11-02', '2026-11-12')
const rth = (days, base, wiggle) => days.flatMap((d, k) => Array.from({ length: 78 }, (_, j) => {
  const c = base + k + Math.sin(j / wiggle)
  return { t: ET(d, 9, 30) + j * 300, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1000 + j }
}))
const CHART = rth(SESS, 90, 9)
const SPX = rth(SESS, 7300, 7)
const PREV = '2026-10-30'
const SPXD = [PREV, ...SESS].map((d, k) => ({ t: Date.parse(`${d}T00:00:00Z`) / 1000, o: 1, h: 1, l: 1, c: 7290 + k * 5, v: 1 }))
const OWND = [PREV, ...SESS].map((d, k) => ({ t: d, o: 1, h: 1, l: 1, c: 89 + k, v: 1 }))
const HELD = 'SEED_FRED6725_RS_RATING:RSRATING@D'
const SEED = []
for (let d = '2026-10-13', k = 0; d <= '2026-11-16'; d = isoPlus(d, 1), k += 1) SEED.push({ t: d, o: 0, h: 1000, l: 0, c: [190.9, 123.49, 75, 39.88][k % 4], v: 0 })
const ctxOf = ({ spx = SPX, spxd = SPXD, listing = true } = {}) => ({
  tf: '5', newestBarIsForming: true, historyFromListing: listing,
  symbol: { ticker: 'RDDT', exchange: 'NYSE', industry: 'Internet Content & Information', sector: 'Communication Services', securityType: 'stock' },
  secondary: new Map([['SPX', { bars: spx, status: 'available' }], ['SPX@D', { bars: spxd, status: 'available' }],
    [OWN_DAILY_KEY, { bars: OWND, status: 'available' }], [HELD, { bars: SEED, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
})
const pine = (lines) => ['//@version=6', 'indicator("ras", overlay = false)', ...lines].join('\n')
const docOf = (source, outputs, meta = {}) => ({ id: 'u_ras', compute: { kind: 'runtime', fn: 'runtime:u_ras', rev: 1, source, outputs },
  inputs: [], meta })
const SAME_TF = docOf(pine([
  // not a bare field (#1978 picks those without a sub-run): the region RUNS, and charges
  'x = request.security("SP:SPX", timeframe.period, ta.sma(close, 3))',
  'plot(x)',
  'plot(ta.sma(x, 5) - ta.sma(close, 5))',
]), { x: 0, y: 1 })
const DAILY = docOf(pine([
  // a daily read above an intraday chart is served as a bare field only (a pick, no sub-run)
  'd = request.security("SP:SPX", "D", close)',
  'plot(d - d[1])',
  'var float acc = 0.0',
  'acc += nz(d) / 1000',
  'plot(acc)',
]), { x: 0, y: 1 })

// a bar moved: a copy of `bars` with bar `i`'s close (and high) replaced
const moved = (bars, i, dc) => bars.map((b, k) => (k === i ? { ...b, c: b.c + dc, h: Math.max(b.h, b.c + dc) } : b))

/** One run, with what it drew, how it ran and the cumulative counts it charged (`onBudget`). */
function run(def, rows, ctx) {
  let counts = null
  try {
    const cols = computeRuntimeColumns(def, rows, ctx, { now: () => 0, onBudget: (b) => { counts = { ...b.counts } } })
    return { cols, inc: runtimeIncrementalOf(cols), counts }
  } catch (e) { return { refused: `${e.guard}: ${e.message}` } }
}
const expectSameDrawn = (a, b, at) => {
  expect(a.refused, at).toBe(b.refused)
  if (b.refused) return
  expect(Object.keys(a.cols), at).toEqual(Object.keys(b.cols))
  for (const k of Object.keys(b.cols)) {
    expect(a.cols[k].length, `${at} ${k}`).toBe(b.cols[k].length)
    for (let i = 0; i < b.cols[k].length; i += 1) if (!Object.is(a.cols[k][i], b.cols[k][i])) expect.fail(`${at}: ${k}[${i}] ${a.cols[k][i]} vs ${b.cols[k][i]}`)
  }
  expect(JSON.stringify(a.cols[RUNTIME_OBJECTS_KEY] || null), at).toBe(JSON.stringify(b.cols[RUNTIME_OBJECTS_KEY] || null))
  for (const k of CUMULATIVE_LIMITS) expect(a.counts[k], `${at}: ${k}`).toBe(b.counts[k])
  for (const k of Object.keys(b.counts)) if (!CUMULATIVE_LIMITS.includes(k)) expect(a.counts[k] >= b.counts[k], `${at}: peak ${k}`).toBe(true)
}

/** A chart's life on one session: each step runs warm (the session the previous step left) and is compared with a
 *  full run of the same step. Returns each step's incremental record. */
function life(def, steps) {
  resetRuntimeSessions()
  const out = []
  // every step's full run is computed first and set aside, so the warm runs see only their own sessions
  const fulls = steps.map(({ rows, ctx }) => { resetRuntimeSessions(); const r = run(def, rows, ctx); resetRuntimeSessions(); return r })
  for (let s = 0; s < steps.length; s += 1) {
    const warm = run(def, steps[s].rows, steps[s].ctx)
    expectSameDrawn(warm, fulls[s], `step ${s} (${steps[s].name})`)
    out.push({ name: steps[s].name, inc: warm.inc })
  }
  return out
}

describe('a run that reads requests resumes across a new supply, and draws what a full run draws', () => {
  for (const [name, def] of [['same-timeframe SPX', SAME_TF], ['daily SPX', DAILY]]) {
    it(`${name}: a tick, a new bar and a requested bar corrected AFTER the checkpoint resume; bit for bit`, () => {
      const n = CHART.length
      const tick = moved(CHART, n - 1, 0.25)
      const spxTick = moved(SPX, SPX.length - 1, 1.5)
      const spxdTick = moved(SPXD, SPXD.length - 1, 2)
      const steps = [
        { name: 'cold', rows: CHART.slice(0, n - 1), ctx: ctxOf({ spx: SPX.slice(0, n - 1) }) },
        { name: 'a new bar', rows: CHART, ctx: ctxOf() },
        { name: 'a tick: the newest chart bar and the newest requested bar move', rows: tick, ctx: ctxOf({ spx: spxTick, spxd: spxdTick }) },
        { name: 'another tick', rows: moved(tick, n - 1, -0.5), ctx: ctxOf({ spx: moved(spxTick, SPX.length - 1, -3) }) },
      ]
      const inc = life(def, steps)
      expect(inc[0].inc.resumedFrom).toBe(null)
      expect(inc[1].inc.resumedFrom).toBe(n - 3)   // the cold run's last confirmed bar
      expect(inc[2].inc.resumedFrom).toBe(n - 2)
      expect(inc[3].inc.resumedFrom).toBe(n - 2)
    })
    it(`${name}: ⛔ a requested bar corrected BEFORE the checkpoint is not resumed (and draws what a full run draws)`, () => {
      const n = CHART.length
      const inc = life(def, [
        { name: 'cold', rows: CHART, ctx: ctxOf() },
        { name: 'SPX bar 40 corrected', rows: CHART, ctx: ctxOf({ spx: moved(SPX, 40, 2), spxd: moved(SPXD, 2, 3) }) },
      ])
      expect(inc[1].inc.resumedFrom).toBe(null)
      expect(inc[1].inc.why).toMatch(/^request: a requested value before the checkpoint changed/)
      expect(n).toBeGreaterThan(41)
    })
  }
  it("a request reached only on the first bars: its sub-run is made again before the resumed bars (the counts are a full run's)", () => {
    const EARLY = docOf(pine([
      'var float first = na',
      'if bar_index < 3',
      '    first := request.security("SP:SPX", timeframe.period, ta.sma(close, 2))',
      'plot(first)',
      'plot(close)',
    ]), { x: 0, y: 1 })
    const n = CHART.length
    const inc = life(EARLY, [
      { name: 'cold', rows: CHART.slice(0, n - 1), ctx: ctxOf({ spx: SPX.slice(0, n - 1) }) },
      { name: 'a new bar', rows: CHART, ctx: ctxOf() },
    ])
    expect(inc[1].inc.resumedFrom, JSON.stringify(inc[1].inc)).toBe(n - 3)
  })
  it('⛔ an alignment moved before the checkpoint (the store gains an earlier SPX session: every index shifts) is not resumed', () => {
    const earlier = rth(['2026-10-30'], 7290, 7)
    const inc = life(SAME_TF, [
      { name: 'cold', rows: CHART, ctx: ctxOf() },
      { name: 'an earlier SPX session', rows: CHART, ctx: ctxOf({ spx: [...earlier, ...SPX] }) },
    ])
    expect(inc[1].inc.resumedFrom).toBe(null)
    expect(inc[1].inc.why).toMatch(/^request: a requested value before the checkpoint changed/)
  })
  it('⛔ CONTROL: with the door shut every request run is a full run, as before (why "request")', () => {
    __resumeAcrossSupplyOffForTests(true)
    const n = CHART.length
    const inc = life(SAME_TF, [
      { name: 'cold', rows: CHART.slice(0, n - 1), ctx: ctxOf({ spx: SPX.slice(0, n - 1) }) },
      { name: 'a new bar', rows: CHART, ctx: ctxOf() },
    ])
    expect(inc[1].inc.resumedFrom).toBe(null)
    expect(inc[1].inc.why).toBe('request')
  })
  it("Fred RS's run half, off the listing (the curtain's A and B): a tick resumes both, bit for bit", () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1'); vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
    // the run half's own document: what the member pane hands the worker
    const ro = memberPaneDefinition({ source: RS, name: 'Fred RS', id: 'u_ras' }).definition.compute.runtimeObjects
    const half = { id: 'u_ras_half', compute: { kind: 'runtime', fn: 'runtime:u_ras_half', source: ro.source, objects: true, outputs: ro.outputs }, meta: { runtimeHistory: 'listing' } }
    const n = CHART.length
    const roles = []
    const inc = life(half, [
      { name: 'cold', rows: CHART, ctx: ctxOf({ listing: false }) },
      { name: 'a tick', rows: moved(CHART, n - 1, 0.25), ctx: ctxOf({ listing: false, spx: moved(SPX, SPX.length - 1, 1.5) }) },
    ])
    for (const s of seen) if (s.opts && s.opts.resume) roles.push(s.opts.resume.bar)
    expect(inc[1].inc.resumedFrom).not.toBe(null)
    expect(roles.length, 'A and B both resumed').toBeGreaterThanOrEqual(2)
  })
})

describe('a resumed run stops exactly where a full run stops', () => {
  it('VM level: at every TOTAL_INSTRUCTIONS ceiling around the sub-run, resumed throws exactly when full throws', () => {
    const n = CHART.length
    // the product's own program, checkpoint and contexts: a cold run, then a full run over a new supply
    resetRuntimeSessions()
    run(SAME_TF, CHART, ctxOf())
    const cold = seen.at(-1)
    resetRuntimeSessions()
    run(SAME_TF, CHART, ctxOf({ spx: moved(SPX, SPX.length - 1, 1.5) }))
    const next = seen.at(-1)
    const cp = cold.res.checkpoint
    expect(cp && cp.requests.length).toBeGreaterThan(0)
    const total = next.res.budget.counts.TOTAL_INSTRUCTIONS
    let both = 0
    for (const cap of [total - 1, total, total + 1, Math.floor(total * 0.5), Math.floor(total * 0.9), Math.floor(total * 0.99)]) {
      const limits = { ...DEFAULT_LIMITS, TOTAL_INSTRUCTIONS: cap }
      const go = (opts) => { try { VM.execute(next.program, next.ctx, limits, opts); return null } catch (e) { return e instanceof RuntimeLimitError ? e.limit : `other: ${e.message}` } }
      const f = go({})
      const r = go({ resume: cp })
      expect(r, `cap ${cap}`).toBe(f)
      if (f) both += 1
    }
    expect(both, 'some ceilings stop both').toBeGreaterThan(0)
    expect(n).toBeGreaterThan(0)
  })
  it('product level: a resumed run that throws is run again in full and draws what a full run draws', () => {
    const n = CHART.length
    resetRuntimeSessions()
    run(SAME_TF, CHART.slice(0, n - 1), ctxOf({ spx: SPX.slice(0, n - 1) }))
    failResumed = true
    const warm = run(SAME_TF, CHART, ctxOf())
    expect(failResumed, 'the resumed run was attempted').toBe(false)
    resetRuntimeSessions()
    const cold = run(SAME_TF, CHART, ctxOf())
    expectSameDrawn(warm, cold, 'abandoned to full')
    expect(warm.inc.resumedFrom).toBe(null)
  })
})

describe('what is causal, and what is charged by adding', () => {
  const prog = (code, { functions = [], requests = [] } = {}) => ({ code: code.flat(), instructions: code.length, functions, requests })
  it('a region of plain ops is causal; a chart column, a nested request, or a call into either is not', () => {
    const plain = prog([[OP.HALT, 0, 0], [OP.READ_SERIES, 3, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]], { requests: [{ entry: 1 }] })
    expect(requestRegionCausal(plain, 1)).toBe(true)
    for (const bad of [OP.READ_COLUMN, OP.READ_HIST, OP.READ_HIST_DYN, OP.REQUEST, OP.OBJECT]) {
      const p = prog([[OP.HALT, 0, 0], [bad, 0, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]], { requests: [{ entry: 1 }] })
      expect(requestRegionCausal(p, 1), `op ${bad}`).toBe(false)
    }
    // a call into a function body that reads a chart column
    const viaCall = prog([[OP.HALT, 0, 0], [OP.READ_COLUMN, 0, 0], [OP.RET, 0, 0], [OP.CALL, 0, 0], [OP.EMIT, 0, 0], [OP.HALT, 0, 0]],
      { functions: [{ entry: 1 }], requests: [{ entry: 3 }] })
    expect(requestRegionCausal(viaCall, 3)).toBe(false)
  })
  it('CUMULATIVE_LIMITS is every limit the runtime charges by adding (INSTRUCTIONS_PER_BAR is charged only as it stops)', () => {
    const dir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
    const charged = new Set()
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/\.charge\('([A-Z_]+)'/g)) charged.add(m[1])
    }
    // the VM's hot counters are flushed as totals (`flushHot`): the four it keeps local
    for (const k of ['LOOP_ITERATIONS', 'CALL_COUNT', 'CARRIED_STEPS', 'WINDOW_CELLS']) charged.add(k)
    charged.delete('INSTRUCTIONS_PER_BAR')
    expect([...charged].sort()).toEqual([...CUMULATIVE_LIMITS].sort())
  })
})
