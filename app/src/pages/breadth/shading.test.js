import { describe, it, expect } from 'vitest'
import { shadeFor, SHADE_PCTS, SHADE_SPEC, SHADE_CUTOFFS, isBacktestedRow, isBacktestedCell } from './shading'

// Synthetic cutoffs only — never real market values in a test.
const GRID = [0.5, 1, 2, 3, 5, 7.5, 10, 15, 20]
// A column ranked 0..100: the p% tail sits at p (low) and 100 - p (high).
const ramp = () => ({ n: 1000, mid: 50, lo: GRID.map(p => p), hi: GRID.map(p => 100 - p) })
const cut = { grid: GRID, cols: { a: ramp(), vixish: ramp(), cnnish: ramp(), dn: ramp(), base_pct: ramp(), r: ramp() } }
const spec = {
  pcts: { notable: 10, strong: 3, extreme: 0.5 },
  cols: {
    a: { bull: 'high', sides: 'both' },
    vixish: { bull: 'low', sides: 'both' },
    cnnish: { bull: 'low', sides: 'both', floors: { high: 75, low: 25 } },
    dn: { bull: 'low', sides: 'high' },
    close: { bull: 'high', sides: 'both', basis: 'base_pct' },
    r: { bull: 'high', sides: 'both', floors: { high: 70, low: 30 } },
    ftd: { kind: 'flag' },
    s2: { kind: 'pair', with: 's4', side: 'up' },
    s4: { kind: 'pair', with: 's2', side: 'down' },
  },
}
const at = (key, row) => shadeFor(key, row, { specIn: spec, cut })

describe('shadeFor — rarity levels', () => {
  it('leaves the middle 80% unshaded', () => {
    expect(at('a', { a: 50 })).toBeNull()
    expect(at('a', { a: 89 })).toBeNull()
    expect(at('a', { a: 11 })).toBeNull()
  })
  it('Notable / Strong / Extreme at the 10 / 3 / 0.5% tails, both ends', () => {
    expect(at('a', { a: 90 })).toEqual({ tone: 'bull', level: 1 })
    expect(at('a', { a: 97 })).toEqual({ tone: 'bull', level: 2 })
    expect(at('a', { a: 99.5 })).toEqual({ tone: 'bull', level: 3 })
    expect(at('a', { a: 10 })).toEqual({ tone: 'bear', level: 1 })
    expect(at('a', { a: 3 })).toEqual({ tone: 'bear', level: 2 })
    expect(at('a', { a: 0.5 })).toEqual({ tone: 'bear', level: 3 })
  })
  it('colors by meaning: high VIX-like readings are bearish, low are bullish', () => {
    expect(at('vixish', { vixish: 99.9 })).toEqual({ tone: 'bear', level: 3 })
    expect(at('vixish', { vixish: 1 })).toEqual({ tone: 'bull', level: 2 })
  })
  it('a one-sided count shades only its meaningful end, as bearish', () => {
    expect(at('dn', { dn: 98 })).toEqual({ tone: 'bear', level: 2 })
    expect(at('dn', { dn: 0 })).toBeNull()
  })
  it('a trader floor makes a reading at least Strong, either end', () => {
    expect(at('r', { r: 72 })).toEqual({ tone: 'bull', level: 2 })
    expect(at('r', { r: 28 })).toEqual({ tone: 'bear', level: 2 })
    // …and never lowers a rarer reading
    expect(at('r', { r: 99.6 })).toEqual({ tone: 'bull', level: 3 })
  })
  it('contrarian fear/greed: extreme fear is bullish, extreme greed bearish', () => {
    expect(at('cnnish', { cnnish: 20 })).toEqual({ tone: 'bull', level: 2 })
    expect(at('cnnish', { cnnish: 80 })).toEqual({ tone: 'bear', level: 2 })
  })
  it('shipped spec: sentiment shows the mood (fear = bearish), matching VIX (owner 11-19)', () => {
    expect(SHADE_SPEC.cols.cnn_fear_greed.bull).toBe('high')
  })
  it('a basis column ranks another field (closes by day %)', () => {
    expect(at('close', { close: 1, base_pct: 99 })).toEqual({ tone: 'bull', level: 2 })
    expect(at('close', { close: 99, base_pct: 50 })).toBeNull()
  })
  it('a flag is Strong when set', () => {
    expect(at('ftd', { ftd: 1 })).toEqual({ tone: 'bull', level: 2 })
    expect(at('ftd', { ftd: 0 })).toBeNull()
  })
  it('pairs keep their share rule, never Extreme', () => {
    expect(at('s2', { s2: 75, s4: 25 })).toEqual({ tone: 'bull', level: 2 })
    expect(at('s2', { s2: 62, s4: 38 })).toEqual({ tone: 'bull', level: 1 })
    expect(at('s4', { s2: 25, s4: 75 })).toEqual({ tone: 'bear', level: 2 })
    expect(at('s4', { s2: 55, s4: 45 })).toBeNull()
  })
  it('missing values or columns are unshaded', () => {
    expect(at('a', { a: null })).toBeNull()
    expect(at('nope', { nope: 1 })).toBeNull()
    expect(at('a', null)).toBeNull()
  })
})

