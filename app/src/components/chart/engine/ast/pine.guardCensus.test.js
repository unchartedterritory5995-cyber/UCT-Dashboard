import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, REFUSALS as PINE_REFUSALS } from './pine.js'

/**
 * WHICH OF THIS DOOR'S DECLARED GUARDS THE REAL CORPORA ACTUALLY FIRE — BY NAME.
 *
 * ⚰️ THE thinkSCRIPT DOOR HAS HAD THIS SINCE ITS INTAKE BENCH WAS BUILT
 * (`thinkscriptIntake.test.js` records `_guardsFired`, a named set). The Pine
 * door had no equivalent, so "these guards work" rested on the unit tests that
 * happen to exist, and nothing said which guards NOTHING exercises.
 *
 * ⛔ A GUARD NOBODY HAS SEEN FIRE IS NOT A GUARD. That is a standing lesson here,
 * and the cost is specific: an unexercised refusal can have a stale sentence, a
 * wrong guard name, or an unreachable branch, and every one of those looks
 * identical to a working one until a member hits it.
 *
 * ⭐ SO THIS NAMES BOTH SETS. Not a count — a count is satisfied by any N guards,
 * and swapping an exercised guard for an unexercised one leaves it unmoved. The
 * unexercised roster is written down so ADDING to it is a visible decision rather
 * than a silent gap.
 *
 * ⚠️ AND ITS SCOPE IS NARROW ON PURPOSE: it measures what the CORPORA fire, which
 * is not the same as what the whole suite fires. A guard listed as unexercised
 * here may well be covered by a unit test — `pine.displace.test.js` drives
 * `pine:plot-offset`, for instance. What this file answers is "does a real
 * published script ever reach this?", which is the question the corpora exist to
 * answer and which no other file asks.
 */
describe('the Pine guard census, by name', () => {
  const CORPORA = [
    path.resolve(process.cwd(), '../tests/fixtures/pine_community'),
    path.resolve(process.cwd(), '../tests/fixtures/pine'),
  ]

  const fired = (() => {
    const seen = new Set()
    let scripts = 0
    for (const dir of CORPORA) {
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.pine'))) {
        scripts += 1
        const out = translatePine(fs.readFileSync(path.join(dir, f), 'utf8'))
        if (out.refusal) seen.add(out.refusal.guard)
        for (const r of out.refusals || []) if (r && r.guard) seen.add(r.guard)
        for (const o of out.outputs || []) if (o.refusal) seen.add(o.refusal.guard)
      }
    }
    return { seen, scripts }
  })()

  const DECLARED = Object.keys(PINE_REFUSALS).sort()

  it('⛔ the census read a real corpus — not vacuous', () => {
    // A moved fixture directory would otherwise leave every set empty and every
    // assertion below green forever.
    expect(fired.scripts).toBeGreaterThanOrEqual(45)
    expect(DECLARED.length).toBeGreaterThan(25)
    expect(fired.seen.size).toBeGreaterThan(5)
  })

  it('⭐ every guard the corpora fire is one this module DECLARES', () => {
    // The direction that catches a typo'd guard name at a throw site: a guard
    // fired but never declared has no sentence, so a member sees a bare code.
    const undeclared = [...fired.seen].filter((g) => !DECLARED.includes(g)).sort()
    expect(undeclared, 'a guard was thrown that this module never declared').toEqual([])
  })

  it('⭐⭐ and the guards NO published script reaches are named, not counted', () => {
    // ⛔ THE ROSTER IS THE POINT. A count would be satisfied by any set of the
    // same size, so an exercised guard could quietly swap places with an
    // unexercised one and this would stay green.
    //
    // ⚠️ BEING ON THIS LIST IS NOT A DEFECT. Most of these refuse constructs no
    // published indicator happens to contain — which is exactly what a corpus of
    // real scripts can and cannot tell you. The list exists so that a guard
    // ARRIVING here is a decision somebody made, and so anyone auditing a
    // refusal's wording knows which sentences no real script has ever produced.
    const unexercised = DECLARED.filter((g) => !fired.seen.has(g))
    expect(unexercised.sort()).toEqual(EXPECTED_UNEXERCISED)
  })
})

