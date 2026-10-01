// ─── ⭐⭐ C29 (C26) — a bare ticker, and a class share, through the member door ───
//
// Read off `vw-other-symbol-rddt-1d-2026-09-30.json` (probe `vw-other-symbol.pine`,
// NYSE:RDDT 1D from the listing): TradingView read bare `"SPY"` as the same series
// as `"AMEX:SPY"`, and bare `"BRK.B"` as `"NYSE:BRK.B"`, on every one of its 634
// bars. The member door now serves all four spellings, each from our store's one
// listing (`SPY` on NYSE Arca, `BRK-B` on NYSE), and each plot is the vendor's own
// value on every bar whose other-symbol bars the harness holds (the committed SPY
// and BRK.B captures — `ourSide.js` unions every capture of a listing).

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide } from './ourSide'
import { resolveOtherSymbols, storeTickerOf, OTHER_SYMBOL_REFUSAL as R } from '../../otherSymbols'

// ⚠️ the capture index build (every committed capture) is slow under a loaded run.
vi.setConfig({ testTimeout: 60000 })

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const cap = JSON.parse(fs.readFileSync(path.join(H, 'vw-other-symbol-rddt-1d-2026-09-30.json'), 'utf8'))
const vend = (() => {
  const titleOf = new Map(cap.study.plots.map((p) => [p.id, p.title]))
  const out = new Map()
  cap.plotValues.fields.forEach((f, i) => { if (f !== 'time') out.set(titleOf.get(f), cap.plotValues.rows.map((r) => r[i])) })
  return out
})()

describe('C29 — bare "SPY" and bare "BRK.B" are served, and read TradingView\'s series', () => {
  it('the capture itself: bare == prefixed on all 634 bars, and the label prints SPY\'s close', () => {
    expect(cap.history.startsAtBar0).toBe(true)
    expect(vend.get('O04_bare_eq_amex').every((v) => v === 1)).toBe(true)
    expect(vend.get('O07_brkb_bare_eq_nyse').every((v) => v === 1)).toBe(true)
    expect(vend.get('O02_SPY_bare').length).toBe(634)
  })

  it('every served plot equals the vendor wherever the harness holds the other listing\'s bars', () => {
    const ours = runOurSide(cap)
    expect(ours.ok, ours.refusal).toBe(true)
    for (const t of ['SPY', 'BRK.B']) expect(ours.notes).toContain(`other symbol ${t}: served`)
    const byTitle = new Map(ours.plots.map((p) => [p.title, p]))
    const counts = {}
    for (const t of ['O02_SPY_bare', 'O03_AMEX_SPY', 'O05_BRKB_bare', 'O06_NYSE_BRKB']) {
      const col = Array.from(byTitle.get(t).column)
      const v = vend.get(t)
      let n = 0
      for (let i = 0; i < v.length; i++) {
        if (!Number.isFinite(col[i])) continue
        expect(col[i], `${t} bar ${i}`).toBe(v[i])
        n++
      }
      counts[t] = n
    }
    // bare and prefixed read the SAME bars, and cover what the committed captures hold
    expect(counts.O02_SPY_bare).toBe(counts.O03_AMEX_SPY)
    expect(counts.O05_BRKB_bare).toBe(counts.O06_NYSE_BRKB)
    expect(counts.O02_SPY_bare).toBeGreaterThanOrEqual(632)
    expect(counts.O05_BRKB_bare).toBeGreaterThanOrEqual(250)
    expect(ours.objects.texts.labels).toEqual(['762.63'])
  })

  it('the class share maps to the store key, and a bare ticker our store does not hold stays refused by name', () => {
    expect(storeTickerOf('BRK.B')).toBe('BRK-B')
    expect(storeTickerOf('SPY')).toBe('SPY')
    const def = { meta: { recurrenceOrigin: 'pine', otherSymbols: [
      { ticker: 'XAUUSD', spellings: [''] }, { ticker: 'SPY', spellings: [''] }, { ticker: 'BRK-B', spellings: ['NYSE'] }] } }
    const bars = [{ t: '2026-09-30', o: 1, h: 1, l: 1, c: 1, v: 1 }]
    const secondary = new Map([['SPY', { bars, status: 'available', exchange: 'NYSE Arca' }]])
    const res = resolveOtherSymbols(def, { secondary, exchangeOf: () => null })
    expect(res.served).toEqual(['SPY'])
    expect(res.refused.find((r) => r.ticker === 'XAUUSD').code).toBe(R.BARE)
    expect(res.refused.find((r) => r.ticker === 'BRK-B').code).toBe(R.CLASS_SHARE)
    // ⛔ a bare ticker TradingView may resolve to an index/commodity is refused even
    // when our store holds an equity of that name (`GOLD` is Barrick on NYSE)
    const gold = resolveOtherSymbols({ meta: { recurrenceOrigin: 'pine', otherSymbols: [{ ticker: 'GOLD', spellings: [''] }] } },
      { secondary: new Map([['GOLD', { bars, status: 'available', exchange: 'NYSE' }]]), exchangeOf: () => null })
    expect(gold.served).toEqual([])
    expect(gold.refused[0].code).toBe(R.BARE)
  })
})
