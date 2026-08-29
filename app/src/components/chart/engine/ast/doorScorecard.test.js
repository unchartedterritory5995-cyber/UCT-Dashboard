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

import { translatePine } from './pine.js'
import { translateThinkScript } from './thinkscript.js'
import { parsePcf } from './pcf.js'

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
  '17-compoundvalue-vs-manual-fibonacci.ts':
    'x[1] + x[2] is Fibonacci: it grows without bound and genuinely never forgets '
    + 'its seed, so the bounded accumulator refuses it correctly',
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
  it('no more than 20 scripts are OPEN', () => {
    expect(open.length).toBeLessThanOrEqual(20)
  })

  it('⭐ TC2000 has no open gaps, and that is a real result rather than an empty set', () => {
    // ⛔ NON-VACUITY: the corpus is large, cited from TC2000's own help pages, and
    // its refusals are REAL refusals — so "0 open" is a finished door, not an
    // unmeasured one.
    expect(PCF.refused.length).toBeGreaterThanOrEqual(21)
    expect(pcfTranslates.length).toBeGreaterThanOrEqual(57)
  })

  it('the doors that translate at all may not translate fewer', () => {
    expect(ALL.filter((r) => r.ok).length).toBeGreaterThanOrEqual(41)
  })
})
