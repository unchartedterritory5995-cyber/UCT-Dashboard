// ─── ⭐⭐ RS RATING L3 — `syminfo.industry` / `syminfo.sector`, held to their witness table ──
//
// `symbolScope.json::classification` serves TradingView's own string for a symbol only where a
// capture witnesses it, keyed by a property of OUR data that predicts it: the instrument class
// (`Stock` / `ADR` / `ETF`, `screener_universe.types()`) first, then our own string. With no
// witnessed row and a string in our store, OUR string is served, TAGGED SUBSTITUTED; with no
// string at all the field stays unsettled and refuses by name. Q-RS4 is queued, so the production
// table ships EMPTY; these rails inject rows (`classificationWith`'s table parameter) to drive the
// serving path, and hold the empty production table to the substitution and refusal paths
// (`lesson_built_tested_green_and_unreachable`).
import { describe, it, expect } from 'vitest'
import SYMBOL_SCOPE from './symbolScope.json'
import {
  classificationTable, classificationWith, SYMBOL_CLASSIFICATION, CLASSIFICATION_FIELD_NAMES,
  CLASSIFICATION_SOURCE, symbolConstants, symbolConstantsWith, symbolSubstitutions, foldText, foldScalar,
  NotFoldable, SYMBOL_EXCHANGE_CONFIRMED, SYMBOL_TICK_SIZE, SYMBOL_LISTING_FIELDS, SYMBOL_MIN_CONTRACT,
} from './bind'
import { BUILTIN_SYMBOL_SCOPED, translatePine } from './pine'

const ROW = Object.freeze({ value: 'Investment Trusts/Mutual Funds', witnesses: ['AMEX:SPY', 'NASDAQ:QQQ'],
  captures: ['tests/fixtures/vendor/q-rs4-spy.json'], captured: '2026-11-20', how: 'Q-RS4 label text' })
const raw = (industry = {}, sector = {}) => ({
  _: 'prose',
  industry: { by_class: industry.by_class || {}, by_ours: industry.by_ours || {} },
  sector: { by_class: sector.by_class || {}, by_ours: sector.by_ours || {} },
})
const TAG = (name) => ({ name: `syminfo.${name}`, source: 'uct:ticker_meta', vendorValueFrom: `capture.symbol.${name}` })
const SPY = Object.freeze({ ticker: 'SPY', exchange: 'NYSE Arca', securityType: 'ETF',
  industry: 'Asset Management', sector: 'Financial Services' })
const NVDA = Object.freeze({ ticker: 'NVDA', exchange: 'NASDAQ', securityType: 'Stock',
  industry: 'Semiconductors', sector: 'Technology' })

describe('L3 — the production table ships empty, by its own statement', () => {
  it('classification has a table per field and serves no row until Q-RS4 lands', () => {
    expect([...CLASSIFICATION_FIELD_NAMES]).toEqual(['industry', 'sector'])
    for (const f of CLASSIFICATION_FIELD_NAMES) {
      const served = SYMBOL_CLASSIFICATION[f]
      const file = SYMBOL_SCOPE.classification[f]
      const rows = (o) => Object.keys(o || {}).filter((k) => !k.startsWith('_')).sort()
      expect(Object.keys(served.byClass).sort()).toEqual(rows(file.by_class))
      expect(Object.keys(served.byOurs).sort()).toEqual(rows(file.by_ours))
    }
    const total = CLASSIFICATION_FIELD_NAMES.reduce((n, f) => n
      + Object.keys(SYMBOL_CLASSIFICATION[f].byClass).length + Object.keys(SYMBOL_CLASSIFICATION[f].byOurs).length, 0)
    if (total === 0) expect(SYMBOL_SCOPE.classification._not_served).toMatch(/NO ROW IS SERVED YET/)
    expect(SYMBOL_SCOPE.classification._the_probe_that_settles_it).toContain('rs-syminfo-industry.pine')
    expect(CLASSIFICATION_SOURCE).toBe('uct:ticker_meta')
  })
})

