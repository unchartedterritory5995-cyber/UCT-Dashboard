// ⛔⛔ A `kind: 'run'` ACTION WITH NO HANDLER IS A BUBBLE THAT ANSWERS A DELIBERATE GESTURE WITH
// SILENCE. This rail makes that condition impossible to SHIP, rather than impossible to notice.
//
// ── THE DEFECT, ALREADY PAID FOR ONCE ──────────────────────────────────────────────────────────
// `registry.js` carries its own tombstone for the last occurrence, in the `breadth` fan:
//
//     "⚰️ `breadth.sizeRule` AND `breadth.snapshot` ARE REMOVED, NOT DEFERRED (B2). Both were
//      `kind: 'run'` with NO `run` handler and no `requires`, so they rendered ALWAYS-ENABLED and
//      did nothing: `HubRoot` does `Promise.resolve(action.run?.(ctx))`, which on `undefined`
//      resolves silently — no throw, no warn, no toast. The member drags to "Snapshot", the fan
//      closes, nothing happens. Invisible while `breadth` sat in PREVIEW_MODES (the projection hid
//      them); live the moment it left."
//
// A perfect diagnosis and a one-off fix. The same condition is in the registry again today —
// `chart.compare`, `chart.logTrade`, `calendar.earnings`, `calendar.macro`, `catalysts.filter` —
// each dark ONLY because its mode is still in PREVIEW_MODES. Increment 5's whole job is taking
// modes OUT of PREVIEW_MODES, so the next flip ships silent bubbles unless something goes red.
//
// ── THE TWO HIDING MECHANISMS, AND WHY MODELLING ONLY ONE WOULD BE WRONG ────────────────────────
// An action reaches a member's fan only if it survives BOTH:
//
//   1. THE PROJECTION — `fanFor(mode)` drops most actions while the mode sits in PREVIEW_MODES.
//   2. THE CONTROLLER — a section controller rebuilds the fan through a `switch (action.id)`
//      whose default arm DROPS what it does not recognise. `screenerSection.js:319-322` says so:
//        "default: // Voice and Home are HubRoot's own; anything the registry grows later arrives
//         here unhandled and is dropped rather than shipped inert."
//
// ⭐ So the danger is precise, and it is NOT "an action with no handler". It is **a mode with no
// controller to drop things, that is no longer hidden by the projection**. Such a mode ships its
// declared fan verbatim, handlers or not. Today that set is empty. This rail exists to keep it
// empty through the increment that empties PREVIEW_MODES.
//
// ⚠️ The controller lookup takes TWO signals, and this rail needed both before it stopped crying
// wolf: mode `scan` is served by `screenerSection.js` (so filename alone fails), and `wireSection.js`
// matches its actions by SUFFIX so it never contains the string `'wire.` (so handled-id alone fails
// too). See `controllerFor` — the reasoning lives there, next to the code it governs.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { modes, fanFor, PREVIEW_MODES } from './registry'

const HUB = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SECTIONS = path.join(HUB, 'sections')

/** Section controllers: every non-test source under hub/sections. */
const CONTROLLERS = readdirSync(SECTIONS)
  .filter((f) => /\.jsx?$/.test(f) && !/\.test\.jsx?$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(path.join(SECTIONS, f), 'utf8') }))

/** Which controller (if any) rebuilds this mode's fan.
 *
 *  ⛔ TWO SIGNALS, BECAUSE NEITHER ALONE IS RIGHT — and getting this wrong makes the rail cry wolf.
 *    · by NAME: `wireSection.js` serves `wire`, and it matches its actions by SUFFIX
 *      (`.flag`, `.note`), so it never contains the literal string `'wire.` at all.
 *    · by HANDLED ID: `screenerSection.js` serves mode `scan` — a filename convention alone would
 *      report `scan` as uncontrolled and send someone hunting a bug that does not exist.
 *  A mode is controlled if EITHER holds. The rail is asking "is there something here that rebuilds
 *  the fan and drops what it cannot do", and both shapes answer yes. */
const controllerFor = (modeId) => CONTROLLERS
  .filter((c) => c.file === `${modeId}Section.js` || c.text.includes(`'${modeId}.`))
  .map((c) => c.file)

/** Every run action the registry actually produces, ids already resolved (helpers build several
 *  with template literals — `flag('wire')` yields `wire.flag` — so reading the built structure is
 *  the only way to see the real id). */
// ⛔ Voice is HUBROOT'S OWN, not a section's, and every controller says so in its default arm —
// `screenerSection.js:320-322`: "Voice and Home are HubRoot's own; anything the registry grows later
// arrives here unhandled and is dropped rather than shipped inert." So a `.voice` action is handled
// for every mode, controller or not, and counting it as naked would make this rail cry wolf on all
// ten modes. (`home` is `kind:'home'`, not `'run'`, so it never reaches this filter.)
const HUBROOT_OWNED = /\.voice$/

const runActionsOf = (mode) => (mode.fan || [])
  .filter((a) => a && a.kind === 'run' && !HUBROOT_OWNED.test(a.id))
  .map((a) => ({ id: a.id, hasInlineRun: typeof a.run === 'function' }))