describe('the shipped spec and cutoffs', () => {
  it('SHADE_PCTS is the spec, ordered notable > strong > extreme, all on the cutoffs grid', () => {
    expect(SHADE_PCTS).toBe(SHADE_SPEC.pcts)
    expect(SHADE_PCTS.notable).toBeGreaterThan(SHADE_PCTS.strong)
    expect(SHADE_PCTS.strong).toBeGreaterThan(SHADE_PCTS.extreme)
    for (const p of Object.values(SHADE_PCTS)) expect(SHADE_CUTOFFS.grid).toContain(p)
  })
  it('every cutoff row is well formed (shape only — no values asserted)', () => {
    const n = SHADE_CUTOFFS.grid.length
    for (const [, t] of Object.entries(SHADE_CUTOFFS.cols)) {
      expect(t.lo).toHaveLength(n)
      expect(t.hi).toHaveLength(n)
      expect(Number.isFinite(t.mid)).toBe(true)
      // tails are monotone toward the middle
      for (let i = 1; i < n; i++) {
        expect(t.lo[i]).toBeGreaterThanOrEqual(t.lo[i - 1])
        expect(t.hi[i]).toBeLessThanOrEqual(t.hi[i - 1])
      }
    }
  })
  it('every ranked spec column names a direction and valid sides', () => {
    for (const [, c] of Object.entries(SHADE_SPEC.cols)) {
      if (c.kind) continue
      expect(['high', 'low']).toContain(c.bull)
      expect(['both', 'high', 'low']).toContain(c.sides)
    }
  })
})

describe('shadeFor — signed columns color by sign (owner 2026-11-19)', () => {
  // A bull-leaning signed column: most days positive, so even the low tail is above zero.
  const lean = { n: 1000, mid: 40, lo: [-200, -150, -90, -60, -20, 5, 10, 15, 20], hi: [400, 350, 300, 250, 200, 150, 120, 90, 70] }
  const zc = { grid: GRID, cols: { nh: lean } }
  const zs = { pcts: { notable: 10, strong: 3, extreme: 0.5 }, cols: { nh: { bull: 'high', sides: 'both', zero: true } } }
  const z = (v) => shadeFor('nh', { nh: v }, { specIn: zs, cut: zc })
  it('a small positive reading is never red, even in the low tail of history', () => {
    expect(z(1)).toBeNull()
    expect(z(8)).toBeNull()
  })
  it('a small negative reading stays unshaded too', () => {
    expect(z(-4)).toBeNull()
    expect(z(-100)).toBeNull()
  })
  it('strength still comes from rarity, on the side of the sign', () => {
    expect(z(120)).toEqual({ tone: 'bull', level: 1 })
    expect(z(250)).toEqual({ tone: 'bull', level: 2 })
    expect(z(400)).toEqual({ tone: 'bull', level: 3 })
    expect(z(-120)).toEqual({ tone: 'bear', level: 1 })
    expect(z(-250)).toEqual({ tone: 'bear', level: 2 })
    expect(z(-400)).toEqual({ tone: 'bear', level: 3 })
  })
  it('zero is unshaded; shipped spec marks NH-NL, A/D and McClellan as signed', () => {
    expect(z(0)).toBeNull()
    for (const k of ['net_new_high_low', 'adv_decline', 'mcclellan_osc']) expect(SHADE_SPEC.cols[k].zero).toBe(true)
  })
})

