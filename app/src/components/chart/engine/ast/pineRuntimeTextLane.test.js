// app/src/components/chart/engine/ast/pineRuntimeTextLane.test.js
//
// ─── ⭐⭐ RULING D2 (option B) — THE SENTENCE PER LANE, AND THE PANE'S GATE ──
//
// `buildRuntimeIr` refuses the WHOLE script at `pine:text-value`, while that
// refusal's own sentence — written for `translatePine`, where a refusal lands on
// one output row — reads "The numeric plots still run; the text output is skipped
// and named here". Both cannot be true of one lane, and the reassuring half is the
// one a member reads.
//
// The ruling: T3/T5 drive the pane from the HOST lane's saved definition, the IR
// lane stays as it is until session 3's text layer, and the sentence splits.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, REFUSALS, PER_ROW_PROMISE_GUARDS } from './pine.js'
import { buildRuntimeIr, RUNTIME_LANE_REFUSALS } from './pineRuntimeFrontend.js'
import { paneGate, paneCanRender, PANE_LANE } from './paneGate.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'

const REPO = path.resolve(process.cwd(), '..')
const read = (n) => fs.readFileSync(path.join(REPO, 'tests/fixtures/member', n), 'utf8')
const V2 = read('uncharted-volume-v2.pine')
const V1 = read('uncharted-volume.pine')
const BARS = [
  { t: 1761570600, o: 1, h: 2, l: 1, c: 2, v: 10 },
  { t: 1761657000, o: 2, h: 3, l: 2, c: 3, v: 11 },
]
const told = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {}, ...runtimeClockOpts(false) })

describe('⛔⛔ the text refusal no longer promises what this lane cannot deliver', () => {
  it('the IR lane still refuses both member scripts, at the same lines', () => {
    // ⭐ THE BEHAVIOUR IS DELIBERATELY UNCHANGED. Option B fixes the SENTENCE and
    // leaves the lane alone until session 3's text layer — so this pins the
    // measurement rather than a new capability.
    const a = told(V2)
    const b = told(V1)
    expect(a.ok).toBe(false)
    expect(a.refusal.guard).toBe('pine:text-value')
    expect(a.refusal.line).toBe(153)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('pine:text-value')
    expect(b.refusal.line).toBe(151)
  })

  it('⭐ and it now says what actually happens here', () => {
    const r = told(V2)
    expect(r.refusal.message).not.toContain('numeric plots still run')
    expect(r.refusal.message).toContain('none of this script runs here')
    expect(r.refusal.message).toBe(RUNTIME_LANE_REFUSALS['pine:text-value'])
  })

  it('⛔ CONTROL: the translator lane keeps the sentence that is TRUE there', () => {
    // Without this, "the wording changed" is equally satisfied by editing the
    // shared table — which would make it wrong in the lane where it is right.
    expect(REFUSALS['pine:text-value']).toContain('numeric plots still run')
    const host = translatePine(V2, { strict: true })
    expect(host.ok).toBe(true)
    expect(host.outputs).toHaveLength(5)
    expect(host.refusals).toHaveLength(0)
  })

  it('⛔ every per-row promise carries a lane override, derived not listed', () => {
    // A second guard whose sentence promises something about the OTHER rows,
    // added to `pine.js` without an override, fails HERE and by name.
    expect(PER_ROW_PROMISE_GUARDS.length).toBeGreaterThan(0)
    for (const g of PER_ROW_PROMISE_GUARDS) {
      expect(REFUSALS[g], `pine.js declares no sentence for ${g}`).toBeTruthy()
      expect(RUNTIME_LANE_REFUSALS[g],
        `${g} promises something about the other rows and the runtime lane has no `
        + 'sentence of its own — it would reach a member claiming the rest of the '
        + 'script still runs, which in this lane it does not').toBeTruthy()
      expect(RUNTIME_LANE_REFUSALS[g]).not.toBe(REFUSALS[g])
    }
  })

  it('⛔ CONTROL: a guard with no per-row promise passes through untouched', () => {
    // The override must be narrow. A lane that rewrote every message would lose
    // the detail `RuntimeRefusal` appends (`— \`for\``), which is the part that
    // says WHICH construct.
    const r = buildRuntimeIr('//@version=6\nindicator("x")\nfor i = 0 to 3\n    a = 1\nplot(close)\n', { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:loop')
    expect(RUNTIME_LANE_REFUSALS['runtime:loop']).toBeUndefined()
    expect(r.refusal.message).toContain('the runtime has no iteration yet')
  })
})

describe('⛔⛔ a pane draws the HOST lane\'s verdict, or it draws nothing', () => {
  it('⭐ Volume v2 passes the gate on the host lane', () => {
    const host = translatePine(V2, { strict: true })
    expect(paneGate(host)).toEqual({ ok: true, reason: null, guard: null })
    expect(paneCanRender(host)).toBe(true)
  })

  it('⛔⛔ …and the SAME SCRIPT is refused on the screener lane, which says ok:true', () => {
    // THE WHOLE RULING IN ONE ASSERTION. The lenient lane answers `ok: true` while
    // carrying four refusals, because a screen needs one usable column. A pane
    // built on that verdict draws one line and silently omits the rest.
    const screen = translatePine(V2, {})
    expect(screen.ok).toBe(true)
    expect(screen.refusals.length).toBe(4)
    const g = paneGate(screen)
    expect(g.ok).toBe(false)
    expect(g.reason).toContain('screener lane')
    expect(PANE_LANE).toBe('host')
  })

  it('⛔ a host refusal reaches the pane as ITS OWN sentence, not a blank', () => {
    const bad = translatePine('//@version=6\nindicator("x")\nplot(request.security(syminfo.tickerid, "60", close))\n', { strict: true })
    // ⛔ NO CONDITIONAL SKIP. An `if (bad.ok) return` here would turn this into a
    // test that cannot fail the day the capability lands; if `60` ever resolves,
    // this goes RED and somebody picks a script that still refuses.
    expect(bad.ok).toBe(false)
    expect(bad.refusal.guard).toBe('pine:request')
    const g = paneGate(bad)
    expect(g.ok).toBe(false)
    expect(typeof g.reason).toBe('string')
    expect(g.reason.length).toBeGreaterThan(0)
    expect(g.guard).toBe(bad.refusal.guard)
  })

  it('⛔ ruling D1\'s alert-only script: nothing failed, and there is nothing to draw', () => {
    const t = translatePine('//@version=6\nindicator("alert only")\nalertcondition(close > open, title = "Green")\n', { strict: true })
    expect(t.ok).toBe(true)
    expect(t.selected).toBe(-1)
    expect(paneGate(t).ok).toBe(false)
    expect(paneGate(t).reason).toContain('nothing a chart can draw')
  })

  it('⛔ CONTROL: the gate refuses junk rather than throwing on it', () => {
    for (const junk of [null, undefined, 0, 'nope', {}, { mode: 'host' }]) {
      expect(paneGate(junk).ok).toBe(false)
      expect(paneCanRender(junk)).toBe(false)
    }
  })
})
