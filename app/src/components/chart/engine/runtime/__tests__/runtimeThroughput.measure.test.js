// app/src/components/chart/engine/runtime/__tests__/runtimeThroughput.measure.test.js
//
// ─── RUNTIME-LANE THROUGHPUT, UNDER VITEST (pine/runtime-walls-4, 2026-09-28) ──
//
// The same measurement as `app/scripts/pine-runtime-bench.mjs`, taken inside
// the test runner, because the two environments DISAGREE by an order of
// magnitude and a number quoted without its environment is not a number:
// under vitest every imported binding is read through the module runner's
// namespace object, so a hot loop that names an import per instruction pays for
// it here and nowhere else. The browser bundle binds imports directly, like the
// plain-Node bench.
//
// ⛔ OPT-IN (`PINE_BENCH=1`) and it ASSERTS NO SPEED — timing is a property of
// the box, and a timing assertion is a flaky test waiting for a busy machine.
// What it does assert is that every script ran to completion on every size, so
// a run that printed nothing cannot read as a fast one. The rails that hold
// behaviour are `runtimeSpeedParity.test.js` (byte-identical outputs) and
// `wallTime.test.js`.
//
//   PINE_BENCH=1 npx vitest run src/components/chart/engine/runtime/__tests__/runtimeThroughput.measure.test.js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import inspector from 'node:inspector'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const SCRIPTS = [
  'kernel-channel-backquant__d8c4b7f75c',
  'atr-stepped-pdf-ma-loxx__9b90a3f7bb',
  'nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125',
  'wyckoff-accumulation-distribution__d9ae726e21',
  'nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888',
]
const SIZES = (process.env.PINE_BENCH_SIZES || '1000,2000,3000').split(',').map(Number)

function build(source, bars) {
  const opts = (ownsDrawing) => ({
    bars, inputs: {}, ...runtimeClockOpts(false),
    plotColours: true, inputsReachEveryFold: true, collectInputs: true,
    ...(ownsDrawing ? { objectTrees: [] } : {}),
  })
  let built = buildRuntimeIr(source, opts(false))
  if (!built.ok && built.refusal.guard === 'runtime:object-op') built = buildRuntimeIr(source, opts(true))
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  return lowerIrProgram(built.ir)
}

describe.skipIf(!process.env.PINE_BENCH)('runtime-lane throughput (measure, opt-in)', () => {
  const all = JSON.parse(fs.readFileSync(
    path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8')).bars
  for (const name of SCRIPTS) {
    it(name, { timeout: 600000 }, () => {
      const source = fs.readFileSync(path.join(REPO, 'corpus/committed', `${name}.pine`), 'utf8')
      const lines = []
      for (const size of SIZES) {
        const bars = all.slice(-size)
        const program = build(source, bars)
        const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars, (b) => Number(b[k])))
        // ⭐ `PINE_BENCH_PROFILE=<dir>` writes a .cpuprofile of each run. `--cpu-prof`
        // cannot be used here: the runner ends its forks without the clean exit
        // Node needs to write one, so the profile is taken from inside.
        const session = process.env.PINE_BENCH_PROFILE ? new inspector.Session() : null
        if (session) {
          session.connect()
          session.post('Profiler.enable')
          session.post('Profiler.start')
        }
        const t0 = performance.now()
        const res = execute(program, {
          bars: size, series, columns: program.columns, confirmed: true,
          barTimes: bars.map((b) => (Number.isFinite(b.t) ? b.t : NaN)),
        })
        const ms = performance.now() - t0
        if (session) {
          session.post('Profiler.stop', (err, { profile }) => {
            if (!err) {
              fs.mkdirSync(process.env.PINE_BENCH_PROFILE, { recursive: true })
              fs.writeFileSync(path.join(process.env.PINE_BENCH_PROFILE,
                `${name.split('__')[0]}-${size}.cpuprofile`), JSON.stringify(profile))
            }
          })
          session.disconnect()
        }
        expect(res.outputs.every((o) => o.length === size)).toBe(true)
        lines.push(`${String(size).padStart(5)} bars  run ${(ms / (size / 1000)).toFixed(1).padStart(8)} ms/1k`)
      }
      console.log(`[bench:vitest] ${name}\n  ${lines.join('\n  ')}`)
    })
  }
})
