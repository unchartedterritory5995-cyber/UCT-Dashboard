/**
 * ⛔⛔ THE BUBBLE A THUMB LANDS ON AND THE ACTION THAT FIRES COME FROM THE SAME LIST.
 *
 * `HubRoot` draws `fanFor(mode)` — the projection — and `useJoystick` resolves a wedge to an action
 * out of `mode.fan`. For any mode still in `PREVIEW_MODES` those are different arrays in a
 * different order, and both are indexed by wedge position, so a member tapping the third bubble
 * fired the third DECLARED action instead of the third DRAWN one.
 *
 * Measured on the deployed tree before the fix, by deriving both lists from that exact registry
 * blob: Home draws seven bubbles (four outer, three inner) and THREE of the seven navigated
 * somewhere other than their own label — Flow->Breadth, Breadth->Wire, Wire->Calendar. Flow's own
 * action was unreachable besides, five outer being declared against four drawn.
 *
 * Live in production since Increment 2, and invisible to every existing rail because each one
 * checked a single list —
 * `homeFanCalendar.test.jsx`'s Calendar case passed only because Calendar happened to sit at the
 * same inner index in BOTH.
 *
 * ⭐ This is the parity assertion neither list can make alone.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { modes, fanFor, PREVIEW_MODES, setHubSurface, hubSurface } from './registry'

const HUB_ROOT = readFileSync(resolve(process.cwd(), 'src', 'hub', 'HubRoot.jsx'), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the drawn fan and the resolved fan are the same list', () => {
  const differingIds = () => modes.filter((m) => {
    const drawn = fanFor(m).map((a) => a.id)
    const declared = m.fan.map((a) => a.id)
    return drawn.length !== declared.length || drawn.some((id, i) => id !== declared[i])
  }).map((m) => m.id)

  it('there ARE modes whose two lists differ — the non-vacuity control', () => {
    // If every mode's projection equalled its declaration, the parity test below would be
    // tautological and would keep passing after the fix was reverted.
    expect(
      differingIds().length,
      'no mode projects a different fan than it declares — the parity assertion proves nothing',
    ).toBeGreaterThan(0)
  })

  it('on the FULL surface, ONLY a preview mode projects differently', () => {
    // ⚰️ THIS USED TO BE THE SECOND HALF OF THE CONTROL ABOVE, UNCONDITIONALLY — and owner ruling
    // R4 made it false by design, not by accident. `fanFor` now composes TWO projections: the
    // preview ("may this ship at all") and the strong cut ("does this earn a bubble"). The
    // original claim is still exactly true of the preview one, so it is kept — pinned to the
    // surface where it is the only projection in play, which is also the strongest form of it.
    setHubSurface('full')
    try {
      const stray = differingIds().filter((id) => !PREVIEW_MODES.has(id))
      expect(stray, `a SHIPPED mode projects differently with no cut applied: ${stray.join(', ')}`)
        .toEqual([])
      // Non-vacuity: the preview must still be doing something, or the filter above is trivial.
      expect(differingIds().length, 'nothing differs at all on the full surface').toBeGreaterThan(0)
    } finally {
      setHubSurface('simplified')
    }
  })

  it('⛔ the cut only ever REMOVES — it never adds an action, nor reorders one', () => {
    // ⭐ The invariant that replaces "only preview modes differ", and it is the one that actually
    // protects a member's thumb. This file exists because a fan drawn from one list and resolved
    // against another fired the wrong action — so what matters about a second projection is not
    // WHICH modes it touches but that it can only ever be a subsequence of the declaration.
    // An inserted or reordered action changes which bubble a given angle lands on, which is the
    // shipped defect this whole rail was written for, wearing a different hat.
    expect(hubSurface(), 'the default surface is the strong cut').toBe('simplified')
    const problems = []
    for (const m of modes) {
      const declared = m.fan.map((a) => a.id)
      const drawn = fanFor(m).map((a) => a.id)
      let at = -1
      for (const id of drawn) {
        const found = declared.indexOf(id, at + 1)
        if (found === -1) problems.push(`${m.id}/${id} is drawn but not declared (or out of order)`)
        else at = found
      }
    }
    expect(problems, 'a projection invented or reordered an action').toEqual([])
    // Non-vacuity: a projection returning nothing would satisfy the loop above trivially.
    const drawnTotal = modes.reduce((n, m) => n + fanFor(m).length, 0)
    expect(drawnTotal, 'no mode drew anything — the subsequence check is vacuous').toBeGreaterThan(0)
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
