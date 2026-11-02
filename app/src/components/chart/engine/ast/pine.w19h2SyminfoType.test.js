// app/src/components/chart/engine/ast/pine.w19h2SyminfoType.test.js
//
// ─── W19-H2 — `syminfo.type`, served ONLY as the answer to a decidable comparison ──
//
// Integrator ruling 2026-10-05 (owner delegated), recorded in
// `symbolScope.json::type_decidable`: for a symbol whose exchange has a `confirmed`
// entry (a US exchange listing), `syminfo.type == L` is false and `!= L` true for
// every `L` in `never_on_a_confirmed_exchange` (forex, crypto, cfd, futures, index,
// economic, spread). Witnessed on every US listing the roster measured
// (`syminfo-roster-*-1d-2026-09-30`: AAPL / BRK.B / F `stock`, SPY a non-stock).
// ⛔ Anything needing the VALUE stays refused by name with `unserved.type`'s sentence.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { parseFormula } from './parse.js'
import { bindingConstants, foldScalar, NotFoldable, SYMBOL_EXCHANGE_CONFIRMED, SYMBOL_TYPE_NEVER_LISTED } from './bind.js'
import { loadPineLibraryStore } from './__tests__/pineLibraryStoreLoader.js'
import SYMBOL_SCOPE from './symbolScope.json'

const REPO = path.resolve(process.cwd(), '..')
const v6 = (body) => `//@version=6\nindicator("x")\n${body}\n`
const tr = (src) => translatePine(src, { strict: true })
const formulaOf = (src) => { const t = tr(src); expect(t.refusal, src).toBeFalsy(); return t.outputs[0].formula }
const foldFor = (formula, symbol) => foldScalar(parseFormula(formula).ast, bindingConstants({ symbol }))

const US = { ticker: 'SPY', exchange: 'NYSE Arca' }
const UNKNOWN = { ticker: 'XYZ', exchange: 'Some Free Text Exchange' }

describe('⭐ W19-H2 — decidable `syminfo.type` comparisons fold on a confirmed exchange', () => {
  it('the ruling\'s roster is the data the door reads, and every confirmed exchange is a listing', () => {
    expect([...SYMBOL_TYPE_NEVER_LISTED].sort()).toEqual(['cfd', 'crypto', 'economic', 'forex', 'futures', 'index', 'spread'])
    expect(Object.keys(SYMBOL_EXCHANGE_CONFIRMED)).toContain('NYSE Arca')
  })

  it('`== L` is 0 and `!= L` is 1 for every never-listed type, either operand order', () => {
    for (const lit of SYMBOL_TYPE_NEVER_LISTED) {
      expect(foldFor(formulaOf(v6(`plot(syminfo.type == "${lit}" ? 1 : 0)`)), US)).toBe(0)
      expect(foldFor(formulaOf(v6(`plot("${lit}" == syminfo.type ? 1 : 0)`)), US)).toBe(0)
      expect(foldFor(formulaOf(v6(`plot(syminfo.type != "${lit}" ? 1 : 0)`)), US)).toBe(1)
    }
  })

  it('⛔ an exchange that is not confirmed stops the fold, naming the type and its reason', () => {
    const f = formulaOf(v6('plot(syminfo.type == "forex" ? 1 : 0)'))
    expect(() => foldFor(f, UNKNOWN)).toThrow(NotFoldable)
    expect(() => foldFor(f, UNKNOWN)).toThrow(/syminfo\.type/)
    expect(() => foldFor(f, { ticker: 'SPY' })).toThrow(NotFoldable)
  })

  it('⛔ anything needing the VALUE keeps `unserved.type`\'s sentence at the door', () => {
    const why = SYMBOL_SCOPE.unserved.type
    for (const body of ['plot(syminfo.type == "stock" ? 1 : 0)', 'plot(syminfo.type == "fund" ? 1 : 0)',
      'plot(syminfo.type == "dr" ? 1 : 0)', 'plot(str.length(syminfo.type))',
      't = syminfo.type\nplot(t == "forex" ? 1 : 0)']) {
      const t = tr(v6(body))
      expect(t.refusal, body).toBeTruthy()
      expect(t.refusal.message, body).toContain(why.slice(0, 60))
    }
  })
})

// ⛔ Third-party library source is never committed: this half runs only with the
// opt-in store loaded (`PINE_LIBRARY_STORE=<scratch dir>`, the census's L1 loader).
const STORE = process.env.PINE_LIBRARY_STORE
const HAVE_STORE = !!(STORE && fs.existsSync(STORE))

describe.skipIf(!HAVE_STORE)('⭐ W19-H2 — atr-stop-loss-indicator (ZenLibrary/9) translates on the host lane', () => {
  beforeAll(() => { loadPineLibraryStore(STORE) })

  it('every output translates, and the pip factor folds to the bare tick on a confirmed exchange', () => {
    const src = fs.readFileSync(path.join(REPO, 'corpus/committed/atr-stop-loss-indicator__LOfv1FvRhL.pine'), 'utf8')
    const t = tr(src)
    expect(t.refusal).toBeFalsy()
    expect(t.outputs.length).toBe(5)
    const f = t.outputs[0].formula
    expect(f).toMatch(/listing_kind/)
    // ZenLibrary's getPipSize: mintick * (forex/crypto/cfd ? 10 : 1) -> mintick on a US listing.
    const pip = parseFormula("text_tonumber(syminfo('mintick')) * (1 == 1 && (text_ne(syminfo('listing_kind'), 'exchange-listing') || text_ne(syminfo('listing_kind'), 'exchange-listing')) ? 10 : 1)").ast
    expect(foldScalar(pip, bindingConstants({ symbol: US }))).toBeCloseTo(0.01, 12)
  })
})
