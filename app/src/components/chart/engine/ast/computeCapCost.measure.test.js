// app/src/components/chart/engine/ast/computeCapCost.measure.test.js
//
// ─── WHAT EACH COMPUTE CAP COSTS AT ITS VALUE, MEASURED (the cap ruling of 2026-11-17) ──
//
// `budget.js` derives each cap from a cost it protects (a frame at the 5,000-bar window,
// the recurrence ceiling both lanes share, the pane's data). This file measures that cost
// on the BROWSER lane: the formula interpreter (`interpret`) over the newest 5,000 daily
// bars of a committed capture, for the most expensive construct each cap admits, at the
// old cap and at each candidate. It also builds the scripts the caps freed through the
// member door and times the host document the door installs (`computeFor`).
//
// The server lane is measured by `tools/pine_coverage/compute_cap_cost.py`, over the
// trees this file writes (`<out>.trees.json`): the same trees, the same bars.
//
// ⛔ OPT-IN, LIKE EVERY CENSUS HERE, AND IT ASSERTS NO TIMING. A wall-clock number is a
// property of the machine; pinning one would go red on a busy box. The ruling's record of
// these readings is `docs/pine/evidence/2026-11-17-compute-caps/EVIDENCE.md`.
//   cd app && COMPUTE_CAP_COST_OUT=<file.json> [COMPUTE_CAP_SCRIPTS=<dir of .pine>] \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/ast/computeCapCost.measure.test.js
//
// `COMPUTE_CAP_SCRIPTS` names a directory holding the freed scripts that are NOT committed
// (the local sample cache's `reference/`); the committed ones are read from
// `corpus/committed`. A script found in neither is recorded as absent, never skipped
// silently. `COMPUTE_CAP_ONLY=<id,id>` measures a subset.
//
// ⚠️ A CANDIDATE CAP IS MEASURED BY RUNNING THIS AGAINST A WORKTREE WHOSE `DEFAULT_BUDGET` HOLDS
// IT (patched for the run, restored byte-equal after; never committed). Against today's caps a
// construct over a cap is recorded as the budget's refusal (`admitted: false`), not timed.
//
// `COMPUTE_CAP_MODE=baseline` measures what TODAY's caps serve instead: the host-lane compute of
// every committed script the member door installs on the host lane, and the runtime-lane compute
// of the freed scripts (the lane that serves the ones it can today).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'

import { parseFormula, SESSION_MAX_BARS } from './parse'
import { interpret, nodeCount, MAX_RECURRENCE_STEPS } from './interpret'
import { checkBudget, DEFAULT_BUDGET } from './budget'
import { bindConstsFor, foldBound } from './bind'
import * as registry from '../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from '../__tests__/vendorHarness/ourSide'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'

const OUT = process.env.COMPUTE_CAP_COST_OUT
/** `baseline` measures what the CURRENT caps serve instead: the host-lane cost of every committed
 *  script the door installs on the host lane, and the runtime-lane cost of the freed scripts. */
const MODE = process.env.COMPUTE_CAP_MODE || 'caps'
const RUN = !!OUT && MODE === 'caps'
const RUN_BASELINE = !!OUT && MODE === 'baseline'
const SCRIPTS_DIR = process.env.COMPUTE_CAP_SCRIPTS || null
const ONLY = process.env.COMPUTE_CAP_ONLY ? new Set(process.env.COMPUTE_CAP_ONLY.split(',')) : null
const REPO = path.resolve(process.cwd(), '..')
const SERIES = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const N_BARS = 5000
/** A case whose first run takes longer than this is timed once (its median would cost minutes). */
const SLOW_MS = 3000
/** The chart binding a script is computed under: the capture's own symbol, so `syminfo.*` settles
 *  (`bind.js::bindConstsFor`) the way a member's chart settles it. */
const SCRIPT_CTX = Object.freeze({ tf: 'D', newestBarIsForming: false, historyFromListing: false,
  symbol: Object.freeze({ ticker: 'AAPL', exchange: 'NASDAQ' }) })

afterEach(() => { vi.unstubAllEnvs() })

const freshBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))

let gc = null
function heapNow() {
  if (!gc) { v8.setFlagsFromString('--expose_gc'); gc = vm.runInNewContext('gc') }
  gc(); gc()
  return process.memoryUsage().heapUsed
}

