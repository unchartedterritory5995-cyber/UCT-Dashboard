// TOP 10 FLOW PICKS — extraction parity + the behaviours that must not drift.
//
// `buildTopPickCandidates` was lifted VERBATIM out of OptionsFlow.jsx so the same
// computation can eventually run once on the server instead of once per member.
// It is the only first-paint reader of `all_directional` (5.01 MB / 12,893 rows)
// and `all_trades` (11.43 MB / 29,514 rows) — ~16.4 MB shipped to produce ten
// rows.
//
// `__fixtures__/topPicksReference.js` is the SAME block generated from the
// PRE-extraction source in git. Comparing against it is what proves the move
// changed nothing: a wrong boundary, a dropped line or a mis-scoped closure
// shows up as a diff on real data rather than as a silent ranking change in
// production.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseCSV, processFlowData, capBand, buildTopPickCandidates } from './flowCompute'
import { referenceTopPicks } from './__fixtures__/topPicksReference'

const HERE = dirname(fileURLToPath(import.meta.url))
// The tracked production-shaped tape. NOT __fixtures__/flow-sample.csv:
// that sample's contracts have all expired, and processFlowData drops expired
// contracts, so every parity assertion below passed over EMPTY arrays. The
// controls caught it; they are what keeps this suite honest as data ages.
const CSV = resolve(HERE, '../../../public/flow-data.csv')

const DATA_MODES = ['stocks', 'index']
const CAP_FILTERS = ['All', 'Mega', 'Large', 'Mid-Small']

// The page's own classifier, minus the runtime-fetched remote set (which the
// fixture cannot supply). Deliberately simple and DECLARED: the real predicate
// closes over remoteETFSet, and that difference is exactly why isEtfFn is a
// parameter rather than a table.
const isEtfFn = (sym, stocketf) => {
  const st = (stocketf || '').toUpperCase()
  return st === 'ETF' || st === 'INDEX'
}

let D
function dataset() {
  if (!D) D = processFlowData(parseCSV(readFileSync(CSV, 'utf8')), null)
  return D
}

function run(fn, dataMode, capFilter, includeStandout = false) {
  const d = dataset()
  return fn(d.all_directional, d.all_trades, { dataMode, capFilter, isEtfFn, includeStandout })
}

describe('extraction parity — new vs the pre-extraction original, on real data', () => {
  for (const dataMode of DATA_MODES) {
    for (const capFilter of CAP_FILTERS) {
      it(`${dataMode} × ${capFilter} is identical to the original`, () => {
        const now = run(buildTopPickCandidates, dataMode, capFilter)
        const ref = run(referenceTopPicks, dataMode, capFilter)
        // Deep equality over the WHOLE result, not just the top ten: ordering,
        // scores, tie-breaks, nested contracts and _moreStrikes all included.
        expect(now.candidates).toEqual(ref.candidates)
        expect(now.ad.length).toBe(ref.ad.length)
        expect(now.standoutCandidates).toEqual(ref.standoutCandidates)
      })
    }
  }

  it('Standout mode is identical too (the lazily-built contract-level path)', () => {
    for (const dataMode of DATA_MODES) {
      for (const capFilter of CAP_FILTERS) {
        const now = run(buildTopPickCandidates, dataMode, capFilter, true)
        const ref = run(referenceTopPicks, dataMode, capFilter, true)
        expect(now.standoutCandidates).toEqual(ref.standoutCandidates)
      }
    }
  })

  it('CONTROL: the tape actually exercises the code', () => {
    // ⛔ THIS IS THE LOAD-BEARING TEST OF THIS FILE. Every parity assertion above
    // compares two results; if both are empty they are trivially equal and the
    // suite is green while proving nothing. processFlowData drops EXPIRED
    // contracts, so a tape ages into producing zero candidates. If this fails,
    // the parity results above are void — refresh public/flow-data.csv with a
    // current day's tape rather than relaxing the thresholds.
    const d = dataset()
    const msg = 'flow-data.csv has aged out (expired contracts) — parity above is VACUOUS'
    expect(d.all_directional.length, msg).toBeGreaterThan(100)
    expect(d.all_trades.length, msg).toBeGreaterThan(100)
    const r = run(buildTopPickCandidates, 'stocks', 'All')
    expect(r.ad.length, msg).toBeGreaterThan(50)
    expect(r.candidates.length, msg).toBeGreaterThan(0)
  })

  it('CONTROL: the two implementations can actually disagree', () => {
    // Proves the comparison is not vacuously true of any two functions — a
    // deliberately different input must produce a different answer.
    const a = run(buildTopPickCandidates, 'stocks', 'All')
    const b = run(referenceTopPicks, 'stocks', 'Mega')
    expect(a.candidates).not.toEqual(b.candidates)
  })
})

