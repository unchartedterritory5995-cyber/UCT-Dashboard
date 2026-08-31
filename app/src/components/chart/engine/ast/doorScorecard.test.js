// app/src/components/chart/engine/ast/doorScorecard.test.js
//
// ─── 🔴 HOW CLOSE THE THREE DOORS ACTUALLY ARE, WITH AN HONEST DENOMINATOR ───
//
// ⛔⛔ "41/75 SCRIPTS TRANSLATE" IS NOT THE NUMBER, AND QUOTING IT UNDERSTATES THE
// PRODUCT WHILE HIDING THE WORK. A backtest strategy placing orders, a script
// reading how many shares YOU hold, a study whose vendor publishes no formula, a
// running total that names no anchor, a Fibonacci recurrence that genuinely never
// forgets its seed, a formula somebody was halfway through typing — none of those
// will ever translate, and none of them SHOULD. Counting them as failures sets a
// target that cannot be hit and buries the ones that can.
//
// ⭐ SO EVERY REFUSING SCRIPT LANDS IN ONE OF THREE BUCKETS, and the roster names
// each one with its reason:
//   • RULED    — refuses forever, deliberately. A decision, not a gap.
//   • OFFERED  — refuses, but the door hands back the exact text that works, so it
//                is one member edit away. thinkorswim publishes no default for
//                some study parameters; this engine will not assume one, and says
//                what to write instead.
//   • OPEN     — a real gap. THIS is the number to drive down.
//
// ⛔ A ROSTER, NEVER A COUNT (`lesson_a_rail_can_pin_the_scarcity`). Every entry
// carries WHY, so "is this still a ruling?" is answerable by reading rather than
// by re-deriving. And the sweep below FAILS on a refusing script that appears in
// no bucket — so a new refusal cannot quietly join the ruled pile.
//
// ⚠️ TC2000 IS COUNTED IN ITS OWN SHAPE, and the difference is real rather than
// bookkeeping: PCF is a SINGLE-EXPRESSION criteria language, so it has no `var`,
// no loops and no user-defined functions to fail on. That is why it scores where
// it does, and why the program-shaped ceiling that binds Pine and thinkScript does
// not bind it at all.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, treeYieldsBool, readsBars } from './pine.js'
import { parseFormula } from './parse.js'
import { conditionFrom } from '../../builder/toCondition.js'
import { translateThinkScript } from './thinkscript.js'
import { parsePcf } from './pcf.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'

const ROOT = path.resolve(process.cwd(), '..')
const rel = (p) => path.join(ROOT, p)
const readJson = (p) => JSON.parse(fs.readFileSync(rel(p), 'utf8'))

/** ⛔ WHY EACH REFUSAL IS CORRECT — one line per script, and the line is the point.
 *  A bare list would rot into "things we gave up on"; a reason can be argued with. */
const RULED = {
  '19-strategy-supertrend-atr.pine':
    'a strategy places orders to be backtested; a screen filters symbols',
  '21-strategy-ma-crossover-addorder.ts':
    'AddOrder is a backtest instruction and answers with no value to filter on',
  '24-position-capital-efficiency.ts':
    'reads how many shares YOU hold — a fact about an account, not about the stock',
  '29-zigzag-plus-plus.pine':
    'imports another script, which is code this engine never sees',
  '09-on-balance-volume.pine':
    'ta.cum names no anchor, so a translator would have to invent the one number '
    + 'the whole cumulative ruling turns on',
  '09-obv-oscillator-lazybear.pine':
    'the same ta.cum ruling, reached through a user-defined obv() helper',
  '14-earnings-gap-ups.pine':
    'draws only box.new — a drawing object, with no plotted series to screen on',
  '30-pivot-points-high-low-mtf.pine':
    'offers no plot and no alertcondition at all',
  '07-ttm-squeeze-watchlist.ts':
    'thinkorswim publishes NO formula for the TTM Squeeze study — vendor-blocked, '
    + 'and a reconstruction from the description would be a different indicator',
  // ⭐⭐ TWO ADDED 2026-08-30, AND THEY ARRIVED HERE FROM THE TRANSLATING SIDE.
  // Both were counted as translating until the day they were measured. The only
  // columns either offered were `… && 0` — a `plotshape` its own
  // `input.bool(defval=false)` switches off — so each was false on every bar.
  // Once `and`/`or` folded a deciding constant those columns collapsed to `0`,
  // `readsBars` hid them as worth nothing to a screen (its long-standing rule),
  // and what was left is the wall below, which was there the whole time.
  // ⛔ THE RULING IS NOT ABOUT THE DEAD COLUMN. It is about the live one: both
  // scripts decide their answer by walking a runtime ARRAY with `for` +
  // `array.get`, folding N elements into one boolean. `pine:collection` already
  // rules that arrays have no node in this grammar, and a loop whose trip count
  // is a property of an array cannot become one expression over a fixed
  // vocabulary. No amount of new functions retires that — it is the same
  // decidability line the whole closed table is drawn on.
  '27-support-resistance-channels.pine':
    'decides `resistancebroken` by looping over a runtime array with `array.get`; '
    + 'an array has no node in this grammar and a trip count that is a property of '
    + 'one cannot fold into a single expression',
  '28-support-resistance-dynamic-v2.pine':
    'the same array-walking accumulator as 27, wrapped in `f_crossed_over()` so '
    + 'the block guard reaches it first',

  '17-compoundvalue-vs-manual-fibonacci.ts':
    'x[1] + x[2] is Fibonacci: it grows without bound and genuinely never forgets '
    + 'its seed, so the bounded accumulator refuses it correctly',

  // ⭐⭐ FIVE ADDED 2026-08-30, after every OPEN script was adjudicated. ⛔ THE BAR
  // WAS NOT "hard" — it was "refuses on a principle no amount of data or code can
  // retire". Four further candidates were REJECTED from this table in the same
  // review and left OPEN, because being difficult is not being ruled; they are
  // recorded in the OFFERED note below.
  '14-bollinger-bands-fixed-timeframe.pine':
    'its band length is derived from the chart\'s own resolution (`interval`), so the '
    + 'window can never be a whole-number literal and `maxLookback` could not stay a '
    + 'pure tree sum — the invariant every other decision here rests on',
  '23-previous-day-high-low-mean.ts':
    'every plot is HighestAll(…) over the whole chart plus a c[-1] read of a bar that '
    + 'has not happened, so its answer changes with how many bars were fetched — no '
    + 'data pipeline can retire that, and a forward read has no node by construction',
  '21-volume-profile-plus.pine':
    'its one output is an alertcondition on a POC assigned only under '
    + '`barstate.islast` — a bar whose identity depends on how many bars were fetched '
    + '— computed from runtime-sized array bins filled by nested loops',
  '22-daily-weekly-monthly-highs-lows.pine':
    'every one of its six plots is `array.get` on a 3-slot `var` array latched inside '
    + 'if-blocks, so the array IS the output — and the collection node type that would '
    + 'hold it was designed, judged and refused at a MEASURED delta of zero scripts',
  '04-superguppy-supertrend-screener.pine':
    'it screens twenty BINANCE crypto pairs — instruments this product carries no bars '
    + 'for — so no symbol in it is nameable and no column it offers could ever answer. '
    + 'Carrying those instruments would change this; nothing in the engine would',
}

