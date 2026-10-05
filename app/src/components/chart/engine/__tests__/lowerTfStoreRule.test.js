// app/src/components/chart/engine/__tests__/lowerTfStoreRule.test.js
//
// ─── ⭐⭐ LTF — THE STORE-AGREEMENT RAIL: which lower-timeframe reads OUR bars may serve ──
//
// Three things, each able to fail:
//   1. THE EVIDENCE. `lowerTfStoreRule.js::EVIDENCE` is a written-down measurement.
//      It is re-derived here from the committed store payloads
//      (`tests/fixtures/store/*.json.gz`, the exact bytes `/api/bars` returned) and
//      the committed TradingView captures, and must equal it count for count.
//   2. THE ROOT CAUSES. Each cause the module states is measured here on the same
//      fixtures, and each hypothesis it rules out is ruled out here.
//   3. THE RULE. Which (code, field, reach) serves follows from the evidence and the
//      bar; a binding over our bars is refused by name where it does not; controls
//      show every branch can turn.

import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { barsOf, servedAgreement, readStorePayload, priceSame } from './storeIntradayAgreement'
import {
  EVIDENCE, BAR, FIELDS, STORE_DISAGREES, TRADINGVIEW_ORIGIN,
  fieldServes, demandOf, lowerTfStoreRefusal,
} from '../lowerTfStoreRule'
import { resolveLowerTf, LOWER_TF_REFUSAL as R } from '../lowerTf'
import { parseFormula } from '../ast/parse'
import { etClockAt } from '../../indicators.js'

vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')
afterAll(() => { vi.unstubAllEnvs() })

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = (f) => barsOf(JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', `${f}.json`), 'utf8')))
const STORE = (f) => barsOf(readStorePayload(path.join(REPO, 'tests/fixtures/store', f)))
const memo = new Map()
const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k) }
const store = (f) => once(`s:${f}`, () => STORE(f))
const vendor = (f) => once(`v:${f}`, () => VENDOR(f))

/** Which committed files each EVIDENCE row was measured on. */
const ROWS = [
  ['RDDT', '5', 'api-bars-RDDT-tf5.json.gz', 'vw-bar-counters-rddt-5-2026-09-30'],
  ['RDDT', '15', 'api-bars-RDDT-tf15.json.gz', 'vw-bar-counters-rddt-15-2026-09-30'],
  ['RDDT', '60', 'api-bars-RDDT-tf15.json.gz', 'vw-bar-counters-rddt-60-2026-09-30'],
  ['RDDT', '240', 'api-bars-RDDT-tf15.json.gz', 'vw-bar-counters-rddt-240-2026-09-30'],
  ['SPY', '5', 'api-bars-SPY-tf5.json.gz', 'vw-time-tf-spy-5-2026-10-01'],
  ['SPY', '15', 'api-bars-SPY-tf15.json.gz', 'vw-time-tf-spy-15-2026-10-01'],
  ['SPY', '60', 'api-bars-SPY-tf15.json.gz', 'vw-bool-cast-spy-60-2026-09-28'],
  ['SPY', '240', 'api-bars-SPY-tf15.json.gz', 'vw-time-tf-spy-240-2026-10-02'],
]
const pairs = (cell) => Object.fromEntries(FIELDS.map((f) => [f, [cell[f].equal, cell[f].n]]))

describe('LTF · 1. the written-down evidence IS the measurement', () => {
  for (const [listing, code, s, v] of ROWS) {
    it(`${listing} ${code}: ${s} against ${v}`, () => {
      expect(EVIDENCE[code].sources[listing]).toContain(s)
      expect(EVIDENCE[code].sources[listing]).toContain(v)
      const r = servedAgreement(store(s), vendor(v), code)
      expect(r.sessions).toBe(EVIDENCE[code].sessions[listing])
      expect(pairs(r.last)).toEqual({ ...EVIDENCE[code].last[listing] })
      expect(pairs(r.every)).toEqual({ ...EVIDENCE[code].every[listing] })
    })
  }

  it('⛔ CONTROL — the measurement moves when one stored close moves (the rail is not a tautology)', () => {
    const bars = store('api-bars-RDDT-tf15.json.gz')
    const r0 = servedAgreement(bars, vendor('vw-bar-counters-rddt-15-2026-09-30'), '15')
    // the last regular-session bar of a mid-history session whose last close agrees
    const i = bars.findIndex((b) => {
      const p = etClockAt(b.t)
      return p && p.y === 2025 && p.m === 6 && p.d === 10 && p.h === 15 && p.min === 45
    })
    expect(i).toBeGreaterThan(0)
    const moved = bars.map((b, k) => (k === i ? { ...b, c: b.c + 0.01 } : b))
    const r1 = servedAgreement(moved, vendor('vw-bar-counters-rddt-15-2026-09-30'), '15')
    expect(r1.last.c.equal).toBe(r0.last.c.equal - 1)
    expect(r1.every.c.equal).toBe(r0.every.c.equal - 1)
  })
})

