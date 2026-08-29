// app/src/components/chart/engine/ast/foreignLanguage.test.js

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { foreignLanguage, foreignRefusal, FOREIGN_LANGUAGES } from './foreignLanguage.js'
import { detectDialect } from './dialect.js'

const ROOT = path.resolve(process.cwd(), '..')
const readAll = (dir, ext) => fs.readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith(ext))
  .map((f) => ({ name: f, source: fs.readFileSync(path.join(ROOT, dir, f), 'utf8') }))

const SAMPLES = {
  'MetaTrader (MQL4/MQL5)':
    'int OnInit() { return(INIT_SUCCEEDED); }\n'
    + 'double MA = iMA(NULL, 0, 14, 0, MODE_SMA, PRICE_CLOSE, 0);\n',
  'EasyLanguage (TradeStation / MultiCharts)':
    'Inputs: Length(14);\nVars: Avg(0);\n'
    + 'Avg = Average(Close, Length);\nIf Close > Avg Then Buy Next Bar at Market;\n',
  'NinjaScript (NinjaTrader)':
    'protected override void OnBarUpdate() {\n  if (CurrentBar < 20) return;\n'
    + '  Value[0] = SMA(Close, 20)[0];\n}\n',
  Python:
    "import pandas as pd\ndef signal(df):\n    return df['close'] > df['close'].rolling(50).mean()\n",
}

describe('a language we cannot read is NAMED, not mistaken for one we can', () => {
  it('⛔⛔ THE DEFECT THIS EXISTS FOR — measured, and it was confidently wrong', () => {
    // ⚰️ `detectDialect` answers `pcf` for every one of these C-like programs,
    // because TC2000's markers are loose BY NATURE: uppercase identifiers and
    // comparisons, which every such language has. Python answers `thinkscript`.
    // A member pasting MetaTrader was told TC2000 could not parse it, and a member
    // pasting Python that "thinkorswim has no character like this one" — a sentence
    // false about the very text they submitted, at the first moment of contact.
    // This case pins the WRONG behaviour so the fix cannot be quietly reverted into
    // it, and so nobody mistakes the detector for the thing that identifies these.
    const guesses = Object.values(SAMPLES).map((s) => detectDialect(s))
    expect(guesses.every((g) => ['pcf', 'thinkscript'].includes(g)),
      'the detector no longer mis-detects these — this note is stale').toBe(true)
  })

  it('⭐⭐ each one is identified by name', () => {
    for (const [name, src] of Object.entries(SAMPLES)) {
      const found = foreignLanguage(src)
      expect(found, `${name} was not recognised`).toBeTruthy()
      expect(found.name).toBe(name)
    }
  })

  it('⛔ TWO markers are required — one is a coincidence', () => {
    // ⭐ THE RULE THAT KEEPS THIS HONEST. `import` appears in a Pine comment and
    // `Buy` in a thinkScript label; a single-marker match is exactly how the
    // detector this sits beside went wrong.
    expect(foreignLanguage('// we import this from somewhere')).toBe(null)
    expect(foreignLanguage('plot Buy = close > open;')).toBe(null)
    expect(foreignLanguage('def signal(df):')).toBe(null)
  })

  it('⛔⛔ NOT ONE committed corpus script is called foreign', () => {
    // ⚰️ THE FALSE-POSITIVE DIRECTION IS THE DANGEROUS ONE. Naming a Pine script
    // "MetaTrader" and refusing it would take a working import away from a member,
    // and it would look like a considered answer. Every script we DO read is
    // checked, not a sample.
    const all = [
      ...readAll('tests/fixtures/pine', '.pine'),
      ...readAll('tests/fixtures/pine_community', '.pine'),
      ...readAll('tests/fixtures/thinkscript', '.ts'),
    ]
    expect(all.length).toBeGreaterThan(70)
    const misnamed = all
      .map((s) => ({ name: s.name, found: foreignLanguage(s.source) }))
      .filter((r) => r.found)
      .map((r) => `${r.name} → ${r.found.name}`)
    expect(misnamed, `these are scripts we READ, called foreign:\n${misnamed.join('\n')}`)
      .toEqual([])
  })

  it('⛔ a bare native formula is never a program', () => {
    for (const f of ['close > 10', 'sma(close, 50) > sma(close, 200)',
      'rsi(close, 14) < 30', 'C > 10 AND V > AVGV50']) {
      expect(foreignLanguage(f), f).toBe(null)
    }
  })

  it('⭐ the sentence names the language AND the two doors that need no translator', () => {
    // ⛔ A REFUSAL WHOSE ONLY CONTENT IS "NO" IS A WALL. These two doors genuinely
    // do not need a per-language translator, so they are the honest next step.
    const msg = foreignRefusal(foreignLanguage(SAMPLES.Python))
    expect(msg).toMatch(/Python/)
    expect(msg).toMatch(/English/i)
    expect(msg).toMatch(/screenshot/i)
  })

  it('⛔ nothing recognised returns null, and null refuses nothing', () => {
    expect(foreignLanguage('')).toBe(null)
    expect(foreignLanguage(null)).toBe(null)
    expect(foreignRefusal(null)).toBe(null)
    expect(FOREIGN_LANGUAGES.length).toBeGreaterThanOrEqual(5)
  })
})
