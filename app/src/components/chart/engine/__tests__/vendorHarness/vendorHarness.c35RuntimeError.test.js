// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c35RuntimeError.test.js
//
// ─── C35 — `runtime.error` IS A STOP WHERE IT IS REACHED, AND NOTHING WHERE IT IS NOT ─
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from the
// listing day). `ema-ribbon-trend-filter-strixedge` validates its inputs on its
// first bar:
//
//     if barstate.isfirst and not (fastLen < midLen and midLen < slowLen)
//         runtime.error("Periods must be ascending: Fast < Mid < Slow")
//
// At the captured inputs (8 / 21 / 55) TradingView ran the script and drew it (its
// 48-cell dashboard is in the capture): the statement was not reached. Where it IS
// reached TradingView stops the script and shows the error instead of the
// indicator. No committed capture shows that case, so this lane models it as a
// STOP BY NAME (`runtime:runtime.error` — nothing is drawn from the run), never a
// value; the capture that would witness it is queued in the triage doc (§ C35).
//
// ⛔ Before C35 the runtime lane refused the whole script at line 53
// (`runtime:expression-statement`). It now lowers the statement and stops on the
// script's next wall — a `request.security` below the chart's timeframe, named by
// the host's own C27 code with the capture that settles it.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { lowerIrProgram } from '../../runtime/lowerIr'
import { execute } from '../../runtime/vm'
import { PineRuntimeError } from '../../runtime/collections'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28.json')

const load = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

/** The vendor's three period inputs and its validation, verbatim, plus a plot. */
function validationScript(source, fastDefault = null) {
  const lines = source.split(/\r?\n/)
  const pick = (re) => {
    const hit = lines.filter((l) => re.test(l))
    expect(hit.length, String(re)).toBe(1)
    return hit[0]
  }
  let fast = pick(/^int\s+fastLen\s*=/)
  if (fastDefault !== null) fast = fast.replace(/input\.int\(8,/, `input.int(${fastDefault},`)
  const at = lines.findIndex((l) => l.startsWith('if barstate.isfirst and not (fastLen < midLen'))
  expect(at).toBeGreaterThan(0)
  expect(lines[at + 1]).toMatch(/^\s+runtime\.error\("Periods must be ascending/)
  return ['//@version=6', 'indicator("c35 runtime.error")', fast, pick(/^int\s+midLen\s*=/),
    pick(/^int\s+slowLen\s*=/), lines[at], lines[at + 1], 'plot(close)', ''].join('\n')
}

function run(src, rows) {
  const built = buildRuntimeIr(src, { bars: rows, inputs: {}, pane: true, basePeriod: 'D', tf: 'D' })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k])))
  return () => execute(program, {
    bars: rows.length, series, columns: program.columns, confirmed: true, barTimes: rows.map((b) => b.t),
  })
}

describe('C35 — ema-ribbon\'s `runtime.error` (RDDT 1D)', () => {
  it('⭐ at the captured inputs the statement is not reached: the run completes, as TradingView\'s did', () => {
    const cap = load()
    const rows = toProductBars(cap)
    const res = run(validationScript(cap.source.text), rows)()
    const col = Array.from(res.outputs[0])
    expect(col.length).toBe(632)
    col.forEach((v, i) => expect(v, `bar ${i}`).toBe(rows[i].c))
  }, 60000)

  it('⛔ reached (a Fast period of 60 > Mid), the run STOPS by name with the author\'s message', () => {
    const cap = load()
    const rows = toProductBars(cap)
    let err = null
    try { run(validationScript(cap.source.text, 60), rows)() } catch (e) { err = e }
    expect(err).toBeInstanceOf(PineRuntimeError)
    expect(err.name).toBe('runtime.error')
    expect(err.message).toBe('Periods must be ascending: Fast < Mid < Slow')
  }, 60000)

  it('⛔ the script as written now stops on its next wall, named by the host\'s lower-timeframe code', () => {
    // ⚰️ C41 (2026-09-30): this read `lower-tf:unwitnessed` with the Q-L1 capture
    // named as what would settle it. Q-L1 was captured and the HOST lane serves
    // the read now (an `ltf` node off the symbol's intraday bars); the per-bar
    // runtime lane holds no intraday bars, so the same line stops it under a
    // different name (`pineRuntimeFrontend.js`, `LOWER_TF_REFUSAL.RUNTIME_LANE`).
    // ⭐ …and that is with the host's read SERVED (`VITE_PINE_LOWER_TF_ENABLED`,
    // `lowerTfGate.js`). It ships OFF: then the host itself refuses the read first
    // (`lower-tf:store-unmeasured`), on the same line.
    const cap = load()
    const build = () => buildRuntimeIr(cap.source.text, { bars: [], inputs: {}, pane: true, basePeriod: 'D', tf: 'D' })
    const off = build()
    expect(off.ok).toBe(false)
    expect(off.refusal.guard).toBe('lower-tf:store-unmeasured')
    expect(off.refusal.line).toBe(156)
    vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')
    try {
      const built = build()
      expect(built.ok).toBe(false)
      expect(built.refusal.guard).toBe('lower-tf:runtime-lane')
      expect(built.refusal.line).toBe(156)
      expect(built.refusal.message).toContain('intraday bars')
    } finally { vi.unstubAllEnvs() }
  }, 60000)
})
