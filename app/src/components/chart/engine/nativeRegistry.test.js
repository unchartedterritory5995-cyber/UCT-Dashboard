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
  CARVED_OUT_INDICATOR_KEYS,
  MACD_HEAD_MASK,
  getDefinition,
  listDefinitions,
  computeFor,
  columnKeys,
  hasAnyFinite,
  registerDefinitions,
} from './nativeRegistry'
import { validateDefinition, COMPUTE_KINDS, PLOT_STYLES, RESERVED_PLOT_STYLES } from './defSchema'
import { migrateLegacyToInstances } from './instances'
// ⚠️ FROM `flipState`, NOT `StockChart`. `StockChart.jsx` re-exports this set
// (`:66`) and the B3 plan's snippet imports it from there — but flipState is
// where it is DECLARED, and the two are the same frozen Set object. Importing
// the 10k-line component (and lightweight-charts with it) into a registry test
// would buy nothing and cost the whole render tree.
import { ENGINE_MIGRATED_DEF_IDS } from './flipState'
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
//
// ⚠️ There is now only ONE. MACD's head-mask was the other, and the owner
// retired it on 2026-08-02 (decision `MACD_HEAD_MASK`) — `COLUMN_HOLDS` is empty
// and `computeFor('macd')` is a straight pass-through of the native. This block
// is kept, pointed at the post-decision truth, because "the adapter does not
// bend the maths" is the claim a future COLUMN_HOLDS entry would break, and it
// should break something here rather than only in the decision's own pin below.

