// 🔴 THE STUDY-REFERENCE RESOLVER — `reference <Study>(…).<Plot>`, and the line
// between what thinkorswim PUBLISHES and what this door would have to invent.
//
// ⭐⭐ THE DEFECT THIS FILE EXISTS TO KEEP FIXED IS AN **OVER-REFUSAL**, which is
// the one defect class with no natural red test. Until 2026-08-29 the five study
// rows in `TS_CALL_SHAPES` read `params: []` plus an unconditional `refuse`, so
// the door refused a study reference HOWEVER COMPLETELY the member had specified
// it. A member who wrote `RSI(length = 14, price = close)` — every value this
// engine needs, stated in their own script, nothing left for anyone to invent —
// was told "thinkorswim publishes no default `length` or `price`": an answer
// about a default they had not asked anybody to supply.
//
// ⛔ NOTHING FAILED WHEN THAT SHIPPED, AND NOTHING COULD HAVE. A wrong "no"
// produces no wrong column, no exception and no complaint — only a refusal
// sentence that reads plausible (`lesson_an_over_refusal_is_invisible`). It had
// already survived one repair: the `rsi` row was corrected for PRINTING a remedy
// that `params: []` made unfollowable, and that fix changed the sentence and left
// the mechanism, so the loop stayed. **A rail on the sentence is not a rail on
// the behaviour** (`lesson_rail_the_sentence_not_just_the_guard`).
//
// ⭐ SO EVERY CASE BELOW IS PAIRED. For each study: a call missing an unpublished
// default must REFUSE naming that parameter, and the same call with it SUPPLIED
// must TRANSLATE to a named formula. Neither half alone can tell a correct
// refusal from a door that refuses everything
// (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
//
// ⛔⛔ AND THE CORPUS DID NOT MOVE: thinkScript 9/24 before this resolver and
// 9/24 after, measured by running the translators over all 24 fixtures both ways.
// That is the honest result and it is recorded here rather than implied. `05` and
// `16` still refuse because thinkorswim publishes no default `price`; `07` is
// proprietary; `09` and `19` each have a SECOND wall behind the study reference
// that no study resolver can reach. What changed is the LANGUAGE — a fully
// specified study reference is now expressible — and the corpus's job is only to
// prove nothing went backwards.

import { describe, it, expect } from 'vitest'

import { translateThinkScript, TS_CALL_SHAPES, TS_DOC_BLOCKED } from './thinkscript.js'
import TABLE from './closedTable.json'

/** The formula of a translation that must have succeeded, or a failing message
 *  naming the guard and sentence instead of a `TypeError` from a null deref. */
const formulaOf = (src) => {
  const r = translateThinkScript(src)
  expect(r.ok, `expected a translation, got ${r.refusal && r.refusal.guard}: `
    + `${r.refusal && r.refusal.message}`).toBe(true)
  return r.outputs[r.selected].formula
}

const refusalOf = (src) => {
  const r = translateThinkScript(src)
  expect(r.ok, `expected a refusal, got the formula: `
    + `${r.ok ? r.outputs[r.selected].formula : ''}`).toBe(false)
  return r.refusal
}

