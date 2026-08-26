// 🔴 ONE DETECTOR, FOUR DIALECTS, AND IT IS MEASURED ON EVERY COMMITTED CORPUS.
//
// ⛔ A DETECTOR TESTED ON SNIPPETS PROVES NOTHING. `pcf.js::detectDialect` was
// right about the two languages it knew and is wrong about both of the two it
// does not (measured 2026-08-25, W3.1 probe, over all 75 committed scripts):
// 15 of the 24 thinkScript files read as `pcf` (`AvgExp`/`MAX`/`C1`-shaped
// tokens and a bare `=` trip its TC2000 markers) and the other 9 read as
// `native` (`mode == mode.UseCompoundValue` trips its `==` native marker) —
// and, worse in the other direction, THREE real published Pine scripts
// (`pine/17`, `pine/18`, `pine_community/02`) read as `pcf` too. So this rail
// reads the real files, in both directions, rather than a hand-typed snippet
// list that would have agreed with any of it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { detectDialect, DIALECTS, READER_NAME } from './dialect.js'
import { detectDialect as detectPcf } from './pcf.js'
import PCF_CORPUS from '../../../../../../tests/fixtures/ast/pcf_corpus.json'
import NATIVE_CORPUS from '../../../../../../tests/fixtures/ast/corpus.json'

const dir = (p) => path.resolve(process.cwd(), p)
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8')
const files = (d, ext) => fs.readdirSync(dir(d)).filter((f) => f.endsWith(ext)).sort()

const TS = '../tests/fixtures/thinkscript'
const PINE = '../tests/fixtures/pine'
const COMMUNITY = '../tests/fixtures/pine_community'

describe('every committed corpus detects as its own dialect', () => {
  // ⭐ A FLOOR, NOT AN EXACT COUNT — and the difference was measured, not
  // guessed. This gate exists to prove the sweep below HAS INPUTS; it is not a
  // census of the corpus, which is a different lane's artifact. An exact count
  // reds the whole file the moment a correctly-detected script is added — the new
  // case passes while the gate says `expected 25 to be 24` — which trains the
  // next reader to edit a number instead of reading a failure. The native gate
  // below was already written as a floor and absorbed W2a's 77 → 90 corpus growth
  // (`b0e5e693a`) with no edit at all; these three are now the same idiom.
  // Coverage does not depend on the number: each file below gets its own `it`.
  it('the corpora are all there — a gate with no inputs is not a gate', () => {
    expect(files(TS, '.ts').length).toBeGreaterThanOrEqual(24)
    expect(files(PINE, '.pine').length).toBeGreaterThanOrEqual(21)
    expect(files(COMMUNITY, '.pine').length).toBeGreaterThanOrEqual(30)
  })

  for (const f of files(TS, '.ts')) {
    it(`thinkscript/${f}`, () => {
      expect(detectDialect(read(dir(TS), f))).toBe('thinkscript')
    })
  }
  for (const f of files(PINE, '.pine')) {
    it(`pine/${f}`, () => expect(detectDialect(read(dir(PINE), f))).toBe('pine'))
  }
  for (const f of files(COMMUNITY, '.pine')) {
    it(`pine_community/${f}`, () => expect(detectDialect(read(dir(COMMUNITY), f))).toBe('pine'))
  }

  it('every accepted TC2000 formula still detects as pcf, and the two detectors agree', () => {
    const sources = (PCF_CORPUS.accepted || []).map((c) => c.source).filter(Boolean)
    expect(sources.length).toBeGreaterThan(20)
    for (const src of sources) {
      const mine = detectDialect(src)
      expect(mine, src).toBe(detectPcf(src) === 'pcf' ? 'pcf' : 'formula')
      expect(mine, src).toBe('pcf')
    }
  })

  it('a native formula is still native — nothing this product ever saved moves', () => {
    for (const src of ['close > sma(close, 50)', 'rsi(close, 14) < 30 && close > 0',
      'accum(0, self + 1, 250)', 'crossOver(ema(close, 9), ema(close, 21))']) {
      expect(detectDialect(src), src).toBe('formula')
    }
  })

  // ⛔ FOUR TYPED SNIPPETS ARE NOT THE PROMISE. "Nothing this product ever saved
  // moves" is a claim about the WHOLE native vocabulary, and this module puts TWO
  // new marker sets in front of the door every saved formula walks through — so
  // the claim has to be measured against the committed native corpus, the same
  // artifact `parse`/`interpret` are pinned on, and not against examples chosen
  // by the person writing the markers. Measured 2026-08-25: 77 cases, 0 move.
  it('every case in the committed NATIVE corpus still reads as formula', () => {
    const cases = (NATIVE_CORPUS.cases || []).filter((c) => c && typeof c.source === 'string')
    expect(cases.length, 'a corpus gate with no inputs is not a gate').toBeGreaterThan(50)
    for (const c of cases) {
      expect(detectDialect(c.source), `${c.id}: ${c.source}`).toBe('formula')
    }
  })
})

