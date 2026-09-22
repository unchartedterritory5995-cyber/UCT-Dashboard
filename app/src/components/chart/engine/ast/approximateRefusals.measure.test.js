// app/src/components/chart/engine/ast/approximateRefusals.measure.test.js
//
// ─── ⭐⭐ REFUSALS THAT DO NOT KNOW WHERE THEY ARE ───────────────────────────
//
// A refusal can carry no location. When that happens `pineRuntimeFrontend`'s
// catch does not leave the line blank — it pins the refusal to whichever
// STATEMENT the walker had open and marks it `locationIsStatement`. The member
// is then pointed at a line that is not the problem, under a sentence about a
// line the translator read perfectly well.
//
//     node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/ast/approximateRefusals.measure.test.js
//
// ⚰️⚰️ WHY THIS IS AN INSTRUMENT AND NOT A FOOTNOTE. Measured over
// `corpus/committed` on 2026-09-22: 193 of 266 scripts stop on a refusal, and
// **96 of them — 36.1% of the corpus — stop on one that cannot say where it
// is.** The largest single guard is `runtime/pine:statement` at 79, where the
// ratio is 79 of 79: every one of them approximate, not a majority.
//
// ⚠️ The 79 figure was the first thing measured and it UNDERSTATED the class
// by 17 scripts and five guards, because it was reached by asking about ONE
// guard rather than about the property. Recorded because the narrow number is
// the one a reader will remember.
//
// ⭐⭐ AND IT DEFEATS EVERY TOOL THAT WORKS BY LINE, which is what makes it a
// measurement problem rather than only a diagnostics one. `distanceToWorking`
// peels the refused line and rebuilds; when the reported line is innocent,
// peeling it changes nothing, the same refusal returns on the same line, and
// the script is recorded UNREACHED. So roughly a third of the corpus is filed
// as "more than 20 capabilities away" on the strength of refusals that never
// knew where they were. Every distance in this programme is an OVER-estimate by
// an unknown amount until this is closed.
//
// ─── WHAT IS ESTABLISHED, AND WHAT IS NOT ───────────────────────────────────
//
// ⭐⭐ ESTABLISHED, AND IT IS A CLASS RATHER THAN A SITE. Driving one fixture
// per guard family through `buildObjectLane` and reading `locationIsStatement`:
//
//     runtime:colour   plot(color.red)                 approximate = FALSE
//     runtime:colour   bgcolor(close)                  approximate = FALSE
//     runtime:array    a.reverse()                     approximate = FALSE
//     pine:function    ta.notarealfunction(close, 5)   approximate = TRUE
//     pine:undefined   plot(nosuchname)                approximate = TRUE
//     pine:drawing     a line used as a value          approximate = TRUE
//     pine:builtin     syminfo.mintick                 approximate = TRUE
//
// **Every `runtime:`-namespaced guard keeps its position; every `pine:`-guard
// reaching the runtime lane loses it.** The runtime lane raises its own with a
// location and the ones it delegates to `pine.js` arrive without one — so this
// is one seam, not a scattering of sites, and it is worth ONE fix.
//
// ⛔ A narrower earlier reading blamed `parseWholeExpression` (the `if (rest)`
// arm), reached by tagging every `pine:statement` raise and seeing which fired.
// That is where `pine:statement` comes from, and it is not the whole story:
// six guards show the behaviour, so a fix aimed at that one arm would move
// 79 of the 96 and leave the class open.
//
// ⛔ NOT ESTABLISHED, and two plausible fixes were tried and MEASURED AS NO-OPS
// rather than assumed to work:
//
//   1. `parsePrimary`'s cursor-exhaustion raise throws with a literal `null`
//      location and looks like the obvious culprit. Giving it the last token's
//      position (the idiom `Cursor.expect` already uses) changed the corpus
//      count by ZERO — it is not the site that fires.
//   2. Falling back through the statement's own tokens at the real site also
//      changed it by ZERO. Instrumenting that site shows the tokens it holds DO
//      carry positions (`withPos = 5 of 5`) and the leftover token is `=>` —
//      a user-function header, thrown and CAUGHT as a probe. So the refusal
//      that ultimately surfaces is a different call, and "the tokens are
//      synthesised" — the natural explanation — is FALSE for the calls that
//      were observed.
//
// ⛔⛔ BOTH FIXES WERE REVERTED. Each is a real improvement in principle and
// neither could be shown to fire, and a guard nobody has seen fire is
// decoration (`lesson_gate_that_cannot_fail`). The next engineer starts from a
// measured position rather than from two plausible patches that changed nothing.
//
// ⛔ IT ASSERTS NO COUNT. A census pinned to a number goes red the day someone
// improves it. What is asserted is that the corpus is real and that the
// classifier can TELL THE TWO KINDS APART.
import { describe, it, expect } from 'vitest'

import { readScript, SCRIPTS, bindingNameOf } from './peelToBuilding.js'
import { buildObjectLane } from '../runtime/objectLane.js'

const LF = String.fromCharCode(10)
const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
}))