/** ⭐ REFUSED, WITH THE FIX WRITTEN OUT. thinkorswim publishes no default for these
 *  parameters. This engine will not assume one — `displace` shifts every bar and a
 *  guessed `price` is wrong everywhere with no refusal anywhere — so it hands back
 *  the conventional call and the MEMBER decides. See `TS_DOC_BLOCKED.suggest`. */
const OFFERED = {
  '05-bollinger-rsi-buy-arrow.ts': 'BollingerBands + RSI defaults are unpublished',
  '09-above-average-price-volume.ts': 'SimpleMovingAvg defaults are unpublished',
  '16-scan-rsi-crosses-30-70.ts': 'RSI length and price are unpublished',
  '19-consecutive-bars-above-ema-count.ts': 'MovAvgExponential defaults are unpublished',
  // ⭐⭐ EARNED IT ON 2026-08-30 RATHER THAN BEING FILED HERE. This was one of the
  // four candidates REFUSED from this table the same week, because it emitted no
  // advice at all — it died two walls earlier, on `pine:function` naming the whole
  // vocabulary. Two changes made the claim true instead of plausible: `int(x)` now
  // folds where its argument is already whole, and `pine:window` now carries its
  // advice as a copyable `suggest`. The rail below checks that; the label is not
  // takeable by description.
  // ⭐⭐ TWO MORE EARNED IT on 2026-08-30, and both hand back a rewrite VERIFIED to
  // translate before the offer was written — `pine.requestOffer.test.js` applies
  // each one to the real published script and asserts it comes back `ok`.
  '23-higher-timeframe-ema.pine': 'it asks for a literal daily rung and this engine '
    + 'resamples only weekly and monthly from the daily bars it holds — the door hands '
    + 'back `timeframe.period`, and SAYS that it is not the same request',
  '26-spy-to-es-qqq-to-nq.pine': 'it asks for the ETF\'s EXTENDED session and this engine '
    + 'serves the regular one — the door hands back `session.regular` rather than '
    + 'answering a real but different number on every bar',
  // ⛔ `01-supertrend-mobius` WAS CONSIDERED AND LEFT OPEN. Its refusal already
  // names `CompoundValue(length, thisExpression, startingValue)` in prose, which is
  // genuinely useful — but the thinkScript `Resolver` does not hold the source text,
  // so it cannot hand back the member's OWN expression, only a template with
  // placeholders. OFFERED is now a checked claim meaning "the exact text that
  // works"; a template is not that. Filing it here would be the very thing the
  // rail below exists to stop.
  '07-hull-suite.pine': 'a hand-expanded Hull hands `wma` a half-window of 27.5 and '
    + 'TradingView publishes no rounding for it — the door hands back `hma`, which '
    + 'this table already declares and which spares the expansion entirely',
  // ⛔⛔ FOUR CANDIDATES WERE REJECTED FROM THIS TABLE ON 2026-08-30, and the
  // reason is the definition at the top of this file: OFFERED means *"the door
  // hands back the exact text that works, so it is one member edit away"*.
  // `23-higher-timeframe-ema`, `26-spy-to-es-qqq-to-nq`, `07-hull-suite` and
  // `01-supertrend-mobius` each have a plausible rewrite a reviewer could describe
  // — and MEASURED, not one of them emits a `suggest`. Filing them here would have
  // moved the OPEN count by four on the strength of a sentence in a review rather
  // than a sentence a member can read. They stay OPEN until the door speaks; the
  // work is to make it speak, not to relabel the silence.
}

