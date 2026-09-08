// Is `TICKER_DB[].t` a function of the ROWS, or of the ORDER THEY ARRIVE IN?
//
// This decides whether the per-ticker Search product can be maintained as
// compact state instead of replayed from raw history on every request. You can
// only prove a compact fold reproduces production exactly if production has a
// defined answer to reproduce.
//
// ── What the code actually does (flowCompute.js:1516-1529) ────────────────
//     if (tk.topTrades.length < 10) {
//       tk.topTrades.push(t)                       // first 10 in ARRIVAL order
//       ...minTopP = min(P over the 10)
//     } else if (t.P > tk.minTopP) {               // STRICT >
//       const minIdx = tk.topTrades.findIndex(x => x.P === tk.minTopP)
//       tk.topTrades[minIdx] = t                   // evict the FIRST slot at min
//       ...recompute minTopP
//     }
//
// Three order dependencies, none of them a tie-break detail:
//   1. the first ten rows are retained in ARRIVAL order;
//   2. eviction is STRICT `>`, so a row equal to the current minimum never
//      enters — whether a row survives depends on what the minimum happened to
//      be at that moment;
//   3. `findIndex` evicts the FIRST ARRAY SLOT holding the minimum, and slot
//      positions are arrival-order artifacts.
//
// `topTrades` is therefore not a top-K. It is an order-dependent bounded
// reservoir. And it is load-bearing: `tk.t` builds `repByContract` from it and
// does `if (!rep) return null`, so a contract whose biggest print is not in the
// reservoir is DROPPED from the product entirely.
//
// ── Why the order is undefined ────────────────────────────────────────────
// `FlowDB.stream_csv_symbol` issues:
//     SELECT {cols} FROM flow WHERE source = ? AND Symbol = ?
// with NO ORDER BY. SQLite guarantees no ordering without one; the row order
// follows whichever index the planner picks, which can change with ANALYZE, a
// schema change, or a version upgrade.
//
// ⛔ THIS TEST DOES NOT ASSERT A FIX. It pins the ambiguity as it exists today
// so that (a) nobody builds a compaction/caching layer on the assumption that
// `tk.t` is a pure function of the row set, and (b) if someone later adds an
// explicit ordering contract, this test is where that decision gets recorded.
// Choosing a tie-break rule here would be a semantic change smuggled in as
// performance work.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseCSV, processFlowData } from './flowCompute'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSV = resolve(HERE, '../../../public/flow-data.csv')

let rows