describe('a study reference whose every value the member stated TRANSLATES', () => {
  // ⭐ THE PAIRS ARE THE POINT. Left: the study spelled the way a member would
  // paste it, with every parameter the vendor never defaulted supplied. Right:
  // exactly the engine formula it must become — not "some formula", the one.
  const TRANSLATES = [
    ['RSI, both unpublished defaults supplied',
      'plot p = RSI(length = 14, price = close) crosses above 30;\n',
      'crossOver(rsi(close, 14), 30)'],
    ['RSI positionally, in the page\'s own parameter order',
      'plot p = RSI(14, 70, 30, close) > 50;\n',
      'rsi(close, 14) > 50'],
    ['BollingerBands lower band, simple average',
      'plot p = low < BollingerBands(price = close, displace = 0, length = 20, '
        + '"average type" = AverageType.SIMPLE).LowerBand;\n',
      'low < sma(close, 20) + -2 * stdev(close, 20)'],
    ['BollingerBands upper band keeps the published +2',
      'plot p = high > BollingerBands(price = close, displace = 0, length = 20, '
        + '"average type" = AverageType.SIMPLE).UpperBand;\n',
      'high > sma(close, 20) + 2 * stdev(close, 20)'],
    ['SimpleMovingAvg with displace stated',
      'plot p = close > SimpleMovingAvg(close, 20, 0);\n',
      'close > sma(close, 20)'],
    ['MovAvgExponential, STRING parameter and STRING plot name — corpus 19\'s spelling',
      'plot p = low > MovAvgExponential("price" = close, "length" = 21, "displace" = 0)'
        + '."AvgExp";\n',
      'low > ema(close, 21)'],
  ]

  for (const [what, src, want] of TRANSLATES) {
    it(`⭐ ${what}`, () => {
      expect(formulaOf(src)).toBe(want)
    })
  }

  it('⛔⛔ the average type DISPATCHES — the bands are drawn around the one asked for', () => {
    // ⭐ THE PAGE NAMES FIVE AVERAGE TYPES AND PICKS NONE, so the arm the member
    // writes chooses the engine. Answering `sma` for a member who asked for HULL
    // would be a chart that looks right and is wrong — the single outcome this
    // door exists against.
    const band = (arm) => formulaOf('plot p = close > BollingerBands(price = close, '
      + `displace = 0, length = 20, "average type" = AverageType.${arm}).UpperBand;\n`)
    expect(band('SIMPLE')).toBe('close > sma(close, 20) + 2 * stdev(close, 20)')
    expect(band('EXPONENTIAL')).toBe('close > ema(close, 20) + 2 * stdev(close, 20)')
    expect(band('HULL')).toBe('close > hma(close, 20) + 2 * stdev(close, 20)')
    // ⛔ AND THE DEVIATION ARM NEVER MOVES WITH IT — thinkorswim's BollingerBands
    // takes the standard deviation of PRICE, not of the average, whichever average
    // is chosen. Three different midlines, one `stdev` — if a future edit routed
    // the deviation through the dispatch too, these three would still all "look
    // fine" individually and this line is what catches it.
    for (const arm of ['SIMPLE', 'EXPONENTIAL', 'HULL']) {
      expect(band(arm)).toContain('stdev(close, 20)')
    }
  })
})

describe('…and a study reference missing an UNPUBLISHED default refuses, naming it', () => {
  // ⛔ THE PARAMETER NAMED IS THE ONE THE MEMBER'S OWN CALL LEFT OUT. The old
  // blanket refusal printed the same fixed list of missing defaults to everybody,
  // so a member who had supplied two of three was told about all three. Each row
  // here supplies a DIFFERENT subset, and asserts the sentence tracks it.
  const REFUSES = [
    ['RSI with nothing at all names `length`', 'plot p = RSI() > 30;\n', '`length` has no value'],
    ['RSI with length only names `price`',
      'plot p = RSI(length = 14) > 30;\n', '`price` has no value'],
    ['BollingerBands with length only names `price`',
      'plot p = close > BollingerBands(length = 20).LowerBand;\n', '`price` has no value'],
    ['SimpleMovingAvg with price and length names `displace`',
      'plot p = close > SimpleMovingAvg(close, 20);\n', '`displace` has no value'],
    ['MovAvgExponential with length only names `price`',
      'plot p = close > MovAvgExponential("length" = 21)."AvgExp";\n', '`price` has no value'],
  ]

  for (const [what, src, names] of REFUSES) {
    it(`⛔ ${what}`, () => {
      const r = refusalOf(src)
      expect(r.guard).toBe('thinkscript:arity')
      expect(r.message).toContain(names)
      // ⭐ AND IT SAYS WHY NOTHING FILLED IT. "publishes no default for it" is the
      // whole content of the refusal: the maths is mapped, the value is not.
      expect(r.message).toContain('publishes no default for it')
    })
  }

  it('⛔⛔ TTM_Squeeze refuses whatever you write — it is PROPRIETARY, not underspecified', () => {
    // ⭐ THE ONE STUDY WHERE A BLANKET REFUSAL IS STILL CORRECT, and keeping it
    // beside the four that changed is what makes the distinction legible: those
    // four refuse a missing NUMBER, this one refuses a missing FORMULA. No
    // argument list can fix it, so no argument list changes the answer.
    for (const src of ['plot p = TTM_Squeeze(close);\n',
      'plot p = TTM_Squeeze(close, 20, 1.5, 2.0, 1.0).SqueezeAlert;\n']) {
      const r = refusalOf(src)
      expect(r.guard, src).toBe('thinkscript:study-ref')
      expect(r.message, src).toContain('publishes no formula')
    }
  })
})