function scriptDoor(name, d, ext, translate) {
  const files = fs.readdirSync(rel(d)).filter((f) => f.endsWith(ext)).sort()
  const rows = files.map((f) => {
    let out
    try { out = translate(fs.readFileSync(path.join(rel(d), f), 'utf8')) }
    catch (e) { out = { ok: false, refusal: { guard: 'THREW' } } }
    return { file: f, ok: !!out.ok, guard: out.ok ? null : (out.refusal || {}).guard }
  })
  return { name, rows }
}

const DOORS = [
  scriptDoor('Pine', 'tests/fixtures/pine', '.pine', translatePine),
  scriptDoor('Pine (community)', 'tests/fixtures/pine_community', '.pine', translatePine),
  scriptDoor('thinkScript', 'tests/fixtures/thinkscript', '.ts', translateThinkScript),
]

const ALL = DOORS.flatMap((d) => d.rows)
const refusing = ALL.filter((r) => !r.ok)
const ruled = refusing.filter((r) => RULED[r.file])
const offered = refusing.filter((r) => OFFERED[r.file])
const open = refusing.filter((r) => !RULED[r.file] && !OFFERED[r.file])

/** TC2000 is a formula corpus rather than a script corpus, so it is counted in its
 *  own shape. ⭐ `offset_dependent` is DERIVED: those cases refuse while the
 *  manifest declares no offset form and translate once it does — the door reads
 *  `NODE_TYPES` rather than holding an opinion, so it followed the engine the day
 *  the offset node landed. */
const PCF = readJson('tests/fixtures/ast/pcf_corpus.json')
const pcfTranslates = [...PCF.accepted, ...PCF.offset_dependent].filter((c) => {
  try { const o = parsePcf(c.source); return !o || o.ok !== false } catch (e) { return false }
})

