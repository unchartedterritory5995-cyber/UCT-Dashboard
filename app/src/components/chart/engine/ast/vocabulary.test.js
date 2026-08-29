// app/src/components/chart/engine/ast/vocabulary.test.js
//
// ─── 🔴 A MEMBER CANNOT BUILD WITH A VOCABULARY THEY CANNOT SEE ─────────────
//
// The engine declares its whole language as data and, until this module, nothing
// showed a member any of it. The 2026-08-28 census found 22 frontend files that
// READ the manifest and not one reference surface; a follow-up derivation found
// that the ONLY complete list of names a member could ever see was inside an
// ERROR — `interpret.js` refuses an unknown name by joining every key in scope,
// a 1,700-character dump of raw identifiers in a red alert chip.
//
// ⛔⛔ AND THE THING THIS FILE ACTUALLY GUARDS IS NOT COMPLETENESS BUT TRUTH. A
// reference a member builds on must never be confidently wrong, so every
// assertion below is about a way it could LIE:
//   * a section whose entries render no English (two shipped that way — `series`
//     declares `doc` where everything else declares `sentence`, and the
//     benchmarks are `{name}` objects that stringify to `[object Object]`);
//   * a tombstone rendered as an exclusion (`_vwap_was_here` and
//     `_adx_was_here` are notes about functions that are LIVE TODAY — printing
//     them would tell a member `vwap` and `adx` are unavailable);
//   * a roster that is a hand-list and so cannot grow with the manifest.

import { describe, it, expect } from 'vitest'

import { TABLE } from './parse'
import { OPERATOR_SENTENCE } from './sentence'
import {
  buildVocabulary, searchVocabulary, signatureOf, reachOf, traitsOf, substituteFor,
} from './vocabulary'

const VOCAB = buildVocabulary()
const items = VOCAB.groups.flatMap((g) => g.items)
const byName = Object.fromEntries(items.map((i) => [i.name, i]))

describe('every name in the vocabulary carries English a member can read', () => {
  it('⛔⛔ NO GROUP RENDERS A BLANK — the rail that would have caught both bugs', () => {
    // ⚰️ TWO SECTIONS SHIPPED BLANK BEFORE THIS EXISTED, for two different
    // reasons, and neither was visible from the code: `series` declares `doc`
    // (five empty rows) and `_benchmarks_scannable` holds objects (fifteen rows
    // reading `[object Object]`). Both were found by DUMPING the built roster,
    // which is what this assertion automates.
    for (const g of VOCAB.groups) {
      expect(g.items.length, `${g.id} is empty`).toBeGreaterThan(0)
      for (const it of g.items) {
        expect(it.sentence, `${g.id}.${it.name} has no English`).toBeTruthy()
        expect(it.sentence, `${g.id}.${it.name} stringified an object`)
          .not.toContain('[object Object]')
      }
    }
  })

  it('⭐ the roster covers every declared section of the manifest', () => {
    // ⛔ DERIVED ON BOTH SIDES. Counting the manifest here and comparing to the
    // built groups means a 64th function appears in the product with no edit to
    // any page — and a section someone adds tomorrow fails this until it is
    // rendered, rather than being silently invisible to members.
    expect(byName.close).toBeTruthy()                       // series
    expect(Object.keys(TABLE.functions).every((n) => byName[n])).toBe(true)
    expect(Object.keys(TABLE.scalars).every((n) => byName[n])).toBe(true)
    expect(Object.keys(TABLE.clock).every((n) => byName[n])).toBe(true)
    expect(Object.keys(OPERATOR_SENTENCE).every((n) => byName[n])).toBe(true)
  })

  it('⛔ a PLANTED entry appears — so the roster is a walk, not a hand-list', () => {
    const planted = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        zzTestFn: {
          args: ['series', 'int'], argRoles: ['source', 'period'],
          lookback: 'arg1', yields: 'num', sentence: 'a planted entry',
        },
      },
    }
    const v = buildVocabulary(planted, OPERATOR_SENTENCE)
    const names = v.groups.flatMap((g) => g.items.map((i) => i.name))
    expect(names).toContain('zzTestFn')
    // …and the CONTROL: the shipped roster does not contain the plant.
    expect(items.map((i) => i.name)).not.toContain('zzTestFn')
  })
})

