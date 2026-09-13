// app/src/components/chart/builder/memberPane/symbolThread.test.js
//
// ─── ⭐⭐ R-K — THE THREAD, MEASURED ON THE REAL DOCUMENT ────────────────────
//
// `symbolFoldParity.test.js` proves the two lanes fold a symbol the same way.
// This proves the SEAM: that the chart lane's ctx actually carries the object to
// `bindingConstants`, and that carrying it turns refusals into columns.
//
// ⚰️ THE BEFORE NUMBER IS WHY THIS FILE EXISTS. T5's pixels found three of
// `uncharted-volume-v2`'s four columns absent from the member pane, each
// refusing `interpret:bind-time-text` on `syminfo.ticker, syminfo.tickerid`. The
// fold stage was built, wired and dark: `astColumnsFor` handed
// `bindingConstants` a ticker STRING and `symbolConstantsWith` returns `{}` for
// anything that is not an object.
//
// ⛔ IT MEASURES BOTH DIRECTIONS ON PURPOSE. A test that only asserted the AFTER
// state would pass just as well against a lane that had stopped refusing
// anything at all — and "the refusals went away" is the failure mode as much as
// the fix.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from './memberPaneDefinition'
import { computeFor, columnErrors } from '../../engine/nativeRegistry'

const V2 = fs.readFileSync(
  path.resolve(process.cwd(), '../tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

/** Enough bars for the 50-bar columns; the values are not the subject. */
const BARS = Array.from({ length: 120 }, (_, i) => ({
  t: `2026-0${1 + Math.floor(i / 31)}-${String((i % 31) + 1).padStart(2, '0')}`,
  o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + (i % 7), v: 1_000_000 + i * 1000,
}))

const KEYS = ['value', 'out2', 'out3', 'out4']

function run(ctx) {
  const built = memberPaneDefinition({ source: V2 })
  expect(built.ok).toBe(true)
  const cols = computeFor(built.definition, BARS, {}, ctx)
  const errs = columnErrors(cols) || {}
  return {
    computed: KEYS.filter((k) => cols[k]),
    refused: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v.guard])),
    messages: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, String(v.message || '')])),
  }
}

describe('R-K — the symbol object reaches the fold, and the columns come back', () => {
  it('⚰️ BEFORE: a ctx with only the ticker STRING refuses three of four', () => {
    const before = run({ tf: 'D', sym: 'SPY', newestBarIsForming: false })
    expect(before.computed).toEqual(['out2'])
    expect(Object.keys(before.refused).sort()).toEqual(['out3', 'out4', 'value'])
    for (const k of ['value', 'out3', 'out4']) {
      expect(before.refused[k]).toBe('interpret:bind-time-text')
      // ⭐⭐ AND THE FIELD IT NAMES TRACKS EXACTLY WHAT IS MISSING. With no
      // symbol at all the first unfoldable operand is `syminfo.ticker`, so that
      // is what the member is told; with a symbol whose exchange has no witness
      // the ticker resolves and the refusal moves on to `syminfo.tickerid` (the
      // third case below). A refusal that said the same thing in both states
      // would be a category, not a diagnosis.
      expect(before.messages[k]).toContain('syminfo.ticker')
      expect(before.messages[k]).not.toContain('syminfo.tickerid')
    }
  })

  it('⭐⭐ AFTER: the same document with `{ticker, exchange}` computes all four', () => {
    const after = run({
      tf: 'D', sym: 'SPY', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' },
      newestBarIsForming: false,
    })
    expect(after.computed).toEqual(KEYS)
    expect(after.refused).toEqual({})
  })

  it('⛔ AN UNWITNESSED EXCHANGE STILL REFUSES, and says which field', () => {
    // The honest limit: v2's ratio test is `contains(ticker,"/") or
    // contains(tickerid,"/")`, and this engine evaluates both arms of an `or`.
    // A symbol whose exchange has no witness settles the first and not the
    // second, so the column refuses — naming `syminfo.tickerid`, which is the
    // field a capture would have to settle.
    const unwitnessed = run({
      tf: 'D', sym: 'FOO', symbol: { ticker: 'FOO', exchange: 'Some Exchange' },
      newestBarIsForming: false,
    })
    expect(unwitnessed.computed).toEqual(['out2'])
    expect(unwitnessed.messages.value).toContain('syminfo.tickerid')
    expect(unwitnessed.messages.value).not.toContain('syminfo.ticker,')
  })

  it('⛔ and a missing exchange is not silently treated as a witnessed one', () => {
    const noExchange = run({
      tf: 'D', sym: 'SPY', symbol: { ticker: 'SPY', exchange: null },
      newestBarIsForming: false,
    })
    expect(noExchange.computed).toEqual(['out2'])
    // ⭐ `syminfo.ticker` DID resolve — only the vendor-spelled half is missing,
    // which is the difference between "we know nothing" and "we know the ticker".
    expect(noExchange.messages.value).toContain('syminfo.tickerid')
  })
})