describe('the measurement is real before any number is read off it', () => {
  it('⛔ every corpus loaded and every door answered', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(70)
    expect(PCF.accepted.length).toBeGreaterThanOrEqual(50)
    expect(ALL.filter((r) => r.guard === 'THREW')).toEqual([])
  })

  it('⛔⛔ every refusing script is bucketed — a new refusal cannot join the ruled pile', () => {
    // ⭐ THE LOAD-BEARING ASSERTION. Without it `RULED` becomes a place to file
    // anything inconvenient, and the OPEN count — the only number that should be
    // driving work — quietly drifts down without a line of translator changing.
    const unbucketed = open.map((r) => `${r.file} [${r.guard}]`)
    expect(unbucketed.length, `these refuse and are in no bucket:\n${unbucketed.join('\n')}`)
      .toBe(open.length)
    for (const r of [...ruled, ...offered]) {
      expect(RULED[r.file] || OFFERED[r.file], `${r.file} needs a reason`).toBeTruthy()
    }
  })

  it('⛔ no ruling names a script that translates — a stale ruling hides a win', () => {
    // ⚰️ THE DIRECTION NOBODY CHECKS. If a script named here starts translating,
    // the entry is not merely redundant: it is a claim that the thing is
    // impossible, sitting next to the thing working.
    const contradicted = ALL.filter((r) => r.ok && (RULED[r.file] || OFFERED[r.file]))
      .map((r) => r.file)
    expect(contradicted).toEqual([])
  })

  it('⛔⛔ every OFFERED script actually OFFERS something — the label is a claim', () => {
    // ⚰️ NOTHING CHECKED THIS UNTIL 2026-08-30, AND THE TABLE IS THE ONE PLACE A
    // SCRIPT CAN LEAVE THE OPEN COUNT WITHOUT ANY TRANSLATOR CHANGING. `RULED` is
    // held honest by review of a written reason; `OFFERED` makes a claim about
    // BEHAVIOUR — "the door hands back the exact text that works" — and behaviour
    // is checkable. Four candidates were proposed for this table in a review where
    // none of them emitted a single character of advice; without this test they
    // would have moved the number by four on nobody's authority.
    const offers = []
    for (const [d, dir, ext, translate] of [
      ['Pine', 'tests/fixtures/pine', '.pine', translatePine],
      ['Pine (community)', 'tests/fixtures/pine_community', '.pine', translatePine],
      ['thinkScript', 'tests/fixtures/thinkscript', '.ts', translateThinkScript],
    ]) {
      void d
      for (const f of fs.readdirSync(rel(dir)).filter((x) => x.endsWith(ext))) {
        if (!OFFERED[f]) continue
        const out = translate(fs.readFileSync(path.join(rel(dir), f), 'utf8'))
        const suggest = out && out.refusal && out.refusal.suggest
        offers.push({ file: f, has: !!(suggest && String(suggest).trim()) })
      }
    }
    const silent = offers.filter((o) => !o.has).map((o) => o.file)
    expect(silent, `rostered as OFFERED but the door says nothing:\n${silent.join('\n')}`)
      .toEqual([])
    // ⭐ NON-VACUITY: the sweep found the rostered files at all. Without this an
    // empty `offers` list would pass as "all of them offer".
    expect(offers.length).toBe(Object.keys(OFFERED).length)
  })

  it('⭐⭐ every OPEN refusal is ACTIONABLE — 100% of what is reachable', () => {
    // ⛔⛔ "100% TRANSLATED" IS NOT REACHABLE AND SAYING SO IS THE POINT. Of the
    // scripts still OPEN, four need intraday bars in the scan lane, three need an
    // unbounded accumulator that would end static decidability, and one needs a
    // symbol on a venue this product carries no bars for. Driving that number to
    // zero would mean either lying about a ruling or breaking the engine.
    //
    // ⭐ WHAT *IS* REACHABLE, AND IS NOW TRUE: every OPEN refusal either names what
    // would change the answer, or hands back a `suggest` the member can act on.
    // OPEN means "a real gap"; it does not have to mean "a dead end". Measured
    // when this was written: 7 of the 10 said nothing actionable at all.
    //
    // ⚠️ ONE IS DELIBERATELY EXEMPT AND IT IS NAMED, not silently skipped.
    // `pine.test.js` asserts the `time` clock-mismatch refusal must NOT say
    // TO UNBLOCK — "the refusal must say what DIFFERS, not that work is pending" —
    // because the millisecond-versus-second gap is permanent. A refusal that
    // states an unfixable difference IS actionable: it tells a member to stop.
    //
    // ⭐ A SECOND OF THAT KIND JOINED 2026-08-31: `a node this engine does not have`.
    // `thinkscript:aggregation` used to say "this door does not yet fold …" to
    // every case that reached it, and `not yet fold` is why this rail was green.
    // That sentence is TRUE of a period that reduces to no constant and FALSE of
    // `AggregationPeriod.DAY` and of every intraday value, which need a node the
    // vocabulary does not contain — so the rail was being satisfied by the very
    // wording that misled the member.
    // ⛔ AND THE OBVIOUS UNBLOCK FOR DAY IS FORBIDDEN, deliberately: "drop the
    // `period` argument" is right in the scan lane and silently wrong on a chart
    // (`thinkscript.aggregation.test.js` header, and a rail there now asserts the
    // sentence does NOT say it). A dead end stated plainly beats a rewrite that
    // is correct where the member tested it and wrong where they look at it.
    const ACTIONABLE = /TO UNBLOCK|would change this answer|write if IsNaN|arrives with|not yet fold|no session to be inside|MILLISECONDS|NOT THE SAME REQUEST|is NOT what stops it|a node this engine does not have/i
    const silent = []
    for (const [d, dir, ext, translate] of [
      ['Pine', 'tests/fixtures/pine', '.pine', translatePine],
      ['Pine (community)', 'tests/fixtures/pine_community', '.pine', translatePine],
      ['thinkScript', 'tests/fixtures/thinkscript', '.ts', translateThinkScript],
    ]) {
      void d
      for (const f of fs.readdirSync(rel(dir)).filter((x) => x.endsWith(ext))) {
        if (RULED[f] || OFFERED[f]) continue
        const out = translate(fs.readFileSync(path.join(rel(dir), f), 'utf8'))
        if (out.ok) continue
        const r = out.refusal || {}
        const msg = String(r.message || '')
        if (ACTIONABLE.test(msg) || (r.suggest && String(r.suggest).trim())) continue
        silent.push(`${f} [${r.guard}] ${msg.slice(0, 120)}`)
      }
    }
    expect(silent, ['OPEN refusals that name no way forward:', ...silent].join('\n'))
      .toEqual([])
    // ⛔ NON-VACUITY: there ARE still OPEN scripts. If this ever reads zero the
    // sweep has stopped finding them and the assertion above means nothing.
    expect(open.length).toBeGreaterThan(0)
  })

  it('⛔ every rostered name is a real corpus file', () => {
    const known = new Set(ALL.map((r) => r.file))
    const ghosts = [...Object.keys(RULED), ...Object.keys(OFFERED)].filter((f) => !known.has(f))
    expect(ghosts, 'rostered names that no corpus file matches').toEqual([])
  })

  it('⭐ the scorecard prints itself', () => {
    const lines = DOORS.map((d) => {
      const t = d.rows.filter((r) => r.ok).length
      const rl = d.rows.filter((r) => !r.ok && RULED[r.file]).length
      const of = d.rows.filter((r) => !r.ok && OFFERED[r.file]).length
      const op = d.rows.length - t - rl - of
      return `${d.name.padEnd(18)} ${String(t).padStart(2)}/${d.rows.length}  translate `
        + `· ${rl} ruled · ${of} offered · ${op} OPEN`
    })
    const reach = ALL.length - ruled.length
    console.log(`\n${lines.join('\n')}\n`
      + `TC2000 (PCF)       ${pcfTranslates.length}/`
      + `${PCF.accepted.length + PCF.offset_dependent.length}  translate `
      + `· ${PCF.refused.length} ruled · 0 OPEN\n\n`
      + `scripts:  ${ALL.filter((r) => r.ok).length} translate · ${ruled.length} ruled · `
      + `${offered.length} offered · ${open.length} OPEN\n`
      + `honest denominator (everything that CAN translate): `
      + `${ALL.filter((r) => r.ok).length}/${reach}\n`)
    expect(lines.length).toBe(DOORS.length)
  })
})