const MODE_ROWS = modes.map((m) => ({
  id: m.id,
  inPreview: PREVIEW_MODES.has(m.id),
  controllers: controllerFor(m.id),
  runActions: runActionsOf(m),
}))

describe('a run action never reaches a member without a handler', () => {
  it('the rail has a population to measure — non-vacuity', () => {
    expect(MODE_ROWS.length, 'no modes found — the registry shape changed and every assertion below '
      + 'is vacuous').toBeGreaterThan(4)
    expect(MODE_ROWS.filter((r) => r.runActions.length).length, 'no mode declares a kind:\'run\' '
      + 'action at all, so this rail is measuring nothing').toBeGreaterThan(2)
    expect(PREVIEW_MODES.size, 'PREVIEW_MODES is empty, so the projection half of the rule can never '
      + 'be exercised').toBeGreaterThan(0)
    expect(CONTROLLERS.length, 'no section controllers found — the controller half cannot be '
      + 'exercised either').toBeGreaterThan(2)
  })

  it('⛔⛔ no LIVE mode ships a fan nothing can handle', () => {
    // A mode out of PREVIEW_MODES with no controller hands `fanFor()`'s output straight to the
    // member. Every run action in it must therefore already carry its own `run`.
    const offenders = []
    for (const r of MODE_ROWS) {
      if (r.inPreview) continue                 // hidden by the projection
      if (r.controllers.length) continue        // a controller rebuilds and drops what it cannot do
      const naked = r.runActions.filter((a) => !a.hasInlineRun).map((a) => a.id)
      if (naked.length) offenders.push(`${r.id}: ${naked.join(', ')}`)
    }
    expect(offenders, 'This mode is LIVE (not in PREVIEW_MODES), has NO section controller to drop '
      + 'unhandled actions, and declares kind:\'run\' actions with no `run`. The member drags to one, '
      + 'the fan closes, nothing happens — `HubRoot` does Promise.resolve(action.run?.(ctx)), which '
      + 'on undefined resolves silently.\n'
      + 'Fix it the way B2 fixed breadth.sizeRule/breadth.snapshot: SHIP THE HANDLER, or REMOVE THE '
      + 'ACTION. Never ship it inert — a bubble that answers a gesture with silence teaches the '
      + 'member the product is broken, which is worse than an absent action that tells the truth.')
      .toEqual([])
  })

  it('⛔ the modes living on borrowed time are named, so the next flip fails HERE', () => {
    // ⭐ THE EARLY-WARNING HALF, and the reason this file exists now rather than after the flip.
    // These modes have no controller and are safe only because the projection hides them. Removing
    // one from PREVIEW_MODES without shipping a controller turns the assertion above red — this one
    // records, by name, exactly what that flip would expose.
    const borrowed = MODE_ROWS
      .filter((r) => r.inPreview && !r.controllers.length && r.runActions.some((a) => !a.hasInlineRun))
      .map((r) => `${r.id}: ${r.runActions.filter((a) => !a.hasInlineRun).map((a) => a.id).join(', ')}`)
      .sort()

    expect(borrowed, 'The set of preview-hidden, uncontrolled modes changed.\n'
      + 'If one LEFT this list a controller arrived (good — update the list). If one JOINED, a new '
      + 'mode was declared with a fan and nothing behind it.\n'
      + '⛔ Taking any of these out of PREVIEW_MODES REQUIRES shipping its controller in the SAME '
      + 'commit, or dropping the listed actions.')
      .toEqual([
        // ⚰️ `calendar` LEFT THIS LIST in Increment 5, by a controller arriving — which is the
        // departure this rail was written to require. Both of its naked run actions were resolved
        // in that same commit, and in the two different ways the ruling allows: `calendar.macro`
        // got a real body (a genuine event-type toggle), and `calendar.earnings` was REMOVED,
        // because `CalendarHeader.jsx:347` locks that type (`if (locked) return`) and the bubble
        // could therefore only ever have been silent.
        'catalysts: catalysts.flag, catalysts.filter, catalysts.note',
        'chart: chart.planTrade, chart.flag, chart.compare, chart.logTrade, chart.note',
      ])
  })

  it('⛔ the projection really is what hides them — the mechanism is checked, not assumed', () => {
    // The whole "safe for now" argument rests on `fanFor()` dropping these. If the projection ever
    // stopped filtering, the assertions above would still pass while the actions became reachable —
    // a guard testing the adjacent thing.
    for (const r of MODE_ROWS) {
      if (!r.inPreview || r.controllers.length) continue
      const mode = modes.find((m) => m.id === r.id)
      const projected = fanFor(mode).map((a) => a.id)
      for (const a of r.runActions) {
        if (a.hasInlineRun) continue
        expect(projected, `'${a.id}' has no handler and no controller, and is safe ONLY because the `
          + `projection hides it — but fanFor() now puts it in '${r.id}'s fan, so it IS reachable.`)
          .not.toContain(a.id)
      }
    }
  })
})
