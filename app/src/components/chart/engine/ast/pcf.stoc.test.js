// ⭐⭐ AUDIT 2026-10-13 P0-1 — TC2000 `STOC` reads HIGH, LOW, CLOSE.
//
// TC2000's own definition (help.tc2000.com/m/69445/l/755874, "Stochastic
// Oscillator"): `K = ((C - Ln)/(Hn - Ln)) * 100`, C the latest close, Ln/Hn the
// n-period low and high; `STOC(x, y, z)` is "x=Period, y=SMA, z=Offset"
// (help.tc2000.com/m/69445/l/745531). The reader used to emit
// `stoch(close, high, low, n)` — the manifest's `stoch` is `(high, low, close, n)`
// — so every TC2000 stochastic computed a different number and was labelled
// exact. These rails check the VALUE against an independent %K written here,
// not just the tree shape, and pin the rule that a SAVED definition keeps
// computing what it computed.
import { describe, it, expect } from 'vitest'
import {
  parsePcf, legacyPcfReadings, legacyReadingOf, pcfLegacyNotice, checkSeriesRoles,
} from './pcf.js'
import { astHash } from './parse.js'
import TABLE from './closedTable.json'
import { interpret } from './interpret.js'
import { validateDefinition, legacyComputeReadings } from '../defSchema.js'

// Synthetic, deterministic bars — never market data.
function synthBars(n = 160, seed = 7) {
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
  const bars = []
  let c = 100
  for (let i = 0; i < n; i++) {
    const o = c
    c = Math.max(5, c + (rnd() - 0.5) * 4)
    const h = Math.max(o, c) + rnd() * 2
    const l = Math.min(o, c) - rnd() * 2
    bars.push({ t: 1000000000 + i * 86400, o, h, l, c, v: 1000 + Math.round(rnd() * 500) })
  }
  return bars
}

// Independent reference: TC2000's published %K, then a simple y-bar average.
function referenceStoc(bars, n, y) {
  const k = bars.map((_, i) => {
    if (i < n - 1) return NaN
    let lo = Infinity, hi = -Infinity
    for (let j = i - n + 1; j <= i; j++) { lo = Math.min(lo, bars[j].l); hi = Math.max(hi, bars[j].h) }
    return ((bars[i].c - lo) / (hi - lo)) * 100
  })
  if (y <= 1) return k
  return k.map((_, i) => {
    if (i < n - 1 + y - 1) return NaN
    let sum = 0
    for (let j = i - y + 1; j <= i; j++) sum += k[j]
    return sum / y
  })
}

const tree = (src) => {
  const r = parsePcf(src)
  expect(r.ok, r.error || src).toBe(true)
  return r.ast
}

describe('P0-1 — STOC is TC2000’s %K', () => {
  const bars = synthBars()

  it('builds stoch(high, low, close, n) in the manifest’s declared slot order', () => {
    const t = tree('STOC14.3')
    expect(t).toEqual({ type: 'call', name: 'sma', args: [
      { type: 'call', name: 'stoch', args: [
        { type: 'series', name: 'high' }, { type: 'series', name: 'low' },
        { type: 'series', name: 'close' }, { type: 'num', value: 14 }] },
      { type: 'num', value: 3 }] })
    expect(TABLE.functions.stoch.argRoles.slice(0, 3)).toEqual(['high', 'low', 'close'])
  })

  for (const [src, n, y] of [['STOC14.1', 14, 1], ['STOC14.3', 14, 3], ['STOC5.3', 5, 3]]) {
    it(`⭐ ${src} equals the published formula bar for bar, inside 0–100`, () => {
      const ours = interpret(tree(src), bars)
      const ref = referenceStoc(bars, n, y)
      let compared = 0
      for (let i = 0; i < bars.length; i++) {
        if (!Number.isFinite(ref[i])) continue
        expect(Math.abs(ours[i] - ref[i]), `${src} bar ${i}`).toBeLessThan(1e-9)
        expect(ours[i]).toBeGreaterThanOrEqual(0)
        expect(ours[i]).toBeLessThanOrEqual(100)
        compared++
      }
      expect(compared).toBeGreaterThan(100)   // non-vacuity: the comparison ran
    })
  }

  it('control: the legacy rotated reading DISAGREES with the formula (so the match above distinguishes)', () => {
    const legacy = legacyPcfReadings('STOC14.3 < 20')[0].ast.args[0]
    const old = interpret(legacy, bars)
    const ref = referenceStoc(bars, 14, 3)
    const wrong = ref.filter((v, i) => Number.isFinite(v) && Math.abs(old[i] - v) > 1).length
    expect(wrong).toBeGreaterThan(50)
  })

  it('the offset wraps the smoothed value (STOC14.3.1 is yesterday’s smoothed %K)', () => {
    const ours = interpret(tree('STOC14.3.1'), bars)
    const ref = referenceStoc(bars, 14, 3)
    for (let i = 20; i < bars.length; i++) expect(Math.abs(ours[i] - ref[i - 1])).toBeLessThan(1e-9)
  })
})

