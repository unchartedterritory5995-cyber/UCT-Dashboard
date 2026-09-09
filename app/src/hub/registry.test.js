// Joystick hub — the registry's rail. Every validateRegistry() rule gets a fixture that FAILS it.
// See docs/plans/joystick/00-master-spec-v1.3.md §4, and 30-phase1-plan.md §5.
//
// ⭐ WHY THIS FILE CARRIES MORE WEIGHT THAN A NORMAL TEST: this app has no TypeScript — no tsconfig,
// no `typescript` dependency, 0 .ts files across 1,332 .jsx — so the JSDoc typedefs in registry.js are
// checked by NOTHING at build time. `validateRegistry()` is the only enforcement that exists, and this
// file is the only thing that proves the validator itself can fail. A validator nobody has watched
// reject something is not a validator (`lesson_gate_that_cannot_fail`).
//
// ⛔ EVERY RULE BELOW ASSERTS BOTH DIRECTIONS: a bad fixture is rejected AND a good one is accepted.
// A one-sided test passes just as happily against a validator that returns a problem for everything.

import { describe, it, expect } from 'vitest'
import {
  modes,
  modesById,
  validateRegistry,
  defineMode,
  HUB_REQUIREMENTS,
  OUTER_MAX,
  INNER_MAX,
  HOME_MODE_ID,
} from './registry.js'
import { UICON_NAMES } from '../components/ui/UIcon.jsx'

// ── Fixture helpers ─────────────────────────────────────────────────────────
// A minimal VALID mode. Each rule's fixture starts here and breaks exactly one thing, so a failure
// names one cause instead of a soup of them.

const voice = (mode = 'test') => ({
  id: `${mode}.voice`, label: 'Voice', icon: 'mic', ring: 1, color: `--hub-mode-${mode}`, kind: 'run',
})
const home = (mode = 'test') => ({
  id: `${mode}.home`, label: 'Home', icon: 'compass', ring: 1, color: '--hub-mode-home', kind: 'home',
})
const outerAction = (n, extra = {}) => ({
  id: `test.a${n}`, label: `A${n}`, icon: 'chart', ring: 0, color: '--hub-mode-scan', kind: 'run', ...extra,
})

const validMode = (over = {}) =>
  defineMode({
    id: 'test',
    label: 'Test',
    color: '--hub-mode-scan',
    route: '/test',
    tapHint: 'tap: nothing',
    fan: [outerAction(1), voice(), home()],
    ...over,
  })

/** Assert the validator produced a problem whose text names the thing we broke. */
const expectProblem = (fixture, needle) => {
  const problems = validateRegistry([fixture])
  expect(problems.join('\n')).toContain(needle)
  return problems
}

// A counter proving cases actually executed. `vitest -t` is a REGEX: a filter matching nothing exits 0
// and reads as a PASS, so a green run says nothing unless something counted the cases.
let executed = 0
const ran = () => { executed += 1 }

describe('validateRegistry — the shipped registry', () => {
  it('accepts the real registry, with the real icon names', () => {
    ran()
    expect(validateRegistry(modes, { iconNames: UICON_NAMES })).toEqual([])
  })

  it('seeds exactly the ten agreed modes', () => {
    ran()
    expect(modes.map((m) => m.id)).toEqual([
      'wire', 'breadth', 'scan', 'chart', 'journal',
      'catalysts', 'notebook', 'calendar', 'home', 'flow',
    ])
    expect(Object.keys(modesById)).toHaveLength(10)
  })

  it('accepts a minimal valid mode (the control — proves the fixtures are not just always-bad)', () => {
    ran()
    expect(validateRegistry([validMode()])).toEqual([])
  })
})

describe('validateRegistry — ring caps', () => {
  it('rejects an outer ring over the cap', () => {
    ran()
    const fan = [...Array(OUTER_MAX + 1)].map((_, i) => outerAction(i))
    expectProblem(validMode({ fan: [...fan, voice(), home()] }), `outer ring has ${OUTER_MAX + 1}`)
  })

  it('rejects an inner ring over the cap', () => {
    ran()
    const inner = [...Array(INNER_MAX)].map((_, i) => ({
      id: `test.i${i}`, label: `I${i}`, icon: 'chart', ring: 1, color: '--hub-mode-scan', kind: 'run',
    }))
    expectProblem(validMode({ fan: [voice(), ...inner, home()] }), `inner ring has ${INNER_MAX + 2}`)
  })

  it('accepts a ring exactly at the cap', () => {
    ran()
    const fan = [...Array(OUTER_MAX)].map((_, i) => outerAction(i))
    expect(validateRegistry([validMode({ fan: [...fan, voice(), home()] })])).toEqual([])
  })
})

