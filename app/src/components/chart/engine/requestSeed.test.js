// ─── ⭐⭐ RS RATING L6b — `request.seed` READS THE SEED STORE, BEHIND ITS Q-RS2 WITNESS ─────
//
// `request.seed(source, symbol, expr)` is rewritten at parse into the other-symbol read
// `request.security("<SOURCE>:<SYMBOL>", "D", expr)` (`pine.js::seedAsSecurity`), so both
// lanes read it as every other symbol. Whether it is served is `requestWitnesses.json`'s
// `seed` row (the frontend's manifest of `pine_seed_store.py::SEEDS`, railed equal by
// `tests/test_pine_seed_manifest.py`): an unregistered seed refuses by name, a pending row
// refuses citing Q-RS2, the witnessed row is served from `/api/bars/<SOURCE>:<SYMBOL>` with
// the merge the capture shows: each row on the chart bar of the SAME date, and a chart bar
// with no row reads `na` (known, never withheld, never carried forward).

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { translatePine } from './ast/pine'
import {
  resolveOtherSymbols, fetchableOtherSymbols, staticallyUnservable, spellingUnservable,
  setRequestWitnessRows, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import { SERIES_GAPS_READ_NA } from './ast/interpret'
import WITNESSES from './requestWitnesses.json'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors } from './nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'

const KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const SEED = "request.seed('seed_fred6725_rs_rating', 'RSRATING', close)"
const pine = (lines) => ['//@version=5', 'indicator("seed")', ...lines].join('\n')
function docOf(src) {
  const t = translatePine(src, { strict: true })
  const trees = {}
  ;(t.outputs || []).forEach((o, i) => { if (o && o.ast) trees[`p${i}`] = o.ast })
  return { t, def: { id: 'u_seed', compute: { kind: 'ast', trees },
    meta: { recurrenceOrigin: 'pine', ...(t.otherSymbols ? { otherSymbols: t.otherSymbols } : {}) } } }
}
const PENDING = Object.fromEntries(Object.entries(WITNESSES.rows).map(([k, v]) => {
  const { witness: _w, captured: _c, how: _h, ...rest } = v
  return [k, rest]
}))

// the chart: Mon 2026-01-05 .. Fri 2026-01-16 (10 sessions)
const DAYS = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16']
const CHART = DAYS.map((t, i) => ({ t, o: 10, h: 11, l: 9, c: 10 + i, v: 1000 }))
// the seed's calendar-day rows: from Wed 01-07 to Tue 01-13, weekend rows included, then none
const ROWS = ['2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11', '2026-01-12', '2026-01-13']
  .map((t, i) => ({ t, o: 0, h: 1000, l: 0, c: 100 + i, v: 0 }))
const CTX = { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true,
  secondary: new Map([[KEY, { bars: ROWS, status: 'available' }]]), exchangeOf: () => null }
// what TradingView draws, by the Q-RS2 witness: na before the first row, each row on its own date,
// na on every chart bar after the last row (01-14..01-16). The weekend rows (01-10, 01-11) land on no bar.
const WANT = [NaN, NaN, 100, 101, 102, 105, 106, NaN, NaN, NaN]
const nzWant = WANT.map((v) => (Number.isNaN(v) ? -1 : v))

afterEach(() => { setRequestWitnessRows(null); resetRuntimeSessions(); resetRuntimeLedgers() })

describe('L6b — the translation: a seed is the other-symbol read of its registry key', () => {
  it('translates to a read of RSRATING under the seed source, fetched under its registry key', () => {
    const { t, def } = docOf(pine([`plot(${SEED})`]))
    expect(t.otherSymbols).toEqual([{ ticker: 'RSRATING', spellings: ['SEED_FRED6725_RS_RATING'] }])
    expect(fetchableOtherSymbols(def)).toEqual([KEY])
  })

  it('⛔ an UNREGISTERED seed is refused by name', () => {
    expect(spellingUnservable('SEED_SOMEONE_ELSE:THING')).toMatchObject({ code: R.SEED_UNREGISTERED })
    const { t } = docOf(pine(["plot(request.seed('seed_someone_else', 'THING', close))"]))
    expect(JSON.stringify(t)).toMatch(/other-symbol:seed-unregistered/)
  })

  it('⛔ a seed call this door cannot read (a computed source) is left as it was', () => {
    const { t } = docOf(pine(["src = close > open ? 'seed_a' : 'seed_b'", "plot(request.seed(src, 'X', close))"]))
    expect(t.otherSymbols || []).toEqual([])
  })
})

describe('L6b — pending: refused citing Q-RS2', () => {
  beforeEach(() => { setRequestWitnessRows(PENDING) })
  it('the static gate refuses it, naming the queue row', () => {
    const why = staticallyUnservable('RSRATING', 'SEED_FRED6725_RS_RATING')
    expect(why.code).toBe(R.WITNESS_PENDING)
    expect(why.reason).toMatch(/Q-RS2/)
    expect(fetchableOtherSymbols(docOf(pine([`plot(${SEED})`])).def)).toEqual([])
  })
})

