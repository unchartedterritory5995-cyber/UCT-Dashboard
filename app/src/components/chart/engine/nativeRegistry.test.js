// app/src/components/chart/engine/nativeRegistry.test.js
//
// The native registry's contract, in the order it matters:
//   1. every entry is a VALID definition (it would be at import time too — the
//      module throws on a malformed native — but a test names WHICH one),
//   2. the definition and the compute adapter AGREE (declared plot keys ==
//      returned columns), which is the whole point of the adapter,
//   3. every column is input-length and NaN-padded, so `hasAnyFinite` can
//      replace `.length` as the pane-existence test,
//   4. the two bespoke behaviours that a naive adapter would silently change:
//      MACD's masked head and SAR's `isUptrend` third field.

import { describe, it, expect } from 'vitest'
import {
  NATIVE_DEFS,
  getDefinition,
  listDefinitions,
  computeFor,
  columnKeys,
  hasAnyFinite,
  registerDefinitions,
} from './nativeRegistry'
import { validateDefinition } from './defSchema'
import { computeMACD, computeRSI, computeParabolicSAR } from '../indicators'
import { CHART_DEFAULTS } from '../chartDefaults'

// ─── fixtures ────────────────────────────────────────────────────────────────

/** Deterministic OHLCV walk. Not random: a fixed LCG so a failure is repeatable. */
function makeBars(n, seed = 7) {
  const bars = []
  let px = 100
  let s = seed
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  for (let i = 0; i < n; i++) {
    const o = px
    const c = Math.max(1, o + (rnd() - 0.48) * 2)
    const h = Math.max(o, c) + rnd() * 0.8
    const l = Math.max(0.5, Math.min(o, c) - rnd() * 0.8)
    bars.push({ t: 1780000000 + i * 86400, o, h, l, c, v: Math.round(1e6 + rnd() * 5e5) })
    px = c
  }
  return bars
}

/**
 * The largest bar count at which each native computes NOTHING, at its DEFAULT
 * inputs — i.e. one short of its first computable series.
 *
 * Hand-written from each guard in `indicators.js` on purpose: a table derived
 * from the code it checks would agree with a bug. The boundary test below adds
 * one bar and demands a finite value, so a number that is too LARGE fails too —
 * the table cannot be quietly loosened.
 */
const TOO_SHORT = {
  rsi: 14,        // needs period + 1 = 15
  macd: 34,       // needs slowPeriod + signalPeriod = 35
  bb: 19,         // needs period = 20
  vwap: 0,        // computes from bar 0 — its only degenerate input is none
  stoch: 13,      // needs kPeriod = 14
  atr: 14,        // needs period + 1 = 15
  sar: 1,         // needs 2 (bar 0 seeds the trend)
  ichimoku: 51,   // needs senkouBPeriod = 52
  mfi: 14,        // needs period + 1 = 15
  cci: 19,        // needs period = 20
  williamsR: 13,  // needs period = 14
  adx: 27,        // needs 2 * period = 28
  obv: 0,         // computes from bar 0 (seeded 0), like VWAP
  donchian: 19,   // needs period = 20
}

const BARS = makeBars(300)

// ─── the registry itself ─────────────────────────────────────────────────────

describe('native registry — membership', () => {
  it('lists exactly the 14 natives that have a compute function', () => {
    expect(listDefinitions().map(d => d.id).sort()).toEqual([
      'adx', 'atr', 'bb', 'cci', 'donchian', 'ichimoku', 'macd', 'mfi',
      'obv', 'rsi', 'sar', 'stoch', 'vwap', 'williamsR',
    ])
  })

  it('does NOT include volumeProfile — it is a canvas overlay, not a definition', () => {
    expect(listDefinitions().some(d => d.id === 'volumeProfile')).toBe(false)
    expect(getDefinition('volumeProfile')).toBe(null)
    // …and it IS a shipped indicator, so its absence is a carve-out, not an oversight.
    expect(CHART_DEFAULTS.indicators.volumeProfile).toBeDefined()
  })

  it('getDefinition returns null for an unknown id and the def for a known one', () => {
    expect(getDefinition('nope')).toBe(null)
    expect(getDefinition('rsi').id).toBe('rsi')
    expect(NATIVE_DEFS.length).toBe(listDefinitions().length)
  })
})

