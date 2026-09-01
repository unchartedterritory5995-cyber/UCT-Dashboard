// app/src/components/chart/engine/ast/pine.timeframe.test.js
//
// ─── 🔴 ONE AUTHORITY ON WHICH TIMEFRAMES THIS ENGINE SERVES ─────────────────
//
// ⛔⛔ THERE WERE FOUR COPIES OF THIS VOCABULARY, and only one of them knew the
// answer. `interpret.js::TF_RESAMPLABLE` is the authority. `pine.js` held its own
// `PINE_TF_CODE = {W, 1W, M, 1M}` and refused any spelling it did not list; the
// `pine:request` sentence a member reads said "weekly and monthly" in prose; and
// the Python lane mirrors the ladder again.
//
// ⚠️ NOTHING WAS WRONG WITH ANY OF THEM ON THE DAY THEY WERE WRITTEN — the sets
// coincided. The whole cost is in the future tense, and this repo has already paid
// it once this week: the thinkScript door refused a self-lag the interpreter had
// held all along, because the door kept its own copy of the engine's ceiling. The
// day `TF_RESAMPLABLE` grows, a door with a private list keeps refusing a
// timeframe the engine can serve, and the refusal reads like a limit rather than
// like a stale copy (`lesson_a_second_authority_over_one_value`).
//
// ⭐ SO THE DOOR NOW ASKS TWO SEPARATE QUESTIONS — what does Pine CALL this
// timeframe (`PINE_TF_SPELLING`, Pine's own knowledge, which legitimately lives in
// Pine's file) and can this engine SERVE it (`TF_RESAMPLABLE`, asked). This file
// is what proves they are actually separate rather than merely described as such.

import { describe, it, expect } from 'vitest'

import { translatePine, REFUSALS } from './pine.js'
import fs from 'node:fs'
import path from 'node:path'
import { TF_RESAMPLABLE, TF_LADDER } from './interpret.js'
import { servableTimeframesText } from './pine.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'

/** A v5 request for the same symbol at `code`, which is the shape `securityAsNode`
 *  folds to a `tf` node. */
const htf = (code) => 'indicator("t")\n'
  + `v = request.security(syminfo.tickerid, "${code}", close)\n`
  + 'plot(v)\n'

/** ⛔ THE CLAUSE THAT LISTS THE SERVABLE TIMEFRAMES, and ONLY that clause. The
 *  sentence also names the BASE the engine resamples from — "from daily bars" —
 *  and a naive substring search over the whole message reads that `daily` as a
 *  promise. It is not one; it is the source. Scoping the check is what makes the
 *  two directions below mean what they say. */
function servableClause() {
  const m = /\(([^)]*?)\s+from\s+/i.exec(REFUSALS['pine:request'])
  if (!m) throw new Error('the `pine:request` sentence no longer has a "(… from …)" clause '
    + '— the rail below cannot read it, which is itself the drift this file exists to catch')
  return m[1].toLowerCase()
}

describe('the servable set comes from the engine, not from a copy in this door', () => {
  it('⛔ the authority is not empty — a vacuous list would pass everything below', () => {
    expect(TF_RESAMPLABLE.length).toBeGreaterThan(0)
    for (const c of TF_RESAMPLABLE) expect(TF_LADDER).toContain(c)
  })

  it('⭐⭐ EVERY timeframe the engine can serve, Pine can ask for', () => {
    // ⛔ THIS IS THE ASSERTION THAT GOES RED THE DAY THE ENGINE GROWS AND THE DOOR
    // DOES NOT. Add `'60'` to `TF_RESAMPLABLE` and this fails until Pine's spelling
    // map knows how to say it — which is a real gap, caught at the moment it opens
    // rather than a release later when a member reports a script that "should work".
    for (const code of TF_RESAMPLABLE) {
      const out = translatePine(htf(code))
      const why = out.refusal ? `${out.refusal.guard}: ${out.refusal.message}` : ''
      expect(out.ok, `the engine serves ${code} but this door refused it — ${why}`).toBe(true)
    }
  })

  it('⛔ a timeframe the engine CANNOT serve is still refused — the door did not go soft', () => {
    // ⭐ THE OTHER HALF, and without it the case above is satisfied by a door that
    // accepts every string. `D` is a real Pine spelling this map now RECOGNISES on
    // purpose; recognising it and serving it are the two questions, and the engine
    // answers the second one.
    const unservable = TF_LADDER.filter((c) => !TF_RESAMPLABLE.includes(c))
    expect(unservable.length, 'the ladder must hold something unservable').toBeGreaterThan(0)
    for (const code of unservable) {
      const out = translatePine(htf(code))
      expect(out.ok, `${code} is not servable and must not translate`).toBe(false)
      expect(out.refusal.guard).toBe('pine:request')
    }
  })
})

