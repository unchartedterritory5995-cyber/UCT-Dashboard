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

/** ⛔ MARKER — delete this and the `run` indirection in the commit that moves the
 *  refusals onto the loop lines. Until then each case passes BECAUSE it fails, which
 *  is visible in the reporter rather than hidden by a skip. */
const STILL_OPEN = true
const run = STILL_OPEN ? it.fails : it

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
  run('⭐⭐ SYNTHETIC · D.3 — `for x in <series-sized>` refuses at the `for`, routing to (c)', () => {
    const src = `${HEAD}var a = array.new<float>(int(volume))\nfor x in a\n    array.set(a, 0, close)\nplot(close)\n`
    const at = lineOf(src, 'for x in a')
    const r = refusalsOf(translatePine(src, { strict: true })).find((x) => x.line === at)
    expect(r, `nothing refuses at line ${at}, the \`for\` itself`).toBeTruthy()
    expect(r.guard).toBe('pine:collection')
    // The routing sentence already exists in `seriesDependentMessage`; a4's work is
    // making the LOOP carry it instead of a later read.
    expect(r.text).toMatch(/depends on a series/)
    expect(r.text).toMatch(/Runtime arrays are the IR lane's, item \(c\)/)
  })

  // ── D.4 · `while`, ruling F4 ─────────────────────────────────────────────
  run('⭐⭐ SYNTHETIC · D.4 — `while` refuses at the `while` line, naming F4', () => {
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
  run('⭐⭐ SYNTHETIC · R1(i) — `for x in <plan-time vector>` refuses, and does NOT route to (c)', () => {
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

  run('⭐ CORPUS · R1(i) — multi-timeframe-supply-demand-zones:264 refuses at its `for`', () => {
    // ⭐ The ONE corpus fixture measured to reach its loop line: today it carries
    // `note:pine:block` at 264, so the walk sees the loop and declines it silently.
    const src = fs.readFileSync(
      path.join(CORPUS, 'multi-timeframe-supply-demand-zones__a98a2ab367.pine'), 'utf8')
    const r = refusalsOf(translatePine(src, { strict: true })).find((x) => x.line === 264)
    expect(r, 'nothing refuses at 264, where `for i in SnD_Type` is').toBeTruthy()
  })

  // ── R1 case (iii) · a source that is outside BOTH lanes ──────────────────
  run('⭐⭐ SYNTHETIC · R1(iii) — a DRAWING array reuses the source\'s own code', () => {
    // ⭐ Measured: `c = array.new_box(2)` already notes `pine:drawing` at its creation.
    // The loop refusal uses the SAME code, so a reader sees one story rather than two.
    const src = `${HEAD}c = array.new_box(2)\nfor b in c\n    box.delete(b)\nplot(close)\n`
    const at = lineOf(src, 'for b in c')
    const r = refusalsOf(translatePine(src, { strict: true })).find((x) => x.line === at)
    expect(r, `nothing refuses at line ${at}`).toBeTruthy()
    expect(r.guard).toBe('pine:drawing')
    // ⛔ Outside BOTH lanes, so it must NOT be routed to item (c) either.
    expect(r.text).not.toMatch(/item \(c\)/)
  })

  run('⭐⭐ SYNTHETIC · R1(iii) — a UDT array reuses `pine:type`, its own creation code', () => {
    const src = `${HEAD}type Foo\n    float a\nc = array.new<Foo>(2)\nfor f in c\n    f.a := 1.0\nplot(close)\n`
    const at = lineOf(src, 'for f in c')
    const r = refusalsOf(translatePine(src, { strict: true })).find((x) => x.line === at)
    expect(r, `nothing refuses at line ${at}`).toBeTruthy()
    expect(r.guard).toBe('pine:type')
  })

  // ── the paired form, which the corpus does not exercise at all ───────────
  run('⭐⭐ SYNTHETIC ONLY — `for [i, x] in` refuses at its line (0 of 34 corpus uses qualify)', () => {
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
  run('⛔⛔ a4b — THE NEXT FRONTIER: a counted-`for` accumulator FOLDS instead of refusing', () => {
    // ⚰️ This is a4b's marker, not a4's, and it is written here so the frontier is a
    // committed assertion rather than a sentence in a report. `s := s + close[i]` over
    // a bounded loop is plan-time expressible BY CONSTRUCTION — it is Mechanism A
    // applied to a scalar instead of a vector — and 379 of 1,004 counted-`for` bodies
    // in the corpus have this shape, which is more than every other admitted shape
    // combined.
    const src = `${HEAD}s = 0.0\nfor i = 0 to 2\n    s := s + close[i]\nplot(s, "acc")\n`
    const t = translatePine(src, { strict: true })
    const acc = (t.outputs || []).find((o) => o.title === 'acc')
    expect(acc, 'the accumulator plot survives at all').toBeTruthy()
    expect(String(acc.formula), 'the fold is a left-nested op chain over the substituted indices')
      .toMatch(/close\[1\]/)
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
