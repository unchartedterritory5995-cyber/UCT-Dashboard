// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.w19h1LoopInBlock.test.js
//
// ─── ⭐⭐ W19-H1 — A TOP-LEVEL NAME WRITTEN BELOW A LOOP INSIDE AN `if` ──────
//
// The main walk refused a whole `if` chain at its loop (`pine:reassign` "… and
// the fold stopped before it, at line N: … `for`"), so every top-level name the
// chain writes was lost — also the ones no loop touches. C46 built the fold that
// steps over the loop (branch `pine/c46-stepover-trial`) and kept it off the lane
// because no capture showed what TradingView draws there (Q-C46a). The capture
// now exists: `vw-loop-in-block-spy-1d-2026-10-02.json` (AMEX:SPY 1D, 1,800
// bars), probe `tools/visual_conformance/probes/vw-loop-in-block.pine`.
//
// What the capture settles, graded by the harness's own comparator:
//   L02 `m` written BELOW a `for` that does not touch it  — MATCH
//   L03 the same chain with no loop                       — MATCH (= L02)
//   L06 `e` written ABOVE the loop in the same block       — MATCH
//   L07 `w` written below a `while`                        — MATCH
//   L08 `k` in the `else` arm of the chain holding the loop — MATCH
// L04 `acc` (the loop's own running total) and L05 (derived from it) stay refused
// by name — ruling R7 puts a loop accumulator on the runtime lane — so the full
// probe still refuses at the door, naming `acc`. To grade the five names the host
// lane now serves, our side runs the probe with the two refused `plot` lines
// removed (a `plot` has no effect on any other value) and the comparator pairs
// what remains by title against the vendor's own columns.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { loadCapture, gradeCapture, enterDoorState, REPO } from './harness'
import { runOurSide, HARNESS_DEF_ID } from './ourSide'
import { compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'

const FILE = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'vw-loop-in-block-spy-1d-2026-10-02.json')
const SERVED = ['L02_m_below_loop', 'L03_m_no_loop', 'L06_e_above_loop', 'L07_w_below_while', 'L08_k_else_arm']
const REFUSED = ['L04_acc_loop_written', 'L05_d_from_loop_total']

let CAP = null
const cap = () => {
  if (CAP) return CAP
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(loaded.reason)
  CAP = loaded.capture
  return CAP
}
/** The probe minus the plot lines of the names R7 keeps refused. */
const servedSource = () => {
  const text = cap().source.text
  const lines = text.split('\n')
  const kept = lines.filter((l) => !REFUSED.some((t) => l.includes(`"${t}"`)))
  expect(lines.length - kept.length, 'exactly the two refused plot lines are removed').toBe(2)
  return kept.join('\n')
}
const gradeServed = () => {
  const c = cap()
  const ours = runOurSide({ ...c, source: { ...c.source, text: servedSource() } })
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  return { ours, verdict: compareCapture(c, ours) }
}

afterEach(() => {
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  vi.unstubAllEnvs()
})

describe('W19-H1 — the main walk steps over a loop inside an `if` chain (Q-C46a)', () => {
  for (const state of ['off', 'on']) {
    it(`⭐⭐ [${state}] the five names the loop does not write MATCH the vendor on every compared bar`, () => {
      enterDoorState(state)
      const { ours, verdict } = gradeServed()
      expect(ours.ok, String(ours.refusal)).toBe(true)
      for (const title of SERVED) {
        const p = verdict.plots.find((x) => x.title === title)
        expect(p, `${title} paired`).toBeTruthy()
        expect(p.verdict, `${title}: ${JSON.stringify(p.firstDivergence || p.reason || null)}`).toBe('MATCH')
        // non-vacuity: a MATCH over drawn bars, not over an empty column
        expect(p.stats.compared, `${title} compared bars`).toBeGreaterThan(1000)
        expect(p.stats.valued, `${title} drawn bars`).toBeGreaterThan(400)
      }
    })
  }

  it('⛔ the control: L02 and L03 are the same column on our side (loop vs no loop)', () => {
    enterDoorState('off')
    const { ours } = gradeServed()
    const col = (t) => ours.plots.find((p) => p.title === t).column
    const a = col('L02_m_below_loop')
    const b = col('L03_m_no_loop')
    expect(a.length).toBe(cap().bars.rows.length)
    let drawn = 0
    for (let i = 0; i < a.length; i += 1) {
      expect(Object.is(a[i], b[i]) || a[i] === b[i], `bar ${i}`).toBe(true)
      if (Number.isFinite(a[i]) && a[i] !== 0) drawn += 1
    }
    expect(drawn).toBeGreaterThan(500)
  })

  it('⛔⛔ the full probe still refuses — by the name the LOOP writes (`acc`, ruling R7)', () => {
    enterDoorState('off')
    const { verdict, ours } = gradeCapture(cap())
    expect(ours.ok).toBe(false)
    expect(String(ours.refusal)).toMatch(/pine:reassign/)
    expect(String(ours.refusal)).toMatch(/`acc` — a running total built inside a `for`/)
    expect(verdict.verdict).toBe('INCONCLUSIVE')
  })
})
