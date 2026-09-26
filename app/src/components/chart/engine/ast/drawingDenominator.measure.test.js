// app/src/components/chart/engine/ast/drawingDenominator.measure.test.js
//
// ─── ⭐⭐ WHAT IS THE HONEST DENOMINATOR FOR "SCRIPTS THAT DRAW"? ────────────
//
// This programme reports its product metric as "N of 266 scripts draw end to
// end". 266 is the size of `corpus/committed` — and it is the WRONG
// denominator, because a script that contains no drawing call at all cannot
// draw, and the object lane refuses it CORRECTLY at
// `objects:no-objects-in-source`. Counting those in the denominator makes the
// engine look worse than it is, by a fixed amount, forever.
//
//     node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/ast/drawingDenominator.measure.test.js
//
// ⛔⛔ AND IT IS ASKED TWO INDEPENDENT WAYS ON PURPOSE, because either one alone
// is a single point of failure:
//
//   SOURCE  — does the script's CODE mention a drawing constructor or method?
//             A text question, answered over comment- and string-stripped source.
//   ENGINE  — does `buildObjectLane` refuse it `objects:no-objects-in-source`?
//             The product's own answer, and the one the metric actually obeys.
//
// ⭐ WHERE THE TWO DISAGREE IS THE INTERESTING NUMBER, and it is reported rather
// than reconciled away. A script the SOURCE says draws but the ENGINE says does
// not is a script whose drawing calls the object pass could not SEE — which is a
// capability gap wearing the costume of an empty script, and it would otherwise
// sit inside a row labelled "correctly refused, not work".
//
// ⛔ CODE, NEVER PROSE. The source scan strips line comments and string literals
// before matching. This repo has had SIX separate instruments report a property
// of themselves as a property of what they measured — a sweep that matched its
// own needle, a rail that matched the prose above the call site it checked. The
// control below plants `label.new` inside a comment and inside a string and
// requires the scan to find NEITHER.
//
// ⛔ IT ASSERTS NO COUNT. A denominator pinned to a number goes red the day the
// corpus changes. What is asserted is that both methods are non-vacuous and that
// the stripper can tell code from prose.
import { describe, it, expect } from 'vitest'

import { readScript, SCRIPTS } from './peelToBuilding.js'
import { buildObjectLane } from '../runtime/objectLane.js'

const LF = String.fromCharCode(10)
const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))

const QUOTES = [String.fromCharCode(34), String.fromCharCode(39)]

/** Comments and string literals removed; strings become a space so nothing is
 *  glued across a quote. Lifted from `objectLaneRuntimeCensus`'s own stripper. */
export function stripped(src) {
  const out = []
  let quote = null
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]
    if (quote) { if (c === quote) quote = null; out.push(' '); continue }
    if (QUOTES.includes(c)) { quote = c; out.push(' '); continue }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== LF) i += 1
      out.push(LF)
      continue
    }
    out.push(c)
  }
  return out.join('')
}

/** A drawing CONSTRUCTOR or a drawing METHOD on one of the five families.
 *
 *  ⭐ `.new` ALONE IS NOT ENOUGH — `array.new_float()` is not a drawing, and a
 *  script whose only `new` is a collection would be counted as a drawer. The
 *  family name has to be one of the five the object pass owns. */
const DRAWS = new RegExp(
  '\\b(line|label|box|table|linefill)\\.'
  + '(new|delete|set_[a-z_0-9]+|get_[a-z_0-9]+|cell|copy|all)\\b',
)

const sourceDraws = (src) => DRAWS.test(stripped(src))

/** The ENGINE's answer: does it refuse for having nothing to draw? */
function engineSaysNoObjects(src) {
  let r = null
  try {
    r = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
  } catch { return false }      // a throw is not "nothing to draw"
  if (r.ok) return false
  const guard = String((r.refusal || {}).guard || '')
  return guard === 'objects:no-objects-in-source' || guard === 'pine:no-output'
}

describe('⭐⭐ the honest denominator for the drawing metric', () => {
  it('⛔ CONTROL — the corpus is on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⛔⛔ CONTROL — the scan reads CODE, not prose', () => {
    // ⭐ THE ONE WAY THIS IS QUIETLY WORTHLESS. A scan that matches its needle
    // inside a comment counts every script that MENTIONS drawing. Six instances
    // of exactly that are recorded in this repo's own conventions.
    const q = String.fromCharCode(34)
    expect(sourceDraws('// label.new(x) is what we would use here'), 'matched a COMMENT')
      .toBe(false)
    expect(sourceDraws(`s = ${q}label.new${q}`), 'matched a STRING literal').toBe(false)
    // ...and it must still see a real one, or it is passing by seeing nothing.
    expect(sourceDraws('l = label.new(bar_index, high, "x")'), 'missed a real call')
      .toBe(true)
    expect(sourceDraws('box.set_bgcolor(b, color.red)'), 'missed a real method').toBe(true)
    // ⛔ AND A COLLECTION CONSTRUCTOR IS NOT A DRAWING.
    expect(sourceDraws('a = array.new_float(0)'), 'counted a collection as a drawing')
      .toBe(false)
  })

  it('⭐⭐ prints both denominators and, more usefully, where they DISAGREE', () => {
    const bySource = []
    const byEngine = []
    const sourceOnly = []      // code mentions a drawing, engine sees none
    const engineOnly = []      // engine finds objects, code scan missed them
    for (const name of SCRIPTS) {
      const src = readScript(name)
      const s = sourceDraws(src)
      const e = !engineSaysNoObjects(src)
      if (s) bySource.push(name)
      if (e) byEngine.push(name)
      if (s && !e) sourceOnly.push(name)
      if (!s && e) engineOnly.push(name)
    }
    const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`

    // eslint-disable-next-line no-console
    console.log([
      '',
      `DRAWING DENOMINATOR — ${SCRIPTS.length} committed scripts`,
      '',
      `  the SOURCE mentions a drawing call      : ${bySource.length}`,
      `  the ENGINE does not refuse "no objects" : ${byEngine.length}`,
      '',
      '⛔ THE METRIC SHOULD BE REPORTED AGAINST THE SMALLER OF THESE, NOT 266.',
      `  a script with no drawing call cannot draw, and ${SCRIPTS.length - bySource.length}`,
      '  of the corpus have none — counting them makes the engine look worse by a',
      '  fixed amount, forever.',
      '',
      `⭐ SOURCE says draws, ENGINE says nothing to draw : ${sourceOnly.length}`,
      '  ⛔ THIS IS THE INTERESTING NUMBER. These are scripts whose drawing calls',
      '  the object pass could not SEE — a capability gap wearing the costume of an',
      '  empty script, currently sitting inside a row labelled "correctly refused".',
      ...sourceOnly.slice(0, 12).map((n) => `      ${n}`),
      sourceOnly.length > 12 ? `      …and ${sourceOnly.length - 12} more` : '',
      '',
      `⚠️ ENGINE finds objects, SOURCE scan missed them : ${engineOnly.length}`,
      '  (a hole in the scan above, not in the engine — report it, do not tune it away)',
      ...engineOnly.slice(0, 6).map((n) => `      ${n}`),
      '',
      `  as a fraction of the corpus : ${pct(bySource.length, SCRIPTS.length)} draw-capable`,
      '',
    ].join(LF))

    // ⛔ NON-VACUITY BOTH WAYS. A scan that matched everything or nothing tells
    // us about the scan, not the corpus.
    expect(bySource.length).toBeGreaterThan(0)
    expect(bySource.length).toBeLessThan(SCRIPTS.length)
    expect(byEngine.length).toBeGreaterThan(0)
  }, 900000)
})
