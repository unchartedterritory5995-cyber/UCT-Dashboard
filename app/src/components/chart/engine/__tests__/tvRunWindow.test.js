// app/src/components/chart/engine/__tests__/tvRunWindow.test.js
//
// ─── ⭐⭐ HISTORY PARITY, PHASE 2 — A LISTING DOCUMENT ON AN INTRADAY CHART RUNS FROM TRADINGVIEW'S FIRST BAR ──────
//
// The chart's stamp (`tvRunStartStampOf`: the rule, the New York day, the empty-slot tolerance, the latch), and the
// lane's slice (`computeRuntimeColumns`: run from the stamp's bar as from the listing, widened back; refused BY NAME
// where the start is not proven). `docs/pine/HISTORY-PARITY.md`.
import { describe, it, expect, afterEach, vi } from 'vitest'

import {
  tvRunStartStampOf, nyDayNumber, sessionSlotsPerDay, missingSessionSlots, indexOfTime, isUsTicker,
  tvRunWindowOf, tvRunStartRefusalSentence, setTvRunStartServed, tvRunStartSignature,
} from '../tvRunWindow'
import { TV_INTRADAY_CAP, TV_INTRADAY_CAP_BOUNDS, chunkKeyOf } from '../tvRunStart'
import {
  computeRuntimeColumns, runtimeColumnsFor, resetRuntimeSessions, RUNTIME_HISTORY_GUARD, runtimeWarmupOf,
} from '../runtime/runtimeColumns'
import { workerRunner, resetRuntimeAsync } from '../runtime/runtimeAsync'
import { setRuntimeRunner } from '../runtime/runtimeColumns'
import { runtimeObjectsWithheld } from '../nativeRegistry'

afterEach(() => { setTvRunStartServed(true); resetRuntimeSessions() })

const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const nyIso = (s) => NY.format(new Date(s * 1000))
const DAY = 86400

/** Unix seconds of a New York wall-clock time (DST-correct, via Intl). */
function nyInstant(y, m, d, hh, mm) {
  let guess = Date.UTC(y, m - 1, d, hh + 5, mm) / 1000
  for (let k = 0; k < 2; k += 1) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric',
      month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(guess * 1000)).map((x) => [x.type, +x.value]))
    const have = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000
    guess += Date.UTC(y, m - 1, d, hh, mm) / 1000 - have
  }
  return guess
}

/** A full session grid of `tf`-minute bars on every weekday from `from` (y, m, d) for `days` calendar days. */
function grid(tf, extended, [y, m, d], days, { skip = () => false } = {}) {
  const out = []
  const start = Date.UTC(y, m - 1, d) / 1000
  for (let k = 0; k < days; k += 1) {
    const day = new Date((start + k * DAY) * 1000)
    const wd = day.getUTCDay()
    if (wd === 0 || wd === 6) continue
    const [Y, M, D] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()]
    const open = extended ? 4 * 60 : 9 * 60 + 30
    const close = extended ? 20 * 60 : 16 * 60
    for (let min = open; min < close; min += tf) {
      if (skip(out.length, min)) continue
      out.push({ t: nyInstant(Y, M, D, Math.floor(min / 60), min % 60) })
    }
  }
  return out
}

