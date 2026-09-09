// Is the Search deep-dive product semantically dependent on `erSoon`?
//
// WHY THIS EXISTS. `/api/flow/ticker/{sym}` ships a ticker's UNCAPPED history —
// measured on prod 3,651 KB wire / 20,252 KB decoded / 4,232 ms for AMD — and
// the browser then runs the FULL `processFlowData` over it in the worker, to
// render ~17 rows. Moving that computation to the server is the fix. But the
// client calls `computeCsv(csv, erSoonArr)`, i.e.
// `processFlowData(rows, toSet(erSoon))`, so the derived object depends on the
// USER's earnings-soon set — and a server that computed it without that set
// would be a semantic change, which the frozen-brain rule forbids.
//
// The same dependency also makes the Search effect re-fire: `erSoonArr` is in
// its dep array, so when the calendar resolves ~1 s after a search the whole
// 20 MB fetch AND the whole recompute happen a SECOND time.
//
// ── What the consumer audit found (and corrected) ─────────────────────────
// A first pass grepped lines 7280-8320 for `.er`, found none, and concluded
// Search was er-independent. THAT WAS WRONG: the Search block is L7234-8499 and
// contains THREE `.er` reads. They are all in the Theme/Sector GROUP view,
// which reads `D.clean_confirmed` (the bootstrap dataset) — not the per-ticker
// object. The per-ticker deep dive reads exactly two properties off it,
// `all_directional` and `TICKER_DB`, and neither it nor the functions it passes
// them to (`_scopeAllDirectional`, `getPrice`) reads `.er` at all.
//
// So the SOURCE evidence says: the uncapped per-ticker product is
// er-independent. Source evidence is not enough — `er` could participate in a
// computation INSIDE processFlowData rather than travelling as an inert field,
// in which case the rows themselves would differ. That is what this file
// measures, on real data, with the controls that stop it passing vacuously.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseCSV, processFlowData } from './flowCompute'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSV = resolve(HERE, '../../../public/flow-data.csv')

// The ONLY two properties the per-ticker deep dive reads off the product.
// Derived by grepping every `_uncapped.X` access in OptionsFlow.jsx; if a third
// appears, this list is wrong and the projection below stops being the truth.
const SEARCH_CONSUMED_KEYS = ['all_directional', 'TICKER_DB']

let rows
let withNull      // what the SERVER would compute (no user earnings set)
let withSetA
let withSetB
let setA
let setB

beforeAll(() => {
  rows = parseCSV(readFileSync(CSV, 'utf8'))
  const syms = [...new Set(rows.map(r => (r.ticker || r.sym || r.S || '').toUpperCase()).filter(Boolean))]
  // Two MATERIALLY different earnings-soon sets over symbols that are actually
  // in this tape — not two arbitrary sets that both miss everything.
  const half = Math.floor(syms.length / 2)
  setA = new Set(syms.slice(0, half))
  setB = new Set(syms.slice(half))
  withNull = processFlowData(rows, null)
  withSetA = processFlowData(rows, setA)
  withSetB = processFlowData(rows, setB)
})

const project = (D) => {
  const out = {}
  for (const k of SEARCH_CONSUMED_KEYS) out[k] = D[k]
  return out
}
// The projection MINUS the one field nothing in the deep dive reads.
const stripEr = (D) => ({
  all_directional: (D.all_directional || []).map(({ er: _er, ...rest }) => rest),
  TICKER_DB: D.TICKER_DB,
})

describe('the tape and the sets are real', () => {
  it('CONTROL: non-trivial rows and a populated product', () => {
    expect(rows.length).toBeGreaterThan(1000)
    expect(withNull.all_directional.length).toBeGreaterThan(100)
    expect(Array.isArray(withNull.TICKER_DB)).toBe(true)
    expect(withNull.TICKER_DB.length).toBeGreaterThan(10)
  })

  it('⛔ CONTROL: the two earnings sets ACTUALLY move the `er` field', () => {
    // Without this the equality below could hold because erSoon does nothing
    // at all — the exact vacuous pass this directory has been bitten by.
    const erA = withSetA.all_directional.filter(t => t.er).length
    const erB = withSetB.all_directional.filter(t => t.er).length
    expect(erA).toBeGreaterThan(0)
    expect(erB).toBeGreaterThan(0)
    const flipped = withSetA.all_directional.filter((t, i) => !!t.er !== !!withSetB.all_directional[i].er).length
    expect(flipped, 'the two sets produced the same er flags — they are not materially different').toBeGreaterThan(0)
  })
})