describe('the plot leg is resolved against what the study DECLARES', () => {
  it('⭐ a bare reference is the study`s FIRST-declared plot — the vendor`s own rule', () => {
    // Reserved-Words/reference: "If the plot name is not defined, study's main
    // plot should be referenced (main is the first declared in the source code)."
    // BollingerBands declares MidLine, LowerBand, UpperBand in that order, so a
    // bare reference is the middle average and NOT a band.
    const bare = formulaOf('plot p = close > BollingerBands(price = close, displace = 0, '
      + 'length = 20, "average type" = AverageType.SIMPLE);\n')
    expect(bare).toBe('close > sma(close, 20)')
    // ⛔ THE CONTROL: naming the plot explicitly gives a DIFFERENT formula, so the
    // line above is a real resolution and not "every leg returns the midline".
    expect(bare).not.toBe(formulaOf('plot p = close > BollingerBands(price = close, '
      + 'displace = 0, length = 20, "average type" = AverageType.SIMPLE).LowerBand;\n'))
  })

  it('⛔⛔ an unknown plot name REFUSES and lists the real ones — it never falls back', () => {
    // ⭐ THIS IS THE SILENT-MISTRANSLATION GUARD. "Unknown leg → use the main
    // plot" is the tempting lenient reading, and under it `.LowerBnd` — one
    // dropped letter — would quietly draw the MIDLINE. That column computes,
    // prints, round-trips and saves, and is not the band the member asked for.
    const r = refusalOf('plot p = close > BollingerBands(price = close, displace = 0, '
      + 'length = 20, "average type" = AverageType.SIMPLE).LowerBnd;\n')
    expect(r.guard).toBe('thinkscript:study-ref')
    expect(r.message).toContain('declares no plot called')
    expect(r.message).toContain('LowerBnd')
    // It names what IS available, so the member fixes it in one edit.
    for (const plot of ['MidLine', 'LowerBand', 'UpperBand']) {
      expect(r.message, `the refusal must list ${plot}`).toContain(plot)
    }
  })

  it('⛔ a SIGNAL-ARROW plot refuses, and points at the crossing it really is', () => {
    // UpSignal/DownSignal are marks on the bars where price crosses the average —
    // not a value on every bar. The screen the member wants IS expressible, so the
    // refusal names it in their own dialect rather than approximating the arrow.
    const r = refusalOf('plot p = MovAvgExponential(close, 21, 0).UpSignal;\n')
    expect(r.guard).toBe('thinkscript:study-ref')
    expect(r.message).toContain('crosses above')
    expect(r.message).toContain('ExpAverage')
    // ⭐ AND THE REMEDY IT NAMES ACTUALLY WORKS — a refusal that offers an
    // unfollowable remedy is the exact defect this whole area was fixed for.
    expect(formulaOf('plot p = close crosses above ExpAverage(close, 21);\n'))
      .toBe('crossOver(close, ema(close, 21))')
  })
})