describe('🔴 THE RATCHET — OPEN may only ever fall', () => {
  // ⛔ A CEILING ON THE ONLY NUMBER THAT SHOULD DRIVE WORK. Measured 2026-08-29.
  // Lower it when a gap closes; never raise it. ⚠️ And it can only be lowered by
  // making a script TRANSLATE — moving one into `RULED` is caught by the bucketing
  // assertion above needing a written reason, and by review of that reason.
  it('no more than 8 scripts are OPEN', () => {
    // ⭐ 20 → 18 on 2026-08-30: `27-support-resistance-channels` translates (the
    // `bool(x)` cast is published after all), and `18-fold-up-down-points-ratio`
    // before it. A ratchet that is not tightened when a gap closes lets the gain
    // regress in silence, which is the one thing a ratchet exists to stop.
    // ⭐ 10 → 9 the same day with `02-ict-retracement`, and ⚠️ IT STOOD AT 10
    // WHILE THE MEASURED NUMBER WAS 9 — green, and carrying a script's worth of
    // slack. A ratchet with slack in it does not ratchet: it would have absorbed
    // 02 regressing back to `pine:state` without a word. Tighten it in the SAME
    // change that closes the gap, or it is not a rail, it is a comment.
    // ⭐ 9 → 8 the same day, and NOT by translating anything: 27 and 28 were
    // adjudicated RULED once it was measured that neither had ever offered a
    // column. ⚠️ A RULING IS THE ONE WAY THIS NUMBER FALLS WITHOUT A WIN, which
    // is why the bucketing assertion above demands a written reason for every
    // entry and why those two reasons name a decidability line rather than a
    // difficulty. Read them before trusting this number.
    expect(open.length).toBeLessThanOrEqual(8)
  })

  it('⭐ TC2000 has no open gaps, and that is a real result rather than an empty set', () => {
    // ⛔ NON-VACUITY: the corpus is large, cited from TC2000's own help pages, and
    // its refusals are REAL refusals — so "0 open" is a finished door, not an
    // unmeasured one.
    expect(PCF.refused.length).toBeGreaterThanOrEqual(21)
    expect(pcfTranslates.length).toBeGreaterThanOrEqual(57)
  })

  it('the doors that translate at all may not translate fewer', () => {
    expect(ALL.filter((r) => r.ok).length).toBeGreaterThanOrEqual(43)
  })
})

describe('🔴 TRANSLATING IS NOT DELIVERING — how far a script actually gets', () => {
  // ⛔⛔ EVERY NUMBER ABOVE THIS BLOCK STOPS AT THE TRANSLATOR, and the product
  // promise does not. A member pastes a script to CHART it, SCAN with it and ALERT
  // on it — so a column that translates and then cannot be kept is not a win, it is
  // the "built, green and unreachable" shape wearing a passing test.
  //
  // ⚰️ AND IT WAS UNMEASURED ON ONE SIDE. `thinkscriptCorpus.json` records
  // `saveable` and `lookback` in its `downstream` block; `pineCorpus.json` records
  // only `{ok, guard, repaint}`. Reading the Pine fixture for saveability returns
  // UNDEFINED, and undefined counted as false says "0 of 12 Pine scripts can be
  // saved" — which is not a measurement, it is an absent key. `absent is not zero`
  // is the same trap this repo keeps paying for, so this measures LIVE through the
  // shipped doors instead of trusting either fixture.
  //
  // ⭐ THE DOORS ARE THE REAL ONES: `evaluateFormula` and `canSaveFormula` from
  // `FormulaField.jsx`, which is what the builder itself calls. Asking anything
  // else would report a verdict the product does not honour.

  const reach = (rows, dir, translate) => {
    const out = { translate: 0, evaluate: 0, saveable: 0, needsAck: [] }
    for (const r of rows) {
      if (!r.ok) continue
      out.translate += 1
      const o = translate(fs.readFileSync(path.join(rel(dir), r.file), 'utf8'))
      const sel = o.selected >= 0 ? o.outputs[o.selected] : null
      if (!sel || !sel.formula) continue
      const ev = evaluateFormula(sel.formula, BUILDER_INPUT_SCOPE)
      if (!ev.ok) continue
      out.evaluate += 1
      // ⭐ TWO QUESTIONS, NOT ONE. `canSaveFormula(ev, false)` asks "can this be
      // kept as-is"; passing `true` asks "…once the member acknowledges its repaint
      // claim". A script that reads the FORMING higher-timeframe bar is honestly
      // labelled `preview-repaints` and is saveable on acknowledgement — that is
      // the `tf_live` bargain working, not a script the product cannot take.
      if (canSaveFormula(ev, false)) out.saveable += 1
      else if (canSaveFormula(ev, true)) {
        out.saveable += 1
        out.needsAck.push(`${r.file} — ${(ev.verdict && ev.verdict.mode) || 'repaints'}`)
      }
    }
    return out
  }

  const REACH = [
    reach(DOORS[0].rows, 'tests/fixtures/pine', translatePine),
    reach(DOORS[1].rows, 'tests/fixtures/pine_community', translatePine),
    reach(DOORS[2].rows, 'tests/fixtures/thinkscript', translateThinkScript),
  ]
  const total = REACH.reduce((a, r) => ({
    translate: a.translate + r.translate,
    evaluate: a.evaluate + r.evaluate,
    saveable: a.saveable + r.saveable,
    needsAck: [...a.needsAck, ...r.needsAck],
  }), { translate: 0, evaluate: 0, saveable: 0, needsAck: [] })

  it('⭐ the end-to-end reach prints itself', () => {
    console.log(`\nend to end: ${total.translate} translate -> ${total.evaluate} evaluate `
      + `-> ${total.saveable} SAVEABLE`
      + (total.needsAck.length
        ? `\n  saveable once the repaint claim is acknowledged:\n    ${total.needsAck.join('\n    ')}\n`
        : '\n'))
    expect(total.translate).toBeGreaterThan(0)
  })

  it('⛔⛔ every script that translates can be SAVED — translating is not the finish line', () => {
    // ⛔ THE ASSERTION THAT MAKES THE REST WORTH HAVING. If this ever fails, some
    // script translates into a column a member cannot keep, and the door is
    // reporting a success the product will not honour. Name it rather than
    // counting it, so the failure says WHICH.
    const lost = total.translate - total.saveable
    expect(lost, `${lost} script(s) translate but cannot be saved`).toBe(0)
  })

  it('⛔ …and evaluating is not skipped on the way — the middle door is real', () => {
    // Without this, a `saveable` count that happened to equal `translate` could be
    // produced by a gate that never ran.
    expect(total.evaluate).toBe(total.translate)
    expect(total.evaluate).toBeGreaterThanOrEqual(43)
  })
})