describe('L3 — the loader: a row missing any field serves nothing', () => {
  it('a complete row serves its value', () => {
    const t = classificationTable(raw({ by_class: { ETF: ROW } }))
    expect(t.industry.byClass).toEqual({ ETF: 'Investment Trusts/Mutual Funds' })
    expect(t.sector.byClass).toEqual({})
  })
  for (const drop of ['value', 'witnesses', 'captures', 'captured', 'how']) {
    it(`no \`${drop}\` => no row`, () => {
      const { [drop]: _gone, ...rest } = ROW
      expect(classificationTable(raw({ by_class: { ETF: rest } })).industry.byClass).toEqual({})
    })
  }
  for (const [what, v] of [['empty witnesses', { witnesses: [] }], ['empty captures', { captures: [] }],
    ['an empty value', { value: '' }], ['a number value', { value: 1 }], ['an empty how', { how: '' }]]) {
    it(`${what} => no row`, () => {
      expect(classificationTable(raw({ by_ours: { X: { ...ROW, ...v } } })).industry.byOurs).toEqual({})
    })
  }
  it('an underscore key is commentary, never a row; a missing section serves nothing', () => {
    expect(classificationTable(raw({ by_class: { _x: ROW } })).industry.byClass).toEqual({})
    expect(classificationTable(undefined)).toEqual({ industry: { byClass: {}, byOurs: {} }, sector: { byClass: {}, byOurs: {} } })
  })
})

describe('L3 — the fold: witnessed, substituted, or refused', () => {
  const injected = classificationTable(raw(
    { by_class: { ETF: ROW }, by_ours: { Semiconductors: { ...ROW, value: 'Semiconductors (FactSet)', witnesses: ['NASDAQ:NVDA'] } } },
    { by_ours: { Technology: { ...ROW, value: 'Electronic Technology', witnesses: ['NASDAQ:NVDA'] } } },
  ))

  it('⭐ a witnessed CLASS row serves TradingView\'s string, untagged, whatever our string says', () => {
    const r = classificationWith(injected, SPY)
    expect(r.values['syminfo.industry']).toBe('Investment Trusts/Mutual Funds')
    expect(r.substituted.map((s) => s.name)).toEqual(['syminfo.sector'])
    expect(r.values['syminfo.sector']).toBe('Financial Services')
  })
  it('⭐ a witnessed OUR-STRING row serves TradingView\'s string, untagged', () => {
    const r = classificationWith(injected, NVDA)
    expect(r.values).toEqual({ 'syminfo.industry': 'Semiconductors (FactSet)', 'syminfo.sector': 'Electronic Technology' })
    expect(r.substituted).toEqual([])
  })
  it('the class row wins over an our-string row (an ETF our store files under a stock industry)', () => {
    const r = classificationWith(injected, { ...SPY, industry: 'Semiconductors' })
    expect(r.values['syminfo.industry']).toBe('Investment Trusts/Mutual Funds')
  })
  it('⭐ no witnessed row: OUR string, tagged with the exact L7 contract', () => {
    const r = classificationWith(injected, { ...NVDA, industry: 'Software - Infrastructure' })
    expect(r.values['syminfo.industry']).toBe('Software - Infrastructure')
    expect(r.substituted).toEqual([TAG('industry')])
  })
  it('⛔ no string in our store: nothing served, nothing tagged (no default)', () => {
    for (const s of [{ ticker: 'X' }, { ticker: 'X', industry: '', sector: '  ' }, { ticker: 'X', industry: null }]) {
      const r = classificationWith(injected, s)
      expect(r.values).toEqual({})
      expect(r.substituted).toEqual([])
    }
    // ⛔ CONTROL: a class row still answers a symbol our store gave no string — the ETF case
    expect(classificationWith(injected, { ticker: 'IWM', securityType: 'ETF' }).values)
      .toEqual({ 'syminfo.industry': 'Investment Trusts/Mutual Funds' })
  })
  it('the empty production table substitutes every string our store holds', () => {
    const r = classificationWith(SYMBOL_CLASSIFICATION, NVDA)
    expect(r.values).toEqual({ 'syminfo.industry': 'Semiconductors', 'syminfo.sector': 'Technology' })
    expect(r.substituted).toEqual([TAG('industry'), TAG('sector')])
  })
  it('a malformed row falls through to substitution, it never serves', () => {
    const { captures: _c, ...noCaptures } = ROW
    const t = classificationTable(raw({ by_class: { ETF: noCaptures } }))
    expect(classificationWith(t, SPY).substituted.map((s) => s.name)).toContain('syminfo.industry')
  })
})

