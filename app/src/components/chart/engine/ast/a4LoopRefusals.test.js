// app/src/components/chart/engine/ast/a4LoopRefusals.test.js
//
// ─── ⭐⭐ a4 — THE ACCEPTANCE, WRITTEN BEFORE THE FIX ────────────────────────
//
// a4 does NOT teach this lane a new iteration form. Rulings R1 and R2 retired
// `for … in`, `for [i, x] in` and `while` from item (a) on the census numbers, under
// the same F4 threshold that retired `while` at 15/116:
//
//     for x in        13 of 92 bodies write a slot   →  retired
//     for [i, x] in    0 of 34                       →  retired
//     while           (F4, already ruled)            →  retired
//
// So a4 is about WHERE THE SENTENCE LANDS AND WHAT IT NAMES. Today each of these
// forms produces a `pine:block` NOTE on the loop line and the translation carries on;
// a refusal appears later, if at all, from whatever READ touches the array the loop
// was supposed to fill — and it names `array.get`, which is the one construct in the
// script that is not the problem. After a4 the loop line itself refuses, by name.
//
// ⛔ WHY THAT IS WORTH A SUB-STEP AT ALL. A member whose script silently loses a loop
// and then refuses three hundred lines later at an unrelated read cannot act on that.
// The refusal has to name the form, the source expression, and the line.
//
// ⚰️ AND THE CORPUS COULD NOT SUPPLY MOST OF THESE FIXTURES, which is itself a finding
// and is recorded rather than worked around. Every `while` user in `corpus/committed`
// is UNREACHABLE at its `while` line: `fibonacci-retracement-statistics-by-volprofex`
// and `ict-institutional-order-flow-fadi` both die on `pine:character` at an earlier
// line (non-ASCII in source), and `k-clustering`'s `while` at :132 sits inside a
// function body the walk never enters. `bigbeluga-smart-money-concepts`, the script
// the `other` bucket was sampled from, dies at `pine:character@25` long before its
// `for obj in bin.ln` at :282. So the message-text cases below are SYNTHETIC and say
// so in their names; the one corpus case is the one that was measured to reach.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')
const HEAD = '//@version=6\nindicator("t", overlay=true)\nplot(close, "real")\n'

/** ⛔ MARKERS, PER CASE — not one flag for the file.
 *
 *  a4 satisfied three of the eight cases and left five open, so a single `STILL_OPEN`
 *  would have had to be flipped all-or-nothing and would have hidden exactly which
 *  half landed. `run` marks a case still failing — it passes BECAUSE it fails, visible
 *  in the reporter rather than hidden by a skip; `it` marks one a4 satisfied, and it
 *  is a real assertion from that moment on.
 *
 *  ⭐ What a4 DID land: the refusal moved off the read and onto the loop line, with
 *  `pine:collection` and a message naming the form and the ruling that retired it.
 *  ⛔ What it did NOT: a series-sized source still refuses at its CREATION rather than
 *  at the `for` (the size only folds at resolve time, so the walk cannot classify it);
 *  a drawing or UDT array never reaches the vector-opaque path at all; and the corpus
 *  fixture at :264 takes its source from a function PARAMETER, a different path again.
 *  Each is named in its own case below rather than summarised away.
 */
const run = it.fails

/** Every refusal in the result, as `guard@line`, plus its message. */
const refusalsOf = (t) => (t.refusals || []).map((r) => ({
  guard: r.guard, line: r.line, text: String(r.detail || r.message || ''),
}))

/** The 1-based line of the first source line matching `needle`. */
function lineOf(src, needle) {
  const n = src.split('\n').findIndex((l) => l.includes(needle)) + 1
  expect(n, `fixture no longer contains ${needle}`).toBeGreaterThan(0)
  return n
}