/** Time `run(bars)` on fresh bars: one warm run, then up to three measured. Heap growth is
 *  read over one run with nothing collected between (an upper bound on what that run held
 *  live, since what it allocated and dropped is counted too); the result is kept alive
 *  until the read. */
function measure(rows, run) {
  const times = []
  let heapGrowth = null
  let result = null
  let error = null
  const once = () => {
    const bars = freshBars(rows)
    const t0 = performance.now()
    try { result = run(bars) } catch (e) { error = { guard: e && e.guard ? e.guard : null, message: String(e && e.message || e).slice(0, 300) } }
    return performance.now() - t0
  }
  const warm = once()
  if (error) return { ms: Number(warm.toFixed(1)), runs: 1, heapGrowthMB: null, error }
  const withResult = (o) => Object.defineProperty(o, 'result', { value: result, enumerable: false })
  if (warm > SLOW_MS) {
    // one run, and no memory read: a second run of a minutes-long case buys nothing
    return withResult({ ms: Number(warm.toFixed(1)), runs: 1, heapGrowthMB: null, error: null, firstMs: Number(warm.toFixed(1)) })
  }
  for (let k = 0; k < 3; k += 1) times.push(once())
  // the memory read: its own run, collected before, nothing collected during
  const h0 = heapNow()
  const bars = freshBars(rows)
  const held = run(bars)
  heapGrowth = process.memoryUsage().heapUsed - h0
  void held
  times.sort((a, b) => a - b)
  return withResult({
    ms: Number(times[Math.floor(times.length / 2)].toFixed(1)),
    runs: times.length,
    heapGrowthMB: Number((heapGrowth / 1048576).toFixed(2)),
    error: null,
    firstMs: Number(warm.toFixed(1)),
  })
}

// --------------------------------------------------------------------------- //
// the constructs each cap admits
// --------------------------------------------------------------------------- //

/** The lookback family: one construct per cost class the table holds. `n` is the window. */
const LOOKBACK_CONSTRUCTS = [
  { id: 'sma', cls: 'O(bars) rolling exact sum', src: (n) => `sma(close, ${n})` },
  { id: 'highest', cls: 'O(bars x window)', src: (n) => `highest(high, ${n})` },
  { id: 'stdev', cls: 'O(bars x window)', src: (n) => `stdev(close, ${n})` },
  { id: 'percentrank', cls: 'O(bars x window)', src: (n) => `percentrank(close, ${n})` },
  { id: 'percentileLinear', cls: 'O(bars x window log window)', src: (n) => `percentileLinearInterpolation(close, ${n}, 50)` },
  { id: 'accum', cls: 'recurrence: bars x warm-up steps', src: (n) => `accum(close, max(self, close), ${n})` },
  { id: 'offset', cls: 'O(bars)', src: (n) => `close[${n}]` },
  { id: 'median', cls: 'O(bars x window^2) rank counting', src: (n) => `median(close, ${n})` },
  { id: 'rci', cls: 'O(bars x window^2) rank counting', src: (n) => `rci(close, ${n})` },
]
const LOOKBACKS = [960, 2400, 2500, 2560]

/** The series family: `sma(x, 50)` summed over `k` DISTINCT series (the five prices, then
 *  clock columns), so each added series is a column fetched, held and walked. */
const SERIES_POOL = ['open', 'high', 'low', 'close', 'volume', 'hour', 'minute', 'dayofweek',
  'dayofmonth', 'month', 'year', 'time']
const seriesSrc = (k) => SERIES_POOL.slice(0, k).map((s) => `sma(${s}, 50)`).join(' + ')
const SERIES_COUNTS = [8, 12]

/** The node family: the largest tree of a given term that fits `cap` nodes. */
function treeAtCap(term, cap) {
  let k = 1
  let best = null
  for (;;) {
    const src = Array.from({ length: k }, (_, i) => term(i)).join(' + ')
    const ast = parseFormula(src).ast
    if (!ast) break
    const n = nodeCount(ast)
    if (n > cap) break
    best = { src, ast, nodes: n, terms: k }
    k += 1
  }
  return best
}
/** Today's lookback cap, from the constant it is derived from (the module's own value may be a
 *  candidate during a run): the node family is measured with every window at the depth that stays. */
