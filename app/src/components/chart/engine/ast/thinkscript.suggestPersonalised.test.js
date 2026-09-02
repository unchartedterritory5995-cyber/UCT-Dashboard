// app/src/components/chart/engine/ast/thinkscript.suggestPersonalised.test.js
//
// ─── ⚰️⚰️ THE DOOR THAT OFFERS THE FIX WAS COMMITTING THE ERROR IT GUARDS ────
//
// `TS_DOC_BLOCKED`'s ruling is explicit about why nothing is auto-applied:
//
//   "a `price` guessed wrong draws a plausible column that is wrong everywhere
//    with no refusal anywhere. Applying one silently is the mistranslation this
//    lane exists against."
//
// ⛔ AND THE SUGGESTION ITSELF DID EXACTLY THAT. It was a STATIC string, so it
// could not know what the member had written, and it overwrote them:
//
//   05-bollinger-rsi-buy-arrow   `input BB_Length = 30;`
//                                `BollingerBands(length = BB_Length)`
//     offered → `BollingerBands(price = close, length = 20, …)`   ⛔ 30 becomes 20
//
//   09-above-average-price-volume `def varhigh = high(period = Period);`
//                                 `SimpleMovingAvg(varhigh, 20)`
//     offered → `SimpleMovingAvg(close, 20, 0)`      ⛔ their series becomes close
//
// A member accepting either edit gets a column that computes, charts, screens and
// is WRONG — the `BB_Length` input still sitting at the top of their script,
// still adjustable, no longer wired to anything. No guard fires, because nothing
// about the result is malformed. That is the exact failure the ruling names, and
// the suggestion was the one place in the lane still doing it.
//
// ⭐ THE FIX KEEPS BOTH HALVES: the registry supplies the parameters the member
// LEFT OUT, and the member's own text fills every one they WROTE.
//
// ─── what this file can actually see, measured ────────────────────────
//
//   control  unmutated                              exit 0   5 passed
//   M1       personalisation off (the old defect)   exit 1   3 failed
//   M2       name-only match (positional half off)  exit 1   1 failed
//   M3       spellTokens always emits a space       exit 0   5 passed
//
// ⚠️ M3 IS AN EQUIVALENT MUTANT AND IS RECORDED RATHER THAN CHASED. Spacing every
// token apart turns `AverageType.SIMPLE` into `AverageType . SIMPLE` — uglier, and
// it still parses and still means the same thing. This file's claim is about which
// VALUES an offered edit carries, not about its whitespace, so a mutation that
// changes only the whitespace SHOULD pass. Adding an assertion to kill it would be
// pinning cosmetics and would fail the next time the spacing rule is improved.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { translateThinkScript, TS_DOC_BLOCKED } from './thinkscript.js'
import { inspectSource } from '../../builder/PineBox.jsx'

const read = (f) => readFileSync(
  path.resolve(process.cwd(), `../tests/fixtures/thinkscript/${f}`), 'utf8')