/** ⭐ REGENERATE, NEVER HAND-EDIT: run the case above, paste what it reports, and
 *  say in the diff WHY a guard moved on or off. A name leaving this list means a
 *  corpus script now reaches it; a name arriving means one stopped. */
// ⭐⭐ `pine:window` LEFT THIS LIST on 2026-08-30, and a guard leaving it is the
// direction worth noticing: an unexercised refusal is a sentence NO MEMBER HAS EVER
// READ, so nothing has ever checked that it helps. `07-hull-suite` now reaches it
// — the `int` fold cleared the two walls in front — and what it reads there names
// `hma(close, 55)` as the call that spares the whole hand-expansion.
// ⭐⭐ `pine:cycle` LEFT THE LIST on 2026-08-31, the same way and for the same
// kind of reason: `float(x)` folds to the identity now, so `02-ict`'s four
// `pine:function` output refusals stopped stopping at a CAST and reached the
// walls actually in their way — two `pine:state` at line 105 and two `pine:cycle`
// at line 112. Both are real: `previous_state = nz(current_state[1])` reads
// `current_state` BEFORE three later `:=` branches, so the binding read is not
// the last word on the name, and `trigger_condition` is computed from it.
// ⛔ THE FOLD DID NOT CREATE THESE. It removed the thing standing in front of
// them — which is what makes an unexercised guard the wrong thing to celebrate:
// its sentence had never been read by anyone until a cast stopped hiding it.
// ⭐⭐ `pine:constant-only` AND `pine:presentation-only` ARRIVED on 2026-09-07,
// and they arrived as NEW GUARDS rather than by a corpus script stopping short.
// Both name outcomes this door previously expressed as SILENCE — `ok:false` with
// `refusal: null` — which OOS-2 found on a real published indicator and which
// five tests in this directory had pinned as the expected shape.
//   · `pine:constant-only` — every column the script would offer holds the same
//     number on every bar.
//   · `pine:presentation-only` — every column is an unchanged price series the
//     script merely draws with, i.e. `plotcandle(open, high, low, close,
//     color = <the indicator>)`, whose payload is the colour this door drops.
// ⚠️ NEITHER IS UNEXERCISED IN THE SENSE THIS LIST WARNS ABOUT. The two published
// corpora do not reach them, so they belong here — but both are pinned by
// dedicated cases in `pine.plotcandle.test.js` and
// `pine.forLoopReassignSilentWrongResult.test.js`, and the 60-script OOS corpus
// reaches the passthrough PATH on two scripts (each surfacing an earlier, more
// specific refusal first, which is the better sentence to show).
const EXPECTED_UNEXERCISED = [
  'pine:character',
  'pine:colour-value',
  'pine:constant-only',
  'pine:declaration-library',
  'pine:drawing',
  'pine:empty',
  'pine:function-def',
  'pine:history-ref',
  'pine:input-kind',
  // ⭐ HOST MODE ONLY (2026-09-08). The census runs the corpus through the
  // LENIENT contract, where `barstate.*` still folds to its closed-bar value —
  // so no published script reaches this guard here, and that is correct rather
  // than a gap. `pineStrictMode.test.js` exercises it directly.
  'pine:live-bar-state',
  'pine:na',
  'pine:named-argument',
  'pine:offset-literal',
  'pine:offset-negative',
  'pine:operator',
  'pine:presentation-only',
  'pine:role-order',
  'pine:roundtrip',
  // ⭐⭐ ARRIVED 2026-08-29, and this is the "door got better" direction the note
  // at the foot of this file warns has to be argued rather than shrugged at.
  // `07-hull-suite` was the ONE published script reaching `pine:statement`, and it
  // reached it with `line: null` and `token: null` — a refusal saying "this line
  // is not a shape the translator reads" about a line the member never wrote,
  // because the splitter had cut a three-line ternary chain into three statements.
  // A line ending in a dangling binary operator is not a statement in Pine either,
  // so it now continues; the script reaches its real first wall (`pine:function`
  // on the `int(…)` cast) at a token that is on the screen.
  // ⚠️ Unexercised does NOT mean dead: `pine:statement` still answers for genuine
  // constructs this door cannot read. It means no PUBLISHED script now reaches it.
  'pine:statement',
  'pine:text-value',
  // ⭐⭐ ARRIVED 2026-09-09 AND BELONGS HERE ON PURPOSE. `pine:timeout` is the
  // wall-clock + step-count guard: it fires when translation does not finish
  // inside its budget, which no HEALTHY script ever does. Being unexercised by
  // the corpus is the correct state and is not evidence the guard is inert — it
  // is proven to fire by `pine.timeout.test.js`, which asks a normal script to
  // stop at 100 resolution steps and checks it refuses by name.
  // ⚠️ It will LEAVE this list the day a corpus script legitimately exceeds the
  // budget, and that would be a defect in the translator, not in the script.
  'pine:timeout',
  'pine:type',
  // ⭐⭐ MOVED HERE 2026-08-28, and the move IS the measurement. `pine:undefined`
  // was reached by exactly one published script — `10-ehlers-instantaneous-trend`,
  // whose `it = … it[1] … it[2]` is a plain self-reference — and it refused
  // NAMING THE VARIABLE BEING DEFINED, which reads as though the member forgot a
  // declaration they had just written. The translator now recognises that shape,
  // so the script refuses at `pine:state` for the reason that is actually true.
  // ⚠️ Unexercised does NOT mean dead: an undefined name is still a real refusal
  // a member can reach by typo. It means no PUBLISHED script does.
  'pine:undefined',
  // ⭐⭐ ARRIVED 2026-09-09 WITH THE BARSTATE RULING, and it belongs here on
  // purpose. `pine:window-dependent` refuses a value whose answer moves with how
  // much history was loaded — today exactly one name reaches it, `barstate.isfirst`
  // on a SCREEN, and no published script in either corpus writes it. Being
  // unexercised is the correct state rather than a gap.
  // ⚠️ IT IS NOT UNTESTED: `pine.barstate.test.js` and `pineStrictMode.test.js`
  // both drive it directly, in BOTH directions — a screen refuses, a pane draws —
  // because asserting only the refusal is how an exemption becomes a hole.
  // ⛔ IT WILL LEAVE THIS LIST the day a corpus script writes `barstate.isfirst`,
  // which is a perfectly ordinary thing to write for initialisation, so the move
  // would be a fact about the corpus rather than a defect.
  'pine:window-dependent',
]