describe('shadeFor — counts ranked as a SHARE of the universe (owner 2026-11-19)', () => {
  // Cutoffs in share units (0..1); a share of 0.30 is the 3% tail, 0.20 the 10% tail.
  const shareCut = { grid: GRID, cols: { 'dn/universe_count': { n: 1000, mid: 0.05, lo: GRID.map(() => 0), hi: [0.40, 0.38, 0.35, 0.30, 0.27, 0.24, 0.20, 0.15, 0.12] } } }
  const ps = {
    pcts: { notable: 10, strong: 3, extreme: 0.5 },
    cols: { dn: { bull: 'low', sides: 'high', per: 'universe_count', floors: { high: 500 }, shareFloors: { high: 0.19 } } },
  }
  const sh = (row, universe) => shadeFor('dn', row, { specIn: ps, cut: shareCut, universe })
  it('the same raw count shades by its share: rare in a small universe, ordinary in a big one', () => {
    expect(sh({ dn: 900, universe_count: 3000 }, 'nasdaq')).toEqual({ tone: 'bear', level: 2 })   // 30%
    expect(sh({ dn: 900, universe_count: 9000 }, 'nasdaq')).toBeNull()                            // 10%
  })
  it('the same share shades the same on every universe size', () => {
    expect(sh({ dn: 600, universe_count: 2000 }, 'us')).toEqual(sh({ dn: 1200, universe_count: 4000 }, 'us'))
  })
  it('no universe count (or zero) means no shade, never a divide-by-zero', () => {
    expect(sh({ dn: 900 }, 'nasdaq')).toBeNull()
    expect(sh({ dn: 900, universe_count: 0 }, 'nasdaq')).toBeNull()
  })
  it('floors: UCT keeps the raw-count floor, other universes the share floor', () => {
    // 520 of 4,000 = 13%: unshaded by rarity; the raw floor (500) lifts it on UCT only
    expect(sh({ dn: 520, universe_count: 4000 }, 'uct')).toEqual({ tone: 'bear', level: 2 })
    expect(sh({ dn: 520, universe_count: 4000 }, 'nasdaq')).toBeNull()
    // 19% of the universe meets the share floor elsewhere
    expect(sh({ dn: 380, universe_count: 2000 }, 'nasdaq')).toEqual({ tone: 'bear', level: 2 })
  })
  it('a signed count keeps its sign as a share', () => {
    const sc = { grid: GRID, cols: { 'nh/universe_count': { n: 1000, mid: 0, lo: GRID.map(() => -0.10), hi: GRID.map(() => 0.10) } } }
    const ss = { pcts: { notable: 10, strong: 3, extreme: 0.5 }, cols: { nh: { bull: 'high', sides: 'both', zero: true, per: 'universe_count' } } }
    expect(shadeFor('nh', { nh: -500, universe_count: 2000 }, { specIn: ss, cut: sc, universe: 'us' })?.tone).toBe('bear')
    expect(shadeFor('nh', { nh: 500, universe_count: 2000 }, { specIn: ss, cut: sc, universe: 'us' })?.tone).toBe('bull')
  })
  it('a share-ranked column never reads raw-count cutoffs (different key)', () => {
    const rawCut = { grid: GRID, cols: { dn: ramp() } }
    expect(shadeFor('dn', { dn: 99, universe_count: 100 }, { specIn: ps, cut: rawCut, universe: 'us' })).toBeNull()
  })
  it('the shipped spec ranks every count column by share, and the shipped cutoffs match', () => {
    const counts = ['up_4pct_today', 'down_4pct_today', 'up_20pct_5d', 'down_20pct_5d', 'up_25pct_quarter',
      'down_25pct_quarter', 'up_25pct_month', 'down_25pct_month', 'up_50pct_month', 'down_50pct_month',
      'magna_up', 'magna_down', 'new_52w_highs', 'new_52w_lows', 'new_20d_highs', 'new_20d_lows',
      'net_new_high_low', 'adv_decline', 'advancing', 'declining', 'near_52w_high', 'new_ath', 'hvc_52w', 'atr_ext_7']
    for (const k of counts) expect(SHADE_SPEC.cols[k].per).toBe('universe_count')
    for (const k of ['pct_above_50sma', 'ratio_5day', 'hi_ratio', 'vix', 'mcclellan_osc']) expect(SHADE_SPEC.cols[k].per).toBeUndefined()
    expect(SHADE_SPEC.cols.up_4pct_today.shareFloors.high).toBeGreaterThan(0)
    expect(SHADE_SPEC.cols.up_4pct_today.shareFloors.high).toBeLessThan(1)
    expect(SHADE_CUTOFFS.cols['up_4pct_today/universe_count']).toBeDefined()
    expect(SHADE_CUTOFFS.cols.up_4pct_today).toBeUndefined()
  })
})

// 2026-11-22 (owner): a back-tested UCT session (`_reconstructed`: today's list run backward) is
// never shaded on its per-universe columns; market-wide columns and other universes are unaffected.
describe('back-tested UCT history is never shaded', () => {
  const hot = { a: 99.9, vix: 99.9, _reconstructed: true }
  const bspec = { ...spec, cols: { ...spec.cols, vix: { bull: 'low', sides: 'both' } } }
  const bcut = { ...cut, cols: { ...cut.cols, vix: ramp() } }
  it('a per-universe column on a back-tested UCT row is unshaded', () => {
    expect(shadeFor('a', hot, { specIn: spec, cut, universe: 'uct' })).toBeNull()
    expect(shadeFor('a', { ...hot, _reconstructed: false }, { specIn: spec, cut, universe: 'uct' }))
      .toEqual({ tone: 'bull', level: 3 })
  })
  it('a market-wide column on the same row keeps its shade', () => {
    expect(shadeFor('vix', hot, { specIn: bspec, cut: bcut, universe: 'uct' })).toEqual({ tone: 'bear', level: 3 })
  })
  it('only UCT rows carry the meaning', () => {
    expect(isBacktestedRow(hot, 'uct')).toBe(true)
    expect(isBacktestedRow(hot, 'nasdaq')).toBe(false)
    expect(isBacktestedCell('vix', hot, 'uct')).toBe(false)
    expect(isBacktestedRow({ a: 1 }, 'uct')).toBe(false)
  })
})