describe('validateRegistry — the Home invariant', () => {
  it('rejects an inner ring that does not end with Home', () => {
    ran()
    expectProblem(
      validMode({ fan: [outerAction(1), home(), voice()] }),
      "inner ring must end with a kind:'home' action",
    )
  })

  it('rejects a mode with no Home at all', () => {
    ran()
    expectProblem(validMode({ fan: [outerAction(1), voice()] }), "must end with a kind:'home'")
  })

  it('rejects a Home action inside the home mode itself', () => {
    ran()
    expectProblem(
      validMode({ id: HOME_MODE_ID, fan: [outerAction(1), voice(HOME_MODE_ID), home(HOME_MODE_ID)] }),
      'must NOT carry a Home action',
    )
  })

  it('accepts the home mode ending its inner ring with Voice', () => {
    ran()
    expect(
      validateRegistry([validMode({ id: HOME_MODE_ID, fan: [outerAction(1), voice(HOME_MODE_ID)] })]),
    ).toEqual([])
  })
})

describe('validateRegistry — Voice on every mode', () => {
  it('rejects a mode with no Voice action', () => {
    ran()
    expectProblem(validMode({ fan: [outerAction(1), home()] }), 'missing a Voice action')
  })
})

describe('validateRegistry — confirm actions', () => {
  it("rejects kind:'confirm' with no confirmText", () => {
    ran()
    expectProblem(
      validMode({ fan: [outerAction(1, { kind: 'confirm' }), voice(), home()] }),
      "requires a confirmText",
    )
  })

  it("accepts kind:'confirm' with a confirmText", () => {
    ran()
    expect(
      validateRegistry([
        validMode({ fan: [outerAction(1, { kind: 'confirm', confirmText: () => 'ok', escalate: true }), voice(), home()] }),
      ]),
    ).toEqual([])
  })

  it('every confirm action in the shipped registry has a confirmText that returns a string', () => {
    ran()
    const confirms = modes.flatMap((m) => m.fan).filter((a) => a.kind === 'confirm')
    expect(confirms.length).toBeGreaterThan(0)
    for (const a of confirms) {
      expect(typeof a.confirmText({ symbol: 'NVDA', selectedPosition: { symbol: 'NVDA' } })).toBe('string')
    }
  })
})

describe('validateRegistry — flickable', () => {
  // ⛔ B3 WIDENED THIS RULE, and the reason is that the old one described the wrong mechanism.
  // `flickable:false` is a guard on an action that FIRES, and the runtime gate that honours it
  // (`useJoystick.js:387`, `flickTarget.action.flickable !== false`) never looks at `kind` — so it
  // was always live on a 'run', and the validator was rejecting a declaration the engine obeyed.
  // What still deserves rejection is 'navigate'/'home': nothing fires, so a guard there is a claim
  // of danger where there is none.

  it("rejects flickable:false on kind:'navigate' — nothing fires, so there is nothing to guard", () => {
    ran()
    expectProblem(
      validMode({ fan: [outerAction(1, { kind: 'navigate', to: '/x', flickable: false }), voice(), home()] }),
      'only meaningful',
    )
  })

  it("rejects flickable:false on kind:'home'", () => {
    ran()
    expectProblem(
      validMode({ fan: [outerAction(1), voice(), { ...home(), flickable: false }] }),
      'only meaningful',
    )
  })

  it("ACCEPTS flickable:false on kind:'run' — the B3 case, and the rule's one live consumer", () => {
    ran()
    expect(
      validateRegistry([validMode({ fan: [outerAction(1, { flickable: false }), voice(), home()] })]),
    ).toEqual([])
  })

  it("ACCEPTS flickable:false on kind:'confirm' — the case that was always legal", () => {
    ran()
    expect(
      validateRegistry([validMode({
        fan: [outerAction(1, { kind: 'confirm', confirmText: () => 'ok', flickable: false, escalate: true }), voice(), home()],
      })]),
    ).toEqual([])
  })

  it("Journal's Close is a flickable:false kind:'run' — the safety marker this rule exists for", () => {
    ran()
    const close = modesById.journal.fan.find((a) => a.id === 'journal.close')
    expect(close.flickable).toBe(false)
    expect(close.kind).toBe('run')
  })
})

