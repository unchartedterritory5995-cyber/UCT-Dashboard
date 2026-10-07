// Completeness audit 2026-10-07, column f — the terminal panels that formatted numbers BY HAND
// (VOL, POS, OHIS, OBT, STRS, U20, BRD, ERX, ATTN, SEAS, DES; FREC and RISK in their own rows
// tests) moved onto lib/presentation/presentationPrimitives. FROZEN ORACLES: each pre-migration
// body, copied verbatim, run in process against its replacement over the domain a real row
// carries. The values no row carries — or that the old body got wrong — are pinned below so a
// change there is a decision, not drift. Same shape as pages/screener/columnDefs.compact.test.js.
import { describe, it, expect } from 'vitest'
import { formatCompactTerminal, formatCurrency, formatNumber, formatNumberMax, formatPercentAsSent } from '../../lib/presentation/presentationPrimitives'
import { count, dollars, num, pctNum, signedPct, signedPremium } from '../optionsAnalytics/optionsFormat'
import { money as tideMoney } from '../optionsAnalytics/MarketTidePanel'
import { perContract } from '../optionsAnalytics/StrategyScreensPanel'
import { ivRankText, wholeText, countText } from '../optionsAnalytics/VolPanels'
import { money as backtestMoney } from '../research/tabs/optionBacktest'
import { keyStatsText } from '../research/tabs/OverviewTab'
import { fmtInt, fmtPrice } from '../Breadth'

// ── the pre-migration bodies (verbatim; `num` is the options panels' shared helper) ──────────
const old = {
  pct: (v) => `${num(v)}%`,                                     // POS impact, OHIS, STRS cells
  pct1: (v) => `${num(v, 1)}%`,
  pct0: (v) => `${num(v, 0)}%`,
  signedPct: (v) => `${v > 0 ? '+' : ''}${num(v)}%`,            // POS NOPE / distance, OHIS actual
  count: (v) => Number(v).toLocaleString(),                     // POS / STRS / VOL counts
  straddle: (v) => `$${num(v)}`,                                // OHIS
  tideMoney: (v) => {                                           // MarketTidePanel.money (POS heatmap)
    if (v == null || Number.isNaN(Number(v))) return '—'
    const n = Number(v)
    const a = Math.abs(n)
    const s = formatCompactTerminal(a)
    return `${n < 0 ? '-' : n > 0 ? '+' : ''}$${s}`
  },
  perContract: (v) => (v == null || Number.isNaN(Number(v)) ? '—' : `$${Math.round(Number(v) * 100).toLocaleString()}`),
  blockPremium: (v) => `$${Math.round(v).toLocaleString()}`,
  backtestMoney: (v) => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
    const n = Number(v)
    return `${n < 0 ? '-' : ''}$${formatNumber(Math.round(Math.abs(n)))}`
  },
  ivRank: (v) => `${Math.round(v)}%`,
  whole: (v) => `${Math.round(v)}`,
  asSent: (v) => `${v}%`,                                       // RISK, ATTN, ERX, SEAS, BRD, U20
  entry: (v) => `$${v.toFixed(2)}`,                             // U20 chart price-line titles
  brdPrice: (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }),
  brdInt: (v) => Number(v).toLocaleString('en-US'),
  brdClose: (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }),
}

// ── the domain ───────────────────────────────────────────────────────────────────────────────
const at = (decimals, lo, hi, step) => {
  const out = []
  const k = 10 ** decimals
  for (let c = Math.round(lo * k); c <= Math.round(hi * k); c += step) out.push(c / k)
  return out
}
const magnitudes = (lo, hi) => {
  const out = []
  for (let e = Math.log10(lo); e <= Math.log10(hi); e += 0.113) {
    const b = 10 ** e
    out.push(Math.round(b), Math.round(b * 1.0049), Math.round(b * 0.9951), Math.round(b * 4.5), Math.round(b * 9.995))
  }
  return out.filter((v) => v >= lo && v <= hi)
}
const PCTS_2DP = at(2, -150, 150, 7)               // a percent the server rounds to two places
const PCTS_1DP = at(1, -150, 1500, 3)
const PCTS_0DP = at(0, -100, 100, 1)
const COUNTS = [0, 1, 7, 999, ...magnitudes(1, 5e10)]
const MONEY = [0, 1, 7, 999, ...magnitudes(1, 5e12)]
const PRICES = [...at(2, 0.01, 50, 13), ...at(2, 50, 5000, 997), 1234.5, 70500, 0.05]

