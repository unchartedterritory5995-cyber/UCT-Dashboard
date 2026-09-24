// app/src/components/chart/builder/memberPane/objectsOnlyAnchorMode.test.js
//
// ─── ⭐⭐ AN OBJECTS-ONLY DEFINITION MUST INSTALL — THE ANCHOR'S MODE ────────
//
// The dashboard the runtime lane exists for (a table-only script, with objects
// and zero output rows) built end to end through `translatePine → paneGate →
// buildDefinition`, but `installUserDefinitions` refused it with:
//
//   `u_member-pane: meta.repaint — declared "repaints" but the linter MEASURES
//    "non-repainting" (forward=0) — every bar this output depends on is at or
//    before its own index.`
//
// The declaration is `meta.repaint = worstRepaint([primary.mode])`, and
// `primary` on the zero-rows path is `OBJECTS_ONLY_ANCHOR` — whose `mode` was
// the string `'clean'`. `'clean'` is not in `REPAINT_MODES` (which is
// `['non-repainting', 'preview-repaints', 'repaints']`), so `worstOf` treats it
// as unknown and fails CLOSED to `'repaints'` — the worst — while the linter
// measuring a literal `0` returns `'non-repainting'`. **The document is refused
// because its own default is a vocabulary the door does not speak.**
//
// ⛔⛔ THIS RAIL EXISTS BECAUSE THE MEMBER-VISIBLE END-TO-END TRIP FAILED.
// `MemberPane.test.jsx` mocks `ChartPane` and never runs the install, so every
// case there is about what the pane is HANDED and none can see this. The rail
// below reproduces the whole chain — `memberPaneDefinition` →
// `installUserDefinitions` — and would have gone red the first time the objects-
// only path was walked live.
//
// ⭐ THE CONTROL — a script that DOES produce rows must keep installing, so a
// fix that changed the anchor mode does not silently change something else.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as engineRegistry from '../../engine/nativeRegistry'
import { objectsOnlyPaneEnabled } from '../../engine/objectsOnlyPaneGate'
import { paneGate } from '../../engine/ast/paneGate'
import { translatePine } from '../../engine/ast/pine'

