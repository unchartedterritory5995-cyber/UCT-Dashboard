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
import { TF_RESAMPLABLE, TF_LADDER } from './interpret.js'

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