describe('the New York day and the session slots', () => {
  it('nyDayNumber agrees with Intl across both DST changes and every hour of their days', () => {
    for (const [y, m, d] of [[2026, 3, 8], [2026, 11, 1], [2025, 3, 9], [2025, 11, 2], [2012, 3, 11], [2024, 1, 1]]) {
      const base = Date.UTC(y, m - 1, d) / 1000 - DAY
      for (let h = 0; h < 72; h += 0.5) {
        const t = base + h * 3600
        const iso = new Date(nyDayNumber(t) * DAY * 1000).toISOString().slice(0, 10)
        expect(iso, `${new Date(t * 1000).toISOString()}`).toBe(nyIso(t))
      }
    }
  })
  it('slots per day: extended hours 960 minutes, regular 390, rounded up (60m regular is 7 bars)', () => {
    expect(sessionSlotsPerDay('1', true)).toBe(960)
    expect(sessionSlotsPerDay('5', true)).toBe(192)
    expect(sessionSlotsPerDay('30', false)).toBe(13)
    expect(sessionSlotsPerDay('60', false)).toBe(7)
    expect(sessionSlotsPerDay('60', true)).toBe(16)
    expect(sessionSlotsPerDay('D', true)).toBe(0)
  })
  it('missing slots: a full grid leaves none; every bar dropped is counted once', () => {
    const full = grid(30, true, [2026, 3, 2], 14).map((b) => b.t)
    expect(missingSessionSlots(full, '30', true)).toBe(0)
    const thin = full.filter((_, i) => i % 4 !== 0)
    expect(missingSessionSlots(thin, '30', true)).toBe(full.length - thin.length)
    // from an index: only the days from there on
    expect(missingSessionSlots(thin, '30', true, thin.length - 24)).toBe(missingSessionSlots(thin.slice(-24), '30', true))
  })
  it('indexOfTime finds a bar by its time (rows or plain numbers), -1 for none', () => {
    const rows = [{ t: 10 }, { t: 20 }, { t: 30 }]
    expect(indexOfTime(rows, 20)).toBe(1)
    expect(indexOfTime([10, 20, 30], 30)).toBe(2)
    expect(indexOfTime(rows, 25)).toBe(-1)
    expect(indexOfTime([], 1)).toBe(-1)
  })
  it('only a plain US ticker is stamped', () => {
    for (const s of ['SPY', 'RDDT', 'BRK.B', 'BF-B']) expect(isUsTicker(s), s).toBe(true)
    for (const s of ['I:SPX', 'X:BTCUSD', 'spy', '', null, 'TOOLONGTICKER']) expect(isUsTicker(s), String(s)).toBe(false)
  })
})

// SPY 30m ETH as a full grid: 32 bars a day, about 3 years (deeper than the cap)
const SPY30 = grid(30, true, [2023, 6, 1], 1270)

