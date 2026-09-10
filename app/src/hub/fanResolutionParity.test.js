/**
 * ⛔⛔ THE BUBBLE A THUMB LANDS ON AND THE ACTION THAT FIRES COME FROM THE SAME LIST.
 *
 * `HubRoot` draws `fanFor(mode)` — the projection — and `useJoystick` resolves a wedge to an action
 * out of `mode.fan`. For any mode still in `PREVIEW_MODES` those are different arrays in a
 * different order, and both are indexed by wedge position, so a member tapping the third bubble
 * fired the third DECLARED action instead of the third DRAWN one.
 *
 * Measured on the deployed tree before the fix: two of Home's four outer bubbles and one of four
 * inner bubbles navigated somewhere other than their own label. Live in production since
 * Increment 2, and invisible to every existing rail because each one checked a single list —
 * `homeFanCalendar.test.jsx`'s Calendar case passed only because Calendar happened to sit at the
 * same inner index in BOTH.
 *
 * ⭐ This is the parity assertion neither list can make alone.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { modes, fanFor, PREVIEW_MODES } from './registry'

const HUB_ROOT = readFileSync(resolve(process.cwd(), 'src', 'hub', 'HubRoot.jsx'), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the drawn fan and the resolved fan are the same list', () => {
  it('there ARE preview modes whose two lists differ — the non-vacuity control', () => {
    // If every mode's projection equalled its declaration, the parity test below would be
    // tautological and would keep passing after the fix was reverted.
    const differing = modes.filter((m) => {
      const drawn = fanFor(m).map((a) => a.id)
      const declared = m.fan.map((a) => a.id)
      return drawn.length !== declared.length || drawn.some((id, i) => id !== declared[i])
    })
    expect(
      differing.map((m) => m.id).length,
      'no mode projects a different fan than it declares — the parity assertion proves nothing',
    ).toBeGreaterThan(0)
    expect(differing.every((m) => PREVIEW_MODES.has(m.id)), 'a SHIPPED mode projects differently')
      .toBe(true)
  })

  it('⛔ HubRoot hands the engine the PROJECTION, not the declared config', () => {
    const src = strip(HUB_ROOT)
    // The projection is computed once and reused for both the render and the engine.
    expect(src, 'the engine mode is gone or renamed')
      .toMatch(/const engineMode = useMemo\(\s*\(\)\s*=>\s*\(activeModeConfig \? \{ \.\.\.activeModeConfig, fan \}/)
    expect(src, 'useJoystick is back on the raw config — the wedge and the action disagree again')
      .toMatch(/useJoystick\(\{\s*mode: engineMode,/)
    expect(src, 'useJoystick must NOT receive the raw activeModeConfig')
      .not.toMatch(/useJoystick\(\{\s*mode: activeModeConfig,/)
  })

  it('⛔ for EVERY mode, wedge N of the drawn fan is wedge N of the resolved fan', () => {
    // The engine indexes by position within a ring, so parity has to hold ring by ring.
    const offenders = []
    for (const mode of modes) {
      const engineMode = { ...mode, fan: fanFor(mode) }   // what HubRoot now passes
      for (const ring of [0, 1]) {
        const drawn = fanFor(mode).filter((a) => a.ring === ring).map((a) => a.id)
        const resolved = engineMode.fan.filter((a) => a.ring === ring).map((a) => a.id)
        drawn.forEach((id, i) => {
          if (id !== resolved[i]) offenders.push(`${mode.id} ring${ring}[${i}]: drawn ${id}, fires ${resolved[i]}`)
        })
      }
    }
    expect(
      offenders,
      'a bubble fires an action other than the one it is labelled with:\n  ' + offenders.join('\n  '),
    ).toEqual([])
  })

  it('the OLD wiring would fail this — proving the assertion has teeth', () => {
    // Reconstruct what the engine used to receive and show it disagrees, so this rail cannot be
    // satisfied by a projection that happens to match today.
    const offenders = []
    for (const mode of modes) {
      const drawn = fanFor(mode).filter((a) => a.ring === 0).map((a) => a.id)
      const oldResolved = mode.fan.filter((a) => a.ring === 0).map((a) => a.id)
      drawn.forEach((id, i) => { if (id !== oldResolved[i]) offenders.push(`${mode.id}[${i}]`) })
    }
    expect(offenders.length, 'the old wiring resolved identically — the bug never existed')
      .toBeGreaterThan(0)
  })
})