describe.each(NATIVE_DEFS.map(d => [d.id, d]))('native "%s"', (id, def) => {
  it('is a valid definition', () => {
    const r = validateDefinition(def)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })

  it('mirrors CHART_DEFAULTS.indicators — migration must be a no-op', () => {
    const legacy = CHART_DEFAULTS.indicators[id]
    expect(legacy, `no CHART_DEFAULTS.indicators.${id}`).toBeDefined()
    const byKey = new Map(def.inputs.map(i => [i.key, i]))
    for (const [k, v] of Object.entries(legacy)) {
      if (k === 'enabled') continue   // enablement is an instance fact, not an input
      expect(byKey.has(k), `${id}: no input for legacy key "${k}"`).toBe(true)
      expect(byKey.get(k).default, `${id}.${k}`).toEqual(v)
    }
  })

  it('returns exactly one column per data-bearing plot key', () => {
    const cols = computeFor(def, BARS, {})
    expect(Object.keys(cols).sort()).toEqual([...columnKeys(def)].sort())
  })

  it('returns input-length columns of plain numbers', () => {
    const cols = computeFor(def, BARS, {})
    for (const [key, col] of Object.entries(cols)) {
      expect(col.length, `${id}.${key} length`).toBe(BARS.length)
      for (let i = 0; i < col.length; i++) {
        expect(typeof col[i], `${id}.${key}[${i}]`).toBe('number')
      }
    }
  })

  it('a computable series has a finite value in every column', () => {
    const cols = computeFor(def, BARS, {})
    for (const [key, col] of Object.entries(cols)) {
      expect(hasAnyFinite(col), `${id}.${key}`).toBe(true)
    }
  })

  it('a too-short series yields all-NaN columns with hasAnyFinite false', () => {
    const n = TOO_SHORT[id]
    const cols = computeFor(def, makeBars(n), {})
    for (const [key, col] of Object.entries(cols)) {
      expect(col.length, `${id}.${key} length`).toBe(n)
      expect(hasAnyFinite(col), `${id}.${key}`).toBe(false)
      for (let i = 0; i < col.length; i++) expect(Number.isNaN(col[i])).toBe(true)
    }
  })

  it('ONE more bar makes it computable — the boundary is exact', () => {
    const cols = computeFor(def, makeBars(TOO_SHORT[id] + 1), {})
    expect(Object.values(cols).some(hasAnyFinite), `${id} still empty`).toBe(true)
  })
})

// ─── the two bespoke behaviours ──────────────────────────────────────────────

describe('MACD head-mask (StockChart.jsx:3952-3965 — the B1 pixel-parity hold)', () => {
  it('masks the MACD line back to the signal\'s first bar, element for element', () => {
    const def = getDefinition('macd')
    const raw = computeMACD(BARS, 12, 26, 9)
    const sigStart = raw.signal.findIndex(p => Number.isFinite(p.value))
    expect(sigStart).toBeGreaterThan(0)   // otherwise this test proves nothing
    const expected = raw.macd.map((p, i) => (i < sigStart ? NaN : p.value))

    const got = computeFor(def, BARS, {})
    expect(got.macd.length).toBe(expected.length)
    for (let i = 0; i < expected.length; i++) {
      if (Number.isNaN(expected[i])) expect(Number.isNaN(got.macd[i]), `macd[${i}]`).toBe(true)
      else expect(got.macd[i], `macd[${i}]`).toBe(expected[i])
    }
    // The mask is a HOLD, not a no-op: the unmasked line really is longer.
    expect(Number.isFinite(raw.macd[sigStart - 1].value)).toBe(true)
    expect(Number.isNaN(got.macd[sigStart - 1])).toBe(true)
  })

  it('leaves signal and histogram untouched', () => {
    const got = computeFor(getDefinition('macd'), BARS, {})
    const raw = computeMACD(BARS, 12, 26, 9)
    for (let i = 0; i < BARS.length; i++) {
      const s = raw.signal[i].value
      if (Number.isFinite(s)) expect(got.signal[i]).toBe(s)
      else expect(Number.isNaN(got.signal[i])).toBe(true)
    }
  })
})

