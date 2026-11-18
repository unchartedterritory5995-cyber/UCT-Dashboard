// ─── ⭐⭐ RS RATING L1b / L6b — SPELLINGS SERVED ONLY BEHIND A CAPTURE WITNESS ─────────
//
// `requestWitnesses.json` holds the other-symbol spellings that are not a US listing
// (`SP:SPX`, the S&P 500 index; `SEED_FRED6725_RS_RATING:RSRATING`, a Pine seed). Each
// is served only once its row carries a `witness` and a `captured` date (peer rule:
// index bars count only after a capture MATCH). Until then the spelling is refused BY
// NAME, citing its queue row, by the one gate both lanes ask
// (`otherSymbols.js::staticallyUnservable`). These rails show both states: the
// committed (pending) rows refuse, and the same rows with a witness injected
// (`setRequestWitnessRows`, the one data edit that turns a row on) serve.

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { translatePine } from './ast/pine'
import {
  resolveOtherSymbols, fetchableOtherSymbols, staticallyUnservable, spellingUnservable,
  setRequestWitnessRows, requestWitnessRows, witnessRowServes, OTHER_SYMBOL_REFUSAL as R,
} from './otherSymbols'
import WITNESSES from './requestWitnesses.json'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { computeFor, columnErrors } from './nativeRegistry'

const pine = (lines) => ['//@version=5', 'indicator("w")', ...lines].join('\n')
function docOf(src) {
  const t = translatePine(src, { strict: true })
  const trees = {}
  ;(t.outputs || []).forEach((o, i) => { if (o && o.ast) trees[`p${i}`] = o.ast })
  return {
    t,
    def: {
      id: 'u_w', compute: { kind: 'ast', trees },
      meta: { recurrenceOrigin: 'pine', ...(t.otherSymbols ? { otherSymbols: t.otherSymbols } : {}) },
    },
  }
}

/** ⭐ The rows as they stood BEFORE their captures landed (no `witness`, no `captured`): the
 *  pending state, injected. The committed file carries the witnesses (L6b, 2026-11-15). */
const PENDING = Object.fromEntries(Object.entries(WITNESSES.rows).map(([k, v]) => {
  const { witness: _w, captured: _c, how: _h, ...rest } = v
  return [k, rest]
}))
/** The rows with a witness written in: the one data edit a landed capture makes. */
const WITNESSED = Object.fromEntries(Object.entries(WITNESSES.rows).map(([k, v]) => [k,
  { ...v, witness: `tests/fixtures/vendor/harness/${v.queue_row}-witness.json`, captured: '2026-11-15' }]))

// SPX daily bars as `api/index_bars.py` serves them: `t` = UTC midnight of the session, seconds.
const utc = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
const SPX = [
  { t: utc('2026-01-02'), o: 1, h: 2, l: 0.5, c: 5900, v: 0 },
  { t: utc('2026-01-05'), o: 1, h: 2, l: 0.5, c: 5910, v: 0 },
  { t: utc('2026-01-06'), o: 1, h: 2, l: 0.5, c: 5920, v: 0 },
]
const ctxOf = (over = {}) => ({
  tf: 'D',
  symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  exchangeOf: () => null,
  secondary: new Map([['SPX', { bars: SPX, status: 'available' }]]),
  ...over,
})

afterEach(() => { setRequestWitnessRows(null) })

describe('the committed rows are WITNESSED (Q-RS2 / Q-RS3 landed, 2026-11-15)', () => {
  it('both rows carry a witness and a known alignment, so both serve', () => {
    const rows = requestWitnessRows()
    expect(Object.keys(rows).sort()).toEqual(['SEED_FRED6725_RS_RATING:RSRATING', 'SP:SPX'])
    for (const row of Object.values(rows)) expect(witnessRowServes(row)).toBe(true)
    expect(rows['SP:SPX'].alignment).toBe('previous-session')
    expect(rows['SEED_FRED6725_RS_RATING:RSRATING'].alignment).toBe('same-date-gaps-na')
  })
})

