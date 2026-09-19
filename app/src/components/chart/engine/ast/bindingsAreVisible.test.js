// app/src/components/chart/engine/ast/bindingsAreVisible.test.js
//
// ─── ⛔⛔ RECORDED OR REFUSED — NEVER ONLY IN `env` ──────────────────────────
//
// Owner ruling, 2026-09-14. **The general form of F2, closing the class rather
// than the instance.**
//
// ⚰️ THE INSTANCE. `var layerArray = array.new<float>(21)` at
// `uncharted-clouds.pine:57` produced NOTHING in `translatePine`'s result — no
// refusal, no note, no line — while the lane's own contract says a statement
// nothing reaches is "a NOTE, listed, never silently dropped". The cause was not
// a missing guard: the parser makes an ordinary call node for `array.new(...)`
// (only RESOLVE refuses a collection), so `stateBinding` accepted it, stored it
// in `env`, and every reader of the RESULT was blind to it.
//
// ⛔ THAT IS A CLASS, NOT A BUG. This walk has several statement branches that
// can each put a binding into `env` — `STATE_KEYWORDS` (`var`/`varip`), the
// top-level `switch` reducer, the `if`-chain folder, the vector hook, and the
// ordinary assignment path. Any of them can bind a name that never surfaces, and
// the failure is invisible by construction: the script translates, the number is
// wrong or missing, and nothing anywhere says which line did it.
//
// ⭐ SO THE RAIL IS ON THE RESULT, NOT ON THE BRANCH. For each branch it drives a
// script through the shipped door and asserts the binding's LINE is visible in
// what `translatePine` returns — as an output, a note or a refusal. It does not
// care WHICH; it cares that a member's line is accounted for.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

/** Is this source line accounted for anywhere in the result? */
function lineIsVisible(result, line) {
  const seen = new Set()
  const walk = (v) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(walk); return }
    if (typeof v.line === 'number') seen.add(v.line)
    Object.values(v).forEach(walk)
  }
  walk(result)
  return seen.has(line)
}

const HEAD = 'indicator("t", overlay=true)\n'

/** Each case: a script, the 1-based line whose binding must be visible, and the
 *  branch it exercises. The line is computed from the source rather than typed,
 *  so an edit to the fixture cannot silently point the assertion elsewhere. */
const CASES = [
  {
    branch: 'STATE_KEYWORDS — `var` holding a collection (the F2 instance)',
    src: `${HEAD}var a = array.new<float>(4)\nplot(close)\n`,
    find: 'var a = array.new',
  },
  {
    // ⚰️ THIS CASE WAS FIRST WRITTEN AS `var n = 0`, AND IT WAS THE RAIL THAT WAS
    // WRONG, NOT THE ENGINE. A plain `var n = 0` is read perfectly well; it is
    // merely unused, and the lane's contract is narrower than "every binding
    // surfaces": *a statement the lane CANNOT READ* is a note, never a silent
    // drop. An unread-but-readable name needs no note, and demanding one would
    // put a line in the result for every `len = 14` a real script carries.
    // ⭐ So the case is a `var` whose right-hand side the lane genuinely cannot
    // read — which is the shape line 57 actually was.
    branch: 'STATE_KEYWORDS — a `var` whose RHS the lane cannot read',
    src: `${HEAD}var c = color.t(color.red)\nplot(close)\n`,
    find: 'var c = color.t',
  },
  {
    branch: 'the vector hook — a non-`var` creation',
    src: `${HEAD}b = array.new_float(3)\nplot(close)\n`,
    find: 'b = array.new_float',
  },
  {
    branch: 'a drawing-typed array, refused at creation',
    src: `${HEAD}c = array.new_label(2)\nplot(close)\n`,
    find: 'c = array.new_label',
  },
  {
    branch: 'a top-level block the walk gives up on',
    src: `${HEAD}d = 0\nfor i = 0 to 2\n    d := d + 1\nplot(close)\n`,
    find: 'for i = 0 to 2',
  },
]