describe('L3 — one authority: symbolConstants carries the fold, symbolSubstitutions its tag', () => {
  it('symbolConstantsWith takes the table as its sixth parameter', () => {
    const injected = classificationTable(raw({ by_class: { ETF: ROW } }))
    const c = symbolConstantsWith(SYMBOL_EXCHANGE_CONFIRMED, SPY, SYMBOL_TICK_SIZE, SYMBOL_LISTING_FIELDS,
      SYMBOL_MIN_CONTRACT, injected)
    expect(c['syminfo.industry']).toBe('Investment Trusts/Mutual Funds')
    expect(c['syminfo.prefix']).toBe('AMEX') // control: the other witness tables are untouched
  })
  it('production: our strings serve and are tagged; a symbol with none settles nothing', () => {
    const c = symbolConstants(NVDA)
    expect(c['syminfo.industry']).toBe('Semiconductors')
    expect(symbolSubstitutions(NVDA)).toEqual([TAG('industry'), TAG('sector')])
    expect(symbolSubstitutions({ ticker: 'X' })).toEqual([])
    expect(symbolSubstitutions(null)).toEqual([])
    // no ticker, no binding: nothing settles and nothing is tagged
    expect(symbolSubstitutions({ industry: 'Semiconductors' })).toEqual([])
    expect(symbolConstants({ industry: 'Semiconductors' })).toEqual({})
  })
  it('⛔ an unsettled field stops the fold BY NAME with the measurement reason', () => {
    let caught = null
    try { foldText({ type: 'symtext', name: 'industry' }, symbolConstants({ ticker: 'X' })) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(NotFoldable)
    expect(caught.what).toMatch(/^syminfo\.industry — /)
    expect(caught.what).toContain('nothing is guessed')
  })
  it('`syminfo.industry == "..."` folds to 1 and 0 over the binding', () => {
    const tree = (s) => ({ type: 'textop', name: 'eq', args: [{ type: 'symtext', name: 'industry' }, { type: 'str', value: s }] })
    expect(foldScalar(tree('Semiconductors'), symbolConstants(NVDA))).toBe(1)
    expect(foldScalar(tree('Investment Trusts/Mutual Funds'), symbolConstants(NVDA))).toBe(0)
  })
})

describe('L3 — the door resolves both names (no more "the engine grammar does not hold")', () => {
  it('both are symbol-scoped text names', () => {
    expect(BUILTIN_SYMBOL_SCOPED['syminfo.industry']).toBe('industry')
    expect(BUILTIN_SYMBOL_SCOPED['syminfo.sector']).toBe('sector')
  })
  it('the micro script translates', () => {
    // ⚠️ `plot(close)` beside it: a script whose every column is constant on every bar refuses
    // `pine:constant-only` (any bind-time text test, `syminfo.ticker` included), so the
    // series plot keeps this about the NAME.
    const r = translatePine("//@version=5\nindicator('m')\nplot(syminfo.industry == 'X' ? 1 : 0)\nplot(syminfo.sector == 'Y' ? 1 : 0)\nplot(close)\n")
    expect(r.refusal, r.refusal && r.refusal.what).toBe(null)
    expect(r.refusals || []).toEqual([])
    // ⛔ CONTROL: the same shape over an unruled sibling still gets the grammar's shrug, so the
    // pass above is the name's, not the shape's
    for (const name of ['syminfo.industry', 'syminfo.employees']) {
      const one = translatePine(`//@version=5\nindicator('m')\nplot(${name} == 'X' ? close : open)\n`)
      expect(one.refusal && one.refusal.guard, name).toBe(name === 'syminfo.employees' ? 'pine:builtin' : null)
    }
  })
})