describe('the chart\'s stamp (tvRunStartStampOf)', () => {
  it('30m extended hours, full session: the first bar of the calendar YEAR holding the 20,000th newest bar, proven', () => {
    const s = tvRunStartStampOf({ bars: SPY30, tf: '30', extended: true, sym: 'SPY' })
    expect(s.proven).toBe(true)
    expect(s.tolerance).toBe(0)
    const k = SPY30.length - TV_INTRADAY_CAP
    const year = new Date(SPY30[k].t * 1000).getUTCFullYear()
    const first = SPY30.findIndex((b) => chunkKeyOf(b.t, 'year') === chunkKeyOf(SPY30[k].t, 'year'))
    expect(s.index).toBe(first)
    expect(s.t).toBe(SPY30[first].t)
    expect(nyIso(s.t)).toMatch(new RegExp(`^${year}-01-0[1-5]$`))
    // 04:00 New York, the first extended-hours bar of the year's first session
    expect(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(s.t * 1000))).toBe('04:00')
    expect(s.key).toBe('SPY|30|eth')
  })
  it('⭐ THE LATCH: a new bar, a scroll-back prepend and many new bars never move a proven start', () => {
    const s = tvRunStartStampOf({ bars: SPY30, tf: '30', extended: true, sym: 'SPY' })
    const more = [...SPY30, ...grid(30, true, [2026, 11, 23], 200).filter((b) => b.t > SPY30[SPY30.length - 1].t)]
    // unlatched, 6,000 more bars would move the cap-th newest bar (and maybe its year); latched, the start holds
    expect(tvRunStartStampOf({ bars: more, tf: '30', extended: true, sym: 'SPY', prev: s })).toBe(s)
    const older = [...grid(30, true, [2022, 1, 3], 400).filter((b) => b.t < SPY30[0].t), ...SPY30]
    expect(tvRunStartStampOf({ bars: older, tf: '30', extended: true, sym: 'SPY', prev: s })).toBe(s)
    // the latched bar trimmed away: computed afresh
    const trimmed = SPY30.slice(s.index + 1)
    const again = tvRunStartStampOf({ bars: trimmed, tf: '30', extended: true, sym: 'SPY', prev: s })
    expect(again).not.toBe(s)
    // another series (session, timeframe, symbol) never inherits it
    expect(tvRunStartStampOf({ bars: SPY30, tf: '30', extended: true, sym: 'QQQ', prev: s })).not.toBe(s)
    expect(tvRunStartStampOf({ bars: SPY30, tf: '30', extended: false, sym: 'SPY', prev: s })).not.toBe(s)
  })
  it('⛔ an unproven stamp is never latched: depth that arrives later is read', () => {
    const short = SPY30.slice(-15000)
    const s = tvRunStartStampOf({ bars: short, tf: '30', extended: true, sym: 'SPY' })
    expect(s.proven).toBe(false)
    expect(tvRunStartStampOf({ bars: SPY30, tf: '30', extended: true, sym: 'SPY', prev: s }).proven).toBe(true)
  })
  it('fewer bars than the cap: proven only when the first bar is the listing day', () => {
    const short = SPY30.slice(-15000)
    const listed = nyIso(short[0].t)
    expect(tvRunStartStampOf({ bars: short, tf: '30', extended: true, sym: 'RDDT' }).proven).toBe(false)
    const s = tvRunStartStampOf({ bars: short, tf: '30', extended: true, sym: 'RDDT', listDate: listed })
    expect(s.proven).toBe(true)
    expect(s.index).toBe(0)
    expect(s.rule).toBe('whole-history')
    expect(tvRunStartStampOf({ bars: short, tf: '30', extended: true, sym: 'RDDT', listDate: '2001-01-02' }).proven).toBe(false)
  })
  it('⛔ a THIN session (bars missing in extended hours) widens the cap by its empty slots: 5m week chunks go ambiguous', () => {
    // 5m ETH, a quarter of the pre/post-market bars missing: thousands of empty slots, more than a week (960 bars)
    const thin = grid(5, true, [2025, 11, 3], 230, { skip: (i, min) => (min < 570 || min >= 960) && i % 4 === 0 })
    const s = tvRunStartStampOf({ bars: thin, tf: '5', extended: true, sym: 'RDDT' })
    expect(s.tolerance).toBeGreaterThan(960)
    expect(s.proven).toBe(false)
    expect(s.ambiguous).toBe(true)
    // the same grid FULL is proven (tolerance 0)
    const full = grid(5, true, [2025, 11, 3], 230)
    const f = tvRunStartStampOf({ bars: full, tf: '5', extended: true, sym: 'SPY' })
    expect(f.tolerance).toBe(0)
    expect(f.proven || f.ambiguous).toBe(true)
    if (f.proven) expect(new Date(f.t * 1000).getUTCDay()).toBe(1)   // a Monday: the ISO week's first session
  })
  it('null where the question does not arise; unmeasured timeframes are stamped unproven', () => {
    expect(tvRunStartStampOf({ bars: [{ t: '2026-01-02' }], tf: 'D', extended: false, sym: 'SPY' })).toBeNull()
    expect(tvRunStartStampOf({ bars: SPY30, tf: '30', extended: true, sym: 'I:SPX' })).toBeNull()
    expect(tvRunStartStampOf({ bars: [], tf: '30', extended: true, sym: 'SPY' })).toBeNull()
    expect(tvRunStartStampOf({ bars: [{ t: 'x' }], tf: '30', extended: true, sym: 'SPY' })).toBeNull()
    const u = tvRunStartStampOf({ bars: SPY30, tf: '10', extended: true, sym: 'SPY' })
    expect(u.proven).toBe(false)
    expect(u.rule).toBe('unmeasured-timeframe')
  })
  it('a stamp is plain data (it crosses the runtime worker) and its signature names start and proof', () => {
    const s = tvRunStartStampOf({ bars: SPY30, tf: '30', extended: true, sym: 'SPY' })
    expect(structuredClone({ ...s })).toEqual({ ...s })
    expect(tvRunStartSignature(s)).toBe(`p${s.t}`)
    expect(tvRunStartSignature({ ...s, proven: false })).not.toBe(tvRunStartSignature(s))
    expect(tvRunStartSignature(null)).toBe('')
  })
})