/* ⭐ MEASURED ACROSS BOTH PUBLISHED CORPORA. The guards above are reached by NONE
 * of them.
 *
 * ⛔ NO COUNT IS WRITTEN HERE ANY MORE, AND THAT IS THE POINT. It said "Nineteen"
 * beside a list that is the only authority on the number, so the day a guard moved
 * on or off, the prose and the list disagreed and the list was right. Count
 * `EXPECTED_UNEXERCISED` — it is four lines up.
 *
 * ⚠️ READ THE LIST CORRECTLY: it does NOT mean those guards are untested. Several
 * have dedicated unit tests — `pine.window.test.js` drives `pine:window`,
 * `pine.namedargs.test.js` drives `pine:named-argument`, and the modulo operator
 * drives `pine:operator`. What it means is that no real published indicator in
 * our corpora contains the construct, so those SENTENCES have never been
 * produced by a script anybody actually wrote.
 *
 * ⛔ THAT IS WORTH KNOWING PRECISELY BECAUSE OF WHAT THIS WEEK FOUND: five of
 * this door's refusal sentences were FALSE about the engine's own capabilities,
 * and each had sat unread because nothing forced anyone to look. A guard on this
 * list is a sentence with no field evidence behind it.
 *
 * ⚠️ `pine:window` and `pine:operator` are here for a reason worth noting: both
 * DID fire from the corpora until this week. Script 20 moved off `pine:window`
 * when window constant-folding landed, and no corpus script uses the modulo
 * operator. A guard can leave the exercised set because the DOOR GOT BETTER, not
 * only because coverage got worse — so a name arriving here needs its reason in
 * the diff, not a shrug. */