describe('determinism', () => {
  it('repeated runs over the same rows produce identical output', () => {
    const a = run(buildTopPickCandidates, 'stocks', 'All')
    const b = run(buildTopPickCandidates, 'stocks', 'All')
    expect(a.candidates).toEqual(b.candidates)
  })

  it('ordering is stable and by descending net, with score as the tie-break', () => {
    const { candidates } = run(buildTopPickCandidates, 'stocks', 'All')
    for (let i = 1; i < candidates.length; i++) {
      const prev = candidates[i - 1], cur = candidates[i]
      expect(prev.net).toBeGreaterThanOrEqual(cur.net)
      if (prev.net === cur.net) expect(prev.score).toBeGreaterThanOrEqual(cur.score)
    }
  })
})

// ── The behaviour that made this extraction delicate ────────────────────────
describe('⛔ filter-then-aggregate — NOT aggregate-then-filter', () => {
  // `ad` filters ROWS by capBand(t.mktcap) BEFORE tkMap accumulates, while tkMap
  // separately UPGRADES a ticker's mktcap when a real value appears. A ticker
  // with a mix of gap-fill (mktcap=0 -> "Unknown") and real rows therefore lands
  // in a different band depending on which happens first. These fixtures exist
  // to fail if anyone "simplifies" that into one aggregate pass.
  const trade = (o) => ({
    S: 'ZZZ', CP: 'C', K: 100, E: '12/19', D: 'BULL', P: 3e6, V: 100, OI: 50,
    Ty: 'SWP', Si: 'A', DTE: 30, Dt: '9/4', price: 1, Spot: 100, confirmed: true,
    mktcap: 0, sector: 'Tech', stocketf: '', er: false, uoa: false, ...o,
  })

  it('a gap-fill row (mktcap=0) is EXCLUDED by a real cap filter', () => {
    const rows = [trade({ mktcap: 0 }), trade({ mktcap: 0, K: 105 })]
    const r = buildTopPickCandidates(rows, rows, {
      dataMode: 'stocks', capFilter: 'Mega', isEtfFn,
    })
    // capBand(0) is not "Mega", so filter-then-aggregate drops both rows.
    expect(r.ad.length).toBe(0)
    expect(r.candidates).toEqual([])
  })

  it('mixed mktcap on one ticker: only the rows matching the band survive', () => {
    const mega = 800e9
    const rows = [trade({ mktcap: 0 }), trade({ mktcap: mega, K: 105 })]
    expect(capBand(0)).not.toBe('Mega')
    expect(capBand(mega)).toBe('Mega')
    const r = buildTopPickCandidates(rows, rows, {
      dataMode: 'stocks', capFilter: 'Mega', isEtfFn,
    })
    // ⛔ ONE row survives. Aggregate-then-filter would have upgraded the ticker
    // to Mega first and kept BOTH — a different, larger premium for the same
    // filter. That is the silent change this rail exists to catch.
    expect(r.ad.length).toBe(1)
    expect(r.ad[0].mktcap).toBe(mega)
  })

  it('with capFilter=All, the gap-fill row is kept and the ticker upgrades', () => {
    const mega = 800e9
    const rows = [trade({ mktcap: 0 }), trade({ mktcap: mega, K: 105 })]
    const r = buildTopPickCandidates(rows, rows, {
      dataMode: 'stocks', capFilter: 'All', isEtfFn,
    })
    expect(r.ad.length).toBe(2)
    // tkMap's upgrade rule: the ticker takes the real mktcap it saw.
    const c = r.candidates.find((x) => x.sym === 'ZZZ')
    if (c) expect(c.mktcap).toBe(mega)
  })
})