describe('the tie-break is DOCUMENTED, not accidental', () => {
  // ⭐ A PLANTED AMBIGUOUS SNIPPET. `//@version` is a machine-readable pragma no
  // thinkScript file carries, so Pine wins over a `def`/`plot ` line; and a
  // thinkScript statement wins over PCF letters, because PCF has no `;`
  // statements at all. Both orders are asserted so a reordering of the marker
  // list is a red test rather than a silent reclassification.
  it('a file carrying BOTH a Pine pragma and thinkScript statements reads as pine', () => {
    expect(detectDialect('//@version=5\ndeclare lower;\ndef x = close;\nplot y = x;\n')).toBe('pine')
    // ⭐ AND IT IS NOT ONLY A PLANTED CASE: `pine/03-rsi-directional-momentum-
    // scanner.pine` writes the phrase `crosses above` in its own prose, which is
    // a thinkScript reserved phrase. Check thinkScript first and a real published
    // Pine script is handed to the thinkScript translator (measured, W3.1).
  })
  it('a thinkScript statement beats PCF letters', () => {
    expect(detectDialect('def AVGC50 = Average(close, 50);\nplot scan = close > AVGC50;\n')).toBe('thinkscript')
  })
  it('`// @version` WITH A SPACE is Pine — two published community scripts write it', () => {
    expect(detectDialect('// @version=4\nstudy("x")\nplot(close)\n')).toBe('pine')
    // ⭐ THE SECOND SNIPPET IS THE ONE THAT BINDS THE SPACE, and the first one is
    // why it had to be measured rather than assumed. All 51 committed Pine
    // scripts — including `pine_community/22` and `/23`, the two that write
    // `// @version` with a space — ALSO carry an `indicator(`/`study(`
    // declaration, so a whole script is caught by the second marker whatever the
    // pragma looks like: with a strict `//@version` the line above stays green
    // (W3.1 mutation harness, 2026-08-25). A pasted FRAGMENT carries no
    // declaration line, so there the spaced pragma is the only Pine marker there
    // is — and under a strict regex this falls through to `pcf` on its bare `=`.
    expect(detectDialect('// @version=4\nsrc = close\nplot(src)\n')).toBe('pine')
  })
  it('empty and rubbish fall to formula, never to a translator', () => {
    // ⚠️ THIS IS THE FLOOR CONTRACT, NOT A TIE-BREAK, and it is honest about what
    // it binds: `pcf.js::detectDialect` carries the same empty/non-string guard
    // and answers `native` for all three, which `READER_NAME` already maps to
    // `formula` — so deleting the local guard leaves this green (measured, W3.1
    // mutation harness). The guard stays because this module's documented answer
    // for empty input must not depend on another module's defensive behaviour;
    // the assertion stays because the answer callers rely on is `formula`.
    expect(detectDialect('')).toBe('formula')
    expect(detectDialect(null)).toBe('formula')
    expect(detectDialect('   ')).toBe('formula')
  })
})

describe('`DIALECTS` is the precedence, not a bag of names', () => {
  // ⛔ THE MODULE HEADER SAYS "ORDER IS THE WHOLE GRAMMAR", SO THE ORDER MUST BE
  // ABLE TO FAIL. Every other assertion in this file either sorts `DIALECTS` or
  // ignores it, so reversing the array left all of them green — a declared
  // contract with no rail under it. This reads the precedence OUT OF THE ANSWERS:
  // for each planted source carrying two dialects' markers, the winner must be
  // whichever of the two `DIALECTS` lists FIRST. Reorder the array and the
  // expected winner moves while `detectDialect` does not, so this reds.
  it('a source carrying two dialects resolves to whichever DIALECTS lists first', () => {
    expect([...DIALECTS]).toEqual(['pine', 'thinkscript', 'pcf', 'formula'])
    const AMBIGUOUS = [
      ['//@version=5\ndeclare lower;\ndef x = close;\nplot y = x;\n', 'pine', 'thinkscript'],
      ['def AVGC50 = Average(close, 50);\nplot scan = close > AVGC50;\n', 'thinkscript', 'pcf'],
      ['// @version=4\nsrc = close\nplot(src)\n', 'pine', 'pcf'],
    ]
    for (const [src, a, b] of AMBIGUOUS) {
      const ia = DIALECTS.indexOf(a)
      const ib = DIALECTS.indexOf(b)
      expect(Math.min(ia, ib), `${a}/${b} must both be named in DIALECTS`).toBeGreaterThanOrEqual(0)
      expect(detectDialect(src), `${JSON.stringify(src)} carries ${a} + ${b}`).toBe(DIALECTS[Math.min(ia, ib)])
    }
  })
})

describe('the reader names are one map, not a second authority', () => {
  it('every dialect this module names has a reader name', () => {
    expect(Object.keys(READER_NAME).sort()).toEqual([...DIALECTS].sort())
    expect(READER_NAME.formula).toBe('native')
    expect(READER_NAME.pcf).toBe('pcf')
  })
})
