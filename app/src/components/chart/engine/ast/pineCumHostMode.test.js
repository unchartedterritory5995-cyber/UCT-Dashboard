// app/src/components/chart/engine/ast/pineCumHostMode.test.js
//
// ─── ⭐⭐⭐ THE ONE PLACE HOST MODE IS LOOSER THAN SCREENER MODE ───────────────
//
// `_functions_cumulative` refused `ta.cum` for a containment reason, not an
// arithmetic one: *"there is no per-entry flag that stops a fetch-dependent
// column flowing into a saved definition, a nightly sweep, an alert or a shared
// screen, and at every one of those consumers the defect is INVISIBLE."*
//
// The flag exists now. It lives on the DEFINITION (`_requirement_tags`), the
// five comparability consumers refuse it BY NAME, and the pane accepts it —
// because a pane is ONE symbol, ONE fetch, with the bar count on screen, so
// nothing on it is compared against another symbol or against yesterday's run.
//
// ⛔ SO THIS FILE'S SUBJECT IS A DIRECTION THAT READS BACKWARDS. Host mode is
// otherwise STRICTER than screener mode — all-or-nothing, every plot resolved or
// the script is refused. Here it is looser, and the reason is that strictness
// and comparability are different questions: "can we DRAW this?" versus "does
// this number mean the same thing twice?".

import { describe, it, expect } from 'vitest'
import { translatePine, hostAdmissible, PINE_INEXPRESSIBLE } from './pine.js'
import { TABLE } from './parse.js'

const SCRIPT = '//@version=6\n'
  + 'indicator("running total", overlay=false)\n'
  + 'total = ta.cum(volume)\n'
  + 'plot(total, "Cumulative volume")\n'

describe('ta.cum: the pane may draw it, a screen may not', () => {
  it('⛔ the SCREENER contract refuses it, and says why in the ruling’s words', () => {
    const out = translatePine(SCRIPT)
    expect(out.ok, 'a screen must not be handed a fetch-dependent level').toBe(false)
    const why = String(out.refusal && (out.refusal.detail || out.refusal.message || ''))
    // ⛔ THE SENTENCE, NOT MERELY A REFUSAL. `lesson_rail_the_sentence_not_just_
    // the_guard`: a test that only asserts "something was refused" passes when the
    // refusal comes from a different door, and this script has several doors it
    // could plausibly die at.
    expect(why).toMatch(/cum/)
    expect(why, 'the refusal must point at the anchored form that DOES work')
      .toMatch(/cumFrom/)
  })

  it('⭐ the HOST contract translates it', () => {
    const out = translatePine(SCRIPT, { strict: true })
    expect(out.ok, out.refusal && JSON.stringify(out.refusal)).toBe(true)
    expect(out.mode).toBe('host')
  })

  it('⛔ and the tree it produces really CALLS cum — not a silent substitution', () => {
    // ⚠️ THE FAILURE THIS CATCHES IS THE WORST ONE AVAILABLE HERE. A translator
    // that quietly mapped `ta.cum` onto `cumFrom` with an invented anchor, or onto
    // `sum(x, n)` with an invented window, would answer `ok: true` and produce a
    // column that is plausible on every bar and wrong on every bar. The whole
    // ruling turns on the anchor NOT being invented, so the tree is inspected.
    const out = translatePine(SCRIPT, { strict: true })
    const names = new Set()
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (n.type === 'call' && typeof n.name === 'string') names.add(n.name)
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') walk(v)
      }
    }
    walk(out.definition ?? out)
    expect(names.has('cum'), `no cum in the tree; saw ${[...names].sort()}`).toBe(true)
    expect(names.has('cumFrom'), 'an anchor was INVENTED').toBe(false)
    expect(names.has('sum'), 'a window was INVENTED').toBe(false)
  })
})

describe('the host allow-set is the manifest’s, not this file’s', () => {
  it('⭐ it is DERIVED — every name comes from a tag the pane accepts', () => {
    const admissible = hostAdmissible(TABLE)
    // non-vacuity first: a derivation that found nothing would make every
    // assertion below pass while the exemption did nothing.
    expect(admissible.size, 'the derivation found no pane-accepted call at all')
      .toBeGreaterThan(0)
    for (const name of admissible) {
      const accepting = Object.entries(TABLE._requirement_tags || {})
        .filter(([tag, spec]) => !tag.startsWith('_') && spec
          && (spec.calls || []).includes(name))
      expect(accepting.length, `${name} is admissible but no tag names it`)
        .toBeGreaterThan(0)
      for (const [, spec] of accepting) {
        expect(spec.accepted_by, `${name}'s tag does not accept the pane`)
          .toContain('pane')
      }
    }
  })

  it('⛔ an empty manifest admits NOTHING — the exemption fails closed', () => {
    expect(hostAdmissible({}).size).toBe(0)
    expect(hostAdmissible({ _requirement_tags: {} }).size).toBe(0)
    // a tag the pane does NOT accept confers nothing
    expect(hostAdmissible({
      _requirement_tags: { t: { calls: ['x'], accepted_by: ['screener'] } },
    }).has('x')).toBe(false)
  })

  it('⛔ every admissible name is still REFUSED for a screen, by name', () => {
    // ⭐ THE PAIR IS THE POINT. "Host serves it" is only safe because "screener
    // refuses it" is still true of the same name; asserting one without the other
    // is how an exemption widens into a hole.
    for (const name of hostAdmissible(TABLE)) {
      expect(PINE_INEXPRESSIBLE[name],
        `${name} is host-admissible but nothing refuses it for a screen`)
        .toBeTruthy()
    }
  })
})