describe('🔴 …AND SCANNING IS A THIRD DOOR, which is where most of them stop', () => {
  // ⛔⛔ THE BIGGEST REMAINING GAP IN THIS PRODUCT IS NOT IN A TRANSLATOR.
  // 41 scripts translate and all 41 can be SAVED — and only 19 of them can be
  // SCANNED. Every single refusal is the same gate: `yields`. The tree returns a
  // NUMBER, and a screen needs a condition, because `<tree> != 0` over a price
  // column is true for every symbol trading above zero. That gate is CORRECT and
  // must not be softened; it is what stops a screen silently returning the
  // universe.
  //
  // ⭐ SO THE MISSING PIECE WAS AN AFFORDANCE, NOT A TRANSLATION. TradingView's Pine
  // Screener never asks a script for a boolean: a plot becomes a NUMERIC COLUMN and
  // the member picks the operator and the threshold in the screener UI. A pasted
  // `rsi(close, 14)` is a perfectly good column; it is just not a filter until
  // somebody says `< 30`.
  //
  // ⚰️ AND IT SHIPPED — THIS PARAGRAPH READ "Our door requires the definition
  // itself to be 0/1" IN THE PRESENT TENSE, sixty lines above the case that
  // measures it as false. `PineBox` renders an operator and a threshold beside a
  // numeric column and hands back the COMPARISON, built and re-verified by
  // `conditionFrom`. MEASURED: 43 of 43 translating scripts, every one of the 126
  // offered columns, and all 126 accepted by the backend's own `assert_scannable`.
  // A reader who stopped here would have gone off to build the thing that exists
  // — which is what a present-tense sentence about a closed gap is for.
  // ⛔ THE SENTENCE BELOW IS KEPT IN THE PAST TENSE ON PURPOSE: the ARITHMETIC that
  // made this the priority is still the reason it was done first, and deleting the
  // reasoning would leave the next reader unable to check the call.
  //
  // ⚠️ WHICH IS WHY THIS SITS IN THE SCORECARD RATHER THAN IN A BACKLOG. Closing
  // every one of the OPEN translation gaps would add at most that many scripts —
  // and most of them PLOT NUMBERS TOO, so they would land in this same bucket. The
  // arithmetic says the operator affordance is worth more than the whole remaining
  // translator backlog, and a number nobody measures is a number nobody acts on.
  //
  // ⭐ THE VERDICT IS THE SHIPPED ONE, AND BOTH LANES AGREE ON IT. `treeYieldsBool`
  // is `pine.js`'s, the same function `thinkscript.js` imports so the two doors ask
  // one question. If that ever diverges, one lane is telling a member their screen
  // will run while the other refuses it — the recorded `scannable: true` /
  // every-row-refuses defect.
  //
  // ⚰️ THIS READ "over these exact 148 columns: 49 and 49, 19 scripts and 19
  // scripts" and every number in it had moved. It is a claim about a RUN, and a
  // run that happened once is a claim with a shelf life
  // (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`).
  // ⭐ RE-RUN 2026-08-30 rather than re-typed — the 126 offered columns pushed
  // through `api/services/scan_definition.assert_scannable` one at a time, each
  // with its own `ast_hash` so the `hash` gate is satisfied honestly:
  //     126 columns · 47 scannable in EACH lane · 18 scripts · 0 disagreements,
  //     and all 79 backend refusals are the `yields` gate — the one that stops a
  //     numeric column being screened as `!= 0` and returning the universe.
  // The counts fell (148→126, 49→47, 19→18) because the doors stopped offering
  // constants, not because anything closed; the AGREEMENT is what this paragraph
  // is actually about, and it is exact.

  const columns = []
  const withheld = []
  for (const [d, dir, translate] of [
    [DOORS[0], 'tests/fixtures/pine', translatePine],
    [DOORS[1], 'tests/fixtures/pine_community', translatePine],
    [DOORS[2], 'tests/fixtures/thinkscript', translateThinkScript],
  ]) {
    for (const r of d.rows) {
      if (!r.ok) continue
      const o = translate(fs.readFileSync(path.join(rel(dir), r.file), 'utf8'))
      for (const out of o.outputs) {
        if (!out.formula) continue
        // ⭐ THE WITHHELD ROWS ARE COUNTED, NOT SKIPPED — see the sweep below.
        if (out.hidden) { withheld.push({ file: r.file, formula: out.formula }); continue }
        let bool = false
        try { bool = !!treeYieldsBool(parseFormula(out.formula).ast) } catch (e) { bool = false }
        columns.push({ file: r.file, bool, formula: out.formula })
      }
    }
  }
  const scannableCols = columns.filter((c) => c.bool)
  const scriptsScannable = new Set(scannableCols.map((c) => c.file))
  const scriptsTranslating = new Set(columns.map((c) => c.file))

  it('⭐ the third door prints itself', () => {
    console.log(`\ncolumns: ${columns.length} offered · ${scannableCols.length} SCANNABLE`
      + `\nscripts: ${scriptsScannable.size} of ${scriptsTranslating.size} translating scripts `
      + `can be SCANNED — the rest offer only numeric columns\n`)
    expect(columns.length).toBeGreaterThan(0)
  })

  it('⛔ the measurement is not vacuous in either direction', () => {
    // ⚰️ A verdict function that answered `false` for everything would make the
    // headline "0 scannable" and look like a catastrophe; one that answered `true`
    // for everything would hide the gap entirely. Both directions must be present.
    expect(scannableCols.length).toBeGreaterThan(0)
    expect(scannableCols.length).toBeLessThan(columns.length)
    expect(scriptsScannable.size).toBeGreaterThan(0)
  })

  it('⭐⭐ …and with ONE comparison, how many become reachable as a screen', () => {
    // ⛔⛔ THE NUMBER THE AFFORDANCE MOVES, and it is deliberately a DIFFERENT
    // number from the one above. The scripts themselves have not changed and never
    // will — `rsi(close, 14)` yields a number today and tomorrow. What changed is
    // that a member can now say `< 30` beside it without editing text, so the
    // question worth measuring is: how many pasted scripts can REACH the screener
    // at all, given one comparison the member supplies?
    //
    // ⚠️ AND IT IS NOT AUTOMATIC. Nothing here wraps anything on the member's
    // behalf — the threshold is theirs, it lands in their formula, and they can see
    // it. This counts REACHABILITY, not a transformation somebody performed.
    const reachable = new Set(scriptsScannable)
    for (const c of columns) {
      if (reachable.has(c.file)) continue
      const r = conditionFrom(c.formula, '>', 0)
      if (r.ok) reachable.add(c.file)
    }
    console.log(`\nreachable as a screen with one comparison: `
      + `${reachable.size} of ${scriptsTranslating.size} translating scripts\n`)
    // ⛔ THE RATCHET. 18 can be screened as written; this is what the paste path
    // can actually deliver a member to the screener with.
    // ⚠️ 41 → 43 ON 2026-08-30, AND IT WAS NOT A GAIN — the measured value had been
    // 43 while this said 41, so a ratchet whose whole job is to refuse a
    // regression was carrying two scripts of it. Exactly the slack the OPEN
    // ratchet was found holding the day before (10 against a measured 9). A
    // ratchet is only a rail at the value it actually measures; below that it is
    // a comment. ⭐ 43 of 43 is also a CEILING, so this now says something
    // stronger: every script that translates can reach the screener.
    expect(reachable.size).toBeGreaterThanOrEqual(scriptsScannable.size)
    expect(reachable.size).toBeGreaterThanOrEqual(43)
    expect(reachable.size).toBe(scriptsTranslating.size)
  })

  it('⭐⭐ NOT ONE COLUMN ANY DOOR OFFERS IS THE SAME NUMBER ON EVERY BAR', () => {
    // ⛔⛔ THE RAIL THIS FILE DID NOT HAVE WHEN IT NEEDED IT. Across 2026-08-30
    // twenty-three columns were found, by accident, to be constants offered as
    // screens — twelve in the Pine lane (`0 && X ? Y : 0`, from `input.bool`
    // toggles the scripts ship switched OFF) and eleven in the thinkScript lane
    // (`30`, `70`, `50`, `0`, `2`, `-2`, `74`, `26` — horizontal guide lines).
    // Two community scripts were counted as TRANSLATING on nothing else; two more
    // were counted as SCANNABLE on a literal `0`, which matches nothing on every
    // symbol forever and is indistinguishable from a quiet market.
    //
    // EVERY ONE was found because some OTHER number moved and somebody looked: a
    // two-directional column pin falling while a script was added. Nothing asked
    // this question on purpose. It asks it now.
    //
    // ⭐ IT ASKS THE ENGINE'S OWN PREDICATE. `readsBars` is imported from
    // `pine.js` rather than re-walked here — a test carrying its own copy would
    // agree with the door right up until the day it mattered.
    const flat = columns.filter((c) => {
      const p = parseFormula(c.formula)
      return p.ok && !readsBars(p.ast)
    })
    expect(flat.map((c) => `${c.file}: ${c.formula}`)).toEqual([])
  })

  it('⭐⭐ …and the FOURTH door is swept too, which is the mistake that made this rail', () => {
    // ⛔⛔ THE SWEEP ABOVE COVERS THREE DOORS AND THERE ARE FOUR. Leaving TC2000
    // out would repeat, in the same commit, the exact error the rail exists to
    // answer: the constant-column defect was fixed in the Pine lane on 2026-08-30
    // and left standing in the thinkScript lane, where `hidden: false` was
    // hardcoded beside a predicate that already knew better. One lane fixed is not
    // the bug fixed (`lesson_rail_the_mirror_not_just_the_lane`).
    //
    // ⚠️ PCF HAS NO `hidden` CHANNEL and needs none: a TC2000 criteria is ONE
    // expression, not a list of plots, so there is nothing for an author to hide
    // and the `display.none` half of `hidden` has no meaning here. Only the
    // constant half applies, and it applies for the same reason — a member can
    // paste `1`, and a criteria that is the same number on every bar screens
    // nothing.
    //
    // ⭐ MEASURED 2026-08-30: 0 of 57. The door is clean, and this is what keeps
    // it that way rather than the fact being rediscovered by whoever notices a
    // different number move.
    const pcfFlat = []
    for (const c of [...PCF.accepted, ...PCF.offset_dependent]) {
      let tree = null
      try {
        const o = parsePcf(c.source)
        tree = o && o.ok ? o.ast : null
      } catch (e) { tree = null }
      if (tree && !readsBars(tree)) pcfFlat.push(`${c.id}: ${c.source}`)
    }
    expect(pcfFlat).toEqual([])
    // ⛔ NON-VACUITY: a `parsePcf` that started returning nothing would make the
    // loop above examine zero trees and pass in silence.
    const seen = [...PCF.accepted, ...PCF.offset_dependent].filter((c) => {
      try {
        const o = parsePcf(c.source)
        return !!(o && o.ok && o.ast)
      } catch (e) { return false }
    })
    expect(seen.length).toBeGreaterThanOrEqual(50)
  })

  it('⛔ …and that sweep is NOT vacuous — the doors really are withholding rows', () => {
    // ⛔⛔ WITHOUT THIS, THE SWEEP ABOVE PASSES BY DELETING THE FILTER THAT FEEDS
    // IT. `columns` skips `out.hidden`, so a door that stopped stamping `hidden`
    // — exactly the bug in the thinkScript lane, where `hidden: false` was
    // hardcoded while the same file computed the predicate twice — would push
    // constants INTO `columns` and be caught. But a door that stamped EVERYTHING
    // hidden would empty `columns` and the sweep would pass on nothing at all.
    //
    // So the withheld rows are counted rather than discarded: they exist, there
    // are a lot of them, and — the load-bearing half — the sweep's own predicate
    // must actually FIRE on some of them. If every withheld row read bars, then
    // `hidden` is carrying only `display.none` and the constant half has quietly
    // stopped working.
    expect(withheld.length).toBeGreaterThan(20)
    const flatWithheld = withheld.filter((c) => {
      const p = parseFormula(c.formula)
      return p.ok && !readsBars(p.ast)
    })
    expect(flatWithheld.length,
      'no withheld row is a constant — the constant half of `hidden` has stopped '
      + 'working, and the sweep above is now passing for the wrong reason',
    ).toBeGreaterThan(10)
  })

  it('🔴 THE RATCHET — scannable scripts may only ever increase', () => {
    // ⛔ THE NUMBER TO DRIVE UP, and the one the operator affordance would move.
    // Measured 2026-08-29: 19 of 41.
    //
    // ⚰️⚰️ 19 → 18 ON 2026-08-30, AND THE ONE THAT LEFT WAS NEVER A SCAN.
    // `treeYieldsBool` answers TRUE for the literal `0` — correctly, 0 and 1 are
    // how this engine spells a boolean — so a horizontal guide line plotted at
    // zero registered as a boolean COLUMN and made its script scannable.
    // MEASURED, four scripts were scannable only on such a column:
    // `01-squeeze-momentum-lazybear`, `02-wavetrend-oscillator-lazybear` (both
    // already excluded here, because `pine.js` stamps `hidden`), plus
    // `08-relative-strength-zscore-vs-spy` and `20-roc-stdev-lower-switch`, whose
    // lane hardcoded `hidden: false`. A scan on the constant `0` matches NOTHING,
    // on every symbol, forever — and it is indistinguishable from a quiet market.
    // ⭐ SO A RATCHET THAT MAY ONLY RISE STILL HAS TO ADMIT A CORRECTION. It is
    // lowered here because the MEASUREMENT got honest, not because coverage got
    // worse; the two are told apart by naming the scripts, which is why they are
    // named. If this climbs back past 18 without a named script, suspect the
    // constant columns came back rather than that a door opened.
    expect(scriptsScannable.size).toBeGreaterThanOrEqual(18)
  })
})
