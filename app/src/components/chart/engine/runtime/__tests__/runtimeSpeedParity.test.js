// app/src/components/chart/engine/runtime/__tests__/runtimeSpeedParity.test.js
//
// ─── THE SPEED WORK CHANGED NO OUTPUT — BYTE FOR BYTE (pine/runtime-walls-4) ──
//
// `vm.js` was made faster on 2026-09-28 (the dispatch loop — see its header).
// A faster interpreter that answers a different number is not an optimisation,
// it is a new indicator, so this rail holds every output series of nine corpus
// scripts to the bytes the UNOPTIMISED VM produced.
//
// ⭐ THE GOLDEN WAS WRITTEN BY THE OLD VM, and committed before the change
// (`runtimeSpeedParity.golden.json`, its own commit). Each entry is the SHA-256
// of an output's raw `Float64Array` bytes — so a NaN payload, a -0 or a last-bit
// rounding difference all fail, not only a visibly different value — plus the
// budget's counts, because a charge moved or dropped by the rewrite would leave
// every series identical and a ceiling quietly somewhere else.
//
// ⛔ Regenerating the golden is `PINE_PARITY_WRITE=1` on a tree whose VM you
// trust; doing it to make this rail pass after a VM change defeats the rail.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const GOLDEN = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  'runtimeSpeedParity.golden.json')

// ⭐ The five loop-bearing scripts the 2,000-bar hold pins (kernel-channel among
// them — the script the speed work was for), plus four runtime-lane scripts
// whose programs reach the carried-state, window, history and colour opcodes
// the loop scripts barely touch.
const SCRIPTS = [
  'kernel-channel-backquant__d8c4b7f75c',
  'atr-stepped-pdf-ma-loxx__9b90a3f7bb',
  'nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125',
  'wyckoff-accumulation-distribution__d9ae726e21',
  'nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888',
  'twin-range-filter__xF3L2PeXm7',
  'range-filter-bs-signals__eCVFctFlqp',
  'btc-charlie-trader-xo-macro-trend-scanner__1f1c092d6a',
  'pivot-high-low-points__hoTsDQRY3L',
]
const BARS = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8')).bars.slice(-2000)

function runScript(name) {
  const source = fs.readFileSync(path.join(REPO, 'corpus/committed', `${name}.pine`), 'utf8')
  const opts = (ownsDrawing) => ({
    bars: BARS, inputs: {}, ...runtimeClockOpts(false),
    plotColours: true, inputsReachEveryFold: true, collectInputs: true,
    ...(ownsDrawing ? { objectTrees: [] } : {}),
  })
  let built = buildRuntimeIr(source, opts(false))
  if (!built.ok && built.refusal.guard === 'runtime:object-op') built = buildRuntimeIr(source, opts(true))
  if (!built.ok) throw new Error(`${name} refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS, (b) => Number(b[k])))
  const res = execute(program, {
    bars: BARS.length, series, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => (Number.isFinite(b.t) ? b.t : NaN)),
  })
  const sha = (f64) => crypto.createHash('sha256')
    .update(Buffer.from(f64.buffer, f64.byteOffset, f64.byteLength)).digest('hex')
  return {
    outputs: res.outputs.map((o, i) => ({
      call: program.outputs[i].call,
      finite: Array.from(o).filter(Number.isFinite).length,
      sha256: sha(o),
    })),
    counts: { ...res.budget.counts },
  }
}

if (process.env.PINE_PARITY_WRITE === '1') {
  const out = { _: 'Written by the pre-optimisation VM, 2026-09-28. See runtimeSpeedParity.test.js.',
    bars: `SPY 1D, last ${BARS.length} of tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json`,
    scripts: {} }
  for (const name of SCRIPTS) out.scripts[name] = runScript(name)
  fs.writeFileSync(GOLDEN, `${JSON.stringify(out, null, 2)}\n`)
}

describe('⭐ the optimised VM answers byte-for-byte what the old one did', () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))

  it('⛔ CONTROL: the golden covers every script named here, each with outputs', () => {
    expect(Object.keys(golden.scripts).sort()).toEqual([...SCRIPTS].sort())
    for (const name of SCRIPTS) {
      expect(golden.scripts[name].outputs.length, name).toBeGreaterThan(0)
      // a golden of all-`na` columns would pass against a VM that computed nothing
      expect(golden.scripts[name].outputs.some((o) => o.finite > 0), name).toBe(true)
    }
  })

  for (const name of SCRIPTS) {
    it(`${name} — every output series and every budget count`, { timeout: 120000 }, () => {
      const got = runScript(name)
      expect(got.outputs).toEqual(golden.scripts[name].outputs)
      expect(got.counts).toEqual(golden.scripts[name].counts)
    })
  }
})