describe('the exclusions are product, and a tombstone is not an exclusion', () => {
  it('⛔⛔ a NOTE key is never rendered as a name a member cannot use', () => {
    // `_functions_excluded` holds 19 keys and only 14 are refused NAMES. Five are
    // prose, and two of those — `_vwap_was_here`, `_adx_was_here` — are
    // tombstones for functions that are CALLABLE TODAY. Rendering them would tell
    // a member the engine lacks `vwap` and `adx` while both sit in the roster
    // above, which is worse than saying nothing.
    const excludedNames = VOCAB.excluded.map((e) => e.name)
    expect(excludedNames).not.toContain('_vwap_was_here')
    expect(excludedNames).not.toContain('_adx_was_here')
    expect(excludedNames.some((n) => n.startsWith('_'))).toBe(false)
    // ⭐ AND THE CONTROL THAT MAKES THAT MEAN SOMETHING: the two names those
    // tombstones are about ARE in the live vocabulary.
    expect(byName.vwap).toBeTruthy()
    expect(byName.adx).toBeTruthy()
  })

  it('⭐ every exclusion carries a reason a member can act on', () => {
    expect(VOCAB.excluded.length).toBeGreaterThan(0)
    for (const e of VOCAB.excluded) {
      expect(e.reason, `${e.name} excluded with no reason`).toBeTruthy()
      expect(e.reason.length, `${e.name}'s reason is a stub`).toBeGreaterThan(20)
    }
  })

  it('⛔ the derivation drops NOTE keys rather than a fixed list of them', () => {
    const planted = {
      ...TABLE,
      _functions_excluded: { ...TABLE._functions_excluded, _some_future_note: 'prose' },
    }
    const v = buildVocabulary(planted, OPERATOR_SENTENCE)
    expect(v.excluded.map((e) => e.name)).not.toContain('_some_future_note')
  })
})

describe('a member finds a name by what it DOES, and finds out what we lack', () => {
  it('⭐⭐ "high volume" finds `hvc_52w` — the case a substring search failed', () => {
    // ⚰️ MEASURED BEFORE THE FIX: the entry's own sentence reads "the 52-week
    // high-volume-close flag", so a substring test for "high volume" matched
    // NOTHING. Splitting both sides on non-alphanumerics is what makes the
    // member's own phrase land.
    const r = searchVocabulary('high volume', VOCAB)
    expect(r.groups.flatMap((g) => g.items.map((i) => i.name))).toContain('hvc_52w')
  })

  it('⭐ a prefix narrows rather than needing the whole word', () => {
    const r = searchVocabulary('vol', VOCAB)
    const names = r.groups.flatMap((g) => g.items.map((i) => i.name))
    expect(names).toContain('volume')
    expect(names).toContain('avg_volume_30d')
  })

  it('⛔ every term must land — AND, not OR', () => {
    // "market cap" as OR would return everything mentioning either word, which is
    // most of the table and is the same as returning nothing.
    const r = searchVocabulary('market cap', VOCAB)
    expect(r.groups.flatMap((g) => g.items.map((i) => i.name))).toEqual(['market_cap'])
  })

  it('⭐⭐ searching for a name we deliberately LACK answers with the reason', () => {
    // ⛔ THE HALF NO RIVAL SHIPS. A member searching `obv` must learn that
    // unbounded on-balance volume is deliberately absent and WHY — not get an
    // empty result, which is indistinguishable from "you typed it wrong".
    const r = searchVocabulary('obv', VOCAB)
    expect(r.excluded.map((e) => e.name)).toContain('obv')
    expect(r.excluded.find((e) => e.name === 'obv').reason).toMatch(/CUMULATIVE/)
    // …and the bounded form we DO have is in the same answer.
    expect(r.groups.flatMap((g) => g.items.map((i) => i.name))).toContain('obvN')
  })

  it('⛔ an empty query returns everything rather than nothing', () => {
    const r = searchVocabulary('   ', VOCAB)
    expect(r.groups.length).toBe(VOCAB.groups.length)
  })
})

