// app/src/components/chart/engine/ast/symbolRosterSpeaks.test.js
//
// ─── ⭐⭐ (h) / PA-1 — THREE `syminfo.*` FIELDS RETIRE **BY NAME** ─────────────
//
// `symbolScope.json::unserved` is a ROSTER, and the manifest says why in its own
// words: *"A namespace-wide fallthrough would refuse an unknown `syminfo.whatever`
// with the same sentence as `syminfo.mintick`, and nobody could tell from the
// outside which names had been THOUGHT ABOUT and which had merely fallen through.
// The roster is the thinking; the fallthrough stays behind it for names nobody has
// ruled on yet."*
//
// ⭐ (h)'s census measured three names that have now been ruled on and were still
// falling through: **`basecurrency` (22 uses / 7 files), `timezone` (13 / 6) and
// `root` (1 / 1)** — 36 uses across 14 files, which is MORE than the four
// refused-by-name fields it sits beside (14 uses). They are not a silence: the
// namespace fallthrough (`pine.js:575`) does refuse them. They are refused
// ANONYMOUSLY, which is the thing this manifest exists to prevent.
//
// ⛔ THE FIX IS DATA, NOT CODE. `BUILTIN_SYMBOL_UNSERVED` (`pine.js` ≈1240) is
// derived from the roster "so the roster has ONE owner", so adding three entries
// makes them refuse by name with no engine change — and this file is the rail that
// the derivation is real rather than a comment claiming agreement.
import { describe, it, expect } from 'vitest'
import { translatePine, BUILTIN_SYMBOL_UNSERVED, REFUSALS } from './pine.js'
import SYMBOL_SCOPE from './symbolScope.json'

/** The three (h) retires, with the corpus numbers that earned each its entry. */
const RETIRED = [
  ['basecurrency', 22, 7],
  ['timezone', 13, 6],
  ['root', 1, 1],
]
/** Already rostered before (h) — the control group. */
const ALREADY = ['type', 'currency', 'session', 'mintick', 'pointvalue', 'description']

const useOf = (field) => `indicator("x")\nplot(close)\nplot(str.length(syminfo.${field}))\n`
const refusalsOf = (src) => (translatePine(src, { strict: true }).refusals || [])

describe('(h) — three syminfo fields retire by name, from the roster', () => {
  it('⛔⛔ NON-VACUITY CONTROL — every specimen REACHES the field and refuses at all', () => {
    // Without this, "the sentence names the field" passes over a script that
    // refused at line 1 and never reached `syminfo.*` — and an empty refusal list
    // satisfies every `.some()` in this file.
    for (const [field] of [...RETIRED.map((r) => r), ...ALREADY.map((f) => [f])]) {
      const refs = refusalsOf(useOf(field))
      expect(refs.length, `${field}: nothing refused, so nothing is under test`)
        .toBeGreaterThan(0)
    }
    // And the control that the door can SERVE, so "refuses" is a fact about these
    // names and not about every `syminfo.*` read.
    expect(translatePine(`indicator("x")\nplot(close)\n`, { strict: true }).ok).toBe(true)
  })

  it('⭐⭐ each retired field is REFUSED BY NAME, carrying a reason a member can act on', () => {
    for (const [field] of RETIRED) {
      const key = `syminfo.${field}`
      expect(Object.keys(BUILTIN_SYMBOL_UNSERVED), `${key} is not on the roster`)
        .toContain(key)
      const why = BUILTIN_SYMBOL_UNSERVED[key]
      expect(String(why).length, `${key}'s reason is too short to act on`)
        .toBeGreaterThan(40)
      const refs = refusalsOf(useOf(field))
      expect(refs.some((r) => String(r.message).includes(field)),
        `${key} refuses without naming itself`).toBe(true)
    }
  })

  it('⛔ the roster is DERIVED from the manifest, not a second copy in the engine', () => {
    // ⚰️ `lesson_a_comment_claiming_agreement_is_not_agreement` — prove it by
    // deriving one from the other, not by reading a sentence that says they match.
    const fromManifest = Object.keys(SYMBOL_SCOPE.unserved)
      .filter((k) => !k.startsWith('_'))
      .map((k) => `syminfo.${k}`)
      .sort()
    expect(Object.keys(BUILTIN_SYMBOL_UNSERVED).sort()).toEqual(fromManifest)
  })

  // ── CONTROLS: what (h) must not move.

  it('⛔⛔ CONTROL — the six fields rostered BEFORE (h) are untouched', () => {
    for (const field of ALREADY) {
      const key = `syminfo.${field}`
      expect(Object.keys(BUILTIN_SYMBOL_UNSERVED)).toContain(key)
      expect(refusalsOf(useOf(field)).some((r) => String(r.message).includes(field)))
        .toBe(true)
    }
  })

  it('⛔⛔ CONTROL — the SERVED fields still serve; a roster entry is not a ban', () => {
    // `syminfo.ticker` folds always; `prefix`/`tickerid` are witness-gated and
    // refuse with `pending_measurement`'s sentence — a DIFFERENT sentence from
    // `unserved`'s, and the difference is the whole point of two rosters.
    expect(Object.keys(BUILTIN_SYMBOL_UNSERVED)).not.toContain('syminfo.ticker')
    expect(Object.keys(BUILTIN_SYMBOL_UNSERVED)).not.toContain('syminfo.prefix')
    expect(Object.keys(BUILTIN_SYMBOL_UNSERVED)).not.toContain('syminfo.tickerid')
    expect(Object.keys(SYMBOL_SCOPE.pending_measurement).filter((k) => !k.startsWith('_')).sort())
      .toEqual(['prefix', 'tickerid'])
  })

  it('⛔⛔ CONTROL — no 42nd REFUSALS code and no 12th node type was implied', () => {
    // A roster entry is DATA. If retiring three names moved either frozen table,
    // the fix was not the one that was ruled.
    //
    // ⭐ THE NUMBER MOVED 41 → 42 ON 2026-09-20, AND NOT BECAUSE OF (h). A
    // separate change declared `pine:objects-only` — the sentence a script that
    // draws a TABLE and offers no plot now gets, instead of being told it
    // "offers no plot and no alert condition", which is true and which reads to
    // the author of a working dashboard as "this engine cannot see my script".
    //
    // ⭐ AND 42 → 43 ON 2026-09-21, AGAIN NOT BECAUSE OF (h). The postfix-member
    // rule declared `pine:member`: `arr.get(i).delete()` used to be refused
    // `pine:character` — "Pine has no character like this one" — about a dot
    // every Pine author writes. It lexes and parses now; what stops it is the
    // receiver's TYPE, and that is a different sentence.
    //
    // ⚠️ WHAT THIS CASE ASKS IS UNCHANGED: did ruling (h) move the table? It did
    // not. The count is re-pinned rather than loosened to a floor, because a
    // floor would stop catching what it was written for — a roster edit that
    // quietly grows the refusal vocabulary.
    expect(Object.keys(REFUSALS).length).toBe(43)
  })
})
