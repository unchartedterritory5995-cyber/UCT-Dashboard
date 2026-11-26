// Opt-in measurement (RUNTIME_PERF_CENSUS=limits-parity, an allowlisted remote switch; writes ../remote-out/parity):
// every corpus script the member door serves on the RUNTIME lane, run over the deepest committed daily histories with
// EVERY whole-run count LIFTED (vm.js CUMULATIVE_LIMITS) and no pane budget, so each count's honest per-bar demand is
// read rather than its stop. Three lengths (JPM newest 2,000, SPY 8,509, JPM 14,546) separate a CONSTANT per-bar cost
// from one that grows with the chart. Asserts nothing about timing.
import { describe, it, vi, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { CUMULATIVE_LIMITS } from '../../runtime/vm'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.RUNTIME_PERF_CENSUS === 'limits-parity'
const OUT = '../remote-out/parity'
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const SPY = path.join(FIX, 'machine-learning-moving-average-backquant-spy-1d-2026-11-17.json')
const JPM = path.join(FIX, 'black-scholes-option-pricing-model-w-greeks-loxx-jpm-1d-2026-11-15.json')
// WALL_TIME too: the VM's 5,000 ms backstop is not the member worker's clock (runtimePaneBudgetFor, up to 12,000 ms)
const LIFTED = { ...Object.fromEntries(CUMULATIVE_LIMITS.map((k) => [k, 1e15])), WALL_TIME: 1e9 }

function run(def, rows, symbol) {
  const bars = rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
  let counts = null; let err = null
  const t0 = performance.now()
  try {
    computeRuntimeColumns(def, bars, { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol },
      { budgetMs: 600000, limits: LIFTED, onBudget: (b) => { counts = { ...b.counts } } })
  } catch (e) { err = e }
  const perBar = {}
  if (counts) for (const k of [...CUMULATIVE_LIMITS, 'INSTRUCTIONS_PER_BAR']) perBar[k] = k === 'INSTRUCTIONS_PER_BAR' ? counts[k] : Math.round(counts[k] / rows.length)
  return { bars: rows.length, ms: Math.round(performance.now() - t0), guard: err ? (err.guard || err.name) : null,
    limit: err ? err.limit || null : null, message: err ? String(err.message).slice(0, 200) : null, counts, perBar }
}

describe.runIf(RUN)('whole-run counts over deep daily history, lifted', () => {
  it('census', () => {
    const spyCap = JSON.parse(fs.readFileSync(SPY, 'utf8'))
    const jpmCap = JSON.parse(fs.readFileSync(JPM, 'utf8'))
    const sym = (cap) => ({ ...cap.symbol, ticker: cap.symbol.name })
    const spy = spyCap.bars.rows
    const jpm = jpmCap.bars.rows
    const charts = [{ name: 'JPM-2000', rows: jpm.slice(-2000), symbol: sym(jpmCap) }, { name: 'SPY-8509', rows: spy, symbol: sym(spyCap) },
      { name: 'JPM-14546', rows: jpm, symbol: sym(jpmCap) }]
    const scripts = []
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try { door = enterMemberDoor(source) } catch { door = { def: null } }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (!door.def || !door.built || door.built.lane !== 'runtime') continue
      scripts.push({ slug: f.replace(/\.pine$/, ''), charts: charts.map((c) => ({ chart: c.name, ...run(door.def, c.rows, c.symbol) })) })
    }
    const max = {}
    for (const k of [...CUMULATIVE_LIMITS, 'INSTRUCTIONS_PER_BAR']) {
      const top = scripts.flatMap((s) => s.charts.map((c) => [c.perBar[k] || 0, s.slug, c.chart])).sort((a, b) => b[0] - a[0]).slice(0, 6)
      max[k] = top
    }
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, 'limits-parity.json'), JSON.stringify({ lifted: LIFTED, max, scripts }, null, 1))
    // eslint-disable-next-line no-console
    console.log('PARITY MAX', JSON.stringify(max))
    expect(scripts.length).toBeGreaterThan(0)
  }, 3600000)
})