describe('a PENDING row: refused by name, citing the queue row', () => {
  beforeEach(() => { setRequestWitnessRows(PENDING) })

  it('every pending row refuses to serve, and the pending state is not vacuous', () => {
    const rows = requestWitnessRows()
    expect(Object.keys(rows).sort()).toEqual(['SEED_FRED6725_RS_RATING:RSRATING', 'SP:SPX'])
    for (const row of Object.values(rows)) expect(witnessRowServes(row)).toBe(false)
  })

  it('`SP:SPX` translates to a read of SPX, and the gate refuses it naming Q-RS3', () => {
    const { t, def } = docOf(pine(['plot(request.security("SP:SPX", timeframe.period, close))']))
    expect(t.otherSymbols).toEqual([{ ticker: 'SPX', spellings: ['SP'] }])
    const why = staticallyUnservable('SPX', 'SP')
    expect(why.code).toBe(R.WITNESS_PENDING)
    expect(why.reason).toMatch(/Q-RS3/)
    const r = resolveOtherSymbols(def, ctxOf())
    expect(r.served).toEqual([])
    expect(r.refused[0]).toMatchObject({ ticker: 'SPX', code: R.WITNESS_PENDING, static: true })
    expect(fetchableOtherSymbols(def)).toEqual([])
  })

  it('the raw spelling is refused the same way (the runtime lane asks this)', () => {
    expect(spellingUnservable('SP:SPX')).toMatchObject({ code: R.WITNESS_PENDING })
  })

  it('CONTROL: the bare `SPX` keeps its own refusal (an index under no exchange)', () => {
    expect(staticallyUnservable('SPX', '')).toMatchObject({ code: R.BARE })
  })

  it('CONTROL: another foreign venue keeps `venue-foreign`', () => {
    expect(spellingUnservable('TSX:RY')).toMatchObject({ code: R.VENUE_FOREIGN })
  })
})

describe('with the witness row injected, SP:SPX is served — aligned by session DATE', () => {
  it('fetched under the store key, served, and every bar keyed by its session date', () => {
    setRequestWitnessRows(WITNESSED)
    const { def } = docOf(pine(['plot(request.security("SP:SPX", timeframe.period, close))']))
    expect(staticallyUnservable('SPX', 'SP')).toBe(null)
    expect(fetchableOtherSymbols(def)).toEqual(['SPX'])
    const r = resolveOtherSymbols(def, ctxOf())
    expect(r.refused).toEqual([])
    expect(r.served).toEqual(['SPX'])
    // ⭐ index bars carry unix seconds; the chart's daily bars an ISO date. Keyed by session
    // date, and — the Q-RS3 witness, `previous-session` — each SPX bar is read on the chart's
    // NEXT session: 2026-01-05's chart bar reads 2026-01-02's SPX bar. The newest SPX bar has
    // no next session yet, so no chart bar reads it.
    expect(r.symbols.SPX.map((b) => b.t)).toEqual(['2026-01-05', '2026-01-06'])
    expect(r.symbols.SPX.map((b) => b.c)).toEqual([5900, 5910])
  })

  it('CONTROL: a `same-date` row keys each bar on its own session date (the alignment is the row\'s)', () => {
    setRequestWitnessRows({ ...WITNESSED, 'SP:SPX': { ...WITNESSED['SP:SPX'], alignment: 'same-date' } })
    const { def } = docOf(pine(['plot(request.security("SP:SPX", timeframe.period, close))']))
    const r = resolveOtherSymbols(def, ctxOf())
    expect(r.symbols.SPX.map((b) => b.t)).toEqual(['2026-01-02', '2026-01-05', '2026-01-06'])
    expect(r.symbols.SPX.map((b) => b.c)).toEqual([5900, 5910, 5920])
  })

  it('⛔ a row whose alignment is not one this engine knows is refused by name, never guessed', () => {
    setRequestWitnessRows({ ...WITNESSED, 'SP:SPX': { ...WITNESSED['SP:SPX'], alignment: 'sideways' } })
    const { def } = docOf(pine(['plot(request.security("SP:SPX", timeframe.period, close))']))
    const r = resolveOtherSymbols(def, ctxOf())
    expect(r.served).toEqual([])
    expect(r.refused[0].code).toBe(R.WITNESS_PENDING)
  })

  it('⛔ only the witnessed timeframes: a 4-hour chart refuses by name', () => {
    // (⭐ RS RATING L13 witnessed the monthly chart, Q-RS-M; L12 the 1 / 5 / 15 / 30 / 60 minute charts, Q-L12-1,
    // `rsIntradayWitness.test.js`; a timeframe with no witnessed block still refuses)
    setRequestWitnessRows(WITNESSED)
    const { def } = docOf(pine(['plot(request.security("SP:SPX", timeframe.period, close))']))
    const r = resolveOtherSymbols(def, ctxOf({ tf: '240' }))
    expect(r.served).toEqual([])
    expect(r.refused[0].code).toBe(R.WITNESS_TIMEFRAME)
    expect(r.refused[0].reason).toMatch(/witnessed on D, W, M, 1, 5, 15, 30, 60 charts only \(capture-queue rows [^)]*Q-L12-1/)
  })

  it('⭐ RS RATING L11 — a weekly chart is served from the DAILY rows held under `SPX@D`, never from the plain key', () => {
    setRequestWitnessRows(WITNESSED)
    const { def } = docOf(pine(['plot(request.security("SP:SPX", timeframe.period, close))']))
    const plain = resolveOtherSymbols(def, ctxOf({ tf: 'W' }))
    expect(plain.served).toEqual([])
    expect(plain.refused[0].code).toBe(R.NO_BARS)
    const heldOn = resolveOtherSymbols(def, ctxOf({ tf: 'W', secondary: new Map([['SPX@D', { bars: SPX, status: 'available' }]]) }))
    expect(heldOn.served).toEqual(['SPX'])
    // `previous-week`: 2026-01-02's week (Friday 2026-01-02) is read by the next week's bar (Friday 2026-01-09);
    // 2026-01-05..06's week by the one after
    expect(heldOn.symbols.SPX.map((b) => [b.t, b.c])).toEqual([['2026-01-09', 5900], ['2026-01-16', 5920]])
  })

  it('⛔ still waiting while the bars load, refused once the answer is empty', () => {
    setRequestWitnessRows(WITNESSED)
    const { def } = docOf(pine(['plot(request.security("SP:SPX", timeframe.period, close))']))
    const loading = resolveOtherSymbols(def, ctxOf({ secondary: new Map([['SPX', { bars: [], status: 'loading' }]]) }))
    expect(loading.refused[0]).toMatchObject({ code: R.NO_BARS, pending: true })
    const none = resolveOtherSymbols(def, ctxOf({ secondary: new Map([['SPX', { bars: [], status: 'no_data' }]]) }))
    expect(none.refused[0].pending).toBeUndefined()
  })
})

