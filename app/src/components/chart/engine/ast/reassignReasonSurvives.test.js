// app/src/components/chart/engine/ast/reassignReasonSurvives.test.js
//
// ─── ⭐⭐ (g) — THE REASSIGN REFUSAL NAMES THE REASON IT ALREADY KNOWS ─────────
//
// (g)'s census measured the premise FALSE: `s := close` is not a typing gap. A
// binding holds a NODE, and for `s := close` that node IS the series, so there is no
// type to lose; `s[k]` is routed by the MUTATION SET, not by a declared type. Only
// **13 of 266** corpus scripts refuse `pine:reassign` at all, and a script doing
// `var float mhigh = na` / `mhigh := high[1]` inside an `if` / plotting it comes out
// `host: true, hostGuards: []`.
//
// ⛔ WHAT IS REAL IS THE SENTENCE. The closing pass's `missed` branch computes
// `why = unfoldable.get(name)` — the reason the fold ACTUALLY stopped, remembered
// per name by the `if`-chain catch — and then **never reads it**: `why` is used only
// in the `else if`. So a member whose `varip` accumulator stopped the fold thirty
// lines earlier is told *"a name that is reassigned later cannot be folded into one
// expression"*, which is true of the line it names and says nothing about the cause.
//
// ⭐ R7a ALREADY DECIDED THE HARD HALF, AND THIS KEEPS IT. Overwriting the LOCATION
// is deliberate — `missed` is the `:=` token and the reassignment fact lives exactly
// there — but "overwriting the location was never a reason to discard the reason".
// R7a carried `held.reason` forward for a binding that was already opaque WITH a
// reason. This adds the one case R7a could not reach: the name went opaque through
// the `if`-chain catch, which records into `unfoldable` and not into `env`.
//
// ⛔ THIS IS THE CLOSING PASS, NOT THE BLOCK WALK. It touches neither
// `foldStatements` nor `destructureBindings` nor `foldIfChain`, so it is not the
// ruling-triggering change (g)'s census suggested it might be — checked by reading
// `pine.js:11320-11358` rather than taken on report.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

/** The corpus script (g) traced end to end: `varip int barIndex = 1` at :97 goes
 *  opaque `pine:state`; `barIndex += 1` inside an `if` throws it; the closing pass
 *  re-places the refusal at the `:=` line and drops the reason. */
const CORPUS = 'corpus/committed/bolingger-bands-inside-bar-boxes__3294017d4f.pine'

/** The same shape, small enough to read. `varip` makes the accumulator a state
 *  binding; the `+=` inside the `if` is what the fold cannot take. */
const SYNTHETIC = `indicator("x")
varip int n = 0
if close > open
    n += 1
plot(close + n)
`

const guardsOf = (t) => (t.refusals || []).map((r) => r.guard || r.code)
const msgFor = (t, guard) =>
  String(((t.refusals || []).find((r) => (r.guard || r.code) === guard) || {}).message || '')

describe('(g) — a reassign refusal carries the reason the walk already recorded', () => {
  it('⛔⛔ NON-VACUITY CONTROL — both specimens REACH pine:reassign', () => {
    // Without this, "the sentence mentions the cause" passes over a script that
    // refused earlier for an unrelated reason, or produced no refusal at all.
    expect(fs.existsSync(path.join(REPO, CORPUS)), 'the corpus specimen is gone').toBe(true)
    for (const [label, src] of [['corpus', read(CORPUS)], ['synthetic', SYNTHETIC]]) {
      const g = guardsOf(translatePine(src, { strict: true }))
      expect(g, `${label}: pine:reassign never fired, so nothing is under test`)
        .toContain('pine:reassign')
    }
  })

  it('⭐⭐ the refusal names the REAL cause, not just the reassigned name', () => {
    for (const [label, src] of [['corpus', read(CORPUS)], ['synthetic', SYNTHETIC]]) {
      const m = msgFor(translatePine(src, { strict: true }), 'pine:reassign')
      expect(m.length, `${label}: no pine:reassign message at all`).toBeGreaterThan(0)
      // The cause here is a bar-to-bar state binding. The sentence must say so —
      // a member cannot act on "it is reassigned later" when the fix is a `varip`.
      expect(m, `${label}: the sentence carries only the name, not the cause`)
        .toMatch(/bar to bar|bar-to-bar|state|varip/i)
    }
  })

  // ── CONTROLS: what (g) must not move.

  it('⛔⛔ CONTROL — R7a stands: the refusal still lands on the `:=` LINE', () => {
    // R7a chose the reassignment's own line deliberately and gave its reason. This
    // change carries a sentence, and must not quietly move the location back.
    const t = translatePine(SYNTHETIC, { strict: true })
    const r = (t.refusals || []).find((x) => (x.guard || x.code) === 'pine:reassign')
    expect(r).toBeTruthy()
    expect(r.line, 'the refusal moved off the `:=` line').toBe(4)
  })

  it('⛔⛔ CONTROL — the refusal SET is unchanged; a sentence is not a new refusal', () => {
    // A wording fix must not add, drop or re-code a refusal on any specimen.
    //
    // ⚰️ THE MEASURED COUNT, NOT AN ASSUMED ONE. This control was written asserting
    // `1` on both specimens and went red on the corpus, which carries **2** —
    // the same defect as d1's first control, which assumed 0 refusals for a script
    // holding 23. A control that pins a number nobody measured tests the author's
    // expectation, not the engine.
    const MEASURED = [['corpus', read(CORPUS), 2], ['synthetic', SYNTHETIC, 1]]
    for (const [label, src, n] of MEASURED) {
      const g = guardsOf(translatePine(src, { strict: true }))
      expect(g.filter((x) => x === 'pine:reassign').length, `${label}: reassign count moved`)
        .toBe(n)
      expect(g.every((x) => typeof x === 'string' && x.startsWith('pine:')),
        `${label}: a non-pine guard appeared`).toBe(true)
    }
  })

  it('⛔⛔ CONTROL — (g) is NOT a typing gap: the folding case still folds', () => {
    // The census's headline, pinned so a later "fix" for (g) cannot quietly break
    // the 592 admissible-and-reachable uses that already work.
    const works = `indicator("x")
var float mhigh = na
if close > open
    mhigh := high[1]
plot(mhigh)
`
    const t = translatePine(works, { strict: true })
    expect(guardsOf(t), 'a reassignment that already folds started refusing')
      .not.toContain('pine:reassign')
  })
})