describe('a suggestion carries the member’s own arguments', () => {
  it('⭐⭐ a NAMED argument survives — their input, not the registry’s number', () => {
    const src = read('05-bollinger-rsi-buy-arrow.ts')
    const { suggest } = translateThinkScript(src).refusal
    expect(suggest).toContain('length = BB_Length')

    // ⛔ THE CONTROL, WITHOUT WHICH THIS PROVES NOTHING. The registry's own text
    // really does hardcode a different number, so a regression to the static
    // string is a value this assertion can see — rather than two spellings of the
    // same answer (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(TS_DOC_BLOCKED.BollingerBands.suggest).toContain('length = 20')
    expect(suggest).not.toContain('length = 20')

    // …and the member's number is not 20 either, so accepting the old edit was a
    // silent CHANGE and not a no-op.
    expect(src).toMatch(/input\s+BB_Length\s*=\s*30/)
  })

  it('⭐⭐ a POSITIONAL argument survives too — the half a name match missed', () => {
    // ⚰️ MEASURED AFTER THE FIRST FIX SHIPPED GREEN. `SimpleMovingAvg` is
    // published positionally, so no template argument carried a name to match on
    // and this script was still being handed `close` in place of its own series.
    const { suggest } = translateThinkScript(read('09-above-average-price-volume.ts')).refusal
    expect(suggest).toContain('varhigh')
    expect(TS_DOC_BLOCKED.SimpleMovingAvg.suggest).toBe('SimpleMovingAvg(close, 20, 0)')
    expect(suggest).not.toBe(TS_DOC_BLOCKED.SimpleMovingAvg.suggest)
  })

  it('⭐⭐ ACCEPTING THE EDITS TRANSLATES THE SCRIPT, and on the member’s numbers', () => {
    // ⚠️ "THE REFUSAL MOVED" IS NOT "THE MEMBER GAINED SOMETHING", so this case
    // does not stop at a different guard. It accepts both suggestions the way a
    // member would — as text, into their own source — and then reads the COLUMN.
    let src = read('05-bollinger-rsi-buy-arrow.ts')
    const first = translateThinkScript(src).refusal.suggest
    src = src.replace(/BollingerBands\(length ?= ?BB_Length\)/g, first)
    const second = translateThinkScript(src).refusal.suggest
    expect(second).toContain('length = RSI_Length')       // the chain personalises too
    src = src.replace(/RSI\(length ?= ?RSI_Length\)/g, second)

    const out = translateThinkScript(src)
    expect(out.ok, out.ok ? '' : `${out.refusal.guard} @${out.refusal.line}`).toBe(true)
    const formula = out.outputs.map((o) => o.formula || '').join(' ')

    // ⭐⭐ THE ASSERTION THE OLD BEHAVIOUR WOULD HAVE FAILED. `BB_Length` is 30, so
    // a correct acceptance computes the bands over 30 bars. The static suggestion
    // produced a script that translated just as happily over 20 — same shape, same
    // column count, no refusal, wrong number on every bar.
    expect(formula).toContain('sma(close, 30)')
    expect(formula).toContain('stdev(close, 30)')
    expect(formula).not.toContain('sma(close, 20)')
  })

  it('⛔ it DEGRADES to the published spelling rather than to a third thing', () => {
    // When the member supplied nothing this door can substitute, the registry's
    // own text comes back byte for byte — so the fix can only ever be the static
    // suggestion or better, and `thinkscript.suggest.test.js` still governs it.
    const { suggest } = translateThinkScript(read('16-scan-rsi-crosses-30-70.ts')).refusal
    expect(suggest).toBe(TS_DOC_BLOCKED.RSI.suggest)
  })

  it('⭐⭐ the MEMBER sees it — measured through `inspectSource`, not the engine', () => {
    // ⚰️ MEASURING THE ENGINE AND REPORTING IT AS THE MEMBER'S EXPERIENCE IS A
    // MISTAKE THIS LANE HAS ALREADY MADE ONCE. `translateThinkScript` is not the
    // door the paste box calls; `inspectSource` is, and it rebuilds the refusal on
    // the way out (`stamp`). A rebuild between writer and reader is exactly where a
    // stamped field goes missing forever
    // (`lesson_a_projection_drops_what_it_does_not_name`), so the claim “the member
    // sees their own value” has to be read THROUGH the reader that ships.
    const out = inspectSource(read('05-bollinger-rsi-buy-arrow.ts'), 'auto')
    expect(out.dialect).toBe('thinkscript')
    expect(out.refusal).toBeTruthy()
    expect(out.refusal.suggest).toContain('length = BB_Length')
    expect(out.refusal.suggest).not.toContain('length = 20')
    // ⭐ and the projection really is the lossy-looking step, so this is not a
    // second spelling of the engine assertion above.
    expect(out.refusal.source).toBeTruthy()
  })

  it('⛔ a QUOTED parameter name stays quoted — an edit that will not parse is worthless', () => {
    const { suggest } = translateThinkScript(read('05-bollinger-rsi-buy-arrow.ts')).refusal
    expect(suggest).toContain('"average type" = AverageType.SIMPLE')
    // and the whole offered call really does read back as one call
    expect(suggest.startsWith('BollingerBands(')).toBe(true)
    expect(suggest.endsWith(')')).toBe(true)
  })
})
