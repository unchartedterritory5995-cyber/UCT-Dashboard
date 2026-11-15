// ─── ⭐⭐ RS RATING L3 — the micro script on BOTH lanes, with an injected witness row ─────
//
// `plot(syminfo.industry == '...' ? 1 : 0)` (beside `plot(close)`, so the script is not
// `pine:constant-only`) drawn by the HOST lane (`memberPaneDefinition` -> `computeFor`) and the
// RUNTIME lane (`computeRuntimeColumns`, the bar-by-bar run). The production witness table is
// empty until Q-RS4 lands, so this file serves the manifest with ONE injected row per kind
// (a class row for ETFs, an our-string row for one stock industry) and shows the three outcomes
// on each lane:
//   1. a witnessed row  -> TradingView's string, and no substitution tag;
//   2. no row, our data -> OUR string, tagged substituted, and the door note says so;
//   3. no data at all   -> refused by name.
import { describe, it, expect, vi } from 'vitest'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors } from '../nativeRegistry'
import { computeRuntimeColumns } from '../runtime/runtimeColumns'
import { SYMBOL_CLASSIFICATION, symbolSubstitutions } from '../ast/bind'
import { substitutedFor, classificationReadsOf } from '../ast/symbolSubstitution'

const FUND = 'Investment Trusts/Mutual Funds'
vi.mock('../ast/symbolScope.json', async (importOriginal) => {
  const real = (await importOriginal()).default
  const row = (value, witnesses) => ({ value, witnesses, captures: ['tests/fixtures/vendor/injected-q-rs4.json'],
    captured: '2026-11-15', how: 'INJECTED BY classificationLanes.test.js (not a capture)' })
  return {
    default: {
      ...real,
      classification: {
        ...real.classification,
        industry: {
          by_class: { ETF: row('Investment Trusts/Mutual Funds', ['AMEX:SPY']) },
          by_ours: { Semiconductors: row('Semiconductors (TV)', ['NASDAQ:NVDA']) },
        },
        sector: { by_class: {}, by_ours: {} },
      },
    },
  }
})

const script = (s) => `//@version=5\nindicator('l3 micro')\nplot(syminfo.industry == '${s}' ? 1 : 0)\nplot(close)\n`
const BARS = Array.from({ length: 60 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 101, l: 99, c: 100 + i, v: 1000 }))
const ctxOf = (symbol) => ({ tf: 'D', symbol, newestBarIsForming: false, historyFromListing: true })

function host(source, symbol) {
  const built = memberPaneDefinition({ source })
  expect(built.ok, built.reason).toBe(true)
  const cols = computeFor(built.definition, BARS, {}, ctxOf(symbol))
  const err = (columnErrors(cols) || {}).value
  return { last: cols.value ? cols.value[cols.value.length - 1] : undefined, err, notes: built.notes }
}
function runtime(source, symbol) {
  const doc = { id: 'rt-l3', meta: { runtimeHistory: 'listing' },
    compute: { kind: 'runtime', fn: 'runtime:rt-l3', outputs: { a: 0, b: 1 }, source } }
  let t = 0
  try {
    const cols = computeRuntimeColumns(doc, BARS, ctxOf(symbol), { incremental: false, budgetMs: 1e9, now: () => (t += 1) })
    return { last: cols.a[cols.a.length - 1], err: (columnErrors(cols) || {}).a }
  } catch (e) {
    return { last: undefined, err: e }
  }
}
const LANES = { host, runtime }

const SPY = { ticker: 'SPY', exchange: 'NYSE Arca', securityType: 'ETF', industry: 'Asset Management' }
const NVDA = { ticker: 'NVDA', exchange: 'NASDAQ', securityType: 'Stock', industry: 'Semiconductors' }
const MSFT = { ticker: 'MSFT', exchange: 'NASDAQ', securityType: 'Stock', industry: 'Software - Infrastructure' }
const BARE = { ticker: 'ZZZZ', exchange: 'NASDAQ' }

describe('L3 lanes — the injected table is the one the engine reads (non-vacuity)', () => {
  it('both injected rows are served', () => {
    expect(SYMBOL_CLASSIFICATION.industry.byClass).toEqual({ ETF: FUND })
    expect(SYMBOL_CLASSIFICATION.industry.byOurs).toEqual({ Semiconductors: 'Semiconductors (TV)' })
  })
})

for (const [lane, run] of Object.entries(LANES)) {
  describe(`L3 lanes — ${lane}`, () => {
    it('1. a witnessed CLASS row folds to TradingView\'s string, untagged', () => {
      expect(run(script(FUND), SPY).last).toBe(1)
      expect(run(script('Asset Management'), SPY).last).toBe(0) // our string is NOT what was served
      expect(substitutedFor(script(FUND), SPY)).toEqual([])
    })
    it('1. a witnessed OUR-STRING row folds to TradingView\'s string, untagged', () => {
      expect(run(script('Semiconductors (TV)'), NVDA).last).toBe(1)
      expect(run(script('Semiconductors'), NVDA).last).toBe(0)
      expect(substitutedFor(script('x'), NVDA)).toEqual([])
    })
    it('2. no witnessed row: OUR string, tagged substituted', () => {
      expect(run(script('Software - Infrastructure'), MSFT).last).toBe(1)
      expect(run(script(FUND), MSFT).last).toBe(0)
      expect(substitutedFor(script('x'), MSFT)).toEqual([
        { name: 'syminfo.industry', source: 'uct:ticker_meta', vendorValueFrom: 'capture.symbol.industry' }])
    })
    it('3. no data at all: refused by name, nothing drawn', () => {
      const r = run(script(FUND), BARE)
      expect(r.last).toBeUndefined()
      expect(r.err && r.err.guard).toBe('interpret:bind-time-text')
      expect(String(r.err && r.err.message)).toContain('syminfo.industry')
      expect(symbolSubstitutions(BARE)).toEqual([])
    })
  })
}

describe('L3 lanes — the member door discloses the substitution by name', () => {
  it('a script reading syminfo.industry carries the note; one that only mentions it in a comment does not', () => {
    const { notes } = host(script('x'), MSFT)
    const n = notes.find((x) => x.name === 'syminfo.industry')
    expect(n && n.note).toContain('uses UCT data')
    expect(n.note).toContain("TradingView's classification may differ")
    const quiet = memberPaneDefinition({ source: "//@version=5\nindicator('q')\n// syminfo.industry\nplot(close, title = 'syminfo.sector')\n" })
    expect(quiet.ok).toBe(true)
    expect(quiet.notes.filter((x) => String(x.name).startsWith('syminfo.'))).toEqual([])
    expect(classificationReadsOf("// syminfo.industry\nx = 'syminfo.sector'\n")).toEqual([])
  })
  it('the note rides on the saved document (meta.disclosures)', () => {
    const built = memberPaneDefinition({ source: script('x') })
    expect(built.definition.meta.disclosures.map((d) => d.name)).toContain('syminfo.industry')
  })
})