// ── the lane ─────────────────────────────────────────────────────────────────────────────────────────────────────
const SRC = '//@version=6\nindicator("tvrs", overlay = false)\nvar float a = 0.0\na += 1\nplot(a, "A")\nplot(bar_index, "B")\n'
const listingDoc = (id = 'tvrs-doc') => ({ id, meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: `runtime:${id}`, outputs: { a: 0, b: 1 }, source: SRC } })
const ROWS = SPY30.map((b, i) => ({ t: b.t, o: 100 + (i % 7), h: 101 + (i % 7), l: 99 + (i % 7), c: 100.5 + (i % 7), v: 1000 }))
const CTX = { tf: '30', newestBarIsForming: false }
const stampOn = (rows) => tvRunStartStampOf({ bars: rows, tf: '30', extended: true, sym: 'SPY' })

describe('the lane: a listing document runs from TradingView\'s first bar', () => {
  it('⭐ proven: the run starts at the stamp\'s bar as bar 0 (its `var` seeded there), widened back with NaN before it', () => {
    const s = stampOn(ROWS)
    expect(s.proven).toBe(true)
    const cut = s.index
    expect(cut).toBeGreaterThan(0)
    const cols = computeRuntimeColumns(listingDoc(), ROWS, { ...CTX, tvRunStart: s })
    expect(cols.a.length).toBe(ROWS.length)
    expect(Number.isNaN(cols.a[cut - 1])).toBe(true)
    expect(Number.isNaN(cols.a[0])).toBe(true)
    expect(cols.a[cut]).toBe(1)
    expect(cols.b[cut]).toBe(0)                          // bar_index 0 on TradingView's first bar
    expect(cols.a[ROWS.length - 1]).toBe(ROWS.length - cut)
    const warm = runtimeWarmupOf(cols)
    expect(warm.withheldBars).toBe(cut)
    expect(warm.tvRunStart).toMatchObject({ cut, t: s.t, chunk: 'year' })
  })
  it('the same bars run from the listing (rows starting AT the stamp) give the same numbers bar for bar', () => {
    const s = stampOn(ROWS)
    const cols = computeRuntimeColumns(listingDoc('tvrs-b'), ROWS, { ...CTX, tvRunStart: s })
    const ref = computeRuntimeColumns(listingDoc('tvrs-c'), ROWS.slice(s.index), { ...CTX, historyFromListing: true })
    for (const k of ['a', 'b']) expect(cols[k].slice(s.index)).toEqual(ref[k])
  })
  it('⛔ no stamp: refused by name as before (`runtime:history-start`)', () => {
    let err = null
    try { computeRuntimeColumns(listingDoc(), ROWS, CTX) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_HISTORY_GUARD)
    expect(err.message).not.toMatch(/20,000th/)
  })
  it('⛔ an unproven stamp (the chart holds too little): refused by name, and the sentence says the start is further back', () => {
    const short = ROWS.slice(-12000)
    const s = stampOn(short)
    expect(s.proven).toBe(false)
    let err = null
    try { computeRuntimeColumns(listingDoc(), short, { ...CTX, tvRunStart: s }) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_HISTORY_GUARD)
    expect(err.message).toMatch(/calendar year that holds the chart's 20,000th newest bar/)
    expect(err.message).toMatch(/This chart holds 12,000 bars/)
    expect(err.message).toMatch(/further back than its loaded history/)
  })
  it('⛔ a proven stamp whose bar is not in the rows (another series): refused, never run from elsewhere', () => {
    const s = stampOn(ROWS)
    const other = ROWS.slice(s.index + 1)
    let err = null
    try { computeRuntimeColumns(listingDoc(), other, { ...CTX, tvRunStart: s }) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_HISTORY_GUARD)
  })
  it('⛔ the switch off: a proven stamp is not served (the mutant\'s control)', () => {
    setTvRunStartServed(false)
    let err = null
    try { computeRuntimeColumns(listingDoc(), ROWS, { ...CTX, tvRunStart: stampOn(ROWS) }) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_HISTORY_GUARD)
  })
  it('a document that is not a listing document ignores the stamp (computes every bar, as before)', () => {
    const def = { ...listingDoc('tvrs-plain'), meta: {} }
    const cols = computeRuntimeColumns(def, ROWS, { ...CTX, tvRunStart: stampOn(ROWS) })
    expect(cols.a[0]).toBe(1)
    expect(runtimeWarmupOf(cols)).toBeNull()
  })
  it('a chart that starts AT the listing keeps the listing statement (the stamp is not consulted)', () => {
    expect(tvRunWindowOf(listingDoc(), ROWS, { ...CTX, historyFromListing: true, tvRunStart: stampOn(ROWS) })).toBeNull()
  })
  it('⭐ the memo keys on the stamp: the same rows with and without a proven start are two answers', () => {
    const def = listingDoc('tvrs-memo')
    let first = null
    try { runtimeColumnsFor(def, ROWS, {}, CTX) } catch (e) { first = e }
    expect(first && first.guard).toBe(RUNTIME_HISTORY_GUARD)
    const cols = runtimeColumnsFor(def, ROWS, {}, { ...CTX, tvRunStart: stampOn(ROWS) })
    expect(cols.a[ROWS.length - 1]).toBeGreaterThan(0)
  })
  it('a run from TradingView\'s start is not a curtain: a host-drawn document\'s drawings are not withheld for it', () => {
    const def = { compute: { kind: 'runtime', outputs: { a: 0 } }, objects: { ops: [{ op: 'x' }] } }
    const cols = computeRuntimeColumns(listingDoc('tvrs-obj'), ROWS, { ...CTX, tvRunStart: stampOn(ROWS) })
    expect(runtimeObjectsWithheld(def, cols)).toBeNull()
  })
  it('the stamp crosses the runtime worker\'s message', () => {
    const sent = []
    resetRuntimeAsync()
    setRuntimeRunner(workerRunner(() => ({ postMessage(m) { sent.push(structuredClone(m)) }, terminate() {} })))
    try {
      const s = stampOn(ROWS)
      runtimeColumnsFor(listingDoc('tvrs-worker'), ROWS, {}, { ...CTX, tvRunStart: s })
      const msg = sent.find((m) => m && m.ctx)
      expect(msg.ctx.tvRunStart).toEqual({ ...s })
    } finally {
      setRuntimeRunner(null); resetRuntimeAsync()
    }
  })
})

describe('the refusal sentences', () => {
  it('ambiguous at a boundary, with the population tolerance named', () => {
    const t = tvRunStartRefusalSentence({ rule: 'cap-chunk', chunk: 'week', ambiguous: true, index: 9, held: 30000, heldFrom: 0, tolerance: 1500 })
    expect(t).toMatch(/so close to the start of a week/)
    expect(t).toMatch(new RegExp(`${TV_INTRADAY_CAP_BOUNDS[0].toLocaleString('en-US')}-${TV_INTRADAY_CAP_BOUNDS[1].toLocaleString('en-US')}`))
    expect(t).toMatch(/leaves 1,500 bar slots empty/)
  })
  it('an unmeasured timeframe says so', () => {
    expect(tvRunStartRefusalSentence({ rule: 'unmeasured-timeframe' })).toMatch(/has not been measured yet/)
  })
})
