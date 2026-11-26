// app/src/components/chart/engine/displayKnob.timing.measure.test.js
//
// ⭐ e97 U6 — THE SAME-PROCESS A/B OF `plotHiddenAt`, which every binder site and the legend now ask per plot per sync.
// OPT-IN (DISPLAY_KNOB_TIMING=1): a timing is a measurement, never a rail on a shared runner. A: twelve plots with no
// `hiddenWhen` (every document saved before e97 U6); B: twelve plots each hidden by a setting. Prints microseconds per
// call and an estimate per sync (12 plots x 9 binder sites). Measured 2026-11-25 on the dev PC: A 0.02 us, B 0.22 us
// a call (B was 2.7 us before the constants were memoised by inputs content), about 0.02 ms a sync.
import { it, expect } from 'vitest'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { plotHiddenAt } from './knobBind.js'

it.skipIf(!process.env.DISPLAY_KNOB_TIMING)('e97 U6 — plotHiddenAt A/B, same process', () => {
  const H = '//@version=6\nindicator("t", overlay = true)\nshow = input.bool(false, "Show")\n'
  const plain = memberPaneDefinition({ source: H + Array.from({ length: 12 }, (_, i) => `plot(close + ${i}, "p${i}")`).join('\n') + '\n' }).definition
  const knob = memberPaneDefinition({ source: H + Array.from({ length: 12 }, (_, i) => `plot(close + ${i}, "p${i}", display = show ? display.all : display.none)`).join('\n') + '\n' }).definition
  expect(knob.plots.every((p) => p.hiddenWhen)).toBe(true)
  const inputs = { show: 1 }
  const run = (def, n) => { const t0 = performance.now(); for (let k = 0; k < n; k++) for (const p of def.plots) plotHiddenAt(p, def, inputs); return performance.now() - t0 }
  for (let r = 0; r < 3; r++) { run(plain, 2000); run(knob, 2000) }
  const N = 20000
  const a = run(plain, N)
  const b = run(knob, N)
  const per = (ms) => (ms * 1000 / (N * 12)).toFixed(3)
  console.log(`[display-knob A/B] A ${per(a)} us/call, B ${per(b)} us/call; per sync (12 plots x 9 sites) A ${(a / N * 9).toFixed(3)} ms, B ${(b / N * 9).toFixed(3)} ms`)
}, 120000)
