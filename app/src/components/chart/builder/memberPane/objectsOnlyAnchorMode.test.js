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

  it('⛔ CONTROL — an ordinary plot script still installs (fix did not widen)', () => {
    const r = memberPaneDefinition({ source: PLOT_ONLY, id: 'u_member-pane-ctrl' })
    expect(r.ok).toBe(true)
    const { installed } = engineRegistry.installUserDefinitions([r.definition])
    expect(installed).toHaveLength(1)
    engineRegistry.uninstallUserDefinition('u_member-pane-ctrl')
  })
})