describe('the sentence a member reads cannot drift from the servable set', () => {
  it('⛔⛔ the `pine:request` refusal names every timeframe the engine serves', () => {
    // ⚰️ THE PROSE IS THE FOURTH COPY, and it is the one a member actually reads —
    // so it is the copy whose drift is least visible and most costly. It is written
    // as prose deliberately (interpolating it left `REFUSALS` undefined for every
    // importer, because this table is built at module load and the authority
    // arrives through an import cycle). Prose that cannot be derived is prose that
    // must be RAILED.
    const ENGLISH = { 1: 'one-minute', 5: 'five-minute', 15: 'fifteen-minute', 30: 'thirty-minute', 60: 'hourly', 240: 'four-hour', D: 'daily', W: 'weekly', M: 'monthly' }
    const text = servableClause()
    for (const code of TF_RESAMPLABLE) {
      const word = (ENGLISH[code] || String(code)).toLowerCase()
      expect(text, `the refusal never mentions ${code} (${word}), which this engine serves`)
        .toContain(word)
    }
  })

  it('⛔ …and does not promise one it cannot serve', () => {
    // The direction that matters more: a sentence naming a timeframe the engine
    // refuses sends a member to write a script that cannot run.
    const ENGLISH = { 1: 'one-minute', 5: 'five-minute', 15: 'fifteen-minute', 30: 'thirty-minute', 60: 'hourly', 240: 'four-hour', D: 'daily' }
    const text = servableClause()
    for (const code of TF_LADDER.filter((c) => !TF_RESAMPLABLE.includes(c))) {
      const word = ENGLISH[code]
      if (!word) continue
      expect(text, `the refusal promises ${word}, which this engine cannot serve`)
        .not.toContain(word)
    }
  })
})

describe('the servable list is spelled ONCE, and the spelling survives a third entry', () => {
  it('⛔⛔ a naive two-name join is INDISTINGUISHABLE at two entries — so test three', () => {
    // ⚰️ A SECOND COPY OF THIS HELPER SAT AT THE `request.security` DECLINE SITE
    // (`TF_RESAMPLABLE.map(…).join(' and ')`) and read correctly for one reason:
    // `TF_RESAMPLABLE` holds exactly TWO entries, and at two entries the naive join
    // and the real one produce the same string. It would have said \"daily and weekly
    // and monthly\" the day a third landed — which is precisely when somebody is
    // editing this area and least likely to re-read a sentence that always looked
    // fine. The call site now uses the helper; this pins the helper at the length
    // that can actually tell the two apart.
    expect(servableTimeframesText(['W', 'M', 'D'])).toBe('weekly, monthly and daily')
    expect(servableTimeframesText(['W', 'M', 'D'])).not.toContain('and weekly and')
  })

  it('⭐ …and it still answers for one, two and none', () => {
    expect(servableTimeframesText(['W'])).toBe('weekly')
    expect(servableTimeframesText(['W', 'M'])).toBe('weekly and monthly')
    expect(servableTimeframesText([])).toBe('no higher timeframe')
  })

  it('⛔⛔ and NO CALL SITE spells the list itself — the rail the values cannot give', () => {
    // ⚠️ THE CASES ABOVE PIN THE HELPER AND CANNOT PIN ITS CALLERS. Measured:
    // reintroducing the inline copy at the `request.security` decline site leaves
    // all of them GREEN, because at the two entries `TF_RESAMPLABLE` holds today
    // both joins produce the identical string. A behavioural rail is blind here by
    // construction, so this one reads the SOURCE instead.
    //
    // ⭐ It asks the one question the values cannot: does anything build this
    // sentence from `TF_RESAMPLABLE` directly instead of calling the helper? That
    // is what was wrong — not the string, which was right by accident.
    const src = fs.readFileSync(path.resolve(__dirname, 'pine.js'), 'utf8')
    const inline = src.match(/TF_RESAMPLABLE\.map\(/g) || []
    expect(inline, 'a call site maps over TF_RESAMPLABLE itself instead of calling '
      + 'servableTimeframesText — correct today at two entries, wrong at three'
    ).toEqual([])
    // ⛔ NON-VACUITY: the file really is being read, and it really does mention
    // the constant — otherwise an empty match proves nothing.
    expect(src).toContain('TF_RESAMPLABLE')
    expect(src).toContain('servableTimeframesText')
  })

  it('⛔ the SHIPPED list is what the default reads — not a copy typed here', () => {
    expect(servableTimeframesText()).toBe(servableTimeframesText(TF_RESAMPLABLE))
  })
})

// ─── 🔴 `time` HAS TWO OVERLOADS AND HAD ONE SENTENCE ────────────────────────

describe('time(timeframe) and time(timeframe, session) are different questions', () => {
  const refusalFor = (call) => {
    const out = translatePine(`//@version=5\nindicator("t")\nplot(${call})\n`)
    expect(out.ok, `${call} was expected to refuse`).toBe(false)
    return String(out.refusal.message)
  }

  it('⛔⛔ the ONE-ARGUMENT form is the period ANCHOR, not a session read', () => {
    // ⚰️ BOTH FORMS GOT THE SESSION SENTENCE: "`time(<session>)` answers whether a
    // bar falls inside a session window". Pine spells the overloads
    // `time(timeframe)` — the opening TIMESTAMP of the enclosing period — and
    // `time(timeframe, session)`. A member who wrote the anchor was told they had
    // written a session-window test.
    //
    // ⛔ IT IS NOT A NITPICK. `25-spy-expected-move-by-vix.pine` writes
    // `t = time(i_range_1)` and the next line is `start = na(t[1]) or t > t[1]` —
    // ordering the value with `>` to detect a new period, which is only
    // meaningful on a TIMESTAMP. You cannot detect a new day by ordering
    // session-membership answers. The refusal described a construct that is not
    // in the script, so the one thing it is for pointed at the wrong thing.
    const anchor = refusalFor('time("D")')
    expect(anchor).toMatch(/OPENING TIMESTAMP/)
    expect(anchor).not.toMatch(/falls inside a session window/)
    // …and it names what this engine DOES declare, so the member has somewhere to go.
    expect(anchor).toMatch(/sessionfirst/)
  })

  it('⭐ the TWO-ARGUMENT form keeps the session sentence, because there it is true', () => {
    // ⛔ THE CONTROL. Replacing the sentence for both forms would pass the case
    // above and lose a correct, well-reasoned refusal: a session genuinely only
    // means something on intraday bars, which is not what the anchor form is about.
    const session = refusalFor('time("D", "0930-1600")')
    expect(session).toMatch(/SESSION CLOCK/)
    expect(session).toMatch(/falls inside a session window/)
    expect(session).not.toMatch(/OPENING TIMESTAMP/)
  })

  it('⛔ the two sentences are genuinely DIFFERENT, not one string reworded', () => {
    // A "split" that emitted the same text twice passes both cases above.
    expect(refusalFor('time("D")')).not.toBe(refusalFor('time("D", "0930-1600")'))
  })

  it('⭐ and the real corpus script gets the anchor sentence', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(),
      '../tests/fixtures/pine_community/25-spy-expected-move-by-vix.pine'), 'utf8')
    // The shape that matters, asserted so the fixture cannot drift out from under
    // the claim without saying so.
    expect(src).toMatch(/t\s*=\s*time\(i_range_1\)/)
    expect(src).toMatch(/na\(t\[1\]\)\s*or\s*t\s*>\s*t\[1\]/)
    const out = translatePine(src)
    expect(out.ok).toBe(false)
    expect(String(out.refusal.message)).toMatch(/OPENING TIMESTAMP/)
  })
})

