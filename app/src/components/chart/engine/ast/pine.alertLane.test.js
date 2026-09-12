// app/src/components/chart/engine/ast/pine.alertLane.test.js
//
// ─── ⭐⭐ RULING D1 (option C) — A PANE DOES NOT SELECT AN ALERT ─────────────
//
// An `alertcondition` DRAWS NOTHING in Pine. It registers a condition the platform
// offers under Alerts. This engine's two lanes disagreed about that: `translatePine`
// made it a first-class output row and `chooseOutput` PREFERRED it over every plot
// ("an alertcondition IS a condition by construction, so it wins"), while
// `buildRuntimeIr` classified it as PRESENTATION and emitted no series for it at all.
//
// ⛔ AND IT LANDED ON THE ONE SCRIPT T5 IS MEANT TO DRAW. Measured on
// `uncharted-volume-v2.pine` before this change: the HOST lane's `selected` was 4 —
// "HVE Trigger" — the single output the runtime lane has nothing to draw, sitting
// beside four volume plots it does. After: 0, "Volume".
//
// ⭐ THE SCREEN IS UNCHANGED, WHICH IS WHY THIS IS A SPLIT AND NOT A DELETION. A scan
// asks "when is this true" and a condition is exactly the right first offer there.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { TABLE, alertNotesOf, alertNoteForOutput, ALERT_NOTES } from './parse.js'

const REPO = path.resolve(process.cwd(), '..')
const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

/** A minimum script where the alertcondition SURVIVES in both lanes, so the two
 *  answers can be compared on one program rather than inferred from two. */
const BOTH = `//@version=6
indicator("alert lane probe", overlay = false)
plot(sma(close, 20), title = "Baseline")
alertcondition(close > sma(close, 20), title = "Cross up")
`

describe('⛔⛔ the host lane never selects an alertcondition', () => {
  it('⭐ Volume v2: the pane picks a PLOT, and the row it skipped is still there', () => {
    const r = translatePine(V2, { strict: true })
    expect(r.ok).toBe(true)
    expect(r.mode).toBe('host')
    // The measured move this ruling is about: 4 -> 0 on the real member script.
    expect(r.selected).toBe(0)
    expect(r.outputs[r.selected].kind).toBe('plot')
    expect(r.outputs[r.selected].title).toBe('Volume')
    // ⛔ A SPLIT, NOT A DELETION. The condition still translated, still carries no
    // refusal, and still occupies index 4 — a member can still see it and the
    // alerts door can still be handed it. Only the pane's FIRST OFFER moved.
    expect(r.outputs).toHaveLength(5)
    expect(r.outputs[4].kind).toBe('alertcondition')
    expect(r.outputs[4].title).toBe('HVE Trigger')
    expect(r.outputs[4].refusal).toBe(null)
    expect(r.refusals).toHaveLength(0)
  })

  it('⭐ one program, two lanes, two answers — the screener still prefers the condition', () => {
    const screen = translatePine(BOTH, {})
    const host = translatePine(BOTH, { strict: true })
    expect(screen.outputs.map((o) => o.kind)).toEqual(['plot', 'alertcondition'])
    expect(host.outputs.map((o) => o.kind)).toEqual(['plot', 'alertcondition'])
    // ⛔ THIS IS THE CONTROL FOR THE WHOLE RULING. Without it, "the host does not
    // pick the alert" is equally satisfied by an engine that had stopped preferring
    // conditions anywhere — which would quietly regress every scan built on one.
    expect(screen.selected).toBe(1)
    expect(screen.outputs[screen.selected].kind).toBe('alertcondition')
    expect(host.selected).toBe(0)
    expect(host.outputs[host.selected].kind).toBe('plot')
  })

  it('⛔ a script whose ONLY output is a condition selects nothing on a pane', () => {
    // The honest answer, written down rather than discovered later: there is no
    // line to draw. `ok` stays true because nothing failed to translate — the
    // pane's own gate is `selected >= 0`, not `ok`.
    const src = `//@version=6
indicator("alert only", overlay = false)
alertcondition(close > open, title = "Green bar")
`
    const host = translatePine(src, { strict: true })
    expect(host.outputs.map((o) => o.kind)).toEqual(['alertcondition'])
    expect(host.selected).toBe(-1)
    const screen = translatePine(src, {})
    expect(screen.selected).toBe(0)
  })
})

describe('⭐ the member is told where the condition went, in ONE declared sentence', () => {
  it('names the condition, from the manifest, with the title substituted', () => {
    const r = translatePine(V2, { strict: true })
    const notes = alertNoteForOutput(r.outputs[4])
    expect(notes).toHaveLength(1)
    expect(notes[0].name).toBe('alertcondition')
    expect(notes[0].note).toBe(
      "This script's alert condition 'HVE Trigger' is available under Alerts; "
      + 'it is not drawn on the chart.')
    // ⛔ ONE COPY. The rendered string is the manifest's own sentence with the
    // placeholder replaced — asserted by DERIVING the expectation from the
    // declaration rather than by writing it twice.
    const spec = TABLE._alertconditions
    expect(notes[0].note).toBe(
      spec.memberNote.split(spec.namePlaceholder).join('HVE Trigger'))
  })

  it('⛔ the sentence is READ, never baked in — swap the declaration and it moves', () => {
    // Mutation proof without a prose sweep: if the producer carried its own copy
    // of the string, a different declaration would change nothing here.
    const stub = { memberNote: 'ALT ⟨who⟩ ALT', namePlaceholder: '⟨who⟩' }
    const out = { kind: 'alertcondition', title: 'HVE Trigger' }
    expect(alertNoteForOutput(out, stub)[0].note).toBe('ALT HVE Trigger ALT')
    // …and there is no default sentence hiding behind an absent section.
    expect(alertNotesOf({})).toBe(null)
    expect(alertNotesOf({ _alertconditions: { memberNote: '   ' } })).toBe(null)
    expect(ALERT_NOTES.memberNote).toBe(TABLE._alertconditions.memberNote)
  })

  it('⛔ EVERY condition gets it, not just the one the pane declined', () => {
    // Keyed off `kind`, never off `selected` — a script declaring three alerts has
    // three things to tell the member, and the second and third are not the
    // selected row by construction.
    const a = { kind: 'alertcondition', title: 'First' }
    const b = { kind: 'alertcondition', title: 'Second' }
    expect(alertNoteForOutput(a)[0].note).toContain("'First'")
    expect(alertNoteForOutput(b)[0].note).toContain("'Second'")
    // …and an untitled one says something rather than naming a JavaScript value.
    expect(alertNoteForOutput({ kind: 'alertcondition', title: null })[0].note)
      .toContain("'this alert'")
  })

  it('⛔ CONTROL: a plot gets no alert note', () => {
    // Without this, "the note appears" would also be satisfied by a producer that
    // annotated every row in the script.
    const r = translatePine(V2, { strict: true })
    expect(alertNoteForOutput(r.outputs[0])).toEqual([])
    expect(alertNoteForOutput(r.outputs[3])).toEqual([])
    expect(alertNoteForOutput(null)).toEqual([])
  })
})