describe('LTF · 2. the root causes, measured', () => {
  const rddt15 = () => store('api-bars-RDDT-tf15.json.gz')
  const tv15 = () => vendor('vw-bar-counters-rddt-15-2026-09-30')
  const minuteOf = (t) => { const p = etClockAt(t); return p.h * 60 + p.min }
  const dayOf = (t) => { const p = etClockAt(t); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` }
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

  it('NOT extended hours: the store holds them, `intrabarSeries` drops them, removing them changes nothing', () => {
    const outside = rddt15().filter((b) => { const m = minuteOf(b.t); return m < 570 || m >= 960 })
    expect(outside.length).toBe(18777)
    expect(tv15().filter((b) => { const m = minuteOf(b.t); return m < 570 || m >= 960 }).length).toBe(0)
    const inside = rddt15().filter((b) => { const m = minuteOf(b.t); return m >= 570 && m < 960 })
    expect(servedAgreement(inside, tv15(), '15')).toEqual(servedAgreement(rddt15(), tv15(), '15'))
  })

  it('NOT the session boundary or time zone: no TradingView bar is missing from the store', () => {
    const ours = new Set(rddt15().map((b) => b.t))
    expect(tv15().filter((b) => !ours.has(b.t)).length).toBe(0)
  })

  it('⭐ VOLUME — TradingView\'s intraday volume is a subset: ours / theirs > 1 in EVERY slot; the DAILY volumes are equal', () => {
    const tvAt = new Map(tv15().map((b) => [b.t, b]))
    const bySlot = new Map()
    for (const b of rddt15()) {
      const y = tvAt.get(b.t)
      if (!y || !y.v) continue
      const m = minuteOf(b.t)
      if (!bySlot.has(m)) bySlot.set(m, [])
      bySlot.get(m).push(b.v / y.v)
    }
    expect(bySlot.size).toBe(26)
    for (const [, xs] of bySlot) expect(median(xs)).toBeGreaterThan(1.2)
    expect(median([...bySlot.values()].flat())).toBeCloseTo(1.383, 2)
    // TradingView's own daily volume against the sum of its own 15m bars
    const tvDay = vendor('vw-bar-counters-rddt-1d-2026-09-30')
    const sum = new Map()
    for (const b of tv15()) sum.set(dayOf(b.t), (sum.get(dayOf(b.t)) || 0) + b.v)
    const own = tvDay.filter((d) => sum.get(dayOf(d.t))).map((d) => d.v / sum.get(dayOf(d.t)))
    expect(own.length).toBe(634)
    expect(median(own)).toBeGreaterThan(1.4)
    // …and our DAILY volume is TradingView's (the same consolidated count): equal on 631 / 634
    // RDDT days and 1,747 / 1,800 SPY days, the rest within a fraction of a percent (late
    // corrections, e.g. 2026-09-30 read before the final count), the median ratio exactly 1
    for (const [ours, theirs, eq, n] of [['api-bars-RDDT-tfD.json.gz', 'vw-bar-counters-rddt-1d-2026-09-30', 631, 634],
      ['api-bars-SPY-tfD.json.gz', 'artemis-oscillator-pro-spy-1d-2026-10-03', 1747, 1800]]) {
      const ourDay = new Map(barsOf(readStorePayload(path.join(REPO, 'tests/fixtures/store', ours))).map((b) => [b.t, b]))
      const rows = vendor(theirs).map((d) => [ourDay.get(dayOf(d.t)), d]).filter(([o]) => o)
      expect(rows.length).toBe(n)
      expect(rows.filter(([o, d]) => o.v === d.v).length).toBe(eq)
      expect(median(rows.map(([o, d]) => o.v / d.v))).toBe(1)
    }
  })

  it('⭐ THE 09:30 OPEN — where ours differs from TradingView\'s it is the OFFICIAL open (the daily bar\'s), every time', () => {
    for (const [s, v, d, differ] of [
      ['api-bars-RDDT-tf15.json.gz', 'vw-bar-counters-rddt-15-2026-09-30', 'vw-bar-counters-rddt-1d-2026-09-30', 29],
      ['api-bars-SPY-tf15.json.gz', 'vw-time-tf-spy-15-2026-10-01', 'artemis-oscillator-pro-spy-1d-2026-10-03', 66],
    ]) {
      const ours = new Map(store(s).map((b) => [b.t, b]))
      const daily = new Map(vendor(d).map((b) => [dayOf(b.t), b]))
      let n = 0
      for (const b of vendor(v)) {
        if (minuteOf(b.t) !== 570) continue
        const o = ours.get(b.t); const dd = daily.get(dayOf(b.t))
        if (!o || !dd || priceSame(o.o, b.o)) continue
        n += 1
        expect(priceSame(o.o, dd.o), `${s} ${dayOf(b.t)}`).toBe(true)
      }
      expect(n).toBe(differ)
    }
  })

  it('⭐ THE LAST PRINT — TradingView\'s last 15m close is not its official close either (84 of 634 days)', () => {
    const daily = new Map(vendor('vw-bar-counters-rddt-1d-2026-09-30').map((b) => [dayOf(b.t), b]))
    const last = new Map()
    for (const b of tv15()) last.set(dayOf(b.t), b)
    let same = 0
    for (const [day, b] of last) if (daily.get(day) && priceSame(daily.get(day).c, b.c)) same += 1
    expect(last.size).toBe(634)
    expect(same).toBe(84)
  })

  it('NOT splits or dividends: our close / theirs is 1 at the median in every year, both listings', () => {
    for (const [s, v] of [['api-bars-RDDT-tf15.json.gz', 'vw-bar-counters-rddt-15-2026-09-30'],
      ['api-bars-SPY-tf15.json.gz', 'vw-time-tf-spy-15-2026-10-01']]) {
      const ours = new Map(store(s).map((b) => [b.t, b]))
      const byYear = new Map()
      for (const b of vendor(v)) {
        const o = ours.get(b.t); if (!o) continue
        const y = etClockAt(b.t).y
        if (!byYear.has(y)) byYear.set(y, [])
        byYear.get(y).push(o.c / b.c)
      }
      for (const [, xs] of byYear) expect(median(xs)).toBe(1)
    }
  })

  it('the store keeps 4 decimals: a sub-1e-4 difference is its precision, not another price', () => {
    for (const b of rddt15()) for (const k of ['o', 'h', 'l', 'c']) expect(Math.abs(b[k] * 1e4 - Math.round(b[k] * 1e4))).toBeLessThan(1e-6)
    expect(priceSame(59.9737, 59.973744)).toBe(true)
    expect(priceSame(50.12, 50.11)).toBe(false)
  })
})

describe('LTF · 3. the rule', () => {
  const served = (reach) => Object.fromEntries(Object.keys(EVIDENCE).map((code) =>
    [code, FIELDS.filter((f) => fieldServes(code, f, reach).ok).join('')]))

  it('⭐ what serves, from the evidence and the bar: time everywhere; open / high / low at a few codes; close and volume NOWHERE', () => {
    expect(BAR).toEqual({ share: 1, minSessions: 40, listings: ['RDDT', 'SPY'] })
    expect(served(0)).toEqual({ 5: 'tohl', 15: 'tol', 60: 'to', 240: 't' })
    // a read that reaches back consumes every intrabar in its reach: only time is equal on every one
    expect(served(1)).toEqual({ 5: 't', 15: 't', 60: 't', 240: 't' })
    expect(served(Infinity)).toEqual(served(1))
  })

  it('⛔ the refusal names the field, the listing, the numbers and the cause', () => {
    const r = fieldServes('15', 'c', 0)
    expect(r.ok).toBe(false)
    expect(r.line).toContain('close of the session\'s last `15` bar equals TradingView\'s on 613 / 632 RDDT sessions')
    expect(r.line).toContain('different trade')
    expect(fieldServes('60', 'v', 0).line).toContain('volume')
    expect(fieldServes('60', 'v', 0).line).toContain('subset of the consolidated volume')
    expect(fieldServes('15', 'o', 3).line).toContain('official opening print')
    expect(fieldServes('30', 'c', 0).line).toContain('was not measured')
  })

  it('⛔ CONTROLS — one unequal value, a short sample, a lowered bar each turn the answer', () => {
    const one = JSON.parse(JSON.stringify(EVIDENCE))
    one['15'].last.SPY.o = [125, 126]
    expect(fieldServes('15', 'o', 0).ok).toBe(true)
    expect(fieldServes('15', 'o', 0, one).ok).toBe(false)
    const short = JSON.parse(JSON.stringify(EVIDENCE))
    short['5'].sessions.SPY = 39
    expect(fieldServes('5', 't', 0, short).ok).toBe(false)
    expect(fieldServes('5', 't', 0, short).line).toContain('fewer than 40')
    expect(fieldServes('15', 'c', 0, EVIDENCE, { ...BAR, share: 0.9 }).ok).toBe(true)
  })

  it('demand: what a child reads and how far back', () => {
    const d = (f) => demandOf(parseFormula(f).ast)
    expect(d('close')).toEqual({ fields: ['c'], reach: 0 })
    expect(d('time').fields).toEqual(['t'])
    expect(d('hour').fields).toEqual(['t'])
    expect(d('ema(close, 9)').reach).toBeGreaterThan(0)
    expect(d('high - low').fields).toEqual(['h', 'l'])
    expect(d('vwap()').fields).toEqual(FIELDS) // a bar reader reads every field
    expect(demandOf({ type: 'mystery', args: [] }).fields).toEqual(FIELDS) // fail closed
  })

  const ltf = (code, formula) => ({ type: 'ltf', value: code, args: [parseFormula(formula).ast] })
  const docOf = (...reads) => ({ id: 'u_l', meta: { recurrenceOrigin: 'pine', lowerTf: [...new Set(reads.map((r) => r.value))] },
    outputs: reads.map((ast) => ({ ast })) })
  const bars15 = () => store('api-bars-RDDT-tf15.json.gz')

  it('⭐ a code is served only when EVERY read at it passes — one close read refuses the code by name', () => {
    expect(lowerTfStoreRefusal(docOf(ltf('15', 'time'), ltf('15', 'low')), '15')).toBe(null)
    const r = lowerTfStoreRefusal(docOf(ltf('15', 'time'), ltf('15', 'close')), '15')
    expect(r.code).toBe(STORE_DISAGREES)
    expect(r.why).toContain('reads close from our intraday bars')
    expect(lowerTfStoreRefusal(docOf(ltf('15', 'ema(low, 9)')), '15').why).toContain('intrabars of history')
    // a stamped code with no read found: refused, never assumed
    expect(lowerTfStoreRefusal({ meta: { lowerTf: ['15'] } }, '15').code).toBe(STORE_DISAGREES)
  })

  it('⭐ the bind: OUR bars are refused for a close read and supplied nothing; TradingView\'s are served', () => {
    const doc = docOf(ltf('60', 'close'))
    const ours = resolveLowerTf(doc, { tf: 'D', lowerTf: new Map([['15', { bars: bars15(), status: 'available' }]]) })
    expect(ours.served).toEqual([])
    expect(ours.supply).toEqual({})
    expect(ours.refused.map((x) => x.refusal)).toEqual([R.STORE_DISAGREES])
    expect(ours.refused[0].reason).toContain('613 / 632 RDDT sessions')
    const theirs = resolveLowerTf(doc, { tf: 'D',
      lowerTf: new Map([['15', { bars: bars15(), status: 'available', origin: TRADINGVIEW_ORIGIN }]]) })
    expect(theirs.served).toEqual(['60'])
    // control — a read the store CAN serve is served from our bars
    const time = resolveLowerTf(docOf(ltf('60', 'time')), { tf: 'D',
      lowerTf: new Map([['15', { bars: bars15(), status: 'available' }]]) })
    expect(time.served).toEqual(['60'])
  })
})