describe('L6b — witnessed: same date, and a gap reads na (Q-RS2)', () => {
  it('the bind serves the rows by their own dates, marked: a gap reads na', () => {
    const r = resolveOtherSymbols(docOf(pine([`plot(${SEED})`])).def, CTX)
    expect(r.served).toEqual(['RSRATING'])
    expect(r.symbols.RSRATING.map((b) => b.t)).toEqual(ROWS.map((b) => b.t))
    expect(r.symbols.RSRATING[SERIES_GAPS_READ_NA]).toBe(true)
  })

  it('host lane, member door: the rows land on their dates, every other bar reads na (nz -> -1)', () => {
    const d = memberPaneDefinition({ source: pine([`plot(nz(${SEED}, -1), "s")`]), id: 'u_seedhost', name: 's' })
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    expect(Object.values(columnErrors(cols))).toEqual([])
    const key = Object.keys(cols)[0]
    expect(Array.from(cols[key])).toEqual(nzWant)
  })

  it('⛔ CONTROL: the same rows under a plain `same-date` row — the gaps are unknown and withheld', () => {
    setRequestWitnessRows({ ...WITNESSES.rows, [KEY]: { ...WITNESSES.rows[KEY], alignment: 'same-date' } })
    const d = memberPaneDefinition({ source: pine([`plot(nz(${SEED}, -1), "s")`]), id: 'u_seedhost', name: 's' })
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    const got = Array.from(cols[Object.keys(cols)[0]])
    expect(got.slice(0, 2)).toEqual([-1, -1])            // before the first row: na, as ever
    expect(got.slice(7).every(Number.isNaN)).toBe(true)  // after the last row: withheld
  })

  it('runtime lane: the same values, from the run\'s own supply', () => {
    const doc = { id: 'u_seedrt', meta: { runtimeHistory: 'listing' },
      compute: { kind: 'runtime', fn: 'runtime:u_seedrt', outputs: { a: 0 }, source: pine([`plot(nz(${SEED}, -1))`]) } }
    const out = computeRuntimeColumns(doc, CHART, CTX)
    expect(Array.from(out.a)).toEqual(nzWant)
  })

  it('⛔ CONTROL: the runtime lane refuses by name where a gap would be unknown (`same-date`)', () => {
    setRequestWitnessRows({ ...WITNESSES.rows, [KEY]: { ...WITNESSES.rows[KEY], alignment: 'same-date' } })
    const doc = { id: 'u_seedrt2', meta: { runtimeHistory: 'listing' },
      compute: { kind: 'runtime', fn: 'runtime:u_seedrt2', outputs: { a: 0 }, source: pine([`plot(nz(${SEED}, -1))`]) } }
    // ⭐ (e85, the tail-lag ruling 2026-11-19) the chart's bars after the seed's last row (2026-01-14 on, the chart's
    // newest finished) are its newest rows not arrived: refused by THAT name (`runtime:request-lag`), not as a hole
    let err = null
    try { computeRuntimeColumns(doc, CHART, CTX) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:request-lag')
    expect(String(err && err.message)).toMatch(/`RSRATING`'s newest bars have not arrived: the bars we hold of it end at 2026-01-13/)
    // ⛔ CONTROL OF THE CONTROL: a gap INSIDE the rows (the seed missing 2026-01-08, with later rows) is still the hole
    const holed = { ...CTX, secondary: new Map([...CTX.secondary].map(([k, e]) => [k, k === KEY
      ? { ...e, bars: e.bars.filter((r) => r.t !== '2026-01-08') } : e])) }
    expect(() => computeRuntimeColumns({ ...doc, id: 'u_seedrt3', compute: { ...doc.compute, fn: 'runtime:u_seedrt3' } }, CHART, holed))
      .toThrow(/no bar on 2026-01-08, after its history began/)
  })
})

describe('acceptance — the ORIGINAL RS Rating source (Fred6724, MPL-2.0) through the member door', () => {
  it('attaches as a host document whose run half (the rating labels) is minted', async () => {
    const { vi } = await import('vitest')
    const fs = await import('node:fs')
    const path = await import('node:path')
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    try {
      const src = fs.readFileSync(path.resolve(process.cwd(), '..', 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
      const d = memberPaneDefinition({ source: src, id: 'u_rsrating', name: 'RS Rating' })
      expect(d.ok, d.reason).toBe(true)
      expect(d.runHalfDeclined).toBeUndefined()
      expect(d.definition.compute.runtimeObjects).toBeTruthy()
      // it reads SP:SPX and the seed as other symbols, spelled as the script spells them
      expect(d.definition.meta.otherSymbols).toEqual(expect.arrayContaining([
        { ticker: 'SPX', spellings: ['SP'] },
        { ticker: 'RSRATING', spellings: ['SEED_FRED6725_RS_RATING'] },
      ]))
    } finally { vi.unstubAllEnvs() }
  })
})
