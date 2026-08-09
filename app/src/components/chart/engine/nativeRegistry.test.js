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

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseJs } from 'acorn'
import {
  NATIVE_DEFS,
  CARVED_OUT_INDICATOR_KEYS,
  MACD_HEAD_MASK,
  SERVER_DEFS,
  AST_DEFS,
  getDefinition,
  listDefinitions,
  computeFor,
  columnKeys,
  hasAnyFinite,
  registerDefinitions,
  validateUserDefinitions,
  AST_LANE_TIER,
  // ⭐ PHASE D TASK 16 — the runtime install layer.
  installUserDefinitions,
  clearUserDefinitions,
  listUserDefinitions,
  listAllDefinitions,
  registryGeneration,
} from './nativeRegistry'
// ⚠️ THE MODULE ITSELF, because `normalizeInstances` takes a REGISTRY (an object
// exposing `getDefinition`) and the namespace import IS the shape the product
// hands it — `StockChart.jsx` passes `import * as engineRegistry`. Reconstructing
// a `{getDefinition}` literal here would test a registry the product never uses.
import * as REGISTRY_MODULE from './nativeRegistry'
import {
  validateDefinition, COMPUTE_KINDS, SUPPORTED_KINDS, PLOT_STYLES, RESERVED_PLOT_STYLES,
  SCHEMA_VERSION as SCHEMA_VERSION_JS,
} from './defSchema'
import { SHIPPED_DEF_IDS, REGISTRY_SIZES, REGISTRY_LANES, idsByLane } from './registrySizes'
import { parseFormula, astHash } from './ast/parse'
import { DEFAULT_BUDGET } from './ast/budget'
import { migrateLegacyToInstances, normalizeInstances } from './instances'
import { computePaneLayout } from './paneLayout'
// ⚠️ FROM `flipState`, NOT `StockChart`. `StockChart.jsx` re-exports this set
// (`:66`) and the B3 plan's snippet imports it from there — but flipState is
// where it is DECLARED, and the two are the same frozen Set object. Importing
// the 10k-line component (and lightweight-charts with it) into a registry test
// would buy nothing and cost the whole render tree.
import { ENGINE_OWNED } from './flipState'
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
  // ── Phase C Task 14 ──
  avwap: 0,       // computes from bar 0, like VWAP — the anchor is the only gate
  atrBands: 14,   // needs period + 1 = 15, exactly like the ATR underneath it
}

const BARS = makeBars(300)

/** The repo root, found by walking up. Under this environment's vite transform
 *  the module URL is an `http:` one, so building a path from it throws "The URL
 *  must be of scheme file" (measured here, not assumed), and `process.cwd()` is
 *  `app/` for the documented runner and the repo root for some editors. Walking
 *  finds both and THROWS BY NAME if neither. Same helper, same reason, as
 *  `ast/lint.test.js`'s and the ledger's. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`nativeRegistry.test.js: could not find the repo root from ${process.cwd()}`)
})()

/** ⚠️ CRLF NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout, so a
 *  multi-line anchor written with newline escapes matches zero times unless the
 *  carriage returns are stripped first. That has cost this programme a
 *  measurement already. */
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n')
const ENGINE_REL = 'app/src/components/chart/engine'

// ─── the registry itself ─────────────────────────────────────────────────────

describe('native registry — membership', () => {
  it('lists 16 natives and 1 server definition — SEVENTEEN, across two lanes', () => {
    expect(NATIVE_DEFS.map(d => d.id).sort()).toEqual([
      'adx', 'atr', 'atrBands', 'avwap', 'bb', 'cci', 'donchian', 'ichimoku',
      'macd', 'mfi', 'obv', 'rsi', 'sar', 'stoch', 'vwap', 'williamsR',
    ])
    expect(listDefinitions().map(d => d.id).sort()).toEqual([
      'adx', 'atr', 'atrBands', 'avwap', 'bb', 'cci', 'donchian', 'ichimoku',
      'macd', 'mfi', 'obv', 'rsLine', 'rsi', 'sar', 'stoch', 'vwap', 'williamsR',
    ])
  })

  it('DOES include rsLine now — the server lane landed, and the hand-back is closed', () => {
    // ⭐ PHASE C TASK 13 INVERTED THIS CASE, AND THE OLD TEXT IS WORTH KEEPING
    // IN VIEW. It read: *"`rsLine` … is simply not on THIS lane … Task 13's
    // `serverCompute` lane is what moves it into `listDefinitions()`; until then
    // a user cannot enable an indicator the binder would throw on."* The lane
    // landed, and the objection is answered rather than waived — `computeFor`
    // dispatches on `compute.kind` before the `NATIVE_COMPUTE` lookup, so the
    // throw the old assertion pinned is now unreachable FOR THIS DEFINITION and
    // still reachable for a native that lost its function (the case below).
    expect(listDefinitions().some(d => d.id === 'rsLine')).toBe(true)
    expect(getDefinition('rsLine').id).toBe('rsLine')
    // …and it is still its own LANE, not folded into the natives.
    expect(SERVER_DEFS.map(d => d.id)).toEqual(['rsLine'])
    expect(SERVER_DEFS[0].compute.kind).toBe('server')
    expect(validateDefinition(SERVER_DEFS[0]).ok).toBe(true)
    expect(NATIVE_DEFS.some(d => d.id === 'rsLine')).toBe(false)
    // ⛔ AND THE SERVER BRANCH RETURNS `{}` RATHER THAN THROWING — the exact
    // property that made registering it safe. With no `ctx.sym` there is nothing
    // to fetch, and an empty column set is what `hasData` reads as "draw nothing
    // this paint", the same answer a native's warmup pad gives.
    expect(computeFor(SERVER_DEFS[0], BARS, {})).toEqual({})
    expect(computeFor(SERVER_DEFS[0], BARS, {}, { sym: '', tf: 'D' })).toEqual({})
    // ⛔ …while the throw is INTACT for a native naming a compute that is gone.
    // Deleting the server branch must not be the same thing as deleting the
    // guard: this is the positive control for the case above.
    expect(() => computeFor({ ...SERVER_DEFS[0], compute: { kind: 'native', fn: 'rsLine' } }, BARS, {}))
      .toThrow(/no native compute registered/)
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
    // The lanes are DIFFERENT sizes, which is the whole reason
    // `listDefinitions()` had to become a union — of THREE lanes since Phase D
    // Task 8.
    expect(NATIVE_DEFS.length + SERVER_DEFS.length + AST_DEFS.length).toBe(listDefinitions().length)
    // ⭐ THE INTEGER USED TO BE TYPED HERE (`toBe(16)`). It is now read from the
    // one hand-written manifest — see `registrySizes.js`'s header for the §A5
    // measurement that made thirty-three of these a problem worth solving.
    expect(NATIVE_DEFS.length).toBe(REGISTRY_SIZES.native)
  })
})