const LOOKBACK_TODAY = SESSION_MAX_BARS
const NODE_TERMS = [
  { id: 'arith', cls: 'pointwise arithmetic', term: (i) => `(close - open) * ${i + 2}` },
  { id: 'sma-distinct', cls: 'distinct sma windows (rolling)', term: (i) => `sma(close, ${20 + i})` },
  { id: 'highest-at-lookback', cls: 'distinct highest windows at the lookback cap (window x nodes)',
    term: (i) => `highest(high, ${DEFAULT_BUDGET.maxLookback - i})` },
  { id: 'highest-at-960', cls: 'distinct highest windows at today\'s lookback cap',
    term: (i) => `highest(high, ${LOOKBACK_TODAY - i})` },
  { id: 'accum-at-960', cls: 'distinct recurrences, each warm-up at today\'s lookback cap (recurrences x bars x warm-up)',
    term: (i) => `accum(close, max(self, close), ${LOOKBACK_TODAY - i})` },
]
const NODE_CAPS = [128, 384]

/** The nine scripts whose only blocker was a compute cap (coverage map 2026-11-17, s8 blocker 6),
 *  and the two with that cap beside `[strategy]`. */
const FREED = [
  { key: 'committed:chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2', cap: 'maxLookback' },
  { key: 'committed:mtf-key-levels-support-and-resistance__29f470a089', cap: 'maxSeriesRefs' },
  { key: 'committed:volume-spikes-growing-volume-signals-with-alerts-scanner__8e706f448f', cap: 'maxLookback' },
  { key: 'reference:check-head-and-shouldersmask-man__INWKFwOBpV', cap: 'maxLookback' },
  { key: 'reference:multi-timeframe-vwap-v5__Au03ORcOFj', cap: 'maxSeriesRefs' },
  { key: 'reference:range-filter-buy-and-sell-5min__65cb674338', cap: 'maxLookback' },
  { key: 'reference:tradingviews-technical-analysis__oZFVfrvzZI', cap: 'maxNodes' },
  { key: 'reference:ut-bot-linreg-candles-longevity-zones-sr-dashboard__26fb08b910', cap: 'maxLookback' },
  { key: 'reference:vwapmvwapema-crossover__N16MOYK6AE', cap: 'maxLookback' },
  { key: 'committed:rsi-vwap-indicator__pTI5ZVw9n4', cap: 'maxLookback', strategy: true },
  { key: 'committed:vwap-fibo-dev-extensions-strategy__mR2vfyGjUv', cap: 'maxSeriesRefs', strategy: true },
]

function sourceOf(key) {
  const [pop, slug] = key.split(':')
  const candidates = pop === 'committed'
    ? [path.join(REPO, 'corpus', 'committed', `${slug}.pine`)]
    : (SCRIPTS_DIR ? [path.join(SCRIPTS_DIR, `${slug}.pine`)] : [])
  for (const p of candidates) if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  return null
}

const want = (id) => !ONLY || ONLY.has(id)

