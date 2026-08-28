import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'

/**
 * WHICH community scripts this door takes, BY NAME.
 *
 * ⛔⛔ WHY THIS FILE EXISTS. The 30-script community corpus had no translate gate
 * at all — `dialect.test.js` only asserts each file IS Pine. So every gain the
 * translator made against it was invisible, and every regression would have been
 * too: the number moved 10 → 11 when `sym` landed and nothing in the suite would
 * have noticed either direction.
 *
 * ⭐ A ROSTER, NOT A COUNT. `lesson_a_rail_can_pin_the_scarcity_that_creates_false_claims`
 * — a count says "11" and is satisfied by any eleven, so a script that started
 * translating could silently pay for one that stopped. The names say WHICH.
 *
 * ⚠️ AND THE REFUSALS ARE PINNED TOO, by guard. A script moving from one refusal
 * to another is a real change in what this door says to a member, and it is
 * exactly the change that would otherwise hide inside an unchanged total.
 */
describe('the community corpus, by name', () => {
  const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_community')
  // ⛔ NO `existsSync` GUARD. A corpus gate that passes with no corpus is
  // `lesson_gate_that_cannot_fail`.
  const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()

  /** Every script this translator takes today. ⭐ `13-relative-strength-vs-benchmark-spy`
   *  ⭐ `04-ut-bot-alerts` and `21-ma-cross-alert-mtf-chartart` are what `iff`
   *  and `linreg` bought — both written in vocabulary this table already held,
   *  so neither cost the grammar a new name.
   *  `13-relative-strength-vs-benchmark-spy` is the one `sym` bought: `request.security(benchmark, timeframe.period, close)`
   *  where `benchmark = input.symbol("SPY")` — relative strength against SPY, which
   *  is the primitive the node was built for. */
  const TRANSLATES = [
    '01-squeeze-momentum-lazybear.pine',
    '02-wavetrend-oscillator-lazybear.pine',
    '03-cm-williams-vix-fix.pine',
    '04-ut-bot-alerts.pine',
    '05-chandelier-exit.pine',
    '06-qqe-mod.pine',
    '11-52-week-high-low.pine',
    '12-vcp-tightness-score.pine',
    '13-relative-strength-vs-benchmark-spy.pine',
    '15-inside-bar.pine',
    '16-nr4-nr7.pine',
    '17-pocket-pivot-breakout.pine',
    '18-minervini-trend-template.pine',
    // ⭐⭐ TWO REFUSALS DEEP, and neither was the one the blocker table named.
    // It cleared `pine:request` when a ternary timeframe learned to fold its own
    // condition, then stopped at `pine:statement` on
    // `fastLength = input(12), slowLength = input(26)` — several bindings on one
    // line, a v2/v3 idiom. The second refusal was INVISIBLE until the first
    // cleared, which is the whole argument for reading refusals at the line
    // rather than estimating them from what a script contains.
    '19-cm-macd-ult-mtf.pine',
    '21-ma-cross-alert-mtf-chartart.pine',
    '24-multi-timeframe-rsi.pine',
    '28-support-resistance-dynamic-v2.pine',
  ]

  const outcome = (f) => {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8')
    try {
      const out = translatePine(src)
      return out.ok ? 'TRANSLATES' : (out.refusal ? out.refusal.guard : 'unknown')
    } catch (e) {
      return `THREW:${e.message.slice(0, 60)}`
    }
  }

  it('the corpus is really there', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(30)
  })

  it('⭐ exactly these scripts translate — named, so a swap cannot hide in a total', () => {
    const got = FILES.filter((f) => outcome(f) === 'TRANSLATES')
    expect(got.sort()).toEqual([...TRANSLATES].sort())
  })

  it('⛔ and every other script refuses BY A DECLARED GUARD, never by throwing', () => {
    // A refusal is this door working. An exception is not — it would reach a
    // member as a 500 rather than as a sentence naming what it cannot take.
    const thrown = FILES.map((f) => [f, outcome(f)]).filter(([, o]) => o.startsWith('THREW:'))
    expect(thrown).toEqual([])
    const unknown = FILES.map((f) => [f, outcome(f)]).filter(([, o]) => o === 'unknown')
    expect(unknown).toEqual([])
  })

  it('⭐ the roster is not vacuous — it is neither everything nor nothing', () => {
    // The control. `toEqual` on a hand-written list passes just as happily if
    // the list were empty and nothing translated.
    expect(TRANSLATES.length).toBeGreaterThan(0)
    expect(TRANSLATES.length).toBeLessThan(FILES.length)
  })
})