describe('P0-1 — the role rail that would have caught it', () => {
  it('refuses a fixed series that is not the series its slot names', () => {
    expect(() => checkSeriesRoles(TABLE, TABLE.functions.stoch, ['close', 'high', 'low'], 'stoch', 0, 'STOC14'))
      .toThrow(/would pass `close` where `stoch` reads its high/)
    expect(() => checkSeriesRoles(TABLE, TABLE.functions.stoch, ['high', 'low', 'close'], 'stoch', 0, 'STOC14'))
      .not.toThrow()
    // A `source` role constrains nothing.
    expect(() => checkSeriesRoles(TABLE, TABLE.functions.rsi, ['close'], 'rsi', 0, 'WRSI14')).not.toThrow()
  })
})

describe('P0-1 — a saved definition keeps computing what it computed', () => {
  const source = 'STOC14.3 < 20 AND C > AVGC50'
  const current = tree(source)
  const legacy = legacyPcfReadings(source)

  it('names exactly one legacy reading for a STOC source, and none for a source without STOC', () => {
    expect(legacy).toHaveLength(1)
    expect(legacy[0].id).toBe('pcf-reader-before-2026-10-30')
    expect(legacy[0].notice).toBe(pcfLegacyNotice(source))
    expect(astHash(legacy[0].ast)).not.toBe(astHash(current))
    // The legacy tree is byte-for-byte what the pre-fix reader emitted.
    expect(JSON.stringify(legacy[0].ast)).toContain(
      '{"type":"call","name":"stoch","args":[{"type":"series","name":"close"},{"type":"series","name":"high"},{"type":"series","name":"low"}')
    expect(legacyPcfReadings('C > AVGC50')).toEqual([])
    expect(legacyPcfReadings('sma(stoch(high, low, close, 14), 3) < 20')).toEqual([])   // native: none
  })

  it('legacyReadingOf matches the legacy tree and not the current one', () => {
    expect(legacyReadingOf(source, astHash(legacy[0].ast), astHash)).not.toBeNull()
    expect(legacyReadingOf(source, astHash(current), astHash)).toBeNull()
    expect(legacyReadingOf(source, 'not-a-hash', astHash)).toBeNull()
  })

  // A minimal `ast` definition, built the way the builder saves one.
  const defWith = (ast) => ({
    id: 'u_stoc_probe', version: 1, name: 'STOC probe', kind: 'scan',
    pane: 'overlay',
    compute: { kind: 'ast', fn: astHash(ast), source, ast, rev: 1 },
  })

  it('⭐ a definition stored with the LEGACY tree still validates on the source-rule (no blanking)', () => {
    const old = validateDefinition(defWith(legacy[0].ast))
    const cur = validateDefinition(defWith(current))
    const sourceErrors = (r) => (r.errors || []).filter((e) => /does not parse to compute\.ast/.test(e))
    expect(sourceErrors(cur)).toEqual([])
    expect(sourceErrors(old)).toEqual([])
    // Control: a tree that is NEITHER reading is still refused by the same rule.
    const other = tree('STOC9.3 < 20 AND C > AVGC50')
    expect(sourceErrors(validateDefinition(defWith(other)))).toHaveLength(1)
  })

  it('legacyComputeReadings discloses the legacy tree and is silent on the current one', () => {
    expect(legacyComputeReadings(defWith(legacy[0].ast))).toEqual([
      { where: 'compute.source', id: 'pcf-reader-before-2026-10-30', notice: pcfLegacyNotice(source) }])
    expect(legacyComputeReadings(defWith(current))).toEqual([])
    expect(legacyComputeReadings(null)).toEqual([])
  })
})

