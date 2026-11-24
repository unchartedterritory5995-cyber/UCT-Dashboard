// app/src/components/chart/engine/ast/knobArmsParity.test.js
//
// ─── ⭐⭐ e95 unit 2b — THE JS HALF OF THE KNOB-ARM PRUNE, HELD TO A PINNED FIXTURE ─────────────────────────────────
//
// A member's `input.string` setting that drives a `switch` is a live knob: the member door builds every arm, and ONE
// binding (its inputs) picks one (coordinator ruling 2026-11-22: prune at bind time). `tests/fixtures/ast/
// knob_arms_parity.json` is the third party: this file asserts THIS lane (`bind.js::pruneKnobArms`, inside
// `foldBound`); `tests/test_knob_arms_parity.py` asserts the Python lane against the same rows. Neither lane is the
// oracle for the other.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pruneKnobArms, foldBound, bindingConstants, pruneAtLeafDefaults } from './bind.js'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests/fixtures/ast/knob_arms_parity.json')
const CASES = JSON.parse(readFileSync(FIXTURE, 'utf8')).cases
const consts = (c) => bindingConstants({ timeframe: c.timeframe, inputs: c.inputs })

describe('the fixture is a real population', () => {
  it('⛔ non-vacuity: arms picked, arms left alone, and a refused arm picked', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(8)
    expect(CASES.some((c) => JSON.stringify(c.prunedTo) !== JSON.stringify(c.tree))).toBe(true)
    expect(CASES.some((c) => JSON.stringify(c.prunedTo) === JSON.stringify(c.tree))).toBe(true)
    expect(CASES.some((c) => JSON.stringify(c.prunedTo).includes('refusedArm'))).toBe(true)
  })
})

describe('this lane prunes to the PINNED bound tree', () => {
  for (const c of CASES) {
    it(`${c.id}: pruneKnobArms`, () => {
      expect(pruneKnobArms(c.tree, consts(c))).toEqual(c.prunedTo)
    })
    it(`${c.id}: foldBound prunes the same way`, () => {
      expect(foldBound(c.tree, consts(c))).toEqual(c.prunedTo)
    })
  }

  it('a tree with nothing to prune binds to ITSELF (the same object), so a document with no knob moves nowhere', () => {
    const c = CASES.find((x) => x.id === 'knob-absent-left-alone')
    expect(pruneKnobArms(c.tree, consts(c))).toBe(c.tree)
  })

  it('a translation tree prunes at the defaults its input leaves carry (`pruneAtLeafDefaults`, the door\'s budget pass)', () => {
    const c = CASES.find((x) => x.id === 'enum-chain-picks-week')
    const tree = JSON.parse(JSON.stringify(c.tree))
    const leaves = []
    const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.type === 'series' && n.name === 'anchor') leaves.push(n); (n.args || []).forEach(walk) }
    walk(tree)
    expect(leaves.length).toBe(3)
    for (const l of leaves) {
      Object.defineProperty(l, 'inputName', { value: 'anchor', enumerable: false })
      Object.defineProperty(l, 'inputDefault', { value: 1, enumerable: false })
    }
    expect(pruneAtLeafDefaults(tree)).toEqual(c.prunedTo)
    // a tree whose leaves carry no default is measured as it stands
    expect(pruneAtLeafDefaults(c.tree)).toBe(c.tree)
  })
})

describe('the refusing leaf, evaluated, refuses by name (`interpret.js` `FN.refusedArm`)', () => {
  it('a `refusedArm(k)` the bind kept (the setting picked it) never computes a number', async () => {
    const { interpret } = await import('./interpret.js')
    const bars = Array.from({ length: 5 }, (_, i) => ({ t: `2026-01-0${i + 1}`, o: 1, h: 2, l: 0, c: 1, v: 10 }))
    let err = null
    try { interpret({ type: 'call', name: 'refusedArm', args: [{ type: 'num', value: 1 }] }, bars) } catch (e) { err = e }
    expect(err && err.guard).toBe('interpret:refused-arm')
    expect(String(err.message)).toContain('a setting picks a branch of this script that the translator refused')
  })
})