describe('Parabolic SAR', () => {
  it('does not leak isUptrend into any column', () => {
    const def = getDefinition('sar')
    const cols = computeFor(def, BARS, {})
    expect(Object.keys(cols)).toEqual(['sar'])
    expect(JSON.stringify(Object.keys(cols))).not.toMatch(/isUptrend/)
    const raw = computeParabolicSAR(BARS, 0.02, 0.2)
    expect(raw.some(p => 'isUptrend' in p)).toBe(true)   // it IS there upstream
    for (let i = 0; i < BARS.length; i++) {
      const v = raw[i].value
      if (Number.isFinite(v)) expect(cols.sar[i]).toBe(v)
      else expect(Number.isNaN(cols.sar[i])).toBe(true)
    }
  })
})

// ─── inputs ──────────────────────────────────────────────────────────────────

describe('computeFor inputs', () => {
  it('honours a supplied input over the declared default', () => {
    const def = getDefinition('rsi')
    const got = computeFor(def, BARS, { period: 7 })
    const want = computeRSI(BARS, 7)
    const dflt = computeRSI(BARS, 14)
    expect(got.rsi[10]).toBe(want[10].value)
    expect(got.rsi[10]).not.toBe(dflt[10].value)
  })

  it('falls back to the declared defaults for anything not supplied', () => {
    const def = getDefinition('rsi')
    const a = computeFor(def, BARS, {})
    const b = computeFor(def, BARS, { period: 14 })
    expect(Array.from(a.rsi)).toEqual(Array.from(b.rsi))
  })

  it('throws loudly on a definition whose compute fn is not a native', () => {
    const def = { ...getDefinition('rsi'), compute: { kind: 'native', fn: 'nope', rev: 1 } }
    expect(() => computeFor(def, BARS, {})).toThrow(/nope/)
  })
})

// ─── hasAnyFinite — the pane-existence test (trap #4) ────────────────────────

describe('hasAnyFinite', () => {
  it('is false for empty, all-NaN and non-array input', () => {
    expect(hasAnyFinite([])).toBe(false)
    expect(hasAnyFinite([NaN, NaN, NaN])).toBe(false)
    expect(hasAnyFinite(new Float64Array(5).fill(NaN))).toBe(false)
    expect(hasAnyFinite(null)).toBe(false)
    expect(hasAnyFinite(undefined)).toBe(false)
  })

  it('is true as soon as one value is finite, wherever it sits', () => {
    expect(hasAnyFinite([NaN, NaN, 1])).toBe(true)
    expect(hasAnyFinite([0])).toBe(true)              // 0 is a value, not a gap
    expect(hasAnyFinite([-100, NaN])).toBe(true)
  })

  it('rejects Infinity — it is not a plottable value', () => {
    expect(hasAnyFinite([Infinity, -Infinity])).toBe(false)
  })
})

// ─── registration-time cross-definition checks (Task 1 carry-in (b)) ─────────

const sourceDef = (defaultValue) => ({
  schemaVersion: 1, id: 'probe', version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Probe', tier: 'free' },
  placement: { target: 'pane' },
  inputs: [{ key: 'src', type: 'source', label: 'Source', default: defaultValue }],
  plots: [{ key: 'out', style: 'line', color: '#fff' }],
})

describe('registerDefinitions — source referents are resolved against the registry', () => {
  it('accepts a bar field', () => {
    const r = registerDefinitions([sourceDef('close')])
    expect(r.errors, JSON.stringify(r.errors)).toEqual([])
  })

  it('accepts a defId.plotKey that exists in the same batch', () => {
    const r = registerDefinitions([...NATIVE_DEFS, sourceDef('rsi.rsi')])
    expect(r.errors, JSON.stringify(r.errors)).toEqual([])
  })

  it('REJECTS a source pointing at a definition that does not exist', () => {
    const r = registerDefinitions([sourceDef('nope.thing')])
    expect(r.errors.join(' ')).toMatch(/nope/)
    expect(r.defs.some(d => d.id === 'probe')).toBe(false)
  })

  it('REJECTS a source pointing at a real definition but a plot it does not declare', () => {
    const r = registerDefinitions([...NATIVE_DEFS, sourceDef('rsi.notAPlot')])
    expect(r.errors.join(' ')).toMatch(/notAPlot/)
  })

  it('REJECTS a source that is neither a bar field nor defId.plotKey', () => {
    const r = registerDefinitions([sourceDef('whatever')])
    expect(r.errors.join(' ')).toMatch(/whatever/)
  })
})
