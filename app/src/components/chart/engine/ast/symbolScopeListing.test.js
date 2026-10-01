// ─── ⭐⭐ C29 — the listing fields, held to the 2026-09-30 syminfo captures ─────
//
// `symbolScope.json::listing_fields` serves `syminfo.root`, `basecurrency`,
// `currency`, `timezone`, `session` and `pointvalue` per witnessed exchange. This
// rail reads the NEW captures (`tests/fixtures/vendor/harness/syminfo-roster-*-
// 2026-09-30.json`) two ways, never a typed copy of their numbers:
//
//   1. every row's value is what the vendor printed on every bar of every
//      witness capture (the probe asks each field in the member's own operator);
//   2. the probe itself, run through the MEMBER DOOR on each capture's own bars
//      and symbol, plots what TradingView plotted, bar for bar — and `type`
//      (SPY is a fund, AAPL a stock, our store cannot tell) stays refused.
//
// The crypto capture (BITSTAMP:BTCUSD) is the control: its exchange has no row,
// so nothing is served there, and the vendor's own answers differ (Etc/UTC, a
// 3-character base) — the fields are not constants of Pine.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import SYMBOL_SCOPE from './symbolScope.json'
import { symbolConstants, SYMBOL_LISTING_FIELDS } from './bind'
import { BUILTIN_SYMBOL_UNSERVED } from './pine'
import { runOurSide } from '../__tests__/vendorHarness/ourSide'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAPTURES = fs.readdirSync(H).filter((n) => /^syminfo-roster-.*-2026-09-30\.json$/.test(n)).sort()
const load = (n) => JSON.parse(fs.readFileSync(path.join(H, n), 'utf8'))
const byPro = new Map(CAPTURES.map((n) => { const c = load(n); return [c.symbol.pro_name, { n, c }] }))

/** Title → column of the vendor's plot values. */
function vendorColumns(cap) {
  const titleOf = new Map(cap.study.plots.map((p) => [p.id, p.title]))
  const out = new Map()
  cap.plotValues.fields.forEach((f, i) => {
    if (f === 'time') return
    out.set(titleOf.get(f), cap.plotValues.rows.map((r) => r[i]))
  })
  return out
}

/** What each probe row MUST read, derived from a row's served fields. */
function expectedFromFields(f, ticker) {
  const root = f.root === '=ticker' ? ticker : f.root
  return {
    S1_base_eq_USD: f.basecurrency === 'USD' ? 1 : 0,
    S2_base_eq_EMPTY: f.basecurrency === '' ? 1 : 0,
    S3_len_base: f.basecurrency.length,
    S4_curr_eq_USD: f.currency === 'USD' ? 1 : 0,
    S5_len_curr: f.currency.length,
    S9_tz_eq_NY: f.timezone === 'America/New_York' ? 1 : 0,
    S10_tz_eq_UTC: f.timezone === 'Etc/UTC' ? 1 : 0,
    S11_tz_eq_Exchange: f.timezone === 'Exchange' ? 1 : 0,
    S12_len_tz: f.timezone.length,
    S13_root_eq_ticker: root === ticker ? 1 : 0,
    S14_len_root: root.length,
    S15_sess_eq_regular: f.session === 'regular' ? 1 : 0,
    S16_len_sess: f.session.length,
    S18_pointvalue: f.pointvalue,
  }
}

const rows = Object.entries(SYMBOL_SCOPE.listing_fields).filter(([k]) => !k.startsWith('_'))

describe('C29 — every listing_fields row is what TradingView printed on its witnesses', () => {
  it('there are captures and rows to check (non-vacuity)', () => {
    expect(CAPTURES.length).toBe(5)
    expect(rows.length).toBeGreaterThan(0)
    expect(Object.keys(SYMBOL_LISTING_FIELDS).sort()).toEqual(rows.map(([k]) => k).sort())
  })
  for (const [exchange, row] of rows) {
    for (const witness of row.witnesses) {
      it(`${exchange} ← ${witness}: every bar of the capture agrees with the row`, () => {
        const hit = byPro.get(witness)
        expect(hit, `no 2026-09-30 syminfo capture of ${witness}`).toBeTruthy()
        const ticker = witness.split(':').pop()
        const want = expectedFromFields(row.fields, ticker)
        const cols = vendorColumns(hit.c)
        // the S19 control: the study evaluated
        expect(cols.get('S19_len_ticker_CONTROL').every((v) => v === ticker.length)).toBe(true)
        for (const [title, v] of Object.entries(want)) {
          const col = cols.get(title)
          expect(col, title).toBeTruthy()
          expect(col.length).toBe(300)
          expect(col.every((x) => x === v), `${witness} ${title}: vendor ${col[0]} vs row ${v}`).toBe(true)
        }
      })
    }
  }
})