beforeEach(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterEach(() => { vi.unstubAllEnvs() })

const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

/** A table-only script: one `table.new`, one `table.cell`. NO plot, NO alert. */
const OBJECTS_ONLY = `${HEAD}var t = table.new(position.top_right, 1, 1)\n`
  + 'if barstate.islast\n    table.cell(t, 0, 0, str.tostring(close))\n'

/** A regular script that DOES plot. Control for the fix's scope. */
const PLOT_ONLY = `${HEAD}plot(ta.sma(close, 20))\n`

describe('⭐⭐ an objects-only definition installs on the flag it is gated by', () => {
  it('⛔ PRECONDITION — the objects-only pane flag is on for this test env', () => {
    // The whole trip depends on this. If it ever reads false here, this rail
    // measures nothing useful — and the flag-off branch is covered by
    // `objectsOnlyPane.test.js`.
    expect(objectsOnlyPaneEnabled({ VITE_PINE_OBJECTS_ONLY_PANE_ENABLED: '1' })).toBe(true)
  })

  it('⭐⭐ builds, and INSTALLS, without a repaint-mode disagreement', () => {
    // Uses the real flag reader — this file's setup file stubs
    // `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1` for the whole suite. If it doesn't,
    // the assertion above would already have failed.
    const r = memberPaneDefinition({ source: OBJECTS_ONLY, id: 'u_member-pane-test' })
    expect(r.ok).toBe(true)
    expect(r.definition).toBeTruthy()

    const { installed, errors } = engineRegistry.installUserDefinitions([r.definition])
    // ⛔ NAME THE FAILURE. If the install refused, dump the message so the next
    // reader sees WHICH invariant reddened rather than "0 installed".
    if (!installed.length) {
      throw new Error(`install refused: ${JSON.stringify(errors).slice(0, 400)}`)
    }
    expect(installed).toHaveLength(1)
    engineRegistry.uninstallUserDefinition('u_member-pane-test')
  })

  it('⛔⛔ CONTROL — `paneGate` ITSELF is what gates the clean case, both ways', () => {
    // ⚰️⚰️ TWO MUTATIONS WERE GREEN BEFORE THIS EXISTED, and the second is the
    // instructive one. Deleting the flag check from `paneGate`'s new
    // clean-objects-only admission left every case in this file and in
    // `objectsOnlyPane.test.js` passing:
    //
    //   1. every pre-existing flag-off case uses the acceptance dashboard, whose
    //      object program has DROPS, so it arrives as a REFUSAL and is gated by
    //      the OLDER admission's flag check — a different line entirely;
    //   2. and the door-level case below cannot see it either, because
    //      `memberPaneDefinition` carries its OWN `allowObjectsOnly && drawsObjects`
    //      check further down, so with `paneGate` wrongly admitting, the DOOR
    //      still refuses and the trip looks identical from outside.
    //
    // ⛔ TWO GATES OVER ONE DECISION MEAN NEITHER CAN BE PROVED THROUGH THE
    // OTHER. This one asks `paneGate` directly, which is the only place the
    // question is answerable.
    const t = translatePine(OBJECTS_ONLY, { strict: true })
    // ⭐ NON-VACUITY FIRST: the fixture really is the CLEAN shape this admission
    // is for — a host accept with no selectable row and real ops. If the host
    // lane ever goes back to refusing it, this reads as a gate failure when it
    // is a different change entirely.
    expect(t.ok, 'the host lane should ACCEPT a clean object-only script').toBe(true)
    expect(t.mode).toBe('host')
    expect(Number.isInteger(t.selected) && t.selected >= 0).toBe(false)
    expect(t.objects.ops.length).toBeGreaterThan(0)

    expect(paneGate(t, { allowObjectsOnly: true }).ok).toBe(true)
    const off = paneGate(t, { allowObjectsOnly: false })
    expect(off.ok, 'the capability is DARK — off, the gate must still refuse').toBe(false)
    expect(paneGate(t, {}).ok, 'and absent configuration is not consent').toBe(false)

    // ⛔⛔ AND THE OPS ARE REQUIRED, ASKED OF THE FUNCTION DIRECTLY — because
    // through the real trip that half is UNFALSIFIABLE. Deleting `drawsObjects`
    // from the admission left all 85 memberPane cases green: the host lane only
    // ever emits `ok: true` with no row WHEN there is a clean object program, so
    // no real script can reach this line with an empty one.
    //
    // ⭐ `paneGate` is a pure function over a plain verdict, so the shape can
    // simply be handed to it. A guard nobody has seen fire is not a guard, and
    // the outcome it prevents is the one this module exists to prevent: an empty
    // pane on screen with no sentence.
    const noOps = { mode: t.mode, ok: true, selected: -1, outputs: [], objects: { ops: [] } }
    expect(paneGate(noOps, { allowObjectsOnly: true }).ok,
      'a verdict with NO ops must not be admitted — that is an empty pane').toBe(false)
    // ⭐ CONTROL for the control: the same shape WITH an op is admitted, so the
    // refusal above is the ops check and not some other field of this literal.
    expect(paneGate({ ...noOps, objects: { ops: [{ k: 'create', family: 'table' }] } },
      { allowObjectsOnly: true }).ok).toBe(true)
  })

  it('⛔ CONTROL — FLAG OFF, the whole trip refuses and builds nothing', () => {
    // The door-level half of the case above: the member-visible outcome with the
    // flag off is unchanged. ⚠️ It cannot stand in for the gate rail — see the
    // second mutation recorded there.
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
    expect(objectsOnlyPaneEnabled()).toBe(false)
    const r = memberPaneDefinition({ source: OBJECTS_ONLY, id: 'u_member-pane-off' })
    expect(r.ok).toBe(false)
    expect(r.definition).toBeFalsy()
  })

  it('⛔ CONTROL — an ordinary plot script still installs (fix did not widen)', () => {
    const r = memberPaneDefinition({ source: PLOT_ONLY, id: 'u_member-pane-ctrl' })
    expect(r.ok).toBe(true)
    const { installed } = engineRegistry.installUserDefinitions([r.definition])
    expect(installed).toHaveLength(1)
    engineRegistry.uninstallUserDefinition('u_member-pane-ctrl')
  })
})