// ⭐⭐ THE SIBLING DEFECT, FOUND READING THE SAME PRIMARY SOURCE: TC2000's `ATR`
// is a SIMPLE average of true range ("Average True Range (uses simple moving
// average for smoothing)", help.tc2000.com/m/69445/l/745531; Wilder's is written
// `XAVG(ATR, 27)`, help.tc2000.com/m/69445/l/755843). The reader mapped it to the
// engine's Wilder `atr`.
function referenceTr(bars) {
  return bars.map((b, i) => (i === 0 ? NaN
    : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))))
}
function referenceAtr(bars, n) {
  const tr = referenceTr(bars)
  return tr.map((_, i) => {
    if (i < n) return NaN   // the window must not touch bar 0, which has no previous close
    let s = 0
    for (let j = i - n + 1; j <= i; j++) s += tr[j]
    return s / n
  })
}

describe('TC2000 ATR is the simple average of true range', () => {
  const bars = synthBars(200, 11)

  for (const n of [1, 5, 14]) {
    it(`⭐ ATR${n} equals the published formula bar for bar`, () => {
      const ours = interpret(tree(`ATR${n}`), bars)
      const ref = referenceAtr(bars, n)
      let compared = 0
      for (let i = 0; i < bars.length; i++) {
        if (!Number.isFinite(ref[i])) continue
        expect(Math.abs(ours[i] - ref[i]), `ATR${n} bar ${i}`).toBeLessThan(1e-9)
        compared++
      }
      expect(compared).toBeGreaterThan(150)
    })
  }

  it('the offset wraps the average (ATR14.2 is the ATR of two bars ago)', () => {
    const ours = interpret(tree('ATR14.2'), bars)
    const ref = referenceAtr(bars, 14)
    for (let i = 20; i < bars.length; i++) expect(Math.abs(ours[i] - ref[i - 2])).toBeLessThan(1e-9)
  })

  it('control: Wilder’s ATR (the legacy reading) is a DIFFERENT number', () => {
    const legacy = legacyPcfReadings('ATR14 > 1')
    expect(legacy).toHaveLength(1)
    const old = legacy[0].ast.args[0]
    expect(old).toEqual({ type: 'call', name: 'atr', args: [
      { type: 'series', name: 'high' }, { type: 'series', name: 'low' },
      { type: 'series', name: 'close' }, { type: 'num', value: 14 }] })
    const wilder = interpret(old, bars)
    const ref = referenceAtr(bars, 14)
    const apart = ref.filter((v, i) => Number.isFinite(v) && Number.isFinite(wilder[i])
      && Math.abs(wilder[i] - v) > 1e-6).length
    expect(apart).toBeGreaterThan(100)
    expect(legacy[0].notice).toMatch(/ATR was computed with Wilder/)
    expect(legacy[0].notice).not.toMatch(/STOC/)
  })

  it('one legacy reading covers a source using both, and names both', () => {
    const src = 'STOC14.3 < 20 AND ATR14 > 1'
    const [r] = legacyPcfReadings(src)
    expect(r.notice).toMatch(/STOC was given/)
    expect(r.notice).toMatch(/ATR was computed/)
    const json = JSON.stringify(r.ast)
    expect(json).toContain('"name":"atr"')
    expect(json).toContain('{"type":"call","name":"stoch","args":[{"type":"series","name":"close"}')
  })
})