describe('what the door will still not assume', () => {
  it('⛔⛔ `displace` must be WRITTEN 0 — its sign convention is backwards from ours', () => {
    // The page says "Positive values signify BACKWARD displacement", which is the
    // opposite of the direction an offset means here. A guess draws a plausible
    // column shifted the wrong way — invisible in the output, wrong on every row.
    const r = refusalOf('plot p = close > SimpleMovingAvg(close, 20, 2);\n')
    expect(r.guard).toBe('thinkscript:function')
    expect(r.message).toContain('shifts every bar')
    expect(r.message).toContain('BACKWARD')
    // …and 0 is accepted, so this is a gate on the VALUE, not a refusal of the
    // parameter.
    expect(formulaOf('plot p = close > SimpleMovingAvg(close, 20, 0);\n'))
      .toBe('close > sma(close, 20)')
  })

  it('⛔ RSI accepts only the Wilder`s average the page publishes as its default', () => {
    const r = refusalOf('plot p = RSI(length = 14, price = close, '
      + '"average type" = AverageType.SIMPLE) > 30;\n')
    expect(r.guard).toBe('thinkscript:function')
    // ⭐ IT NAMES THE ENGINE, NOT ANOTHER INDICATOR'S SUBJECT. This gate had one
    // caller (`ATR`) and hard-coded that caller's noun — "Wilder's average of the
    // TRUE RANGE" — so the day RSI became the second caller it described a
    // different indicator to the member. Wilder's SMOOTHING is what both share.
    expect(r.message).toContain('`rsi`')
    expect(r.message).toContain("Wilder's smoothing")
    expect(r.message, 'RSI is not an average of the true range')
      .not.toContain('true range')
    expect(r.message).toContain('AverageType.SIMPLE')
  })

  it('⭐ the Wilder`s default is USED, not demanded — the page publishes it', () => {
    // "By default, the Wilder's moving average is used in the calculation of RSI"
    // is a published default, so omitting `average type` must NOT refuse. (The
    // clause was missing from this file's earlier citation, which is why the door
    // used to demand it.)
    expect(formulaOf('plot p = RSI(length = 14, price = close) > 30;\n'))
      .toBe('rsi(close, 14) > 30')
    // …and writing the published value explicitly gives the identical answer.
    expect(formulaOf('plot p = RSI(length = 14, price = close, '
      + '"average type" = AverageType.WILDERS) > 30;\n')).toBe('rsi(close, 14) > 30')
  })

  it('⛔⛔ `defaults` still carries ONLY what a page prints — no `price`, no `length`', () => {
    // 🔴 THE LOAD-BEARING LINE OF THE WHOLE CHANGE. Mapping these studies would be
    // worthless — worse than worthless — if it were done by baking in `price:
    // close` and `length: 14`. Those are numbers sitting on the member's own
    // thinkorswim, not numbers thinkorswim publishes, and an invented window is
    // invisible in the result. This asserts the temptation was not taken, on every
    // mapped study at once, derived from the shapes rather than spot-checked.
    for (const name of ['rsi', 'bollingerbands', 'movavgexponential', 'simplemovingavg']) {
      const defaults = Object.keys(TS_CALL_SHAPES[name].defaults || {})
      expect(defaults, `${name} defaults \`price\` — that is a member's setting, not a `
        + 'published default').not.toContain('price')
      expect(defaults, `${name} defaults \`length\` — no Studies-Library page prints one`)
        .not.toContain('length')
      expect(defaults, `${name} defaults \`displace\`, which shifts every bar`)
        .not.toContain('displace')
    }
    // ⭐ AND THE CONTROL, so this is not vacuously true of empty maps: the
    // defaults that ARE published are present and are the published values.
    expect(TS_CALL_SHAPES.rsi.defaults['over bought']).toBe(70)
    expect(TS_CALL_SHAPES.rsi.defaults['over sold']).toBe(30)
    expect(TS_CALL_SHAPES.rsi.defaults['average type']).toEqual({ arm: 'wilders' })
    expect(TS_CALL_SHAPES.bollingerbands.defaults['num dev up']).toBe(2)
    expect(TS_CALL_SHAPES.bollingerbands.defaults['num dev dn']).toBe(-2)
  })
})

describe('the resolver is DATA, and the data is checked against the engine it names', () => {
  it('⛔ every mapped study reaches only functions the CLOSED TABLE declares', () => {
    let checked = 0
    for (const [name, shape] of Object.entries(TS_CALL_SHAPES)) {
      if (!shape.study) continue
      checked += 1
      const engines = [
        ...(shape.dispatch ? Object.values(shape.dispatch) : []),
        ...(shape.engine ? [shape.engine] : []),
        ...(shape.engines || []),
      ]
      expect(engines.length, `${name} names no engine at all`).toBeGreaterThan(0)
      for (const e of engines) {
        expect(Object.keys(TABLE.functions), `${name} → ${e}`).toContain(e)
      }
    }
    // non-vacuity: there ARE study shapes and this looked at them
    expect(checked, 'no study shapes found — this rail measured nothing').toBe(4)
  })

  it('⛔ every mapped study has a `TS_DOC_BLOCKED` entry that still describes it', () => {
    // ⚠️ A MAPPED STUDY IS STILL DOC-BLOCKED — partially. It refuses only for the
    // defaults the vendor never printed, so the registry entry must still exist
    // and must still be reachable in the refusal a partial call produces.
    for (const [name, shape] of Object.entries(TS_CALL_SHAPES)) {
      if (!shape.study) continue
      const registryName = Object.keys(TS_DOC_BLOCKED)
        .find((k) => k.toLowerCase() === name)
      expect(registryName, `${name} is mapped but has no TS_DOC_BLOCKED entry`).toBeTruthy()
      expect(TS_DOC_BLOCKED[registryName].missing.length).toBeGreaterThan(15)
      expect(TS_DOC_BLOCKED[registryName].unblocks.length).toBeGreaterThan(25)
    }
  })
})
