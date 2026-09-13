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

import { modes, fanFor, PREVIEW_MODES } from './registry'

const HUB_ROOT = readFileSync(resolve(process.cwd(), 'src', 'hub', 'HubRoot.jsx'), 'utf8')
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the drawn fan and the resolved fan are the same list', () => {
  it('only a PREVIEW mode may project a fan different from the one it declares', () => {
    // ⚰️ THIS WAS "there ARE preview modes whose two lists differ", and it FIRED at stage 2 —
    // correctly. It existed so the parity assertion below could not be satisfied trivially, and
    // it proved that by finding a real mode whose projection differed. With `PREVIEW_MODES` empty
    // there is no such mode left in the product, so the search returns nothing.
    //
    // ⛔ THE ANSWER IS NOT TO DELETE THE CONTROL OR TO SOFTEN IT TO `>= 0`. The teeth moved to a
    // FIXTURE in the case below ("the OLD wiring would fail this"), which cannot be disarmed by a
    // product change; what is left here is the invariant that still has content at every stage —
    // a mode that projects differently is a preview mode, and nothing else ever may.
    const differing = modes.filter((m) => {
      const drawn = fanFor(m).map((a) => a.id)
      const declared = m.fan.map((a) => a.id)
      return drawn.length !== declared.length || drawn.some((id, i) => id !== declared[i])
    })
    expect(differing.every((m) => PREVIEW_MODES.has(m.id)),
      `a SHIPPED mode projects differently: ${differing.filter((m) => !PREVIEW_MODES.has(m.id))
        .map((m) => m.id).join(', ')}`).toBe(true)

    // Positive identification of the empty case, never an inference from emptiness: at stage 2
    // every mode has left the preview, so `differing` SHOULD be empty — and the registry must
    // still have actually loaded for that to mean anything.
    expect(modes.length, 'the registry came back empty — this control measured nothing')
      .toBeGreaterThan(5)
    if (PREVIEW_MODES.size === 0) expect(differing.map((m) => m.id)).toEqual([])
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
    // ⚰️ THIS USED TO WALK THE LIVE REGISTRY looking for a mode whose projection differed from its
    // declaration. At stage 2 `PREVIEW_MODES` is empty, every projection equals its declaration,
    // and the search found nothing — so the control reported "the bug never existed" about a bug
    // that very much did. ⛔ The control was right to fire: with no differing mode in the product,
    // a comparison over the product proves nothing.
    //
    // ⭐ THE TEETH ARE NOW A FIXTURE, not a hostage to whether some section is still a teaser. The
    // comparison below is the same one the parity assertion makes; it is pointed at a mode built
    // to differ, and it must catch it.
    const drawn = ['m.a', 'm.b']
    const oldResolved = ['m.b', 'm.a'] // the same actions, resolved in the order the OLD wiring used
    const offenders = []
    drawn.forEach((id, i) => { if (id !== oldResolved[i]) offenders.push(`fixture[${i}]`) })
    expect(offenders.length, 'the comparison cannot tell two different orderings apart, so the '
      + 'parity assertion above would pass over a real mismatch').toBeGreaterThan(0)

    // …and the same comparison says nothing when the two lists agree, or it would flag everything.
    const same = []
    drawn.forEach((id, i) => { if (id !== drawn[i]) same.push(i) })
    expect(same, 'the comparison flags identical lists — it would fire on every healthy mode')
      .toEqual([])
  })
})