describe.skipIf(!RUN)('compute-cap cost on 5,000 daily bars (opt-in)', () => {
  it('measures every construct and every freed script', () => {
    const cap = JSON.parse(fs.readFileSync(SERIES, 'utf8'))
    const rows = cap.bars.rows.slice(-N_BARS)
    expect(rows.length).toBe(N_BARS) // non-vacuity: the series is long enough
    const ctx = { tf: 'D' }
    const cases = []
    const trees = []
    const run = (id, family, n, ast, extra = {}) => {
      if (!want(id)) return
      const b = checkBudget(ast, null)
      const m = b.ok ? measure(rows, (bars) => interpret(ast, bars, {}, null, undefined, ctx)) : null
      // ⭐ THE LIVE HALF OF MEMORY: the columns the run's own memo still holds when it ends
      // (a lower bound on its peak; `heapGrowthMB` is the upper one).
      if (m && !m.error && m.heapGrowthMB != null) {
        const memo = new Map()
        const h0 = heapNow()
        const col = interpret(ast, freshBars(rows), {}, null, undefined, { ...ctx, crossMemo: memo })
        m.retainedMB = Number(((heapNow() - h0) / 1048576).toFixed(2))
        m.memoColumns = memo.size
        void col
      }
      cases.push({ id, family, n, measured: b.measured, admitted: b.ok, budgetGuard: b.ok ? null : b.guard, ...extra, ...(m || {}) })
      trees.push({ id, family, n, tree: ast })
      // a long run says where it is: one line per case, as it lands (vitest holds stdout to the end)
      fs.appendFileSync(`${OUT}.progress.jsonl`, `${JSON.stringify(cases[cases.length - 1])}\n`)
      // eslint-disable-next-line no-console
      console.log(`[cap-cost] ${id}: ${m ? `${m.ms} ms, heap +${m.heapGrowthMB} MB${m.error ? ` REFUSED ${m.error.guard}` : ''}` : `budget refused ${b.guard}`}`)
    }

    for (const c of LOOKBACK_CONSTRUCTS) {
      for (const n of LOOKBACKS) run(`lookback/${c.id}/${n}`, 'maxLookback', n, parseFormula(c.src(n)).ast, { cls: c.cls })
    }
    for (const k of SERIES_COUNTS) run(`series/sma50x${k}`, 'maxSeriesRefs', k, parseFormula(seriesSrc(k)).ast, { cls: 'sma(x, 50) per distinct series' })
    for (const t of NODE_TERMS) {
      for (const nc of NODE_CAPS) {
        const best = treeAtCap(t.term, nc)
        run(`nodes/${t.id}/${nc}`, 'maxNodes', nc, best.ast, { cls: t.cls, terms: best.terms, nodes: best.nodes })
      }
    }

    // ── the freed scripts, through the member door, as production runs it ──
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
    const scripts = []
    for (const f of FREED) {
      if (!want(`script/${f.key}`) && ONLY) continue
      const source = sourceOf(f.key)
      if (!source) { scripts.push({ key: f.key, absent: true }); continue }
      let door
      try { door = enterMemberDoor(source) } catch (e) {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
        scripts.push({ key: f.key, threw: String(e && e.message || e).slice(0, 300) })
        continue
      }
      try {
        const doc = door.built && door.built.definition
        const docTrees = doc && doc.compute && doc.compute.kind === 'ast'
          ? (doc.compute.trees || { value: doc.compute.ast }) : null
        const needs = { maxNodes: 0, maxLookback: 0, maxSeriesRefs: 0 }
        if (docTrees) {
          for (const ast of Object.values(docTrees)) {
            let b = null
            try { b = checkBudget(ast, null) } catch { b = null }
            if (b) for (const k of Object.keys(needs)) needs[k] = Math.max(needs[k], b.measured[k] || 0)
          }
          // ⭐ THE TREES THE SERVER WOULD BE HANDED: folded under the same binding the chart folds
          // them under (`nativeRegistry.astColumnsUnstopped`: the inputs at their defaults, the
          // symbol), with the inputs beside them, so both lanes time the same work.
          const inputs = door.def ? registry.treeScalars(door.def, registry.resolveInputs(door.def, undefined)) : {}
          const consts = bindConstsFor({ tf: 'D', inputs, symbol: SCRIPT_CTX.symbol })
          const bound = {}
          for (const [k, ast] of Object.entries(docTrees)) {
            try { bound[k] = foldBound(ast, consts) } catch { bound[k] = ast }
          }
          trees.push({ id: `script/${f.key}`, family: 'script', n: null, trees: bound, inputs, tf: 'D' })
        }
        const row = {
          key: f.key, cap: f.cap, strategy: !!f.strategy,
          lane: door.built && door.built.ok ? (door.built.lane || (doc && doc.compute && doc.compute.kind)) : null,
          stage: door.stage, refusal: door.refusal ? door.refusal.slice(0, 300) : null,
          treeCount: docTrees ? Object.keys(docTrees).length : 0, needs,
        }
        if (door.def) {
          const m = measure(rows, (bars) => registry.computeFor(door.def, bars, undefined,
            { ...SCRIPT_CTX }))
          const errs = registry.columnErrors(m.result || {})
          Object.assign(row, m, { columnErrors: errs && Object.keys(errs).length
            ? Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v && v.guard])) : null })
        }
        scripts.push(row)
        fs.appendFileSync(`${OUT}.progress.jsonl`, `${JSON.stringify(row)}
`)
        // eslint-disable-next-line no-console
        console.log(`[cap-cost] ${f.key}: lane ${row.lane} ${row.ms != null ? `${row.ms} ms` : row.refusal}`)
      } finally {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
      }
    }

    const out = {
      measuredOn: new Date().toISOString(), node: process.version, bars: N_BARS,
      series: path.relative(REPO, SERIES).replace(/\\/g, '/'),
      caps: { ...DEFAULT_BUDGET }, maxRecurrenceSteps: MAX_RECURRENCE_STEPS,
      rssMaxMB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
      cases, scripts,
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
    fs.writeFileSync(`${OUT}.trees.json`, JSON.stringify({ bars: N_BARS, series: out.series, trees }))
    expect(cases.length + scripts.length).toBeGreaterThan(0) // non-vacuity: something was measured
  })
})