describe('options panels (VOL / POS / OHIS / STRS): byte-identical on every value a row carries', () => {
  it('a percent in percent units, at 2 / 1 / 0 decimals', () => {
    for (const v of PCTS_2DP.filter((x) => Math.abs(x) >= 0.005 || x === 0)) expect([v, pctNum(v)]).toEqual([v, old.pct(v)])
    for (const v of PCTS_1DP.filter((x) => Math.abs(x) >= 0.05 || x === 0)) expect([v, pctNum(v, 1)]).toEqual([v, old.pct1(v)])
    for (const v of PCTS_0DP) expect([v, pctNum(v, 0)]).toEqual([v, old.pct0(v)])
  })
  it('a signed percent ("+" above zero, a flat 0 unsigned)', () => {
    for (const v of PCTS_2DP.filter((x) => Math.abs(x) >= 0.005 || x === 0)) expect([v, signedPct(v)]).toEqual([v, old.signedPct(v)])
  })
  it('counts (open interest, volume, delta-shares, dealer contracts)', () => {
    for (const v of [...COUNTS, ...COUNTS.map((x) => -x), 12.5, 1234.567]) {
      expect([v, count(v)]).toEqual([v, old.count(v)])
      expect([v, countText(v)]).toEqual([v, old.count(v)])
    }
  })
  it('the OHIS straddle', () => {
    for (const v of PRICES) expect([v, formatCurrency(v)]).toEqual([v, old.straddle(v)])
  })
  it('the signed premium (POS heatmap, TIDE, chain tools)', () => {
    for (const v of [...MONEY, ...MONEY.map((x) => -x)]) expect([v, tideMoney(v)]).toEqual([v, old.tideMoney(v)])
    expect(signedPremium(40000)).toBe('+$40K')
  })
  it('STRS per-contract dollars and block premium', () => {
    // a spread's per-share dollars are never negative; the negative edge is pinned below
    for (const v of at(2, 0, 60, 7)) expect([v, perContract(v)]).toEqual([v, old.perContract(v)])
    for (const v of MONEY) expect([v, dollars(v)]).toEqual([v, old.blockPremium(v)])
  })
  it('VOL: IV rank and percentile (0-100)', () => {
    for (const v of at(2, 0, 100, 1)) {
      expect([v, ivRankText(v)]).toEqual([v, old.ivRank(v)])
      expect([v, wholeText(v)]).toEqual([v, old.whole(v)])
    }
  })
})

describe('OBT: the backtest\'s money', () => {
  it('whole dollars, grouped, on every P&L a trade carries', () => {
    for (const v of [...MONEY, ...MONEY.map((x) => -x), ...at(2, -500, 500, 37)]) {
      if (v < 0 && Math.round(Math.abs(v)) === 0) continue      // pinned below
      expect([v, backtestMoney(v)]).toEqual([v, old.backtestMoney(v)])
    }
  })
})

describe('as-sent percents (RISK, ATTN, ERX, SEAS, BRD, U20)', () => {
  it('byte-identical to `${v}%` on every value a server round produces', () => {
    for (const v of [...PCTS_2DP, ...PCTS_1DP, ...PCTS_0DP, 0, 100, 150, 87.5]) {
      expect([v, formatPercentAsSent(v)]).toEqual([v, old.asSent(v)])
    }
  })
})

describe('U20 and BRD', () => {
  it('U20 entry / stop price-line titles', () => {
    for (const v of PRICES) expect([v, formatCurrency(v)]).toEqual([v, old.entry(v)])
  })
  it('BRD price, integer and S&P close cells', () => {
    for (const v of [...PRICES, ...COUNTS, 5432.1, 4999.99]) {
      expect([v, fmtPrice(v)]).toEqual([v, old.brdPrice(v)])
      expect([v, formatNumberMax(Number(v), { maxDecimals: 0 })]).toEqual([v, old.brdClose(v)])
    }
    for (const v of COUNTS) expect([v, fmtInt(v)]).toEqual([v, old.brdInt(v)])
    expect([fmtPrice(null), fmtInt(undefined)]).toEqual(['—', '—'])
  })
})

describe('the pinned edges (a change here is a decision)', () => {
  it('a missing value is ONE em dash, never "—%", "$—" or "NaN"', () => {
    expect(old.pct(null)).toBe('—%')
    expect(pctNum(null)).toBe('—')
    expect(old.straddle(null)).toBe('$—')
    expect(formatCurrency(NaN)).toBe('—')
    expect(old.count(null)).toBe('0')            // Number(null) is 0: a missing count printed "0"
    expect(count(null)).toBe('—')
    expect(old.count(undefined)).toBe('NaN')
    expect(count(undefined)).toBe('—')
    expect(old.asSent(null)).toBe('null%')
    expect(formatPercentAsSent(null)).toBe('—')
    expect(old.ivRank(null)).toBe('0%')          // a missing rank read as a real 0
    expect(ivRankText(null)).toBe('—')
  })
  it('a value that rounds to zero reads without a minus', () => {
    expect(old.pct(-0.001)).toBe('-0.00%')
    expect(pctNum(-0.001)).toBe('0.00%')
    expect(old.backtestMoney(-0.4)).toBe('-$0')
    expect(backtestMoney(-0.4)).toBe('$0')
    expect(old.tideMoney(-0.4)).toBe('-$0')
    expect(tideMoney(-0.4)).toBe('$0')
  })
  it('a currency sign sits inside the minus, and halves round away from zero', () => {
    expect(old.perContract(-1.25)).toBe('$-125')
    expect(perContract(-1.25)).toBe('-$125')
    expect(old.tideMoney(-500.5)).toBe('-$501')
    expect(tideMoney(-500.5)).toBe('-$500')      // the ladder rounds the whole-dollar tier with Math.round
    expect(old.blockPremium(-2.5)).toBe('$-2')
    expect(dollars(-2.5)).toBe('-$3')
  })
  it('DES key stats: two-place P/E, beta and 52-week levels; a percent dividend yield', () => {
    expect(keyStatsText({ forward_pe: 28.5, beta: 1.22, div_yield: 0.42, week52_low: 164.23000000000002, week52_high: 243 }))
      .toEqual({ forwardPe: '28.50', beta: '1.22', divYield: '0.42%', range: '164.23 — 243.00' })
    expect(keyStatsText({ week52_high: 70500.5 }).range).toBe('— — 70,500.50')
    expect(keyStatsText(null)).toEqual({ forwardPe: '—', beta: '—', divYield: '—', range: '— — —' })
    expect(keyStatsText({ div_yield: 1.5 }).divYield).toBe('1.50%')   // was "1.5%"
  })
})