// ✅ THE CLOSING PASS OVER `env` HAS LANDED, and the `it.fails` marker that stood
// here is gone with it. `translatePine` now resolves every leftover binding once,
// after the outputs, and notes the ones that REFUSE — so a right-hand side this
// lane cannot read can no longer sit in `env` with no line anywhere in the result.
//
// ⚰️⚰️ AND THE CLAIM THIS COMMENT USED TO MAKE WAS MEASURED FALSE, WHICH IS THE
// MORE USEFUL HALF. It said `var n = request.security(…)` "is refused only at
// resolve, so when nothing reads the name, nothing refuses and nothing notes" —
// and named it a second instance of the line-57 class. It is not one:
//
//     plot(request.security(syminfo.tickerid, "D", close))
//         -> ok=true, outputs ["close"], no refusal, no note
//
// The lane READS that call (a same-symbol daily fold), so the binding is readable
// and merely unused — which is `len = 14`, and the contract above says in as many
// words that an unread-but-readable name needs no note. The case demanded a note
// the contract forbids, so the ENGINE was right and the RAIL was wrong.
//
// ⛔ THAT IS THE SECOND TIME THIS FILE MADE EXACTLY THIS MISTAKE — the first was
// `var n = 0`, recorded in the case above. Both times the fixture was written from
// what the shape LOOKED like rather than from what the lane does with it. The case
// now uses `color.t`, measured to refuse `pine:colour-value`, so it exercises the
// branch it names. **Before asserting a lane cannot read something, read it.**

describe('every statement branch records its binding, or refuses it by name', () => {
  for (const c of CASES) {
    it(`⭐ ${c.branch}`, () => {
      const line = c.src.split('\n').findIndex((l) => l.includes(c.find)) + 1
      expect(line, `fixture no longer contains ${c.find}`).toBeGreaterThan(0)
      const t = translatePine(c.src, { mode: 'host' })
      expect(lineIsVisible(t, line),
        `line ${line} (${c.find}) is bound but appears nowhere in the result — `
        + 'it exists only in `env`, which is the class this rail exists to close')
        .toBe(true)
    })
  }

  it('⭐⭐ THE CLOSING PASS — an unread UNREADABLE binding is noted, by its own reason', () => {
    // Not merely "a line appears": the note must carry the refusal's own guard, or
    // the member is told a line is unread without being told what about it is.
    const src = `${HEAD}c = color.t(color.red)\nplot(close)\n`
    const t = translatePine(src, { mode: 'host' })
    const note = (t.notes || []).find((n) => n.line === 2)
    expect(note, 'line 2 is bound, never read, and must not be silent').toBeTruthy()
    expect(note.code).toBe('pine:colour-value')
  })

  it('⛔⛔ THE OTHER HALF — an unread READABLE binding stays SILENT', () => {
    // ⭐ The load-bearing half of the closing pass is what it does NOT report. A
    // pass that noted every unread name would put a line in the result for every
    // `len = 14` a real script carries, and the notes would stop being read.
    const t = translatePine(`${HEAD}len = 14\nplot(close)\n`, { mode: 'host' })
    expect((t.notes || []).filter((n) => n.line === 2)).toEqual([])
  })

  it('⛔ …and a binding an OUTPUT read is not re-reported', () => {
    // The mark is taken in `resolveBinding`, the one choke point every read goes
    // through. If it were missed, a name the script plainly uses would be noted as
    // unread — which is worse than silence, because it is wrong rather than absent.
    const t = translatePine(`${HEAD}len = 14\nplot(ta.sma(close, len))\n`, { mode: 'host' })
    expect((t.notes || []).filter((n) => n.line === 2)).toEqual([])
  })

  it('⛔⛔ CONTROL — the detector can return FALSE, so a pass means something', () => {
    // ⭐ The control is on the DETECTOR, which is the half that could silently
    // pass: a `lineIsVisible` that always answered true would make every case
    // above green forever. A line the script does not have must be invisible.
    const t = translatePine(`${HEAD}plot(close)\n`, { mode: 'host' })
    expect(lineIsVisible(t, 9999)).toBe(false)
    // …and a line it DOES have is visible, so the detector is not always-false.
    expect(lineIsVisible(t, 1)).toBe(true)
  })
})