// ─── 🔴 A REFUSAL THAT DENIED A SHIPPED ACCUMULATOR ──────────────────────────

describe('`cum` refuses on the ANCHOR, and names the call that has one', () => {
  const cumRefusal = () => {
    const out = translatePine('//@version=5\nindicator("t")\nplot(ta.cum(volume))\n')
    expect(out.ok).toBe(false)
    return String(out.refusal.message)
  }

  it('⛔⛔ it no longer claims this engine has only a re-seeding accumulator', () => {
    // ⚰️ IT SAID "This engine's ONLY accumulator re-seeds a fixed number of bars
    // back" — and `cumFrom(source, anchor, window)` is declared in the manifest,
    // implemented in BOTH lanes, and carries eight conformance cases. The clause
    // denied a capability that ships, which is how a member stops looking.
    const msg = cumRefusal()
    expect(msg).not.toMatch(/only accumulator/i)
    expect(msg).toMatch(/cumFrom\(source, anchor, window\)/)
  })

  it('⭐ the RULING is unchanged — `cum` still does not translate', () => {
    // ⛔ THE HALF THAT MUST NOT MOVE. `cum` names no anchor; picking one would
    // invent the number the whole answer turns on, and the value would then change
    // with how many bars the chart requested. Naming `cumFrom` is an OFFER, never
    // a silent substitution.
    const out = translatePine('//@version=5\nindicator("t")\nplot(ta.cum(volume))\n')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function')
    expect(cumRefusal()).toMatch(/names no anchor/)
  })

  it('⭐⭐ and the offered call actually works — evaluated, not asserted', () => {
    // ⛔ AN OFFER NOBODY RAN IS A CLAIM. This is the anchored OBV both
    // `cum`-blocked corpus scripts are reaching for, pushed through the SAME
    // downstream door the member's formula box uses.
    const anchoredObv = 'cumFrom(close > open ? volume : -volume, 1762189200, 600)'
    const down = evaluateFormula(anchoredObv, BUILDER_INPUT_SCOPE)
    expect(down.ok, down.guard + ' ' + down.error).toBe(true)
    expect(canSaveFormula(down, false)).toBe(true)
    expect(down.readback).toMatch(/running total/)
  })

  it('⛔ a DATE-shaped anchor is still refused, and says why', () => {
    // The guard that caught the author of this very test: `20260101` is not a
    // unix instant, and read as seconds it anchors in 1970. Naming `cumFrom` in a
    // refusal is only useful if the member also learns what an anchor IS.
    const bad = evaluateFormula('cumFrom(volume, 20260101, 250)', BUILDER_INPUT_SCOPE)
    expect(bad.ok).toBe(false)
    expect(String(bad.error)).toMatch(/unix-second instant/)
    expect(String(bad.error)).toMatch(/1970/)
  })
})