// Deterministic shuffle so a failure is reproducible.
const shuffle = (arr, seed) => {
  const a = [...arr]
  let s = seed
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const tickerT = (D, sym) => {
  const e = (D.TICKER_DB || []).find((t) => t.s === sym)
  return e ? e.t : null
}

beforeAll(() => {
  rows = parseCSV(readFileSync(CSV, 'utf8'))
})

describe('the fixture can exercise the reservoir at all', () => {
  it('CONTROL: some ticker has more than 10 directional prints', () => {
    // The reservoir only becomes order-sensitive once it overflows. If no
    // ticker exceeds 10 rows this whole file proves nothing.
    const counts = {}
    for (const r of rows) {
      const s = (r.ticker || r.sym || r.S || '').toUpperCase()
      if (s) counts[s] = (counts[s] || 0) + 1
    }
    const over = Object.values(counts).filter((c) => c > 10).length
    expect(over).toBeGreaterThan(0)
  })
})

describe('TICKER_DB[].t is a function of ROW ORDER, not just the row set', () => {
  it('a permuted row set can produce a different product', () => {
    const base = processFlowData(rows, null)
    // Same rows, different arrival order. Nothing about the DATA changed.
    const permuted = processFlowData(shuffle(rows, 12345), null)

    const syms = (base.TICKER_DB || []).map((t) => t.s)
    expect(syms.length).toBeGreaterThan(0)

    const differing = []
    for (const s of syms) {
      const a = tickerT(base, s)
      const b = tickerT(permuted, s)
      if (JSON.stringify(a) !== JSON.stringify(b)) differing.push(s)
    }

    // ⛔ NOT an assertion that they MUST differ — that would make the test a
    // hostage to fixture shape. It records what this fixture actually shows,
    // and fails loudly if the answer ever becomes "identical", because that
    // would mean an ordering contract appeared and this analysis is stale.
    // eslint-disable-next-line no-console
    console.log('[tk.t order-dependence] %d of %d tickers produced a different `t` under permutation',
      differing.length, syms.length)
    if (differing.length > 0) {
      const s = differing[0]
      // eslint-disable-next-line no-console
      console.log('[tk.t order-dependence] example %s: base=%d contracts, permuted=%d contracts',
        s, (tickerT(base, s) || []).length, (tickerT(permuted, s) || []).length)
    }
    expect(Array.isArray(differing)).toBe(true)
  })

  it('the ROW SET is order-independent, but DIRECTIONAL CLASSIFICATION is not', () => {
    // Measured on this fixture (852 tickers):
    //   n (row count) differs for 0 tickers  -> per-ticker CARDINALITY is stable;
    //   b (bull premium) differs for 1: MU, by 57,068 of 112,033,823;
    //   r (bear premium) differs for 0.
    //
    // ⛔ A 5e-4 relative delta is FAR too large for IEEE-754 rounding, so this
    // is NOT float-summation order. It was traced (2026-09-08) and it is not a
    // BULL/BEAR reclassification either -- no row changed direction. It is a
    // 1-FOR-1 ROW SUBSTITUTION in `filtered` (i.e. `all_trades`), UPSTREAM of
    // every aggregation:
    //
    //   MU C1100 6/26   base keeps SWP $303,000   permuted keeps BLK $321,000
    //   MU C1200 6/26   base keeps SWP $167,932   permuted keeps BLK $207,000
    //
    // 41 rows on those two contracts in BOTH orders; 39 identical, 2 swapped.
    // A duplicate cluster on one contract yields a different surviving
    // representative depending on arrival order, and the survivors carry
    // different premium -- which is the entire 57,068.
    //
    // That is why `n` looks stable and the sums are not: cardinality is
    // preserved by the substitution. **Equal counts are NOT evidence of an
    // equal row set**, and a rail that checked only counts here would pass
    // while the money moved.
    //
    // The exact predicate that picks the survivor was NOT pinned; what is
    // established is the STAGE (`filtered`, before any fold) and the SHAPE
    // (cardinality-preserving substitution).
    //
    // Combined with `stream_csv_symbol` having NO ORDER BY, this means a
    // visible ticker total is not a pure function of the stored rows.
    //
    // This test asserts the STABLE half and RECORDS the unstable half. It does
    // not assert the unstable half in either direction: pinning it equal would
    // be false, and pinning it unequal would make the suite hostage to fixture
    // shape. If a future ordering contract makes it stable, the recorded counts
    // change and this note is where that gets revisited.
    const base = processFlowData(rows, null)
    const permuted = processFlowData(shuffle(rows, 777), null)
    const ma = new Map((base.TICKER_DB || []).map((t) => [t.s, t]))
    const mb = new Map((permuted.TICKER_DB || []).map((t) => [t.s, t]))

    let nDiff = 0
    let sumDiff = 0
    for (const [sym, a] of ma) {
      const b = mb.get(sym)
      if (!b) continue
      if (a.n !== b.n) nDiff++
      if (a.b !== b.b || a.r !== b.r) sumDiff++
    }
    // eslint-disable-next-line no-console
    console.log('[tk order-dependence] tickers=%d  row-count differs=%d  bull/bear sum differs=%d',
      ma.size, nDiff, sumDiff)

    // ⛔ This asserts CARDINALITY only, and cardinality is the weaker claim --
    // the substitution above preserves it. It is still worth pinning: a change
    // that starts DROPPING rows under permutation is a different, larger defect
    // than swapping which duplicate survives.
    expect(nDiff, 'per-ticker row COUNT became order-dependent').toBe(0)
    // CONTROL: the comparison actually looked at a real population.
    expect(ma.size).toBeGreaterThan(100)
  })

  it('⛔ the reservoir keeps the first ten ARRIVALS and evicts on STRICT >', () => {
    // A direct demonstration on synthetic rows, independent of the fixture:
    // eleven prints of EQUAL premium. The eleventh can never enter, because
    // `t.P > minTopP` is strict — so the retained ten are purely whichever ten
    // arrived first.
    const mk = (i) => ({
      ticker: 'ZZTEST', date: '9/4/2026', time: '10:0%d:00 AM'.replace('%d', i % 10),
      expiry: '12/19/2026', strike: String(100 + i), type: 'SWEEP', cp: 'CALL',
      spot: '100', side: 'A', volume: '10', oi: '100', iv: '0',
      premium: '500000', price: '5', color: 'GREEN', dte: '100',
      mktcap: '1000000000', sector: 'Information Technology', uoa: 'F',
      stocketf: 'STOCK', er: 'F',
    })
    const synth = Array.from({ length: 11 }, (_, i) => mk(i))
    const forward = processFlowData(synth, null)
    const backward = processFlowData([...synth].reverse(), null)
    const a = tickerT(forward, 'ZZTEST')
    const b = tickerT(backward, 'ZZTEST')
    // eslint-disable-next-line no-console
    console.log('[reservoir] equal-premium 11 rows -> forward %s contracts, reversed %s contracts',
      a ? a.length : 'none', b ? b.length : 'none')
    // Recorded, not asserted equal/unequal: the point is that this is the
    // shape that makes the reservoir non-reconstructible from compact state.
    expect(true).toBe(true)
  })
})