describe('an entry states what the engine will refuse people over', () => {
  it('⭐⭐ the signature names the ROLES, not the kinds', () => {
    // `atr(series, series, series, int)` tells a member nothing and the wrong
    // order is a `pine:role-order` refusal. `atr(high, low, close, period)` is
    // copyable.
    expect(signatureOf('atr', TABLE.functions.atr)).toBe('atr(high, low, close, period)')
    expect(signatureOf('sma', TABLE.functions.sma)).toBe('sma(series, period)')
  })

  it('⭐ the reach names the ARGUMENT, because that is what was declared', () => {
    expect(reachOf(TABLE.functions.sma)).toMatch(/argument 2/)
    expect(reachOf(TABLE.functions.vwap)).toMatch(/session/)
    expect(reachOf(TABLE.functions.abs)).toMatch(/this bar only/)
  })

  it('⛔ a trait row exists only where a declaration does', () => {
    // An entry that declares nothing special must say nothing special, or every
    // card carries the same six lines and the member stops reading them.
    expect(traitsOf(TABLE.functions.abs)).toEqual([])
    expect(traitsOf(TABLE.functions.pivothigh).map((t) => t.key)).toContain('forward')
    expect(traitsOf(TABLE.functions.vwap).map((t) => t.key)).toContain('reads')
    expect(traitsOf(TABLE.functions.accum).map((t) => t.key)).toContain('recurrence')
    // ⭐ AND THE VENDOR NOTE REACHES THE REFERENCE, not just the paste box — a
    // member reading about `atr` here is owed the same sentence as one pasting it.
    expect(traitsOf(TABLE.functions.atr).map((t) => t.key)).toContain('vendorNote')
  })
})

describe('a refused name points at the formula to write instead', () => {
  const excludedByName = Object.fromEntries(VOCAB.excluded.map((e) => [e.name, e]))

  it('⭐⭐ seven refused functions hand back a formula a member can paste', () => {
    expect(excludedByName.hl2.instead).toBe('(high + low) / 2')
    expect(excludedByName.hlc3.instead).toBe('(high + low + close) / 3')
    expect(excludedByName.macdSignal.instead).toBe('ema(macd(close, 12, 26), 9)')
  })

  it('⛔⛔ TRAP 1 — `stochD` must NOT hand back `dPeriod`', () => {
    // Its reason reads "… %D is the simple mean of %K over `dPeriod` and …
    // `sma(stoch(…), 3)`", so taking the FIRST backticked span after the phrase
    // yields an ARGUMENT NAME offered to a member as a formula.
    expect(excludedByName.stochD.instead).toBe('sma(stoch(high, low, close, 14), 3)')
    expect(excludedByName.stochD.instead).not.toBe('dPeriod')
  })

  it('⛔⛔ TRAP 2 — `obv` must NOT hand back the expression it WARNS against', () => {
    // Its reason contains "⛔ IT IS NOT `obvN(20)`". A reader that scraped
    // backticks without gating on the ALREADY-EXPRESSIBLE phrase would hand back
    // exactly the thing the manifest is telling the member not to use.
    expect(excludedByName.obv.instead).toBeNull()
    expect(excludedByName.obv.reason).toContain('obvN(20)')
  })

  it('⛔ a candidate that is not a FORMULA is never shown', () => {
    // The parser is the judge, and a lone identifier is rejected even though it
    // parses — a substitute must DO something.
    expect(substituteFor('ALREADY EXPRESSIBLE: `dPeriod`')).toBeNull()
    expect(substituteFor('ALREADY EXPRESSIBLE: `close + 1`')).toBe('close + 1')
    expect(substituteFor('ALREADY EXPRESSIBLE: `((((`')).toBeNull()
    // …and no phrase means no substitute, however many backticks the prose has.
    expect(substituteFor('this is not expressible, and it is NOT `sma(close, 5)`')).toBeNull()
  })
})