describe('MACD needs NO column hold — the B1 pixel-parity mask is retired', () => {
  it('passes the native line through element for element — no head is held back', () => {
    const def = getDefinition('macd')
    const raw = computeMACD(BARS, 12, 26, 9)
    const sigStart = raw.signal.findIndex(p => Number.isFinite(p.value))
    expect(sigStart).toBeGreaterThan(0)   // otherwise this test proves nothing
    const expected = raw.macd.map(p => p.value)

    const got = computeFor(def, BARS, {})
    expect(got.macd.length).toBe(expected.length)
    for (let i = 0; i < expected.length; i++) {
      if (Number.isFinite(expected[i])) expect(got.macd[i], `macd[${i}]`).toBe(expected[i])
      else expect(Number.isNaN(got.macd[i]), `macd[${i}]`).toBe(true)
    }
    // The retired mask was a HOLD, not a no-op — the bar before the signal begins
    // is exactly the bar it used to erase, and it is now drawn.
    expect(Number.isFinite(raw.macd[sigStart - 1].value)).toBe(true)
    expect(got.macd[sigStart - 1]).toBe(raw.macd[sigStart - 1].value)
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

// ─── the carve-out (B3 carry #3, adjudication A4) ────────────────────────────
//
// `volumeProfile` has had three docstrings explaining why it has no definition
// since B1, and NONE of them failed if somebody added one. These do. The claim
// under test is an equation, not a note:
//
//     settings keys  −  engine definitions  ==  CARVED_OUT_INDICATOR_KEYS
//
// Read it in both directions. A settings key that is neither defined NOR
// declared carved-out is a hole somebody left; an id in the carve-out set that
// IS defined is a stale note that will mislead the next reader. Either way the
// arithmetic 14 + 1 = 15 stops being true, and this file goes red.
//
// ⚠️ THE LAST THREE TESTS QUANTIFY OVER THE SET, so they are vacuous on an EMPTY
// one — emptying `CARVED_OUT_INDICATOR_KEYS` is caught by the first two and by
// them alone. That is why "is exactly volumeProfile" pins the contents by hand
// instead of trusting the equation to be self-supporting. Do not delete it as
// redundant; it is what makes the others mean anything.

describe('the volumeProfile carve-out is a DECISION, not a gap (B3 carry #3)', () => {
  it('names every settings key with no definition, and nothing else', () => {
    const settingsKeys = Object.keys(CHART_DEFAULTS.indicators)
    const defined = new Set(listDefinitions().map(d => d.id))
    const undefinedKeys = settingsKeys.filter(k => !defined.has(k))
    expect(undefinedKeys.sort()).toEqual([...CARVED_OUT_INDICATOR_KEYS].sort())
    for (const k of CARVED_OUT_INDICATOR_KEYS) {
      expect(defined.has(k), `${k} is defined AND carved out`).toBe(false)
    }
  })

  it('is exactly volumeProfile, and 14 + 1 = 15', () => {
    // The count is asserted THREE ways on purpose. The equation above already
    // fails on a 16th key that nobody defined; these fail on a 16th key that
    // somebody DID define, which is the case where a new indicator lands in the
    // engine and the enumeration sites, the parity gates and this arithmetic
    // silently stop agreeing about how many there are.
    expect([...CARVED_OUT_INDICATOR_KEYS]).toEqual(['volumeProfile'])
    expect(listDefinitions()).toHaveLength(14)
    expect(Object.keys(CHART_DEFAULTS.indicators)).toHaveLength(15)
  })

  it('the migrator SKIPS a carved-out key rather than emitting an instance nothing can render', () => {
    // Generic over the SET, not hard-coded to volumeProfile: whatever is carved
    // out must be skipped, and `rsi` is here as the control that proves the
    // migrator ran at all rather than returning [] for an unrelated reason.
    const indicators = { rsi: { enabled: true } }
    for (const k of CARVED_OUT_INDICATOR_KEYS) indicators[k] = { enabled: true }
    const out = migrateLegacyToInstances({ indicators })
    expect(out.map(i => i.defId)).toEqual(['rsi'])
  })

  it('a carved-out key can never be migrated — the flip would delete the overlay', () => {
    // `ENGINE_MIGRATED_DEF_IDS` is what makes a legacy block stand down. Adding a
    // carved-out key there would silence the canvas effect for an indicator the
    // engine cannot draw, and the volume profile would simply vanish — no engine
    // series takes its place, because there is no definition to bind.
    for (const k of CARVED_OUT_INDICATOR_KEYS) {
      expect(ENGINE_MIGRATED_DEF_IDS.has(k), `${k} is carved out and must never be migrated`).toBe(false)
    }
  })

  it('the carve-out has NOT expired — v1 still has no grammar that could express it', () => {
    // ⛔ WHEN THIS GOES RED, DO NOT DELETE IT. Red here means the carve-out's
    // stated expiry condition has arrived (see the `CARVED_OUT_INDICATOR_KEYS`
    // docstring): a `primitive` compute kind, or a plot style that can draw
    // horizontal volume bins. That is the moment to re-open the decision on
    // purpose — which is the whole reason the expiry condition is executable
    // rather than a sentence in a comment.
    expect(COMPUTE_KINDS).not.toContain('primitive')
    // `bgband` and `fill` are the two styles someone reaching for a volume
    // profile would reach for first. Both are schema-RESERVED — declared in the
    // spec, refused by the validator — so neither is a v1 escape hatch.
    for (const style of ['bgband', 'fill']) {
      expect(RESERVED_PLOT_STYLES).toContain(style)
      expect(PLOT_STYLES).not.toContain(style)
    }
  })
})

// ─── the MACD head-mask (B3 adjudication A5) ─────────────────────────────────
//
// ✅ **DECIDED 2026-08-02: the owner DROPPED the mask.** `MACD_HEAD_MASK` is
// `false`, the engine's `COLUMN_HOLDS` is empty, and the `macd` column is now the
// Python lane's column element for element. Measured cost of applying it: **88
// changed pixels (0.011828%)** on `macd_headmask`, builds `9f566cd22874` (mask
// on) vs `9045bb69fc56` (mask off). Record:
// `docs/decisions/2026-08-02-macd-head-mask.md`; adjudication row is spec §11,
// status ACCEPTED.
//
// These cases WERE the pin on an open decision. They are now the pin on a closed
// one, pointed the other way — the failure they exist to catch has inverted, not
// disappeared:
//
//   1. the flag is OFF — the decision stays applied,
//   2. no hold is applied — the drawn column starts on the line's OWN first bar
//      (25), not the signal's (33),
//   3. the two really are different bars, by exactly 8 at 12/26/9. If that gap
//      were 0 the flip would have moved nothing and the 88 px would be a lie —
//      this is the anti-theatre claim and it survives the decision unchanged,
//   4. §9.1's render-boundary exception is CLOSED, asserted in numbers: the
//      values Python publishes on bars 25-32 are the values this column carries,
//      exactly.
//
// ⚠️ THE PIN IS STILL DELIBERATELY IN TWO PLACES. This file pins the COLUMN (what
// the engine computes). `__tests__/macdHeadMaskRendered.test.jsx` pins what the
// LEGACY lane hands to lightweight-charts, because MACD is not migrated and the
// lane a user actually sees is `StockChart.jsx`'s `indicatorData` memo. A future
// edit that re-masked ONE lane would be invisible to the other file, and that
// asymmetry is precisely what makes the 88 px number honest.

describe('the MACD head-mask was DROPPED, and stays dropped (B3/A5, decision MACD_HEAD_MASK)', () => {
  const firstFiniteCol = (col) => {
    for (let i = 0; i < col.length; i++) if (Number.isFinite(col[i])) return i
    return -1
  }
  const firstFinitePts = (pts) => pts.findIndex(p => Number.isFinite(p.value))

  it('is OFF, and is a boolean somebody can flip back in one place', () => {
    expect(MACD_HEAD_MASK).toBe(false)
    expect(typeof MACD_HEAD_MASK).toBe('boolean')
  })

  it('applies NO hold — the drawn line starts on its own first bar, 8 before the signal', () => {
    const cols = computeFor(getDefinition('macd'), BARS, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 })
    const line = firstFiniteCol(cols.macd)
    const signal = firstFiniteCol(cols.signal)
    expect(signal).toBeGreaterThan(0)                 // else this proves nothing
    expect(line, 'the column must NOT be held back to the signal').toBeLessThan(signal)
    expect(signal - line).toBe(8)                     // signalPeriod - 1
    expect(line).toBe(25)                             // slowPeriod - 1
  })

  it('the line really does start earlier than the signal — so the flip moved something', () => {
    // Straight from the native, no COLUMN_HOLDS. If these were equal the mask
    // would have been a no-op and the 88 px it cost to drop it would be a lie.
    const raw = computeMACD(BARS, 12, 26, 9)
    const gap = firstFinitePts(raw.signal) - firstFinitePts(raw.macd)
    expect(gap, 'the dropped mask used to hide this many bars').toBe(8)
    // …at the START of history, which is what made dropping it a VISIBLE change.
    // The exact bars are named in the decision record and they are these.
    expect(firstFinitePts(raw.macd)).toBe(25)     // slowPeriod - 1
    expect(firstFinitePts(raw.signal)).toBe(33)   // + signalPeriod - 1
  })

  it('publishes what the PYTHON lane publishes — §9.1\'s exception, CLOSED, in numbers', () => {
    // `tests/fixtures/indicators/macd_default.json` is the shared oracle both
    // lanes are held to at rel-tol 1e-9. Its `macd` column is finite on every one
    // of these bars, and until 2026-08-02 the column this chart drew was NaN on
    // all of them — the entire §9.1 exception. It is closed, and closing it is
    // asserted here rather than described in a comment.
    const cols = computeFor(getDefinition('macd'), BARS, {})
    const raw = computeMACD(BARS, 12, 26, 9)
    const restored = []
    for (let i = 25; i < 33; i++) {
      expect(Number.isFinite(raw.macd[i].value), `raw macd[${i}] should be finite`).toBe(true)
      expect(Number.isNaN(cols.macd[i]), `drawn macd[${i}] must no longer be masked`).toBe(false)
      expect(cols.macd[i], `drawn macd[${i}] must equal the raw value exactly`).toBe(raw.macd[i].value)
      restored.push(i)
    }
    expect(restored).toEqual([25, 26, 27, 28, 29, 30, 31, 32])
    // Bar 24 is still NaN — the flip restored the head, it did not extend the
    // line past where the maths defines it.
    expect(Number.isNaN(cols.macd[24])).toBe(true)
    // And the bar the mask used to stop at is unchanged, on both sides.
    expect(cols.macd[33]).toBe(raw.macd[33].value)
  })

  // The general statement — "the column IS the native's line on every bar,
  // finite-ness included", which is §9.1 with no render-boundary exception left
  // in it — lives one describe up, in `MACD needs NO column hold`. It is not
  // repeated here.

  it('hands back a FRESH column every call — a re-instated mask must not double-apply', () => {
    // `maskMacdHead` writes NaN into the array it was handed. It is dormant, but
    // it is KEPT (the decision is reversible in one edit), so this stays: if
    // `computeFor` ever started memoising, a second reader would receive the
    // FIRST reader's array and any mutation would travel.
    const def = getDefinition('macd')
    const a = computeFor(def, BARS, {})
    const b = computeFor(def, BARS, {})
    expect([...a.macd]).toEqual([...b.macd])
    expect(a.macd).not.toBe(b.macd)
    a.macd[40] = 12345
    expect(b.macd[40]).not.toBe(12345)
  })

  it('is a PRESENTATION change — `version` bumped, `compute.rev` did NOT', () => {
    // The decision record's rule: the picture moved, the maths did not. Bumping
    // `compute.rev` would tell every downstream cache the NUMBERS changed, which
    // is false and would invalidate a server-lane port that is still correct.
    const def = getDefinition('macd')
    expect(def.version, 'the rendered output changed').toBe(2)
    expect(def.compute.rev, 'the maths did not').toBe(1)
    // Every other native is still on the shared version — the bump is scoped to
    // the definition the decision touched, not applied across the board.
    for (const other of listDefinitions().filter(d => d.id !== 'macd')) {
      expect(other.version, `${other.id} should not have been bumped`).toBe(1)
    }
  })
})