/**
 * Peel a script until it builds or cannot be peeled further, and report the
 * refusal it STOPPED on — with whether that refusal knew its own line.
 *
 * ⭐ IT PEELS RATHER THAN READING THE FIRST BLOCKER, because the question is
 * about the walls a line-based tool actually hits, and the first blocker is
 * usually peelable. The stopping refusal is the one that defeats the tool.
 */
export function stoppedOn(src, cap = 20) {
  const work = src.split(LF)
  for (let step = 0; step < cap; step += 1) {
    let r = null
    try {
      r = buildObjectLane(work.join(LF), { tf: 'D', newestBarIsForming: false, bars: BARS })
    } catch { return { kind: 'threw' } }
    if (r.ok) return null
    const ref = r.refusal || {}
    const guard = `${r.lane}/${ref.guard || '?'}`
    const idx = Number(ref.line || 0) - 1
    const noLine = !(idx >= 0 && idx < work.length)
    const bound = noLine ? null : bindingNameOf(work[idx])
    const next = bound ? `${bound.indent}${bound.name} = 0.0` : ''
    if (noLine || work[idx] === next) {
      return { kind: 'stuck', guard, approximate: ref.locationIsStatement === true, line: ref.line }
    }
    work[idx] = next
  }
  return { kind: 'cap' }
}

describe('⭐⭐ refusals that do not know their own line', () => {
  it('⛔ CONTROL — the corpus is on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⛔⛔ CONTROL — the classifier can tell APPROXIMATE from EXACT', () => {
    // ⭐ THE ONE WAY THIS IS QUIETLY WORTHLESS: a reader that answers the same
    // thing for everything. Both halves are MEASURED fixtures, not guesses — the
    // first draft of this control used an unknown `ta.*` function as its "exact"
    // case and FAILED, because that one is approximate too.
    const q = String.fromCharCode(34)
    const H = `//@version=6${LF}indicator(${q}t${q}, overlay = true)${LF}`
    const T = `var t = table.new(position.top_right, 1, 1)${LF}`
    const build = (body) => {
      try { return buildObjectLane(H + T + body, { tf: 'D', newestBarIsForming: false, bars: BARS }) }
      catch { return null }
    }
    // EXACT: a guard the RUNTIME lane raises itself.
    const exact = build(`bgcolor(close)${LF}`)
    expect(exact && exact.ok === false, 'the exact fixture did not refuse').toBe(true)
    expect((exact.refusal || {}).line, 'the exact fixture carries no line').toBeTruthy()
    expect((exact.refusal || {}).locationIsStatement, 'the exact fixture reads approximate')
      .not.toBe(true)

    // APPROXIMATE: a guard delegated to `pine.js`.
    const approx = build(`plot(ta.notarealfunction(close, 5))${LF}`)
    expect(approx && approx.ok === false, 'the approximate fixture did not refuse').toBe(true)
    expect((approx.refusal || {}).locationIsStatement, 'the approximate fixture reads exact')
      .toBe(true)
  })

  it('⭐⭐ prints how many scripts stop on a refusal that cannot say where it is', () => {
    const rows = []
    const byGuard = new Map()
    let stuck = 0
    let approx = 0
    for (const name of SCRIPTS) {
      const s = stoppedOn(readScript(name))
      if (!s || s.kind !== 'stuck') continue
      stuck += 1
      if (!s.approximate) continue
      approx += 1
      byGuard.set(s.guard, (byGuard.get(s.guard) || 0) + 1)
      rows.push(`${name}  ${s.guard}  reported L${s.line}`)
    }
    const pct = (n) => `${((n / SCRIPTS.length) * 100).toFixed(1)}%`

    // eslint-disable-next-line no-console
    console.log([
      '',
      `APPROXIMATE REFUSALS — ${SCRIPTS.length} scripts, peel cap 20`,
      '⛔ the reported line is the enclosing STATEMENT, not the problem. A tool',
      '  that peels by line cannot make progress on any of these.',
      '',
      `  scripts that STOP on a refusal        : ${stuck}`,
      `  …of which the location is APPROXIMATE : ${approx}  (${pct(approx)} of the corpus)`,
      '',
      'by guard:',
      ...[...byGuard.entries()].sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${String(n).padStart(5)}  ${g}`),
      '',
      '⭐ the site is `parseWholeExpression` in pine.js. Two plausible fixes were',
      '  tried and measured as NO-OPS — see this file’s header before trying a third.',
      '',
      ...rows.slice(0, 12).map((r) => `    ${r}`),
      rows.length > 12 ? `    …and ${rows.length - 12} more` : '',
      '',
    ].join(LF))

    // ⛔ NON-VACUITY, BOTH WAYS. Zero would mean the walk never stopped anywhere
    // (a broken peeler); every script would mean the classifier says yes to
    // everything. Neither is a finding about the corpus.
    expect(stuck, 'no script stopped anywhere — the peeler is broken').toBeGreaterThan(0)
    expect(approx).toBeLessThan(SCRIPTS.length)
  }, 900000)
})