describe('end to end through the member door: the plot that reads SP:SPX', () => {
  const DAYS = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08']
  const CHART = DAYS.map((t, i) => ({ t, o: 10, h: 11, l: 9, c: 10 + i, v: 1000 }))
  const SPXD = DAYS.map((t, i) => ({ t: utc(t), o: 1, h: 2, l: 0.5, c: 6000 + 10 * i, v: 0 }))
  const CTX = { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false,
    secondary: new Map([['SPX', { bars: SPXD, status: 'available' }]]), exchangeOf: () => null }
  const SRC = pine(['plot(close, "own")', 'plot(request.security("SP:SPX", timeframe.period, close), "spx")'])

  it('pending: only that plot is refused, by name, citing Q-RS3; the other is drawn', () => {
    setRequestWitnessRows(PENDING)
    const d = memberPaneDefinition({ source: SRC, id: 'u_l1bspx', name: 'l1b' })
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    const errs = Object.values(columnErrors(cols))
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ guard: 'pine:request', code: R.WITNESS_PENDING })
    expect(errs[0].message).toMatch(/Q-RS3/)
  })

  it('witnessed: the plot reads the PREVIOUS session\'s SPX close on every bar (the Q-RS3 witness)', () => {
    setRequestWitnessRows(WITNESSED)
    const d = memberPaneDefinition({ source: SRC, id: 'u_l1bspx', name: 'l1b' })
    expect(d.ok, d.reason).toBe(true)
    const cols = computeFor(d.definition, CHART, undefined, CTX)
    expect(Object.values(columnErrors(cols))).toEqual([])
    const spxKey = Object.keys(cols).find((k) => Array.from(cols[k]).some((v) => v > 1000))
    expect(Array.from(cols[spxKey])).toEqual([NaN, 6000, 6010, 6020, 6030])
  })
})