describe('C29 — the member door plots the syminfo probe as TradingView did', () => {
  const SERVED = ['S1_base_eq_USD', 'S2_base_eq_EMPTY', 'S3_len_base', 'S4_curr_eq_USD', 'S5_len_curr',
    'S9_tz_eq_NY', 'S10_tz_eq_UTC', 'S11_tz_eq_Exchange', 'S12_len_tz', 'S13_root_eq_ticker', 'S14_len_root',
    'S15_sess_eq_regular', 'S16_len_sess', 'S17_mintick', 'S18_pointvalue', 'S19_len_ticker_CONTROL']
  const TYPE = ['S6_type_eq_stock', 'S7_type_eq_equity', 'S8_len_type']
  // ⭐ The member door refuses a WHOLE script that reads an unserved name, so the
  // probe as captured is refused on its three `type` rows (asserted below). The
  // served rows are graded on the same source with exactly those three lines
  // removed — every other byte is the captured probe's.
  // ⭐ And a plot constant over the whole series is HIDDEN at the member door by
  // design (`hiddenReason: 'constant'`), so every served row is read as
  // `<expr> + close * 0` — Pine's identity on a bar whose close is not na (every
  // captured bar) — which makes it a series the pane draws and the binder hands
  // points for. The FIELD is still read by the fold the product runs.
  // The pane carries at most 12 visible rows (`CARRY_MAX`), so the 16 served
  // rows are graded in two passes, each keeping only its own plot lines.
  const titleOf = (l) => { const m = l.match(/^plot\(.*, "(S\d+_[A-Za-z_]+)"\)$/); return m ? m[1] : null }
  const withoutType = (cap, keep = null) => ({
    ...cap,
    source: {
      ...cap.source,
      text: cap.source.text.split('\n').filter((l) => !l.includes('syminfo.type'))
        .filter((l) => !keep || !titleOf(l) || keep.includes(titleOf(l)))
        .map((l) => l.replace(/^plot\((.*), ("S\d+_[A-Za-z_]+")\)$/, 'plot(($1) + close * 0, $2)')).join('\n'),
    },
  })
  it('the probe as captured is refused by name on `syminfo.type`, and only on it', () => {
    const { c } = byPro.get('NASDAQ:AAPL')
    expect(c.source.text.split('\n').filter((l) => l.includes('syminfo.type')).length).toBe(3)
    const ours = runOurSide(c)
    expect(ours.ok).toBe(false)
    expect(ours.refusal).toMatch(/syminfo\.type/)
  })
  for (const pro of ['AMEX:SPY', 'NASDAQ:AAPL', 'NYSE:BRK.B', 'NYSE:F']) {
    it(`${pro}: every served row equals the vendor on all 300 bars`, () => {
      const { c } = byPro.get(pro)
      const vend = vendorColumns(c)
      const plots = []
      for (const half of [SERVED.slice(0, 8), SERVED.slice(8)]) {
        const ours = runOurSide(withoutType(c, half))
        expect(ours.ok, ours.refusal).toBe(true)
        plots.push(...ours.plots)
      }
      const byTitle = new Map(plots.map((p) => [p.title, p]))
      let compared = 0
      for (const t of SERVED) {
        const p = byTitle.get(t)
        expect(p && p.column, `${pro} ${t}: ${p && p.missingReason}`).toBeTruthy()
        const col = Array.from(p.column)
        const v = vend.get(t)
        for (let i = 0; i < v.length; i++) {
          expect(col[i], `${pro} ${t} bar ${i}`).toBeCloseTo(v[i], 12)
          compared++
        }
      }
      expect(compared).toBe(SERVED.length * 300)
      for (const t of TYPE) expect(byTitle.has(t)).toBe(false)
    })
  }

  it('control — BITSTAMP:BTCUSD has no row: nothing listing-scoped is served there', () => {
    const { c } = byPro.get('BITSTAMP:BTCUSD')
    const ours = runOurSide(withoutType(c))
    expect(ours.ok, ours.refusal).toBe(true)
    const byTitle = new Map(ours.plots.map((p) => [p.title, p]))
    for (const t of ['S2_base_eq_EMPTY', 'S4_curr_eq_USD', 'S9_tz_eq_NY', 'S13_root_eq_ticker',
      'S15_sess_eq_regular', 'S18_pointvalue']) {
      const p = byTitle.get(t)
      const col = p && p.column ? Array.from(p.column) : null
      expect(col === null || col.every(Number.isNaN), `${t} served on an unwitnessed exchange`).toBe(true)
    }
    // and the vendor's own answers differ from the US rows — they are not Pine constants
    const v = vendorColumns(c)
    expect(v.get('S9_tz_eq_NY')[0]).toBe(0)
    expect(v.get('S3_len_base')[0]).toBe(3)
  })

  it('the fold: served per witnessed exchange, absent on any other', () => {
    const us = symbolConstants({ ticker: 'SPY', exchange: 'NYSE Arca' })
    expect(us['syminfo.root']).toBe('SPY')
    expect(us['syminfo.basecurrency']).toBe('')
    expect(us['syminfo.timezone']).toBe('America/New_York')
    expect(us['syminfo.pointvalue']).toBe('1')
    const otc = symbolConstants({ ticker: 'LVMUY', exchange: 'OTC' })
    for (const f of ['root', 'basecurrency', 'currency', 'timezone', 'session', 'pointvalue']) {
      expect(Object.prototype.hasOwnProperty.call(otc, `syminfo.${f}`), f).toBe(false)
    }
  })

  it('`type` is still refused BY NAME, with the measurement in its sentence', () => {
    expect(BUILTIN_SYMBOL_UNSERVED['syminfo.type']).toMatch(/SPY answers a 4-character type/)
  })
})