// --------------------------------------------------------------------------- //
// the baseline: what the caps as they stand already serve, and what it costs
// --------------------------------------------------------------------------- //

describe.skipIf(!RUN_BASELINE)('compute-cap baseline on 5,000 daily bars (opt-in)', () => {
  it('times every host document the door installs today, and the freed scripts on the runtime lane', () => {
    const cap = JSON.parse(fs.readFileSync(SERIES, 'utf8'))
    const rows = cap.bars.rows.slice(-N_BARS)
    expect(rows.length).toBe(N_BARS) // non-vacuity: the series is long enough
    const ctx = { ...SCRIPT_CTX }
    const progress = `${OUT}.progress.jsonl`
    const timeDoor = (door) => measure(rows, (bars) => registry.computeFor(door.def, bars, undefined, ctx))
    const needsOf = (doc) => {
      const needs = { maxNodes: 0, maxLookback: 0, maxSeriesRefs: 0 }
      const trees = doc && doc.compute && doc.compute.kind === 'ast' ? (doc.compute.trees || { value: doc.compute.ast }) : {}
      for (const ast of Object.values(trees)) {
        let b = null
        try { b = checkBudget(ast, null) } catch { b = null }
        if (b) for (const k of Object.keys(needs)) needs[k] = Math.max(needs[k], b.measured[k] || 0)
      }
      return needs
    }

    // ── 1. the host lane as production runs it: every committed script ──
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '0')
    const corpus = path.join(REPO, 'corpus', 'committed')
    const files = fs.readdirSync(corpus).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200)
    const host = []
    for (const f of files) {
      const source = fs.readFileSync(path.join(corpus, f), 'utf8')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      try {
        const doc = door.built && door.built.definition
        if (!door.def || !doc || !doc.compute || doc.compute.kind !== 'ast') continue
        const row = { file: f.replace(/\.pine$/, ''), needs: needsOf(doc), trees: Object.keys(doc.compute.trees || {}).length, ...timeDoor(door) }
        host.push(row)
        fs.appendFileSync(progress, `${JSON.stringify(row)}\n`)
      } finally {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
      }
    }

    // ── 2. the freed scripts as the runtime-on lane serves them today ──
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const runtime = []
    try {
      for (const f of FREED) {
        const source = sourceOf(f.key)
        if (!source) { runtime.push({ key: f.key, absent: true }); continue }
        let door
        try { door = enterMemberDoor(source) } catch (e) {
          registry.uninstallUserDefinition(HARNESS_DEF_ID)
          runtime.push({ key: f.key, threw: String(e && e.message || e).slice(0, 300) })
          continue
        }
        try {
          const row = { key: f.key, lane: door.built && door.built.lane, stage: door.stage, refusal: door.refusal ? door.refusal.slice(0, 300) : null }
          if (door.def) {
            const m = timeDoor(door)
            Object.assign(row, m)
            const errs = registry.columnErrors(m.result || {})
            row.columnErrors = errs && Object.keys(errs).length ? Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v && v.guard])) : null
          }
          runtime.push(row)
          fs.appendFileSync(progress, `${JSON.stringify(row)}\n`)
        } finally {
          registry.uninstallUserDefinition(HARNESS_DEF_ID)
        }
      }
    } finally {
      __resetRuntimePanePermission()
      __resetRuntimeAllowList()
    }

    const ms = host.map((r) => r.ms).filter((x) => typeof x === 'number').sort((a, b) => a - b)
    const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]
    const out = {
      measuredOn: new Date().toISOString(), node: process.version, bars: N_BARS, caps: { ...DEFAULT_BUDGET },
      hostSummary: { scripts: host.length, medianMs: q(0.5), p90Ms: q(0.9), p99Ms: q(0.99), maxMs: ms[ms.length - 1] },
      host, runtime,
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
    expect(host.length).toBeGreaterThan(0) // non-vacuity: the host lane served something
  })
})