describe('validateRegistry — escalate (B5)', () => {
  // ⛔ THE OLD INVARIANT, KEPT AS A RULE. Before B3, "fires warn()" and "kind:'confirm'" were the
  // same set by accident of implementation (`useJoystick.js` branched on kind). B3 moved the
  // Journal's three committing actions to 'run' and the haptic set silently shrank by three —
  // Close included — with every test green. The marker makes the cue declarative; this rule stops
  // the set shrinking that way again.

  it("rejects kind:'confirm' without escalate:true — a confirm always escalates", () => {
    ran()
    expectProblem(
      validMode({ fan: [outerAction(1, { kind: 'confirm', confirmText: () => 'ok' }), voice(), home()] }),
      'requires escalate:true',
    )
  })

  it("accepts kind:'confirm' with escalate:true", () => {
    ran()
    expect(validateRegistry([validMode({
      fan: [outerAction(1, { kind: 'confirm', confirmText: () => 'ok', escalate: true }), voice(), home()],
    })])).toEqual([])
  })

  it("ACCEPTS escalate:true on kind:'run' — the inverse rule is deliberately absent, and that is the point", () => {
    ran()
    // B3's three actions are exactly this shape. A rule requiring 'confirm' for the marker would
    // have forced them back into the stacking defect to keep their haptic.
    expect(validateRegistry([validMode({
      fan: [outerAction(1, { escalate: true }), voice(), home()],
    })])).toEqual([])
  })

  it('the shipped escalate set is the five actions that fired warn() before B3', () => {
    ran()
    const escalating = modes.flatMap((m) => m.fan).filter((a) => a.escalate === true).map((a) => a.id)
    expect(escalating.sort()).toEqual([
      'chart.alert',
      'journal.breakeven',
      'journal.close',
      'journal.moveStop',
      'scan.alert',
    ])
  })

  it('every kind:"confirm" action in the shipped registry carries the marker', () => {
    ran()
    const confirms = modes.flatMap((m) => m.fan).filter((a) => a.kind === 'confirm')
    expect(confirms.length).toBeGreaterThan(0)   // control: the filter is not vacuous
    for (const a of confirms) expect(a.escalate, `${a.id}`).toBe(true)
  })
})

describe('validateRegistry — navigate actions', () => {
  it("rejects kind:'navigate' with no 'to'", () => {
    ran()
    expectProblem(validMode({ fan: [outerAction(1, { kind: 'navigate' }), voice(), home()] }), "requires a 'to'")
  })
})

describe('validateRegistry — ids', () => {
  it('rejects a duplicate action id', () => {
    ran()
    expectProblem(
      validMode({ fan: [outerAction(1), outerAction(1), voice(), home()] }),
      'duplicate action id: test.a1',
    )
  })

  it('rejects a duplicate mode id', () => {
    ran()
    const problems = validateRegistry([validMode(), validMode()])
    expect(problems.join('\n')).toContain('duplicate mode id: test')
  })
})

describe('validateRegistry — requires', () => {
  it('rejects an unknown requires value', () => {
    ran()
    expectProblem(
      validMode({ fan: [outerAction(1, { requires: ['brokerage'] }), voice(), home()] }),
      'unknown requires value "brokerage"',
    )
  })

  it('accepts every allowed literal', () => {
    ran()
    expect(
      validateRegistry([validMode({ fan: [outerAction(1, { requires: HUB_REQUIREMENTS }), voice(), home()] })]),
    ).toEqual([])
  })
})

describe('validateRegistry — labels and icons', () => {
  it('rejects a label over 10 characters', () => {
    ran()
    expectProblem(validMode({ fan: [outerAction(1, { label: 'Eleven chars' }), voice(), home()] }), 'max 10')
  })

  it('rejects a missing icon — colour is never the only signal', () => {
    ran()
    expectProblem(validMode({ fan: [outerAction(1, { icon: undefined }), voice(), home()] }), 'missing icon')
  })

  it('rejects an icon that is not in the UIcon registry, when icon names are supplied', () => {
    ran()
    const problems = validateRegistry(
      [validMode({ fan: [outerAction(1, { icon: 'definitelyNotAGlyph' }), voice(), home()] })],
      { iconNames: UICON_NAMES },
    )
    expect(problems.join('\n')).toContain('is not in the UIcon registry')
  })

  it('every label in the shipped registry is 10 chars or fewer', () => {
    ran()
    const tooLong = modes.flatMap((m) => m.fan).filter((a) => a.label.length > 10)
    expect(tooLong.map((a) => `${a.id}:${a.label}`)).toEqual([])
  })
})

describe('validateRegistry — colours are tokens, never literals', () => {
  it('rejects a hex literal in an action colour', () => {
    ran()
    expectProblem(validMode({ fan: [outerAction(1, { color: '#67DB44' }), voice(), home()] }), 'must be a CSS custom-property')
  })

  it('every colour in the shipped registry is a custom-property name', () => {
    ran()
    const literals = modes.flatMap((m) => m.fan).filter((a) => !a.color.startsWith('--'))
    expect(literals.map((a) => a.id)).toEqual([])
  })
})

describe('validateRegistry — tiers are gone', () => {
  it("rejects any action carrying a 'tier'", () => {
    ran()
    expectProblem(validMode({ fan: [outerAction(1, { tier: 'founder' }), voice(), home()] }), 'there are no tiers')
  })
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    expect(executed).toBeGreaterThanOrEqual(24)
  })
})