describe('erSoon changes NOTHING the Search deep dive reads', () => {
  it('all_directional is identical field-for-field EXCEPT `er`', () => {
    const a = stripEr(withSetA), b = stripEr(withSetB)
    expect(a.all_directional.length).toBe(b.all_directional.length)
    expect(a.all_directional).toEqual(b.all_directional)
  })

  it('TICKER_DB differs ONLY in `er` — including the nested trades in `t`', () => {
    // Measured: the differing keys are exactly {er, t}, and `t` differs only
    // because each trade inside it carries its own `er`. Naming them here means
    // a future change that makes erSoon influence, say, `mktcap` or `sector`
    // fails BY NAME rather than silently altering a Search result.
    const differing = new Set()
    for (let i = 0; i < withSetA.TICKER_DB.length; i++) {
      for (const k of Object.keys(withSetA.TICKER_DB[i])) {
        if (JSON.stringify(withSetA.TICKER_DB[i][k]) !== JSON.stringify(withSetB.TICKER_DB[i][k])) differing.add(k)
      }
    }
    expect([...differing].sort()).toEqual(['er', 't'])
    // …and inside `t`, `er` is the only differing key.
    const inner = new Set()
    for (let i = 0; i < withSetA.TICKER_DB.length; i++) {
      const ta = withSetA.TICKER_DB[i].t || [], tb = withSetB.TICKER_DB[i].t || []
      for (let j = 0; j < ta.length; j++) {
        for (const k of Object.keys(ta[j])) {
          if (JSON.stringify(ta[j][k]) !== JSON.stringify(tb[j][k])) inner.add(k)
        }
      }
    }
    expect([...inner].sort()).toEqual(['er'])
  })

  it("⛔ THE MIGRATION PROOF: a null-computed product + the client's own erSoon === the client-computed product", () => {
    // This is what licenses the server to compute WITHOUT the user's earnings
    // set — which is what makes the product user-independent and therefore
    // cacheable at all. `processFlowData` treats a Set as the authority and
    // sets `er = set.has(symbol)`, so re-applying it on arrival is not an
    // approximation of the pipeline: it IS the pipeline's own rule.
    const applyEr = (D, set) => ({
      all_directional: (D.all_directional || []).map(t => ({ ...t, er: set.has(t.S) })),
      TICKER_DB: (D.TICKER_DB || []).map(tk => ({
        ...tk, er: set.has(tk.s),
        t: (tk.t || []).map(t => ({ ...t, er: set.has(t.S) })),
      })),
    })
    for (const [set, client] of [[setA, withSetA], [setB, withSetB]]) {
      const revived = applyEr(withNull, set)
      expect(revived.all_directional).toEqual(client.all_directional)
      expect(revived.TICKER_DB).toEqual(client.TICKER_DB)
    }
  })

  it('⛔ CONTROL: applying the WRONG set does NOT reproduce it', () => {
    // Otherwise the proof above could hold because `er` is inert everywhere.
    const applyEr = (D, set) => (D.all_directional || []).map(t => ({ ...t, er: set.has(t.S) }))
    expect(applyEr(withNull, setB)).not.toEqual(withSetA.all_directional)
  })

  it('⛔ CONTROL: the UNPROJECTED product DOES differ — so this is not equality-by-erasure', () => {
    // If the full objects were identical too, the assertions above would be
    // proving nothing about the projection.
    expect(project(withSetA)).not.toEqual(project(withSetB))
  })

  it('`er` is the ONLY key that differs on any row', () => {
    // Stronger than the projection test: name every differing key so a future
    // change that makes erSoon influence a second field fails HERE, by name,
    // instead of silently changing a Search result.
    const differing = new Set()
    const A = withSetA.all_directional, B = withSetB.all_directional
    for (let i = 0; i < A.length; i++) {
      for (const k of Object.keys(A[i])) {
        if (JSON.stringify(A[i][k]) !== JSON.stringify(B[i][k])) differing.add(k)
      }
    }
    expect([...differing].sort()).toEqual(['er'])
  })
})
