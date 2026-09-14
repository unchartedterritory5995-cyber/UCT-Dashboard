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
    src: `${HEAD}var n = request.security(syminfo.tickerid, "D", close)\nplot(close)\n`,
    find: 'var n = request.security',
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

// ⚰️⚰️ THE RAIL FOUND A SECOND INSTANCE ON ITS FIRST RUN, AND IT IS NOT FIXED
// HERE. `var n = request.security(…)` binds silently too: `stateBinding` accepts
// anything that PARSES, and `request.security` parses fine — it is refused only
// at resolve, so when nothing reads the name, nothing refuses and nothing notes.
// Same shape as line 57, different namespace.
//
// ⛔ CLOSING THE CLASS NEEDS A CLOSING PASS over `env` at the end of the walk —
// every name still bound to something never resolved and never noted gets a note
// — and that is its own increment, not a change to smuggle into this one. It is
// marked `it.fails` so it is VISIBLE and SELF-RETIRING: this line passes while
// the defect exists and turns RED the day the closing pass lands, which is when
// it should be deleted. A skipped test would have hidden it.
const KNOWN_OPEN = new Set(['STATE_KEYWORDS — a `var` whose RHS the lane cannot read'])

describe('every statement branch records its binding, or refuses it by name', () => {
  for (const c of CASES) {
    const run = KNOWN_OPEN.has(c.branch) ? it.fails : it
    run(`⭐ ${c.branch}`, () => {
      const line = c.src.split('\n').findIndex((l) => l.includes(c.find)) + 1
      expect(line, `fixture no longer contains ${c.find}`).toBeGreaterThan(0)
      const t = translatePine(c.src, { mode: 'host' })
      expect(lineIsVisible(t, line),
        `line ${line} (${c.find}) is bound but appears nowhere in the result — `
        + 'it exists only in `env`, which is the class this rail exists to close')
        .toBe(true)
    })
  }

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