describe('a4 — a retired loop form refuses AT ITS OWN LINE', () => {
  // ── D.3 · a source whose SIZE depends on a series ────────────────────────
  // ⭐⭐ RULING R4 (owner, 2026-09-14) — THE CREATION LINE IS THE RIGHT PLACE, and this
  // case asserts it rather than treating it as a shortfall.
  //
  // A series-sized source refuses where the DEPENDENCY IS — the size expression at the
  // creation — with `pine:collection`, the composed `seriesDependentMessage`, and the
  // routing to item (c). The `for` line is downstream of that fact: by the time the
  // loop is reached the array is already unusable, and moving the sentence there would
  // name the loop for a problem the loop did not cause. Requiring the loop line would
  // mean folding sizes earlier — a change to WHEN sizes are settled, which is an
  // engine-order change a4 is not entitled to make.
  //
  // ⛔ The assertion does not weaken: it still names the code, the sentence and the
  // line. Only the line it names changed, and it changed to the true one.
  it('⭐⭐ SYNTHETIC · D.3 / R4 — a series-sized source refuses at its CREATION, routing to (c)', () => {
    // No loop touches the array: the size is folded at the read, fails, and the
    // refusal names the DEPENDENCY where the dependency is.
    const src = `${HEAD}var a = array.new<float>(int(volume))\nplot(array.get(a, 0))\n`
    const at = lineOf(src, 'var a = array.new<float>(int(volume))')
    const r = refusalsOf(translatePine(src, { strict: true })).find((x) => x.line === at)
    expect(r, `nothing refuses at line ${at}, the creation`).toBeTruthy()
    expect(r.guard).toBe('pine:collection')
    expect(r.text).toMatch(/depends on a series/)
    // ⭐ The dependency is named, not merely reported — `int` is what will not fold.
    expect(r.text).toMatch(/`int`/)
    expect(r.text).toMatch(/Runtime arrays are the IR lane's, item \(c\)/)
  })

  // ⭐⭐ R8 — CLOSED. The routing gap a4 opened by relocating the refusal is fixed, and
  // this case is a real assertion now rather than a marker.
  //
  // a4 moved the refusal onto the loop line, which was right for every shape except
  // this one: a series-sized source iterated by a `for … in` got the loop's generic
  // sentence, because the loop's opaque replacement fired before the size ever folded,
  // and the routing to item (c) went with it. Routing is a hard requirement of
  // Mechanism A's foreclosure, not a nicety.
  //
  // ⚖️ TWO CANDIDATES WERE BUILT AND MEASURED before one was chosen. Both gave exactly
  // one refusal, both carried the routing, both left the verdicts alone:
  //
  //   (i)  settle the size at the read, before the loop's sentence  -> pine:collection@4
  //   (ii) re-locate the size refusal onto the loop line            -> pine:collection@5
  //
  // (i) wins on the third criterion — the line named is where the dependency IS.
  // (ii) puts the refusal on line 5 while its own text reads "`int` at line 4", so the
  // line and the message disagree and the member is pointed at the loop for a fact
  // about the creation. Consistent with R4, which ruled the same way for the
  // un-iterated case.
  it('⭐⭐ R8 · a series-sized source ITERATED by a loop still routes to (c)', () => {
    const src = `${HEAD}var a = array.new<float>(int(volume))\nfor x in a\n`
      + '    array.set(a, 0, close)\nplot(array.get(a, 0))\n'
    const t = translatePine(src, { strict: true })
    const all = refusalsOf(t)
    // ⛔ ONE refusal, not two — the dependency REPLACES the loop's sentence (1.1).
    expect(all.length, 'the dependency replaces the loop sentence, never joins it').toBe(1)
    const r = all[0]
    expect(r.guard).toBe('pine:collection')
    expect(r.line, 'named at the creation, where the dependency is')
      .toBe(lineOf(src, 'var a = array.new<float>(int(volume))'))
    expect(r.text).toMatch(/depends on a series/)
    expect(r.text).toMatch(/Runtime arrays are the IR lane's, item \(c\)/)
    // …and the lenient lane still offers what it can, so R2's verdict rule holds.
    expect(translatePine(src, {}).ok).toBe(true)
  })

  it('⛔⛔ CONTROL — R8 did NOT disturb the plan-time case, which still names the loop', () => {
    // The whole risk of R8 is over-reach: settling the size at the read could have
    // moved every loop refusal to a creation line. A plan-time source has a size that
    // folds, so the fold is silent and the loop's sentence still wins.
    const src = `${HEAD}var a = array.new<float>(3)\nfor i = 0 to 2\n    array.set(a, i, close + i)\n`
      + 'var b = array.new<float>(3)\nfor x in a\n    array.set(b, 0, x)\nplot(array.get(b, 0))\n'
    const all = refusalsOf(translatePine(src, { strict: true }))
    expect(all.length).toBe(1)
    expect(all[0].line).toBe(lineOf(src, 'for x in a'))
    expect(all[0].text).toMatch(/13 of 92/)
  })

  // ── D.4 · `while`, ruling F4 ─────────────────────────────────────────────
  it('⭐⭐ SYNTHETIC · D.4 — `while` refuses at the `while` line, naming F4', () => {
    const src = `${HEAD}var a = array.new<float>(4)\ni = 0\nwhile i < 4\n`
      + '    array.set(a, i, close)\n    i := i + 1\nplot(array.get(a, 0))\n'
    const at = lineOf(src, 'while i < 4')
    const r = refusalsOf(translatePine(src, { strict: true })).find((x) => x.line === at)
    expect(r, `nothing refuses at line ${at}, the \`while\` itself`).toBeTruthy()
    // ⛔ R2: `pine:collection`, NOT a promoted `pine:block`. `pine:block` is a note
    // code emitted at sites unrelated to iteration, and promoting it would change its
    // meaning everywhere it is emitted — wider than a4 is entitled to be.
    expect(r.guard).toBe('pine:collection')
    expect(r.text).toMatch(/while/)
    expect(r.text, 'the ruling is named with its number, not asserted').toMatch(/15 of 116/)
  })

  // ── R1 case (i) · a plan-time vector source ──────────────────────────────
  it('⭐⭐ SYNTHETIC · R1(i) — `for x in <plan-time vector>` refuses, and does NOT route to (c)', () => {
    const src = `${HEAD}var a = array.new<float>(3)\nfor i = 0 to 2\n    array.set(a, i, close + i)\n`
      + 'var b = array.new<float>(3)\nfor x in a\n    array.set(b, 0, x)\nplot(array.get(b, 0))\n'
    const at = lineOf(src, 'for x in a')
    const r = refusalsOf(translatePine(src, { strict: true })).find((x) => x.line === at)
    expect(r, `nothing refuses at line ${at}`).toBeTruthy()
    expect(r.guard).toBe('pine:collection')
    expect(r.text, 'names the form').toMatch(/for .* in/)
    expect(r.text, 'names the ruling with its census number').toMatch(/13 of 92/)
    // ⛔ THE LOAD-BEARING NEGATIVE. This is not a runtime-array case, so routing it to
    // item (c) would be a FALSE sentence — it would send a member to wait for a lane
    // that was never going to serve them. R1 says so explicitly.
    expect(r.text, 'a plan-time source must NOT be routed to item (c)')
      .not.toMatch(/item \(c\)/)
  })

  // ⭐⭐ RULING R6 (owner, 2026-09-14) — MEASURED, AND THE CASE IS MOOT ON ALL 13.
  //
  // R6 said: measure first, and if an earlier refusal fires before the loop is
  // reached, the loop line is never the frontier on that script — swap in another of
  // the 13 owed uses. Measured on every one of the 13, and **there is no swap
  // available**, because an earlier refusal fires on all of them:
  //
  //   ai-supertrend-…-presenttrading__3b9db05a48   :259   pine:declaration-strategy@5
  //   ict-killzones-pivots-tfo__d0b8be94f1         :768   pine:character@250
  //   multi-timeframe-supply-demand-zones__a98a…   :264   pine:no-output (0 outputs)
  //   volume-footprint-…__e15e52b27d  (×9 uses)    :595…  pine:character@1572
  //
  // ⭐ SO THE MOOT-NESS ITSELF BECOMES THE ASSERTION, rather than the case being
  // deleted. If any of these scripts ever becomes reachable — the `pine:character`
  // class is a source-encoding refusal that a later wave may well close — this goes
  // RED, which is precisely the moment R1 should be reopened on corpus evidence.
  // A deleted case would have gone quiet instead.
  //
  // ⚠️ `SnD_Type` at :264 is also a FUNCTION PARAMETER, so even reachable it would
  // exercise a `param` binding rather than a vector. That is recorded as owed under
  // R1 and is NOT built here: a4 does not do parameter typing.
  it('⭐ CORPUS / R6 — all 13 owed `for x in` uses are refused EARLIER, so none can test the loop line', () => {
    const CASES = [
      ['ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48.pine', 'pine:declaration-strategy'],
      ['ict-killzones-pivots-tfo__d0b8be94f1.pine', 'pine:character'],
      ['volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d.pine', 'pine:character'],
      ['multi-timeframe-supply-demand-zones__a98a2ab367.pine', 'pine:no-output'],
    ]
    for (const [name, expected] of CASES) {
      const src = fs.readFileSync(path.join(CORPUS, name), 'utf8')
      const t = translatePine(src, { strict: true })
      const first = (t.refusals || [])[0]
      expect(first, `${name} now refuses nothing — reopen R1 on this evidence`).toBeTruthy()
      expect(first.guard,
        `${name}'s first refusal changed; if the loop is now reachable, reopen R1`)
        .toBe(expected)
    }
  })

  // ── R1 case (iii) · a source that is outside BOTH lanes ──────────────────
  // ⭐⭐ RULING R5 (owner, 2026-09-14) — IT STAYS WHERE IT ALREADY SPEAKS.
  //
  // A drawing array is never a `vector` binding: `array.new_box` marks the name opaque
  // at CREATION and records `pine:drawing` there, so the loop's vector-opaque
  // replacement has no binding to carry a sentence for. The creation site is the
  // honest placement — it is where the object's kind is decided.
  //
  // ⚰️ AND THE MEASUREMENT CORRECTED THE RULING'S OWN WORDING, which is recorded
  // rather than smoothed over. R5 says it "stays where it already refuses"; measured,
  // it does not refuse ANYWHERE — `ok=true`, zero refusals, a `pine:drawing` NOTE at
  // the creation and a `pine:block` note at the loop. A script that iterates a drawing
  // array and plots nothing from it is not a failed translation; it is a translation
  // with a line this lane does not draw, which is exactly what a note is for.
  it('⭐⭐ SYNTHETIC · R1(iii) / R5 — a DRAWING array NOTES at its creation, naming the kind', () => {
    // ⭐ Measured: `c = array.new_box(2)` already notes `pine:drawing` at its creation.
    // The loop refusal uses the SAME code, so a reader sees one story rather than two.
    const src = `${HEAD}c = array.new_box(2)\nfor b in c\n    box.delete(b)\nplot(close)\n`
    const t = translatePine(src, { strict: true })
    const at = lineOf(src, 'c = array.new_box(2)')
    const note = (t.notes || []).find((n) => n.line === at && n.code === 'pine:drawing')
    expect(note, `no pine:drawing note at line ${at}, the creation`).toBeTruthy()
    // ⭐ It names the OBJECT KIND, not just "a drawing" — a member has to know which
    // of their constructs this is about.
    expect(note.message).toMatch(/array\.new_box/)
    // ⛔ Outside BOTH lanes, so it must NOT be routed to item (c) either: item (c) is
    // the runtime-array lane, and a box is not an array problem.
    expect(note.message).not.toMatch(/item \(c\)/)
    expect(note.message.toLowerCase()).not.toContain('not supported')
  })

  it('⭐⭐ SYNTHETIC · R1(iii) / R5 — a UDT array NOTES `pine:type` at the TYPE declaration', () => {
    // ⚠️ AT THE `type` DECLARATION, NOT THE ARRAY CREATION, and the distinction is the
    // honest one: what this lane cannot store is the TYPE, and the array is merely the
    // first place that shows. Measured — `pine:type@4` on `type Foo`, `pine:vector@6`
    // on the `array.new<Foo>` line, so the array creation IS recorded, separately, as
    // an ordinary plan-time vector of `Foo` slots.
    const src = `${HEAD}type Foo\n    float a\nc = array.new<Foo>(2)\nfor f in c\n    f.a := 1.0\nplot(close)\n`
    const t = translatePine(src, { strict: true })
    const at = lineOf(src, 'type Foo')
    const note = (t.notes || []).find((n) => n.line === at && n.code === 'pine:type')
    expect(note, `no pine:type note at line ${at}, the type declaration`).toBeTruthy()
    expect(note.message.toLowerCase()).not.toContain('not supported')
    // …and the array creation is separately visible, so neither line is silent.
    const vec = (t.notes || []).find(
      (n) => n.code === 'pine:vector' && n.line === lineOf(src, 'c = array.new<Foo>(2)'))
    expect(vec, 'the array creation is recorded too').toBeTruthy()
  })

  // ── the paired form, which the corpus does not exercise at all ───────────
  it('⭐⭐ SYNTHETIC ONLY — `for [i, x] in` refuses at its line (0 of 34 corpus uses qualify)', () => {
    // ⚠️ LABELLED SYNTHETIC DELIBERATELY. Not one of the corpus's 34 `for [i, x] in`
    // uses has a slot-writing body, so there is no corpus fixture to name here and
    // dressing a synthetic as corpus evidence would be the thing this programme keeps
    // catching itself doing.
    const src = `${HEAD}var a = array.new<float>(3)\nfor i = 0 to 2\n    array.set(a, i, close + i)\n`
      + 'var b = array.new<float>(3)\nfor [i, x] in a\n    array.set(b, i, x)\nplot(array.get(b, 0))\n'
    const at = lineOf(src, 'for [i, x] in a')
    const r = refusalsOf(translatePine(src, { strict: true })).find((x) => x.line === at)
    expect(r, `nothing refuses at line ${at}`).toBeTruthy()
    expect(r.guard).toBe('pine:collection')
  })

  // ── a4b's own red acceptance, written now so the frontier is on record ───
  //
  // ⚠️⚠️ THIS MARKER IS SYNTHETIC BY NECESSITY, AND THE INSTRUCTION TO ANCHOR IT TO A
  // NAMED CORPUS SCRIPT CANNOT BE MET — measured, not assumed. The ask was for an
  // `it.fails` asserting `pine:reassign` on a named accumulator script at a named
  // line. Three corpus accumulator scripts were run on the strict lane:
  //
  //   delta-volume-v21-by-kernel-phi__uP24atP4R0  :26   reassign [] — pine:request@36
  //   atr-stop-loss-indicator__LOfv1FvRhL         :25   reassign [] — pine:module@7
  //   cumulative-volume-delta__c772250751         :17   reassign [] — pine:request@12
  //
  // ⛔ `pine:reassign` fires on NONE of them. In a real script the accumulator sits
  // inside a `for` the walk declines, so it is never resolved and never refused — the
  // block is a `pine:block` NOTE and the accumulator is INVISIBLE, not refused. The
  // refusal appears only when the accumulated name is bound at top level and read by
  // an output, which is the synthetic below. **The 379 are invisible today**, and
  // a4b's census must count which of the two each one is.
  //
  // ⭐ And the marker asserts the POST-a4b state, not the present one, because that is
  // what makes it self-retiring: it fails today, passes when a4b folds, and is deleted
  // in that commit. An `it.fails` asserting `pine:reassign` fires would pass TODAY and
  // go red on success — a marker that lights up when the work is done is a trap.
  // ⭐⭐ RULING R7 — a4b RETIRES, and this is its acceptance.
  //
  // The marker that stood here asserted the accumulator would FOLD. It will not be
  // built: the a4b census put **1 of 379** accumulator bodies inside what could be
  // unrolled, and that one runs a single iteration. That is under the F4 threshold by
  // the same logic that retired `while` (15 of 116) and `for … in` (13 of 92, 0 of 34).
  //
  // ⛔ THE BINDING CONSTRAINT IS THE ITERATION COUNT, and the message has to say so,
  // because that is what a reopening would have to change: only **63 of 379** of these
  // loops have a bound this engine could settle. Seed, shape and escape are not what
  // stops it — dropping each of those alone leaves 7, 50 and 9 admissible.
  //
  // ⚠️ SYNTHETIC, DELIBERATELY AND OF NECESSITY. Every corpus accumulator script tried
  // is masked by an earlier refusal — delta-volume-v21 by `pine:request@36`,
  // atr-stop-loss-indicator by `pine:module@7`, cumulative-volume-delta by
  // `pine:request@12` — so nothing in the corpus reaches its accumulator at all. This
  // fixture is built so nothing refuses before the loop.
  it('⛔⛔ R7 · SYNTHETIC — a counted-`for` accumulator refuses with a4b\'s reason', () => {
    const src = `${HEAD}s = 0.0\nfor i = 0 to 2\n    s := s + close[i]\nplot(s, "acc")\n`
    // ⭐ R7a — THE LINE IS THE `:=`, NOT THE `for`, AND THAT IS THE RULING.
    // The reassignment fact lives at the `:=`; R4 and R8 both put the refusal where
    // the fact is, and the SENTENCE names the loop. Candidate (i) — reordering the
    // body walk so the refusal lands on the `for` — was rejected: it touches every
    // statement branch that walks a body, which is the most likely place for a fifth
    // ordering defect to ship silently, and it buys a line that agrees with the
    // sentence no better than this one does.
    const at = lineOf(src, 's := s + close[i]')
    const all = refusalsOf(translatePine(src, { strict: true }))
    // ⛔ REPLACED, NOT ADDED. The accumulator already refused `pine:reassign`; R7 gives
    // that sentence a reason. It must not become two.
    expect(all.length, 'one cause, one refusal — the sentence is replaced').toBe(1)
    const r = all[0]
    expect(r.line, 'the reassignment fact lives at the `:=`').toBe(at)
    expect(r.text, 'and the sentence names the loop it could not fold').toMatch(/`for`/)
    expect(r.text, 'the census number is in the sentence').toMatch(/1 of 379/)
    expect(r.text, 'and the constraint a reopening would have to change')
      .toMatch(/63 of 379/)
    expect(r.text.toLowerCase()).not.toContain('not supported')
  })

  // ── permanent controls ───────────────────────────────────────────────────
  it('⛔⛔ CONTROL — a3 still works: a counted `for` writing slots is untouched', () => {
    // a4 moves refusals onto RETIRED forms. If it touched the admitted one, this goes
    // red — which is the only thing standing between a4 and undoing a3.
    const src = `${HEAD}var a = array.new<float>(3)\nfor i = 0 to 2\n    array.set(a, i, close + i)\nplot(array.get(a, 1))\n`
    const t = translatePine(src, { strict: true })
    expect(t.refusals || []).toEqual([])
    expect(String((t.outputs || [])[1].formula)).toBe('close + 1')
  })

  it('⛔⛔ CONTROL — TODAY the accumulator refuses, so a4b\'s marker means something', () => {
    // Without this, the a4b case above would pass on an engine that had simply stopped
    // emitting the plot. It must be REFUSED today, not absent.
    const src = `${HEAD}s = 0.0\nfor i = 0 to 2\n    s := s + close[i]\nplot(s, "acc")\n`
    const r = refusalsOf(translatePine(src, { strict: true }))
    expect(r.some((x) => x.guard === 'pine:reassign'),
      'the frontier is a refusal, not silence').toBe(true)
  })

  it('⛔⛔ CONTROL — no refusal anywhere says "not supported"', () => {
    // The foreclosure is phrased as a ROUTE, never as a dead end. This sweeps every
    // fixture in this file rather than trusting each case's own wording.
    const sources = [
      `${HEAD}var a = array.new<float>(int(volume))\nfor x in a\n    array.set(a, 0, close)\nplot(close)\n`,
      `${HEAD}var a = array.new<float>(4)\ni = 0\nwhile i < 4\n    array.set(a, i, close)\n    i := i + 1\nplot(array.get(a, 0))\n`,
      `${HEAD}c = array.new_box(2)\nfor b in c\n    box.delete(b)\nplot(close)\n`,
    ]
    for (const src of sources) {
      for (const r of refusalsOf(translatePine(src, { strict: true }))) {
        expect(r.text.toLowerCase(), `"${r.guard}" says "not supported"`)
          .not.toContain('not supported')
      }
    }
  })
})
