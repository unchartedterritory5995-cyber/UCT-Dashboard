// app/scripts/pine-runtime-bench.mjs
//
// ─── RUNTIME-LANE THROUGHPUT BENCH (pine/runtime-walls-4, 2026-09-28) ─────────
//
// Runs the loop-bearing scripts the 2,000-bar hold pins
// (`runtimeWallsNewlyAttaching.test.js`) through the runtime lane — front end →
// `lowerIrProgram` → `execute` — on the committed SPY daily fixture at 1,000 /
// 2,000 / 3,000 bars, and prints ms per 1,000 bars for the BUILD and the RUN
// separately, so a slow script says which half is slow.
//
// ⭐ DETERMINISTIC INPUT: the last N bars of
// `tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json`, every input at the
// author's default, the clock told `false` (settled) — the fixture the door uses.
//
// ⛔ NOT A TEST. Timing is a property of the box. The rails that hold behaviour
// are `runtimeSpeedParity.test.js` (byte-identical outputs) and the wall rails.
//
// Run from `app/` (plain Node cannot resolve this tree's extensionless imports,
// so the bench is bundled first):
//
//   npx esbuild scripts/pine-runtime-bench.mjs --bundle --platform=node \
//     --format=esm --outfile=<somewhere outside the repo>/bench.mjs --log-level=warning
//   node <that>/bench.mjs [--reps 3] [--sizes 1000,2000,3000] [--only kernel]
//   node --cpu-prof --cpu-prof-dir=<dir> <that>/bench.mjs --only kernel --sizes 2000 --reps 1
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../src/components/chart/engine/ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../src/components/chart/engine/ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../src/components/chart/engine/runtime/lowerIr.js'
import { execute } from '../src/components/chart/engine/runtime/vm.js'

const REPO = path.resolve(process.cwd(), '..')
const SCRIPTS = [
  'kernel-channel-backquant__d8c4b7f75c',
  'atr-stepped-pdf-ma-loxx__9b90a3f7bb',
  'nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125',
  'wyckoff-accumulation-distribution__d9ae726e21',
  'nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888',
]

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const REPS = Number(arg('reps', '3'))
const SIZES = arg('sizes', '1000,2000,3000').split(',').map(Number)
const ONLY = arg('only', '')
// ⭐ `--stat min` on a contended box: the fastest of N runs is the one least
// disturbed by other processes, so A/B comparisons read it rather than a median.
const STAT = arg('stat', 'median')

const ALL = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8')).bars

function runOnce(source, bars) {
  const t0 = performance.now()
  const opts = (ownsDrawing) => ({
    bars, inputs: {}, ...runtimeClockOpts(false),
    plotColours: true, inputsReachEveryFold: true, collectInputs: true,
    // ⭐ as the door does for a script whose drawings the object program owns
    ...(ownsDrawing ? { objectTrees: [] } : {}),
  })
  let built = buildRuntimeIr(source, opts(false))
  if (!built.ok && built.refusal.guard === 'runtime:object-op') built = buildRuntimeIr(source, opts(true))
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const t1 = performance.now()
  const n = bars.length
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars, (b) => Number(b[k])))
  const res = execute(program, {
    bars: n, series, columns: program.columns, confirmed: true,
    barTimes: bars.map((b) => (Number.isFinite(b.t) ? b.t : NaN)),
  })
  const t2 = performance.now()
  return { buildMs: t1 - t0, runMs: t2 - t1, instructions: res.budget.counts.TOTAL_INSTRUCTIONS }
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const pick = (xs) => (STAT === 'min' ? Math.min(...xs) : median(xs))

console.log(`node ${process.version} · reps ${REPS} (${STAT}) · SPY 1D fixture`)
console.log('script'.padEnd(34), 'bars'.padStart(5), 'build ms/1k'.padStart(12),
  'run ms/1k'.padStart(10), 'total ms/1k'.padStart(12), 'instr/bar'.padStart(10))
for (const name of SCRIPTS) {
  if (ONLY && !name.includes(ONLY)) continue
  const source = fs.readFileSync(path.join(REPO, 'corpus/committed', `${name}.pine`), 'utf8')
  for (const size of SIZES) {
    const bars = ALL.slice(-size)
    const runs = []
    for (let r = 0; r < REPS; r += 1) runs.push(runOnce(source, bars))
    const b = pick(runs.map((x) => x.buildMs)) / (size / 1000)
    const e = pick(runs.map((x) => x.runMs)) / (size / 1000)
    console.log(name.slice(0, 34).padEnd(34), String(size).padStart(5), b.toFixed(1).padStart(12),
      e.toFixed(1).padStart(10), (b + e).toFixed(1).padStart(12),
      String(Math.round(runs[0].instructions / size)).padStart(10))
  }
}