/** ⭐⭐ THE FOURTEEN SECTIONS `CHART_DEFAULTS.indicators` CARRIED UNTIL B5 TASK 9,
 *  verbatim, at `456ea0cb`. Every value a July blob merged for an input it did
 *  not itself declare came from here, so this is what "the migration is a no-op
 *  for an unset input" is measured against. Nothing else in the tree has these
 *  numbers any more.
 *
 *  ⛔ THIS IS A RECORD, NOT A SOURCE OF TRUTH. If a definition's default is
 *  deliberately changed, the change belongs in `nativeRegistry` and this row is
 *  updated with a note saying which users it moves — never the other way round,
 *  and never silently. */
const JULY_LEGACY_DEFAULTS = {
  rsi:  { enabled: false, period: 14, color: '#7b68ee' },
  macd: {
    enabled: false, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    macdColor: '#2196F3', signalColor: '#FF9800',
  },
  bb:   { enabled: false, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' },
  vwap: { enabled: false, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  stoch: { enabled: false, kPeriod: 14, dPeriod: 3, kColor: '#FF6B6B', dColor: '#4ECDC4' },
  atr:   { enabled: false, period: 14, color: '#FFA726' },
  sar:   { enabled: false, step: 0.02, maxStep: 0.2, color: '#ffeb3b' },
  ichimoku: {
    enabled: false,
    tenkanColor: '#26C6DA',
    kijunColor: '#EF5350',
    spanAColor: 'rgba(76,175,80,0.2)',
    spanBColor: 'rgba(239,83,80,0.2)',
    chikouColor: 'rgba(255,235,59,0.7)',
  },
  mfi:       { enabled: false, period: 14, color: '#c084fc' },
  cci:       { enabled: false, period: 20, color: '#fbbf24' },
  williamsR: { enabled: false, period: 14, color: '#60a5fa' },
  adx:       { enabled: false, period: 14, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' },
  obv:       { enabled: false, color: '#9ca3af' },
  donchian:  { enabled: false, period: 20, color: 'rgba(96,165,250,0.5)' },
}

/**
 * ⭐ THE DEFINITIONS THAT ARE NOT A MIGRATION OF ANYTHING (Phase C Task 14).
 *
 * Every one of the fourteen above is a legacy `StockChart.jsx` render block
 * wearing the schema, so "the July default and the definition default agree" is
 * a claim about REAL USER DATA: a stored blob that never mentioned an input got
 * that input's value from the July table, and gets it from the definition now.
 *
 * `avwap` and `atrBands` are new indicators. There is no July section, no stored
 * blob that ever carried them, and therefore no user whose chart a default here
 * could move. A hand-written row for them would not be a record of anything — it
 * would be a copy of the definition, asserted against the definition.
 *
 * ⛔ SO THE EXCLUSION IS AN EXPLICIT LIST, NOT A `?? {}` IN THE LOOP. A skip that
 * fires whenever a row is missing would silently absolve the NEXT migration that
 * forgot one, which is exactly what the coverage test below exists to catch.
 */
const NOT_A_MIGRATION = ['atrBands', 'avwap', 'rsLine']

describe('the July defaults table', () => {
  it('covers every MIGRATED definition and nothing else — a missing row is a silent no-op', () => {
    // Without this, a definition added (or renamed) after Task 9 would simply
    // have no row and the per-definition case above would `toBeDefined()`-fail
    // by name — which is the point — while a DELETED definition would leave a
    // dead row nobody notices. Both directions.
    expect(Object.keys(JULY_LEGACY_DEFAULTS).sort())
      .toEqual(listDefinitions().map(d => d.id).filter(id => !NOT_A_MIGRATION.includes(id)).sort())
    // …and the exclusion list names definitions that EXIST, so a renamed or
    // deleted definition cannot hide inside it and take its July row with it.
    for (const id of NOT_A_MIGRATION) {
      expect(getDefinition(id), `NOT_A_MIGRATION names ${id}, which is not a definition`).toBeTruthy()
      expect(JULY_LEGACY_DEFAULTS[id], `${id} has a July row AND claims not to be a migration`)
        .toBeUndefined()
      // The real claim: there is no legacy section for it either. If one ever
      // appears, it IS a migration and belongs in the table.
      expect(CHART_DEFAULTS.indicators[id], `CHART_DEFAULTS carries a ${id} section`).toBeUndefined()
    }
    // …and the rows really carry values, so the loop above is not iterating
    // fourteen `{enabled}`-only objects and asserting nothing.
    const inputKeys = Object.values(JULY_LEGACY_DEFAULTS)
      .flatMap(v => Object.keys(v).filter(k => k !== 'enabled'))
    expect(inputKeys.length, 'the July table has no inputs left to compare')
      .toBeGreaterThan(30)
  })
})

describe.each(NATIVE_DEFS.map(d => [d.id, d]))('native "%s"', (id, def) => {
  it('is a valid definition', () => {
    const r = validateDefinition(def)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })

  it('mirrors the JULY defaults — the migration of an UNSET input must be a no-op', () => {
    // ⭐⭐ B5 TASK 9 MOVED THIS CONTROL DOWN A LEVEL, and the level it moved to is
    // a frozen table, which is unusual enough to say why.
    //
    // It read `CHART_DEFAULTS.indicators[id]` — the fifteen-section legacy
    // table — and Task 9 DELETED fourteen of those sections. So the control had
    // no subject: the comparison would have been definition-against-`undefined`.
    //
    // ⛔ BUT THE CLAIM IT MAKES IS STILL LIVE, AND IT IS ABOUT REAL USER DATA.
    // The fold carries only the keys a stored blob ACTUALLY DECLARES; an input
    // the blob never mentioned is absent from the instance and the DEFINITION
    // default supplies it at compute time. Before the fold, `mergeChartSettings`
    // supplied it from the table below. So a definition default that differs
    // from its July value silently changes what an existing user's chart draws —
    // no test, no pixel gate case, no support ticket anyone can answer.
    //
    // ⚠️ SO THE DELETED TABLE IS TRANSCRIBED HERE, VERBATIM, ONCE. This is the
    // only copy left and it is deliberately in a TEST: the discovery scan skips
    // `.test.` files precisely because a fixture is allowed to enumerate, and a
    // fifteen-section list in shipped source is the thing this phase retired.
    const legacy = JULY_LEGACY_DEFAULTS[id]
    if (NOT_A_MIGRATION.includes(id)) {
      // A NEW indicator, not a migrated block — see NOT_A_MIGRATION. There is no
      // July value to be a no-op against, and inventing one would assert the
      // definition against a copy of itself.
      expect(legacy, `${id} is in NOT_A_MIGRATION but has a July row`).toBeUndefined()
      return
    }
    expect(legacy, `no JULY_LEGACY_DEFAULTS.${id} — a definition with no July row`).toBeDefined()
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
    // ⭐ THREE COLUMNS SINCE PHASE C, NOT ONE — and this line USED TO READ
    // `toEqual(['sar'])`. `priceCrossedSar` and `trendFlipped` are `sar`'s two
    // declared EVENTS, and events are columns (spec §3.1); `registerDefinitions`
    // refuses the definition if they do not come back. The claim this case
    // actually makes is unchanged and is the one below: `isUptrend` still never
    // reaches a column. `trendFlipped` is that flag's CHANGE, which is a number
    // in a `{0, 1, NaN}` domain — not the boolean riding on the point.
    // Their VALUES are pinned in both lanes by
    // `tests/fixtures/indicators/sar_events_*.json`; the wiring is asserted in
    // `__tests__/eventColumns.test.js`.
    expect(Object.keys(cols)).toEqual(['sar', 'priceCrossedSar', 'trendFlipped'])
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

  it('is exactly volumeProfile, and 16 + 1 = 17', () => {
    // The count is asserted THREE ways on purpose. The equation above already
    // fails on a 16th key that nobody defined; these fail on a 16th key that
    // somebody DID define, which is the case where a new indicator lands in the
    // engine and the enumeration sites, the parity gates and this arithmetic
    // silently stop agreeing about how many there are.
    expect([...CARVED_OUT_INDICATOR_KEYS]).toEqual(['volumeProfile'])
    // ⭐ FOURTEEN BECAME SIXTEEN AT PHASE C TASK 14, and the equation is the
    // reason the change is visible at all: `avwap` and `atrBands` are the first
    // definitions that were never a settings section, so the LEFT side of
    // "settings keys − definitions == carve-out" grew on the definitions side
    // only. The carve-out did not move, the blob did not move, and this number
    // is the one thing that had to.
    // ⭐ AND SIXTEEN BECAME SEVENTEEN AT PHASE C TASK 13, on the OTHER lane:
    // `rsLine` is `compute.kind: 'server'`, so it grew the definitions side
    // again without touching the settings blob or the carve-out.
    // ⭐ AND SEVENTEEN STAYED SEVENTEEN AT PHASE D TASK 8, which added a THIRD
    // LANE and registered nothing on it — the number is no longer typed here at
    // all, it is read from `registrySizes.js`'s manifest.
    expect(listDefinitions()).toHaveLength(REGISTRY_SIZES.total)
    // ⭐ B5 TASK 9: the arithmetic used to be 14 + 1 = 15, where 15 was the
    // settings blob's own section count. The blob enumerates ONLY the carve-out
    // now — the other fourteen are folded into `indicatorInstances` — so the
    // equation becomes 14 definitions + 1 carved-out section, and the blob's
    // section list IS the carve-out list. That is a stronger statement than the
    // old one: a sixteenth undefined key cannot hide in a fifteen-key blob any
    // more, because there is no fifteen-key blob.
    expect(Object.keys(CHART_DEFAULTS.indicators)).toEqual([...CARVED_OUT_INDICATOR_KEYS])
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
    // `ENGINE_OWNED` is what makes a legacy block stand down. Adding a
    // carved-out key there would silence the canvas effect for an indicator the
    // engine cannot draw, and the volume profile would simply vanish — no engine
    // series takes its place, because there is no definition to bind.
    for (const k of CARVED_OUT_INDICATOR_KEYS) {
      expect(ENGINE_OWNED.has(k), `${k} is carved out and must never be migrated`).toBe(false)
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
// ⚠️ THE PIN IS STILL DELIBERATELY IN TWO PLACES, AND B3 TASK 6 MADE THAT MORE
// IMPORTANT, NOT LESS. This file pins the COLUMN (what the engine computes).
// `__tests__/macdHeadMaskRendered.test.jsx` pins what the LEGACY lane hands to
// lightweight-charts — `StockChart.jsx`'s `indicatorData` memo. When that comment
// was written MACD was not migrated and the legacy memo was the only lane a user
// could see; since Task 6 BOTH lanes are live (the engine draws MACD for anyone
// holding an instance, the memo draws it for everyone else), so a re-mask that
// reached one and not the other would now be visible to half the users and to
// neither test on its own. `macdFlipAParity.test.js` adds the third: what the
// ENGINE hands the renderer. All three read the one `MACD_HEAD_MASK` constant,
// and that is what keeps the 88 px number honest.

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

// ─────────────────────────────────────────────────────────────────────────────
// PHASE D TASK 8 — ONE MANIFEST, ONE EQUALITY, AND THE THIRD LANE
// ─────────────────────────────────────────────────────────────────────────────

/** An `ast` definition for `source`, built THROUGH the one parser. */
const astDef = (source, over = {}) => {
  const parsed = parseFormula(source)
  if (!parsed.ok) throw new Error(`astDef fixture does not parse: ${source} — ${parsed.error}`)
  const compute = { kind: 'ast', fn: astHash(parsed.ast), rev: 1, ast: parsed.ast, source }
  return {
    schemaVersion: SCHEMA_VERSION_JS, id: 'myFormula', version: 1,
    compute: { ...compute, ...(over.compute || {}) },
    // ⚠️ `tier` IS `AST_LANE_TIER`, NOT A CHOICE THIS FIXTURE MAKES. It read
    // `'free'` until Phase D Task 14 added GATE 4 — `/api/user-definitions`
    // declares `Depends(require_paid)` on every one of its handlers, so a `free`
    // badge on this lane is refused at registration. It is read off the registry
    // rather than retyped so the fixture cannot drift from the gate it feeds.
    meta: {
      name: 'My formula', shortName: 'F', category: 'Custom', tier: AST_LANE_TIER,
      repaint: 'non-repainting', ...(over.meta || {}),
    },
    placement: { target: 'pane', pane: { height: 0.15 } },
    inputs: [{ key: 'color', type: 'color', label: 'Colour', default: 'token:info' }],
    plots: over.plots || [{ key: 'out', label: 'F', style: 'line', color: '$color', width: 1, role: 'primary' }],
    ...(over.events ? { events: over.events } : {}),
  }
}

describe('⭐⭐ THE registry manifest — every definition, by lane, BY NAME', () => {
  // 🔴 THIS ONE EQUALITY IS WHAT THIRTY-THREE HAND-TYPED ASSERTIONS COLLAPSED
  // INTO, and it is a STRENGTHENING rather than a shortening. Plan §A5 measured
  // "2 definitions cost 33 assertions across 12 files"; C Task 10 then watched
  // 28 tests across 13 files fail on `defs.length === 16` when the registry
  // moved to 17. Every one of those was a COUNT, and a count is satisfied by:
  //
  //   * a RENAME — `williamsR` → `williams` keeps the count at seventeen;
  //   * a LANE MOVE — a native re-declared `server` keeps the TOTAL at seventeen
  //     and quietly changes which lane fetches it;
  //   * a SWAP — one definition deleted and another added in the same commit.
  //
  // None of those is expressible as a number, and all three are expressible as a
  // list. So the collapse replaces N integers with ONE ordered, lane-partitioned
  // list of ids — and the integers that survive elsewhere are all read from that
  // list's lengths rather than typed.
  it('the registry equals the shipped manifest — ordered, partitioned, by name', () => {
    expect(idsByLane(listDefinitions())).toEqual(SHIPPED_DEF_IDS)
  })

  it('…and it is NOT vacuous: the manifest is written down, not derived', () => {
    // `registrySizes.js` imports NOTHING. A manifest computed from
    // `listDefinitions()` would be true by construction and could never fail —
    // the same reasoning `CARVED_OUT_INDICATOR_KEYS` gives one file over. Proven
    // by AST over the module's own source, not by grep: an `import` in a comment
    // is not an import, and a grep cannot tell the difference.
    const src = readSrc(`${ENGINE_REL}/registrySizes.js`)
    const tree = parseJs(src, { ecmaVersion: 'latest', sourceType: 'module' })
    const imports = tree.body.filter(n => n.type === 'ImportDeclaration').map(n => n.source.value)
    expect(imports, 'registrySizes.js derives from something — the manifest checks nothing').toEqual([])
    // …and the positive control for that scan: the SAME scan over this registry
    // finds the imports that are really there.
    const regSrc = readSrc(`${ENGINE_REL}/nativeRegistry.js`)
    const regImports = parseJs(regSrc, { ecmaVersion: 'latest', sourceType: 'module' })
      .body.filter(n => n.type === 'ImportDeclaration').map(n => n.source.value)
    expect(regImports, 'the import scan finds nothing anywhere — it is broken, not selective')
      .toContain('./defSchema')
  })

  it('…and every REGISTRY_SIZES value DERIVES — no numeric literal survives in it', () => {
    // ⛔ THE ONE PROPERTY NO BEHAVIOURAL TEST CAN SEE. `total: 17` and
    // `total: a + b + c` are the same number today and stay the same number
    // until the exact moment a definition lands — which is the moment the
    // hardcoded one starts lying, silently, in the file whose entire job is to
    // be the place the number lives. Same class as Phase D Task 7's M4 (a
    // hand-copied `26` against a read `TRAILING_PAD`): only a scan over the
    // source can tell them apart.
    const src = readSrc(`${ENGINE_REL}/registrySizes.js`)
    const tree = parseJs(src, { ecmaVersion: 'latest', sourceType: 'module' })
    let sizesObject = null
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier'
          && node.id.name === 'REGISTRY_SIZES') {
        // `Object.freeze({...})` — the object literal is the call's argument.
        const init = node.init
        sizesObject = init && init.type === 'CallExpression' ? init.arguments[0] : init
      }
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end') continue
        visit(node[k])
      }
    }
    visit(tree.body)
    expect(sizesObject && sizesObject.type, 'REGISTRY_SIZES is not an object literal any more')
      .toBe('ObjectExpression')

    const literals = []
    const derived = []
    for (const prop of sizesObject.properties) {
      const name = prop.key.name || prop.key.value
      const valueSrc = src.slice(prop.value.start, prop.value.end)
      if (prop.value.type === 'Literal' && typeof prop.value.value === 'number') {
        literals.push(`${name}: ${valueSrc}`)
      }
      if (/SHIPPED_DEF_IDS/.test(valueSrc)) derived.push(name)
    }
    expect(literals,
      'a REGISTRY_SIZES value is a hand-typed integer. That is the literal thirty-three '
      + 'assertions just stopped being — a table that does not derive is a literal wearing '
      + 'a table\'s name.').toEqual([])
    // …and the scan is SELECTING, not merely finding nothing: every one of the
    // four values really does read the manifest.
    expect(derived.sort(), 'a REGISTRY_SIZES value does not read SHIPPED_DEF_IDS at all')
      .toEqual(['ast', 'native', 'server', 'total'])
  })

  it('…and the sizes agree with the manifest, the lanes and the registry', () => {
    // The brief's two arithmetic rails. Neither is a tautology under this design:
    // `REGISTRY_SIZES` is DECLARED (from the hand-written manifest) and
    // `listDefinitions()` is the actual registry, so the second line is the
    // registry proving the declaration.
    expect(REGISTRY_SIZES.total).toBe(REGISTRY_SIZES.native + REGISTRY_SIZES.server + REGISTRY_SIZES.ast)
    expect(listDefinitions().length).toBe(REGISTRY_SIZES.total)
    for (const lane of REGISTRY_LANES) {
      expect(REGISTRY_SIZES[lane], `${lane}: size and manifest disagree`)
        .toBe(SHIPPED_DEF_IDS[lane].length)
    }
    // ⛔ AND THE LANES ARE THE SUPPORTED KINDS. `registrySizes.js` re-types that
    // list on purpose (importing it would make the manifest derive from the
    // thing it exists to check); this is the assertion that pays for the copy.
    expect(REGISTRY_LANES).toEqual([...SUPPORTED_KINDS])
    // …and the third lane is EMPTY, which is a claim: Task 8 built the lane and
    // registered nothing on it.
    expect(REGISTRY_SIZES.ast).toBe(0)
    expect(AST_DEFS).toEqual([])
  })

  it('`idsByLane` files an UNKNOWN lane under its own name rather than dropping it', () => {
    // The partition helper's own failure mode. Dropping an off-lane definition
    // would make the manifest equality pass while a `script` definition sat in
    // the registry; a default bucket would file it under a lane it is not on.
    const out = idsByLane([
      { id: 'a', compute: { kind: 'native' } },
      { id: 'b', compute: { kind: 'script' } },
      { id: 'c' },
    ])
    expect(out).toEqual({
      native: ['a'], server: [], ast: [], script: ['b'], '<no compute.kind>': ['c'],
    })
  })
})

describe('`supportedKinds` is a FILTER now, not a sentence (Phase D Task 8)', () => {
  it('a definition of an UNSUPPORTED kind is LISTED but refuses to RENDER', () => {
    // Spec §3.1: catalog fetch filters by client `supportedKinds`; and §5: premium
    // entries stay LISTED for merchandising even when locked. So "cannot run" and
    // "must not appear" are different, and conflating them would hide the whole
    // server lane from a client that simply has an older bundle.
    const d = astDef('sma(close, 20)')
    d.compute = { kind: 'script', fn: 'x', rev: 1 }
    const res = validateUserDefinitions([d])
    expect(res.defs.map(x => x.id)).toEqual([])
    expect(res.errors.join('\n')).toMatch(/kind "script" is declared but this client cannot run it/)
    // ⛔ AND IT IS NOT A VALIDATION FAILURE. The same definition is well-formed —
    // the refusal has to read "cannot run", not "malformed", or a client one
    // version behind stops describing a lane instead of greying it out.
    expect(validateDefinition(d).ok, 'an unsupported kind was reported as INVALID').toBe(true)
  })

  it('…and the three supported lanes all register through the same door', () => {
    // The positive control: a filter that refuses everything would satisfy the
    // case above. `native` and `server` are taken from the SHIPPED registry, so
    // this cannot pass on a fixture that happens to be shaped right.
    const native = NATIVE_DEFS[0]
    const server = SERVER_DEFS[0]
    const ast = astDef('sma(close, 20)')
    const res = validateUserDefinitions([native, server, ast])
    expect(res.errors, JSON.stringify(res.errors)).toEqual([])
    expect(res.defs.map(d => d.compute.kind).sort()).toEqual(['ast', 'native', 'server'])
  })
})

describe('the `ast` lane REGISTERS, and the three gates it registers through', () => {
  it('an ast definition registers and COMPUTES a real column', () => {
    const res = validateUserDefinitions([astDef('sma(close, 20)')])
    expect(res.errors, JSON.stringify(res.errors)).toEqual([])
    const [def] = res.defs
    const cols = computeFor(def, BARS, {})
    expect(Object.keys(cols)).toEqual(['out'])
    expect(cols.out.length).toBe(BARS.length)
    expect(hasAnyFinite(cols.out), 'the ast lane computed nothing').toBe(true)
    // …and it really is the FORMULA's answer, not a copy of close: the 20-bar
    // warmup is NaN and the first computable bar is the mean of the first 20.
    expect(Number.isNaN(cols.out[18])).toBe(true)
    const mean = BARS.slice(0, 20).reduce((s, b) => s + b.c, 0) / 20
    expect(cols.out[19]).toBeCloseTo(mean, 9)
  })

  it('⛔ the `ast` branch is BEFORE the NATIVE_COMPUTE lookup — the ORDERING is the rail', () => {
    // ⭐ THE MUTATION THIS CASE EXISTS FOR: move the `ast` branch BELOW the
    // `NATIVE_COMPUTE[def.compute.fn]` lookup. An ast definition's `compute.fn`
    // is a 71-character `sha256:…` string, so the lookup misses and the throw
    // fires FIRST — the lane registers, validates, budgets and lints, and then
    // can never draw. It is an ordering fact, and this asserts the ordering
    // rather than a value: the SAME definition must not reach the throw.
    const [def] = validateUserDefinitions([astDef('ema(close, 9)')]).defs
    expect(def.compute.fn).toMatch(/^sha256:/)
    expect(Object.keys(computeFor(def, BARS, {}))).toEqual(['out'])
    expect(() => computeFor(def, BARS, {}), 'the ast lane fell through to the native lookup')
      .not.toThrow()

    // ⚠️ AND THE THROW IS INTACT — C Task 13 shipped this assertion when it added
    // the server lane, and a THIRD lane is exactly where a `return {}` fallback
    // gets added by accident. This case is NOT killed by the ordering mutation,
    // which is what makes it the control rather than a duplicate.
    expect(() => computeFor({ ...def, compute: { kind: 'native', fn: def.compute.fn } }, BARS, {}))
      .toThrow(/no native compute registered/)
  })

  it('GATE 1 — one formula is ONE series: a second data plot is refused', () => {
    // `interpret` returns a single column. A definition declaring two data plots
    // would fill one and leave the other permanently NaN — `hasAnyFinite` false,
    // nothing drawn, no error anywhere. Invisible, which is why it is refused.
    const d = astDef('sma(close, 20)', {
      plots: [
        { key: 'out', label: 'F', style: 'line', color: '$color', width: 1, role: 'primary' },
        { key: 'other', label: 'G', style: 'line', color: '$color', width: 1, role: 'secondary' },
      ],
    })
    const res = validateUserDefinitions([d])
    expect(res.defs).toEqual([])
    expect(res.errors.join('\n')).toMatch(/computes ONE column/)
    // …and an `hlines` GUIDE is not a data plot, so it stays legal.
    const withGuide = astDef('sma(close, 20)', {
      plots: [
        { key: 'out', label: 'F', style: 'line', color: '$color', width: 1, role: 'primary' },
        { key: 'zero', label: '0', style: 'hlines', levels: [0], color: '$color', width: 1, role: 'context' },
      ],
    })
    expect(validateUserDefinitions([withGuide]).errors).toEqual([])
  })

  it('GATE 1b — an ast definition that declares an EVENT is refused BY THE EXISTING DOOR', () => {
    // ⛔ NO SECOND GUARD WAS ADDED FOR THIS, AND THAT IS THE POINT. `computeFor`
    // reads the ast lane's column key off `def.plots`, never off `columnKeys`
    // (which is the union of plots AND events) — so an ast definition's event
    // simply never comes back, and `validateEventColumns` refuses it by name at
    // the door it was built for. A refusal from the right door, measured.
    const d = astDef('sma(close, 20)', { events: [{ key: 'fired', label: 'Fired' }] })
    const res = validateUserDefinitions([d])
    expect(res.defs).toEqual([])
    expect(res.errors.join('\n')).toMatch(/"fired" returned no column/)
  })

  it('GATE 2 — the BUDGET refuses at registration, and names the cap that fired', () => {
    // Task 6's UX half. `checkBudget` at registration is a message an author sees
    // while typing; `assertBudget` inside `interpret` is the safety half that
    // throws at compute. Registration-only lets a definition registered under one
    // budget run forever under a later, smaller one.
    const deep = `sma(${'sma('.repeat(0)}close, ${DEFAULT_BUDGET.maxLookback + 10})`
    const res = validateUserDefinitions([astDef(deep)])
    expect(res.defs).toEqual([])
    expect(res.errors.join('\n')).toMatch(/exceeds the lookback budget/)
    expect(res.errors.join('\n')).toMatch(/budget:lookback/)
    // ⛔ THE DOOR IS NAMED, NOT INFERRED. A tree the budget cannot even MEASURE
    // is refused by the guard that stopped it — `resolve:function` here — and not
    // reported as "over budget", which is the wrong-door defect this branch has
    // now found four separate times.
    const bogus = { type: 'call', name: 'nope', args: [{ type: 'series', name: 'close' }] }
    const d = astDef('sma(close, 20)')
    d.compute.ast = bogus
    d.compute.fn = astHash(bogus)
    d.compute.source = 'nope(close)'
    const r2 = validateUserDefinitions([d])
    expect(r2.defs).toEqual([])
    expect(r2.errors.join('\n')).toMatch(/resolve:function/)
    expect(r2.errors.join('\n'), 'a resolve refusal was reported as a budget refusal')
      .not.toMatch(/exceeds the .* budget/)
  })

  it('GATE 3 — the repaint badge must BE the measurement, in both directions', () => {
    // ⭐ THE ONE LANE WHERE THE BADGE IS DECIDABLE. Spec §11 forbids static
    // analysis of hand-written computes, so all seventeen shipped definitions
    // are `undecidable-hand-written` and their badges are unauditable claims. An
    // ast definition's compute IS a tree this repo can read.
    const over = astDef('sma(close, 20)', { meta: { repaint: 'repaints' } })
    const res = validateUserDefinitions([over])
    expect(res.defs, 'a false badge registered').toEqual([])
    expect(res.errors.join('\n')).toMatch(/the linter MEASURES "non-repainting"/)
    // ⛔ UNDER-CLAIMING IS AS FALSE AS OVER-CLAIMING — a user reads the badge and
    // makes a decision on it, so `repaints` on maths that does not is refused too.
    // (That IS the case above: `sma` is clean and the declaration said it repaints.)
    const missing = astDef('sma(close, 20)')
    delete missing.meta.repaint
    expect(validateUserDefinitions([missing]).errors.join('\n')).toMatch(/meta\.repaint — required/)
    // …and the honest one registers, which is what stops this being a gate that
    // refuses everything.
    expect(validateUserDefinitions([astDef('sma(close, 20)')]).errors).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PHASE D TASK 16 — THE RUNTIME INSTALL LAYER, AND THE RAILS IT MAY NOT WEAKEN
// ─────────────────────────────────────────────────────────────────────────────

describe('🔴 the RUNTIME lane — a user definition installs, and the SHIPPED manifest does not move', () => {
  // ⚠️ TEARDOWN UNDOES WHAT SETUP CREATED. The installed index is module-scoped,
  // so a case that leaves one behind changes the answer every LATER case in this
  // file gets from `listDefinitions()`, `idsByLane` and `getDefinition` — and it
  // would do so in the direction that makes the manifest rails above pass for the
  // wrong reason. vitest gives each FILE its own module registry, so this is the
  // whole blast radius.
  const USER_ID = 'u_0123456789ab'
  const userDef = (source = 'sma(close, 20)', over = {}) => {
    const d = astDef(source, over)
    d.id = USER_ID
    return d
  }

  afterEach(() => { clearUserDefinitions() })

  it('installs — and it is the door `validateUserDefinitions` never was', () => {
    // The defect, stated as a contrast. Validation alone leaves the registry
    // unable to resolve the definition, which is precisely what shipped from
    // Task 8 to Task 15 and what the parity case measured as 0 changed pixels
    // with AND without its own perturbation.
    const def = userDef()
    const validated = validateUserDefinitions([def])
    expect(validated.errors, JSON.stringify(validated.errors)).toEqual([])
    expect(validated.defs).toHaveLength(1)
    expect(getDefinition(USER_ID),
      'validation INSTALLED — then the two doors are one door and the rename is a lie')
      .toBeNull()

    const installed = installUserDefinitions([def])
    expect(installed.errors, JSON.stringify(installed.errors)).toEqual([])
    expect(installed.installed.map(d => d.id)).toEqual([USER_ID])
    expect(getDefinition(USER_ID)).toBeTruthy()
    expect(listUserDefinitions().map(d => d.id)).toEqual([USER_ID])
  })

  it('⛔⛔ …and the THREE SHIPPED RAILS still hold WHILE it is installed', () => {
    // 🔴 THE DECISION, ASSERTED RATHER THAN INTENDED. `listDefinitions()` is the
    // shipped CATALOGUE and `getDefinition` is the SESSION. If the two were one
    // function, every rail below would silently become a statement about who is
    // signed in — and would still pass in every suite that installs nothing,
    // which is the worst outcome available: green, and measuring something other
    // than what it says.
    expect(installUserDefinitions([userDef()]).installed).toHaveLength(1)
    // The definition really is resolvable — otherwise this case asserts that
    // nothing changed by changing nothing.
    expect(getDefinition(USER_ID)).toBeTruthy()

    expect(idsByLane(listDefinitions()),
      'an installed user definition reached the SHIPPED manifest').toEqual(SHIPPED_DEF_IDS)
    expect(listDefinitions()).toHaveLength(REGISTRY_SIZES.total)
    expect(REGISTRY_SIZES.ast, 'REGISTRY_SIZES started counting user definitions').toBe(0)
    expect(AST_DEFS, 'the frozen ast lane was mutated').toEqual([])
    expect(SHIPPED_DEF_IDS.ast).toEqual([])

    // …and `listAllDefinitions` is the one that DID move, by exactly one, with
    // the shipped catalogue first and unreordered.
    expect(listAllDefinitions()).toHaveLength(REGISTRY_SIZES.total + 1)
    expect(listAllDefinitions().slice(0, REGISTRY_SIZES.total).map(d => d.id))
      .toEqual(listDefinitions().map(d => d.id))
    expect(listAllDefinitions()[REGISTRY_SIZES.total].id).toBe(USER_ID)
  })

  it('⛔ an INVALID definition does not install — the negative, asserted', () => {
    // Task 10: a stored verdict goes STALE. A badge that disagrees with the
    // linter is refused in both directions at validation, and the install must
    // not be a way around that — "it is already saved" is not a reason to draw
    // something the gates say is wrong.
    const res = installUserDefinitions([userDef('sma(close, 20)', { meta: { repaint: 'repaints' } })])
    expect(res.installed, 'an invalid definition INSTALLED').toEqual([])
    expect(res.errors.join('\n')).toMatch(/the linter MEASURES "non-repainting"/)
    expect(getDefinition(USER_ID)).toBeNull()
    expect(listUserDefinitions()).toEqual([])

    // ⭐ THE POSITIVE CONTROL FOR THIS CASE. A door that refused EVERYTHING would
    // satisfy every line above, and it is the same fixture one field apart.
    expect(installUserDefinitions([userDef()]).installed).toHaveLength(1)
    expect(getDefinition(USER_ID)).toBeTruthy()
  })

  it('⛔ a SHIPPED id cannot be installed over — the shadow is refused BY NAME', () => {
    // A user definition claiming `rsi` would shadow the native for every chart in
    // the tab: the settings row, the legend chip, the alert address and the pane
    // height all resolve through one lookup.
    const shipped = NATIVE_DEFS[0].id
    const impostor = userDef()
    impostor.id = shipped
    const res = installUserDefinitions([impostor])
    expect(res.installed).toEqual([])
    expect(res.errors.join('\n')).toMatch(/a SHIPPED definition already owns this id/)
    // …and the native is untouched: the same object, on the same lane.
    expect(getDefinition(shipped)).toBe(NATIVE_DEFS[0])
    expect(idsByLane(listDefinitions())).toEqual(SHIPPED_DEF_IDS)
  })

  it('the GENERATION changes iff the installed SET changed', () => {
    // ⚠️ WHY THIS IS A CONTRACT AND NOT AN OPTIMISATION. `paneLayout` memoises
    // "the ids that reserve a pane" against this number, and `StockChart` carries
    // it in `updateChart`'s dependency list. A counter that never moved would
    // reproduce the ordering bug in both places at once; a counter that moved on
    // every call would rebuild the pane-target set and repaint the whole chart on
    // every SWR revalidation, i.e. every time the tab regained focus.
    const g0 = registryGeneration()
    const def = userDef()

    installUserDefinitions([def])
    const g1 = registryGeneration()
    expect(g1, 'installing a new definition did not move the generation').not.toBe(g0)

    // The SAME claim again — same id, same version, same compute handle.
    installUserDefinitions([def])
    expect(registryGeneration(), 'a re-install of an unchanged definition moved the generation')
      .toBe(g1)

    // A MATHS change under the same id is a different claim and must move it.
    const edited = userDef('sma(close, 30)')
    expect(edited.compute.fn).not.toBe(def.compute.fn)
    installUserDefinitions([edited])
    const g2 = registryGeneration()
    expect(g2, 'an edited formula did not move the generation').not.toBe(g1)
    expect(getDefinition(USER_ID).compute.source).toBe('sma(close, 30)')

    // And clearing moves it once, then not again.
    clearUserDefinitions()
    const g3 = registryGeneration()
    expect(g3).not.toBe(g2)
    clearUserDefinitions()
    expect(registryGeneration(), 'clearing an empty index moved the generation').toBe(g3)
  })

  it('an installed definition RESOLVES everywhere ONE id is resolved', () => {
    // The point of widening `getDefinition` rather than adding a second lookup:
    // the instance validator, the ownership facade and the pane geometry all go
    // through it, so none of them has to learn anything new.
    const inst = {
      instanceId: `inst:${USER_ID}:0`,
      defId: USER_ID,
      defVersion: 1,
      inputs: { color: 'token:info' },
      placement: { target: 'pane' },
      hidden: false,
    }
    installUserDefinitions([userDef()])

    // ⛔ THE EXACT DROP THE DEFECT PRODUCED, shown in both directions on one
    // fixture — the second half is the pre-Task-16 behaviour, reproduced.
    expect(normalizeInstances([inst], REGISTRY_MODULE).kept).toHaveLength(1)
    expect(ENGINE_OWNED.has(USER_ID)).toBe(true)
    const bands = computePaneLayout([inst], { hasVolumeBand: false }).bands
    expect(Object.keys(bands)).toContain(USER_ID)

    clearUserDefinitions()
    expect(normalizeInstances([inst], REGISTRY_MODULE).kept).toEqual([])
    expect(ENGINE_OWNED.has(USER_ID)).toBe(false)
    expect(Object.keys(computePaneLayout([inst], { hasVolumeBand: false }).bands))
      .not.toContain(USER_ID)
  })

  it('⛔ THE PANE MEMO IS NOT FROZEN AT FIRST CALL — the layout half of the ordering bug', () => {
    // 🔴 THE MUTATION THIS CASE EXISTS FOR: memoise `paneTargetIds` on `null`
    // again. `computePaneLayout` is called FIRST here, with nothing installed, so
    // the memo fills with the shipped sixteen — exactly the state every real
    // chart is in when a user's definitions arrive from SWR after the first
    // paint. Under the old memo the band below never appears, whatever the
    // registry says.
    const inst = {
      instanceId: `inst:${USER_ID}:0`, defId: USER_ID, defVersion: 1,
      inputs: { color: 'token:info' }, placement: { target: 'pane' }, hidden: false,
    }
    expect(Object.keys(computePaneLayout([inst], { hasVolumeBand: false }).bands))
      .not.toContain(USER_ID)

    installUserDefinitions([userDef()])

    expect(Object.keys(computePaneLayout([inst], { hasVolumeBand: false }).bands),
      'the pane-target set was frozen at first call — a definition installed after the '
      + 'first paint reserves no band, and its series is created into a pane the layout '
      + 'never asked for').toContain(USER_ID)
  })
})