describe('ETF classification is honoured on both tabs', () => {
  const trade = (o) => ({
    S: 'SPY', CP: 'C', K: 500, E: '12/19', D: 'BULL', P: 3e6, V: 100, OI: 50,
    Ty: 'SWP', Si: 'A', DTE: 30, Dt: '9/4', price: 1, Spot: 500, confirmed: true,
    mktcap: 800e9, sector: '', stocketf: 'ETF', er: false, uoa: false, ...o,
  })

  it('an ETF row is excluded from the Stocks tab and kept on Indexes', () => {
    const rows = [trade({})]
    expect(buildTopPickCandidates(rows, rows, { dataMode: 'stocks', capFilter: 'All', isEtfFn }).ad.length).toBe(0)
    expect(buildTopPickCandidates(rows, rows, { dataMode: 'index', capFilter: 'All', isEtfFn }).ad.length).toBe(1)
  })

  it('a non-ETF row is the exact mirror', () => {
    const rows = [trade({ S: 'NVDA', stocketf: '' })]
    expect(buildTopPickCandidates(rows, rows, { dataMode: 'stocks', capFilter: 'All', isEtfFn }).ad.length).toBe(1)
    expect(buildTopPickCandidates(rows, rows, { dataMode: 'index', capFilter: 'All', isEtfFn }).ad.length).toBe(0)
  })

  it('the predicate is genuinely consulted — swapping it swaps the result', () => {
    // Guards against the classification being hard-coded during a refactor.
    const rows = [trade({ S: 'NVDA', stocketf: '' })]
    const always = () => true
    expect(buildTopPickCandidates(rows, rows, { dataMode: 'stocks', capFilter: 'All', isEtfFn: always }).ad.length).toBe(0)
  })
})

describe('null / missing / degenerate input', () => {
  it('null row arrays do not throw', () => {
    expect(() => buildTopPickCandidates(null, null, { dataMode: 'stocks', capFilter: 'All', isEtfFn })).not.toThrow()
  })

  it('empty rows yield empty candidates, not a crash', () => {
    const r = buildTopPickCandidates([], [], { dataMode: 'stocks', capFilter: 'All', isEtfFn })
    expect(r.candidates).toEqual([])
    expect(r.ad).toEqual([])
  })

  it('a ticker present in directional but absent from trades still ranks', () => {
    // contractTotals is a DISPLAY overlay; a missing entry must fall back to the
    // directional figures rather than zeroing the row out.
    const t = {
      S: 'QQQ2', CP: 'C', K: 10, E: '12/19', D: 'BULL', P: 5e6, V: 10, OI: 5,
      Ty: 'SWP', Si: 'A', DTE: 30, Dt: '9/4', price: 1, Spot: 10, confirmed: true,
      mktcap: 5e9, sector: '', stocketf: '', er: false, uoa: false,
    }
    const r = buildTopPickCandidates([t], [], { dataMode: 'stocks', capFilter: 'All', isEtfFn })
    const c = r.candidates.find((x) => x.sym === 'QQQ2')
    expect(c).toBeTruthy()
    expect(c.topCDisplayPrem).toBe(c.topC.prem)   // fell back, not zeroed
  })

  it('standoutCandidates is null unless the Standout view asked for it', () => {
    const r = run(buildTopPickCandidates, 'stocks', 'All', false)
    expect(r.standoutCandidates).toBe(null)
    const s = run(buildTopPickCandidates, 'stocks', 'All', true)
    expect(Array.isArray(s.standoutCandidates)).toBe(true)
  })
})
